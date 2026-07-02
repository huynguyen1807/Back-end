import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  createAdminNutritionFact,
  createAdminRecipe,
  createAdminFoodCategory,
  createAdminStorageRule,
  deleteAdminFoodCategory,
  deleteAdminNutritionFact,
  deleteAdminRecipe,
  deleteAdminStorageRule,
  getAdminRecipe,
  listAdminAiGeneratedData,
  listAdminFoodCategories,
  listAdminNutritionFacts,
  listAdminRecipes,
  listAdminStorageRules,
  reviewAdminAiGeneratedData,
  updateAdminFoodCategory,
  updateAdminNutritionFact,
  updateAdminRecipe,
  updateAdminStorageRule
} from '../services/adminDataService';

export const adminListNutritionFacts = async (req: AuthRequest, res: Response) => {
  try {
    const facts = await listAdminNutritionFacts(req.query);
    res.json({ success: true, data: facts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminCreateNutritionFact = async (req: AuthRequest, res: Response) => {
  try {
    const fact = await createAdminNutritionFact(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: fact });
  } catch (error: any) {
    res.status(error.message.includes('required') || error.message.includes('not found') ? 400 : 500)
      .json({ success: false, message: error.message });
  }
};

export const adminUpdateNutritionFact = async (req: AuthRequest, res: Response) => {
  try {
    const fact = await updateAdminNutritionFact(req.user!.userId, req.params.id as string, req.body);
    res.json({ success: true, data: fact });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminDeleteNutritionFact = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteAdminNutritionFact(req.user!.userId, req.params.id as string);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminListRecipes = async (req: AuthRequest, res: Response) => {
  try {
    const recipes = await listAdminRecipes(req.user!.userId, req.query);
    res.json({ success: true, data: recipes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminGetRecipe = async (req: AuthRequest, res: Response) => {
  try {
    const recipe = await getAdminRecipe(req.user!.userId, req.params.id as string);
    res.json({ success: true, data: recipe });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminCreateRecipe = async (req: AuthRequest, res: Response) => {
  try {
    const recipe = await createAdminRecipe(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: recipe });
  } catch (error: any) {
    res.status(error.message.includes('required') ? 400 : 500).json({ success: false, message: error.message });
  }
};

export const adminUpdateRecipe = async (req: AuthRequest, res: Response) => {
  try {
    const recipe = await updateAdminRecipe(req.user!.userId, req.params.id as string, req.body);
    res.json({ success: true, data: recipe });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminDeleteRecipe = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteAdminRecipe(req.user!.userId, req.params.id as string);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminListFoodCategories = async (req: AuthRequest, res: Response) => {
  try {
    const categories = await listAdminFoodCategories(req.query);
    res.json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminCreateFoodCategory = async (req: AuthRequest, res: Response) => {
  try {
    const category = await createAdminFoodCategory(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    res.status(error.message.includes('required') ? 400 : 500).json({ success: false, message: error.message });
  }
};

export const adminUpdateFoodCategory = async (req: AuthRequest, res: Response) => {
  try {
    const category = await updateAdminFoodCategory(req.user!.userId, req.params.id as string, req.body);
    res.json({ success: true, data: category });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminDeleteFoodCategory = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteAdminFoodCategory(req.user!.userId, req.params.id as string);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminListStorageRules = async (req: AuthRequest, res: Response) => {
  try {
    const rules = await listAdminStorageRules(req.query);
    res.json({ success: true, data: rules });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminCreateStorageRule = async (req: AuthRequest, res: Response) => {
  try {
    const rule = await createAdminStorageRule(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: rule });
  } catch (error: any) {
    res.status(error.message.includes('required') ? 400 : 500).json({ success: false, message: error.message });
  }
};

export const adminUpdateStorageRule = async (req: AuthRequest, res: Response) => {
  try {
    const rule = await updateAdminStorageRule(req.user!.userId, req.params.id as string, req.body);
    res.json({ success: true, data: rule });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminDeleteStorageRule = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteAdminStorageRule(req.user!.userId, req.params.id as string);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const adminListAiGeneratedData = async (req: AuthRequest, res: Response) => {
  try {
    const items = await listAdminAiGeneratedData(req.query);
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminReviewAiGeneratedData = async (req: AuthRequest, res: Response) => {
  try {
    const result = await reviewAdminAiGeneratedData(req.user!.userId, req.params.id as string, req.body);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};
