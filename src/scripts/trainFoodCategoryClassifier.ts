/**
 * Huấn luyện một Naive Bayes classifier THẬT cho bài toán phân loại danh mục thực phẩm.
 *
 * Dữ liệu huấn luyện lấy từ CATEGORY_SEEDS (`foodExamples` + `keywords` + `aliases` + tên
 * danh mục) — đây là dữ liệu do nhóm tự biên soạn/kiểm chứng từ trước (không phải do AI tự
 * sinh ra), nên dùng làm nhãn huấn luyện là hợp lệ, không cần thêm bước gán nhãn thủ công mới.
 *
 * QUAN TRỌNG — chống rò dữ liệu (data leakage): mọi câu/từ trong CATEGORY_SEEDS có text khớp
 * CHÍNH XÁC (sau normalize) với một `foodName` trong bộ eval (`foodCategoryDataset.ts`) sẽ bị
 * loại khỏi tập huấn luyện. Nếu không loại, model sẽ "học vẹt" đúng ngay các case eval và số
 * liệu đánh giá sau này sẽ không còn ý nghĩa.
 *
 * Chạy: npm run train:food-category-model
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { CATEGORY_SEEDS } from '../seeders/foodCategoryMetadata';
import { FOOD_CATEGORY_TRAINING_EXTRA } from '../ml/foodCategoryTrainingExtra';
import { FOOD_CATEGORY_EVAL_DATASET } from '../evaluation/foodCategoryDataset';
import { normalizeFoodText } from '../utils/foodCategoryValidation';
import { trainNaiveBayes, predictWithModel, type NaiveBayesTrainingDoc } from '../ml/foodCategoryNaiveBayes';

function buildTrainingDocs(): { docs: NaiveBayesTrainingDoc[]; excluded: string[] } {
  const evalKeys = new Set(FOOD_CATEGORY_EVAL_DATASET.map((testCase) => normalizeFoodText(testCase.foodName)));
  const docs: NaiveBayesTrainingDoc[] = [];
  const excluded: string[] = [];

  for (const seed of CATEGORY_SEEDS) {
    const candidateTexts = [
      ...seed.foodExamples,
      ...seed.keywords,
      ...seed.aliases,
      seed.displayName,
      seed.categoryName,
    ];

    for (const text of candidateTexts) {
      const key = normalizeFoodText(text);
      if (!key) continue;
      if (evalKeys.has(key)) {
        excluded.push(`${text} (${seed.categoryName})`);
        continue;
      }
      docs.push({ text, label: seed.categoryName });
    }
  }

  for (const extra of FOOD_CATEGORY_TRAINING_EXTRA) {
    const key = normalizeFoodText(extra.text);
    if (!key) continue;
    if (evalKeys.has(key)) {
      excluded.push(`${extra.text} (${extra.label})`);
      continue;
    }
    docs.push({ text: extra.text, label: extra.label });
  }

  return { docs, excluded };
}

function main() {
  const { docs, excluded } = buildTrainingDocs();
  const model = trainNaiveBayes(docs);

  const outDir = join(__dirname, '..', 'ml');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'foodCategoryModel.json');
  writeFileSync(outPath, JSON.stringify(model, null, 2), 'utf-8');

  console.log('\n=== Huấn luyện Naive Bayes classifier — Phân loại danh mục thực phẩm ===\n');
  console.log(`Tổng số văn bản huấn luyện: ${model.totalDocs}`);
  console.log(`Kích thước từ vựng: ${model.vocabularySize}`);
  console.log(`Số danh mục: ${model.classes.length}`);
  console.log('\nPhân bố theo danh mục:');
  for (const classModel of model.classes) {
    console.log(`  ${classModel.label.padEnd(14)} docs=${classModel.docCount}  words=${classModel.totalWords}`);
  }

  console.log(`\nĐã loại ${excluded.length} mục trùng với bộ eval (chống rò dữ liệu):`);
  for (const item of excluded) console.log(`  - ${item}`);

  // Kiểm tra nhanh (sanity check) — KHÔNG phải số liệu báo cáo chính thức. Số liệu chính thức,
  // so sánh với rule-based + AI fallback trên đúng bộ eval, chạy bằng `npm run eval:food-category`.
  let sanityCorrect = 0;
  for (const testCase of FOOD_CATEGORY_EVAL_DATASET) {
    const prediction = predictWithModel(model, testCase.foodName);
    if (prediction?.categoryName === testCase.expectedCategory) sanityCorrect += 1;
  }
  console.log(
    `\n[Sanity check — không phải số liệu chính thức] Model dự đoán đúng ${sanityCorrect}/${FOOD_CATEGORY_EVAL_DATASET.length} case trong bộ eval.`
  );
  console.log(`Đã lưu model: ${outPath}`);
}

main();
