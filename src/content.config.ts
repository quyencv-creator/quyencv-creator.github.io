import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // Ảnh bìa tuỳ chọn: đường dẫn trong public/ (vd "/covers/abc.png") hoặc URL đầy đủ.
    // Để trống thì dùng ảnh SVG tự tạo từ title + tags.
    cover: z.string().optional(),
    // Series: slug khai báo trong SERIES (src/consts.ts) và thứ tự bài trong series.
    series: z.string().optional(),
    seriesOrder: z.number().optional(),
  }),
});

export const collections = { blog };
