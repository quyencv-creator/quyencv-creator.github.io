export const SITE_TITLE = 'Blog của Quyền';
export const SITE_DESCRIPTION = 'Ghi chép về lập trình, công cụ và những điều học được.';

// Tag ngôn ngữ cố định: hiện trên menu và luôn có trang /tags/<tag>/ kể cả khi chưa có bài.
// Quy ước: viết thường, không dấu; dùng "golang" (không dùng "go"); bài Rails gắn "ruby" (+ "rails").
export const LANGUAGE_TAGS = [
  { tag: 'golang', label: 'Golang' },
  { tag: 'python', label: 'Python' },
  { tag: 'ruby', label: 'Ruby' },
] as const;

export const POSTS_PER_PAGE = 10;

// Google Analytics 4: điền Measurement ID dạng "G-XXXXXXXXXX". Để trống thì không nhúng script.
export const GA_MEASUREMENT_ID = 'G-73BKB046SZ';

// Tên hiển thị cho tag: viết hoa đúng chuẩn (AI, DevOps, SRE...). Tag không có trong bảng sẽ được viết hoa chữ đầu.
export const TAG_LABELS: Record<string, string> = {
  golang: 'Golang', python: 'Python', ruby: 'Ruby', rails: 'Ruby on Rails',
  ai: 'AI', backend: 'Backend', thinking: 'Tư duy', architecture: 'Kiến trúc',
  devops: 'DevOps', career: 'Sự nghiệp', redis: 'Redis', concurrency: 'Concurrency',
  database: 'Database', performance: 'Hiệu năng', observability: 'Observability', cache: 'Cache',
  sre: 'SRE', solid: 'SOLID', sidekiq: 'Sidekiq', security: 'Bảo mật', robotics: 'Robotics',
  production: 'Production', 'outbox-pattern': 'Outbox Pattern', middleware: 'Middleware',
  microservices: 'Microservices', ecommerce: 'E-commerce', docker: 'Docker',
  'design-principles': 'Nguyên lý thiết kế', 'background-job': 'Background Job', asynq: 'Asynq',
};

// Mô tả ngắn cho các chủ đề chính, hiện ở đầu trang tag.
export const TAG_DESCRIPTIONS: Record<string, string> = {
  golang: 'Go trong thực tế: concurrency, middleware, background job, cache và những cái bẫy khi lên production.',
  python: 'Python cho backend và AI: FastAPI, RAG và cách tổ chức dự án.',
  ruby: 'Ruby và Rails: service object, xử lý đồng thời, Sidekiq và những vấn đề khi hệ thống lớn dần.',
  rails: 'Ruby on Rails ở quy mô thật: locking, Sidekiq, service object, load test.',
  ai: 'Làm phần mềm trong thời AI: dùng AI thế nào cho đúng, và kỹ năng nào vẫn thuộc về con người.',
  backend: 'Thiết kế và vận hành hệ thống backend: dữ liệu, cache, hàng đợi, độ tin cậy.',
  thinking: 'Suy ngẫm về nghề: cách đặt câu hỏi, tư duy hệ thống, và nghề dev đang đổi thay ra sao.',
  architecture: 'Kiến trúc phần mềm và những đánh đổi đằng sau mỗi quyết định.',
  devops: 'Vận hành hệ thống: load test, observability, on-call, postmortem.',
  career: 'Sự nghiệp của người làm phần mềm khi ngành đang thay đổi.',
  redis: 'Redis trong thực tế: Lua script, cache, bảng xếp hạng, flash sale.',
  database: 'Database: locking, transaction và những lỗi chỉ hiện ra dưới tải.',
};

export const tagLabel = (tag: string) => TAG_LABELS[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1);
