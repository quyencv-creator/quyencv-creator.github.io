---
title: "Ruby thread: khi request của user A trả về dữ liệu của user B"
description: Puma chạy nhiều thread trong một process, các thread dùng chung bộ nhớ. Một biến @user đặt sai chỗ là đủ để request này lấy nhầm dữ liệu của request khác khi tải nặng. Bài viết giải thích vì sao GVL không cứu được, các chỗ hay rò dữ liệu (class ivar, biến toàn cục, Thread.current trong thread pool) và cách khắc phục, kèm code chạy thật.
pubDate: 2026-07-27
tags: [ruby, backend]
---

Có một loại bug mà ai gặp rồi đều nhớ rất lâu: user A mở trang hồ sơ và thấy **tên, email, đơn hàng của user B**. Local không tái hiện được, staging cũng không. Chỉ xảy ra trên production, vào giờ cao điểm, thỉnh thoảng.

Nguyên nhân gần như luôn giống nhau: **hai request chạy trên hai thread khác nhau, cùng đọc ghi một biến nằm ở vùng nhớ dùng chung**.

Mọi output trong bài đều chạy thật với Ruby 3.3.

## Vì sao Ruby có chuyện này?

Puma, web server mặc định của Rails, chạy theo mô hình **nhiều worker process, mỗi process nhiều thread**:

```ruby
# config/puma.rb
workers 2      # 2 process, bộ nhớ tách biệt
threads 5, 5   # mỗi process 5 thread, DÙNG CHUNG bộ nhớ
```

Mỗi request được giao cho một thread. Các thread trong cùng một process cùng thấy những thứ sau:

- Class và module (cùng với instance variable của chính class).
- Biến toàn cục `$x`, class variable `@@x`, hằng số.
- Object được tạo một lần lúc boot và giữ lại (singleton, memoize ở class).

Chỉ có **biến cục bộ** và **object được tạo mới trong request** là thuộc riêng thread đó.

### "Ruby có GVL mà, sao vẫn bị?"

Đây là hiểu lầm phổ biến nhất. GVL (Global VM Lock) đảm bảo tại một thời điểm chỉ một thread chạy **Ruby code**. Nhưng:

- Khi một thread chờ **IO** (query DB, gọi HTTP, đọc file, `sleep`), nó **nhả GVL** và thread khác được chạy.
- Ngay cả khi không có IO, scheduler vẫn chuyển thread theo time slice (mặc định 100ms).

GVL chống được việc hai thread phá hỏng cấu trúc nội bộ của VM. Nó **không** biến một chuỗi lệnh của bạn thành nguyên tử. Giữa "gán `@user`" và "đọc lại `@user`", thread khác hoàn toàn có thể chen vào.

Và web app thì dành phần lớn thời gian để **chờ IO**. Tải càng nặng, càng nhiều thread đang chờ cùng lúc, cửa sổ để chen vào càng rộng. Đó là lý do bug chỉ hiện ra lúc cao điểm.

## Tái hiện: class instance variable

Đây là dạng gặp nhiều nhất. Service viết bằng class method cho gọn, rồi "tiện tay" lưu trạng thái vào `@user`:

```ruby
class ProfileService
  def self.call(user)
    @user = user           # @user này thuộc về CLASS ProfileService, không phải request
    sleep 0.05             # giả lập IO: query DB, gọi API...
    "profile of #{@user}"
  end
end

results = %w[alice bob].map do |u|
  Thread.new { ProfileService.call(u) }
end.map(&:value)

p results
# => ["profile of bob", "profile of bob"]
```

Diễn biến:

```text
Thread A: @user = "alice"
Thread A: sleep (chờ IO, nhả GVL)
Thread B: @user = "bob"          # ghi đè lên cùng một biến
Thread B: sleep
Thread A: tỉnh dậy, đọc @user    # => "bob"  ← alice nhận dữ liệu của bob
Thread B: đọc @user              # => "bob"
```

Trong `self.call`, `self` là **chính class**. Class chỉ có một, dùng chung cho mọi thread, nên `@user` ở đây thực chất là một biến toàn cục đội lốt.

Request của user nào phải đợi IO, request của user khác nhảy vào ghi đè. Trong app thật, "IO" là `User.find`, `Order.where(...)`, `HTTP.get(...)`, tức là có mặt ở gần như mọi dòng.

### Cách sửa: mỗi lần gọi một instance mới

```ruby
class ProfileService
  def self.call(user) = new(user).call   # tạo object mới cho MỖI lần gọi

  def initialize(user)
    @user = user                         # @user thuộc về instance riêng
  end

  def call
    sleep 0.05
    "profile of #{@user}"
  end
end

# => ["profile of alice", "profile of bob"]
```

`self.call` vẫn giữ interface gọn, nhưng trạng thái nằm trong instance chỉ tồn tại trong request đó. Đây cũng là lý do pattern service object chuẩn là `new(...).call`, xem thêm [bài về service object](/blog/rails-service-object/).

Luật rút ra: **trong class method, `@x` là trạng thái dùng chung**. Nếu thấy `@` trong một `def self.xxx`, hãy dừng lại và hỏi biến đó có thuộc về request nào không.

## Các chỗ khác hay rò dữ liệu

### 1. Class variable và biến toàn cục

```ruby
class ApplicationController < ActionController::Base
  before_action { @@current_user = User.find(session[:user_id]) } # dùng chung mọi thread
end

$current_tenant = Tenant.find(...) # biến toàn cục: còn tệ hơn
```

Cùng bản chất với ví dụ trên. Không bao giờ lưu dữ liệu của request vào `@@` hay `$`.

### 2. Memoize ở cấp class

```ruby
class PermissionChecker
  def self.permissions_for(user)
    @permissions ||= user.roles.flat_map(&:permissions) # cache theo user ĐẦU TIÊN gọi
  end
end
```

Không cần tới race condition: user đầu tiên gọi sau khi boot quyết định quyền của **mọi user** tới khi restart server. Nếu user đầu là admin, bạn có lỗ hổng bảo mật nghiêm trọng.

Memoize ở cấp class chỉ an toàn với dữ liệu **không phụ thuộc request** (config, danh sách quốc gia…), và ngay cả khi đó, `||=` vẫn có thể chạy hai lần khi hai thread cùng gọi lần đầu. Muốn chắc thì nạp lúc boot hoặc bọc bằng Mutex.

### 3. Hằng số bị sửa

```ruby
DEFAULT_OPTIONS = { locale: "vi" }

def build_options(user)
  opts = DEFAULT_OPTIONS          # không copy, cùng một Hash
  opts[:locale] = user.locale     # sửa thẳng vào hằng số dùng chung
  opts
end
```

Hằng số trong Ruby chỉ ngăn **gán lại tên**, không ngăn sửa object. Cách phòng: `freeze` hằng số (`DEFAULT_OPTIONS = { locale: "vi" }.freeze`) để sửa nhầm là lỗi ngay, và dùng `DEFAULT_OPTIONS.merge(locale: user.locale)` để tạo Hash mới.

### 4. `Thread.current` trong thread pool: dữ liệu thừa từ request trước

Nhiều người "sửa" bug class ivar bằng cách chuyển sang `Thread.current`, vì mỗi thread có kho riêng:

```ruby
Thread.current[:user] = current_user
```

Đúng là không còn chuyện hai thread ghi đè nhau. Nhưng Puma **tái sử dụng thread** qua nhiều request. Nếu không dọn, request sau sẽ thấy dữ liệu của request trước trên cùng thread:

```ruby
q = Queue.new
worker = Thread.new { 2.times { q.pop.call } } # một thread xử lý 2 request, giống thread pool

q << -> { Thread.current[:user] = "alice"; puts "req1 user=#{Thread.current[:user]}" }
q << -> { puts "req2 user=#{Thread.current[:user].inspect}" } # request này không set user
worker.join

# req1 user=alice
# req2 user="alice"   ← request không đăng nhập vẫn "là" alice
```

Request 2 có thể là một request **chưa đăng nhập** (API public, webhook, health check), và nó thừa hưởng danh tính của alice.

Thêm một bẫy nữa: `Thread.current[:x]` thực ra là **fiber-local**, không phải thread-local:

```ruby
Thread.current[:a] = 1
Thread.current.thread_variable_set(:b, 2)

Fiber.new { p [Thread.current[:a], Thread.current.thread_variable_get(:b)] }.resume
# => [nil, 2]
```

Nếu code chạy trong Fiber (Enumerator với `next`, gem `async`, Falcon), giá trị đặt bên ngoài sẽ biến mất bên trong. Muốn thật sự theo thread thì dùng `thread_variable_get/set`, nhưng vấn đề "phải tự dọn" thì vẫn còn nguyên.

Nếu buộc phải dùng `Thread.current`, hãy **luôn dọn trong `ensure`**:

```ruby
class CurrentUserMiddleware
  def initialize(app) = @app = app

  def call(env)
    Thread.current[:user] = nil # reset ngay đầu request
    @app.call(env)
  ensure
    Thread.current[:user] = nil # và dọn khi kết thúc, kể cả khi có exception
  end
end
```

Hoặc dùng gem `request_store`, vốn làm đúng việc này.

## Cách khắc phục trong Rails: `ActiveSupport::CurrentAttributes`

Rails có sẵn công cụ cho bài toán "trạng thái theo request":

```ruby
# app/models/current.rb
class Current < ActiveSupport::CurrentAttributes
  attribute :user, :tenant, :request_id
end
```

```ruby
class ApplicationController < ActionController::Base
  before_action do
    Current.user = User.find_by(id: session[:user_id])
  end
end

# Ở bất kỳ đâu trong request:
Current.user
```

Rails tự **reset** `Current` trước và sau mỗi request (và mỗi job của Active Job), nên không có dữ liệu thừa. Giá trị được cô lập theo thread hoặc fiber tuỳ cấu hình `config.active_support.isolation_level` (mặc định `:thread`, chuyển sang `:fiber` nếu chạy server dựa trên fiber).

Nhưng đừng lạm dụng. `Current` vẫn là một dạng biến toàn cục, chỉ là an toàn với thread. Dùng nó cho những thứ **thật sự xuyên suốt request**: user hiện tại, tenant, request_id cho log. Còn dữ liệu nghiệp vụ thì **truyền tham số tường minh**:

```ruby
# Khó test, phụ thuộc ngầm:
class OrderService
  def call = Order.create!(user: Current.user, ...)
end

# Rõ ràng, test dễ, không phụ thuộc request:
class OrderService
  def initialize(user:) = @user = user
  def call = Order.create!(user: @user, ...)
end
```

Phiên bản thứ hai chạy đúng cả trong console, rake task và background job, những nơi không có request nào để gán `Current.user`.

## Khi thật sự cần trạng thái dùng chung: Mutex

Có những thứ cố ý dùng chung: bộ đếm, cache trong process, connection pool tự viết. Lúc này cần khoá. Ví dụ bộ đếm, mô phỏng thread bị chuyển giữa lúc đọc và lúc ghi:

```ruby
c = 0
10.times.map do
  Thread.new { 1000.times { v = c; sleep 0 if rand < 0.01; c = v + 1 } }
end.each(&:join)
p c # => 1301   (đúng ra phải là 10000)
```

```ruby
m = Mutex.new
c = 0
10.times.map do
  Thread.new { 1000.times { m.synchronize { v = c; sleep 0 if rand < 0.01; c = v + 1 } } }
end.each(&:join)
p c # => 10000
```

Con số `1301` sẽ khác nhau mỗi lần chạy. Đó chính là đặc điểm của race condition: kết quả phụ thuộc thời điểm.

Thay vì tự quản lý Mutex, nên dùng cấu trúc thread-safe có sẵn trong gem `concurrent-ruby` (Rails đã kéo sẵn gem này):

```ruby
COUNTER = Concurrent::AtomicFixnum.new(0)
COUNTER.increment

CACHE = Concurrent::Map.new
CACHE.compute_if_absent(key) { expensive_lookup(key) }
```

Và nhớ: Mutex chỉ bảo vệ **trong một process**. Puma có nhiều worker process, mỗi process có bộ nhớ riêng. Trạng thái cần đồng bộ giữa các process hay giữa nhiều server thì phải nằm ở Redis hoặc database, cùng với cơ chế khoá ở đó, xem [bài về race condition và locking trong Rails](/blog/rails-race-condition-locking/).

## Làm sao phát hiện sớm?

Bug này hầu như không lộ ra khi dev chạy local với một request mỗi lần. Vài cách bắt sớm:

- **Grep code**: tìm `@` trong `def self.`, `@@`, `$`, `||=` ở cấp class, và hằng số kiểu Hash/Array chưa `freeze`. Đây là bước rẻ nhất mà bắt được phần lớn lỗi.
- **Bật `# frozen_string_literal: true`** và `freeze` mọi hằng số kiểu collection.
- **Load test với nhiều thread** trên staging (`k6`, `wrk`) bằng nhiều user khác nhau, rồi kiểm tra response có đúng user không. Một test đơn giản: mỗi request gọi `/me`, so `id` trả về với token đã gửi.
- **Test đồng thời**: viết test spec bắn N thread cùng gọi service với user khác nhau, assert mỗi thread nhận đúng kết quả của mình. Thêm `sleep` nhỏ trong stub IO để mở rộng cửa sổ race.
- **Log `request_id` và `user_id`** ở mọi tầng. Khi có báo cáo "thấy dữ liệu người khác", log là thứ duy nhất giúp truy ngược.

## Kết

Có một câu hỏi đáng tự hỏi mỗi khi viết một dòng gán: **biến này sống bao lâu và ai nhìn thấy nó?**

- Biến cục bộ, instance của object tạo trong request: an toàn.
- Class ivar, `@@`, `$`, hằng số bị sửa, memoize ở class: **dùng chung giữa mọi request**.
- `Thread.current`: riêng theo thread nhưng **sống qua nhiều request**, phải tự dọn.
- `Current` của Rails: tự dọn, dùng cho ngữ cảnh request, đừng dùng thay tham số.

Ruby và Rails không ngăn bạn viết code dùng chung trạng thái. Nhưng khi tải tăng và IO kéo dài, mọi biến dùng chung sẽ lộ ra, đúng vào lúc bạn ít muốn nó lộ ra nhất.
