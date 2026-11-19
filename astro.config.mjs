import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Đổi thành https://<username>.github.io (repo phải tên <username>.github.io).
// Nếu repo tên khác, thêm: base: '/<tên-repo>'
export default defineConfig({
  site: 'https://quyencv-creator.github.io',
  integrations: [sitemap()],
});
