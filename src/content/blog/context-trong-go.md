---
title: "Context trong Go: vì sao hàm nào cũng phải nhận ctx?"
description: Gọi hàm mà không truyền ctx thì sao? Thử cho hàm treo, cho query PostgreSQL mồ côi giữ lock khi server tắt, cho job export bị dừng giữa chừng. Từ đó hiểu context đơn giản nhất có thể, và vì sao Ruby không cần thứ này.
pubDate: 2026-11-21
tags: [golang, concurrency, backend]
---

Mới học Go, ai cũng thấy khó chịu: hàm nào cũng có `ctx context.Context` làm tham số đầu tiên, truyền từ trên xuống dưới như một nghi thức. Không truyền có được không?

Được, code vẫn chạy. Bài này cho thấy **khi nào thì không truyền sẽ thành vấn đề**, bằng những ví dụ chạy được.

## 1. Thí nghiệm: một hàm bị treo

Một chương trình bình thường: có một goroutine chạy nền, một hàm gửi email, và một hàm gọi API lấy giá. Không ai dùng context.

```go
package main

import (
	"fmt"
	"time"
)

// Giả lập gọi API bên ngoài bị treo: không bao giờ trả lời.
func fetchPrice() (int, error) {
	select {} // treo mãi mãi
}

func sendEmail() {
	time.Sleep(200 * time.Millisecond)
	fmt.Println("email: đã gửi")
}

func main() {
	start := time.Now()

	go func() {
		for i := 1; ; i++ {
			time.Sleep(300 * time.Millisecond)
			fmt.Println("worker: xử lý job", i)
		}
	}()

	sendEmail()

	price, err := fetchPrice() // ← main kẹt ở đây
	fmt.Println("giá:", price, err)

	fmt.Println("xong sau", time.Since(start))
}
```

Chạy:

```
email: đã gửi
worker: xử lý job 1
worker: xử lý job 2
worker: xử lý job 3
...
(chạy mãi, phải Ctrl+C)
```

Chuyện gì đã xảy ra:

- `sendEmail()` chạy bình thường.
- `fetchPrice()` **treo**, và `main` treo theo. Dòng "xong sau" không bao giờ in ra.
- Goroutine worker **vẫn chạy tiếp**, không ai bảo nó dừng.
- Từ bên ngoài, **không có cách nào** bảo `fetchPrice` "thôi, đừng chờ nữa".

Trong thực tế, "treo" không phải chuyện hiếm: API bên thứ ba không trả lời, DB bị lock, mạng mất gói tin. Với web server, mỗi request kẹt như vậy giữ một goroutine, một kết nối DB, một ít bộ nhớ. Một nghìn request kẹt là server chết.

### Còn nếu hàm bị lỗi thì sao?

Nếu `fetchPrice` **trả lỗi ngay** (`return 0, errors.New("API 500")`), mọi thứ vẫn ổn: `main` nhận `err`, xử lý, chạy tiếp. Lỗi trả về thì Go xử lý bằng `error` là đủ, **không cần context**.

Vấn đề nằm ở chỗ khác: context không dùng để báo lỗi **từ dưới lên**. Nó dùng để báo **từ trên xuống**: "thôi, dừng lại đi". Hai trường hợp cần báo như vậy:

1. **Quá thời gian**: chờ đủ lâu rồi, bỏ cuộc.
2. **Không cần nữa**: người dùng đóng tab, một việc song song đã lỗi, chương trình đang tắt.

### Bọc thêm goroutine có giải quyết được không?

Một cách "chữa" hay gặp: chạy `fetchPrice` trong goroutine, rồi `select` với `time.After`:

```go
ch := make(chan int, 1)
go func() { p, _ := fetchPrice(); ch <- p }()

select {
case p := <-ch:
	fmt.Println("giá:", p)
case <-time.After(time.Second):
	fmt.Println("quá thời gian")
}
```

`main` thoát được, nhưng goroutine chạy `fetchPrice` **vẫn treo ở đó mãi**, cùng với kết nối mạng nó đang giữ. Đây là **goroutine leak**: mình chỉ ngừng *chờ*, chứ không *dừng* được việc kia. Muốn dừng thật thì chính `fetchPrice` phải biết lắng nghe tín hiệu dừng. Đó chính là việc của context.

## 2. Sửa bằng context

```go
func fetchPrice(ctx context.Context) (int, error) {
	select {
	case <-time.After(time.Hour): // giả lập API rất chậm
		return 100, nil
	case <-ctx.Done(): // có người bảo dừng
		return 0, ctx.Err()
	}
}

func worker(ctx context.Context) {
	for i := 1; ; i++ {
		select {
		case <-ctx.Done():
			fmt.Println("worker: dừng vì", ctx.Err())
			return
		case <-time.After(300 * time.Millisecond):
			fmt.Println("worker: xử lý job", i)
		}
	}
}

func main() {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	done := make(chan struct{})
	go func() { worker(ctx); close(done) }()

	price, err := fetchPrice(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		fmt.Println("fetchPrice: quá 1 giây, bỏ qua")
	} else {
		fmt.Println("giá:", price)
	}

	<-done
	fmt.Println("xong sau", time.Since(start).Round(100*time.Millisecond))
}
```

Kết quả:

```
worker: xử lý job 1
worker: xử lý job 2
worker: xử lý job 3
fetchPrice: quá 1 giây, bỏ qua
worker: dừng vì context deadline exceeded
xong sau 1s
```

**Một** dòng `context.WithTimeout` ở `main` đã dừng được **cả** `fetchPrice` lẫn goroutine worker. Không còn gì treo, không còn goroutine chạy lạc.

Trong code thật, bạn hiếm khi tự viết `select { case <-ctx.Done() }`. Các thư viện đã làm sẵn: `http.NewRequestWithContext`, `db.QueryContext`, `rdb.Get(ctx, ...)`. Việc của bạn chỉ là **truyền ctx xuống** tới chúng.

## 3. Một hàm lỗi, huỷ luôn các hàm còn lại

Trường hợp hay gặp hơn: trang chủ cần tải song song 3 thứ: thông tin user, đơn hàng, gợi ý sản phẩm. Nếu tải user **lỗi**, hai cái còn lại có chạy tiếp cũng vô ích.

```go
func loadUser(ctx context.Context) error {
	select {
	case <-time.After(200 * time.Millisecond):
		return errors.New("DB: connection refused") // lỗi sau 200ms
	case <-ctx.Done():
		return ctx.Err()
	}
}

func loadOrders(ctx context.Context) error {
	select {
	case <-time.After(5 * time.Second): // việc chậm, mất 5 giây
		fmt.Println("orders: xong")
		return nil
	case <-ctx.Done():
		fmt.Println("orders: huỷ giữa chừng vì", context.Cause(ctx))
		return ctx.Err()
	}
}

// loadRecommend giống loadOrders

func main() {
	start := time.Now()
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)

	var wg sync.WaitGroup
	for _, f := range []func(context.Context) error{loadUser, loadOrders, loadRecommend} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := f(ctx); err != nil && !errors.Is(err, context.Canceled) {
				cancel(err) // một hàm lỗi → huỷ tất cả
			}
		}()
	}
	wg.Wait()
	fmt.Println("lỗi:", context.Cause(ctx))
	fmt.Println("xong sau", time.Since(start).Round(100*time.Millisecond))
}
```

Kết quả:

```
recommend: huỷ giữa chừng vì DB: connection refused
orders: huỷ giữa chừng vì DB: connection refused
lỗi: DB: connection refused
xong sau 200ms
```

Mất **200ms** thay vì 5 giây. Không có context, `loadOrders` và `loadRecommend` vẫn chạy hết 5 giây, giữ kết nối DB, chỉ để kết quả bị vứt đi.

Mẫu này phổ biến tới mức có sẵn package [`errgroup`](https://pkg.go.dev/golang.org/x/sync/errgroup): `g, ctx := errgroup.WithContext(ctx)`, rồi `g.Go(...)` và `g.Wait()`. Nó làm đúng những gì đoạn code trên làm.

## 4. Context, giải thích đơn giản nhất

Hãy tưởng tượng context là **một sợi dây** buộc vào mọi việc đang làm cho cùng một yêu cầu.

- `main` (hoặc HTTP handler) **cầm đầu dây**.
- Mỗi lần gọi hàm và truyền `ctx`, sợi dây được **nối dài** xuống hàm đó.
- Khi cần dừng, chỉ cần **giật đầu dây** (`cancel()` hoặc hết giờ). Mọi hàm đang nắm dây đều cảm nhận được (`<-ctx.Done()`) và tự dừng.

Context mang ba thứ chính, cộng một thứ phụ:

| Thứ | Hỏi bằng | Ý nghĩa |
|---|---|---|
| Tín hiệu huỷ | `<-ctx.Done()` | Đóng lại khi có người bảo dừng |
| Lý do | `ctx.Err()`, `context.Cause(ctx)` | `Canceled`, `DeadlineExceeded`, hoặc lỗi cụ thể |
| Hạn chót | `ctx.Deadline()` | Phải xong trước thời điểm nào |
| (Thêm) giá trị theo request | `ctx.Value(key)` | Request ID, user đã đăng nhập; dùng có chừng mực |

Và vài cách tạo:

```go
ctx := context.Background()                                  // gốc, không bao giờ bị huỷ
ctx, cancel := context.WithCancel(parent)                    // huỷ bằng tay
ctx, cancel := context.WithTimeout(parent, 2*time.Second)    // tự huỷ sau 2 giây
ctx, stop := signal.NotifyContext(parent, os.Interrupt)      // tự huỷ khi bấm Ctrl+C
```

Context là **cây**: context con được tạo từ context cha. Cha bị huỷ thì **mọi con đều bị huỷ**. Con bị huỷ thì cha **không bị ảnh hưởng**. Vì vậy một handler có thể đặt timeout 2 giây riêng cho lời gọi API, mà không làm ảnh hưởng tới cả request.

Ba quy tắc cần nhớ:

1. `ctx` là **tham số đầu tiên** của mọi hàm có I/O hoặc có thể chạy lâu.
2. Có `cancel` thì **luôn `defer cancel()`**, kể cả với `WithTimeout`, để giải phóng tài nguyên sớm.
3. **Không lưu ctx trong struct**, không tạo `context.Background()` mới giữa chừng (làm vậy là cắt đứt sợi dây).

Trong web server, bạn thậm chí không cần tạo ctx: `r.Context()` của `net/http` **tự huỷ khi client ngắt kết nối**. Người dùng đóng tab là mọi truy vấn DB đang chạy cho request đó dừng theo, miễn là bạn đã truyền ctx xuống tới tận chúng.

## 5. Context thật sự cứu bạn ở đâu?

Ví dụ `time.After` ở trên dễ hiểu nhưng hơi "đồ chơi". Đây là những tình huống thật, nơi thiếu context thì hậu quả nằm ngoài chương trình Go của bạn.

### 5.1. Database đang chạy query thì server tắt

Một request mở transaction, `UPDATE` một dòng (giữ **row lock**), rồi chạy một câu query báo cáo nặng. Đúng lúc đó server Go bị tắt hoặc crash.

Câu hỏi hay gặp: **connection có bị deadlock không?**

Không phải deadlock theo nghĩa của database (hai transaction chờ nhau, PostgreSQL tự phát hiện và huỷ một bên). Mà là thứ khó chịu hơn: **query mồ côi**. Mình đã thử với PostgreSQL 16 và pgx v5:

```go
// KHÔNG có context
tx, _ := db.Begin()
tx.Exec("UPDATE accounts SET balance = balance - 10 WHERE id = 1") // giữ row lock
tx.Exec("SELECT pg_sleep(60)")                                      // giả lập query nặng
// ... server crash ở giây thứ 1
```

16 giây sau khi process Go đã chết, nhìn vào PostgreSQL:

```
SELECT state, wait_event, query FROM pg_stat_activity;

 state  | wait_event | age_s |        query
--------+------------+-------+---------------------
 active | PgSleep    |    16 | SELECT pg_sleep(60)
```

Query **vẫn chạy**. PostgreSQL không biết client đã chết, vì nó chỉ phát hiện ra khi cố gửi kết quả về. Trong lúc đó transaction vẫn giữ row lock, và mọi request khác muốn sửa tài khoản số 1 đều **phải chờ**:

```
SET lock_timeout = '3s';
UPDATE accounts SET balance = balance + 1 WHERE id = 1;
ERROR:  canceling statement due to lock timeout
```

Với một query báo cáo chạy 10 phút, đó là 10 phút tài khoản bị khoá, 10 phút CPU của DB bị chiếm cho một kết quả không ai nhận.

Giờ làm lại với context:

```go
tx, err := db.BeginTx(ctx, nil)
tx.ExecContext(ctx, "UPDATE accounts SET balance = balance - 10 WHERE id = 1")
_, err = tx.ExecContext(ctx, "SELECT pg_sleep(60)")
// ctx bị huỷ sau 1 giây
// → err = context canceled, query dừng sau 1s
```

Lần này `pg_stat_activity` **trống**, và `UPDATE` từ request khác chạy được ngay. Khi ctx bị huỷ, driver gửi một **CancelRequest** riêng tới PostgreSQL, bảo server dừng câu query đó; transaction bị rollback, lock được nhả.

Có một chi tiết mình chỉ phát hiện khi chạy thử: **pgx gửi CancelRequest trong một goroutine nền**. Lần đầu mình cho chương trình `os.Exit` ngay sau `cancel()`, goroutine đó chưa kịp gửi, và query vẫn chạy trên server như không có gì. Bài học: **huỷ ctx xong phải cho chương trình thời gian dọn dẹp**, đừng thoát ngay. Đó chính là lý do cần graceful shutdown ở phần 5.2.

Context không cứu được trường hợp process bị `kill -9` hay mất điện, vì lúc đó không còn code nào chạy để gửi tín hiệu. Lớp phòng thủ cuối là cấu hình phía database: `statement_timeout`, `idle_in_transaction_session_timeout`, và `client_connection_check_interval` (PostgreSQL 14+) để server tự kiểm tra client còn sống không.

### 5.2. Export đang chạy thì server phải tắt

Job export xuất 1 triệu đơn hàng ra CSV, chạy hàng trăm query theo từng batch. Giữa chừng, server được deploy bản mới và nhận `SIGTERM`.

Không có context, có hai kết cục, đều tệ:

- Process bị giết ngang: file CSV ghi dở, có thể đã bị gửi cho người dùng như thể là file hoàn chỉnh; query đang chạy thành query mồ côi như phần 5.1; job bị đánh dấu "đang chạy" mãi mãi.
- Hoặc job không biết gì cả, tiếp tục bắn **hàng trăm query còn lại** trong lúc server đang cố tắt, kéo dài thời gian deploy cho tới khi bị kill cứng.

Với context, job **tự biết** để dừng ở batch hiện tại, xoá file tạm, báo lỗi rõ ràng:

```go
func exportOrders(ctx context.Context, db *pgxpool.Pool, path string) (err error) {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	defer func() {
		f.Close()
		if err != nil {
			os.Remove(tmp) // không để lại file dở dang
			return
		}
		err = os.Rename(tmp, path) // chỉ khi xong hết mới "công bố" file
	}()

	w := csv.NewWriter(f)
	lastID, batch := 0, 0
	for {
		rows, err := db.Query(ctx, // ← ctx đi tới tận câu query
			`SELECT id, total FROM orders WHERE id > $1 ORDER BY id LIMIT 1000`, lastID)
		if err != nil {
			return fmt.Errorf("batch %d: %w", batch, err)
		}
		n := 0
		for rows.Next() {
			var id, total int
			if err := rows.Scan(&id, &total); err != nil {
				rows.Close()
				return err
			}
			w.Write([]string{strconv.Itoa(id), strconv.Itoa(total)})
			lastID, n = id, n+1
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("batch %d: %w", batch, err)
		}
		if n == 0 {
			w.Flush()
			return w.Error()
		}
		batch++
	}
}
```

Không cần chỗ nào viết `if ctx.Err() != nil`: `db.Query(ctx, ...)` tự trả lỗi ngay khi ctx bị huỷ, kể cả khi đang chờ giữa chừng một query.

Phần còn lại là `main` với **graceful shutdown**. Điểm quan trọng: job export chạy nền nên dùng **ctx của app**, không dùng `r.Context()` (cái đó bị huỷ ngay khi request trả 202 về).

```go
func main() {
	// ctx tự huỷ khi nhận Ctrl+C hoặc SIGTERM (Kubernetes, systemd, docker stop)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	var jobs sync.WaitGroup
	mux := http.NewServeMux()
	mux.HandleFunc("POST /exports", func(w http.ResponseWriter, r *http.Request) {
		jobs.Add(1)
		go func() {
			defer jobs.Done()
			err := exportOrders(ctx, db, "/data/orders.csv") // ctx của app
			log.Printf("export kết thúc: %v", err)
		}()
		w.WriteHeader(http.StatusAccepted)
	})

	srv := &http.Server{
		Addr:        ":8080",
		Handler:     mux,
		BaseContext: func(net.Listener) context.Context { return ctx }, // request cũng bị huỷ khi tắt
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done() // chờ tín hiệu tắt
	log.Println("nhận tín hiệu tắt, dừng nhận request mới")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx) // chờ request đang chạy xong, tối đa 10 giây
	jobs.Wait()               // chờ job export dọn dẹp xong
	log.Println("đã dọn dẹp xong, thoát")
}
```

Chạy thật: gọi `POST /exports`, 2 giây sau gửi `SIGTERM`:

```
POST /exports -> 202
nhận tín hiệu tắt, dừng nhận request mới
export: kết thúc sau 2.13s, err=batch 1: context canceled
đã dọn dẹp xong, thoát
```

PostgreSQL không còn query nào của job, file tạm đã bị xoá, process thoát sạch. Job nên được đánh dấu "bị huỷ" trong DB để chạy lại sau, thay vì nằm "đang chạy" mãi.

### 5.3. Người dùng đóng tab giữa lúc tìm kiếm nặng

Trang tìm kiếm chạy một query full-text mất 8 giây. Người dùng sốt ruột, F5 năm lần. Không có context: server chạy **năm** query 8 giây, bốn cái kết quả không ai nhận. Với `r.Context()` truyền xuống `db.Query(ctx, ...)`, mỗi lần F5 là request cũ bị huỷ và query cũ dừng ngay. Lúc cao điểm, đây là khác biệt giữa DB chịu tải được và DB sập.

### 5.4. Gọi API bên thứ ba

`http.Get` mặc định **không có timeout**. Đối tác thanh toán treo là goroutine của bạn treo theo, mỗi request một cái, cho tới khi hết bộ nhớ.

```go
ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, http.MethodPost, paymentURL, body)
resp, err := client.Do(req) // tối đa 3 giây, hoặc sớm hơn nếu client ngắt
```

Dùng `r.Context()` làm cha, nên timeout 3 giây **không vượt quá** thời gian còn lại của cả request. Request chỉ còn 1 giây thì lời gọi API cũng chỉ được 1 giây.

### 5.5. Vòng lặp retry

```go
for attempt := 0; ; attempt++ {
	err := callAPI(ctx)
	if err == nil {
		return nil
	}
	select {
	case <-time.After(backoff(attempt)):
	case <-ctx.Done():
		return ctx.Err() // đang chờ để retry mà bị huỷ: dừng luôn
	}
}
```

Không có `ctx.Done()`, vòng retry vẫn kiên nhẫn chờ 1s, 2s, 4s, 8s… để gọi lại cho một request đã chết từ lâu.

### 5.6. Consumer đọc từ hàng đợi

Worker đọc message từ Kafka, RabbitMQ, SQS. Khi deploy, ta muốn: **xử lý nốt message đang làm, không nhận message mới**, rồi mới thoát. Vòng lặp `for` kiểm tra `ctx.Done()` trước mỗi lần lấy message mới, và message đang xử lý dở thì **không commit offset/ack**, để lần sau worker khác nhận lại. Thiếu context, worker bị giết giữa chừng sau khi đã ack nhưng chưa xử lý xong, và message đó biến mất.

### 5.7. Chờ tài nguyên có hạn

Lấy kết nối từ pool đang cạn, chờ semaphore, chờ lock phân tán trên Redis: tất cả đều là **chờ**, và chờ thì phải có giới hạn. `pool.Acquire(ctx)`, `sem.Acquire(ctx, 1)` trả lỗi khi ctx hết hạn, thay vì xếp hàng vô hạn và kéo cả hệ thống chậm theo.

### Điểm chung

Mọi tình huống trên có chung một hình dạng: **ai đó ở trên đã không cần kết quả nữa** (hết giờ, người dùng bỏ đi, server tắt, một nhánh khác lỗi), nhưng **ai đó ở dưới vẫn đang tốn tài nguyên** (query, lock, kết nối, file, CPU). Context là đường dây để tin "không cần nữa" đi từ trên xuống tới tận dưới cùng, và tới cả **tiến trình khác** như PostgreSQL.

## 6. Vì sao Ruby không cần, còn Go lúc nào cũng phải truyền?

Một controller Rails không có `ctx` nào cả:

```ruby
class OrdersController < ApplicationController
  def show
    @order = Order.find(params[:id])
    @price = PriceApi.fetch(@order.sku)
  end
end
```

Vậy timeout và huỷ được xử lý ở đâu? Ở **từng thư viện** và **ở tầng server**:

- `Net::HTTP` có `open_timeout`, `read_timeout`; mỗi thư viện HTTP tự cấu hình timeout riêng.
- PostgreSQL có `statement_timeout` trong `database.yml`.
- Puma, Unicorn, hoặc `Rack::Timeout` giới hạn cả request; quá giờ thì cắt ngang thread/process.
- Dữ liệu theo request (user hiện tại, request id) để trong `Current` attributes hoặc thread-local, không cần truyền tay.

Sự khác biệt đến từ **mô hình chạy**:

| | Ruby (Rails điển hình) | Go |
|---|---|---|
| Mỗi request chạy trong | Một thread hoặc process riêng, tuần tự từ đầu tới cuối | Một goroutine, thường đẻ thêm nhiều goroutine con |
| Chạy song song trong một request | Hiếm | Rất phổ biến |
| Dữ liệu theo request | Thread-local, "ma thuật" ngầm | Truyền tường minh bằng tham số |
| Dừng một việc đang chạy | Server cắt ngang từ bên ngoài (`Timeout`, kill process) | Không thể giết goroutine từ bên ngoài, nó phải **tự** dừng khi nghe `ctx.Done()` |

Điểm mấu chốt nằm ở dòng cuối: **Go không có cách nào giết một goroutine từ bên ngoài**. Goroutine không có id công khai, không có `kill`. Thiết kế này tránh được cả loạt bug do bị cắt ngang giữa chừng (Ruby `Timeout.timeout` nổi tiếng vì có thể ngắt ngay giữa lúc đang ghi dữ liệu, để lại trạng thái hỏng). Cái giá phải trả: muốn goroutine dừng thì phải **nói với nó**, và kênh để nói chính là `ctx`.

Thêm vào đó, một request Go thường đẻ ra nhiều goroutine (gọi song song 3 API, chạy job nền). Thread-local không đi theo goroutine con được, nên Go chọn cách **truyền tường minh**: nhìn chữ ký hàm là biết hàm này có thể bị huỷ.

Ruby giấu chuyện này đi cho tiện. Go bắt bạn viết ra cho rõ.

## Tóm lại

- Không truyền ctx thì code vẫn chạy, cho tới khi có một hàm **treo**: `main` treo theo, goroutine chạy lạc, kết nối bị giữ mãi.
- Lỗi trả về thì dùng `error`. Context dùng cho chiều ngược lại: báo **từ trên xuống** là hãy dừng, vì hết giờ hoặc vì không cần nữa.
- Bọc goroutine + `time.After` chỉ ngừng *chờ*, không *dừng* được việc kia, và gây goroutine leak.
- Context là sợi dây nối mọi việc của một yêu cầu: giật đầu dây là tất cả cùng dừng. Cha huỷ thì con huỷ, con huỷ không ảnh hưởng cha.
- Tác dụng lớn nhất nằm **ngoài** chương trình Go: không có ctx, server tắt thì query vẫn chạy trên PostgreSQL và **giữ lock**; có ctx, driver gửi CancelRequest, query dừng, lock được nhả.
- Huỷ ctx xong phải **cho thời gian dọn dẹp** (graceful shutdown): job export dừng ở batch hiện tại, xoá file tạm, rồi mới thoát. Job nền dùng ctx của app, không dùng `r.Context()`.
- Ctx cũng là thứ giới hạn mọi kiểu **chờ**: API bên thứ ba, vòng retry, pool kết nối, semaphore, hàng đợi.
- Ruby xử lý timeout ở từng thư viện và cắt ngang từ server. Go không cho giết goroutine từ bên ngoài, nên mọi hàm phải nhận ctx để **tự** dừng.
