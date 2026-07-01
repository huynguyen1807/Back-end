import { Router } from 'express';

import {
  adminCreateNutritionFact,
  adminCreateRecipe,
  adminCreateFoodCategory,
  adminCreateStorageRule,
  adminDeleteFoodCategory,
  adminDeleteNutritionFact,
  adminDeleteRecipe,
  adminDeleteStorageRule,
  adminGetRecipe,
  adminListAiGeneratedData,
  adminListFoodCategories,
  adminListNutritionFacts,
  adminListRecipes,
  adminListStorageRules,
  adminReviewAiGeneratedData,
  adminUpdateFoodCategory,
  adminUpdateNutritionFact,
  adminUpdateRecipe,
  adminUpdateStorageRule
} from '../controllers/adminDataController';
import { protect, restrictTo } from '../middleware/authMiddleware';

const router = Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/nutrition-facts', adminListNutritionFacts);
router.post('/nutrition-facts', adminCreateNutritionFact);
router.put('/nutrition-facts/:id', adminUpdateNutritionFact);
router.delete('/nutrition-facts/:id', adminDeleteNutritionFact);

router.get('/food-categories', adminListFoodCategories);
router.post('/food-categories', adminCreateFoodCategory);
router.put('/food-categories/:id', adminUpdateFoodCategory);
router.delete('/food-categories/:id', adminDeleteFoodCategory);

router.get('/storage-rules', adminListStorageRules);
router.post('/storage-rules', adminCreateStorageRule);
router.put('/storage-rules/:id', adminUpdateStorageRule);
router.delete('/storage-rules/:id', adminDeleteStorageRule);

router.get('/ai-generated-data', adminListAiGeneratedData);
router.patch('/ai-generated-data/:id/review', adminReviewAiGeneratedData);

router.get('/recipes', adminListRecipes);
router.post('/recipes', adminCreateRecipe);
router.get('/recipes/:id', adminGetRecipe);
router.put('/recipes/:id', adminUpdateRecipe);
router.delete('/recipes/:id', adminDeleteRecipe);

export default router;
