import { Router } from 'express';

import {
  addMissingIngredients,
  listShoppingLists,
  updateShoppingItem
} from '../controllers/shoppingListController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.get('/', listShoppingLists);
router.post('/missing-ingredients', addMissingIngredients);
router.patch('/:listId/items/:itemId', updateShoppingItem);

export default router;
