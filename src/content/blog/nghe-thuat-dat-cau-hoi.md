---
title: "Nghệ thuật đặt câu hỏi: khi ai cũng có lời giải, thứ hiếm là vấn đề"
description: AI suy luận và trả lời ngày càng giỏi, nên lời giải không còn là lợi thế. Thứ hiếm bây giờ là câu hỏi đúng. Nhưng câu hỏi từ đâu ra? Không phải từ một khung giờ ngồi nghĩ, mà từ sự khó chịu, từ việc ở đủ gần vấn đề, và từ thói quen hỏi tiếp khi người khác đã dừng.
pubDate: 2026-11-25
tags: [thinking, ai]
---

Hồi mới đi làm, mình nghĩ người giỏi là người trả lời được. Ai hỏi gì về Rails, về SQL, về Go cũng biết. Gặp bug lạ thì tìm ra nguyên nhân nhanh hơn người khác.

Bây giờ, phần lớn những câu trả lời đó mình gõ vào AI và nhận lại trong vài giây. Có khi đúng hơn mình tự nghĩ. Người bên cạnh cũng làm y như vậy. Người ở công ty đối thủ cũng thế.

Khi ai cũng có một cỗ máy trả lời trong túi, câu trả lời không còn là lợi thế. Thứ còn lại là **câu hỏi**: hỏi cái gì, và tại sao lại hỏi cái đó.

## Lời giải đang rẻ đi

Nói "lời giải rẻ đi" không có nghĩa là thực thi không còn quan trọng. Một kế hoạch đúng vẫn có thể chết vì làm dở. Nhưng chi phí để đi từ một câu hỏi đã rõ ràng tới một lời giải chấp nhận được đang giảm rất nhanh. Viết một API, phân tích một tập dữ liệu, so sánh ba thư viện, phác một kiến trúc: những việc từng mất cả tuần giờ còn một buổi.

Cái không rẻ đi là bước trước đó. AI giải rất giỏi bài toán **đã được nói rõ**. Nó rất tệ ở việc nhận ra bài toán **đã bị nói sai**. Bạn hỏi "làm sao tăng tốc trang báo cáo này", nó sẽ đưa ra index, cache, phân trang, tất cả đều hợp lý. Nó sẽ không hỏi lại: "Có ai thật sự mở trang báo cáo này không? Hay họ export ra Excel rồi tự tính?" Câu hỏi đó có thể xoá luôn cả bài toán.

Một lời giải hoàn hảo cho câu hỏi sai vẫn là công sức đổ đi, chỉ là đổ đi nhanh hơn.

## Nhưng câu hỏi ở đâu ra?

Đây là chỗ mà các bài viết về "tư duy đặt câu hỏi" thường bỏ trống. Người ta khuyên "hãy đặt câu hỏi đúng" như thể câu hỏi nằm sẵn đâu đó, chỉ cần với tay lấy. Thực tế thì không. Ngồi trước màn hình trắng và tự nhủ "giờ mình sẽ nghĩ ra một câu hỏi hay" gần như không bao giờ có kết quả.

Theo những gì mình trải qua, câu hỏi tốt hiếm khi đến từ việc cố nghĩ. Nó đến từ vài nguồn rất đời thường.

### Từ sự khó chịu

Thứ gì làm bạn bực mình lặp đi lặp lại là một câu hỏi chưa được đặt ra. Deploy mất 40 phút và ai cũng than nhưng không ai sửa. Mỗi lần onboarding người mới lại phải giải thích cùng một chuyện. Khách hàng gọi hỗ trợ hỏi cùng một câu mỗi tuần.

Phần lớn mọi người quen dần với sự khó chịu. Đó chính là lúc câu hỏi biến mất. Người tìm ra vấn đề là người **chưa chịu quen**, và hỏi: "Tại sao việc này lại phải như vậy?"

### Từ việc ở đủ gần vấn đề

Bạn không thể đặt câu hỏi hay về một thứ bạn chỉ nhìn từ xa. Dev chỉ đọc ticket sẽ hỏi về ticket. Dev từng ngồi cạnh kế toán một buổi chiều, xem họ thao tác với phần mềm, sẽ hỏi về **công việc của kế toán**. Hai loại câu hỏi đó dẫn tới hai sản phẩm rất khác nhau.

AI không ngồi cạnh kế toán được. Nó không thấy họ thở dài khi phải copy dữ liệu từ màn hình này sang màn hình khác. Đây là lợi thế không thể chép lại của người ở hiện trường: bạn thấy những thứ không ai ghi vào tài liệu.

### Từ dữ liệu "trông hơi lạ"

Một biểu đồ có cái gai nhỏ vào mỗi thứ Hai. Một nhóm user đăng ký xong rồi không bao giờ quay lại. Một endpoint chậm nhưng chỉ chậm với vài khách hàng. Phản xạ thông thường là bỏ qua: "chắc ngẫu nhiên thôi". Phản xạ của người tìm vấn đề là: "Lạ nhỉ, tại sao?"

Những bất thường nhỏ là nơi thực tế không khớp với hiểu biết của bạn. Và chỗ không khớp đó chính là chỗ câu hỏi sống.

### Từ việc hỏi tiếp khi người khác đã dừng

Đa số người dừng ở câu trả lời đầu tiên nghe hợp lý. "Tại sao đơn hàng bị trùng?" — "Vì user bấm hai lần." Xong, thêm debounce ở frontend, đóng ticket.

Hỏi tiếp: tại sao bấm hai lần lại tạo hai đơn? Vì backend không có idempotency. Tại sao không có? Vì lúc thiết kế không nghĩ tới retry. Vậy còn chỗ nào khác cũng không nghĩ tới retry? Câu hỏi thứ tư đó mới là câu hỏi đáng giá, vì nó tìm ra cả một loại bug chứ không phải một bug.

### Từ việc thứ gì vừa trở nên khả thi

Có một loại câu hỏi đặc biệt hữu ích ngay lúc này: **"Việc gì trước đây không đáng làm vì quá tốn công, giờ đã đáng làm?"** Đọc hết 10.000 phiếu phản hồi của khách hàng. Viết test cho module cũ không ai dám đụng. Chuẩn hoá lại dữ liệu bẩn của 5 năm. Khi chi phí của lời giải giảm, những câu hỏi từng bị gạt đi vì "không ai có thời gian" bỗng thành câu hỏi tốt.

## Thế nào là một câu hỏi tốt?

Không phải câu hỏi nào nghe sâu sắc cũng tốt. Vài thứ mình dùng để tự kiểm tra:

Câu hỏi tốt **nói về vấn đề, không nói về lời giải**. "Làm sao thêm nút export?" là câu hỏi về lời giải đã chọn sẵn. "Người dùng cần dữ liệu này để làm gì?" là câu hỏi về vấn đề. Câu thứ hai có thể dẫn tới cái nút, cũng có thể dẫn tới thứ tốt hơn nhiều.

Câu hỏi tốt **đủ cụ thể để có thể sai**. "Làm sao để sản phẩm tốt hơn?" không bao giờ sai, nên cũng không bao giờ dẫn tới đâu. "Có phải user bỏ giỏ hàng vì phí ship hiện ra quá muộn không?" thì kiểm chứng được, và dù đúng hay sai bạn đều học được điều gì đó.

Câu hỏi tốt **có người quan tâm tới câu trả lời**. Một câu hỏi thông minh mà trả lời xong không ai thay đổi quyết định gì thì chỉ là câu đố.

## AI cũng đặt câu hỏi được mà?

Có. Nhờ AI liệt kê "các câu hỏi nên đặt ra về hệ thống này" sẽ cho bạn một danh sách khá dài, và nhiều câu dùng được. Mình vẫn làm vậy thường xuyên.

Nhưng có hai giới hạn. Thứ nhất, AI chỉ hỏi dựa trên những gì bạn đưa cho nó. Nó không biết kế toán thở dài, không thấy cái gai trên biểu đồ nếu bạn không đưa biểu đồ vào, không biết sếp bạn thật sự lo về điều gì. Câu hỏi hay nhất thường nằm ở phần ngữ cảnh bạn **chưa nghĩ tới việc đưa vào**. Thứ hai, AI không có gì để mất. Nó không bực mình vì deploy chậm, không bị khách hàng gọi lúc nửa đêm. Câu hỏi thường sinh ra từ người phải sống với vấn đề.

Nên mình dùng AI như một người cùng hỏi, không phải người hỏi thay. Mình mang vấn đề từ hiện trường về, AI giúp mở rộng ra những góc mình chưa nghĩ tới, rồi mình chọn câu nào đáng theo.

## Đừng biến "tìm câu hỏi" thành cái cớ để không làm

Có một cái bẫy ở chiều ngược lại, và mình muốn nói thẳng. "Quan trọng là đặt câu hỏi" rất dễ biến thành lý do để chỉ nói mà không làm, để ngồi phân tích mãi mà không ship gì. Người đặt câu hỏi giỏi nhất mình từng gặp đều là người **làm nhiều**. Họ có câu hỏi hay vì họ chạm vào vấn đề hằng ngày, thử, sai, rồi hỏi lại.

Câu hỏi không đến từ việc ngồi một chỗ suy ngẫm. Nó đến từ việc đi ra ngoài, đứng đủ gần, chịu khó chịu, và tò mò lâu hơn người khác một chút.

## Một thói quen nhỏ

Nếu muốn bắt đầu từ đâu đó, đây là thói quen mình đang tập: cuối mỗi tuần, viết ra ba thứ làm mình khó chịu, hoặc thấy lạ, hoặc không hiểu vì sao lại như vậy. Không cần giải. Chỉ cần viết ra.

Sau vài tháng, danh sách đó sẽ là tài sản quý hơn bất kỳ câu trả lời nào mà AI đưa cho bạn. Vì câu trả lời thì ai cũng có. Còn câu hỏi đó, chỉ bạn mới có.
