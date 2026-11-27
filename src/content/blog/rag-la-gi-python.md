---
title: "RAG là gì? Giải thích bằng Python"
description: RAG (Retrieval-Augmented Generation) cho LLM tìm tài liệu liên quan trước rồi mới trả lời. Bài viết đi từ khái niệm, kiến trúc hai luồng, code Python retrieval + generation, tới so sánh với fine-tuning và các vấn đề khi đưa vào backend thật.
pubDate: 2026-06-28
tags: [ai, python, backend]
---

**RAG (Retrieval-Augmented Generation)** là kỹ thuật kết hợp **tìm kiếm dữ liệu** (Retrieval) với **mô hình ngôn ngữ lớn** (LLM) để **sinh câu trả lời** (Generation).

Hiểu đơn giản: thay vì bắt AI trả lời hoàn toàn dựa trên kiến thức đã học lúc huấn luyện, ta cho hệ thống **tìm tài liệu liên quan trước**, rồi đưa tài liệu đó vào làm ngữ cảnh để AI trả lời.

Ví dụ bạn xây chatbot cho công ty, cần trả lời dựa trên tài liệu nội bộ:

- Quy định nghỉ phép.
- Chính sách lương thưởng.
- Tài liệu API.
- Hướng dẫn sử dụng sản phẩm.
- Database documentation.

Nhân viên hỏi:

> "Nhân viên được nghỉ phép bao nhiêu ngày mỗi năm?"

Một LLM thông thường chỉ trả lời được theo kiến thức chung. Nó **không biết** chính sách riêng của công ty bạn, và tệ hơn, nó có thể bịa ra một con số nghe rất hợp lý.

RAG sẽ:

- Tìm tài liệu có nội dung liên quan đến nghỉ phép.
- Lấy đoạn văn bản phù hợp.
- Gửi **câu hỏi + đoạn văn bản** cho LLM.
- LLM trả lời **dựa trên** tài liệu tìm được (và có thể trích nguồn).

## 1. Kiến trúc hoạt động của RAG

RAG có hai luồng tách biệt, chạy vào hai thời điểm khác nhau.

**Luồng chuẩn bị dữ liệu (Indexing)**: chạy khi có tài liệu mới hoặc tài liệu thay đổi.

- Đọc PDF, DOCX, Markdown…
- Chia tài liệu thành các đoạn nhỏ (**chunking**).
- Chuyển từng đoạn thành vector (**embedding**).
- Lưu vector kèm nội dung gốc và metadata (nguồn, ngày cập nhật, quyền truy cập) vào **vector database**.

**Luồng trả lời câu hỏi (Retrieval + Generation)**: chạy mỗi lần user hỏi.

- Nhận câu hỏi.
- Chuyển câu hỏi thành vector **bằng đúng embedding model đã dùng lúc indexing**.
- Tìm những đoạn tài liệu gần nghĩa nhất.
- Ghép các đoạn đó vào prompt (**augmentation**).
- LLM sinh câu trả lời.

Điểm hay bị bỏ qua: vector của câu hỏi và của tài liệu phải nằm **cùng một không gian**. Đổi embedding model thì phải index lại toàn bộ tài liệu.

## 2. Thực hành RAG bằng Python

Ta dựng một chatbot nhỏ trả lời câu hỏi dựa trên chính sách của một công ty thương mại điện tử. Để code ngắn gọn, dữ liệu được giữ trong RAM bằng NumPy thay cho vector database. Về bản chất, vector DB cũng làm đúng việc này, chỉ là ở quy mô lớn hơn và có index để tìm nhanh.

Dữ liệu:

```python
documents = [
    "Chính sách đổi trả: Khách hàng được đổi trả sản phẩm trong vòng 7 ngày kể từ ngày nhận hàng.",
    "Chính sách vận chuyển: Đơn hàng trên 500.000 VND được miễn phí vận chuyển.",
    "Chính sách thanh toán: Hệ thống hỗ trợ thanh toán qua thẻ ngân hàng và ví điện tử.",
    "Chính sách nghỉ phép: Nhân viên có 12 ngày nghỉ phép có lương mỗi năm.",
    "Chính sách hoàn tiền: Tiền sẽ được hoàn trong vòng 5 đến 7 ngày làm việc.",
]
```

Có một tài liệu nội bộ (nghỉ phép) lẫn vào dữ liệu cho khách hàng. Mình cố ý giữ nó để minh hoạ một vấn đề thật: nếu không phân quyền, chatbot khách hàng vẫn có thể lôi tài liệu nhân sự ra trả lời. Phần 5 sẽ nói kỹ hơn.

Người dùng hỏi:

> Nếu mua hàng 600.000 VND thì có được miễn phí ship không?

### Retrieval

Bước đầu tiên là tìm tài liệu liên quan tới câu hỏi.

```bash
pip install sentence-transformers numpy
```

**Lưu ý về chọn model.** Nhiều bài hướng dẫn dùng `all-MiniLM-L6-v2`, nhưng model này được huấn luyện chủ yếu trên **tiếng Anh**. Với tiếng Việt, kết quả tìm kiếm sẽ kém và khó đoán. Ở đây mình dùng model đa ngôn ngữ `paraphrase-multilingual-MiniLM-L12-v2`. Khi làm thật, nên thử thêm `intfloat/multilingual-e5-base` hoặc `BAAI/bge-m3` và đo trên dữ liệu của chính bạn.

```python
from sentence_transformers import SentenceTransformer
import numpy as np

documents = [
    "Chính sách đổi trả: Khách hàng được đổi trả sản phẩm trong vòng 7 ngày kể từ ngày nhận hàng.",
    "Chính sách vận chuyển: Đơn hàng trên 500.000 VND được miễn phí vận chuyển.",
    "Chính sách thanh toán: Hệ thống hỗ trợ thanh toán qua thẻ ngân hàng và ví điện tử.",
    "Chính sách nghỉ phép: Nhân viên có 12 ngày nghỉ phép có lương mỗi năm.",
    "Chính sách hoàn tiền: Tiền sẽ được hoàn trong vòng 5 đến 7 ngày làm việc.",
]

# Model đa ngôn ngữ, hỗ trợ tiếng Việt
model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

# Indexing: encode tài liệu MỘT LẦN, không encode lại mỗi lần hỏi.
# normalize_embeddings=True => độ dài vector = 1, nên dot product chính là cosine similarity.
document_vectors = model.encode(documents, normalize_embeddings=True)


def retrieve(query: str, top_k: int = 2, min_score: float = 0.3):
    query_vector = model.encode([query], normalize_embeddings=True)[0]

    # Cosine similarity giữa câu hỏi và mọi tài liệu
    scores = document_vectors @ query_vector

    # Lấy top K điểm cao nhất
    indices = np.argsort(scores)[::-1][:top_k]

    return [
        {"id": int(i), "document": documents[i], "score": float(scores[i])}
        for i in indices
        if scores[i] >= min_score  # bỏ kết quả quá xa, tránh nhồi rác vào prompt
    ]


query = "Đơn hàng 600.000 đồng có được miễn phí ship không?"
for item in retrieve(query):
    print(item)
```

Kết quả mong đợi là tài liệu về **vận chuyển** đứng đầu. Con số `score` cụ thể phụ thuộc model, nên đừng copy ngưỡng `min_score = 0.3` sang hệ thống khác mà không đo lại. Ngưỡng này phải chỉnh dựa trên một bộ câu hỏi mẫu của chính bạn.

Vì sao cần `min_score`? `top_k` **luôn** trả về đủ K kết quả, kể cả khi không có tài liệu nào liên quan. Hỏi "Công ty có bán xe máy không?" thì vẫn nhận về 2 đoạn gần nhất, dù chẳng đoạn nào trả lời được. Không có ngưỡng, LLM sẽ nhận ngữ cảnh sai và dễ trả lời bậy.

### Generation

Tiếp theo, đưa kết quả tìm được vào LLM. Ví dụ dùng OpenAI SDK; các nhà cung cấp khác (Anthropic, Gemini, Ollama chạy local…) làm tương tự, chỉ khác client và tên model.

```bash
pip install openai
export OPENAI_API_KEY=...
```

```python
from openai import OpenAI

client = OpenAI()  # đọc key từ biến môi trường OPENAI_API_KEY

SYSTEM_PROMPT = """Bạn là chatbot hỗ trợ khách hàng.
Chỉ trả lời dựa trên các tài liệu trong CONTEXT.
Nếu CONTEXT không có thông tin để trả lời, hãy nói: "Tôi chưa có thông tin về vấn đề này."
Khi trả lời, ghi rõ nguồn theo dạng [doc-<id>]."""


def generate_answer(query: str, retrieved_docs: list[dict]) -> str:
    # Không tìm được gì đủ liên quan: trả lời luôn, không gọi LLM (đỡ tốn tiền, đỡ bịa)
    if not retrieved_docs:
        return "Tôi chưa có thông tin về vấn đề này."

    context = "\n".join(
        f"[doc-{item['id']}] {item['document']}" for item in retrieved_docs
    )

    response = client.chat.completions.create(
        model="gpt-4.1-mini",  # đổi theo model bạn đang dùng
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"CONTEXT:\n{context}\n\nQUESTION:\n{query}"},
        ],
        temperature=0,
    )
    return response.choices[0].message.content


query = "Đơn hàng 600.000 đồng có được miễn phí ship không?"
print(generate_answer(query, retrieve(query)))
```

So với cách nhét hết vào một prompt duy nhất, có vài chỉnh sửa đáng chú ý:

- **Chỉ dẫn nằm trong `system`, dữ liệu nằm trong `user`.** Model tuân thủ quy tắc ổn định hơn, và tài liệu khó "ghi đè" chỉ dẫn hơn (dù không chặn được hoàn toàn prompt injection).
- **Đánh số tài liệu** để LLM trích nguồn, người dùng kiểm chứng được.
- **Không có tài liệu thì không gọi LLM.** Đây là lớp chặn bịa đặt rẻ và hiệu quả nhất.

Kết quả mong đợi, đại ý:

```text
Có. Đơn hàng trên 500.000 VND được miễn phí vận chuyển,
nên đơn 600.000 VND của bạn được miễn phí ship [doc-1].
```

Đây chính là RAG cơ bản:

```text
User Question  →  "Đơn hàng 600.000 VND có miễn phí ship không?"
      │
Retrieval      →  tìm tài liệu liên quan (ở đây là NumPy, thực tế là vector DB)
      │
Augmentation   →  ghép tài liệu tìm được vào prompt
      │
Generation     →  LLM sinh câu trả lời kèm nguồn
```

## 3. Những thành phần quan trọng

| Thành phần | Vai trò | Công cụ Python |
|---|---|---|
| Document Loader | Đọc PDF, DOCX, HTML… | pypdf, Unstructured, Docling |
| Chunking | Chia tài liệu thành đoạn nhỏ | Tự viết, LangChain text splitters |
| Embedding | Chuyển văn bản thành vector | Sentence Transformers, API embedding |
| Vector Database | Lưu và tìm vector | ChromaDB, Qdrant, pgvector, Pinecone |
| Retriever | Tìm tài liệu liên quan (vector, keyword, hybrid) | Qdrant, rank_bm25, LangChain |
| Reranker | Sắp xếp lại kết quả cho chính xác hơn | Cross-encoder (vd `BAAI/bge-reranker-v2-m3`) |
| LLM | Sinh câu trả lời | OpenAI, Anthropic, Gemini, Ollama |
| Evaluation | Đo chất lượng retrieval và câu trả lời | Ragas, bộ test tự xây |
| Pipeline | Kết nối toàn bộ quy trình | Tự viết, LangChain, LlamaIndex |

Hai dòng mình thêm vào so với bảng thường thấy:

- **Reranker.** Vector search nhanh nhưng thô. Cách phổ biến: lấy top 20–50 bằng vector search, rồi dùng cross-encoder chấm lại để giữ top 3–5 thật sự liên quan.
- **Evaluation.** Không đo thì không biết sửa chunking hay đổi model có làm hệ thống tốt lên hay không.

Thêm một lưu ý: với dữ liệu chứa **mã sản phẩm, số hiệu điều khoản, tên riêng**, vector search hay trượt. Kết hợp với keyword search (BM25), gọi là **hybrid search**, thường cải thiện đáng kể.

## 4. RAG khác gì fine-tuning?

Đây là điểm rất nhiều developer nhầm lẫn.

| RAG | Fine-tuning |
|---|---|
| Tìm dữ liệu bên ngoài lúc có câu hỏi | Điều chỉnh model qua training |
| Cập nhật dữ liệu dễ: index lại tài liệu là xong | Muốn cập nhật kiến thức phải train lại |
| Trích được nguồn, kiểm chứng được | Không biết model "nhớ" từ đâu ra |
| Phân quyền theo từng tài liệu được | Kiến thức đã vào trọng số thì ai hỏi cũng lộ |
| Phù hợp dữ liệu doanh nghiệp, thay đổi thường xuyên | Phù hợp điều chỉnh hành vi, văn phong, định dạng output |
| Không thay đổi trọng số model | Thay đổi trọng số model |

Ví dụ:

- Muốn AI biết chính sách mới của công ty → **RAG**.
- Muốn AI phân loại ticket theo format riêng → **fine-tuning** có thể phù hợp (nhưng nên thử few-shot prompt trước, thường là đủ).
- Muốn chatbot trả lời dựa trên hàng triệu tài liệu nội bộ → **RAG**.

Hai cách không loại trừ nhau. Có thể fine-tune để model trả lời đúng giọng điệu, đồng thời dùng RAG để cung cấp kiến thức.

## 5. Đưa RAG vào một dự án backend thực tế

Với một hệ thống thương mại điện tử, có thể dựng:

**Project: E-commerce AI Knowledge Assistant**

- **Backend:** Python FastAPI.
- **LLM:** OpenAI, Anthropic hoặc Ollama (chạy local nếu dữ liệu không được ra ngoài).
- **Embedding:** Sentence Transformers (model đa ngôn ngữ).
- **Vector DB:** Qdrant (hoặc pgvector nếu đã dùng PostgreSQL và dữ liệu chưa quá lớn).
- **PostgreSQL:** lưu user, conversation, document metadata.
- **Queue / worker:** chạy indexing ở background, vì parse và embed tài liệu lớn mất nhiều thời gian.
- **Redis:** cache embedding của câu hỏi lặp lại, cache kết quả, rate limit.

Các API:

```text
POST   /documents/upload        # upload, trả về document_id
POST   /documents/{id}/index    # đẩy job indexing vào queue
GET    /documents/{id}/status   # pending / indexing / ready / failed
POST   /chat
GET    /chat/history
DELETE /documents/{id}          # xoá cả file lẫn toàn bộ vector của tài liệu
```

Những vấn đề production thực sự phải giải quyết, kèm hướng xử lý:

- **Tài liệu được cập nhật thì đồng bộ vector cũ thế nào?** Lưu `document_id` và `version` (hoặc hash nội dung) trong metadata của từng chunk. Khi cập nhật: index bản mới, xong mới xoá chunk của bản cũ, để không có lúc nào tài liệu "biến mất".
- **Tìm được 10 đoạn nhưng 5 đoạn không liên quan?** Đặt ngưỡng điểm, dùng reranker, và giới hạn số token context đưa vào LLM.
- **Ngăn LLM trả lời khi không có bằng chứng?** Không có tài liệu đạt ngưỡng thì không gọi LLM; bắt buộc trích nguồn; có thể kiểm tra lại xem nguồn được trích có thật sự nằm trong context không.
- **Phân quyền để user A không đọc được tài liệu của user B?** Lọc theo metadata (`tenant_id`, `role`…) **ngay trong câu truy vấn vector DB**, không phải lọc sau khi đã lấy kết quả, và tuyệt đối không giao việc này cho prompt. Đây cũng là lý do tài liệu nghỉ phép ở ví dụ trên không được phép xuất hiện trong chatbot khách hàng.
- **Prompt injection từ tài liệu.** Một tài liệu có thể chứa câu kiểu "bỏ qua mọi chỉ dẫn trước đó…". Xem nội dung tài liệu là dữ liệu không tin cậy, và đừng cấp cho LLM quyền gọi tool nguy hiểm dựa trên nội dung đó.
- **Giảm latency khi 1.000 người hỏi cùng lúc?** Load embedding model một lần khi khởi động, dùng async client cho LLM, stream câu trả lời, cache, và đặt timeout + fallback cho lời gọi LLM.
- **Đánh giá retrieval có tìm đúng không?** Xây bộ vài chục tới vài trăm cặp (câu hỏi → tài liệu đúng), đo **recall@k** và **MRR** mỗi lần đổi chunking, model hay ngưỡng.

Mấy điểm về phân quyền, cache và fallback mình đã viết chi tiết hơn ở bài [Tích hợp LLM vào hệ thống: chatbot nội bộ và những thứ không ai nói trước](/blog/tich-hop-llm-chatbot-noi-bo/).

## Kết

RAG không đơn giản là nối vector DB với ChatGPT. Chất lượng hệ thống phụ thuộc rất lớn vào **chunking, embedding, retrieval, reranking và khả năng đánh giá**. LLM giỏi đến đâu cũng không cứu được một bước retrieval tìm sai dữ liệu: đưa vào rác thì nhận ra rác, chỉ là rác được viết rất trôi chảy.

Nếu học RAG để làm backend engineer, mình khuyên nên học sâu retrieval, vector search, data pipeline, API và concurrency trước khi tập trung vào LangChain. Đó là những kiến thức có giá trị lâu dài hơn việc chỉ biết dùng một framework.
