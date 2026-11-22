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

## 4. Đo và test ba điều này

Mỗi điều cần hai thứ: **test trước khi deploy** để bắt lỗi sớm, và **số đo trên production** để biết nó vẫn đúng.

| | Test trước khi deploy | Đo trên production |
|---|---|---|
| **Correctness** | Test concurrency, test retry/idempotency | Câu SQL kiểm tra bất biến, job đối soát |
| **Reliability** | Giả lập lỗi (timeout, job bị ngắt) | Error rate, retry/dead set, trạng thái kẹt |
| **Performance** | Bullet chặn N+1, load test | p95 latency, slow query, cache hit rate |

### 4.1 Correctness

**Test concurrency thật**, không mock. Tắt transactional fixtures cho test này, vì các thread cần thấy dữ liệu đã commit:

```ruby
RSpec.describe "Đặt phòng đồng thời", use_transactional_fixtures: false do
  it "10 người đặt phòng cuối, chỉ 1 người thành công" do
    room = create(:room_type)
    create(:room_inventory, room_type: room, date: Date.new(2026, 12, 24), total: 1, booked: 0)

    results = 10.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          BookingService.reserve!(room.id, [Date.new(2026, 12, 24)])
          :ok
        rescue BookingService::SoldOut
          :sold_out
        end
      end
    end.map(&:value)

    expect(results.count(:ok)).to eq(1)
    expect(RoomInventory.sum(:booked)).to eq(1)
  end
end
```

Đổi code giữ phòng sang kiểu "đọc rồi ghi", test này phải fail. Nếu không fail thì test chưa đủ đồng thời (tăng số thread, thêm `sleep` nhỏ giữa đọc và ghi khi viết test).

**Test retry:** gọi cùng một thao tác hai lần với cùng key, kết quả phải như gọi một lần.

```ruby
it "thanh toán hai lần cùng key chỉ tạo một payment" do
  booking = create(:booking, :held)
  2.times { PaymentService.pay!(booking, "key-123") }
  expect(Payment.where(booking:).count).to eq(1)
end

it "webhook gửi lại không gửi hai email" do
  2.times { post "/webhooks/payment", params: payload }
  expect(ConfirmationMailer.deliveries.size).to eq(1)
end
```

**Đo trên production: kiểm tra bất biến.** Test không bao phủ hết. Một job chạy mỗi giờ, tìm dữ liệu vi phạm điều không bao giờ được xảy ra:

```ruby
class InvariantCheckJob
  include Sidekiq::Job

  CHECKS = {
    overbooked:         "SELECT count(*) FROM room_inventories WHERE booked > total",
    double_payment:     "SELECT count(*) FROM (SELECT booking_id FROM payments WHERE status = 'paid'
                           GROUP BY booking_id HAVING count(*) > 1) t",
    paid_not_confirmed: "SELECT count(*) FROM bookings b JOIN payments p ON p.booking_id = b.id
                           WHERE p.status = 'paid' AND b.status <> 'confirmed'
                           AND p.updated_at < now() - interval '10 minutes'"
  }.freeze

  def perform
    CHECKS.each do |name, sql|
      n = ActiveRecord::Base.connection.select_value(sql).to_i
      StatsD.gauge("invariant.#{name}", n)
      Rails.logger.error("invariant violated: #{name}=#{n}") if n.positive?
    end
  end
end
```

Alert khi bất kỳ gauge nào lớn hơn 0. Thêm một job **đối soát** hằng ngày: so số tiền và số giao dịch với báo cáo của cổng thanh toán.

### 4.2 Reliability

**Giả lập lỗi trong test.** Với WebMock, cho cổng thanh toán timeout và kiểm tra hệ thống phản ứng đúng:

```ruby
it "cổng thanh toán timeout thì booking vẫn ở trạng thái held, không treo" do
  stub_request(:post, %r{payment}).to_timeout
  booking = create(:booking, :held)

  expect { PaymentService.pay!(booking, "key-1") }.to raise_error(PaymentService::Unavailable)
  expect(booking.reload).to be_held
end

it "hold hết hạn được trả lại phòng, chạy hai lần vẫn đúng" do
  booking = travel_to(20.minutes.ago) { BookingService.reserve!(room.id, dates) }
  2.times { ReleaseExpiredHoldsJob.new.perform }

  expect(booking.reload).to be_released
  expect(RoomInventory.sum(:booked)).to eq(0)
end
```

**Test job bị ngắt giữa chừng:** raise lỗi ở giữa job, chạy lại, kiểm tra không có tác dụng phụ bị lặp (email, thanh toán).

**Thử trên staging (game day):** tắt Redis, chặn mạng tới cổng thanh toán, kill pod Sidekiq trong lúc có job. Ghi lại cái gì hỏng và mất bao lâu để hồi phục.

**Đo trên production:**

| Chỉ số | Ý nghĩa | Alert khi |
|---|---|---|
| Error rate của `POST /bookings`, `/payments` | Luồng chính có đang lỗi | Vượt error budget của SLO |
| Thời gian gọi cổng thanh toán, số lần timeout | Phụ thuộc bên ngoài | Timeout tăng đột biến |
| Sidekiq retry set, dead set | Job đang lỗi lặp lại | Dead set tăng |
| Số booking `held` quá 30 phút | Job dọn hold không chạy | > 0 |
| Thời gian hồi phục sau sự cố | Hệ thống có tự lành | Theo dõi qua postmortem |

### 4.3 Performance

**Chặn N+1 ngay trong test** bằng gem Bullet:

```ruby
# config/environments/test.rb
config.after_initialize do
  Bullet.enable = true
  Bullet.raise  = true   # test fail nếu có N+1
end
```

**Load test luồng tìm phòng** trên staging với k6:

```javascript
// search.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "2m", target: 50 },    // mức bình thường
    { duration: "5m", target: 1000 },  // gấp 20 lần, mùa lễ
    { duration: "2m", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<500"] },
};

export default function () {
  const res = http.get("https://staging.example.com/search?city=da-nang&check_in=2026-12-24&check_out=2026-12-26&guests=2");
  check(res, { "status 200": (r) => r.status === 200 });
}
```

```bash
k6 run search.js
```

Trong lúc chạy, nhìn xem cái gì chạm trần trước: CPU DB, số connection, Puma thread bận, Redis. Đó là nút thắt cần xử lý.

**Load test luồng đặt phòng cùng lúc** để kiểm tra cả correctness dưới tải: 500 user ảo cùng đặt 10 phòng còn lại, sau đó chạy lại `InvariantCheckJob`, kết quả phải bằng 0.

**Đo trên production:**

- p95, p99 latency theo endpoint (tìm phòng, chi tiết khách sạn, đặt phòng).
- Slow query log của Postgres (`log_min_duration_statement = 200ms`), hoặc `pg_stat_statements`.
- Cache hit rate của kết quả tìm phòng.
- Puma: số thread bận và request phải xếp hàng.

## Tóm tắt

| | Câu hỏi | Trong app đặt phòng | Công cụ chính | Test / đo |
|---|---|---|---|---|
| **Correctness** | Có đúng khi chạy đồng thời, retry? | Giữ phòng, thanh toán, webhook | Transaction, `UPDATE ... WHERE`, unique index, idempotency key | Test nhiều thread, test gọi lặp; job kiểm tra bất biến |
| **Reliability** | Có tự phục hồi khi một phần lỗi? | Cổng thanh toán, job, hold hết hạn | Timeout, retry, job idempotent, dọn trạng thái dở | WebMock timeout, game day; error rate, dead set |
| **Performance** | Có nhanh khi tải tăng? | Tìm phòng, trang khách sạn | Cache, read replica, index, job nền | Bullet, k6; p95, slow query |

Checklist ngắn khi review một tính năng:

- Hai request cùng lúc có làm sai dữ liệu không? Retry có làm trùng không?
- Mỗi lời gọi ra ngoài có timeout không? Bước nào dừng giữa chừng thì ai dọn?
- Chỗ nào được đọc nhiều nhất? Nó có cache, có index chưa? Cache sai thì ai kiểm tra lại?

Đúng trước, bền sau, nhanh cuối cùng. Và cả ba đều phải **có test hoặc số đo**, không chỉ là cảm giác.
