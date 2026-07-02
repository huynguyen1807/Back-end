import { Router } from 'express';

import {
  addMissingIngredientsHandler,
  addShoppingListItemHandler,
  completeShoppingListHandler,
  createShoppingListHandler,
  getShoppingListHandler,
  listShoppingListsHandler,
  removeShoppingListItemHandler,
  updateShoppingListItemHandler
} from '../controllers/shoppingListController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.get('/', listShoppingListsHandler);
router.post('/', createShoppingListHandler);
router.post('/missing-ingredients', addMissingIngredientsHandler);
router.get('/:id', getShoppingListHandler);
router.post('/:id/items', addShoppingListItemHandler);
router.patch('/:id/items/:itemId', updateShoppingListItemHandler);
router.delete('/:id/items/:itemId', removeShoppingListItemHandler);
router.patch('/:id/complete', completeShoppingListHandler);

export default router;
