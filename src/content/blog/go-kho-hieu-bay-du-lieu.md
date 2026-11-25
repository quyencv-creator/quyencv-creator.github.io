---
title: "Những thứ khó hiểu trong Go (phần 2): bẫy slice, map, interface nil và shadowing"
description: append lúc ghi đè dữ liệu slice khác lúc không, map không an toàn khi chạy đồng thời, error nil mà vẫn khác nil, := che mất biến bên ngoài, biến vòng lặp trước và sau Go 1.22, struct{} và iota. Mỗi mục có code chạy thật và output.
pubDate: 2026-11-25
tags: [golang]
---

Phần 1 nói về [make, defer, channel và select](/blog/go-kho-hieu-make-defer-channel/). Phần này là những cái bẫy không gây lỗi biên dịch, cũng không panic, mà lặng lẽ cho ra **dữ liệu sai**. Đây là loại bug khó tìm nhất.

Mọi output trong bài đều chạy thật với Go 1.24.

## 1. Slice dùng chung mảng nền

Một slice chỉ là một struct nhỏ gồm ba trường:

```go
type slice struct {
    ptr *T  // trỏ tới mảng nền
    len int
    cap int
}
```

Cắt slice (`s[a:b]`) **không copy dữ liệu**. Nó tạo một header mới trỏ vào **cùng mảng nền**.

### `append` có thể ghi đè slice gốc

```go
s := []int{1, 2, 3}
t := s[:2]        // [1 2], nhưng cap = 3, chung mảng với s
t = append(t, 99) // còn chỗ trong cap: ghi thẳng vào vị trí s[2]
fmt.Println(s)    // [1 2 99]
```

`s` bị đổi mà không ai đụng vào `s`.

### Hai slice cùng append, đè lên nhau

```go
a := make([]int, 3, 5)
b := append(a, 4)
c := append(a, 5)
fmt.Println("b:", b, "c:", c)
// b: [0 0 0 5] c: [0 0 0 5]
```

`a` còn dư cap, nên cả `b` và `c` đều ghi vào cùng vị trí thứ 4 của mảng nền. `c` ghi sau, đè mất số 4 của `b`.

Luật cần nhớ: **`append` chỉ cấp phát mảng mới khi hết cap**. Còn cap thì nó ghi vào mảng cũ. Vì vậy cùng một đoạn code có thể đúng hay sai tuỳ dữ liệu đầu vào, đó là lý do bug này rất khó tái hiện.

### Cách sửa: full slice expression `s[low:high:max]`

Chỉ số thứ ba giới hạn cap, buộc `append` lần sau phải cấp phát mảng mới:

```go
a := make([]int, 3, 5)
d := a[0:3:3]      // len 3, cap 3: không còn chỗ trống
e := append(d, 9)  // hết cap -> mảng mới
e[0] = 100
fmt.Println("a:", a, "e:", e)
// a: [0 0 0] e: [100 0 0 9]
```

Hoặc copy tường minh khi cần một slice độc lập:

```go
dst := make([]int, len(src))
copy(dst, src)
// hoặc: dst := slices.Clone(src)   (Go 1.21+)
```

### Rò rỉ bộ nhớ do giữ slice con

```go
func firstLine(data []byte) []byte {
    i := bytes.IndexByte(data, '\n')
    return data[:i] // giữ tham chiếu tới TOÀN BỘ data
}
```

Đọc file 100 MB rồi chỉ giữ dòng đầu, nhưng GC không giải phóng được 100 MB kia vì slice con vẫn trỏ vào mảng nền. Sửa bằng `bytes.Clone(data[:i])`.

## 2. Map

### Thứ tự duyệt là ngẫu nhiên, và cố ý như vậy

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k := range m {
    fmt.Print(k) // mỗi lần chạy có thể khác: abc, bca, cab...
}
```

Go cố ý xáo thứ tự để không ai viết code phụ thuộc vào nó. Cần thứ tự cố định thì sort key trước:

```go
keys := slices.Sorted(maps.Keys(m)) // Go 1.23+
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

Hệ quả thực tế: test so sánh output JSON hoặc chuỗi được build từ map có thể **lúc pass lúc fail**.

### Map không an toàn khi chạy đồng thời

```go
m := map[int]int{}
for i := 0; i < 100; i++ {
    go func() { m[i] = i }()
}
// fatal error: concurrent map writes
```

Đây không phải panic thường, nên `recover` **không bắt được**. Cả process chết. Cách sửa:

- `sync.Mutex` hoặc `sync.RWMutex` bọc quanh map (cách phổ biến nhất).
- `sync.Map`: chỉ đáng dùng khi key gần như chỉ ghi một lần rồi đọc nhiều, hoặc các goroutine làm việc trên các tập key tách biệt. Các trường hợp khác, map + mutex thường nhanh và dễ hiểu hơn.

Chạy test với `go test -race` để phát hiện sớm.

### Không sửa được field của struct trong map

```go
type User struct{ Name string }
m := map[string]User{"k": {"a"}}

m["k"].Name = "z" // compile error: cannot assign to struct field m["k"].Name in map
```

Phần tử của map không có địa chỉ cố định (map có thể dời dữ liệu khi lớn lên), nên Go cấm lấy địa chỉ hay gán vào field. Hai cách:

```go
// Cách 1: lấy ra, sửa, ghi lại
u := m["k"]
u.Name = "z"
m["k"] = u

// Cách 2: lưu con trỏ
mp := map[string]*User{"k": {Name: "a"}}
mp["k"].Name = "z" // được
```

Cách 2 tiện hơn nhưng có đánh đổi, xem [phần 3 về con trỏ](/blog/go-kho-hieu-con-tro/).

## 3. Interface nil nhưng `!= nil`

Đây có lẽ là bẫy nổi tiếng nhất của Go:

```go
type MyErr struct{}

func (*MyErr) Error() string { return "my" }

func find(fail bool) error {
    var e *MyErr // nil
    if fail {
        e = &MyErr{}
    }
    return e // trả về *MyErr nil, bọc trong interface error
}

err := find(false)
fmt.Println(err == nil) // false (!!)
```

### Tại sao?

Một giá trị interface gồm **hai phần**: (kiểu, giá trị). Interface chỉ bằng `nil` khi **cả hai** đều nil.

```text
var err error            -> (nil, nil)       == nil
err = (*MyErr)(nil)      -> (*MyErr, nil)    != nil
```

`find` trả về `(*MyErr, nil)`: phần giá trị nil nhưng phần kiểu là `*MyErr`, nên interface khác nil. Caller kiểm tra `if err != nil`, tưởng có lỗi, và có thể còn panic khi gọi method trên con trỏ nil.

### Cách tránh

Luật đơn giản: **hàm trả về `error` thì `return nil` tường minh**, đừng trả về một biến con trỏ có thể nil.

```go
func find(fail bool) error {
    if fail {
        return &MyErr{}
    }
    return nil // interface nil thật
}
```

Bẫy này không chỉ có với `error` mà với **mọi interface**: `io.Reader`, `http.Handler`, interface tự định nghĩa…

## 4. Shadowing với `:=`

`:=` khai báo biến **mới** trong scope hiện tại. Nếu scope ngoài đã có biến cùng tên, biến mới sẽ **che** (shadow) biến cũ.

```go
x := 0
if true {
    x, y := 5, 6 // tạo x MỚI trong block if, không gán vào x bên ngoài
    _ = y
    _ = x
}
fmt.Println(x) // 0
```

Trường hợp gây bug thật thường là với `err`:

```go
func load() (cfg *Config, err error) {
    if useCache {
        cfg, err := readCache() // cfg, err MỚI, che named return
        if err != nil {
            return nil, err
        }
        _ = cfg
    }
    return cfg, err // cfg bên ngoài vẫn là nil
}
```

Cách sửa: trong block con, dùng `=` thay `:=` nếu muốn gán vào biến ngoài:

```go
var c *Config
c, err = readCache()
```

Bắt lỗi tự động: `go vet` mặc định không kiểm tra shadow. Bật bằng analyzer `shadow` hoặc dùng `golangci-lint` với `govet` có `enable: [shadow]`.

## 5. Biến vòng lặp và closure: trước và sau Go 1.22

Trước Go 1.22, biến vòng lặp được **dùng chung** cho mọi lần lặp:

```go
users := []User{{"a"}, {"b"}}
var ptrs []*User
for _, u := range users {
    ptrs = append(ptrs, &u)
}
ptrs[0].Name = "X"
```

Kết quả, chạy thật với `go.mod` khai báo hai phiên bản khác nhau:

```text
go 1.21:  users=[{a} {b}]  *ptrs[0]={X}  *ptrs[1]={X}   // cả hai trỏ cùng một biến u
go 1.22+: users=[{a} {b}]  *ptrs[0]={X}  *ptrs[1]={b}   // mỗi vòng lặp có u riêng
```

Hai điều cần để ý:

1. **Hành vi phụ thuộc vào dòng `go` trong `go.mod`**, không phải phiên bản Go bạn cài. Module cũ khai báo `go 1.20` thì dù build bằng Go 1.24 vẫn dính bẫy cũ.
2. Ở cả hai phiên bản, `&u` **không trỏ vào phần tử trong slice** mà trỏ vào một bản copy. Sửa `ptrs[0].Name` không đổi `users`. Muốn sửa phần tử thật thì dùng chỉ số:

```go
for i := range users {
    users[i].Name += "!"
}
// [{a!} {b!}]
```

Cùng lý do đó, code goroutine cũ hay có dòng `i := i` hoặc truyền `i` làm tham số `go func(i int){...}(i)`. Với `go 1.22+` thì không cần nữa, nhưng gặp trong codebase cũ thì đừng vội xoá trước khi kiểm tra `go.mod`.

## 6. `struct{}`: kiểu không tốn byte nào

`struct{}` có kích thước 0 byte. Hai ứng dụng phổ biến:

**Làm set:**

```go
seen := map[string]struct{}{}
seen["a"] = struct{}{}

if _, ok := seen["a"]; ok {
    fmt.Println("đã thấy")
}
```

So với `map[string]bool`, cách này tiết kiệm bộ nhớ và nói rõ ý đồ: chỉ quan tâm key có hay không, không có trạng thái `false`.

**Làm tín hiệu qua channel:**

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

`chan struct{}` nói rõ: channel này chỉ để báo hiệu, không mang dữ liệu. `close(done)` đánh thức **mọi** goroutine đang chờ, còn gửi một giá trị thì chỉ đánh thức một.

## 7. `iota` và cách Go làm enum

Go không có từ khoá `enum`. Thay vào đó dùng hằng số với `iota`, một bộ đếm tăng dần trong mỗi khối `const`:

```go
type Status int

const (
    StatusPending Status = iota // 0
    StatusActive                // 1
    StatusClosed                // 2
)
```

Ba điểm cần để ý:

**Zero value trùng với giá trị đầu tiên.** `var s Status` có giá trị `StatusPending`. Nếu "chưa gán" phải khác "pending", thì dành giá trị 0 cho trạng thái không hợp lệ:

```go
const (
    StatusUnknown Status = iota // 0: chưa gán
    StatusPending               // 1
    StatusActive                // 2
)
```

**Không có kiểm tra phạm vi.** `Status(99)` vẫn biên dịch bình thường. Dữ liệu từ JSON hay database cần validate.

**Đừng lưu giá trị `iota` xuống database.** Ai đó chèn hằng mới vào giữa khối `const` là mọi giá trị phía sau bị dịch đi một, dữ liệu cũ lập tức sai nghĩa. Lưu chuỗi (`"active"`) hoặc gán số tường minh.

In ra tên thay vì số bằng cách cài method `String()`, có thể sinh tự động bằng `stringer`:

```bash
go install golang.org/x/tools/cmd/stringer@latest
stringer -type=Status
```

## Tóm tắt nhanh

- Slice con chung mảng nền; `append` chỉ cấp phát mới khi hết cap. Dùng `s[a:b:b]` hoặc `slices.Clone` khi cần tách.
- Map: thứ tự ngẫu nhiên, ghi đồng thời làm chết process, không gán được field của struct trong map.
- Interface chỉ nil khi cả kiểu lẫn giá trị đều nil. Luôn `return nil` tường minh.
- `:=` trong block con tạo biến mới.
- Hành vi biến vòng lặp phụ thuộc dòng `go` trong `go.mod`.

Phần tiếp theo: [Con trỏ và những vấn đề của con trỏ](/blog/go-kho-hieu-con-tro/).
