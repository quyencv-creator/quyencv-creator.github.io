---
title: "Khi AI viết code mà không ai đọc nổi: 8 kịch bản cho nghề dev và cuộc đua token"
description: Code không ai hiểu là code lỗi, dù AI viết nhanh đến đâu. Tám kịch bản cho 5–10 năm tới, từ AI làm junior siêu tốc đến cuộc đua token, kèm dấu hiệu để tự quan sát và việc dev nên làm.
pubDate: 2026-08-18
tags: [ai, thinking, career]
---

Chiều thứ Sáu, một PR 2.000 dòng nằm trong hàng đợi review. Người mở PR ghi mô tả đúng một dòng: "Refactor payment module, generated with AI, all tests pass." Reviewer mở diff, cuộn được khoảng ba trăm dòng thì bắt đầu đọc lướt. Có mấy lớp abstraction lạ, một cái retry tự viết lồng trong một cái retry khác, vài đoạn xử lý lỗi nuốt exception rồi trả về giá trị mặc định. CI xanh. Sprint còn hai ngày. Anh bấm approve, để lại comment "LGTM", rồi đi về.

Không ai trong câu chuyện này lười. Người mở PR tin vào test. Reviewer tin vào người mở PR. Cả hai cùng tin vào AI. Và kết quả là một module thanh toán mà, tính từ chiều thứ Sáu đó, **không còn ai trong công ty thật sự hiểu**.

Tình huống này đang diễn ra ở rất nhiều team, và nó đặt ra một câu hỏi khó chịu hơn câu "AI có thay thế dev không": khi AI viết phần lớn code, thậm chí viết đến mức con người không còn đọc nổi, thì dev làm gì?

## Code không ai đọc hiểu được là code lỗi

Mình muốn nói thẳng điều này trước khi bàn tới bất kỳ kịch bản nào: **code không ai đọc hiểu được là code lỗi**, kể cả khi nó chạy. Nó không phải code "xịn" mà con người chưa theo kịp. Nó là một khoản nợ chưa tới hạn.

Code tồn tại để được sửa. Phần lớn chi phí của một hệ thống nằm ở giai đoạn bảo trì, không phải lúc viết ra. Một đoạn code mà không ai giải thích được vì sao nó đúng thì cũng không ai dám sửa, không ai debug được lúc 2 giờ sáng, và không ai chịu trách nhiệm được khi nó tính sai tiền của khách hàng. "Test pass" chỉ chứng minh code đúng với những trường hợp mà ai đó đã nghĩ tới. Phần nguy hiểm luôn nằm ở những trường hợp không ai nghĩ tới.

Vì vậy dev có **quyền** và có **trách nhiệm** từ chối merge. Không phải vì ghét AI, mà vì bấm approve là ký tên. Nếu bạn không hiểu thứ mình đang ký, thì comment đúng nhất không phải "LGTM" mà là "Tôi không hiểu đoạn này, hãy tách nhỏ và viết lại cho đơn giản hơn". Câu này đáng giá hơn mọi prompt.

## "Nhưng mình đâu có đọc mã máy do compiler sinh ra?"

Đây là lập luận phổ biến nhất của phe "cứ để AI viết": chẳng ai đọc assembly mà compiler sinh ra, vậy tại sao phải đọc code do AI sinh ra? AI chỉ là một tầng trừu tượng mới.

So sánh này sai ở một điểm nền tảng. Compiler là **deterministic**: cùng một đoạn source, cùng phiên bản, cùng cờ biên dịch, ra cùng một kết quả. Nó có ngữ nghĩa được đặc tả, có bộ test khổng lồ, và đã được kiểm chứng qua hàng chục năm dùng thực tế. Khi compiler có bug, đó là tin tức. Còn LLM thì cùng một prompt có thể cho ra hai đoạn code khác nhau, không có đặc tả hình thức nào ràng buộc output, và khi nó sai thì sai một cách rất tự tin.

Chúng ta không đọc assembly vì đã có một chuỗi bảo đảm đứng giữa source và mã máy. Giữa yêu cầu của bạn và code do AI viết thì chưa có chuỗi bảo đảm đó. Chừng nào AI chưa đạt độ tin cậy như compiler, vẫn phải có một con người hiểu code và chịu trách nhiệm về nó.

## Vai trò của dev dịch chuyển về đâu

Nếu không còn gõ phần lớn code, dev làm năm việc mà AI hiện chưa làm thay được một cách đáng tin.

Thứ nhất là **định nghĩa vấn đề**. AI giỏi giải bài toán đã được nói rõ, nhưng rất tệ ở việc nhận ra bài toán bị nói sai. "Thêm nút export CSV" có khi thực chất là "kế toán cần đối soát cuối tháng", và lời giải đúng là một báo cáo, không phải một cái nút. Thứ hai là **kiến trúc và trade-off**: chọn nhất quán hay sẵn sàng, chọn đơn giản hôm nay hay linh hoạt năm sau, chọn công nghệ team vận hành nổi. Những quyết định này phụ thuộc vào ngữ cảnh mà không prompt nào chứa hết. Thứ ba là **verify và test**: thiết kế test bắt được trường hợp biên, viết property test, đọc code để tìm chỗ sai chứ không phải để gật đầu. Thứ tư là **ép AI viết code đơn giản**: từ chối abstraction thừa, bắt tách nhỏ, bắt đặt tên rõ ràng. Thứ năm là **debug hệ thống thật**, nơi lỗi nằm ở tương tác giữa network, database, cache, cấu hình và dữ liệu bẩn trên production, không nằm gọn trong một file.

Còn một điều chắc chắn ở mọi kịch bản phía dưới: **kỹ năng chỉ gõ code đúng cú pháp sẽ mất giá**. Không phải về 0, nhưng nó sẽ không còn là lý do để ai đó trả lương cho bạn.

## Nhóm A: nghề dev

### 1. AI là junior siêu nhanh

Đây là kịch bản khả thi nhất, và ở nhiều nơi nó đã bắt đầu. AI làm việc như một junior không biết mệt: viết nhanh, viết nhiều, đôi khi sai một cách ngớ ngẩn, cần người kèm. Team cần ít người hơn cho cùng một khối lượng việc, và công việc của senior chuyển từ viết sang review, từ "làm" sang "kiểm".

Người thiệt nhất trong kịch bản này là junior thật. Những việc dễ, như viết CRUD, sửa bug nhỏ, viết test cho hàm đơn giản, từng là con đường để người mới học nghề. Giờ AI làm hết những việc đó. Vấn đề là senior không tự nhiên sinh ra; họ là junior của mười năm trước. Một ngành cắt hết cửa vào nghề sẽ thiếu người giỏi sau một thập kỷ.

**Dấu hiệu:** tin tuyển dụng junior giảm trong khi tin tuyển senior vẫn giữ [cần dẫn nguồn]; team của bạn nói "không cần tuyển thêm, có AI rồi".

**Dev nên làm gì:** nếu là junior, đừng chỉ học viết code, hãy học đọc code và giải thích vì sao code đúng. Nếu là senior, hãy giữ lại một phần việc vừa sức cho junior, dù AI làm nhanh hơn.

### 2. Code dùng xong bỏ

Với phần mềm rủi ro thấp như tool nội bộ, landing page, script xử lý dữ liệu một lần, hay prototype, việc bảo trì code có thể trở nên vô nghĩa. Thay vì sửa, người ta sinh lại toàn bộ từ spec và bộ test. Code thành thứ dùng xong bỏ, giống như một file build.

Trong kịch bản này, tài sản thật không còn là code mà là **spec, contract và test**. Ai viết được spec rõ ràng, định nghĩa được contract giữa các thành phần, và có bộ test đủ chặt để code sinh lại vẫn đúng, người đó nắm giá trị. Còn code thì chẳng ai quý nữa.

**Dấu hiệu:** team bắt đầu lưu prompt và spec trong repo như tài liệu chính; có những service được "viết lại từ đầu" mỗi quý mà không ai thấy tiếc.

**Dev nên làm gì:** luyện viết spec và test như luyện một kỹ năng chính, vì một spec mơ hồ sẽ cho ra code sai một cách nhất quán.

### 3. Nợ kỹ thuật bùng nổ

Đây là kịch bản của chiều thứ Sáu ở đầu bài, nhân lên hàng nghìn lần. Áp lực tốc độ khiến team merge code không ai hiểu. Mỗi PR riêng lẻ đều có vẻ ổn, CI đều xanh. Nhưng vài năm sau, hệ thống là một khối code mà không ai dám chạm vào, sửa một chỗ thì hỏng ba chỗ, và chính AI cũng không gỡ được vì context không đủ chứa cả hệ thống.

Nghe bi quan, nhưng có một mặt khác: người gỡ được đống đó sẽ cực kỳ có giá. Giống như thợ COBOL hiện nay, những người hiếm hoi còn hiểu các hệ thống ngân hàng cũ và được trả lương cao chính vì không ai khác làm được.

**Dấu hiệu:** thời gian sửa một bug nhỏ ngày càng dài; câu "đừng đụng vào module đó" xuất hiện nhiều hơn trong các cuộc họp.

**Dev nên làm gì:** rèn kỹ năng đọc và refactor code lạ, code xấu, code không có tài liệu, vì đó sẽ là kỹ năng khan hiếm.

### 4. AI tin cậy như compiler

Đây là kịch bản xa nhất, và có thể không xảy ra trong 5–10 năm tới. AI không chỉ viết code mà còn tự chứng minh code đúng: sinh kèm bằng chứng hình thức, hoặc được kiểm chứng tới mức độ tin cậy ngang compiler. Lúc đó, lập luận "không cần đọc code" mới thật sự đứng vững.

Nếu kịch bản này đến, giá trị của dev chuyển hẳn sang **hiểu bài toán kinh doanh**: biết khách hàng cần gì, biết quy trình nghiệp vụ vận hành ra sao, biết đặt yêu cầu sao cho đúng. Dev lúc đó gần với một kỹ sư hệ thống hoặc chuyên gia nghiệp vụ hơn là người viết code.

**Dấu hiệu:** các công cụ formal verification bắt đầu được dùng phổ biến ngoài giới học thuật và hệ thống an toàn cao; các tổ chức kiểm định bắt đầu chấp nhận code do AI sinh mà không cần con người review.

**Dev nên làm gì:** đầu tư vào hiểu biết nghiệp vụ của ngành mình đang làm, vì đó là thứ AI không tự học được từ GitHub.

## Nhóm B: cuộc đua token

### 5. Token thành hóa đơn cloud mới

Mười năm trước, nhiều công ty giật mình khi nhìn hóa đơn AWS, và từ đó sinh ra cả một nghề tên là FinOps. Token đang đi đúng con đường đó. Khi agent tự chạy hàng trăm lượt gọi model cho một tác vụ, chi phí không còn là chuyện nhỏ.

Kỹ năng mới xuất hiện: chọn model theo độ khó của việc (không dùng model mạnh nhất để đổi tên biến), tận dụng prompt caching, và **context engineering**, tức là quyết định đưa gì vào context và bỏ gì ra để model vừa đủ thông tin mà không tốn thừa. Đây là một kỹ năng thật, không phải trò viết prompt hoa mỹ.

**Dấu hiệu:** công ty bắt đầu có dashboard chi phí AI theo team; có người được giao nhiệm vụ "tối ưu chi phí LLM".

**Dev nên làm gì:** biết rõ một tác vụ của mình tốn bao nhiêu token và vì sao, giống như biết một query tốn bao nhiêu thời gian.

### 6. Token rẻ như điện

Kịch bản ngược lại: giá token giảm mạnh tới mức gần như không ai tính. Lúc đó cách làm thay đổi. Thay vì nghĩ kỹ một lời giải, người ta cho AI chạy song song mười hướng giải, rồi chọn hướng tốt nhất. Brute force thắng sự khéo léo.

Nhưng brute force chuyển điểm nghẽn sang **khâu verify**. Mười lời giải thì phải có cách biết lời giải nào đúng, và cách đó phải tự động, nhanh, đáng tin. Team nào có bộ test và hệ thống đánh giá tốt sẽ tận dụng được token rẻ; team nào không có thì chỉ có thêm mười lời giải không biết chọn cái nào. Và đừng tưởng hóa đơn sẽ giảm. Nghịch lý Jevons cho thấy khi một tài nguyên rẻ đi, người ta dùng nó nhiều hơn tới mức tổng chi phí có thể vẫn tăng. Than đá rẻ hơn không làm nước Anh thế kỷ 19 đốt ít than hơn.

**Dấu hiệu:** giá mỗi triệu token giảm liên tục qua các thế hệ model [cần dẫn nguồn]; công cụ bắt đầu mặc định chạy nhiều lần sinh song song.

**Dev nên làm gì:** đầu tư vào hạ tầng verify: test, eval, môi trường chạy thử, vì đó là thứ quyết định token rẻ có thành giá trị hay không.

### 7. Đua token như đua KPI số dòng code

Ngành phần mềm từng đo năng suất bằng số dòng code và đã trả giá cho điều đó: người ta viết dài hơn chứ không viết tốt hơn. Kịch bản này là phiên bản mới của sai lầm cũ. Công ty đo "mức độ dùng AI" bằng số token, số lượt gọi, phần trăm code do AI sinh. Dev hiểu luật chơi và đốt token cho đẹp số liệu.

Kết quả đi thẳng về kịch bản 3. Khi chỉ số là lượng token chứ không phải kết quả, sẽ có thêm nhiều code hơn, nhiều PR hơn, và ít người hiểu hệ thống hơn. Định luật Goodhart vẫn đúng: khi một thước đo trở thành mục tiêu, nó không còn là thước đo tốt.

**Dấu hiệu:** buổi đánh giá hiệu suất có mục "mức độ sử dụng AI"; có bảng xếp hạng ai dùng AI nhiều nhất.

**Dev nên làm gì:** nếu bị đo bằng token, hãy chủ động đề xuất đo bằng kết quả, và đừng bao giờ đánh đổi khả năng hiểu code để lấy số đẹp.

### 8. Phân tầng theo túi tiền

Công ty lớn ký hợp đồng lớn, dùng model mạnh nhất, chạy agent không giới hạn. Team nhỏ ở Việt Nam, startup, outsource biên lợi nhuận mỏng thì phải tính từng đồng: tự host model mã nguồn mở, dùng model nhỏ, hoặc giới hạn số lượt gọi. Khoảng cách năng suất giữa hai nhóm có thể nới rộng.

Nhưng bị ép tối ưu lại tạo ra một lợi thế ngầm. Người biết chạy model nhỏ cho tốt, biết chia việc để model rẻ làm được, biết tự host và vận hành, sẽ có kỹ năng mà người chỉ quen gọi API model mạnh nhất không có. Giống như dev từng làm việc với phần cứng yếu thường viết code hiệu quả hơn.

**Dấu hiệu:** sự chênh lệch rõ ràng giữa công cụ AI ở công ty lớn và công ty nhỏ; nhu cầu tự host model trong nước tăng, nhất là ở các ngành có yêu cầu dữ liệu không ra nước ngoài.

**Dev nên làm gì:** học cách làm được việc với model nhỏ và hạ tầng tự vận hành, vì đó là kỹ năng mà túi tiền lớn không mua thay được.

## Các kịch bản không loại trừ nhau

Đọc tới đây, đừng cố đoán kịch bản nào sẽ "thắng". Chúng có thể diễn ra song song, thậm chí trong cùng một công ty. Một ngân hàng có thể đang ở kịch bản 1 với hệ thống lõi, kịch bản 2 với tool nội bộ, và kịch bản 7 trong phòng nhân sự. Một startup có thể vừa ở kịch bản 8 vì thiếu tiền, vừa trượt dần vào kịch bản 3 vì áp lực ra sản phẩm. Câu hỏi đúng không phải "tương lai sẽ là kịch bản nào" mà là "công ty mình, team mình đang ở kịch bản nào, và đang trượt về hướng nào".

## Đo chi phí cho mỗi kết quả đúng

Nếu chỉ giữ lại một điều từ bài này, hãy giữ điều này: **đừng đo token, hãy đo chi phí cho mỗi kết quả đúng**. Một tính năng đúng, chạy ổn trên production, không phải quay lại sửa ba lần, tốn tổng cộng bao nhiêu: token, giờ review, giờ debug, giờ xử lý sự cố. Đo theo cách đó, code AI sinh nhanh mà không ai hiểu sẽ lộ ra đúng giá của nó, và code đơn giản, dễ verify sẽ thắng.

Còn với bản thân, hãy đầu tư vào hai thứ mà mọi kịch bản trên đều cần: **khả năng hiểu hệ thống** và **khả năng verify**. Đọc code người khác viết, kể cả code xấu. Viết test bắt được lỗi thật. Debug tới tận gốc thay vì vá triệu chứng. Và lần tới khi gặp một PR 2.000 dòng mà bạn không hiểu, đừng bấm approve. Hãy viết: "Tôi không hiểu đoạn này." Đó không phải là thừa nhận yếu kém. Đó là việc của một kỹ sư.
