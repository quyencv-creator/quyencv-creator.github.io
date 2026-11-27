---
title: "Bảng xếp hạng contest với Redis và Lua script trong Golang"
description: Dựng bảng xếp hạng kiểu ICPC (điểm + penalty) bằng Redis Sorted Set, dùng Lua script để cập nhật nguyên tử, pipeline để đọc nhanh, kèm code go-redis chạy được và những cái bẫy khi đưa lên production.
pubDate: 2026-03-26
tags: [golang, redis, backend]
---

Một contest lập trình có vài nghìn thí sinh, nộp bài liên tục, và ai cũng F5 bảng xếp hạng mỗi vài giây. Bài này dựng bảng xếp hạng đó bằng **Redis** và **Lua script**, viết bằng Go với thư viện [go-redis](https://github.com/redis/go-redis), để thấy rõ:

- Redis giải quyết được gì mà database thường làm vất vả.
- Lua script dùng để làm gì, và tại sao không chỉ gọi lệnh Redis bình thường.

## 1. Bài toán

Luật xếp hạng kiểu ICPC:

- Mỗi bài AC (Accepted) được cộng điểm của bài đó.
- **Penalty** = thời điểm AC (tính bằng giây từ lúc bắt đầu) + 300 giây cho **mỗi lần nộp sai trước đó**.
- Xếp hạng: **điểm cao hơn** đứng trên; bằng điểm thì **penalty thấp hơn** đứng trên.
- Một bài đã AC thì nộp lại không tính gì nữa.

Yêu cầu hệ thống:

- Kết quả chấm phải cập nhật bảng xếp hạng **ngay lập tức**.
- Xem top 10, top 100, và "tôi đang hạng mấy" phải **nhanh**, dù hàng nghìn người cùng xem.
- Hai kết quả chấm của cùng một người tới cùng lúc **không được** làm sai điểm.

## 2. Vì sao Redis?

Làm bằng SQL thì mỗi lần xem bảng xếp hạng là một câu `ORDER BY score DESC, penalty ASC` trên toàn bộ thí sinh, và "tôi đang hạng mấy" là một câu `COUNT(*)` những người đứng trên. Hàng nghìn người F5 mỗi vài giây là hàng nghìn câu như vậy.

Redis có sẵn một cấu trúc sinh ra cho đúng việc này: **Sorted Set (ZSET)**. Mỗi phần tử có một `score` (số thực), Redis luôn giữ chúng **đã sắp xếp**:

| Việc cần làm | Lệnh Redis | Độ phức tạp |
|---|---|---|
| Cập nhật điểm một người | `ZADD lb 100.99 user_A` | O(log N) |
| Lấy top 10 | `ZREVRANGE lb 0 9` | O(log N + 10) |
| Hạng của một người | `ZREVRANK lb user_A` | O(log N) |
| Điểm của một người | `ZSCORE lb user_A` | O(1) |

Không có lần sắp xếp nào lúc đọc, vì dữ liệu đã được sắp xếp sẵn lúc ghi.

Ngoài ZSET, mỗi thí sinh có thêm một **Hash** lưu chi tiết: tổng điểm, tổng penalty, bài nào đã AC, mỗi bài sai mấy lần.

```
{contest:101}:lb              ZSET   user_B → 100.99996, user_A → 100.99994
{contest:101}:user:user_A     HASH   prob_1:wrong=1, prob_1:solved=1,
                                     total_score=100, total_penalty=600
```

## 3. Gộp điểm và penalty vào một con số

ZSET chỉ sắp xếp theo **một** số. Nhưng ta cần sắp theo hai tiêu chí: điểm (giảm dần), rồi penalty (tăng dần).

Mẹo: ghép cả hai vào một số thực:

```
zset_score = total_score + (1 - total_penalty / 10_000_000)
```

- **Phần nguyên** là điểm, nên điểm cao hơn luôn đứng trên.
- **Phần thập phân** nằm trong khoảng (0, 1], penalty càng thấp thì phần này càng lớn, nên cùng điểm thì penalty thấp đứng trên.

Ví dụ: A có 100 điểm, penalty 600s → `100.99994`. B có 100 điểm, penalty 400s → `100.99996`. B đứng trên A.

Mẹo này đúng **khi penalty nhỏ hơn 10.000.000 giây** (khoảng 115 ngày), quá đủ cho một contest. Penalty vượt mốc đó thì phần thập phân âm và thứ tự sai, nên hãy chọn hệ số theo độ dài contest của bạn.

## 4. Vì sao cần Lua script?

Xử lý một lần nộp bài AC cần các bước:

1. Đọc xem bài này đã AC chưa (`HGET`).
2. Đọc số lần sai (`HGET`).
3. Đánh dấu đã AC, cộng điểm, cộng penalty (`HSET`, `HINCRBY`).
4. Cập nhật ZSET (`ZADD`).

Nếu gọi từng lệnh từ Go, giữa bước 1 và bước 3 có một khoảng hở. Hai kết quả AC của cùng một bài tới gần như đồng thời (chấm lại, hoặc hai worker cùng xử lý trùng):

```
Worker 1: HGET solved → chưa AC          Worker 2: HGET solved → chưa AC
Worker 1: cộng 100 điểm                   Worker 2: cộng 100 điểm   ← cộng 2 lần!
```

Đây là **race condition** kiểu đọc-rồi-ghi kinh điển.

**Lua script** giải quyết gọn: Redis chạy cả script như **một lệnh duy nhất**. Trong lúc script chạy, không lệnh nào khác chen vào được. Toàn bộ "đọc → kiểm tra → ghi" trở thành nguyên tử.

Lợi ích thứ hai: **một round-trip mạng** thay vì 5–6 lần gọi qua lại giữa Go và Redis.

Lựa chọn thay thế là `MULTI`/`WATCH` (optimistic locking): theo dõi key, nếu bị đổi giữa chừng thì transaction thất bại và phải tự retry. Làm được, nhưng code dài hơn, và khi nhiều người tranh nhau một key thì retry liên tục. Với logic "đọc rồi quyết định ghi gì", Lua gọn hơn nhiều.

## 5. Script xử lý nộp bài

```lua
local lb_key   = KEYS[1]
local user_key = KEYS[2]

local user_id       = ARGV[1]
local prob_id       = ARGV[2]
local is_ac         = tonumber(ARGV[3])
local prob_score    = tonumber(ARGV[4])
local elapsed       = tonumber(ARGV[5])
local wrong_penalty = tonumber(ARGV[6])

local solved_field = prob_id .. ":solved"
local wrong_field  = prob_id .. ":wrong"

-- 1. Đã AC bài này rồi → bỏ qua
if redis.call('HGET', user_key, solved_field) == "1" then
  return 0
end

-- 2. Nộp sai → chỉ tăng số lần sai
if is_ac == 0 then
  redis.call('HINCRBY', user_key, wrong_field, 1)
  return 1
end

-- 3. AC → đánh dấu, tính penalty, cộng điểm
redis.call('HSET', user_key, solved_field, "1")
local wrong_count   = tonumber(redis.call('HGET', user_key, wrong_field)) or 0
local added_penalty = elapsed + wrong_count * wrong_penalty

local new_score   = redis.call('HINCRBY', user_key, "total_score", prob_score)
local new_penalty = redis.call('HINCRBY', user_key, "total_penalty", added_penalty)

-- 4. Cập nhật bảng xếp hạng
local zset_score = new_score + (1 - new_penalty / 10000000.0)
redis.call('ZADD', lb_key, zset_score, user_id)

return 2
```

Vài điểm cần để ý:

- **`KEYS` và `ARGV` tách riêng.** Mọi key script đụng tới phải truyền qua `KEYS`, không tự ghép tên key trong script. Redis Cluster dựa vào `KEYS` để biết script chạy trên node nào.
- **Giá trị trả về** (0, 1, 2) cho Go biết chuyện gì đã xảy ra, không cần đọc lại.
- Nộp sai **sau khi** đã AC cũng bị bỏ qua ở bước 1, đúng luật.

## 6. Gọi script từ Go

```go
package leaderboard

import (
	"context"
	"fmt"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// Nguyên văn script ở phần 5, đặt trong raw string `...`.
const submitLua = `
local lb_key   = KEYS[1]
-- ...
return 2
`

// Tạo một lần ở cấp package: go-redis tính sẵn SHA1 của script.
var submitScript = redis.NewScript(submitLua)

const wrongPenaltySec = 300

func lbKey(contestID string) string { return fmt.Sprintf("{contest:%s}:lb", contestID) }

func userKey(contestID, userID string) string {
	return fmt.Sprintf("{contest:%s}:user:%s", contestID, userID)
}

type SubmitResult int

const (
	AlreadySolved SubmitResult = 0
	WrongAnswer   SubmitResult = 1
	Accepted      SubmitResult = 2
)

func Submit(ctx context.Context, rdb *redis.Client, contestID, userID, probID string,
	isAC bool, probScore, elapsedSec int) (SubmitResult, error) {

	ac := 0
	if isAC {
		ac = 1
	}
	keys := []string{lbKey(contestID), userKey(contestID, userID)}
	res, err := submitScript.Run(ctx, rdb, keys,
		userID, probID, ac, probScore, elapsedSec, wrongPenaltySec).Int()
	if err != nil {
		return 0, fmt.Errorf("submit script: %w", err)
	}
	return SubmitResult(res), nil
}
```

`redis.NewScript` làm sẵn một việc quan trọng:

- Lần đầu, `Run` gửi `EVALSHA <sha1>`, tức chỉ gửi **mã băm** của script chứ không gửi nguyên văn.
- Nếu Redis chưa có script (vừa khởi động lại), Redis trả lỗi `NOSCRIPT`, go-redis tự động gửi lại bằng `EVAL` kèm nguyên văn script, Redis lưu lại, các lần sau lại dùng `EVALSHA`.

Vì vậy khai báo script **một lần** ở biến cấp package, đừng gọi `NewScript` trong mỗi request.

### Hash tag `{contest:101}`

Để ý phần trong ngoặc nhọn ở tên key. Trong **Redis Cluster**, mỗi key nằm ở một slot tuỳ theo mã băm của tên. Một script đụng tới nhiều key thì các key đó **bắt buộc cùng slot**, nếu không Redis báo lỗi `CROSSSLOT`.

Khi tên key có `{...}`, Redis chỉ băm phần trong ngoặc. Mọi key của contest 101 đều có `{contest:101}`, nên chúng luôn nằm cùng một node. Với Redis đơn lẻ thì ngoặc nhọn không ảnh hưởng gì, nên cứ đặt sẵn từ đầu.

## 7. Đọc bảng xếp hạng bằng pipeline

```go
type Entry struct {
	Rank    int
	UserID  string
	Score   int
	Penalty int
}

func Top(ctx context.Context, rdb *redis.Client, contestID string, n int64) ([]Entry, error) {
	// 1. Lấy N user đứng đầu
	ids, err := rdb.ZRevRange(ctx, lbKey(contestID), 0, n-1).Result()
	if err != nil {
		return nil, err
	}

	// 2. Lấy chi tiết N user trong MỘT lần gọi mạng
	pipe := rdb.Pipeline()
	cmds := make([]*redis.MapStringStringCmd, len(ids))
	for i, id := range ids {
		cmds[i] = pipe.HGetAll(ctx, userKey(contestID, id))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	// 3. Ghép kết quả
	board := make([]Entry, 0, len(ids))
	for i, cmd := range cmds {
		data := cmd.Val()
		score, _ := strconv.Atoi(data["total_score"])
		penalty, _ := strconv.Atoi(data["total_penalty"])
		board = append(board, Entry{Rank: i + 1, UserID: ids[i], Score: score, Penalty: penalty})
	}
	return board, nil
}

func MyRank(ctx context.Context, rdb *redis.Client, contestID, userID string) (int64, error) {
	r, err := rdb.ZRevRank(ctx, lbKey(contestID), userID).Result()
	if err == redis.Nil {
		return 0, nil // chưa AC bài nào, chưa có hạng
	}
	return r + 1, err
}
```

**Pipeline** khác Lua script thế nào?

| | Pipeline | Lua script |
|---|---|---|
| Mục đích | Gom nhiều lệnh vào một round-trip | Chạy logic nguyên tử trên server |
| Nguyên tử | Không, lệnh khác có thể chen giữa | Có |
| Có `if`/tính toán giữa các lệnh | Không, lệnh sau không thấy kết quả lệnh trước | Có |
| Dùng khi | Đọc nhiều key độc lập | Đọc rồi quyết định ghi |

Lấy top 100 bằng 100 lần `HGETALL` riêng lẻ là 100 round-trip; qua pipeline chỉ còn **1**. Ở đây không cần nguyên tử (chỉ đọc để hiển thị), nên pipeline là đủ.

## 8. Chạy thử

```go
func main() {
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	c := "101"

	Submit(ctx, rdb, c, "user_A", "prob_1", false, 100, 120) // A sai ở giây 120
	Submit(ctx, rdb, c, "user_A", "prob_1", true, 100, 300)  // A AC ở giây 300: penalty 300 + 300 = 600
	Submit(ctx, rdb, c, "user_B", "prob_1", true, 100, 400)  // B AC ở giây 400: penalty 400
	Submit(ctx, rdb, c, "user_B", "prob_1", true, 100, 500)  // B nộp lại: bỏ qua

	board, _ := Top(ctx, rdb, c, 10)
	for _, e := range board {
		fmt.Printf("#%d %s | %d điểm | penalty %ds\n", e.Rank, e.UserID, e.Score, e.Penalty)
	}
}
```

Kết quả:

```
#1 user_B | 100 điểm | penalty 400s
#2 user_A | 100 điểm | penalty 600s
```

Cùng 100 điểm, B đứng trên vì penalty thấp hơn. Lần nộp lại của B không làm thay đổi gì.

Thử thêm tình huống race: cho **200 goroutine** cùng nộp AC một bài cho cùng một người. Nhờ Lua script, `total_score` vẫn đúng **100**, không phải 20.000.

## 9. Những điều cần biết trước khi lên production

**Lua script chặn cả Redis.** Redis chạy lệnh trên một luồng, nên trong lúc script chạy, **mọi client khác phải chờ**. Script ở trên chỉ vài lệnh O(1) và O(log N), chạy trong vài micro giây. Đừng bao giờ viết script lặp qua hàng nghìn phần tử hay gọi `KEYS *` bên trong.

**Không có rollback.** Nếu script lỗi giữa chừng (ví dụ `HINCRBY` vào một field không phải số), các lệnh **đã chạy trước đó vẫn được giữ**. Kiểm tra dữ liệu đầu vào ở Go trước khi gọi script.

**Bằng điểm và bằng penalty.** Hai người cùng `zset_score` thì Redis sắp theo tên phần tử (thứ tự từ điển), không phải ai AC trước. Nếu luật cần phân xử thêm, đưa tiêu chí đó vào công thức điểm.

**Redis không phải nơi lưu trữ chính.** Kết quả chấm vẫn phải ghi vào database. Redis là bảng xếp hạng **tính sẵn** để đọc nhanh; nếu mất dữ liệu Redis thì dựng lại được bằng cách phát lại các lần nộp bài theo thứ tự thời gian (script đã xử lý đúng việc nộp trùng).

**Dọn dẹp sau contest.** Đặt `EXPIRE` cho các key `{contest:<id>}:*` sau khi contest kết thúc và đã lưu bảng xếp hạng cuối cùng, để Redis không phình mãi.

**Đóng băng bảng xếp hạng (freeze).** Nhiều contest ẩn bảng xếp hạng trong giờ cuối. Cách đơn giản: lúc freeze, copy ZSET sang key `{contest:101}:lb:frozen` (`ZUNIONSTORE` hoặc `COPY`), người xem đọc bản frozen, còn bản chính vẫn cập nhật bình thường.

## Tóm lại

- **Sorted Set** giữ bảng xếp hạng luôn được sắp xếp: cập nhật O(log N), lấy top và tra hạng đều nhanh.
- **Ghép nhiều tiêu chí vào một score** (phần nguyên là điểm, phần thập phân là penalty) để ZSET sắp theo đúng luật.
- **Lua script** biến chuỗi "đọc → kiểm tra → ghi" thành nguyên tử, chống cộng điểm hai lần, và chỉ tốn một round-trip.
- **`redis.NewScript`** tự dùng `EVALSHA` và tự gửi lại script khi gặp `NOSCRIPT`; khai báo một lần ở cấp package.
- **Pipeline** để đọc nhiều key trong một lần gọi mạng khi không cần nguyên tử.
- **Hash tag `{...}`** để mọi key của một contest nằm cùng slot, chạy được trên Redis Cluster.
- Giữ script **ngắn**, nhớ **không có rollback**, và coi Redis là **lớp đọc nhanh**, không phải nguồn dữ liệu gốc.
