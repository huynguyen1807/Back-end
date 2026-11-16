/**
 * Script đánh giá pipeline sinh công thức AI (`generateAiRecipeDrafts`).
 *
 * MỤC ĐÍCH: đo mức độ tuân thủ của AI (Gemini, qua prompt engineering) đối với
 * các quy tắc nghiệp vụ mà chính prompt trong `aiRecipeProvider.ts` yêu cầu.
 * Đây KHÔNG phải huấn luyện model — hệ thống không tự train AI, nên bằng chứng
 * nghiên cứu ở đây là một phương pháp đánh giá có kiểm soát trên các kịch bản
 * đầu vào thật (`src/evaluation/recipeGenerationDataset.ts`), gọi thẳng pipeline
 * AI thật (cần GEMINI_API_KEY) và kiểm tra tự động trên kết quả trả về.
 *
 * Chạy: npm run eval:recipe-generation
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { generateAiRecipeDrafts, type AiRecipeDraft } from '../services/aiRecipeProvider';
import { RECIPE_GENERATION_EVAL_SCENARIOS, type RecipeGenEvalScenario } from '../evaluation/recipeGenerationDataset';
import {
  buildIngredientSignature,
  checkDraft,
  type RecipeCheck,
} from '../evaluation/recipeGenerationChecks';

type ScenarioResult = {
  scenario: RecipeGenEvalScenario;
  draftCount: number;
  checks: Array<RecipeCheck & { recipeName: string }>;
  duplicateSignatureCount: number;
  error?: string;
};

function hasApiKey() {
  const key = process.env.GEMINI_API_KEY || '';
  return Boolean(key) && key !== 'your_actual_api_key_here';
}

async function evaluateScenario(scenario: RecipeGenEvalScenario): Promise<ScenarioResult> {
  try {
    const drafts = await generateAiRecipeDrafts(scenario.input);
    const signatures = drafts.map((d) => buildIngredientSignature(d.ingredients || d.missingIngredients || []));
    const seen = new Set<string>();
    let duplicateSignatureCount = 0;
    for (const sig of signatures) {
      if (!sig) continue;
      if (seen.has(sig)) duplicateSignatureCount += 1;
      seen.add(sig);
    }

    const checks = drafts.map((draft) => ({
      recipeName: draft.recipeName || '(không có tên)',
      ...checkDraft(draft, scenario),
    }));

    return { scenario, draftCount: drafts.length, checks, duplicateSignatureCount };
  } catch (error: any) {
    return { scenario, draftCount: 0, checks: [], duplicateSignatureCount: 0, error: error?.message || String(error) };
  }
}

function percent(count: number, total: number) {
  return total === 0 ? '0.0' : ((count / total) * 100).toFixed(1);
}

async function main() {
  if (!hasApiKey()) {
    console.error('Chưa cấu hình GEMINI_API_KEY trong .env — không thể chạy đánh giá (pipeline này luôn cần Gemini thật, không có fallback rule-based).');
    process.exit(1);
  }

  const results: ScenarioResult[] = [];
  for (const scenario of RECIPE_GENERATION_EVAL_SCENARIOS) {
    console.log(`\nĐang đánh giá kịch bản: ${scenario.name}...`);
    results.push(await evaluateScenario(scenario));
  }

  const allChecks = results.flatMap((r) => r.checks);
  const total = allChecks.length;
  const nameOkCount = allChecks.filter((c) => c.nameOk).length;
  const calorieOkCount = allChecks.filter((c) => c.calorieOk).length;
  const sourcedOkCount = allChecks.filter((c) => c.ingredientsSourcedOk).length;
  const missingOkCount = allChecks.filter((c) => c.missingNotPantryOk).length;
  const unitsOkCount = allChecks.filter((c) => c.unitsOk).length;
  const totalDuplicates = results.reduce((sum, r) => sum + r.duplicateSignatureCount, 0);

  console.log('\n=== Đánh giá pipeline sinh công thức AI ===\n');
  console.log(`Tổng số kịch bản: ${results.length}, tổng số công thức AI tạo ra: ${total}`);
  console.log(`- Tên món hợp lệ (không mashup "A + B"): ${nameOkCount}/${total} (${percent(nameOkCount, total)}%)`);
  console.log(`- Calo bám sát allocation (±30%): ${calorieOkCount}/${total} (${percent(calorieOkCount, total)}%)`);
  console.log(`- ENOUGH_INGREDIENTS chỉ dùng tồn kho thật: ${sourcedOkCount}/${total} (${percent(sourcedOkCount, total)}%)`);
  console.log(`- MISSING_INGREDIENTS không liệt kê gia vị cơ bản: ${missingOkCount}/${total} (${percent(missingOkCount, total)}%)`);
  console.log(`- Đơn vị hợp lệ (g/kg/ml/l/quả/cái): ${unitsOkCount}/${total} (${percent(unitsOkCount, total)}%)`);
  console.log(`- Số công thức trùng nguyên liệu trong cùng 1 kịch bản: ${totalDuplicates}`);

  for (const r of results) {
    console.log(`\n--- ${r.scenario.name} ---`);
    if (r.error) {
      console.log(`  LỖI: ${r.error}`);
      continue;
    }
    console.log(`  Số công thức: ${r.draftCount}, trùng nguyên liệu: ${r.duplicateSignatureCount}`);
    for (const c of r.checks) {
      const flags = [
        c.nameOk ? 'tên-OK' : 'tên-SAI',
        c.calorieOk ? 'calo-OK' : 'calo-SAI',
        c.ingredientsSourcedOk ? 'nguyênliệu-OK' : 'nguyênliệu-SAI',
        c.missingNotPantryOk ? 'thiếu-OK' : 'thiếu-SAI',
        c.unitsOk ? 'đơnvị-OK' : 'đơnvị-SAI',
      ].join(' ');
      console.log(`  - ${c.recipeName.padEnd(30)} ${flags}`);
    }
  }

  writeReport(results, { total, nameOkCount, calorieOkCount, sourcedOkCount, missingOkCount, unitsOkCount, totalDuplicates });
}

function writeReport(
  results: ScenarioResult[],
  summary: { total: number; nameOkCount: number; calorieOkCount: number; sourcedOkCount: number; missingOkCount: number; unitsOkCount: number; totalDuplicates: number }
) {
  const outDir = join(__dirname, '..', '..', 'docs', 'research');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'recipe-generation-evaluation.md');

  const lines: string[] = [];
  lines.push('# Đánh giá pipeline sinh công thức AI (gợi ý món ăn từ tồn kho)');
  lines.push('');
  lines.push(`Chạy lúc: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Phương pháp');
  lines.push('');
  lines.push(
    '- Hệ thống **không tự huấn luyện mô hình AI**. Phần sinh công thức dùng Gemini (`@google/generative-ai`) qua prompt engineering (`services/aiRecipeProvider.ts`), không có dataset huấn luyện/trọng số do nhóm tự tạo.'
  );
  lines.push(
    '- Bằng chứng nghiên cứu ở đây là một **phương pháp đánh giá có kiểm soát**: chạy pipeline AI thật trên các kịch bản đầu vào thực tế (`src/evaluation/recipeGenerationDataset.ts`), sau đó kiểm tra tự động xem kết quả AI trả về có tuân thủ đúng các quy tắc nghiệp vụ mà chính prompt yêu cầu không:'
  );
  lines.push('  - **Tên món hợp lệ**: không ở dạng ghép công thức máy móc ("A + B", "Breakfast with …").');
  lines.push('  - **Calo bám sát allocation**: lượng calo ước tính nằm trong (hoặc gần) khoảng calo cho phép của khung giờ ăn.');
  lines.push('  - **Nguồn nguyên liệu đúng**: công thức khai "đủ nguyên liệu" chỉ dùng thực phẩm có thật trong tồn kho.');
  lines.push('  - **Không liệt kê gia vị cơ bản là nguyên liệu thiếu** (muối, đường, dầu ăn, nước mắm…).');
  lines.push('  - **Đơn vị hợp lệ**: chỉ dùng g/kg/ml/l/quả/cái theo đúng chuẩn hệ thống.');
  lines.push('  - **Đa dạng**: không lặp lại đúng bộ nguyên liệu giữa các công thức gợi ý trong cùng kịch bản.');
  lines.push('');
  lines.push('## Kết quả tổng hợp');
  lines.push('');
  lines.push('| Chỉ số | Kết quả |');
  lines.push('|---|---|');
  lines.push(`| Tổng số công thức AI tạo ra | ${summary.total} |`);
  lines.push(`| Tên món hợp lệ | ${summary.nameOkCount}/${summary.total} (${percent(summary.nameOkCount, summary.total)}%) |`);
  lines.push(`| Calo bám sát allocation (±30%) | ${summary.calorieOkCount}/${summary.total} (${percent(summary.calorieOkCount, summary.total)}%) |`);
  lines.push(`| Nguyên liệu đúng tồn kho (ENOUGH_INGREDIENTS) | ${summary.sourcedOkCount}/${summary.total} (${percent(summary.sourcedOkCount, summary.total)}%) |`);
  lines.push(`| Không liệt kê gia vị cơ bản (MISSING_INGREDIENTS) | ${summary.missingOkCount}/${summary.total} (${percent(summary.missingOkCount, summary.total)}%) |`);
  lines.push(`| Đơn vị hợp lệ | ${summary.unitsOkCount}/${summary.total} (${percent(summary.unitsOkCount, summary.total)}%) |`);
  lines.push(`| Số công thức trùng nguyên liệu | ${summary.totalDuplicates} |`);
  lines.push('');
  lines.push('## Chi tiết từng kịch bản');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.scenario.name}`);
    if (r.scenario.note) lines.push(`_${r.scenario.note}_`);
    lines.push('');
    if (r.error) {
      lines.push(`Lỗi khi chạy: ${r.error}`);
      lines.push('');
      continue;
    }
    lines.push(`Số công thức: ${r.draftCount}, số công thức trùng nguyên liệu: ${r.duplicateSignatureCount}`);
    lines.push('');
    lines.push('| Tên món | Tên hợp lệ | Calo OK | Nguyên liệu đúng | Không gia vị cơ bản | Đơn vị hợp lệ |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of r.checks) {
      lines.push(
        `| ${c.recipeName} | ${c.nameOk ? '✅' : '❌'} | ${c.calorieOk ? '✅' : '❌'} | ${c.ingredientsSourcedOk ? '✅' : '❌'} | ${c.missingNotPantryOk ? '✅' : '❌'} | ${c.unitsOk ? '✅' : '❌'} |`
      );
    }
    lines.push('');
  }

  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nĐã ghi báo cáo: ${outPath}`);
}

main().catch((error) => {
  console.error('[evaluateRecipeGeneration] failed:', error);
  process.exit(1);
});
