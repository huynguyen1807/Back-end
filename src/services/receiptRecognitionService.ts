import { GoogleGenerativeAI } from '@google/generative-ai';
import { FoodCategory } from '../models/foodCategory.model';
import { parseReceiptRecognition, ReceiptRecognition } from '../utils/receiptRecognition';

export class ReceiptScanError extends Error {
  constructor(message: string, public status = 502, public code = 'RECEIPT_SCAN_FAILED') {
    super(message);
  }
}

function normalize(value: string) {
  return value.trim().normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ');
}

export async function recognizeReceipt(imageBuffer: Buffer, mimeType: string): Promise<ReceiptRecognition> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_actual_api_key_here') {
    throw new ReceiptScanError('Máy chủ chưa cấu hình Gemini để đọc hóa đơn. Hãy thêm GEMINI_API_KEY vào cấu hình backend rồi khởi động lại.', 503, 'GEMINI_API_KEY_MISSING');
  }

  const categories = await FoodCategory.find({ isActive: true })
    .select('categoryName displayName')
    .sort({ sortOrder: 1 })
    .lean();
  const categoryList = categories.map((category) => ({
    categoryName: category.categoryName,
    displayName: category.displayName,
  }));
  const prompt = `Đọc ảnh hóa đơn mua hàng ở Việt Nam và trích xuất các dòng hàng hóa là thực phẩm/đồ uống có thể lưu trong kho thực phẩm gia đình.
Đây là OCR hóa đơn, không phải nhận diện mã vạch. Bỏ qua mã vạch, mã giao dịch, tổng tiền, tiền khách đưa, tiền thối, khuyến mãi và hàng không phải thực phẩm.
Không suy diễn tên bị che/mờ; nếu không chắc, giữ tên đọc được ngắn gọn và đặt confidence thấp.
Mỗi dòng hàng trả về một phần tử. Không tự cộng các dòng trùng nhau. Số lượng lấy từ cột số lượng; đơn vị chỉ dùng kg, g, ml, l, quả, cái. Nếu hóa đơn không ghi đơn vị, dùng cái.
categoryName phải khớp tên hoặc displayName trong danh sách, nếu không khớp thì để chuỗi rỗng.
purchaseDate chỉ trả về YYYY-MM-DD khi đọc rõ ngày mua, nếu không thì null. Ngày trên hóa đơn Việt Nam thường theo DD/MM/YYYY.
Chỉ trả về JSON đúng cấu trúc:
{"purchaseDate":"YYYY-MM-DD hoặc null","items":[{"foodName":"Tên hàng","quantity":1,"unit":"cái","confidence":0.9,"categoryName":"Tên danh mục"}]}

Danh mục thực phẩm:
${JSON.stringify(categoryList)}

Trả items tối đa 48 dòng.`;
  const models = [...new Set([
    ...(process.env.GEMINI_MODEL || '').split(',').map((item) => item.trim()).filter(Boolean),
    ...(process.env.GEMINI_MODELS || '').split(',').map((item) => item.trim()).filter(Boolean),
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
  ])];
  const genAI = new GoogleGenerativeAI(apiKey);
  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType,
    },
  };
  let lastError: unknown;
  let malformedResponse = false;
  const deadline = Date.now() + 50_000;

  for (const modelName of models) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1000) break;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 5000, temperature: 0.1 },
      });
      const response = await model.generateContent([prompt, imagePart], { timeout: Math.min(20_000, remainingMs) });
      const parsed = parseReceiptRecognition(response.response.text());
      if (parsed) {
        return {
          ...parsed,
          items: parsed.items.map((item) => {
            const category = categories.find((candidate) =>
              normalize(candidate.categoryName) === normalize(item.categoryName || '')
              || normalize(candidate.displayName || '') === normalize(item.categoryName || ''),
            );
            return {
              ...item,
              categoryName: category?.displayName || category?.categoryName,
              categoryId: category ? String(category._id) : undefined,
            };
          }),
        };
      }
      malformedResponse = true;
      lastError = new Error(`Gemini model ${modelName} returned an invalid receipt response.`);
    } catch (error) {
      lastError = error;
      const details = error as { status?: number; code?: string; name?: string };
      console.warn(`[Gemini receipt recognition error:${modelName}] status=${details.status ?? 'unknown'} code=${details.code ?? details.name ?? 'unknown'}`);
    }
  }

  const details = lastError as { status?: number; code?: string; name?: string } | undefined;
  if (Date.now() >= deadline || details?.name === 'AbortError' || details?.name === 'TimeoutError') {
    throw new ReceiptScanError('Gemini đọc hóa đơn quá thời gian. Kiểm tra mạng backend hoặc thử ảnh rõ, thẳng hơn.', 504, 'GEMINI_TIMEOUT');
  }
  if (details?.status === 429 || details?.code === 'RESOURCE_EXHAUSTED') {
    throw new ReceiptScanError('Gemini đang hết quota hoặc bị giới hạn lượt gọi. Kiểm tra quota/billing hoặc cấu hình model khác.', 503, 'GEMINI_QUOTA_EXCEEDED');
  }
  if (details?.status === 401 || details?.status === 403) {
    throw new ReceiptScanError('Gemini từ chối API key hoặc key chưa được cấp quyền dùng model. Kiểm tra cấu hình GEMINI_API_KEY.', 503, 'GEMINI_AUTH_FAILED');
  }
  if (details?.status === 404) {
    throw new ReceiptScanError('Model Gemini đang cấu hình không tồn tại hoặc không được hỗ trợ. Kiểm tra GEMINI_MODEL/GEMINI_MODELS.', 503, 'GEMINI_MODEL_UNAVAILABLE');
  }
  if (malformedResponse) {
    throw new ReceiptScanError('Gemini đã phản hồi nhưng kết quả đọc hóa đơn không đúng định dạng. Hãy thử lại với ảnh rõ hơn.', 502, 'GEMINI_INVALID_RESPONSE');
  }
  throw new ReceiptScanError('Không gọi được model Gemini để đọc hóa đơn. Kiểm tra kết nối backend và cấu hình model.', 503, 'GEMINI_UNAVAILABLE');
}
