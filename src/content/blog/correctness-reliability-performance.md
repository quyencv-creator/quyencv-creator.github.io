---
title: "3 điều quan trọng khi xây một hệ thống: đúng dữ liệu, phục hồi được, chịu được tải"
description: "Data correctness, system reliability, performance at scale qua một app Rails đặt phòng khách sạn: mỗi điều nằm ở đâu trong code và kiểm tra thế nào."
pubDate: 2026-11-22
tags: [ruby, rails, architecture, backend]
---

Khi nhìn vào một hệ thống, dù là review, thiết kế hay trực sự cố, mình hỏi ba câu theo đúng thứ tự này:

1. **Data correctness**: dữ liệu có đúng không, kể cả khi có concurrency, retry và lỗi?
2. **System reliability**: một thành phần chết thì hệ thống có tự phục hồi không?
3. **Performance at scale**: traffic tăng 10 lần thì có còn nhanh không?

Thứ tự quan trọng. Nhanh mà sai thì vô dụng. Đúng mà sập là mất tiền. Chỉ khi đúng và bền rồi mới tối ưu tốc độ.

Ví dụ: một app **Rails đặt phòng khách sạn**. User tìm phòng, chọn ngày, giữ phòng, thanh toán, nhận email xác nhận.

## 1. Data correctness

**Câu hỏi:** hai người cùng bấm "Đặt" phòng cuối cùng thì sao? Request bị retry thì sao?

| Chỗ dễ sai | Hậu quả | Cách giữ đúng |
|---|---|---|
| Hai người cùng đặt phòng cuối | Overbooking | Lock hoặc constraint ở DB |
| User bấm "Thanh toán" hai lần, client retry | Trừ tiền hai lần | Idempotency key |
| Webhook cổng thanh toán gửi lại | Booking xác nhận hai lần, gửi hai email | Unique theo `payment_ref` |
| Tạo booking xong nhưng job gửi email không được enqueue | Khách không nhận xác nhận | Outbox hoặc `after_commit` |

**Giữ phòng: để DB quyết định, không để Ruby quyết định.**

```ruby
# Sai: đọc rồi ghi, có khoảng hở giữa hai bước
if inventory.available > 0
  inventory.update!(available: inventory.available - 1)
end

# Đúng: điều kiện nằm trong câu UPDATE
def reserve!(room_type_id, dates)
  Booking.transaction do
    dates.each do |date|
      updated = RoomInventory
        .where(room_type_id:, date:)
        .where("booked < total")
        .update_all("booked = booked + 1")
      raise SoldOut if updated.zero?   # rollback cả các đêm trước
    end
    Booking.create!(room_type_id:, check_in: dates.first, check_out: dates.last + 1, status: :held)
  end
end
```

Đặt 3 đêm là 3 dòng inventory, một transaction: thiếu một đêm là rollback cả ba.

**Thanh toán: idempotency key.**

```ruby
add_index :payments, :idempotency_key, unique: true

def pay!(booking, key)
  Payment.create!(booking:, idempotency_key: key, amount: booking.total)
rescue ActiveRecord::RecordNotUnique
  Payment.find_by!(idempotency_key: key)   # lần retry trả lại kết quả cũ
end
```

Chi tiết các kiểu lock và race condition trong Rails, xem bài [race condition và locking](/blog/rails-race-condition-locking/).

**Kiểm tra:** test chạy 10 thread cùng đặt một phòng còn 1 chỗ, kỳ vọng đúng 1 booking thành công.

## 2. System reliability

**Câu hỏi:** cổng thanh toán chậm, Redis chết, Sidekiq bị kill giữa chừng thì sao?

| Thành phần lỗi | Nếu không chuẩn bị | Cách phục hồi |
|---|---|---|
| Cổng thanh toán treo | Puma hết thread, cả site treo | Timeout ngắn, circuit breaker |
| Job gửi email lỗi | Mất email | Sidekiq retry, job idempotent |
| Sidekiq bị kill khi deploy | Job đang chạy biến mất | Graceful shutdown, job chạy lại được |
| Giữ phòng nhưng không thanh toán | Phòng bị khoá mãi | Hold có hạn, job dọn hold hết hạn |
| Redis cache chết | Lỗi 500 | Cache lỗi thì đọc thẳng DB |

**Gọi bên ngoài luôn có timeout:**

```ruby
conn = Faraday.new(url: ENV["PAYMENT_URL"]) do |f|
  f.options.open_timeout = 2
  f.options.timeout = 5
end
```

**Hold có hạn, hệ thống tự dọn:**

```ruby
class ReleaseExpiredHoldsJob
  include Sidekiq::Job

  def perform
    Booking.held.where("created_at < ?", 15.minutes.ago).find_each do |b|
      b.release!   # trả lại inventory trong transaction, idempotent nếu đã release
    end
  end
end
```

Đây là ý chính của reliability: **giả định mọi bước đều có thể dừng giữa chừng**, và thiết kế để trạng thái dở dang tự được dọn hoặc chạy lại an toàn. Retry chỉ an toàn khi mục 1 đã đúng: job idempotent, thanh toán có idempotency key.

**Kiểm tra:** tắt cổng thanh toán trên staging, trang tìm phòng vẫn phải chạy. Đặt SLO cho luồng đặt phòng để biết khi nào đang hỏng, xem bài [SLI, SLO, SLA và error budget](/blog/sli-slo-sla-error-budget/).

## 3. Performance at scale

**Câu hỏi:** mùa lễ, traffic tìm phòng tăng 20 lần. Chỗ nào chậm trước?

| Chỗ | Đặc điểm | Cách giữ nhanh |
|---|---|---|
| **Tìm phòng** (đọc nhiều nhất) | 100 lượt tìm mới có 1 lượt đặt | Cache kết quả tìm, read replica, index `(room_type_id, date)` |
| Trang chi tiết khách sạn | Ảnh, mô tả ít đổi | Cache dài, CDN cho ảnh |
| Giá theo ngày | Đổi theo lịch | Cache kèm version, xem bài [cache flash sale](/blog/cache-invalidation-flashsale/) |
| Gửi email, tạo hoá đơn PDF | Không cần ngay | Đẩy sang Sidekiq, xem bài [scaling Sidekiq](/blog/scaling-sidekiq-high-volume/) |
| Danh sách booking của user | N+1 | `includes(:hotel, :room_type)` |

```ruby
def search(city:, check_in:, check_out:, guests:)
  key = ["search", city, check_in, check_out, guests, Inventory.version]
  Rails.cache.fetch(key, expires_in: 1.minute) do
    RoomType.joins(:hotel)
      .where(hotels: { city: })
      .available_between(check_in, check_out, guests)
      .includes(:hotel)
      .to_a
  end
end
```

Kết quả tìm được phép cũ một phút. Còn số phòng thật **được kiểm tra lại lúc đặt** bằng câu `UPDATE` ở mục 1. Đây là chỗ ba điều gặp nhau: cache cho nhanh ở chỗ đọc, nhưng quyết định đúng sai luôn nằm ở DB.

**Kiểm tra:** load test luồng tìm phòng ở 10–20 lần traffic bình thường, xem p95 latency và chỗ nào chạm trần trước (DB, Puma thread, Redis).

## Tóm tắt

| | Câu hỏi | Trong app đặt phòng | Công cụ chính |
|---|---|---|---|
| **Correctness** | Có đúng khi chạy đồng thời, retry? | Giữ phòng, thanh toán, webhook | Transaction, `UPDATE ... WHERE`, unique index, idempotency key |
| **Reliability** | Có tự phục hồi khi một phần lỗi? | Cổng thanh toán, job, hold hết hạn | Timeout, retry, job idempotent, dọn trạng thái dở |
| **Performance** | Có nhanh khi tải tăng? | Tìm phòng, trang khách sạn | Cache, read replica, index, job nền |

Checklist ngắn khi review một tính năng:

- Hai request cùng lúc có làm sai dữ liệu không? Retry có làm trùng không?
- Mỗi lời gọi ra ngoài có timeout không? Bước nào dừng giữa chừng thì ai dọn?
- Chỗ nào được đọc nhiều nhất? Nó có cache, có index chưa? Cache sai thì ai kiểm tra lại?

Đúng trước, bền sau, nhanh cuối cùng. Và cả ba đều phải **có test hoặc số đo**, không chỉ là cảm giác.
