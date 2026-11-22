---
title: "Modular monolith cho ecommerce + logistics: lựa chọn của team 1–2 người + AI (Go)"
description: "Vì sao team 1–2 dev dùng AI nên chọn modular monolith: so sánh chi phí với microservices, thiết kế module ecommerce + giao hàng, chia database theo schema, outbox, và khi nào mới tách service. Code Go."
pubDate: 2026-11-22
tags: [golang, architecture, backend, database]
---

Bạn có một shop online. Mỗi ngày 5.000 đến 20.000 đơn, vài lần mỗi tháng có flash sale. Shop tự vận hành giao hàng qua GHN, GHTK và J&T. Đội kỹ thuật là 1 đến 2 dev, cộng thêm AI coding tool.

Câu hỏi kiến trúc hay gặp: "Có nên tách microservices cho chuyên nghiệp không?". Bài này trả lời là **không, chưa**. Lựa chọn hợp lý là **modular monolith**: một codebase, một lần deploy, nhưng bên trong chia module có ranh giới rõ như thể chúng là các service riêng.

Cả bài dùng một ví dụ xuyên suốt: shop trên, viết bằng Go, Postgres, Redis.

## 1. Team 1–2 người + AI: vì sao modular monolith

### 1.1 Bốn khái niệm hay bị lẫn

Hai câu hỏi khác nhau: **code nằm ở mấy repo** và **chạy thành mấy thứ deploy riêng**.

| | **Deploy một khối** | **Deploy nhiều service** |
|---|---|---|
| **Một repo** | Monolith (cổ điển hoặc **modular**) | Monorepo chứa nhiều microservices |
| **Nhiều repo** | Hiếm gặp (lib chia repo, build ra một binary) | Microservices kiểu "mỗi service một repo" |

- **Monolith**: một ứng dụng, một lần deploy. Không nói gì về cấu trúc bên trong.
- **Modular monolith**: monolith mà bên trong chia **module có ranh giới**: mỗi module sở hữu dữ liệu riêng, chỉ lộ interface, không gọi vào ruột module khác.
- **Monorepo**: chỉ là cách tổ chức code. Monorepo có thể chứa một monolith hoặc 30 microservices.
- **Microservices**: mỗi service deploy riêng, giao tiếp qua mạng, thường có DB riêng.

Monolith "tệ" không phải vì là monolith. Nó tệ vì **không có module**: mọi thứ gọi mọi thứ, bảng nào cũng bị đọc ghi từ khắp nơi. Modular monolith giữ được lợi ích của một khối deploy mà tránh được đống bùn đó.

### 1.2 Lập luận cho team 1–2 người

**On-call là một người.** Lúc 2 giờ sáng đơn không tạo được, người trực cần mở một dashboard, một log stream, một stack trace. Với microservices, câu hỏi đầu tiên là "lỗi ở service nào?", và câu trả lời có khi nằm ở ba service cùng lúc.

**AI cần thấy toàn bộ ngữ cảnh.** AI coding tool làm tốt nhất khi:

- Đọc được toàn bộ code liên quan trong một repo: checkout gọi inventory thế nào, inventory trả lỗi gì.
- Sửa xuyên module trong **một PR**: thêm field `warehouse_id` vào cả ordering, inventory và shipping, compiler kiểm tra hết.
- Tự chạy `go test ./...` cho **toàn hệ thống** và thấy ngay mình làm vỡ chỗ nào.

Với microservices, cùng thay đổi đó là ba PR ở ba repo (hoặc ba service), một thay đổi hợp đồng API cần versioning, và test tích hợp cần dựng cả cụm. AI không chạy được, hoặc chạy được nhưng chậm và mong manh.

**Định luật Conway.** Hệ thống phản ánh cấu trúc giao tiếp của tổ chức. Microservices sinh ra để giải bài toán **tổ chức**: 10 team không thể cùng deploy một binary mà không giẫm chân nhau. Team 2 người không có bài toán đó. Dùng microservices khi đó là trả chi phí của một giải pháp cho một vấn đề mình không có.

### 1.3 Khi nào câu trả lời KHÔNG phải modular monolith

Để công bằng, có những trường hợp modular monolith không phải lựa chọn đúng:

| Tình huống | Nên chọn |
|---|---|
| Sản phẩm còn đang tìm product-market fit, vài trăm đơn/ngày, có thể bỏ hết sau 3 tháng | Monolith đơn giản, Rails/Laravel/Shopify. Chia module kỹ lúc này là quá sớm |
| Shop nhỏ, nghiệp vụ chuẩn, không tự làm logistics | SaaS (Shopify, Haravan, Sapo) + vài integration. Tự viết là phí |
| Một phần có yêu cầu kỹ thuật khác hẳn: xử lý video, ML inference trên GPU | Tách **riêng phần đó** thành service, phần còn lại vẫn monolith |
| Đã có nhiều team độc lập (vài chục dev), cần deploy độc lập | Microservices bắt đầu đáng tiền |
| Yêu cầu compliance tách hẳn một vùng dữ liệu (ví dụ dữ liệu thẻ theo PCI DSS) | Tách vùng đó ra, hoặc dùng cổng thanh toán để không chạm vào dữ liệu thẻ |

## 2. Chi phí duy trì: modular monolith vs microservices

Giả định cho ví dụ: khoảng **8 module/service** (catalog, inventory, ordering, payment, fulfillment, shipping, customer, notification; reporting tính sau).

### 2.1 Bảng so sánh

| Hạng mục | Modular monolith | Microservices (~8 service) |
|---|---|---|
| **Compute** | 3 entrypoint (api, worker, webhook), mỗi cái 2–3 pod | 8 service × 2 pod tối thiểu cho HA, cộng gateway |
| **Database** | 1 Postgres managed + 1 read replica | 8 DB (hoặc 1 cluster chia 8 DB), mỗi cái cần backup, monitoring, nâng cấp |
| **Redis** | 2 instance nhỏ (cache, queue) | Thường vẫn 2 instance dùng chung, hoặc nhiều hơn |
| **Message broker** | Không bắt buộc: outbox trong Postgres + worker | Gần như bắt buộc: Kafka/RabbitMQ/NATS, cần vận hành |
| **Observability** | Log + metric + trace trong một process | Bắt buộc distributed tracing, log tập trung theo correlation ID, dung lượng log lớn hơn nhiều |
| **CI/CD** | 1 pipeline, 1 image | 8 pipeline (hoặc 1 pipeline phức tạp), 8 image, quản lý version |
| **On-call** | Một chỗ để nhìn, một chỗ để rollback | Lỗi lan qua nhiều service, rollback từng service, phụ thuộc thứ tự deploy |
| **Debug** | Stack trace từ handler xuống tận SQL | Ghép trace qua nhiều hop mạng, lỗi có thể là timeout, retry, hoặc dữ liệu lệch giữa các DB |
| **Versioning API** | Interface Go, compiler kiểm tra | Hợp đồng HTTP/gRPC, tương thích ngược, deploy theo thứ tự |
| **Onboard dev mới** | Clone 1 repo, `make dev`, chạy được trong vài phút | Dựng cụm local hoặc dùng môi trường chung, học topology |
| **Tốc độ ra feature xuyên module** | 1 PR, 1 deploy | Nhiều PR, phối hợp deploy, có khi cần feature flag cho tương thích |

### 2.2 Chi phí cloud theo tháng: ước tính dạng khoảng

Đây là **ước tính thô** để so sánh thứ bậc, không phải báo giá. Giá thật phụ thuộc nhà cung cấp, vùng, cam kết dài hạn. Giả định chung: cloud phổ biến (AWS/GCP), Postgres và Redis **managed**, Kubernetes managed hoặc VM có Docker.

**Modular monolith**

| Thành phần | Giả định | Khoảng/tháng (USD) |
|---|---|---|
| Compute | 6–8 pod nhỏ (0,5–1 vCPU, 1–2 GB) | 100–300 |
| Postgres | 1 primary 2–4 vCPU/8–16 GB + 1 read replica | 200–600 |
| Redis | 2 instance nhỏ | 50–150 |
| Observability | Log + metric + trace mức vừa phải | 50–300 |
| **Tổng** | | **khoảng 400–1.300** |

**Microservices (~8 service)**

| Thành phần | Giả định | Khoảng/tháng (USD) |
|---|---|---|
| Compute | 16–24 pod + gateway + sidecar (nếu dùng service mesh) | 300–900 |
| Postgres | 8 DB: hoặc 8 instance nhỏ, hoặc 1–2 cluster lớn hơn chia DB | 400–1.500 |
| Redis | 2–3 instance | 50–200 |
| Broker | Kafka/RabbitMQ managed, cụm nhỏ nhất có HA | 150–600 |
| Observability | Distributed tracing, log nhiều hơn rõ rệt | 200–800 |
| **Tổng** | | **khoảng 1.100–4.000** |

Hai điểm cần đọc đúng:

- Con số cloud **không phải chi phí lớn nhất**. Chi phí lớn nhất là **thời gian của 1–2 dev**: mỗi giờ vận hành Kafka, debug trace phân tán, sửa pipeline là một giờ không làm feature.
- Tự host (VPS, Postgres tự chạy) có thể rẻ hơn nhiều về tiền, nhưng đổi lại thời gian vận hành. Với team 2 người, managed thường đáng tiền hơn.

**Về Amazon Prime Video năm 2023**: team làm công cụ **giám sát chất lượng video** (Video Quality Analysis) của Prime Video viết rằng họ chuyển công cụ đó từ kiến trúc phân tán (AWS Step Functions + Lambda) về một ứng dụng monolith, và chi phí hạ tầng **của công cụ đó** giảm hơn 90%. Đây là **một thành phần**, không phải toàn bộ Prime Video, và nguyên nhân chính là chi phí truyền dữ liệu và điều phối giữa các bước. Bài học đúng: phân tán có giá, và giá đó đáng trả hay không tuỳ bài toán. Không nên kể nó như "Amazon bỏ microservices".

### 2.3 Chi phí ẩn của microservices

**Distributed transaction / saga.** Checkout cần: tạo đơn, giữ kho, trừ tiền. Trong một DB, đó là một transaction. Qua ba service, đó là saga:

```
ordering: tạo đơn (pending)
  → inventory: giữ kho          (lỗi? → huỷ đơn)
  → payment: trừ tiền           (lỗi? → trả kho → huỷ đơn)
  → ordering: xác nhận đơn      (lỗi? → hoàn tiền → trả kho → ...)
```

Mỗi bước cần hành động bù trừ, mỗi hành động bù trừ có thể lỗi, và cần trạng thái trung gian để resume. Viết đúng saga là việc của vài tuần, không phải vài giờ.

**Retry / timeout giữa service.** Mỗi lời gọi mạng có thể chậm, lỗi, hoặc **thành công nhưng response bị mất**. Phải có timeout, retry có backoff, idempotency key, circuit breaker. Retry sai cách tạo retry storm khi một service chậm.

**Distributed monolith.** Kết quả phổ biến nhất khi team nhỏ tách service quá sớm: 8 service nhưng phải deploy cùng nhau, gọi đồng bộ dây chuyền, chung một DB. Có đủ chi phí của microservices mà không có lợi ích nào.

**Dữ liệu không nhất quán.** Mỗi service một DB nghĩa là "đơn đã thanh toán" ở payment có thể chưa có ở ordering trong vài giây, hoặc vĩnh viễn nếu sự kiện bị mất. Báo cáo phải ghép từ nhiều nguồn.

### 2.4 Chi phí của modular monolith (cũng phải nói)

| Chi phí | Biểu hiện | Giảm bằng cách |
|---|---|---|
| **Giữ ranh giới cần kỷ luật** | "Chỉ lần này thôi" import thẳng repo của module khác, JOIN sang bảng của module khác | Ép bằng tool trong CI (mục 3.3), không chỉ bằng quy ước |
| **Deploy chung** | Sửa một dòng template email cũng deploy lại cả app | CI nhanh, rolling deploy, feature flag. Với team 2 người, đây hiếm khi là vấn đề thật |
| **Một module lỗi ảnh hưởng cả app** | Goroutine leak ở reporting làm OOM pod đang phục vụ checkout | Tách **entrypoint**: api, worker, webhook chạy pod riêng (mục 6.2); timeout và giới hạn tài nguyên theo module |
| **Scale theo đơn vị cả app** | Muốn thêm CPU cho webhook phải scale cả binary | Cũng giải bằng nhiều entrypoint từ một codebase |
| **Một DB là điểm chung** | Query nặng của reporting làm chậm checkout | Reporting đọc từ read replica |

## 3. Thiết kế module cho ecommerce + logistics

### 3.1 Danh sách module

| Module | Dữ liệu sở hữu | Trách nhiệm |
|---|---|---|
| **catalog** | products, variants, categories, prices | Sản phẩm, giá, lịch flash sale |
| **inventory** | stock theo (sku, warehouse), reservations | Tồn kho, giữ kho khi đặt, trả kho khi huỷ |
| **ordering** | orders, order_lines, order_status_history | Giỏ hàng → đơn, máy trạng thái đơn |
| **payment** | payments, refunds | Thu tiền online (VNPay, MoMo...), hoàn tiền, ghi nhận COD đã thu |
| **fulfillment** | pick_lists, packages | Chọn kho, soạn hàng, đóng gói |
| **shipping** | shipments, carrier_events, cod_ledger | Tạo vận đơn qua GHN/GHTK/J&T, nhận webhook, đối soát COD |
| **customer** | customers, addresses | Tài khoản, sổ địa chỉ |
| **notification** | templates, notification_log | Email, SMS, Zalo ZNS |
| **reporting** | Không sở hữu dữ liệu nghiệp vụ, chỉ đọc | Doanh thu, tỉ lệ giao thành công, đối soát |

### 3.2 Cấu trúc thư mục Go

Một codebase, nhiều entrypoint:

```
shop/
├── cmd/
│   ├── api/main.go          # HTTP API cho web/app
│   ├── worker/main.go       # outbox worker, job nền, tạo vận đơn
│   └── webhook/main.go      # nhận webhook GHN/GHTK/J&T, cổng thanh toán
├── internal/
│   ├── catalog/
│   ├── inventory/
│   │   ├── inventory.go     # interface + kiểu public của module
│   │   ├── service.go       # implementation
│   │   ├── postgres.go      # truy cập schema inventory
│   │   ├── migrations/
│   │   └── CLAUDE.md
│   ├── ordering/
│   ├── payment/
│   ├── fulfillment/
│   ├── shipping/
│   │   ├── carrier.go       # interface Carrier
│   │   ├── ghn/ ghtk/ jnt/  # adapter từng hãng
│   │   └── ...
│   ├── customer/
│   ├── notification/
│   ├── reporting/
│   └── platform/            # hạ tầng dùng chung, không có nghiệp vụ
│       ├── db/              # InTx, kết nối Postgres
│       ├── outbox/          # Publish, Worker
│       ├── httpx/ log/ config/
├── CLAUDE.md
├── .go-arch-lint.yml
└── go.mod
```

Quy tắc phụ thuộc:

- `cmd/*` được import mọi module để lắp ráp (wiring).
- Module nghiệp vụ được import `platform` và **chỉ phần public** của module khác.
- `platform` không import module nghiệp vụ nào.

### 3.3 Mỗi module chỉ lộ interface

File `internal/inventory/inventory.go` là "cửa trước" của module:

```go
package inventory

import (
	"context"
	"database/sql"
	"errors"
)

var ErrOutOfStock = errors.New("inventory: out of stock")

type Line struct {
	SKU string
	Qty int
}

type ReservationID string

// Service là thứ duy nhất module khác được dùng.
type Service interface {
	// Reserve chạy trong transaction của bên gọi (xem mục 4.2).
	Reserve(ctx context.Context, tx *sql.Tx, orderID, warehouseID string, lines []Line) (ReservationID, error)
	Release(ctx context.Context, tx *sql.Tx, id ReservationID) error
	Available(ctx context.Context, sku string) (int, error)
}
```

Implementation để private (`type service struct`), chỉ lộ constructor `NewService(db *sql.DB) Service`:

```go
type service struct{ db *sql.DB }

func NewService(db *sql.DB) Service { return &service{db: db} }

func (s *service) Reserve(ctx context.Context, tx *sql.Tx, orderID, warehouseID string, lines []Line) (ReservationID, error) {
	for _, l := range lines {
		// Điều kiện nằm trong UPDATE: không có khoảng hở giữa "đọc" và "ghi".
		res, err := tx.ExecContext(ctx, `
			UPDATE inventory.stock
			   SET reserved = reserved + $1
			 WHERE sku = $2 AND warehouse_id = $3
			   AND on_hand - reserved >= $1`, l.Qty, l.SKU, warehouseID)
		if err != nil {
			return "", err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return "", ErrOutOfStock
		}
	}
	var id string
	err := tx.QueryRowContext(ctx, `
		INSERT INTO inventory.reservations (order_id, warehouse_id)
		VALUES ($1, $2) RETURNING id`, orderID, warehouseID).Scan(&id)
	return ReservationID(id), err
}
```

Kiểu `UPDATE ... WHERE on_hand - reserved >= $1` là cách tránh oversell không cần lock tường minh. Chi tiết về race condition khi trừ kho, xem bài [race condition và locking](/blog/rails-race-condition-locking/) (ví dụ Rails nhưng nguyên lý SQL giống hệt).

**Ép ranh giới bằng tool, không bằng lời nhắc.** Thư mục `internal/` chỉ chặn import từ **ngoài** module Go `shop`; bên trong, `ordering` vẫn import được `inventory/postgres.go` nếu nó public. Nên cần thêm linter trong CI, ví dụ `go-arch-lint`:

```yaml
# .go-arch-lint.yml
version: 3
workdir: internal

components:
  platform:     { in: platform/** }
  catalog:      { in: catalog }
  inventory:    { in: inventory }
  ordering:     { in: ordering }
  payment:      { in: payment }
  fulfillment:  { in: fulfillment }
  shipping:     { in: shipping/** }
  customer:     { in: customer }
  notification: { in: notification }
  reporting:    { in: reporting }

commonComponents: [platform]

deps:
  ordering:
    mayDependOn: [catalog, inventory, payment, customer]
  fulfillment:
    mayDependOn: [inventory, ordering, shipping]
  reporting:
    mayDependOn: [ordering, payment, shipping]
  # module không liệt kê thì chỉ được dùng platform
```

Hoặc dùng `depguard` trong golangci-lint với rule kiểu "`internal/catalog` không được import `internal/ordering`". Quan trọng là **CI fail** khi vi phạm.

Lưu ý: các file như `postgres.go` của module nên dùng kiểu và hàm viết thường (private), để kể cả khi import được package, code ngoài cũng không gọi được vào phần truy cập dữ liệu.

### 3.4 Gọi đồng bộ hay phát sự kiện?

Quy tắc đơn giản:

- **Cần kết quả ngay để trả lời người dùng** → gọi đồng bộ qua interface. Checkout cần biết còn hàng không, thanh toán được không.
- **Chuyện xảy ra sau, không ảnh hưởng response** → phát sự kiện qua outbox. Gửi email, soạn hàng, tạo vận đơn.

```
                      ┌──────────────── 1 transaction Postgres ─────────────────┐
POST /checkout ──▶ ordering.PlaceOrder                                          │
                      │  INSERT ordering.orders                                 │
                      │  inventory.Reserve(tx)   ──── sync, cùng tx             │
                      │  outbox.Publish(OrderPlaced)                            │
                      └─────────────────────────────────────────────────────────┘
                      │
                      ▼  redirect cổng thanh toán (hoặc COD: confirm ngay)
webhook cổng TT ──▶ payment.Confirm ──▶ outbox: OrderPaid
                                              │
                         outbox worker ◀──────┘
                           ├─▶ fulfillment.OnOrderPaid  → chọn kho, tạo pick list
                           │      └─▶ outbox: PackageReady
                           │             └─▶ shipping.CreateShipment (GHN/GHTK/J&T)
                           └─▶ notification.OnOrderPaid → email "đã nhận đơn"

webhook GHN/GHTK/J&T ──▶ shipping.ApplyTrackingEvent
                           └─▶ outbox: ShipmentDelivered
                                  ├─▶ ordering: đơn → completed
                                  ├─▶ payment: ghi nhận COD (nếu có)
                                  └─▶ notification: "giao thành công"
```

Payment online đi qua redirect và webhook của cổng thanh toán, nên bản chất đã là bất đồng bộ. Với COD, `payment` chỉ ghi nhận "sẽ thu khi giao", tiền thật về khi hãng vận chuyển đối soát (mục 3.5).

### 3.5 Điểm khó riêng của logistics

**(a) Webhook trùng và sai thứ tự.** Hãng vận chuyển gửi lại webhook khi timeout, và các trạng thái có thể đến không theo thứ tự (`delivered` đến trước `out_for_delivery`). Hai lớp phòng thủ:

1. **Idempotent**: lưu mọi sự kiện với unique `(carrier, event_id)`, trùng thì bỏ qua.
2. **Máy trạng thái không lùi**: chỉ chuyển trạng thái theo cạnh hợp lệ.

```go
package shipping

type ShipmentStatus int

const (
	StatusCreated ShipmentStatus = iota
	StatusPickedUp
	StatusInTransit
	StatusOutForDelivery
	StatusDelivered
	StatusFailed
	StatusReturned
)

var allowed = map[ShipmentStatus][]ShipmentStatus{
	StatusCreated:        {StatusPickedUp, StatusFailed},
	StatusPickedUp:       {StatusInTransit, StatusOutForDelivery, StatusFailed},
	StatusInTransit:      {StatusOutForDelivery, StatusFailed},
	StatusOutForDelivery: {StatusDelivered, StatusFailed},
	StatusFailed:         {StatusOutForDelivery, StatusReturned}, // giao lại hoặc hoàn
	// Delivered, Returned: trạng thái cuối, không đi đâu nữa
}

func CanTransition(from, to ShipmentStatus) bool {
	for _, s := range allowed[from] {
		if s == to {
			return true
		}
	}
	return false
}
```

```go
func ApplyTrackingEvent(ctx context.Context, conn *sql.DB, carrier string, ev TrackingEvent) error {
	return db.InTx(ctx, conn, func(tx *sql.Tx) error {
		// 1. Idempotent: webhook trùng thì không làm gì.
		res, err := tx.ExecContext(ctx, `
			INSERT INTO shipping.carrier_events (carrier, event_id, tracking_code, status, occurred_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (carrier, event_id) DO NOTHING`,
			carrier, ev.EventID, ev.TrackingCode, ev.Status, ev.OccurredAt)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil
		}

		// 2. Khoá vận đơn, kiểm tra cạnh hợp lệ.
		var current ShipmentStatus
		var orderID string
		if err := tx.QueryRowContext(ctx, `
			SELECT status, order_id FROM shipping.shipments
			 WHERE carrier = $1 AND tracking_code = $2
			 FOR UPDATE`, carrier, ev.TrackingCode).Scan(&current, &orderID); err != nil {
			return err
		}
		if !CanTransition(current, ev.Status) {
			return nil // đến muộn hoặc sai thứ tự: đã lưu log, không lùi trạng thái
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE shipping.shipments SET status = $1, updated_at = now()
			 WHERE carrier = $2 AND tracking_code = $3`, ev.Status, carrier, ev.TrackingCode); err != nil {
			return err
		}

		// 3. Phát sự kiện trong cùng transaction.
		if ev.Status == StatusDelivered {
			return outbox.Publish(ctx, tx, "shipping.ShipmentDelivered", orderID,
				map[string]string{"order_id": orderID, "tracking_code": ev.TrackingCode})
		}
		return nil
	})
}
```

Sự kiện "sai thứ tự" vẫn được lưu trong `carrier_events`, nên khi cần điều tra vẫn có đủ lịch sử.

**(b) Interface `Carrier` cho nhiều hãng.** Mỗi hãng có API, mã trạng thái, cách ký webhook khác nhau. Đưa hết về một interface, phần còn lại của hệ thống không biết đang dùng hãng nào:

```go
package shipping

type CreateShipmentReq struct {
	OrderID    string
	ToName     string
	ToPhone    string
	ToAddress  string
	WeightGram int
	CODAmount  int64 // 0 nếu đã thanh toán online
}

type Shipment struct {
	TrackingCode string
	Fee          int64
}

type TrackingEvent struct {
	TrackingCode string
	Status       ShipmentStatus // đã map từ mã riêng của hãng
	EventID      string
	OccurredAt   time.Time
}

type Carrier interface {
	Code() string // "ghn", "ghtk", "jnt"
	Quote(ctx context.Context, req CreateShipmentReq) (int64, error)
	CreateShipment(ctx context.Context, req CreateShipmentReq) (Shipment, error)
	Cancel(ctx context.Context, trackingCode string) error
	// ParseWebhook xác thực chữ ký và map mã trạng thái của hãng về ShipmentStatus.
	ParseWebhook(r *http.Request) ([]TrackingEvent, error)
}
```

Mỗi hãng là một package con `shipping/ghn`, `shipping/ghtk`, `shipping/jnt` implement interface này. Thêm hãng mới là thêm một package, không sửa ordering hay fulfillment. Đây cũng là loại việc rất hợp để giao cho AI: "viết adapter `shipping/jnt` theo interface `Carrier`, kèm test map trạng thái".

**(c) Đối soát COD kiểu ledger.** Tiền COD đi đường vòng: shipper thu, hãng giữ, vài ngày sau chuyển về trừ phí. Đừng lưu một cột `cod_collected bool` rồi ghi đè. Dùng **sổ cái** chỉ thêm, không sửa:

```sql
CREATE TABLE shipping.cod_ledger (
    id            bigserial PRIMARY KEY,
    shipment_id   bigint NOT NULL,
    entry_type    text   NOT NULL,  -- 'expected', 'collected', 'fee', 'remitted', 'adjustment'
    amount        bigint NOT NULL,  -- đồng; âm cho phí và khoản trừ
    carrier_ref   text,             -- mã phiên đối soát của hãng
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (shipment_id, entry_type, carrier_ref)
);
```

Số tiền hãng còn nợ shop là `SUM(amount)` theo hãng. Khi file đối soát của hãng lệch với sổ, thêm dòng `adjustment` có ghi chú, không sửa dòng cũ. Kế toán và bạn lúc 2 giờ sáng đều cảm ơn thiết kế này.

**(d) Tồn kho theo (sku, warehouse).** Khi có hơn một kho (Hà Nội, HCM), tồn kho phải là `(sku, warehouse_id)`, không phải một con số theo sku. Fulfillment chọn kho gần địa chỉ khách nhất còn đủ hàng, inventory giữ kho tại đúng kho đó. Thiết kế ngay từ đầu rẻ hơn nhiều so với migrate sau.

## 4. Chia database

### 4.1 Bốn lựa chọn

| Lựa chọn | Mô tả | Transaction xuyên module | Độc lập | Vận hành | Hợp với |
|---|---|---|---|---|---|
| **Chung bảng, tự do** | Mọi module đọc ghi mọi bảng | Dễ | Không có | Dễ | Không ai cả (đây là đống bùn) |
| **Chung DB, mỗi module một schema** | `catalog.*`, `inventory.*`, ... | **Có, một transaction** | Ranh giới rõ, tách sau được | Một DB để backup, monitor | **Team nhỏ, ví dụ này** |
| **DB riêng, chung server** | Mỗi module một database trên cùng Postgres | Không (cần saga/outbox) | Cao | Vẫn một server, nhiều DB | Chuẩn bị tách service |
| **DB server riêng** | Mỗi module một instance | Không | Cao nhất | Nhiều instance để vận hành | Microservices thật sự |

**Khuyến nghị: một Postgres, mỗi module một schema.**

### 4.2 Lợi ích lớn nhất: một transaction cho checkout

Tạo đơn, giữ kho và ghi sự kiện outbox nằm trong **cùng một transaction**. Hoặc cả ba thành công, hoặc không gì cả. Không saga, không hành động bù trừ.

```go
package db

// InTx chạy fn trong một transaction, rollback nếu fn lỗi hoặc panic.
func InTx(ctx context.Context, conn *sql.DB, fn func(tx *sql.Tx) error) (err error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
```

```go
package ordering

type CheckoutInput struct {
	CustomerID  string
	WarehouseID string
	Lines       []inventory.Line
}

type OrderPlaced struct {
	OrderID    string `json:"order_id"`
	CustomerID string `json:"customer_id"`
}

type Service struct {
	db        *sql.DB
	inventory inventory.Service
}

func (s *Service) PlaceOrder(ctx context.Context, in CheckoutInput) (string, error) {
	var orderID string
	err := db.InTx(ctx, s.db, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO ordering.orders (customer_id, status)
			VALUES ($1, 'pending_payment') RETURNING id`, in.CustomerID).Scan(&orderID); err != nil {
			return err
		}
		if _, err := s.inventory.Reserve(ctx, tx, orderID, in.WarehouseID, in.Lines); err != nil {
			return fmt.Errorf("reserve: %w", err)
		}
		return outbox.Publish(ctx, tx, "ordering.OrderPlaced", orderID,
			OrderPlaced{OrderID: orderID, CustomerID: in.CustomerID})
	})
	return orderID, err
}
```

`ordering` không ghi vào bảng của `inventory`. Nó **gọi** `inventory.Reserve` và truyền transaction vào. Module inventory vẫn là chỗ duy nhất ghi schema `inventory`. Đây là thoả hiệp có chủ đích: chia sẻ transaction, không chia sẻ bảng.

Truyền `*sql.Tx` qua interface làm module dính vào việc "cùng một DB". Khi tách inventory ra service riêng, đây là chỗ phải đổi thành saga. Chấp nhận được, vì chỗ cần đổi rất rõ và chỉ có vài lời gọi.

### 4.3 Quy tắc

1. **Mỗi schema chỉ một module ghi.** `inventory.stock` chỉ có code trong `internal/inventory` được `INSERT/UPDATE/DELETE`.
2. **Không đọc bảng của module khác.** Cần dữ liệu thì gọi interface. Ngoại lệ duy nhất: **reporting chỉ đọc**, chạy trên **read replica**, để query nặng không chạm primary.
3. **Không foreign key chéo schema.** `ordering.order_lines.sku` không có FK tới `catalog.variants`. Lưu ID và snapshot cần thiết (tên, giá tại thời điểm mua). FK chéo là thứ khiến việc tách DB sau này gần như không thể.
4. **Migration theo module.** Mỗi module có thư mục `migrations/` riêng, bảng version riêng (ví dụ `inventory.schema_migrations`). Công cụ như `goose` hay `golang-migrate` đều cấu hình được bảng version.
5. **Tuỳ chọn: role Postgres theo schema.** Mỗi module kết nối bằng role chỉ có quyền ghi schema của mình. Vi phạm ranh giới thành lỗi `permission denied` ngay lúc chạy test.

```sql
CREATE SCHEMA inventory;
CREATE ROLE inventory_rw LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA inventory TO inventory_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO inventory_rw;
```

Với checkout dùng một transaction xuyên module, cách này cần một role chung cho app. Có thể bắt đầu bằng quy tắc 1–4 cộng linter, chỉ thêm role khi thấy cần.

### 4.4 Outbox: sự kiện không bao giờ mất

Ghi sự kiện vào bảng trong cùng transaction với dữ liệu nghiệp vụ, rồi một worker đọc và xử lý. Chi tiết hơn về pattern này, xem bài [outbox pattern trong Go](/blog/outbox-pattern-golang/).

```sql
CREATE SCHEMA platform;

CREATE TABLE platform.outbox_events (
    id            bigserial   PRIMARY KEY,
    event_type    text        NOT NULL,
    aggregate_id  text        NOT NULL,
    payload       jsonb       NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    published_at  timestamptz
);

CREATE INDEX outbox_unpublished ON platform.outbox_events (id)
    WHERE published_at IS NULL;
```

```go
package outbox

func Publish(ctx context.Context, tx *sql.Tx, eventType, aggregateID string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO platform.outbox_events (event_type, aggregate_id, payload)
		VALUES ($1, $2, $3)`, eventType, aggregateID, b)
	return err
}
```

Worker dùng `FOR UPDATE SKIP LOCKED` để chạy nhiều bản song song mà không lấy trùng event:

```go
func (w *Worker) processBatch(ctx context.Context, limit int) error {
	return db.InTx(ctx, w.db, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT id, event_type, aggregate_id, payload
			  FROM platform.outbox_events
			 WHERE published_at IS NULL
			 ORDER BY id
			 LIMIT $1
			 FOR UPDATE SKIP LOCKED`, limit)
		if err != nil {
			return err
		}
		var events []Event
		for rows.Next() {
			var e Event
			if err := rows.Scan(&e.ID, &e.Type, &e.AggregateID, &e.Payload); err != nil {
				rows.Close()
				return err
			}
			events = append(events, e)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		for _, e := range events {
			for _, h := range w.handlers[e.Type] {
				if err := h(ctx, e); err != nil {
					// Dừng batch, commit những event đã xong; event này thử lại lần sau.
					return nil
				}
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE platform.outbox_events SET published_at = now() WHERE id = $1`, e.ID); err != nil {
				return err
			}
		}
		return nil
	})
}
```

Lắp ráp trong `cmd/worker/main.go`:

```go
w := outbox.NewWorker(conn)
w.Subscribe("payment.OrderPaid", fulfillment.OnOrderPaid)
w.Subscribe("payment.OrderPaid", notification.OnOrderPaid)
w.Subscribe("shipping.ShipmentDelivered", ordering.OnShipmentDelivered)
w.Subscribe("shipping.ShipmentDelivered", payment.OnShipmentDelivered)
w.Run(ctx)
```

Handler phải **idempotent**: outbox đảm bảo at-least-once, một event có thể được xử lý hai lần (worker chết sau khi handler chạy, trước khi commit). Handler gọi API bên ngoài (tạo vận đơn GHN) nên dùng idempotency key là `order_id` hoặc kiểm tra "đã tạo vận đơn cho đơn này chưa".

Ở 5.000–20.000 đơn/ngày, mỗi đơn sinh khoảng 5–10 event, tức vài trăm nghìn event/ngày. Postgres xử lý mức này thoải mái. Nhớ dọn định kỳ các event đã `published_at` cũ hơn vài ngày.

### 4.5 Redis: tách hai instance

| Instance | Dùng cho | `maxmemory-policy` | Mất dữ liệu thì sao |
|---|---|---|---|
| **redis-cache** | Cache sản phẩm, giá, session | `allkeys-lru` | Không sao, nạp lại từ DB |
| **redis-queue** | Tồn kho flash sale, rate limit, hàng đợi (nếu có) | `noeviction` | **Nghiêm trọng**: oversell hoặc mất job |

Dùng chung một instance thì đến lúc cache đầy, Redis sẽ xoá key theo LRU, và key tồn kho flash sale cũng có thể bị xoá. Chi tiết về cache giá và tồn kho trong flash sale, xem bài [cache invalidation và cache expire trong flash sale](/blog/cache-invalidation-flashsale/).

### 4.6 Khi nào tách DB, và tách thế nào

Dấu hiệu nên tách DB của một module:

- Module đó chiếm phần lớn tải ghi và làm chậm phần còn lại, dù đã tối ưu query và index.
- Cần chế độ vận hành khác: dữ liệu tracking giữ 2 năm, dung lượng lớn gấp 10 lần phần còn lại.
- Module chuẩn bị tách thành service riêng (mục 6).

Các bước tách, ví dụ `shipping`:

1. **Kiểm tra ranh giới**: không có code ngoài `shipping` đọc ghi schema `shipping`, không có FK chéo. Nhờ đã giữ quy tắc ở 4.3, bước này chủ yếu là xác nhận.
2. **Bỏ transaction chung**: chỗ nào truyền `*sql.Tx` vào `shipping` thì đổi thành giao tiếp qua outbox event.
3. **Tạo DB mới**, replicate schema `shipping` sang (logical replication hoặc dump/restore trong maintenance window).
4. **Chuyển connection** của module `shipping` sang DB mới qua config.
5. **Reporting** đọc thêm từ DB mới, hoặc đổ dữ liệu về một kho dữ liệu chung.

Vì từ đầu đã chia schema và không FK chéo, việc tách là vài ngày làm việc có kế hoạch, không phải vài tháng gỡ rối.

## 5. Làm việc với AI trong modular monolith

### 5.1 CLAUDE.md ở gốc và trong từng module

File ở gốc nói luật chơi chung:

```markdown
# CLAUDE.md (gốc)

## Kiến trúc
Modular monolith. Mỗi module trong internal/<module> sở hữu một schema Postgres cùng tên.

## Luật bắt buộc
- Chỉ gọi module khác qua interface trong <module>/<module>.go.
- Không đọc/ghi bảng của schema khác. Không FK chéo schema.
- Việc xảy ra sau (email, tạo vận đơn): phát event qua outbox.Publish trong cùng tx.
- Handler event phải idempotent.

## Lệnh
- make test        # toàn bộ test, cần Docker cho Postgres
- make lint        # golangci-lint + go-arch-lint (CI chặn nếu fail)
- make migrate m=inventory
```

File trong từng module nói về chính module đó:

```markdown
# internal/shipping/CLAUDE.md

## Trách nhiệm
Tạo vận đơn qua GHN/GHTK/J&T, nhận webhook, máy trạng thái vận đơn, sổ COD.

## Sở hữu
Schema shipping: shipments, carrier_events, cod_ledger.

## Phát event
- shipping.ShipmentDelivered {order_id, tracking_code}
- shipping.ShipmentFailed {order_id, reason}

## Nhận event
- fulfillment.PackageReady → tạo vận đơn (idempotent theo order_id)

## Lưu ý
- Trạng thái không bao giờ lùi: sửa allowed trong state.go phải sửa cả state_test.go.
- cod_ledger chỉ INSERT, không UPDATE/DELETE.
- Thêm hãng mới: tạo package con implement Carrier, không sửa code ngoài shipping.

## Test
go test ./internal/shipping/...
```

### 5.2 Giao việc theo module

Prompt tốt cho AI có phạm vi bằng một module và một hợp đồng rõ:

| Kém | Tốt |
|---|---|
| "Thêm hỗ trợ J&T" | "Viết package `internal/shipping/jnt` implement `shipping.Carrier`. Map mã trạng thái J&T theo bảng sau về `ShipmentStatus`. Kèm test `ParseWebhook` với 3 payload mẫu. Không sửa file ngoài `internal/shipping/jnt`." |
| "Sửa lỗi đơn bị trạng thái sai" | "Webhook `delivered` đến trước `out_for_delivery` làm vận đơn kẹt. Viết test tái hiện trong `internal/shipping`, rồi sửa." |

Ranh giới module giúp AI không "tiện tay" sửa lung tung, và giúp bạn review: diff chỉ nên nằm trong module được giao, cộng phần wiring ở `cmd/`.

### 5.3 Lưới an toàn

**Test máy trạng thái** là test rẻ nhất mà đáng giá nhất. Máy trạng thái đơn hàng và vận đơn là chỗ bug đắt tiền nhất (giao rồi lại thành đang giao, đơn huỷ rồi vẫn tạo vận đơn):

```go
func TestShipmentNeverMovesBackward(t *testing.T) {
	cases := []struct {
		from, to ShipmentStatus
		want     bool
	}{
		{StatusCreated, StatusPickedUp, true},
		{StatusOutForDelivery, StatusDelivered, true},
		{StatusDelivered, StatusInTransit, false},
		{StatusDelivered, StatusFailed, false},
		{StatusInTransit, StatusPickedUp, false},
		{StatusFailed, StatusReturned, true},
	}
	for _, c := range cases {
		if got := CanTransition(c.from, c.to); got != c.want {
			t.Errorf("%v -> %v: got %v, want %v", c.from, c.to, got, c.want)
		}
	}
}
```

Ba lớp CI chặn trước khi merge:

1. `go test ./...` với Postgres thật (testcontainers hoặc service trong CI), không mock DB cho các test transaction.
2. `go-arch-lint check` / `depguard`: import sai ranh giới thì fail.
3. Test hợp đồng event: payload của `ShipmentDelivered` đổi field thì test của bên nhận fail.

Đo xem hệ thống có đáp ứng không (checkout thành công, webhook xử lý kịp) thì dùng SLO, xem bài [SLI, SLO, SLA và error budget](/blog/sli-slo-sla-error-budget/).

## 6. Khi nào tách service

### 6.1 Dấu hiệu cụ thể

Tách khi có **ít nhất một** dấu hiệu thật, không phải vì "sau này sẽ lớn":

| Dấu hiệu | Ví dụ trong shop |
|---|---|
| Tải khác hẳn phần còn lại | Webhook tracking: 20.000 đơn × 5–10 webhook/đơn, dồn cục vào giờ giao hàng |
| Yêu cầu tài nguyên khác | Reporting cần nhiều RAM, chạy job nặng ban đêm |
| Chu kỳ release khác | Adapter hãng vận chuyển đổi liên tục theo API của hãng |
| Có team riêng sở hữu | Tuyển thêm 3 dev chỉ làm logistics |
| Lỗi của module làm ảnh hưởng checkout dù đã tách entrypoint | Hiếm, nhưng có thể xảy ra |

### 6.2 Bước trung gian: tách entrypoint trước khi tách code

Một codebase đã có `cmd/api`, `cmd/worker`, `cmd/webhook`. Mỗi cái build ra một binary (hoặc cùng image, khác lệnh chạy), deploy thành **deployment riêng, scale riêng**:

| Deployment | Chạy | Scale theo |
|---|---|---|
| `shop-api` | `cmd/api` | Request/s, latency checkout; tăng mạnh khi flash sale |
| `shop-webhook` | `cmd/webhook` | Request/s từ hãng vận chuyển, cổng thanh toán |
| `shop-worker` | `cmd/worker` | Độ trễ của outbox (event chưa xử lý cũ nhất) |

Webhook chậm không làm chậm checkout. Worker bị OOM không làm sập API. Đây đã là phần lớn lợi ích "cô lập lỗi" của microservices, với chi phí gần bằng không: vẫn một codebase, một DB, một transaction.

Phần lớn shop ở quy mô 5.000–20.000 đơn/ngày dừng ở bước này là đủ.

### 6.3 Khi tách thật: strangler pattern + outbox

Ví dụ tách `shipping` thành service riêng:

1. **Ranh giới đã có**: interface `Carrier`, schema `shipping`, event `ShipmentDelivered`. Đây là lợi ích của việc giữ kỷ luật từ đầu.
2. **Dựng service mới** chạy cùng code `internal/shipping` (copy hoặc tách thành Go module riêng).
3. **Strangler**: chuyển dần từng luồng. Đầu tiên webhook J&T trỏ về service mới, rồi GHTK, rồi GHN. Luồng nào chưa chuyển vẫn chạy trong monolith.
4. **Thay lời gọi trong cùng process bằng event**: monolith phát `PackageReady` qua outbox, service shipping nhận qua broker hoặc qua API pull outbox. Service shipping phát `ShipmentDelivered` ngược lại.
5. **Tách DB** theo mục 4.6.
6. **Xoá code shipping khỏi monolith** khi mọi luồng đã chuyển và chạy ổn định vài tuần.

Bất cứ lúc nào cũng có thể dừng lại hoặc quay lui một luồng, vì mỗi bước đều nhỏ.

## 7. Checklist

**Lựa chọn**
- Team 1–2 người, một sản phẩm: modular monolith, một repo, một codebase.
- Biết rõ trường hợp không hợp: còn tìm PMF, nghiệp vụ chuẩn dùng SaaS, phần có yêu cầu kỹ thuật đặc biệt.

**Module**
- Mỗi module một thư mục `internal/<module>`, chỉ lộ interface; implementation private.
- `platform` chỉ có hạ tầng, không import module nghiệp vụ.
- CI chạy `go-arch-lint`/`depguard`, fail khi vi phạm ranh giới.
- Cần kết quả ngay thì gọi đồng bộ; việc xảy ra sau thì phát event qua outbox.

**Logistics**
- Webhook hãng vận chuyển: unique `(carrier, event_id)`, máy trạng thái không lùi.
- Một interface `Carrier`, mỗi hãng một package adapter.
- COD đối soát bằng ledger chỉ thêm, không sửa.
- Tồn kho theo `(sku, warehouse_id)` ngay từ đầu.

**Database**
- Một Postgres, mỗi module một schema; một transaction cho checkout.
- Mỗi schema chỉ một module ghi; reporting chỉ đọc, trên read replica.
- Không FK chéo schema; migration theo module.
- Outbox trong Postgres, worker `FOR UPDATE SKIP LOCKED`, handler idempotent, dọn event cũ.
- Redis cache (`allkeys-lru`) và Redis queue/tồn kho (`noeviction`) tách riêng.

**AI**
- CLAUDE.md ở gốc (luật chung) và trong từng module (trách nhiệm, event phát/nhận, cách test).
- Giao việc theo module, có hợp đồng rõ; review diff có nằm trong module không.
- Test máy trạng thái đơn/vận đơn; test với Postgres thật; CI chặn vi phạm ranh giới.

**Tăng trưởng**
- Tách entrypoint `api`/`worker`/`webhook` thành deployment riêng trước.
- Chỉ tách service khi có dấu hiệu thật; dùng strangler + outbox, từng luồng một.

Modular monolith không phải là "chưa đủ trình làm microservices". Với team 1–2 người cộng AI, nó là kiến trúc giúp **một người hiểu được toàn bộ hệ thống, AI sửa được xuyên module một cách an toàn, và vẫn giữ đường lui để tách service** khi thật sự cần.
