---
title: "Scaling Sidekiq cho ứng dụng high-volume: deploy nhiều Docker instance và đo xem nghẽn ở đâu"
description: "Thiết kế queue, concurrency, connection pool, deploy Sidekiq bằng Docker Compose/Kubernetes để scale ngang, và đo latency, throughput, saturation để biết đang nghẽn ở Redis, DB hay CPU."
pubDate: 2026-05-23
tags: [ruby, backend, devops, database]
---

Sidekiq chạy ngon với vài nghìn job một ngày. Khi lên vài triệu job một ngày, các câu hỏi đổi khác: tăng `concurrency` hay thêm container? Vì sao thêm container mà queue vẫn dồn? Job email chạy chậm có phải do Sidekiq không, hay do DB?

Bài này đi theo thứ tự:

1. Sidekiq chạy thế nào, giới hạn nằm ở đâu.
2. Thiết kế queue và concurrency trước khi scale.
3. Deploy nhiều Docker instance: Compose và Kubernetes, kèm autoscale.
4. Đo performance khi có nhiều instance: chỉ số nào, lấy ở đâu, đọc thế nào để biết đang nghẽn ở đâu.

Ví dụ xuyên suốt: một app e-commerce với khoảng **5 triệu job/ngày**, đỉnh **300 job/giây** vào giờ flash sale: gửi email, đồng bộ tồn kho, webhook đối tác, xuất báo cáo.

## 1. Sidekiq chạy thế nào

```
Rails app ──LPUSH──▶ Redis (queue:critical, queue:default, ...) ◀──BRPOP── Sidekiq process
                                                                           ├─ thread 1 ─▶ DB / API
                                                                           ├─ thread 2
                                                                           └─ thread N  (concurrency)
```

- Một **process** Sidekiq = một container (trong bài này). Mỗi process chạy N **thread** (`concurrency`).
- Thread lấy job từ Redis bằng `BRPOP`, chạy code Ruby, xong thì lấy job tiếp.
- Ruby (MRI) có **GVL**: tại một thời điểm, một process chỉ chạy Ruby trên **một core**. Thread chỉ thật sự song song khi đang chờ I/O (DB, HTTP, Redis).

Hệ quả quan trọng nhất của cả bài:

| Loại job | Bản chất | Scale bằng |
|---|---|---|
| I/O-bound (gọi API, query DB, gửi email) | Phần lớn thời gian ngồi chờ | Tăng `concurrency` (10–25), thêm container |
| CPU-bound (render PDF, resize ảnh, parse CSV lớn) | Tốn CPU Ruby | **Thêm process/container**, mỗi cái `concurrency` thấp (2–5), mỗi container ~1 CPU |

Tăng `concurrency` lên 50 cho job CPU-bound không làm nhanh hơn, chỉ làm latency từng job tệ hơn vì thread tranh nhau GVL.

**Throughput tối đa lý thuyết** của một hệ thống:

```
throughput ≈ (số container × concurrency) / thời gian trung bình mỗi job
```

300 job/giây, mỗi job trung bình 200 ms → cần ít nhất `300 × 0,2 = 60` thread bận liên tục. Để chừa 30–50% headroom, cần khoảng 90 thread, ví dụ **9 container × 10 thread**. Đây là con số khởi đầu, sau đó dùng số đo ở phần 4 để chỉnh.

## 2. Chuẩn bị trước khi scale

Thêm container vào một thiết kế tồi chỉ làm nó tồi nhanh hơn. Ba việc cần làm trước.

### 2.1 Tách queue theo độ ưu tiên và theo loại tài nguyên

Sai lầm phổ biến: mọi thứ vào `default`. Một lô 200.000 job xuất báo cáo được enqueue sẽ chặn email reset password ở phía sau.

```ruby
class PasswordResetJob
  include Sidekiq::Job
  sidekiq_options queue: :critical, retry: 5
end

class SyncInventoryJob
  include Sidekiq::Job
  sidekiq_options queue: :default
end

class PartnerWebhookJob
  include Sidekiq::Job
  sidekiq_options queue: :webhooks, retry: 10   # phụ thuộc bên ngoài, hay chậm
end

class ExportReportJob
  include Sidekiq::Job
  sidekiq_options queue: :bulk, retry: 3        # CPU-bound, nặng
end
```

Quy tắc: **mỗi queue có một SLO về latency** (thời gian từ lúc enqueue đến lúc bắt đầu chạy):

| Queue | Ví dụ | Latency chấp nhận |
|---|---|---|
| `critical` | Reset password, OTP, thanh toán | < 5 giây |
| `default` | Đồng bộ kho, email đơn hàng | < 1 phút |
| `webhooks` | Gọi đối tác | < 5 phút |
| `bulk` | Báo cáo, import | < 1 giờ |

Con số này là thứ bạn sẽ đo và alert ở phần 4.

### 2.2 Tách nhóm worker theo queue (không để một process nghe tất cả)

Sidekiq có hai cách đọc nhiều queue:

```bash
sidekiq -q critical -q default -q bulk           # strict: luôn ưu tiên critical trước
sidekiq -q critical,6 -q default,3 -q bulk,1     # weighted: theo tỉ trọng ngẫu nhiên
```

Nhưng với high-volume, cách bền vững hơn là **mỗi nhóm queue một deployment riêng**, scale độc lập:

| Deployment | Queue | concurrency | CPU / RAM mỗi container |
|---|---|---|---|
| `sidekiq-critical` | `critical` | 10 | 1 CPU / 1 GB |
| `sidekiq-default` | `default`, `webhooks` | 20 | 1 CPU / 1,5 GB |
| `sidekiq-bulk` | `bulk` | 3 | 1 CPU / 2 GB |

Lợi ích: webhook đối tác treo không ăn hết thread của `critical`; job bulk tốn RAM không làm OOM container `critical`; và mỗi nhóm có autoscale riêng.

### 2.3 Connection pool phải đủ cho concurrency

Mỗi thread Sidekiq có thể cần một connection DB. Thiếu connection thì thread ngồi chờ `ActiveRecord::ConnectionTimeoutError`.

```yaml
# config/database.yml
production:
  pool: <%= ENV.fetch("DB_POOL") { ENV.fetch("SIDEKIQ_CONCURRENCY", 5).to_i + 2 } %>
```

Và đây là chỗ hay chết khi scale ngang:

```
Tổng connection DB = số container × pool
                   = (4 critical × 12) + (8 default × 22) + (4 bulk × 5) + (web: 6 pod × 5 puma thread)
                   = 48 + 176 + 20 + 30 = 274
```

Postgres mặc định `max_connections = 100`. Thêm container là DB từ chối kết nối. Giải pháp: PgBouncer (transaction mode) đứng trước Postgres, hoặc tính lại pool. **Trước khi tăng replica, luôn tính lại tổng connection.**

Redis cũng vậy: mỗi process Sidekiq giữ `concurrency + 5` connection Redis. Redis chịu được hàng chục nghìn connection, nhưng các dịch vụ managed (ElastiCache, Redis Cloud) có giới hạn theo gói.

### 2.4 Job phải idempotent và nhỏ

- Sidekiq đảm bảo **at-least-once**: job có thể chạy hai lần (retry, container bị kill khi deploy). Ví dụ: kiểm tra `order.email_sent_at` trước khi gửi.
- Đừng truyền object, truyền ID: `SyncInventoryJob.perform_async(product.id)`.
- Tách job lớn thành nhiều job nhỏ: một job "gửi email cho 100.000 người" nên thành 100.000 job, hoặc 1.000 job mỗi job 100 người, enqueue bằng `perform_bulk`:

```ruby
user_ids.each_slice(1_000) do |ids|
  NewsletterJob.perform_bulk(ids.map { |id| [id] })
end
```

Job ngắn thì deploy dừng nhanh, retry ít tốn, và tải chia đều cho các container.

## 3. Deploy nhiều Docker instance

### 3.1 Dockerfile dùng chung cho web và worker

Một image, hai lệnh chạy khác nhau. Không build image riêng cho Sidekiq.

```dockerfile
FROM ruby:3.3-slim AS base
WORKDIR /app
ENV RAILS_ENV=production BUNDLE_WITHOUT="development:test" \
    MALLOC_ARENA_MAX=2

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      build-essential libpq-dev libjemalloc2 && rm -rf /var/lib/apt/lists/*
ENV LD_PRELOAD=libjemalloc.so.2

COPY Gemfile Gemfile.lock ./
RUN bundle install --jobs 4
COPY . .
RUN bundle exec bootsnap precompile --gemfile app/ lib/

# tini làm PID 1 để chuyển tín hiệu SIGTERM đúng cho Sidekiq
RUN apt-get update -qq && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]
```

Hai dòng hay bị bỏ qua nhưng rất quan trọng cho worker:

- **jemalloc + `MALLOC_ARENA_MAX=2`**: Ruby đa thread với glibc malloc hay bị phân mảnh, RSS phình dần đến vài GB. jemalloc thường giảm 30–50% RAM.
- **tini**: đảm bảo `SIGTERM` tới đúng process Sidekiq để nó dừng nhận job mới và chờ job đang chạy kết thúc.

### 3.2 Cấu hình Sidekiq đọc từ biến môi trường

```yaml
# config/sidekiq.yml
:concurrency: <%= ENV.fetch("SIDEKIQ_CONCURRENCY", 10) %>
:timeout: 25          # chờ job đang chạy tối đa 25s khi nhận SIGTERM
:queues:
<% ENV.fetch("SIDEKIQ_QUEUES", "critical,default").split(",").each do |q| %>
  - <%= q %>
<% end %>
```

```ruby
# config/initializers/sidekiq.rb
Sidekiq.configure_server do |config|
  config.redis = { url: ENV.fetch("REDIS_URL"), network_timeout: 3, pool_timeout: 3 }
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL"), network_timeout: 3, pool_timeout: 3, size: 5 }
end
```

Cùng một image, đổi `SIDEKIQ_QUEUES` và `SIDEKIQ_CONCURRENCY` là thành nhóm worker khác.

**Redis cho Sidekiq** nên là instance riêng (không dùng chung với cache), và cấu hình `maxmemory-policy noeviction`. Nếu Redis đầy mà đang `allkeys-lru`, nó sẽ **âm thầm xoá job**.

### 3.3 Docker Compose (một hoặc vài máy)

```yaml
# docker-compose.production.yml
x-app: &app
  image: registry.example.com/shop:${APP_VERSION}
  env_file: .env.production
  depends_on: [redis]
  restart: unless-stopped
  stop_grace_period: 30s        # > :timeout của Sidekiq (25s)

services:
  web:
    <<: *app
    command: bundle exec puma -C config/puma.rb
    deploy: { replicas: 3 }

  sidekiq-critical:
    <<: *app
    command: bundle exec sidekiq -C config/sidekiq.yml
    environment:
      SIDEKIQ_QUEUES: critical
      SIDEKIQ_CONCURRENCY: 10
    deploy:
      replicas: 2
      resources: { limits: { cpus: "1", memory: 1G } }

  sidekiq-default:
    <<: *app
    command: bundle exec sidekiq -C config/sidekiq.yml
    environment:
      SIDEKIQ_QUEUES: default,webhooks
      SIDEKIQ_CONCURRENCY: 20
    deploy:
      replicas: 4
      resources: { limits: { cpus: "1", memory: 1536M } }

  sidekiq-bulk:
    <<: *app
    command: bundle exec sidekiq -C config/sidekiq.yml
    environment:
      SIDEKIQ_QUEUES: bulk
      SIDEKIQ_CONCURRENCY: 3
    deploy:
      replicas: 2
      resources: { limits: { cpus: "1", memory: 2G } }

  redis:
    image: redis:7
    command: redis-server --appendonly yes --maxmemory-policy noeviction
    volumes: [redis-data:/data]

volumes:
  redis-data:
```

Scale thủ công một nhóm:

```bash
docker compose -f docker-compose.production.yml up -d --scale sidekiq-default=8
```

Compose đủ cho một hai máy. Khi cần nhiều node và autoscale, chuyển sang Kubernetes.

### 3.4 Kubernetes: Deployment cho từng nhóm worker

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sidekiq-default
spec:
  replicas: 4
  selector: { matchLabels: { app: sidekiq, pool: default } }
  template:
    metadata:
      labels: { app: sidekiq, pool: default }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9394"
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: sidekiq
          image: registry.example.com/shop:1.42.0
          command: ["bundle", "exec", "sidekiq", "-C", "config/sidekiq.yml"]
          env:
            - { name: SIDEKIQ_QUEUES, value: "default,webhooks" }
            - { name: SIDEKIQ_CONCURRENCY, value: "20" }
            - { name: DB_POOL, value: "22" }
          envFrom: [{ secretRef: { name: shop-env } }]
          resources:
            requests: { cpu: "500m", memory: "1Gi" }
            limits:   { cpu: "1",    memory: "1536Mi" }
          ports: [{ name: metrics, containerPort: 9394 }]
          lifecycle:
            preStop:
              # TSTP = "quiet": ngừng lấy job mới, làm nốt job đang chạy
              exec: { command: ["sh", "-c", "kill -TSTP 1 && sleep 30"] }
          livenessProbe:
            exec: { command: ["sh", "-c", "test $(( $(date +%s) - $(stat -c %Y /tmp/sidekiq_alive) )) -lt 60"] }
            periodSeconds: 30
```

Vài điểm:

- **Graceful shutdown**: khi rolling deploy, pod nhận `preStop` → gửi `TSTP` (quiet) → sau đó `SIGTERM` → Sidekiq chờ tối đa `:timeout` rồi đẩy job chưa xong trở lại Redis. `terminationGracePeriodSeconds` phải lớn hơn tổng thời gian này, nếu không Kubernetes sẽ `SIGKILL` và job phải chờ cơ chế khôi phục (Sidekiq Pro `super_fetch`) hoặc mất.
- **Liveness probe**: Sidekiq không có HTTP endpoint mặc định. Cách đơn giản: một heartbeat ghi file định kỳ (hoặc dùng gem `sidekiq_alive`). Probe không được phụ thuộc vào Redis, nếu không Redis chậm một chút là toàn bộ worker bị restart dây chuyền.
- **Không dùng `limits.cpu` thấp hơn 1** cho worker có `concurrency` cao: throttling CPU làm job chậm một cách rất khó chẩn đoán.

### 3.5 Autoscale theo queue latency, không theo CPU

Autoscale theo CPU sai với Sidekiq: worker I/O-bound có thể chỉ dùng 20% CPU trong khi queue đã dồn 50.000 job. Chỉ số đúng để scale là **queue latency** (job cũ nhất trong queue đã chờ bao lâu).

Dùng **KEDA** để scale theo metric Prometheus:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: sidekiq-default
spec:
  scaleTargetRef: { name: sidekiq-default }
  minReplicaCount: 4
  maxReplicaCount: 30
  cooldownPeriod: 300
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        query: max(sidekiq_queue_latency_seconds{queue=~"default|webhooks"})
        threshold: "30"     # muốn latency ~30s, vượt thì thêm pod
```

Hai giới hạn của autoscale cần đặt ra từ đầu:

- `maxReplicaCount` phải tính từ **tổng connection DB** ở mục 2.3. Autoscale lên 100 pod mà DB chỉ chịu 300 connection thì autoscaler sẽ tự gây sự cố.
- Nếu nút thắt là DB hoặc API đối tác, thêm worker chỉ làm tệ hơn. Phần 4 giúp phân biệt hai trường hợp này.

## 4. Đo performance khi có nhiều instance

Khi chạy 1 container, mở Sidekiq Web UI là đủ. Khi chạy 30 container ở 3 nhóm, cần trả lời được ba câu:

1. **Có đang đáp ứng không?** Job có bắt đầu chạy đủ nhanh theo SLO từng queue không?
2. **Nếu không, nghẽn ở đâu?** Thiếu worker, Redis, DB, API ngoài, hay CPU/RAM của container?
3. **Thêm container có giúp không?**

### 4.1 Bốn nhóm chỉ số

| Nhóm | Chỉ số | Ý nghĩa |
|---|---|---|
| **Latency hàng đợi** | `queue_latency` theo queue | Job cũ nhất đã chờ bao lâu. **Chỉ số số một**, là thứ người dùng cảm nhận |
| **Lưu lượng** | job enqueued/s, processed/s, failed/s | Vào có lớn hơn ra không |
| **Mức sử dụng** | busy threads / tổng threads theo nhóm | Worker có đang bận hết không |
| **Thời gian chạy job** | p50/p95/p99 duration theo class | Job có đang chậm đi không, chậm vì đâu |

Thêm các chỉ số tài nguyên: CPU, RSS mỗi container, CPU throttling, Redis (latency, memory, ops/s), DB (connection, query time), thời gian gọi API ngoài.

### 4.2 Lấy số liệu: API có sẵn của Sidekiq

Sidekiq lưu sẵn trạng thái **toàn cụm** trong Redis, nên dù có bao nhiêu container, đọc từ một chỗ là đủ:

```ruby
require "sidekiq/api"

Sidekiq::Queue.all.each do |q|
  puts "#{q.name}: size=#{q.size} latency=#{q.latency.round(1)}s"
end

stats = Sidekiq::Stats.new
puts "processed=#{stats.processed} failed=#{stats.failed} retry=#{stats.retry_size} dead=#{stats.dead_size}"

# Từng process (mỗi container một dòng)
Sidekiq::ProcessSet.new.each do |p|
  puts "#{p['hostname']} queues=#{p['queues'].join(',')} busy=#{p['busy']}/#{p['concurrency']} rss=#{p['rss'].to_i / 1024}MB"
end
```

`ProcessSet` là công cụ nhanh nhất để thấy toàn cảnh nhiều instance: container nào bận, container nào rảnh, container nào RSS phình bất thường.

### 4.3 Export ra Prometheus

Có hai loại metric, cần lấy ở hai chỗ khác nhau:

**(a) Metric toàn cụm** (queue size, latency, retry, dead): chỉ cần **một** exporter đọc từ Redis. Nếu mọi container cùng export, Prometheus sẽ có 30 bản sao giống nhau. Dùng gem `sidekiq-prometheus-exporter` hoặc tự viết một deployment nhỏ:

```ruby
# exporter.rb — chạy 1 replica duy nhất
require "sidekiq/api"
require "prometheus/client"
require "prometheus/client/formats/text"
require "webrick"

registry = Prometheus::Client.registry
latency  = registry.gauge(:sidekiq_queue_latency_seconds, docstring: "Oldest job age", labels: [:queue])
size     = registry.gauge(:sidekiq_queue_size, docstring: "Jobs waiting", labels: [:queue])
busy     = registry.gauge(:sidekiq_busy_threads, docstring: "Busy threads", labels: [:pool])
capacity = registry.gauge(:sidekiq_threads_total, docstring: "Total threads", labels: [:pool])
retries  = registry.gauge(:sidekiq_retry_size, docstring: "Retry set size")
dead     = registry.gauge(:sidekiq_dead_size, docstring: "Dead set size")

Thread.new do
  loop do
    Sidekiq::Queue.all.each do |q|
      latency.set(q.latency, labels: { queue: q.name })
      size.set(q.size, labels: { queue: q.name })
    end

    by_pool = Hash.new { |h, k| h[k] = [0, 0] }
    Sidekiq::ProcessSet.new.each do |p|
      pool = p["queues"].sort.join(",")
      by_pool[pool][0] += p["busy"]
      by_pool[pool][1] += p["concurrency"]
    end
    by_pool.each do |pool, (b, c)|
      busy.set(b, labels: { pool: pool })
      capacity.set(c, labels: { pool: pool })
    end

    stats = Sidekiq::Stats.new
    retries.set(stats.retry_size)
    dead.set(stats.dead_size)
    sleep 10
  end
end

server = WEBrick::HTTPServer.new(Port: 9394)
server.mount_proc("/metrics") { |_, res| res.body = Prometheus::Client::Formats::Text.marshal(registry) }
server.start
```

**(b) Metric từng job** (duration, success/fail theo class): phải đo **trong mỗi container**, bằng server middleware:

```ruby
# config/initializers/sidekiq_metrics.rb
require "prometheus_exporter/client"

class JobMetricsMiddleware
  def call(_worker, job, queue)
    start  = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    waited = Time.now.to_f - job["enqueued_at"].to_f   # thời gian chờ thật của job này
    status = "success"
    yield
  rescue Exception
    status = "failed"
    raise
  ensure
    duration = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start
    PrometheusExporter::Client.default.send_json(
      type: "sidekiq_job",
      job_class: job["wrapped"] || job["class"],
      queue: queue,
      status: status,
      duration: duration,
      wait: waited
    )
  end
end

Sidekiq.configure_server do |config|
  config.server_middleware { |chain| chain.add JobMetricsMiddleware }
end
```

Gem `prometheus_exporter` (của Discourse) có sẵn `PrometheusExporter::Instrumentation::Sidekiq` làm đúng việc này, kèm metric process (RSS, GC, số thread). Mỗi pod có label `pod`, `pool` để lọc theo nhóm và theo instance.

**Bonus:** Sidekiq 7+ có trang **Metrics** trong Web UI, hiển thị thời gian chạy và số job theo class trong vài giờ gần nhất, không cần cài thêm gì. Dùng để xem nhanh; dùng Prometheus để alert và xem lịch sử.

### 4.4 Các câu PromQL quan trọng

```promql
# 1. Latency từng queue (so với SLO)
max by (queue) (sidekiq_queue_latency_seconds)

# 2. Vào vs ra: nếu enqueue > processed lâu dài thì queue sẽ dồn mãi
sum by (queue) (rate(sidekiq_jobs_enqueued_total[5m]))
sum by (queue) (rate(sidekiq_job_duration_seconds_count[5m]))

# 3. Mức bận của từng nhóm worker (saturation)
sum by (pool) (sidekiq_busy_threads) / sum by (pool) (sidekiq_threads_total)

# 4. p95 thời gian chạy theo job class
histogram_quantile(0.95,
  sum by (le, job_class) (rate(sidekiq_job_duration_seconds_bucket[5m])))

# 5. Tỉ lệ lỗi theo job class
sum by (job_class) (rate(sidekiq_job_duration_seconds_count{status="failed"}[5m]))
  / sum by (job_class) (rate(sidekiq_job_duration_seconds_count[5m]))

# 6. CPU throttling của container worker
sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{pod=~"sidekiq-.*"}[5m]))
  / sum by (pod) (rate(container_cpu_cfs_periods_total{pod=~"sidekiq-.*"}[5m]))
```

(Tên metric tuỳ exporter bạn dùng; ý nghĩa thì giống nhau.)

### 4.5 Đọc số: đang nghẽn ở đâu?

Đây là phần quan trọng nhất. Khi queue latency vượt SLO, nhìn các chỉ số khác theo thứ tự sau:

| Latency queue | Busy / tổng thread | Job duration | Chỉ số khác | Chẩn đoán | Làm gì |
|---|---|---|---|---|---|
| Tăng | **~100%** | Ổn định | CPU, DB bình thường | **Thiếu worker** | Thêm container (scale ngang). Đây là trường hợp duy nhất thêm container chắc chắn giúp |
| Tăng | ~100% | **Tăng** | DB: connection/query time tăng | **Nghẽn DB** | **Không** thêm worker. Tối ưu query, thêm index, PgBouncer, giảm concurrency nhóm nặng |
| Tăng | ~100% | Tăng, chỉ ở vài class | Thời gian gọi HTTP ngoài tăng | **API đối tác chậm** | Timeout ngắn, circuit breaker, đưa sang queue riêng, giới hạn tốc độ |
| Tăng | ~100% | Tăng | CPU container ~100%, throttling cao | **Thiếu CPU / GVL** | Giảm concurrency mỗi process, thêm process; tăng CPU limit |
| Tăng | **Thấp** | — | — | **Worker không nghe queue đó**, hoặc bị chặn | Kiểm tra `SIDEKIQ_QUEUES`, strict ordering, Redis kết nối được không |
| Tăng | Thấp/dao động | — | Redis latency cao, CPU Redis ~100% | **Nghẽn Redis** | Xem mục 4.6 |
| Bình thường | ~100% liên tục | — | — | Sắp quá tải | Thêm headroom trước khi có sự cố |
| Bình thường | Thấp | — | — | Thừa worker | Giảm replica, tiết kiệm tiền |

Vài dấu hiệu đặc trưng khác:

- **RSS tăng dần theo thời gian rồi pod OOMKilled**: memory bloat hoặc leak. Kiểm tra jemalloc, các job load quá nhiều record (`.all.each` thay vì `find_each`).
- **Retry set tăng nhanh**: job lỗi hàng loạt và sẽ quay lại làm queue dồn thêm. Nhìn tỉ lệ lỗi theo class để tìm thủ phạm.
- **Một container bận 100%, các container khác rảnh** (thấy trong `ProcessSet`): container đó nghe một queue mà các container khác không nghe. Đây là lý do nên tách deployment theo nhóm queue và đo `busy` theo `pool`.
- **Job wait time (đo trong middleware) cao nhưng queue latency thấp**: job đang nằm ở **scheduled** hoặc **retry** set lâu, không phải ở queue chính.

### 4.6 Khi Redis là nút thắt

Redis chạy một thread. Một instance thường chịu được 50.000–100.000 thao tác/giây, đủ cho phần lớn ứng dụng, nhưng có vài thứ làm Redis chậm sớm:

```bash
redis-cli --latency            # latency thực tế từ client
redis-cli info stats | grep instantaneous_ops_per_sec
redis-cli info memory | grep used_memory_human
redis-cli slowlog get 10       # lệnh chậm
```

Thủ phạm thường gặp:

- **Payload job lớn**: truyền cả JSON sản phẩm vào argument. Chỉ truyền ID.
- **Retry/dead set quá lớn**: hàng triệu job chết lâu năm. Dọn định kỳ, đặt `dead_max_jobs`.
- **Enqueue từng job trong vòng lặp lớn**: mỗi lần một round-trip. Dùng `perform_bulk`.
- **Redis dùng chung với cache**: cache eviction và lệnh `KEYS` của ai đó làm block cả queue. Tách instance.

Nếu đã tối ưu hết mà một Redis vẫn không đủ, có thể **shard** theo nhóm job: Sidekiq hỗ trợ nhiều Redis pool qua `Sidekiq::Client.via(pool)`, ví dụ để `bulk` sang một Redis riêng. Hiếm app cần đến bước này.

### 4.7 Dashboard và alert

Một dashboard Grafana cho Sidekiq nên có, từ trên xuống:

1. **Queue latency theo queue**, kèm đường SLO.
2. **Enqueued/s vs Processed/s** theo queue.
3. **Busy / tổng thread** theo pool, và số replica của từng pool.
4. **p95 duration theo job class** (top 10).
5. **Tỉ lệ lỗi theo class**, kích thước retry/dead set.
6. **Tài nguyên**: CPU, throttling, RSS theo pod; Redis latency/memory; DB connection.

Alert dựa trên SLO, không dựa trên CPU:

```yaml
groups:
  - name: sidekiq
    rules:
      - alert: SidekiqCriticalQueueSlow
        expr: max(sidekiq_queue_latency_seconds{queue="critical"}) > 5
        for: 2m
        labels: { severity: page }
        annotations:
          summary: "Queue critical chờ > 5s (SLO)"

      - alert: SidekiqDefaultQueueSlow
        expr: max(sidekiq_queue_latency_seconds{queue="default"}) > 60
        for: 10m
        labels: { severity: ticket }

      - alert: SidekiqPoolSaturated
        expr: sum by (pool) (sidekiq_busy_threads) / sum by (pool) (sidekiq_threads_total) > 0.9
        for: 15m
        labels: { severity: ticket }
        annotations:
          summary: "Pool {{ $labels.pool }} bận > 90% trong 15 phút"

      - alert: SidekiqDeadJobsGrowing
        expr: increase(sidekiq_dead_size[1h]) > 100
        labels: { severity: ticket }

      - alert: SidekiqNoProcesses
        expr: sum(sidekiq_threads_total) == 0
        for: 2m
        labels: { severity: page }
```

### 4.8 Load test trước giờ cao điểm

Đừng chờ flash sale mới biết hệ thống chịu được bao nhiêu. Trên staging (cùng cấu hình DB và Redis):

```ruby
# Bơm 100.000 job giả lập
100.times do
  SyncInventoryJob.perform_bulk(Array.new(1_000) { [rand(1..50_000)] })
end
```

Rồi quan sát: processed/s ổn định ở mức nào, khi nào latency bắt đầu tăng, khi đó chỉ số nào chạm trần trước (thread, DB, CPU, Redis). Tăng replica, lặp lại. Điểm mà **thêm replica không còn tăng processed/s** chính là nút thắt thật của hệ thống, và cũng là giá trị hợp lý cho `maxReplicaCount`.

## 5. Checklist

**Thiết kế**
- Tách queue theo độ ưu tiên, mỗi queue có SLO latency.
- Job idempotent, nhỏ, chỉ truyền ID; enqueue hàng loạt bằng `perform_bulk`.
- Job I/O-bound: concurrency 10–25. Job CPU-bound: concurrency 2–5, thêm process.

**Deploy**
- Một image cho web và worker; nhóm worker cấu hình bằng `SIDEKIQ_QUEUES`, `SIDEKIQ_CONCURRENCY`.
- jemalloc, `MALLOC_ARENA_MAX=2`, tini.
- Mỗi nhóm queue một deployment, scale độc lập.
- Graceful shutdown: `TSTP` khi `preStop`, grace period > Sidekiq `:timeout`.
- Redis riêng cho Sidekiq, `noeviction`, có persistence.
- Tính tổng connection DB trước khi tăng replica; dùng PgBouncer khi cần.
- Autoscale theo **queue latency** (KEDA), không theo CPU; `maxReplicaCount` theo giới hạn DB.

**Đo**
- Một exporter toàn cụm cho queue latency, size, busy threads theo pool.
- Middleware trong từng container cho duration và lỗi theo job class.
- Dashboard: latency → in/out → saturation → duration → lỗi → tài nguyên.
- Alert theo SLO latency từng queue.
- Load test để tìm nút thắt thật trước giờ cao điểm.

Scale Sidekiq không phải là "thêm container cho đến khi hết dồn". Câu hỏi đúng là **"thứ gì đang hết trước?"**: thread, CPU, DB hay Redis. Queue latency cho bạn biết có vấn đề, busy threads và job duration cho bạn biết vấn đề ở đâu, và chỉ khi worker là thứ hết trước thì thêm container mới là câu trả lời.
