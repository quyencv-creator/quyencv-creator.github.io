---
title: Transactional Outbox Pattern với Golang
description: Cách ghi dữ liệu và publish event một cách nhất quán, không mất message, bằng outbox pattern trong Go + PostgreSQL.
pubDate: 2026-11-20
tags: [golang, microservices, outbox-pattern]
---

## Vấn đề: dual write

Một service tạo đơn hàng thường phải làm hai việc: **lưu đơn vào database** và **publish event** `OrderCreated` lên Kafka/RabbitMQ để các service khác xử lý.

```go
func (s *Service) CreateOrder(ctx context.Context, o Order) error {
	if err := s.repo.Insert(ctx, o); err != nil {
		return err
	}
	return s.broker.Publish(ctx, "order.created", o) // nếu bước này lỗi thì sao?
}
```

Hai thao tác này không nằm trong cùng một transaction:

- Insert thành công, publish lỗi (broker sập, timeout) → đơn tồn tại nhưng không ai biết.
- Publish trước, insert lỗi → các service khác xử lý một đơn không tồn tại.

Đây là bài toán **dual write**. Không thể giải bằng retry đơn thuần, vì process có thể chết giữa hai bước.

## Ý tưởng của outbox pattern

Thay vì publish trực tiếp, ta **ghi event vào một bảng `outbox` trong cùng transaction** với dữ liệu nghiệp vụ. Một tiến trình riêng (relay) đọc bảng outbox và publish lên broker.

```
┌──────────── 1 transaction ────────────┐
│  INSERT orders      INSERT outbox     │
└───────────────────────────────────────┘
                 │
          Relay (poll) ──► Kafka / RabbitMQ
```

Vì database đảm bảo tính atomic, hoặc cả đơn hàng và event cùng được lưu, hoặc không có gì cả.

## Bảng outbox

```sql
CREATE TABLE outbox (
    id            BIGSERIAL PRIMARY KEY,
    aggregate_id  TEXT        NOT NULL,
    event_type    TEXT        NOT NULL,
    payload       JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
```

## Ghi dữ liệu và event trong một transaction

```go
type Order struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	Amount int64  `json:"amount"`
}

func (s *Service) CreateOrder(ctx context.Context, o Order) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() // no-op nếu đã commit

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO orders (id, user_id, amount) VALUES ($1, $2, $3)`,
		o.ID, o.UserID, o.Amount,
	); err != nil {
		return fmt.Errorf("insert order: %w", err)
	}

	payload, err := json.Marshal(o)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1, $2, $3)`,
		o.ID, "order.created", payload,
	); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}

	return tx.Commit()
}
```

## Relay: đọc outbox và publish

Relay chạy như một goroutine (hoặc một process riêng), định kỳ lấy một batch event chưa publish:

```go
type Publisher interface {
	Publish(ctx context.Context, topic, key string, payload []byte) error
}

type Relay struct {
	db        *sql.DB
	pub       Publisher
	batchSize int
	interval  time.Duration
}

func (r *Relay) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.processBatch(ctx); err != nil {
				log.Printf("outbox relay: %v", err)
			}
		}
	}
}

func (r *Relay) processBatch(ctx context.Context) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// SKIP LOCKED cho phép chạy nhiều relay song song mà không xử lý trùng.
	rows, err := tx.QueryContext(ctx, `
		SELECT id, aggregate_id, event_type, payload
		FROM outbox
		WHERE published_at IS NULL
		ORDER BY id
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, r.batchSize)
	if err != nil {
		return err
	}

	type event struct {
		id         int64
		key, topic string
		payload    []byte
	}
	var events []event
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.id, &e.key, &e.topic, &e.payload); err != nil {
			rows.Close()
			return err
		}
		events = append(events, e)
	}
	rows.Close()

	for _, e := range events {
		if err := r.pub.Publish(ctx, e.topic, e.key, e.payload); err != nil {
			return fmt.Errorf("publish %d: %w", e.id, err) // rollback, lần sau thử lại
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE outbox SET published_at = now() WHERE id = $1`, e.id,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
```

Khởi động trong `main`:

```go
relay := &Relay{db: db, pub: kafkaPub, batchSize: 100, interval: 500 * time.Millisecond}
go relay.Run(ctx)
```

## Những điều cần lưu ý

**At-least-once, không phải exactly-once.** Nếu relay publish xong nhưng chết trước khi commit `published_at`, event sẽ được publish lại. Consumer phải **idempotent**, ví dụ lưu `event_id` đã xử lý vào bảng `processed_events` và bỏ qua nếu trùng.

**Thứ tự.** `ORDER BY id` giữ thứ tự trong một relay. Dùng `aggregate_id` làm partition key khi publish lên Kafka để các event của cùng một đơn hàng đi vào cùng partition.

**Dọn dẹp.** Bảng outbox sẽ phình to; chạy job xoá định kỳ:

```sql
DELETE FROM outbox WHERE published_at < now() - interval '7 days';
```

**Polling vs CDC.** Polling đơn giản, đủ dùng cho đa số hệ thống. Khi cần độ trễ thấp hoặc throughput lớn, có thể thay relay bằng **Change Data Capture** (Debezium đọc WAL của PostgreSQL) — code ghi outbox giữ nguyên.

## Tóm tắt

| | Publish trực tiếp | Outbox pattern |
|---|---|---|
| Nhất quán DB ↔ broker | Không đảm bảo | Đảm bảo (atomic) |
| Mất event khi broker sập | Có | Không, relay retry |
| Trùng lặp event | Ít | Có thể → consumer idempotent |
| Độ phức tạp | Thấp | Thêm bảng + relay |

Outbox pattern đổi một chút phức tạp lấy sự an tâm: dữ liệu và event không bao giờ lệch nhau, kể cả khi broker hay service gặp sự cố.
