/**
 * Bộ kịch bản đánh giá (evaluation scenarios) cho pipeline sinh công thức AI
 * (`generateAiRecipeDrafts` trong `services/aiRecipeProvider.ts`).
 *
 * Đây KHÔNG phải dataset huấn luyện model (hệ thống không tự train model AI —
 * phần AI dùng Gemini qua prompt engineering). Đây là các kịch bản đầu vào thật
 * dùng để ĐO mức độ tuân thủ của AI đối với các quy tắc nghiệp vụ mà chính prompt
 * yêu cầu (chỉ dùng nguyên liệu có sẵn khi khai ENOUGH_INGREDIENTS, không liệt kê
 * gia vị cơ bản là nguyên liệu thiếu, bám sát calo mục tiêu, tránh trùng lặp…),
 * phục vụ làm bằng chứng nghiên cứu/đánh giá cho báo cáo đồ án.
 */
import type { generateAiRecipeDrafts } from '../services/aiRecipeProvider';

export type RecipeGenInput = Parameters<typeof generateAiRecipeDrafts>[0];

export type RecipeGenEvalScenario = {
  name: string;
  note?: string;
  input: RecipeGenInput;
};

export const RECIPE_GENERATION_EVAL_SCENARIOS: RecipeGenEvalScenario[] = [
  {
    name: 'Đủ nguyên liệu cơ bản (sáng + trưa)',
    note: 'Tủ lạnh có đủ nguyên liệu phổ biến, kỳ vọng ưu tiên ENOUGH_INGREDIENTS.',
    input: {
      priorityFoods: [
        { foodName: 'Trứng gà', quantity: 6, unit: 'quả', status: 'FRESH', daysUntilExpiry: 10, categoryName: 'Egg', calories: 155 },
        { foodName: 'Thịt heo', quantity: 300, unit: 'g', status: 'FRESH', daysUntilExpiry: 3, categoryName: 'Meat', calories: 242 },
        { foodName: 'Cà rốt', quantity: 200, unit: 'g', status: 'FRESH', daysUntilExpiry: 7, categoryName: 'Vegetable', calories: 41 },
        { foodName: 'Rau cải', quantity: 150, unit: 'g', status: 'FRESH', daysUntilExpiry: 4, categoryName: 'Vegetable', calories: 25 },
        { foodName: 'Gạo', quantity: 2, unit: 'kg', status: 'FRESH', daysUntilExpiry: 60, categoryName: 'Dry Food', calories: 130 },
      ],
      allocations: [
        { mealType: 'BREAKFAST', min: 350, max: 550, target: 450 },
        { mealType: 'LUNCH', min: 550, max: 800, target: 650 },
      ],
      preference: { dietType: 'balanced' },
      calorieMin: 1400,
      calorieMax: 2000,
      calorieTarget: 1700,
    },
  },
  {
    name: 'Nguyên liệu sắp hết hạn, cần món tối',
    note: 'Hải sản sắp hỏng, kỳ vọng AI ưu tiên dùng hết trước khi hỏng (priorityReasons).',
    input: {
      priorityFoods: [
        { foodName: 'Tôm sú', quantity: 250, unit: 'g', status: 'NEAR_EXPIRY', daysUntilExpiry: 1, categoryName: 'Seafood', calories: 99 },
        { foodName: 'Mực ống', quantity: 200, unit: 'g', status: 'NEAR_EXPIRY', daysUntilExpiry: 1, categoryName: 'Seafood', calories: 92 },
        { foodName: 'Hành tây', quantity: 2, unit: 'cái', status: 'FRESH', daysUntilExpiry: 14, categoryName: 'Vegetable', calories: 40 },
      ],
      allocations: [
        { mealType: 'DINNER', min: 600, max: 900, target: 750 },
      ],
      preference: { dietType: 'balanced' },
      calorieMin: 1500,
      calorieMax: 2100,
      calorieTarget: 1800,
    },
  },
  {
    name: 'Mục tiêu giảm cân (BMI context)',
    note: 'BMI thừa cân + mục tiêu giảm cân, kỳ vọng calo nằm sát mức min của allocation.',
    input: {
      priorityFoods: [
        { foodName: 'Ức gà', quantity: 400, unit: 'g', status: 'FRESH', daysUntilExpiry: 4, categoryName: 'Meat', calories: 165 },
        { foodName: 'Bông cải xanh', quantity: 300, unit: 'g', status: 'FRESH', daysUntilExpiry: 5, categoryName: 'Vegetable', calories: 34 },
        { foodName: 'Dưa leo', quantity: 200, unit: 'g', status: 'FRESH', daysUntilExpiry: 6, categoryName: 'Vegetable', calories: 15 },
      ],
      allocations: [
        { mealType: 'LUNCH', min: 400, max: 600, target: 450 },
        { mealType: 'DINNER', min: 350, max: 550, target: 400 },
      ],
      preference: { dietType: 'low_carb', goal: 'weight_loss' },
      calorieMin: 1200,
      calorieMax: 1500,
      calorieTarget: 1350,
      bmiProfile: {
        weightKg: 78,
        heightCm: 165,
        age: 29,
        gender: 'female',
        activityLevel: 'light',
        goal: 'weight_loss',
        bmi: 28.7,
        category: 'overweight',
        categoryLabel: 'Thừa cân',
      },
    },
  },
  {
    name: 'Tránh trùng lặp công thức đã có',
    note: 'Đã có "Canh rau cải thịt bằm" trong existingRecipes, kỳ vọng AI không lặp lại đúng công thức này.',
    input: {
      priorityFoods: [
        { foodName: 'Thịt bằm', quantity: 300, unit: 'g', status: 'FRESH', daysUntilExpiry: 3, categoryName: 'Meat', calories: 263 },
        { foodName: 'Rau cải', quantity: 200, unit: 'g', status: 'FRESH', daysUntilExpiry: 4, categoryName: 'Vegetable', calories: 25 },
        { foodName: 'Cà chua', quantity: 150, unit: 'g', status: 'FRESH', daysUntilExpiry: 5, categoryName: 'Vegetable', calories: 18 },
      ],
      allocations: [
        { mealType: 'DINNER', min: 600, max: 850, target: 700 },
      ],
      preference: { dietType: 'balanced' },
      calorieMin: 1500,
      calorieMax: 2000,
      calorieTarget: 1750,
      existingRecipes: [
        {
          recipeName: 'Canh rau cải thịt bằm',
          ingredients: [{ ingredientName: 'Thịt bằm' }, { ingredientName: 'Rau cải' }],
          cookingSteps: ['Nấu nước sôi', 'Cho thịt bằm vào nấu chín', 'Cho rau cải vào nấu chín', 'Nêm nếm vừa ăn'],
          calories: 250,
          tags: ['canh', 'dinner'],
        },
      ],
    },
  },
];
