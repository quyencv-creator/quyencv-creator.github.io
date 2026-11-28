---
title: "Status page (2/3): dựng MVP bằng Go"
description: "Phần 2 của series tự dựng dịch vụ status page. Dựng một MVP chạy thật bằng Go và PostgreSQL: probe HTTP, TLS, TCP từ nhiều vùng, scheduler lệch pha, incident engine chỉ mở sự cố khi nhiều vùng cùng lỗi (có test), trang status tĩnh kèm API summary.json, notifier webhook và email, heartbeat giám sát chính bộ giám sát, kèm log chạy thật và một lỗi SQL phát hiện ra trong lúc chạy."
pubDate: 2026-11-28
draft: true
tags: [golang, backend, devops]
---

[Phần 1](/blog/status-page-1-vi-sao-can/) nói về việc vì sao cần trang status và cách giao tiếp khi có sự cố. Phần này bắt tay vào làm: một MVP dịch vụ giám sát và trang status bằng Go, đủ để thấy toàn bộ luồng chạy từ đầu tới cuối.

**Về độ tin cậy của nội dung:** toàn bộ code trong bài đã chạy thật với Go 1.24 và PostgreSQL 16 trên máy local. Log, output test, JSON và ảnh chụp trang status đều là output thật. Phần nào chưa chạy hoặc chỉ là mô phỏng, mình ghi rõ ngay tại chỗ, và có tổng hợp ở cuối bài.

## Kiến trúc tổng quát

```text
             ┌─────────────┐
             │  Scheduler  │  phát job theo chu kỳ, lệch pha từng monitor
             └──────┬──────┘
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   [probe hn]  [probe hcm]  [probe sg]     mỗi vùng một nhóm worker
        └───────────┼───────────┘
                    ▼ Result
             ┌──────────────┐     ┌────────────┐
             │ check_results│◄────┤  Postgres  │
             └──────┬───────┘     └────────────┘
                    ▼
            ┌────────────────┐   opened / resolved
            │ Incident engine├────────────────────► Notifier (webhook, email, ...)
            └───────┬────────┘
                    ▼
            ┌────────────────┐
            │ Status page    │  HTML tĩnh + /api/v2/summary.json
            └────────────────┘

   Heartbeat: checker ghi "còn sống" mỗi giây, watchdog kiểm tra từ bên ngoài
```

Trong MVP, tất cả nằm trong một tiến trình để dễ chạy demo. "Nhiều vùng" được mô phỏng bằng nhiều nhóm worker, không phải máy chủ thật ở nhiều nơi. Mình sẽ nói về đánh đổi này ở cuối.

## Lưu trữ

```sql
CREATE TABLE monitors (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL,
    kind       text NOT NULL CHECK (kind IN ('http', 'tcp')),
    target     text NOT NULL,
    interval_s int  NOT NULL DEFAULT 60
);

-- Nhiều nhất, chỉ cần giữ vài tuần -> partition theo ngày, xoá dữ liệu cũ bằng DROP thay vì DELETE.
CREATE TABLE check_results (
    monitor_id  bigint      NOT NULL,
    region      text        NOT NULL,
    checked_at  timestamptz NOT NULL,
    ok          boolean     NOT NULL,
    latency_ms  int,
    status_code int,
    cert_days   int,
    error       text
) PARTITION BY RANGE (checked_at);

CREATE TABLE incidents (
    id          bigserial PRIMARY KEY,
    monitor_id  bigint      NOT NULL REFERENCES monitors(id),
    status      text        NOT NULL CHECK (status IN ('investigating','identified','monitoring','resolved')),
    started_at  timestamptz NOT NULL,
    resolved_at timestamptz,
    title       text        NOT NULL
);

CREATE TABLE incident_updates (
    id          bigserial PRIMARY KEY,
    incident_id bigint      NOT NULL REFERENCES incidents(id),
    status      text        NOT NULL,
    body        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE heartbeats (name text PRIMARY KEY, beat_at timestamptz NOT NULL);
```

**Vì sao partition `check_results` theo ngày?** Đây là bảng lớn nhất và tăng nhanh nhất. 100 monitor, 3 vùng, check mỗi 30 giây là gần 900.000 dòng mỗi ngày. Dữ liệu chi tiết chỉ cần giữ vài tuần. Với partition theo ngày, xoá dữ liệu cũ là `DROP TABLE check_results_20261001`, gần như tức thì, thay vì một câu `DELETE` hàng chục triệu dòng làm phình bảng và tốn I/O (xem thêm về thao tác trên bảng lớn trong bài [migration không downtime](/blog/database-migration-khong-downtime/)). Đổi lại, cần một job tạo partition trước cho những ngày sắp tới:

```go
func (s *Store) EnsurePartitions(ctx context.Context, from, to time.Time) error {
    for d := from.Truncate(24 * time.Hour); !d.After(to); d = d.Add(24 * time.Hour) {
        name := "check_results_" + d.Format("20060102")
        sql := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s PARTITION OF check_results
            FOR VALUES FROM ('%s') TO ('%s')`, name, d.Format(time.RFC3339), d.Add(24*time.Hour).Format(time.RFC3339))
        if _, err := s.db.Exec(ctx, sql); err != nil {
            return err
        }
    }
    return nil
}
```

```text
 check_results_20261127
 check_results_20261128
 check_results_20261129
```

**Vì sao `incidents` không partition?** Số lượng incident nhỏ, và lịch sử incident cần giữ lâu (uptime 90 ngày, báo cáo SLA) nên không có lý do gì để chia.

## Probe: HTTP, TLS, TCP

Mỗi vùng có một `Probe` riêng. Kết quả gồm trạng thái, độ trễ, mã HTTP và số ngày còn lại của chứng chỉ TLS.

```go
func (p *Probe) Check(ctx context.Context, m Monitor) Result {
    r := Result{MonitorID: m.ID, Region: p.Region, At: time.Now(), CertDays: -1}
    if p.Fault != nil { // mô phỏng sự cố mạng chỉ ở vùng này
        if err := p.Fault(m); err != nil {
            r.Err = err.Error()
            return r
        }
    }
    start := time.Now()
    switch m.Kind {
    case "http":
        req, _ := http.NewRequestWithContext(ctx, http.MethodGet, m.Target, nil)
        resp, err := p.Client.Do(req)
        r.Latency = time.Since(start)
        if err != nil {
            r.Err = err.Error()
            return r
        }
        resp.Body.Close()
        r.StatusCode = resp.StatusCode
        if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
            r.CertDays = int(time.Until(resp.TLS.PeerCertificates[0].NotAfter).Hours() / 24)
        }
        r.OK = resp.StatusCode >= 200 && resp.StatusCode < 400
        if !r.OK {
            r.Err = resp.Status
        }
    case "tcp":
        d := net.Dialer{Timeout: 3 * time.Second}
        conn, err := d.DialContext(ctx, "tcp", m.Target)
        r.Latency = time.Since(start)
        if err != nil {
            r.Err = err.Error()
            return r
        }
        conn.Close()
        r.OK = true
    }
    return r
}
```

Vài quyết định trong cấu hình HTTP client:

```go
Client: &http.Client{
    Timeout: 3 * time.Second,
    // Không theo redirect: 301 về trang đăng nhập cũng là tín hiệu cần biết.
    CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
    Transport: &http.Transport{
        // Demo dùng cert tự ký của httptest. Production: bỏ dòng này.
        TLSClientConfig:   &tls.Config{InsecureSkipVerify: true},
        DisableKeepAlives: true, // đo cả thời gian bắt tay, giống người dùng mới
    },
},
```

- **Timeout ngắn** (3 giây): một endpoint trả về sau 30 giây với người dùng cũng là hỏng.
- **Không theo redirect**: nếu trang chủ bất ngờ redirect về trang đăng nhập, đó là sự cố, không phải thành công.
- **Tắt keep-alive**: mỗi lần check mở kết nối mới, đo cả DNS và bắt tay TLS, giống trải nghiệm của người dùng mới. Đổi lại tốn tài nguyên hơn.
- **`InsecureSkipVerify` chỉ dùng cho demo** vì server giả lập dùng chứng chỉ tự ký. Trên production, chứng chỉ không hợp lệ phải được coi là lỗi.

Output thật của lần check TLS đầu tiên:

```text
[t=  0.3s] TLS API thanh toán: cert còn 20881 ngày, latency 3ms
```

Con số 20.881 ngày là vì chứng chỉ của `httptest` trong Go có hạn rất xa. Với chứng chỉ thật, ta sẽ đặt cảnh báo khi còn dưới khoảng 14 đến 30 ngày. Phần cảnh báo hết hạn cert chưa được làm trong MVP này: dữ liệu `cert_days` đã được lưu, nhưng chưa có rule cảnh báo.

## Scheduler: lệch pha để không dồn cùng một giây

Nếu mọi monitor đều khởi động cùng lúc với cùng chu kỳ, chúng sẽ chạy đồng loạt ở cùng một giây, mỗi phút một lần. Đó chính là vấn đề mình đã gặp với cache trong bài [cache stampede](/blog/golang-cache-stampede-flash-sale/), chỉ là lần này kẻ bị dồn tải là chính bộ giám sát và các hệ thống được giám sát.

Cách giải: mỗi monitor có một **pha** cố định trong chu kỳ, tính từ hash của tên.

```go
func phase(m Monitor) time.Duration {
    h := fnv.New32a()
    h.Write([]byte(m.Name))
    return time.Duration(h.Sum32()%uint32(m.Interval.Milliseconds())) * time.Millisecond
}
```

Dùng hash thay vì số ngẫu nhiên để pha **ổn định qua các lần khởi động lại**: cùng một monitor luôn chạy ở cùng thời điểm trong chu kỳ, đồ thị độ trễ không bị nhảy mỗi lần deploy.

Đo với 300 monitor, chu kỳ 60 giây:

```text
không lệch pha: tối đa 300 check trong cùng 1 giây
lệch pha theo hash: tối đa 9 check trong cùng 1 giây, 10 giây đầu: [5 3 4 8 3 9 6 5 3 3]
```

Scheduler phát job tới hàng đợi của từng vùng. Nếu một vùng quá tải, bỏ lượt đó thay vì để hàng đợi tăng vô hạn:

```go
for _, q := range regions {
    select {
    case q <- Job{Monitor: m}:
    default: // vùng đang quá tải: bỏ lượt này
    }
}
```

Bỏ lượt nghĩa là mất một điểm dữ liệu. Nhưng một bộ giám sát mà hàng đợi dồn tới mức check chạy trễ cả phút thì còn tệ hơn: nó báo cáo về quá khứ mà tưởng là hiện tại. Trong production, cần đếm số lượt bị bỏ và cảnh báo khi nó tăng. Cách tổ chức worker và hàng đợi trong Go có thể xem thêm ở bài [background job](/blog/golang-background-job/).

## Incident engine: không báo động giả

Đây là phần quan trọng nhất. Một bộ giám sát báo sai sẽ nhanh chóng bị mọi người phớt lờ, và tới lúc có sự cố thật thì không ai tin nữa.

Quy tắc của MVP:

- Một vùng được coi là **đang lỗi** khi fail **N lần liên tiếp** (ở đây N = 3).
- Chỉ **mở incident** khi có **ít nhất 2 vùng** cùng đang lỗi.
- **Đóng incident** khi số vùng đang lỗi dưới 2 **và** ít nhất 2 vùng đã OK **M lần liên tiếp** (M = 2).

Hai lớp lọc này loại bỏ hai nguồn báo động giả phổ biến nhất: **lỗi thoáng qua** (một request timeout ngẫu nhiên) và **lỗi mạng ở một vùng** (đường truyền từ vùng đó có vấn đề, nhưng người dùng ở nơi khác vẫn dùng bình thường).

Engine được viết thành logic thuần: không gọi mạng, không gọi database, chỉ nhận kết quả và trả ra sự kiện.

```go
func (e *Engine) Observe(r Result) []Event {
    s := e.state[r.MonitorID]
    if s == nil {
        s = &monState{fails: map[string]int{}, oks: map[string]int{}, lastErr: map[string]string{}}
        e.state[r.MonitorID] = s
    }
    if r.OK {
        s.fails[r.Region], s.oks[r.Region] = 0, s.oks[r.Region]+1
    } else {
        s.fails[r.Region], s.oks[r.Region] = s.fails[r.Region]+1, 0
        s.lastErr[r.Region] = r.Err
    }

    var failing, healthy []string
    for region := range s.fails {
        if s.fails[region] >= e.FailThreshold {
            failing = append(failing, region)
        }
        if s.oks[region] >= e.RecoverThreshold {
            healthy = append(healthy, region)
        }
    }
    sort.Strings(failing)

    switch {
    case !s.open && len(failing) >= e.MinRegions:
        s.open = true
        return []Event{{Kind: IncidentOpened, MonitorID: r.MonitorID, Regions: failing, At: r.At, Reason: s.lastErr[failing[0]]}}
    case s.open && len(failing) < e.MinRegions && len(healthy) >= e.MinRegions:
        s.open = false
        return []Event{{Kind: IncidentResolved, MonitorID: r.MonitorID, At: r.At}}
    }
    return nil
}
```

Nhờ tách khỏi I/O, có thể test các trường hợp khó một cách nhanh và chắc chắn:

```go
// Một vùng lỗi kéo dài (vd đường truyền quốc tế) không được mở incident.
func TestSingleRegionFailureDoesNotOpenIncident(t *testing.T) {
    e := NewEngine(3, 2, 2)
    for round := 0; round < 50; round++ {
        evs := append(append(feed(e, "sg", false, 1), feed(e, "hn", true, 1)...), feed(e, "hcm", true, 1)...)
        if len(evs) > 0 {
            t.Fatalf("round %d: không được có sự kiện, nhận %+v", round, evs)
        }
    }
}

// Lỗi chập chờn không đủ N lần liên tiếp ở 2 vùng thì không mở.
func TestFlappingBelowThresholdDoesNotOpen(t *testing.T) {
    e := NewEngine(3, 2, 2)
    for round := 0; round < 20; round++ {
        ok := round%3 == 2 // fail, fail, ok, fail, fail, ok...
        if evs := append(feed(e, "hn", ok, 1), feed(e, "hcm", ok, 1)...); len(evs) > 0 {
            t.Fatalf("round %d: không được mở incident khi chưa đủ 3 lần liên tiếp: %+v", round, evs)
        }
    }
}
```

```text
=== RUN   TestSingleRegionFailureDoesNotOpenIncident
--- PASS: TestSingleRegionFailureDoesNotOpenIncident (0.00s)
=== RUN   TestFlappingBelowThresholdDoesNotOpen
--- PASS: TestFlappingBelowThresholdDoesNotOpen (0.00s)
=== RUN   TestTwoRegionsOpenThenResolve
--- PASS: TestTwoRegionsOpenThenResolve (0.00s)
PASS
```

**Đánh đổi:** mỗi lớp lọc làm việc phát hiện chậm hơn. Với check mỗi 30 giây và N = 3, incident được mở sau khoảng 1,5 phút. Giảm N thì phát hiện nhanh hơn nhưng báo sai nhiều hơn. Không có con số đúng cho mọi hệ thống; với API thanh toán có thể chấp nhận báo sai để phát hiện nhanh, với trang blog thì ngược lại. Một hệ thống thật nên cho cấu hình N và số vùng tối thiểu theo từng monitor.

**Một giới hạn quan trọng:** trạng thái của engine nằm trong bộ nhớ. Nếu tiến trình khởi động lại, engine quên mọi bộ đếm, và incident đang mở trong database sẽ không bao giờ được đóng tự động. Bản production cần khôi phục trạng thái từ các kết quả gần nhất trong `check_results` và các incident đang mở khi khởi động. MVP này chưa làm.

## Notifier: một interface, nhiều kênh

```go
type Notifier interface {
    Name() string
    Notify(ctx context.Context, n Notification) error
}
```

MVP có hai cài đặt: `WebhookNotifier` gửi POST JSON thật tới một URL (trong demo là một server `httptest` đóng vai hệ thống của khách hàng), và `EmailNotifier` **giả lập**, chỉ ghi log. Thêm Slack hay Zalo sau này chỉ cần thêm một kiểu cài đặt interface này.

Gửi tới nhiều kênh, mỗi kênh có retry, kênh này lỗi không chặn kênh khác:

```go
func Fanout(ctx context.Context, ns []Notifier, n Notification) error {
    var errs []error
    for _, nt := range ns {
        var err error
        for attempt := 0; attempt < 3; attempt++ {
            if err = nt.Notify(ctx, n); err == nil {
                break
            }
            time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
        }
        if err != nil {
            errs = append(errs, fmt.Errorf("%s: %w", nt.Name(), err))
        }
    }
    return errors.Join(errs...)
}
```

Trong MVP, `Fanout` chạy đồng bộ ngay trong vòng xử lý kết quả. Một webhook chậm 3 giây sẽ làm chậm cả vòng xử lý. Bản production nên đưa thông báo vào hàng đợi riêng, có lưu trạng thái gửi để không mất thông báo khi tiến trình khởi động lại, và có cơ chế chống gửi trùng.

## Trang status và API JSON

Trang status được **sinh ra thành file tĩnh** (HTML và JSON), không phải một trang động truy vấn database mỗi lần có người xem. Như phần 1 đã nói, lúc có sự cố là lúc lượng truy cập trang status tăng vọt. File tĩnh đặt sau CDN chịu được gần như bất kỳ lượng truy cập nào, và vẫn hiển thị được ngay cả khi database của dịch vụ giám sát gặp vấn đề.

Ghi file theo kiểu ghi ra file tạm rồi đổi tên, để người đọc không bao giờ thấy một file viết dở:

```go
tmp := path + ".tmp"
// ... ghi nội dung vào tmp ...
return os.Rename(tmp, path)
```

API `summary.json` theo cấu trúc tương tự các trang dựng bằng Atlassian Statuspage. Output thật, chụp lại trong lúc incident đang mở:

```json
{
  "status": {
    "indicator": "major",
    "description": "Một số hệ thống đang gặp sự cố"
  },
  "components": [
    { "id": 1, "name": "API thanh toán", "status": "major_outage", "uptime_90d": 99.448 },
    { "id": 2, "name": "Website", "status": "operational", "uptime_90d": 99.965 },
    { "id": 3, "name": "Database", "status": "operational", "uptime_90d": 99.996 }
  ],
  "incidents": [
    { "id": 6, "name": "API thanh toán không truy cập được", "status": "investigating", "resolved_at": null }
  ]
}
```

(Số uptime được làm tròn khi trích vào bài; file thật có đủ chữ số.)

Trang HTML sinh ra, chụp sau khi demo kết thúc:

![Trang status sinh ra bởi MVP: 3 thành phần với thanh uptime 90 ngày và danh sách sự cố gần đây](/blog-assets/status-page-mvp.png)

Các sự cố ghi "dữ liệu giả lập" là lịch sử được tạo sẵn để thanh uptime 90 ngày có dữ liệu. Sự cố đầu danh sách là sự cố thật của lần chạy demo.

### Uptime tính từ incident, không phải từ từng lần check

Uptime một ngày được tính bằng **thời gian nằm trong incident**, không phải tỉ lệ check thành công. Lý do: nếu tính theo từng check, một vùng lỗi mạng cả ngày sẽ kéo uptime xuống, dù người dùng không hề bị ảnh hưởng. Tính theo incident thì uptime nhất quán với quy tắc mở incident.

### Một lỗi thật phát hiện khi chạy

Lần chạy đầu, trang status hiện **đỏ gần như toàn bộ 90 ngày**, uptime khoảng 2 đến 4%, dù chỉ có vài sự cố lịch sử.

**Nghi ngờ đầu tiên, và nó sai:** code ban đầu viết `rs.Scan(&d.Date, &d.Uptime)` mà không kiểm tra lỗi. Mình đoán `Scan` đang lỗi âm thầm, nên thêm kiểm tra lỗi ở mọi chỗ `Scan` và ép kiểu kết quả sang `float8` cho chắc. Chạy lại: vẫn đỏ, và không có lỗi nào được trả về. Giả thuyết bị loại. Thay đổi đó vẫn được giữ lại, vì bỏ qua lỗi `Scan` là thói quen xấu, nhưng nó không phải nguyên nhân.

**Nguyên nhân thật: `GREATEST` và `LEAST` bỏ qua `NULL`.** Câu SQL ban đầu:

```sql
SUM(EXTRACT(EPOCH FROM
    LEAST(COALESCE(i.resolved_at, now()), days.day + interval '1 day')
  - GREATEST(i.started_at, days.day::timestamptz)))
```

Với những ngày không có incident nào, `LEFT JOIN` trả về `NULL` cho mọi cột của `i`. Trong PostgreSQL, `GREATEST` và `LEAST` **bỏ qua giá trị `NULL`** thay vì trả về `NULL`. Kết quả: `COALESCE(i.resolved_at, now())` thành `now()`, `LEAST` cho ra cuối ngày, `GREATEST(NULL, đầu ngày)` cho ra đầu ngày, và mỗi ngày không có sự cố bị tính đủ 86.400 giây downtime. Kiểm tra trực tiếp trong psql:

```text
    day     | count |      s
------------+-------+--------------
 2026-08-31 |     0 | 86400.000000
 2026-09-01 |     0 | 86400.000000
```

`count = 0` incident nhưng tổng downtime là 86.400 giây. Cách sửa: chỉ tính khi thật sự có incident.

```sql
SUM(CASE WHEN i.id IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM
    LEAST(COALESCE(i.resolved_at, now()), days.day + interval '1 day')
  - GREATEST(i.started_at, days.day::timestamptz)) END)
```

Sau khi sửa, uptime về đúng giá trị 99,4% đến 99,99% như trong ảnh. Bài học: một trang status báo sai uptime còn tệ hơn không có trang status, và **lỗi kiểu này chỉ lộ ra khi nhìn tận mắt kết quả**, vì code không hề báo lỗi. Nên có test cho câu SQL tính uptime với dữ liệu biết trước đáp án.

## Heartbeat: ai giám sát bộ giám sát?

Nếu tiến trình checker bị treo, nó sẽ không báo lỗi, cũng không mở incident. Nó chỉ im lặng, và mọi thứ trên trang status trông vẫn xanh. Đây là kiểu sự cố nguy hiểm nhất của một hệ thống giám sát.

Giải pháp là **dead man's switch**: checker ghi "tôi còn sống" định kỳ, và một tiến trình khác kiểm tra. Nếu quá lâu không có tín hiệu, báo động.

```go
// Checker: mỗi giây ghi heartbeat.
store.Beat(ctx, "checker")

// Watchdog: kiểm tra tuổi của heartbeat.
if age := time.Since(last); age > 3*time.Second && !alerted {
    logf("WATCHDOG: checker im lặng %v -> báo động: hệ thống giám sát đã ngừng hoạt động", age.Round(time.Second))
}
```

Trong demo, watchdog chạy **cùng tiến trình** để dễ quan sát, nên nó chỉ chứng minh được cơ chế. Trong thực tế, watchdog **phải chạy ở nơi khác**: một máy khác, một nhà cung cấp khác, hoặc một dịch vụ nhận heartbeat bên ngoài. Nếu watchdog chạy cùng máy với checker, khi máy chết thì cả hai cùng chết và không ai báo. Đây cũng là nguyên tắc "chạy tách khỏi hệ thống được giám sát" ở phần 1, áp dụng cho chính bộ giám sát.

## Chạy demo toàn bộ luồng

Kịch bản demo:

- **API thanh toán**: server HTTPS giả lập, sống từ giây 0 đến 6, trả lỗi 500 từ giây 6 đến 16, rồi sống lại.
- **Website**: luôn sống, nhưng vùng `sg` bị mô phỏng mất kết nối suốt buổi (giả lập sự cố đường truyền một vùng).
- **Database**: check TCP tới cổng PostgreSQL thật.
- 3 vùng `hn`, `hcm`, `sg`; check mỗi 1 giây (để demo nhanh; thực tế thường 30 đến 60 giây).
- Ở giây 22: mô phỏng checker bị treo, dừng mọi check và heartbeat.

Log thật:

```text
[t=  0.0s] bắt đầu: 3 monitor x 3 vùng, check mỗi 1s; mở incident khi >= 2 vùng lỗi 3 lần liên tiếp
[t=  0.3s] TLS API thanh toán: cert còn 20881 ngày, latency 3ms
[t=  2.0s] Website lỗi ở vùng sg (3 lần), các vùng khác OK -> không mở incident
[t=  8.3s] INCIDENT #6 MỞ: API thanh toán, vùng lỗi [hcm hn] (500 Internal Server Error)
[t=  8.3s] webhook nhận: {"kind":"opened","incident_id":6,"monitor":"API thanh toán","regions":["hcm","hn"],"at":"2026-11-28T02:11:57.449028205Z","message":"[SỰ CỐ] API thanh toán không truy cập được từ [hcm hn]"}
2026/11/28 02:11:57 [email -> oncall@example.com] [SỰ CỐ] API thanh toán không truy cập được từ [hcm hn]
[t=  9.0s] Website lỗi ở vùng sg (10 lần), các vùng khác OK -> không mở incident
[t= 17.3s] INCIDENT #6 ĐÓNG: API thanh toán đã hồi phục
[t= 17.3s] webhook nhận: {"kind":"resolved","incident_id":6,"monitor":"API thanh toán","at":"2026-11-28T02:12:06.449334813Z","message":"[ĐÃ KHẮC PHỤC] API thanh toán hoạt động trở lại"}
2026/11/28 02:12:06 [email -> oncall@example.com] [ĐÃ KHẮC PHỤC] API thanh toán hoạt động trở lại
[t= 19.0s] Website lỗi ở vùng sg (20 lần), các vùng khác OK -> không mở incident
[t= 22.0s] mô phỏng tiến trình checker bị treo: dừng mọi check và heartbeat
[t= 26.0s] WATCHDOG: checker im lặng 4s -> báo động: hệ thống giám sát đã ngừng hoạt động
[t= 28.0s] kết thúc. webhook đã nhận 2 lần. summary.status={"indicator":"none","description":"Tất cả hệ thống hoạt động bình thường"}
[t= 28.0s] check_results: 198 dòng
```

Đọc log:

- **Server lỗi ở giây 6, incident mở ở giây 8,3**: đúng 3 lần check thất bại liên tiếp ở 2 vùng. Lúc mở, chỉ 2 vùng `hcm` và `hn` đạt ngưỡng; vùng thứ ba tới sau một chút vì các vùng check lệch nhau vài trăm mili giây. Ở một lần chạy khác, cặp vùng đạt ngưỡng trước là `hcm` và `sg`, điều này là bình thường.
- **Server hồi phục ở giây 16, incident đóng ở giây 17,3**: sau 2 lần check OK liên tiếp.
- **Website lỗi ở `sg` hơn 20 lần trong suốt buổi demo nhưng không có incident nào**: đúng như test đã chứng minh.
- **Mỗi sự kiện tạo đúng một webhook và một email**: tổng 2 webhook.
- **Checker treo ở giây 22, watchdog báo ở giây 26**: ngưỡng là 3 giây, cộng với chu kỳ kiểm tra 1 giây của watchdog.
- **Incident có ID 6** vì 5 incident lịch sử giả lập được tạo trước.

Các bản ghi trong `incident_updates` sau khi chạy:

```text
  1 | investigating | Phát hiện tự động: API thanh toán lỗi từ các vùng [hcm sg]. Đang điều tra. | 02:10:09
  2 | resolved      | Dịch vụ đã hoạt động trở lại bình thường.                                  | 02:10:18
```

(Bản ghi này lấy từ một lần chạy trước đó, trong đó cặp vùng đạt ngưỡng đầu tiên là `hcm` và `sg`.)

Nội dung cập nhật tự động ở đây còn rất máy móc. Như phần 1 đã nói, cập nhật trên trang status nên do con người viết lại bằng ngôn ngữ người dùng hiểu. Bản tự động chỉ nên là bản nháp đầu tiên, hoặc chỉ hiện trong nội bộ cho tới khi có người xác nhận.

## Những gì MVP này chưa làm

Để rõ ràng về mức độ "chạy thật" của bài:

**Đã chạy thật:** probe HTTP, HTTPS (đọc ngày hết hạn cert) và TCP; scheduler lệch pha; lưu vào PostgreSQL với partition theo ngày; incident engine với 3 test pass; mở và đóng incident trong database; webhook gửi POST thật tới một server local; sinh trang HTML và `summary.json`; heartbeat và watchdog; toàn bộ log demo ở trên.

**Mô phỏng, chưa phải thật:**

- **Nhiều vùng** là nhiều nhóm worker trong cùng một tiến trình, cùng một máy. Bản thật cần probe chạy ở nhiều nơi khác nhau, gửi kết quả về trung tâm qua hàng đợi.
- **Sự cố mạng ở vùng `sg`** được giả lập bằng hàm `Fault`, không phải mất kết nối thật.
- **Email** chỉ ghi log.
- **Watchdog** chạy cùng tiến trình với checker.
- **Lịch sử 90 ngày** là dữ liệu tạo sẵn.

**Chưa làm:**

- Khôi phục trạng thái engine khi khởi động lại.
- Cảnh báo cert sắp hết hạn.
- Ghi kết quả theo lô (mỗi kết quả hiện là một câu `INSERT`; với tải lớn nên gom lô hoặc dùng `COPY`).
- Job xoá partition cũ.
- Giao diện quản trị để con người viết cập nhật sự cố, có đăng nhập và phân quyền.
- Hàng đợi bền vững cho thông báo, chống gửi trùng.
- Người đăng ký nhận thông báo (subscriber).
- Metric của chính hệ thống giám sát: số check mỗi giây, số lượt bị bỏ, độ trễ xử lý. Xem bài [observability](/blog/observability-go-vs-rails/) để biết nên đo gì.

Danh sách "chưa làm" dài hơn danh sách "đã làm", và đó là điều đáng nói nhất của bài này. Phần chạy được trong một buổi chiều chỉ là phần nhỏ. Phần còn lại, thứ làm nên một dịch vụ đáng tin cậy, mới là phần tốn thời gian. Mỗi lần dịch vụ giám sát báo sai hay bỏ sót, hãy viết [postmortem](/blog/postmortem-la-gi/) như với bất kỳ hệ thống production nào, vì với một dịch vụ giám sát, độ tin cậy chính là sản phẩm.

## Tiếp theo

[Phần 3](/blog/status-page-3-mo-hinh-kinh-doanh/) bàn về câu hỏi tiếp theo: có nên biến công cụ này thành một dịch vụ để bán không, thị trường ra sao, và những rủi ro khi thứ mình bán là độ tin cậy.

Toàn bộ mã nguồn MVP gồm khoảng 900 dòng Go và SQL, chia thành các file `probe.go`, `scheduler.go`, `engine.go`, `engine_test.go`, `store.go`, `notifier.go`, `statuspage.go`, `main.go` và `schema.sql`.
