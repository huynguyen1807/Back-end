import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  createRecipe,
  deleteRecipe,
  dismissRecipeRecommendation,
  getRecipeById,
  listRecipes,
  updateRecipe
} from '../services/recipeService';

export const dismissRecipeRecommendationItem = async (req: AuthRequest, res: Response) => {
  try {
    const result = await dismissRecipeRecommendation(req.params.id as string, req.user!.userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const listRecipeItems = async (req: AuthRequest, res: Response) => {
  try {
    const recipes = await listRecipes(req.user!.userId, req.query);
    res.json({ success: true, data: recipes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRecipeItem = async (req: AuthRequest, res: Response) => {
  try {
    const recipe = await getRecipeById(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: recipe });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const createRecipeItem = async (req: AuthRequest, res: Response) => {
  try {
    const recipe = await createRecipe(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: recipe });
  } catch (error: any) {
    res.status(error.message.includes('required') ? 400 : 500).json({ success: false, message: error.message });
  }
};

export const updateRecipeItem = async (req: AuthRequest, res: Response) => {
  try {
    const recipe = await updateRecipe(req.params.id as string, req.user!.userId, req.body);
    res.json({ success: true, data: recipe });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const deleteRecipeItem = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteRecipe(req.params.id as string, req.user!.userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};
