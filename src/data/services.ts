// TODO: điền BOOKING_URL bằng link Google Calendar Appointment hoặc Cal.com (để trống thì nút Đặt lịch bị ẩn),
// ví dụ https://calendar.app.google/xxxx hoặc https://cal.com/<username>/<event>
export const BOOKING_URL = {
  'it-support': '',
  mentoring: '',
} as const;

export interface Service {
  slug: keyof typeof BOOKING_URL;
  title: string;
  summary: string;
  audience: string[];
  scope: string[];
  outOfScope: string[];
  price: string;
  duration: string;
  format: string;
  /** Kết quả người dùng nhận được sau buổi, hiện trên trang chủ và trang dịch vụ. */
  outcome: string;
  /** Biểu tượng: tên lớp .lp-icon (mentor, wrench, spark, db, pulse). */
  icon: string;
  faq: { q: string; a: string }[];
}

/** Giá hiển thị: "Contact" nghĩa là báo giá riêng. */
export const priceLabel = (price: string) => (price.trim().toLowerCase() === 'contact' ? 'Liên hệ báo giá' : price);

export const services: Service[] = [
  {
    slug: 'it-support',
    title: 'IT support online 1-1',
    summary: 'Gọi video 1-1 để chẩn đoán và khắc phục sự cố phần mềm trên máy tính của bạn.',
    audience: [
      'Người dùng cá nhân gặp lỗi phần mềm, máy chậm, không cài được ứng dụng.',
      'Freelancer, văn phòng nhỏ chưa có bộ phận IT riêng.',
      'Developer bị kẹt khi cài đặt môi trường: Docker, WSL, Node, Go, Python, Git.',
    ],
    scope: [
      'Cài đặt, cấu hình và gỡ lỗi phần mềm trên Windows, macOS, Linux.',
      'Lỗi Docker, WSL2, Git, SSH key, biến môi trường, PATH.',
      'Máy chậm, đầy ổ đĩa, khởi động lâu, ứng dụng bị treo.',
      'Cấu hình email, trình duyệt, VPN, máy in mạng cơ bản.',
      'Hướng dẫn sao lưu dữ liệu và các bước phòng tránh lỗi tái diễn.',
    ],
    outOfScope: [
      'Sửa chữa phần cứng, thay linh kiện.',
      'Bẻ khoá, cài phần mềm không bản quyền.',
      'Khôi phục dữ liệu từ ổ cứng hỏng vật lý.',
    ],
    price: 'Contact',
    duration: '60 phút',
    outcome: 'Máy và môi trường làm việc chạy lại, kèm các bước để lỗi không quay lại.',
    icon: 'wrench',
    format: 'Google Meet hoặc Zoom, chia sẻ màn hình (có thể điều khiển từ xa nếu bạn đồng ý).',
    faq: [
      {
        q: 'Nếu không sửa được lỗi trong buổi thì sao?',
        a: 'Nếu chưa xác định được nguyên nhân, mình sẽ ghi lại các bước đã thử và đề xuất hướng tiếp theo.',
      },
      {
        q: 'Có cần cài phần mềm điều khiển từ xa không?',
        a: 'Không bắt buộc. Mặc định mình hướng dẫn qua chia sẻ màn hình; chỉ dùng điều khiển từ xa khi bạn đồng ý và có thể ngắt bất cứ lúc nào.',
      },
      {
        q: 'Dữ liệu của tôi có an toàn không?',
        a: 'Mình không sao chép hay lưu dữ liệu của bạn. Bạn nên đóng các tài liệu nhạy cảm và tự nhập mật khẩu khi cần.',
      },
      {
        q: 'Thanh toán như thế nào?',
        a: '', // TODO: điền nội dung (để trống thì câu hỏi bị ẩn)
      },
      {
        q: 'Muốn đổi hoặc huỷ lịch thì sao?',
        a: 'Bạn có thể đổi lịch qua link trong email xác nhận.',
      },
    ],
  },
  {
    slug: 'mentoring',
    title: 'Mentor online 1-1 cho junior dev',
    summary: 'Buổi 1-1 định hướng, review code và gỡ rối kỹ thuật cho developer mới đi làm hoặc đang chuẩn bị đi làm.',
    audience: [
      'Sinh viên năm cuối, fresher đang tìm công việc developer đầu tiên.',
      'Junior dev 0–2 năm kinh nghiệm muốn tiến bộ nhanh hơn.',
      'Người chuyển ngành sang lập trình backend.',
    ],
    scope: [
      'Lộ trình học backend, Go, database, system design cơ bản.',
      'Review code, cấu trúc project, Pull Request theo chuẩn thực tế.',
      'Gỡ rối bug cụ thể bạn đang gặp trong project.',
      'Review CV, GitHub, chuẩn bị và phỏng vấn thử (mock interview).',
      'Kỹ năng làm việc: viết task, ước lượng, giao tiếp trong team, đọc code người khác.',
    ],
    outOfScope: [
      'Làm hộ bài tập, đồ án hoặc bài test tuyển dụng.',
      'Cam kết có việc làm sau khi mentor.',
    ],
    price: 'Contact',
    duration: '60 phút',
    outcome: 'Biết rõ mình cần học gì tiếp, code được review như ở team thật, tự tin hơn khi phỏng vấn.',
    icon: 'mentor',
    format: 'Google Meet, chia sẻ màn hình. Sau buổi có ghi chú tóm tắt và bài tập gợi ý.',
    faq: [
      {
        q: 'Tôi cần chuẩn bị gì trước buổi?',
        a: 'Gửi trước mục tiêu của buổi, link repo hoặc CV (nếu cần review) khi đặt lịch, để buổi tập trung vào đúng vấn đề.',
      },
      {
        q: 'Buổi mentor dùng ngôn ngữ, công nghệ nào?',
        a: 'Thế mạnh là backend với Go, PostgreSQL, Redis, Docker, AWS. Câu hỏi về định hướng, CV và kỹ năng làm việc thì không phụ thuộc ngôn ngữ.',
      },
      {
        q: 'Một buổi có đủ không?',
        a: 'Một buổi phù hợp để giải quyết một vấn đề cụ thể. Nếu muốn theo một lộ trình, gói nhiều buổi sẽ hiệu quả hơn.',
      },
      {
        q: 'Có hỗ trợ giữa các buổi không?',
        a: '', // TODO: điền nội dung (để trống thì câu hỏi bị ẩn)
      },
      {
        q: 'Muốn đổi hoặc huỷ lịch thì sao?',
        a: 'Bạn có thể đổi lịch qua link trong email xác nhận.',
      },
    ],
  },
];
