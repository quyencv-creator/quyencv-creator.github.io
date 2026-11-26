---
title: "\"Things You Should Never Do\" có còn đúng khi AI viết lại được mọi thứ?"
description: Năm 2000, Joel Spolsky gọi viết lại từ đầu là sai lầm chiến lược tệ nhất của một công ty phần mềm. Hơn hai mươi năm sau, AI viết lại cả hệ thống trong vài tháng. Vài suy ngẫm về việc cái gì đã đổi, cái gì vẫn nguyên, và vì sao viết lại càng rẻ thì phần đắt nhất càng lộ rõ.
pubDate: 2026-11-26
tags: [thinking, ai, architecture]
---

Năm 2000, Joel Spolsky viết bài "Things You Should Never Do, Part I". Bài ngắn, đọc mười phút, nhưng tới giờ vẫn được trích dẫn mỗi khi có ai trong phòng họp nói "hay là mình viết lại từ đầu".

Ví dụ trong bài là Netscape. Họ quyết định viết lại trình duyệt từ đầu, và trong lúc viết lại, sản phẩm gần như đứng yên suốt mấy năm. Joel gọi đó là sai lầm chiến lược tệ nhất mà một công ty phần mềm có thể mắc.

Lập luận của ông gói trong vài ý. Đọc code khó hơn viết code, nên lập trình viên luôn thấy code cũ là một mớ hỗn độn. Nhưng code cũ trông xấu là vì nó chứa đầy bug fix: mỗi dòng lạ là một lần ai đó đã gặp lỗi thật và sửa nó. Viết lại từ đầu là vứt bỏ tất cả hiểu biết đó, rồi phải tìm lại từng cái một, bằng những bug mới. Trong lúc đó, đối thủ không chờ bạn.

Hơn hai mươi năm sau, mọi chuyện có vẻ đã khác. Năm 2026, Bun, một runtime JavaScript với codebase rất lớn, được chuyển từ Zig sang Rust với Claude Code làm phần lớn công việc, mất khoảng bốn tháng. Các công ty AI cũng bắt đầu nói công khai về việc dùng AI để chuyển những hệ thống lớn của chính họ sang ngôn ngữ khác.

Vậy Joel sai rồi sao?

## Một nửa lập luận đã đổi

Phải thừa nhận thẳng: một vế trong lập luận của Joel đã yếu đi rất nhiều.

Netscape mất nhiều năm chủ yếu vì phải gõ lại từng dòng. Thời gian đó chính là thứ khiến viết lại trở thành sai lầm chiến lược: sản phẩm đứng yên, đối thủ vượt lên, cơ hội mất đi. Khi AI biến "nhiều năm" thành "vài tháng", vế này không còn nặng như trước. Nếu lý do duy nhất để không viết lại là "lâu quá", thì lý do đó đang hết hiệu lực.

Nhưng đó chỉ là một nửa.

## Nửa còn lại vẫn nguyên

Vế quan trọng hơn trong bài của Joel không nói về thời gian. Nó nói về **hiểu biết**.

Code cũ chứa những thứ không ai ghi lại: cách xử lý một trường hợp biên mà một khách hàng lớn gặp năm nào đó, một đoạn kiểm tra kỳ lạ để tránh lỗi của một thư viện bên thứ ba, một hành vi sai mà người dùng đã quen tới mức coi là đúng. Những hiểu biết đó không nằm trong cú pháp. Chúng nằm trong **hành vi** của hệ thống đang chạy.

AI dịch cú pháp rất giỏi. Nhưng nó không biết dòng code lạ nào là rác, dòng nào là bản sửa cho một sự cố từ năm 2021. Bảo AI "viết lại cho sạch" là bảo nó làm đúng điều Joel cảnh báo: dọn đi những thứ trông thừa, và mất luôn hiểu biết bên trong. Chỉ khác là nó làm nhanh hơn và tự tin hơn con người.

## Những người viết lại giỏi nhất làm gì?

Điều mình thấy thú vị nhất trong các câu chuyện viết lại bằng AI gần đây không phải là tốc độ. Mà là cách những team làm tốt **không tin vào bản dịch**.

Họ kiểm chứng bản mới với bản cũ bằng mọi thứ có trong tay: bộ test sẵn có của hệ thống cũ, và với các service, chạy hệ thống mới song song với hệ thống cũ, đưa cùng một traffic thật vào cả hai, rồi so sánh từng khác biệt. Mỗi chỗ lệch là một câu hỏi: đây là bug của bản mới, hay là một hành vi của bản cũ mà không ai biết là tồn tại?

Nói cách khác, những người có AI mạnh nhất trong tay vẫn làm đúng điều Joel lo lắng: bảo toàn hiểu biết của hệ thống cũ. Chỉ là họ không bảo toàn bằng cách "đừng viết lại", mà bằng cách **chứng minh** bản mới hành xử giống bản cũ trước khi tin nó.

AI làm phần gõ rẻ đi. Nó không làm phần biết rẻ đi.

## Rào chắn tự nhiên đã mất

Có một hệ quả ít người nói tới.

Trước đây, không ai viết lại bừa bãi, không phải vì ai cũng đọc bài của Joel, mà vì **quá đắt**. Chi phí thời gian là một rào chắn tự nhiên. Muốn viết lại, bạn phải thuyết phục được sếp, được team, phải có lý do đủ lớn. Phần lớn ý định viết lại chết ngay ở bước đó, và đó thường là điều tốt.

Giờ rào chắn đó gần như biến mất. Ai cũng có thể bảo AI viết lại một service vào chiều thứ Sáu. Và khi không còn chi phí nào ngăn lại, thứ duy nhất phân biệt một lần viết lại tốt với một thảm hoạ là **kỷ luật**: có hệ thống cũ để đối chiếu không, có traffic thật để so không, có ai chịu trách nhiệm cho từng chỗ khác biệt không.

Team có kỷ luật đó sẽ dùng AI để làm những lần viết lại mà trước đây không ai dám làm. Team không có sẽ lặp lại đúng sai lầm của Netscape, chỉ là nhanh hơn, và với nhiều hệ thống hơn.

## Ngôn ngữ thành chi tiết, hệ thống thì không

Một điều nữa đáng suy ngẫm. Ngày nay, một team chưa từng viết Rust vẫn có thể làm ra một hệ thống Rust chạy được. Rào cản ngôn ngữ đang biến mất nhanh hơn ai cũng tưởng.

Nhưng nhìn kỹ các câu chuyện thành công được kể lại, những team đó không thiếu thứ quan trọng hơn: họ hiểu rất sâu hệ thống cũ làm gì, và có hạ tầng để so sánh hai bên. Lợi thế của họ không nằm ở việc biết ngôn ngữ đích. Nó nằm ở việc biết **hệ thống của mình thật sự đang làm gì**.

Có lẽ đây là bài học lớn nhất. Khi AI có thể chuyển hệ thống từ ngôn ngữ này sang ngôn ngữ khác, câu hỏi "bạn biết ngôn ngữ gì" mất dần ý nghĩa. Câu hỏi còn lại là: bạn có hiểu hệ thống của mình đủ để biết bản mới có đúng không?

## Joel vẫn đúng, theo một cách khác

Nếu phải viết lại bài của Joel cho năm 2026, có lẽ tiêu đề sẽ không còn là "đừng bao giờ viết lại". Nó sẽ là: **đừng bao giờ viết lại mà không có cách chứng minh bản mới giữ nguyên những gì bản cũ đã biết**.

Viết lại càng rẻ, phần đắt nhất càng lộ rõ. Phần đắt nhất chưa bao giờ là gõ code. Nó luôn là biết code đó có đúng không.

Joel viết rằng code cũ chứa hiểu biết. Câu đó vẫn đúng. Chỉ có một điều đã thay đổi: hiểu biết đó từng được bảo vệ bởi việc viết lại quá tốn kém. Giờ nó chỉ còn được bảo vệ bởi những người chịu khó kiểm chứng.
