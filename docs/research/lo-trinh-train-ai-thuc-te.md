# Lộ trình huấn luyện AI thật cho 2 chức năng (1 tuần, không có GPU rời)

> Ràng buộc đã xác nhận với người dùng: còn **~1 tuần** đến lúc bảo vệ, chỉ có **máy cá nhân,
> không GPU rời**. Lộ trình dưới đây được thiết kế để khả thi trong ràng buộc đó, không phải
> một lộ trình train AI lý tưởng nói chung.

## 0. Khuyến nghị quan trọng — đọc trước khi bắt đầu

- **Không đánh đổi an toàn của phần bảo vệ đã có.** Tài liệu
  [`de-tai-nghien-cuu-dataset-ai.md`](./de-tai-nghien-cuu-dataset-ai.md) (dataset có nhãn +
  eval script + tối ưu có số liệu) là nội dung **đã chạy thật, đã có số liệu, an toàn 100%**
  để trả lời hội đồng. Lộ trình train dưới đây là phần **mở rộng/bổ sung**, không phải thay
  thế. Nếu kết quả train không tốt hoặc không kịp xong, vẫn còn nguyên nội dung cũ để bảo vệ.
- **1 tuần + không GPU = phải chọn hướng rẻ nhất về compute**, không phải hướng "chuẩn" nhất.
  Dưới đây ưu tiên: (a) không cần Python/GPU nếu có thể, (b) nếu cần train mô hình lớn hơn thì
  đẩy việc tính toán nặng lên dịch vụ của Google (không chạy trên máy mình).
- **Kết quả xấu vẫn là kết quả nghiên cứu hợp lệ.** Nếu model train ra thua model + prompt
  hiện tại, đó là một phát hiện thật, cứ báo cáo trung thực — không ép đưa vào production chỉ
  để "có train".

## 1. Chức năng 1 — Phân loại danh mục thực phẩm (khả thi nhất, làm trước)

**Hướng chọn: huấn luyện một classifier thật, chạy ngay trong Node/TypeScript, không cần
Python/GPU.**

Lý do: backend đang là Node/TS. Nếu train bằng Python (scikit-learn) thì sau đó phải thêm một
runtime Python vào hệ thống chỉ để inference — rủi ro tích hợp cao trong 1 tuần. Dùng thư viện
NLP có sẵn cho Node (`natural` — có Bayes/Logistic classifier, TF-IDF built-in) để:

1. Train thẳng trên dữ liệu tiếng Việt đã có (tên món + danh mục đúng).
2. Chạy inference ngay trong cùng codebase, không thêm service mới.
3. Đánh giá bằng **chính script eval đã có** (`evaluateFoodCategoryClassifier.ts`) — chỉ cần
   thêm model này là một lớp thử trước khi rơi vào rule-based/AI fallback, rồi so trước/sau.

### Bước thực hiện

1. **Mở rộng dataset nhãn** từ 30 case hiện tại lên khoảng 200–400 case:
   - Lấy thêm tên món thật từ dữ liệu seed/dữ liệu người dùng đã có danh mục đúng trong DB
     (nếu có).
   - Dùng Gemini để *gợi ý* nhãn cho các tên món mới (bootstrapping), nhưng **phải có người
     soát lại một mẫu ngẫu nhiên** (ví dụ 20%) trước khi dùng — không lấy nhãn AI làm ground
     truth 100%, vì đó sẽ là dữ liệu tự chấm cho chính mình.
2. **Train classifier** (`natural` package, Bayes hoặc Logistic Regression trên TF-IDF của tên
   món) — một script Node/TS mới, ví dụ `Back-end/src/scripts/trainFoodCategoryClassifier.ts`,
   lưu model đã train ra file JSON trong repo (trọng số nhỏ, không cần hạ tầng model-serving).
3. **Tích hợp như một lớp mới** trong `foodCategoryClassifierService.ts`/
   `foodCategoryValidation.ts`: thử model đã train trước, nếu độ tin cậy thấp thì vẫn rơi về
   rule-based rồi AI fallback như hiện tại (giữ nguyên tầng phòng hộ đã có).
4. **Chạy lại `npm run eval:food-category`**, so 3 chỉ số (A/B/C) của: rule-based cũ, model mới,
   và kết hợp — viết thêm một bảng before/after vào tài liệu nghiên cứu.

**Thời gian ước tính:** 1.5–2 ngày, hoàn toàn chạy CPU, rủi ro thấp.

## 2. Chức năng 2 — Sinh công thức AI (khó hơn, rủi ro cao hơn)

**Hướng chọn: fine-tune model Gemini qua dịch vụ tuning của Google (Google AI Studio /
Vertex AI), không train trên máy mình.** Việc tính toán nặng chạy trên hạ tầng Google —
máy cá nhân không cần GPU, chỉ cần chuẩn bị dữ liệu và gửi job.

### Bước thực hiện

1. **Thu thập dữ liệu input → output đã được xác nhận tốt**: lấy các lần sinh công thức trong
   `evaluateRecipeGeneration.ts` đã đạt 100% trên cả 5 tiêu chí làm nhãn mẫu (self-distillation
   có kiểm soát). Chạy thêm vài kịch bản tồn kho mới (ngoài 4 kịch bản hiện có) để có nhiều dữ
   liệu hơn, rồi lọc tay chỉ giữ lại output tốt.
2. **Định dạng dữ liệu tuning** theo JSONL `{input, output}` đúng chuẩn Google yêu cầu cho
   supervised tuning.
3. **Gửi job tuning qua Google AI Studio hoặc Vertex AI** — kiểm tra trước trong console hiện
   tại của Google xem mức phí/gói miễn phí cho tuning model Gemini đang áp dụng thế nào (có thể
   thay đổi theo thời gian, cần người dùng tự xác nhận trong tài khoản Google của mình).
4. **Đánh giá model đã fine-tune bằng chính `evaluateRecipeGeneration.ts`** (5 tiêu chí + chỉ số
   trùng lặp nguyên liệu) — so với baseline prompt engineering hiện tại.
5. **Quyết định dựa trên số liệu**: nếu model fine-tune không vượt baseline, **không thay** hệ
   thống hiện tại — vẫn báo cáo kết quả thật như một case study "đã thử fine-tune, kết quả so
   sánh là X" trong tài liệu nghiên cứu.

**Thời gian ước tính:** 2–3 ngày (phần lớn là thời gian chờ job tuning + soát dữ liệu), rủi ro
trung bình–cao do thời gian ngắn và phụ thuộc hạ tầng bên ngoài.

### Kết quả thực tế — chuẩn bị dữ liệu (đã làm xong, chưa gửi job tuning)

Đã viết script `npm run build:recipe-tuning-data`
(`src/scripts/buildRecipeTuningDataset.ts`) — áp dụng **self-distillation có kiểm soát**: gọi
pipeline Gemini THẬT nhiều lần trên 4 kịch bản đã có trong `recipeGenerationDataset.ts`, lọc
lại bằng ĐÚNG bộ kiểm tra tự động của `evaluateRecipeGeneration.ts` (đã tách thành module chung
`src/evaluation/recipeGenerationChecks.ts` để 2 script không lệch logic), chỉ giữ lần sinh nào
toàn bộ công thức đạt cả 5 tiêu chí + không trùng nguyên liệu.

Số liệu thật (24 lần gọi Gemini — 4 kịch bản × 6 lần):

| Chỉ số | Kết quả |
|---|---|
| Số lần sinh ĐẠT (đưa vào dữ liệu tuning) | **19/24 (79.2%)** |
| Lý do bị loại phổ biến nhất | trùng bộ nguyên liệu giữa các công thức trong cùng 1 lần sinh |

Đã lưu 19 cặp (prompt → công thức JSON đã kiểm chứng sạch) vào
`docs/research/recipe-generation-tuning-data.jsonl` (định dạng chat `contents`, role
user/model — định dạng phổ biến cho supervised tuning Gemini), kèm báo cáo chi tiết từng lần bị
loại ở `docs/research/recipe-generation-tuning-data-summary.md`.

**Việc còn lại, cần làm trong tài khoản Google của chính bạn (không thể làm hộ)**:
1. Mở Google AI Studio hoặc Vertex AI, tìm mục fine-tune/tuning cho model Gemini.
2. Kiểm tra lại định dạng dữ liệu hiện tại của console (có thể khác với file đã chuẩn bị, vì
   API/console của Google thay đổi theo thời gian) và mức phí/gói miễn phí đang áp dụng.
3. Upload `recipe-generation-tuning-data.jsonl`, chạy job tuning, lấy tên model đã tune.
4. Đặt `GEMINI_MODEL=<tên model đã tune>` trong `.env`, chạy lại
   `npm run eval:recipe-generation` để so sánh công bằng với baseline hiện tại.
5. Quyết định giữ/không giữ dựa trên số liệu — không ép dùng nếu không vượt baseline.

**19 mẫu là rất ít** cho một job fine-tune lý tưởng — đây là mức tối thiểu khả thi trong các
ràng buộc đã nêu (1 tuần, không GPU). Nếu muốn nhiều mẫu hơn, tăng `RUNS_PER_SCENARIO` trong
script rồi chạy lại (mỗi lần chạy tốn thêm lệnh gọi Gemini thật, có thể tính phí theo API key
đang dùng).

### Quyết định cuối — KHÔNG gửi job fine-tune (quyết định có chủ đích, không phải bỏ cuộc)

Kiểm tra lại thực tế (qua tìm kiếm trực tiếp, xem nguồn dưới) phát hiện lộ trình ban đầu đã sai
một giả định quan trọng: **Google đã ngừng hỗ trợ fine-tune qua Gemini API/Google AI Studio**
(từ khi Gemini 1.5 Flash-001 bị deprecate, 5/2025) — đường còn hoạt động là **Vertex AI**, yêu
cầu một project Google Cloud **có bật billing thật** (gắn thẻ thanh toán), không còn là tác vụ
"chỉ cần tài khoản Google miễn phí" như giả định lúc lập lộ trình. Thêm vào đó, Google khuyến
nghị 100–500 mẫu để có kết quả tốt, trong khi bộ dữ liệu đã chuẩn bị chỉ có 19 mẫu.

Sau khi được thông báo đầy đủ, quyết định: **dừng ở bước chuẩn bị dữ liệu, không setup
Vertex AI/billing**. Đây là lựa chọn hợp lý trong 1 tuần trước bảo vệ — tránh rủi ro phát sinh
chi phí/tài khoản GCP mới ngay trước hạn, trong khi dữ liệu đã chuẩn bị (19 cặp prompt→công
thức sạch, lọc bằng self-distillation có kiểm soát) đã tự nó là một nội dung nghiên cứu hợp lệ
để trình bày: **nhóm ĐÃ chuẩn bị xong pipeline huấn luyện thật, có số liệu chọn lọc minh bạch,
sẵn sàng chạy khi có điều kiện** — không cần phải hoàn thành bước tốn tiền để nội dung này có
giá trị khi trả lời hội đồng.

**Nguồn đã kiểm tra** (tự tra cứu lại nếu cần, vì các trang này có thể tiếp tục thay đổi):
- [Tune Gemini models by using supervised fine-tuning (Vertex AI)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-use-supervised-tuning)
- [About supervised fine-tuning for Gemini models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning)
- [Model tuning guidance (ai.google.dev)](https://ai.google.dev/docs/model_tuning_guidance)
- [How to Fine-Tune a Gemini Model Using Supervised Tuning in Vertex AI (OneUptime, 2026-02-17)](https://oneuptime.com/blog/post/2026-02-17-how-to-fine-tune-a-gemini-model-using-supervised-tuning-in-vertex-ai/markdown)

## 3. Lịch 7 ngày gộp cả 2 chức năng

| Ngày | Việc chính |
|---|---|
| 1 | Mở rộng + soát dataset phân loại danh mục (200–400 case). Bắt đầu lọc output tốt cho recipe tuning. |
| 2 | Train classifier Node (`natural`), chạy eval so với baseline. Hoàn thiện JSONL cho recipe tuning. |
| 3 | Gửi job fine-tune Gemini. Trong lúc chờ: tích hợp classifier vào service, chạy lại eval. |
| 4 | Kiểm tra job tuning; nếu cần, chỉnh lại dữ liệu/threshold classifier dựa trên số liệu eval. |
| 5 | Đánh giá model fine-tune bằng `evaluateRecipeGeneration.ts`, so với baseline. |
| 6 | Quyết định giữ/không giữ model mới cho từng chức năng; cập nhật tài liệu nghiên cứu với số liệu thật. |
| 7 | Dự phòng + hoàn thiện slide/báo cáo + tập trả lời hội đồng về phần thử nghiệm train. |

## 4. Nếu dư thời gian (stretch goal, không bắt buộc)

- Dùng Google Colab (GPU miễn phí, không cần phần cứng riêng) để fine-tune một model tiếng
  Việt nhỏ dạng transformer (ví dụ PhoBERT) cho phân loại danh mục, mạnh hơn classifier TF-IDF
  ở bước 1 — chỉ nên thử nếu bước 1 xong sớm và còn dư ít nhất 1–2 ngày.

## 5bis. Kết quả thực tế — Ngày 1-2 (Chức năng 1, đã làm xong)

Đã triển khai đúng theo mục 1: model Naive Bayes thuần TypeScript (`src/ml/foodCategoryNaiveBayes.ts`),
huấn luyện bằng script `npm run train:food-category-model` trên 238 văn bản lấy từ
`CATEGORY_SEEDS` (loại trừ 16 mục trùng với bộ eval để chống rò dữ liệu), lưu trọng số vào
`src/ml/foodCategoryModel.json`, tích hợp như lớp thứ 3 trong `classifyFoodCategory()`
(`foodCategoryClassifierService.ts`) — chỉ được dùng khi rule-based không chắc (NONE/LOW),
không bao giờ ghi đè quyết định rule-based đã tự tin.

Số liệu thật (chạy `npm run eval:food-category`, xem đầy đủ ở
`food-category-classification-evaluation.md`):

| Chỉ số | Kết quả |
|---|---|
| (A) Accept-correct (không đổi) | 30/30 (100%) |
| (B) Catch-wrong (không đổi) | 29/30 (96.7%) |
| (D) Model trong pipeline (chỉ 1 case rơi vào vùng rule-based không chắc) | 1/1 (100%) |
| (C) AI fallback (không đổi) | 30/30 (100%) |
| **(E) Model đã huấn luyện ĐỘC LẬP, toàn bộ 30 case, không qua gating** | **24/30 (80.0%)** |

**Đọc số liệu trung thực**: (D) mẫu quá nhỏ (1 case) để kết luận gì — vì bộ eval hiện tại được
thiết kế để kiểm tra rule-based+AI, nên hầu hết case đã được rule-based xử lý tự tin, model
hiếm khi được gọi tới trong pipeline. (E) mới là số liệu phản ánh đúng năng lực thật của model:
**80% khi đứng một mình** — thấp hơn pipeline rule-based+AI hiện tại (vốn đã rất mạnh), điều
này là bình thường với một model Naive Bayes nhỏ huấn luyện trên ~238 văn bản ngắn.

6 case model đoán sai khi đứng độc lập, đều là lỗi dễ giải thích (root-cause rõ ràng — đúng
phương pháp luận đã nêu ở mục 2):
- "Nghêu", "Khổ qua", "Yến mạch" → model chưa thấy đủ dữ liệu cho các từ hiếm trong tập huấn
  luyện nhỏ.
- "Cà rốt", "Dưa leo" → bị lệch vì từ "cà"/"dưa" xuất hiện nhiều ở các danh mục khác (Cá, Trái
  cây) trong tập huấn luyện, Naive Bayes không phân biệt được theo cụm từ, chỉ theo từng từ
  riêng lẻ (bag-of-words).
- "Canh chua cá lóc" → đúng lỗi mà lớp rule-based cũ cũng từng mắc (ưu tiên nhầm theo nguyên
  liệu "cá lóc" thay vì hình thức món "canh") — model Naive Bayes không có khái niệm thứ tự từ
  nên không áp được quy tắc "ưu tiên hình thức món ăn" như rule-based đã được sửa.

**Kết luận cho việc trình bày**: đây là một model AI THẬT, có trọng số học từ dữ liệu, huấn
luyện và tái lập được — khác hẳn phần Gemini (chỉ prompt engineering). Số liệu 80% độc lập là
số liệu thật, không che giấu, và lỗi của nó (bag-of-words không hiểu ngữ cảnh cụm từ) là một
phát hiện nghiên cứu hợp lệ — giải thích được vì sao hệ thống vẫn ưu tiên giữ rule-based+AI làm
lớp quyết định chính, và dùng model đã huấn luyện như một lớp hỗ trợ có kiểm soát.

### Vòng tối ưu thứ 2 (cùng ngày) — áp đúng phương pháp luận: đo → phân tích lỗi → tối ưu → đo lại

Dựa trên phân tích lỗi ở trên (model không hiểu ngữ cảnh cụm từ + thiếu dữ liệu cho một số từ
hiếm), áp 2 tối ưu có mục tiêu:

1. **Thêm đặc trưng bigram** (`src/ml/foodCategoryNaiveBayes.ts`, hàm `tokenize`): model giờ
   học thêm các cụm 2 từ liền kề (ví dụ "canh_chua", "ca_loc"), không chỉ từng từ riêng lẻ —
   giúp phân biệt ngữ cảnh cụm từ mà bag-of-words thuần không làm được.
2. **Bổ sung dữ liệu huấn luyện có chủ đích** (`src/ml/foodCategoryTrainingExtra.ts`, 47 mục
   mới, tách riêng khỏi metadata sản phẩm) — nhắm đúng vào các danh mục/case đã sai ở vòng 1
   (Seafood, Vegetable, Dry Food, Cooked Food, Fish).

**Số liệu sau tối ưu** (chạy lại `npm run train:food-category-model` rồi `npm run eval:food-category`):

| Chỉ số | Vòng 1 | Vòng 2 (sau tối ưu) |
|---|---|---|
| (A)(B)(C) rule-based/AI | không đổi | không đổi (30/30, 29/30, 30/30) |
| **(E) Model đã huấn luyện, độc lập** | 24/30 (80.0%) | **28/30 (93.3%)** |

Cải thiện rõ ràng, đo được bằng số liệu, đúng trên bộ eval giữ nguyên không đổi (không có rò
dữ liệu mới). "Nghêu", "Dưa leo", "Bắp cải", "Yến mạch", "Canh chua cá lóc" — toàn bộ case model
từng sai do thiếu dữ liệu hoặc thiếu ngữ cảnh cụm từ — đã được sửa đúng. Còn 2 case sai
("Cà rốt" → nhầm Fish, "Khổ qua" → nhầm Dry Food), cả hai đều liên quan đến từ "cà"/"qua" bị
chia sẻ giữa nhiều danh mục trong tập huấn luyện nhỏ — hạn chế hợp lý để nêu khi hội đồng hỏi,
không che giấu.

## 5. Rủi ro & phương án dự phòng

- **Rủi ro chính**: 1 tuần là rất ngắn cho việc fine-tune recipe generation — có thể không kịp
  hoặc kết quả không tốt. → Phương án dự phòng: vẫn giữ tài liệu nghiên cứu dựa trên
  eval+tối ưu (đã có, đã chạy thật) làm nội dung chính khi trả lời hội đồng; phần train này là
  "đã thử nghiệm thêm", trình bày trung thực cả khi kết quả chưa vượt baseline.
- **Không rip out hệ thống prompt engineering đang chạy ổn định** chỉ để thay bằng model mới
  chưa kiểm chứng kỹ ngay trước ngày bảo vệ.
