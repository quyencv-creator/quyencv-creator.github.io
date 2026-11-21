---
title: "Cache invalidation và cache expire: thiết kế cache cho flash sale khi giá thay đổi"
description: "Phân biệt expire và invalidate qua bài toán flash sale: chỗ nào đọc nhiều nhất, đặt cache ở tầng nào, invalidate giá ra sao cho đúng và không sập DB. Code Go."
pubDate: 2026-11-21
tags: [golang, cache, redis, backend]
---

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

Flash sale là chỗ câu nói này đau nhất: **lượng đọc tăng gấp 100 lần trong vài giây**, và **giá đổi đúng lúc đó** (00:00 giá về 99k, 00:15 hết suất thì về lại 199k). Cache sai thì một trong hai chuyện xảy ra:

- Cache giữ giá cũ: khách thấy 199k trong khi đã sale, hoặc tệ hơn là thấy 99k sau khi sale đã hết.
- Cache bị xoá quá mạnh: 200.000 request cùng lúc đập vào DB, DB sập, sale sập.

Bài này đi qua: expire và invalidate khác nhau thế nào, trong flash sale chỗ nào đọc nhiều nhất, đặt cache ở đâu, và chọn kiểu invalidate nào cho từng loại dữ liệu. Toàn bộ code dùng Go và Redis.

## 1. Expire và invalidate: hai câu hỏi khác nhau

| | Cache expire (TTL) | Cache invalidation |
|---|---|---|
| Ai quyết định cache hết hạn | **Thời gian** | **Sự kiện** (dữ liệu nguồn vừa đổi) |
| Câu hỏi trả lời | "Tôi chấp nhận dữ liệu cũ tối đa bao lâu?" | "Dữ liệu vừa đổi, ai đang giữ bản cũ?" |
| Ưu điểm | Đơn giản, tự lành, không cần biết ai ghi | Dữ liệu mới gần như ngay lập tức |
| Nhược điểm | Cũ tối đa bằng TTL; TTL ngắn thì DB chịu tải | Phức tạp, dễ sót, có race condition |
| Hợp với | Dữ liệu chấp nhận cũ vài giây/phút | Dữ liệu phải đúng (giá, tồn kho, quyền) |

Hai cách **không loại trừ nhau**. Hệ thống tốt dùng cả hai: invalidate để đúng nhanh, TTL làm **lưới an toàn** khi invalidate bị sót (message mất, deploy lỗi, bug). Quy tắc: **không bao giờ đặt key cache không có TTL**.

## 2. Flash sale: chỗ nào đọc nhiều nhất?

Giả sử sale 1.000 suất iPhone giá 99k lúc 00:00. Đếm request trong 5 phút đầu:

| Dữ liệu | Ai đọc | Tỉ lệ đọc/ghi | Đổi khi nào | Chấp nhận cũ? |
|---|---|---|---|---|
| **Thông tin sản phẩm** (tên, ảnh, mô tả) | Mọi người, mọi lần F5 | ~10⁶ : 0 | Gần như không | Vài phút, OK |
| **Giá sale + thời gian sale** | Mọi người, mọi lần F5 | ~10⁶ : vài lần | Đúng mốc giờ, hoặc admin sửa | **Vài giây là tối đa** |
| **Tồn kho còn lại** ("còn 37 suất") | Mọi người | ~10⁵ : 10³ | Mỗi đơn hàng | Hiển thị cũ 1–2s OK, **trừ kho thì không** |
| **Đơn hàng / thanh toán** | Chỉ người mua | ~1 : 1 | Liên tục | Không cache |

Kết luận:

1. **Trang chi tiết sản phẩm + giá** là chỗ đọc nhiều nhất, tỉ lệ đọc/ghi khổng lồ. Đây là chỗ đầu tư cache nhiều nhất.
2. **Giá** là dữ liệu vừa nóng vừa phải đúng, nên là trọng tâm của thuật toán invalidate.
3. **Tồn kho** cache để hiển thị, nhưng việc **trừ kho** phải làm atomic ở một chỗ (Redis `DECR` / Lua), không đọc từ cache rồi trừ.
4. **Đơn hàng** không cache.

Sai lầm phổ biến là cache cả cục "product + price + stock" chung một key. Giá đổi thì phải xoá cả cục, stock đổi mỗi đơn thì cache gần như vô dụng. **Tách key theo tốc độ thay đổi.**

```
product:{id}        -> tên, ảnh, mô tả         TTL 10 phút
price:{id}          -> giá, sale_start, sale_end, version   TTL 30s + invalidate
stock:{id}          -> số còn lại (nguồn sự thật cho trừ kho trong sale)
```

## 3. Đặt cache ở tầng nào?

```
Client ── CDN ── API Gateway ── Product Service ──┬── L1: in-memory (mỗi pod)
                                                  ├── L2: Redis
                                                  └── DB (MySQL/Postgres)
```

| Tầng | Cache gì | Lý do |
|---|---|---|
| **CDN** | Ảnh, JS, HTML tĩnh, `product` | Không cache **giá** ở CDN: purge CDN chậm (giây đến phút) và khó đảm bảo mọi edge đều purge |
| **L1 in-memory** (mỗi pod) | `product`, `price` với TTL rất ngắn (1–2s) | Chặn hot key: 1 sản phẩm × 200k rps sẽ dồn hết vào **một** node Redis. L1 biến 200k rps thành (số pod × 1 req/s) |
| **L2 Redis** | `product`, `price`, `stock` | Nguồn chung cho mọi pod, nơi invalidate tập trung |
| **DB** | Nguồn sự thật | Chỉ nhận cache miss, được bảo vệ bởi singleflight |

**Thuật toán cache nằm ở Product Service**, trong một lớp `PriceCache` bọc L1 + L2 + DB. Không rải logic cache khắp handler. Lý do: chỉ có một chỗ biết thứ tự đọc, khi nào ghi lại, khi nào xoá.

## 4. Các chiến lược invalidate, chọn cái nào?

| Chiến lược | Cách làm | Vấn đề |
|---|---|---|
| Chỉ TTL | Chờ hết hạn | Giá cũ tối đa bằng TTL. TTL 5 phút là thảm hoạ trong sale |
| Update cache khi ghi (write-through: ghi DB rồi `SET` cache) | Ghi giá mới vào cache | **Race**: 2 admin sửa cùng lúc, thứ tự ghi DB và ghi cache có thể ngược nhau, cache giữ giá sai **vĩnh viễn đến hết TTL** |
| **Delete khi ghi (cache-aside)** | Ghi DB, rồi `DEL` cache, lần đọc sau tự nạp | Còn một race nhỏ (đọc cũ ghi đè sau DEL), xử lý bằng version hoặc delayed double delete |
| **Pre-scheduled** (biết trước mốc giờ) | Đưa cả `sale_start`/`sale_end` vào cache, **tính giá lúc đọc** | Không cần invalidate tại mốc giờ |

Với flash sale, kết hợp ba ý:

1. **Giá theo lịch không cần invalidate.** Cache lưu `{base_price, sale_price, sale_start, sale_end}`, giá hiển thị tính ở runtime bằng `time.Now()`. Đến 00:00 mọi pod tự đổi giá cùng lúc, không ai phải xoá key nào, không có thundering herd tại đúng giây sale bắt đầu.
2. **Admin sửa giá đột xuất**: ghi DB → `DEL` Redis → publish sự kiện để các pod xoá L1. Kèm `version` để chống ghi đè bản cũ.
3. **TTL ngắn làm lưới an toàn**: Redis 30s (có jitter), L1 1–2s.

Đây là ý quan trọng nhất của bài: **thay vì invalidate đúng giây, hãy cache dữ liệu có chứa thời điểm thay đổi.** Biến bài toán invalidate thành phép tính.

## 5. Code Go

### 5.1 Model: giá tính tại thời điểm đọc

```go
package price

import "time"

type Price struct {
	ProductID string    `json:"product_id"`
	BasePrice int64     `json:"base_price"` // đơn vị: đồng
	SalePrice int64     `json:"sale_price"`
	SaleStart time.Time `json:"sale_start"`
	SaleEnd   time.Time `json:"sale_end"`
	Version   int64     `json:"version"` // tăng mỗi lần admin sửa
}

// Effective trả giá đúng tại thời điểm now.
// Cache có cũ vài giây cũng không sai mốc giờ sale.
func (p Price) Effective(now time.Time) int64 {
	if p.SalePrice > 0 && !now.Before(p.SaleStart) && now.Before(p.SaleEnd) {
		return p.SalePrice
	}
	return p.BasePrice
}
```

Ghi chú: thời gian của các pod phải đồng bộ NTP. Lệch 2 giây thì pod này đã sale, pod kia chưa; chấp nhận được, nhưng nên biết.

### 5.2 L1 in-memory với TTL ngắn

```go
package price

import (
	"sync"
	"time"
)

type l1Entry struct {
	p       Price
	expires time.Time
}

type L1 struct {
	mu  sync.RWMutex
	m   map[string]l1Entry
	ttl time.Duration
}

func NewL1(ttl time.Duration) *L1 {
	return &L1{m: make(map[string]l1Entry), ttl: ttl}
}

func (c *L1) Get(id string) (Price, bool) {
	c.mu.RLock()
	e, ok := c.m[id]
	c.mu.RUnlock()
	if !ok || time.Now().After(e.expires) {
		return Price{}, false
	}
	return e.p, true
}

func (c *L1) Set(p Price) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Không cho bản cũ hơn ghi đè bản mới hơn.
	if cur, ok := c.m[p.ProductID]; ok && cur.p.Version > p.Version {
		return
	}
	c.m[p.ProductID] = l1Entry{p: p, expires: time.Now().Add(c.ttl)}
}

func (c *L1) Delete(id string) {
	c.mu.Lock()
	delete(c.m, id)
	c.mu.Unlock()
}
```

Production thì dùng thư viện có giới hạn kích thước (ristretto, otter). Map ở đây để dễ đọc.

### 5.3 PriceCache: L1 → Redis → DB, chặn stampede bằng singleflight

```go
package price

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

type Repo interface {
	GetPrice(ctx context.Context, id string) (Price, error)
	UpdatePrice(ctx context.Context, p Price) (Price, error) // trả về bản đã tăng version
}

type Cache struct {
	l1    *L1
	rdb   *redis.Client
	repo  Repo
	group singleflight.Group
	ttl   time.Duration
}

func NewCache(rdb *redis.Client, repo Repo) *Cache {
	return &Cache{
		l1:   NewL1(2 * time.Second),
		rdb:  rdb,
		repo: repo,
		ttl:  30 * time.Second,
	}
}

func key(id string) string { return "price:" + id }

// jitter tránh việc hàng nghìn key cùng hết hạn một lúc.
func (c *Cache) ttlWithJitter() time.Duration {
	return c.ttl + time.Duration(rand.Int63n(int64(c.ttl/5)))
}

func (c *Cache) Get(ctx context.Context, id string) (Price, error) {
	if p, ok := c.l1.Get(id); ok {
		return p, nil
	}

	// singleflight: 10.000 goroutine cùng miss một key trên pod này
	// thì chỉ 1 goroutine xuống Redis/DB, số còn lại chờ kết quả.
	v, err, _ := c.group.Do(id, func() (any, error) {
		raw, err := c.rdb.Get(ctx, key(id)).Bytes()
		if err == nil {
			var p Price
			if jerr := json.Unmarshal(raw, &p); jerr == nil {
				return p, nil
			}
		} else if !errors.Is(err, redis.Nil) {
			// Redis lỗi: vẫn đọc DB, nhưng đã có singleflight che chắn.
		}

		p, err := c.repo.GetPrice(ctx, id)
		if err != nil {
			return Price{}, err
		}
		c.setRedisIfNewer(ctx, p)
		return p, nil
	})
	if err != nil {
		return Price{}, err
	}
	p := v.(Price)
	c.l1.Set(p)
	return p, nil
}
```

### 5.4 Ghi lại Redis có kiểm tra version

Race kinh điển của cache-aside:

```
T1 (đọc):  miss → đọc DB được v1 ............................. SET cache = v1  ← ghi đè!
T2 (ghi):                 UPDATE DB = v2 → DEL cache
```

T1 đọc DB trước khi T2 ghi, nhưng `SET` sau khi T2 đã `DEL`. Kết quả: cache giữ v1 đến hết TTL. Trong flash sale, 30 giây giá sai là đủ lên báo.

Sửa bằng Lua: chỉ `SET` khi version mới **lớn hơn hẳn** version đang có, và để lại một "tombstone" ghi version khi xoá.

```go
// KEYS[1] = price:{id}, KEYS[2] = price:{id}:ver
// ARGV[1] = version, ARGV[2] = json, ARGV[3] = ttl ms
var setIfNewer = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[2]) or '-1')
if tonumber(ARGV[1]) < cur then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3] * 10)
return 1
`)

func (c *Cache) setRedisIfNewer(ctx context.Context, p Price) {
	b, _ := json.Marshal(p)
	_ = setIfNewer.Run(ctx, c.rdb,
		[]string{key(p.ProductID), key(p.ProductID) + ":ver"},
		p.Version, b, c.ttlWithJitter().Milliseconds(),
	).Err()
}
```

Key `:ver` sống lâu hơn key dữ liệu (×10 TTL), nên sau khi `DEL` dữ liệu, nó vẫn nhớ "version mới nhất là v2", và bản v1 đến muộn sẽ bị từ chối.

### 5.5 Admin sửa giá: ghi DB → bump version → DEL → broadcast

```go
const invalidateChannel = "price:invalidate"

func (c *Cache) Update(ctx context.Context, p Price) error {
	// 1. Ghi DB trước. DB là nguồn sự thật.
	//    UPDATE prices SET ..., version = version + 1 WHERE product_id = ? RETURNING *
	saved, err := c.repo.UpdatePrice(ctx, p)
	if err != nil {
		return err
	}

	// 2. Ghi version mới vào tombstone và xoá dữ liệu Redis trong một lần.
	pipe := c.rdb.TxPipeline()
	pipe.Set(ctx, key(saved.ProductID)+":ver", saved.Version, c.ttl*10)
	pipe.Del(ctx, key(saved.ProductID))
	if _, err := pipe.Exec(ctx); err != nil {
		// Không rollback DB. TTL 30s là lưới an toàn; log + retry qua outbox.
		return err
	}

	// 3. Báo mọi pod xoá L1.
	return c.rdb.Publish(ctx, invalidateChannel, saved.ProductID).Err()
}

// Mỗi pod chạy một goroutine lắng nghe.
func (c *Cache) ListenInvalidations(ctx context.Context) {
	sub := c.rdb.Subscribe(ctx, invalidateChannel)
	defer sub.Close()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-sub.Channel():
			if !ok {
				return
			}
			c.l1.Delete(msg.Payload)
		}
	}
}
```

Vì sao **xoá** chứ không **ghi giá mới** vào cache? Xoá là idempotent và không phụ thuộc thứ tự: hai lần xoá vẫn là xoá. Ghi đè thì phụ thuộc ai ghi sau. Lần đọc tiếp theo sẽ nạp bản đúng từ DB, có singleflight lo phần tải.

Redis Pub/Sub là **fire-and-forget**: pod đang restart sẽ lỡ message. Không sao, L1 TTL chỉ 2 giây. Đây là lý do L1 phải có TTL ngắn: nó là lưới an toàn cho kênh invalidate không đảm bảo.

Nếu bước 2 hoặc 3 có thể bị bỏ qua (process chết giữa chừng sau khi ghi DB), cách chắc chắn hơn là **outbox / CDC**: ghi sự kiện `price_changed` cùng transaction với DB, một worker (hoặc Debezium đọc binlog) xoá cache. Khi đó invalidate được đảm bảo "ít nhất một lần".

### 5.6 Handler

```go
func (h *Handler) GetProductPrice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := h.prices.Get(r.Context(), id)
	if err != nil {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	now := time.Now()
	writeJSON(w, map[string]any{
		"product_id": id,
		"price":      p.Effective(now),
		"on_sale":    p.Effective(now) == p.SalePrice && p.SalePrice > 0,
		"sale_end":   p.SaleEnd,
	})
}
```

## 6. Tồn kho: cache khác hẳn giá

Giá là đọc nhiều ghi ít. Tồn kho trong sale là **ghi liên tục**, cache-aside không hợp. Cách làm phổ biến:

- Trước sale: nạp `stock:{id} = 1000` vào Redis. Trong lúc sale, **Redis là nguồn sự thật cho trừ kho**.
- Trừ kho atomic bằng Lua, không bao giờ `GET` rồi `SET`:

```go
var reserve = redis.NewScript(`
local left = tonumber(redis.call('GET', KEYS[1]) or '0')
if left < tonumber(ARGV[1]) then return -1 end
return redis.call('DECRBY', KEYS[1], ARGV[1])
`)

func (s *Stock) Reserve(ctx context.Context, id string, qty int) (bool, error) {
	n, err := reserve.Run(ctx, s.rdb, []string{"stock:" + id}, qty).Int64()
	if err != nil {
		return false, err
	}
	return n >= 0, nil // sau đó đẩy đơn vào queue để ghi DB bất đồng bộ
}
```

- Con số "còn 37 suất" trên trang: đọc `stock:{id}` qua L1 TTL 1s. Lệch 1 giây không ai để ý, nhưng không pod nào cần hỏi Redis 200k lần/giây.

## 7. Checklist

- **Tách key theo tốc độ thay đổi**: product, price, stock là ba key khác nhau.
- **Mọi key đều có TTL**, kèm jitter. Invalidate để đúng, TTL để tự lành.
- **Giá theo lịch**: cache cả `sale_start`/`sale_end`, tính giá ở runtime. Không invalidate đúng giây.
- **Giá sửa đột xuất**: ghi DB → `DEL` (không `SET`) → broadcast xoá L1. Có version để chặn bản cũ ghi đè.
- **Hot key**: L1 in-memory TTL 1–2s trước Redis.
- **Stampede**: singleflight trong mỗi pod; nếu nhiều pod cùng miss, cân nhắc thêm lock ngắn trên Redis hoặc pre-warm trước giờ sale.
- **Pre-warm**: 5 phút trước sale, chạy job nạp `product`, `price`, `stock` của toàn bộ sản phẩm sale vào Redis.
- **Không cache giá ở CDN.** Ảnh và mô tả thì thoải mái.
- **Trừ kho không đọc cache**: atomic ở Redis, ghi DB qua queue.
- **Invalidate quan trọng thì dùng outbox/CDC**, đừng tin một lệnh `DEL` sau commit là đủ.

Cache expire trả lời "tôi chịu được cũ bao lâu", cache invalidation trả lời "ai cần biết là dữ liệu vừa đổi". Trong flash sale, câu trả lời tốt nhất cho giá lại là: **đừng để giá phải đổi trong cache**: cache cả lịch giá, để đồng hồ làm phần việc invalidate.
