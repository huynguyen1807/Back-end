import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  getFoodItems,
  getFoodItemById,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  markFoodConsumed,
  getFoodCategories,
  getFoodSummary,
} from '../services/foodService';

// GET /api/foods
export const listFoods = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { filter } = req.query; // SAFE | NEAR_EXPIRY | EXPIRED
    const items = await getFoodItems(userId, filter as string);
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/foods/summary
export const foodSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const summary = await getFoodSummary(userId);
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/foods/categories
export const listCategories = async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await getFoodCategories();
    res.json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/foods/:id
export const getFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const item = await getFoodItemById(req.params.id as string, userId);
    res.json({ success: true, data: item });
  } catch (error: any) {
    const status = error.message === 'Food item not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// POST /api/foods
export const createFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const item = await createFoodItem(userId, req.body);
    res.status(201).json({ success: true, data: item });
  } catch (error: any) {
    const status = error.message === 'Missing required fields' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// PUT /api/foods/:id
export const updateFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const item = await updateFoodItem(req.params.id as string, userId, req.body);
    res.json({ success: true, data: item });
  } catch (error: any) {
    const status = error.message === 'Food item not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// DELETE /api/foods/:id
export const deleteFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await deleteFoodItem(req.params.id as string, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    const status = error.message === 'Food item not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// PATCH /api/foods/:id/consume
export const consumeFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await markFoodConsumed(req.params.id as string, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};
