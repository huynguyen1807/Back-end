# Đánh giá bộ phân loại danh mục thực phẩm

Chạy lúc: 2026-11-11T06:53:00.988Z

## Phương pháp

- Hệ thống dùng Gemini (`@google/generative-ai`) qua prompt engineering làm lớp AI fallback — không có trọng số học từ dữ liệu.
- **Từ phiên bản này, hệ thống có thêm một lớp model THẬT được huấn luyện** (Naive Bayes, `src/ml/foodCategoryNaiveBayes.ts`, chạy `npm run train:food-category-model`) — trọng số là tần suất từ/danh mục học được từ dữ liệu (`src/seeders/foodCategoryMetadata.ts`), có Laplace smoothing, được lưu lại thành file model (`src/ml/foodCategoryModel.json`) và nạp lại khi inference. Dữ liệu huấn luyện đã được loại trừ mọi mục trùng với bộ eval dưới đây để tránh rò dữ liệu (data leakage) — xem log của script huấn luyện.
- Bằng chứng nghiên cứu ở đây là một **phương pháp đánh giá có kiểm soát**: bộ dữ liệu có nhãn (ground truth) trong `src/evaluation/foodCategoryDataset.ts`, chạy qua các lớp phân loại thật của hệ thống:
  - **(A) Accept-correct**: chọn đúng danh mục có bị báo "không khớp" (false positive) không?
  - **(B) Catch-wrong**: chọn sai danh mục có chủ đích có bị phát hiện và gợi ý đúng không?
  - **(D) Model đã huấn luyện (trong pipeline)**: trên đúng vùng mà rule-based không chắc (NONE/LOW), model Naive Bayes có gợi ý đúng danh mục không?
  - **(C) AI fallback** (chỉ chạy khi có `GEMINI_API_KEY`): trên cùng vùng đó, Gemini có gợi ý đúng danh mục không?
  - **(E) Model đã huấn luyện (độc lập)**: nếu BỎ rule-based, cho model Naive Bayes tự dự đoán toàn bộ 30 case — đo đúng năng lực thật của model khi đứng một mình.

## Kết quả tổng hợp

| Chỉ số | Kết quả |
|---|---|
| Tổng số case | 30 |
| (A) Accept-correct | 30/30 (100.0%) |
| (B) Catch-wrong | 29/30 (96.7%) |
| (D) Model đã huấn luyện đúng | 0/1 (0.0%) |
| (C) AI fallback đúng | 30/30 (100.0%) |
| (E) Model đã huấn luyện (độc lập, toàn bộ 30 case) | 28/30 (93.3%) |

> **Lưu ý đọc số liệu**: (D) chỉ đo trên 1 case rơi vào vùng rule-based không chắc trong bộ eval hiện tại — mẫu quá nhỏ để kết luận. (E) là số liệu đáng tin hơn để đánh giá đúng năng lực của model khi đứng một mình, không được rule-based "che" các case dễ.

## Chi tiết từng case

| Thực phẩm | Danh mục đúng | (A) | (B) | Độ tin cậy rule-based | Model (trong pipeline) | Model (độc lập) | AI gợi ý | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| Thịt bò | Meat | ✅ | ✅ | HIGH | — | Meat (✅) | Thịt (✅) |  |
| Ba chỉ heo | Meat | ✅ | ✅ | HIGH | — | Meat (✅) | Thịt (✅) |  |
| Ức gà | Meat | ✅ | ✅ | HIGH | — | Meat (✅) | Thịt (✅) |  |
| Tôm sú | Seafood | ✅ | ✅ | HIGH | — | Seafood (✅) | Hải sản (✅) |  |
| Mực ống | Seafood | ✅ | ✅ | HIGH | — | Seafood (✅) | Hải sản (✅) |  |
| Nghêu | Seafood | ✅ | ✅ | HIGH | — | Seafood (✅) | Hải sản (✅) |  |
| Cá hồi phi lê | Fish | ✅ | ✅ | HIGH | — | Fish (✅) | Cá (✅) |  |
| Cá basa | Fish | ✅ | ✅ | HIGH | — | Fish (✅) | Cá (✅) |  |
| Cá lóc | Fish | ✅ | ✅ | HIGH | — | Fish (✅) | Cá (✅) |  |
| Cà rốt | Vegetable | ✅ | ✅ | HIGH | — | Fish (❌) | Rau củ (✅) |  |
| Dưa leo | Vegetable | ✅ | ✅ | HIGH | — | Vegetable (✅) | Rau củ (✅) |  |
| Bắp cải | Vegetable | ✅ | ✅ | HIGH | — | Vegetable (✅) | Rau củ (✅) |  |
| Chuối sứ | Fruit | ✅ | ✅ | HIGH | — | Fruit (✅) | Trái cây (✅) |  |
| Cam sành | Fruit | ✅ | ✅ | HIGH | — | Fruit (✅) | Trái cây (✅) |  |
| Xoài cát Hòa Lộc | Fruit | ✅ | ✅ | HIGH | — | Fruit (✅) | Trái cây (✅) |  |
| Trứng gà ta | Egg | ✅ | ✅ | HIGH | — | Egg (✅) | Trứng (✅) |  |
| Sữa tươi không đường | Dairy | ✅ | ✅ | HIGH | — | Dairy (✅) | Sữa và chế phẩm (✅) |  |
| Phô mai lát | Dairy | ✅ | ✅ | HIGH | — | Dairy (✅) | Sữa và chế phẩm (✅) |  |
| Sữa chua Hy Lạp | Dairy | ✅ | ✅ | HIGH | — | Dairy (✅) | Sữa và chế phẩm (✅) |  |
| Gạo ST25 | Dry Food | ✅ | ✅ | HIGH | — | Dry Food (✅) | Đồ khô / ngũ cốc (✅) |  |
| Mì gói | Dry Food | ✅ | ✅ | HIGH | — | Dry Food (✅) | Đồ khô / ngũ cốc (✅) |  |
| Yến mạch | Dry Food | ✅ | ✅ | HIGH | — | Dry Food (✅) | Đồ khô / ngũ cốc (✅) |  |
| Cơm hộp gà nướng | Cooked Food | ✅ | ✅ | HIGH | — | Cooked Food (✅) | Đồ ăn chín (✅) |  |
| Xúc xích đông lạnh | Frozen Food | ✅ | ✅ | HIGH | — | Frozen Food (✅) | Đông lạnh (✅) |  |
| Khổ qua | Vegetable | ✅ | ✅ | HIGH | — | Dry Food (❌) | Rau củ (✅) | Tên có chữ "qua" (= quả) nên dễ bị nhầm là trái cây. |
| Trái thanh trà | Fruit | ✅ | ❌ | NONE | Fruit (❌) | Fruit (✅) | Trái cây (✅) | Đặc sản miền Tây, KHÔNG có trong keywords/foodExamples hiện tại → kỳ vọng rule-based trả về NONE/LOW, là case nên dùng AI hỗ trợ. |
| Trứng vịt lộn | Egg | ✅ | ✅ | HIGH | — | Egg (✅) | Trứng (✅) | Thường được luộc sẵn khi bán nên dễ bị hiểu lầm là món đã chế biến. |
| Canh chua cá lóc | Cooked Food | ✅ | ✅ | HIGH | — | Cooked Food (✅) | Đồ ăn chín (✅) | Vừa có "canh" (Cooked Food) vừa có "cá lóc" (Fish) trong cùng tên — kiểm tra hệ thống có ưu tiên đúng ngữ cảnh "món đã nấu" không. |
| Cá viên | Frozen Food | ✅ | ✅ | MEDIUM | — | Frozen Food (✅) | Đông lạnh (✅) | Vừa khớp "cá" (Fish, keyword+alias, tổng điểm cao) vừa khớp "viên" (Frozen Food) — case kinh điển dễ bị rule-based chấm điểm nghiêng sai về Fish. |
| Há cảo tôm | Frozen Food | ✅ | ✅ | HIGH | — | Frozen Food (✅) | Đông lạnh (✅) | Có "tôm" (Seafood) nhưng bản chất là món đông lạnh chế biến sẵn — kiểm tra từ khóa nguyên liệu có đánh lạc hướng hệ thống không. |
