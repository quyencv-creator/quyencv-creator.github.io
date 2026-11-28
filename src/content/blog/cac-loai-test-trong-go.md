---
title: "Các loại test và 3 loại quan trọng nhất trong Go project"
description: "Unit, integration, contract, end-to-end, smoke, load, fuzz: mỗi loại test trả lời một câu hỏi khác nhau. Với một Go backend thông thường, ba loại mang lại nhiều giá trị nhất là unit test dạng bảng, test HTTP handler bằng httptest, và integration test với database thật. Code chạy thật, kèm output, coverage và một bug mà test bắt được."
pubDate: 2026-11-28
tags: [golang, backend]
---

Hỏi "dự án này có test không" thì hầu như ai cũng trả lời có. Hỏi tiếp "test đó bảo vệ được điều gì" thì câu trả lời thường mơ hồ hơn nhiều.

Test không phải là một thứ duy nhất. Mỗi loại test trả lời một câu hỏi khác nhau, tốn chi phí khác nhau, và bắt được những loại lỗi khác nhau. Bài này đi qua các loại test phổ biến, rồi tập trung vào ba loại mà mình thấy đáng đầu tư nhất trong một Go backend thông thường, với code chạy thật và output thật.

**Về code trong bài:** toàn bộ chạy với Go 1.24 và PostgreSQL 16 trên máy local. Output test, coverage và lỗi đều là output thật. Phần nào không chạy, mình ghi rõ tại chỗ.

## Các loại test và câu hỏi mỗi loại trả lời

| Loại | Câu hỏi nó trả lời | Tốc độ | Ví dụ |
|---|---|---|---|
| **Unit test** | Một hàm có tính đúng với mọi đầu vào không? | Mili giây | Hàm tính tổng tiền, hàm parse, logic nghiệp vụ thuần |
| **Component / handler test** | Một lớp của hệ thống (HTTP handler, consumer) có xử lý đúng request, lỗi, mã trạng thái không? | Mili giây | Handler trả 400 khi thiếu header, 409 khi trùng |
| **Integration test** | Code có làm việc đúng với hệ thống thật bên ngoài không? (database, Redis, hàng đợi) | Hàng chục đến hàng trăm mili giây | Ràng buộc UNIQUE, transaction, câu SQL |
| **Contract test** | Hai service có còn hiểu nhau không? | Nhanh | Format JSON mà service khác đang đọc |
| **End-to-end test** | Luồng người dùng từ đầu tới cuối có chạy không? | Giây đến phút | Đăng nhập, thêm giỏ, thanh toán |
| **Smoke test** | Bản vừa deploy có sống không? | Giây | Gọi `/health` và một API chính sau deploy |
| **Load / performance test** | Hệ thống chịu được bao nhiêu tải, gãy ở đâu? | Phút đến giờ | Bắn 200 request/giây trong 10 phút |
| **Fuzz / property test** | Có đầu vào lạ nào làm code sai hoặc panic không? | Chạy càng lâu càng tốt | Parser, decoder, hàm xử lý chuỗi |

Có một mô hình quen thuộc gọi là **kim tự tháp test**: nhiều unit test ở đáy vì rẻ và nhanh, ít end-to-end test ở đỉnh vì chậm và dễ vỡ. Mô hình này hữu ích, nhưng đừng hiểu máy móc thành "càng nhiều unit test càng tốt". Một backend chủ yếu đọc ghi database mà chỉ có unit test với database giả thì đang bỏ trống đúng chỗ hay hỏng nhất.

Câu hỏi đúng không phải "cần bao nhiêu test mỗi loại", mà là: **lỗi nào đắt nhất với hệ thống này, và loại test nào bắt được lỗi đó với chi phí thấp nhất?**

Load test mình đã viết riêng trong bài [k6 cho Rails API](/blog/k6-load-test-rails-api/). Bài này tập trung vào ba loại chạy được trong `go test` hằng ngày.

## Ví dụ xuyên suốt

Một service đặt hàng nhỏ, gồm ba phần:

- `Total()`: tính tổng tiền, trừ mã giảm giá, cộng phí ship nếu chưa tới ngưỡng miễn phí.
- `NewHandler()`: API `POST /orders` (bắt buộc header `Idempotency-Key`) và `GET /orders/{id}`.
- `PGStore`: lưu đơn hàng vào PostgreSQL, có ràng buộc `UNIQUE` cho idempotency key và `CHECK (total >= 0)`.

Handler không phụ thuộc trực tiếp vào PostgreSQL mà vào một interface nhỏ:

```go
type Store interface {
    Create(ctx context.Context, o *Order) error
    Get(ctx context.Context, id int64) (Order, error)
}
```

Interface nhỏ này là thứ cho phép test handler mà không cần database. Đây là thiết kế có chủ đích, không phải viết thêm cho có.

## Loại 1: Unit test dạng bảng (table-driven)

Logic nghiệp vụ thuần, không I/O, là chỗ unit test phát huy nhất. Trong Go, cách viết phổ biến là **test dạng bảng**: mỗi trường hợp là một dòng dữ liệu, một vòng lặp chạy tất cả.

```go
func Total(items []Item, couponPct int) (int64, error) {
    if len(items) == 0 {
        return 0, ErrEmptyCart
    }
    if couponPct < 0 || couponPct > 50 {
        return 0, ErrInvalidCoupon
    }
    var sub int64
    for _, it := range items {
        if it.Quantity <= 0 {
            return 0, ErrInvalidQuantity
        }
        sub += it.Price * int64(it.Quantity)
    }
    sub -= sub * int64(couponPct) / 100
    if sub < FreeShipThreshold {
        sub += ShippingFee
    }
    return sub, nil
}
```

```go
func TestTotal(t *testing.T) {
    tests := []struct {
        name    string
        items   []Item
        coupon  int
        want    int64
        wantErr error
    }{
        {"dưới ngưỡng thì cộng phí ship", []Item{{"A", 100_000, 2}}, 0, 230_000, nil},
        {"đúng ngưỡng thì miễn phí ship", []Item{{"A", 250_000, 2}}, 0, 500_000, nil},
        {"giảm giá kéo xuống dưới ngưỡng thì phải trả ship", []Item{{"A", 520_000, 1}}, 10, 498_000, nil},
        {"nhiều sản phẩm", []Item{{"A", 300_000, 1}, {"B", 150_000, 2}}, 0, 600_000, nil},
        {"giỏ trống", nil, 0, 0, ErrEmptyCart},
        {"số lượng 0", []Item{{"A", 100_000, 0}}, 0, 0, ErrInvalidQuantity},
        {"coupon quá 50%", []Item{{"A", 100_000, 1}}, 60, 0, ErrInvalidCoupon},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            got, err := Total(tc.items, tc.coupon)
            if !errors.Is(err, tc.wantErr) {
                t.Fatalf("err = %v, muốn %v", err, tc.wantErr)
            }
            if got != tc.want {
                t.Errorf("Total() = %d, muốn %d", got, tc.want)
            }
        })
    }
}
```

```text
--- PASS: TestTotal (0.00s)
    --- PASS: TestTotal/dưới_ngưỡng_thì_cộng_phí_ship (0.00s)
    --- PASS: TestTotal/nhiều_sản_phẩm (0.00s)
    --- PASS: TestTotal/giảm_giá_kéo_xuống_dưới_ngưỡng_thì_phải_trả_ship (0.00s)
    --- PASS: TestTotal/đúng_ngưỡng_thì_miễn_phí_ship (0.00s)
    --- PASS: TestTotal/giỏ_trống (0.00s)
    --- PASS: TestTotal/coupon_quá_50% (0.00s)
    --- PASS: TestTotal/số_lượng_0 (0.00s)
PASS
```

Vài điểm đáng để ý:

- **Tên test là câu mô tả nghiệp vụ**, không phải `test1`, `test2`. Khi fail, bạn biết ngay quy tắc nào bị vỡ mà không cần đọc code.
- **Test ranh giới**: đúng ngưỡng 500.000, dưới ngưỡng, và trường hợp "trước giảm giá thì trên ngưỡng, sau giảm giá thì dưới ngưỡng". Bug hay nằm ở biên.
- **`errors.Is`** thay vì so chuỗi lỗi, để đổi câu chữ thông báo không làm vỡ test.
- **`t.Run`** cho từng trường hợp, nên chạy được riêng một case bằng `go test -run 'TestTotal/giỏ'`.
- **`t.Parallel()`** khi các case độc lập. Từ Go 1.22, biến vòng lặp `tc` là riêng cho mỗi lần lặp, nên không cần dòng `tc := tc` như trước (xem bài [bẫy dữ liệu trong Go](/blog/go-kho-hieu-bay-du-lieu/)).

### Khi test bắt được bug

Để thấy test có giá trị thật, mình cố ý gây một bug rất dễ xảy ra: xét ngưỡng miễn phí ship **trước** khi trừ giảm giá.

```go
if sub < FreeShipThreshold { // BUG: xét ngưỡng miễn ship trước khi trừ giảm giá
    sub += ShippingFee
}
sub -= sub * int64(couponPct) / 100
```

```text
--- FAIL: TestTotal (0.00s)
    --- FAIL: TestTotal/giảm_giá_kéo_xuống_dưới_ngưỡng_thì_phải_trả_ship (0.00s)
        price_test.go:32: Total() = 468000, muốn 498000
FAIL
```

Đơn 520.000 đồng, giảm 10% còn 468.000, đáng lẽ phải cộng phí ship. Bản lỗi miễn phí ship cho đơn này. Trên production, lỗi kiểu này không làm crash gì cả. Nó chỉ âm thầm làm mất 30.000 đồng trên mỗi đơn có mã giảm giá. Tên test đã nói rõ quy tắc nào bị vỡ.

## Loại 2: Test HTTP handler bằng `httptest`

Handler là nơi có nhiều nhánh nhất: thiếu header, body hỏng, dữ liệu không hợp lệ, trùng, lỗi database. Mỗi nhánh cần trả đúng mã trạng thái và thông báo. Gói `net/http/httptest` cho phép gọi handler trực tiếp, không cần mở cổng mạng, và nhanh như unit test.

Thay database bằng một bản giả trong bộ nhớ, có thể ép trả lỗi:

```go
type fakeStore struct {
    mu     sync.Mutex
    orders map[int64]Order
    keys   map[string]bool
    err    error // ép lỗi để test nhánh 500
}

func (f *fakeStore) Create(_ context.Context, o *Order) error {
    f.mu.Lock()
    defer f.mu.Unlock()
    if f.err != nil {
        return f.err
    }
    if f.keys[o.IdempotencyKey] {
        return ErrDuplicate
    }
    f.keys[o.IdempotencyKey] = true
    o.ID = int64(len(f.orders) + 1)
    f.orders[o.ID] = *o
    return nil
}
```

Test vẫn dạng bảng, mỗi dòng là một nhánh của handler:

```go
func TestCreateOrder(t *testing.T) {
    const okBody = `{"user_id": 7, "items": [{"SKU": "A", "Price": 100000, "Quantity": 2}]}`
    tests := []struct {
        name     string
        key      string
        body     string
        storeErr error
        wantCode int
        wantBody string
    }{
        {"tạo thành công", "k1", okBody, nil, http.StatusCreated, `"total":230000`},
        {"thiếu idempotency key", "", okBody, nil, http.StatusBadRequest, "Idempotency-Key"},
        {"body hỏng", "k2", `{"user_id":`, nil, http.StatusBadRequest, "body không hợp lệ"},
        {"giỏ trống", "k3", `{"user_id": 7, "items": []}`, nil, http.StatusUnprocessableEntity, "giỏ hàng trống"},
        {"database lỗi", "k4", okBody, context.DeadlineExceeded, http.StatusInternalServerError, "lỗi hệ thống"},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            s := newFakeStore()
            s.err = tc.storeErr
            req := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(tc.body))
            if tc.key != "" {
                req.Header.Set("Idempotency-Key", tc.key)
            }
            rec := httptest.NewRecorder()
            NewHandler(s).ServeHTTP(rec, req)
            if rec.Code != tc.wantCode {
                t.Fatalf("status = %d, muốn %d, body %s", rec.Code, tc.wantCode, rec.Body)
            }
            if !strings.Contains(rec.Body.String(), tc.wantBody) {
                t.Errorf("body = %s, muốn chứa %q", rec.Body, tc.wantBody)
            }
        })
    }
}
```

(Trong code thật, đoạn tạo request được tách thành hàm `do(t, h, method, path, key, body)` có gọi `t.Helper()`, để khi fail thì Go báo dòng lỗi ở test chứ không ở hàm phụ.)

Điểm quan trọng nhất ở đây là trường hợp **"database lỗi"**. Với database thật, rất khó ép nó trả lỗi đúng lúc cần. Với bản giả, chỉ cần một dòng. Đây là lý do để có test handler riêng: **kiểm tra những nhánh lỗi mà môi trường thật khó tái hiện**. Và chính những nhánh này hay bị viết vội, ví dụ trả về nguyên lỗi database cho người dùng, hoặc trả 200 khi lẽ ra phải là 500.

### Cái bẫy của bản giả

Bản giả tiện, nhưng nó **chỉ đúng tới mức người viết nó hiểu hệ thống thật**. Bản `fakeStore` ở trên kiểm tra trùng key bằng một map có mutex. Nhưng ai đảm bảo PostgreSQL thật cũng hành xử y như vậy khi 20 request cùng key tới đồng thời? Ai đảm bảo câu SQL đúng cú pháp, đúng tên cột? Bản giả không bao giờ bị lỗi `CHECK constraint`. Bản giả không bao giờ chậm.

Test handler với bản giả chứng minh **handler** đúng. Nó không chứng minh gì về **database**. Đó là việc của loại thứ ba.

## Loại 3: Integration test với database thật

Với một backend, phần lớn bug nghiêm trọng nằm ở chỗ gặp database: câu SQL sai, thiếu ràng buộc, xử lý trùng lặp sai khi có đồng thời, transaction không đúng phạm vi. Những lỗi này **chỉ lộ ra khi chạy với database thật**.

### Tách bằng build tag

Integration test chậm hơn và cần database, nên tách riêng bằng **build tag** để `go test ./...` thường ngày vẫn nhanh và không cần gì thêm:

```go
//go:build integration

package shop
```

Hàm phụ dựng database và dọn dẹp sau mỗi test:

```go
func testDB(t *testing.T) *pgxpool.Pool {
    t.Helper()
    url := os.Getenv("TEST_DATABASE_URL")
    if url == "" {
        t.Skip("chưa đặt TEST_DATABASE_URL")
    }
    ctx := context.Background()
    db, err := pgxpool.New(ctx, url)
    if err != nil {
        t.Fatal(err)
    }
    if _, err := db.Exec(ctx, Schema); err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() {
        db.Exec(ctx, `TRUNCATE orders RESTART IDENTITY`)
        db.Close()
    })
    return db
}
```

- **`t.Skip`** khi không có database, thay vì fail, để ai chạy nhầm tag mà không có database cũng không bị chặn.
- **`t.Cleanup`** dọn dữ liệu sau mỗi test, để các test không phụ thuộc vào nhau.
- Database test là một database **riêng** (`shop_test`), không bao giờ là database dev hay database thật.

### Test thứ mà bản giả không chứng minh được

```go
// Ràng buộc UNIQUE chỉ có ở database thật: bản giả không chứng minh được điều này.
func TestPGStoreDuplicateKeyUnderConcurrency(t *testing.T) {
    s := &PGStore{DB: testDB(t)}
    var wg sync.WaitGroup
    var mu sync.Mutex
    created, dup := 0, 0
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            err := s.Create(context.Background(), &Order{IdempotencyKey: "same", UserID: 1, Total: 1})
            mu.Lock()
            defer mu.Unlock()
            switch {
            case err == nil:
                created++
            case errors.Is(err, ErrDuplicate):
                dup++
            default:
                t.Errorf("lỗi không mong đợi: %v", err)
            }
        }()
    }
    wg.Wait()
    if created != 1 || dup != 19 {
        t.Fatalf("20 request cùng key: tạo %d, trùng %d; muốn 1 và 19", created, dup)
    }
}
```

Test này kiểm tra ba thứ cùng lúc: ràng buộc `UNIQUE` thật sự tồn tại trong schema, code dịch đúng mã lỗi PostgreSQL `23505` thành `ErrDuplicate`, và điều đó vẫn đúng khi 20 request tới đồng thời. Nếu ai đó viết lại migration và quên ràng buộc `UNIQUE`, test này fail ngay, trong khi mọi test với bản giả vẫn xanh.

Tương tự, một test kiểm tra `CHECK (total >= 0)` thật sự chặn số âm:

```go
func TestPGStoreRejectsNegativeTotal(t *testing.T) {
    s := &PGStore{DB: testDB(t)}
    err := s.Create(context.Background(), &Order{IdempotencyKey: "neg", UserID: 1, Total: -1})
    if err == nil || !strings.Contains(err.Error(), "orders_total_check") {
        t.Fatalf("muốn lỗi CHECK constraint, nhận %v", err)
    }
}
```

### Một test xuyên suốt cả luồng

Thêm một test đi qua toàn bộ các lớp: HTTP thật (`httptest.NewServer` mở cổng thật), handler, `PGStore`, PostgreSQL thật. Chỉ cần một vài test kiểu này cho các luồng quan trọng nhất, để chắc các mảnh ghép lại với nhau đúng:

```go
func TestCreateOrderEndToEnd(t *testing.T) {
    srv := httptest.NewServer(NewHandler(&PGStore{DB: testDB(t)}))
    defer srv.Close()

    req, _ := http.NewRequest(http.MethodPost, srv.URL+"/orders",
        strings.NewReader(`{"user_id": 7, "items": [{"SKU": "A", "Price": 520000, "Quantity": 1}], "coupon": 10}`))
    req.Header.Set("Idempotency-Key", "e2e-1")
    resp, err := http.DefaultClient.Do(req)
    // ... kiểm tra 201, rồi GET /orders/1 và kiểm tra "total":498000
}
```

### Kết quả

```text
=== RUN   TestPGStoreCreateAndGet
--- PASS: TestPGStoreCreateAndGet (0.03s)
=== RUN   TestPGStoreDuplicateKeyUnderConcurrency
--- PASS: TestPGStoreDuplicateKeyUnderConcurrency (0.02s)
=== RUN   TestPGStoreRejectsNegativeTotal
--- PASS: TestPGStoreRejectsNegativeTotal (0.01s)
=== RUN   TestCreateOrderEndToEnd
--- PASS: TestCreateOrderEndToEnd (0.01s)
PASS
```

Chạy có tag nhưng không có database thì các test được bỏ qua, không fail:

```text
--- SKIP: TestPGStoreCreateAndGet (0.00s)
--- SKIP: TestPGStoreDuplicateKeyUnderConcurrency (0.00s)
--- SKIP: TestPGStoreRejectsNegativeTotal (0.00s)
```

## Chạy và đọc coverage

```bash
# Hằng ngày: nhanh, không cần gì thêm
go test -race -cover ./...

# Trước khi merge, trong CI: thêm integration test với database thật
TEST_DATABASE_URL=postgres://postgres@localhost:5440/shop_test \
  go test -race -tags=integration -cover ./...
```

```text
# chỉ unit + handler test
ok  	shop	1.017s	coverage: 80.6% of statements

# thêm integration test
ok  	shop	1.130s	coverage: 96.8% of statements
```

Phần 16% chênh lệch chính là `store.go`: code nói chuyện với database. Không có integration test thì phần đó **không được test ở đâu cả**, dù con số 80% nghe có vẻ ổn.

Một lời cảnh báo về coverage: nó cho biết dòng nào **đã chạy**, không cho biết dòng đó **có được kiểm tra đúng** hay không. Một test gọi hàm mà không kiểm tra kết quả cũng làm tăng coverage. Dùng coverage để tìm chỗ **chưa có test**, đừng dùng nó làm mục tiêu.

**`-race`** đáng bật cho mọi lần chạy test. Nó làm test chậm hơn, nhưng bắt được những lỗi dữ liệu dùng chung giữa các goroutine mà mắt thường gần như không thấy.

## Đưa vào CI

Một cấu hình CI thường có hai bước: unit và handler test chạy trên mọi commit, integration test chạy với một PostgreSQL dựng riêng (ví dụ service container trong GitHub Actions). Ví dụ:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: shop_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 2s --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.24" }
      - run: go test -race ./...
      - run: go test -race -tags=integration ./...
        env:
          TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/shop_test
```

Phần cấu hình CI này **mình chưa chạy thử** trong GitHub Actions; các lệnh `go test` bên trong thì đã chạy ở local như trên.

## Những thứ khác trong bộ công cụ của Go

- **Fuzz test** (`func FuzzXxx(f *testing.F)`, chạy bằng `go test -fuzz`): Go sinh đầu vào ngẫu nhiên để tìm trường hợp làm code panic hoặc sai. Rất đáng dùng cho parser, decoder, bất kỳ hàm nào nhận dữ liệu từ bên ngoài. Bài này không chạy demo fuzz.
- **Benchmark** (`func BenchmarkXxx(b *testing.B)`, chạy bằng `go test -bench . -benchmem`): đo tốc độ và số lần cấp phát bộ nhớ, dùng trước và sau khi tối ưu.
- **Testcontainers cho Go**: tự dựng database trong Docker cho mỗi lần chạy test, khỏi phải dựng sẵn như trong bài. Tiện nhưng cần Docker trên máy chạy test.

## Những lỗi hay gặp khi viết test

- **Mock tất cả mọi thứ, kể cả database.** Test xanh, coverage cao, nhưng câu SQL chưa từng chạy với database thật lần nào. Như con số 80,6% so với 96,8% ở trên.
- **Test cách làm thay vì kết quả.** Kiểm tra "hàm X được gọi đúng 2 lần với tham số Y" khiến mọi lần refactor đều làm vỡ test, dù hành vi không đổi.
- **Dùng `time.Sleep` để chờ.** Test chậm và lúc pass lúc fail. Chờ bằng channel, `WaitGroup`, hoặc vòng lặp kiểm tra có giới hạn thời gian.
- **Các test phụ thuộc lẫn nhau** qua dữ liệu chung, chạy riêng thì pass, chạy cùng thì fail. Mỗi test tự dựng và tự dọn dữ liệu của mình.
- **Sửa test cho khớp với code** mỗi khi test fail, thay vì tìm hiểu vì sao fail. Đây là lỗi đặc biệt hay gặp khi để AI viết code; mình đã viết về nó trong bài [code review thời AI](/blog/code-review-thoi-ai/).

## Kết

Nếu chỉ được chọn ba loại test cho một Go backend, mình chọn:

1. **Unit test dạng bảng** cho logic nghiệp vụ, đặc biệt ở các ranh giới. Rẻ, nhanh, và bắt được những bug âm thầm làm mất tiền.
2. **Test handler bằng `httptest`** với một interface nhỏ, để kiểm tra mọi nhánh lỗi mà môi trường thật khó tái hiện.
3. **Integration test với database thật**, để chứng minh những thứ mà bản giả không bao giờ chứng minh được: câu SQL, ràng buộc, và hành vi khi có đồng thời.

Ba loại này bổ sung cho nhau: loại đầu nhanh nhưng không chạm I/O, loại hai kiểm tra nhánh lỗi nhưng dựa vào bản giả, loại ba chậm hơn nhưng nói thật về database. Thiếu loại nào, sẽ có một vùng bug mà không test nào nhìn thấy.
