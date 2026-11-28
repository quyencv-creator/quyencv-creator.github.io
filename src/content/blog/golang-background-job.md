---
title: "Background job trong Go: goroutine, worker pool, Asynq và job chạy hàng giờ"
description: Các cách chạy background job trong Go, khi nào dùng goroutine, khi nào cần queue như Asynq, cách theo dõi trạng thái, retry, dead queue và xử lý job export kéo dài cả tiếng.
pubDate: 2026-01-27
tags: [golang, backend]
---

Gửi email sau khi đăng ký, resize ảnh, đồng bộ dữ liệu, export báo cáo hàng triệu dòng… là những việc **không nên bắt người dùng chờ** trong một HTTP request. Bài này trả lời 5 câu hỏi:

1. Go xử lý background job bằng cách nào?
2. Dùng goroutine, Asynq hay cách khác?
3. Làm sao biết job đã chạy chưa, lỗi gì, có vào dead queue không?
4. Setup background job trong project Go ra sao?
5. Job chạy cả tiếng (export, batch) xử lý thế nào để không treo hệ thống?

## 1. Ba cấp độ xử lý background job

| Cấp độ | Cách làm | Mất job khi restart? | Retry | Theo dõi trạng thái | Dùng khi |
|---|---|---|---|---|---|
| 1 | `go func()` | **Mất** | Tự viết | Không | Việc nhỏ, mất cũng không sao |
| 2 | Worker pool (channel + goroutine) | **Mất** | Tự viết | Tự viết | Giới hạn song song trong một process |
| 3 | Job queue (Asynq, River, Temporal…) | **Không** | Có sẵn | Có sẵn + UI | Mọi job quan trọng trong production |

Quy tắc ngắn gọn: **nếu mất job là có vấn đề (người dùng không nhận email, đơn không được xử lý), hãy dùng queue lưu bền vững.**

## 2. Cấp 1: goroutine

```go
func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	user, err := h.svc.Register(r.Context(), req)
	// ...
	go h.mailer.SendWelcome(context.Background(), user.Email) // fire-and-forget
	writeJSON(w, http.StatusCreated, user)
}
```

Đơn giản nhưng có nhiều cái bẫy:

- **Không dùng `r.Context()`** trong goroutine: context bị huỷ ngay khi response trả về, email sẽ bị huỷ giữa chừng. Dùng `context.Background()` hoặc `context.WithoutCancel(r.Context())` (Go 1.21+, giữ lại value như request ID).
- **Panic trong goroutine làm sập cả server.** Middleware Recover không bắt được panic ở goroutine khác, nên phải tự `recover`.
- **Restart, deploy là mất job** đang chạy và chưa chạy.
- **Không giới hạn:** 10.000 request cùng lúc sinh ra 10.000 goroutine cùng gọi SMTP.

Nếu vẫn dùng goroutine, ít nhất hãy bọc lại:

```go
func Go(logger *slog.Logger, fn func()) {
	go func() {
		defer func() {
			if err := recover(); err != nil {
				logger.Error("background panic", "error", err, "stack", string(debug.Stack()))
			}
		}()
		fn()
	}()
}
```

## 3. Cấp 2: worker pool trong process

Giới hạn số job chạy song song bằng một channel có buffer và N worker:

```go
// internal/worker/pool.go
package worker

type Job func(ctx context.Context) error

type Pool struct {
	jobs   chan Job
	wg     sync.WaitGroup
	logger *slog.Logger
}

func NewPool(queueSize int, logger *slog.Logger) *Pool {
	return &Pool{jobs: make(chan Job, queueSize), logger: logger}
}

func (p *Pool) Start(ctx context.Context, workers int) {
	for i := 0; i < workers; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for job := range p.jobs {
				p.run(ctx, job)
			}
		}()
	}
}

func (p *Pool) run(ctx context.Context, job Job) {
	defer func() {
		if err := recover(); err != nil {
			p.logger.Error("job panic", "error", err)
		}
	}()
	if err := job(ctx); err != nil {
		p.logger.Error("job failed", "error", err)
	}
}

// Submit trả lỗi khi hàng đợi đầy thay vì block request.
func (p *Pool) Submit(job Job) error {
	select {
	case p.jobs <- job:
		return nil
	default:
		return errors.New("job queue full")
	}
}

// Stop: không nhận job mới, chờ job đang chạy xong.
func (p *Pool) Stop() {
	close(p.jobs)
	p.wg.Wait()
}
```

Tốt hơn goroutine trần (có giới hạn, có graceful shutdown), nhưng job vẫn **nằm trong RAM**: deploy hoặc crash là mất. Phù hợp cho việc phụ như ghi analytics, warm cache.

## 4. Cấp 3: job queue lưu bền vững

Ý tưởng: API **ghi job vào nơi lưu trữ** (Redis hoặc Postgres), một process **worker** riêng lấy job ra chạy. Job sống sót qua restart, có retry, có trạng thái.

```
┌─────────┐  Enqueue   ┌──────────────┐  Dequeue  ┌──────────┐
│ API     │ ─────────► │ Redis / PG   │ ────────► │ Worker   │
│ server  │            │ (queue)      │ ◄──────── │ process  │
└─────────┘            └──────────────┘  ack/fail └──────────┘
```

Các lựa chọn phổ biến trong Go:

| Thư viện | Lưu trữ | Điểm mạnh |
|---|---|---|
| [**Asynq**](https://github.com/hibiken/asynq) | Redis | Phổ biến nhất, API giống `net/http`, có retry, lịch chạy, dead queue, UI `asynqmon` |
| [**River**](https://riverqueue.com) | PostgreSQL | Enqueue **trong cùng transaction** với dữ liệu, không cần Redis |
| [**Temporal**](https://temporal.io) | Temporal server | Workflow nhiều bước, chạy hàng giờ đến hàng ngày, tự resume sau crash |
| Kafka / RabbitMQ / SQS | Broker | Hệ thống lớn, nhiều service cùng tiêu thụ event |

> Thư viện hay bị gọi nhầm là "asyncq": tên đúng là **Asynq** (`github.com/hibiken/asynq`).

Gợi ý chọn:

- Đã có Redis, cần đơn giản → **Asynq**.
- Chỉ có Postgres, cần job nhất quán với dữ liệu (giống [outbox pattern](/blog/outbox-pattern-golang/)) → **River**.
- Quy trình nhiều bước, dài, cần đảm bảo chạy hết (thanh toán, onboarding, pipeline dữ liệu) → **Temporal**.

Phần còn lại của bài dùng **Asynq** làm ví dụ.

## 5. Setup background job với Asynq

### Cấu trúc thư mục

```
shop/
├── cmd/
│   ├── api/main.go           # HTTP server: chỉ ENQUEUE job
│   └── worker/main.go        # Worker: chỉ CHẠY job
├── internal/
│   ├── jobs/
│   │   ├── tasks.go          # tên task, payload, hàm tạo task
│   │   ├── email.go          # handler: gửi email
│   │   └── export.go         # handler: export báo cáo
│   └── ...
```

API và worker là **hai binary riêng** từ cùng một codebase, dùng chung `internal/`. Tách ra để:

- Scale độc lập: 2 pod API, 10 pod worker.
- Job nặng không ăn CPU, RAM của API.
- Deploy worker không làm gián đoạn API.

### Định nghĩa task

```go
// internal/jobs/tasks.go
package jobs

const (
	TypeWelcomeEmail = "email:welcome"
	TypeExportOrders = "export:orders"
)

type WelcomeEmailPayload struct {
	UserID int64  `json:"user_id"`
	Email  string `json:"email"`
}

func NewWelcomeEmailTask(userID int64, email string) (*asynq.Task, error) {
	b, err := json.Marshal(WelcomeEmailPayload{UserID: userID, Email: email})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TypeWelcomeEmail, b,
		asynq.Queue("default"),
		asynq.MaxRetry(5),
		asynq.Timeout(30*time.Second),
		asynq.TaskID(fmt.Sprintf("welcome:%d", userID)), // chống enqueue trùng
		asynq.Retention(24*time.Hour),                   // giữ job đã xong 24h để tra cứu
	), nil
}
```

Payload chỉ chứa **ID và dữ liệu nhỏ**, không nhét cả object lớn. Worker tự load từ DB khi chạy.

### Enqueue từ API

```go
// cmd/api/main.go
queue := asynq.NewClient(asynq.RedisClientOpt{Addr: cfg.RedisAddr})
defer queue.Close()

userSvc := user.NewService(userRepo, queue)
```

```go
// internal/user/service.go
type enqueuer interface {
	EnqueueContext(ctx context.Context, t *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

func (s *Service) Register(ctx context.Context, in RegisterInput) (*User, error) {
	u, err := s.repo.Create(ctx, in)
	if err != nil {
		return nil, err
	}
	task, err := jobs.NewWelcomeEmailTask(u.ID, u.Email)
	if err != nil {
		return nil, err
	}
	if _, err := s.queue.EnqueueContext(ctx, task); err != nil && !errors.Is(err, asynq.ErrTaskIDConflict) {
		s.logger.ErrorContext(ctx, "enqueue welcome email", "error", err)
	}
	return u, nil
}
```

### Handler của job

```go
// internal/jobs/email.go
type EmailHandler struct {
	Mailer Mailer
}

func (h *EmailHandler) Welcome(ctx context.Context, t *asynq.Task) error {
	var p WelcomeEmailPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		// Payload hỏng: retry bao nhiêu lần cũng vô ích → đưa thẳng vào dead queue.
		return fmt.Errorf("bad payload: %v: %w", err, asynq.SkipRetry)
	}
	if err := h.Mailer.Send(ctx, p.Email, "Chào mừng!", "..."); err != nil {
		return err // lỗi tạm thời (SMTP timeout) → Asynq tự retry
	}
	return nil
}
```

### Worker main

```go
// cmd/worker/main.go
func main() {
	cfg := must(config.Load())
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	db := must(postgres.NewPool(context.Background(), cfg.DatabaseURL))
	defer db.Close()

	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: cfg.RedisAddr},
		asynq.Config{
			Concurrency: 20,
			Queues: map[string]int{ // trọng số ưu tiên
				"critical": 6,
				"default":  3,
				"low":      1,
			},
			ShutdownTimeout: 30 * time.Second,
			ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, t *asynq.Task, err error) {
				retried, _ := asynq.GetRetryCount(ctx)
				maxRetry, _ := asynq.GetMaxRetry(ctx)
				logger.Error("job failed", "type", t.Type(), "retry", retried, "max", maxRetry, "error", err)
			}),
		},
	)

	emailH := &jobs.EmailHandler{Mailer: smtp.New(cfg.SMTP)}
	exportH := &jobs.ExportHandler{DB: db, Store: must(s3store.New(context.Background(), cfg.AWSRegion, cfg.S3Bucket))}

	mux := asynq.NewServeMux()
	mux.HandleFunc(jobs.TypeWelcomeEmail, emailH.Welcome)
	mux.HandleFunc(jobs.TypeExportOrders, exportH.Orders)

	// Run tự bắt SIGTERM/SIGINT: ngừng nhận job mới, chờ job đang chạy tối đa ShutdownTimeout.
	if err := srv.Run(mux); err != nil {
		log.Fatal(err)
	}
}
```

`asynq.ServeMux` cũng hỗ trợ middleware y như [middleware HTTP](/blog/golang-middleware/): `mux.Use(loggingMiddleware, recoverMiddleware)`.

### Job định kỳ (cron)

```go
// cmd/scheduler/main.go
scheduler := asynq.NewScheduler(asynq.RedisClientOpt{Addr: cfg.RedisAddr}, nil)
scheduler.Register("0 2 * * *", asynq.NewTask("report:daily", nil)) // 2h sáng mỗi ngày
scheduler.Register("@every 5m", asynq.NewTask("sync:inventory", nil))
scheduler.Run()
```

Chỉ chạy **một** instance scheduler, nếu không job sẽ bị enqueue trùng.

## 6. Theo dõi job: đã chạy chưa, lỗi gì, có vào dead queue không?

Vòng đời một task trong Asynq:

```
           Enqueue
              │
  ProcessIn ┌─▼────────┐
  ─────────►│ scheduled │
            └─────┬─────┘
                  ▼
            ┌───────────┐  worker lấy  ┌────────┐  return nil  ┌───────────┐
            │  pending  │ ───────────► │ active │ ───────────► │ completed │
            └───────────┘              └───┬────┘              └───────────┘
                  ▲                        │ return err
                  │   hết thời gian chờ    ▼
                  │   (backoff)       ┌─────────┐
                  └─────────────────  │  retry  │
                                      └────┬────┘
                         hết MaxRetry hoặc │ SkipRetry
                                           ▼
                                      ┌──────────┐
                                      │ archived │  ← "dead queue"
                                      └──────────┘
```

- **retry:** lỗi, chờ chạy lại theo exponential backoff.
- **archived:** dead queue. Job đã thất bại hết số lần retry, hoặc trả `asynq.SkipRetry`. Job nằm đó chờ người xem xét, **không tự chạy lại**.

### Cách 1: Asynqmon (UI web)

```bash
docker run --rm -p 8081:8080 hibiken/asynqmon --redis-addr=host.docker.internal:6379
```

UI có thể:

- Xem số job theo từng trạng thái và từng queue.
- Xem lỗi gần nhất của từng job.
- Chạy lại hoặc xoá job trong archived.

Chạy thêm `asynq` CLI nếu thích dùng terminal: `asynq dash`.

### Cách 2: Inspector API (tra cứu trong code)

```go
insp := asynq.NewInspector(asynq.RedisClientOpt{Addr: cfg.RedisAddr})

info, err := insp.GetTaskInfo("default", "welcome:42")
if err == nil {
	fmt.Println(info.State)    // asynq.TaskStateCompleted, TaskStateRetry, TaskStateArchived...
	fmt.Println(info.Retried)  // đã retry bao nhiêu lần
	fmt.Println(info.LastErr)  // lỗi gần nhất
}

// Liệt kê dead queue
dead, _ := insp.ListArchivedTasks("default", asynq.PageSize(50))

// Sửa xong bug → chạy lại toàn bộ job chết
insp.RunAllArchivedTasks("default")
```

### Cách 3: Bảng trạng thái của riêng bạn

Với job mà **người dùng cần thấy tiến độ** (ví dụ "Export của bạn đang chạy 45%"), đừng bắt frontend hỏi Asynq. Lưu trạng thái nghiệp vụ trong DB:

```sql
CREATE TABLE export_jobs (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT      NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'pending', -- pending | running | done | failed
    progress     INT         NOT NULL DEFAULT 0,          -- 0..100
    file_url     TEXT,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
```

Asynq lo phần **chạy và retry**, bảng của bạn lo phần **hiển thị cho người dùng**.

### Cảnh báo

- Export metrics Prometheus (Asynq có sẵn `x/metrics`), alert khi `archived > 0` hoặc `pending` tăng liên tục.
- Log có `task_id`, `type`, `retry` trong `ErrorHandler` để tra cứu.

## 7. Job chạy cả tiếng: export, batch import

Đây là chỗ nhiều hệ thống bị treo. Các nguyên tắc:

### 7.1. Không bao giờ chạy trong HTTP request

```
POST /exports           → tạo export_jobs (pending), enqueue task → trả 202 + job_id ngay
GET  /exports/{id}      → trả status, progress, file_url
(tuỳ chọn) WebSocket / email khi xong
```

### 7.2. Queue riêng, worker riêng

Không để một job export 1 tiếng chiếm hết slot của queue gửi email:

```go
asynq.NewTask(TypeExportOrders, payload,
	asynq.Queue("long"),
	asynq.Timeout(2*time.Hour),
	asynq.MaxRetry(3),
)
```

Chạy một deployment worker riêng chỉ nghe queue `long`, concurrency thấp:

```go
asynq.Config{Concurrency: 2, Queues: map[string]int{"long": 1}}
```

Worker email (`critical`, `default`) và worker export (`long`) scale độc lập, không ảnh hưởng nhau.

### 7.3. Stream dữ liệu, không load hết vào RAM

Export 5 triệu dòng mà `SELECT *` vào một slice là hết RAM, pod bị OOM kill. Đọc từng dòng và ghi thẳng ra S3:

```go
// internal/jobs/export.go
func (h *ExportHandler) Orders(ctx context.Context, t *asynq.Task) error {
	var p ExportPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("%v: %w", err, asynq.SkipRetry)
	}
	h.setStatus(ctx, p.JobID, "running", 0)

	pr, pw := io.Pipe()
	uploadErr := make(chan error, 1)

	// Goroutine 1: upload lên S3 theo từng phần (multipart), đọc từ pipe.
	go func() {
		key := fmt.Sprintf("exports/%d.csv", p.JobID)
		uploadErr <- h.Store.Upload(ctx, key, pr) // dùng s3/manager.Uploader
	}()

	// Goroutine hiện tại: đọc DB từng dòng, ghi CSV vào pipe.
	err := h.writeCSV(ctx, p, pw)
	pw.CloseWithError(err) // báo cho uploader biết đã xong (hoặc lỗi)

	if err := errors.Join(err, <-uploadErr); err != nil {
		h.setFailed(ctx, p.JobID, err)
		return err
	}
	h.setDone(ctx, p.JobID, fmt.Sprintf("exports/%d.csv", p.JobID))
	return nil
}

func (h *ExportHandler) writeCSV(ctx context.Context, p ExportPayload, w io.Writer) error {
	rows, err := h.DB.Query(ctx,
		`SELECT id, user_id, amount, created_at FROM orders WHERE created_at BETWEEN $1 AND $2 ORDER BY id`,
		p.From, p.To)
	if err != nil {
		return err
	}
	defer rows.Close()

	cw := csv.NewWriter(w)
	cw.Write([]string{"id", "user_id", "amount", "created_at"})

	var n int
	for rows.Next() {
		var o order.Order
		if err := rows.Scan(&o.ID, &o.UserID, &o.Amount, &o.CreatedAt); err != nil {
			return err
		}
		cw.Write([]string{
			strconv.FormatInt(o.ID, 10), strconv.FormatInt(o.UserID, 10),
			strconv.FormatInt(o.Amount, 10), o.CreatedAt.Format(time.RFC3339),
		})
		n++
		if n%10_000 == 0 {
			cw.Flush()
			h.setProgress(ctx, p.JobID, n, p.EstimatedRows)
			if ctx.Err() != nil { // bị huỷ (timeout, worker shutdown)
				return ctx.Err()
			}
		}
	}
	cw.Flush()
	return errors.Join(rows.Err(), cw.Error())
}
```

RAM dùng gần như không đổi dù export 10 nghìn hay 10 triệu dòng.

### 7.4. Chia nhỏ job (fan-out)

Một job 1 tiếng nếu chết ở phút 55 thì phải chạy lại từ đầu. Chia thành nhiều job nhỏ, mỗi job vài phút:

```
export:orders (job cha)
   ├─► export:orders:chunk  id 1..500k
   ├─► export:orders:chunk  id 500k..1M
   ├─► ...
   └─► khi tất cả chunk xong → export:orders:merge (gộp file / tạo zip)
```

- Mỗi chunk retry độc lập, lỗi chỉ chạy lại phần lỗi.
- Nhiều worker chạy song song, tổng thời gian giảm.
- Đếm số chunk đã xong trong DB (`UPDATE export_jobs SET done_chunks = done_chunks + 1 ... RETURNING`), chunk cuối cùng enqueue job merge.

### 7.5. Checkpoint để chạy tiếp được

Với batch import hoặc xử lý tuần tự không chia được, lưu **vị trí đã xử lý**:

```go
for {
	batch, err := repo.FetchAfter(ctx, lastID, 1000) // WHERE id > $1 ORDER BY id LIMIT 1000
	if err != nil || len(batch) == 0 {
		return err
	}
	if err := process(ctx, batch); err != nil {
		return err
	}
	lastID = batch[len(batch)-1].ID
	repo.SaveCheckpoint(ctx, jobID, lastID) // retry sẽ bắt đầu từ đây
}
```

Dùng **keyset pagination** (`WHERE id > ?`) thay vì `OFFSET`. `OFFSET` 4 triệu sẽ chậm dần theo thời gian.

### 7.6. Idempotent

Job có thể chạy **nhiều hơn một lần**: retry, worker chết giữa chừng, deploy. Mọi job phải chạy lại được an toàn:

- Ghi file với key cố định (`exports/{job_id}.csv`): chạy lại thì ghi đè, không tạo file mới.
- Insert dùng `ON CONFLICT DO NOTHING` hoặc upsert.
- Gửi email: lưu `sent_at` và kiểm tra trước khi gửi.

### 7.7. Tôn trọng context và shutdown

- Kiểm tra `ctx.Err()` định kỳ trong vòng lặp dài.
- Truyền `ctx` vào mọi lời gọi DB, S3.
- Khi deploy, Asynq huỷ context sau `ShutdownTimeout`. Job dừng ở checkpoint gần nhất, sau đó được chạy lại.
- Đặt `terminationGracePeriodSeconds` của Kubernetes lớn hơn `ShutdownTimeout`.

### 7.8. Không làm DB chính chết theo

- Export đọc từ **read replica** nếu có.
- Giới hạn concurrency của queue `long`. 2 export song song là đủ, 50 cái sẽ làm DB quá tải.
- Batch insert theo lô 1.000 dòng (`pgx.CopyFrom`), không insert từng dòng.

### 7.9. Khi nào chuyển sang Temporal?

Khi job dài **nhiều bước**, mỗi bước gọi hệ thống khác, cần chạy lại đúng bước bị lỗi, có thể chờ nhiều giờ hoặc nhiều ngày (chờ người duyệt, chờ webhook). Lúc đó tự xây checkpoint trên Asynq trở nên phức tạp, và **Temporal** sinh ra cho đúng bài toán này.

## Tổng kết

| Câu hỏi | Trả lời ngắn |
|---|---|
| Xử lý background job bằng gì? | `go func()` cho việc vặt, worker pool để giới hạn song song, **job queue** cho mọi job quan trọng |
| Goroutine hay Asynq? | Mất job có sao không? Có → Asynq (Redis) / River (Postgres) / Temporal (workflow dài) |
| Theo dõi job thế nào? | Trạng thái `pending → active → completed / retry → archived`. Xem bằng Asynqmon, Inspector API, bảng trạng thái riêng cho người dùng |
| Dead queue? | `archived`: hết retry hoặc `SkipRetry`. Alert khi có job vào đây, sửa lỗi rồi `RunAllArchivedTasks` |
| Setup trong project? | `cmd/api` enqueue, `cmd/worker` chạy, `internal/jobs` định nghĩa task + handler |
| Job chạy hàng giờ? | Trả 202 ngay, queue và worker riêng, stream không load RAM, chia chunk, checkpoint, idempotent, tôn trọng `ctx` |
