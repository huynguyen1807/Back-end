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
    const { filter, ownerType, householdId } = req.query; // SAFE | NEAR_EXPIRY | EXPIRED | NEED_CHECK
    const items = await getFoodItems(userId, filter as string, ownerType as string, householdId as string);
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const foodSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ownerType, householdId } = req.query;
    const summary = await getFoodSummary(userId, ownerType as string, householdId as string);
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

export const getFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ownerType, householdId } = req.query;
    const item = await getFoodItemById(req.params.id as string, userId, ownerType as string, householdId as string);
    res.json({ success: true, data: item });
  } catch (error: any) {
    const status = error.message === 'Food item not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const createFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ownerType, householdId } = req.query;
    const item = await createFoodItem(userId, req.body, ownerType as string, householdId as string);
    res.status(201).json({ success: true, data: item });
  } catch (error: any) {
    const status = error.message === 'Missing required fields'
      || error.message === 'Category not found'
      || error.message.startsWith('Vị trí lưu trữ')
      ? 400
      : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const updateFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ownerType, householdId } = req.query;
    const item = await updateFoodItem(req.params.id as string, userId, req.body, ownerType as string, householdId as string);
    res.json({ success: true, data: item });
  } catch (error: any) {
    const status = error.message === 'Food item not found'
      ? 404
      : error.message === 'Category not found' || error.message.startsWith('Vị trí lưu trữ')
        ? 400
        : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const deleteFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ownerType, householdId } = req.query;
    const result = await deleteFoodItem(req.params.id as string, userId, ownerType as string, householdId as string);
    res.json({ success: true, ...result });
  } catch (error: any) {
    const status = error.message === 'Food item not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const consumeFood = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ownerType, householdId } = req.query;
    const result = await markFoodConsumed(req.params.id as string, userId, ownerType as string, householdId as string);
    res.json({ success: true, ...result });
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};
