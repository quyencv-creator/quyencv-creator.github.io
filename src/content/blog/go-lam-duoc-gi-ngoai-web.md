---
title: "Ngoài làm web, Go còn làm được gì?"
description: "Go nổi tiếng với web API, nhưng phần lớn hạ tầng cloud hiện đại như Docker, Kubernetes, Terraform, Prometheus cũng viết bằng Go. Công cụ dòng lệnh, DevOps, mạng và proxy, database, xử lý dữ liệu, IoT, WebAssembly, desktop, game. Kèm một demo CLI chạy thật: một file chạy được cho Linux, Windows, macOS, không cần cài gì thêm. Và những chỗ Go không phải lựa chọn tốt."
pubDate: 2026-11-28
tags: [golang, backend, devops]
---

Nhắc tới Go, phần lớn người ta nghĩ tới web API và microservice. Không sai: đó là chỗ Go được dùng nhiều nhất. Nhưng nếu nhìn vào những công cụ mà dev dùng hằng ngày, có một điều thú vị: rất nhiều trong số đó viết bằng Go, và chúng không phải là web app.

Docker, Kubernetes, Terraform, Prometheus, etcd, Hugo, GitHub CLI, Caddy, Traefik, Vault, Consul, CockroachDB, NATS. Tất cả đều viết bằng Go.

Bài này đi qua những mảng Go làm tốt ngoài web, vì sao nó làm tốt, và cả những mảng nó không nên được chọn.

## Vì sao Go hợp với nhiều thứ ngoài web?

Trước khi đi vào từng mảng, cần hiểu vài đặc điểm của Go khiến nó phù hợp:

- **Biên dịch ra một file chạy duy nhất.** Không cần cài runtime (như Java, Python, Node), không cần thư viện đi kèm. Copy một file sang máy khác là chạy.
- **Build chéo cho hệ điều hành khác rất dễ.** Từ một máy Linux, một dòng lệnh là ra file chạy cho Windows, macOS, ARM.
- **Khởi động nhanh, dùng ít bộ nhớ.** Quan trọng cho công cụ dòng lệnh, container và serverless.
- **Xử lý đồng thời là một phần của ngôn ngữ.** Goroutine và channel làm cho việc viết chương trình mạng, chương trình xử lý song song tự nhiên hơn nhiều ngôn ngữ khác.
- **Thư viện chuẩn rất đầy đủ:** mạng, HTTP, mã hoá, nén, JSON, xử lý file đều có sẵn.

## Demo: một công cụ dòng lệnh, build cho 4 nền tảng

Để thấy rõ đặc điểm đầu tiên, đây là một công cụ dòng lệnh nhỏ `logsum`: đọc file access log của Nginx, đếm số request theo mã trạng thái, và liệt kê những đường dẫn bị lỗi 5xx nhiều nhất. Kiểu công cụ mà ai làm vận hành cũng từng phải viết vội bằng một đống lệnh `grep`, `awk`, `sort`.

```go
func main() {
    top := flag.Int("top", 3, "số đường dẫn lỗi hiển thị")
    flag.Parse()
    if flag.NArg() != 1 {
        fmt.Fprintln(os.Stderr, "cách dùng: logsum [-top N] access.log")
        os.Exit(2)
    }
    f, err := os.Open(flag.Arg(0))
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    defer f.Close()

    status := map[string]int{}
    errPaths := map[string]int{}
    total := 0
    sc := bufio.NewScanner(f)
    for sc.Scan() {
        // ... "GET /path HTTP/1.1" 200 ...
        parts := strings.Split(sc.Text(), `"`)
        if len(parts) < 3 {
            continue
        }
        req := strings.Fields(parts[1])
        rest := strings.Fields(parts[2])
        if len(req) < 2 || len(rest) < 1 {
            continue
        }
        total++
        code := rest[0]
        status[code]++
        if code[0] == '5' {
            errPaths[req[1]]++
        }
    }
    // ... sắp xếp và in kết quả
}
```

Chạy với một file log giả lập 200.000 dòng (khoảng 17 MB):

```text
$ ./logsum -top 3 access.log
200000 request
  200: 157977
  304: 15934
  404: 13588
  500: 8505
  502: 3996
đường dẫn lỗi 5xx nhiều nhất:
   4209  /api/v1/payments
   1691  /
   1672  /cart
```

Trên máy chạy thử, mỗi lần chạy mất khoảng 0,1 giây và dùng khoảng 13 MB bộ nhớ (đo 3 lần: 0,093 s, 0,102 s, 0,098 s). Không tối ưu gì, chỉ đọc từng dòng bằng thư viện chuẩn.

Phần đáng nói nhất là build. Từ một máy Linux:

```bash
CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o out/logsum-linux-amd64 .
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="-s -w" -o out/logsum-linux-arm64 .
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o out/logsum-windows-amd64.exe .
CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -ldflags="-s -w" -o out/logsum-darwin-arm64 .
```

```text
1581240  logsum-linux-amd64        ELF 64-bit, x86-64, statically linked
1638584  logsum-linux-arm64        ELF 64-bit, ARM aarch64, statically linked
1695232  logsum-windows-amd64.exe  PE32+ executable (console) x86-64, for MS Windows
1707538  logsum-darwin-arm64       Mach-O 64-bit arm64 executable
```

Bốn file, mỗi file khoảng 1,6 MB, chạy được ngay trên Linux server, Raspberry Pi hay server ARM, Windows và Mac chip Apple, mà không cần cài thêm bất cứ thứ gì. Gửi cho đồng nghiệp chỉ cần gửi một file. (Mình chỉ chạy thử bản Linux x86-64; ba bản kia được build và kiểm tra định dạng bằng lệnh `file`, chưa chạy trên máy thật.)

So với một script Python làm cùng việc: người nhận phải có đúng phiên bản Python, có thể phải cài thêm thư viện, và trên Windows thì thường là một câu chuyện dài. Đó là lý do nhiều công cụ dòng lệnh phổ biến chọn Go.

## Các mảng Go làm tốt ngoài web

### 1. Công cụ dòng lệnh (CLI)

Như demo ở trên. Một file chạy, khởi động tức thì, build cho mọi nền tảng. Các thư viện như `cobra` (dùng trong Kubernetes `kubectl` và GitHub CLI) giúp làm CLI có lệnh con, cờ, tự sinh hướng dẫn và tự hoàn thành lệnh. Ví dụ quen thuộc: `gh` (GitHub CLI), `hugo`, `terraform`, `kubectl`, `k6` (mình đã viết về [load test bằng k6](/blog/k6-load-test-rails-api/)).

Với team, đây cũng là cách thay thế tốt cho những script nội bộ đã quá dài: công cụ deploy, công cụ dọn dữ liệu, công cụ kiểm tra cấu hình.

### 2. Hạ tầng và DevOps

Đây là "sân nhà" của Go. Phần lớn hệ sinh thái container và cloud native viết bằng Go: Docker, Kubernetes, containerd, Terraform, Prometheus, Grafana (phần backend), Vault, Consul, etcd. Nếu bạn muốn viết **Kubernetes operator**, **Terraform provider**, hay **exporter cho Prometheus**, Go gần như là lựa chọn mặc định vì thư viện chính thức của các hệ thống này đều là Go. Xem thêm vì sao Go gắn với Prometheus trong bài [observability Go và Rails](/blog/observability-go-vs-rails/).

### 3. Mạng: proxy, gateway, agent

Goroutine rẻ, nên một chương trình Go có thể giữ hàng chục nghìn kết nối cùng lúc mà code vẫn viết theo kiểu tuần tự dễ đọc. Ví dụ: Caddy và Traefik (reverse proxy, tự lấy chứng chỉ TLS), các API gateway, VPN, DNS server, các agent thu thập log và metric chạy trên mỗi máy chủ.

### 4. Database và hệ thống lưu trữ

Không chỉ dùng database, Go còn được dùng để **viết** database: CockroachDB, etcd, InfluxDB (các phiên bản đầu), Dgraph, cùng nhiều hệ thống hàng đợi như NATS. Đây là mảng khó, nhưng nó cho thấy Go đủ hiệu năng và đủ kiểm soát cho phần mềm hệ thống.

### 5. Xử lý dữ liệu, job nền, pipeline

Đọc file lớn, chuyển đổi dữ liệu, đồng bộ giữa các hệ thống, crawler, consumer đọc từ Kafka hay RabbitMQ. Go làm tốt những việc này nhờ xử lý song song dễ dàng và dùng ít bộ nhớ. Mình đã viết chi tiết trong bài [background job trong Go](/blog/golang-background-job/) và dùng goroutine để [lấy dữ liệu song song](/blog/goroutine-lay-du-lieu-song-song/).

### 6. Serverless

File chạy nhỏ, khởi động nhanh, ít bộ nhớ: đúng những gì serverless cần, vì bạn trả tiền theo thời gian chạy và bộ nhớ, và thời gian khởi động lạnh ảnh hưởng trực tiếp tới người dùng. Các nền tảng serverless lớn đều hỗ trợ Go.

### 7. Thiết bị nhúng và IoT với TinyGo

TinyGo là một trình biên dịch Go khác, nhắm tới vi điều khiển và thiết bị nhỏ, có thể chạy trên các bo mạch như Arduino, Raspberry Pi Pico và nhiều dòng chip phổ biến. Bộ thư viện hỗ trợ nhỏ hơn Go chuẩn, nhưng đủ để điều khiển cảm biến, đèn, động cơ bằng cú pháp Go quen thuộc. Với các thiết bị đủ mạnh chạy Linux (như Raspberry Pi), dùng Go chuẩn và build chéo cho ARM như demo ở trên là đủ.

### 8. WebAssembly

Go biên dịch được sang WebAssembly để chạy trong trình duyệt, và TinyGo cho ra file nhỏ hơn đáng kể. Phù hợp khi muốn dùng lại logic Go (ví dụ một bộ kiểm tra hợp lệ, một parser) ở cả server lẫn trình duyệt. Với giao diện web thông thường thì JavaScript và TypeScript vẫn là lựa chọn hợp lý hơn.

### 9. Ứng dụng desktop

Các thư viện như **Wails** (giao diện viết bằng HTML/CSS/JS, logic bằng Go, nhẹ hơn Electron) và **Fyne** (giao diện vẽ bằng Go thuần) cho phép làm ứng dụng desktop. Hợp với công cụ nội bộ, ứng dụng tiện ích. Chưa phải lựa chọn phổ biến cho ứng dụng desktop lớn.

### 10. Game

**Ebitengine** là thư viện làm game 2D bằng Go, build được cho desktop, web và di động. Phù hợp cho game 2D, game độc lập, công cụ học lập trình. Không phải lựa chọn cho game 3D lớn.

### 11. Blockchain và bảo mật

Go Ethereum (geth), một trong những phần mềm node phổ biến của Ethereum, viết bằng Go. Rất nhiều công cụ bảo mật (quét cổng, quét lỗ hổng, công cụ pentest) cũng viết bằng Go, vì cùng lý do với CLI: một file chạy, chạy được ở mọi nơi.

## Khi nào không nên chọn Go?

Nói về điểm mạnh mà không nói điểm yếu thì không công bằng:

- **Machine learning và phân tích dữ liệu.** Hệ sinh thái của Python (NumPy, pandas, PyTorch, Jupyter) vượt xa. Go có thể dùng để **phục vụ** model hoặc làm pipeline dữ liệu xung quanh, nhưng phần nghiên cứu và huấn luyện model thì Python vẫn là lựa chọn đúng. Mình viết về RAG bằng Python trong bài [RAG là gì](/blog/rag-la-gi-python/) vì lý do đó.
- **Giao diện người dùng phức tạp.** Web frontend, ứng dụng di động, desktop nhiều màn hình: các công nghệ chuyên dụng (React, Swift, Kotlin, Flutter) phù hợp hơn.
- **Phần mềm cần kiểm soát bộ nhớ tuyệt đối.** Driver, kernel, phần mềm thời gian thực cứng, game engine 3D. Garbage collector của Go gây ra những khoảng dừng ngắn; với phần lớn ứng dụng thì không đáng kể, nhưng với những phần mềm này thì C, C++ hay Rust hợp hơn.
- **Prototype cần thay đổi cực nhanh.** Script vài chục dòng chạy một lần thì Python hay shell nhanh hơn để viết. Go đáng giá khi công cụ cần được dùng lâu, chia sẻ cho người khác, hoặc chạy nhanh.

**Về code trong bài:** demo `logsum` đã chạy thật với Go 1.24 trên Linux x86-64, với file log giả lập 200.000 dòng. Thời gian và bộ nhớ đo trên một máy chạy thử, chỉ để tham khảo. Các bản Windows, macOS, Linux ARM được build và kiểm tra định dạng file, chưa chạy trên máy thật.
