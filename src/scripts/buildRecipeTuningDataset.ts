/**
 * Chuẩn bị dữ liệu fine-tune (supervised tuning) cho chức năng sinh công thức AI.
 *
 * Ý tưởng (self-distillation có kiểm soát — KHÔNG phải dữ liệu tự AI sinh ra rồi tin luôn):
 * chạy pipeline Gemini THẬT (`generateAiRecipeDrafts`) nhiều lần trên các kịch bản đầu vào
 * thật đã có (`src/evaluation/recipeGenerationDataset.ts`), rồi lọc lại bằng ĐÚNG bộ kiểm tra
 * tự động đang dùng để đánh giá (`src/evaluation/recipeGenerationChecks.ts`, 5 tiêu chí + chỉ
 * số trùng lặp). Chỉ giữ lại lần sinh nào mà TOÀN BỘ công thức trong phản hồi đạt cả 5 tiêu
 * chí và không trùng lặp nguyên liệu — nghĩa là chỉ dùng dữ liệu đã được xác nhận "sạch" bằng
 * số liệu thật để làm nhãn huấn luyện, không lấy nhãn AI tự chấm cho chính nó mà không kiểm
 * chứng.
 *
 * Mỗi lần sinh ĐẠT trở thành một cặp (prompt → JSON công thức) đúng định dạng chat của Gemini
 * tuning (role user/model) — CHÚ Ý: định dạng tuning chính xác (trường tên, cách gửi job) có
 * thể đã thay đổi theo thời gian trên Google AI Studio / Vertex AI — cần tự kiểm tra lại trong
 * console hiện tại của Google trước khi gửi job, file này chỉ chuẩn bị dữ liệu.
 *
 * Chạy: npm run build:recipe-tuning-data
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { generateAiRecipeDrafts, buildAiRecipePrompt } from '../services/aiRecipeProvider';
import { RECIPE_GENERATION_EVAL_SCENARIOS, type RecipeGenEvalScenario } from '../evaluation/recipeGenerationDataset';
import { buildIngredientSignature, checkDraft, isFullyValid } from '../evaluation/recipeGenerationChecks';

const RUNS_PER_SCENARIO = 6;

function hasApiKey() {
  const key = process.env.GEMINI_API_KEY || '';
  return Boolean(key) && key !== 'your_actual_api_key_here';
}

type TuningExample = {
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
};

async function tryOneRun(scenario: RecipeGenEvalScenario): Promise<{ example?: TuningExample; rejectReason?: string }> {
  const drafts = await generateAiRecipeDrafts(scenario.input);
  if (!drafts.length) return { rejectReason: 'Gemini trả về rỗng/lỗi parse' };

  const signatures = drafts.map((d) => buildIngredientSignature(d.ingredients || d.missingIngredients || []));
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const sig of signatures) {
    if (!sig) continue;
    if (seen.has(sig)) duplicateCount += 1;
    seen.add(sig);
  }
  if (duplicateCount > 0) return { rejectReason: `${duplicateCount} công thức trùng bộ nguyên liệu` };

  const allValid = drafts.every((draft) => isFullyValid(checkDraft(draft, scenario)));
  if (!allValid) return { rejectReason: 'ít nhất 1 công thức không đạt đủ 5 tiêu chí' };

  const prompt = buildAiRecipePrompt(scenario.input);
  const output = JSON.stringify(drafts);

  return {
    example: {
      contents: [
        { role: 'user', parts: [{ text: prompt }] },
        { role: 'model', parts: [{ text: output }] },
      ],
    },
  };
}

async function main() {
  if (!hasApiKey()) {
    console.error('Chưa cấu hình GEMINI_API_KEY trong .env — cần gọi pipeline AI thật để lọc dữ liệu sạch.');
    process.exit(1);
  }

  const accepted: TuningExample[] = [];
  const rejectedLog: string[] = [];

  for (const scenario of RECIPE_GENERATION_EVAL_SCENARIOS) {
    for (let run = 1; run <= RUNS_PER_SCENARIO; run += 1) {
      console.log(`\nKịch bản "${scenario.name}" — lần chạy ${run}/${RUNS_PER_SCENARIO}...`);
      try {
        const { example, rejectReason } = await tryOneRun(scenario);
        if (example) {
          accepted.push(example);
          console.log('  → ĐẠT, đưa vào dữ liệu tuning.');
        } else {
          rejectedLog.push(`${scenario.name} (lần ${run}): ${rejectReason}`);
          console.log(`  → LOẠI: ${rejectReason}`);
        }
      } catch (error: any) {
        rejectedLog.push(`${scenario.name} (lần ${run}): lỗi — ${error?.message || error}`);
        console.log(`  → LỖI: ${error?.message || error}`);
      }
    }
  }

  const outDir = join(__dirname, '..', '..', 'docs', 'research');
  mkdirSync(outDir, { recursive: true });

  const jsonlPath = join(outDir, 'recipe-generation-tuning-data.jsonl');
  writeFileSync(jsonlPath, accepted.map((example) => JSON.stringify(example)).join('\n') + (accepted.length ? '\n' : ''), 'utf-8');

  const summaryPath = join(outDir, 'recipe-generation-tuning-data-summary.md');
  const lines: string[] = [];
  lines.push('# Dữ liệu fine-tune cho chức năng sinh công thức AI (chuẩn bị, chưa gửi job)');
  lines.push('');
  lines.push(`Chạy lúc: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    '**Phương pháp**: chạy pipeline Gemini thật trên các kịch bản đã có, lọc lại bằng đúng bộ kiểm tra tự động của `npm run eval:recipe-generation`; chỉ giữ lần sinh nào TOÀN BỘ công thức trong phản hồi đạt cả 5 tiêu chí và không trùng nguyên liệu.'
  );
  lines.push('');
  lines.push(`- Số kịch bản: ${RECIPE_GENERATION_EVAL_SCENARIOS.length}, số lần chạy/kịch bản: ${RUNS_PER_SCENARIO} (tổng ${RECIPE_GENERATION_EVAL_SCENARIOS.length * RUNS_PER_SCENARIO} lần gọi Gemini thật).`);
  lines.push(`- **Số mẫu ĐẠT, đưa vào dữ liệu tuning**: ${accepted.length}.`);
  lines.push(`- File dữ liệu: \`docs/research/recipe-generation-tuning-data.jsonl\` (định dạng chat contents, 1 JSON object/dòng).`);
  lines.push('');
  lines.push('## Các lần bị loại (minh bạch, không che)');
  lines.push('');
  if (rejectedLog.length) {
    for (const item of rejectedLog) lines.push(`- ${item}`);
  } else {
    lines.push('_Không có lần nào bị loại._');
  }
  lines.push('');
  lines.push('## Lưu ý quan trọng trước khi gửi job fine-tune');
  lines.push('');
  lines.push(
    `- **${accepted.length} mẫu là RẤT ÍT** cho một job fine-tune (Google thường khuyến nghị nhiều hơn). Đây là dữ liệu tối thiểu khả thi trong 1 tuần không có GPU — nếu muốn kết quả tốt hơn, chạy lại script này với \`RUNS_PER_SCENARIO\` cao hơn để có thêm mẫu, hoặc viết thêm kịch bản mới trong \`recipeGenerationDataset.ts\`.`
  );
  lines.push(
    '- **Định dạng chính xác của job tuning (tên field, cách upload, mức phí) cần tự kiểm tra lại trong Google AI Studio / Vertex AI hiện tại** — các API/console của Google có thể đã thay đổi so với lúc viết tài liệu này. File `.jsonl` ở trên dùng định dạng chat `contents` (role user/model) là định dạng phổ biến cho supervised tuning Gemini, nhưng hãy xác nhận lại trước khi gửi.'
  );
  lines.push(
    '- Sau khi có model đã fine-tune, đánh giá bằng **chính** `npm run eval:recipe-generation` (trỏ `GEMINI_MODEL`/`GEMINI_MODELS` sang tên model đã tune) để so sánh công bằng với baseline prompt engineering hiện tại — quyết định giữ/không giữ dựa trên số liệu, không dựa trên cảm quan.'
  );
  lines.push('');
  writeFileSync(summaryPath, lines.join('\n'), 'utf-8');

  console.log(`\n=== Tổng kết ===`);
  console.log(`Số mẫu đạt: ${accepted.length}/${RECIPE_GENERATION_EVAL_SCENARIOS.length * RUNS_PER_SCENARIO}`);
  console.log(`Đã lưu: ${jsonlPath}`);
  console.log(`Đã lưu: ${summaryPath}`);
}

main().catch((error) => {
  console.error('[buildRecipeTuningDataset] failed:', error);
  process.exit(1);
});
