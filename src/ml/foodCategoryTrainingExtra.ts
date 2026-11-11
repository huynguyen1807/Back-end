/**
 * Dữ liệu huấn luyện BỔ SUNG cho model Naive Bayes phân loại danh mục thực phẩm.
 *
 * Tách riêng khỏi `seeders/foodCategoryMetadata.ts` (CÓ CHỦ ĐÍCH): file đó là metadata sản
 * phẩm, dùng để seed DB thật — không nên trộn dữ liệu "chỉ để train model" vào đó. Danh sách
 * dưới đây do nhóm tự biên soạn tay (tên thực phẩm phổ biến thật, không phải AI tự sinh), bổ
 * sung thêm để tăng kích thước tập huấn luyện sau vòng đánh giá đầu tiên (xem
 * `docs/research/lo-trinh-train-ai-thuc-te.md`, mục "Kết quả thực tế — Ngày 1-2").
 *
 * `label` phải khớp đúng `categoryName` trong `CATEGORY_SEEDS`.
 */

export type ExtraTrainingDoc = { text: string; label: string };

export const FOOD_CATEGORY_TRAINING_EXTRA: ExtraTrainingDoc[] = [
  // Seafood — "Nghêu" đứng một mình bị đoán sai ở vòng 1 vì dữ liệu quá ít.
  { text: 'Sò huyết', label: 'Seafood' },
  { text: 'Ốc hương', label: 'Seafood' },
  { text: 'Nghêu trắng', label: 'Seafood' },
  { text: 'Tôm càng', label: 'Seafood' },
  { text: 'Cua biển', label: 'Seafood' },
  { text: 'Mực lá', label: 'Seafood' },
  { text: 'Bạch tuộc', label: 'Seafood' },
  { text: 'Hàu sữa', label: 'Seafood' },

  // Vegetable — "Cà rốt", "Dưa leo" bị lệch vì "cà"/"dưa" cũng xuất hiện ở Fruit/Fish.
  { text: 'Cà tím', label: 'Vegetable' },
  { text: 'Cà chua bi', label: 'Vegetable' },
  { text: 'Dưa leo baby', label: 'Vegetable' },
  { text: 'Rau muống', label: 'Vegetable' },
  { text: 'Rau cải ngọt', label: 'Vegetable' },
  { text: 'Su hào', label: 'Vegetable' },
  { text: 'Đậu bắp', label: 'Vegetable' },
  { text: 'Bông cải xanh', label: 'Vegetable' },
  { text: 'Cải thảo', label: 'Vegetable' },
  { text: 'Hành lá', label: 'Vegetable' },

  // Fruit — thêm để cân bằng với Vegetable (tránh model lệch về Fruit do vốn đã nhiều dữ liệu).
  { text: 'Dưa hấu ruột đỏ', label: 'Fruit' },
  { text: 'Dưa lưới vàng', label: 'Fruit' },
  { text: 'Xoài keo', label: 'Fruit' },
  { text: 'Bưởi da xanh', label: 'Fruit' },
  { text: 'Táo Mỹ', label: 'Fruit' },
  { text: 'Việt quất', label: 'Fruit' },
  { text: 'Dâu tây', label: 'Fruit' },

  // Dry Food — "Yến mạch" đứng một mình bị đoán sai vì dữ liệu quá ít.
  { text: 'Yến mạch nguyên hạt', label: 'Dry Food' },
  { text: 'Bột yến mạch', label: 'Dry Food' },
  { text: 'Ngũ cốc ăn sáng', label: 'Dry Food' },
  { text: 'Đậu đen', label: 'Dry Food' },
  { text: 'Đậu phộng', label: 'Dry Food' },
  { text: 'Hạt điều', label: 'Dry Food' },
  { text: 'Gạo nếp', label: 'Dry Food' },
  { text: 'Miến', label: 'Dry Food' },

  // Cooked Food — thêm cụm "canh chua ..." để model học bigram "canh chua" là dấu hiệu món đã
  // nấu, bù cho case "Canh chua cá lóc" bị lệch sang Fish ở vòng 1.
  { text: 'Canh chua', label: 'Cooked Food' },
  { text: 'Canh chua cá', label: 'Cooked Food' },
  { text: 'Canh rau củ', label: 'Cooked Food' },
  { text: 'Canh bí đỏ', label: 'Cooked Food' },
  { text: 'Cháo lòng', label: 'Cooked Food' },
  { text: 'Bún riêu', label: 'Cooked Food' },
  { text: 'Phở bò chín', label: 'Cooked Food' },
  { text: 'Cơm chiên', label: 'Cooked Food' },
  { text: 'Mì xào', label: 'Cooked Food' },

  // Fish — thêm vài loài cá phổ biến để củng cố cụm "cá + tên loài".
  { text: 'Cá rô phi', label: 'Fish' },
  { text: 'Cá diêu hồng', label: 'Fish' },
  { text: 'Cá chép', label: 'Fish' },
  { text: 'Cá kèo', label: 'Fish' },
  { text: 'Cá bớp', label: 'Fish' },
];
