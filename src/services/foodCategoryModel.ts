/**
 * Lớp suy luận (inference) cho model Naive Bayes đã huấn luyện (`npm run train:food-category-model`).
 *
 * Đây là lớp AI THẬT có trọng số học từ dữ liệu — khác với `foodCategoryValidation.ts` (rule-based,
 * điểm số đặt tay) và `foodCategoryClassifierService.ts`'s Gemini fallback (không có trọng số học
 * từ dữ liệu). Model được nạp tĩnh từ file JSON đã huấn luyện (`../ml/foodCategoryModel.json`),
 * không train lại lúc runtime.
 */
import foodCategoryModel from '../ml/foodCategoryModel.json';
import { predictWithModel, type FoodCategoryNaiveBayesModel } from '../ml/foodCategoryNaiveBayes';
import type { FoodCategoryValidationResult } from '../utils/foodCategoryValidation';

const model = foodCategoryModel as unknown as FoodCategoryNaiveBayesModel;

export type ModelPrediction = {
  categoryName: string;
  confidence: FoodCategoryValidationResult['confidence'];
  probability: number;
  runnerUp?: { categoryName: string; probability: number };
};

function confidenceFromProbability(probability: number): FoodCategoryValidationResult['confidence'] {
  if (probability >= 0.75) return 'HIGH';
  if (probability >= 0.55) return 'MEDIUM';
  if (probability > 0.4) return 'LOW';
  return 'NONE';
}

export function predictFoodCategory(foodName: string): ModelPrediction | null {
  const prediction = predictWithModel(model, foodName);
  if (!prediction) return null;

  return {
    categoryName: prediction.categoryName,
    confidence: confidenceFromProbability(prediction.probability),
    probability: prediction.probability,
    runnerUp: prediction.runnerUp,
  };
}
