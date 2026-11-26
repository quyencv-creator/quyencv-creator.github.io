---
title: "Postmortem là gì, tại sao dev nên đọc, và đọc ở đâu"
description: Postmortem là bản phân tích sau sự cố, viết ra để học chứ không để đổ lỗi. Đọc postmortem của người khác là cách rẻ nhất để có kinh nghiệm xử lý sự cố mà không phải tự làm sập production. Kèm cách đọc cho hiệu quả và danh sách nguồn đọc công khai.
pubDate: 2026-11-26
draft: true
tags: [thinking, devops, backend]
---

Kinh nghiệm xử lý sự cố là thứ đắt nhất trong nghề backend. Cách duy nhất để có nó là đứng giữa một sự cố thật: production sập, khách hàng gọi, sếp hỏi bao giờ xong, còn bạn thì đang nhìn vào một đống log không hiểu gì. Mỗi lần như vậy học được rất nhiều, nhưng không ai muốn có nhiều lần như vậy.

May là có một đường tắt: đọc lại sự cố của người khác. Rất nhiều công ty viết lại chi tiết các sự cố của họ và công bố công khai. Những tài liệu đó gọi là **postmortem**.

## Postmortem là gì?

Postmortem (còn gọi là incident report, post-incident review, hay RCA, root cause analysis) là bản phân tích được viết **sau khi** một sự cố đã được xử lý xong. Nó trả lời: chuyện gì đã xảy ra, ảnh hưởng tới ai và bao nhiêu, vì sao xảy ra, xử lý ra sao, và làm gì để không lặp lại.

Một postmortem tốt thường có các phần:

- **Tóm tắt**: vài câu cho người không có thời gian đọc hết.
- **Ảnh hưởng**: bao nhiêu người dùng, bao lâu, mất dữ liệu gì, thiệt hại gì.
- **Dòng thời gian**: từng mốc theo phút, từ lúc vấn đề bắt đầu, lúc được phát hiện, những gì đã thử, tới lúc khôi phục.
- **Nguyên nhân**: không chỉ "nguyên nhân gốc" mà là chuỗi các yếu tố góp phần.
- **Cái gì làm tốt, cái gì làm chưa tốt**, và **chỗ đã gặp may**.
- **Hành động khắc phục**: việc cụ thể, có người phụ trách, có hạn.

Điều quan trọng nhất về postmortem không nằm ở cấu trúc mà ở tinh thần: **blameless**, tức là không đổ lỗi. Chương "Postmortem Culture: Learning from Failure" trong cuốn *Site Reliability Engineering* của Google viết rằng một postmortem thật sự không đổ lỗi phải tập trung vào các yếu tố góp phần gây ra sự cố, mà không quy kết cá nhân hay team nào vì hành vi sai. Trước đó, năm 2012, John Allspaw ở Etsy đã viết bài "Blameless PostMortems and a Just Culture" với cùng một tinh thần: nhìn kỹ xem sự cố thật sự xảy ra thế nào, đối xử tôn trọng với các kỹ sư liên quan, và học từ đó.

Vì sao không đổ lỗi lại quan trọng? Vì nếu người gây ra sự cố bị phạt, lần sau người ta sẽ giấu chi tiết, và bạn mất đúng thứ thông tin cần nhất để không lặp lại sự cố. Hơn nữa, khi một người gõ nhầm lệnh làm sập production, câu hỏi đáng giá không phải là "ai gõ nhầm" mà là "tại sao hệ thống cho phép một lệnh gõ nhầm làm sập production".

## Tại sao nên đọc postmortem?

### Kinh nghiệm giá rẻ

Mỗi postmortem là kinh nghiệm của một đội kỹ sư, thường là rất giỏi, trả bằng hàng giờ căng thẳng và đôi khi hàng triệu đô. Bạn đọc nó mất hai mươi phút. Không có khoản đầu tư nào có tỉ suất tốt hơn.

### Sự cố lặp lại theo khuôn mẫu

Đọc đủ nhiều, bạn sẽ thấy các sự cố lớn rất hay quay về vài khuôn mẫu: một thay đổi cấu hình được đẩy ra mọi nơi cùng lúc, một cơ chế bảo vệ bị gỡ đi trong lúc refactor, backup chưa bao giờ được thử khôi phục, retry làm quá tải hệ thống đang yếu, chứng chỉ hết hạn, một lệnh chạy nhầm máy. Khi đã quen mặt các khuôn mẫu này, bạn bắt đầu nhận ra chúng trong hệ thống của chính mình, **trước** khi chúng thành sự cố.

### Học cách hệ thống hỏng, không chỉ cách nó chạy

Tài liệu kỹ thuật dạy bạn cách hệ thống hoạt động khi mọi thứ đúng. Postmortem dạy bạn hệ thống hành xử thế nào khi mọi thứ sai: vòng phản hồi nào khuếch đại sự cố, độ trễ nào khiến việc phát hiện chậm, giả định ngầm nào bị phá vỡ. Đây chính là [tư duy hệ thống](/blog/tu-duy-he-thong-thoi-ai/) được minh hoạ bằng tình huống thật.

### Học cách debug của người giỏi

Phần dòng thời gian cho bạn thấy người ta đã nghi ngờ gì trước, đã thử gì, đã sai ở đâu, và cuối cùng tìm ra bằng cách nào. Đây là bài học [debug hệ thống thật](/blog/debug-he-thong-that-thoi-ai/) mà không khoá học nào dạy được.

### Viết postmortem của chính mình tốt hơn

Đọc nhiều postmortem hay, bạn sẽ biết một bản phân tích tốt trông như thế nào: dòng thời gian rõ, nguyên nhân sâu, hành động khắc phục cụ thể chứ không phải "sẽ cẩn thận hơn".

## Hai postmortem nên đọc đầu tiên

### GitLab, 31/1/2017: xoá nhầm database

Theo postmortem GitLab công bố ngày 10/2/2017: database bị spam làm mất ổn định, replication bị chậm, và trong lúc xử lý bản replica, một kỹ sư chạy lệnh xoá dữ liệu **trên nhầm máy**, máy primary. Lệnh được dừng lại, nhưng trong khoảng 300 GB dữ liệu chỉ còn khoảng 4,5 GB. Họ khôi phục từ một bản snapshot tạo khoảng 6 giờ trước đó, và các thay đổi trong khoảng thời gian ấy bị mất.

Bản này đáng đọc vì hai lý do. Thứ nhất, nó cho thấy một sự cố lớn hiếm khi là "một người gõ nhầm": nó là một chuỗi bắt đầu từ spam, tới replication chậm, tới một thao tác khắc phục chạy nhầm chỗ. Đọc bản gốc để xem họ phân tích từng mắt xích ra sao. Thứ hai, GitLab công khai gần như mọi thứ ngay trong lúc xử lý, kể cả livestream quá trình khôi phục, một mức minh bạch hiếm thấy.

### Cloudflare, 2/7/2019: một biểu thức chính quy

Theo bài "Details of the Cloudflare outage on July 2, 2019": một rule WAF mới chứa một biểu thức chính quy gây backtracking quá mức, làm CPU của mọi core xử lý HTTP/HTTPS trên toàn mạng Cloudflare lên 100%. Dịch vụ bị gián đoạn 27 phút.

Bài viết đáng đọc vì chính Cloudflare nói rằng câu chuyện thật phức tạp hơn nhiều so với "một regex tồi": có một cơ chế bảo vệ lẽ ra ngăn được regex dùng quá nhiều CPU, nhưng nó đã bị gỡ nhầm trong một lần refactor vài tuần trước. Cộng thêm việc rule được đẩy ra toàn cầu cùng lúc. Bài có cả phụ lục giải thích backtracking của regex, rất đáng đọc riêng.

## Đọc ở đâu?

**Tuyển tập**

- **[danluu/post-mortems](https://github.com/danluu/post-mortems)**: danh sách postmortem công khai lớn và lâu đời nhất, chia theo loại lỗi (cấu hình, phần cứng, thời gian, database…), vẫn được cộng đồng cập nhật. Nếu chỉ lưu một link, hãy lưu link này.
- **[icco/postmortems](https://github.com/icco/postmortems)**: dựa trên danh sách của Dan Luu, thêm phân loại và dữ liệu thời gian.
- **The VOID (Verica Open Incident Database)**: cơ sở dữ liệu báo cáo sự cố phần mềm công khai, ra mắt năm 2021, kèm các báo cáo phân tích hằng năm về xu hướng sự cố.

**Từ các công ty lớn**

- **[AWS Post-Event Summaries](https://aws.amazon.com/premiumsupport/technology/pes/)**: các bản tóm tắt sau sự cố lớn của AWS, có từ năm 2011, gần nhất là sự cố DynamoDB ở us-east-1 tháng 10/2025. Đọc để hiểu một hệ thống ở quy mô cực lớn hỏng theo cách nào.
- **[GitHub Availability Report](https://github.blog/tag/github-availability-report/)**: GitHub công bố hằng tháng từ năm 2020, tóm tắt các sự cố trong tháng và hướng khắc phục. Ngắn, đều đặn, rất hợp để đọc định kỳ.
- **Blog của Cloudflare**: Cloudflare nổi tiếng viết postmortem chi tiết và nhanh, thường kèm cả phân tích kỹ thuật sâu.
- Trang status của các dịch vụ bạn đang dùng: nhiều nơi đính kèm báo cáo sau mỗi sự cố.

**Về văn hoá và cách viết postmortem**

- **[Google SRE book, chương 15: Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)** và **[SRE Workbook, chương 10](https://sre.google/workbook/postmortem-culture/)**: miễn phí, có template, có cả một postmortem viết dở được phân tích và sửa lại.
- **[Blameless PostMortems and a Just Culture](https://www.etsy.com/codeascraft/blameless-postmortems)** của John Allspaw: bài viết kinh điển về tinh thần không đổ lỗi.

## Đọc thế nào cho có ích?

Đọc postmortem như đọc tin tức thì quên ngay. Vài cách để nó đọng lại:

**Dừng ở mỗi mốc trong dòng thời gian.** Trước khi đọc tiếp, tự hỏi: nếu là mình, lúc này mình sẽ nghi ngờ gì, sẽ làm gì? Rồi so với điều họ đã làm. Đây là cách luyện xử lý sự cố mà không cần sự cố.

**Tìm chuỗi, không tìm thủ phạm.** Sau mỗi bài, thử viết ra chuỗi các yếu tố dẫn tới sự cố. Nếu chuỗi của bạn chỉ có một mắt xích ("do regex tồi", "do kỹ sư gõ nhầm"), bạn đã đọc chưa kỹ.

**Áp vào hệ thống của mình.** Câu hỏi đáng giá nhất sau mỗi postmortem: "Chuyện này có xảy ra với hệ thống của mình không?" Backup của mình đã từng được thử khôi phục chưa? Config của mình có được đẩy ra mọi nơi cùng lúc không? Có cơ chế bảo vệ nào mình từng gỡ đi mà không biết vì sao nó tồn tại không?

**Đọc đều.** Một bài mỗi tuần, đều đặn trong một năm, giá trị hơn nhiều so với đọc hai mươi bài trong một tối rồi thôi.

**Đọc cùng team.** Một số team có buổi đọc postmortem hằng tháng: chọn một bài, mỗi người đọc trước, rồi cùng thảo luận "chuyện này xảy ra ở mình thì sao". Đây là buổi học rẻ nhất mà team có thể tổ chức.

## Và hãy viết postmortem của chính mình

Đọc postmortem của người khác là bước một. Bước hai là bắt đầu viết cho sự cố của chính team mình, kể cả sự cố nhỏ: một lần deploy lỗi phải rollback, một cron job chạy sai, một tối API chậm. Không cần dài. Chỉ cần dòng thời gian, chuỗi nguyên nhân, và hai ba hành động khắc phục có người nhận.

Sau một năm, tập postmortem đó sẽ là tài liệu giá trị nhất về hệ thống của bạn, giá trị hơn mọi sơ đồ kiến trúc, vì nó ghi lại hệ thống **thật sự** hành xử thế nào, chứ không phải hành xử thế nào trên giấy.
