import { GoogleGenerativeAI } from '@google/generative-ai';

import { FoodCategory } from '../models/foodCategory.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { StorageLocation } from '../models/storageLocation.model';
import { StorageRule } from '../models/storageRule.model';
import { buildOwnerQuery, getInventoryOwnerContext } from './foodService';
import { resolveNutritionForFood } from './nutritionService';
import {
  FoodCategoryLike,
  getFoodCategoryHintKeys,
  normalizeFoodText,
} from '../utils/foodCategoryValidation';
import { validateNutritionSnapshot } from '../utils/nutritionValidation';
import { GeminiScanCandidate, GeminiScanFood, getDistinctScanFoods, MAX_SCAN_FOODS, parseScanPayload } from '../utils/scanPayload';
import { getStorageGuidance } from '../utils/storageGuidance';

type RecognitionInput = {
  userId: string;
  imageBuffer: Buffer;
  mimeType: string;
  ownerType?: string;
  householdId?: string;
  signal?: AbortSignal;
  onStage?: (stage: 'recognizing' | 'enriching') => void;
};

type GeminiFailureCode =
  | 'GEMINI_API_KEY_MISSING'
  | 'GEMINI_QUOTA_EXCEEDED'
  | 'GEMINI_MODEL_UNAVAILABLE'
  | 'GEMINI_INVALID_RESPONSE'
  | 'GEMINI_TIMEOUT'
  | 'GEMINI_UNAVAILABLE';

type GeminiFailure = {
  code: GeminiFailureCode;
  message: string;
  retryAfterSeconds?: number;
  modelAttempts: string[];
};

const CATEGORY_SELECT = 'categoryName displayName aliases keywords foodExamples sortOrder';
const DEFAULT_SCAN_MODEL_ATTEMPTS = 2;
const modelCooldownUntil = new Map<string, number>();

function getGenAI() {
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

function getMaxModelAttempts() {
  const configured = Number(process.env.GEMINI_SCAN_MAX_MODEL_ATTEMPTS);
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, 5);
  return DEFAULT_SCAN_MODEL_ATTEMPTS;
}

function compactList(values: unknown, limit = 6) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeFoodText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function clamp01(value: any) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function getCategoryId(category?: FoodCategoryLike | null) {
  return category?._id ? String(category._id) : undefined;
}

function getCategoryLabel(category?: FoodCategoryLike | null) {
  return category?.displayName?.trim() || category?.categoryName?.trim() || 'Chưa phân loại';
}

function buildPrompt(categories: FoodCategoryLike[]) {
  const compactCategories = categories.map((category) => ({
    id: getCategoryId(category),
    categoryName: category.categoryName,
    displayName: category.displayName,
    aliases: compactList(category.aliases, 4),
    keywords: compactList(category.keywords, 6),
    foodExamples: compactList(category.foodExamples, 8),
  }));

  return `
You are a food image recognition engine for a Vietnamese household inventory app.
Identify ALL distinct visible food types in the image, up to ${MAX_SCAN_FOODS} foods, in a single pass.

Rules:
- Return Vietnamese food names with diacritics.
- Do not guess if the image is not food or too blurry. Set isFood=false and confidence <= 0.25.
- Map the food to one of the existing categories by categoryName/displayName/aliases/examples.
- Use grocery/culinary classification, not botanical taxonomy.
- Do not confuse Vietnamese words with accents: "cà rốt", "cà chua" are vegetables, not fish ("cá").
- Each distinct food belongs in foods. Group identical foods together and estimate their combined quantity.
- Return a tight boundingBox [yMin,xMin,yMax,xMax] for each food, coordinates normalized to 0..1000 in the exact supplied image. Do not return the full scene for every food. If a food cannot be localized reliably, omit its box.
- Set visibility=CLEAR, PACKAGED or OCCLUDED. Never guess contents of opaque bags. Recognize packaging only when a readable label or visible food supports it; flag uncertainty.
- Set foodState=RAW or COOKED only when clearly visible; otherwise UNKNOWN. Never infer purchase date, freshness, safety or shelf life from appearance.
- Candidates are alternative names for the SAME food, never other objects in the image. Return at most two alternatives per food, only when ambiguous.
- Return foods=[] when no food is visible. Do not invent hidden foods or infer ingredients inside prepared dishes.
- Names, storage, quantities, warnings and nutrition must belong to their own food, not be copied from the main item.
- Keep explanations brief. Shelf life is an estimate; never claim visual freshness proves food safety.
- Do not invent category names outside the provided category list.
- Keep foodName short and natural, e.g. "Dưa leo", "Nhãn lồng", "Thịt bò", "Trứng gà".
- nutritionPer100g is for 100 g of the edible portion, never for the total amount visible in the image.
- Estimate nutrition for the recognized state when visible (raw/cooked, skin-on/skinless) and keep calories consistent with protein, carbs, and fat.
- Use zero only when a nutrient is genuinely absent; do not copy the same macro values across unrelated foods.

Available categories:
${JSON.stringify(compactCategories)}

Return only raw JSON:
{
  "foods": [{
  "isFood": true,
  "foodName": "Tên thực phẩm",
  "normalizedName": "ten thuc pham chinh",
  "categoryName": "Tên danh mục từ danh sách",
  "confidence": 0.0,
  "boundingBox": [100,100,500,500],
  "visibility": "CLEAR|PACKAGED|OCCLUDED",
  "foodState": "RAW|COOKED|UNKNOWN",
  "candidates": [
    {
      "foodName": "Tên ứng viên",
      "normalizedName": "ten ung vien",
      "categoryName": "Tên danh mục từ danh sách",
      "confidence": 0.0,
      "reason": "Lý do ngắn bằng tiếng Việt"
    }
  ],
  "visualEvidence": ["dấu hiệu nhìn thấy trong ảnh"],
  "estimatedQuantity": { "quantity": 1, "unit": "kg|g|ml|l|quả|cái" },
  "preferredStorageType": "REFRIGERATOR|OUTSIDE|FREEZER|PANTRY|KITCHEN_CABINET",
  "nutritionPer100g": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "warnings": []
  }],
  "warnings": []
}`;
}

async function recognizeWithGemini(input: RecognitionInput, categories: FoodCategoryLike[]) {
  const genAI = getGenAI();
  if (!genAI) {
    return {
      parsed: null,
      modelUsed: undefined,
      failure: {
        code: 'GEMINI_API_KEY_MISSING' as const,
        message: 'Backend chua cau hinh GEMINI_API_KEY nen khong the nhan dien anh.',
        modelAttempts: [],
      },
    };
  }

  const prompt = buildPrompt(categories);
  const imagePart = {
    inlineData: {
      data: input.imageBuffer.toString('base64'),
      mimeType: input.mimeType,
    },
  };
  const modelAttempts: string[] = [];
  let lastFailure: GeminiFailure | undefined;
  let attemptedCount = 0;
  const maxAttempts = getMaxModelAttempts();
  const configuredTimeout = Number(process.env.GEMINI_SCAN_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(45_000, Math.max(1000, configuredTimeout)) : 25_000;
  const deadline = Date.now() + timeoutMs;

  for (const modelName of getGeminiModelNames()) {
    if (attemptedCount >= maxAttempts) break;
    input.signal?.throwIfAborted();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const cooldownUntil = modelCooldownUntil.get(modelName) || 0;
    if (Date.now() < cooldownUntil) {
      lastFailure = {
        code: 'GEMINI_QUOTA_EXCEEDED',
        message: `Gemini model ${modelName} dang trong thoi gian cooldown do quota/rate-limit.`,
        retryAfterSeconds: Math.ceil((cooldownUntil - Date.now()) / 1000),
        modelAttempts: [...modelAttempts],
      };
      continue;
    }

    modelAttempts.push(modelName);
    attemptedCount += 1;
    try {
      const model = genAI.getGenerativeModel({ model: modelName, generationConfig: {
        responseMimeType: 'application/json', maxOutputTokens: 6000, temperature: 0.1,
      } });
      const result = await model.generateContent([prompt, imagePart], { timeout: remainingMs, signal: input.signal });
      const parsed = parseScanPayload(result.response.text());
      if (parsed) return { parsed, modelUsed: modelName, failure: undefined };
      lastFailure = {
        code: 'GEMINI_INVALID_RESPONSE',
        message: `Gemini model ${modelName} tra ve noi dung khong dung JSON schema.`,
        modelAttempts: [...modelAttempts],
      };
    } catch (error: any) {
      input.signal?.throwIfAborted();
      const status = error?.status ? `status=${error.status}` : '';
      const message = error?.message || String(error);
      console.warn(`[Gemini scan recognition error:${modelName}] ${status} ${message}`);
      const retryMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i) || message.match(/"retryDelay":"(\d+)s"/i);
      const retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : undefined;
      if (error?.status === 429) {
        const cooldownMs = Math.max(15, retryAfterSeconds || 60) * 1000;
        modelCooldownUntil.set(modelName, Date.now() + cooldownMs);
      }
      const code: GeminiFailureCode = Date.now() >= deadline || error?.name === 'AbortError'
        ? 'GEMINI_TIMEOUT' : error?.status === 429
        ? 'GEMINI_QUOTA_EXCEEDED'
        : error?.status === 404
          ? 'GEMINI_MODEL_UNAVAILABLE'
          : 'GEMINI_UNAVAILABLE';
      lastFailure = {
        code,
        message,
        retryAfterSeconds,
        modelAttempts: [...modelAttempts],
      };
    }
  }

  return {
    parsed: null,
    modelUsed: undefined,
    failure: lastFailure || {
      code: 'GEMINI_UNAVAILABLE' as const,
      message: 'Gemini khong tra ve ket qua nhan dien.',
      modelAttempts,
    },
  };
}

function getFailureWarning(failure?: GeminiFailure) {
  if (!failure) {
    return 'AI chua nhan dien duoc thuc pham tu anh nay. Vui long chup lai ro hon hoac nhap thu cong.';
  }

  if (failure.code === 'GEMINI_API_KEY_MISSING') {
    return 'Backend chua cau hinh GEMINI_API_KEY. Vui long them key vao file .env backend va khoi dong lai server.';
  }

  if (failure.code === 'GEMINI_QUOTA_EXCEEDED') {
    const retry = failure.retryAfterSeconds ? ` Thu lai sau khoang ${failure.retryAfterSeconds} giay.` : '';
    return `Gemini API dang het quota hoac bi gioi han request cho key hien tai.${retry} Hay doi API key co quota, bat billing, hoac cau hinh GEMINI_MODEL/GEMINI_MODELS sang model con quota.`;
  }

  if (failure.code === 'GEMINI_MODEL_UNAVAILABLE') {
    return 'Model Gemini dang cau hinh khong kha dung. Hay dat GEMINI_MODEL hoac GEMINI_MODELS trong .env backend bang model dang duoc cap quyen.';
  }

  if (failure.code === 'GEMINI_TIMEOUT') return 'Nhận diện mất nhiều thời gian hơn dự kiến. Hãy thử ảnh rõ hơn, ít chồng lấp hoặc thử lại.';

  return 'Gemini dang khong kha dung nen chua the nhan dien anh. Vui long thu lai hoac nhap thu cong.';
}

function findCategoryByName(categoryName: string | undefined, categories: FoodCategoryLike[]) {
  const target = normalizeFoodText(categoryName || '');
  if (!target) return undefined;

  return categories.find((category) => {
    const values = [
      category.categoryName,
      category.displayName,
      ...(category.aliases || []),
    ].map((value) => normalizeFoodText(value || ''));
    return values.includes(target);
  });
}

function hasNormalizedTerm(source: string, term: string) {
  if (!source || !term || term.length < 2) return false;
  if (term === 'ca' && source !== term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(source);
}

function scoreCategoryForFoodName(foodName: string, category: FoodCategoryLike) {
  const source = normalizeFoodText(foodName);
  const hintKeys = getFoodCategoryHintKeys(foodName);
  const scoreGroups = [
    { weight: 6, values: category.foodExamples || [] },
    { weight: 4, values: category.keywords || [] },
    { weight: 3, values: category.aliases || [] },
    { weight: 1, values: [category.displayName, category.categoryName] },
  ];

  const hintScore = hintKeys.some((hintKey) => {
    const categoryKeys = [
      category.categoryName,
      category.displayName,
      ...(category.aliases || []),
      ...(category.keywords || []),
    ].map((value) => normalizeFoodText(value || ''));
    return categoryKeys.includes(hintKey);
  }) ? 12 : 0;

  return hintScore + scoreGroups.reduce((score, group) => {
    const matched = group.values.some((value) => hasNormalizedTerm(source, normalizeFoodText(value || '')));
    return matched ? score + group.weight : score;
  }, 0);
}

function categoryMatchesFoodHint(foodName: string | undefined, category: FoodCategoryLike) {
  const hintKeys = getFoodCategoryHintKeys(foodName || '');
  if (!hintKeys.length) return true;

  const categoryKeys = [
    category.categoryName,
    category.displayName,
    ...(category.aliases || []),
    ...(category.keywords || []),
    ...(category.foodExamples || []),
  ].map((value) => normalizeFoodText(value || ''));

  return hintKeys.some((hintKey) => categoryKeys.includes(hintKey));
}

function findBestCategoryByFoodName(foodName: string | undefined, categories: FoodCategoryLike[]) {
  if (!foodName?.trim()) return undefined;
  const scored = categories
    .map((category) => ({
      category,
      score: scoreCategoryForFoodName(foodName, category),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.category;
}

function mapCandidateToCategory(candidate: GeminiScanCandidate, categories: FoodCategoryLike[]) {
  const byFoodName = findBestCategoryByFoodName(candidate.foodName, categories);
  if (byFoodName) return byFoodName;

  const direct = findCategoryByName(candidate.categoryName, categories);
  if (direct && categoryMatchesFoodHint(candidate.foodName, direct)) return direct;

  return undefined;
}

function normalizeEstimatedQuantityUnit(unit?: string) {
  const normalized = normalizeFoodText(unit || '');
  if (['kg', 'g', 'ml', 'l'].includes(normalized)) return normalized;
  if (['qua', 'trai'].includes(normalized)) return 'quả';
  if (['cai', 'hop', 'goi', 'item', 'piece', 'pieces'].includes(normalized)) return 'cái';
  return 'kg';
}

function normalizeStorageType(value?: string) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['REFRIGERATOR', 'FRIDGE', 'COOLER'].includes(normalized)) return 'REFRIGERATOR';
  if (['FREEZER', 'FROZEN'].includes(normalized)) return 'FREEZER';
  if (['PANTRY'].includes(normalized)) return 'PANTRY';
  if (['KITCHEN_CABINET', 'CABINET'].includes(normalized)) return 'KITCHEN_CABINET';
  return 'OUTSIDE';
}

function storageLabel(storageType: string) {
  if (storageType === 'REFRIGERATOR') return 'Tủ lạnh';
  if (storageType === 'FREEZER') return 'Ngăn đông';
  if (storageType === 'PANTRY') return 'Tủ khô';
  if (storageType === 'KITCHEN_CABINET') return 'Tủ bếp';
  return 'Bên ngoài';
}

function defaultExpiryDays(storageType: string) {
  if (storageType === 'FREEZER') return 30;
  if (storageType === 'REFRIGERATOR') return 5;
  if (storageType === 'PANTRY' || storageType === 'KITCHEN_CABINET') return 14;
  return 3;
}

type InventoryOwnerContext = Awaited<ReturnType<typeof getInventoryOwnerContext>>;

async function resolveStorage(
  ownerContext: InventoryOwnerContext,
  categoryId?: string,
  preferredStorageType?: string,
) {
  const rule = categoryId
    ? await StorageRule.findOne({ categoryId, status: 'OFFICIAL' })
      .sort({ priority: -1, estimatedDays: -1 })
      .lean()
    : null;

  const storageType = normalizeStorageType(rule?.storageType || preferredStorageType);
  const ownerQuery = buildOwnerQuery(ownerContext);
  const location = await StorageLocation.findOne({
    ...ownerQuery,
    storageType,
    isActive: true,
  }).sort({ isDefault: -1, createdAt: 1 });

  return {
    storageType,
    storageLocationId: location?._id ? String(location._id) : undefined,
    location: storageType === 'REFRIGERATOR'
      ? 'fridge'
      : storageType === 'FREEZER'
        ? 'freezer'
        : 'outside',
    description: rule?.instruction || `Nên bảo quản ở ${storageLabel(storageType).toLowerCase()}.`,
    temperature: storageType === 'FREEZER'
      ? '-18°C'
      : storageType === 'REFRIGERATOR'
        ? '≤ 4°C'
        : '20-25°C',
    estimatedDays: Number(rule?.estimatedDays) || defaultExpiryDays(storageType),
  };
}

async function resolveNutrition(foodName: string, categoryId?: string, aiNutrition?: GeminiScanFood['nutritionPer100g']) {
  const nutrition = await resolveNutritionForFood({
    foodName,
    categoryId,
    quantity: 100,
    unit: 'g',
  });

  if (nutrition.source === 'NUTRITION_FACT') {
    return {
      calories: nutrition.calories,
      protein: nutrition.macroSummary.protein,
      carbs: nutrition.macroSummary.carbs,
      fat: nutrition.macroSummary.fat,
      source: 'NUTRITION_FACT',
      matched: true,
    };
  }

  const validatedAiNutrition = validateNutritionSnapshot({
    ...aiNutrition,
    baseQuantity: 100,
    unit: 'g',
    source: 'SCAN_AI',
  });
  if (validatedAiNutrition.value) {
    const snapshot = validatedAiNutrition.value;
    return {
      calories: snapshot.calories,
      protein: snapshot.protein,
      carbs: snapshot.carbs,
      fat: snapshot.fat,
      source: 'GEMINI',
      matched: true,
    };
  }

  return {
    calories: nutrition.calories,
    protein: nutrition.macroSummary.protein,
    carbs: nutrition.macroSummary.carbs,
    fat: nutrition.macroSummary.fat,
    source: nutrition.source,
    matched: nutrition.matched,
    validationWarning: aiNutrition ? validatedAiNutrition.warning : undefined,
  };
}

async function hasOfficialNutrition(foodName: string, categoryId?: string) {
  if (!foodName.trim()) return false;
  const query: any = {
    foodName: new RegExp(foodName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    status: 'OFFICIAL',
  };
  if (categoryId) query.categoryId = categoryId;
  return Boolean(await NutritionFact.exists(query));
}

async function enrichRecognizedFood(
  parsed: GeminiScanFood,
  categories: FoodCategoryLike[],
  ownerContext: InventoryOwnerContext,
) {
  const warnings: string[] = [];
  const primary: GeminiScanCandidate = { foodName: parsed.foodName, normalizedName: parsed.normalizedName, categoryName: parsed.categoryName, confidence: parsed.confidence };
  const rawCandidates = [primary, ...(Array.isArray(parsed.candidates) ? parsed.candidates : [])]
    .filter((candidate) => candidate && typeof candidate.foodName === 'string' && candidate.foodName.trim());
  const seen = new Set<string>();
  const mappedCandidates = rawCandidates.map((candidate) => {
    const category = mapCandidateToCategory(candidate, categories);
    return {
      foodName: candidate.foodName!.trim(),
      normalizedName: candidate.normalizedName || normalizeFoodText(candidate.foodName || ''),
      categoryId: getCategoryId(category), categoryName: getCategoryLabel(category),
      confidence: clamp01(candidate.confidence ?? parsed.confidence), reason: candidate.reason,
    };
  }).filter((candidate) => {
    const key = normalizeFoodText(candidate.foodName);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 3);
  // Primary identity stays first: alternatives must not replace the identity
  // whose quantity, expiry and nutrition were supplied by the model.
  const best = mappedCandidates[0];
  if (!best?.categoryId) warnings.push('Chưa khớp danh mục. Vui lòng chọn danh mục trước khi thêm.');
  if (best && best.confidence < 0.65) warnings.push('Độ tin cậy thấp, vui lòng kiểm tra lại tên thực phẩm.');
  const [storage, nutrition, nutritionMatched] = await Promise.all([
    resolveStorage(ownerContext, best?.categoryId, parsed.preferredStorageType),
    resolveNutrition(best?.foodName || '', best?.categoryId, parsed.nutritionPer100g),
    hasOfficialNutrition(best?.foodName || '', best?.categoryId),
  ]);
  const guidance = getStorageGuidance(best?.foodName || '', parsed.foodState ?? 'UNKNOWN', storage.storageType);
  const estimatedDays = guidance?.minDays ?? 0;
  if (!guidance) warnings.push('Chưa đủ dữ kiện để gợi ý ngày bảo quản. Hãy chọn trạng thái, nơi bảo quản và xác nhận ngày trên bao bì hoặc tự nhập.');
  if (parsed.visibility !== 'CLEAR') warnings.push('Món đang trong bao hoặc bị che khuất. Hãy kiểm tra tên và vùng ảnh trước khi chọn lưu.');
  if (nutrition.validationWarning) warnings.push('Dinh dưỡng AI chưa hợp lý; đã dùng dữ liệu dự phòng.');
  const quantity = Number(parsed.estimatedQuantity?.quantity);
  return {
    productName: best?.foodName || 'Không xác định',
    category: best?.categoryName || 'Chưa phân loại', confidence: best?.confidence ?? 0,
    isFood: Boolean(best), normalizedName: best?.normalizedName || '',
    categoryId: best?.categoryId, categoryName: best?.categoryName,
    boundingBox: parsed.boundingBox, visibility: parsed.visibility, foodState: parsed.foodState ?? 'UNKNOWN',
    storageGuide: guidance,
    candidates: mappedCandidates,
    visualEvidence: Array.isArray(parsed.visualEvidence) ? parsed.visualEvidence.filter((v) => typeof v === 'string').slice(0, 3) : [],
    estimatedQuantity: { quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 100_000) : 1, unit: normalizeEstimatedQuantityUnit(parsed.estimatedQuantity?.unit) },
    storageSuggestion: storage,
    expiryEstimate: { predictedDays: estimatedDays, expiryDate: new Date(Date.now() + estimatedDays * 86400000).toLocaleDateString('en-GB'), explanation: storage.description },
    nutritionEstimate: { ...nutrition, matched: nutritionMatched || nutrition.matched },
    warnings: [...new Set([...(Array.isArray(parsed.warnings) ? parsed.warnings.filter((w) => typeof w === 'string') : []), ...warnings])],
  };
}

export async function recognizeFoodsFromImage(input: RecognitionInput) {
  input.signal?.throwIfAborted();
  const [ownerContext, categories] = await Promise.all([
    getInventoryOwnerContext(input.userId, input.ownerType, input.householdId),
    FoodCategory.find({ isActive: true }).select(CATEGORY_SELECT).sort({ sortOrder: 1, categoryName: 1 }).lean(),
  ]);
  input.signal?.throwIfAborted();
  input.onStage?.('recognizing');
  const { parsed, modelUsed, failure } = await recognizeWithGemini(input, categories);
  input.signal?.throwIfAborted();
  const inventoryContext = { ownerType: ownerContext.ownerType, householdId: ownerContext.householdId ? String(ownerContext.householdId) : undefined };
  if (!parsed) return {
    foods: [], warnings: [getFailureWarning(failure)], errorCode: failure?.code || 'GEMINI_INVALID_RESPONSE',
    retryAfterSeconds: failure?.retryAfterSeconds, aiProvider: 'GEMINI', modelUsed, inventoryContext,
  };
  input.onStage?.('enriching');
  const rawFoods = getDistinctScanFoods(parsed);
  const foods: Awaited<ReturnType<typeof enrichRecognizedFood>>[] = [];
  // Bounded parallel enrichment keeps one crowded photo from flooding MongoDB.
  for (let start = 0; start < rawFoods.length; start += 3) {
    input.signal?.throwIfAborted();
    foods.push(...await Promise.all(rawFoods.slice(start, start + 3).map((food) => enrichRecognizedFood(food, categories, ownerContext))));
  }
  input.signal?.throwIfAborted();
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w) => typeof w === 'string') : [];
  if (!foods.length) warnings.push('Chưa tìm thấy thực phẩm rõ ràng. Hãy đổi góc chụp hoặc chọn một ảnh khác.');
  if (Array.isArray(parsed.foods) && parsed.foods.length >= MAX_SCAN_FOODS) warnings.push(`Mỗi ảnh nhận diện tối đa ${MAX_SCAN_FOODS} loại thực phẩm. Bạn có thể quét thêm ảnh cho những món còn lại.`);
  return { foods, warnings, errorCode: undefined, retryAfterSeconds: undefined, aiProvider: 'GEMINI', modelUsed, inventoryContext };
}

// Compatibility for existing single-food clients. The new scanner uses scan jobs.
export async function recognizeFoodFromImage(input: RecognitionInput) {
  const batch = await recognizeFoodsFromImage(input);
  return {
    ...(batch.foods[0] ?? { productName: 'Không xác định', category: 'Chưa phân loại', confidence: 0, isFood: false, candidates: [] }),
    warnings: [...batch.warnings, ...(batch.foods[0]?.warnings ?? [])],
    errorCode: batch.errorCode, retryAfterSeconds: batch.retryAfterSeconds,
    aiProvider: batch.aiProvider, modelUsed: batch.modelUsed, inventoryContext: batch.inventoryContext,
  };
}
