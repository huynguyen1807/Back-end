import { Router } from 'express';

import {
  calculateNutrition,
  getNutritionFacts,
  macroReport
} from '../controllers/nutritionController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.get('/facts', getNutritionFacts);
router.post('/calculate', calculateNutrition);
router.get('/report', macroReport);
router.post('/reports', macroReport);

export default router;
