import { GoogleGenerativeAI } from '@google/generative-ai';
import { FileState, GoogleAIFileManager } from '@google/generative-ai/server';

export type RecipeVideoResult = {
  dishName: string;
  ingredients: string[];
  cookingSteps: string[];
  cookingTime: number;
};

type AnalyzeInput = {
  videoBuffer: Buffer;
  mimeType: string;
};

type AnalyzeOutput = {
  result: RecipeVideoResult | null;
  modelUsed?: string;
  errorCode?: 'GEMINI_API_KEY_MISSING' | 'GEMINI_ANALYSIS_FAILED';
  errorMessage?: string;
};

const PROMPT = `Bạn là trợ lý phân tích video nấu ăn cho một ứng dụng quản lý thực phẩm gia đình tại Việt Nam.
Xem kỹ video được cung cấp (hình ảnh lẫn lời thoại/phụ đề nếu có) và trích xuất công thức món ăn thực sự xuất hiện trong video.

Quy tắc:
- Chỉ dùng thông tin thực sự quan sát được trong video, không suy đoán hoặc bổ sung nguyên liệu/bước không xuất hiện.
- Dùng tiếng Việt có dấu cho tên món, nguyên liệu và các bước nấu.
- Nếu video không phải video nấu ăn hoặc không thể xác định được công thức, trả về dishName rỗng và ingredients/cookingSteps là mảng rỗng.
- cookingTime là tổng thời gian ước lượng để hoàn thành món (đơn vị: phút, số nguyên dương).

Chỉ trả về DUY NHẤT nội dung JSON thô theo đúng schema sau, không bọc trong markdown:
{
  "dishName": "Tên món ăn",
  "ingredients": ["Nguyên liệu 1", "Nguyên liệu 2"],
  "cookingSteps": ["Bước 1", "Bước 2"],
  "cookingTime": 30
}`;

function getApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY || '';
  return apiKey && apiKey !== 'your_actual_api_key_here' ? apiKey : null;
}

function getGeminiModelNames(): string[] {
  const configured = (process.env.GEMINI_MODEL || process.env.GEMINI_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(new Set([
    ...configured,
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
  ]));
}

async function waitForFileActive(fileManager: GoogleAIFileManager, fileName: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let file = await fileManager.getFile(fileName);

  while (file.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      throw new Error('Gemini xử lý video quá lâu, vui lòng thử lại với video ngắn hơn.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    file = await fileManager.getFile(fileName);
  }

  if (file.state !== FileState.ACTIVE) {
    throw new Error(`Gemini không thể xử lý video này (trạng thái: ${file.state}).`);
  }

  return file;
}

function parseRecipeResponse(text: string): RecipeVideoResult | null {
  try {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients.map((v: unknown) => String(v)).filter(Boolean) : [];
    const cookingSteps = Array.isArray(parsed.cookingSteps) ? parsed.cookingSteps.map((v: unknown) => String(v)).filter(Boolean) : [];
    const cookingTime = Number(parsed.cookingTime);

    return {
      dishName: String(parsed.dishName || '').trim(),
      ingredients,
      cookingSteps,
      cookingTime: Number.isFinite(cookingTime) && cookingTime > 0 ? Math.round(cookingTime) : 0,
    };
  } catch {
    return null;
  }
}

export async function analyzeRecipeVideo(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { result: null, errorCode: 'GEMINI_API_KEY_MISSING' };
  }

  const fileManager = new GoogleAIFileManager(apiKey);
  let uploadedFileName: string | undefined;

  try {
    const uploadResponse = await fileManager.uploadFile(input.videoBuffer, {
      mimeType: input.mimeType,
      displayName: `recipe-video-${Date.now()}`,
    });
    uploadedFileName = uploadResponse.file.name;

    const activeFile = await waitForFileActive(fileManager, uploadedFileName);
    const genAI = new GoogleGenerativeAI(apiKey);
    const videoPart = {
      fileData: {
        fileUri: activeFile.uri,
        mimeType: activeFile.mimeType,
      },
    };

    let lastErrorMessage: string | undefined;
    for (const modelName of getGeminiModelNames()) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 3000,
            temperature: 0.2,
          },
        });
        const response = await model.generateContent([PROMPT, videoPart]);
        const parsed = parseRecipeResponse(response.response.text());
        if (parsed && parsed.dishName) {
          return { result: parsed, modelUsed: modelName };
        }
        lastErrorMessage = `Model ${modelName} không trả về JSON hợp lệ hoặc không nhận diện được công thức.`;
      } catch (error: any) {
        const message = error?.message || String(error);
        console.warn(`[Gemini recipe-video error:${modelName}]`, message);
        lastErrorMessage = message;
      }
    }

    return { result: null, errorCode: 'GEMINI_ANALYSIS_FAILED', errorMessage: lastErrorMessage };
  } catch (error: any) {
    return { result: null, errorCode: 'GEMINI_ANALYSIS_FAILED', errorMessage: error?.message || String(error) };
  } finally {
    if (uploadedFileName) {
      fileManager.deleteFile(uploadedFileName).catch(() => {
        // no-op: file sẽ tự hết hạn sau 48h theo chính sách Gemini File API
      });
    }
  }
}
