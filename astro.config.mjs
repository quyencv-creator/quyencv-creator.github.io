import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Đổi thành https://<username>.github.io (repo phải tên <username>.github.io).
// Nếu repo tên khác, thêm: base: '/<tên-repo>'
export default defineConfig({
  site: 'https://quyencv-creator.github.io',
  integrations: [sitemap()],
  // Tag cũ đã gộp vào bộ tag chính: chuyển hướng để link cũ không bị 404.
  redirects: {
    '/tags/rails/': '/tags/ruby/',
    '/tags/redis/': '/tags/database/',
    '/tags/concurrency/': '/tags/backend/',
    '/tags/performance/': '/tags/backend/',
    '/tags/cache/': '/tags/backend/',
    '/tags/observability/': '/tags/devops/',
    '/tags/sre/': '/tags/devops/',
    '/tags/production/': '/tags/devops/',
    '/tags/docker/': '/tags/devops/',
    '/tags/security/': '/tags/devops/',
    '/tags/solid/': '/tags/architecture/',
    '/tags/design-principles/': '/tags/architecture/',
    '/tags/microservices/': '/tags/architecture/',
    '/tags/outbox-pattern/': '/tags/architecture/',
    '/tags/ecommerce/': '/tags/architecture/',
    '/tags/middleware/': '/tags/backend/',
    '/tags/sidekiq/': '/tags/backend/',
    '/tags/background-job/': '/tags/backend/',
    '/tags/asynq/': '/tags/backend/',
    '/tags/robotics/': '/tags/ai/',
  },
});
