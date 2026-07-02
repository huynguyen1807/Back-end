import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  addShoppingListItem,
  completeShoppingList,
  createShoppingList,
  getShoppingListById,
  getShoppingLists,
  removeShoppingListItem,
  updateShoppingListItem
} from '../services/shoppingListService';

function getStatusCode(message: string) {
  if (
    message.includes('required') ||
    message.includes('invalid') ||
    message.includes('must be') ||
    message.includes('greater than')
  ) {
    return 400;
  }

  if (message.includes('not found')) {
    return 404;
  }

  if (message.includes('permission')) {
    return 403;
  }

  return 500;
}

function handleShoppingListError(res: Response, error: any) {
  const message = error.message ?? 'Server error';
  res.status(getStatusCode(message)).json({ success: false, message });
}

export const listShoppingListsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const lists = await getShoppingLists(req.user!.userId, req.query.status as any);
    res.json({ success: true, data: lists });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};

export const createShoppingListHandler = async (req: AuthRequest, res: Response) => {
  try {
    const list = await createShoppingList(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: list });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};

export const getShoppingListHandler = async (req: AuthRequest, res: Response) => {
  try {
    const list = await getShoppingListById(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: list });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};

export const addShoppingListItemHandler = async (req: AuthRequest, res: Response) => {
  try {
    const item = await addShoppingListItem(req.params.id as string, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: item });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};

export const updateShoppingListItemHandler = async (req: AuthRequest, res: Response) => {
  try {
    const item = await updateShoppingListItem(
      req.params.id as string,
      req.params.itemId as string,
      req.user!.userId,
      req.body
    );

    res.json({ success: true, data: item });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};

export const removeShoppingListItemHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await removeShoppingListItem(
      req.params.id as string,
      req.params.itemId as string,
      req.user!.userId
    );

    res.json({ success: true, ...result });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};

export const completeShoppingListHandler = async (req: AuthRequest, res: Response) => {
  try {
    const list = await completeShoppingList(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: list });
  } catch (error: any) {
    handleShoppingListError(res, error);
  }
};
