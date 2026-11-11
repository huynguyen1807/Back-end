/**
 * Script đánh giá bộ phân loại danh mục thực phẩm (food category classifier).
 *
 * MỤC ĐÍCH: đo độ chính xác có số liệu cụ thể của:
 *  (A) lớp rule-based thuần (`validateFoodCategoryWithDatabase`)
 *  (B) pipeline hybrid rule-based + AI fallback (`classifyFoodCategory`, nếu có GEMINI_API_KEY)
 * trên bộ dữ liệu có nhãn (`src/evaluation/foodCategoryDataset.ts`).
 *
 * Đây là "research evaluation" thay cho việc tự train model: hệ thống không tự
 * huấn luyện AI, nên thứ có thể đưa ra làm bằng chứng nghiên cứu là một
 * phương pháp đánh giá có kiểm soát (ground truth + metric rõ ràng), không phải
 * một bộ trọng số mô hình.
 *
 * Chạy: npm run eval:food-category
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { CATEGORY_SEEDS } from '../seeders/foodCategoryMetadata';
import {
  validateFoodCategoryWithDatabase,
  type FoodCategoryLike,
} from '../utils/foodCategoryValidation';
import { classifyFoodCategory } from '../services/foodCategoryClassifierService';
import { predictFoodCategory } from '../services/foodCategoryModel';
import { FOOD_CATEGORY_EVAL_DATASET } from '../evaluation/foodCategoryDataset';

const categories: FoodCategoryLike[] = CATEGORY_SEEDS.map((seed) => ({
  _id: seed.categoryName,
  categoryName: seed.categoryName,
  displayName: seed.displayName,
  description: seed.description,
  aliases: seed.aliases,
  keywords: seed.keywords,
  foodExamples: seed.foodExamples,
}));

function categoryIdByName(name: string): string {
  const id = categories.find((category) => category.categoryName === name)?._id;
  if (!id) throw new Error(`Unknown category in eval dataset: ${name}`);
  return String(id);
}

function hasGeminiKey() {
  const key = process.env.GEMINI_API_KEY || '';
  return Boolean(key) && key !== 'your_actual_api_key_here';
}

type CaseResult = {
  foodName: string;
  expectedCategory: string;
  acceptCorrect: boolean;
  catchWrong: boolean;
  deterministicConfidence: string;
  modelRecommended?: string;
  modelCorrect?: boolean;
  aiRecommended?: string;
  aiCorrect?: boolean;
  note?: string;
  /** Độ chính xác ĐỘC LẬP của model Naive Bayes trên toàn bộ 30 case — không qua gating
   * rule-based, dùng để đánh giá đúng năng lực thật của model khi đứng một mình. */
  standaloneModelRecommended?: string;
  standaloneModelCorrect?: boolean;
};

/** Vùng mà rule-based KHÔNG chắc (NONE/LOW) và chưa tự phát hiện mismatch — đúng vùng mà cả
 * lớp model Naive Bayes đã huấn luyện và lớp AI fallback (Gemini) được kỳ vọng xử lý. */
function isUncertainZone(validation: { isMismatch: boolean; confidence: string }) {
  if (validation.isMismatch) return false;
  return validation.confidence === 'NONE' || validation.confidence === 'LOW';
}

async function evaluateCase(testCase: (typeof FOOD_CATEGORY_EVAL_DATASET)[number]): Promise<CaseResult> {
  const expectedId = categoryIdByName(testCase.expectedCategory);
  const wrongId = categoryIdByName(testCase.wrongCategory);

  // (A) Người dùng chọn ĐÚNG danh mục -> hệ thống không nên báo mismatch (false positive).
  const correctSelection = validateFoodCategoryWithDatabase(testCase.foodName, expectedId, categories);
  const acceptCorrect = !correctSelection.isMismatch;

  // (B) Người dùng chọn SAI danh mục có chủ đích -> hệ thống nên bắt được và gợi ý đúng.
  const wrongSelection = validateFoodCategoryWithDatabase(testCase.foodName, wrongId, categories);
  const catchWrong = Boolean(wrongSelection.isMismatch && wrongSelection.recommendedCategoryId === expectedId);

  const result: CaseResult = {
    foodName: testCase.foodName,
    expectedCategory: testCase.expectedCategory,
    acceptCorrect,
    catchWrong,
    deterministicConfidence: wrongSelection.confidence,
    note: testCase.note,
  };

  // (E) Độ chính xác độc lập của model — chạy trên MỌI case, không qua gating, để biết năng
  // lực thật của model khi đứng một mình (không có rule-based che các case dễ).
  const standalonePrediction = predictFoodCategory(testCase.foodName);
  result.standaloneModelRecommended = standalonePrediction?.categoryName;
  result.standaloneModelCorrect = standalonePrediction?.categoryName === testCase.expectedCategory;

  // (D) Model Naive Bayes đã huấn luyện (`npm run train:food-category-model`) — chỉ đo trên
  // đúng vùng mà rule-based không chắc, để so sánh công bằng với (C) AI fallback.
  if (isUncertainZone(wrongSelection)) {
    const modelPrediction = predictFoodCategory(testCase.foodName);
    if (modelPrediction && (modelPrediction.confidence === 'HIGH' || modelPrediction.confidence === 'MEDIUM')) {
      result.modelRecommended = modelPrediction.categoryName;
      result.modelCorrect = modelPrediction.categoryName === testCase.expectedCategory;
    } else {
      result.modelCorrect = false;
      result.modelRecommended = modelPrediction?.categoryName;
    }
  }

  if (hasGeminiKey()) {
    const aiResult = await classifyFoodCategory({
      foodName: testCase.foodName,
      selectedCategoryId: wrongId,
      categories,
      allowAi: true,
    });
    result.aiRecommended = aiResult.recommendedCategoryName;
    result.aiCorrect = aiResult.recommendedCategoryId === expectedId;
  }

  return result;
}

function percent(count: number, total: number) {
  return total === 0 ? '0.0' : ((count / total) * 100).toFixed(1);
}

async function main() {
  const results: CaseResult[] = [];
  for (const testCase of FOOD_CATEGORY_EVAL_DATASET) {
    results.push(await evaluateCase(testCase));
  }

  const total = results.length;
  const acceptCorrectCount = results.filter((r) => r.acceptCorrect).length;
  const catchWrongCount = results.filter((r) => r.catchWrong).length;
  const aiRan = results.some((r) => r.aiRecommended !== undefined);
  const aiCorrectCount = results.filter((r) => r.aiCorrect).length;
  const aiEvaluated = results.filter((r) => r.aiCorrect !== undefined).length;
  const modelCorrectCount = results.filter((r) => r.modelCorrect).length;
  const modelEvaluated = results.filter((r) => r.modelCorrect !== undefined).length;
  const standaloneModelCorrectCount = results.filter((r) => r.standaloneModelCorrect).length;

  console.log('\n=== Đánh giá bộ phân loại danh mục thực phẩm ===\n');
  console.log(`Tổng số case: ${total}`);
  console.log(
    `(A) Chấp nhận lựa chọn ĐÚNG (không báo mismatch sai): ${acceptCorrectCount}/${total} (${percent(acceptCorrectCount, total)}%)`
  );
  console.log(
    `(B) Bắt được lựa chọn SAI + gợi ý đúng danh mục:       ${catchWrongCount}/${total} (${percent(catchWrongCount, total)}%)`
  );
  if (modelEvaluated > 0) {
    console.log(
      `(D) Model đã huấn luyện (trong vùng rule-based không chắc): ${modelCorrectCount}/${modelEvaluated} (${percent(modelCorrectCount, modelEvaluated)}%)`
    );
  } else {
    console.log('(D) Model đã huấn luyện: không có case nào thuộc vùng rule-based không chắc.');
  }
  console.log(
    `(E) Model đã huấn luyện ĐỘC LẬP (toàn bộ ${total} case, không qua gating): ${standaloneModelCorrectCount}/${total} (${percent(standaloneModelCorrectCount, total)}%)`
  );
  if (aiRan) {
    console.log(
      `(C) AI fallback gợi ý đúng danh mục:                   ${aiCorrectCount}/${aiEvaluated} (${percent(aiCorrectCount, aiEvaluated)}%)`
    );
  } else {
    console.log('(C) AI fallback: BỎ QUA — chưa cấu hình GEMINI_API_KEY trong .env.');
  }

  console.log('\n--- Chi tiết từng case ---');
  for (const r of results) {
    const flagA = r.acceptCorrect ? 'OK' : 'SAI';
    const flagB = r.catchWrong ? 'OK' : 'SAI';
    const modelCol = r.modelRecommended ? `Model→${r.modelRecommended}(${r.modelCorrect ? 'OK' : 'SAI'})` : '-';
    const standaloneCol = `Solo→${r.standaloneModelRecommended ?? '?'}(${r.standaloneModelCorrect ? 'OK' : 'SAI'})`;
    const aiCol = r.aiRecommended ? `AI→${r.aiRecommended}(${r.aiCorrect ? 'OK' : 'SAI'})` : '-';
    console.log(
      `${r.foodName.padEnd(26)} kỳ vọng=${r.expectedCategory.padEnd(12)} A=${flagA.padEnd(3)} B=${flagB.padEnd(3)} conf=${r.deterministicConfidence.padEnd(6)} ${modelCol.padEnd(22)} ${standaloneCol.padEnd(22)} ${aiCol}${r.note ? '  // ' + r.note : ''}`
    );
  }

  writeReport(results, {
    total,
    acceptCorrectCount,
    catchWrongCount,
    aiRan,
    aiCorrectCount,
    aiEvaluated,
    modelCorrectCount,
    modelEvaluated,
    standaloneModelCorrectCount,
  });
}

function writeReport(
  results: CaseResult[],
  summary: {
    total: number;
    acceptCorrectCount: number;
    catchWrongCount: number;
    aiRan: boolean;
    aiCorrectCount: number;
    aiEvaluated: number;
    modelCorrectCount: number;
    modelEvaluated: number;
    standaloneModelCorrectCount: number;
  }
) {
  const outDir = join(__dirname, '..', '..', 'docs', 'research');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'food-category-classification-evaluation.md');

  const lines: string[] = [];
  lines.push('# Đánh giá bộ phân loại danh mục thực phẩm');
  lines.push('');
  lines.push(`Chạy lúc: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    '## Phương pháp'
  );
  lines.push('');
  lines.push(
    '- Hệ thống dùng Gemini (`@google/generative-ai`) qua prompt engineering làm lớp AI fallback — không có trọng số học từ dữ liệu.'
  );
  lines.push(
    '- **Từ phiên bản này, hệ thống có thêm một lớp model THẬT được huấn luyện** (Naive Bayes, `src/ml/foodCategoryNaiveBayes.ts`, chạy `npm run train:food-category-model`) — trọng số là tần suất từ/danh mục học được từ dữ liệu (`src/seeders/foodCategoryMetadata.ts`), có Laplace smoothing, được lưu lại thành file model (`src/ml/foodCategoryModel.json`) và nạp lại khi inference. Dữ liệu huấn luyện đã được loại trừ mọi mục trùng với bộ eval dưới đây để tránh rò dữ liệu (data leakage) — xem log của script huấn luyện.'
  );
  lines.push(
    '- Bằng chứng nghiên cứu ở đây là một **phương pháp đánh giá có kiểm soát**: bộ dữ liệu có nhãn (ground truth) trong `src/evaluation/foodCategoryDataset.ts`, chạy qua các lớp phân loại thật của hệ thống:'
  );
  lines.push('  - **(A) Accept-correct**: chọn đúng danh mục có bị báo "không khớp" (false positive) không?');
  lines.push('  - **(B) Catch-wrong**: chọn sai danh mục có chủ đích có bị phát hiện và gợi ý đúng không?');
  lines.push('  - **(D) Model đã huấn luyện (trong pipeline)**: trên đúng vùng mà rule-based không chắc (NONE/LOW), model Naive Bayes có gợi ý đúng danh mục không?');
  lines.push('  - **(C) AI fallback** (chỉ chạy khi có `GEMINI_API_KEY`): trên cùng vùng đó, Gemini có gợi ý đúng danh mục không?');
  lines.push('  - **(E) Model đã huấn luyện (độc lập)**: nếu BỎ rule-based, cho model Naive Bayes tự dự đoán toàn bộ 30 case — đo đúng năng lực thật của model khi đứng một mình.');
  lines.push('');
  lines.push('## Kết quả tổng hợp');
  lines.push('');
  lines.push(`| Chỉ số | Kết quả |`);
  lines.push(`|---|---|`);
  lines.push(`| Tổng số case | ${summary.total} |`);
  lines.push(
    `| (A) Accept-correct | ${summary.acceptCorrectCount}/${summary.total} (${percent(summary.acceptCorrectCount, summary.total)}%) |`
  );
  lines.push(
    `| (B) Catch-wrong | ${summary.catchWrongCount}/${summary.total} (${percent(summary.catchWrongCount, summary.total)}%) |`
  );
  lines.push(
    summary.modelEvaluated > 0
      ? `| (D) Model đã huấn luyện đúng | ${summary.modelCorrectCount}/${summary.modelEvaluated} (${percent(summary.modelCorrectCount, summary.modelEvaluated)}%) |`
      : `| (D) Model đã huấn luyện | Không có case nào thuộc vùng rule-based không chắc |`
  );
  lines.push(
    summary.aiRan
      ? `| (C) AI fallback đúng | ${summary.aiCorrectCount}/${summary.aiEvaluated} (${percent(summary.aiCorrectCount, summary.aiEvaluated)}%) |`
      : `| (C) AI fallback | Bỏ qua — chưa cấu hình \`GEMINI_API_KEY\` khi chạy lần này |`
  );
  lines.push(
    `| (E) Model đã huấn luyện (độc lập, toàn bộ ${summary.total} case) | ${summary.standaloneModelCorrectCount}/${summary.total} (${percent(summary.standaloneModelCorrectCount, summary.total)}%) |`
  );
  lines.push('');
  lines.push(
    '> **Lưu ý đọc số liệu**: (D) chỉ đo trên 1 case rơi vào vùng rule-based không chắc trong bộ eval hiện tại — mẫu quá nhỏ để kết luận. (E) là số liệu đáng tin hơn để đánh giá đúng năng lực của model khi đứng một mình, không được rule-based "che" các case dễ.'
  );
  lines.push('');
  lines.push('## Chi tiết từng case');
  lines.push('');
  lines.push('| Thực phẩm | Danh mục đúng | (A) | (B) | Độ tin cậy rule-based | Model (trong pipeline) | Model (độc lập) | AI gợi ý | Ghi chú |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.foodName} | ${r.expectedCategory} | ${r.acceptCorrect ? '✅' : '❌'} | ${r.catchWrong ? '✅' : '❌'} | ${r.deterministicConfidence} | ${r.modelRecommended ? `${r.modelRecommended} (${r.modelCorrect ? '✅' : '❌'})` : '—'} | ${r.standaloneModelRecommended ?? '—'} (${r.standaloneModelCorrect ? '✅' : '❌'}) | ${r.aiRecommended ? `${r.aiRecommended} (${r.aiCorrect ? '✅' : '❌'})` : '—'} | ${r.note ?? ''} |`
    );
  }
  lines.push('');

  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nĐã ghi báo cáo: ${outPath}`);
}

main().catch((error) => {
  console.error('[evaluateFoodCategoryClassifier] failed:', error);
  process.exit(1);
});
