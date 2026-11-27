---
title: "Có nên cache kết quả tính toán nghiệp vụ? Ví dụ cart total khi user reload liên tục"
description: "Cart total có khuyến mãi, voucher, phí ship, hạng thành viên: cache hay tính lại mỗi lần? Đo trước, cache đầu vào thay vì kết quả, cache theo fingerprint để khỏi invalidate, và luôn tính lại khi checkout. Code Go."
pubDate: 2026-06-06
tags: [golang, cache, backend, ecommerce]
---

User mở trang giỏ hàng, thấy tổng tiền. F5. F5 lần nữa. Đổi số lượng, quay lại, F5. Mỗi lần như vậy server tính lại cart total: giá từng sản phẩm, khuyến mãi theo combo, voucher, hạng thành viên, phí ship gọi API GHN.

Câu hỏi tự nhiên: **tính rồi thì cache lại cho nhanh?**

Câu trả lời ngắn của bài này:

1. **Đo trước.** Phần lớn trường hợp, cái chậm không phải là phép tính mà là việc **lấy đầu vào**.
2. **Cache đầu vào** (giá, rule khuyến mãi, phí ship) trước khi nghĩ đến cache kết quả.
3. Nếu vẫn cần cache kết quả: **key theo fingerprint của mọi đầu vào**, không cần invalidate.
4. **Không bao giờ dùng kết quả cache để thu tiền.** Checkout luôn tính lại.

Cả bài dùng một ví dụ: shop online khoảng 10.000 đơn/ngày, có flash sale, giao hàng qua GHN/GHTK.

## 1. Cart total gồm những gì

```
Cart total =
    Σ (giá hiện tại của SKU × số lượng)          ← catalog, có thể đang flash sale
  − khuyến mãi tự động (mua 2 tặng 1, combo)     ← promotion rules
  − voucher của user                              ← còn hạn? còn lượt? đủ điều kiện?
  − ưu đãi hạng thành viên                        ← customer
  + phí ship                                      ← API hãng vận chuyển, theo địa chỉ + cân nặng
  = tổng
```

Kết quả phụ thuộc vào **rất nhiều đầu vào**, và đầu vào đến từ **nhiều nơi, đổi theo nhịp khác nhau**:

| Đầu vào | Ai sở hữu | Đổi khi nào |
|---|---|---|
| Danh sách item, số lượng | Giỏ hàng của user | Khi user sửa giỏ |
| Giá SKU | Catalog | Admin sửa giá, **đúng mốc giờ flash sale** |
| Rule khuyến mãi | Promotion | Admin bật/tắt, theo lịch |
| Voucher | Promotion | Hết hạn, hết lượt dùng (do **user khác** dùng) |
| Hạng thành viên | Customer | Thỉnh thoảng |
| Phí ship | Hãng vận chuyển | Khi đổi địa chỉ, cân nặng; hãng đổi biểu phí |
| **Thời gian hiện tại** | Đồng hồ | Liên tục: sale bắt đầu/kết thúc, voucher hết hạn |

Đầu vào cuối cùng hay bị quên: **thời gian**. Một kết quả đúng lúc 23:59:59 có thể sai lúc 00:00:00.

## 2. Bước 0: đo trước khi cache

Trước khi cache, trả lời: **một lần tính tốn bao lâu, và tốn vào đâu?**

```go
func (c *calculator) Compute(ctx context.Context, cart Cart, now time.Time) (Total, error) {
	defer observe("cart_compute_total", time.Now())

	prices, err := timed("load_prices", func() (map[string]int64, error) {
		return c.catalog.Prices(ctx, skus(cart))
	})
	// ... load_promotions, load_voucher, shipping_quote, apply_rules
}
```

Kết quả điển hình khi đo một hệ thống như vậy:

| Bước | Thời gian điển hình | Ghi chú |
|---|---|---|
| Lấy giá 10 SKU | 1–5 ms | Một query `WHERE sku IN (...)`, hoặc N query nếu viết vòng lặp |
| Lấy rule khuyến mãi đang chạy | 1–10 ms | Có khi load cả bảng rule |
| Kiểm tra voucher | 1–3 ms | |
| **Gọi API phí ship** | **100–800 ms** | Mạng ra ngoài, hãng có lúc chậm, có rate limit |
| **Áp rule (CPU)** | **< 1 ms** | Kể cả logic "phức tạp" với vài chục item |

Gần như luôn luôn, phần "logic phức tạp" chạy trong **micro giây**. Thứ chậm là **I/O để lấy đầu vào**, đặc biệt là API bên ngoài.

Kết luận của bước 0 thường là: **không cần cache kết quả, cần cache đúng đầu vào chậm.**

## 3. Ba tầng có thể cache, theo thứ tự nên làm

| Tầng | Cache gì | Rủi ro sai | Lợi ích | Nên làm |
|---|---|---|---|---|
| **A. Trong một request** | Giá, rule đã load trong lần tính này | Không có | Tránh N+1 khi tính | Luôn luôn |
| **B. Đầu vào dùng chung** | Giá SKU, danh sách rule khuyến mãi, phí ship theo tuyến | Thấp, có quy trình invalidate riêng | Lớn nhất | Gần như luôn luôn |
| **C. Kết quả cuối** | Cart total của từng giỏ | Cao nhất: đúng hay sai phụ thuộc mọi đầu vào | Thường nhỏ sau khi đã có B | Chỉ khi đo thấy cần |

### 3.1 Tầng A: memo trong một request

Logic khuyến mãi phức tạp hay hỏi đi hỏi lại cùng một thứ: "giá của SKU A là bao nhiêu?" trong rule combo, rồi trong rule giảm theo danh mục. Memo lại trong phạm vi một lần tính:

```go
type requestMemo struct {
	mu sync.Mutex
	m  map[string]int64
}

func (r *requestMemo) price(sku string, load func(string) int64) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.m == nil {
		r.m = map[string]int64{}
	}
	if p, ok := r.m[sku]; ok {
		return p
	}
	p := load(sku)
	r.m[sku] = p
	return p
}
```

Memo sống và chết cùng request, không bao giờ cũ. Tốt hơn nữa là load hết giá cần thiết bằng một query ngay từ đầu.

### 3.2 Tầng B: cache đầu vào dùng chung

Đây là nơi bỏ công sức:

- **Giá SKU**: dùng chung cho mọi user, đọc cực nhiều. Cách cache giá có lịch flash sale (lưu cả `sale_start`/`sale_end`, tính giá theo thời gian lúc đọc) đã có trong bài [cache invalidation và cache expire trong flash sale](/blog/cache-invalidation-flashsale/).
- **Rule khuyến mãi đang chạy**: vài chục đến vài trăm rule, đổi vài lần một ngày. Cache cả danh sách trong memory mỗi pod, TTL ngắn + invalidate khi admin sửa.
- **Phí ship**: thứ đáng cache nhất. Phí ship phụ thuộc vào **tuyến và cân nặng**, không phụ thuộc vào user:

```go
func ShippingQuoteKey(carrier, fromDistrict, toWard string, weightGram int) string {
	bucket := (weightGram + 499) / 500 * 500 // làm tròn lên 500g, giống biểu phí hãng
	return "ship_quote:" + carrier + ":" + fromDistrict + ":" + toWard + ":" + strconv.Itoa(bucket)
}
```

10.000 user ở cùng phường đặt gói dưới 500g dùng chung một key. Hãng đổi biểu phí vài lần một năm, TTL 6–24 giờ là đủ an toàn, và phí ship cuối cùng vẫn được xác nhận lại khi tạo vận đơn.

Sau tầng B, một lần tính cart total thường còn **vài ms**. Lúc này user có F5 100 lần cũng không phải vấn đề.

### 3.3 Tầng C: cache kết quả cuối, chỉ khi thật sự cần

Vẫn có trường hợp cần: engine khuyến mãi thật sự nặng (tối ưu tổ hợp voucher cho giỏ 50 item), hoặc trang giỏ hàng bị gọi cực nhiều vào giờ flash sale. Khi đó đọc tiếp mục 4.

## 4. Nếu cache kết quả: cache theo fingerprint, đừng invalidate

### 4.1 Vì sao invalidate cart total gần như không làm được

Thử liệt kê sự kiện nào phải xoá cache cart total của user X:

- User X sửa giỏ (dễ).
- **Admin sửa giá** một SKU nằm trong giỏ của X. Cần biết những giỏ nào chứa SKU đó.
- **Một rule khuyến mãi được bật**. Ảnh hưởng tới giỏ nào? Phải chạy lại rule để biết.
- **User Y dùng lượt cuối của voucher** mà X đang áp. Sự kiện của người khác làm sai kết quả của X.
- **Đồng hồ chạy qua 00:00**, flash sale bắt đầu. Không có sự kiện ghi nào cả.
- X lên hạng thành viên.

Event-based invalidation cho kết quả cuối nghĩa là phải biết **mọi đường phụ thuộc**, và chỉ cần sót một đường là khách thấy sai tiền. Thay vào đó, đổi câu hỏi:

> Đừng hỏi "khi nào cache này sai?". Hãy đặt key sao cho **đầu vào đổi thì key đổi**. Cache cũ không cần xoá, nó chỉ không bao giờ được đọc nữa và tự hết TTL.

Đó là **content-addressed cache**: key là fingerprint của mọi đầu vào.

### 4.2 Fingerprint gồm những gì

| Thành phần | Đưa vào fingerprint bằng |
|---|---|
| Item, số lượng | Danh sách item **đã sắp xếp** (thứ tự không được ảnh hưởng) |
| Voucher, địa chỉ | Mã voucher, `address_id` |
| Giá | `price_version`: số tăng mỗi khi có giá nào đổi |
| Khuyến mãi | `promo_version`: số tăng mỗi khi rule hoặc voucher đổi |
| Hạng thành viên | `member_version` của user |
| Thời gian | Thời gian **làm tròn xuống phút** |

```go
type Versions struct {
	Price  int64 // tăng khi bất kỳ giá nào đổi
	Promo  int64 // tăng khi rule khuyến mãi/voucher đổi
	Member int64 // hạng thành viên của user
}

// Fingerprint gom MỌI đầu vào ảnh hưởng tới kết quả.
func Fingerprint(c Cart, v Versions, now time.Time) string {
	items := append([]Item(nil), c.Items...)
	sort.Slice(items, func(i, j int) bool { return items[i].SKU < items[j].SKU })

	h := sha256.New()
	enc := json.NewEncoder(h)
	_ = enc.Encode(struct {
		Items   []Item
		Voucher string
		Address string
		Price   int64
		Promo   int64
		Member  int64
		Minute  string
	}{items, c.VoucherCode, c.AddressID, v.Price, v.Promo, v.Member,
		now.Truncate(time.Minute).Format(time.RFC3339)})
	return hex.EncodeToString(h.Sum(nil))[:32]
}
```

Vài lựa chọn có chủ đích:

- **Version toàn cục thay vì version theo từng SKU.** Đổi giá một SKU làm "mất" cache của mọi giỏ. Nghe phí, nhưng giá đổi vài chục lần một ngày, mỗi lần chỉ làm mỗi giỏ tính lại **một lần**. Đổi lại, không bao giờ sót. Muốn tinh hơn thì đưa version của từng SKU trong giỏ vào fingerprint.
- **Làm tròn theo phút.** Flash sale bắt đầu lúc 00:00:00 thì đúng giây đó fingerprint đổi, vì sang phút mới. Điều kiện: mọi mốc giờ khuyến mãi phải đặt tròn phút. Nếu có rule theo giây, dùng "mốc thay đổi kế tiếp" thay cho phút.
- **Voucher hết lượt do người khác dùng**: tăng `promo_version` khi lượt dùng của một voucher chạm 0, hoặc chấp nhận preview sai trong tối đa một TTL và để checkout bắt (mục 5).

Version lưu ở Redis (`INCR price_version`) ngay sau khi ghi DB thành công.

### 4.3 CachedCalculator

```go
type Store interface {
	Get(ctx context.Context, key string) ([]byte, bool, error)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration) error
}

type CachedCalculator struct {
	calc     Calculator
	versions VersionSource
	store    Store
	ttl      time.Duration
	group    singleflight.Group
}

func (cc *CachedCalculator) Preview(ctx context.Context, c Cart) (Total, error) {
	now := time.Now()
	v, err := cc.versions.Current(ctx, c.UserID)
	if err != nil {
		return cc.calc.Compute(ctx, c, now) // không có version thì tính thẳng, không cache
	}
	fp := Fingerprint(c, v, now)
	key := "cart_total:" + c.ID + ":" + fp

	if raw, ok, err := cc.store.Get(ctx, key); err == nil && ok {
		var t Total
		if json.Unmarshal(raw, &t) == nil {
			return t, nil
		}
	}

	// User bấm F5 liên tục: chỉ một goroutine tính, các request trùng chờ kết quả.
	res, err, _ := cc.group.Do(key, func() (any, error) {
		t, err := cc.calc.Compute(ctx, c, now)
		if err != nil {
			return Total{}, err
		}
		t.Fingerprint = fp
		if b, err := json.Marshal(t); err == nil {
			_ = cc.store.Set(ctx, key, b, cc.ttl)
		}
		return t, nil
	})
	if err != nil {
		return Total{}, err
	}
	return res.(Total), nil
}
```

Ba điểm quan trọng:

1. **Lỗi khi lấy version thì tính thẳng.** Không có version thì không biết cache còn đúng không, nên bỏ qua cache. Cache hỏng không được làm sai tiền.
2. **Không bao giờ cần `DEL`.** Key cũ tự hết TTL (5 phút). Không có code invalidate nào để quên.
3. **Không cache lỗi.** API ship lỗi thì lần F5 sau thử lại.

Vì key đã chứa fingerprint, cache có TTL dài hay ngắn cũng không ảnh hưởng tính đúng, chỉ ảnh hưởng dung lượng Redis.

## 5. Quy tắc quan trọng nhất: checkout luôn tính lại

Preview (trang giỏ hàng) và checkout (thu tiền) là **hai mức yêu cầu khác nhau**:

| | Preview giỏ hàng | Checkout |
|---|---|---|
| Mục đích | Cho user xem | Tạo đơn, thu tiền, trừ voucher, giữ kho |
| Sai thì sao | User thấy số cũ vài giây | **Mất tiền** hoặc khiếu nại |
| Tần suất | Rất cao (F5, đổi số lượng) | Thấp (một lần mỗi đơn) |
| Cache | Được, theo fingerprint | **Không bao giờ** |
| Nguồn dữ liệu | Có thể đọc cache đầu vào | Đọc giá, voucher, tồn kho từ nguồn sự thật, trong transaction |

```go
var ErrTotalChanged = errors.New("cart: total changed, please review")

// Checkout luôn tính lại, không bao giờ đọc cache.
func PlaceOrder(ctx context.Context, calc Calculator, c Cart, shownTotal int64) (Total, error) {
	t, err := calc.Compute(ctx, c, time.Now())
	if err != nil {
		return Total{}, err
	}
	if t.Total != shownTotal {
		return t, ErrTotalChanged
	}
	return t, nil
}
```

Client gửi lên `shownTotal`, tức số tiền user đã nhìn thấy. Nếu tính lại ra số khác (sale vừa hết, voucher vừa hết lượt), **không âm thầm thu số mới**, mà trả về để UI hiển thị "Giá đã thay đổi, vui lòng kiểm tra lại". Đây là trải nghiệm đúng, và cũng là lý do preview được phép cũ vài giây: checkout là lưới an toàn.

Hai lỗi kinh điển cần tránh:

- **Tin số tiền client gửi lên.** `shownTotal` chỉ dùng để so sánh, không bao giờ dùng để thu tiền.
- **Checkout đọc lại cache preview "cho nhanh".** Một lần mỗi đơn, nhanh hơn vài ms không đáng với rủi ro thu sai.

Trong checkout, việc trừ lượt voucher và giữ kho phải atomic để không bị hai người cùng dùng lượt cuối. Chi tiết về các kiểu race condition này, xem bài [race condition và locking](/blog/rails-race-condition-locking/).

## 6. Bảng quyết định

| Tình huống | Làm gì |
|---|---|
| Chưa đo, chỉ "thấy logic phức tạp" | Đo trước. Thường không cần cache kết quả |
| Chậm vì N+1 query giá/rule | Sửa query, memo trong request (tầng A) |
| Chậm vì API phí ship | Cache phí ship theo tuyến + cân nặng (tầng B) |
| Giá, rule đọc nhiều | Cache đầu vào dùng chung (tầng B) |
| Đã làm A, B mà vẫn chậm (engine khuyến mãi nặng thật) | Cache kết quả theo fingerprint (tầng C) |
| User F5 liên tục gây tải | singleflight theo key; rate limit nếu là bot |
| Checkout | Luôn tính lại, so sánh với số user đã thấy |
| Kết quả dùng cho báo cáo, đối soát | Không cache: lưu **snapshot** vào đơn hàng lúc đặt |

Dòng cuối đáng nói thêm: số tiền của **đơn đã đặt** không phải là thứ để cache, mà là thứ để **lưu vĩnh viễn**: giá từng dòng, giảm giá áp dụng, voucher, phí ship tại thời điểm đặt. Báo cáo và đổi trả đọc snapshot đó, không bao giờ tính lại theo giá hiện tại.

## 7. Đo xem cache có đáng không

Khi đã bật tầng C, theo dõi:

- **Hit rate** của `cart_total:*`. Dưới 30–40% nghĩa là fingerprint đổi quá thường (version toàn cục bump liên tục, hoặc làm tròn thời gian quá mịn), và cache chỉ tốn Redis.
- **p95 thời gian `Compute`** khi miss, so với p95 khi hit. Chênh nhau vài ms thì bỏ tầng C cho đơn giản.
- **Tỉ lệ `ErrTotalChanged` khi checkout.** Tăng đột biến nghĩa là preview đang sai nhiều: xem lại fingerprint có thiếu đầu vào nào không.
- **Số lần gọi API phí ship**, so với số lần xem giỏ. Đây thường là con số tiết kiệm lớn nhất.

## 8. Checklist

- **Đo trước**: thời gian của từng bước lấy đầu vào và phần áp rule.
- **Memo trong request** để tránh N+1, load giá theo lô.
- **Cache đầu vào dùng chung**: giá (có lịch sale), rule khuyến mãi, phí ship theo tuyến và cân nặng.
- **Cache kết quả cuối chỉ khi đo thấy cần.**
- Nếu cache kết quả: **key theo fingerprint** của mọi đầu vào, gồm cả thời gian làm tròn; không viết code invalidate.
- Lỗi khi lấy version thì **bỏ qua cache**, tính thẳng.
- **singleflight** cho các request F5 trùng nhau.
- **Checkout luôn tính lại** từ nguồn sự thật, so với số user đã thấy, báo khi khác.
- **Không bao giờ tin số tiền client gửi lên.**
- Đơn đã đặt thì **lưu snapshot** tiền, không tính lại.

Câu hỏi "có nên cache business calculation không" thường là câu hỏi sai. Câu hỏi đúng là: **cái gì đang chậm, và sai thì ai chịu?** Đầu vào chậm thì cache đầu vào. Kết quả chỉ để xem thì cache theo fingerprint. Kết quả dùng để thu tiền thì không cache, mà tính lại và lưu lại.
