import { SERIES } from './consts';
import { getPosts } from './utils';

export type SeriesInfo = (typeof SERIES)[number];

export async function getSeriesPosts(slug: string) {
  const posts = await getPosts();
  return posts
    .filter((p) => p.data.series === slug)
    .sort((a, b) => (a.data.seriesOrder ?? 0) - (b.data.seriesOrder ?? 0));
}

export async function getAllSeries() {
  const out = [];
  for (const s of SERIES) {
    const posts = await getSeriesPosts(s.slug);
    if (posts.length > 0) out.push({ ...s, posts });
  }
  return out;
}

export const seriesInfo = (slug?: string) => SERIES.find((s) => s.slug === slug);
