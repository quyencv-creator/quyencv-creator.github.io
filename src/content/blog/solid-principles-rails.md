---
title: "SOLID là gì? Giải thích dễ hiểu kèm ví dụ trong Rails"
description: Năm nguyên tắc SOLID giải thích bằng ví dụ đời thường, mỗi nguyên tắc có một ví dụ Rails "trước và sau khi sửa", và khi nào không nên áp dụng quá mức.
pubDate: 2026-02-03
tags: [ruby, architecture]
---

SOLID là 5 nguyên tắc thiết kế giúp code **dễ sửa, dễ mở rộng và dễ test**. Tên SOLID ghép từ chữ cái đầu của mỗi nguyên tắc:

| Chữ | Tên | Một câu dễ nhớ |
|---|---|---|
| **S** | Single Responsibility | Mỗi class chỉ có **một lý do để thay đổi** |
| **O** | Open/Closed | Thêm tính năng bằng cách **thêm code mới**, không sửa code cũ |
| **L** | Liskov Substitution | Class con phải **thay được class cha** mà không làm hỏng gì |
| **I** | Interface Segregation | Đừng bắt ai phụ thuộc vào thứ **họ không dùng** |
| **D** | Dependency Inversion | Phụ thuộc vào **vai trò**, không phụ thuộc vào **cài đặt cụ thể** |

Ruby không có từ khoá `interface` như Java hay Go, nhưng nhờ **duck typing** ("nếu nó kêu như vịt thì nó là vịt"), cả 5 nguyên tắc vẫn áp dụng rất tự nhiên.

Ví dụ xuyên suốt bài: một app bán hàng Rails với `Order`, thanh toán, gửi email và xuất báo cáo.

---

## S: Single Responsibility Principle

> Một class chỉ nên có **một lý do để thay đổi**.

**Ví dụ đời thường:** đầu bếp nấu ăn, thu ngân thu tiền. Nếu một người vừa nấu vừa thu tiền vừa giao hàng, khi đổi máy tính tiền thì người đó cũng phải học lại, và bếp bị ảnh hưởng theo.

### Trước: "fat model" làm mọi thứ

```ruby
# app/models/order.rb
class Order < ApplicationRecord
  belongs_to :user
  has_many :line_items

  after_create :charge_card, :send_confirmation_email, :notify_slack

  def total
    line_items.sum { |i| i.price * i.quantity }
  end

  def charge_card
    Stripe::Charge.create(amount: total, currency: "vnd", customer: user.stripe_id)
  end

  def send_confirmation_email
    OrderMailer.confirmation(self).deliver_later
  end

  def notify_slack
    SlackClient.post("#sales", "Đơn mới ##{id}: #{total}đ")
  end

  def to_csv
    [id, user.email, total, created_at].join(",")
  end
end
```

`Order` đang có ít nhất **5 lý do để thay đổi**: đổi cách tính tiền, đổi cổng thanh toán, đổi nội dung email, đổi kênh Slack, đổi format CSV. Test `Order.create` thì phải mock cả Stripe lẫn Slack.

### Sau: tách theo trách nhiệm

```ruby
# app/models/order.rb: chỉ lo dữ liệu và quy tắc của đơn hàng
class Order < ApplicationRecord
  belongs_to :user
  has_many :line_items

  def total
    line_items.sum { |i| i.price * i.quantity }
  end
end
```

```ruby
# app/services/orders/place_order.rb: điều phối quy trình đặt hàng
module Orders
  class PlaceOrder
    def initialize(payment_gateway: Payments::StripeGateway.new)
      @payment_gateway = payment_gateway
    end

    def call(user:, cart:)
      order = Order.transaction do
        user.orders.create!(line_items: cart.to_line_items)
      end
      @payment_gateway.charge(order)
      OrderMailer.confirmation(order).deliver_later
      Notifications::NewOrderJob.perform_later(order.id)
      order
    end
  end
end
```

```ruby
# app/exporters/order_csv_exporter.rb: chỉ lo format CSV
class OrderCsvExporter
  def row(order)
    [order.id, order.user.email, order.total, order.created_at.iso8601]
  end
end
```

Mỗi class giờ có đúng một lý do để thay đổi. `Order.create` trong test không còn gọi Stripe.

**Dấu hiệu vi phạm SRP trong Rails:** model hàng nghìn dòng, nhiều callback `after_create` gọi API bên ngoài, controller có hàng chục dòng logic, tên class kiểu `OrderManager`, `OrderHelper`.

---

## O: Open/Closed Principle

> Code nên **mở để mở rộng**, nhưng **đóng để sửa đổi**.

**Ví dụ đời thường:** ổ cắm điện. Muốn dùng thêm thiết bị mới, bạn cắm phích vào, không ai đục tường đi lại dây điện.

### Trước: thêm phương thức thanh toán là sửa `case`

```ruby
class PaymentProcessor
  def charge(order, method)
    case method
    when "stripe"
      Stripe::Charge.create(amount: order.total, currency: "vnd")
    when "momo"
      Momo::Client.new.pay(order.id, order.total)
    when "cod"
      order.update!(payment_status: "pending_cod")
    # Thêm VNPay? Lại mở file này ra sửa, và có thể làm hỏng Stripe.
    end
  end
end
```

### Sau: mỗi phương thức là một class, đăng ký vào registry

```ruby
# app/services/payments/stripe_gateway.rb
module Payments
  class StripeGateway
    def charge(order)
      Stripe::Charge.create(amount: order.total, currency: "vnd")
    end
  end
end

# app/services/payments/momo_gateway.rb
module Payments
  class MomoGateway
    def charge(order)
      Momo::Client.new.pay(order.id, order.total)
    end
  end
end

# app/services/payments/cod_gateway.rb
module Payments
  class CodGateway
    def charge(order)
      order.update!(payment_status: "pending_cod")
    end
  end
end
```

```ruby
# app/services/payments.rb
module Payments
  GATEWAYS = {
    "stripe" => StripeGateway,
    "momo"   => MomoGateway,
    "cod"    => CodGateway,
  }.freeze

  def self.for(method)
    GATEWAYS.fetch(method) { raise ArgumentError, "Unknown payment method: #{method}" }.new
  end
end

# Sử dụng
Payments.for(params[:payment_method]).charge(order)
```

Thêm VNPay: tạo `VnpayGateway`, thêm một dòng vào `GATEWAYS`. Không đụng vào code Stripe, MoMo đang chạy ổn.

**Trong Rails, OCP còn xuất hiện ở:**

- **STI / polymorphic:** `Notification` có các subclass `EmailNotification`, `SmsNotification`.
- **Concern:** thêm hành vi bằng `include Searchable` thay vì sửa model.
- **Rails.application.config / middleware:** thêm middleware vào stack mà không sửa Rails.

---

## L: Liskov Substitution Principle

> Ở đâu dùng được class cha, thì **thay bằng class con cũng phải chạy đúng**.

**Ví dụ đời thường:** bạn thuê "một tài xế" để chở hàng. Công ty gửi đến tài xế nào cũng phải lái được xe. Nếu gửi đến một người "là tài xế nhưng không biết lái số sàn" thì hợp đồng bị phá.

### Trước: class con phá vỡ "lời hứa" của class cha

```ruby
class Notifier
  # Lời hứa: gửi thông báo, trả về true nếu thành công.
  def deliver(user, message)
    raise NotImplementedError
  end
end

class EmailNotifier < Notifier
  def deliver(user, message)
    UserMailer.notice(user, message).deliver_later
    true
  end
end

class SmsNotifier < Notifier
  def deliver(user, message)
    # Vi phạm: đòi thêm điều kiện mà class cha không có, và raise lỗi lạ.
    raise "User has no phone" if user.phone.blank?
    SmsClient.send(user.phone, message)
    # Vi phạm: không trả về true, trả về một Hash.
  end
end

# Code gọi phải biết đang dùng class con nào → mất ý nghĩa của kế thừa.
notifiers.each do |n|
  next if n.is_a?(SmsNotifier) && user.phone.blank?
  n.deliver(user, "Đơn đã giao")
end
```

Dấu hiệu rõ nhất: code gọi phải dùng `is_a?` / `kind_of?` để xử lý riêng từng class con.

### Sau: mọi class con giữ đúng lời hứa

```ruby
class SmsNotifier < Notifier
  def deliver(user, message)
    return false if user.phone.blank? # không gửi được → trả false, đúng lời hứa
    SmsClient.send(user.phone, message)
    true
  end
end

# Code gọi không cần biết class con là gì.
notifiers.each { |n| n.deliver(user, "Đơn đã giao") }
```

**LSP trong Rails thường bị vi phạm ở STI.** Ví dụ `class GuestUser < User` nhưng `GuestUser#orders` lại raise lỗi, hoặc `AdminUser#save` bỏ qua validation. Nếu subclass phải "tắt bớt" hành vi của cha, có thể nó không nên kế thừa. Dùng composition hoặc tách model riêng.

---

## I: Interface Segregation Principle

> Đừng bắt một class **phụ thuộc vào những method nó không dùng**.

**Ví dụ đời thường:** điều khiển TV 80 nút trong khi bạn chỉ cần bật, tắt và đổi kênh. Tốt hơn là có điều khiển gọn cho người dùng thường, và menu kỹ thuật riêng cho thợ.

Ruby không có `interface`, nên ISP thể hiện qua **module nhỏ** và **object chỉ lộ ra những gì cần**.

### Trước: một concern "to" cho mọi model

```ruby
# app/models/concerns/exportable.rb
module Exportable
  extend ActiveSupport::Concern

  def to_csv;   raise NotImplementedError; end
  def to_pdf;   raise NotImplementedError; end
  def to_excel; raise NotImplementedError; end
  def to_xml;   raise NotImplementedError; end
end

class Order < ApplicationRecord
  include Exportable
  def to_csv = ...
  def to_pdf = ...
  # to_excel, to_xml: Order không cần nhưng vẫn "có", gọi vào thì nổ lỗi.
end

class Product < ApplicationRecord
  include Exportable
  def to_csv = ...
  # 3 method còn lại để trống
end
```

### Sau: module nhỏ, chỉ include thứ mình cần

```ruby
module CsvExportable
  extend ActiveSupport::Concern
  class_methods do
    def to_csv(records = all)
      CSV.generate do |csv|
        csv << csv_columns
        records.each { |r| csv << csv_columns.map { |c| r.public_send(c) } }
      end
    end
  end
end

module PdfExportable
  def to_pdf
    PdfRenderer.new(self).render
  end
end

class Order < ApplicationRecord
  include CsvExportable
  include PdfExportable
  def self.csv_columns = %i[id total created_at]
end

class Product < ApplicationRecord
  include CsvExportable
  def self.csv_columns = %i[id name price]
end
```

### ISP ở tầng view và API: chỉ lộ ra những gì cần

Truyền cả object `ActiveRecord` vào view hoặc JSON là "bắt" phía dùng phụ thuộc vào mọi cột, mọi method của model, kể cả `password_digest`. Dùng **presenter / serializer** chỉ chứa thứ cần thiết:

```ruby
# app/serializers/order_summary_serializer.rb
class OrderSummarySerializer
  def initialize(order)
    @order = order
  end

  def as_json(*)
    { id: @order.id, total: @order.total, status: @order.status }
  end
end

render json: OrderSummarySerializer.new(order)
```

---

## D: Dependency Inversion Principle

> Module cấp cao (nghiệp vụ) **không phụ thuộc trực tiếp** vào module cấp thấp (Stripe, S3, SMTP). Cả hai phụ thuộc vào một **vai trò chung**.

**Ví dụ đời thường:** bạn cắm sạc vào ổ điện, không cần biết điện đến từ thuỷ điện hay điện mặt trời. Ổ cắm là "vai trò chung" giữa thiết bị và nhà máy điện.

### Trước: service "cứng" với Stripe

```ruby
module Orders
  class Refund
    def call(order)
      Stripe::Refund.create(charge: order.charge_id) # khoá chặt vào Stripe
      order.update!(status: "refunded")
    end
  end
end
```

Vấn đề:

- Test phải gọi Stripe thật hoặc stub hằng số `Stripe::Refund`.
- Chuyển sang MoMo phải sửa nghiệp vụ hoàn tiền.

### Sau: tiêm dependency qua constructor

```ruby
module Orders
  class Refund
    # Vai trò cần có: một object biết `refund(order)`.
    def initialize(gateway: Payments::StripeGateway.new)
      @gateway = gateway
    end

    def call(order)
      @gateway.refund(order)
      order.update!(status: "refunded")
    end
  end
end
```

Production dùng mặc định, test truyền object giả:

```ruby
# spec/services/orders/refund_spec.rb
RSpec.describe Orders::Refund do
  it "marks order as refunded" do
    fake_gateway = double(refund: true)
    order = create(:order, status: "paid")

    described_class.new(gateway: fake_gateway).call(order)

    expect(fake_gateway).to have_received(:refund).with(order)
    expect(order.reload.status).to eq("refunded")
  end
end
```

Nhờ duck typing, `fake_gateway` chỉ cần có method `refund`, không cần kế thừa gì.

**DIP trong Rails đã có sẵn ở nhiều nơi:**

| Vai trò chung | Cài đặt có thể thay |
|---|---|
| `ActiveJob` | Sidekiq, GoodJob, Solid Queue, async |
| `ActiveStorage` | Disk, S3, GCS, Azure |
| `ActionMailer` delivery method | SMTP, SendGrid, `:test` |
| `Rails.cache` | Memory, Redis, Solid Cache |

Code nghiệp vụ gọi `perform_later`, `attach`, `deliver_later`. Đổi hạ tầng chỉ cần sửa `config/`. Đó chính là DIP.

---

## Tóm tắt: SOLID trong một app Rails

```
app/
├── controllers/     # mỏng: nhận params, gọi service, render       (S)
├── models/          # dữ liệu, validation, quan hệ, scope            (S)
│   └── concerns/    # module nhỏ, đúng mục đích                      (I)
├── services/        # quy trình nghiệp vụ, nhận dependency qua init  (S, D)
│   └── payments/    # mỗi gateway một class, đăng ký vào registry    (O, L)
├── serializers/     # chỉ lộ ra field cần thiết                      (I)
└── jobs/            # việc chạy nền, gọi API bên ngoài               (S)
```

| Nguyên tắc | Dấu hiệu vi phạm | Cách sửa trong Rails |
|---|---|---|
| S | Model / controller khổng lồ, nhiều callback gọi API | Service object, job, exporter |
| O | `case type when ...` lặp lại ở nhiều nơi | Polymorphism, registry, STI |
| L | `is_a?` trong code gọi; subclass raise lỗi lạ | Giữ đúng contract hoặc bỏ kế thừa |
| I | Concern to, nhiều method `NotImplementedError` | Concern nhỏ, serializer / presenter |
| D | `Stripe::`, `Aws::S3::` nằm thẳng trong nghiệp vụ | Inject qua `initialize`, adapter |

## Đừng áp dụng quá mức

SOLID là **công cụ**, không phải luật:

- App CRUD nhỏ không cần `PaymentGatewayFactoryRegistry`. Một `case` với 2 nhánh hoàn toàn ổn.
- Tách class khi **có lý do thật**: lần thứ hai cần thêm một loại, test quá khó, file quá dài. Đừng tách "phòng trường hợp".
- "Rails way" (fat model, callback) vẫn hiệu quả cho nhiều project. Hãy refactor theo SOLID **khi bắt đầu đau**, không phải từ ngày đầu.

Một câu để nhớ: **SOLID giúp bạn thay đổi code mà không sợ.** Nếu một nguyên tắc làm code khó hiểu hơn mà không giúp thay đổi dễ hơn, đừng dùng nó.
