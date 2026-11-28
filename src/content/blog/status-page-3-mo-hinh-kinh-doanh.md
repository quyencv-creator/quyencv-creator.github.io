---
title: "Status page (3/3): biến công cụ monitor thành dịch vụ"
description: "Phần cuối của series tự dựng dịch vụ status page. Thị trường đã đông, bản miễn phí đã hào phóng, vậy có nên bán? Mô hình freemium theo mức dùng, ngách Việt Nam (tiếng Việt, thanh toán nội địa, Zalo, probe trong nước, hoá đơn VAT) lớn hay nhỏ, bán kèm dịch vụ tư vấn, bán cho đơn vị outsource, và những rủi ro khi thứ mình bán là độ tin cậy."
pubDate: 2026-11-28
tags: [thinking, career, devops]
---

> **Series "Tự dựng dịch vụ status page":** [Phần 1: Vì sao cần trang status](/blog/status-page-1-vi-sao-can/) · [Phần 2: Dựng MVP bằng Go](/blog/status-page-2-mvp-go/) · **Phần 3: Biến công cụ monitor thành dịch vụ**

Sau [phần 1](/blog/status-page-1-vi-sao-can/) (vì sao cần trang status) và [phần 2](/blog/status-page-2-mvp-go/) (tự dựng dịch vụ), bạn có trong tay một công cụ chạy được: giám sát vài endpoint, có trang status, có cập nhật sự cố, có thông báo cho người đăng ký. Câu hỏi tự nhiên tiếp theo: có bán được không?

Bài này trả lời thẳng câu hỏi đó. Không phải để khuyên bạn bỏ việc khởi nghiệp, mà để nhìn rõ thị trường, những chỗ có thể có cơ hội, và những rủi ro mà người làm kỹ thuật hay đánh giá thấp.

Mọi con số về giá trong bài đều có nguồn ở cuối. Giá của các dịch vụ này thay đổi thường xuyên, và nhiều nguồn mâu thuẫn nhau, nên hãy kiểm tra trang giá chính thức trước khi dựa vào bất kỳ con số nào.

## Thị trường đã rất đông

Nói thẳng trước: đây không phải thị trường trống. Một số cái tên đáng chú ý:

- **Atlassian Statuspage**: cái tên lâu đời và phổ biến nhất cho trang status dạng SaaS, mạnh về quy trình cập nhật sự cố và người đăng ký. Theo Capterra và hướng dẫn mua trên cộng đồng Atlassian, các gói trang công khai bắt đầu từ khoảng 29 USD/tháng (gói Hobby) và lên tới khoảng 1.499 USD/tháng cho gói lớn. Các nguồn không thống nhất về việc có gói miễn phí hay không.
- **Better Stack**: kết hợp giám sát uptime, trang status, log và nhiều thứ khác. Theo trang giá chính thức, gói miễn phí cho dự án cá nhân có 10 monitor, 10 heartbeat và một trang status, kiểm tra mỗi 3 phút. Thêm monitor và thêm trang status thì trả phí theo add-on.
- **UptimeRobot**: nổi tiếng với gói miễn phí hào phóng. Trang giá chính thức ghi gói miễn phí có 50 monitor, kiểm tra mỗi 5 phút, kèm một trang status. Các gói trả phí có chu kỳ kiểm tra ngắn hơn, nhưng tên gói và giá cụ thể trong các nguồn mình tìm được không thống nhất.
- **Instatus**: tập trung vào trang status đẹp và nhanh. Theo các bài so sánh (phần lớn do đối thủ viết, nên có thể thiên lệch), gói miễn phí có trang status công khai, khoảng 15 monitor, 200 người đăng ký và không có tên miền riêng; tên miền riêng nằm ở gói Pro. [cần dẫn nguồn chính thức]
- **Upptime**: mã nguồn mở, miễn phí, chạy hoàn toàn trên GitHub Actions và GitHub Pages.
- **Uptime Kuma**: mã nguồn mở, tự host, miễn phí, một container Docker là chạy.

Nhìn danh sách này, có hai điều rõ ràng. Một, **phần cơ bản đã gần như miễn phí**: 10 đến 50 monitor, một trang status, kiểm tra vài phút một lần, ai cũng cho không. Hai, **khách hàng lớn đã có lựa chọn quen thuộc** với thương hiệu mạnh, tích hợp sẵn với hệ sinh thái họ đang dùng.

Nếu sản phẩm của bạn chỉ là "một UptimeRobot nữa", bạn đang cạnh tranh với bản miễn phí của những công ty có hàng chục năm vận hành. Đó là cuộc chơi khó thắng.

## Freemium theo mức dùng: cho không cái gì, thu tiền cái gì?

Gần như mọi đối thủ đều dùng freemium. Lý do đơn giản: chi phí phục vụ một khách nhỏ rất thấp, và khách nhỏ hôm nay có thể là khách lớn ngày mai. Nhìn vào cách họ chia gói, có thể thấy một khuôn mẫu khá nhất quán:

| Trục | Miễn phí | Trả phí | Vì sao |
|---|---|---|---|
| Số monitor | Vài chục | Hàng trăm trở lên | Chi phí tăng gần như tuyến tính theo số monitor |
| Chu kỳ kiểm tra | Vài phút | 30 giây đến 1 phút | Kiểm tra dày hơn tốn tài nguyên hơn, và khách trả tiền vì muốn biết sớm hơn |
| Người đăng ký nhận thông báo | Vài trăm | Hàng nghìn | Gửi email, SMS tốn tiền thật |
| Tên miền riêng | Không | Có | Đây là ranh giới giữa "dùng thử" và "dùng thật cho khách hàng" |
| Bỏ dòng "Powered by" | Không | Có | Bản miễn phí là kênh marketing của nhà cung cấp |
| Thành viên team, phân quyền | 1 đến 2 người | Nhiều người | Doanh nghiệp cần, cá nhân không cần |
| Trang status riêng tư (nội bộ) | Không | Có | Nhu cầu của doanh nghiệp lớn |

Nguyên tắc chung: **cho miễn phí những gì một cá nhân cần để thấy giá trị, thu tiền khi khách bắt đầu dùng nó cho việc kinh doanh**. Tên miền riêng và bỏ branding là hai tín hiệu rõ nhất: không ai cần chúng cho dự án cá nhân, nhưng gần như mọi doanh nghiệp đều cần.

Một điều cần cân nhắc: bản miễn phí không miễn phí với bạn. Mỗi monitor miễn phí vẫn tốn tài nguyên, mỗi người dùng miễn phí vẫn có thể gửi email hỏi hỗ trợ. Với một sản phẩm nhỏ, bản miễn phí quá hào phóng có thể ngốn hết thời gian và tiền mà chưa ai trả.

## Ngách Việt Nam: có thật, nhưng nhỏ hơn bạn nghĩ

Lợi thế duy nhất mà một sản phẩm làm trong nước có so với các đối thủ quốc tế là **hiểu thị trường trong nước**. Cụ thể:

**Giao diện và nội dung tiếng Việt.** Trang status cho khách hàng Việt nên bằng tiếng Việt. Một số đối thủ có hỗ trợ đa ngôn ngữ, nhưng trải nghiệm quản trị và mẫu nội dung thường vẫn thiết kế cho tiếng Anh.

**Thanh toán nội địa.** Nhiều doanh nghiệp nhỏ ở Việt Nam không có thẻ thanh toán quốc tế, hoặc thủ tục để thanh toán dịch vụ nước ngoài bằng ngoại tệ là một rào cản. Thanh toán qua chuyển khoản, ví điện tử, cổng thanh toán nội địa giải quyết được việc này.

**Hoá đơn VAT.** Doanh nghiệp Việt Nam cần hoá đơn hợp lệ để hạch toán chi phí. Mua dịch vụ nước ngoài thường đi kèm thủ tục khai thuế riêng. Một nhà cung cấp trong nước xuất được hoá đơn điện tử theo quy định là một lý do thật để chọn.

**Thông báo qua Zalo.** Ở Việt Nam, rất nhiều người đọc Zalo nhanh hơn đọc email. Nhưng tích hợp Zalo không đơn giản như tích hợp Slack:

- Muốn gửi tin thông báo qua Zalo Notification Service (ZNS), cần có Zalo Official Account (OA) **đã được xác thực**. Theo các tài liệu hướng dẫn mình tìm được, OA chủ yếu dành cho doanh nghiệp, hộ kinh doanh khó được duyệt hơn, và việc xác thực cần hoàn tất trong một khoảng thời gian sau khi tạo.
- Mỗi mẫu tin phải được **đăng ký và duyệt trước** (template). Bạn không thể gửi nội dung tuỳ ý.
- Gửi tin **có phí theo từng tin**. Các nguồn mình tìm được đưa ra mức phí khác nhau và không rõ thời điểm áp dụng. [cần dẫn nguồn chính thức từ Zalo]
- Có hạn mức số tin mỗi ngày cho OA mới, theo một số nguồn bên thứ ba. [cần dẫn nguồn chính thức]

Nghĩa là: tính năng "thông báo Zalo" kéo theo chi phí theo tin nhắn, quy trình duyệt mẫu, và phụ thuộc vào chính sách của Zalo, thứ có thể thay đổi bất cứ lúc nào. Đây là tính năng nên nằm ở gói trả phí, và nên tính giá sao cho bù được phí tin nhắn.

**Probe đặt trong nước.** Các dịch vụ quốc tế thường kiểm tra từ các máy chủ ở nước ngoài. Với một hệ thống chỉ phục vụ người dùng Việt Nam, kết quả kiểm tra từ nước ngoài có thể khác với trải nghiệm thật của người dùng trong nước, đặc biệt khi đường truyền quốc tế gặp vấn đề. Có probe đặt tại các nhà mạng trong nước giúp phân biệt "hệ thống của bạn lỗi" với "đường truyền quốc tế có vấn đề". Đây là lợi thế kỹ thuật thật, nhưng nó cũng là chi phí thật: máy chủ ở nhiều nhà mạng, nhiều vị trí.

### Ngách này lớn hay nhỏ?

Đánh giá thẳng: **nhỏ**. Lý do:

- Phần lớn doanh nghiệp vừa và nhỏ ở Việt Nam **chưa có thói quen làm trang status**. Họ còn chưa có monitoring tử tế. Bạn không chỉ bán sản phẩm, mà phải bán cả ý tưởng rằng họ cần nó, và đó là việc rất tốn công.
- Doanh nghiệp đủ lớn để thật sự cần trang status (ngân hàng, ví điện tử, sàn thương mại điện tử, SaaS) thường **có đội kỹ thuật tự làm**, hoặc đã dùng dịch vụ quốc tế, hoặc có yêu cầu bảo mật khiến họ ngại dùng nhà cung cấp nhỏ.
- Mức sẵn sàng chi trả cho một công cụ "phụ" như trang status ở doanh nghiệp nhỏ thường thấp.

Ngách này có thể đủ để nuôi một sản phẩm nhỏ do một hai người vận hành, như một nguồn thu phụ. Nó khó có thể là một doanh nghiệp lớn nếu chỉ bán phần mềm. Mình không có số liệu về quy mô thị trường để khẳng định chắc chắn. [cần dẫn nguồn]

## Bán kèm dịch vụ: sản phẩm là cửa vào

Có một cách nhìn khác, thực tế hơn với một người làm kỹ thuật: đừng coi công cụ là sản phẩm chính, mà coi nó là **cửa vào** cho dịch vụ.

Một doanh nghiệp cài trang status của bạn sẽ sớm gặp những câu hỏi khó hơn: giám sát những gì, alert thế nào cho khỏi báo động giả, ai trực sự cố, viết cập nhật thế nào, làm [postmortem](/blog/postmortem-la-gi/) ra sao, thiết lập [on-call](/blog/on-call-la-gi/) công bằng thế nào. Đó là những câu hỏi mà họ sẵn sàng trả tiền để có người giúp, và đó cũng chính là kỹ năng mà bạn đã có khi tự dựng được công cụ này.

Mô hình có thể là:

- **Sản phẩm**: rẻ hoặc miễn phí, đủ tốt để doanh nghiệp tin bạn hiểu việc.
- **Dịch vụ**: tư vấn thiết lập monitoring và alert, viết runbook, đào tạo team về quy trình xử lý sự cố, review postmortem.

Biên lợi nhuận của dịch vụ thường cao hơn nhiều so với phần mềm ở quy mô nhỏ, và nó không đòi hỏi bạn có hàng nghìn khách hàng. Đây cũng là hướng tự nhiên để nối với những gì blog này đang làm: các [dịch vụ](/services/) tư vấn và mentoring có thể mở rộng sang hỗ trợ doanh nghiệp thiết lập vận hành hệ thống.

Đánh đổi: dịch vụ không mở rộng được như phần mềm. Thu nhập tỉ lệ với số giờ bạn làm. Nhưng với một người hoặc một team nhỏ, đó thường là điểm khởi đầu thực tế hơn.

## Bán cho đơn vị outsource

Có một nhóm khách hàng cụ thể và có nhu cầu rõ ràng hơn: **các công ty outsource và agency** đang vận hành hệ thống cho khách hàng.

Như mình đã viết trong bài [thuê ngoài làm sản phẩm bền vững](/blog/thue-ngoai-lam-san-pham-ben-vung/), khách hàng thông minh sẽ yêu cầu cam kết chất lượng đo được (SLA) và báo cáo định kỳ. Một đơn vị outsource cần:

- **Trang status riêng cho từng khách hàng**, mang thương hiệu của khách hoặc của chính họ.
- **Báo cáo SLA hằng tháng** tự động: thời gian hoạt động, số sự cố, thời gian khắc phục, để gửi cho khách mà không phải làm tay.
- **Một bảng điều khiển chung** để quản lý nhiều khách hàng cùng lúc.

Đây là nhu cầu có thật, có người trả tiền (vì báo cáo SLA giúp họ giữ hợp đồng), và các công cụ phổ thông không thiết kế riêng cho nó. Một sản phẩm tập trung vào "báo cáo SLA cho agency" có câu chuyện bán hàng rõ ràng hơn nhiều so với "trang status cho mọi người".

Một lưu ý pháp lý: nếu bạn định xây sản phẩm dựa trên API của một dịch vụ khác rồi bán lại, hãy đọc kỹ điều khoản của họ. Theo một hướng dẫn của DreamHost, điều khoản của UptimeRobot cho phép dùng cho mục đích kinh doanh nhưng cấm bán lại trang status hoặc cảnh báo của họ như một dịch vụ giám sát. Hãy kiểm tra trực tiếp điều khoản hiện hành trước khi làm.

## Rủi ro: thứ bạn bán là độ tin cậy

Đây là phần mà người làm kỹ thuật hay đánh giá thấp nhất.

**Sập hay báo sai là mất uy tín ngay lập tức.** Một ứng dụng ghi chú sập một giờ thì người dùng khó chịu. Một dịch vụ giám sát sập một giờ thì khách hàng của bạn mù trong một giờ, và nếu hệ thống của họ cũng sập đúng lúc đó, họ sẽ không bao giờ tin bạn nữa. Tệ không kém là báo sai: báo "hệ thống sập" lúc 3 giờ sáng khi mọi thứ vẫn chạy, hoặc trang status hiện đỏ trước mặt khách hàng của khách hàng. Bạn đang bán độ tin cậy, nên bạn phải đáng tin hơn chính khách hàng của mình.

**Chi phí hạ tầng nhiều vùng.** Như [phần 1](/blog/status-page-1-vi-sao-can/) đã nói, trang status phải chạy tách biệt với hệ thống nó giám sát. Với một dịch vụ bán cho người khác, điều đó có nghĩa là: probe ở nhiều nơi để tránh báo sai do một điểm mạng có vấn đề, trang công khai phải sống khi có lượng truy cập tăng đột biến, dữ liệu phải có bản sao ở nơi khác. Chi phí này phải trả từ ngày đầu, trước khi có khách hàng đầu tiên.

**Hỗ trợ lúc nửa đêm.** Sự cố không chọn giờ hành chính. Khách hàng của dịch vụ giám sát sẽ liên hệ bạn đúng lúc hệ thống của họ có vấn đề, thường là ngoài giờ. Nếu bạn làm một mình, bạn đang ký vào một ca trực không bao giờ kết thúc. Hãy tự hỏi thật lòng: bạn có muốn điện thoại kêu lúc 2 giờ sáng vì khách hỏi tại sao alert không đến?

**Cạnh tranh giá với bản miễn phí.** Mỗi khi bạn đặt giá, khách hàng sẽ so với gói miễn phí của UptimeRobot, Better Stack, và với việc tự cài Uptime Kuma. Lý do để trả tiền cho bạn phải rõ ràng và cụ thể: hoá đơn VAT, hỗ trợ tiếng Việt, Zalo, probe trong nước, báo cáo SLA. Nếu không nói được lý do đó trong một câu, bạn đang bán thứ mà người ta có thể lấy miễn phí.

**Phụ thuộc vào nền tảng của người khác.** Gửi thông báo qua Zalo, SMS, email đều phụ thuộc vào chính sách và giá của bên thứ ba. Một thay đổi chính sách có thể làm tính năng chính của bạn ngừng hoạt động hoặc tăng chi phí đột ngột.

## Một lộ trình nhỏ, không đốt tiền

Nếu sau tất cả những điều trên bạn vẫn muốn thử, đây là cách mình nghĩ ít rủi ro nhất:

**Bước 1: Dùng nội bộ.** Dùng chính công cụ của bạn cho các hệ thống bạn đang vận hành, ở công ty hoặc dự án cá nhân, trong vài tháng. Mỗi lần nó báo sai, mỗi lần nó bỏ lỡ một sự cố, là một bài học miễn phí. Nếu bạn không tin nó đủ để dùng cho hệ thống của chính mình, đừng bán cho ai.

**Bước 2: Vài khách quen.** Đưa cho ba đến năm doanh nghiệp quen biết dùng miễn phí hoặc giá tượng trưng, đổi lại họ góp ý thẳng thắn. Quan sát họ dùng tính năng nào, hỏi gì, phàn nàn gì. Đây là lúc tìm ra lý do thật để người ta trả tiền, thứ thường khác với lý do bạn tưởng.

**Bước 3: Thu phí.** Chỉ khi có ít nhất vài khách nói "tôi sẵn sàng trả tiền cho cái này", mới đặt giá chính thức. Bắt đầu với một gói đơn giản, dễ hiểu. Có thể kèm dịch vụ thiết lập ban đầu có trả phí.

Ở mỗi bước, hãy giữ công việc chính. Đây là thứ để thử nghiệm bên lề, không phải để đặt cược cả sự nghiệp. Mình đã viết về cách thử nghiệm nhỏ trước khi nhảy hẳn trong bài [bi quan về nghề IT](/blog/bi-quan-ve-nghe-it/).

## Kết

Biến một công cụ monitor thành sản phẩm để bán là có thể, nhưng không dễ, và hầu như chắc chắn không làm giàu nhanh. Thị trường đã đông, phần cơ bản đã miễn phí, và thứ bạn bán (độ tin cậy) là thứ khó xây và dễ mất nhất.

Giá trị lớn nhất của việc tự dựng một dịch vụ status page, theo mình, không nằm ở chỗ bán nó. Nó nằm ở chỗ bạn hiểu sâu cách giám sát, cách xử lý sự cố, cách giao tiếp khi có sự cố, và cách giữ một hệ thống đáng tin cậy. Những hiểu biết đó dùng được ở mọi công việc, và nếu muốn kiếm tiền từ chúng, con đường thực tế nhất thường là dịch vụ, với công cụ chỉ là thứ chứng minh bạn biết mình đang nói gì.

## Nguồn

- Atlassian Statuspage: [trang giá chính thức](https://www.atlassian.com/software/statuspage/pricing), [Statuspage Buyer's Guide (Atlassian Community)](https://community.atlassian.com/t5/Statuspage-articles/Statuspage-Buyer-s-Guide/ba-p/1047902), [Statuspage Pricing (Capterra)](https://www.capterra.com/p/177360/Statuspage/pricing/), [eesel.ai: Jira Service Management status pages](https://www.eesel.ai/blog/jira-service-management-status-pages)
- Better Stack: [trang giá chính thức](https://betterstack.com/pricing), [Uptime monitoring](https://betterstack.com/better-uptime/monitoring)
- UptimeRobot: [trang giá chính thức](https://uptimerobot.com/pricing.md), [DreamHost: uptime monitor bill (điều khoản sử dụng)](https://www.dreamhost.com/guides/uptime-kuma/uptime-monitor-bill/)
- Instatus (nguồn bên thứ ba, có thể thiên lệch): [Hyperping: Instatus pricing](https://hyperping.com/blog/instatus-pricing), [OneUptime: compare Instatus](https://oneuptime.com/compare/instatus), [Product Compass: Free status page on your own domain](https://www.productcompass.pm/p/free-status-page)
- So sánh công cụ mã nguồn mở: [Better Stack: Free & open source status page tools](https://betterstack.com/community/comparisons/open-source-status-page-tools/)
- Zalo ZNS (nguồn bên thứ ba, cần đối chiếu với Zalo): [FPT Shop: Zalo ZNS là gì](https://fptshop.com.vn/tin-tuc/thu-thuat/zalo-zns-la-gi-174686), [EGANY: giải pháp Zalo Business](https://egany.com/ecommerce-cro/recap-ega-cafe-8-giai-phap-zalo-business-cho-doanh-nghiep), [Sapo: cách tạo Zalo OA](https://www.sapo.vn/blog/cach-tao-zalo-oa), [Infobip: Zalo message templates](https://www.infobip.com/docs/zalo/message-templates)
