---
title: "Code review thời AI: khi viết code rẻ hơn đọc code"
description: AI làm việc viết code gần như miễn phí, nhưng đọc code vẫn tốn như cũ, nên code review thành điểm nghẽn của cả team. Người mở PR phải chịu trách nhiệm gì, reviewer nên nhìn vào đâu, những lỗi đặc trưng của code AI viết, và dùng AI để review thế nào cho đúng vai.
pubDate: 2026-11-27
draft: true
tags: [thinking, ai, backend]
---

Trước đây, một dev viết code mất một ngày, reviewer đọc mất nửa tiếng. Tỉ lệ đó khiến code review là một bước nhẹ nhàng ở cuối quy trình.

Bây giờ, dev cùng AI viết code đó trong nửa tiếng. Reviewer vẫn cần nửa tiếng để đọc, hoặc lâu hơn, vì code dài hơn và không phải do một người tự nghĩ ra từng dòng. Tỉ lệ đảo ngược. Hàng đợi PR dài ra. Reviewer bắt đầu đọc lướt. Và như mình từng viết trong bài [Khi AI viết code mà không ai đọc nổi](/blog/ai-viet-code-dev-lam-gi/), cuối cùng ai đó bấm approve một thứ mà không ai hiểu.

Code review không biến mất trong thời AI. Nó trở thành **khâu quan trọng nhất**, vì đó là chỗ cuối cùng một con người hiểu code trước khi nó lên production. Nhưng cách làm review phải thay đổi.

## Người mở PR là tác giả, dù ai gõ

Thay đổi đầu tiên không nằm ở reviewer mà ở người mở PR.

Quy tắc mình thấy cần thiết nhất: **người mở PR là tác giả của mọi dòng trong đó, bất kể ai đã gõ ra**. Nếu bạn không giải thích được một dòng, thì dòng đó chưa sẵn sàng để review. Đẩy code AI viết sang cho reviewer đọc lần đầu là chuyển việc hiểu code từ người có ngữ cảnh nhất sang người có ít ngữ cảnh nhất.

Trong thực tế, điều đó có nghĩa là trước khi mở PR, tác giả phải:

- **Tự đọc toàn bộ diff** như đang review code của người khác.
- **Xoá những gì không cần**: abstraction thừa, hàm helper không dùng, comment hiển nhiên, file tạm AI tạo ra rồi quên xoá.
- **Chạy và kiểm chứng**: không chỉ "test pass" mà đã thử tay luồng chính, đã thử trường hợp lỗi.
- **Viết mô tả PR tử tế.**

### Mô tả PR quan trọng hơn bao giờ hết

Khi code được viết nhanh, thứ reviewer thiếu nhất là **ngữ cảnh**. Một mô tả PR tốt trả lời bốn câu:

```markdown
## Vì sao
Đơn hàng bị tạo trùng khi user bấm "Đặt hàng" hai lần (ticket #812).

## Làm gì
Thêm idempotency key cho POST /orders, lưu trong Redis 24 giờ.
Request trùng key trả về đơn đã tạo thay vì tạo mới.

## Đã kiểm chứng thế nào
- Test mới: hai request cùng key chạy song song -> chỉ một đơn được tạo.
- Thử tay trên staging bằng cách bấm liên tục.

## Chỗ cần review kỹ
- `IdempotencyStore#fetch_or_store`: xử lý race khi hai request đến cùng lúc.
- Chưa xử lý trường hợp Redis down: hiện tại fallback là cho tạo đơn bình thường.
```

Mục cuối là mục giá trị nhất. Tác giả biết chỗ nào mình không chắc. Nói ra giúp reviewer dồn sức đúng chỗ, thay vì rải đều sự chú ý trên 400 dòng.

### Giữ PR nhỏ, kể cả khi AI viết được PR lớn

AI viết được 2.000 dòng trong một lần, nhưng không ai review được 2.000 dòng một cách nghiêm túc. Ai từng review cũng biết: PR càng lớn, người đọc càng lướt, và điều đó không đổi khi người viết là AI. Hãy chia việc thành những PR mà một người đọc hết được trong một lần ngồi. Tách refactor khỏi thay đổi hành vi. Tách thay đổi schema khỏi thay đổi logic.

## Reviewer nên nhìn vào đâu

Khi AI viết code, những lỗi lặt vặt (sai cú pháp, đặt tên kỳ quặc, quên xử lý null hiển nhiên) ít đi nhiều. Nhưng có những loại lỗi mà code AI viết đặc biệt hay mắc. Đây là chỗ reviewer nên dồn sức.

### 1. Có giải đúng vấn đề không?

Câu hỏi đầu tiên, trước khi đọc dòng code nào: **PR này có giải đúng vấn đề không?** AI làm đúng điều nó được yêu cầu. Nếu yêu cầu sai, code sẽ đúng một cách hoàn hảo cho một vấn đề không tồn tại. Đọc ticket, đọc mô tả PR, rồi hỏi: có cách nào đơn giản hơn nhiều không? Có cần làm việc này không?

### 2. Lỗi bị nuốt im lặng

Đây là thói quen rất hay gặp trong code AI viết: bọc mọi thứ trong xử lý lỗi rồi trả về giá trị mặc định cho "an toàn".

```ruby
def shipping_fee(order)
  ShippingClient.quote(order)
rescue StandardError => e
  Rails.logger.error(e.message)
  0 # phí ship bằng 0 khi có lỗi?
end
```

Code chạy, test pass, không bao giờ crash. Và mỗi khi đối tác vận chuyển lỗi, công ty miễn phí ship cho mọi đơn hàng mà không ai biết. Câu hỏi cho mỗi khối xử lý lỗi: **khi lỗi này xảy ra, hành vi đúng là gì?** Thường câu trả lời là "báo lỗi cho người gọi", không phải "giả vờ như không có gì".

### 3. Test được sửa cho khớp với code

Khi AI sửa code và test fail, một "cách sửa" phổ biến là sửa test cho khớp với kết quả mới. Trong diff, đoạn này trông rất vô hại:

```diff
-    expect(order.total).to eq(105_000)
+    expect(order.total).to eq(100_000)
```

Có thể con số mới đúng. Cũng có thể code vừa làm mất phí ship và test bị sửa để che đi. Quy tắc: **mỗi thay đổi trong assertion của test cũ phải có lý do**, và lý do đó phải nằm trong mô tả PR. Test cũ bị sửa đáng được đọc kỹ hơn cả code mới.

Tương tự, hãy nhìn xem test có thật sự kiểm tra gì không. Test mock hết mọi thứ rồi kiểm tra rằng mock được gọi thì chỉ chứng minh code gọi mock, không chứng minh code đúng.

### 4. Thứ không tồn tại

AI đôi khi dùng một method không có trong phiên bản thư viện bạn đang dùng, một option cấu hình không tồn tại, hoặc một biến môi trường không ai set. Nếu có test chạy qua đúng đoạn đó, lỗi sẽ lộ. Nếu không, nó lộ trên production. Đặc biệt cảnh giác với **dependency mới**: AI có thể gợi ý một package có tên nghe hợp lý nhưng không phải package bạn nghĩ, hoặc không tồn tại, và kẻ xấu đã bắt đầu đăng ký sẵn những tên package như vậy. Mỗi dependency mới trong PR cần được kiểm tra: đúng package không, ai duy trì, có cần thật không.

### 5. Bảo mật và phân quyền

AI viết rất giỏi luồng chính: user đăng nhập, xem đơn hàng của mình. Nó hay quên câu hỏi: **user này có quyền xem đơn hàng đó không?**

```ruby
def show
  @order = Order.find(params[:id]) # bất kỳ ai đăng nhập đều xem được mọi đơn
end
```

Với mỗi endpoint mới, reviewer nên tự hỏi: ai được gọi, ai không được gọi, và code kiểm tra điều đó ở đâu. Cũng vậy với input đi vào query, vào lệnh shell, vào template.

### 6. Hiệu năng ở quy mô thật

Code AI viết thường đúng với vài bản ghi trong test. Với 100.000 bản ghi thì sao? Tìm vòng lặp có query bên trong (N+1), load toàn bộ bảng vào bộ nhớ, thiếu phân trang, thiếu index cho cột mới dùng để lọc. Những lỗi này không bao giờ lộ ra trong test, chỉ lộ ra khi [dữ liệu lớn lên](/blog/k6-load-test-rails-api/).

### 7. Đồng thời

Hai request cùng lúc thì sao? Hai worker cùng xử lý một job thì sao? Biến này có bị chia sẻ giữa các thread không? Đây là loại lỗi mà cả người lẫn AI đều hay bỏ sót, và chỉ hiện ra dưới tải. Xem thêm bài về [dữ liệu bị lẫn giữa các request trong Ruby](/blog/ruby-thread-du-lieu-request/).

### 8. Độ phức tạp không cần thiết

AI có xu hướng viết code "đầy đủ": interface cho thứ chỉ có một cài đặt, factory cho thứ chỉ tạo một kiểu, cấu hình cho thứ không bao giờ đổi. Mỗi lớp trừu tượng thừa là thêm một chỗ để người sau phải hiểu. Reviewer có quyền, và nên, nói: "Viết đơn giản lại đi."

## Dùng AI để review: người soát lỗi, không phải người duyệt

Dùng AI để review code là hợp lý, và nên làm. Nó đọc nhanh, không mệt, bắt được nhiều lỗi lặt vặt mà người hay bỏ qua lúc 5 giờ chiều thứ Sáu.

Nhưng hãy đặt nó đúng vai: **lượt soát đầu tiên**, giống như linter thông minh hơn. Nó lọc bớt lỗi lặt vặt để người review có thể dồn sức vào những câu hỏi mà AI kém: có giải đúng vấn đề không, có phù hợp với kiến trúc không, có rủi ro gì với hệ thống thật không.

Vài điều cần nhớ:

- **AI review không thay được approve của người.** Người bấm approve là người cùng chịu trách nhiệm.
- **AI review cũng có nhiễu.** Nó có thể đưa ra hai mươi góp ý, trong đó ba cái đáng giá. Đừng bắt tác giả sửa hết chỉ vì máy nói.
- **AI review code do AI viết có điểm mù chung.** Nếu cùng một kiểu model viết và review, những giả định sai của nó có thể được xác nhận lại thay vì bị phát hiện.

## Vài quy tắc cho team

Nếu muốn bắt đầu từ đâu đó, đây là những quy tắc mình thấy hiệu quả:

- **Không approve thứ mình không hiểu.** Comment "Tôi không hiểu đoạn này, giải thích hoặc viết lại đơn giản hơn" là một comment review hoàn toàn hợp lệ.
- **Giới hạn kích thước PR.** Lớn hơn mức team đọc được thì phải tách.
- **Mô tả PR bắt buộc** với bốn mục: vì sao, làm gì, kiểm chứng thế nào, chỗ cần review kỹ.
- **Sửa bug phải có test tái hiện bug**, và test đó phải fail trên code cũ.
- **Thay đổi assertion của test cũ phải có lý do** ghi trong mô tả PR.
- **Dependency mới phải được duyệt riêng.**
- **Code đụng tới tiền, phân quyền, dữ liệu người dùng** cần hai người review.
- **Đừng đo năng suất bằng số PR merge.** Đo như vậy chỉ khuyến khích merge nhanh hơn, không khuyến khích merge đúng hơn.

## Kết

Trong thời AI, viết code rẻ hơn đọc code. Điều đó không làm code review kém quan trọng đi. Ngược lại, nó biến review thành nơi duy nhất trong quy trình mà một con người buộc phải hiểu thứ sắp lên production.

Một team review tốt không phải là team bắt được nhiều lỗi nhất. Đó là team mà mỗi lần bấm approve, có ít nhất hai người hiểu code đó làm gì, vì sao nó đúng, và sửa nó thế nào khi nó hỏng.
