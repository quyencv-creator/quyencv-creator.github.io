---
title: "Go web service từ A đến Z: import, build, cấu trúc và vòng đời một request"
description: Cách Go import package, build thành một file binary, tổ chức project và đi theo một HTTP request từ main → handler → service → repo, kèm DB pool, Redis, AWS SDK.
pubDate: 2026-11-20
tags: [golang, architecture, backend]
---

Bài này đi qua toàn bộ một Go web service thực tế: từ việc import package, build ra một file chạy duy nhất, đến cách tổ chức thư mục và một request đi qua những lớp nào.

## 1. Module và import package

Mọi project Go bắt đầu bằng một **module**:

```bash
go mod init github.com/quyencv/shop
```

Lệnh này tạo `go.mod`. Đường dẫn module là tiền tố cho mọi import trong project:

```go
import (
	"context"  // thư viện chuẩn
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool" // thư viện bên ngoài

	"github.com/quyencv/shop/internal/config" // package trong chính project
)
```

Quy tắc cần nhớ:

- **Một thư mục = một package.** Tên package thường trùng tên thư mục cuối.
- **Chữ hoa = public, chữ thường = private.** `config.Load` dùng được từ package khác, `config.parse` thì không.
- **Thêm thư viện:** `go get github.com/redis/go-redis/v9`, sau đó `go mod tidy` để dọn `go.mod` / `go.sum`.
- **`internal/`** là thư mục đặc biệt: package bên trong chỉ import được từ chính module này. Dùng nó cho hầu hết code của bạn.
- **Không được import vòng** (A import B, B import A). Đây là lý do cần phân lớp rõ ràng.

## 2. Build thành một file duy nhất

Go biên dịch toàn bộ code và thư viện thành **một file binary**, không cần cài runtime trên server.

```bash
go build -o bin/api ./cmd/api
./bin/api
```

Để được một file **tĩnh hoàn toàn**, chạy được trên mọi Linux (kể cả image `scratch`):

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags="-s -w -X main.version=1.2.0" -o bin/api ./cmd/api
```

| Flag | Ý nghĩa |
|---|---|
| `CGO_ENABLED=0` | Không link thư viện C → binary tĩnh |
| `GOOS` / `GOARCH` | Cross-compile, ví dụ build trên Mac ra binary Linux |
| `-trimpath` | Bỏ đường dẫn máy build khỏi binary |
| `-ldflags="-s -w"` | Bỏ debug symbol, file nhỏ hơn ~30% |
| `-X main.version=...` | Gán giá trị cho biến lúc build |

Muốn đóng gói cả file tĩnh (HTML, migration SQL) vào binary, dùng `embed`:

```go
//go:embed migrations/*.sql
var migrations embed.FS
```

Dockerfile multi-stage, image cuối chỉ vài MB:

```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /api ./cmd/api

FROM gcr.io/distroless/static
COPY --from=build /api /api
ENTRYPOINT ["/api"]
```

## 3. Cấu trúc thư mục

```
shop/
├── cmd/
│   └── api/
│       └── main.go            # điểm vào: đọc config, khởi tạo, nối dây, chạy server
├── internal/
│   ├── config/                # đọc env → struct Config
│   ├── platform/              # hạ tầng: tạo client cho thư viện bên ngoài
│   │   ├── postgres/          #   pgxpool
│   │   ├── redis/             #   go-redis
│   │   └── s3store/           #   AWS SDK S3
│   ├── order/                 # một domain / tính năng
│   │   ├── handler.go         #   HTTP: parse request, trả response
│   │   ├── service.go         #   nghiệp vụ
│   │   ├── repository.go      #   truy vấn DB
│   │   └── model.go           #   struct Order
│   └── httpserver/            # router, middleware
├── pkg/                       # (tuỳ chọn) code dùng lại được cho project KHÁC
├── migrations/
├── go.mod
└── Dockerfile
```

**Đặt code ở đâu?**

| Loại code | Vị trí |
|---|---|
| Hàm `main`, nối dây các thành phần | `cmd/<tên-app>/main.go` |
| Tạo client thư viện ngoài (DB, Redis, AWS, Stripe…) | `internal/platform/<tên>` |
| Nghiệp vụ theo domain | `internal/<domain>` (order, user, payment…) |
| Package tự viết, chỉ dùng trong project | `internal/...` |
| Package tự viết, muốn project khác import | `pkg/...` hoặc tách thành module riêng |

Nhóm theo **domain** (`order/`, `user/`) thay vì theo **lớp** (`handlers/`, `services/`, `repos/`) giúp mỗi tính năng nằm gọn một chỗ.

## 4. Config

```go
// internal/config/config.go
package config

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	RedisAddr   string
	AWSRegion   string
	S3Bucket    string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisAddr:   getenv("REDIS_ADDR", "localhost:6379"),
		AWSRegion:   getenv("AWS_REGION", "ap-southeast-1"),
		S3Bucket:    os.Getenv("S3_BUCKET"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
```

Config được đọc **một lần** trong `main` rồi truyền xuống. Không gọi `os.Getenv` rải rác trong service.

## 5. Tạo client cho thư viện bên ngoài (platform)

Mỗi package trong `platform/` chỉ có một việc: **nhận config, trả về client đã sẵn sàng**.

**PostgreSQL pool:**

```go
// internal/platform/postgres/postgres.go
package postgres

func NewPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 20
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil { // fail sớm nếu DB không kết nối được
		pool.Close()
		return nil, err
	}
	return pool, nil
}
```

**Redis:**

```go
// internal/platform/redis/redis.go
package redis

import goredis "github.com/redis/go-redis/v9"

func NewClient(ctx context.Context, addr string) (*goredis.Client, error) {
	rdb := goredis.NewClient(&goredis.Options{Addr: addr, PoolSize: 20})
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return rdb, nil
}
```

**AWS SDK v2 (S3):**

```go
// internal/platform/s3store/s3store.go
package s3store

import (
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Store struct {
	client *s3.Client
	bucket string
}

func New(ctx context.Context, region, bucket string) (*Store, error) {
	// Tự đọc credential từ env, ~/.aws hoặc IAM role khi chạy trên EC2/ECS/EKS.
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return &Store{client: s3.NewFromConfig(awsCfg), bucket: bucket}, nil
}

func (s *Store) Put(ctx context.Context, key string, body io.Reader) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Body:   body,
	})
	return err
}
```

Tại sao bọc AWS client trong `Store` thay vì dùng thẳng `*s3.Client` trong service?

- Service chỉ cần `Put(ctx, key, body)`, không cần biết `PutObjectInput`.
- Đổi sang MinIO / GCS chỉ sửa một chỗ.
- Dễ mock khi test (xem phần interface bên dưới).

Áp dụng tương tự cho mọi thư viện bên thứ ba: Stripe, SendGrid, Firebase… mỗi cái một package trong `platform/`.

## 6. Repository → Service → Handler

**Model:**

```go
// internal/order/model.go
package order

type Order struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Amount    int64     `json:"amount"`
	CreatedAt time.Time `json:"created_at"`
}
```

**Repository**: chỉ nói chuyện với DB, nhận `*pgxpool.Pool` qua constructor:

```go
// internal/order/repository.go
package order

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, o *Order) error {
	return r.db.QueryRow(ctx,
		`INSERT INTO orders (user_id, amount) VALUES ($1, $2) RETURNING id, created_at`,
		o.UserID, o.Amount,
	).Scan(&o.ID, &o.CreatedAt)
}

func (r *Repository) GetByID(ctx context.Context, id int64) (*Order, error) {
	var o Order
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, amount, created_at FROM orders WHERE id = $1`, id,
	).Scan(&o.ID, &o.UserID, &o.Amount, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}
```

**Service**: nghiệp vụ. Nó **khai báo interface** cho những gì nó cần, thay vì phụ thuộc vào struct cụ thể:

```go
// internal/order/service.go
package order

var ErrNotFound = errors.New("order not found")
var ErrInvalidAmount = errors.New("amount must be positive")

// Interface khai báo ở phía NGƯỜI DÙNG (service), không phải phía cài đặt.
type store interface {
	Create(ctx context.Context, o *Order) error
	GetByID(ctx context.Context, id int64) (*Order, error)
}

type cache interface {
	Get(ctx context.Context, key string) *goredis.StringCmd
	Set(ctx context.Context, key string, v any, ttl time.Duration) *goredis.StatusCmd
}

type Service struct {
	repo  store
	cache cache
}

func NewService(repo store, cache cache) *Service {
	return &Service{repo: repo, cache: cache}
}

func (s *Service) Create(ctx context.Context, userID, amount int64) (*Order, error) {
	if amount <= 0 {
		return nil, ErrInvalidAmount
	}
	o := &Order{UserID: userID, Amount: amount}
	if err := s.repo.Create(ctx, o); err != nil {
		return nil, fmt.Errorf("create order: %w", err)
	}
	return o, nil
}

func (s *Service) Get(ctx context.Context, id int64) (*Order, error) {
	key := fmt.Sprintf("order:%d", id)
	if b, err := s.cache.Get(ctx, key).Bytes(); err == nil {
		var o Order
		if json.Unmarshal(b, &o) == nil {
			return &o, nil
		}
	}
	o, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if b, err := json.Marshal(o); err == nil {
		s.cache.Set(ctx, key, b, 5*time.Minute)
	}
	return o, nil
}
```

`*Repository` và `*goredis.Client` tự động thoả mãn các interface này. Go không cần `implements`. Khi test, bạn truyền một fake struct vào.

**Handler**: chỉ lo HTTP: đọc request, gọi service, ghi response:

```go
// internal/order/handler.go
package order

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /orders", h.create)
	mux.HandleFunc("GET /orders/{id}", h.get)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID int64 `json:"user_id"`
		Amount int64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	o, err := h.svc.Create(r.Context(), req.UserID, req.Amount)
	if errors.Is(err, ErrInvalidAmount) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, o)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	o, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
```

## 7. `main.go`: nối dây mọi thứ

`main` là nơi **duy nhất** biết mọi thành phần. Nó tạo từng thứ theo thứ tự rồi truyền vào constructor của lớp trên (dependency injection thủ công, không cần framework):

```go
// cmd/api/main.go
package main

var version = "dev" // gán lúc build bằng -ldflags "-X main.version=..."

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	// ctx bị huỷ khi nhận Ctrl+C / SIGTERM (Kubernetes, Docker stop).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// 1. Config
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// 2. Hạ tầng (mỗi thứ tạo MỘT lần, dùng chung cho cả app)
	db, err := postgres.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer db.Close()

	rdb, err := redis.NewClient(ctx, cfg.RedisAddr)
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	defer rdb.Close()

	files, err := s3store.New(ctx, cfg.AWSRegion, cfg.S3Bucket)
	if err != nil {
		return fmt.Errorf("s3: %w", err)
	}
	_ = files // truyền vào service nào cần upload file

	// 3. Domain: repo → service → handler
	orderRepo := order.NewRepository(db)
	orderSvc := order.NewService(orderRepo, rdb)
	orderHandler := order.NewHandler(orderSvc)

	// 4. Router + middleware
	mux := http.NewServeMux()
	orderHandler.Routes(mux)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpserver.Logging(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// 5. Chạy server, chờ tín hiệu tắt
	errCh := make(chan error, 1)
	go func() {
		log.Printf("api %s listening on %s", version, cfg.HTTPAddr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	// 6. Graceful shutdown: chờ request đang chạy xong (tối đa 10s)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
```

Thứ tự `defer` đảm bảo khi tắt: server dừng nhận request → Redis đóng → DB pool đóng.

## 8. Một request đi từ đâu tới đâu

```
Client: GET /orders/42
   │
   ▼
http.Server (net/http)  ── tạo r.Context(), huỷ khi client ngắt kết nối
   │
   ▼
Middleware (logging, auth, request-id, timeout)
   │  ctx = context.WithValue(ctx, requestIDKey, "abc")
   ▼
order.Handler.get(w, r)
   │  parse id từ URL, gọi h.svc.Get(r.Context(), 42)
   ▼
order.Service.Get(ctx, 42)
   │  1. rdb.Get(ctx, "order:42")      ──► Redis  (hit → trả về ngay)
   │  2. repo.GetByID(ctx, 42)         ──► miss
   ▼
order.Repository.GetByID(ctx, 42)
   │  db.QueryRow(ctx, "SELECT ...")   ──► mượn 1 connection từ pool,
   │                                       trả lại pool khi Scan xong
   ▼
PostgreSQL
   │
   ◄── kết quả đi ngược lên: repo → service (ghi cache) → handler → JSON 200
```

Tóm lại:

- **Khi khởi động** (một lần): config → DB pool → Redis → AWS client → repo → service → handler → router.
- **Mỗi request**: chỉ có `ctx` và dữ liệu request đi xuống. Pool, client đã có sẵn trong struct, **không tạo mới**.

## 9. Context: truyền ở mọi tầng

Quy tắc của Go:

- `ctx context.Context` luôn là **tham số đầu tiên** của mọi hàm có I/O.
- Lấy từ `r.Context()` trong handler, truyền xuống service → repo → `db.QueryRow(ctx, ...)` / `rdb.Get(ctx, ...)` / `s3.PutObject(ctx, ...)`.
- **Không lưu ctx trong struct**, không dùng `context.Background()` giữa chừng một request.

Lợi ích: khi client đóng tab hoặc hết timeout, context bị huỷ và **mọi truy vấn DB, Redis, AWS đang chạy cho request đó dừng theo**, không lãng phí connection.

Đặt timeout cho cả request bằng middleware:

```go
func Timeout(d time.Duration, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), d)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
```

## 10. Context hay struct: truyền cái gì bằng cái gì?

| Thứ cần truyền | Cách truyền | Lý do |
|---|---|---|
| DB pool, Redis client, AWS client, logger | Field trong struct, qua constructor `NewX(...)` | Sống suốt vòng đời app, dùng chung |
| Config | Truyền giá trị cần thiết vào constructor | Đọc một lần lúc khởi động |
| Deadline, cancel | `ctx` | Gắn với từng request |
| Request ID, user ID đã xác thực, trace | `ctx.Value` (dùng có chừng mực) | Metadata của từng request |
| Dữ liệu nghiệp vụ (order, amount) | Tham số hàm | Rõ ràng, có kiểu |

**Đừng** nhét DB pool vào context, và **đừng** dùng biến global cho pool. Truyền qua constructor giúp nhìn vào `main.go` là thấy toàn bộ phụ thuộc, và test thay thế được dễ dàng.

## Tổng kết

1. `go mod init` → import theo đường dẫn module; code riêng để trong `internal/`.
2. `CGO_ENABLED=0 go build -ldflags="-s -w"` → một file binary tĩnh, đóng vào image distroless vài MB.
3. `cmd/` cho điểm vào, `internal/platform/` cho client thư viện ngoài, `internal/<domain>/` cho handler, service, repo.
4. Tạo pool và client **một lần** trong `main`, truyền xuống bằng constructor.
5. `ctx` đi theo từng request qua mọi tầng, tới tận lời gọi DB, Redis, AWS.
6. Service khai báo interface cho thứ nó cần → dễ test, dễ thay thế.
