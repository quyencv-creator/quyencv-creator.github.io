---
title: "Ngân hàng muốn tăng tốc bằng AI: làm sao để nhân viên không bê cả source code cho AI bên ngoài?"
description: "Cấm AI thì nhân viên dùng lén bằng tài khoản cá nhân, thả cửa thì source code và dữ liệu khách hàng ra ngoài. Cách các tổ chức tài chính có thể vừa dùng AI vừa kiểm soát được: cung cấp con đường chính thức tốt hơn con đường lén, phân loại dữ liệu, cổng AI tập trung, kiểm soát agent, và đặt luật rõ ràng cho con người."
pubDate: 2026-11-13
tags: [ai, security, devops]
---

Một dev ở ngân hàng đang gặp bug khó trong module tính lãi. Công cụ nội bộ không giúp được. Anh mở điện thoại, đăng nhập một chatbot AI bằng tài khoản cá nhân, dán vào đó 300 dòng code, kèm luôn đoạn log có số tài khoản khách hàng để "cho AI hiểu ngữ cảnh". Năm phút sau bug được sửa. Không ai biết chuyện này đã xảy ra.

Đây không phải là kịch bản giả tưởng. Với bất kỳ tổ chức nào có dev mà chưa có công cụ AI chính thức, chuyện này gần như chắc chắn đang diễn ra. Câu hỏi không phải là "có hay không", mà là "bao nhiêu và ở đâu".

Ngân hàng đứng giữa hai áp lực. Một bên là cạnh tranh: các ngân hàng số, các công ty fintech đang dùng AI để làm nhanh hơn, và đứng ngoài nghĩa là tụt lại. Bên kia là rủi ro: source code của hệ thống lõi, cấu hình bảo mật, và trên hết là dữ liệu khách hàng. Từ 01/01/2026, Luật Bảo vệ dữ liệu cá nhân (Luật số 91/2025/QH15) có hiệu lực, và theo Nghị định 356/2025/NĐ-CP hướng dẫn luật này, thông tin tài khoản, lịch sử giao dịch và dữ liệu thẻ ngân hàng thuộc nhóm dữ liệu cá nhân nhạy cảm. Để lộ những thứ này qua một công cụ AI không được kiểm soát không còn là chuyện nội bộ.

Vậy làm sao để vừa dùng được AI, vừa không để source code và dữ liệu đi ra ngoài?

## Cấm hoàn toàn là cách tệ nhất

Phản xạ đầu tiên của nhiều tổ chức là cấm. Chặn mọi trang web AI, ra thông báo cấm sử dụng, xong.

Vấn đề là lệnh cấm không xoá được nhu cầu. Dev vẫn cần sửa bug nhanh, vẫn biết AI giúp được, và vẫn có điện thoại cá nhân với 4G. Lệnh cấm chỉ đẩy việc sử dụng ra khỏi tầm nhìn: từ máy công ty có giám sát sang thiết bị cá nhân không ai kiểm soát. Người ta gọi đây là "shadow AI", và nó nguy hiểm hơn nhiều so với việc dùng AI công khai trong một khuôn khổ có kiểm soát.

Nguyên tắc đầu tiên vì vậy là: **con đường chính thức phải tốt hơn con đường lén lút**. Nếu công cụ AI ngân hàng cung cấp chậm, yếu, khó xin quyền, thì nhân viên sẽ quay lại với điện thoại cá nhân, và mọi biện pháp kiểm soát phía sau đều vô nghĩa.

## Lớp 1: Cung cấp AI qua kênh doanh nghiệp

Khác biệt lớn nhất giữa "dán code vào chatbot bằng tài khoản cá nhân" và "dùng AI trong doanh nghiệp" nằm ở **hợp đồng và đường đi của dữ liệu**.

Các nhà cung cấp AI lớn đều có gói dành cho doanh nghiệp, với những điều khoản mà gói cá nhân không có: cam kết không dùng dữ liệu của khách hàng để huấn luyện model, giới hạn thời gian lưu dữ liệu, có thể có tuỳ chọn không lưu dữ liệu, hợp đồng xử lý dữ liệu, và các chứng nhận bảo mật. Những điều khoản cụ thể khác nhau giữa các nhà cung cấp và thay đổi theo thời gian, nên bộ phận pháp chế và bảo mật phải đọc kỹ hợp đồng, không dựa vào trang giới thiệu.

Với ngân hàng, còn một lựa chọn thường phù hợp hơn: **dùng model qua nền tảng cloud mà ngân hàng đã có hợp đồng**. Nhiều model hàng đầu, trong đó có Claude, có thể được truy cập qua Amazon Bedrock hay Google Cloud Vertex AI. Khi đó, dữ liệu đi qua hạ tầng cloud mà ngân hàng đã thẩm định, đã ký hợp đồng, có thể chọn vùng đặt dữ liệu, có thể kết nối qua đường mạng riêng thay vì internet công cộng, và nằm trong cùng hệ thống giám sát, phân quyền mà ngân hàng đang dùng.

Với những phần nhạy cảm nhất, có thể cân nhắc **tự vận hành model mã nguồn mở** trong hạ tầng của ngân hàng. Đổi lại là model thường yếu hơn và chi phí vận hành cao hơn. Đây thường là lựa chọn cho một phạm vi hẹp, không phải cho toàn bộ tổ chức.

## Lớp 2: Phân loại cái gì được đi đâu

Không phải mọi đoạn code đều nhạy cảm như nhau. Code của trang giới thiệu sản phẩm khác với code của hệ thống tính lãi, và cả hai đều khác với khoá mã hoá hay dữ liệu khách hàng. Đối xử với tất cả như nhau thì hoặc là quá lỏng, hoặc là quá chặt tới mức không ai dùng được.

Một cách phân loại thực tế:

| Mức | Ví dụ | Được dùng với AI nào |
|---|---|---|
| Công khai | Thư viện mã nguồn mở, tài liệu công khai | Mọi công cụ được duyệt |
| Nội bộ | Tool nội bộ, website, ứng dụng ít rủi ro | AI qua kênh doanh nghiệp đã duyệt |
| Mật | Core banking, hệ thống thanh toán, cấu hình bảo mật | Chỉ AI chạy trong hạ tầng được kiểm soát chặt, có thể là tự vận hành |
| Tuyệt mật | Dữ liệu khách hàng thật, khoá, mật khẩu, chứng chỉ | Không đưa vào AI, trong mọi trường hợp |

Bảng này chỉ có tác dụng khi **mỗi repository được gắn nhãn**, và nhân viên biết rõ repo mình đang làm thuộc mức nào. Phân loại trên giấy mà không gắn vào công cụ thì không ai nhớ.

Và một điều quan trọng: dòng cuối của bảng (dữ liệu khách hàng, khoá, mật khẩu) **không nên nằm trong source code ngay từ đầu**. Nếu repo của bạn có mật khẩu database trong file cấu hình, có file dữ liệu mẫu lấy từ production, thì vấn đề không chỉ là AI. Bất kỳ ai clone repo cũng có những thứ đó. Dọn sạch secret khỏi code, đưa vào hệ thống quản lý secret chuyên dụng, dùng dữ liệu giả cho môi trường dev và test. Làm được điều này thì hậu quả của việc code bị lộ giảm đi rất nhiều.

## Lớp 3: Một cổng AI tập trung

Thay vì để từng nhân viên, từng công cụ kết nối thẳng tới nhà cung cấp AI, nhiều tổ chức đặt một **cổng AI (AI gateway)** ở giữa. Mọi yêu cầu tới AI đều đi qua cổng này. Nó cho phép:

- **Xác thực theo tài khoản công ty**: biết ai đang dùng, mất quyền khi nghỉ việc.
- **Ghi log**: lưu lại ai gửi gì, lúc nào, để điều tra khi cần. Cần cân nhắc vì chính log này cũng chứa dữ liệu nhạy cảm và phải được bảo vệ.
- **Quét và che dữ liệu nhạy cảm** trước khi gửi đi: phát hiện số thẻ, số tài khoản, số CMND/CCCD, khoá API, mật khẩu, và chặn hoặc che chúng.
- **Định tuyến theo mức nhạy cảm**: yêu cầu từ repo mức "Mật" chỉ được gửi tới model chạy trong hạ tầng nội bộ.
- **Giới hạn chi phí** theo người, theo team.

Song song với cổng chính thức, các kênh không chính thức bị chặn ở tầng mạng: proxy của công ty chặn các dịch vụ AI dành cho người dùng cá nhân, công cụ chống thất thoát dữ liệu (DLP) giám sát việc tải lên. Nhưng nhớ lại nguyên tắc đầu tiên: chặn chỉ có tác dụng khi con đường chính thức đủ tốt.

## Lớp 4: AI agent cần kiểm soát riêng

Chatbot chỉ thấy những gì người dùng dán vào. **AI agent** thì khác hẳn: nó tự đọc cả repository, tự chạy lệnh trong terminal, tự gọi mạng, tự sửa file. Một agent có thể đọc file `.env` chứa mật khẩu mà người dùng không hề chủ động đưa cho nó.

Với agent, cần thêm những kiểm soát sau:

- **Chính sách cấu hình tập trung**: các công cụ agent dành cho doanh nghiệp thường cho phép bộ phận IT đặt chính sách áp dụng cho mọi máy: cấm đọc những file nào (`.env`, file chứa khoá), cấm chạy những lệnh nào, chỉ được dùng model qua cổng nào. Người dùng không tự gỡ được.
- **Môi trường cách ly**: agent làm việc với code nhạy cảm nên chạy trong môi trường riêng (máy ảo, container, máy trạm từ xa) mà mạng ra ngoài bị giới hạn, chỉ được đi tới cổng AI và những địa chỉ được duyệt.
- **Không có thông tin đăng nhập production**: môi trường mà agent chạy không bao giờ được có quyền truy cập database production, khoá triển khai, hay tài khoản cloud có quyền cao.
- **Cảnh giác với nội dung độc hại**: agent đọc mọi thứ trong repo, kể cả file README, comment, issue. Một đoạn văn bản được cài cắm khéo léo có thể yêu cầu agent gửi dữ liệu ra ngoài. Giới hạn mạng ra ngoài là lớp phòng thủ chính cho rủi ro này.
- **Con người duyệt trước khi thay đổi**: agent đề xuất, người duyệt. Không để agent tự merge, tự deploy vào hệ thống quan trọng.

## Lớp 5: Con người và quy trình

Công nghệ chỉ giải quyết được một phần. Phần còn lại nằm ở con người.

**Quy định rõ ràng, ngắn gọn.** Một trang, không phải năm mươi trang. Được dùng công cụ nào, với loại code nào, tuyệt đối không được đưa gì vào. Viết bằng ví dụ cụ thể: "Không dán log có số tài khoản khách hàng" rõ hơn nhiều so với "Không chia sẻ dữ liệu nhạy cảm".

**Đào tạo bằng tình huống thật.** Đoạn log nào là có dữ liệu khách hàng? File cấu hình nào có secret? Nhiều sự cố xảy ra không phải vì cố ý, mà vì người ta không nhận ra thứ mình đang dán là nhạy cảm.

**Xin công cụ mới phải nhanh.** Nếu dev muốn thử một công cụ AI mới và quy trình phê duyệt mất ba tháng, họ sẽ dùng lén. Có một quy trình đánh giá nhanh cho các công cụ rủi ro thấp.

**Ân xá cho việc dùng lén trong quá khứ.** Khi triển khai chính sách mới, cho phép mọi người khai báo những công cụ họ đã dùng mà không bị phạt. Mục tiêu là biết rủi ro đang ở đâu, không phải tìm người để kỷ luật.

## Lớp 6: Giám sát và kiểm tra định kỳ

- Xem log của cổng AI định kỳ: ai dùng nhiều bất thường, những yêu cầu nào bị chặn vì chứa dữ liệu nhạy cảm, và vì sao.
- Quét repository để tìm secret còn sót lại.
- Đánh giá lại nhà cung cấp AI định kỳ, vì điều khoản và năng lực của họ thay đổi.
- Thử tấn công chính hệ thống của mình: thử đưa dữ liệu nhạy cảm qua cổng AI xem có bị chặn không, thử để agent đọc file `.env` xem chính sách có hoạt động không.

## Một điều hay bị quên: source code có thể không phải thứ quý nhất

Câu chuyện thường được kể là "bảo vệ source code". Nhưng nếu nhìn kỹ, với phần lớn ngân hàng, source code tự nó thường không phải tài sản nhạy cảm nhất. Code của một hệ thống ngân hàng phần lớn là logic nghiệp vụ mà đối thủ cũng có, viết trên những framework mà ai cũng dùng.

Thứ thật sự nguy hiểm là những gì **đi kèm** code: mật khẩu và khoá nằm trong file cấu hình, dữ liệu khách hàng thật trong file test, cấu hình hạ tầng tiết lộ kiến trúc mạng, lỗ hổng bảo mật chưa vá mà kẻ tấn công có thể đọc ra từ code. Một tổ chức dọn sạch secret khỏi code, không dùng dữ liệu thật trong môi trường dev, và vá lỗ hổng kịp thời thì rủi ro của việc lộ code giảm đi rất nhiều, dù là lộ qua AI hay qua bất kỳ đường nào khác.

Nói cách khác, kiểm soát AI là cần thiết, nhưng nó không thay thế được việc giữ cho code sạch ngay từ đầu.

## Kết

Ngân hàng không chọn giữa "dùng AI" và "an toàn". Họ chọn giữa **dùng AI có kiểm soát** và **dùng AI không kiểm soát**, vì nhân viên sẽ dùng AI dù có được phép hay không.

Con đường có kiểm soát gồm: một kênh chính thức đủ tốt để không ai cần dùng lén, một bảng phân loại rõ ràng cái gì được đi đâu, một cổng tập trung để ghi lại và lọc, những giới hạn riêng cho agent, và những quy định mà con người hiểu và làm theo được. Không lớp nào hoàn hảo. Nhưng chồng nhiều lớp lên nhau thì một sai sót ở một lớp không đủ để dữ liệu khách hàng đi ra ngoài.

Và bước rẻ nhất, hiệu quả nhất, nên làm ngay hôm nay: dọn sạch mật khẩu và dữ liệu khách hàng khỏi source code.
