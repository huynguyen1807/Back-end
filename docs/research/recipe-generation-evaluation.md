# Đánh giá pipeline sinh công thức AI (gợi ý món ăn từ tồn kho)

Chạy lúc: 2026-11-10T15:45:37.475Z

## Phương pháp

- Hệ thống **không tự huấn luyện mô hình AI**. Phần sinh công thức dùng Gemini (`@google/generative-ai`) qua prompt engineering (`services/aiRecipeProvider.ts`), không có dataset huấn luyện/trọng số do nhóm tự tạo.
- Bằng chứng nghiên cứu ở đây là một **phương pháp đánh giá có kiểm soát**: chạy pipeline AI thật trên các kịch bản đầu vào thực tế (`src/evaluation/recipeGenerationDataset.ts`), sau đó kiểm tra tự động xem kết quả AI trả về có tuân thủ đúng các quy tắc nghiệp vụ mà chính prompt yêu cầu không:
  - **Tên món hợp lệ**: không ở dạng ghép công thức máy móc ("A + B", "Breakfast with …").
  - **Calo bám sát allocation**: lượng calo ước tính nằm trong (hoặc gần) khoảng calo cho phép của khung giờ ăn.
  - **Nguồn nguyên liệu đúng**: công thức khai "đủ nguyên liệu" chỉ dùng thực phẩm có thật trong tồn kho.
  - **Không liệt kê gia vị cơ bản là nguyên liệu thiếu** (muối, đường, dầu ăn, nước mắm…).
  - **Đơn vị hợp lệ**: chỉ dùng g/kg/ml/l/quả/cái theo đúng chuẩn hệ thống.
  - **Đa dạng**: không lặp lại đúng bộ nguyên liệu giữa các công thức gợi ý trong cùng kịch bản.

## Kết quả tổng hợp

| Chỉ số | Kết quả |
|---|---|
| Tổng số công thức AI tạo ra | 13 |
| Tên món hợp lệ | 13/13 (100.0%) |
| Calo bám sát allocation (±30%) | 13/13 (100.0%) |
| Nguyên liệu đúng tồn kho (ENOUGH_INGREDIENTS) | 13/13 (100.0%) |
| Không liệt kê gia vị cơ bản (MISSING_INGREDIENTS) | 13/13 (100.0%) |
| Đơn vị hợp lệ | 13/13 (100.0%) |
| Số công thức trùng nguyên liệu | 0 |

## Chi tiết từng kịch bản

### Đủ nguyên liệu cơ bản (sáng + trưa)
_Tủ lạnh có đủ nguyên liệu phổ biến, kỳ vọng ưu tiên ENOUGH_INGREDIENTS._

Số công thức: 4, số công thức trùng nguyên liệu: 0

| Tên món | Tên hợp lệ | Calo OK | Nguyên liệu đúng | Không gia vị cơ bản | Đơn vị hợp lệ |
|---|---|---|---|---|---|
| Cháo trứng gà cà rốt | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trứng chiên cuộn rau cải | ✅ | ✅ | ✅ | ✅ | ✅ |
| Thịt heo kho cà rốt | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cơm chiên thịt heo rau cải | ✅ | ✅ | ✅ | ✅ | ✅ |

### Nguyên liệu sắp hết hạn, cần món tối
_Hải sản sắp hỏng, kỳ vọng AI ưu tiên dùng hết trước khi hỏng (priorityReasons)._

Số công thức: 3, số công thức trùng nguyên liệu: 0

| Tên món | Tên hợp lệ | Calo OK | Nguyên liệu đúng | Không gia vị cơ bản | Đơn vị hợp lệ |
|---|---|---|---|---|---|
| Tôm xào hành tây | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mực ống nhồi thịt | ✅ | ✅ | ✅ | ✅ | ✅ |
| Canh hải sản thập cẩm | ✅ | ✅ | ✅ | ✅ | ✅ |

### Mục tiêu giảm cân (BMI context)
_BMI thừa cân + mục tiêu giảm cân, kỳ vọng calo nằm sát mức min của allocation._

Số công thức: 3, số công thức trùng nguyên liệu: 0

| Tên món | Tên hợp lệ | Calo OK | Nguyên liệu đúng | Không gia vị cơ bản | Đơn vị hợp lệ |
|---|---|---|---|---|---|
| Ức gà xào bông cải xanh | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gà cuộn dưa leo | ✅ | ✅ | ✅ | ✅ | ✅ |
| Canh ức gà nấu nấm | ✅ | ✅ | ✅ | ✅ | ✅ |

### Tránh trùng lặp công thức đã có
_Đã có "Canh rau cải thịt bằm" trong existingRecipes, kỳ vọng AI không lặp lại đúng công thức này._

Số công thức: 3, số công thức trùng nguyên liệu: 0

| Tên món | Tên hợp lệ | Calo OK | Nguyên liệu đúng | Không gia vị cơ bản | Đơn vị hợp lệ |
|---|---|---|---|---|---|
| Thịt bằm sốt cà chua | ✅ | ✅ | ✅ | ✅ | ✅ |
| Đậu phụ nhồi thịt sốt cà chua | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bún thịt bằm rau cải | ✅ | ✅ | ✅ | ✅ | ✅ |
