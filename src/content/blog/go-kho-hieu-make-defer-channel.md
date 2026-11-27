---
title: "Những thứ khó hiểu trong Go (phần 1): make, defer, channel và select"
description: make khác new thế nào, defer chạy lúc nào và tính tham số lúc nào, chan<- với <-chan, channel nil và channel đã close hành xử ra sao, select chọn nhánh theo luật gì. Mỗi mục có code chạy thật và output.
pubDate: 2026-07-05
tags: [golang]
---

Go nổi tiếng là ngôn ngữ ít cú pháp. Nhưng chính vì ít, mỗi cú pháp lại gánh nhiều ý nghĩa, và người mới (kể cả người đã viết Go vài năm) vẫn hay vấp ở cùng vài chỗ.

Đây là phần 1 của loạt bài ba phần:

- **Phần 1 (bài này):** `make`/`new`, `defer`, channel, `select`.
- **Phần 2:** [Bẫy dữ liệu: slice, map, interface nil, shadowing](/blog/go-kho-hieu-bay-du-lieu/).
- **Phần 3:** [Con trỏ và những vấn đề của con trỏ](/blog/go-kho-hieu-con-tro/).

Mọi output trong bài đều chạy thật với Go 1.24.

## 1. `make` và `new`

Cả hai đều "cấp phát", nhưng làm hai việc khác nhau:

| | `new(T)` | `make(T, ...)` |
|---|---|---|
| Dùng cho | Mọi kiểu | **Chỉ** slice, map, channel |
| Trả về | `*T` (con trỏ) | `T` (giá trị, không phải con trỏ) |
| Giá trị bên trong | Zero value của `T` | Đã **khởi tạo** sẵn sàng dùng |

Tại sao slice, map, channel cần `make`? Vì zero value của chúng là `nil`, và một cấu trúc nil chưa có vùng nhớ bên dưới: map chưa có bảng băm, channel chưa có hàng đợi.

```go
p := new(int)          // *int, trỏ tới một int có giá trị 0
s := make([]int, 3, 5) // slice len 3, cap 5: [0 0 0]
m := make(map[string]int)
ch := make(chan int, 10) // buffered channel, sức chứa 10

bad := new(map[string]int) // *map[string]int, trỏ tới một map NIL
```

`new(map[string]int)` gần như không bao giờ là thứ bạn muốn.

### Map nil: đọc được, ghi thì panic

```go
var m map[string]int   // nil
fmt.Println(m["a"])    // 0, không lỗi
fmt.Println(len(m))    // 0
delete(m, "a")         // không lỗi
m["a"] = 1             // panic: assignment to entry in nil map
```

Slice nil thì "hiền" hơn: `append` vào slice nil vẫn chạy bình thường, nên `var s []int` rồi append là cách viết hoàn toàn hợp lệ.

Trong thực tế, `new` ít khi cần. Thay vì `p := new(User)`, người ta viết `p := &User{}`, vừa ngắn vừa gán được field luôn.

## 2. `defer`

`defer` hoãn lời gọi hàm tới **lúc hàm bao ngoài return**. Nghe đơn giản, nhưng có ba luật hay bị hiểu sai.

### Luật 1: chạy theo thứ tự ngược (LIFO)

```go
for i := 0; i < 3; i++ {
    defer fmt.Print(i, " ")
}
// Output: 2 1 0
```

Defer được đẩy vào một ngăn xếp. Điều này hợp lý: tài nguyên mở sau thì đóng trước.

### Luật 2: tham số được tính **ngay lúc gặp `defer`**, không phải lúc chạy

```go
func main() {
    x := 1
    defer fmt.Println("defer arg:", x)                    // x được chụp = 1 ngay lúc này
    defer func() { fmt.Println("defer closure:", x) }()  // closure đọc x lúc chạy
    x = 2
}
// Output:
// defer closure: 2
// defer arg: 1
```

Đây là nguồn bug kinh điển khi đo thời gian:

```go
start := time.Now()
defer log.Println("took", time.Since(start))          // SAI: time.Since tính ngay, ra ~0
defer func() { log.Println("took", time.Since(start)) }() // ĐÚNG
```

### Luật 3: defer có thể sửa giá trị trả về, nếu dùng named return

```go
func named() (n int) {
    defer func() { n *= 2 }()
    return 3
}
// named() == 6
```

`return 3` thực chất là: gán `n = 3`, chạy các defer, rồi mới thoát hàm. Defer thấy `n` và sửa được nó. Không có named return thì defer không chạm được tới giá trị trả về.

Ứng dụng phổ biến nhất là biến panic thành error:

```go
func safe() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    var m map[string]int
    m["a"] = 1 // panic
    return nil
}
// safe() trả về: recovered: assignment to entry in nil map
```

`recover()` chỉ có tác dụng khi được gọi **trực tiếp bên trong hàm defer**. Gọi ở chỗ khác luôn trả về `nil`.

### Bẫy: defer trong vòng lặp

```go
for _, path := range files {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // chỉ chạy khi HÀM return, không phải hết mỗi vòng
    // ...
}
```

Với 10.000 file, bạn giữ 10.000 file descriptor mở cùng lúc và có thể chạm giới hạn của hệ điều hành. Cách sửa: tách thân vòng lặp ra một hàm riêng, để defer chạy khi hàm đó kết thúc.

```go
for _, path := range files {
    if err := process(path); err != nil {
        return err
    }
}

func process(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    // ...
    return nil
}
```

## 3. Cú pháp channel

### Mũi tên `<-` nằm ở đâu?

Mẹo nhớ: **mũi tên chỉ hướng dữ liệu chảy**.

```go
ch <- v     // gửi: v chảy VÀO ch
v := <-ch   // nhận: dữ liệu chảy RA khỏi ch
```

Với kiểu channel cũng vậy:

```go
chan int    // hai chiều: gửi và nhận
chan<- int  // chỉ gửi (mũi tên chỉ VÀO chan)
<-chan int  // chỉ nhận (mũi tên chỉ RA khỏi chan)
```

Kiểu một chiều dùng trong chữ ký hàm, để compiler chặn dùng sai:

```go
func producer(out chan<- int) {
    for i := 0; i < 3; i++ {
        out <- i
    }
    close(out)
}

func consumer(in <-chan int) {
    for v := range in {
        fmt.Println(v)
    }
    // in <- 1  // compile error: send to receive-only channel
}

ch := make(chan int)
go producer(ch) // chan int tự chuyển thành chan<- int
consumer(ch)    // và thành <-chan int
```

### Unbuffered và buffered

- `make(chan int)`: **unbuffered**. Gửi sẽ block cho tới khi có goroutine nhận, và ngược lại. Hai bên "bắt tay" nhau, nên đây cũng là một cơ chế đồng bộ.
- `make(chan int, 3)`: **buffered**. Gửi chỉ block khi buffer đầy, nhận chỉ block khi buffer rỗng.

Lỗi hay gặp nhất của người mới:

```go
func main() {
    ch := make(chan int)
    ch <- 1          // block mãi: không ai nhận
    fmt.Println(<-ch)
}
// fatal error: all goroutines are asleep - deadlock!
```

Buffer không phải cách sửa deadlock. Nó chỉ làm deadlock đến muộn hơn. Chọn kích thước buffer phải có lý do cụ thể (giới hạn số job đang chờ, làm phẳng các đợt tăng tải), không phải "thêm 100 cho chắc".

### Nhận từ channel đã close: `v, ok`

```go
ch := make(chan int, 2)
ch <- 1
close(ch)

v, ok := <-ch // 1 true   (vẫn đọc được dữ liệu còn trong buffer)
v, ok = <-ch  // 0 false  (đã rỗng và đã close: trả zero value)
```

`ok == false` là cách duy nhất phân biệt "nhận được số 0 thật" với "channel đã đóng". `for v := range ch` làm việc này tự động và thoát khi channel đóng.

### Bảng hành vi: nên in ra dán cạnh màn hình

| Thao tác | Channel `nil` | Channel đã `close` | Channel bình thường |
|---|---|---|---|
| Gửi `ch <- v` | **Block mãi mãi** | **panic** | Gửi / block nếu đầy |
| Nhận `<-ch` | **Block mãi mãi** | Trả zero value, `ok=false` | Nhận / block nếu rỗng |
| `close(ch)` | **panic** | **panic** | Đóng channel |

Hai luật rút ra:

1. **Chỉ bên gửi được close**, và chỉ close một lần. Bên nhận close sẽ làm bên gửi panic.
2. Nhiều goroutine cùng gửi vào một channel thì không goroutine nào được tự close. Dùng `sync.WaitGroup` để đợi tất cả gửi xong rồi close ở một chỗ duy nhất:

```go
var wg sync.WaitGroup
out := make(chan int)

for i := 0; i < 3; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        out <- id
    }(i)
}

go func() {
    wg.Wait()
    close(out) // close đúng một lần, sau khi mọi bên gửi đã xong
}()

for v := range out {
    fmt.Println(v)
}
```

Channel nil block mãi nghe có vẻ vô dụng, nhưng nó lại là một công cụ hữu ích khi dùng với `select`.

## 4. `select`

`select` giống `switch`, nhưng mỗi `case` là một thao tác trên channel. Nó chờ tới khi **một** case có thể chạy.

### Nhiều case sẵn sàng: chọn **ngẫu nhiên**

```go
a := make(chan int, 1)
b := make(chan int, 1)
a <- 1
b <- 2

select {
case v := <-a:
    fmt.Println("a", v)
case v := <-b:
    fmt.Println("b", v)
}
// Có lúc in "a 1", có lúc in "b 2"
```

Không có thứ tự ưu tiên từ trên xuống như `switch`. Go cố ý chọn ngẫu nhiên để không channel nào bị bỏ đói. Nếu cần ưu tiên (ví dụ tín hiệu dừng phải được xử lý trước), phải kiểm tra riêng trước.

### `default`: không block

```go
select {
case job := <-jobs:
    handle(job)
default:
    // không có job nào sẵn: làm việc khác thay vì đứng đợi
}
```

Dùng `default` để gửi mà không block, ví dụ bỏ bớt metric khi buffer đầy:

```go
select {
case metrics <- m:
default:
    dropped.Add(1) // buffer đầy, bỏ qua thay vì làm chậm request
}
```

Cẩn thận: `for { select { ... default: } }` không có gì để chờ sẽ thành vòng lặp bận, ăn 100% một core CPU.

### Timeout

```go
select {
case res := <-resultCh:
    return res, nil
case <-time.After(2 * time.Second):
    return nil, errors.New("timeout")
case <-ctx.Done():
    return nil, ctx.Err()
}
```

Trong code thật, ưu tiên dùng `ctx.Done()` với `context.WithTimeout`, vì context truyền được việc huỷ xuống các tầng bên dưới. Chi tiết xem bài [Context trong Go](/blog/context-trong-go/).

### Gán channel = nil để tắt một nhánh

Đây là nơi channel nil phát huy tác dụng: một case nhận từ channel nil **không bao giờ được chọn**. Ví dụ gộp hai channel cho tới khi cả hai đều đóng:

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for a != nil || b != nil {
            select {
            case v, ok := <-a:
                if !ok {
                    a = nil // a đã đóng: tắt nhánh này
                    continue
                }
                out <- v
            case v, ok := <-b:
                if !ok {
                    b = nil
                    continue
                }
                out <- v
            }
        }
    }()
    return out
}
```

Nếu không gán `nil`, channel đã đóng sẽ trả `0, false` liên tục, và vòng lặp quay tít không nghỉ.

### `select {}` rỗng

```go
select {} // block mãi mãi
```

Đôi khi thấy ở cuối `main` của các chương trình chỉ chạy goroutine nền. Trong code production, nên chờ tín hiệu tắt (`signal.NotifyContext`) để còn shutdown gọn gàng.

## Tóm tắt nhanh

- `make` cho slice/map/chan và trả về giá trị đã sẵn sàng; `new` trả con trỏ tới zero value.
- `defer`: LIFO, tham số tính ngay lúc khai báo, sửa được named return, đừng defer trong vòng lặp dài.
- Mũi tên `<-` chỉ hướng dữ liệu chảy. Chỉ bên gửi được close.
- `select` chọn ngẫu nhiên giữa các case sẵn sàng; channel nil dùng để tắt một nhánh.

Phần tiếp theo: [Bẫy dữ liệu: slice, map, interface nil, shadowing](/blog/go-kho-hieu-bay-du-lieu/).
