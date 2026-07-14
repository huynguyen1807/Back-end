import { GoogleGenerativeAI } from '@google/generative-ai';

import { FoodCategory } from '../models/foodCategory.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { StorageLocation } from '../models/storageLocation.model';
import { StorageRule } from '../models/storageRule.model';
import { buildOwnerQuery, getInventoryOwnerContext } from './foodService';
import { resolveNutritionForFood } from './nutritionService';
import {
  FoodCategoryLike,
  normalizeFoodText,
} from '../utils/foodCategoryValidation';

type GeminiScanCandidate = {
  foodName?: string;
  normalizedName?: string;
  categoryName?: string;
  confidence?: number;
  reason?: string;
};

type GeminiScanResult = {
  isFood?: boolean;
  foodName?: string;
  normalizedName?: string;
  categoryName?: string;
  confidence?: number;
  candidates?: GeminiScanCandidate[];
  visualEvidence?: string[];
  estimatedQuantity?: {
    quantity?: number;
    unit?: string;
  };
  preferredStorageType?: string;
  estimatedExpiryDays?: number;
  nutritionPer100g?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  warnings?: string[];
};

type RecognitionInput = {
  userId: string;
  imageBuffer: Buffer;
  mimeType: string;
};

type GeminiFailureCode =
  | 'GEMINI_API_KEY_MISSING'
  | 'GEMINI_QUOTA_EXCEEDED'
  | 'GEMINI_MODEL_UNAVAILABLE'
  | 'GEMINI_INVALID_RESPONSE'
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

function parseJsonObject(text: string): GeminiScanResult | null {
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
Analyze the image and identify the main food item only.

Rules:
- Return Vietnamese food names with diacritics.
- Do not guess if the image is not food or too blurry. Set isFood=false and confidence <= 0.25.
- Map the food to one of the existing categories by categoryName/displayName/aliases/examples.
- Use grocery/culinary classification, not botanical taxonomy.
- Return multiple candidates only when the image is ambiguous.
- Do not invent category names outside the provided category list.
- Keep foodName short and natural, e.g. "Dưa leo", "Nhãn lồng", "Thịt bò", "Trứng gà".

Available categories:
${JSON.stringify(compactCategories, null, 2)}

Return only raw JSON:
{
  "isFood": true,
  "foodName": "Tên thực phẩm chính",
  "normalizedName": "ten thuc pham chinh",
  "categoryName": "Tên danh mục từ danh sách",
  "confidence": 0.0,
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
  "estimatedQuantity": { "quantity": 1, "unit": "kg|g|item|serving" },
  "preferredStorageType": "REFRIGERATOR|OUTSIDE|FREEZER|PANTRY|KITCHEN_CABINET",
  "estimatedExpiryDays": 3,
  "nutritionPer100g": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
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

  for (const modelName of getGeminiModelNames()) {
    if (attemptedCount >= maxAttempts) break;
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
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([prompt, imagePart]);
      const parsed = parseJsonObject(result.response.text());
      if (parsed) return { parsed, modelUsed: modelName, failure: undefined };
      lastFailure = {
        code: 'GEMINI_INVALID_RESPONSE',
        message: `Gemini model ${modelName} tra ve noi dung khong dung JSON schema.`,
        modelAttempts: [...modelAttempts],
      };
    } catch (error: any) {
      const status = error?.status ? `status=${error.status}` : '';
      const message = error?.message || String(error);
      console.warn(`[Gemini scan recognition error:${modelName}] ${status} ${message}`);
      const retryMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i) || message.match(/"retryDelay":"(\d+)s"/i);
      const retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : undefined;
      if (error?.status === 429) {
        const cooldownMs = Math.max(15, retryAfterSeconds || 60) * 1000;
        modelCooldownUntil.set(modelName, Date.now() + cooldownMs);
      }
      const code: GeminiFailureCode = error?.status === 429
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
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(source);
}

function scoreCategoryForFoodName(foodName: string, category: FoodCategoryLike) {
  const source = normalizeFoodText(foodName);
  const scoreGroups = [
    { weight: 6, values: category.foodExamples || [] },
    { weight: 4, values: category.keywords || [] },
    { weight: 3, values: category.aliases || [] },
    { weight: 1, values: [category.displayName, category.categoryName] },
  ];

  return scoreGroups.reduce((score, group) => {
    const matched = group.values.some((value) => hasNormalizedTerm(source, normalizeFoodText(value || '')));
    return matched ? score + group.weight : score;
  }, 0);
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
  const direct = findCategoryByName(candidate.categoryName, categories);
  if (direct) return direct;

  return findBestCategoryByFoodName(candidate.foodName, categories);
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

async function resolveStorage(userId: string, categoryId?: string, preferredStorageType?: string) {
  const rule = categoryId
    ? await StorageRule.findOne({ categoryId, status: 'OFFICIAL' })
        .sort({ priority: -1, estimatedDays: -1 })
        .lean()
    : null;

  const storageType = normalizeStorageType(rule?.storageType || preferredStorageType);
  const ownerQuery = buildOwnerQuery(await getInventoryOwnerContext(userId));
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
        ? '2-6°C'
        : '20-25°C',
    estimatedDays: Number(rule?.estimatedDays) || defaultExpiryDays(storageType),
  };
}

async function resolveNutrition(foodName: string, categoryId?: string, aiNutrition?: GeminiScanResult['nutritionPer100g']) {
  const nutrition = await resolveNutritionForFood({
    foodName,
    categoryId,
    quantity: 100,
    unit: 'g',
  });

  if (nutrition.matched) {
    return {
      calories: nutrition.calories,
      protein: nutrition.macroSummary.protein,
      carbs: nutrition.macroSummary.carbs,
      fat: nutrition.macroSummary.fat,
      source: 'DATABASE',
      matched: true,
    };
  }

  return {
    calories: Number(aiNutrition?.calories) || 0,
    protein: Number(aiNutrition?.protein) || 0,
    carbs: Number(aiNutrition?.carbs) || 0,
    fat: Number(aiNutrition?.fat) || 0,
    source: aiNutrition ? 'GEMINI' : 'NONE',
    matched: false,
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

export async function recognizeFoodFromImage(input: RecognitionInput) {
  const categories = await FoodCategory.find({ isActive: true })
    .select(CATEGORY_SELECT)
    .sort({ sortOrder: 1, categoryName: 1 })
    .lean();

  const { parsed, modelUsed, failure } = await recognizeWithGemini(input, categories);
  const warnings: string[] = [];

  if (!parsed) {
    return {
      productName: 'Không xác định',
      category: 'Chưa phân loại',
      confidence: 0,
      isFood: false,
      normalizedName: '',
      candidates: [],
      visualEvidence: [],
      estimatedQuantity: { quantity: 1, unit: 'kg' },
      warnings: [getFailureWarning(failure)],
      errorCode: failure?.code || 'GEMINI_INVALID_RESPONSE',
      providerError: failure?.message,
      retryAfterSeconds: failure?.retryAfterSeconds,
      modelAttempts: failure?.modelAttempts || [],
      aiProvider: 'GEMINI',
      modelUsed,
    };
  }

  if (parsed.isFood === false) {
    warnings.push('Ảnh không giống thực phẩm hoặc không đủ rõ để nhận diện.');
  }

  const rawCandidates = (parsed.candidates?.length ? parsed.candidates : [{
    foodName: parsed.foodName,
    normalizedName: parsed.normalizedName,
    categoryName: parsed.categoryName,
    confidence: parsed.confidence,
  }]).filter((candidate) => candidate.foodName?.trim());

  const mappedCandidates = rawCandidates
    .map((candidate) => {
      const category = mapCandidateToCategory(candidate, categories);
      const confidence = clamp01(candidate.confidence ?? parsed.confidence);
      return {
        foodName: candidate.foodName!.trim(),
        normalizedName: candidate.normalizedName || normalizeFoodText(candidate.foodName || ''),
        categoryId: getCategoryId(category),
        categoryName: getCategoryLabel(category),
        confidence,
        reason: candidate.reason,
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);

  const best = mappedCandidates[0];
  if (!best) {
    warnings.push('Không có ứng viên thực phẩm đủ tin cậy.');
  }
  if (best && !best.categoryId) {
    warnings.push('Không map được thực phẩm về danh mục trong database.');
  }
  if (best && best.confidence < 0.65) {
    warnings.push('Độ tin cậy thấp, nên kiểm tra lại trước khi thêm vào inventory.');
  }

  const storage = await resolveStorage(input.userId, best?.categoryId, parsed.preferredStorageType);
  const nutrition = await resolveNutrition(best?.foodName || '', best?.categoryId, parsed.nutritionPer100g);
  const nutritionMatched = await hasOfficialNutrition(best?.foodName || '', best?.categoryId);
  const estimatedDays = Math.max(
    0,
    Number(parsed.estimatedExpiryDays) || Number(storage.estimatedDays) || 3,
  );

  return {
    productName: best?.foodName || parsed.foodName || 'Không xác định',
    category: best?.categoryName || 'Chưa phân loại',
    confidence: best?.confidence || clamp01(parsed.confidence),
    isFood: parsed.isFood !== false && Boolean(best),
    normalizedName: best?.normalizedName || parsed.normalizedName || '',
    categoryId: best?.categoryId,
    categoryName: best?.categoryName,
    candidates: mappedCandidates,
    visualEvidence: Array.isArray(parsed.visualEvidence) ? parsed.visualEvidence.slice(0, 5) : [],
    estimatedQuantity: {
      quantity: Number(parsed.estimatedQuantity?.quantity) || 1,
      unit: parsed.estimatedQuantity?.unit || 'kg',
    },
    storageSuggestion: storage,
    expiryEstimate: {
      predictedDays: estimatedDays,
      expiryDate: new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB'),
      explanation: storage.description,
    },
    nutritionEstimate: {
      ...nutrition,
      matched: nutritionMatched || nutrition.matched,
    },
    warnings: Array.from(new Set([...(parsed.warnings || []), ...warnings])).filter(Boolean),
    aiProvider: 'GEMINI',
    modelUsed,
  };
}
