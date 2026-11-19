# Blog cá nhân (Astro + GitHub Pages)

## Chạy bằng Docker (không cần cài Node)

```bash
docker compose up dev                      # viết bài, hot reload: http://localhost:4321
docker compose --profile prod up --build web   # xem bản production: http://localhost:8080
docker build --target export --output dist .   # xuất file tĩnh ra ./dist
```

## Viết bài

Tạo file `.md` trong `src/content/blog/` (xem mẫu `xin-chao.md`). Đặt `draft: true` để ẩn bài khi deploy.

## Đưa lên GitHub Pages

1. Tạo repo tên `<username>.github.io` trên GitHub.
2. Sửa `site` trong `astro.config.mjs` thành `https://<username>.github.io` (nếu repo tên khác, thêm `base: '/<tên-repo>'`).
3. Push code lên nhánh `main`.
4. Vào **Settings → Pages → Source**, chọn **GitHub Actions**.

Mỗi lần push lên `main`, workflow `.github/workflows/deploy.yml` sẽ tự build và đăng.
