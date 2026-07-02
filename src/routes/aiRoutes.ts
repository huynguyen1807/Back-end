import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware';
import {
  recognizeFoodController,
  predictExpiryController,
  storageSuggestionsController,
  mealSuggestionsController,
  nutritionInfoController,
  analyzeRecipeVideoController,
  personalizedMenuController
} from '../controllers/aiController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const aiRouter = Router();

// Protect all AI routes with authentication middleware
aiRouter.use(protect);

aiRouter.post('/recognize-food', upload.single('image'), recognizeFoodController);
aiRouter.post('/predict-expiry', predictExpiryController);
aiRouter.post('/storage-suggestions', storageSuggestionsController);
aiRouter.post('/meal-suggestions', mealSuggestionsController);
aiRouter.post('/nutrition-info', nutritionInfoController);
aiRouter.post('/analyze-recipe-video', upload.single('video'), analyzeRecipeVideoController);
aiRouter.post('/personalized-menu', personalizedMenuController);

export default aiRouter;
