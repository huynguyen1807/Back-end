# Đề tài nghiên cứu: Xây dựng dataset có nhãn để đánh giá và tối ưu các pipeline AI (không huấn luyện model)

> Tài liệu này tổng hợp lại thành một "đề tài nghiên cứu" mạch lạc, dùng để đưa vào báo cáo
> (thay cho câu "hệ thống tự huấn luyện AI model" ở Report 1 — câu này **không đúng** với
> những gì code thực sự làm) và dùng khi trả lời hội đồng. Toàn bộ số liệu trong tài liệu
> là số liệu thật, lấy từ 2 lần chạy script đánh giá (`npm run eval:food-category`,
> `npm run eval:recipe-generation`), không phải số liệu minh họa.

## 1. Vấn đề

Hệ thống dùng **Google Gemini** cho các chức năng AI (phân loại danh mục thực phẩm, sinh
công thức nấu ăn từ tồn kho, trích xuất công thức từ video...) thông qua **prompt
engineering** — nhóm **không tự huấn luyện model** (không có dataset huấn luyện, không có
bước cập nhật trọng số, không có pipeline training nào trong code).

Vấn đề đặt ra: khi hệ thống không tự train AI, nhóm chứng minh "có nghiên cứu" bằng cách nào
cho một đồ án tốt nghiệp? Trả lời: bằng một phương pháp **đánh giá có kiểm soát
(controlled evaluation)** dựa trên **dataset có nhãn (ground truth) do nhóm tự xây dựng** —
đây là một hướng nghiên cứu ứng dụng hợp lệ, không cần hạ tầng GPU/training, nhưng vẫn tạo
ra số liệu thật, có thể tái lập (reproducible).

## 2. Phương pháp nghiên cứu

Áp dụng thống nhất cho cả 2 case study dưới đây:

1. **Xây dataset có nhãn thủ công** — cố ý gồm cả case dễ (để xác nhận hệ thống không bị hỏng
   bởi thay đổi) và case khó/mơ hồ (để tìm giới hạn thật của hệ thống, không chọn toàn case
   "dễ ăn điểm").
2. **Viết script đánh giá tự động**, gọi thẳng vào logic/pipeline AI thật đang chạy trong sản
   phẩm (không mock, không giả lập), so khớp kết quả với nhãn.
3. **Đo baseline** bằng số liệu cụ thể (tỉ lệ đúng/sai trên từng tiêu chí).
4. **Phân tích lỗi theo từng case** để tìm nguyên nhân gốc (root cause), không chỉ nhìn tỉ lệ
   tổng.
5. **Tối ưu có mục tiêu** (rule-based logic hoặc prompt) dựa trên nguyên nhân gốc tìm được.
6. **Đo lại trên cùng dataset** để so sánh before/after bằng số liệu, không chỉ bằng cảm quan.

## 3. Case study 1 — Phân loại danh mục thực phẩm (rule-based + AI fallback)

- **Dataset**: 30 case (`Back-end/src/evaluation/foodCategoryDataset.ts`) — 24 case dễ (khớp
  trực tiếp keyword/alias/example) và 6 case khó có chủ đích (ví dụ "Khổ qua" dễ nhầm trái
  cây vì có chữ "qua", "Canh chua cá lóc" vừa có từ chỉ món đã nấu vừa có tên một loại cá).
- **3 chỉ số đo**: (A) chấp nhận đúng khi người dùng chọn đúng danh mục, (B) bắt được và gợi
  ý đúng khi người dùng chọn sai danh mục, (C) lớp AI fallback (Gemini) có gợi ý đúng khi
  rule-based không chắc không.

| Chỉ số | Trước tối ưu | Sau tối ưu |
|---|---|---|
| (A) Chấp nhận đúng | 28/30 (93.3%) | **30/30 (100%)** |
| (B) Bắt lỗi sai | 27/30 (90.0%) | **29/30 (96.7%)** |
| (C) AI fallback đúng | 28/30 (93.3%) | **30/30 (100%)** |

**Nguyên nhân lỗi tìm được**: 2 case bị rule-based chấm điểm sai vì tên món **chứa tên một
nguyên liệu thô** bên trong tên món đã chế biến — "Canh chua **cá lóc**" bị tính điểm cao cho
danh mục "Cá" dù bản chất là món canh; "Há cảo **tôm**" bị tính điểm cho "Hải sản" dù bản chất
là món đông lạnh chế biến sẵn.

**Tối ưu áp dụng** (`Back-end/src/utils/foodCategoryValidation.ts`): thêm quy tắc "ưu tiên
hình thức món ăn" — khi tên món chứa từ chỉ món đã chế biến ("canh", "súp", "cơm hộp"...) hoặc
món đông lạnh chế biến sẵn ("há cảo", "chả cá"...), hệ thống bỏ qua gợi ý theo nguyên liệu thô
chứa trong tên, chỉ xét theo bản chất món ăn. Bổ sung từ khóa "há cảo" còn thiếu cho danh mục
Đông lạnh.

Case còn "sai" duy nhất sau tối ưu (Trái thanh trà) là **chủ đích**: đây là đặc sản không có
trong dữ liệu seed, rule-based đúng đắn trả về "không chắc" (NONE) và nhường cho AI fallback —
minh chứng đúng vai trò thiết kế của lớp AI, không phải một lỗi cần sửa.

## 4. Case study 2 — Sinh công thức AI từ tồn kho (Gemini, prompt engineering)

- **Dataset**: 4 kịch bản đầu vào thực tế (`Back-end/src/evaluation/recipeGenerationDataset.ts`)
  — đủ nguyên liệu cơ bản, nguyên liệu sắp hết hạn, mục tiêu giảm cân (có BMI context), và
  tránh trùng lặp công thức đã có.
- **5 tiêu chí đo tự động**, lấy trực tiếp từ các quy tắc nghiệp vụ mà chính prompt của hệ
  thống yêu cầu: tên món hợp lệ, calo bám sát khung giờ ăn, nguyên liệu "đủ sẵn" chỉ dùng
  thực phẩm có thật trong tồn kho, không liệt kê gia vị cơ bản là "nguyên liệu thiếu", đơn vị
  đúng chuẩn hệ thống — cộng với kiểm tra trùng lặp nguyên liệu giữa các công thức.

| Lần chạy | Số công thức | Trùng lặp nguyên liệu |
|---|---|---|
| Trước tối ưu | 15 | 1 |
| Sau tối ưu (lần chạy sạch) | 13 | **0** |

5/5 tiêu chí đơn lẻ đạt 100% ở cả hai lần chạy; khác biệt duy nhất là mức độ trùng lặp.

**Nguyên nhân lỗi tìm được**: ở kịch bản giảm cân, AI tạo 2 công thức dùng chung đúng một bộ
nguyên liệu chính (ức gà + bông cải xanh), chỉ khác kỹ thuật nấu (áp chảo vs xào).

**Tối ưu áp dụng** (`Back-end/src/services/aiRecipeProvider.ts`): bổ sung quy tắc rõ trong
prompt — cấm 2 công thức trong cùng một lần trả lời dùng chung bộ nguyên liệu chính, dù kỹ
thuật nấu khác nhau.

**Phát hiện phụ có giá trị**: quá trình chạy đánh giá thật (không mock) phát hiện model
`gemini-2.5-flash` đã bị Google ngừng hỗ trợ (lỗi 404), đang được dùng làm model dự phòng
cứng trong **6 file** của hệ thống — kể cả chức năng trích xuất công thức từ video YouTube
đang chạy thật trên màn hình Planner. Đây là một ví dụ cho thấy giá trị thực tiễn của việc có
một quy trình đánh giá chạy trên pipeline thật: phát hiện được lỗi hạ tầng mà review code tay
khó thấy ngay.

## 5. Đóng góp của đề tài (dùng khi trả lời hội đồng)

- **Không có tuyên bố sai về "tự huấn luyện AI"**: trình bày đúng bản chất — hệ thống dùng
  model nền (Gemini) có sẵn qua prompt engineering, phần nghiên cứu của nhóm là **phương
  pháp đánh giá và tối ưu có số liệu**, không phải training.
- **Có ground truth tự xây dựng, có thể tái lập**: 2 dataset có nhãn, 2 script đánh giá chạy
  được bất cứ lúc nào (`npm run eval:food-category`, `npm run eval:recipe-generation`), không
  phải số liệu chỉ nói miệng.
- **Có quy trình khoa học đầy đủ**: đo baseline → phân tích nguyên nhân gốc → tối ưu có mục
  tiêu → đo lại để chứng minh cải thiện bằng số liệu, không chỉ "sửa cho chạy".
- **Tối ưu dựa trên dataset mang lại cải thiện đo được**: 93.3%→100% / 90%→96.7% (phân loại
  danh mục), 1 trùng lặp→0 trùng lặp (sinh công thức).

## 6. Hạn chế & hướng phát triển

- Dataset còn ở quy mô nhỏ (30 case + 4 kịch bản) — đủ để minh chứng **phương pháp luận**,
  chưa đủ để khẳng định độ chính xác tổng quát trên mọi trường hợp thực tế.
- Chưa có dataset có nhãn cho chức năng trích xuất công thức từ video (khó gán nhãn tự động
  vì phụ thuộc nội dung video thật).
- Hướng phát triển tiếp theo: mở rộng dataset theo thời gian từ dữ liệu thật của người dùng,
  và chạy lại 2 script đánh giá này như một bước kiểm tra hồi quy (regression check) mỗi khi
  sửa prompt hoặc rule-based logic — biến nó thành một phần của quy trình phát triển, không
  chỉ dùng một lần cho báo cáo.

## 7. Tệp liên quan (để trích dẫn/trình chiếu khi bảo vệ)

- `Back-end/src/evaluation/foodCategoryDataset.ts` — dataset 30 case.
- `Back-end/src/scripts/evaluateFoodCategoryClassifier.ts` — script đánh giá.
- `Back-end/docs/research/food-category-classification-evaluation.md` — báo cáo kết quả.
- `Back-end/src/evaluation/recipeGenerationDataset.ts` — dataset 4 kịch bản.
- `Back-end/src/scripts/evaluateRecipeGeneration.ts` — script đánh giá.
- `Back-end/docs/research/recipe-generation-evaluation.md` — báo cáo kết quả.
- `Back-end/src/utils/foodCategoryValidation.ts` — nơi áp dụng tối ưu case study 1.
- `Back-end/src/services/aiRecipeProvider.ts` — nơi áp dụng tối ưu case study 2.
