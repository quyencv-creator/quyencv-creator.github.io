---
title: "Status page (1/3): vì sao cần trang status"
description: "Phần 1 của series tự dựng dịch vụ status page. Khi hệ thống sập, việc báo cho khách biết chuyện gì đang xảy ra quan trọng gần ngang việc sửa lỗi. Trang status giải quyết gì, cách viết cập nhật sự cố cho tốt, Atlassian Statuspage, Upptime, Uptime Kuma làm gì, và vì sao trang status phải chạy tách khỏi hệ thống nó báo cáo."
pubDate: 2026-11-28
tags: [devops, backend]
---

> **Series "Tự dựng dịch vụ status page":** **Phần 1: Vì sao cần trang status** · [Phần 2: Dựng MVP bằng Go](/blog/status-page-2-mvp-go/) · [Phần 3: Biến công cụ monitor thành dịch vụ](/blog/status-page-3-mo-hinh-kinh-doanh/)

Mười giờ sáng thứ Hai, API thanh toán bắt đầu trả lỗi. Team on-call nhận alert và bắt tay điều tra.

Năm phút sau, hotline bắt đầu đổ chuông. Mười phút sau, inbox hỗ trợ có hai trăm email gần giống nhau: "Hệ thống bị lỗi à?", "Bao giờ sửa xong?", "Tiền của tôi đã bị trừ chưa?". Fanpage có bài đăng chửi. Đối tác gọi thẳng cho giám đốc. Giám đốc nhắn cho tech lead hỏi tình hình. Tech lead, đáng lẽ đang điều phối việc sửa lỗi, giờ phải trả lời từng người một, và mỗi người nhận một câu trả lời hơi khác nhau vì tình hình thay đổi từng phút.

Lỗi được sửa xong sau bốn mươi phút. Nhưng nhóm chăm sóc khách hàng mất thêm hai ngày để trả lời hết những người đã liên hệ, và rất nhiều khách nhớ lần sự cố đó không phải vì bốn mươi phút gián đoạn, mà vì **không ai cho họ biết chuyện gì đang xảy ra**.

Đây là bài toán mà trang status giải quyết. Bài này là phần 1 trong series ba phần về việc tự dựng một dịch vụ status page: vì sao cần nó, nó nên làm gì, và những công cụ đang có trên thị trường.

## Trang status giải quyết gì?

Trang status là một trang công khai cho biết hệ thống đang hoạt động ra sao, sự cố nào đang diễn ra, và bảo trì nào sắp tới. Nó làm được ba việc mà không kênh nào khác làm tốt bằng.

**Giảm tải cho bộ phận hỗ trợ.** Khi có một chỗ duy nhất đăng thông tin chính thức, khách tự vào xem thay vì gọi điện. Nhân viên hỗ trợ chỉ cần trả lời "anh chị xem cập nhật tại trang status", thay vì tự đoán tình hình. Team kỹ thuật viết một cập nhật cho tất cả mọi người, thay vì trả lời từng người.

**Giữ niềm tin.** Khách chấp nhận được sự cố nhiều hơn bạn nghĩ. Thứ họ khó chấp nhận là sự im lặng, và việc phát hiện ra sự cố từ mạng xã hội trước khi nghe từ chính nhà cung cấp. Một trang status được cập nhật đều đặn cho thấy có người đang xử lý, và họ trung thực về những gì đang xảy ra.

**Minh bạch về cam kết.** Nếu bạn cam kết thời gian hoạt động với khách hàng (SLA), trang status với lịch sử sự cố và thanh thời gian hoạt động là bằng chứng công khai bạn có giữ cam kết đó hay không. Xem thêm về [SLI, SLO, SLA](/blog/sli-slo-sla-error-budget/).

### Trang status không phải là monitoring

Hai thứ này hay bị nhầm, nhưng phục vụ hai đối tượng khác nhau.

| | Monitoring và alert | Trang status |
|---|---|---|
| Người xem | Team kỹ thuật | Khách hàng, đối tác, nội bộ không kỹ thuật |
| Nội dung | Metric chi tiết, log, trace, CPU, độ trễ từng endpoint | Thành phần nào bị ảnh hưởng, ảnh hưởng gì tới người dùng, khi nào cập nhật tiếp |
| Mục đích | Phát hiện và chẩn đoán vấn đề | Giao tiếp về vấn đề |
| Ai cập nhật | Tự động | Phần lớn do con người, đôi khi có tự động hỗ trợ |

[Monitoring](/blog/observability-go-vs-rails/) cho biết CPU database lên 100%. Trang status nói: "Một số khách hàng không thể thanh toán bằng thẻ. Chúng tôi đang điều tra." Người dùng không quan tâm CPU. Họ quan tâm họ có thanh toán được không.

Vì vậy, đừng để monitoring tự động đổi trạng thái trên trang status mà không có người xem lại. Một alert báo sai sẽ khiến trang status báo sự cố không có thật, và khách sẽ mất niềm tin vào chính trang đó.

## Giao tiếp khi có sự cố

Có trang status chưa đủ. Cách viết trên đó quyết định nó giúp được hay làm tình hình tệ hơn.

### Bốn trạng thái của một sự cố

Phần lớn các hệ thống status page, trong đó có Atlassian Statuspage, dùng bốn trạng thái cho một sự cố:

1. **Investigating (Đang điều tra)**: đã biết có vấn đề, chưa biết nguyên nhân.
2. **Identified (Đã xác định)**: đã tìm ra nguyên nhân, đang sửa.
3. **Monitoring (Đang theo dõi)**: đã áp dụng bản sửa, đang theo dõi xem có ổn định không.
4. **Resolved (Đã khắc phục)**: sự cố kết thúc.

Bốn trạng thái này cho người đọc biết sự cố đang ở đâu chỉ bằng một cái nhìn, mà không cần đọc hết nội dung.

### Viết một cập nhật tốt

Một cập nhật tốt trả lời ba câu, theo đúng thứ tự người đọc quan tâm:

- **Ai bị ảnh hưởng và bị ảnh hưởng thế nào?** Viết bằng ngôn ngữ của người dùng, không phải của kỹ sư.
- **Chúng tôi đang làm gì?**
- **Khi nào có cập nhật tiếp theo?** Câu này quan trọng nhất và hay bị quên nhất. Nó cho người đọc biết họ không cần ngồi bấm tải lại trang liên tục.

### Bao lâu cập nhật một lần?

Đăng cập nhật đầu tiên **càng sớm càng tốt**, kể cả khi chưa biết gì: "Chúng tôi đang điều tra" vẫn tốt hơn im lặng. Sau đó, cập nhật theo một nhịp cố định (ví dụ mỗi 30 phút khi sự cố đang diễn ra), **kể cả khi không có gì mới**. Và luôn giữ lời hứa về thời điểm cập nhật tiếp theo: hứa 30 phút thì 30 phút sau phải có cập nhật, dù chỉ là "vẫn đang xử lý".

Nhịp cập nhật cụ thể tuỳ mức độ nghiêm trọng của sự cố. Quan trọng là có một nhịp, và giữ nó.

### Một chuỗi cập nhật tốt

> **10:07 · Investigating**
> Một số khách hàng không thể thanh toán bằng thẻ ngân hàng. Thanh toán qua ví điện tử vẫn hoạt động bình thường. Chúng tôi đang điều tra và sẽ cập nhật trước 10:30.
>
> **10:28 · Identified**
> Chúng tôi đã xác định nguyên nhân nằm ở kết nối tới đối tác xử lý thẻ và đang chuyển sang kết nối dự phòng. Thanh toán bằng ví điện tử không bị ảnh hưởng. Cập nhật tiếp theo trước 11:00.
>
> **10:46 · Monitoring**
> Thanh toán bằng thẻ đã hoạt động trở lại. Chúng tôi đang theo dõi để chắc chắn hệ thống ổn định. Các giao dịch thất bại trong thời gian sự cố không bị trừ tiền. Cập nhật tiếp theo trước 11:15.
>
> **11:12 · Resolved**
> Sự cố đã được khắc phục hoàn toàn. Thanh toán bằng thẻ bị gián đoạn từ 10:02 đến 10:44. Chúng tôi sẽ công bố báo cáo chi tiết về nguyên nhân và các biện pháp phòng ngừa trong vòng 5 ngày làm việc.

Để ý: mỗi cập nhật đều nói ai bị ảnh hưởng, cái gì vẫn chạy (để khách có lựa chọn khác), và khi nào có tin tiếp. Câu "các giao dịch thất bại không bị trừ tiền" trả lời trước câu hỏi mà phần lớn khách sẽ gọi điện để hỏi.

### Một chuỗi cập nhật tệ

> **10:31 · Investigating**
> Chúng tôi đang gặp sự cố.
>
> **11:40 · Resolved**
> Đã khắc phục. Xin lỗi vì sự bất tiện.

Cập nhật đầu tiên đến muộn gần 30 phút sau khi sự cố bắt đầu. Không nói ai bị ảnh hưởng, không nói cái gì vẫn dùng được, không hẹn giờ cập nhật tiếp. Hơn một tiếng im lặng ở giữa. Cập nhật cuối không cho biết sự cố kéo dài bao lâu hay có mất dữ liệu không. Khách đọc xong vẫn phải gọi hotline để hỏi.

Còn một kiểu tệ khác, ngược lại: viết quá kỹ thuật. "Connection pool của primary DB cạn do lock contention trên bảng ledger" đúng về mặt kỹ thuật, nhưng khách không biết điều đó có nghĩa là họ không thanh toán được.

### Khi nào đăng postmortem?

Với sự cố nghiêm trọng, cập nhật "Resolved" nên kèm một lời hứa về báo cáo chi tiết, và báo cáo đó phải thật sự được đăng. Phiên bản công khai của [postmortem](/blog/postmortem-la-gi/) thường ngắn gọn hơn bản nội bộ: chuyện gì đã xảy ra, ảnh hưởng ra sao, nguyên nhân chính, và những gì đã làm để không lặp lại. Không cần nêu tên ai, không cần chi tiết hạ tầng nhạy cảm.

Postmortem công khai là thứ biến một sự cố thành bằng chứng về sự chuyên nghiệp. Khách hàng thấy bạn hiểu chuyện gì đã xảy ra và có kế hoạch cụ thể, không chỉ một lời xin lỗi chung chung.

Người viết các cập nhật này thường là người đang [trực sự cố](/blog/on-call-la-gi/), hoặc một người được phân vai riêng để lo phần giao tiếp. Với sự cố lớn, nên tách vai: một người sửa, một người viết, để việc giao tiếp không làm chậm việc sửa lỗi.

## Những công cụ đang có

### Atlassian Statuspage

Statuspage của Atlassian là một trong những dịch vụ status page dạng SaaS phổ biến nhất. Theo tài liệu của Atlassian, các khái niệm chính gồm:

- **Component**: các phần của dịch vụ mà người dùng phụ thuộc vào, như API, ứng dụng di động, trang quản trị. Có thể gom thành nhóm.
- **Incident**: sự cố, đi qua đúng bốn trạng thái Investigating, Identified, Monitoring, Resolved đã nói ở trên. Mỗi cập nhật có thể gửi thông báo tới người đăng ký.
- **Scheduled maintenance**: lịch bảo trì, hiện trên trang và gửi nhắc trước cho người đăng ký.
- **Subscriber**: người đăng ký nhận thông báo khi có sự cố hoặc bảo trì.
- **Uptime**: hiển thị lịch sử thời gian hoạt động của các component, dạng những thanh màu theo từng ngày quen thuộc.

Các trang dựng bằng Statuspage còn có một API công khai, chỉ đọc, không cần xác thực, theo cùng một cấu trúc URL. Ví dụ `/api/v2/summary.json` trả về trạng thái tổng thể, trạng thái từng component, các sự cố chưa khắc phục và các đợt bảo trì sắp tới. Trạng thái của component gồm `operational`, `degraded_performance`, `partial_outage` và `major_outage`. Nhờ API này, khách hàng có thể tự tích hợp trạng thái của bạn vào hệ thống giám sát của họ.

Statuspage có nhiều gói với giới hạn khác nhau về số người đăng ký, số component, số thành viên. Giá và giới hạn thay đổi theo thời gian, nên hãy xem trực tiếp trên trang của Atlassian.

**Ví dụ quen thuộc: GitHub.** Trang status của GitHub tại githubstatus.com được ra mắt từ cuối năm 2018, thay cho trang status.github.com cũ. Trang liệt kê trạng thái của từng thành phần như Git Operations, Webhooks, API Requests, Issues, Pull Requests, Actions, Packages; cho phép đăng ký nhận cập nhật qua email, SMS hoặc webhook; và lưu lại lịch sử sự cố. GitHub Enterprise Cloud còn có trang status riêng theo từng khu vực. Trang này được liệt kê trong tài liệu hướng dẫn về các trang dựng bằng Atlassian Statuspage, và dùng cùng cấu trúc API `/api/v2/` như trên.

### Upptime

Upptime là một dự án mã nguồn mở theo hướng hoàn toàn khác: dựng toàn bộ trang status trên hạ tầng của GitHub, không cần máy chủ riêng.

- **GitHub Actions** chạy theo lịch, kiểm tra các URL cần giám sát.
- Khi một URL lỗi, Upptime **tự mở một GitHub Issue**. Issue đó chính là sự cố. Muốn đăng cập nhật thì viết comment vào issue. Khi URL hoạt động trở lại, issue được tự động đóng.
- Trang status tĩnh được dựng và đăng lên **GitHub Pages**.

Ưu điểm: miễn phí với repo công khai, không phải vận hành máy chủ, mọi thứ nằm trong một repo. Nhược điểm cũng nằm ở đó: nó phụ thuộc hoàn toàn vào GitHub. Khi GitHub Actions, Issues hay Pages gặp sự cố, việc giám sát và trang status của bạn cũng bị ảnh hưởng theo. Và với các dịch vụ dùng chung hạ tầng với GitHub, đó chính là lúc bạn cần trang status nhất.

### Uptime Kuma

Uptime Kuma là công cụ giám sát mã nguồn mở, tự host, giấy phép MIT, thường chạy bằng một container Docker duy nhất. Nó kết hợp cả hai vai:

- **Giám sát**: kiểm tra HTTP(S), TCP, ping, DNS, từ khoá trong trang, cùng kiểu "push" khi dịch vụ chủ động báo về.
- **Cảnh báo**: gửi qua rất nhiều kênh như Telegram, Discord, Slack, email.
- **Trang status công khai**: hiển thị trạng thái các dịch vụ được giám sát.

Đây là lựa chọn phổ biến cho team nhỏ, homelab, hoặc khi cần giám sát nội bộ nhanh. Một số bài so sánh chỉ ra rằng nó chưa có quản lý nhiều người dùng và phân quyền, và quy trình viết cập nhật sự cố đơn giản hơn so với các dịch vụ chuyên về status page.

### SaaS hay tự host?

| | SaaS (như Statuspage) | Tự host (Uptime Kuma, tự viết) | Dựa trên nền tảng khác (Upptime) |
|---|---|---|---|
| Vận hành | Nhà cung cấp lo | Tự lo cài đặt, nâng cấp, sao lưu | Gần như không |
| Chi phí | Trả theo gói | Chi phí máy chủ và công vận hành | Miễn phí trong giới hạn của nền tảng |
| Tách biệt khỏi hệ thống của bạn | Tốt, chạy trên hạ tầng khác | Phụ thuộc vào nơi bạn đặt nó | Phụ thuộc vào GitHub |
| Tuỳ biến | Trong giới hạn sản phẩm | Toàn quyền | Trong giới hạn của dự án |
| Dữ liệu | Nằm ở nhà cung cấp | Nằm ở bạn | Nằm trong repo GitHub |

Không có lựa chọn đúng cho mọi trường hợp. SaaS hợp với team muốn có ngay một trang chuyên nghiệp mà không phải vận hành gì thêm. Tự host hợp khi cần kiểm soát dữ liệu, cần tích hợp sâu, hoặc chi phí SaaS không hợp lý với quy mô của mình. Series này đi theo hướng tự dựng, để hiểu một dịch vụ status page cần những gì bên trong.

## Nguyên tắc quan trọng nhất: chạy tách khỏi hệ thống được giám sát

Nếu chỉ nhớ một điều từ bài này, hãy nhớ điều này: **trang status phải chạy trên hạ tầng tách biệt với hệ thống mà nó báo cáo**.

Nghe hiển nhiên, nhưng rất hay bị vi phạm. Trang status đặt trên cùng cluster Kubernetes với ứng dụng. Dùng chung database. Dùng chung load balancer, chung DNS, chung tài khoản cloud, chung vùng (region). Khi hệ thống sập, trang status sập theo, đúng vào lúc duy nhất mà người ta cần đến nó.

Tách biệt nghĩa là, ít nhất:

- **Khác máy chủ, khác cluster.** Tốt hơn nữa là khác nhà cung cấp cloud, hoặc khác region.
- **Không dùng chung database** với hệ thống chính.
- **Không phụ thuộc vào hệ thống đăng nhập** của sản phẩm chính để người quản trị cập nhật trang.
- **Tên miền và DNS** không phụ thuộc vào hạ tầng đang được giám sát. Dùng một tên miền riêng cho trang status (GitHub dùng githubstatus.com, tách khỏi github.com) giúp trang vẫn truy cập được ngay cả khi tên miền chính gặp sự cố.
- **Trang công khai nên là trang tĩnh hoặc được cache mạnh**, để vẫn hiển thị được khi có lượng truy cập tăng đột biến, vì lúc có sự cố, ai cũng vào xem cùng lúc.

Đây cũng là tiêu chí đầu tiên để đánh giá bất kỳ giải pháp nào, mua hay tự dựng: **khi hệ thống của bạn sập hoàn toàn, trang status còn sống không, và bạn còn cập nhật được nó không?**

## Tiếp theo

Phần này trả lời câu hỏi "vì sao". Ở **[phần 2](/blog/status-page-2-mvp-go/)**, mình sẽ bắt tay vào thiết kế một dịch vụ status page tự dựng: mô hình dữ liệu cho component, incident, cập nhật và lịch bảo trì, cách tách phần quản trị khỏi trang công khai, và cách giữ cho trang vẫn sống khi hệ thống chính sập.

## Nguồn

- Atlassian: [What is Statuspage?](https://support.atlassian.com/statuspage/docs/what-is-statuspage), [Statuspage features](https://www.atlassian.com/software/statuspage/features), [Create and manage your components](https://support.atlassian.com/statuspage/docs/create-and-manage-your-components/), [Learn how Statuspage works](https://support.atlassian.com/statuspage/docs/learn-how-statuspage-works/)
- API công khai của các trang Statuspage: [New Relic Status API](https://status.newrelic.com/api), [MongoDB Atlas Status API: GET /summary.json](https://www.mongodb.com/docs/api/doc/cloud-status/operation/operation-getstatussummary)
- Tài liệu liệt kê githubstatus.com trong số các trang dựng bằng Statuspage: [Monitoring Status Pages Built With Atlassian Statuspage (PDF)](https://storage.googleapis.com/ihub-static-storage/content/Monitoring%20Status%20Pages%20Built%20With%20Atlassian%20Statuspage.pdf)
- GitHub: [Introducing the new GitHub Status Site (2018)](https://github.blog/engineering/infrastructure/introducing-the-new-github-status-site/), [githubstatus.com](https://www.githubstatus.com/)
- Upptime: [github.com/upptime](https://www.github.com/upptime)
- Uptime Kuma: [github.com/louislam/uptime-kuma](https://github.com/louislam/uptime-kuma), [Better Stack: Uptime Kuma guide](https://betterstack.com/community/guides/monitoring/uptime-kuma-guide/), [Better Stack: Statuspage vs Uptime Kuma](https://betterstack.com/community/comparisons/statuspage-vs-uptime-kuma.md)
