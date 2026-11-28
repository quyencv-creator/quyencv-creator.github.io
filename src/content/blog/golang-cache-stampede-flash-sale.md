---
title: "Cache stampede trong flash sale với Go: 100 sản phẩm cùng hết hạn, làm sao để database không bị dội cùng lúc?"
description: "Nạp cache giá và tồn kho cho 100 sản phẩm flash sale cùng một lúc thì chúng cũng hết hạn cùng một lúc, và hàng nghìn request ập vào database. Đo bằng code Go chạy thật với Redis: cache-aside thông thường, TTL jitter, singleflight, soft TTL kèm làm mới nền có lock, làm mới chủ động cả lô, và vì sao tồn kho không nên cache theo kiểu này."
pubDate: 2026-11-20
tags: [golang, database, backend]
---

Flash sale bắt đầu lúc 12 giờ trưa với 100 sản phẩm. Từ 11 giờ 59, team nạp sẵn giá của cả 100 sản phẩm vào Redis với TTL 60 giây. Mọi thứ chạy ổn trong một phút đầu.

Đúng 12 giờ 01, cả 100 key cùng hết hạn. Lúc đó có 5.000 request đang xem giỏ hàng. Mỗi request thấy cache trống, mỗi request tự đi query database. Database đang chịu tải cao nhất trong ngày bỗng nhận thêm vài nghìn query cùng một giây, chậm lại, request timeout, user bấm tải lại, và vòng lặp bắt đầu.

Hiện tượng này gọi là **cache stampede** (hay thundering herd): nhiều request cùng phát hiện cache hết hạn và cùng lao vào nguồn dữ liệu gốc. Bài này đo trực tiếp vấn đề bằng code Go chạy với Redis thật, rồi đi qua từng cách xử lý.

## Thiết lập để đo

Database được giả lập: mỗi query mất 50ms và có bộ đếm số lần được gọi.

```go
type Product struct {
    ID    int   `json:"id"`
    Price int64 `json:"price"`
}

type DB struct{ queries atomic.Int64 }

func (db *DB) GetProduct(ctx context.Context, id int) (Product, error) {
    db.queries.Add(1)
    time.Sleep(50 * time.Millisecond) // giả lập query 50ms
    return Product{ID: id, Price: int64(100_000 + id)}, nil
}
```

Kịch bản: 5.000 request đồng thời, chia đều cho 100 sản phẩm, đúng lúc cache của cả 100 sản phẩm vừa hết hạn. Đếm xem database bị gọi bao nhiêu lần.

## Cách thông thường: cache-aside với TTL cố định

```go
func (c *NaiveCache) Get(ctx context.Context, id int) (Product, error) {
    key := "naive:product:" + strconv.Itoa(id)
    if b, err := c.rdb.Get(ctx, key).Bytes(); err == nil {
        var p Product
        return p, json.Unmarshal(b, &p)
    }
    p, err := c.db.GetProduct(ctx, id) // miss: ai cũng tự query DB
    if err != nil {
        return p, err
    }
    b, _ := json.Marshal(p)
    c.rdb.Set(ctx, key, b, 60*time.Second) // TTL cố định: cùng nạp thì cùng hết hạn
    return p, nil
}
```

Kết quả:

```text
naive : 4991 query DB, 194ms
```

Gần như **mỗi request là một query**. Cache vô dụng đúng vào lúc cần nó nhất. Lý do: query mất 50ms, và trong 50ms đó, mọi request khác tới cùng key đều thấy cache vẫn trống và cũng tự đi query. Con số dao động quanh 4.950–5.000 qua các lần chạy.

Có hai vấn đề chồng lên nhau ở đây:

1. **Hết hạn đồng loạt**: nạp cùng lúc với cùng TTL thì hết hạn cùng lúc.
2. **Không ai điều phối**: khi cache trống, mọi request cùng tự load.

## Bước 1: TTL jitter, đừng để mọi key hết hạn cùng giây

Cách rẻ nhất: cộng thêm một khoảng ngẫu nhiên vào TTL.

```go
jit := time.Duration(rand.Int63n(int64(10 * time.Second)))
c.rdb.Set(ctx, key, b, 60*time.Second+jit)
```

100 key giờ hết hạn rải rác trong khoảng 60–70 giây, thay vì cùng một giây. Jitter không chặn được stampede trên **một** key nóng, nhưng nó biến một cú dội lớn thành nhiều cú dội nhỏ, và thường là đủ để database không quá tải.

## Bước 2: singleflight, gộp request trùng trong một process

Gói `golang.org/x/sync/singleflight` giải quyết vấn đề thứ hai: khi nhiều goroutine cùng muốn load một key, chỉ một goroutine thật sự chạy, những goroutine khác chờ và dùng chung kết quả.

```go
v, err, _ := c.sf.Do(c.key(id), func() (any, error) {
    return c.load(ctx, id)
})
```

Với cache trống, 5.000 request:

```text
safe (cache trống) : 114 query DB, 114ms
```

Từ gần 5.000 xuống khoảng 100–130 query. Không về đúng 100 vì singleflight chỉ gộp những lời gọi **đang chạy cùng lúc**: một request đọc Redis thấy trống ngay trước khi lần load đầu ghi xong, nhưng tới `sf.Do` sau khi lần load đó đã kết thúc, sẽ load thêm một lần nữa. Con số này dao động qua các lần chạy.

Hai giới hạn quan trọng của singleflight:

- **Chỉ trong một process.** Chạy 10 pod thì mỗi pod vẫn load riêng, tức là tới 10 lần mỗi key.
- **Request vẫn phải chờ database.** Gộp được số query, nhưng không giảm được độ trễ khi cache trống.

## Bước 3: soft TTL, trả bản cũ và làm mới ở nền

Ý tưởng: lưu kèm trong cache một mốc "hết hạn mềm". Quá mốc đó, dữ liệu được coi là cũ nhưng **vẫn được trả về ngay**, đồng thời kích hoạt làm mới ở nền. Redis vẫn giữ key với một TTL dài hơn nhiều (hết hạn cứng), để cache gần như không bao giờ thật sự trống.

```go
type entry struct {
    Product   Product `json:"p"`
    SoftExpAt int64   `json:"exp"` // unix ms: quá mốc này thì "cũ" nhưng vẫn dùng được
}

func (c *SafeCache) Get(ctx context.Context, id int) (Product, error) {
    b, err := c.rdb.Get(ctx, c.key(id)).Bytes()
    if err == nil {
        var e entry
        if err := json.Unmarshal(b, &e); err == nil {
            if c.now().UnixMilli() > e.SoftExpAt {
                c.refreshAsync(id) // cũ: trả ngay bản cũ, làm mới ở nền
            }
            return e.Product, nil
        }
    }
    if !errors.Is(err, redis.Nil) && err != nil {
        return Product{}, err
    }
    // Miss thật (chưa có hoặc đã quá hard TTL): gộp mọi request cùng key thành một lần load.
    v, err, _ := c.sf.Do(c.key(id), func() (any, error) { return c.load(ctx, id) })
    if err != nil {
        return Product{}, err
    }
    return v.(Product), nil
}

func (c *SafeCache) load(ctx context.Context, id int) (Product, error) {
    p, err := c.db.GetProduct(ctx, id)
    if err != nil {
        return p, err
    }
    jit := time.Duration(rand.Int63n(int64(c.jitter)))
    e := entry{Product: p, SoftExpAt: c.now().Add(c.softTTL + jit).UnixMilli()}
    b, _ := json.Marshal(e)
    return p, c.rdb.Set(ctx, c.key(id), b, c.hardTTL+jit).Err()
}
```

Phần làm mới nền cần hai lớp chống trùng: singleflight trong process, và **lock phân tán** trong Redis giữa các instance.

```go
func (c *SafeCache) refreshAsync(id int) {
    go func() {
        // singleflight: trong một process, 5.000 request đọc bản cũ chỉ sinh ra một lần làm mới.
        c.sf.Do("refresh:"+c.key(id), func() (any, error) {
            ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
            defer cancel()
            // Lock phân tán: giữa nhiều instance, chỉ một nơi được làm mới key này.
            // Không xoá lock khi xong, để nó tự hết hạn như dấu "vừa làm mới",
            // tránh request đọc bản cũ ngay trước đó lại lấy lock và load thêm lần nữa.
            ok, err := c.rdb.SetNX(ctx, "lock:"+c.key(id), "1", 5*time.Second).Result()
            if err != nil || !ok {
                return nil, err
            }
            return c.load(ctx, id)
        })
    }()
}
```

Kết quả khi cả 100 sản phẩm cùng vượt soft TTL (mô phỏng bằng cách tua đồng hồ của cache lên 2 phút):

```text
safe (cùng lúc hết soft TTL): 100 query DB, 65ms (request không chờ DB)
```

Đúng một query cho mỗi sản phẩm, và quan trọng hơn: **không request nào phải chờ database**. Mọi request nhận bản cũ ngay lập tức, việc làm mới diễn ra ở nền.

Một chi tiết mình phát hiện khi chạy thử: phiên bản đầu tiên xoá lock ngay sau khi làm mới xong, và kết quả là khoảng 110 query thay vì 100. Lý do: những request đã đọc được bản cũ ngay trước khi bản mới được ghi vẫn kích hoạt làm mới, thấy lock đã được xoá, và load thêm lần nữa. Để lock tự hết hạn sau vài giây thay vì xoá ngay đã giải quyết được việc đó.

Đánh đổi của cách này: người dùng có thể thấy **dữ liệu cũ thêm vài trăm mili giây** sau khi soft TTL hết. Với giá sản phẩm thì thường chấp nhận được. Với tồn kho thì không, phần dưới sẽ nói.

Còn về lock: `SET NX` với TTL ở đây không phải là một lock phân tán chặt chẽ. Trong trường hợp xấu (Redis failover, làm mới chạy lâu hơn TTL của lock), hai instance có thể cùng làm mới. Với cache, hậu quả chỉ là thêm một query, nên chấp nhận được. Đừng dùng nguyên cơ chế này cho những việc mà chạy trùng gây hại.

## Bước 4: làm mới chủ động cả lô

Với flash sale, danh sách sản phẩm biết trước và chỉ có 100 cái. Vậy tại sao phải đợi request kích hoạt làm mới?

Chạy một job nền, cứ mỗi khoảng thời gian thì load **cả 100 sản phẩm trong một query** và ghi vào Redis bằng pipeline:

```go
func (db *DB) GetProducts(ctx context.Context, ids []int) ([]Product, error) {
    // SELECT id, price FROM products WHERE id = ANY($1)
    ...
}

func (c *SafeCache) WarmAll(ctx context.Context, ids []int) error {
    ps, err := c.db.GetProducts(ctx, ids)
    if err != nil {
        return err
    }
    pipe := c.rdb.Pipeline()
    for _, p := range ps {
        jit := time.Duration(rand.Int63n(int64(c.jitter)))
        b, _ := json.Marshal(entry{Product: p, SoftExpAt: c.now().Add(c.softTTL + jit).UnixMilli()})
        pipe.Set(ctx, c.key(p.ID), b, c.hardTTL+jit)
    }
    _, err = pipe.Exec(ctx)
    return err
}
```

```text
warm all: 1 query DB cho 100 sản phẩm
```

Một query thay cho 100. Nếu job này chạy đều đặn với chu kỳ ngắn hơn soft TTL, request gần như không bao giờ thấy dữ liệu cũ, và database chỉ chịu một query mỗi chu kỳ bất kể có bao nhiêu người đang xem.

Trong môi trường nhiều instance, job này cũng cần chạy ở **một chỗ duy nhất** (một cron job riêng, hoặc dùng lock tương tự ở trên để bầu một instance). Xem thêm cách tổ chức job nền trong bài [background job với Go](/blog/golang-background-job/).

Khi giá thay đổi (admin sửa giá giữa flash sale), không cần đợi chu kỳ: ghi vào database xong thì ghi đè luôn key trong cache, hoặc phát một event để job làm mới ngay.

## Tồn kho: đừng cache theo kiểu này

Đến đây có một câu hỏi quan trọng: tồn kho có dùng chung cơ chế trên được không?

**Không.** Giá thì thấy cũ vài giây là chấp nhận được. Tồn kho thì sai một đơn vị cũng là bán quá số hàng đang có. Trong flash sale, tồn kho thay đổi liên tục mỗi giây, và cache-aside (đọc DB, ghi cache, đợi hết hạn) luôn có độ trễ giữa lúc kho thay đổi và lúc cache biết.

Cách phổ biến cho flash sale là **đưa tồn kho vào Redis làm nguồn dữ liệu chính trong suốt sự kiện**, và trừ kho bằng một thao tác nguyên tử:

```go
var reserveScript = redis.NewScript(`
local stock = tonumber(redis.call("GET", KEYS[1]) or "0")
local qty = tonumber(ARGV[1])
if stock < qty then return -1 end
return redis.call("DECRBY", KEYS[1], qty)
`)

func Reserve(ctx context.Context, rdb *redis.Client, productID, qty int) (bool, error) {
    n, err := reserveScript.Run(ctx, rdb, []string{"stock:" + strconv.Itoa(productID)}, qty).Int64()
    if err != nil {
        return false, err
    }
    return n >= 0, nil
}
```

Lua script chạy nguyên tử trong Redis, nên kiểm tra và trừ kho không bị xen giữa. Thử với 100 sản phẩm trong kho và 1.000 người mua cùng lúc:

```text
stock: bán 100, còn 0
```

Đúng 100, không bán quá. Chi tiết hơn về Lua script trong Redis có ở bài [bảng xếp hạng với Redis và Lua](/blog/redis-lua-bang-xep-hang-contest/).

Khi Redis là nguồn chính, database phải được cập nhật lại sau: mỗi lần trừ kho thành công thì ghi một bản ghi vào hàng đợi, và một worker ghi xuống database. Đây là chỗ cần cẩn thận để không mất dữ liệu nếu Redis có sự cố. Mô hình [outbox](/blog/outbox-pattern-golang/) là một cách tiếp cận. Và đừng quên đối soát: cuối sự kiện, so số lượng trong Redis với tổng đơn hàng trong database.

Còn số tồn kho **hiển thị** trên trang sản phẩm ("còn 23 sản phẩm") thì có thể đọc trực tiếp từ key `stock:` trong Redis, không cần thêm tầng cache nào. Con số đó có thể lệch một chút so với lúc user bấm mua, nhưng việc kiểm tra thật sự xảy ra ở `Reserve`, nên không bao giờ bán quá.

## Kết hợp lại

Cho flash sale 100 sản phẩm:

| Dữ liệu | Cách làm |
|---|---|
| Giá, tên, ảnh | Job nền làm mới cả lô trong một query, soft TTL + jitter làm lưới an toàn, singleflight khi cache trống thật |
| Tồn kho | Redis là nguồn chính trong sự kiện, trừ kho bằng Lua script, đồng bộ xuống database qua hàng đợi |
| Giỏ hàng | Lưu ID và số lượng; giá và tồn kho đọc từ hai nguồn trên khi hiển thị, kiểm tra lại khi thanh toán |

Và vài việc nên làm trước giờ mở bán:

- **Nạp sẵn cache** cho cả 100 sản phẩm trước khi mở bán, đừng để request đầu tiên tự nạp.
- **Load test** đúng kịch bản cache hết hạn đồng loạt, không chỉ kịch bản cache đã nóng. Xem bài [load test bằng k6](/blog/k6-load-test-rails-api/) để biết cách dựng kịch bản.
- **Giám sát tỉ lệ cache miss** và số query vào database theo thời gian thực trong lúc flash sale.

## Ghi chú về code

Code trong bài đã chạy với Go 1.24, `github.com/redis/go-redis/v9`, `golang.org/x/sync/singleflight` và Redis chạy local. Database được giả lập bằng `time.Sleep(50ms)` để dễ đo số lần gọi. Các con số query và thời gian dao động nhẹ giữa các lần chạy, nhưng chênh lệch giữa các cách làm thì luôn rõ ràng như trên.
