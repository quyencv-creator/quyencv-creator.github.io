---
title: "On-call là gì: trực sự cố, làm gì khi bị gọi lúc 3 giờ sáng, và làm sao để không kiệt sức"
description: On-call là việc luân phiên chịu trách nhiệm cho hệ thống ngoài giờ làm việc. Bài viết giải thích cách tổ chức một lịch on-call, phải làm gì khi nhận alert, alert thế nào là tốt, và những dấu hiệu cho thấy on-call của team đang có vấn đề.
pubDate: 2026-09-23
tags: [devops, backend, career]
---

Ở nhiều công ty Việt Nam, on-call không có tên gọi. Nó là chuyện điện thoại rung lúc 11 giờ đêm, một tin nhắn trong nhóm Zalo: "Anh ơi web không vào được." Ai biết hệ thống nhất thì người đó xử lý. Tuần nào có sự cố thì người đó mất ngủ cả tuần. Không có lịch, không có quy trình, không có phụ cấp, và thường cũng không có lời cảm ơn.

On-call được tổ chức tử tế thì khác. Nó vẫn mệt, nhưng mệt có giới hạn, có người chia sẻ, và mỗi lần bị gọi dậy thì hệ thống tốt lên một chút.

## On-call là gì?

On-call là việc **một người được chỉ định chịu trách nhiệm phản hồi sự cố của hệ thống trong một khoảng thời gian**, kể cả ngoài giờ làm việc. Trong ca trực, người đó phải nhận được cảnh báo, phản hồi trong một thời gian đã thống nhất, và có đủ quyền cũng như công cụ để xử lý.

Điểm mấu chốt nằm ở hai chữ "được chỉ định". On-call không phải là "ai rảnh thì xử lý", cũng không phải "người giỏi nhất luôn luôn xử lý". Nó là một lịch luân phiên, ai cũng biết tuần này ai trực, và những người không trực thì được yên.

## Một lịch on-call thường gồm những gì?

**Luân phiên (rotation).** Các thành viên lần lượt trực, phổ biến nhất là theo tuần. Team càng đông thì mỗi người càng ít phải trực. Team chỉ có hai người thì mỗi người trực một nửa thời gian của đời mình, và đó là công thức để kiệt sức.

**Primary và secondary.** Primary nhận alert đầu tiên. Nếu primary không phản hồi sau một khoảng thời gian (ví dụ 10 phút), alert tự chuyển sang secondary. Như vậy không có sự cố nào bị bỏ sót chỉ vì một người đang tắm hoặc điện thoại hết pin.

**Escalation.** Có những thứ người trực không tự xử lý được: cần quyền truy cập đặc biệt, cần chuyên gia database, cần quyết định kinh doanh (ví dụ tắt tính năng thanh toán). Lịch on-call phải ghi rõ trong từng trường hợp thì gọi ai, và người được gọi phải chấp nhận việc bị gọi.

**Bàn giao (handoff).** Cuối ca, người trực ghi lại cho người tiếp theo: có sự cố nào, cái gì còn đang theo dõi, alert nào đang kêu bất thường. Năm phút bàn giao tiết kiệm được rất nhiều lần phải tìm hiểu lại từ đầu.

**Công cụ.** Cần một hệ thống gửi alert tới đúng người trực theo lịch, gọi điện hoặc đẩy thông báo cho tới khi có người xác nhận, và tự escalate khi không ai trả lời. PagerDuty là cái tên phổ biến nhất; nhiều nền tảng monitoring cũng có tính năng on-call riêng. Tin nhắn vào nhóm chat không phải là công cụ on-call: nó không đánh thức ai, không escalate, và chìm mất giữa các tin nhắn khác.

## Khi bị gọi: làm gì, theo thứ tự nào?

Điện thoại kêu lúc 3 giờ sáng. Não chưa tỉnh hẳn. Đây là lúc dễ làm sai nhất, nên cần một thứ tự cố định để làm theo mà không phải nghĩ.

**1. Xác nhận (acknowledge).** Bấm xác nhận trên công cụ on-call để hệ thống biết đã có người nhận, không gọi tiếp người khác. Việc này nên làm trong vài phút, kể cả khi chưa biết chuyện gì xảy ra.

**2. Đánh giá ảnh hưởng.** Người dùng có đang bị ảnh hưởng không? Bao nhiêu người? Tính năng nào? Câu trả lời quyết định mức độ khẩn cấp. Một alert về ổ đĩa còn 15% dung lượng có thể đợi tới sáng. Trang thanh toán trả lỗi 500 thì không.

**3. Cầm máu trước, tìm nguyên nhân sau.** Mục tiêu đầu tiên là khôi phục dịch vụ, không phải hiểu tại sao nó hỏng. Rollback bản deploy gần nhất, tắt tính năng bằng feature flag, thêm tài nguyên, chuyển tải sang chỗ khác. Hiểu sâu nguyên nhân là việc của ban ngày, khi đã tỉnh táo. Mình viết kỹ hơn về phần này trong bài [debug hệ thống thật](/blog/debug-he-thong-that-thoi-ai/).

**4. Gọi người khi cần, đừng ngại.** Đây là chỗ người mới hay sai nhất: cố tự xử lý một mình vì ngại đánh thức người khác. Nếu sau 15–20 phút bạn chưa có hướng, hoặc sự cố ảnh hưởng lớn, hãy escalate. Đánh thức một người để sự cố kết thúc sau 20 phút tốt hơn nhiều so với để nó kéo dài ba tiếng.

**5. Thông báo.** Cho những người cần biết rằng có sự cố và đang được xử lý: team, bộ phận chăm sóc khách hàng, trang status nếu có. Cập nhật định kỳ, kể cả khi chưa có gì mới ("vẫn đang điều tra, cập nhật tiếp sau 30 phút"). Im lặng khiến người khác lo lắng và bắt đầu gọi bạn để hỏi, đúng lúc bạn cần tập trung nhất.

**6. Ghi chép.** Ghi lại mọi thứ kèm giờ: thấy gì, nghi gì, làm gì, kết quả ra sao. Ghi chép này là nguyên liệu cho [postmortem](/blog/postmortem-la-gi/) sau đó, và nó gần như không thể dựng lại chính xác nếu không ghi ngay.

## Alert thế nào là tốt?

On-call tệ thường không phải do có quá nhiều sự cố, mà do có quá nhiều **alert vô nghĩa**. Mỗi đêm bị đánh thức ba lần vì những thứ không cần làm gì, chỉ sau vài tuần bạn sẽ bắt đầu tắt tiếng điện thoại, và đúng đêm có sự cố thật thì không ai dậy.

Vài nguyên tắc:

**Alert nào đánh thức người phải cần hành động ngay.** Nếu alert kêu mà câu trả lời đúng là "để sáng mai xem", thì nó không nên gọi điện lúc 3 giờ sáng. Chuyển nó thành ticket hoặc thông báo trong giờ làm việc.

**Alert theo triệu chứng người dùng thấy, không theo nguyên nhân.** "Tỉ lệ lỗi của API đặt hàng trên 2% trong 5 phút" là alert tốt, vì nó nói trực tiếp rằng người dùng đang bị ảnh hưởng. "CPU server trên 80%" thường là alert tệ: CPU cao có thể chẳng ảnh hưởng ai, còn hệ thống có thể sập mà CPU vẫn thấp. Các chỉ số nguyên nhân như CPU, bộ nhớ, độ dài hàng đợi vẫn hữu ích, nhưng là để xem trên dashboard khi điều tra, không phải để đánh thức người. Phần này liên quan tới việc hệ thống của bạn có [những metric nào](/blog/observability-go-vs-rails/).

**Mỗi alert có một runbook.** Runbook là tài liệu ngắn trả lời: alert này nghĩa là gì, kiểm tra gì đầu tiên, các cách xử lý thường gặp, khi nào thì escalate và gọi ai. Người trực lúc 3 giờ sáng không nên phải tự suy luận từ đầu. Viết runbook ban ngày, khi đầu óc còn tỉnh táo, cho chính mình lúc nửa đêm.

**Xem lại alert định kỳ.** Mỗi tuần hoặc mỗi tháng, nhìn lại: alert nào kêu nhiều nhất, bao nhiêu lần trong số đó thật sự cần làm gì. Alert kêu mà không ai cần làm gì thì sửa ngưỡng hoặc xoá. Alert bỏ lỡ một sự cố thật thì thêm.

## Bao nhiêu là quá nhiều?

Chương "Being On-Call" trong cuốn *Site Reliability Engineering* của Google đưa ra một mức tham khảo: tối đa khoảng hai sự cố cho mỗi ca trực 12 tiếng. Lý do là mỗi sự cố, tính cả xử lý, tìm nguyên nhân, viết postmortem và làm hành động khắc phục, tốn khá nhiều giờ. Nhiều hơn mức đó thì người trực chỉ kịp chữa cháy, không còn thời gian sửa tận gốc, và số sự cố sẽ không bao giờ giảm.

Con số cụ thể của Google không nhất thiết đúng với team bạn. Nhưng nguyên tắc đằng sau nó thì đúng ở mọi nơi: **on-call phải có giới hạn tải**, và khi vượt giới hạn thì đó là tín hiệu để dừng làm tính năng mới mà tập trung vào độ ổn định.

## Dấu hiệu on-call của team đang có vấn đề

- Chỉ một hai người "biết hệ thống" nên lúc nào cũng bị gọi, dù không ai xếp lịch cho họ.
- Người trực thường xuyên bị gọi nhiều lần trong một đêm.
- Phần lớn alert được xác nhận rồi bỏ qua mà không làm gì.
- Cùng một loại sự cố lặp lại hết tháng này sang tháng khác.
- Người mới không được đưa vào lịch trực vì "chưa đủ hiểu hệ thống", và cũng không có kế hoạch nào để họ hiểu.
- Không ai được nghỉ bù sau một đêm thức trắng xử lý sự cố.
- Mọi người bắt đầu sợ tuần mình trực.

Nếu thấy từ ba dấu hiệu trở lên, vấn đề không nằm ở người trực. Nó nằm ở cách team tổ chức on-call, và ở chất lượng của chính hệ thống.

## On-call công bằng

On-call là công việc thật, lấy đi thời gian và sức khoẻ thật. Ngay cả khi tuần trực trôi qua yên ổn, người trực vẫn không thể đi xa, không thể uống bia, phải mang theo laptop. Một lịch on-call tử tế cần:

**Có đền bù**: phụ cấp trực, hoặc tính giờ làm thêm khi phải xử lý sự cố, theo chính sách của công ty và quy định lao động.

**Có nghỉ bù**: thức tới 4 giờ sáng xử lý sự cố thì sáng hôm sau không phải vào làm đúng giờ.

**Chia đều**: mọi người trong team đều tham gia, kể cả senior và tech lead. Khi người viết code cũng là người bị gọi dậy vì code đó, chất lượng code thay đổi rất nhanh.

**Đào tạo trước khi trực**: người mới nên trực cùng (shadow) một người có kinh nghiệm vài ca trước khi tự trực chính.

## Nếu bạn sắp trực lần đầu

Trước ca trực đầu tiên, hãy chắc chắn bạn trả lời được những câu sau:

- Mình có quyền truy cập vào mọi thứ cần thiết chưa: server, database, dashboard, công cụ deploy, VPN? Thử đăng nhập từng cái **trước** khi bị gọi, không phải trong lúc bị gọi.
- Alert sẽ đến với mình bằng cách nào, và mình đã thử nhận một alert test chưa?
- Rollback một bản deploy làm thế nào?
- Runbook ở đâu?
- Khi cần escalate thì gọi ai, số điện thoại là gì?

Và nhớ rằng: không ai mong người trực lần đầu xử lý mọi thứ một mình. Biết khi nào cần gọi người khác là một kỹ năng, không phải là thất bại.

## Kết

On-call là nơi bạn gặp hệ thống của mình ở trạng thái thật nhất: không phải sơ đồ kiến trúc, không phải tài liệu, mà là thứ đang chạy lúc 3 giờ sáng với dữ liệu thật và người dùng thật. Nó mệt, nhưng cũng là nơi bạn học về hệ thống nhanh nhất.

Một team tổ chức on-call tốt sẽ dùng mỗi lần bị gọi dậy như một khoản đầu tư: alert tốt hơn, runbook đầy đủ hơn, hệ thống ổn định hơn, để lần sau ít bị gọi hơn. Một team tổ chức on-call tệ sẽ bị gọi dậy mãi vì cùng những lý do cũ, cho tới khi người giỏi nhất nghỉ việc.

---

**Đọc thêm:** series [Tự dựng dịch vụ status page](/blog/status-page-1-vi-sao-can/), về cách giao tiếp với khách hàng khi có sự cố và tự dựng một MVP giám sát bằng Go.
