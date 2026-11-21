import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { APIRoute, GetStaticPaths } from 'astro';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { SITE_TITLE } from '../../consts';
import { COVER_W, COVER_H, coverTheme, wrapTitle, titleFontSize } from '../../cover';
import { getPosts, formatDate } from '../../utils';

// Ảnh chia sẻ mạng xã hội 1200x630, cùng thiết kế với Cover.astro, tạo lúc build.
const require = createRequire(import.meta.url);
const font = (subset: string, weight: 400 | 700) => ({
  name: `BVP-${subset}`,
  weight,
  style: 'normal' as const,
  data: readFileSync(require.resolve(`@fontsource/be-vietnam-pro/files/be-vietnam-pro-${subset}-${weight}-normal.woff`)),
});
const fonts = ['latin', 'vietnamese'].flatMap((s) => [font(s, 400), font(s, 700)]);

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { id: post.id }, props: { post } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { title, tags, pubDate } = props.post.data;
  const theme = coverTheme(tags);
  const lines = wrapTitle(title);
  const size = titleFontSize(lines.length);

  const tree = h(
    'div',
    {
      width: COVER_W, height: COVER_H, display: 'flex', flexDirection: 'column', position: 'relative',
      color: '#fff', fontFamily: 'BVP-latin, BVP-vietnamese',
      backgroundImage: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
    },
    [
      h('div', { position: 'absolute', left: 860, top: -130, width: 440, height: 440, borderRadius: 220, background: 'rgba(255,255,255,.06)' }),
      h('div', { position: 'absolute', left: 1010, top: 420, width: 280, height: 280, borderRadius: 140, background: 'rgba(255,255,255,.05)' }),
      h('div', { position: 'absolute', left: 80, top: 70, right: 80, bottom: 70, display: 'flex', flexDirection: 'column' }, [
        h('div', { display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: 2, color: theme.accent }, theme.label.toUpperCase()),
        h('div', { width: 64, height: 6, borderRadius: 3, marginTop: 14, background: theme.accent }),
        h(
          'div',
          { display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1, fontSize: size, fontWeight: 700, lineHeight: 1.2 },
          lines.map((l) => h('div', { display: 'flex' }, l)),
        ),
        h('div', { display: 'flex', justifyContent: 'space-between', fontSize: 28, opacity: 0.85 }, [
          h('div', { display: 'flex' }, SITE_TITLE),
          h('div', { display: 'flex' }, formatDate(pubDate)),
        ]),
      ]),
    ],
  );

  const svg = await satori(tree as any, { width: COVER_W, height: COVER_H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: COVER_W } }).render().asPng();
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
