import { GoogleGenerativeAI } from '@google/generative-ai';

import {
  FoodCategoryLike,
  FoodCategoryValidationResult,
  normalizeFoodText,
  validateFoodCategoryWithDatabase,
} from '../utils/foodCategoryValidation';

type ClassificationInput = {
  foodName: string;
  selectedCategoryId: any;
  categories: FoodCategoryLike[];
  allowAi?: boolean;
};

type GeminiClassification = {
  suggestedCategoryId?: string;
  suggestedCategoryName?: string;
  confidence?: number;
  reason?: string;
  isAmbiguous?: boolean;
};

const classificationCache = new Map<string, GeminiClassification>();

function getCategoryId(category?: FoodCategoryLike) {
  return category?._id ? String(category._id) : undefined;
}

function getCategoryLabel(category?: FoodCategoryLike) {
  return category?.displayName?.trim() || category?.categoryName?.trim() || 'Chưa phân loại';
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey || apiKey === 'your_actual_api_key_here') return null;
  return new GoogleGenerativeAI(apiKey);
}

function getGeminiModelNames() {
  const configured = (process.env.GEMINI_MODEL || process.env.GEMINI_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(new Set([
    ...configured,
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
  ]));
}

function parseJson(text: string): GeminiClassification | null {
  const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleanText);
  } catch (_) {
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleanText.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

function findCategoryByAiResult(result: GeminiClassification, categories: FoodCategoryLike[]) {
  const suggestedId = result.suggestedCategoryId ? String(result.suggestedCategoryId) : '';
  if (suggestedId) {
    const byId = categories.find((category) => getCategoryId(category) === suggestedId);
    if (byId) return byId;
  }

  const suggestedName = normalizeFoodText(result.suggestedCategoryName || '');
  if (!suggestedName) return undefined;

  return categories.find((category) => {
    const names = [
      category.categoryName,
      category.displayName,
      ...(Array.isArray(category.aliases) ? category.aliases : []),
    ].map((item) => normalizeFoodText(item || ''));
    return names.includes(suggestedName);
  });
}

function shouldUseGemini(validation: FoodCategoryValidationResult) {
  if (validation.isMismatch) return false;
  return validation.confidence === 'NONE' || validation.confidence === 'LOW';
}

function buildPrompt(foodName: string, selectedCategoryId: any, categories: FoodCategoryLike[]) {
  const compactCategories = categories.map((category) => ({
    id: getCategoryId(category),
    categoryName: category.categoryName,
    displayName: category.displayName,
    aliases: category.aliases || [],
    keywords: category.keywords || [],
    foodExamples: category.foodExamples || [],
  }));

  return `
You are a food inventory classifier for a Vietnamese meal planning app.
Classify the food name into exactly one existing category from the provided list.

Rules:
- Use culinary / grocery classification, not strict botanical taxonomy.
- "Dưa leo", "dưa chuột", cucumber should be Vegetable/Rau củ in this app.
- "Nhãn", "nhãn lồng", longan should be Fruit/Trái cây.
- Raw meat/fish/seafood must not be classified as ready-to-eat/cooked food.
- Do not invent a new category. Use only one provided category id.
- If ambiguous, choose the most practical grocery category and set isAmbiguous=true.

Food name: ${JSON.stringify(foodName)}
Selected category id by user: ${JSON.stringify(String(selectedCategoryId || ''))}
Available categories:
${JSON.stringify(compactCategories, null, 2)}

Return only JSON:
{
  "suggestedCategoryId": "one category id from list",
  "suggestedCategoryName": "category display/name",
  "confidence": 0.0,
  "reason": "short Vietnamese reason",
  "isAmbiguous": false
}`;
}

async function classifyWithGemini(foodName: string, selectedCategoryId: any, categories: FoodCategoryLike[]) {
  const client = getGeminiClient();
  if (!client) return null;

  const cacheKey = `${normalizeFoodText(foodName)}::${categories.map(getCategoryId).filter(Boolean).join('|')}`;
  const cached = classificationCache.get(cacheKey);
  if (cached) return cached;

  const prompt = buildPrompt(foodName, selectedCategoryId, categories);
  for (const modelName of getGeminiModelNames()) {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJson(text);
      const category = parsed ? findCategoryByAiResult(parsed, categories) : undefined;
      if (!parsed || !category) continue;

      const normalized: GeminiClassification = {
        suggestedCategoryId: getCategoryId(category),
        suggestedCategoryName: getCategoryLabel(category),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: parsed.reason,
        isAmbiguous: Boolean(parsed.isAmbiguous),
      };
      classificationCache.set(cacheKey, normalized);
      return normalized;
    } catch (error: any) {
      const status = error?.status ? `status=${error.status}` : '';
      const message = error?.message || String(error);
      console.warn(`[Gemini food category classifier error:${modelName}] ${status} ${message}`);
      if (error?.status === 429) break;
    }
  }

  return null;
}

function confidenceLabel(value: number): FoodCategoryValidationResult['confidence'] {
  if (value >= 0.8) return 'HIGH';
  if (value >= 0.65) return 'MEDIUM';
  if (value > 0) return 'LOW';
  return 'NONE';
}

export async function classifyFoodCategory(input: ClassificationInput): Promise<FoodCategoryValidationResult> {
  const deterministic = validateFoodCategoryWithDatabase(
    input.foodName,
    input.selectedCategoryId,
    input.categories,
  );

  if (!input.allowAi || !shouldUseGemini(deterministic)) {
    return deterministic;
  }

  const aiResult = await classifyWithGemini(input.foodName, input.selectedCategoryId, input.categories);
  const aiCategory = aiResult ? findCategoryByAiResult(aiResult, input.categories) : undefined;
  const selectedId = input.selectedCategoryId ? String(input.selectedCategoryId) : undefined;
  const selectedCategory = input.categories.find((category) => getCategoryId(category) === selectedId);

  if (!aiResult || !aiCategory) {
    return deterministic;
  }

  const confidence = confidenceLabel(Number(aiResult.confidence) || 0);
  const recommendedCategoryId = getCategoryId(aiCategory);
  const recommendedCategoryName = getCategoryLabel(aiCategory);
  const selectedCategoryName = getCategoryLabel(selectedCategory);
  const shouldWarn = Boolean(
    recommendedCategoryId &&
    recommendedCategoryId !== selectedId &&
    Number(aiResult.confidence) >= 0.65 &&
    !aiResult.isAmbiguous
  );

  return {
    isMismatch: shouldWarn,
    confidence,
    source: 'GEMINI',
    selectedCategoryId: selectedId,
    selectedCategoryName,
    recommendedCategoryId,
    recommendedCategoryName,
    matchedCategoryIds: recommendedCategoryId ? [recommendedCategoryId] : deterministic.matchedCategoryIds,
    reason: aiResult.reason,
    warning: shouldWarn
      ? `Danh mục "${selectedCategoryName}" không khớp với thực phẩm "${input.foodName}". AI gợi ý danh mục phù hợp hơn là "${recommendedCategoryName}" (${aiResult.reason || 'phân loại theo thực phẩm thực tế'}).`
      : undefined,
  };
}
