---
title: "FastAPI từ A đến Z: cấu trúc dự án và vòng đời một request"
description: Dựng một dự án FastAPI thực tế với PostgreSQL và Redis, rồi đi theo một request từ lúc Uvicorn nhận tới lúc trả JSON, để thấy rõ thứ gì tạo một lần khi khởi động, thứ gì tạo mỗi request.
pubDate: 2026-11-21
tags: [python, architecture, backend]
---

Bài này đi qua toàn bộ một dự án FastAPI thực tế: cài môi trường, chạy app, tổ chức thư mục, rồi đi theo **một request** qua từng lớp cho tới khi JSON được trả về.

Xuyên suốt bài là một ví dụ duy nhất: module `orders` với endpoint `GET /api/v1/orders/{id}`, đọc từ PostgreSQL và cache bằng Redis.

## 1. Môi trường & dependency

Mỗi dự án Python nên có **môi trường ảo riêng**, để thư viện của dự án này không đụng dự án khác. Cách truyền thống dùng `venv` có sẵn trong Python:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Hoặc dùng [uv](https://docs.astral.sh/uv/), nhanh hơn nhiều và tự quản lý venv lẫn file lock:

```bash
uv init shop && cd shop
uv add fastapi "uvicorn[standard]" pydantic-settings "sqlalchemy[asyncio]" asyncpg redis alembic
uv add --dev pytest httpx
```

Tất cả dependency được khai báo trong `pyproject.toml`:

```toml
[project]
name = "shop"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic-settings>=2.6",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "redis>=5.2",
    "alembic>=1.14",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.28"]
```

- `uvicorn`: ASGI server, thứ thực sự nhận kết nối HTTP.
- `asyncpg`: driver PostgreSQL bất đồng bộ mà SQLAlchemy dùng bên dưới.
- `uv.lock` (do uv sinh ra) ghim version chính xác, nhớ commit file này để mọi máy cài giống nhau.

## 2. Chạy app

FastAPI chỉ là framework. Thứ chạy nó là **Uvicorn**, một ASGI server:

```bash
# Dev: tự restart khi sửa code
uv run uvicorn app.main:app --reload

# Production: nhiều process để dùng nhiều CPU
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

`app.main:app` nghĩa là: import module `app/main.py`, lấy biến `app` trong đó.

Lưu ý về `--workers 4`: mỗi worker là **một process riêng**, có bộ nhớ riêng. Nghĩa là mỗi worker có pool DB riêng, Redis client riêng. Với `pool_size=10` và 4 worker, app có thể mở tới 40 kết nối PostgreSQL. Tính con số này khi cấu hình `max_connections` của DB.

Khi chạy trong Kubernetes, thường để 1 worker mỗi container và tăng số pod thay vì tăng `--workers`.

## 3. Cấu trúc thư mục

```
shop/
├── app/
│   ├── main.py                  # tạo app, lifespan, middleware, router, exception handler
│   ├── core/
│   │   ├── config.py            # Settings đọc từ .env
│   │   └── errors.py            # exception nghiệp vụ (NotFoundError…)
│   ├── db/
│   │   └── session.py           # tạo engine + session factory
│   ├── models/                  # bảng DB (SQLAlchemy)
│   │   ├── base.py
│   │   └── order.py
│   ├── schemas/                 # dữ liệu vào/ra API (Pydantic)
│   │   └── order.py
│   ├── repositories/            # truy vấn DB
│   │   └── order.py
│   ├── services/                # nghiệp vụ, cache
│   │   └── order.py
│   ├── api/
│   │   ├── deps.py              # các hàm Depends dùng chung
│   │   └── v1/
│   │       ├── router.py        # gom router của v1
│   │       └── endpoints/
│   │           └── orders.py    # route /orders
│   └── workers/                 # job chạy nền (Celery, arq…)
├── alembic/                     # migration DB
├── tests/
├── .env
└── pyproject.toml
```

| Thư mục | Chứa gì | Không chứa gì |
|---|---|---|
| `core/` | Config, exception, logging, security | Nghiệp vụ |
| `db/` | Engine, session factory | Query cụ thể |
| `models/` | Class ánh xạ bảng DB | Logic API |
| `schemas/` | Pydantic model cho request/response | Truy vấn DB |
| `repositories/` | Câu lệnh `select`, `insert`… | HTTP, cache |
| `services/` | Nghiệp vụ, cache, gọi nhiều repo | `Request`, `HTTPException` |
| `api/` | Route, `Depends`, mã HTTP | SQL |
| `workers/` | Task chạy nền | Route |
| `alembic/` | Script migration | |
| `tests/` | Test | |

Khi dự án lớn, có thể chuyển sang nhóm theo tính năng (`app/orders/{models,schemas,service,router}.py`). Nguyên tắc chia lớp vẫn giữ nguyên.

## 4. Config

Không đọc `os.environ` rải rác khắp nơi. Gom hết vào một class với **pydantic-settings**:

```python
# app/core/config.py
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "shop"
    debug: bool = False
    database_url: str = "postgresql+asyncpg://shop:shop@localhost:5432/shop"
    redis_url: str = "redis://localhost:6379/0"
    db_pool_size: int = 10
    cache_ttl_seconds: int = 60
    api_token: str = "dev-token"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```bash
# .env
DATABASE_URL=postgresql+asyncpg://shop:secret@db:5432/shop
REDIS_URL=redis://redis:6379/0
CACHE_TTL_SECONDS=300
```

- Biến môi trường thật **ưu tiên hơn** `.env`. Trên production chỉ cần set env, không cần file.
- Sai kiểu (ví dụ `DB_POOL_SIZE=abc`) thì app **lỗi ngay lúc khởi động**, không đợi tới lúc chạy mới vỡ.
- `@lru_cache` làm `get_settings()` chỉ tạo `Settings` **một lần**, các lần gọi sau trả lại đúng object đó. Vì là một hàm, trong test có thể thay bằng `app.dependency_overrides[get_settings]`.

## 5. Tài nguyên dùng chung: DB pool và Redis

Kết nối DB và Redis rất tốn kém để mở. Chúng phải được tạo **một lần khi app khởi động**, dùng chung cho mọi request, và **đóng khi app tắt**.

```python
# app/db/session.py
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import Settings


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,  # số kết nối giữ sẵn
        max_overflow=5,                   # mở thêm tạm thời khi đông
        pool_pre_ping=True,               # kiểm tra kết nối chết trước khi dùng
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)
```

Ba khái niệm cần phân biệt:

- **Engine**: giữ **pool kết nối**. Một app một engine.
- **Session factory** (`async_sessionmaker`): "khuôn" để tạo session. Tạo một lần.
- **Session** (`AsyncSession`): một phiên làm việc, mượn một kết nối từ pool khi cần, trả lại khi đóng. **Mỗi request một session**, không bao giờ dùng chung giữa các request.

`expire_on_commit=False` để sau khi `commit()`, object vẫn đọc được thuộc tính mà không phải query lại (trong async, query ngầm sẽ gây lỗi).

Chỗ tạo và đóng là **lifespan**, sẽ thấy đầy đủ ở phần 8:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    engine = create_engine(settings)
    app.state.session_factory = create_session_factory(engine)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    yield                        # ← app phục vụ request ở đây
    await app.state.redis.aclose()
    await engine.dispose()       # đóng mọi kết nối trong pool
```

Code trước `yield` chạy khi khởi động, sau `yield` chạy khi tắt. Lưu vào `app.state` để dependency lấy ra được.

## 6. Repository → Service → Endpoint

### Models khác schemas thế nào?

Đây là chỗ người mới hay nhầm vì cả hai đều trông giống "class Order":

| | `models/` (SQLAlchemy) | `schemas/` (Pydantic) |
|---|---|---|
| Mô tả | Một **bảng** trong DB | Dữ liệu **vào/ra API** |
| Dùng ở | Repository, service | Endpoint, service |
| Chứa | Mọi cột, kể cả cột nội bộ | Chỉ trường muốn lộ ra client |
| Thay đổi khi | Đổi DB (cần migration) | Đổi hợp đồng API |

Tách ra để có thể đổi DB mà không phá API, và để không bao giờ vô tình trả cột nhạy cảm (ví dụ `customer_email`) ra ngoài.

```python
# app/models/order.py
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base  # class Base(DeclarativeBase): pass


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_email: Mapped[str] = mapped_column(String(255))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

```python
# app/schemas/order.py
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # đọc được từ object SQLAlchemy

    id: int
    total: Decimal
    status: str
    created_at: datetime
    # không có customer_email → không bao giờ lộ ra API
```

### Repository: chỉ nói chuyện với DB

```python
# app/repositories/order.py
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order


class OrderRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, order_id: int) -> Order | None:
        return await self.session.get(Order, order_id)

    async def list_by_status(self, status: str) -> list[Order]:
        result = await self.session.scalars(select(Order).where(Order.status == status))
        return list(result)
```

**Không được:** biết về HTTP, Redis, hay quyết định nghiệp vụ. Không `commit()` ở đây; việc kết thúc transaction thuộc về service hoặc dependency.

### Service: nghiệp vụ và cache

```python
# app/services/order.py
from redis.asyncio import Redis

from app.core.errors import NotFoundError
from app.repositories.order import OrderRepository
from app.schemas.order import OrderOut


class OrderService:
    def __init__(self, repo: OrderRepository, cache: Redis, ttl: int):
        self.repo = repo
        self.cache = cache
        self.ttl = ttl

    async def get(self, order_id: int) -> OrderOut:
        key = f"order:{order_id}"

        cached = await self.cache.get(key)
        if cached:                                   # cache hit → trả ngay
            return OrderOut.model_validate_json(cached)

        order = await self.repo.get_by_id(order_id)  # cache miss → hỏi DB
        if order is None:
            raise NotFoundError(f"Order {order_id} không tồn tại")

        data = OrderOut.model_validate(order)
        await self.cache.set(key, data.model_dump_json(), ex=self.ttl)
        return data
```

**Không được:** import `Request`, `HTTPException` hay bất cứ thứ gì của FastAPI. Service báo lỗi bằng exception nghiệp vụ (`NotFoundError`), còn chuyển thành mã HTTP nào là việc của tầng API. Nhờ vậy service dùng lại được trong worker, CLI hay test mà không cần HTTP.

### Endpoint: mỏng nhất có thể

```python
# app/api/v1/endpoints/orders.py
from fastapi import APIRouter, Path

from app.api.deps import CurrentUser, OrderSvc
from app.schemas.order import OrderOut

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: int = Path(gt=0),
    *,
    svc: OrderSvc,
    user: CurrentUser,
) -> OrderOut:
    return await svc.get(order_id)
```

**Không được:** viết SQL, gọi Redis, hay chứa `if` nghiệp vụ. Endpoint chỉ nhận input đã được validate, gọi service, trả kết quả.

## 7. Dependency Injection với `Depends`

Endpoint ở trên không tự tạo service. Nó **khai báo** cần `OrderSvc` và `CurrentUser`, FastAPI tự dựng ra cho mỗi request:

```python
# app/api/deps.py
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.repositories.order import OrderRepository
from app.services.order import OrderService

bearer = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session            # ← endpoint chạy trong lúc này
    # ra khỏi `async with` → session đóng, kết nối trả về pool


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


def get_order_service(
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> OrderService:
    return OrderService(OrderRepository(db), redis, settings.cache_ttl_seconds)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    if creds is None or creds.credentials != settings.api_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token không hợp lệ")
    return {"id": 1, "email": "demo@example.com"}   # thực tế: decode JWT, tra DB


DbSession = Annotated[AsyncSession, Depends(get_db)]
OrderSvc = Annotated[OrderService, Depends(get_order_service)]
CurrentUser = Annotated[dict, Depends(get_current_user)]
```

Vài điều quan trọng:

- **`get_db` dùng `yield`**: phần trước `yield` chạy trước endpoint, phần sau chạy **sau khi response đã tính xong**. Đây là chỗ dọn dẹp tự động, có lỗi hay không session cũng được đóng.
- **Cache trong một request**: nếu nhiều dependency cùng cần `get_db`, FastAPI chỉ gọi nó **một lần** cho request đó và dùng chung kết quả. Repository và service vì vậy luôn chung một session, chung một transaction.
- **Mỗi request một bộ mới**: `OrderRepository` và `OrderService` được tạo mới mỗi request. Rất rẻ, vì chúng chỉ là object Python nhỏ giữ tham chiếu tới session và Redis client đã có sẵn.
- **`Annotated` alias** (`OrderSvc`, `CurrentUser`) giúp chữ ký endpoint ngắn và không lặp `Depends(...)` khắp nơi.
- **Test dễ**: `app.dependency_overrides[get_order_service] = lambda: FakeService()` là thay được toàn bộ DB và Redis.

## 8. `main.py`: nối mọi thứ lại

```python
# app/main.py
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.session import create_engine, create_session_factory

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    engine = create_engine(settings)
    app.state.session_factory = create_session_factory(engine)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    yield
    await app.state.redis.aclose()
    await engine.dispose()


app = FastAPI(title=get_settings().app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shop.example.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)          # ← mọi thứ phía sau chạy ở đây
    ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info("%s %s %s %.1fms id=%s", request.method, request.url.path,
                response.status_code, ms, request_id)
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message,
                           "request_id": request.state.request_id}},
    )


app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}
```

```python
# app/api/v1/router.py
from fastapi import APIRouter

from app.api.v1.endpoints import orders

api_router = APIRouter()
api_router.include_router(orders.router)
```

```python
# app/core/errors.py
class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str):
        self.message = message


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
```

Ghép prefix lại: `"/api/v1"` + `"/orders"` + `"/{order_id}"` = `GET /api/v1/orders/{order_id}`.

Về thứ tự middleware: middleware **thêm sau** nằm **bên ngoài**. Ở đây `request_context` được thêm sau CORS nên chạy trước CORS khi request đi vào, và chạy sau cùng khi response đi ra. Nhờ vậy dòng log đo được toàn bộ thời gian xử lý.

## 9. Một request đi từ đâu tới đâu

```
Client: GET /api/v1/orders/42   (Authorization: Bearer ...)
   │
   ▼
Uvicorn (ASGI server)  ── parse HTTP, tạo scope, gọi app(scope, receive, send)
   │
   ▼
Middleware: request_context  ── gán request_id, bắt đầu đo thời gian
   │
   ▼
Middleware: CORS  ── kiểm tra Origin
   │
   ▼
Router  ── khớp /api/v1/orders/{order_id} → get_order
   │
   ▼
Dependencies (giải theo cây, mỗi cái một lần / request)
   │  get_settings()      → Settings có sẵn (lru_cache)
   │  get_db()            → mượn session từ pool, dừng ở `yield`
   │  get_redis()         → Redis client có sẵn trong app.state
   │  get_order_service() → OrderService(OrderRepository(db), redis, ttl)
   │  get_current_user()  → kiểm tra Bearer token  ──✗ 401
   ▼
Pydantic validate path/query/body
   │  "42" → int, kiểm tra gt=0                      ──✗ 422
   ▼
Endpoint get_order(order_id=42, svc, user)
   │
   ▼
OrderService.get(42)
   │  1. redis.get("order:42")      ──► Redis   (hit → trả về ngay ↑)
   │  2. repo.get_by_id(42)         ──► miss
   ▼
OrderRepository.get_by_id(42)
   │  session.get(Order, 42)        ──► lấy 1 kết nối từ pool
   ▼
PostgreSQL
   │
   ◄── kết quả đi ngược lên: Order (model) → service chuyển thành OrderOut,
   │                          ghi cache "order:42" → endpoint return
   ▼
response_model=OrderOut  ── serialize thành JSON, lọc đúng các trường khai báo
   │
   ▼
Dependency cleanup  ── code sau `yield` của get_db: đóng session,
   │                    kết nối trả về pool
   ▼
Middleware (chiều ra)  ── thêm X-Request-ID, ghi log "200 12.3ms"
   │
   ▼
Uvicorn gửi về client: 200 {"id":42,"total":"199000.50",...}
```

### Tóm lại

- **Khi khởi động (một lần):** đọc `Settings` → tạo engine và pool kết nối DB → tạo session factory → tạo Redis client → đăng ký middleware, router, exception handler.
- **Mỗi request:** một session DB (mượn kết nối từ pool, trả lại cuối request), một `OrderRepository`, một `OrderService`, kết quả validate của Pydantic. Pool, Redis client và Settings **không bao giờ tạo mới** trong request.
- **Khi tắt (một lần):** đóng Redis client, `engine.dispose()` đóng mọi kết nối trong pool.

## 10. `async def` hay `def`?

FastAPI chạy hai loại hàm theo hai cách khác nhau:

| Khai báo | FastAPI chạy ở đâu | Dùng khi |
|---|---|---|
| `async def` | Thẳng trên **event loop** | Mọi I/O bên trong đều có `await` (asyncpg, redis.asyncio, httpx.AsyncClient) |
| `def` | Trong **threadpool** riêng | Phải gọi thư viện đồng bộ (`requests`, `psycopg2`, SDK cũ, đọc file lớn) |

Event loop là **một luồng duy nhất** phục vụ mọi request của worker. Trong `async def`, mỗi `await` là lúc loop đi phục vụ request khác. Nếu một dòng code **chặn** mà không `await`, toàn bộ worker đứng im.

Lỗi hay gặp nhất:

```python
import requests
import time


@router.get("/rate")
async def get_rate():
    time.sleep(1)                                   # ❌ chặn cả event loop 1 giây
    r = requests.get("https://api.example.com/rate")  # ❌ HTTP đồng bộ, chặn loop
    return r.json()
```

Trong 1 giây đó, **mọi request khác** của worker đều phải chờ, kể cả `/health`. Ba cách sửa:

```python
import asyncio

import httpx
from fastapi.concurrency import run_in_threadpool


# 1. Dùng thư viện async
@router.get("/rate")
async def get_rate():
    await asyncio.sleep(1)
    async with httpx.AsyncClient() as client:
        r = await client.get("https://api.example.com/rate")
    return r.json()


# 2. Bỏ async, FastAPI tự đẩy vào threadpool
@router.get("/rate-sync")
def get_rate_sync():
    return requests.get("https://api.example.com/rate").json()


# 3. Giữ async, đẩy riêng đoạn blocking vào thread
@router.get("/report")
async def report():
    return await run_in_threadpool(build_heavy_report)
```

Quy tắc ngắn gọn: **trong `async def`, mọi I/O phải có `await`**. Không chắc thư viện có async hay không thì dùng `def`. Việc nặng CPU (resize ảnh, xuất PDF lớn) thì đẩy sang `workers/`, đừng làm trong request.

## 11. Lỗi đi đâu?

Khi order không tồn tại, service không biết gì về HTTP, nó chỉ `raise NotFoundError`. Exception bay ngược lên qua endpoint, tới exception handler đã đăng ký trong `main.py`:

```
OrderService.get(999)
   │  repo trả None → raise NotFoundError("Order 999 không tồn tại")
   ▼
Endpoint  (không bắt, để exception đi tiếp)
   ▼
Dependency cleanup  ── get_db vẫn đóng session, trả kết nối về pool
   ▼
@app.exception_handler(AppError)
   │  NotFoundError.status_code = 404
   ▼
404 {"error":{"code":"not_found","message":"Order 999 không tồn tại","request_id":"7db6..."}}
```

Mỗi loại lỗi được xử lý ở một nơi:

| Lỗi | Ai raise | Kết quả |
|---|---|---|
| Nghiệp vụ (`NotFoundError`, `AppError`) | Service | Exception handler của mình → JSON theo format riêng |
| Sai input | Pydantic (trước khi vào endpoint) | 422, FastAPI tự xử lý |
| Xác thực, quyền | Dependency (`HTTPException`) | 401/403 |
| Bug không lường trước | Bất kỳ đâu | 500, nên log kèm `request_id` |

Gắn `request_id` vào body lỗi giúp khi người dùng báo lỗi, chỉ cần tìm id đó trong log là ra cả request.

## Tổng kết: checklist dựng dự án FastAPI mới

1. `uv init` + `pyproject.toml`, commit `uv.lock`.
2. Chạy bằng Uvicorn: `--reload` khi dev, `--workers` (hoặc nhiều pod) khi production; nhớ nhân pool size với số worker.
3. Chia lớp: `models` (DB) ≠ `schemas` (API); repository → service → endpoint, mỗi lớp chỉ làm việc của mình.
4. Config gom vào `Settings` (pydantic-settings), `get_settings()` có `@lru_cache`.
5. Engine, pool, Redis client tạo **một lần** trong `lifespan`, đóng sau `yield`.
6. Session DB tạo **mỗi request** qua `get_db` có `yield`, tự trả kết nối về pool.
7. Dựng service bằng `Depends`, dùng `Annotated` alias cho gọn, thay bằng `dependency_overrides` khi test.
8. Trong `async def` chỉ dùng thư viện async; thư viện đồng bộ thì dùng `def`.
9. Service raise exception nghiệp vụ, `exception_handler` chuyển thành JSON lỗi thống nhất kèm `request_id`.
10. Migration bằng Alembic, việc nặng đẩy sang `workers/`.
