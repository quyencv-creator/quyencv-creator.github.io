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
