import { Router } from 'express';

import {
  addMeal,
  createPlan,
  dailyPlanSummary,
  deletePlan,
  extractVideoRecipe,
  generatePlan,
  getPlan,
  listPlans,
  updatePlan
} from '../controllers/mealPlanController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.get('/summary', dailyPlanSummary);
router.post('/generate', generatePlan);
router.post('/video-extract', extractVideoRecipe);
router.post('/meals', addMeal);
router.get('/', listPlans);
router.post('/', createPlan);
router.get('/:id', getPlan);
router.put('/:id', updatePlan);
router.delete('/:id', deletePlan);

export default router;
