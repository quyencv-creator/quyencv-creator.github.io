---
title: "Postmortem là gì, tại sao dev nên đọc, và đọc ở đâu"
description: Postmortem là bản phân tích sau sự cố, viết ra để học chứ không để đổ lỗi. Đọc postmortem của người khác là cách rẻ nhất để có kinh nghiệm xử lý sự cố mà không phải tự làm sập production. Kèm nguồn đọc công khai, cách đọc cho hiệu quả, và cách tự viết postmortem khi chính mình gặp sự cố.
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

## Tự viết postmortem khi chính mình gặp sự cố

Đọc postmortem của người khác là bước một. Bước hai là viết cho sự cố của chính mình, kể cả sự cố nhỏ: một lần deploy lỗi phải rollback, một cron job chạy sai, một tối API chậm mười phút. Sự cố nhỏ là lúc tập viết tốt nhất, vì không ai căng thẳng và không ai cần tìm người chịu trách nhiệm.

### Ghi chép ngay trong lúc xử lý

Phần khó viết nhất của postmortem là dòng thời gian, và nó gần như không thể dựng lại chính xác sau hai ngày. Vì vậy, ngay khi sự cố bắt đầu, mở một chỗ ghi chép chung (một kênh chat riêng cho sự cố, hoặc một file) và ghi lại mọi thứ kèm giờ: thấy gì, nghi gì, chạy lệnh gì, kết quả ra sao.

```text
22:41  Alert: tỉ lệ lỗi POST /orders > 5%
22:44  Log: ActiveRecord::ConnectionTimeoutError hàng loạt
22:47  Nghi pool nhỏ, tăng pool 5 -> 20, deploy
22:55  Lỗi giảm vài phút rồi quay lại
23:06  pg_stat_activity: 40 connection "idle in transaction", giữ 6-8 giây
23:10  Thấy lời gọi API vận chuyển nằm trong transaction, không timeout
23:14  Bật feature flag tắt tính phí ship realtime, dùng phí cố định
23:16  Tỉ lệ lỗi về 0
```

Ghi cả những hướng đi sai, như dòng 22:47 ở trên. Đó là phần học được nhiều nhất, và cũng là phần người ta hay xoá đi cho đẹp. Ghi giờ kèm múi giờ nếu team ở nhiều nơi. Nếu được, lưu lại ảnh chụp dashboard và đoạn log quan trọng trước khi chúng bị xoay vòng mất.

### Viết trong vòng một hai ngày

Viết khi trí nhớ còn tươi, thường là trong 24–48 giờ sau khi sự cố kết thúc. Để quá một tuần thì chi tiết đã mờ, và động lực cũng mất theo.

### Một template đủ dùng

Không cần template phức tạp. Đây là bản mình thấy đủ cho phần lớn sự cố:

```markdown
# [Ngày] Tên ngắn của sự cố

## Tóm tắt
2-3 câu: chuyện gì xảy ra, ảnh hưởng thế nào, đã xử lý ra sao.

## Ảnh hưởng
- Thời gian: từ ... đến ... (bao lâu)
- Ai bị ảnh hưởng, bao nhiêu: số request lỗi, số user, số đơn hàng...
- Mất dữ liệu / thiệt hại tiền: có / không, bao nhiêu

## Dòng thời gian
Copy từ ghi chép lúc xử lý, làm gọn lại, giữ cả hướng đi sai.

## Nguyên nhân
Chuỗi các yếu tố dẫn tới sự cố, không phải một câu.
Cơ chế: vì sao những yếu tố đó gộp lại thì sinh ra đúng triệu chứng đã thấy.

## Phát hiện thế nào
Alert báo, khách báo, hay tình cờ thấy? Mất bao lâu từ lúc bắt đầu tới lúc biết?

## Điều làm tốt / chưa tốt / gặp may

## Hành động khắc phục
| Việc | Loại | Người phụ trách | Hạn |
|------|------|-----------------|-----|
```

### Ảnh hưởng: đo bằng con số

"Một số user bị lỗi" không nói lên gì. "Từ 22:41 tới 23:16, khoảng 18% request đặt hàng thất bại" thì có. Lấy số từ log và metric, không ước lượng bằng cảm giác. Nếu không đo được thì ghi rõ "không đo được vì thiếu metric X", và đó tự nó đã là một hành động khắc phục.

### Nguyên nhân: hỏi tiếp cho tới khi thấy cơ chế

Đừng dừng ở câu trả lời đầu tiên. "Do pool connection cạn" là triệu chứng. Hỏi tiếp: tại sao cạn? Vì connection bị giữ lâu. Tại sao bị giữ lâu? Vì lời gọi HTTP nằm trong transaction. Tại sao lời gọi đó không bị cắt? Vì không đặt timeout. Tại sao review không bắt được? Vì không có quy ước nào về gọi ra ngoài trong transaction.

Kỹ thuật hỏi "tại sao" nhiều lần rất hữu ích, nhưng có một cái bẫy: nó dễ dẫn tới **một** nguyên nhân gốc duy nhất. Sự cố thật thường có nhiều nhánh cùng góp phần. Ở ví dụ trên còn có nhánh "đối tác chậm" và nhánh "alert chỉ báo tỉ lệ lỗi, không báo độ trễ gọi ra ngoài". Ghi hết các nhánh.

### Viết không đổ lỗi, kể cả khi người gây lỗi là chính mình

Không đổ lỗi không có nghĩa là không nói chuyện gì đã xảy ra. Nó có nghĩa là mô tả **hành động và bối cảnh**, không phán xét **con người**.

| Đổ lỗi | Không đổ lỗi |
|---|---|
| "Anh A quên đặt timeout." | "Lời gọi API vận chuyển không có timeout. Thư viện HTTP mặc định chờ 60 giây, và code review không có bước kiểm tra timeout cho lời gọi ra ngoài." |
| "Người trực xử lý sai, tăng pool làm tình hình tệ hơn." | "Thông báo lỗi chỉ ra pool, nên giả thuyết đầu tiên là pool nhỏ. Lúc đó chưa có dashboard cho thời gian giữ connection." |
| "Do sơ suất của team backend." | (Câu này không có thông tin gì. Xoá.) |

Khi chính bạn là người gây lỗi, cám dỗ ngược lại cũng nguy hiểm không kém: tự nhận hết rồi kết luận "lần sau mình sẽ cẩn thận hơn". Câu đó không ngăn được sự cố nào. Câu hỏi đúng vẫn là: hệ thống, công cụ, quy trình nào đã cho phép sai sót đó gây ra hậu quả?

### Hành động khắc phục: cụ thể, có người, có hạn

"Cẩn thận hơn khi review", "cải thiện monitoring" không phải hành động, vì không ai biết khi nào thì xong. Một hành động tốt thì kiểm tra được là đã làm hay chưa:

| Việc | Loại | Người phụ trách | Hạn |
|---|---|---|---|
| Đưa lời gọi API vận chuyển ra khỏi transaction | Ngăn chặn | Bình | 28/11 |
| Đặt timeout 2s và circuit breaker cho mọi lời gọi ra ngoài | Ngăn chặn | Bình | 5/12 |
| Alert khi p95 thời gian gọi đối tác > 1s | Phát hiện | An | 3/12 |
| Feature flag tắt tính phí realtime, ghi vào runbook | Giảm thiểu | An | 30/11 |
| Thêm rule lint cảnh báo HTTP call trong `transaction do` | Ngăn chặn | Châu | 10/12 |

Chia hành động theo ba loại giúp không bỏ sót: **ngăn chặn** (để không xảy ra), **phát hiện** (để biết sớm hơn), **giảm thiểu** (để khi xảy ra thì ít thiệt hại hơn). Một postmortem chỉ có hành động ngăn chặn thường là chưa nghĩ đủ, vì không có gì ngăn được mọi sự cố.

Và quan trọng nhất: **theo dõi tới khi các hành động được làm xong**. Postmortem có danh sách hành động đẹp mà không ai làm còn tệ hơn không viết, vì nó tạo cảm giác đã giải quyết xong.

### Một ví dụ hoàn chỉnh

Ghép tất cả lại, đây là một postmortem đầy đủ cho sự cố pool connection ở trên (sự cố minh hoạ, cùng tình huống với bài [debug hệ thống thật](/blog/debug-he-thong-that-thoi-ai/)). Độ dài như thế này là đủ cho phần lớn sự cố.

> **[2026-11-20] Đặt hàng thất bại do đối tác vận chuyển chậm**
>
> **Tóm tắt.** Từ 22:41 tới 23:16, khoảng 18% request đặt hàng thất bại. API tính phí ship của đối tác vận chuyển chậm từ khoảng 150ms lên khoảng 8 giây. Vì lời gọi này nằm trong transaction và không có timeout, mỗi request giữ connection database suốt 8 giây, làm cạn pool. Khôi phục bằng cách tắt tính phí ship realtime qua feature flag.
>
> **Ảnh hưởng.**
> - Thời gian: 35 phút (22:41–23:16).
> - Khoảng 22.700 trên 126.000 request `POST /orders` trả lỗi 500 (tính từ log Nginx).
> - Số đơn hàng mất thực tế: chưa xác định, vì một phần user đã thử lại thành công. Đang đối chiếu với dữ liệu giỏ hàng bị bỏ.
> - Không mất dữ liệu: các transaction lỗi đều rollback.
> - Từ 23:14 tới khi bật lại tính năng (09:30 hôm sau), phí ship tính theo mức cố định 30.000đ. Chênh lệch so với phí thật đang được kế toán tổng hợp.
>
> **Dòng thời gian** (giờ Việt Nam)
> - ~22:38 Đối tác bắt đầu chậm (thấy được sau, qua log thời gian gọi ra ngoài).
> - 22:41 Alert tỉ lệ lỗi `POST /orders` > 5%. Bình nhận alert.
> - 22:44 Log đầy `ActiveRecord::ConnectionTimeoutError`.
> - 22:47 Giả thuyết: pool nhỏ. Tăng `pool` 5 → 20 và deploy.
> - 22:55 Lỗi giảm vài phút sau khi restart pod, rồi quay lại như cũ.
> - 23:06 `pg_stat_activity` cho thấy 40 connection ở trạng thái `idle in transaction`, mỗi cái giữ 6–8 giây.
> - 23:10 Tìm thấy lời gọi API vận chuyển nằm trong `Order.transaction`, không đặt timeout.
> - 23:14 Bật flag `shipping_fee_realtime = false`.
> - 23:16 Tỉ lệ lỗi về 0. Kết thúc sự cố.
> - 23:40 Revert thay đổi `pool` về 5.
>
> **Nguyên nhân.**
> - Lời gọi API tính phí ship được thêm vào bên trong transaction tạo đơn hàng (PR #1482, merge 13/11).
> - `Net::HTTP` không đặt timeout nên dùng mặc định 60 giây.
> - Đối tác chậm lên khoảng 8 giây, không rõ lý do (đã hỏi đối tác, chưa có phản hồi).
>
> Cơ chế: 60 request/giây × 8 giây giữ connection = cần khoảng 480 connection cùng lúc, hệ thống chỉ có 40 (8 process × pool 5). Pool cạn, các thread chờ hết `checkout_timeout` 5 giây rồi báo lỗi. Tăng pool không có tác dụng vì mỗi process chỉ có 5 thread, mỗi thread dùng tối đa một connection.
>
> **Phát hiện.** Alert tỉ lệ lỗi báo sau khoảng 3 phút. Không có alert nào cho độ trễ gọi ra đối tác, nên mất 25 phút mới tìm ra hướng đúng.
>
> **Làm tốt.** Alert tỉ lệ lỗi hoạt động. Feature flag tắt tính phí realtime đã có sẵn, nên khi tìm ra nguyên nhân thì khôi phục được trong 2 phút.
>
> **Chưa tốt.** Giả thuyết đầu tiên (pool nhỏ) được áp vào production mà chưa kiểm chứng. Không có dashboard cho thời gian giữ connection. Lúc review PR #1482 không ai để ý lời gọi HTTP nằm trong transaction.
>
> **Gặp may.** Sự cố xảy ra lúc 22h, traffic chỉ bằng khoảng một nửa giờ cao điểm buổi trưa. Nếu đối tác chậm vào giờ trưa thì sẽ cần khoảng gấp đôi số connection, và lỗi sẽ lan sang mọi endpoint khác dùng chung database.
>
> **Hành động khắc phục.**
>
> | Việc | Loại | Người phụ trách | Hạn |
> |---|---|---|---|
> | Đưa lời gọi API vận chuyển ra khỏi transaction | Ngăn chặn | Bình | 22/11 |
> | Timeout 2s + circuit breaker cho mọi lời gọi ra ngoài | Ngăn chặn | Bình | 29/11 |
> | Rule lint cảnh báo HTTP call trong `transaction do` | Ngăn chặn | Châu | 4/12 |
> | Alert khi p95 gọi đối tác > 1s | Phát hiện | An | 27/11 |
> | Dashboard thời gian giữ connection và số connection `idle in transaction` | Phát hiện | An | 4/12 |
> | Ghi flag `shipping_fee_realtime` vào runbook xử lý sự cố | Giảm thiểu | An | 24/11 |

Để ý vài điểm trong ví dụ trên. Bình là người nhận alert và cũng là người đề xuất tăng pool, nhưng postmortem không nói "Bình xử lý sai". Nó nói "giả thuyết đầu tiên được áp vào production mà chưa kiểm chứng" và "không có dashboard cho thời gian giữ connection", vì đó là những thứ sửa được. Những chỗ chưa biết ("số đơn hàng mất thực tế", "lý do đối tác chậm") được ghi thẳng là chưa biết, không đoán cho đủ. Và mục "gặp may" chỉ ra một rủi ro lớn hơn chính sự cố này, thứ mà nếu không viết ra thì sẽ không ai nghĩ tới.

### Ngay cả khi chỉ có một mình

Nếu bạn làm một mình, hoặc team không có văn hoá postmortem, vẫn nên viết, dù chỉ nửa trang trong một file markdown riêng. Bạn sẽ ngạc nhiên vì mình quên nhanh tới mức nào. Sáu tháng sau, khi một lỗi trông quen quen quay lại, ghi chép đó sẽ cứu bạn hàng giờ.

Sau một năm, tập postmortem đó sẽ là tài liệu giá trị nhất về hệ thống của bạn, giá trị hơn mọi sơ đồ kiến trúc, vì nó ghi lại hệ thống **thật sự** hành xử thế nào, chứ không phải hành xử thế nào trên giấy.
