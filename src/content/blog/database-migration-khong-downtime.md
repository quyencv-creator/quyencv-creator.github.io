---
title: "Database migration không downtime"
description: "Một câu ALTER TABLE chạy mất 1 mili giây vẫn có thể làm treo cả hệ thống. Đo trên PostgreSQL 16 với bảng 2 triệu dòng: hàng đợi lock, lock_timeout, thêm cột, đổi kiểu, tạo index, thêm NOT NULL, backfill theo lô, và mô hình expand-contract để code cũ và mới cùng chạy được trong lúc deploy."
pubDate: 2026-11-28
draft: true
tags: [database, backend, devops]
---

Một buổi chiều, team deploy một migration rất đơn giản: thêm một cột `boolean` vào bảng `orders`. Trên máy dev, câu lệnh chạy xong trong chưa tới một mili giây. Trên production, ngay khi migration bắt đầu, mọi request đọc đơn hàng đều treo. Năm giây sau, mọi thứ trở lại bình thường như chưa có gì xảy ra. Nhưng trong năm giây đó, hàng nghìn request đã timeout.

Câu lệnh không chậm. Thứ làm treo hệ thống là **cái khoá mà nó phải chờ để được chạy**.

Bài này đi qua những thao tác đổi schema hay gặp, đo trực tiếp trên PostgreSQL 16 với một bảng `orders` 2 triệu dòng, để thấy cái nào an toàn, cái nào nguy hiểm, và làm sao để đổi schema mà hệ thống vẫn chạy bình thường. Các con số chạy trên một máy local, không tải. Trên production với dữ liệu lớn hơn và tải thật, thời gian sẽ dài hơn, nhưng tỉ lệ giữa các cách làm thì tương tự.

## Kẻ thù thật sự: hàng đợi lock

Gần như mọi câu `ALTER TABLE` trong PostgreSQL cần một lock mạnh nhất là `ACCESS EXCLUSIVE`, nghĩa là không ai khác được đọc hay ghi bảng trong lúc nó giữ lock. Với những thay đổi nhỏ như thêm một cột không có giá trị mặc định, lock chỉ được giữ trong khoảnh khắc, nên nghe có vẻ vô hại.

Vấn đề nằm ở **thời gian chờ để lấy được lock**. Nếu đang có một transaction khác dùng bảng đó (một báo cáo chạy lâu, một job nền, một transaction ai đó quên commit), câu `ALTER` phải xếp hàng chờ. Và trong lúc nó chờ, **mọi câu truy vấn tới sau, kể cả `SELECT` đơn giản nhất, đều phải xếp hàng sau nó**.

Thử nghiệm:

1. Session A mở một transaction, đọc bảng `orders`, rồi giữ transaction đó 6 giây (mô phỏng một báo cáo chạy lâu).
2. Session B chạy `ALTER TABLE orders ADD COLUMN flag boolean;`
3. Session C chạy `SELECT total FROM orders WHERE id = 1;`, câu truy vấn theo khoá chính, bình thường mất dưới một mili giây.

Kết quả:

```text
Session C (SELECT theo id):   5009 ms
Session B (ALTER TABLE):      5511 ms
```

Một câu `SELECT` theo khoá chính mất **5 giây**. Không phải vì câu `ALTER` chậm, mà vì nó phải chờ session A, và session C phải chờ sau nó. Trên production, session C không phải là một câu truy vấn mà là toàn bộ traffic vào bảng đó.

### Luôn đặt `lock_timeout`

Cách phòng thủ quan trọng nhất: không cho migration chờ lock quá lâu. Nếu không lấy được lock trong vài giây thì bỏ cuộc và thử lại sau, thay vì làm treo cả hệ thống.

```sql
SET lock_timeout = '2s';
ALTER TABLE orders ADD COLUMN flag2 boolean;
```

Chạy lại đúng thử nghiệm trên với `lock_timeout = 2s`:

```text
Session C (SELECT theo id):   1490 ms
Session B (ALTER TABLE):      ERROR: canceling statement due to lock timeout (2000 ms)
```

Câu `SELECT` vẫn phải chờ, nhưng chỉ tới khi `ALTER` bỏ cuộc, chứ không phải chờ hết transaction dài. Migration lỗi, nhưng hệ thống vẫn sống, và bạn có thể chạy lại migration vào lúc khác. Đây là đánh đổi đúng: một migration lỗi thì sửa được, còn năm phút downtime thì khách hàng đã thấy rồi.

Kèm theo nên đặt thêm `statement_timeout` cho phiên chạy migration, để không có câu lệnh nào vô tình chạy hàng giờ.

## Thao tác nào an toàn, thao tác nào không?

Đo trên bảng `orders` 2 triệu dòng:

| Thao tác | Thời gian | Ghi chú |
|---|---|---|
| Thêm cột, không default | dưới 1 ms | An toàn (vẫn cần `lock_timeout`) |
| Thêm cột, default là hằng số (`DEFAULT 'VND'`) | 0,9 ms | An toàn từ PostgreSQL 11 |
| Thêm cột, default thay đổi theo dòng (`DEFAULT gen_random_uuid()`) | 4.312 ms | **Ghi lại toàn bộ bảng**, khoá suốt thời gian đó |
| Đổi kiểu cột `int` sang `bigint` | 2.029 ms | **Ghi lại toàn bộ bảng** |
| `CREATE INDEX` | 635 ms | **Chặn ghi** trong suốt thời gian tạo |
| `CREATE INDEX CONCURRENTLY` | 1.075 ms | Chậm hơn, nhưng không chặn ghi |
| `SET NOT NULL` trực tiếp | 238 ms | **Quét toàn bộ bảng** trong khi giữ lock mạnh |
| `SET NOT NULL` sau khi đã có `CHECK` hợp lệ | 0,8 ms | Bỏ qua bước quét |

Với 2 triệu dòng, vài giây nghe có vẻ chấp nhận được. Với 200 triệu dòng, những thao tác ghi lại toàn bộ bảng có thể mất hàng chục phút, và trong suốt thời gian đó không ai đọc hay ghi được bảng.

## Từng trường hợp cụ thể

### Tạo index: luôn dùng `CONCURRENTLY`

`CREATE INDEX` thường chặn mọi thao tác ghi (`INSERT`, `UPDATE`, `DELETE`) vào bảng cho tới khi tạo xong. `CREATE INDEX CONCURRENTLY` tạo index mà không chặn ghi, đổi lại chậm hơn (1.075 ms so với 635 ms trong thử nghiệm) vì phải quét bảng nhiều lần.

```sql
CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);
```

Hai điều cần biết:

- `CONCURRENTLY` **không chạy được trong transaction**. Nhiều công cụ migration mặc định bọc mỗi migration trong một transaction, nên phải tắt riêng cho migration này.
- Nếu bị lỗi giữa chừng, nó để lại một index ở trạng thái `INVALID`. Phải xoá đi (`DROP INDEX CONCURRENTLY`) rồi tạo lại.

### Thêm `NOT NULL`: đi đường vòng qua `CHECK`

`ALTER COLUMN ... SET NOT NULL` phải quét toàn bộ bảng để chắc chắn không có dòng nào `NULL`, và giữ lock mạnh suốt thời gian quét. Cách an toàn gồm ba bước:

```sql
-- 1. Thêm ràng buộc nhưng chưa kiểm tra dữ liệu cũ: gần như tức thì
ALTER TABLE orders ADD CONSTRAINT orders_note_not_null CHECK (note IS NOT NULL) NOT VALID;

-- 2. Kiểm tra dữ liệu cũ: có quét bảng, nhưng với lock yếu hơn, không chặn đọc ghi
ALTER TABLE orders VALIDATE CONSTRAINT orders_note_not_null;

-- 3. Từ PostgreSQL 12, nếu đã có CHECK hợp lệ thì SET NOT NULL bỏ qua bước quét
ALTER TABLE orders ALTER COLUMN note SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT orders_note_not_null;
```

Trong thử nghiệm, bước 3 chỉ mất 0,8 ms, so với 238 ms khi `SET NOT NULL` trực tiếp. Bước 2 mất 356 ms, nhưng trong thời gian đó hệ thống vẫn đọc ghi bình thường.

Cách tương tự áp dụng cho khoá ngoại: thêm với `NOT VALID`, rồi `VALIDATE CONSTRAINT` riêng.

### Thêm cột có giá trị mặc định

Từ PostgreSQL 11, thêm cột với default là **hằng số** không cần ghi lại bảng: 0,9 ms trong thử nghiệm. Nhưng nếu default là một hàm cho giá trị khác nhau ở mỗi dòng (như `gen_random_uuid()` hay `clock_timestamp()`), PostgreSQL phải ghi giá trị vào từng dòng: 4,3 giây với 2 triệu dòng, khoá bảng suốt thời gian đó.

Với trường hợp đó: thêm cột không có default, rồi backfill theo lô (phần dưới), rồi mới đặt default cho các dòng mới.

### Đổi kiểu cột, đổi tên cột: không làm trực tiếp

Đổi `int` sang `bigint` ghi lại toàn bộ bảng. Đổi tên cột thì nhanh, nhưng lập tức làm hỏng mọi phiên bản code đang dùng tên cũ. Cả hai đều cần mô hình **expand-contract** ở phần sau.

## Backfill theo lô

Khi cần điền dữ liệu cho một cột mới trên bảng lớn, đừng chạy một câu `UPDATE` cho cả bảng. Trong thử nghiệm, `UPDATE` 2 triệu dòng trong một lần mất **17 giây**. Trong suốt thời gian đó, mọi dòng bị khoá ghi, WAL phình to, replica bị trễ, và nếu có lỗi thì cả 17 giây bị rollback.

Thay vào đó, cập nhật theo lô nhỏ, mỗi lô một transaction ngắn, có nghỉ giữa các lô:

```go
func backfillCurrency(ctx context.Context, db *sql.DB) error {
    const batch = 5000
    var lastID int64
    for {
        var maxID sql.NullInt64
        err := db.QueryRowContext(ctx, `
            WITH b AS (
                SELECT id FROM orders
                WHERE id > $1 AND currency IS NULL
                ORDER BY id
                LIMIT $2
            ), u AS (
                UPDATE orders o SET currency = 'VND'
                FROM b WHERE o.id = b.id
                RETURNING o.id
            )
            SELECT max(id) FROM u`, lastID, batch).Scan(&maxID)
        if err != nil {
            return err
        }
        if !maxID.Valid {
            return nil // không còn dòng nào cần cập nhật
        }
        lastID = maxID.Int64
        time.Sleep(100 * time.Millisecond) // nhường tài nguyên cho traffic thật
    }
}
```

Vài nguyên tắc:

- **Duyệt theo khoá chính tăng dần** (`id > lastID`), không dùng `OFFSET`, để mỗi lô đều nhanh như nhau.
- **Chạy được lại từ giữa chừng**: điều kiện `currency IS NULL` khiến việc chạy lại sau khi bị ngắt là an toàn.
- **Theo dõi độ trễ replica** trong lúc backfill, và chậm lại nếu replica bị trễ.
- Chạy backfill như một **job riêng**, không nằm trong migration. Migration nên chạy nhanh và chỉ đổi schema.

## Expand-contract: để code cũ và mới cùng chạy được

Phần trên giải quyết chuyện khoá bảng. Nhưng còn một nguyên nhân downtime khác ít được để ý: **trong lúc deploy, code cũ và code mới chạy cùng lúc**.

Với rolling deploy, trong vài phút sẽ có cả pod chạy phiên bản cũ lẫn pod chạy phiên bản mới, cùng dùng chung một database. Nếu migration đổi tên cột `total` thành `amount`, thì ngay khi migration chạy xong, mọi pod cũ đang tìm cột `total` sẽ lỗi. Nếu deploy code mới trước, code mới tìm `amount` cũng lỗi.

Giải pháp là chia mọi thay đổi không tương thích thành nhiều bước, mỗi bước đều tương thích với cả code trước và sau nó. Người ta gọi là **expand-contract** (hay parallel change).

Ví dụ: đổi cột `total int` thành `amount bigint`.

1. **Expand**: thêm cột `amount bigint`, cho phép `NULL`. Code cũ không biết cột này, không sao.
2. **Ghi cả hai**: deploy code ghi vào cả `total` lẫn `amount`, vẫn đọc từ `total`.
3. **Backfill**: chép dữ liệu cũ từ `total` sang `amount` theo lô.
4. **Đọc cột mới**: deploy code đọc từ `amount`, vẫn ghi cả hai (phòng khi phải rollback về bước trước).
5. **Ngừng ghi cột cũ**: deploy code chỉ dùng `amount`.
6. **Contract**: xoá cột `total`.

Sáu bước cho một việc nghe như một câu lệnh. Đúng là tốn công hơn. Nhưng ở mỗi bước, bạn đều có thể dừng lại hoặc quay lui mà không mất dữ liệu và không có downtime. Với bảng nhỏ ít traffic, có thể gộp vài bước. Với bảng lõi như `orders`, `payments`, `users`, nên làm đủ.

### Xoá cột: báo cho code biết trước

Xoá cột tưởng an toàn nhất, nhưng có một cái bẫy với các ORM. Rails, chẳng hạn, đọc danh sách cột của bảng khi khởi động và có thể dùng danh sách đó khi sinh câu `INSERT`. Nếu cột bị xoá trong khi app đang chạy, các câu lệnh đó có thể lỗi cho tới khi app khởi động lại.

Cách làm: trước tiên deploy code bảo ORM bỏ qua cột đó, sau đó mới xoá cột.

```ruby
class Order < ApplicationRecord
  self.ignored_columns += ["legacy_status"]
end
```

## Trong Rails và Go

**Rails**: gem `strong_migrations` kiểm tra migration và báo lỗi khi thấy thao tác nguy hiểm (tạo index không concurrently, thêm cột có default nguy hiểm, đổi kiểu cột...), kèm hướng dẫn cách làm an toàn. Rất đáng cài cho mọi dự án Rails có dữ liệu thật. Tạo index concurrently trong Rails:

```ruby
class AddIndexOnOrdersUserId < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!

  def change
    add_index :orders, :user_id, algorithm: :concurrently
  end
end
```

**Go**: các công cụ migration phổ biến chạy file SQL thuần, nên mọi kỹ thuật trên áp dụng trực tiếp. Hai điều cần để ý: công cụ có tự bọc migration trong transaction không (nếu có, `CREATE INDEX CONCURRENTLY` sẽ lỗi), và đặt `lock_timeout` ngay đầu mỗi file migration.

```sql
-- 20261128_add_index_orders_user.up.sql
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user ON orders (user_id);
```

## Checklist trước khi chạy migration trên production

- **Đặt `lock_timeout`** (vài giây) và `statement_timeout` cho phiên chạy migration.
- **Kiểm tra transaction đang chạy lâu** trước khi migrate: `SELECT pid, now() - xact_start, query FROM pg_stat_activity WHERE state <> 'idle' ORDER BY 2 DESC;`
- **Index luôn tạo `CONCURRENTLY`**, ngoài transaction.
- **Constraint thêm với `NOT VALID`**, rồi `VALIDATE` riêng.
- **Không đổi kiểu, không đổi tên cột trực tiếp** trên bảng lớn: dùng expand-contract.
- **Backfill là job riêng**, theo lô, chạy lại được.
- **Code phải chạy được với cả schema trước và sau migration.**
- **Thử migration trên bản sao có kích thước gần production**, không chỉ trên database dev vài trăm dòng.
- **Chạy vào lúc ít traffic** nếu có thể, nhưng đừng coi đó là biện pháp an toàn duy nhất.

## Kết

Migration gây downtime hiếm khi vì câu lệnh chậm. Nó gây downtime vì những thứ không hiện ra trên máy dev: một transaction dài khiến lock phải xếp hàng, một thao tác ghi lại cả bảng mà trên dữ liệu nhỏ trông như tức thì, một khoảnh khắc code cũ gặp schema mới.

Hai thói quen giải quyết phần lớn vấn đề: **luôn đặt `lock_timeout`**, và **chia mọi thay đổi không tương thích thành các bước mà code cũ và mới đều chạy được**. Phần còn lại là biết thao tác nào khoá bảng, và tránh nó.
