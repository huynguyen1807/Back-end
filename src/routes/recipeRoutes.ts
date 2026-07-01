import { Router } from 'express';

import {
  getRecipeItem,
  listRecipeItems
} from '../controllers/recipeController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.get('/', listRecipeItems);
router.get('/:id', getRecipeItem);

export default router;
