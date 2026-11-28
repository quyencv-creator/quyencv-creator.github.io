---
title: Race condition trong Rails — Pessimistic Lock vs Optimistic Lock
description: Race condition xảy ra thế nào trong Rails, cách dùng pessimistic lock và optimistic lock, ưu nhược điểm, khi nào nên chọn cái nào và các bài toán thực tế hay gặp.
pubDate: 2026-02-10
tags: [ruby, database, backend]
---

## Race condition là gì

Race condition xảy ra khi **hai hoặc nhiều tiến trình cùng đọc rồi ghi một dữ liệu**, và kết quả cuối cùng phụ thuộc vào thứ tự chạy — thứ tự mà ta không kiểm soát được.

Trong Rails, nguồn concurrency đến từ khắp nơi: nhiều Puma worker/thread, nhiều Sidekiq job, nhiều server sau load balancer. Code chạy đúng trên máy dev (1 request mỗi lần) vẫn có thể sai trên production.

Ví dụ kinh điển — trừ tồn kho:

```ruby
class OrdersController < ApplicationController
  def create
    product = Product.find(params[:product_id])

    if product.stock >= params[:quantity].to_i
      product.update!(stock: product.stock - params[:quantity].to_i)
      Order.create!(product: product, quantity: params[:quantity])
    else
      render json: { error: "Hết hàng" }, status: :unprocessable_entity
    end
  end
end
```

Kho còn `stock = 1`, hai request đến cùng lúc:

```
Request A                     Request B
SELECT stock → 1
                              SELECT stock → 1
1 >= 1 ✔
                              1 >= 1 ✔
UPDATE stock = 0
                              UPDATE stock = 0
Order A created               Order B created   ← bán 2 sản phẩm, kho chỉ có 1
```

Đây là pattern **read-modify-write**: đọc giá trị vào Ruby, tính toán, rồi ghi đè lại. Mọi chỗ có pattern này trên dữ liệu dùng chung đều là ứng viên race condition.

> Bọc trong `transaction` **không** giải quyết vấn đề. Ở isolation level mặc định (READ COMMITTED của PostgreSQL, REPEATABLE READ của MySQL), hai transaction vẫn đọc được cùng giá trị `stock = 1`. Transaction đảm bảo atomic, không đảm bảo tuần tự hoá.

## Pessimistic Lock

**Ý tưởng:** "Tôi bi quan, tôi tin là sẽ có xung đột, nên khoá dòng dữ liệu lại trước khi đọc." Rails dùng `SELECT ... FOR UPDATE` ở tầng database.

```ruby
def create
  Product.transaction do
    product = Product.lock.find(params[:product_id])
    # SELECT * FROM products WHERE id = ? LIMIT 1 FOR UPDATE

    raise OutOfStock if product.stock < quantity

    product.update!(stock: product.stock - quantity)
    Order.create!(product: product, quantity: quantity)
  end
end
```

Request B sẽ **bị chặn** ở câu `SELECT ... FOR UPDATE` cho tới khi A commit/rollback, rồi mới đọc được `stock = 0` → báo hết hàng.

Các cách viết khác:

```ruby
# Lock bản ghi đã load sẵn (reload + FOR UPDATE)
product = Product.find(id)
product.lock!

# Mở transaction + lock trong một bước
product.with_lock do
  product.decrement!(:stock, quantity)
end

# Tuỳ biến lock clause (PostgreSQL/MySQL 8+)
Product.lock("FOR UPDATE NOWAIT").find(id)       # không chờ, lỗi ngay nếu bị khoá
Product.lock("FOR UPDATE SKIP LOCKED").where(...) # bỏ qua dòng đang bị khoá
```

### Lưu ý quan trọng

- **Lock chỉ có tác dụng trong transaction.** `Product.lock.find(id)` ngoài transaction sẽ nhả lock ngay sau câu SELECT (autocommit) — vô dụng.
- **`lock!` sẽ reload record**, mọi thay đổi chưa save trên object sẽ mất.
- **Deadlock:** A khoá product 1 rồi chờ product 2, B khoá product 2 rồi chờ product 1. Cách tránh: luôn lock theo một thứ tự cố định.

  ```ruby
  Product.transaction do
    products = Product.where(id: ids).order(:id).lock.to_a
    # ...
  end
  ```

- Không gọi HTTP API, gửi mail, hay việc gì chậm bên trong block đang giữ lock.

### Ưu điểm

- Đảm bảo tuyệt đối: không bao giờ có hai tiến trình cùng sửa một dòng.
- Logic đơn giản, không cần retry, user không thấy lỗi xung đột.
- Phù hợp khi xung đột xảy ra **thường xuyên**.

### Nhược điểm

- Giảm throughput: các request trên cùng dòng phải xếp hàng. Hot row (1 sản phẩm flash sale) thành nút cổ chai.
- Giữ connection DB lâu hơn → dễ cạn connection pool khi traffic cao.
- Nguy cơ deadlock, lock wait timeout.
- Không dùng được cho xung đột kéo dài qua nhiều request (user mở form 10 phút rồi mới bấm lưu).

## Optimistic Lock

**Ý tưởng:** "Tôi lạc quan, xung đột hiếm khi xảy ra. Không khoá gì cả, nhưng khi ghi thì kiểm tra xem dữ liệu có bị ai sửa trong lúc đó không."

Rails hỗ trợ sẵn qua cột `lock_version`:

```ruby
class AddLockVersionToProducts < ActiveRecord::Migration[7.2]
  def change
    add_column :products, :lock_version, :integer, default: 0, null: false
  end
end
```

Chỉ cần có cột này, ActiveRecord tự động bật optimistic locking. Mỗi lần `update`:

```sql
UPDATE products
SET stock = 0, lock_version = 6
WHERE id = 1 AND lock_version = 5
```

Nếu số dòng bị ảnh hưởng là 0 (đã có người tăng `lock_version`), Rails raise `ActiveRecord::StaleObjectError`.

```ruby
def create
  retries = 0
  begin
    Product.transaction do
      product = Product.find(params[:product_id])
      raise OutOfStock if product.stock < quantity

      product.update!(stock: product.stock - quantity)
      Order.create!(product: product, quantity: quantity)
    end
  rescue ActiveRecord::StaleObjectError
    retries += 1
    retry if retries < 3
    render json: { error: "Dữ liệu vừa thay đổi, vui lòng thử lại" }, status: :conflict
  end
end
```

### Optimistic lock cho form (xung đột giữa nhiều request)

Đây là chỗ optimistic lock toả sáng. Hai admin cùng mở trang sửa bài viết, ai lưu sau sẽ ghi đè người trước mà không biết. Gửi `lock_version` qua form:

```erb
<%= form_with model: @article do |f| %>
  <%= f.hidden_field :lock_version %>
  <%= f.text_field :title %>
  <%= f.submit %>
<% end %>
```

```ruby
def update
  @article = Article.find(params[:id])
  if @article.update(article_params) # article_params permit :lock_version
    redirect_to @article
  else
    render :edit, status: :unprocessable_entity
  end
rescue ActiveRecord::StaleObjectError
  @article.reload
  flash.now[:alert] = "Bài viết đã được người khác chỉnh sửa. Hãy xem lại trước khi lưu."
  render :edit, status: :conflict
end
```

Pessimistic lock không làm được việc này, vì không thể giữ transaction mở trong lúc user đang gõ.

### Ưu điểm

- Không chặn ai: đọc/ghi song song, throughput cao.
- Không deadlock, không giữ connection lâu.
- Hoạt động xuyên suốt nhiều request (form edit, API client giữ version / ETag).

### Nhược điểm

- Phải xử lý `StaleObjectError`: retry hoặc báo user. Quên rescue là 500.
- Khi xung đột **nhiều**, retry liên tục → lãng phí, thậm chí tệ hơn pessimistic (thundering herd).
- Mọi `update` đều tăng `lock_version`, kể cả cập nhật không liên quan (ví dụ `view_count`) → xung đột giả. Cân nhắc tách cột hay bị cập nhật sang bảng khác.
- `update_all`, `update_columns`, `increment!` không kiểm tra `lock_version` → dễ bypass mà không biết.

## So sánh nhanh

| | Pessimistic | Optimistic |
|---|---|---|
| Cơ chế | `SELECT ... FOR UPDATE`, chặn trước | Kiểm tra `lock_version` khi ghi |
| Tần suất xung đột phù hợp | Cao | Thấp |
| Throughput | Thấp hơn | Cao hơn |
| Deadlock | Có thể | Không |
| Xử lý ở app | Gần như không | Phải rescue + retry/báo lỗi |
| Xuyên nhiều request | Không | Có |
| Thao tác bên trong | Phải ngắn | Có thể dài |

## Khi nào dùng cái nào

**Dùng pessimistic lock khi:**

- Xung đột xảy ra thường xuyên trên cùng một dòng.
- Sai một lần là mất tiền hoặc vi phạm nghiệp vụ nghiêm trọng (số dư, tồn kho, ghế ngồi).
- Thao tác ngắn, nằm gọn trong một transaction.
- Không chấp nhận được việc user nhận lỗi "thử lại".

**Dùng optimistic lock khi:**

- Xung đột hiếm (mỗi user sửa dữ liệu của chính mình, CMS ít người cùng sửa).
- Cần phát hiện "lost update" giữa nhiều request — form edit, API PATCH.
- Hệ thống đọc nhiều, cần throughput cao, không muốn giữ connection.
- Chấp nhận được việc báo conflict hoặc retry.

**Không dùng cả hai, khi có cách đơn giản hơn:**

Nhiều trường hợp chỉ cần một câu SQL atomic, không cần lock nào cả:

```ruby
# Trừ kho atomic, điều kiện nằm trong WHERE
affected = Product.where(id: id)
                  .where("stock >= ?", quantity)
                  .update_all(["stock = stock - ?", quantity])
raise OutOfStock if affected.zero?

# Tăng counter
Post.update_counters(post_id, views_count: 1)
```

Câu `UPDATE` tự khoá dòng trong thời gian rất ngắn, database tự tuần tự hoá. Nhanh hơn cả hai loại lock ở trên. Nhược điểm: bỏ qua validation và callback.

Với bài toán "không được trùng" (một email một tài khoản, một user chỉ vote một lần), **unique index** mới là câu trả lời, không phải lock:

```ruby
add_index :votes, [:user_id, :post_id], unique: true

begin
  Vote.create!(user: current_user, post: post)
rescue ActiveRecord::RecordNotUnique
  # đã vote rồi
end
```

`validates :uniqueness` của Rails **không** chống race condition — nó chỉ là một câu SELECT trước khi INSERT. Luôn cần unique index đi kèm. Rails 6+ có `create_or_find_by` dựa trên chính cơ chế này.

## Các bài toán hay gặp

**1. Trừ tồn kho / flash sale** — Pessimistic lock hoặc atomic `UPDATE ... WHERE stock >= ?`. Với flash sale cực nóng, cả hai đều nghẽn trên một dòng; giải pháp thường là đưa vào Redis (`DECRBY`) hoặc queue rồi đồng bộ về DB.

**2. Số dư ví / chuyển tiền** — Pessimistic lock, lock cả hai tài khoản theo thứ tự id để tránh deadlock:

```ruby
Account.transaction do
  from, to = Account.where(id: [from_id, to_id]).order(:id).lock.to_a
              .partition { |a| a.id == from_id }.map(&:first)
  raise InsufficientFunds if from.balance < amount
  from.update!(balance: from.balance - amount)
  to.update!(balance: to.balance + amount)
end
```

**3. Đặt chỗ (vé, ghế, phòng khách sạn, lịch hẹn)** — Pessimistic lock trên dòng ghế/slot, hoặc unique index trên `(seat_id, show_id)`.

**4. Admin / CMS cùng sửa một bản ghi** — Optimistic lock với `lock_version` qua form.

**5. Background job xử lý queue tự chế** — `FOR UPDATE SKIP LOCKED` để nhiều worker lấy job khác nhau, không chờ nhau. Đây là cách Solid Queue và GoodJob hoạt động.

```ruby
Job.transaction do
  job = Job.where(status: "pending").order(:id).lock("FOR UPDATE SKIP LOCKED").first
  next unless job
  job.update!(status: "running")
end
```

**6. Sidekiq job chạy trùng (callback, webhook gửi lại)** — Idempotency key + unique index, hoặc `with_lock` rồi kiểm tra trạng thái trước khi xử lý:

```ruby
order.with_lock do
  return if order.paid?
  order.update!(status: "paid")
end
```

**7. Counter (view, like)** — `update_counters` / `increment_counter`, không dùng lock.

**8. Khoá theo khái niệm, không phải theo dòng** (ví dụ "chỉ một tiến trình được sinh báo cáo tháng này") — Advisory lock của PostgreSQL (`pg_advisory_xact_lock`, gem `with_advisory_lock`) hoặc Redis lock. Lưu ý Redis lock không an toàn tuyệt đối khi có network partition, không nên dùng cho dữ liệu tài chính.

## Kiểm tra bằng test

Race condition không lộ ra trong test thông thường. Có thể tái hiện bằng thread:

```ruby
it "không bán quá số lượng tồn kho" do
  product = Product.create!(stock: 1)

  threads = 5.times.map do
    Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        PurchaseService.call(product_id: product.id, quantity: 1)
      rescue OutOfStock
      end
    end
  end
  threads.each(&:join)

  expect(product.reload.stock).to eq(0)
  expect(Order.count).to eq(1)
end
```

Test này cần tắt transactional fixtures (`self.use_transactional_tests = false` hoặc dùng `DatabaseCleaner` strategy `:truncation`), vì mỗi thread dùng connection riêng và không thấy dữ liệu trong transaction chưa commit của test.

## Kết

- Thấy pattern đọc → tính trong Ruby → ghi lại trên dữ liệu dùng chung: nghĩ ngay đến race condition.
- Ưu tiên giải pháp ở tầng database trước: atomic `UPDATE`, unique index.
- Xung đột nhiều, dữ liệu quan trọng, thao tác ngắn → pessimistic.
- Xung đột ít, hoặc xung đột kéo dài qua nhiều request → optimistic.
