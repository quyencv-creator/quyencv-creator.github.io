---
title: "Dùng goroutine lấy dữ liệu song song thay cho JOIN: nhanh hơn hay chỉ phức tạp hơn?"
description: Lấy danh sách bài viết kèm tác giả, bình luận, lượt thích. Một câu JOIN lớn, nhiều query tuần tự, hay errgroup chạy song song rồi map theo post id? Benchmark thật trên PostgreSQL với 5 cách, và những cái bẫy của goroutine khi làm việc với database.
pubDate: 2026-04-09
tags: [golang, backend, database]
---

Trang feed cần hiển thị 20 bài viết, mỗi bài có: tên tác giả, 3 bình luận mới nhất, số lượt thích.

Cách đầu tiên ai cũng nghĩ tới là một câu `JOIN` thật to. Rồi một ngày bạn thấy Go có goroutine, và nảy ra ý tưởng: *"Sao không lấy posts trước, rồi bắn song song 3 query lấy users, comments, likes, xong ghép lại theo post id?"*

Được không? **Được.** Nhanh hơn không? **Tuỳ.** Bài này đo thật để trả lời.

## 1. Dữ liệu và năm cách làm

Dữ liệu thử trên PostgreSQL 16: 5.000 users, 100.000 posts, 2 triệu comments, 3 triệu likes. Mỗi lần lấy một trang 20 bài.

| Cách | Mô tả | Số query mỗi trang |
|---|---|---|
| A1 | Một câu JOIN "ngây thơ": posts ⨝ users ⨝ comments ⨝ likes | 1 |
| A2 | Một câu query viết cẩn thận bằng `LATERAL` | 1 |
| B | Lấy posts, rồi lần lượt users, comments, likes theo `ANY($ids)` | 4, tuần tự |
| C | Giống B, nhưng 3 query sau chạy **song song** bằng `errgroup` | 4, 3 cái song song |
| D | Mỗi post một goroutine, mỗi goroutine tự query user, comments, likes của post đó | 1 + 20 × 3 = 61 |

Cách C chính là ý tưởng trong câu hỏi. Cách D là phiên bản "goroutine cho mọi thứ" mà mình hay gặp khi review code.

## 2. Cách C: errgroup + map theo post id

```go
func feedParallel(ctx context.Context, db *pgxpool.Pool, page int) ([]*Post, error) {
	// 1. Lấy trang posts trước: cần id thì mới lấy được phần còn lại
	posts, err := listPosts(ctx, db, page)
	if err != nil {
		return nil, err
	}
	postIDs, userIDs := collectIDs(posts)

	// 2. Ba query độc lập chạy song song
	var (
		users    map[int64]*User
		comments map[int64][]Comment
		likes    map[int64]int
	)
	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { users, err = usersByID(ctx, db, userIDs); return })
	g.Go(func() (err error) { comments, err = commentsByPost(ctx, db, postIDs); return })
	g.Go(func() (err error) { likes, err = likesByPost(ctx, db, postIDs); return })
	if err := g.Wait(); err != nil {
		return nil, err // một query lỗi → ctx bị huỷ → hai query kia dừng theo
	}

	// 3. Ghép lại theo id, sau khi mọi goroutine đã xong
	for _, p := range posts {
		p.Author = users[p.UserID]
		p.Comments = comments[p.ID]
		p.Likes = likes[p.ID]
	}
	return posts, nil
}
```

Các query con đều lấy **theo lô** (batch), mỗi query một lần cho cả 20 bài:

```go
func usersByID(ctx context.Context, db *pgxpool.Pool, ids []int64) (map[int64]*User, error) {
	rows, _ := db.Query(ctx, `SELECT id, name FROM users WHERE id = ANY($1)`, ids)
	m := make(map[int64]*User, len(ids))
	_, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (struct{}, error) {
		u := &User{}
		err := r.Scan(&u.ID, &u.Name)
		m[u.ID] = u
		return struct{}{}, err
	})
	return m, err
}

// 3 bình luận mới nhất CỦA MỖI bài, trong một query
func commentsByPost(ctx context.Context, db *pgxpool.Pool, postIDs []int64) (map[int64][]Comment, error) {
	rows, _ := db.Query(ctx, `
		SELECT c.id, c.post_id, c.user_id, c.body
		FROM unnest($1::bigint[]) AS p(id)
		CROSS JOIN LATERAL (
			SELECT * FROM comments WHERE post_id = p.id ORDER BY id DESC LIMIT 3
		) c`, postIDs)
	m := make(map[int64][]Comment, len(postIDs))
	_, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (struct{}, error) {
		var c Comment
		err := r.Scan(&c.ID, &c.PostID, &c.UserID, &c.Body)
		m[c.PostID] = append(m[c.PostID], c)
		return struct{}{}, err
	})
	return m, err
}

func likesByPost(ctx context.Context, db *pgxpool.Pool, postIDs []int64) (map[int64]int, error) {
	rows, _ := db.Query(ctx,
		`SELECT post_id, count(*) FROM likes WHERE post_id = ANY($1) GROUP BY post_id`, postIDs)
	m := make(map[int64]int, len(postIDs))
	_, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (struct{}, error) {
		var id int64
		var n int
		err := r.Scan(&id, &n)
		m[id] = n
		return struct{}{}, err
	})
	return m, err
}
```

Để ý: mỗi goroutine ghi vào **biến riêng của nó** (`users`, `comments`, `likes`), và chỉ đọc chúng **sau** `g.Wait()`. Không goroutine nào đụng vào dữ liệu của goroutine khác, nên không cần mutex.

## 3. Kết quả benchmark

Pool 10 kết nối, Go và PostgreSQL chạy trên cùng máy (độ trễ mạng gần bằng 0). Đo 400 request cho mỗi cách. Cả 5 cách cho **cùng một kết quả**, mình đã kiểm tra trước khi đo.

**Một người dùng (concurrency 1):**

| Cách | p50 | p99 | req/s |
|---|---|---|---|
| A1 JOIN ngây thơ | 10,96 ms | 15,27 ms | 89 |
| A2 Một query LATERAL | 0,96 ms | 1,37 ms | 1.007 |
| B Batch tuần tự | 0,59 ms | 1,08 ms | 1.593 |
| **C Batch song song** | **0,40 ms** | **0,73 ms** | **2.381** |
| D Goroutine mỗi post | 2,04 ms | 2,97 ms | 468 |

**50 request cùng lúc (concurrency 50):**

| Cách | p50 | p99 | req/s |
|---|---|---|---|
| A1 JOIN ngây thơ | 186,81 ms | 209,25 ms | 264 |
| A2 Một query LATERAL | 9,22 ms | 11,69 ms | 5.224 |
| **B Batch tuần tự** | **7,85 ms** | **9,01 ms** | **6.225** |
| C Batch song song | 8,44 ms | 10,26 ms | 5.823 |
| D Goroutine mỗi post | 82,53 ms | 90,20 ms | 600 |

Ba điều rút ra:

1. **Lúc vắng, song song thắng.** C nhanh hơn B khoảng 30%, vì 3 query chờ đồng thời thay vì nối đuôi nhau.
2. **Lúc đông, song song không còn lợi.** Khi 50 request tranh nhau 10 kết nối, nút thắt là **pool**, không phải độ trễ. Mỗi request của C chiếm tới 3 kết nối cùng lúc, nên request khác phải xếp hàng lâu hơn. B lại nhỉnh hơn.
3. **Hai cách tệ hẳn:** JOIN ngây thơ (A1) và goroutine cho từng post (D), chậm hơn 10 tới 25 lần. Phần sau giải thích vì sao.

Lưu ý: benchmark này chạy cùng máy nên mỗi query chỉ mất vài trăm micro giây. Khi DB ở máy khác, mỗi round-trip mạng tốn 0,5–2ms, lợi ích của song song **lớn hơn** lúc vắng, nhưng chuyện nghẽn pool lúc đông thì vẫn y như vậy.

## 4. Vì sao JOIN ngây thơ chậm: bùng nổ số dòng

```sql
SELECT p.*, u.name, c.*, l.user_id
FROM (SELECT * FROM posts ORDER BY id DESC LIMIT 20) p
JOIN users u        ON u.id = p.user_id
LEFT JOIN comments c ON c.post_id = p.id
LEFT JOIN likes l    ON l.post_id = p.id
```

Mỗi bài có 20 bình luận và 30 lượt thích. JOIN comments **và** likes trên cùng một bài tạo ra **tích Descartes**: 20 × 30 = 600 dòng cho một bài. 20 bài thành **12.000 dòng**, để rồi trong Go phải khử trùng lặp, chỉ giữ lại 20 bài, 60 bình luận và 20 con số.

Đây là lý do "JOIN tất cả" có tiếng xấu. Nhưng lỗi nằm ở cách viết, không phải ở việc dùng một query. Cách A2 vẫn là **một** query, chỉ là viết cẩn thận:

```sql
SELECT p.id, p.user_id, p.title, u.name, lk.cnt, coalesce(cm.items, '[]')
FROM (SELECT * FROM posts ORDER BY id DESC LIMIT $1 OFFSET $2) p
JOIN users u ON u.id = p.user_id
CROSS JOIN LATERAL (SELECT count(*) AS cnt FROM likes WHERE post_id = p.id) lk
LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('ID', c.id, 'PostID', c.post_id,
                                      'UserID', c.user_id, 'Body', c.body)) AS items
    FROM (SELECT * FROM comments WHERE post_id = p.id ORDER BY id DESC LIMIT 3) c
) cm ON true
ORDER BY p.id DESC
```

Mỗi bài đúng **một dòng**: đếm like bằng subquery, bình luận gom thành mảng JSON. Nhanh hơn A1 tới 11 lần, và đứng ngang B, C lúc đông. Đổi lại, SQL dài và khó bảo trì hơn, và mảng JSON phải được parse lại ở Go.

## 5. Vì sao goroutine cho từng post chậm: N+1 chạy song song vẫn là N+1

```go
for _, p := range posts {
	g.Go(func() error {
		u, _ := usersByID(ctx, db, []int64{p.UserID})   // 20 query
		c, _ := commentsByPost(ctx, db, []int64{p.ID})  // 20 query
		l, _ := likesByPost(ctx, db, []int64{p.ID})     // 20 query
		// ...
	})
}
```

Trông rất "Go", rất song song. Nhưng nó là bài toán **N+1** quen thuộc: 61 query cho một trang, thay vì 4. Chạy song song chỉ giấu bớt độ trễ, còn tổng số việc DB phải làm vẫn gấp 15 lần. Và với pool 10 kết nối, 20 goroutine cũng không thực sự song song: một nửa phải xếp hàng chờ kết nối.

Lúc đông thì càng tệ: một request chiếm **cả 10 kết nối**, request khác không còn gì để dùng. Kết quả: chậm hơn B tới 10 lần.

> Goroutine không làm cho việc ít đi. Nó chỉ cho phép **chờ** nhiều việc cùng lúc.

## 6. Những cái bẫy khi chạy query song song

### Mỗi goroutine chiếm một kết nối

Một request của cách C giữ 3 kết nối cùng lúc. Pool 10 kết nối chỉ phục vụ được khoảng 3 request như vậy cùng lúc. Khi tính kích thước pool, nhân thêm số query song song của mỗi request. Nếu có nhiều nhánh, giới hạn bằng `g.SetLimit(n)`.

### Không dùng được trong transaction

Một transaction là **một kết nối**, và `pgx.Tx` không an toàn khi dùng từ nhiều goroutine. Muốn đọc nhất quán trong một transaction thì phải chạy tuần tự.

### Mỗi query thấy một thời điểm khác nhau

Bốn query riêng lẻ, mỗi query thấy dữ liệu ở một khoảnh khắc riêng. Có thể đếm like xong thì có người like thêm, hoặc một bình luận vừa bị xoá. Với feed thì không sao. Với báo cáo tài chính, số liệu phải khớp nhau, thì dùng một query, hoặc một transaction `REPEATABLE READ` chạy tuần tự.

### Không ghi chung vào một map

```go
result := map[int64]*Post{}
g.Go(func() error { result[1] = ...; return nil }) // ❌ data race
g.Go(func() error { result[2] = ...; return nil }) // ❌ có thể làm sập chương trình
```

Map của Go không an toàn khi ghi đồng thời; runtime có thể dừng chương trình với lỗi `concurrent map writes`. Như ở phần 2: mỗi goroutine ghi vào **biến riêng**, ghép lại **sau** `Wait()`. Chạy test với `go test -race` để bắt lỗi này sớm.

### Luôn truyền ctx của errgroup

`errgroup.WithContext` trả về một ctx bị huỷ khi có goroutine lỗi. Truyền đúng ctx đó vào các query (như `ctx` trong ví dụ, đã bị gán lại), để một query lỗi thì các query còn lại dừng theo, không phải chờ hết. Chi tiết về context có trong bài [Context trong Go](/blog/context-trong-go/).

## 7. Vậy nên chọn cách nào?

| Tình huống | Nên dùng |
|---|---|
| Mặc định, phần lớn API | **B: batch tuần tự.** Đơn giản, ít kết nối, chịu tải tốt nhất |
| Endpoint ít người gọi nhưng cần độ trễ thấp, DB ở xa, nhiều nguồn chậm | **C: batch song song** với `errgroup`, có `SetLimit` |
| Dữ liệu từ nhiều **service khác nhau** (DB, Redis, HTTP API) | **C**: đây là chỗ song song phát huy tốt nhất, vì các nguồn không tranh chung một pool |
| Cần một ảnh chụp nhất quán, hoặc ít round-trip nhất | **A2: một query** viết cẩn thận bằng `LATERAL`, `json_agg` |
| Không bao giờ | **A1** (JOIN nhiều bảng một-nhiều cùng lúc) và **D** (goroutine cho từng phần tử) |

Thứ quyết định tốc độ ở đây **không phải** goroutine, mà là **số query**: từ 61 xuống 4 (lấy theo lô với `ANY($ids)`) mới là bước nhảy lớn. Song song hoá chỉ là bước tối ưu thêm, và có giá của nó.

## Tóm lại

- Ý tưởng "lấy posts trước, rồi song song lấy users, comments, likes, ghép theo post id" là **đúng và chạy tốt**, miễn là mỗi nhánh lấy **theo lô** (`WHERE id = ANY($1)`), không phải từng dòng.
- Lúc vắng, song song nhanh hơn tuần tự khoảng 30%. Lúc đông, khi pool là nút thắt, nó **không còn lợi** và có thể chậm hơn, vì mỗi request chiếm nhiều kết nối.
- **N+1 chạy song song vẫn là N+1**: goroutine cho từng post chậm gấp 10 lần batch.
- JOIN không xấu, **JOIN nhiều bảng một-nhiều cùng lúc** mới xấu (bùng nổ số dòng). Một query viết bằng `LATERAL` + `json_agg` vẫn rất nhanh.
- Khi chạy song song: tính lại kích thước pool, không dùng trong transaction, chấp nhận mỗi query thấy một thời điểm khác nhau, không ghi chung map, và luôn truyền ctx của errgroup.
- Mặc định chọn **batch tuần tự**. Chỉ song song hoá khi đo thấy có lợi, nhất là khi gom dữ liệu từ nhiều service khác nhau.
