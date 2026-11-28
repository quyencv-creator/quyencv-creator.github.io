import { getPosts, formatDate } from '../utils';
import { tagLabel } from '../consts';

// Chuyển markdown thành văn bản thuần để tìm kiếm: giữ nội dung code, bỏ ký hiệu định dạng.
function plain(md) {
  return md
    .replace(/```[^\n]*\n/g, '\n')
    .replace(/```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*`|]/g, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET() {
  const posts = await getPosts();
  const items = posts.map((p) => ({
    id: p.id,
    t: p.data.title,
    d: p.data.description,
    g: p.data.tags.map(tagLabel),
    tg: p.data.tags,
    dt: formatDate(p.data.pubDate),
    b: plain(p.body ?? ''),
  }));
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
}
