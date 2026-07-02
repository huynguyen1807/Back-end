import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  addMissingIngredientsToShoppingList,
  getActiveShoppingLists,
  updateShoppingListItem
} from '../services/shoppingListService';

export const listShoppingLists = async (req: AuthRequest, res: Response) => {
  try {
    const lists = await getActiveShoppingLists(req.user!.userId);
    res.json({ success: true, data: lists });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addMissingIngredients = async (req: AuthRequest, res: Response) => {
  try {
    const list = await addMissingIngredientsToShoppingList(req.user!.userId, req.body.items);
    res.status(201).json({ success: true, data: list });
  } catch (error: any) {
    res
      .status(error.message.includes('required') ? 400 : 500)
      .json({ success: false, message: error.message });
  }
};

export const updateShoppingItem = async (req: AuthRequest, res: Response) => {
  try {
    const list = await updateShoppingListItem(
      req.user!.userId,
      req.params.listId as string,
      req.params.itemId as string,
      req.body
    );
    res.json({ success: true, data: list });
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};
