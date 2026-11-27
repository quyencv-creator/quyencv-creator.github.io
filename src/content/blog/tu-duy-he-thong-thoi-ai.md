---
title: "Tư duy hệ thống: sức mạnh của người làm phần mềm thời AI"
description: AI tối ưu từng mảnh rất giỏi, nhưng hệ thống hỏng ở chỗ các mảnh tương tác với nhau. Vòng phản hồi, độ trễ, điểm nghẽn di chuyển, hệ quả bậc hai, và cách tập nhìn hệ thống thay vì nhìn từng dòng code.
pubDate: 2026-09-01
tags: [thinking, ai, architecture]
---

Một team nọ thấy API thanh toán thỉnh thoảng timeout. Cách sửa rất hợp lý: thêm retry, thử lại ba lần. Đoạn code chỉ mười dòng, AI viết trong vài giây, review không có gì để chê, test xanh.

Hai tuần sau, dịch vụ thanh toán chậm đi một chút vào giờ cao điểm. Request bắt đầu timeout. Mỗi request timeout được thử lại ba lần, nên tải lên dịch vụ thanh toán tăng gấp mấy lần, đúng lúc nó đang yếu nhất. Nó chậm hơn nữa, timeout nhiều hơn nữa, retry nhiều hơn nữa. Mười phút sau, toàn bộ hệ thống sập.

Đoạn code retry không sai. Mười dòng đó đúng từng dòng. Cái sai nằm ở chỗ không ai trong code nhìn thấy: **cách đoạn code đó tương tác với phần còn lại của hệ thống**.

Đó là khác biệt giữa nhìn code và nhìn hệ thống. Và trong thời AI, đó là khác biệt quan trọng nhất.

## AI tối ưu từng mảnh, hệ thống hỏng ở chỗ nối

AI hiện nay rất giỏi với những bài toán có ranh giới rõ: viết hàm này, sửa bug kia, tối ưu query nọ. Đưa nó một mảnh, nó trả về một mảnh tốt hơn.

Nhưng hệ thống thật không hỏng ở bên trong các mảnh. Nó hỏng ở **chỗ các mảnh gặp nhau**: retry gặp tải cao, cache gặp lúc hết hạn đồng loạt, autoscale gặp giới hạn connection của database, một thay đổi nhỏ ở service A gặp một giả định ngầm ở service B. Những thứ này không nằm trong file nào. Chúng không nằm trong diff của PR nào. Chúng nằm trong **quan hệ** giữa các thứ.

Khi AI làm cho việc tạo ra từng mảnh rẻ đi và nhanh hơn, số mảnh tăng lên, số chỗ nối tăng lên còn nhanh hơn. Người hiểu được các chỗ nối trở nên hiếm, và vì hiếm nên có giá.

## Tư duy hệ thống là gì?

Nói ngắn gọn: **nhìn vào quan hệ và hành vi theo thời gian, thay vì chỉ nhìn vào từng thành phần tại một thời điểm**.

Donella Meadows, trong cuốn *Thinking in Systems*, mô tả hệ thống bằng vài khái niệm cơ bản. Mình thấy chúng áp dụng vào phần mềm gần như nguyên vẹn. Dưới đây là năm thứ mình thấy hữu ích nhất.

### Vòng phản hồi

Một vòng phản hồi xảy ra khi kết quả của một hành động quay lại ảnh hưởng chính hành động đó.

**Vòng tự khuếch đại** làm mọi thứ chạy theo một chiều ngày càng mạnh. Câu chuyện retry ở đầu bài là một ví dụ: chậm sinh ra retry, retry sinh ra chậm hơn. Nợ kỹ thuật cũng vậy: code khó sửa thì người ta vá tạm, vá tạm làm code khó sửa hơn.

**Vòng tự cân bằng** kéo hệ thống về một trạng thái ổn định. Autoscale là vòng cân bằng: tải tăng thì thêm máy, tải giảm thì bớt máy. Circuit breaker cũng vậy: lỗi nhiều thì ngắt, để hệ thống phía sau có thời gian hồi phục.

Câu hỏi để tập: **khi thứ này tăng lên, nó làm gì với chính nó?** Nếu câu trả lời là "làm nó tăng thêm", bạn vừa tìm ra một vòng khuếch đại, và cần một cơ chế hãm: backoff có jitter, giới hạn số lần retry, circuit breaker.

### Độ trễ

Hầu hết vòng phản hồi đều có độ trễ, và độ trễ là thứ làm hệ thống dao động.

Autoscale mất vài phút để khởi động máy mới. Trong vài phút đó tải vẫn tăng, nên hệ thống thêm quá nhiều máy. Tải giảm thì lại bớt quá nhiều. Lên xuống liên tục như người chỉnh vòi nước nóng lạnh trong nhà tắm mà nước phải mất mười giây mới đổi nhiệt độ.

Trong tổ chức cũng thế. Một quyết định kiến trúc hôm nay mất sáu tháng mới lộ hệ quả. Tới lúc đó, người quyết định có thể đã chuyển team, và không ai liên hệ được nguyên nhân với kết quả.

Câu hỏi để tập: **từ lúc làm tới lúc thấy kết quả mất bao lâu?** Độ trễ càng dài, càng phải nghĩ kỹ trước khi làm, vì sửa sai sẽ rất đắt.

### Điểm nghẽn di chuyển

Eliyahu Goldratt, với *Lý thuyết ràng buộc*, chỉ ra một điều đơn giản mà rất hay bị quên: năng lực của cả hệ thống bị giới hạn bởi **khâu chậm nhất**. Tăng tốc bất kỳ khâu nào khác đều không làm hệ thống nhanh hơn. Nó chỉ làm hàng tồn chất đống trước khâu chậm nhất.

Đây chính là chuyện đang xảy ra với AI và phát triển phần mềm. AI làm khâu viết code nhanh lên nhiều lần. Nhưng nếu review, test, deploy, và khả năng hiểu hệ thống không nhanh lên theo, thì điểm nghẽn chỉ **di chuyển** sang đó. PR chất đống chờ review. Reviewer bị quá tải, bắt đầu đọc lướt rồi bấm approve. Mình đã viết về hệ quả của chuyện này trong bài [Khi AI viết code mà không ai đọc nổi](/blog/ai-viet-code-dev-lam-gi/).

Câu hỏi để tập: **nếu khâu này nhanh gấp mười, điểm nghẽn sẽ chuyển đi đâu?**

### Hệ quả bậc hai

Hệ quả bậc một là thứ bạn nhắm tới. Hệ quả bậc hai là thứ xảy ra **vì** hệ quả bậc một.

Thêm cache để giảm tải database: bậc một là database nhẹ hơn. Bậc hai là khi cache hết hạn cùng lúc, hàng nghìn request ập vào database cùng một giây. Bậc hai nữa là dữ liệu cũ hiện ra cho user, và ai đó phải viết code xoá cache, rồi code đó có bug.

Đo năng suất bằng số token đã dùng: bậc một là mọi người dùng AI nhiều hơn. Bậc hai là người ta đốt token để đẹp số liệu, code nhiều lên mà hiểu biết ít đi.

Câu hỏi để tập, cũng là câu hỏi đơn giản nhất mà hiệu quả nhất: **"Rồi sao nữa?"** Hỏi ít nhất hai lần.

### Ranh giới

Mọi hệ thống bạn nhìn đều có một ranh giới mà bạn tự vẽ ra. Bên trong là thứ bạn quan tâm, bên ngoài là "không phải việc của mình". Rất nhiều sự cố xảy ra vì ranh giới bị vẽ quá hẹp.

Một service tối ưu độ trễ của riêng nó bằng cách gọi song song mười service khác, và làm cả hệ thống quá tải. Một team giảm số bug của mình bằng cách đẩy validation sang team khác. Mỗi bên đều tối ưu đúng trong ranh giới của mình, và cả hệ thống thì tệ đi.

Định luật Conway nói thêm một điều: cấu trúc hệ thống phần mềm sẽ phản chiếu cấu trúc giao tiếp của tổ chức tạo ra nó. Nghĩa là muốn hiểu vì sao hệ thống có hình dạng như hiện tại, đôi khi phải nhìn vào sơ đồ tổ chức chứ không phải sơ đồ kiến trúc.

Câu hỏi để tập: **nếu nới ranh giới rộng thêm một vòng, mình sẽ thấy gì mà trước đây không thấy?**

## Vì sao đây là sức mạnh trong thời AI?

Vì nó nằm đúng ở chỗ AI yếu nhất.

AI làm việc với những gì nằm trong context. Hệ thống thật thì không bao giờ nằm gọn trong context: nó gồm cả hành vi lúc tải cao mà không ai ghi lại, giả định ngầm giữa các team, lịch sử vì sao một quyết định được đưa ra, người dùng thật làm gì khác với tài liệu. AI có thể giúp bạn phân tích một vòng phản hồi khi bạn đã chỉ ra nó. Nhưng nhìn ra vòng phản hồi đó ngay từ đầu cần một người đã quan sát hệ thống chạy, đã từng thấy nó sập, và có thói quen hỏi "rồi sao nữa".

Còn một lý do nữa. Khi AI làm từng phần nhanh lên, **tốc độ thay đổi của cả hệ thống tăng lên**. Nhiều thay đổi hơn, nhanh hơn, nghĩa là nhiều tương tác chưa ai lường trước hơn. Trong một hệ thống thay đổi chậm, bạn có thể học dần từ sai lầm. Trong một hệ thống thay đổi nhanh, người không nhìn được toàn cục sẽ liên tục bị bất ngờ.

Người chỉ giỏi viết code đang cạnh tranh trực tiếp với AI. Người hiểu hệ thống thì đang **dùng** AI.

## Tập tư duy hệ thống thế nào?

Đây không phải kỹ năng học xong một khoá là có. Nó là thói quen nhìn. Vài cách mình thấy có ích:

**Vẽ ra.** Trước khi sửa một thứ quan trọng, vẽ trên giấy các thành phần liên quan và mũi tên giữa chúng. Đánh dấu chỗ nào có vòng lặp, chỗ nào có độ trễ. Việc vẽ buộc bạn thấy những quan hệ mà đọc code không thấy.

**Đọc postmortem.** Của công ty mình và của công ty khác. Sự cố lớn gần như không bao giờ có một nguyên nhân. Nó là một chuỗi tương tác, và postmortem viết tốt là bài học tư duy hệ thống miễn phí.

**Ở lại với hệ thống sau khi ship.** Người chỉ viết code rồi chuyển việc sẽ không bao giờ thấy hệ quả bậc hai. Người trực sự cố, đọc metric, xem hệ thống chạy dưới tải thật sẽ dần có trực giác về hành vi của nó.

**Hỏi ba câu trước mỗi thay đổi lớn:** thay đổi này tạo ra vòng phản hồi nào, điểm nghẽn sẽ chuyển đi đâu, và rồi sao nữa?

**Dùng AI để kiểm tra, không phải để thay.** Sau khi tự vẽ hệ thống, mô tả nó cho AI và hỏi: "Có vòng phản hồi nào mình bỏ sót? Lúc tải cao cái gì sẽ hỏng trước?" AI rất hữu ích ở vai trò người phản biện, khi bạn đã đưa đủ bức tranh cho nó.

## Nhìn rộng hơn một vòng

Quay lại câu chuyện retry. Nếu có một người trong team hỏi "khi dịch vụ thanh toán chậm, retry sẽ làm gì với nó?", sự cố đó không xảy ra. Câu hỏi đó không cần kiến thức gì cao siêu. Nó chỉ cần thói quen nhìn rộng hơn đoạn code trước mặt một vòng.

AI sẽ viết ngày càng nhiều đoạn code trước mặt. Việc của chúng ta là nhìn rộng hơn chúng một vòng.
