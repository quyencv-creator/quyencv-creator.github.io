---
title: "Load test Rails API bằng k6: vì sao dân Rails hay bỏ qua, và cách setup chuẩn cho mọi dự án"
description: Cộng đồng Rails viết test rất nhiều nhưng hiếm khi load test. Bài viết phân tích lý do, rồi đưa ra một bộ setup k6 dùng lại được cho bất kỳ Rails API nào - chạy Rails ở production mode bằng Docker Compose, seed dữ liệu, xác thực, các kịch bản smoke/load/stress/spike/soak, ngưỡng pass/fail và chạy trong CI.
pubDate: 2026-11-25
tags: [rails, ruby, performance, backend, devops]
---

Hỏi một team Rails: "Có test không?" Gần như chắc chắn có, RSpec với vài nghìn example, coverage 90%.

Hỏi tiếp: "API chịu được bao nhiêu request mỗi giây? p95 bao nhiêu khi có 200 user cùng lúc?" Thường chỉ nhận về một khoảng lặng.

Bài này nói về khoảng lặng đó, và cách lấp nó bằng **k6**, một công cụ load test mã nguồn mở của Grafana Labs.

## Vì sao giới Rails ít để ý tới load test?

Đây là quan sát cá nhân từ các dự án mình làm và đọc, không phải số liệu khảo sát. Nhưng các lý do khá nhất quán.

### 1. Văn hoá "làm cho chạy trước, scale sau"

Rails sinh ra để ship nhanh. Câu "Rails can't scale" bị nhắc nhiều tới mức cộng đồng có phản xạ đáp lại: *đa số app không bao giờ cần scale tới mức đó*. Điều này đúng với phần lớn startup. Nhưng nó dần thành cái cớ để **không đo**, và khi cần scale thật thì không ai biết giới hạn hiện tại nằm ở đâu.

### 2. Thời Heroku để lại thói quen "thêm dyno"

Một thế hệ dev Rails lớn lên với Heroku: chậm thì kéo thanh trượt thêm dyno. Tiền giải quyết được vấn đề, nên không ai cần hiểu vấn đề. Tới khi chuyển sang tự vận hành (Kubernetes, ECS, VPS) và hoá đơn tăng theo tải, thói quen này mới lộ giá.

### 3. Văn hoá test xoay quanh tính đúng đắn, không phải hiệu năng

RSpec, Minitest, FactoryBot, request spec, system test: hệ sinh thái test của Rails rất giàu, nhưng tất cả đều trả lời câu hỏi **"có đúng không"**. Không có gì trong `rails new` gợi ý câu hỏi **"có đủ nhanh khi nhiều người dùng cùng lúc không"**. Thứ không có sẵn trong framework thì ít ai tự làm.

### 4. APM làm người ta tưởng đã đủ

New Relic, Skylight, Scout, Datadog cho thấy endpoint nào chậm **trên production**. Rất hữu ích, nhưng đó là đo **sau khi** vấn đề xảy ra, với tải hiện tại. APM không trả lời được: tải gấp 3 lần thì sao? Deploy mới có làm p95 tệ đi không? Pool DB 5 connection có đủ cho 10 thread Puma không?

### 5. Công cụ nằm ngoài hệ sinh thái Ruby

k6 viết bằng Go, script viết bằng JavaScript. Gatling dùng Scala/Java, JMeter là Java với giao diện XML. Dev Rails phải bước ra khỏi vùng quen thuộc. Phía Ruby không có công cụ load test nào phổ biến tương đương, và `ab`, `wrk` thì quá đơn giản cho kịch bản có đăng nhập, nhiều bước.

### 6. Load test Rails "đúng" thì phiền

Chạy `rails s` ở development rồi bắn tải là đo sai hoàn toàn: development mode reload code, không eager load, không cache, log ra từng query. Muốn số liệu có ý nghĩa phải chạy production mode, có dữ liệu đủ lớn, có Postgres và Redis giống thật. Bước chuẩn bị này đủ ngán để nhiều team bỏ cuộc.

Phần còn lại của bài giải quyết đúng lý do số 6: một bộ setup làm một lần, dùng lại mãi.

## Vì sao chọn k6?

- **Script bằng JavaScript**: dev nào cũng đọc được, review được trong PR, nằm chung repo với code.
- **Một binary duy nhất**, hoặc một Docker image `grafana/k6`. Không cần JVM, không cần cài thêm gì.
- **Ngưỡng pass/fail (thresholds)** ngay trong script: vượt ngưỡng thì k6 thoát với exit code khác 0, CI fail. Load test trở thành một bài test thật sự, không phải một biểu đồ để ngắm.
- **Mô hình tải mở (arrival rate)**: bắn đúng N request mỗi giây bất kể server nhanh hay chậm, phản ánh tải thật tốt hơn mô hình "N user lặp vòng" (giải thích ở dưới).
- Script k6 chạy trên runtime Go, không phải Node.js, nên không dùng được package npm tuỳ ý. Đây là giới hạn cần biết trước.

## Cấu trúc thư mục

Đặt toàn bộ vào thư mục `load_test/` trong repo Rails:

```text
load_test/
├── docker-compose.yml      # Rails (production mode) + Postgres + Redis + k6
├── .env.loadtest           # biến môi trường cho lần chạy load test
├── scripts/
│   ├── main.js             # entry point, chọn kịch bản qua biến SCENARIO
│   ├── config.js           # BASE_URL, thresholds, profile tải
│   ├── lib/
│   │   ├── auth.js         # đăng nhập, cache token theo VU
│   │   └── api.js          # wrapper http có tag theo endpoint
│   └── flows/
│       ├── browse.js       # luồng đọc: xem danh sách, chi tiết
│       └── checkout.js     # luồng ghi: tạo đơn hàng
└── results/                # summary JSON (gitignore)
```

Tách **flow** (người dùng làm gì) khỏi **scenario** (bao nhiêu người, trong bao lâu) là điểm mấu chốt để dùng lại. Cùng một flow chạy được ở mọi kịch bản.

## Bước 1: chạy Rails ở production mode

### docker-compose.yml

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      retries: 30

  redis:
    image: redis:7

  api:
    build: ..                       # Dockerfile production của app
    env_file: .env.loadtest
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    ports:
      - "3000:3000"
    deploy:
      resources:
        limits:
          cpus: "2"                 # giới hạn giống 1 pod/instance production
          memory: 1g

  k6:
    image: grafana/k6:latest        # nên pin version cụ thể trong dự án thật
    profiles: ["k6"]                # chỉ chạy khi gọi tường minh
    volumes:
      - ./scripts:/scripts
      - ./results:/results
    environment:
      BASE_URL: http://api:3000
    depends_on:
      - api
```

`deploy.resources.limits` quan trọng hơn người ta nghĩ: không giới hạn thì Rails trên laptop 12 core sẽ cho con số đẹp chẳng liên quan gì tới pod 2 CPU trên production.

### .env.loadtest

```bash
RAILS_ENV=production
SECRET_KEY_BASE=loadtest-only-not-a-real-secret
DATABASE_URL=postgres://postgres:postgres@db:5432/app_loadtest
REDIS_URL=redis://redis:6379/0

# Khớp với cấu hình production
WEB_CONCURRENCY=2          # số worker process Puma
RAILS_MAX_THREADS=5        # số thread mỗi worker

RAILS_LOG_LEVEL=warn       # log từng request ở mức info làm chậm đáng kể
RAILS_LOG_TO_STDOUT=1
LOAD_TEST=1                # cờ để tắt những thứ chỉ có ở production thật
```

### Những chỉnh sửa nhỏ trong app

**Pool DB phải ≥ số thread.** Sai chỗ này là lỗi Rails phổ biến nhất mà load test lôi ra được:

```yaml
# config/database.yml
production:
  pool: <%= ENV.fetch("RAILS_MAX_THREADS", 5) %>
```

Pool nhỏ hơn số thread thì dưới tải, thread phải đứng chờ connection, và cuối cùng gặp `ActiveRecord::ConnectionTimeoutError`.

**`force_ssl`**: container load test chạy HTTP thuần, nên cho tắt qua biến môi trường:

```ruby
# config/environments/production.rb
config.force_ssl = ENV["LOAD_TEST"].blank?
config.assume_ssl = ENV["LOAD_TEST"].blank?
```

**Rate limit (Rack::Attack, `rate_limit` của Rails 7.2+)**: k6 bắn từ một IP, sẽ bị chặn ngay. Đừng tắt hẳn trong code; chỉ nới ra khi có cờ `LOAD_TEST`, và **kiểm tra kỹ cờ này không bao giờ được set trên production**.

**Dịch vụ bên ngoài** (thanh toán, email, SMS): xem mục ngay dưới. Load test mà gửi 50.000 email thật là một ngày rất tệ.

## Bước 1b: secret, env và API bên ngoài khi chạy production mode

Đây là chỗ khiến nhiều team chùn tay: `RAILS_ENV=production` nghĩa là app sẽ đòi `RAILS_MASTER_KEY`, đọc `credentials.yml.enc`, và gọi Stripe, S3, SendGrid… thật. Nguyên tắc xuyên suốt:

> **Load test chạy code production, nhưng không bao giờ chạm vào secret production hay dịch vụ production.**

### Secret: credentials riêng cho load test

Đừng bao giờ copy `RAILS_MASTER_KEY` của production vào máy dev hay CI để chạy load test. Key đó mở được mọi secret thật.

Thay vào đó, tạo một bộ credentials riêng chứa toàn giá trị giả hoặc giá trị sandbox:

```bash
bin/rails credentials:edit --environment loadtest
# tạo config/credentials/loadtest.yml.enc và config/credentials/loadtest.key
```

```yaml
# nội dung loadtest.yml.enc (khi mở để sửa)
secret_key_base: loadtest-only-not-a-real-secret
stripe:
  secret_key: sk_test_loadtest_fake
  api_base: http://mock-apis:8080
aws:
  access_key_id: loadtest
  secret_access_key: loadtest
```

Rồi cho production mode đọc bộ này khi có cờ `LOAD_TEST`, mà vẫn giữ `RAILS_ENV=production`:

```ruby
# config/environments/production.rb
Rails.application.configure do
  if ENV["LOAD_TEST"] == "1"
    config.credentials.content_path = Rails.root.join("config/credentials/loadtest.yml.enc")
    config.credentials.key_path     = Rails.root.join("config/credentials/loadtest.key")
  end
  # ...
end
```

Commit file `.yml.enc`, còn `loadtest.key` thì đưa vào `.gitignore` và CI secret như mọi key khác. Dù bên trong toàn giá trị giả, giữ thói quen này để không ai quen tay commit key.

Vì sao không tạo hẳn một `RAILS_ENV=loadtest` (copy `production.rb`)? Làm được, nhưng sẽ phát sinh lệch: gem trong `group :production` của Gemfile không được load, `Rails.env.production?` trả về `false` ở những chỗ code rẽ nhánh theo môi trường, và bạn sẽ đo một thứ hơi khác production. Giữ `RAILS_ENV=production` và chỉ đổi nguồn credentials ít bất ngờ hơn.

### Biến môi trường: không có giá trị mặc định trỏ về production

```ruby
# Nguy hiểm: quên set biến là gọi thẳng production
PAYMENT_URL = ENV.fetch("PAYMENT_API_URL", "https://api.payment-provider.com")

# An toàn: thiếu biến thì app không khởi động được
PAYMENT_URL = ENV.fetch("PAYMENT_API_URL")
```

Nguyên tắc **fail-closed**: thiếu cấu hình thì crash ngay khi boot, không âm thầm rơi về giá trị thật. Nếu codebase đang hard-code URL dịch vụ ngoài, chuyển chúng ra ENV hoặc credentials là việc phải làm trước, và nó cũng có ích cho staging.

### API bên ngoài: mock server thay vì sandbox hay stub trong code

Có ba lựa chọn, và chúng không tương đương:

| Cách | Ưu | Nhược |
|---|---|---|
| Sandbox của nhà cung cấp (Stripe test mode…) | Giống thật nhất | Rate limit thấp, có thể vi phạm điều khoản sử dụng, kết quả phụ thuộc mạng ngoài |
| Stub trong code (`FakePaymentGateway`) | Đơn giản, nhanh | **Bỏ qua HTTP client, timeout, connection pool**: chính những thứ hay gãy dưới tải |
| **Mock server qua HTTP** | Đi đúng đường code thật, chỉnh được độ trễ, không phụ thuộc bên ngoài | Phải viết mapping cho từng endpoint |

Mình khuyên dùng **mock server**. Điểm quan trọng nhất mà stub trong code bỏ lỡ: **độ trễ**. Một request gọi Stripe mất 300ms là 300ms thread Puma bị giữ. Stub trả về ngay lập tức thì load test sẽ báo hệ thống chịu được gấp nhiều lần thực tế.

Ví dụ với WireMock, thêm vào `docker-compose.yml`:

```yaml
  mock-apis:
    image: wiremock/wiremock:3.9.1
    volumes:
      - ./mocks:/home/wiremock/mappings
```

```json
// load_test/mocks/payment-charge.json
{
  "request": { "method": "POST", "urlPath": "/v1/charges" },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": { "id": "ch_loadtest", "status": "succeeded" },
    "delayDistribution": { "type": "lognormal", "median": 300, "sigma": 0.4 }
  }
}
```

`delayDistribution` kiểu lognormal mô phỏng độ trễ thật: đa số quanh 300ms, thỉnh thoảng có request chậm hơn nhiều. Lấy median từ APM production (thời gian gọi external service).

Với các dịch vụ phổ biến, có sẵn bản thay thế chạy local:

- **S3** → MinIO hoặc LocalStack (`aws-sdk-s3` cấu hình được `endpoint` và `force_path_style`).
- **Email** → Mailpit qua SMTP, hoặc `config.action_mailer.delivery_method = :test` nếu không cần đo phần gửi mail.
- **SDK có `api_base`** (Stripe, nhiều SDK khác): trỏ về mock server qua credentials như trên.
- **Xác thực JWT bên thứ ba** (Auth0, Cognito): mock endpoint JWKS, ký token bằng key load test.

### Lưới an toàn cuối cùng: chặn internet ở tầng mạng

Dù cẩn thận tới đâu, vẫn có thể sót một chỗ gọi ra ngoài (một gem analytics, một initializer gửi metric). Cách chắc chắn nhất: **cho container app không có đường ra internet**.

```yaml
networks:
  loadtest:
    internal: true   # không có route ra ngoài

services:
  api:
    networks: [loadtest]
  db:
    networks: [loadtest]
  redis:
    networks: [loadtest]
  mock-apis:
    networks: [loadtest]
  k6:
    networks: [loadtest]
```

Chỗ nào gọi ra ngoài mà chưa mock sẽ lỗi kết nối ngay, hiện rõ trong log. Như vậy tốt hơn nhiều so với âm thầm tính tiền thẻ thật. (Build image vẫn cần internet để tải gem; `internal: true` chỉ áp dụng khi container chạy.)

### Đừng quên background job

Nếu `POST /orders` đẩy job Sidekiq gửi email, gọi webhook, đồng bộ sang ERP, thì những job đó cũng chạy dưới tải. Thêm container Sidekiq dùng chung `.env.loadtest`, cùng network nội bộ, để:

- Job cũng gọi vào mock, không gọi ra ngoài.
- Đo được độ dài hàng đợi. Hàng đợi tăng mãi không giảm nghĩa là worker không theo kịp, dù API vẫn trả response nhanh.

## Bước 2: dữ liệu đủ lớn và giống thật

Load test trên database 10 dòng là vô nghĩa: mọi query đều nhanh, mọi index thiếu đều vô hình. Viết một rake task tạo dữ liệu với **tỉ lệ giống production**:

```ruby
# lib/tasks/load_test.rake
namespace :load_test do
  desc "Seed dữ liệu cho load test"
  task seed: :environment do
    abort "Chỉ chạy khi LOAD_TEST=1" unless ENV["LOAD_TEST"] == "1"

    user_count = Integer(ENV.fetch("USERS", 1_000))
    password_digest = BCrypt::Password.create("loadtest-password", cost: 4)

    users = Array.new(user_count) do |i|
      {
        email: "loadtest+#{i}@example.com",
        password_digest: password_digest,
        created_at: Time.current,
        updated_at: Time.current
      }
    end
    User.insert_all(users) # nhanh hơn create! hàng chục lần

    product_ids = Product.insert_all(
      Array.new(5_000) { |i| { name: "Product #{i}", price: rand(10_000..500_000), created_at: Time.current, updated_at: Time.current } },
      returning: :id
    ).rows.flatten

    # Mỗi user khoảng 20 đơn hàng: tạo đủ dữ liệu để lộ N+1 và index thiếu
    User.where("email LIKE 'loadtest+%'").find_each do |user|
      orders = Array.new(20) do
        { user_id: user.id, product_id: product_ids.sample, total: rand(10_000..2_000_000), created_at: rand(365).days.ago, updated_at: Time.current }
      end
      Order.insert_all(orders)
    end
  end
end
```

Hai điểm cần chú ý:

- **Một password chung, hash một lần** với cost thấp. Hash bcrypt 1.000 lần ở cost mặc định mất cả phút. (Cost thấp chỉ dùng cho seed; endpoint đăng nhập vẫn chạy bcrypt với cost thật của app khi kiểm tra password.)
- `insert_all` bỏ qua validation và callback. Chấp nhận được cho seed, nhưng nhớ set những cột mà callback lẽ ra sẽ điền.

Chạy:

```bash
cd load_test
docker compose up -d api
docker compose exec api bin/rails db:prepare
docker compose exec -e USERS=1000 api bin/rails load_test:seed
```

## Bước 3: script k6

### config.js: một chỗ cho mọi con số

```javascript
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const USER_POOL = Number(__ENV.USER_POOL || 1000);

export const thresholds = {
  http_req_failed: ['rate<0.01'],                 // < 1% request lỗi
  http_req_duration: ['p(95)<500', 'p(99)<1500'], // ms
  checks: ['rate>0.99'],
  // Ngưỡng riêng cho từng endpoint, dựa trên tag name
  'http_req_duration{name:GET /orders}': ['p(95)<300'],
  'http_req_duration{name:POST /orders}': ['p(95)<800'],
};

export const profiles = {
  smoke: {
    executor: 'constant-vus',
    vus: 2,
    duration: '1m',
  },
  load: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 50,
    maxVUs: 300,
    stages: [
      { target: 50, duration: '2m' },   // tăng dần tới tải dự kiến
      { target: 50, duration: '10m' },  // giữ ổn định
      { target: 0, duration: '1m' },
    ],
  },
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 1000,
    stages: [
      { target: 100, duration: '3m' },
      { target: 200, duration: '3m' },
      { target: 400, duration: '3m' },  // tìm điểm gãy
      { target: 0, duration: '1m' },
    ],
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 1000,
    stages: [
      { target: 10, duration: '1m' },
      { target: 300, duration: '10s' }, // tăng đột ngột
      { target: 300, duration: '1m' },
      { target: 10, duration: '10s' },
      { target: 10, duration: '2m' },   // có hồi phục không?
    ],
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: 30,
    timeUnit: '1s',
    duration: '2h',                     // tìm rò rỉ bộ nhớ, connection
    preAllocatedVUs: 50,
    maxVUs: 200,
  },
};
```

**Các con số ở đây chỉ là điểm khởi đầu.** Tải "load" phải lấy từ số liệu production thật (RPS giờ cao điểm trong APM hoặc log), còn ngưỡng p95 phải là cam kết mà team và product đồng ý.

### Arrival rate vs số VU cố định

Với API, ưu tiên executor `*-arrival-rate` (mô hình mở) thay vì `constant-vus` (mô hình đóng):

- **Mô hình đóng**: 50 VU, mỗi VU gửi request rồi **chờ response** mới gửi tiếp. Server chậm đi thì VU cũng gửi chậm lại, tải tự giảm, và biểu đồ trông đỡ tệ hơn thực tế.
- **Mô hình mở**: 50 request mỗi giây, bất kể server nhanh hay chậm. Đây mới là cách user thật hành xử: họ không lịch sự đợi server rảnh rồi mới bấm.

Smoke test dùng VU cố định là đủ, vì mục đích chỉ là kiểm tra script chạy đúng.

### lib/auth.js: đăng nhập một lần cho mỗi VU

```javascript
import http from 'k6/http';
import { check, fail } from 'k6';
import { BASE_URL, USER_POOL } from '../config.js';

let token = null; // biến module: mỗi VU có bản riêng

export function authHeaders() {
  if (!token) {
    // Mỗi VU dùng một user khác nhau, tránh mọi VU cùng đè lên dữ liệu của một user
    const i = (__VU - 1) % USER_POOL;
    const res = http.post(
      `${BASE_URL}/api/v1/sessions`,
      JSON.stringify({ email: `loadtest+${i}@example.com`, password: 'loadtest-password' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /sessions' } },
    );
    if (!check(res, { 'login 200': (r) => r.status === 200 })) {
      fail(`login failed: ${res.status}`);
    }
    token = res.json('token');
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
```

Mỗi VU là một runtime JavaScript riêng, nên biến `token` ở cấp module không bị chia sẻ giữa các VU. Không đăng nhập mỗi iteration, vì như vậy bạn đang đo tốc độ bcrypt chứ không phải API.

Endpoint và format token ở trên (`/api/v1/sessions`, `token`) là giả định. Hãy chỉnh theo cách xác thực của app bạn (Devise JWT, `has_secure_token`, OAuth…).

### lib/api.js: gắn tag cho URL có ID

```javascript
import http from 'k6/http';
import { BASE_URL } from '../config.js';
import { authHeaders } from './auth.js';

export function get(path, name) {
  return http.get(`${BASE_URL}${path}`, { headers: authHeaders(), tags: { name } });
}

export function post(path, body, name) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: authHeaders(), tags: { name } });
}
```

Tag `name` rất quan trọng. Không có nó, `/orders/1`, `/orders/2`… `/orders/9999` thành 9.999 dòng metric riêng biệt, vừa không đọc được vừa làm k6 tốn bộ nhớ. Có tag thì tất cả gộp về `GET /orders/:id`.

### flows: người dùng làm gì

```javascript
// flows/browse.js
import { check, sleep } from 'k6';
import { get } from '../lib/api.js';

export function browse() {
  const list = get('/api/v1/orders?page=1', 'GET /orders');
  check(list, { 'orders 200': (r) => r.status === 200 });

  const orders = list.json('data') || [];
  if (orders.length > 0) {
    const id = orders[Math.floor(Math.random() * orders.length)].id;
    const detail = get(`/api/v1/orders/${id}`, 'GET /orders/:id');
    check(detail, { 'order 200': (r) => r.status === 200 });
  }
  sleep(Math.random() * 2); // thời gian user "đọc", tránh bắn liên tục phi thực tế
}
```

```javascript
// flows/checkout.js
import { check } from 'k6';
import { post } from '../lib/api.js';

export function checkout() {
  const res = post('/api/v1/orders', { product_id: 1 + Math.floor(Math.random() * 5000), quantity: 1 }, 'POST /orders');
  check(res, { 'create 201': (r) => r.status === 201 });
}
```

Cấu trúc JSON (`data`, `id`), mã trạng thái và ID sản phẩm phụ thuộc API của bạn. Đây là phần duy nhất phải viết lại theo từng dự án.

### main.js: ghép lại

```javascript
import { profiles, thresholds } from './config.js';
import { browse } from './flows/browse.js';
import { checkout } from './flows/checkout.js';

const scenario = __ENV.SCENARIO || 'smoke';
if (!profiles[scenario]) {
  throw new Error(`Unknown SCENARIO: ${scenario}`);
}

export const options = {
  scenarios: {
    [scenario]: { ...profiles[scenario], exec: 'mixed' },
  },
  thresholds,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

// Tỉ lệ đọc/ghi lấy theo production. Ví dụ: 90% đọc, 10% ghi.
export function mixed() {
  if (Math.random() < 0.9) {
    browse();
  } else {
    checkout();
  }
}

export function handleSummary(data) {
  return {
    [`/results/${scenario}-summary.json`]: JSON.stringify(data, null, 2),
    stdout: '\n' + JSON.stringify({
      scenario,
      p95_ms: data.metrics.http_req_duration.values['p(95)'],
      failed_rate: data.metrics.http_req_failed.values.rate,
      rps: data.metrics.http_reqs.values.rate,
    }, null, 2) + '\n',
  };
}
```

## Bước 4: chạy

```bash
cd load_test

# Luôn chạy smoke trước: kiểm tra script, auth, dữ liệu đều ổn
docker compose run --rm k6 run -e SCENARIO=smoke /scripts/main.js

# Sau đó mới tới kịch bản thật
docker compose run --rm k6 run -e SCENARIO=load /scripts/main.js
docker compose run --rm k6 run -e SCENARIO=stress /scripts/main.js
```

Kịch bản nào dùng để trả lời câu hỏi nào:

| Kịch bản | Câu hỏi | Khi nào chạy |
|---|---|---|
| smoke | Script và hệ thống có chạy không? | Mọi PR có đụng tới API |
| load | Tải bình thường có đạt ngưỡng không? | Trước release, hằng đêm |
| stress | Gãy ở đâu, gãy kiểu gì? | Khi lên kế hoạch scale |
| spike | Tải tăng đột ngột thì sao, có hồi phục không? | Trước sự kiện, chiến dịch marketing |
| soak | Chạy lâu có rò bộ nhớ, rò connection không? | Định kỳ, sau thay đổi lớn |

## Bước 5: đọc kết quả theo cách của Rails

Con số k6 chỉ là triệu chứng. Đi kèm, luôn xem các tín hiệu phía server:

- **p95/p99, không phải trung bình.** Trung bình 120ms có thể đang che 5% request mất 3 giây.
- **`ActiveRecord::ConnectionTimeoutError`** trong log: pool DB nhỏ hơn số thread, hoặc có request giữ connection quá lâu.
- **CPU của Puma 100% mà RPS không tăng**: CPU-bound, hoặc tranh chấp GVL. Thử tăng `WEB_CONCURRENCY` (thêm process) thay vì tăng thread.
- **CPU thấp mà latency cao**: đang chờ IO, thường là DB. Bật `pg_stat_statements` và xem query nào chiếm nhiều thời gian nhất.
- **Bộ nhớ tăng đều trong soak test**: rò bộ nhớ, hoặc phân mảnh bộ nhớ (thử `jemalloc` hoặc `MALLOC_ARENA_MAX=2`).
- **N+1**: dữ liệu seed lớn sẽ phơi bày chúng. Bật gem `prosopite` hoặc `bullet` trong lần chạy smoke để bắt.
- **Lỗi dữ liệu dưới tải**: nhân tiện kiểm tra response có đúng user không. Nếu có biến dùng chung giữa các thread, load test là nơi nó lộ ra, xem [bài về Ruby thread](/blog/ruby-thread-du-lieu-request/).

Quy trình đúng là **thay đổi một thứ mỗi lần**: chạy, ghi lại baseline, sửa một chỗ (thêm index, chỉnh pool, đổi số thread), chạy lại, so sánh. Thay ba thứ cùng lúc thì không biết thứ nào có tác dụng.

## Bước 6: đưa vào CI

Smoke test trên mỗi PR, chạy hoàn toàn trong Docker Compose, không cần môi trường riêng:

```yaml
# .github/workflows/load-test-smoke.yml
name: Load test (smoke)

on:
  pull_request:
    paths: ["app/**", "config/**", "db/**", "load_test/**"]

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - name: Start stack
        working-directory: load_test
        run: |
          docker compose up -d --build api
          docker compose exec -T api bin/rails db:prepare
          docker compose exec -T -e USERS=100 api bin/rails load_test:seed

      - name: Run k6 smoke
        working-directory: load_test
        run: docker compose run --rm k6 run -e SCENARIO=smoke -e USER_POOL=100 /scripts/main.js

      - name: Upload summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-smoke
          path: load_test/results/
```

Kịch bản `load` và `stress` không nên chạy trong GitHub Actions: runner dùng chung tài nguyên, số liệu dao động mạnh giữa các lần chạy. Chạy chúng theo lịch (hằng đêm) trên **staging có cấu hình giống production**, với k6 trên một máy riêng, không chung máy với app. k6 chung máy với Rails sẽ tranh CPU với chính thứ nó đang đo.

## Những điều cần nói thẳng

- **Số liệu từ Docker Compose trên laptop không phải năng lực của production.** Nó dùng để **so sánh**: trước và sau một thay đổi, branch này với main. Muốn biết năng lực thật thì đo trên staging giống production.
- **Không load test production** khi chưa có kế hoạch và sự đồng ý của người vận hành. Bạn có thể tự DDoS chính mình, làm bẩn dữ liệu analytics, hoặc làm cạn quota của dịch vụ bên thứ ba.
- **Load test không thay thế APM** và ngược lại. APM cho biết cái gì đang chậm với user thật; load test cho biết điều gì *sẽ* xảy ra.
- **Bộ setup này tốn khoảng một ngày để dựng lần đầu** cho một Rails API trung bình. Phần tốn thời gian nhất là rake seed và các flow, vì chúng gắn với nghiệp vụ. Phần còn lại (compose, config, auth, CI) gần như copy được nguyên.

Một ngày công đổi lấy việc biết trước hệ thống gãy ở đâu, thay vì biết được vào 9 giờ tối ngày chạy khuyến mãi.
