---
title: "Khi một ngày ai cũng có thể port mọi hệ thống sang ngôn ngữ khác"
description: AI dịch code từ Ruby sang Go, từ PHP sang Java ngày càng giỏi. Nhưng cú pháp chưa bao giờ là phần khó của việc port. Phần khó là hành vi, cái mà người dùng đang phụ thuộc vào mà không ai ghi lại. Khi việc dịch code gần như miễn phí, cái gì còn đắt, và chọn ngôn ngữ còn quan trọng không?
pubDate: 2026-11-26
tags: [thinking, ai, architecture]
---

Mấy năm trước, câu "viết lại hệ thống sang Go" trong một cuộc họp thường kết thúc bằng một phép tính: 200.000 dòng Ruby, team năm người, ít nhất một năm, trong lúc đó không làm được tính năng mới. Rồi người ta thôi.

Bây giờ phép tính đó đang thay đổi. AI dịch một file Ruby sang Go trong vài giây, dịch cả một module trong một buổi chiều. Không khó để hình dung một ngày không xa, việc dịch cú pháp của cả một hệ thống từ ngôn ngữ này sang ngôn ngữ khác gần như miễn phí.

Câu hỏi đáng nghĩ là: khi ngày đó tới, cái gì vẫn còn đắt?

## Cú pháp chưa bao giờ là phần khó

Đây là một API Rails trả về danh sách sản phẩm trong giỏ hàng. Khi giỏ trống, nó trả về:

```json
{"items": []}
```

Port sang Go, bản dịch trông hoàn toàn đúng:

```go
type CartResponse struct {
    Items []string `json:"items"`
}

var items []string // giỏ trống: slice nil
json.Marshal(CartResponse{Items: items})
```

Kết quả:

```json
{"items": null}
```

Trong Go, một slice chưa được khởi tạo là `nil`, và `encoding/json` biến nó thành `null`, không phải `[]`. Ruby thì không có khái niệm này. App mobile đã ba năm nay đọc `items` và gọi `.length` trên nó. Bản port lên production, và mọi user có giỏ hàng trống đều bị crash app.

Không có dòng nào trong bản dịch sai về cú pháp. Test của bản Go cũng pass, vì test được dịch cùng với code, và test gốc chưa bao giờ kiểm tra trường hợp giỏ trống trả về `[]` hay `null`. Lỗi nằm ở chỗ hai ngôn ngữ có **ngữ nghĩa khác nhau** cho cùng một thứ trông giống nhau.

Vài ví dụ khác, giữa đúng hai ngôn ngữ đó, đều đã chạy thử:

| | Ruby | Go |
|---|---|---|
| `9223372036854775807 + 1` | `9223372036854775808` (số nguyên tự mở rộng) | `-9223372036854775808` (tràn số, im lặng) |
| Độ dài chuỗi `"Việt"` | `4` (đếm ký tự) | `6` với `len()` (đếm byte) |
| Thứ tự duyệt `Hash` / `map` | Theo thứ tự chèn | Ngẫu nhiên, cố ý |
| Giá trị "chưa có" | `nil` | Zero value: `0`, `""`, `false`, hoặc `nil` tuỳ kiểu |

Mỗi dòng trong bảng là một bug tiềm năng mà không compiler nào báo, không linter nào bắt, và AI chỉ tránh được nếu nó biết hệ thống của bạn **dựa vào** hành vi đó. Mà thường thì chính bạn cũng không biết.

Mình đã viết về một số khác biệt kiểu này trong Go ở bài [bẫy dữ liệu](/blog/go-kho-hieu-bay-du-lieu/). Port từ ngôn ngữ khác sang thì những cái bẫy đó nhân lên.

## Hành vi mới là đặc tả thật

Có một định luật gọi là Hyrum's Law: khi một API có đủ nhiều người dùng, thì mọi hành vi quan sát được của nó, dù có được hứa hẹn trong tài liệu hay không, sẽ có người phụ thuộc vào.

Một hệ thống chạy production vài năm là minh chứng sống của định luật này. Thứ tự các phần tử trong JSON. Cách làm tròn tiền. Thông báo lỗi mà một đối tác đang parse bằng regex. Một bug từ năm 2021 mà team kế toán đã quen và có quy trình riêng để xử lý. Timezone của các mốc thời gian. Không cái nào trong số này nằm trong tài liệu, và tất cả đều là một phần của hệ thống.

Khi port, bạn không port code. Bạn port **hành vi**. Và hành vi đầy đủ của một hệ thống chỉ được ghi ở một chỗ duy nhất: chính code cũ đang chạy, cùng với dữ liệu và người dùng của nó.

## Khi dịch rẻ, verify thành phần đắt nhất

Nếu AI làm phần dịch, thì phần còn lại là chứng minh bản mới hành xử giống bản cũ. Và đây là chỗ tốn công thật sự.

Test có sẵn không đủ, vì test chỉ kiểm tra những gì người viết test đã nghĩ tới, như ví dụ giỏ hàng ở trên. Các kỹ thuật dùng được:

**Characterization test.** Trước khi port, viết test ghi lại hành vi hiện tại của hệ thống cũ, kể cả hành vi có vẻ sai. Không phải test "code nên làm gì" mà test "code đang làm gì". Bản mới phải pass đúng bộ test này.

**So sánh với traffic thật.** Cho bản mới chạy song song với bản cũ, nhận cùng một request thật (shadow traffic), so sánh response của hai bên, ghi lại mọi khác biệt. Đây là cách duy nhất để tìm ra những hành vi mà không ai biết là tồn tại. Nó cũng không rẻ: cần hạ tầng để nhân bản request, cần xử lý các request có ghi dữ liệu để không ghi hai lần, và cần người ngồi phân loại từng khác biệt là bug hay chấp nhận được.

**Port từng phần.** Thay vì viết lại toàn bộ rồi chuyển một lần, thay từng endpoint, từng module, để hệ thống cũ và mới cùng chạy, chuyển dần traffic sang (cách Martin Fowler gọi là strangler fig). Mỗi bước nhỏ thì khi sai cũng sai nhỏ, rollback được.

Ngày AI dịch code miễn phí, chi phí của một dự án port sẽ không về 0. Nó chỉ chuyển gần như hoàn toàn sang khâu verify.

## Còn những thứ không nằm trong code

Kể cả khi hành vi được port hoàn hảo, vẫn còn những thứ không ai dịch được:

**Hệ sinh thái.** Gem bạn đang dùng có tương đương trong Go không, và có hành xử giống không? Thư viện xử lý tiền tệ, thư viện tạo PDF, SDK của đối tác thanh toán chỉ có bản Ruby và Java. Mỗi thư viện thay thế là một tập hành vi khác.

**Kiến thức vận hành.** Team đã mất ba năm để biết hệ thống Rails cần bao nhiêu worker Puma, bộ nhớ tăng thế nào sau một tuần, query nào cần theo dõi, metric nào báo trước sự cố. Bản Go là một hệ thống mới về mặt vận hành: GC khác, mô hình đồng thời khác, cách hỏng khác. Toàn bộ trực giác đó phải học lại, thường là qua sự cố.

**Dữ liệu.** Code có thể dịch lại bất cứ lúc nào. Dữ liệu thì không. Schema, encoding, cách lưu thời gian, những bản ghi bẩn từ 2019 do một bug cũ để lại: bản mới phải đọc được tất cả.

**Con người.** Ai sẽ debug bản mới lúc 3 giờ sáng? Nếu cả team chỉ quen Ruby, port sang Go bằng AI có nghĩa là bạn có một hệ thống Go mà không ai thật sự hiểu Go. Đó chính là kịch bản [nợ kỹ thuật bùng nổ](/blog/ai-viet-code-dev-lam-gi/), chỉ là xảy ra nhanh hơn.

## Vậy ngôn ngữ còn quan trọng không?

Có, nhưng theo một cách khác.

Trước đây, chọn ngôn ngữ là quyết định gần như vĩnh viễn, vì chi phí đổi quá lớn. Khi chi phí dịch giảm, quyết định đó **bớt bị khoá chặt**. Đây là tin tốt: bạn có thể bắt đầu bằng ngôn ngữ giúp ra sản phẩm nhanh nhất, và chuyển những phần cần hiệu năng sang ngôn ngữ khác khi thật sự cần, với chi phí thấp hơn trước nhiều.

Nhưng khoá chặt không biến mất. Nó **dời chỗ**. Thứ khó thay đổi không còn là code, mà là:

- **Contract**: API, format dữ liệu, event mà các hệ thống khác và đối tác đang dùng.
- **Dữ liệu** và schema của nó.
- **Hành vi** mà người dùng đã quen và phụ thuộc vào.

Nếu có một bài học thiết kế từ đây, thì đó là: đầu tư vào việc làm cho những thứ này **rõ ràng và tường minh**. Contract có đặc tả (OpenAPI, schema của event). Hành vi quan trọng có test. Dữ liệu có ràng buộc ở tầng database chứ không chỉ ở tầng code. Một hệ thống có những thứ này thì port sang đâu cũng dễ. Một hệ thống mà đặc tả duy nhất là "code đang chạy" thì AI giỏi đến mấy cũng chỉ dịch được phần nổi.

## Đừng port chỉ vì port được

Có một cái bẫy tâm lý cần nói thẳng. Khi một việc trở nên dễ, người ta có xu hướng làm nó nhiều hơn cần thiết. "Viết lại sang Go cho nhanh" sẽ nghe hấp dẫn hơn bao giờ hết khi AI hứa làm xong trong một tuần.

Năm 2000, Joel Spolsky viết bài "Things You Should Never Do", lấy ví dụ quyết định viết lại từ đầu trình duyệt Netscape, và gọi viết lại từ đầu là sai lầm chiến lược tệ nhất mà một công ty phần mềm có thể mắc. Lập luận của ông là code cũ trông xấu nhưng chứa đựng hàng năm sửa lỗi và hiểu biết tích luỹ, và viết lại là vứt bỏ tất cả những thứ đó. AI làm phần gõ phím nhanh hơn, nhưng không làm lập luận đó sai đi. Kiến thức tích luỹ trong code cũ vẫn chỉ được bảo toàn nếu bạn verify được rằng bản mới giữ nguyên nó.

Trước khi port, hỏi: **vấn đề thật là gì?** Nếu là hiệu năng, có thể chỉ cần viết lại một service nóng nhất, hoặc chỉ cần thêm index. Nếu là tuyển người, ngôn ngữ có thật sự là lý do không ai ứng tuyển không? Nếu là kiến trúc rối, thì port một kiến trúc rối sang ngôn ngữ khác sẽ cho ra một kiến trúc rối viết bằng ngôn ngữ khác.

## Kết

Khi một ngày ai cũng port được mọi hệ thống sang mọi ngôn ngữ, người có giá không phải là người biết nhiều ngôn ngữ nhất. Người có giá là người hiểu **hành vi** của hệ thống: nó thật sự làm gì, ai phụ thuộc vào điều gì, và làm sao chứng minh bản mới vẫn làm đúng như vậy.

Ngôn ngữ đang dần trở thành chi tiết triển khai. Hành vi, contract và dữ liệu thì vẫn là thứ thật sự định nghĩa một hệ thống.
