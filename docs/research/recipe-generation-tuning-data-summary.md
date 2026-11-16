# Dữ liệu fine-tune cho chức năng sinh công thức AI (chuẩn bị, chưa gửi job)

Chạy lúc: 2026-11-11T07:00:57.803Z

**Phương pháp**: chạy pipeline Gemini thật trên các kịch bản đã có, lọc lại bằng đúng bộ kiểm tra tự động của `npm run eval:recipe-generation`; chỉ giữ lần sinh nào TOÀN BỘ công thức trong phản hồi đạt cả 5 tiêu chí và không trùng nguyên liệu.

- Số kịch bản: 4, số lần chạy/kịch bản: 6 (tổng 24 lần gọi Gemini thật).
- **Số mẫu ĐẠT, đưa vào dữ liệu tuning**: 19.
- File dữ liệu: `docs/research/recipe-generation-tuning-data.jsonl` (định dạng chat contents, 1 JSON object/dòng).

## Các lần bị loại (minh bạch, không che)

- Đủ nguyên liệu cơ bản (sáng + trưa) (lần 1): 1 công thức trùng bộ nguyên liệu
- Đủ nguyên liệu cơ bản (sáng + trưa) (lần 3): 1 công thức trùng bộ nguyên liệu
- Đủ nguyên liệu cơ bản (sáng + trưa) (lần 4): 2 công thức trùng bộ nguyên liệu
- Đủ nguyên liệu cơ bản (sáng + trưa) (lần 6): 2 công thức trùng bộ nguyên liệu
- Mục tiêu giảm cân (BMI context) (lần 2): 1 công thức trùng bộ nguyên liệu

## Lưu ý quan trọng trước khi gửi job fine-tune

- **19 mẫu là RẤT ÍT** cho một job fine-tune (Google thường khuyến nghị nhiều hơn). Đây là dữ liệu tối thiểu khả thi trong 1 tuần không có GPU — nếu muốn kết quả tốt hơn, chạy lại script này với `RUNS_PER_SCENARIO` cao hơn để có thêm mẫu, hoặc viết thêm kịch bản mới trong `recipeGenerationDataset.ts`.
- **Định dạng chính xác của job tuning (tên field, cách upload, mức phí) cần tự kiểm tra lại trong Google AI Studio / Vertex AI hiện tại** — các API/console của Google có thể đã thay đổi so với lúc viết tài liệu này. File `.jsonl` ở trên dùng định dạng chat `contents` (role user/model) là định dạng phổ biến cho supervised tuning Gemini, nhưng hãy xác nhận lại trước khi gửi.
- Sau khi có model đã fine-tune, đánh giá bằng **chính** `npm run eval:recipe-generation` (trỏ `GEMINI_MODEL`/`GEMINI_MODELS` sang tên model đã tune) để so sánh công bằng với baseline prompt engineering hiện tại — quyết định giữ/không giữ dựa trên số liệu, không dựa trên cảm quan.
