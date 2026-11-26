---
title: "Kỹ năng debug hệ thống thật trong thời AI"
description: AI đọc stack trace và đề xuất cách sửa trong vài giây, nhưng lỗi trên production hiếm khi nằm ở chỗ stack trace chỉ tới. Phân biệt triệu chứng với nguyên nhân, quan sát trước khi đoán, thay đổi từng biến một, chứng minh bản sửa, và dùng AI như một người cộng sự chứ không phải người phán xử.
pubDate: 2026-11-26
draft: true
tags: [thinking, ai, backend, devops]
---

Thử hình dung một Rails API bán hàng với cấu hình rất bình thường: 4 pod, mỗi pod chạy Puma 2 worker, mỗi worker 5 thread, `pool: 5` trong `database.yml`. Tổng cộng 8 process, 40 thread, 40 connection tới Postgres, trong khi `max_connections` của Postgres là 100. Dư dả.

Endpoint `POST /orders` nhận khoảng 60 request mỗi giây vào buổi tối. Mỗi request mở một transaction, trong đó có lời gọi sang đối tác vận chuyển để tính phí ship, mất khoảng 150ms. Cộng thêm các query, mỗi request giữ một connection chừng 0,2 giây.

Áp định luật Little (số việc đang xử lý = tốc độ đến × thời gian xử lý): 60 × 0,2 = **12 connection** bận cùng lúc, trên tổng 40. Hệ thống chạy ổn suốt nhiều tháng.

Một tối, API của đối tác chậm đi: thay vì 150ms, mỗi lần gọi mất khoảng 8 giây. Code gọi đối tác dùng `Net::HTTP` không đặt timeout, nên nó dùng mặc định là 60 giây, tức là ngoan ngoãn đợi đủ 8 giây. Và vì lời gọi nằm **trong transaction**, connection database bị giữ suốt 8 giây đó.

Làm lại phép tính: 60 × 8 = **480 connection** cần dùng cùng lúc, trong khi chỉ có 40. Pool cạn trong chưa tới một giây. Các thread còn lại xếp hàng chờ connection, chờ đủ 5 giây (`checkout_timeout` mặc định), rồi log đầy một dòng:

```text
ActiveRecord::ConnectionTimeoutError: could not obtain a connection from the pool within 5.000 seconds
```

Người trực copy dòng lỗi dán vào AI. Câu trả lời đến ngay, rõ ràng, tự tin: pool quá nhỏ, hãy tăng `pool` từ 5 lên 20. Kèm cả đoạn config mẫu.

Deploy. Lỗi giảm được vài phút, vì restart pod xoá sạch hàng đợi, rồi quay lại y như cũ. Tất nhiên: mỗi worker vẫn chỉ có 5 thread, mỗi thread dùng tối đa một connection, nên 15 connection thêm vào pool không bao giờ được dùng tới. Bản sửa đó **không thay đổi gì cả**.

Người trực tăng tiếp `RAILS_MAX_THREADS` lên 20 cho "khớp" với pool. Giờ là 8 × 20 = 160 connection, vượt `max_connections` 100 của Postgres, và một loại lỗi mới xuất hiện:

```text
FATAL: sorry, too many clients already
```

Mà kể cả nếu Postgres nhận đủ 160, vẫn còn thiếu xa 480.

Nguyên nhân chưa bao giờ là pool nhỏ. Nguyên nhân là connection bị giữ để làm một việc chẳng liên quan gì tới database. Cách sửa đúng không đụng tới pool: đưa lời gọi HTTP ra khỏi transaction, đặt timeout 2 giây, và thêm circuit breaker để đối tác chậm thì ngắt sớm thay vì kéo cả hệ thống chết theo. Sau khi sửa, thời gian giữ connection quay về khoảng 50ms, dù đối tác có chậm tới đâu.

AI không sai về kiến thức. Pool nhỏ đúng là một nguyên nhân phổ biến của lỗi đó. Nó sai vì nó chỉ thấy **triệu chứng** mà bạn đưa cho nó, không thấy **hệ thống** đang chạy. Nếu người trực đưa thêm ba con số (số thread, thời gian giữ connection, độ trễ của đối tác), có lẽ AI cũng đã tính ra được. Nhưng biết cần đưa con số nào chính là kỹ năng.

Bài này nói về kỹ năng nhìn thấy hệ thống đó.

## Vì sao debug hệ thống thật khó hơn debug code

Debug một hàm thì mọi thứ nằm trước mặt: input, code, output. Debug một hệ thống đang chạy thì phần lớn thông tin quan trọng **không nằm trong code**:

- **Trạng thái**: dữ liệu trong database, cache đang giữ gì, hàng đợi đang dài bao nhiêu.
- **Thời gian**: lỗi chỉ xảy ra lúc tải cao, lúc cron chạy, lúc cache hết hạn, khi hai request đến cùng một mili giây.
- **Môi trường**: cấu hình, biến môi trường, giới hạn của hệ điều hành, phiên bản thư viện trên máy production khác máy dev.
- **Các bên khác**: service khác, database, mạng, DNS, đối tác bên ngoài.

Và điều gây hiểu lầm nhiều nhất: **chỗ lỗi hiện ra thường không phải chỗ lỗi bắt đầu**. Lỗi hiện ra ở database pool, nguyên nhân ở một lời gọi HTTP. Lỗi hiện ra là hết bộ nhớ, nguyên nhân là một vòng retry. Lỗi hiện ra ở service A, nguyên nhân là service B thay đổi format response.

Stack trace cho bạn biết chương trình chết ở đâu. Nó hiếm khi cho bạn biết tại sao.

## AI làm chuyện này dễ hơn, và cũng khó hơn

Dễ hơn, vì AI đọc log nhanh hơn bạn, giải thích được thông báo lỗi lạ, viết được câu query phân tích trong vài giây, và biết những nguyên nhân phổ biến của hàng nghìn loại lỗi.

Khó hơn, vì ba lý do.

**Thứ nhất, nhiều code hơn mà ít người hiểu hơn.** Khi phần lớn code do AI viết và được merge vội, lúc có sự cố bạn đang debug một đoạn code mà không ai trong team từng thật sự nghĩ về nó. Không có ai để hỏi "lúc viết bạn giả định gì".

**Thứ hai, giả thuyết đến quá nhanh.** Trước đây, nghĩ ra một giả thuyết mất công, nên người ta kiểm tra nó cẩn thận. Bây giờ AI đưa ra năm giả thuyết hợp lý trong năm giây. Cám dỗ là chọn cái nghe hay nhất rồi sửa luôn. Đó là cách bạn tăng pool lên 20 lúc mười một giờ đêm.

**Thứ ba, AI giỏi làm lỗi biến mất.** Bọc try/catch, tăng timeout, thêm retry, tăng giới hạn. Lỗi không còn hiện ra nữa, nhưng nguyên nhân vẫn còn đó, chỉ là giờ nó im lặng. Một hệ thống đầy lỗi im lặng còn nguy hiểm hơn một hệ thống báo lỗi ầm ĩ.

## Những kỹ năng vẫn thuộc về con người

### Cầm máu trước, tìm nguyên nhân sau

Khi production đang sập, việc đầu tiên không phải là hiểu tại sao. Việc đầu tiên là làm cho nó ngừng sập: rollback bản deploy gần nhất, tắt tính năng mới bằng feature flag, chuyển tải sang chỗ khác, tạm ngắt lời gọi tới đối tác đang chậm.

Nghe hiển nhiên, nhưng dev có bản năng muốn hiểu vấn đề, và bản năng đó khiến người dùng phải chờ trong lúc bạn đọc code. Cầm máu xong rồi mới mở hồ sơ bệnh án. Có một điều kiện: trước khi rollback, lưu lại bằng chứng (log, metric, một vài stack dump), vì sau khi khôi phục, dấu vết thường biến mất.

### Hỏi "cái gì đã thay đổi?"

Hệ thống đang chạy ổn rồi đột nhiên hỏng thì gần như chắc chắn có thứ gì đó đã thay đổi. Câu hỏi đầu tiên luôn là: **thay đổi gì, lúc nào?**

Đi qua danh sách: deploy code, thay đổi config, thay đổi hạ tầng, nâng cấp thư viện, migration database, lượng traffic, hình dạng dữ liệu (một khách hàng mới có 100.000 đơn hàng), và các bên ngoài (đối tác, nhà cung cấp cloud, chứng chỉ TLS hết hạn).

Đặt mốc thời gian lỗi bắt đầu cạnh mốc thời gian của từng thay đổi. Rất nhiều sự cố được giải quyết chỉ bằng bước này, trước cả khi mở code ra.

### Quan sát trước khi đoán

Phản xạ tự nhiên là đoán ngay: "chắc là do cache". Rồi đi tìm bằng chứng ủng hộ cái đoán đó. Đây là cách debug tệ nhất, vì bạn sẽ luôn tìm được bằng chứng cho thứ mình muốn tin.

Cách tốt hơn là thu thập trước: metric nào bất thường, bắt đầu từ lúc nào, ảnh hưởng tất cả hay chỉ một nhóm (một endpoint, một khách hàng, một server, một vùng)? Câu hỏi "**chỉ một nhóm**" đặc biệt mạnh. Nếu lỗi chỉ xảy ra trên một trong năm server, nguyên nhân nằm ở thứ khác biệt giữa server đó và bốn server còn lại.

Và đừng quên những gì **không** xảy ra. Nếu database chậm thì lẽ ra mọi endpoint đều chậm; nếu chỉ một endpoint chậm thì database có lẽ không phải thủ phạm. Một giả thuyết tốt phải giải thích được cả những gì bạn thấy lẫn những gì bạn không thấy.

### Đặt giả thuyết có thể sai, rồi cố chứng minh nó sai

Một giả thuyết hữu ích là giả thuyết **có thể kiểm chứng**: "Nếu đúng là connection bị giữ bởi lời gọi HTTP, thì trong `pg_stat_activity` sẽ thấy nhiều connection ở trạng thái `idle in transaction` với thời gian dài." Rồi đi xem. Nếu không thấy, giả thuyết sai, và đó là thông tin quý, không phải thất bại.

Thay đổi **một biến mỗi lần**. Tăng pool, thêm index và đổi timeout cùng lúc thì dù lỗi có hết, bạn cũng không biết cái nào có tác dụng, và có thể hai trong ba thay đổi đang làm hệ thống tệ đi.

### Thu hẹp phạm vi bằng chia đôi

Khi không biết lỗi ở đâu, chia đôi không gian tìm kiếm. Lỗi xuất hiện ở commit nào: `git bisect`. Lỗi do dòng dữ liệu nào: chia đôi tập dữ liệu. Lỗi do cấu hình nào: tắt một nửa, xem còn lỗi không. Chia đôi nghe đơn điệu, nhưng nó luôn hội tụ, trong khi đoán mò thì không.

### Hiểu các tầng bên dưới code

Rất nhiều lỗi "khó hiểu" trở nên rõ ràng khi bạn biết tầng bên dưới vận hành ra sao. Connection pool giữ connection như thế nào và nhả khi nào. Transaction giữ lock tới lúc nào. Runtime của bạn xử lý đồng thời ra sao: GVL trong Ruby, goroutine và scheduler trong Go, GC dừng thế giới lúc nào. Hệ điều hành giới hạn số file descriptor bao nhiêu. DNS được cache bao lâu. TCP timeout mặc định là bao nhiêu.

Không cần biết hết, nhưng càng biết nhiều tầng, bạn càng có nhiều giả thuyết đúng để kiểm tra. Và đây là thứ AI biết rất nhiều nhưng không thể tự áp vào hệ thống của bạn nếu bạn không biết đủ để hỏi đúng.

### Phân biệt triệu chứng và nguyên nhân

Hỏi "tại sao" cho tới khi bạn mô tả được một **cơ chế** giải thích được mọi quan sát, từ đầu đến cuối. "Pool cạn" là triệu chứng. "Mỗi request giữ connection 8 giây vì lời gọi HTTP không có timeout nằm trong transaction, nên 60 request/giây cần 480 connection trong khi chỉ có 40" là cơ chế. Khi có cơ chế, cách sửa hiện ra rõ ràng: đưa lời gọi HTTP ra khỏi transaction, đặt timeout, thêm circuit breaker. Và bạn biết vì sao tăng pool là sai.

### Chứng minh bản sửa có tác dụng

Lỗi biến mất sau khi deploy bản sửa chưa chứng minh được gì. Có thể đối tác vừa nhanh trở lại. Có thể traffic vừa giảm. Có thể bạn may mắn.

Bản sửa được chứng minh khi bạn **tái hiện được lỗi trước khi sửa**, và **không tái hiện được sau khi sửa**, trong cùng điều kiện. Ở ví dụ đầu bài: dựng môi trường có mock đối tác chậm 8 giây, bắn 60 request/giây (một [bộ load test](/blog/k6-load-test-rails-api/) dùng đúng lúc này), thấy pool cạn; áp bản sửa, bắn lại, số connection bận quay về quanh mức 60 × 0,05 = 3. Không tái hiện được lỗi thì ít nhất phải có metric cho thấy cơ chế đã thay đổi, ví dụ số connection `idle in transaction` giảm về gần 0.

## Dùng AI khi debug: cộng sự, không phải người phán xử

Mình dùng AI khi debug hằng ngày, và nó rất hữu ích, với điều kiện dùng đúng vai.

**Đưa sự kiện, không đưa kết luận.** Đừng hỏi "pool connection nhỏ quá thì sửa thế nào". Hãy đưa: thông báo lỗi, thời điểm bắt đầu, những gì đã thay đổi gần đây, metric nào bất thường, metric nào bình thường. Câu hỏi đã chứa sẵn kết luận thì câu trả lời sẽ chỉ xác nhận kết luận đó.

**Hỏi nhiều giả thuyết và cách phân biệt chúng.** "Liệt kê các nguyên nhân có thể của tình trạng này, xếp theo khả năng, và với mỗi nguyên nhân cho biết cần kiểm tra gì để loại trừ nó." Câu hỏi này biến AI từ người đưa đáp án thành người lập kế hoạch điều tra.

**Bắt nó phản biện mình.** AI có xu hướng đồng ý với người hỏi. Khi bạn đã có giả thuyết, hãy hỏi: "Những bằng chứng nào sẽ cho thấy giả thuyết này sai? Có quan sát nào nó không giải thích được?"

**Giao việc nặng nhọc.** Viết câu query phân tích log, script gom metric, lệnh tìm các request chậm nhất, giải thích một đoạn code lạ, tóm tắt 5.000 dòng log quanh thời điểm lỗi. Đây là chỗ AI tiết kiệm cho bạn hàng giờ.

**Không áp bản sửa mà không hiểu cơ chế.** Nếu AI đề xuất một thay đổi mà bạn không giải thích được vì sao nó sửa được lỗi, thì bạn chưa debug xong. Bạn chỉ đang thử vận may.

## Tập kỹ năng này thế nào?

Debug hệ thống thật không học được qua sách. Nó học được qua sự cố. Vài cách để có thêm sự cố mà không phải đợi production sập:

**Tham gia trực sự cố**, kể cả khi chưa bắt buộc. Ngồi cạnh người đang debug một sự cố thật là bài học đáng giá hơn mọi khoá học.

**Đọc postmortem**, của công ty mình và của các công ty công bố công khai. Đọc chậm, và ở mỗi bước tự hỏi: lúc này mình sẽ nghi ngờ cái gì?

**Tổ chức game day.** Cố ý gây lỗi trên staging: làm chậm database, cắt mạng tới một service, cho đối tác trả về lỗi, rồi để người khác trong team debug. Đây là cách luyện an toàn và rất hiệu quả.

**Làm quen với công cụ quan sát tầng thấp**: `EXPLAIN ANALYZE` và `pg_stat_activity` cho database, `pprof` cho Go, `stackprof` hay `rbspy` cho Ruby, `strace`, `tcpdump`, `ss` cho hệ điều hành và mạng. Không cần thành thạo hết, nhưng biết chúng tồn tại và trả lời được câu hỏi gì. Và biết hệ thống của mình có những [log, metric, trace](/blog/observability-go-vs-rails/) nào để nhìn vào lúc cần.

**Viết lại sự cố bằng lời của mình** sau mỗi lần debug xong: triệu chứng là gì, nguyên nhân là gì, cơ chế là gì, vì sao lúc đầu mình đoán sai. Phần cuối là phần học được nhiều nhất.

## Kết

AI sẽ ngày càng giỏi đọc stack trace. Nhưng stack trace chưa bao giờ là phần khó của debug. Phần khó là nhìn thấy hệ thống đằng sau nó: trạng thái, thời gian, các tầng, các bên khác, và chuỗi nhân quả nối chúng lại. Đó là [tư duy hệ thống](/blog/tu-duy-he-thong-thoi-ai/) áp vào lúc mọi thứ đang cháy.

Lần tới khi AI đưa bạn một bản sửa tự tin lúc mười một giờ đêm, hãy hỏi thêm một câu trước khi deploy: **cơ chế nào giải thích được mọi thứ mình đang thấy?** Nếu chưa trả lời được, bạn chưa tìm ra lỗi. Bạn mới chỉ tìm ra chỗ nó hiện ra.
