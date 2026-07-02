import { Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AuthRequest } from '../middleware/authMiddleware';
import { ScanResult } from '../models/scanResult.model';
import { AIPrediction } from '../models/aiPrediction.model';
import { FoodCategory } from '../models/foodCategory.model';
import { StorageLocation } from '../models/storageLocation.model';

// Initialize Google Gemini lazily to avoid import hoisting issues
function getGenAI(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const hasApiKey = apiKey && apiKey !== 'your_actual_api_key_here';
  if (!hasApiKey) {
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
}

// Helpers to auto-provision categories and storage locations
async function getOrCreateCategory(categoryName: string, userId: string): Promise<string> {
  const normalizedName = (categoryName || 'Khác').trim();
  let category = await FoodCategory.findOne({
    categoryName: { $regex: new RegExp(`^${normalizedName}$`, 'i') }
  });

  if (!category) {
    category = await FoodCategory.create({
      categoryName: normalizedName,
      description: 'Tự động tạo bởi AI',
      isActive: true,
      createdBy: userId
    });
  }
  return (category._id as any).toString();
}

async function getOrCreateStorageLocation(storageTypeStr: string, userId: string): Promise<string> {
  let mappedType: 'REFRIGERATOR' | 'OUTSIDE' | 'FREEZER' = 'OUTSIDE';
  let name = 'Bên ngoài';

  const typeLower = (storageTypeStr || '').toLowerCase();
  if (typeLower === 'fridge' || typeLower === 'refrigerator') {
    mappedType = 'REFRIGERATOR';
    name = 'Tủ lạnh';
  } else if (typeLower === 'freezer') {
    mappedType = 'FREEZER';
    name = 'Ngăn đông';
  }

  let location = await StorageLocation.findOne({ userId, storageType: mappedType });
  if (!location) {
    location = await StorageLocation.create({
      ownerType: 'USER',
      userId,
      storageName: name,
      storageType: mappedType,
      isDefault: true,
      isActive: true
    });
  }
  return (location._id as any).toString();
}

/**
 * POST /api/ai/recognize-food
 * Form-data: image (file)
 */
export const recognizeFoodController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ message: 'Vui lòng cung cấp file ảnh thực phẩm' });
      return;
    }

    let resultJson = {
      productName: 'Táo đỏ',
      category: 'Trái cây',
      confidence: 0.90
    };

    const genAI = getGenAI();

    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const imagePart = {
          inlineData: {
            data: req.file.buffer.toString('base64'),
            mimeType: req.file.mimetype
          }
        };

        const prompt = `Hãy nhận diện loại thực phẩm có trong hình ảnh này. 
Trả về một đối tượng JSON duy nhất có dạng:
{
  "productName": "tên thực phẩm bằng tiếng Việt, ví dụ: Cà chua, Chuối, Thịt bò",
  "category": "thể loại thực phẩm bằng tiếng Việt, ví dụ: Trái cây, Rau quả, Thịt, Hải sản, Bơ sữa, Khác",
  "confidence": độ tin cậy từ 0.0 đến 1.0
}
Chú ý: Chỉ trả về nội dung JSON thô, không bọc trong thẻ markdown \`\`\`json hay bất kỳ văn bản giải thích nào khác.`;

        const response = await model.generateContent([prompt, imagePart]);
        const responseText = response.response.text().trim();
        
        // Strip out code block wrappers if Gemini ignored instructions
        const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        resultJson = JSON.parse(cleanJsonText);
      } catch (err: any) {
        console.error('[GEMINI recognize-food error]', err.message);
        // Fallback to default
      }
    } else {
      console.warn('⚠️  [GEMINI API] Running in mock fallback mode for recognizeFood');
      // Simulate slight delay for mock UX
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Save scan result history
    await ScanResult.create({
      userId,
      scanType: 'FOOD_IMAGE',
      productName: resultJson.productName,
      confidenceScore: resultJson.confidence,
      status: 'SUCCESS'
    });

    res.json(resultJson);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi nhận diện thực phẩm', error: error.message });
  }
};

/**
 * POST /api/ai/predict-expiry
 * Body: { productName, storageLocation }
 */
export const predictExpiryController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { productName, storageLocation } = req.body;
    if (!productName) {
      res.status(400).json({ message: 'Thiếu tên sản phẩm' });
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY

    let predictedDays = 7;
    let explanation = 'Bảo quản tốt';

    const genAI = getGenAI();

    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Với thực phẩm là "${productName}" được bảo quản tại vị trí "${storageLocation || 'outside'}" (ví dụ: 'outside' - nhiệt độ phòng, 'fridge' - tủ lạnh, 'freezer' - ngăn đông), hãy dự đoán thời hạn bảo quản (số ngày tối đa thực phẩm còn tươi ngon tính từ ngày hôm nay ${todayStr}). 
Trả về đối tượng JSON dạng:
{
  "predictedDays": số ngày dự đoán (số nguyên lớn hơn hoặc bằng 0),
  "explanation": "Lời giải thích ngắn gọn bằng tiếng Việt về cách bảo quản tốt nhất"
}
Chú ý: Chỉ trả về nội dung JSON thô, không bọc trong thẻ markdown \`\`\`json.`;

        const response = await model.generateContent(prompt);
        const responseText = response.response.text().trim();
        const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJsonText);
        
        predictedDays = parsed.predictedDays ?? 7;
        explanation = parsed.explanation ?? '';
      } catch (err: any) {
        console.error('[GEMINI predict-expiry error]', err.message);
      }
    } else {
      console.warn('⚠️  [GEMINI API] Running in mock fallback mode for predictExpiry');
    }

    const expiryDate = new Date(Date.now() + predictedDays * 24 * 60 * 60 * 1000);
    const expiryDateString = expiryDate.toLocaleDateString('en-GB');

    // Create category and storage location IDs
    const categoryId = await getOrCreateCategory(productName.includes('Chuối') ? 'Trái cây' : 'Rau quả', userId);
    const storageLocationId = await getOrCreateStorageLocation(storageLocation, userId);

    // Save AI prediction to database
    await AIPrediction.create({
      userId,
      foodName: productName,
      categoryId,
      storageLocationId,
      purchaseDate: new Date(),
      predictedExpiryDate: expiryDate,
      estimatedDays: predictedDays,
      confidenceScore: 0.9,
      explanation,
      status: 'ACCEPTED_BY_USER'
    });

    res.json({
      predictedDays,
      expiryDate: expiryDateString,
      explanation
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi dự đoán hạn sử dụng', error: error.message });
  }
};

/**
 * POST /api/ai/storage-suggestions
 * Body: { productName }
 */
export const storageSuggestionsController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productName } = req.body;
    if (!productName) {
      res.status(400).json({ message: 'Thiếu tên sản phẩm' });
      return;
    }

    let suggestions = [
      {
        location: 'fridge' as const,
        description: 'Nên để ở ngăn mát tủ lạnh, bọc kín hơi.',
        temperature: '4-6°C'
      },
      {
        location: 'outside' as const,
        description: 'Bảo quản nơi thoáng mát ngoài tủ lạnh nếu ăn sớm.',
        temperature: '20-25°C'
      }
    ];

    const genAI = getGenAI();

    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Với thực phẩm tên là "${productName}", hãy đưa ra gợi ý cách bảo quản ở các môi trường khác nhau.
Trả về một mảng JSON (tối đa 3 gợi ý) dạng:
[
  {
    "location": "fridge" hoặc "outside" hoặc "freezer",
    "description": "Lời khuyên bảo quản cụ thể tại vị trí này bằng tiếng Việt",
    "temperature": "Khoảng nhiệt độ phù hợp, ví dụ: 2-5°C"
  }
]
Chú ý: Chỉ trả về nội dung JSON thô, không chứa giải thích ngoài lề hay markdown.`;

        const response = await model.generateContent(prompt);
        const responseText = response.response.text().trim();
        const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        suggestions = JSON.parse(cleanJsonText);
      } catch (err: any) {
        console.error('[GEMINI storage-suggestions error]', err.message);
      }
    } else {
      console.warn('⚠️  [GEMINI API] Running in mock fallback mode for storageSuggestions');
    }

    res.json(suggestions);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi lấy gợi ý bảo quản', error: error.message });
  }
};

/**
 * POST /api/ai/meal-suggestions
 * Body: { productName, preferences }
 */
export const mealSuggestionsController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productName, preferences } = req.body;
    if (!productName) {
      res.status(400).json({ message: 'Thiếu tên sản phẩm' });
      return;
    }

    let meals = [
      {
        dishName: `Salad ${productName}`,
        ingredients: [productName, 'Xà lách', 'Dầu ô liu', 'Chanh'],
        cookingTime: 10,
        difficulty: 'easy'
      },
      {
        dishName: `${productName} sốt cà chua`,
        ingredients: [productName, 'Cà chua', 'Hành tây', 'Gia vị'],
        cookingTime: 20,
        difficulty: 'easy'
      }
    ];

    const genAI = getGenAI();

    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prefText = preferences ? ` Sở thích: ${JSON.stringify(preferences)}.` : '';
        const prompt = `Đề xuất 2-3 món ăn chế biến từ nguyên liệu chính là "${productName}".${prefText}
Trả về mảng JSON dạng:
[
  {
    "dishName": "Tên món ăn bằng tiếng Việt",
    "ingredients": ["Nguyên liệu 1", "Nguyên liệu 2"],
    "cookingTime": số phút nấu (số nguyên),
    "difficulty": "easy" hoặc "medium" hoặc "hard"
  }
]
Chú ý: Chỉ trả về nội dung JSON thô, không bọc markdown.`;

        const response = await model.generateContent(prompt);
        const responseText = response.response.text().trim();
        const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        meals = JSON.parse(cleanJsonText);
      } catch (err: any) {
        console.error('[GEMINI meal-suggestions error]', err.message);
      }
    } else {
      console.warn('⚠️  [GEMINI API] Running in mock fallback mode for mealSuggestions');
    }

    res.json(meals);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi gợi ý món ăn', error: error.message });
  }
};

/**
 * POST /api/ai/nutrition-info
 * Body: { productName, quantity }
 */
export const nutritionInfoController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productName, quantity } = req.body;
    const qty = quantity || 100;

    let nutrition = {
      calories: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2
    };

    const genAI = getGenAI();

    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Tính toán hoặc dự đoán thành phần dinh dưỡng cho ${qty}g thực phẩm "${productName}".
Trả về đối tượng JSON dạng:
{
  "calories": số lượng calo (kcal),
  "protein": số gram protein,
  "carbs": số gram tinh bột,
  "fat": số gram chất béo
}
Chú ý: Chỉ trả về JSON thô.`;

        const response = await model.generateContent(prompt);
        const responseText = response.response.text().trim();
        const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        nutrition = JSON.parse(cleanJsonText);
      } catch (err: any) {
        console.error('[GEMINI nutrition-info error]', err.message);
      }
    } else {
      console.warn('⚠️  [GEMINI API] Running in mock fallback mode for nutritionInfo');
    }

    res.json(nutrition);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi lấy thông tin dinh dưỡng', error: error.message });
  }
};

/**
 * POST /api/ai/analyze-recipe-video
 */
export const analyzeRecipeVideoController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({
      dishName: 'Bún chả Hà Nội',
      ingredients: ['Thịt ba chỉ', 'Thịt nạc vai', 'Đu đủ', 'Cà rốt', 'Bún', 'Rau thơm'],
      cookingSteps: [
        'Sơ chế và ướp thịt ba chỉ và thịt nạc băm viên với hành, sả, dầu hào, nước màu.',
        'Làm dưa góp từ đu đủ, cà rốt tỉa hoa bóp muối, giấm, đường.',
        'Nướng thịt trên than hoa cho chín vàng thơm.',
        'Pha nước chấm ấm nóng chua ngọt vừa ăn.',
        'Trình bày bún, thịt nướng, nước chấm và rau sống ăn kèm.'
      ],
      cookingTime: 45
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi phân tích video công thức', error: error.message });
  }
};

/**
 * POST /api/ai/personalized-menu
 */
export const personalizedMenuController = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { inventory } = req.body;
    const itemsText = (inventory || []).join(', ') || 'các thực phẩm có sẵn';

    let recommendations = [
      {
        dishName: 'Món xào thập cẩm',
        ingredients: ['Các rau quả có sẵn', 'Tỏi', 'Gia vị'],
        cookingTime: 15,
        difficulty: 'easy'
      }
    ];

    const genAI = getGenAI();

    if (genAI && inventory && inventory.length > 0) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Dựa trên danh sách các thực phẩm có sẵn này: "${itemsText}", đề xuất 2 thực phẩm có thể nấu kết hợp.
Trả về mảng JSON dạng:
[
  {
    "dishName": "Tên món ăn gợi ý bằng tiếng Việt",
    "ingredients": ["Nguyên liệu cần có"],
    "cookingTime": thời gian nấu (số nguyên phút),
    "difficulty": "easy" hoặc "medium"
  }
]
Chú ý: Chỉ trả về JSON thô.`;

        const response = await model.generateContent(prompt);
        const responseText = response.response.text().trim();
        const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        recommendations = JSON.parse(cleanJsonText);
      } catch (err: any) {
        console.error('[GEMINI personalized-menu error]', err.message);
      }
    } else {
      console.warn('⚠️  [GEMINI API] Running in mock fallback mode for personalizedMenu');
    }

    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi lấy thực đơn cá nhân hóa', error: error.message });
  }
};
