import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';

export type VideoRecipePlatform = 'YOUTUBE' | 'TIKTOK' | 'FACEBOOK' | 'OTHER';

export type ExtractedVideoIngredient = {
  ingredientName: string;
  quantity: number;
  unit: string;
  isRequired?: boolean;
};

export type ExtractedVideoRecipe = {
  recipeName: string;
  description?: string;
  ingredients: ExtractedVideoIngredient[];
  cookingSteps: string[];
  cookingTime?: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  calories?: number;
  servings?: number;
  cuisine?: string;
  macroSummary?: {
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  tags?: string[];
  notes?: string;
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODELS = (process.env.GEMINI_MODEL || process.env.GEMINI_MODELS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

function getGenAI(): GoogleGenerativeAI | null {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_actual_api_key_here') return null;
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

function getModelCandidates(): string[] {
  return Array.from(new Set([...GEMINI_MODELS, ...FALLBACK_MODELS]));
}

export function detectVideoPlatform(videoUrl: string): VideoRecipePlatform {
  const url = videoUrl.toLowerCase();
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YOUTUBE';
  if (url.includes('tiktok.com')) return 'TIKTOK';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'FACEBOOK';
  return 'OTHER';
}

const SYSTEM_INSTRUCTION = `Bạn là trợ lý trích xuất công thức nấu ăn từ video YouTube.
Nhiệm vụ: xem/nghe video và trả về công thức đầy đủ dưới dạng JSON.

QUY TẮC BẮT BUỘC:
- Chỉ trả về JSON thuần, KHÔNG markdown, KHÔNG code fence, KHÔNG giải thích thêm.
- Tất cả các trường người dùng nhìn thấy PHẢI dùng tiếng Việt có dấu.
- Tên món phải tự nhiên, đúng kiểu đặt tên món Việt hoặc tên gốc nếu là món quốc tế.
- Nguyên liệu phải có số lượng (number) và đơn vị (g/ml/thìa/cái/bát/...); nếu không rõ thì ước lượng hợp lý.
- cookingSteps là mảng các bước ngắn gọn, đánh số thứ tự trong nội dung ("Bước 1: ..."), mỗi bước 1-2 câu.
- cookingTime là phút (number), difficulty là "EASY" | "MEDIUM" | "HARD".
- calories ước lượng cho 1 khẩu phần (number).
- servings là số người ăn (number).
- macroSummary ước lượng protein/carbs/fat (gram) cho 1 khẩu phần.
- Nếu video không phải nấu ăn, vẫn trả JSON nhưng recipeName = "Không phải video nấu ăn" và ingredients/cookingSteps = [].
- Ưu tiên lấy thông tin từ giọng nói và chữ trên video. Bỏ qua quảng cáo/intro/outro.
- Nếu có nhiều món trong video, CHỈ trích xuất món chính (được nấu chi tiết nhất).`;

function buildUserPrompt(videoUrl: string): string {
  return `Hãy trích xuất công thức nấu ăn từ video YouTube sau:

URL: ${videoUrl}

Trả về JSON object (không markdown) đúng schema:
{
  "recipeName": "string",
  "description": "string mô tả ngắn 1-2 câu",
  "cuisine": "string (Việt Nam/Hàn/Nhật/...)",
  "servings": number,
  "cookingTime": number (phút),
  "difficulty": "EASY" | "MEDIUM" | "HARD",
  "calories": number,
  "macroSummary": { "protein": number, "carbs": number, "fat": number },
  "ingredients": [
    { "ingredientName": "string", "quantity": number, "unit": "string", "isRequired": boolean }
  ],
  "cookingSteps": ["Bước 1: ...", "Bước 2: ..."],
  "tags": ["string", "string"],
  "notes": "string (mẹo hoặc lưu ý ngắn, có thể để trống)"
}`;
}

function parseJsonResponse<T>(text: string, fallback: T): T {
  try {
    const clean = text
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(clean);
  } catch {
    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      try {
        return JSON.parse(text.slice(objStart, objEnd + 1));
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function normalizeExtractedRecipe(raw: any): ExtractedVideoRecipe {
  const pickString = (...vals: any[]): string | undefined => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };

  const ingredients = Array.isArray(raw?.ingredients)
    ? raw.ingredients
        .map((item: any) => ({
          ingredientName: String(item?.ingredientName || item?.name || '').trim(),
          quantity: Number(item?.quantity) || 1,
          unit: String(item?.unit || 'phần').trim(),
          isRequired: item?.isRequired !== false
        }))
        .filter((item: any) => item.ingredientName)
    : [];

  const cookingSteps = Array.isArray(raw?.cookingSteps)
    ? raw.cookingSteps.map((step: any) => String(step || '').trim()).filter(Boolean)
    : Array.isArray(raw?.steps)
      ? raw.steps.map((step: any) => String(step || '').trim()).filter(Boolean)
      : [];

  const difficultyRaw = String(raw?.difficulty || '').toUpperCase();
  const difficulty: 'EASY' | 'MEDIUM' | 'HARD' | undefined =
    difficultyRaw === 'EASY' || difficultyRaw === 'MEDIUM' || difficultyRaw === 'HARD'
      ? (difficultyRaw as 'EASY' | 'MEDIUM' | 'HARD')
      : undefined;

  const macroSummary = raw?.macroSummary
    ? {
        protein: Number(raw.macroSummary.protein) || 0,
        carbs: Number(raw.macroSummary.carbs) || 0,
        fat: Number(raw.macroSummary.fat) || 0
      }
    : undefined;

  return {
    recipeName: pickString(raw?.recipeName, raw?.title) || 'Công thức trích xuất từ video',
    description: pickString(raw?.description, raw?.desc),
    ingredients,
    cookingSteps,
    cookingTime: Number(raw?.cookingTime) || undefined,
    difficulty,
    calories: Number(raw?.calories) || undefined,
    servings: Number(raw?.servings) || undefined,
    cuisine: pickString(raw?.cuisine),
    macroSummary,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
    notes: pickString(raw?.notes, raw?.tips)
  };
}

export type ExtractFromVideoResult = {
  platform: VideoRecipePlatform;
  extractedRecipe: ExtractedVideoRecipe;
  rawText: string;
  modelUsed: string;
};

export class UnsupportedVideoPlatformError extends Error {
  constructor(platform: VideoRecipePlatform) {
    super(
      `Video platform "${platform}" is not supported. Currently only YouTube is supported.`
    );
    this.name = 'UnsupportedVideoPlatformError';
  }
}

export async function extractRecipeFromVideoUrl(
  videoUrl: string
): Promise<ExtractFromVideoResult> {
  const platform = detectVideoPlatform(videoUrl);
  if (platform !== 'YOUTUBE') {
    throw new UnsupportedVideoPlatformError(platform);
  }

  const genAI = getGenAI();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const models = getModelCandidates();
  const errors: string[] = [];
  const userPrompt = buildUserPrompt(videoUrl);

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        },
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ]
      });

      const filePart = {
        fileData: {
          fileUri: videoUrl,
          mimeType: 'video/mp4'
        }
      };

      const result = await model.generateContent([userPrompt, filePart as any]);
      const text = result?.response?.text?.() || '';
      if (!text.trim()) {
        errors.push(`${modelName}: empty response`);
        continue;
      }

      const parsed = parseJsonResponse<any>(text, null);
      if (!parsed || typeof parsed !== 'object') {
        errors.push(`${modelName}: could not parse JSON`);
        continue;
      }

      const normalized = normalizeExtractedRecipe(parsed);
      return {
        platform,
        extractedRecipe: normalized,
        rawText: text,
        modelUsed: modelName
      };
    } catch (error: any) {
      const msg = error?.message || 'unknown error';
      if (/404|not found|model/i.test(msg)) {
        errors.push(`${modelName}: ${msg}`);
        continue;
      }
      errors.push(`${modelName}: ${msg}`);
    }
  }

  console.error('[VideoRecipeExtractor] All models failed:', errors.join(' | '));
  throw new Error(
    `Không thể trích xuất công thức từ video. Lý do: ${errors[errors.length - 1] || 'unknown'}`
  );
}