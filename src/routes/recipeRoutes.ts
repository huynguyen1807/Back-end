import { Router } from 'express';

import {
  createRecipeItem,
  deleteRecipeItem,
  getRecipeItem,
  listRecipeItems,
  updateRecipeItem
} from '../controllers/recipeController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.get('/', listRecipeItems);
router.post('/', createRecipeItem);
router.get('/:id', getRecipeItem);
router.put('/:id', updateRecipeItem);
router.delete('/:id', deleteRecipeItem);

export default router;
