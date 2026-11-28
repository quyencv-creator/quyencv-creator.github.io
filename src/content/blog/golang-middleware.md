---
title: "Middleware trong Go: cách viết, cách chạy và 3 ví dụ thực tế"
description: Middleware trong Go là gì, chạy theo thứ tự nào, nên làm gì ở tầng middleware, kèm ví dụ logging, authentication và phân quyền theo role.
pubDate: 2026-01-19
tags: [golang, backend, middleware]
---

Trong [bài trước](/blog/go-web-service-tu-a-den-z/) có nhắc tới middleware nằm giữa `http.Server` và handler. Bài này đi sâu vào phần đó: middleware là gì, viết thế nào, chạy theo thứ tự ra sao, và người ta thường đặt gì vào đây.

## 1. Middleware là gì?

Middleware là một lớp bọc quanh handler, chạy **trước** và **sau** handler cho mọi request đi qua nó. Nó dùng để xử lý những việc **chung cho nhiều route**: ghi log, xác thực, giới hạn tốc độ… thay vì lặp lại trong từng handler.

Trong Go, `net/http` chỉ có một khái niệm:

```go
type Handler interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
}
```

Middleware đơn giản là **một hàm nhận một `http.Handler` và trả về một `http.Handler` khác**:

```go
func(next http.Handler) http.Handler
```

Không cần framework, không cần thư viện. Mọi router phổ biến (chi, gorilla/mux, echo, gin) đều dựa trên cùng ý tưởng này.

## 2. Cách viết một middleware

Khung chung:

```go
func MyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// (1) Trước handler: đọc header, kiểm tra, gắn dữ liệu vào context...

		next.ServeHTTP(w, r) // (2) Gọi tầng tiếp theo

		// (3) Sau handler: đo thời gian, ghi log...
	})
}
```

Ba điều cần nhớ:

- **Gọi `next.ServeHTTP`** để cho request đi tiếp. **Không gọi** nghĩa là chặn request lại (ví dụ trả 401) và phải `return`.
- Muốn truyền dữ liệu xuống tầng dưới thì gắn vào context: `next.ServeHTTP(w, r.WithContext(ctx))`.
- Middleware cần tham số (config, dependency) thì viết hàm **trả về** middleware:

```go
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
```

### Ghép nhiều middleware

Bọc lồng nhau thì khó đọc:

```go
handler := Recover(Logging(Auth(mux)))
```

Viết một hàm `Chain` nhỏ:

```go
// internal/httpserver/chain.go
type Middleware func(http.Handler) http.Handler

// Chain(h, A, B, C) => A(B(C(h))): A chạy đầu tiên.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}
```

### Đặt ở đâu trong project

```
internal/
├── httpserver/
│   ├── chain.go
│   ├── logging.go       # middleware chung cho toàn app
│   ├── recover.go
│   └── requestid.go
└── auth/
    ├── middleware.go    # Authenticate, RequireRole
    └── context.go       # đọc/ghi user từ context
```

Middleware chung (log, recover, request ID) để ở `httpserver/`. Middleware gắn với một domain (auth) để trong package của domain đó.

## 3. Middleware chạy từ đâu tới đâu

Middleware xếp lớp như **củ hành**: request đi vào từ lớp ngoài cùng tới handler, response đi ngược ra theo thứ tự đảo lại.

```
Chain(mux, Recover, RequestID, Logging, Authenticate)

Request ─►┌─ Recover ─────────────────────────────────┐
          │ ┌─ RequestID ───────────────────────────┐ │
          │ │ ┌─ Logging ─────────────────────────┐ │ │
          │ │ │ ┌─ Authenticate ────────────────┐ │ │ │
          │ │ │ │                               │ │ │ │
          │ │ │ │  mux ─► RequireRole ─► Handler│ │ │ │
          │ │ │ │                               │ │ │ │
          │ │ │ └───────────────────────────────┘ │ │ │
          │ │ └───────────────────────────────────┘ │ │
          │ └───────────────────────────────────────┘ │
Response ◄└───────────────────────────────────────────┘
```

Với 3 middleware A, B, C, thứ tự in ra là:

```
A trước → B trước → C trước → HANDLER → C sau → B sau → A sau
```

Nếu `Authenticate` trả 401 và không gọi `next`, request dừng ở đó. Handler không chạy, nhưng phần "sau" của `Logging`, `RequestID`, `Recover` vẫn chạy, nên request bị chặn vẫn được ghi log.

**Thứ tự rất quan trọng:**

- `Recover` đặt **ngoài cùng** để bắt panic của mọi lớp bên trong.
- `RequestID` đặt **trước** `Logging` để log có request ID.
- `Logging` đặt **trước** `Authenticate` để ghi log cả request bị từ chối (401).
- `RequireRole` đặt **sau** `Authenticate`, vì cần biết user là ai mới kiểm tra được role.

## 4. Ví dụ 1: Logging

Muốn log status code thì phải "nghe lén" `WriteHeader`, vì `http.ResponseWriter` không cho đọc lại status. Ta bọc nó:

```go
// internal/httpserver/logging.go
package httpserver

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func Logging(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			logger.InfoContext(r.Context(), "http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"bytes", rec.bytes,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", RequestIDFrom(r.Context()),
			)
		})
	}
}
```

Kết quả (JSON với `slog.NewJSONHandler`):

```json
{"level":"INFO","msg":"http request","method":"GET","path":"/orders/42","status":200,"bytes":87,"duration_ms":3,"request_id":"9f1c..."}
```

Middleware **RequestID** đi kèm:

```go
// internal/httpserver/requestid.go
type ctxKey int

const requestIDKey ctxKey = iota

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString() // github.com/google/uuid
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}
```

Key của context dùng **kiểu riêng chưa export** (`ctxKey`), không dùng `string`, để tránh đụng key với package khác.

## 5. Ví dụ 2: Authentication

Middleware đọc token từ header `Authorization: Bearer <token>`, xác thực, rồi gắn **user** vào context cho handler dùng.

Phần lưu và đọc user trong context:

```go
// internal/auth/context.go
package auth

type User struct {
	ID    int64
	Email string
	Roles []string
}

type ctxKey struct{}

func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func UserFrom(ctx context.Context) (*User, bool) {
	u, ok := ctx.Value(ctxKey{}).(*User)
	return u, ok
}
```

Middleware nhận vào một `TokenVerifier`, là interface, để không phụ thuộc vào thư viện JWT hay cách lưu session cụ thể:

```go
// internal/auth/middleware.go
package auth

type TokenVerifier interface {
	Verify(ctx context.Context, token string) (*User, error)
}

func Authenticate(v TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || token == "" {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return // không gọi next → request dừng ở đây
			}

			user, err := v.Verify(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
		})
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
```

Cài đặt `TokenVerifier` bằng JWT, đặt trong `internal/platform/jwt` hoặc `internal/auth/jwt.go`:

```go
// dùng github.com/golang-jwt/jwt/v5
type JWTVerifier struct {
	secret []byte
}

type claims struct {
	Email string   `json:"email"`
	Roles []string `json:"roles"`
	jwt.RegisteredClaims
}

func (v *JWTVerifier) Verify(_ context.Context, token string) (*User, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) {
		return v.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(c.Subject, 10, 64)
	if err != nil {
		return nil, err
	}
	return &User{ID: id, Email: c.Email, Roles: c.Roles}, nil
}
```

Handler chỉ việc lấy user ra, không cần biết token:

```go
func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.UserFrom(r.Context())
	writeJSON(w, http.StatusOK, user)
}
```

## 6. Ví dụ 3: Phân quyền theo role

`Authenticate` trả lời câu hỏi "**bạn là ai**" (sai thì 401). `RequireRole` trả lời câu hỏi "**bạn có được làm việc này không**" (sai thì 403).

```go
// internal/auth/middleware.go
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFrom(r.Context())
			if !ok {
				// Quên đặt Authenticate phía trước: lỗi cấu hình, không phải lỗi người dùng.
				writeError(w, http.StatusUnauthorized, "unauthenticated")
				return
			}
			for _, want := range roles {
				if slices.Contains(user.Roles, want) {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeError(w, http.StatusForbidden, "forbidden")
		})
	}
}
```

Vì `RequireRole` khác nhau theo từng route, ta gắn nó **ở cấp route** thay vì cấp toàn app:

```go
// cmd/api/main.go
mux := http.NewServeMux()

// Public
mux.HandleFunc("GET /health", healthHandler)

// Cần đăng nhập
authed := auth.Authenticate(jwtVerifier)
mux.Handle("GET /me", authed(http.HandlerFunc(userHandler.Me)))
mux.Handle("GET /orders/{id}", authed(http.HandlerFunc(orderHandler.Get)))

// Cần đăng nhập + role admin
adminOnly := func(h http.HandlerFunc) http.Handler {
	return httpserver.Chain(h, authed, auth.RequireRole("admin"))
}
mux.Handle("DELETE /orders/{id}", adminOnly(orderHandler.Delete))
mux.Handle("GET /admin/users", adminOnly(userHandler.List))

// Middleware toàn app bọc ngoài cùng
handler := httpserver.Chain(mux,
	httpserver.Recover(logger),
	httpserver.RequestID,
	httpserver.Logging(logger),
)

srv := &http.Server{Addr: ":8080", Handler: handler}
```

Thử bằng curl:

```bash
curl -i localhost:8080/me                                  # 401 missing bearer token
curl -i -H "Authorization: Bearer $USER_TOKEN"  -X DELETE localhost:8080/orders/1   # 403 forbidden
curl -i -H "Authorization: Bearer $ADMIN_TOKEN" -X DELETE localhost:8080/orders/1   # 204
```

## 7. Bonus: Recover

Một panic trong handler mà không được bắt sẽ khiến `net/http` đóng kết nối và client không nhận được response tử tế. `Recover` biến panic thành lỗi 500 và ghi lại stack trace:

```go
// internal/httpserver/recover.go
func Recover(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					if err == http.ErrAbortHandler {
						panic(err) // panic cố ý của net/http, để nguyên
					}
					logger.ErrorContext(r.Context(), "panic",
						"error", err, "stack", string(debug.Stack()))
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
```

## 8. Middleware làm được những gì? Người ta hay viết gì?

Middleware có toàn quyền với request và response:

| Có thể làm | Ví dụ |
|---|---|
| Đọc / sửa request | Đọc header, cookie, IP; giới hạn kích thước body bằng `http.MaxBytesReader` |
| Gắn dữ liệu vào context | User, request ID, trace span, tenant ID |
| Chặn request | Trả 401, 403, 429 mà không gọi `next` |
| Sửa response | Thêm header, nén gzip, bọc `ResponseWriter` |
| Đo lường sau handler | Thời gian xử lý, status code, số byte |
| Bắt lỗi | `recover()` panic |

Những middleware hay gặp trong project thực tế, theo thứ tự thường đặt (ngoài → trong):

1. **Recover**: bắt panic.
2. **Request ID**: gắn ID cho mỗi request để truy vết log.
3. **Tracing / Metrics**: OpenTelemetry span, Prometheus counter và histogram.
4. **Logging**: access log.
5. **CORS**: header cho frontend khác domain.
6. **Security headers**: `Strict-Transport-Security`, `X-Content-Type-Options`…
7. **Rate limit**: giới hạn số request theo IP hoặc user (`golang.org/x/time/rate`, Redis).
8. **Timeout / body limit**: `context.WithTimeout`, `http.MaxBytesReader`.
9. **Compression**: gzip.
10. **Authentication**: xác thực token hoặc session.
11. **Authorization**: kiểm tra role hoặc permission, thường gắn theo route.

## 9. Những gì **không** nên đặt trong middleware

- **Nghiệp vụ:** tính tiền, kiểm tra tồn kho… thuộc về service. Middleware chỉ lo việc "xuyên suốt" mọi request.
- **Truy vấn DB nặng cho mọi request:** ví dụ load toàn bộ profile user khi chỉ cần ID. Lấy những gì tối thiểu từ token, phần còn lại để handler hoặc service lấy khi cần.
- **Dữ liệu nghiệp vụ trong `ctx.Value`:** context chỉ nên chứa metadata của request (user, request ID, trace). Dữ liệu nghiệp vụ truyền bằng tham số hàm.
- **Đọc hết `r.Body`** rồi quên trả lại: handler phía sau sẽ nhận body rỗng.

## Tổng kết

1. Middleware là `func(http.Handler) http.Handler`. Chỉ cần thư viện chuẩn.
2. Code trước `next.ServeHTTP` chạy khi request đi vào, code sau chạy khi response đi ra. Không gọi `next` là chặn request.
3. Thứ tự giống củ hành: lớp đặt trước ở ngoài. Recover ngoài cùng, Auth trước Role.
4. Truyền dữ liệu xuống bằng `r.WithContext`, dùng key kiểu riêng chưa export.
5. Middleware chung gắn cho cả app; middleware riêng (role) gắn theo từng route.
6. Middleware lo việc xuyên suốt (log, auth, giới hạn). Nghiệp vụ để ở service.
