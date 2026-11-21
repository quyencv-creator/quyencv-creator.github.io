---
title: "Viết service object tốt trong Rails: tổ chức, đặt tên, truyền phụ thuộc và test"
description: Khi nào cần service object, đặt tên và tổ chức thư mục thế nào, một interface duy nhất là call, trả về Result thay vì nil, truyền phụ thuộc qua constructor để test không cần Stripe hay SMTP, và giữ transaction ngắn. Kèm ví dụ đặt hàng chạy được với test.
pubDate: 2026-11-21
tags: [ruby, rails, architecture, backend]
---

Rails có câu "fat model, skinny controller". Vài năm sau, model `Order` dài 1.500 dòng, vừa validate, vừa tính tiền, vừa gọi Stripe, vừa gửi email trong callback. Không ai dám sửa.

**Service object** là cách phổ biến để gỡ mớ đó: mỗi **nghiệp vụ** một class nhỏ, làm đúng một việc. Nhưng service viết tệ thì chỉ là chuyển đống lộn xộn từ model sang thư mục khác. Bài này là những quy ước mình thấy giúp service dễ đọc, dễ test, dễ sửa.

Ví dụ xuyên suốt: **đặt một đơn hàng**: kiểm tra tồn kho, tạo đơn, trừ kho, thu tiền qua cổng thanh toán, gửi email xác nhận.

## 1. Khi nào cần service, khi nào không

Cần service khi nghiệp vụ:

- Đụng tới **nhiều model** (Order, OrderItem, Product).
- Gọi **hệ thống bên ngoài** (cổng thanh toán, email, API đối tác).
- Có **nhiều bước** và cần xử lý khi một bước thất bại.
- Được gọi từ **nhiều nơi** (controller, job, rake task, console).

**Không** cần service cho:

- CRUD đơn giản: `Post.create(post_params)` trong controller là đủ.
- Logic chỉ thuộc về một model: `order.total_with_tax` để làm method của `Order`.
- Một dòng gọi qua: `UserUpdater.call(user, params)` chỉ để gọi `user.update(params)` là thêm một lớp vô ích.

## 2. Đặt tên và tổ chức thư mục

Đặt tên theo **hành động nghiệp vụ**, nhóm theo **domain**:

```
app/services/
├── orders/
│   ├── place.rb           # Orders::Place
│   ├── cancel.rb          # Orders::Cancel
│   └── refund.rb          # Orders::Refund
├── payments/
│   └── gateway.rb         # Payments::Gateway (bọc SDK Stripe)
└── users/
    └── register.rb        # Users::Register
```

Quy tắc:

- **Động từ** cho việc cần làm: `Orders::Place`, `Users::Register`, `Invoices::Generate`. Đọc lên là biết nó làm gì.
- **Namespace theo domain** (`Orders::`), không theo kỹ thuật. Tránh dồn hết vào `app/services/` phẳng với 200 file.
- **Tránh các hậu tố vô nghĩa**: `OrderManager`, `OrderHandler`, `OrderProcessor`, `OrderService`. "Manager" của cái gì? Nó làm *gì*? Những cái tên này là chỗ mọi thứ dồn vào.
- Tên file theo đúng quy ước Zeitwerk: `app/services/orders/place.rb` ↔ `Orders::Place`.

### Còn "import" thì sao?

Trong Rails, bạn **không `require`** file service. **Zeitwerk** tự nạp hằng số `Orders::Place` từ `app/services/orders/place.rb` khi được dùng lần đầu, miễn là tên file và tên class khớp nhau. Mọi thư mục con trong `app/` đều được autoload sẵn, không cần cấu hình.

Vì vậy "import" trong Rails không phải là chuyện cú pháp, mà là chuyện **phụ thuộc ngầm**. Viết `Stripe::Charge.create(...)` ở giữa method nghĩa là service **gắn chặt** với Stripe, và test buộc phải chặn Stripe. Phần 4 sẽ xử lý chuyện này.

## 3. Một interface duy nhất: `call`

```ruby
module Orders
  class Place
    def self.call(...) = new(...).call

    def initialize(user_id:, items:, idempotency_key:)
      @user_id = user_id
      @items = items
      @idempotency_key = idempotency_key
    end

    def call
      # ...
    end

    private

    # các bước nhỏ
  end
end
```

Nơi gọi:

```ruby
result = Orders::Place.call(user_id: current_user.id, items: cart_items,
                            idempotency_key: params[:idempotency_key])
```

Vì sao như vậy:

- **Một public method duy nhất.** Service làm một việc, nên chỉ có một cửa vào. Có thêm `validate`, `calculate`, `notify` public là dấu hiệu service đang làm nhiều việc.
- **`self.call(...)`** là phím tắt cho `new(...).call`. Cú pháp `(...)` (Ruby 2.7+) chuyển tiếp nguyên mọi tham số.
- **Keyword arguments.** `Place.call(user_id: 1, items: [...])` đọc rõ hơn `Place.call(1, [...], "abc")`, và đổi thứ tự không làm hỏng code.
- **Dữ liệu vào qua constructor, không qua `call`.** Instance là "một lần thực thi" của nghiệp vụ, mọi thứ nó cần nằm sẵn trong biến instance.
- **Truyền id hoặc dữ liệu đơn giản** khi service có thể được gọi từ background job (job serialize tham số). Truyền object khi đã có sẵn trong tay và chỉ gọi đồng bộ.

## 4. Truyền phụ thuộc qua constructor

Service đặt hàng cần **cổng thanh toán** và **gửi thông báo**. Cách viết thường thấy:

```ruby
def call
  # ...
  Stripe::PaymentIntent.create(amount: total, currency: "vnd", ...)  # ❌ gắn chặt Stripe
  OrderMailer.with(order:).confirmation.deliver_later               # ❌ gắn chặt mailer
end
```

Test service này phải stub Stripe bằng WebMock hoặc VCR, stub mailer, và một lần đổi cổng thanh toán là sửa mọi service.

Cách tốt hơn: **nhận phụ thuộc qua constructor, có giá trị mặc định**:

```ruby
def initialize(user_id:, items:, idempotency_key:,
               payment_gateway: Payments::Gateway.new,
               notifier: Orders::Notifier)
  @user_id = user_id
  @items = items
  @idempotency_key = idempotency_key
  @payment_gateway = payment_gateway
  @notifier = notifier
end
```

- **Code production** không phải truyền gì: mặc định là gateway thật, notifier thật.
- **Test** truyền vào object giả, không cần mạng, không cần stub hằng số toàn cục.
- **Gateway là lớp bọc riêng của bạn**, không phải SDK Stripe trực tiếp. Service chỉ biết `charge(amount_cents:, reference:)`; Stripe hay VNPay là chuyện bên trong `Payments::Gateway`.

```ruby
# app/services/payments/gateway.rb
module Payments
  class Gateway
    def charge(amount_cents:, reference:)
      intent = Stripe::PaymentIntent.create(amount: amount_cents, currency: "vnd",
                                            metadata: { order_id: reference }, confirm: true, ...)
      Result.success(intent.id)
    rescue Stripe::CardError => e
      Result.failure(:declined, e.message)
    end
  end
end

# app/services/orders/notifier.rb
module Orders
  module Notifier
    def self.order_placed(order_id)
      OrderMailer.with(order_id:).confirmation.deliver_later
    end
  end
end
```

Chỉ inject những thứ **đi ra ngoài hệ thống** hoặc **khó kiểm soát trong test** (thanh toán, email, HTTP, thời gian hiện tại, số ngẫu nhiên). Không cần inject ActiveRecord model: test với database thật trong Rails nhanh và đáng tin hơn là giả lập `Order.create!`.

## 5. Trả về Result, đừng trả về `nil` hay `false`

Đặt hàng có thể thất bại theo nhiều cách: giỏ trống, hết hàng, thẻ bị từ chối. Trả `nil` hay `false` thì nơi gọi không biết **vì sao**. Ném exception cho lỗi nghiệp vụ thì nơi gọi phải `rescue` một loạt class lỗi.

Một object `Result` nhỏ là đủ, viết bằng `Data` (Ruby 3.2+):

```ruby
# app/services/result.rb
module Result
  Success = Data.define(:value) do
    def success? = true
    def failure? = false
  end

  Failure = Data.define(:error, :message) do
    def success? = false
    def failure? = true
  end

  def self.success(value = nil) = Success.new(value:)
  def self.failure(error, message = nil) = Failure.new(error:, message: message || error.to_s)
end
```

Controller đọc rất tự nhiên:

```ruby
class OrdersController < ApplicationController
  def create
    result = Orders::Place.call(user_id: current_user.id, items: cart_params,
                                idempotency_key: params.require(:idempotency_key))

    if result.success?
      redirect_to result.value, notice: "Đặt hàng thành công"
    else
      flash.now[:alert] = result.message
      render :new, status: result.error == :out_of_stock ? :conflict : :unprocessable_entity
    end
  end
end
```

Ranh giới giữa hai loại lỗi:

| Loại | Ví dụ | Cách báo |
|---|---|---|
| Lỗi nghiệp vụ, **dự đoán được** | Hết hàng, thẻ bị từ chối, giỏ trống | `Result.failure(:out_of_stock, ...)` |
| Lỗi **hệ thống**, không lường trước | DB mất kết nối, bug, timeout | Để exception bay lên, Rails trả 500 và báo lỗi |

`error` là symbol để code xử lý (`:out_of_stock`), `message` là câu để hiển thị cho người dùng.

Không muốn tự viết thì có gem `dry-monads`. Nhưng một file 15 dòng như trên thường là đủ, và ai đọc cũng hiểu.

## 6. Service hoàn chỉnh

```ruby
# app/services/orders/place.rb
module Orders
  class Place
    class OutOfStock < StandardError; end

    def self.call(...) = new(...).call

    def initialize(user_id:, items:, idempotency_key:,
                   payment_gateway: Payments::Gateway.new,
                   notifier: Orders::Notifier)
      @user_id = user_id
      @items = items                     # [{ product_id: 1, quantity: 2 }, ...]
      @idempotency_key = idempotency_key
      @payment_gateway = payment_gateway
      @notifier = notifier
    end

    def call
      return Result.failure(:empty_cart, "Giỏ hàng trống") if @items.empty?

      if (existing = Order.find_by(idempotency_key: @idempotency_key))
        return existing.status == "paid" ? Result.success(existing) : Result.failure(:duplicate_request)
      end

      order = reserve_order
      charge = @payment_gateway.charge(amount_cents: order.total_cents, reference: order.id)
      if charge.failure?
        release(order)
        return Result.failure(:payment_failed, "Thanh toán thất bại")
      end

      order.update!(status: "paid", payment_id: charge.value)
      @notifier.order_placed(order.id)
      Result.success(order)
    rescue OutOfStock => e
      Result.failure(:out_of_stock, e.message)
    end

    private

    # Transaction ngắn: chỉ giữ lock trong lúc kiểm tra và trừ kho.
    def reserve_order
      ActiveRecord::Base.transaction do
        products = Product.where(id: @items.map { _1[:product_id] }).lock.index_by(&:id)
        @items.each do |item|
          product = products.fetch(item[:product_id])
          raise OutOfStock, "#{product.name} đã hết hàng" if product.stock < item[:quantity]
        end

        total = @items.sum { products[_1[:product_id]].price_cents * _1[:quantity] }
        order = Order.create!(user_id: @user_id, total_cents: total, status: "pending",
                              idempotency_key: @idempotency_key)
        @items.each do |item|
          product = products[item[:product_id]]
          order.items.create!(product:, quantity: item[:quantity], price_cents: product.price_cents)
          product.decrement!(:stock, item[:quantity])
        end
        order
      end
    end

    # Thanh toán thất bại: trả hàng về kho, đánh dấu đơn thất bại.
    def release(order)
      ActiveRecord::Base.transaction do
        order.items.each { _1.product.increment!(:stock, _1.quantity) }
        order.update!(status: "payment_failed")
      end
    end
  end
end
```

`call` đọc như một **kịch bản**: kiểm tra đầu vào → chống trùng → giữ hàng → thu tiền → hoàn tất hoặc trả hàng. Chi tiết nằm trong các method private có tên rõ ràng. Nhìn vào `call` là hiểu nghiệp vụ, không cần đọc SQL.

## 7. Những quy tắc nhỏ nhưng quan trọng

### Không gọi HTTP bên trong transaction

Bản đầu tiên mình viết gọi `@payment_gateway.charge` **bên trong** `transaction do ... end`. Chạy được, test xanh, nhưng sai: suốt thời gian chờ cổng thanh toán (1–3 giây, có khi 30 giây khi họ chậm), các dòng `Product` bị `lock` và transaction giữ một kết nối DB. Ngày sale, mọi đơn hàng mua cùng sản phẩm phải xếp hàng sau một cuộc gọi HTTP.

Cách đúng như phần 6: **transaction ngắn** để giữ hàng (`reserve_order`), **thu tiền bên ngoài** transaction, thất bại thì **bù trừ** (`release`). Đơn ở trạng thái `pending` trong lúc chờ là chuyện bình thường.

### Đừng `return` bên trong block `transaction`

```ruby
ActiveRecord::Base.transaction do
  return Result.failure(:out_of_stock) if product.stock < qty  # ❌
  # ...
end
```

Từ Rails 7.1, thoát khỏi block transaction bằng `return`, `break` hay `throw` sẽ **commit** những gì đã ghi trước đó, không phải rollback. Muốn huỷ thì `raise` một exception (như `OutOfStock` ở trên), rescue nó ở ngoài transaction.

### Tác dụng phụ chạy sau khi commit

Email, push notification, gọi webhook: chỉ chạy khi dữ liệu **đã thật sự được lưu**. Nếu service có thể bị gọi bên trong một transaction lớn hơn, bọc tác dụng phụ trong `ActiveRecord.after_all_transactions_commit { ... }` (Rails 7.2+), hoặc dùng `deliver_later` / job để nó chạy sau. Gửi email "đặt hàng thành công" rồi transaction rollback là trải nghiệm tệ nhất.

### Idempotency

Người dùng bấm "Đặt hàng" hai lần, mạng chập chờn khiến request bị gửi lại. Mỗi lần đặt hàng mang một `idempotency_key` (sinh ở client, lưu trong form), cột có **unique index**. Gặp lại key cũ thì trả kết quả cũ, không thu tiền lần hai.

### Service không biết gì về HTTP

Không nhận `params`, không đọc `session`, không trả `render`/`redirect`. Service nhận dữ liệu thuần và trả `Result`. Nhờ vậy cùng một `Orders::Place` dùng được từ controller, API, background job, rake task và console.

### Service gọi service: được, nhưng có chừng mực

`Orders::Place` gọi `Payments::Gateway` là bình thường. Nhưng nếu một service gọi năm service khác, mỗi cái lại gọi tiếp, thì việc lần theo luồng sẽ rất khổ. Giữ cây gọi **nông**, và mỗi service con cũng trả `Result`.

### Không đặt logic nghiệp vụ trong callback

`after_create :charge_card` trên model `Order` nghĩa là **mọi** chỗ tạo `Order` đều thu tiền, kể cả seed data, test, import từ hệ thống cũ. Callback hợp với việc thuộc về chính dữ liệu (chuẩn hoá email, đặt giá trị mặc định). Nghiệp vụ có tác dụng phụ thì để trong service, gọi một cách tường minh.

## 8. Test

Nhờ truyền phụ thuộc qua constructor, test không cần mạng, không cần stub hằng số:

```ruby
# test/services/orders/place_test.rb
require "test_helper"

class Orders::PlaceTest < ActiveSupport::TestCase
  class FakeGateway
    attr_reader :charges

    def initialize(succeed: true)
      @succeed = succeed
      @charges = []
    end

    def charge(amount_cents:, reference:)
      @charges << amount_cents
      @succeed ? Result.success("pay_123") : Result.failure(:declined)
    end
  end

  class FakeNotifier
    attr_reader :sent

    def initialize = @sent = []
    def order_placed(order_id) = @sent << order_id
  end

  setup do
    @book = Product.create!(name: "Sách Ruby", price_cents: 200_00, stock: 5)
    @gateway = FakeGateway.new
    @notifier = FakeNotifier.new
  end

  def place(qty: 2, key: "k1", gateway: @gateway)
    Orders::Place.call(user_id: 1, items: [{ product_id: @book.id, quantity: qty }],
                       idempotency_key: key, payment_gateway: gateway, notifier: @notifier)
  end

  test "đặt hàng thành công: tạo đơn, trừ kho, thu tiền, gửi thông báo" do
    result = place

    assert result.success?
    assert_equal "paid", result.value.status
    assert_equal 400_00, result.value.total_cents
    assert_equal 3, @book.reload.stock
    assert_equal [result.value.id], @notifier.sent
  end

  test "hết hàng: không tạo đơn, không thu tiền" do
    result = place(qty: 9)

    assert_equal :out_of_stock, result.error
    assert_equal "Sách Ruby đã hết hàng", result.message
    assert_equal 0, Order.count
    assert_empty @gateway.charges
  end

  test "thẻ bị từ chối: trả hàng về kho, không gửi thông báo" do
    result = place(gateway: FakeGateway.new(succeed: false))

    assert_equal :payment_failed, result.error
    assert_equal "payment_failed", Order.last.status
    assert_equal 5, @book.reload.stock
    assert_empty @notifier.sent
  end

  test "gửi lại cùng idempotency key: không thu tiền lần hai" do
    first = place
    second = place

    assert_equal first.value.id, second.value.id
    assert_equal 1, @gateway.charges.size
    assert_equal 3, @book.reload.stock
  end
end
```

Mình đã chạy bộ test này (bản rút gọn với ActiveRecord 8.1 và SQLite): **5 test, 20 assertion, đều pass**.

Vài nguyên tắc khi test service:

- **Fake đơn giản hơn mock.** Một class 5 dòng ghi lại những gì được gọi (`@charges`, `@sent`) dễ đọc hơn chuỗi `expects(:charge).with(...).returns(...)`, và không vỡ khi đổi thứ tự gọi.
- **Dùng database thật cho model.** Test transaction, lock, unique index bằng DB thật mới đáng tin.
- **Test theo kết quả nghiệp vụ**, không theo cách cài đặt: "kho còn 3", "không thu tiền", chứ không phải "đã gọi `decrement!`".
- **Mỗi nhánh thất bại một test.** `Result.failure` với `error` là symbol giúp assert rất gọn.
- Gateway thật (`Payments::Gateway`) có bộ test riêng, dùng WebMock/VCR. Chỉ **một** chỗ phải đụng tới HTTP giả.

## 9. Những dấu hiệu service đang đi sai hướng

| Dấu hiệu | Vấn đề |
|---|---|
| Tên kết thúc bằng `Manager`, `Handler`, `Service` | Không rõ nó làm gì, sẽ thành nơi chứa đủ thứ |
| Nhiều public method | Đang làm nhiều việc, tách ra |
| Trả `nil`, `false`, hoặc lúc trả object lúc trả string | Nơi gọi phải đoán |
| Nhận `params` hoặc `request` | Gắn chặt với HTTP, không dùng lại được trong job |
| `Stripe::`, `Net::HTTP`, `Time.now` rải rác giữa method | Khó test, khó thay thế; inject qua constructor |
| Gọi API bên ngoài trong `transaction do` | Giữ lock và kết nối DB trong lúc chờ mạng |
| Class cha `BaseService` với hàng chục hook, DSL tự chế | Thêm "ma thuật" mà ai mới vào cũng phải học |
| `call` dài 100 dòng | Tách thành các method private có tên theo bước nghiệp vụ |

## Tóm lại

- Dùng service cho nghiệp vụ **nhiều bước, nhiều model, có tác dụng phụ**. CRUD đơn giản thì không cần.
- Đặt tên **động từ + namespace theo domain**: `Orders::Place`, file `app/services/orders/place.rb`; Zeitwerk tự nạp, không cần `require`.
- **Một public method `call`**, `self.call(...)` làm phím tắt, tham số là keyword arguments qua constructor.
- **Inject phụ thuộc bên ngoài** (thanh toán, email, HTTP, thời gian) qua constructor với giá trị mặc định; test truyền fake vào.
- Trả **`Result`** cho lỗi nghiệp vụ, để exception cho lỗi hệ thống.
- **Transaction ngắn**, không gọi HTTP bên trong, không `return` khỏi block; tác dụng phụ chạy **sau commit**; có **idempotency key** cho thao tác tạo tiền.
- Test bằng **fake + database thật**, assert theo kết quả nghiệp vụ, mỗi nhánh thất bại một test.
