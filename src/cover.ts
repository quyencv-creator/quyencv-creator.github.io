// Thiết kế ảnh bìa dùng chung cho Cover.astro (SVG) và ảnh chia sẻ /og/<id>.png.
export const COVER_W = 1200;
export const COVER_H = 630;

type Theme = { from: string; to: string; accent: string; label: string };

// Nền tối, chữ trắng: tương phản tốt bất kể trang đang ở light hay dark mode.
const THEMES: Record<string, Theme> = {
  golang: { from: '#006d82', to: '#003a47', accent: '#7fe3f5', label: 'Golang' },
  python: { from: '#2f5f8f', to: '#16304d', accent: '#ffd43b', label: 'Python' },
  ruby: { from: '#9b1c23', to: '#4a0b10', accent: '#ffb3b8', label: 'Ruby' },
  thinking: { from: '#6131c4', to: '#2c1166', accent: '#d6c4ff', label: 'Thinking' },
};
const DEFAULT_THEME: Theme = { from: '#334155', to: '#0f172a', accent: '#fdba74', label: 'Blog' };

export const coverTheme = (tags: string[]): Theme => {
  const tag = tags[0];
  return THEMES[tag] ?? { ...DEFAULT_THEME, label: tag ? `#${tag}` : DEFAULT_THEME.label };
};

// Tách tiêu đề thành nhiều dòng theo số ký tự ước lượng; cắt bằng "…" nếu quá dài.
export function wrapTitle(title: string, maxChars = 26, maxLines = 4): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

export const titleFontSize = (lines: number) => (lines <= 2 ? 72 : lines === 3 ? 62 : 54);

// Màu nền cho ô tag: tag có theme riêng thì dùng theme, tag khác lấy màu theo mã băm của tên
// để mỗi tag luôn cùng một màu. Nền tối, chữ trắng: đọc được ở cả light và dark mode.
export function tagColors(tag: string): { from: string; to: string } {
  const theme = THEMES[tag];
  if (theme) return { from: theme.from, to: theme.to };
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return { from: `hsl(${h} 55% 29%)`, to: `hsl(${(h + 25) % 360} 60% 20%)` };
}
