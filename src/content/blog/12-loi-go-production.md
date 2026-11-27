---
title: "12 lỗi Go hay gặp trên production: triệu chứng, cách phát hiện, cách sửa"
description: "Goroutine leak, nil map, data race, HTTP client không timeout, defer trong vòng lặp... Mỗi lỗi kèm triệu chứng thật, công cụ phát hiện và code sửa."
pubDate: 2026-05-15
tags: [golang, backend, production]
---

Go dễ viết, dễ deploy, nên cũng dễ mang lỗi lên production mà không biết. Phần lớn các lỗi dưới đây **compile được, test qua được**, chỉ lộ ra khi có tải thật hoặc chạy vài ngày liền.

Mỗi lỗi có bốn phần: **code lỗi → triệu chứng → cách phát hiện → cách sửa**.

Trước khi vào, đây là bộ công cụ mà gần như lỗi nào cũng dùng tới:

```go
import _ "net/http/pprof"

go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
```

- `go test -race ./...` và `go build -race` để tìm data race.
- `go vet ./...`, `staticcheck ./...`, `golangci-lint run` để bắt lỗi tĩnh.
- `/debug/pprof/goroutine`, `/heap`, `/profile` để xem goroutine, heap, CPU.
- Metric `go_goroutines`, `go_memstats_heap_inuse_bytes` (Prometheus client có sẵn).

## 1. Goroutine leak

```go
func search(ctx context.Context, q string) (Result, error) {
	ch := make(chan Result) // unbuffered
	go func() { ch <- callBackend(q) }()

	select {
	case r := <-ch:
		return r, nil
	case <-ctx.Done():
		return Result{}, ctx.Err() // goroutine kia kẹt mãi ở `ch <-`
	}
}
```

**Triệu chứng:** memory tăng đều theo ngày, không bao giờ giảm. `go_goroutines` tăng từ vài trăm lên vài trăm nghìn. Restart pod thì "khỏi", vài ngày sau bị lại.

**Phát hiện:**

```bash
curl -s localhost:6060/debug/pprof/goroutine?debug=1 | head -50
```

Thấy hàng chục nghìn goroutine cùng stack `chan send` tại cùng một dòng là đúng bệnh. Trong test, dùng `go.uber.org/goleak`:

```go
func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }
```

**Sửa:** goroutine nào cũng phải có đường thoát. Ở đây dùng channel buffer 1 để lệnh gửi không bao giờ chặn:

```go
ch := make(chan Result, 1)
```

Quy tắc chung: trước khi viết `go func()`, trả lời được câu "goroutine này kết thúc khi nào?".

## 2. Ghi vào nil map

```go
type Cache struct {
	items map[string]string
}

func (c *Cache) Set(k, v string) { c.items[k] = v } // panic nếu items chưa make

var c Cache
c.Set("a", "b") // panic: assignment to entry in nil map
```

**Triệu chứng:** pod crash với `panic: assignment to entry in nil map`, thường ở một code path ít chạy (struct khởi tạo bằng literal ở một chỗ khác, hoặc unmarshal JSON thiếu field).

**Phát hiện:** stack trace trong log ghi rõ dòng lỗi. `nilaway` (của Uber) bắt được nhiều trường hợp trước khi deploy.

**Sửa:** dùng constructor, hoặc khởi tạo lười:

```go
func NewCache() *Cache { return &Cache{items: make(map[string]string)} }

func (c *Cache) Set(k, v string) {
	if c.items == nil {
		c.items = make(map[string]string)
	}
	c.items[k] = v
}
```

Đọc nil map thì an toàn (trả zero value), chỉ ghi là panic.

## 3. Data race trên map

```go
var counts = map[string]int{}

func handler(w http.ResponseWriter, r *http.Request) {
	counts[r.URL.Path]++ // mỗi request một goroutine
}
```

**Triệu chứng:** thỉnh thoảng process chết với `fatal error: concurrent map writes`. Đây là `fatal error`, **không recover được**, cả process chết. Với race trên biến thường thì không crash, chỉ ra số sai một cách khó hiểu.

**Phát hiện:**

```bash
go test -race ./...
```

Chạy một canary build với `-race` dưới tải thật cũng rất hiệu quả (chậm 2 đến 10 lần, tốn RAM hơn, nên chỉ một pod).

**Sửa:** bảo vệ bằng mutex, hoặc dùng `sync.Map` khi key ít đổi, đọc nhiều:

```go
var (
	mu     sync.Mutex
	counts = map[string]int{}
)

func handler(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	counts[r.URL.Path]++
	mu.Unlock()
}
```

Với counter đơn giản, dùng `atomic.Int64` hoặc metric Prometheus.

## 4. HTTP client không có timeout

```go
resp, err := http.Get("https://payment.example.com/charge") // http.DefaultClient: không timeout
```

**Triệu chứng:** đối tác chậm hoặc treo, service của bạn treo theo. Goroutine và connection dồn lên, latency p99 tăng vọt, cuối cùng hết file descriptor (`too many open files`).

**Phát hiện:** pprof goroutine thấy rất nhiều goroutine nằm ở `net/http.(*persistConn).roundTrip` hoặc `readLoop`. Grep code tìm `http.Get(`, `http.Post(`, `http.DefaultClient`.

**Sửa:** client riêng có timeout, và truyền context từ request:

```go
var client = &http.Client{
	Timeout: 5 * time.Second,
	Transport: &http.Transport{
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	},
}

req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
resp, err := client.Do(req)
```

Server cũng vậy: `http.ListenAndServe` mặc định không có timeout, hãy dùng `http.Server{ReadHeaderTimeout: 5 * time.Second, ...}`.

## 5. Quên đóng `resp.Body`

```go
resp, err := client.Do(req)
if err != nil {
	return err
}
if resp.StatusCode != 200 {
	return fmt.Errorf("status %d", resp.StatusCode) // Body chưa đóng
}
defer resp.Body.Close()
```

**Triệu chứng:** số connection TCP tăng dần (`ss -s`, `netstat`), `too many open files`, connection không được tái sử dụng nên latency cao vì phải bắt tay TLS liên tục.

**Phát hiện:** linter `bodyclose` (có trong golangci-lint). Metric số file descriptor `process_open_fds` tăng đều.

**Sửa:** `defer Close()` ngay sau khi kiểm tra `err`, trước mọi nhánh return khác. Muốn tái sử dụng connection thì phải đọc hết body:

```go
resp, err := client.Do(req)
if err != nil {
	return err
}
defer func() {
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}()
```

## 6. `defer` trong vòng lặp

```go
for _, path := range files { // 100.000 file
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close() // chỉ chạy khi hàm return
	process(f)
}
```

**Triệu chứng:** job batch chết giữa chừng với `too many open files`. Chạy với ít file thì không sao.

**Phát hiện:** `staticcheck` (SA9001), golangci-lint `gocritic`. `ls /proc/<pid>/fd | wc -l` tăng liên tục khi job chạy.

**Sửa:** tách thân vòng lặp ra hàm riêng để `defer` chạy sau mỗi lần lặp:

```go
for _, path := range files {
	if err := processFile(path); err != nil {
		return err
	}
}

func processFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return process(f)
}
```

## 7. Nil interface không phải nil

```go
type MyErr struct{}

func (*MyErr) Error() string { return "boom" }

func validate() error {
	var e *MyErr // nil pointer
	if ok := true; ok {
		return e // trả về interface (type=*MyErr, value=nil) ≠ nil
	}
	return nil
}

if err := validate(); err != nil {
	log.Println("failed:", err) // luôn chạy vào đây
}
```

**Triệu chứng:** request thành công nhưng bị báo lỗi, hoặc code gọi `err.Error()` rồi panic vì nil pointer. Rất khó hiểu khi đọc log.

**Phát hiện:** `go vet` không bắt hết; `nilaway` và `staticcheck` bắt được một phần. Code review: hàm trả về `error` nhưng `return` một biến kiểu con trỏ cụ thể là dấu hiệu đáng ngờ.

**Sửa:** luôn trả `nil` tường minh, và khai báo biến lỗi với kiểu `error`:

```go
func validate() error {
	if bad {
		return &MyErr{}
	}
	return nil
}
```

## 8. Slice giữ cả mảng lớn

```go
func firstBytes(path string) []byte {
	data, _ := os.ReadFile(path) // 50 MB
	return data[:16]             // vẫn trỏ vào mảng 50 MB
}
```

Tương tự với `s[:n]` trên chuỗi lớn, hoặc giữ một phần tử của slice struct lớn trong cache.

**Triệu chứng:** heap lớn bất thường so với lượng dữ liệu thực sự cần giữ. Một cache "chỉ có vài nghìn key nhỏ" mà tốn vài GB.

**Phát hiện:**

```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap
```

Xem `inuse_space`: chỗ cấp phát là `os.ReadFile` hoặc `io.ReadAll` nhưng dữ liệu không được giải phóng.

**Sửa:** copy phần cần giữ:

```go
return bytes.Clone(data[:16])           // Go 1.20+
// chuỗi: strings.Clone(s[:n])
```

Một lỗi cùng họ: `append` vào slice con có thể ghi đè dữ liệu slice gốc, vì chung mảng. Dùng full slice expression `s[a:b:b]` để giới hạn capacity.

## 9. Biến vòng lặp bị goroutine bắt nhầm (code trước Go 1.22)

```go
for _, u := range users {
	go func() {
		sendEmail(u) // Go < 1.22: mọi goroutine có thể dùng cùng một u (phần tử cuối)
	}()
}
```

**Triệu chứng:** một người nhận 100 email, 99 người còn lại không nhận được.

**Phát hiện:** `go vet` (loopclosure). Kiểm tra dòng `go` trong `go.mod`: từ **Go 1.22**, mỗi vòng lặp có biến riêng, lỗi này biến mất, **nhưng chỉ khi `go.mod` khai báo `go 1.22` trở lên**. Repo cũ build bằng toolchain mới mà `go.mod` vẫn ghi `go 1.19` thì vẫn dính.

**Sửa:** nâng `go` directive trong `go.mod` lên ≥ 1.22. Nếu chưa nâng được:

```go
for _, u := range users {
	u := u
	go func() { sendEmail(u) }()
}
```

## 10. Không truyền và không tôn trọng `context`

```go
func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query("SELECT ... FROM huge_table") // không dùng r.Context()
	...
}
```

**Triệu chứng:** client đã timeout và bỏ đi từ lâu, nhưng query vẫn chạy trên DB. Khi có sự cố, các query "mồ côi" chồng chất làm DB quá tải, sự cố kéo dài hơn cả khi nguyên nhân gốc đã hết.

**Phát hiện:** `SHOW PROCESSLIST` / `pg_stat_activity` thấy query chạy lâu hơn timeout của API. Linter `noctx` bắt các lệnh gọi HTTP/DB không có context.

**Sửa:** dùng biến thể `...Context` và đặt deadline:

```go
ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
defer cancel()
rows, err := h.db.QueryContext(ctx, "SELECT ... FROM huge_table")
```

Với vòng lặp dài trong code của bạn, kiểm tra `ctx.Err()` định kỳ. Và luôn `defer cancel()`, quên nó thì rò rỉ timer (`go vet` có cảnh báo `lostcancel`).

## 11. Panic trong goroutine làm sập cả process

```go
func handler(w http.ResponseWriter, r *http.Request) {
	go func() {
		audit(r) // nil pointer ở đây → cả server chết
	}()
}
```

`net/http` có recover cho goroutine của handler, **nhưng không recover cho goroutine bạn tự tạo**. Một panic không được recover ở bất kỳ goroutine nào sẽ kết thúc toàn bộ process.

**Triệu chứng:** pod restart, `CrashLoopBackOff`, log cuối là `panic: runtime error: invalid memory address or nil pointer dereference` với stack trace của goroutine nền.

**Phát hiện:** `kubectl logs --previous`, alert theo số lần restart của container.

**Sửa:** bọc goroutine nền bằng helper có recover, log kèm stack:

```go
func Go(fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("goroutine panic", "panic", r, "stack", string(debug.Stack()))
			}
		}()
		fn()
	}()
}
```

Đừng lạm dụng recover để che bug, nó chỉ là lưới an toàn. Lưu ý: `fatal error` (như `concurrent map writes` ở lỗi 3) không recover được.

## 12. Chưa cấu hình `GOMEMLIMIT` / `GOMAXPROCS` trong container

**Triệu chứng:**

- Pod bị `OOMKilled` dù heap "lý thuyết" vẫn dưới limit: GC mặc định (`GOGC=100`) cho heap phình lên gấp đôi lượng live data rồi mới dọn, và không biết container chỉ có 1 GiB.
- Latency tệ, CPU throttling cao: trước Go 1.25, `GOMAXPROCS` mặc định bằng **số CPU của node** (ví dụ 64) chứ không phải CPU limit của container (ví dụ 2), nên scheduler chạy 64 thread trên quota 2 CPU và bị CFS throttle.

**Phát hiện:** `kubectl describe pod` thấy `OOMKilled`; metric `container_cpu_cfs_throttled_periods_total` cao; log `runtime.GOMAXPROCS(0)` khi khởi động để xem giá trị thật.

**Sửa:**

```yaml
env:
  - name: GOMEMLIMIT
    value: "900MiB"   # ~90% memory limit 1Gi
```

Từ Go 1.25, runtime tự đọc CPU limit của cgroup để đặt `GOMAXPROCS`. Với bản cũ hơn, dùng `go.uber.org/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

`GOMEMLIMIT` là giới hạn mềm: GC chạy dày hơn khi gần chạm ngưỡng. Nếu live data thật sự vượt limit thì vẫn OOM; khi đó là lúc đi tìm lỗi 1 hoặc lỗi 8.

## Tổng kết

| # | Lỗi | Triệu chứng chính | Công cụ phát hiện |
|---|---|---|---|
| 1 | Goroutine leak | Memory, `go_goroutines` tăng đều | pprof goroutine, goleak |
| 2 | Ghi vào nil map | `panic: assignment to entry in nil map` | stack trace, nilaway |
| 3 | Race trên map | `fatal error: concurrent map writes` | `-race` |
| 4 | HTTP client không timeout | Treo theo đối tác, hết FD | pprof, grep `DefaultClient` |
| 5 | Quên đóng Body | Connection, FD tăng | bodyclose |
| 6 | `defer` trong vòng lặp | `too many open files` trong batch | staticcheck |
| 7 | Nil interface ≠ nil | Báo lỗi khi không có lỗi | nilaway, review |
| 8 | Slice giữ mảng lớn | Heap lớn bất thường | pprof heap |
| 9 | Biến vòng lặp (< 1.22) | Mọi goroutine dùng cùng giá trị | go vet, `go.mod` |
| 10 | Bỏ qua context | Query mồ côi, DB quá tải | noctx, processlist |
| 11 | Panic trong goroutine | Pod crash, restart | `kubectl logs --previous` |
| 12 | Thiếu GOMEMLIMIT/GOMAXPROCS | OOMKilled, CPU throttling | metric cgroup |

Ba việc làm một lần mà chặn được phần lớn danh sách này:

1. **CI chạy** `go test -race ./...` và `golangci-lint run` (bật `bodyclose`, `noctx`, `staticcheck`, `govet`).
2. **Mọi service mở pprof** trên cổng nội bộ và export metric runtime ra Prometheus, có alert cho `go_goroutines` và số lần restart.
3. **Template service chuẩn** có sẵn HTTP client có timeout, `http.Server` có timeout, helper `Go()` có recover, `GOMEMLIMIT` trong manifest.
