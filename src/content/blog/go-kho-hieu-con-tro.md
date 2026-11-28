---
title: "Những thứ khó hiểu trong Go (phần 3): con trỏ và những vấn đề của con trỏ"
description: Go truyền mọi thứ bằng giá trị, vậy khi nào cần con trỏ? Receiver con trỏ và receiver giá trị, method set và interface, nil receiver, copy struct chứa Mutex, escape analysis, con trỏ có thật sự nhanh hơn không, và *string cho field tuỳ chọn.
pubDate: 2026-07-20
tags: [golang]
series: nhung-thu-kho-hieu-trong-go
seriesOrder: 3
---

Phần cuối của loạt bài. Hai phần trước: [make, defer, channel và select](/blog/go-kho-hieu-make-defer-channel/), [bẫy slice, map, interface nil và shadowing](/blog/go-kho-hieu-bay-du-lieu/).

Người đến từ C sợ con trỏ vì sợ quản lý bộ nhớ. Người đến từ Java, Python, Ruby lại không quen phải tự quyết định "truyền giá trị hay truyền con trỏ". Go có garbage collector, không có phép toán con trỏ, nên con trỏ trong Go an toàn hơn C nhiều. Nhưng vẫn có những chỗ dễ hiểu sai.

Mọi output trong bài đều chạy thật với Go 1.24.

## 1. Go truyền mọi thứ bằng giá trị

Đây là nền tảng để hiểu mọi thứ phía sau: **Go luôn copy** khi truyền tham số, gán biến, trả về giá trị. Không có ngoại lệ.

```go
type Counter struct{ n int }

func incValue(c Counter) { c.n++ }   // sửa bản copy
func incPtr(c *Counter)  { c.n++ }   // sửa qua địa chỉ

c := Counter{}
incValue(c) // c.n vẫn 0
incPtr(&c)  // c.n = 1
```

Với con trỏ, thứ được copy là **địa chỉ** (8 byte trên máy 64-bit), nên hai bên cùng trỏ tới một vùng nhớ.

Vậy tại sao truyền slice hay map vào hàm thì sửa được dữ liệu?

```go
func setFirst(s []int)         { s[0] = 99 }
func setKey(m map[string]int)  { m["a"] = 1 }
```

Vì bản thân slice và map đã **chứa con trỏ bên trong**. Slice là header `{ptr, len, cap}`; copy header thì `ptr` vẫn trỏ cùng mảng nền. Nhưng header là bản copy, nên `append` trong hàm không làm slice của caller dài ra:

```go
func add(s []int) { s = append(s, 4) } // caller không thấy phần tử mới
```

Muốn hàm thay đổi độ dài thì **trả về slice mới** (như chính `append` làm), không cần truyền `*[]int`. Con trỏ tới slice hay map hầu như không bao giờ cần thiết.

## 2. Khi nào nên dùng con trỏ?

Dùng con trỏ khi:

- **Cần sửa giá trị** của caller.
- **Struct có chứa thứ không được copy**: `sync.Mutex`, `sync.WaitGroup`, `bytes.Buffer`, hay bất kỳ struct nào mang trạng thái (connection, cache).
- **Cần phân biệt "không có" với zero value**: `*int` nil khác với `0`.
- **Struct thật sự lớn** và được truyền đi rất nhiều lần. "Lớn" ở đây là hàng trăm byte trở lên, không phải 3–4 field.

Không cần con trỏ khi:

- Struct nhỏ, bất biến: `time.Time`, `Point{X, Y}`, các value object.
- Slice, map, channel, function, interface: đã là kiểu tham chiếu.

## 3. Receiver con trỏ và receiver giá trị

```go
func (c Counter) Get() int { return c.n }   // value receiver: nhận bản copy
func (c *Counter) Inc()    { c.n++ }        // pointer receiver: sửa được
```

Go tự lấy địa chỉ khi gọi method trên biến:

```go
c := Counter{}
c.Inc() // Go tự viết lại thành (&c).Inc()
```

Tiện, nhưng chính sự tiện này che đi luật thật sự, và luật đó lộ ra ở hai chỗ.

### Bẫy 1: giá trị không thoả interface có method pointer receiver

```go
type Incer interface{ Inc() }

var i Incer = Counter{}
// compile error: Counter does not implement Incer (method Inc has pointer receiver)

var i Incer = &Counter{} // được
```

Luật **method set**:

| Kiểu | Có những method nào |
|---|---|
| `T` | Chỉ method receiver `T` |
| `*T` | Method receiver `T` **và** `*T` |

Lý do: interface giữ một **bản copy** của giá trị. Nếu cho `Counter` thoả `Incer`, thì `Inc()` sẽ sửa bản copy nằm trong interface chứ không phải biến gốc, gây bug âm thầm. Go chặn ngay từ lúc biên dịch.

### Bẫy 2: giá trị không có địa chỉ thì không gọi được pointer method

```go
m := map[string]Counter{}
m["a"].Inc() // compile error: cannot call pointer method Inc on Counter

Counter{}.Inc() // cũng lỗi: giá trị tạm không có địa chỉ
```

`c.Inc()` chạy được vì `c` là biến, có địa chỉ. Phần tử map và giá trị tạm thì không. (Liên quan tới mục map ở [phần 2](/blog/go-kho-hieu-bay-du-lieu/).)

### Quy ước: đừng trộn hai loại receiver

Nếu một method của type cần pointer receiver, thì cho **tất cả** method dùng pointer receiver. Trộn lẫn khiến method set khó đoán, và dễ vô tình copy struct có trạng thái. Ngoại lệ chấp nhận được: type nhỏ, bất biến, toàn value receiver (như `time.Time`).

## 4. Nil pointer

### Dereference con trỏ nil: panic

```go
var p *User
fmt.Println(p.Name)
// panic: runtime error: invalid memory address or nil pointer dereference
```

Đây là panic phổ biến nhất trong Go production. Thường gặp khi:

- Field con trỏ trong struct chưa được khởi tạo (`cfg.DB.Host` với `cfg.DB` nil).
- Hàm trả về `(*T, error)`, caller bỏ qua `err` rồi dùng luôn `*T`.
- Map lưu con trỏ, key không tồn tại thì nhận về `nil`.

```go
users := map[string]*User{}
u := users["missing"] // nil, không lỗi
fmt.Println(u.Name)   // panic
```

Luôn kiểm tra `ok` khi đọc map lưu con trỏ: `u, ok := users[id]`.

### Nil receiver lại là hợp lệ

Gọi method trên con trỏ nil **không panic** cho tới khi method thật sự dereference. Có thể tận dụng điều này:

```go
type Node struct {
    Val  int
    Next *Node
}

func (n *Node) Len() int {
    if n == nil {
        return 0
    }
    return 1 + n.Next.Len()
}

var l *Node
fmt.Println(l.Len())                       // 0
fmt.Println((&Node{1, &Node{2, nil}}).Len()) // 2
```

Kỹ thuật này hữu ích cho cây, danh sách liên kết, hay logger tuỳ chọn. Nhưng nó cũng là nguồn gốc của bẫy "interface nil mà `!= nil`" ở phần 2: con trỏ nil bọc trong interface vẫn gọi method được, nên nó trông như một giá trị hợp lệ.

## 5. Copy struct chứa `sync.Mutex`

```go
type SafeCounter struct {
    mu sync.Mutex
    n  int
}

func (c SafeCounter) Inc() { // value receiver: copy cả mutex
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

Mỗi lần gọi `Inc()`, struct bị copy, khoá một **mutex khác**, tăng một **n khác**. Không có gì được bảo vệ, và `n` gốc không bao giờ tăng. Code vẫn biên dịch.

`go vet` bắt được:

```text
./main.go:20:9: Inc passes lock by value: h.SafeCounter contains sync.Mutex
```

Sửa: pointer receiver, và truyền `*SafeCounter` đi khắp nơi. Đây là lý do nên chạy `go vet` trong CI: nó bắt được những lỗi mà compiler cho qua.

Các kiểu tương tự không được copy sau khi dùng: `sync.WaitGroup`, `sync.RWMutex`, `sync.Once`, `sync.Cond`, `strings.Builder`, `bytes.Buffer`.

## 6. Trả về con trỏ tới biến cục bộ: an toàn

Người đến từ C sẽ giật mình:

```go
func NewUser(name string) *User {
    u := User{Name: name}
    return &u // trong C đây là lỗi nghiêm trọng
}
```

Trong Go, hoàn toàn an toàn. Compiler thực hiện **escape analysis**: thấy `u` "thoát" ra khỏi hàm, nó cấp phát `u` trên **heap** thay vì stack. Xem compiler quyết định gì:

```bash
go build -gcflags=-m .
```

```text
./main.go:11:2: moved to heap: u
```

Hệ quả đáng quan tâm không phải là đúng sai mà là **hiệu năng**: mỗi biến bị đẩy lên heap là thêm một lần cấp phát và thêm việc cho GC.

## 7. Con trỏ có nhanh hơn không?

Niềm tin phổ biến: "truyền con trỏ đỡ copy, nên nhanh hơn". Không phải lúc nào cũng đúng.

- Copy một struct vài chục byte rất rẻ, CPU làm việc này cực nhanh.
- Truyền con trỏ thường khiến dữ liệu **escape lên heap**: tốn công cấp phát, tạo áp lực cho GC.
- Truy cập qua con trỏ là một lần nhảy bộ nhớ, có thể gây cache miss.

Ví dụ `[]User` và `[]*User`:

```go
users := []User{...}   // các User nằm liền nhau trong một mảng: duyệt nhanh, ít rác cho GC
ptrs  := []*User{...}  // mỗi User một chỗ trên heap: duyệt chậm hơn, GC phải quét từng con trỏ
```

Với hàng trăm nghìn phần tử, khác biệt đo được rõ ràng. Dùng `[]*T` khi thật sự cần chia sẻ hoặc sửa phần tử từ nhiều nơi, không phải theo phản xạ.

Quy tắc thực tế: **chọn con trỏ hay giá trị theo ngữ nghĩa** (có cần sửa không, có được copy không), rồi **đo** bằng benchmark (`go test -bench . -benchmem`) nếu nghi ngờ về hiệu năng. Đừng tối ưu bằng cảm giác.

## 8. `*string` cho field tuỳ chọn

Khi nhận JSON cho API PATCH, cần phân biệt ba trường hợp: không gửi field, gửi giá trị rỗng, gửi giá trị mới.

```go
type UpdateUser struct {
    Name  *string `json:"name"`
    Age   *int    `json:"age"`
}
```

```text
{}                  -> Name == nil           : không đổi
{"name": ""}        -> Name != nil, *Name="" : đổi thành rỗng
{"name": "An"}      -> *Name == "An"         : đổi thành "An"
```

Dùng `string` thường thì `{}` và `{"name": ""}` đều thành `""`, không phân biệt được.

Lưu ý: `{"name": null}` cũng cho `Name == nil`, giống như không gửi. Nếu API cần phân biệt cả "gửi null" để xoá giá trị, phải dùng kiểu tự định nghĩa có cờ `Set` và cài `UnmarshalJSON`.

Đánh đổi: code phải kiểm tra nil ở mọi chỗ đọc. Từ Go 1.26, `new` nhận được một biểu thức làm giá trị khởi tạo, nên viết gọn được:

```go
req := UpdateUser{Name: new("An")} // Go 1.26+
```

Với phiên bản cũ hơn, viết helper:

```go
func ptr[T any](v T) *T { return &v }

req := UpdateUser{Name: ptr("An")}
```

## 9. Những thứ Go cố ý không cho phép

- **Không có phép toán con trỏ**: `p++`, `p + 4` không biên dịch. Muốn duyệt bộ nhớ thì dùng slice.
- **Không lấy được địa chỉ của hằng hay giá trị tạm**: `&5`, `&f()` lỗi. Nhưng `&User{...}` thì được, đây là ngoại lệ dành riêng cho composite literal.
- **Không có con trỏ treo (dangling pointer)**: GC đảm bảo vùng nhớ còn sống chừng nào còn con trỏ trỏ tới.

Package `unsafe` cho phép phá các luật trên. Gần như không bao giờ cần trong code ứng dụng; nếu thấy mình đang viết `unsafe.Pointer`, hãy dừng lại và hỏi xem có cách khác không.

## Tóm tắt nhanh

- Go luôn copy. Con trỏ copy địa chỉ; slice và map đã chứa con trỏ bên trong.
- Method set: `T` chỉ có method receiver `T`; `*T` có cả hai. Đó là lý do `Counter{}` không thoả interface có pointer method.
- Không trộn receiver; struct có Mutex luôn dùng pointer receiver, và chạy `go vet`.
- Trả về `&local` là an toàn nhờ escape analysis, nhưng có giá ở heap và GC.
- Con trỏ không mặc nhiên nhanh hơn. Chọn theo ngữ nghĩa, đo bằng benchmark.
