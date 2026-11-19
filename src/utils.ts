import { getCollection } from 'astro:content';

export async function getPosts() {
  const posts = await getCollection('blog', ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export const formatDate = (d: Date) =>
  d.toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });

export const url = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
