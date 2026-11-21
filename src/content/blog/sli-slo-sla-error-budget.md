---
title: "SLI, SLO, SLA và error budget: đặt SLO đầu tiên cho service của bạn"
description: "Phân biệt SLI, SLO, SLA, error budget qua một API checkout thật: chọn SLI, đặt SLO, viết PromQL và alert theo burn rate."
pubDate: 2026-11-21
tags: [sre, observability, backend]
---

Service của bạn có dashboard Grafana, CPU xanh, memory xanh. Vậy mà người dùng vẫn than "thanh toán hay bị lỗi". Ai đúng?

Người dùng đúng. CPU không nói gì về trải nghiệm của họ. SLI, SLO và error budget là cách đo **đúng thứ người dùng cảm nhận**, và dùng con số đó để ra quyết định.

Cả bài dùng một ví dụ: **API checkout** (`POST /checkout`) của một shop, khoảng **10 triệu request mỗi tháng**.

## 1. Bốn khái niệm trong một ví dụ

Sếp hỏi: "Checkout có ổn không?". Trả lời theo bốn tầng:

| Khái niệm | Câu trả lời cho checkout | Là gì |
|---|---|---|
| **SLI** | Tháng này 99,95% request trả về thành công | Con số **đo được** |
| **SLO** | Mục tiêu: ít nhất 99,9% request thành công trong 30 ngày | **Mục tiêu nội bộ** cho SLI |
| **Error budget** | Được phép lỗi 0,1%, tức khoảng 10.000 request mỗi tháng | Phần **được phép hỏng**: 100% − SLO |
| **SLA** | Hợp đồng với đối tác: dưới 99,5% thì hoàn 10% phí | **Cam kết có hậu quả** (tiền, hợp đồng) |

Định nghĩa ngắn:

- **SLI** (Service Level Indicator): tỉ lệ sự kiện tốt trên tổng sự kiện. `request tốt / tổng request`.
- **SLO** (Service Level Objective): ngưỡng mục tiêu cho SLI, trong một khoảng thời gian.
- **Error budget**: `1 − SLO`. SLO 99,9% thì budget là 0,1%.
- **SLA** (Service Level Agreement): SLO được ghi vào hợp đồng, vi phạm thì phải đền.

Quan hệ quan trọng nhất: **SLA phải lỏng hơn SLO**. SLO là vạch báo động của team. SLA là vạch mất tiền. Phải chạm vạch báo động trước để còn kịp sửa.

## 2. SLO nghĩa là bao nhiêu phút downtime?

Quy đổi theo tháng 30 ngày (43.200 phút), giả sử lỗi xảy ra theo kiểu "sập hoàn toàn":

| SLO | Downtime cho phép mỗi tháng |
|---|---|
| 99% | 7 giờ 12 phút |
| 99,5% | 3 giờ 36 phút |
| 99,9% | 43 phút 12 giây |
| 99,95% | 21 phút 36 giây |
| 99,99% | 4 phút 19 giây |

Nhìn dòng 99,99%: 4 phút mỗi tháng. Một lần deploy lỗi, phát hiện và rollback chưa xong đã hết budget. Mỗi số 9 thêm vào đắt hơn rất nhiều so với số 9 trước đó.

## 3. Chọn SLI: đo thứ người dùng cảm nhận

Người dùng checkout quan tâm hai thứ:

1. **Có thành công không?** → **availability SLI**
2. **Có nhanh không?** → **latency SLI**

Không phải CPU, không phải số pod đang chạy, không phải "health check trả 200".

### Định nghĩa cụ thể

```
Availability SLI = request không trả 5xx / tổng request
Latency SLI      = request xong dưới 300ms / tổng request
```

Vài quyết định cần ghi rõ:

- **4xx không tính là lỗi.** Thẻ hết tiền, sai mã giảm giá là lỗi của người dùng, không phải của service.
- **Latency dùng tỉ lệ dưới ngưỡng**, không dùng trung bình. Trung bình giấu đi những người phải chờ 5 giây.
- **Đo ở đâu?** Càng gần người dùng càng tốt. Đo ở load balancer hoặc ingress sẽ bắt được cả lỗi khi pod chết, khi mạng nội bộ có vấn đề. Đo trong code ứng dụng thì app sập là… không còn metric nào để đo.

### PromQL

Giả sử có metric chuẩn `http_requests_total` và histogram `http_request_duration_seconds`:

```promql
# Availability SLI, 30 ngày
sum(rate(http_requests_total{job="checkout", code!~"5.."}[30d]))
/
sum(rate(http_requests_total{job="checkout"}[30d]))
```

```promql
# Latency SLI: tỉ lệ request dưới 300ms, 30 ngày
sum(rate(http_request_duration_seconds_bucket{job="checkout", le="0.3"}[30d]))
/
sum(rate(http_request_duration_seconds_count{job="checkout"}[30d]))
```

Lưu ý: `le="0.3"` phải là một bucket **có thật** trong histogram. Không có bucket 0.3 thì thêm vào lúc khai báo metric, đừng nội suy.

## 4. Đặt SLO đầu tiên

Đừng bắt đầu bằng con số mơ ước. Làm theo thứ tự:

1. **Xem SLI thật của 4 tuần gần nhất.** Giả sử checkout đang đạt 99,95% availability, 99,3% request dưới 300ms.
2. **Đặt SLO thấp hơn mức hiện tại một chút**, vừa đủ để người dùng hài lòng:
   - Availability: **99,9%** trong 30 ngày.
   - Latency: **99%** request dưới **300ms** trong 30 ngày.
3. **Hỏi lại người dùng (hoặc product)**: mức này đã đủ tốt chưa? Nếu khách vẫn than ở mức 99,9% thì SLI đang đo sai chỗ, hoặc SLO quá lỏng.
4. **Xem lại sau 1–3 tháng.** SLO không phải khắc lên đá.

Dùng **cửa sổ trượt 30 ngày** thay vì "theo tháng dương lịch". Lỗi ngày 30 không được "xoá sổ" vào ngày 1.

## 5. Error budget: biến SLO thành quyết định

Với checkout:

```
Error budget = (1 − 0,999) × 10.000.000 request = 10.000 request lỗi / 30 ngày
```

10.000 request lỗi là **ngân sách để tiêu**. Tiêu vào deploy tính năng mới, thử nghiệm, migrate database, nâng cấp hạ tầng. Mỗi thứ đều có rủi ro làm hỏng một ít request.

Đây là chỗ error budget có giá trị: nó trả lời câu hỏi muôn thuở **"nên release tiếp hay nên ổn định lại?"** bằng một con số, thay vì bằng cảm giác hay ai nói to hơn.

- **Còn nhiều budget** → cứ release, cứ thử. Service đang ổn hơn mức cần.
- **Sắp hết budget** → chậm lại, ưu tiên độ ổn định.
- **Hết budget** → dừng thay đổi rủi ro, sửa cho xong.

## 6. Alert theo burn rate, không theo ngưỡng tĩnh

Alert kiểu "error rate > 1% trong 5 phút" có hai vấn đề:

- 1% lỗi trong 5 phút lúc 3 giờ sáng: báo thức dậy, nhưng nó chỉ tiêu 0,01% budget. Báo động giả.
- 0,2% lỗi kéo dài cả tuần: không bao giờ chạm ngưỡng 1%, nhưng âm thầm đốt sạch budget.

**Burn rate** đo **tốc độ tiêu budget**:

```
burn rate = error rate hiện tại / error rate cho phép (0,1%)
```

- Burn rate **1**: tiêu đúng tốc độ, hết budget vừa đúng 30 ngày.
- Burn rate **14,4**: hết budget trong 30 / 14,4 ≈ **2 ngày**.

Google SRE Workbook (chương 5, *Alerting on SLOs*) đề xuất **multi-window, multi-burn-rate**: mỗi alert kiểm tra một cửa sổ dài (để chắc là thật) **và** một cửa sổ ngắn (để alert tắt nhanh khi đã hết lỗi).

| Mức | Burn rate | Cửa sổ dài | Cửa sổ ngắn | Budget đã tiêu khi báo | Hành động |
|---|---|---|---|---|---|
| Page | 14,4 | 1 giờ | 5 phút | 2% | Gọi người trực ngay |
| Page | 6 | 6 giờ | 30 phút | 5% | Gọi người trực ngay |
| Ticket | 1 | 3 ngày | 6 giờ | 10% | Xử lý trong giờ làm việc |

### Prometheus rules

```yaml
groups:
  - name: checkout-sli
    rules:
      # Tỉ lệ lỗi theo từng cửa sổ (lặp lại cho 30m, 1h, 6h, 3d)
      - record: checkout:error_ratio:rate5m
        expr: |
          sum(rate(http_requests_total{job="checkout", code=~"5.."}[5m]))
          /
          sum(rate(http_requests_total{job="checkout"}[5m]))
      # ... checkout:error_ratio:rate30m, rate1h, rate6h, rate3d tương tự

  - name: checkout-slo-alerts
    rules:
      # SLO 99.9% → error budget = 0.001
      - alert: CheckoutErrorBudgetBurnFast
        expr: |
          (
            checkout:error_ratio:rate1h > (14.4 * 0.001)
            and
            checkout:error_ratio:rate5m > (14.4 * 0.001)
          )
          or
          (
            checkout:error_ratio:rate6h > (6 * 0.001)
            and
            checkout:error_ratio:rate30m > (6 * 0.001)
          )
        labels:
          severity: page
        annotations:
          summary: "Checkout đang đốt error budget quá nhanh"

      - alert: CheckoutErrorBudgetBurnSlow
        expr: |
          checkout:error_ratio:rate3d > (1 * 0.001)
          and
          checkout:error_ratio:rate6h > (1 * 0.001)
        labels:
          severity: ticket
        annotations:
          summary: "Checkout đốt error budget đều đều, cần xem trong giờ làm việc"
```

Mình đã kiểm tra bộ rule này bằng `promtool test rules`: giả lập 2% lỗi liên tục thì `CheckoutErrorBudgetBurnFast` bắn sau 90 phút; giả lập 0,05% lỗi (trong SLO) thì không có alert nào.

Latency SLO làm y hệt, thay "request lỗi" bằng "request chậm hơn 300ms" và budget 0,01 (vì SLO 99%).

## 7. Khi budget cạn: một tháng của checkout

Ngày 18 của cửa sổ 30 ngày, dashboard error budget của checkout:

| Sự kiện | Request lỗi | Budget đã dùng |
|---|---|---|
| Database failover, checkout lỗi hoàn toàn 25 phút | ~5.800 | 58% |
| Deploy lỗi, 2% request lỗi trong 3 giờ trước khi rollback | ~830 | 8% |
| Lỗi lặt vặt hằng ngày (~0,05%), 18 ngày | ~3.000 | 30% |
| **Tổng** | **~9.630** | **~96%** |

Còn 12 ngày, còn khoảng 370 request được phép lỗi. Tuần này team định release tính năng "thanh toán trả góp".

Không có error budget, cuộc họp sẽ là: product muốn release, dev thấy hơi lo, cuối cùng ai thâm niên hơn thắng. Có error budget, câu trả lời có sẵn trong **policy** mà mọi người đã đồng ý từ trước:

- Budget dưới 10% → **dừng release tính năng**, chỉ deploy bản sửa lỗi và cải thiện độ ổn định.
- 58% budget đi vào một sự cố failover → ưu tiên số một là **làm cho failover nhanh hơn**, không phải thêm tính năng.
- "Trả góp" dời sang khi cửa sổ 30 ngày trượt qua sự cố failover và budget hồi lại.

Quyết định không dễ chịu, nhưng **không ai phải cãi nhau**. Con số đã nói thay.

## 8. Error budget policy mẫu

Viết ngắn, được cả dev, SRE và product ký đồng ý **trước** khi có sự cố:

```markdown
# Error budget policy: Checkout API

SLO: 99,9% availability, 99% request < 300ms, cửa sổ trượt 30 ngày.

## Còn trên 50% budget
- Release bình thường.
- Được làm thử nghiệm có rủi ro (migrate, đổi hạ tầng) sau khi báo trước.

## Còn 10–50% budget
- Release bình thường nhưng bắt buộc canary và có kế hoạch rollback.
- Postmortem cho mọi sự cố tiêu trên 20% budget.

## Còn dưới 10% hoặc đã hết budget
- Dừng release tính năng. Chỉ deploy bản sửa lỗi, cải thiện độ ổn định, bản vá bảo mật.
- Ít nhất một người trong team dành toàn thời gian cho việc ổn định.
- Mở lại release khi budget về trên 10%.

## Ngoại lệ
- Một sự cố đơn lẻ tiêu trên 20% budget: bắt buộc postmortem, action item ưu tiên cao nhất.
- Lỗi do phụ thuộc bên ngoài (cổng thanh toán): vẫn tính vào budget, nhưng hành động là
  thêm fallback/timeout, không phải dừng release.
- Tranh chấp: trưởng nhóm kỹ thuật và product quyết định cùng nhau.
```

## 9. Sai lầm thường gặp

**SLO 100% hoặc quá cao.** 100% nghĩa là budget bằng 0: không được deploy, không được restart, không được nâng cấp gì. Không hệ thống nào đạt được, và người dùng cũng không phân biệt được 99,99% với 100%, vì mạng điện thoại của họ còn chập chờn hơn thế. Google SRE Book (chương 3, *Embracing Risk*) giải thích kỹ lý do 100% là mục tiêu sai.

**Đo SLI ở chỗ không phản ánh người dùng.** Health check `/healthz` luôn trả 200 trong khi checkout lỗi vì database. Hoặc đo trong app, nên khi app sập thì metric cũng biến mất và SLI trông vẫn đẹp. Đo ở load balancer, hoặc dùng synthetic check gọi đúng luồng người dùng.

**SLA chặt hơn SLO.** Hứa với khách 99,95% nhưng team chỉ đặt mục tiêu 99,9%. Tức là team "đạt SLO" trong khi công ty đang phải đền tiền. SLA luôn lỏng hơn SLO.

**Có SLO nhưng không ai dùng.** SLO nằm trên một dashboard không ai mở, budget hết mà release vẫn chạy như thường. Khi đó SLO chỉ là trang trí. Không có error budget policy được đồng ý trước thì SLO không có tác dụng.

**Quá nhiều SLO.** 15 SLO cho một service, mỗi endpoint một cái. Không ai nhớ, không ai theo dõi. Bắt đầu với **1–2 SLO cho mỗi hành trình quan trọng** của người dùng (checkout, đăng nhập), thêm dần khi thật sự cần.

## Checklist: áp dụng ngay tuần này

- [ ] Chọn **một** luồng quan trọng nhất của service (ví dụ checkout).
- [ ] Viết định nghĩa availability SLI và latency SLI, ghi rõ "request tốt" là gì.
- [ ] Đo ở load balancer/ingress nếu được; kiểm tra histogram có bucket đúng ngưỡng latency.
- [ ] Chạy PromQL lấy SLI của 4 tuần gần nhất.
- [ ] Đặt SLO thấp hơn mức hiện tại một chút, cửa sổ trượt 30 ngày.
- [ ] Tạo dashboard "error budget còn lại".
- [ ] Thay alert ngưỡng tĩnh bằng alert multi-window multi-burn-rate.
- [ ] Viết error budget policy một trang, lấy chữ ký của dev, SRE, product.
- [ ] Đặt lịch xem lại SLO sau 1 tháng.

Tài liệu gốc nên đọc: Google SRE Book, chương 3 (*Embracing Risk*) và chương 4 (*Service Level Objectives*); Google SRE Workbook, chương 2 (*Implementing SLOs*) và chương 5 (*Alerting on SLOs*).

---

**Các phương án tiêu đề khác:**

1. Error budget: con số giúp team ngừng cãi nhau về chuyện release
2. Từ SLI tới burn rate alert: đặt SLO cho API checkout trong một buổi chiều
3. 99,9% nghĩa là gì? SLI, SLO, SLA và error budget cho backend developer
