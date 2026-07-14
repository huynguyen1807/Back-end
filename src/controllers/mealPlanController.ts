import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  createMealPlan,
  deleteMealPlan,
  extractRecipeFromVideo,
  generateDailyMealPlan,
  getMealPlanById,
  getMealPlanSummary,
  listMealPlans,
  updateMealPlan
} from '../services/mealPlanService';

function isMealPlanBadRequest(message = '') {
  return (
    message.includes('required') ||
    message.includes('not found') ||
    message.includes('Not enough') ||
    message.includes('not compatible')
  );
}

export const listPlans = async (req: AuthRequest, res: Response) => {
  try {
    const plans = await listMealPlans(req.user!.userId, req.query);
    res.json({ success: true, data: plans });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const dailyPlanSummary = async (req: AuthRequest, res: Response) => {
  try {
    const summary = await getMealPlanSummary(req.user!.userId, (req.query.date as string) || new Date());
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const generatePlan = async (req: AuthRequest, res: Response) => {
  try {
    const result = await generateDailyMealPlan(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.message.includes('required') ? 400 : 500).json({ success: false, message: error.message });
  }
};

export const extractVideoRecipe = async (req: AuthRequest, res: Response) => {
  try {
    const result = await extractRecipeFromVideo(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    const message = error?.message || 'unknown error';
    const status = error?.name === 'UnsupportedVideoPlatformError'
      || message.includes('required')
      || message.includes('not supported')
      ? 400
      : 500;
    res.status(status).json({ success: false, message });
  }
};

export const getPlan = async (req: AuthRequest, res: Response) => {
  try {
    const plan = await getMealPlanById(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: plan });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};

export const createPlan = async (req: AuthRequest, res: Response) => {
  try {
    const plan = await createMealPlan(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: plan });
  } catch (error: any) {
    res.status(isMealPlanBadRequest(error.message) ? 400 : 500)
      .json({ success: false, message: error.message });
  }
};

export const updatePlan = async (req: AuthRequest, res: Response) => {
  try {
    const plan = await updateMealPlan(req.params.id as string, req.user!.userId, req.body);
    res.json({ success: true, data: plan });
  } catch (error: any) {
    if (error.message.includes('Meal plan not found')) {
      res.status(404).json({ success: false, message: error.message });
      return;
    }
    res.status(isMealPlanBadRequest(error.message) ? 400 : 500).json({ success: false, message: error.message });
  }
};

export const deletePlan = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteMealPlan(req.params.id as string, req.user!.userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message });
  }
};
