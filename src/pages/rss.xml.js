import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { getPosts } from '../utils';

export async function GET(context) {
  const posts = await getPosts();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/blog/${p.id}/`,
    })),
  });
}
