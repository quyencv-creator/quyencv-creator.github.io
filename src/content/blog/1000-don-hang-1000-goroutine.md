---
title: "1.000 đơn hàng, có nên chạy 1.000 goroutine?"
description: "Một API xử lý 1.000 đơn hàng, mỗi đơn phải gọi một external API. Đo bằng code chạy thật với một API giả lập chỉ chịu được 50 request đồng thời: 1.000 goroutine thẳng tay thì 95% đơn thất bại; worker pool kèm timeout, retry có kiểm soát và context thì xử lý xong cả 1.000. Giới hạn concurrency, backpressure, timeout, huỷ giữa chừng và retry, từng thứ một."
pubDate: 2026-11-28
tags: [golang, backend, concurrency]
---

Bài toán: một API nhận một lô 1.000 đơn hàng. Với mỗi đơn, hệ thống phải gọi sang một dịch vụ bên ngoài, ví dụ lấy phí vận chuyển, tạo vận đơn, hoặc xuất hoá đơn điện tử. Đối tác có giới hạn, đôi khi lỗi, đôi khi chậm.

Viết bằng Go thì phản xạ đầu tiên là: goroutine rẻ, cứ mỗi đơn một goroutine cho nhanh. Bài này kiểm tra phản xạ đó bằng code chạy thật, rồi đi qua từng thứ cần có để xử lý lô đơn này cho đúng: giới hạn concurrency, backpressure, timeout, huỷ bằng context và retry có kiểm soát.

## Dựng một external API "giống thật"

API bên ngoài trong thực tế không phải lúc nào cũng nhanh và ổn định. Mình giả lập một API có những tính chất hay gặp:

- Chỉ chịu được **tối đa 50 request đồng thời**. Quá giới hạn thì trả `429 Too Many Requests` kèm header `Retry-After`.
- **3%** request lỗi `500`.
- **2%** request chậm bất thường, mất **2 giây**.
- Còn lại mất **40 đến 80ms**.

```go
func NewFakeAPI(limit int64) *FakeAPI {
    f := &FakeAPI{}
    f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := f.inflight.Add(1)
        defer f.inflight.Add(-1)
        // ... ghi lại đỉnh số request đồng thời
        if n > limit {
            w.Header().Set("Retry-After", "1")
            http.Error(w, "too many requests", http.StatusTooManyRequests)
            return
        }
        p := rand.Float64()
        switch {
        case p < 0.03:
            http.Error(w, "boom", http.StatusInternalServerError)
            return
        case p < 0.05:
            select {
            case <-time.After(2 * time.Second):
            case <-r.Context().Done():
                return
            }
        default:
            time.Sleep(time.Duration(40+rand.IntN(40)) * time.Millisecond)
        }
        w.Write([]byte(`{"ok":true}`))
    }))
    return f
}
```

Giới hạn 50 là con số giả định cho demo. Mỗi nhà cung cấp có giới hạn riêng, thường ghi trong tài liệu API (rate limit theo giây, theo phút, hoặc số kết nối đồng thời).

## Cách 1: 1.000 goroutine cùng lúc

Cách đầu tiên ai cũng nghĩ tới, vì goroutine rẻ:

```go
func runNaive(url string, orders []int) (ok, failed int) {
    var wg sync.WaitGroup
    var mu sync.Mutex
    for _, id := range orders {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            resp, err := http.Get(fmt.Sprintf("%s/orders/%d", url, id))
            mu.Lock()
            defer mu.Unlock()
            if err != nil || resp.StatusCode != http.StatusOK {
                failed++
            } else {
                ok++
            }
            if resp != nil {
                resp.Body.Close()
            }
        }(id)
    }
    wg.Wait()
    return
}
```

Kết quả (hai lần chạy):

```text
[1.000 goroutine] 2.097s | thành công 50, thất bại 950 | API: 1000 request, 947 bị từ chối (429), đỉnh 53 request đồng thời
[1.000 goroutine] 208ms  | thành công 71, thất bại 929 | API: 1000 request, 927 bị từ chối (429), đỉnh 52 request đồng thời
```

**Hơn 90% đơn hàng thất bại.** Goroutine đúng là rẻ, nhưng thứ bị giới hạn không phải goroutine của bạn, mà là **hệ thống ở đầu bên kia**. 1.000 request ập tới cùng lúc, API chỉ nhận 50, phần còn lại bị từ chối ngay.

Để ý thêm hai chi tiết:

- Lần chạy đầu mất **2,1 giây** vì vài request rơi vào trường hợp chậm 2 giây, và không có timeout nên chương trình cứ thế đợi. Lần thứ hai không gặp request chậm nào nên chỉ mất 208ms. Không có timeout nghĩa là thời gian xử lý của bạn phụ thuộc hoàn toàn vào request chậm nhất của người khác.
- Không có retry, nên lỗi tạm thời (429, 500) cũng thành lỗi vĩnh viễn với khách hàng.

Trong thực tế còn tệ hơn demo: API của đối tác có thể không lịch sự trả 429 mà bị quá tải và chậm đi cho **mọi** khách hàng của họ, kể cả bạn. Một số đối tác sẽ chặn IP của bạn. Còn phía bạn, 1.000 kết nối mở cùng lúc tốn file descriptor, bộ nhớ, và có thể chạm giới hạn của hệ điều hành hoặc của proxy ở giữa.

## Cách 2: worker pool, giới hạn concurrency

Thay vì một goroutine mỗi đơn, dùng **một số worker cố định** cùng đọc việc từ một channel:

```go
func RunPool(ctx context.Context, c *Client, orders []int, workers int) []Result {
    jobs := make(chan int, workers) // hàng đợi nhỏ: producer phải chờ khi worker bận
    results := make(chan Result, workers)

    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for id := range jobs {
                results <- c.Process(ctx, id)
            }
        }()
    }

    go func() {
        defer close(jobs)
        for _, id := range orders {
            select {
            case jobs <- id: // block khi hàng đợi đầy: đó chính là backpressure
            case <-ctx.Done():
                return // bị huỷ: ngừng phát việc mới
            }
        }
    }()
    go func() { wg.Wait(); close(results) }()

    var out []Result
    for r := range results {
        out = append(out, r)
    }
    return out
}
```

Ba ý nằm trong đoạn code này:

**Giới hạn concurrency.** Tại mọi thời điểm chỉ có tối đa `workers` request đang chạy. Con số này phải nhỏ hơn giới hạn của đối tác, và nên chừa khoảng trống: nếu có nhiều instance cùng gọi một API, giới hạn phải chia cho số instance.

**Backpressure.** Channel `jobs` có sức chứa nhỏ. Khi worker bận, producer bị chặn ở dòng `jobs <- id` cho tới khi có chỗ trống. Hệ thống tự điều tiết theo tốc độ xử lý, thay vì dồn 1.000 việc vào bộ nhớ hay vào mạng. Nếu nguồn việc là một hàng đợi (Kafka, RabbitMQ, bảng job), backpressure nghĩa là đọc chậm lại, không phải đọc hết rồi chất đống.

**Đóng channel đúng chỗ.** Chỉ producer đóng `jobs`. Một goroutine riêng đợi mọi worker xong rồi mới đóng `results`. Xem lại luật "chỉ bên gửi được close" trong bài [những thứ khó hiểu trong Go phần 1](/blog/go-kho-hieu-make-defer-channel/).

## Timeout, retry có kiểm soát, và context

Mỗi đơn được xử lý bằng `Process`, với ba lớp bảo vệ.

### Timeout cho từng lần gọi

```go
func (c *Client) callOnce(ctx context.Context, id int) error {
    ctx, cancel := context.WithTimeout(ctx, c.Timeout) // 500ms mỗi lần gọi
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/orders/%d", c.BaseURL, id), nil)
    resp, err := c.HTTP.Do(req)
    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            return errRetryable{err: fmt.Errorf("timeout sau %v", c.Timeout)}
        }
        return errRetryable{err: err}
    }
    defer resp.Body.Close()
    io.Copy(io.Discard, resp.Body) // đọc hết body để kết nối được dùng lại
    switch {
    case resp.StatusCode == http.StatusOK:
        return nil
    case resp.StatusCode == http.StatusTooManyRequests:
        ra, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
        return errRetryable{err: errors.New("429"), retryAfter: time.Duration(ra) * time.Second}
    case resp.StatusCode >= 500:
        return errRetryable{err: fmt.Errorf("%d", resp.StatusCode)}
    default:
        return fmt.Errorf("lỗi không thử lại: %d", resp.StatusCode)
    }
}
```

Timeout gắn vào **context của request**, không chỉ là `http.Client.Timeout`. Nhờ vậy, khi context cha bị huỷ (người dùng đóng trình duyệt, cả lô bị huỷ), request đang chạy cũng dừng theo. Xem thêm về [context trong Go](/blog/context-trong-go/).

Một chi tiết nhỏ hay bị quên: đọc hết body trước khi đóng (`io.Copy(io.Discard, ...)`), để Go có thể dùng lại kết nối cũ thay vì mở kết nối mới cho mỗi request.

### Retry có kiểm soát

```go
func (c *Client) Process(ctx context.Context, id int) Result {
    backoff := 100 * time.Millisecond
    for attempt := 1; ; attempt++ {
        err := c.callOnce(ctx, id)
        var re errRetryable
        if err == nil || !errors.As(err, &re) || attempt == c.MaxAttempts {
            return Result{OrderID: id, Attempts: attempt, Err: err}
        }
        wait := backoff + time.Duration(rand.Int64N(int64(backoff))) // jitter
        if re.retryAfter > wait {
            wait = re.retryAfter
        }
        select {
        case <-time.After(wait):
        case <-ctx.Done():
            return Result{OrderID: id, Attempts: attempt, Err: ctx.Err()}
        }
        backoff *= 2
    }
}
```

"Có kiểm soát" nghĩa là:

- **Chỉ retry lỗi tạm thời:** 429, 5xx, timeout. Lỗi `400 Bad Request` thì thử lại bao nhiêu lần cũng vậy.
- **Có giới hạn số lần** (`MaxAttempts = 3`). Retry vô hạn biến một sự cố ngắn của đối tác thành một cơn bão request kéo dài, đúng kiểu vòng khuếch đại mình đã viết trong bài [tư duy hệ thống](/blog/tu-duy-he-thong-thoi-ai/).
- **Backoff luỹ thừa** (100ms, 200ms, 400ms…) để cho đối tác thời gian hồi phục.
- **Jitter**: cộng thêm một khoảng ngẫu nhiên, để các worker không cùng thử lại đúng một thời điểm. Cùng ý tưởng với TTL jitter trong bài [cache stampede](/blog/golang-cache-stampede-flash-sale/).
- **Tôn trọng `Retry-After`** khi đối tác nói rõ phải đợi bao lâu.
- **Dừng ngay khi context bị huỷ**, kể cả khi đang đợi giữa hai lần thử.

**Cảnh báo quan trọng:** chỉ retry thao tác **idempotent**, tức là gọi nhiều lần cũng cho kết quả như gọi một lần. Đọc trạng thái đơn hàng thì an toàn. Gọi "trừ tiền" mà timeout rồi gọi lại có thể trừ tiền hai lần. Với thao tác ghi, cần gửi kèm **idempotency key** để đối tác nhận ra request trùng. Nếu đối tác không hỗ trợ, đừng tự động retry.

### Kết quả

```text
[pool 20 worker] 4.478s | thành công 1000, thất bại 0, 49 đơn phải retry | API: 1051 request, 0 bị từ chối, đỉnh 20 đồng thời
[pool 40 worker] 2.493s | thành công 1000, thất bại 0, 51 đơn phải retry | API: 1052 request, 0 bị từ chối, đỉnh 40 đồng thời
```

Lần chạy thứ hai:

```text
[pool 20 worker] 4.746s | thành công 999, thất bại 1, 62 đơn phải retry | API: 1063 request, 0 bị từ chối, đỉnh 20 đồng thời
[pool 40 worker] 2.354s | thành công 1000, thất bại 0, 44 đơn phải retry | API: 1044 request, 0 bị từ chối, đỉnh 40 đồng thời
```

So với cách 1:

| | 1.000 goroutine | Pool 20 worker | Pool 40 worker |
|---|---|---|---|
| Đơn thành công | 50 – 71 | 999 – 1.000 | 1.000 |
| Bị đối tác từ chối (429) | 927 – 947 | 0 | 0 |
| Đỉnh request đồng thời | 52 – 53 | 20 | 40 |
| Thời gian | 0,2 – 2,1 s | khoảng 4,5 s | khoảng 2,4 s |

Vài điều đáng để ý:

- **Chậm hơn nhưng đúng.** Pool 20 worker mất khoảng 4,5 giây thay vì 0,2 giây, nhưng xử lý xong gần như toàn bộ đơn. Nhanh mà sai thì không có giá trị.
- **Tăng worker thì nhanh hơn, cho tới khi chạm giới hạn của đối tác.** 40 worker nhanh gần gấp đôi 20 worker mà vẫn không bị từ chối, vì 40 vẫn dưới 50. Nếu tăng lên 60, sẽ bắt đầu dính 429 trở lại. Số worker tối ưu phụ thuộc giới hạn của **đối tác**, không phải sức mạnh máy của bạn.
- **Khoảng 50 đơn phải retry,** khớp với 5% request lỗi hoặc chậm mà API giả lập sinh ra. Retry đã cứu chúng.
- **Lần chạy thứ hai có 1 đơn thất bại** sau 3 lần thử. Retry có giới hạn nghĩa là sẽ có lúc vẫn thất bại, và điều đó là **đúng**: đơn đó cần được ghi lại và xử lý sau (đưa vào hàng đợi thử lại, báo cho người vận hành), chứ không phải thử mãi.

## Cách viết gọn hơn: `errgroup.SetLimit`

Khi không cần tách riêng producer và consumer, gói `golang.org/x/sync/errgroup` cho cách viết gọn hơn nhiều:

```go
func RunErrgroup(ctx context.Context, c *Client, orders []int, limit int) []Result {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(limit) // g.Go sẽ chặn khi đã có đủ `limit` goroutine đang chạy
    var mu sync.Mutex
    out := make([]Result, 0, len(orders))
    for _, id := range orders {
        g.Go(func() error {
            r := c.Process(ctx, id)
            mu.Lock()
            out = append(out, r)
            mu.Unlock()
            return nil // lỗi từng đơn ghi vào Result, không huỷ cả lô
        })
    }
    g.Wait()
    return out
}
```

```text
[errgroup limit 40] 2.516s | thành công 1000, thất bại 0, 48 đơn phải retry | API: 1049 request, 0 bị từ chối, đỉnh 39 đồng thời
```

`SetLimit` vừa giới hạn concurrency, vừa tạo backpressure (vòng `for` bị chặn ở `g.Go` khi đủ goroutine). Lưu ý: nếu hàm trong `g.Go` trả về lỗi, `errgroup` sẽ **huỷ context của cả nhóm**. Ở đây mình muốn một đơn lỗi không làm hỏng cả lô, nên trả về `nil` và ghi lỗi vào `Result`. Nếu nghiệp vụ là "một đơn lỗi thì dừng tất cả", hãy trả về lỗi.

Còn một lựa chọn khác là semaphore: một channel có buffer làm "vé", lấy vé trước khi gọi, trả vé sau khi xong. `errgroup.SetLimit` thực chất làm đúng việc đó cho bạn.

## Huỷ giữa chừng bằng context

Người dùng huỷ request, hệ thống đang tắt để deploy, hoặc cả lô có hạn chót. Chạy cùng pool 20 worker, nhưng đặt hạn chót 1 giây cho cả lô:

```go
ctx, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()
rs := RunPool(ctx, c, orders(N), 20)
```

```text
[huỷ sau 1s] dừng sau 1.001s | xử lý xong 229, thất bại 0, dừng giữa chừng 40, chưa bắt đầu 731
```

Chương trình dừng đúng sau 1 giây. 229 đơn đã xong, 40 đơn bị dừng giữa chừng (20 đơn đang chạy trên 20 worker, cộng 20 đơn đã nằm trong hàng đợi có sức chứa 20), và 731 đơn **chưa bao giờ được bắt đầu**, vì producer ngừng phát việc ngay khi context bị huỷ.

Không có context, chương trình sẽ cố gọi hết 1.000 đơn dù kết quả không còn ai cần, tốn tài nguyên của bạn lẫn của đối tác. Và quan trọng: **phải biết chính xác đơn nào đã xử lý, đơn nào chưa**, để lần chạy sau tiếp tục từ đúng chỗ.

## Checklist khi gọi external API hàng loạt

1. **Không chạy 1.000 goroutine thẳng tay.** Goroutine rẻ, nhưng đối tác thì có giới hạn, và kết nối mạng của mình cũng vậy.
2. **Giới hạn concurrency** bằng worker pool hoặc `errgroup.SetLimit`, với con số dựa trên giới hạn của đối tác chia cho số instance.
3. **Backpressure:** hàng đợi có giới hạn, để producer chậm lại khi worker bận, thay vì dồn hết vào bộ nhớ.
4. **Timeout cho từng lần gọi,** gắn vào context, để một request chậm không giữ worker mãi.
5. **Context để huỷ** cả lô khi người dùng huỷ hoặc hệ thống tắt.
6. **Retry có kiểm soát:** chỉ lỗi tạm thời, có giới hạn lần, backoff có jitter, tôn trọng `Retry-After`, và chỉ với thao tác idempotent.
7. **Xử lý đơn thất bại sau cùng:** ghi lại, đưa vào hàng đợi thử lại, có metric và cảnh báo.

Một bước nữa nên cân nhắc: với 1.000 đơn trong một request HTTP, người dùng phải đợi vài giây, và request có thể bị cắt giữa chừng bởi proxy hoặc load balancer. Thường nên trả về ngay "đã nhận", rồi xử lý ở **job nền** và cho người dùng theo dõi tiến độ. Mình viết về cách tổ chức job nền trong bài [background job trong Go](/blog/golang-background-job/).

## Ghi chú về code

Toàn bộ code trong bài đã chạy thật với Go 1.24 và `golang.org/x/sync` v0.25.0. External API là một server `httptest` chạy local, với giới hạn và tỉ lệ lỗi do mình đặt ra cho demo, nên con số thời gian và số đơn phải retry dao động giữa các lần chạy. Chênh lệch giữa các cách làm thì ổn định qua các lần chạy.
