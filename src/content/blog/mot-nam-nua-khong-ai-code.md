---
title: "Một năm nữa không ai code, không ai mở IDE, giao hết cho AI: người kinh doanh chỉ cần kết quả?"
description: Câu "một năm nữa không ai code nữa" đúng một nửa. Gõ code đang biến mất thật. Nhưng "chỉ cần kết quả" là câu mà ngành outsource đã nghe suốt hai mươi năm, và nó chưa bao giờ đơn giản. Ai định nghĩa kết quả, ai nghiệm thu, và ai chịu trách nhiệm khi kết quả sai?
pubDate: 2026-10-15
tags: [thinking, ai, career]
---

Gần đây mình nghe câu này khá nhiều, từ founder, từ người làm kinh doanh, và cả từ một số dev: "Một năm nữa không ai code nữa đâu. Không ai mở IDE. Giao hết cho AI. Người làm kinh doanh chỉ cần kết quả, đâu cần biết code."

Mình không nghĩ câu này sai hoàn toàn. Nhưng mình nghĩ nó trộn lẫn ba điều rất khác nhau, và chỉ một trong ba là đúng.

## Phần đúng: gõ code đang biến mất

Phải thừa nhận thẳng: việc **gõ code** đang giảm rất nhanh. Rất nhiều dev hiện nay dành phần lớn thời gian để mô tả việc cần làm, đọc code AI viết, và sửa hướng, chứ không phải gõ từng dòng. Agent chạy trong terminal, tự đọc repo, tự sửa file, tự chạy test. IDE vẫn mở, nhưng ngày càng giống một chỗ để đọc hơn là chỗ để viết.

Với một số loại phần mềm, người không biết code đã có thể tự làm ra thứ dùng được: landing page, tool nội bộ, script xử lý dữ liệu, prototype để gọi vốn. Năm năm trước những việc này cần thuê người. Giờ thì không.

Nếu "không ai code nữa" nghĩa là "không ai gõ code bằng tay nữa", thì nó đang xảy ra. Một năm hay ba năm thì khó nói, nhưng hướng đi là rõ.

## Phần sai: "chỉ cần kết quả"

Vấn đề nằm ở vế sau. "Người kinh doanh chỉ cần kết quả" nghe rất hợp lý, cho tới khi bạn hỏi: **kết quả là gì?**

Người làm outsource ở Việt Nam nghe câu này suốt hai mươi năm. Khách hàng không quan tâm code, chỉ cần sản phẩm chạy. Và gần như mọi dự án outsource thất bại đều thất bại ở đúng chỗ đó: không phải vì đội dev code dở, mà vì hai bên hiểu chữ "kết quả" khác nhau.

Khách nói "làm cho tôi chức năng đặt hàng". Đội dev làm, demo chạy, nghiệm thu, thanh toán. Ba tháng sau:

- Hai khách bấm đặt cùng lúc thì món cuối cùng trong kho bán được hai lần.
- Khách có 5.000 đơn hàng thì trang lịch sử mất 40 giây mới mở được.
- Một nhân viên nghỉ việc vẫn đăng nhập được vào trang quản trị.
- Đối tác thanh toán đổi API, không ai biết sửa ở đâu, vì đội làm ban đầu đã chuyển dự án.

Tất cả những thứ trên đều là "kết quả". Chỉ là không ai nói ra lúc đặt hàng, và cũng không ai kiểm tra lúc nghiệm thu. Demo chạy được và một hệ thống chạy ổn ba năm là hai kết quả rất khác nhau, và người không biết kỹ thuật thường chỉ nhìn thấy cái thứ nhất.

AI là một nhà thầu outsource cực nhanh, cực rẻ, làm việc 24/7, không bao giờ cãi. Nhưng nó mang theo **đúng những vấn đề** của outsource: làm đúng điều bạn nói chứ không phải điều bạn cần, không chịu trách nhiệm khi hệ thống hỏng, và làm cho thứ chưa xong trông như đã xong. Mình phân tích kỹ ba điểm này, cùng chuyện mô hình kinh doanh phần mềm sẽ thay đổi thế nào, trong bài [Khi AI trở thành công ty outsource](/blog/ai-la-outsource-tuong-lai/).

## Vậy ai sẽ cần trong thế giới "không ai code"?

Nếu không còn ai gõ code, thì ba việc sau vẫn phải có người làm, và chúng chưa bao giờ là việc gõ code:

**Định nghĩa kết quả.** Biến "làm cho tôi chức năng đặt hàng" thành một danh sách những gì phải đúng: hết hàng thì sao, hai người đặt cùng lúc thì sao, ai được xem gì, chậm tới mức nào thì chấp nhận được. Đây là việc của người hiểu cả kinh doanh lẫn kỹ thuật. Người chỉ hiểu một bên sẽ bỏ sót.

**Nghiệm thu thật sự.** Không phải xem demo, mà kiểm tra hệ thống dưới tải thật, với dữ liệu thật, với những trường hợp xấu nhất. Viết test cho những thứ quan trọng, thử phá hệ thống trước khi người dùng phá. Mình đã viết về chuyện này trong bài [AI viết code mà không ai đọc nổi](/blog/ai-viet-code-dev-lam-gi/): khi AI viết, điểm nghẽn chuyển sang khâu verify.

**Vận hành và chịu trách nhiệm.** Hệ thống chạy được hôm nay phải chạy được cả năm sau, khi dữ liệu lớn gấp trăm lần, khi đối tác đổi API, khi có sự cố lúc 3 giờ sáng. Ai đó phải [trực sự cố](/blog/on-call-la-gi/), phải [debug hệ thống thật](/blog/debug-he-thong-that-thoi-ai/), phải quyết định rollback hay không. AI hỗ trợ được rất nhiều, nhưng quyết định và trách nhiệm vẫn cần một con người.

Những người làm được ba việc này có thể không còn được gọi là "lập trình viên". Nhưng họ cũng không phải là "người kinh doanh chỉ cần kết quả". Họ là người đứng giữa, và họ sẽ có giá hơn bao giờ hết.

## Ở đâu thì "chỉ cần kết quả" là đủ?

Công bằng mà nói, có những nơi câu đó gần như đúng:

- Phần mềm dùng một lần, hoặc dùng nội bộ vài người: script đối soát cuối tháng, dashboard cho team, tool chuyển đổi file.
- Prototype để kiểm tra một ý tưởng, chấp nhận vứt đi nếu ý tưởng không thành.
- Những thứ mà sai thì thiệt hại nhỏ và sửa nhanh.

Với những thứ này, người kinh doanh tự làm bằng AI là hoàn toàn hợp lý, và nên làm. Không cần thuê ai cả.

Nhưng ranh giới nằm ở đây: **khi phần mềm chạm vào tiền, dữ liệu của người khác, hoặc trở thành thứ công ty phụ thuộc vào**, "chỉ cần kết quả" không còn đủ. Lúc đó bạn cần biết kết quả đó có đúng không, có an toàn không, và ai sửa khi nó hỏng.

## Về con số "một năm"

Một lưu ý nhỏ về dự đoán. Ngành công nghệ có thói quen đoán đúng hướng nhưng sai thời gian. Chuyện "không ai cần lập trình viên nữa" đã được dự đoán nhiều lần, với ngôn ngữ thế hệ thứ tư, với công cụ kéo thả, với no-code. Lần nào hướng đi cũng có phần đúng: lập trình trở nên dễ hơn, nhiều người làm được hơn. Và lần nào nhu cầu về người hiểu hệ thống cũng tăng lên, không giảm đi, vì có nhiều phần mềm hơn để hiểu.

Lần này có thể khác, vì AI mạnh hơn mọi công cụ trước đó rất nhiều. Nhưng "một năm" là một con số quá tự tin cho một thay đổi chạm tới mọi ngành.

## Kết

Nếu bạn là người làm kinh doanh: hãy dùng AI để tự làm những thứ rủi ro thấp, nó sẽ tiết kiệm cho bạn rất nhiều tiền và thời gian. Nhưng với những thứ công ty bạn phụ thuộc vào, đừng nhầm "chạy được" với "xong". Bạn vẫn cần một người hiểu hệ thống, có thể không còn ngồi gõ code, nhưng biết hỏi đúng câu hỏi và biết kiểm tra câu trả lời.

Nếu bạn là dev: đừng bám vào việc gõ code, vì nó đang mất giá thật. Hãy chuyển sang những thứ mà "chỉ cần kết quả" luôn cần nhưng không ai nói ra: định nghĩa kết quả cho đúng, chứng minh kết quả là đúng, và giữ cho nó đúng theo thời gian.

Không ai code nữa cũng được. Nhưng sẽ luôn cần người biết code đó có đúng không.
