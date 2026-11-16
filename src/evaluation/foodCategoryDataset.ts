/**
 * Bộ dữ liệu đánh giá (evaluation set) có nhãn thật cho bộ phân loại danh mục
 * thực phẩm (`foodCategoryClassifierService.ts` / `foodCategoryValidation.ts`).
 *
 * Đây KHÔNG phải dataset huấn luyện mô hình (hệ thống không tự train model AI —
 * phần AI dùng Gemini qua prompt). Đây là dữ liệu có nhãn (ground truth) dùng để
 * ĐO ĐỘ CHÍNH XÁC của lớp rule-based và của pipeline hybrid (rule-based + AI
 * fallback), phục vụ làm bằng chứng nghiên cứu/đánh giá cho báo cáo đồ án.
 *
 * `expectedCategory` / `wrongCategory` phải khớp đúng `categoryName` trong
 * `CATEGORY_SEEDS` (seeders/foodCategoryMetadata.ts).
 */

export type FoodCategoryEvalCase = {
  foodName: string;
  expectedCategory: string;
  /** Một danh mục SAI có chủ đích, dùng để kiểm tra khả năng "bắt lỗi" của hệ thống. */
  wrongCategory: string;
  /** Giải thích vì sao case này khó / mập mờ, dùng khi viết báo cáo kết quả. */
  note?: string;
};

export const FOOD_CATEGORY_EVAL_DATASET: FoodCategoryEvalCase[] = [
  // ── Case dễ: khớp trực tiếp foodExamples/keywords ─────────────────────────
  { foodName: 'Thịt bò', expectedCategory: 'Meat', wrongCategory: 'Fish' },
  { foodName: 'Ba chỉ heo', expectedCategory: 'Meat', wrongCategory: 'Seafood' },
  { foodName: 'Ức gà', expectedCategory: 'Meat', wrongCategory: 'Egg' },
  { foodName: 'Tôm sú', expectedCategory: 'Seafood', wrongCategory: 'Fish' },
  { foodName: 'Mực ống', expectedCategory: 'Seafood', wrongCategory: 'Fish' },
  { foodName: 'Nghêu', expectedCategory: 'Seafood', wrongCategory: 'Fish' },
  { foodName: 'Cá hồi phi lê', expectedCategory: 'Fish', wrongCategory: 'Seafood' },
  { foodName: 'Cá basa', expectedCategory: 'Fish', wrongCategory: 'Meat' },
  { foodName: 'Cá lóc', expectedCategory: 'Fish', wrongCategory: 'Seafood' },
  { foodName: 'Cà rốt', expectedCategory: 'Vegetable', wrongCategory: 'Fruit' },
  { foodName: 'Dưa leo', expectedCategory: 'Vegetable', wrongCategory: 'Fruit' },
  { foodName: 'Bắp cải', expectedCategory: 'Vegetable', wrongCategory: 'Dry Food' },
  { foodName: 'Chuối sứ', expectedCategory: 'Fruit', wrongCategory: 'Vegetable' },
  { foodName: 'Cam sành', expectedCategory: 'Fruit', wrongCategory: 'Dairy' },
  { foodName: 'Xoài cát Hòa Lộc', expectedCategory: 'Fruit', wrongCategory: 'Vegetable' },
  { foodName: 'Trứng gà ta', expectedCategory: 'Egg', wrongCategory: 'Meat' },
  { foodName: 'Sữa tươi không đường', expectedCategory: 'Dairy', wrongCategory: 'Dry Food' },
  { foodName: 'Phô mai lát', expectedCategory: 'Dairy', wrongCategory: 'Frozen Food' },
  { foodName: 'Sữa chua Hy Lạp', expectedCategory: 'Dairy', wrongCategory: 'Dry Food' },
  { foodName: 'Gạo ST25', expectedCategory: 'Dry Food', wrongCategory: 'Vegetable' },
  { foodName: 'Mì gói', expectedCategory: 'Dry Food', wrongCategory: 'Cooked Food' },
  { foodName: 'Yến mạch', expectedCategory: 'Dry Food', wrongCategory: 'Vegetable' },
  { foodName: 'Cơm hộp gà nướng', expectedCategory: 'Cooked Food', wrongCategory: 'Meat' },
  { foodName: 'Xúc xích đông lạnh', expectedCategory: 'Frozen Food', wrongCategory: 'Meat' },

  // ── Case khó / mập mờ: nhiều khả năng lớp rule-based sai hoặc NONE/LOW ────
  // → đúng chỗ kỳ vọng lớp AI fallback phải chứng minh được giá trị của nó.
  {
    foodName: 'Khổ qua',
    expectedCategory: 'Vegetable',
    wrongCategory: 'Fruit',
    note: 'Tên có chữ "qua" (= quả) nên dễ bị nhầm là trái cây.',
  },
  {
    foodName: 'Trái thanh trà',
    expectedCategory: 'Fruit',
    wrongCategory: 'Vegetable',
    note: 'Đặc sản miền Tây, KHÔNG có trong keywords/foodExamples hiện tại → kỳ vọng rule-based trả về NONE/LOW, là case nên dùng AI hỗ trợ.',
  },
  {
    foodName: 'Trứng vịt lộn',
    expectedCategory: 'Egg',
    wrongCategory: 'Cooked Food',
    note: 'Thường được luộc sẵn khi bán nên dễ bị hiểu lầm là món đã chế biến.',
  },
  {
    foodName: 'Canh chua cá lóc',
    expectedCategory: 'Cooked Food',
    wrongCategory: 'Fish',
    note: 'Vừa có "canh" (Cooked Food) vừa có "cá lóc" (Fish) trong cùng tên — kiểm tra hệ thống có ưu tiên đúng ngữ cảnh "món đã nấu" không.',
  },
  {
    foodName: 'Cá viên',
    expectedCategory: 'Frozen Food',
    wrongCategory: 'Fish',
    note: 'Vừa khớp "cá" (Fish, keyword+alias, tổng điểm cao) vừa khớp "viên" (Frozen Food) — case kinh điển dễ bị rule-based chấm điểm nghiêng sai về Fish.',
  },
  {
    foodName: 'Há cảo tôm',
    expectedCategory: 'Frozen Food',
    wrongCategory: 'Seafood',
    note: 'Có "tôm" (Seafood) nhưng bản chất là món đông lạnh chế biến sẵn — kiểm tra từ khóa nguyên liệu có đánh lạc hướng hệ thống không.',
  },
];
