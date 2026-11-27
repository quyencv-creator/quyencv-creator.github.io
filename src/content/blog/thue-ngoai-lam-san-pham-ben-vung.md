---
title: "Thuê ngoài làm sản phẩm: làm sao để nhiều năm sau, dữ liệu lớn, người dùng đông vẫn chạy ổn?"
description: Không nhà thầu nào đảm bảo được "không lỗi". Thứ bạn mua được là một mức chất lượng đo được, một cam kết vận hành, và quyền tự do đổi nhà thầu. Checklist cho người làm kinh doanh khi chọn và ký hợp đồng với đơn vị làm sản phẩm.
pubDate: 2026-10-22
tags: [thinking, career, backend]
---

Một câu chuyện rất quen: công ty thuê một đơn vị làm sản phẩm, demo đẹp, nghiệm thu xong, thanh toán đủ. Vài tuần sau bắt đầu có lỗi. Vài tháng sau, khi người dùng đông lên, trang chậm dần, thỉnh thoảng sập. Gọi nhà thầu thì họ báo giá "bảo trì". Đổi nhà thầu thì bên mới nói không hiểu code, đề nghị làm lại từ đầu.

Khi nhiều đơn vị cùng ứng tuyển làm sản phẩm cho bạn, câu hỏi thật không phải "bên nào làm đẹp nhất" hay "bên nào rẻ nhất". Câu hỏi là: **ba năm sau, khi dữ liệu lớn gấp trăm lần và người dùng đông gấp chục lần, hệ thống còn chạy ổn không, và nếu không thì ai sửa?**

## Sự thật đầu tiên: không ai đảm bảo được "không lỗi"

Nói thẳng điều này trước, vì nó quyết định mọi thứ phía sau: **không công ty nào đảm bảo được phần mềm chạy nhiều năm không lỗi**. Google, Amazon, Cloudflare đều có sự cố, và họ công khai [postmortem](/blog/postmortem-la-gi/) để mọi người cùng học.

Đơn vị nào hứa "làm xong là chạy mãi không lỗi" thì hoặc không hiểu phần mềm, hoặc đang nói để trúng thầu. Cả hai đều là dấu hiệu nên lo.

Thứ bạn có thể đảm bảo là: lỗi ở **mức chấp nhận được**, được **phát hiện sớm**, được **sửa nhanh**, và bạn **không bị phụ thuộc** vào một nhà thầu duy nhất. Muốn vậy, phải đưa những điều này vào ngay từ lúc chọn và ký hợp đồng.

## 1. Đổi "ổn định" thành con số

"Hệ thống phải ổn định" là câu vô nghĩa trong hợp đồng, vì không ai đo được. Thay vào đó, ghi những chỉ số kiểm tra được:

- **Thời gian hoạt động**: ví dụ 99,9% mỗi tháng.
- **Độ trễ**: ví dụ 95% request trả về dưới 500ms.
- **Tỉ lệ lỗi tối đa**: ví dụ dưới 0,1% request lỗi.
- **Thời gian phản hồi sự cố** theo mức độ: sự cố nghiêm trọng phản hồi trong 15 phút, khắc phục trong 4 giờ.

Kèm theo: đo bằng công cụ gì, ai có quyền xem số liệu, và vi phạm thì giảm phí hoặc phạt ra sao.

Khi đó, "vài bữa lại có lỗi" không còn là chuyện cãi nhau cảm tính. Nó là một con số trong báo cáo tháng, và hợp đồng đã nói rõ phải xử lý thế nào.

Một lưu ý: các con số trên chỉ là ví dụ. Mỗi "số 9" thêm vào (99,9% lên 99,99%) làm chi phí tăng đáng kể. Hãy chọn mức mà kinh doanh của bạn thật sự cần, không phải mức nghe ấn tượng nhất.

## 2. Nghiệm thu cả tương lai, không chỉ hiện tại

Phần lớn lỗi "chạy được vài bữa rồi hỏng" đến từ việc nghiệm thu chỉ bằng demo, với vài chục bản ghi và một người dùng. Hệ thống nào cũng chạy tốt trong điều kiện đó.

Tiêu chí nghiệm thu nên có:

- **Kiểm tra chịu tải** ở mức cao hơn hiện tại nhiều lần, ví dụ gấp 3–5 lần lượng người dùng dự kiến năm sau. Xem chi tiết cách làm trong bài [load test bằng k6](/blog/k6-load-test-rails-api/).
- **Dữ liệu lớn**: tạo dữ liệu giả gấp nhiều lần hiện tại rồi chạy lại toàn bộ tính năng. Đây là cách lộ ra query chậm, thiếu index, trang danh sách không phân trang, trước khi người dùng thật gặp.
- **Thử khôi phục backup**: không chỉ hỏi "có backup không" mà yêu cầu khôi phục thật một bản backup ra môi trường riêng và kiểm tra dữ liệu. Backup chưa từng được khôi phục thử thì chưa chắc là backup.
- **Kiểm tra bảo mật** cơ bản, tốt nhất do một bên thứ ba độc lập thực hiện.
- **Giám sát và cảnh báo** có sẵn từ ngày bàn giao: khi hệ thống chậm hoặc lỗi, phải có người được báo, không phải đợi khách hàng gọi điện.

## 3. Tách hợp đồng xây dựng và hợp đồng vận hành

Bảo trì không phải là bằng chứng nhà thầu làm dở. Nó là chi phí cố định của **mọi** phần mềm đang chạy. Dữ liệu lớn lên cần tối ưu. Đối tác thanh toán đổi API. Thư viện phát hiện lỗ hổng bảo mật. Hệ điều hành và cloud cần nâng cấp. Một phần mềm không ai bảo trì sẽ hỏng dần, dù lúc bàn giao nó hoàn hảo.

Vì vậy nên tách rõ:

- **Giai đoạn bảo hành** sau bàn giao: lỗi do chính nhà thầu gây ra thì họ sửa miễn phí, trong một thời gian xác định.
- **Hợp đồng vận hành** riêng sau đó: phí định kỳ, cam kết theo các chỉ số ở mục 1, bao gồm trực sự cố, cập nhật bảo mật, tối ưu khi dữ liệu tăng.
- **Ngân sách bảo trì hằng năm** được lên kế hoạch ngay từ đầu, không coi là chi phí phát sinh.

Cẩn thận với báo giá xây dựng rất rẻ mà không nói gì về vận hành. Đó thường là chiến lược lấy lại tiền ở giai đoạn bảo trì, khi bạn đã phụ thuộc và không dễ đổi.

## 4. Không để bị nhà thầu giữ con tin

Đây là điểm quan trọng nhất, và cũng hay bị bỏ qua nhất. Bạn phải luôn có khả năng đổi nhà thầu mà không phải làm lại từ đầu.

- **Bạn sở hữu mọi thứ**: source code trong repository của bạn, tài khoản cloud đứng tên công ty bạn, domain, database, khoá API của các dịch vụ bên ngoài. Nhà thầu được cấp quyền truy cập, không phải ngược lại.
- **Tài liệu là một phần của sản phẩm**: sơ đồ kiến trúc, hướng dẫn cài đặt và deploy, [runbook xử lý sự cố](/blog/on-call-la-gi/). Không có tài liệu thì chưa nghiệm thu.
- **Thử chuyển giao trước khi nghiệm thu**: nhờ một người ngoài, không thuộc nhà thầu, tự deploy và chạy hệ thống chỉ bằng tài liệu được giao. Họ không làm được thì tài liệu chưa đủ.
- **Code theo chuẩn phổ biến, có test tự động**. Code tốt là code mà một đơn vị khác tiếp nhận được.

## 5. Chọn nhà thầu bằng cách xem họ xử lý lỗi

Khi nhiều đơn vị cùng ứng tuyển, demo đẹp và portfolio dài không nói lên nhiều. Ai cũng có demo đẹp. Những câu hỏi phân loại tốt hơn:

- **"Sự cố lớn nhất anh chị từng gặp là gì, và đã xử lý thế nào?"** Bên nào kể rõ ràng, có dòng thời gian, có bài học, có thay đổi sau đó, là bên có kinh nghiệm vận hành thật. Bên nào nói "chưa từng có sự cố" đáng lo hơn.
- **"Anh chị đang vận hành hệ thống nào có tải lớn?"** và xin liên hệ khách hàng cũ để hỏi trực tiếp: sau bàn giao họ có còn hỗ trợ không, lỗi được sửa nhanh không.
- **"Anh chị kiểm tra chất lượng thế nào?"** Đặc biệt khi họ dùng AI để viết code: ai review, test những gì, kiểm tra hiệu năng ra sao. Code do AI viết nhanh hơn, nhưng cũng dễ có những lỗi [không ai đọc ra](/blog/ai-viet-code-dev-lam-gi/) nếu không có quy trình kiểm chứng.
- **Làm một dự án thử có trả phí**: nhỏ, vài tuần, có tiêu chí nghiệm thu như mục 2. Cách một đơn vị làm một việc nhỏ cho bạn thấy họ sẽ làm việc lớn thế nào.

## 6. Giữ một người phía bạn hiểu hệ thống

Mọi điều khoản ở trên đều chỉ có giá trị nếu phía bạn có người **đọc hiểu và kiểm tra được**. Không có người đó, bạn không biết báo cáo SLA có đúng không, kiến trúc có hợp lý không, nghiệm thu có thật không.

Không cần một team lớn. Một người nội bộ hiểu cả kinh doanh lẫn kỹ thuật, hoặc một chuyên gia độc lập thuê theo giờ để review ở các mốc quan trọng, là đủ cho phần lớn công ty. Chi phí cho người này nhỏ hơn nhiều so với chi phí làm lại một sản phẩm hỏng.

## Kết

Đừng mua "một sản phẩm không lỗi", vì không ai bán được thứ đó. Hãy mua ba thứ:

- **Một mức chất lượng đo được**, ghi bằng con số trong hợp đồng.
- **Một cam kết vận hành**, có người chịu trách nhiệm khi có sự cố.
- **Quyền tự do đổi nhà thầu**, nhờ sở hữu mọi thứ và có tài liệu đầy đủ.

Có đủ ba thứ đó, lỗi vẫn sẽ xảy ra, nhưng nó sẽ là chuyện được phát hiện sớm, sửa nhanh, và không làm công ty bạn phụ thuộc vào thiện chí của bất kỳ ai.
