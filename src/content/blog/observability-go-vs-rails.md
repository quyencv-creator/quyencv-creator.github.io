---
title: "Vì sao Go app hay nói về Prometheus, Grafana, OpenTelemetry còn Rails app thì ít?"
description: Go cần tự lắp observability và lắp rất dễ, Rails thì mua APM trọn gói nên ít ai phải nói tới. Bài viết giải thích lý do kỹ thuật lẫn văn hoá, trả lời câu hỏi dự án bình thường không phải microservice có cần stack này không, và các công cụ có sẵn thay thế ở cả Go lẫn Rails.
pubDate: 2026-08-10
tags: [golang, ruby, devops, backend]
---

Đọc blog kỹ thuật của team Go, bạn sẽ gặp Prometheus, Grafana, OpenTelemetry ở khắp nơi: dashboard, histogram, trace xuyên 12 service. Đọc blog của team Rails, chủ đề này hiếm hơn hẳn.

Không phải vì Rails app không được giám sát. Chúng vẫn được giám sát, chỉ là theo một cách khác: **mua APM trọn gói** (New Relic, Datadog, Skylight, Scout, AppSignal), cài một gem, xong. Việc dễ quá thì không ai viết bài.

Nhận định trên là quan sát cá nhân, không có số liệu khảo sát. Nhưng đằng sau nó có những lý do kỹ thuật rất cụ thể.

Trước khi đi tiếp, phân biệt nhanh ba công cụ:

- **Prometheus**: thu thập và lưu **metric** (số liệu theo thời gian: số request, độ trễ, bộ nhớ…).
- **Grafana**: **vẽ dashboard** và cảnh báo, đọc dữ liệu từ Prometheus và nhiều nguồn khác.
- **OpenTelemetry (OTel)**: một **chuẩn chung** cùng bộ thư viện để tạo trace, metric, log và gửi tới bất kỳ backend nào, không bị khoá vào một nhà cung cấp.

## Vì sao Go *cần* tự lắp observability?

### 1. Không có gì "cài vào là chạy"

Hầu hết APM cho Ruby, Python, Java hoạt động bằng **auto-instrumentation**: lúc runtime, gem tự chèn code đo đạc vào Rails, ActiveRecord, Net::HTTP, Redis… nhờ monkey-patch. Ruby là ngôn ngữ động nên chuyện này dễ.

Go biên dịch ra mã máy, không có monkey-patch. Không thư viện nào tự chui vào `net/http` hay `database/sql` để đo được. Muốn có metric hay trace, **bạn phải tự viết code**: bọc handler bằng middleware, bọc HTTP client bằng transport, truyền `context.Context` đi khắp nơi. (Gần đây có thêm hướng instrument bằng eBPF hoặc chèn code lúc biên dịch, nhưng chưa phổ biến bằng cách viết tường minh.)

Đã phải tự lắp thì team phải chọn công cụ, phải hiểu nó, và phải viết tài liệu cho nhau. Bài blog sinh ra từ đó.

### 2. Go thường chạy trong kiến trúc nhiều service

Go hay được chọn cho microservice, API gateway, worker, công cụ hạ tầng. Một request của user có thể đi qua 5–10 service. Khi request đó chậm, câu hỏi đầu tiên là **chậm ở service nào?** Log riêng lẻ của từng service không trả lời được. Cần **distributed tracing**: một trace ID đi xuyên mọi service, cho thấy mỗi chặng mất bao lâu. OpenTelemetry sinh ra cho đúng bài toán này.

### 3. Chi phí APM tăng theo số service

APM thương mại thường tính tiền theo host, theo container hoặc theo lượng dữ liệu. Một monolith Rails trên 4 server thì hoá đơn chấp nhận được. 80 service Go trên Kubernetes, mỗi service vài pod, thì hoá đơn là một con số mà CFO sẽ hỏi. Stack mã nguồn mở tự vận hành (Prometheus, Grafana, Tempo, Loki) tốn công nhưng chi phí dễ kiểm soát hơn ở quy mô đó.

## Vì sao Go *dễ* lắp observability?

### 1. Cùng một hệ sinh thái

Prometheus, Kubernetes, Docker, etcd, Grafana Tempo, phần lớn OpenTelemetry Collector đều viết bằng Go. Thư viện Prometheus cho Go (`client_golang`) do chính đội Prometheus duy trì. Dùng Prometheus trong Go gần như là dùng công cụ "nhà làm".

### 2. Một process, nhiều goroutine

Một Go app thường là **một process duy nhất** xử lý mọi request bằng goroutine. Mọi metric nằm chung một vùng nhớ, nên chỉ cần mở một endpoint `/metrics` là Prometheus đọc được toàn bộ:

```go
var reqDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "http_request_duration_seconds",
    Help:    "HTTP request latency",
    Buckets: prometheus.DefBuckets,
}, []string{"route", "status"})

func instrument(route string, h http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        h(w, r)
        reqDuration.WithLabelValues(route, "200").Observe(time.Since(start).Seconds())
    }
}

func main() {
    http.HandleFunc("/orders", instrument("/orders", ordersHandler))
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":8080", nil)
}
```

Chỉ vậy là `/metrics` đã có độ trễ request, kèm sẵn metric của runtime Go (GC, goroutine, bộ nhớ) mà `client_golang` tự đăng ký:

```text
# HELP go_gc_duration_seconds A summary of the wall-time pause (stop-the-world) duration in garbage collection cycles.
# TYPE go_gc_duration_seconds summary
go_gc_duration_seconds{quantile="0"} 0
...
```

(Ví dụ trên ghi status cố định là `"200"` cho ngắn. Code thật cần bọc `ResponseWriter` để lấy status thật.)

### 3. Middleware và `context` là chuẩn chung

Mọi thư viện HTTP và gRPC trong Go đều dùng mô hình middleware và `context.Context`. OTel tận dụng đúng điều này: `otelhttp.NewHandler` bọc handler, `otelhttp.NewTransport` bọc HTTP client, trace context tự đi theo `ctx`. Không cần phép màu nào cả. Xem thêm [bài về middleware](/blog/golang-middleware/) và [bài về context](/blog/context-trong-go/).

### 4. OTel cho Go chín sớm

Theo trang trạng thái của OpenTelemetry, SDK Go đã ổn định cho traces và metrics từ khá sớm. Ruby thì đến thời điểm viết bài, **chỉ traces là stable; metrics và logs vẫn đang ở giai đoạn phát triển** (gem riêng, chưa tới 1.0). Đây là một lý do rất thực tế khiến bài viết "Rails + OTel đầy đủ" còn hiếm.

## Vì sao Rails ít nhắc tới?

### 1. APM cài một gem là chạy

```ruby
# Gemfile
gem "newrelic_rpm"   # hoặc skylight, scout_apm, appsignal, ddtrace...
```

Khởi động lại là có ngay trace từng request, từng query SQL, từng lời gọi Redis, Sidekiq job. Auto-instrumentation qua monkey-patch làm hết. Không ai cần viết bài "cách lắp observability cho Rails" vì không có gì để lắp.

### 2. Monolith không cần distributed tracing

Một request Rails đi từ Puma → controller → ActiveRecord → Postgres và quay về, trong **một process**. Log của Rails đã cho bạn gần đủ: thời gian xử lý, thời gian view, thời gian ActiveRecord.

```text
Completed 200 OK in 142ms (Views: 12.3ms | ActiveRecord: 98.1ms | Allocations: 18234)
```

Không có 10 service để truy xem chậm ở đâu.

### 3. Mô hình multi-process làm Prometheus khó hơn

Đây là trở ngại kỹ thuật thật, không chỉ là chuyện văn hoá. Puma chạy **nhiều worker process** (fork), mỗi process có bộ nhớ riêng. Prometheus gọi `/metrics` thì request đó rơi vào **một** worker ngẫu nhiên, và nhận về số liệu của riêng worker đó.

Để gộp metric từ mọi worker, phải dùng thêm cơ chế: `prometheus_exporter` chạy một process riêng nhận metric từ các worker, hoặc `prometheus-client` ghi metric ra file dùng chung rồi đọc gộp. Làm được, nhưng phiền hơn hẳn so với Go chỉ có một process.

### 4. Rails có sẵn một hệ thống instrumentation

`ActiveSupport::Notifications` phát sự kiện cho gần như mọi thứ trong Rails: request, SQL, render view, cache, job. Đây chính là thứ các gem APM lắng nghe. Nhiều team tự viết vài dòng là có số liệu mình cần, không cần tới stack nào.

## Dự án bình thường, không phải microservice, có cần không?

Câu trả lời thẳng: **phần lớn là không cần cả stack Prometheus + Grafana + OpenTelemetry tự vận hành**. Thứ bạn cần là trả lời được bốn câu hỏi:

1. Hệ thống có đang lỗi không? (tỉ lệ lỗi)
2. Có đang chậm không? (độ trễ p95, p99)
3. Request nào, query nào chậm?
4. Khi có sự cố, tìm được log của request đó không?

Một monolith Go hoặc Rails với vài server trả lời được cả bốn câu bằng **log có cấu trúc + một APM hoặc dịch vụ giám sát có sẵn + công cụ có sẵn của ngôn ngữ**. Tự dựng và vận hành Prometheus, Grafana, Tempo, Loki là một việc tốn công: chúng cần lưu trữ, cần nâng cấp, cần cảnh báo cho chính chúng.

Nên cân nhắc stack đầy đủ khi:

- Có **từ 3–4 service trở lên** gọi qua lại, và đã từng mất nhiều giờ tìm xem request chậm ở đâu.
- **Hoá đơn APM** trở thành khoản đáng kể.
- Hạ tầng đã chạy Kubernetes, team đã vận hành Prometheus cho việc khác.
- Có **yêu cầu dữ liệu không rời khỏi hạ tầng** của công ty (tài chính, y tế, hợp đồng với khách hàng).

Và có một bước ở giữa đáng giá: **instrument bằng OpenTelemetry nhưng gửi dữ liệu tới một dịch vụ có sẵn** (Grafana Cloud, Honeycomb, chính Datadog/New Relic đều nhận OTLP). Bạn có chuẩn mở, không bị khoá vào nhà cung cấp, mà không phải tự vận hành backend.

## Công cụ có sẵn thay thế

### Go: thư viện chuẩn đã có rất nhiều

| Nhu cầu | Có sẵn trong Go | Ghi chú |
|---|---|---|
| Log có cấu trúc | `log/slog` (Go 1.21+) | JSON handler, gắn field, đủ cho hầu hết dự án |
| Profiling CPU, bộ nhớ, goroutine | `net/http/pprof` | Import là có `/debug/pprof/`, xem bằng `go tool pprof` |
| Biến số đơn giản qua HTTP | `expvar` | Import là có `/debug/vars` dạng JSON, kèm memstats |
| Metric runtime | `runtime/metrics` | GC, scheduler, bộ nhớ chi tiết |
| Trace thực thi | `runtime/trace` | Xem goroutine bị block ở đâu, bằng `go tool trace` |

Ví dụ `expvar` và `pprof`, không cần thư viện ngoài nào:

```go
import (
    "expvar"
    "log/slog"
    _ "net/http/pprof" // đăng ký /debug/pprof/
)

var ordersCreated = expvar.NewInt("orders_created") // xuất hiện ở /debug/vars

func ordersHandler(w http.ResponseWriter, r *http.Request) {
    ordersCreated.Add(1)
    slog.Info("order created", "user_id", 42)
    // ...
}
```

```text
{"time":"2026-11-25T09:23:58.42Z","level":"INFO","msg":"order created","user_id":42}
```

**Cảnh báo:** `pprof` và `expvar` lộ thông tin nội bộ (dòng lệnh, bộ nhớ, stack). Không bao giờ mở chúng ra internet. Chạy chúng trên một port riêng chỉ nghe trong mạng nội bộ.

### Rails: framework và vài gem nhỏ

| Nhu cầu | Có sẵn / gem nhẹ | Ghi chú |
|---|---|---|
| Sự kiện instrumentation | `ActiveSupport::Notifications` | Có sẵn, subscribe để lấy thời gian SQL, request, job |
| Log có cấu trúc | `lograge`, hoặc logger có sẵn với tag | Gộp log request thành một dòng JSON |
| Gắn request ID vào log | `config.log_tags = [:request_id]` | Có sẵn, nối log của cùng một request |
| Profiling khi dev | `rack-mini-profiler`, `stackprof` | Thời gian từng phần trong trang, flamegraph |
| Phát hiện N+1 | `bullet`, `prosopite` | Bắt khi dev và test |
| Trạng thái Puma | `Puma.stats`, control app | Thread bận, backlog |
| Hàng đợi Sidekiq | Web UI có sẵn của Sidekiq | Độ dài hàng đợi, job lỗi, retry |

Ví dụ ghi log mọi query chậm, chỉ bằng thứ Rails có sẵn:

```ruby
# config/initializers/slow_query_log.rb
ActiveSupport::Notifications.subscribe("sql.active_record") do |event|
  next if event.duration < 100 # ms

  Rails.logger.warn(
    "slow_query duration_ms=#{event.duration.round(1)} " \
    "name=#{event.payload[:name]} sql=#{event.payload[:sql].truncate(500)}"
  )
end
```

Với nhiều dự án, **`lograge` + `config.log_tags = [:request_id]` + một APM gói miễn phí hoặc gói nhỏ** đã đủ trả lời cả bốn câu hỏi ở trên.

### Khi muốn đi xa hơn với Rails

Nếu đã quyết định dùng stack mở:

- **Traces:** `opentelemetry-sdk` + `opentelemetry-instrumentation-all` (stable, auto-instrument Rails, ActiveRecord, Sidekiq, Net::HTTP…).
- **Metrics:** `yabeda` (có adapter cho Prometheus, Rails, Puma, Sidekiq) hoặc `prometheus_exporter`. Tránh dựa vào OTel metrics cho Ruby khi nó chưa stable.
- **Gửi đi:** qua OpenTelemetry Collector, rồi tới Tempo (trace), Prometheus (metric), Loki (log), vẽ trên Grafana.

Những metric đặc thù của Rails nên có, vì APM chung chung hay bỏ sót:

- **Request queue time**: thời gian request chờ trong hàng đợi trước khi Puma nhận. Cần proxy (Nginx, load balancer) gắn header `X-Request-Start`. Đây là tín hiệu sớm nhất cho thấy thiếu worker/thread.
- **DB connection pool**: số connection đang dùng và đang chờ (`ActiveRecord::Base.connection_pool.stat`).
- **Puma**: số thread bận so với tổng, backlog.
- **Sidekiq**: độ dài và độ trễ của từng hàng đợi.

## Kết

Go app nói nhiều về Prometheus, Grafana, OpenTelemetry vì **chúng buộc phải vậy**: không có auto-instrumentation, chạy nhiều service, và hệ sinh thái cùng nhà khiến việc lắp rất tự nhiên. Rails app ít nói vì APM đã làm hết, kiến trúc monolith ít cần trace phân tán, và mô hình multi-process khiến Prometheus kém tự nhiên hơn.

Không bên nào "đúng" hơn. Câu hỏi đáng đặt ra không phải là "nên dùng công cụ gì" mà là **"khi có sự cố lúc 2 giờ sáng, mất bao lâu để biết lỗi ở đâu?"** Nếu câu trả lời là vài phút với log và APM hiện tại, bạn chưa cần thêm gì cả.
