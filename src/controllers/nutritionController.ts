import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  calculateNutritionForIngredients,
  generateNutritionReport,
  listNutritionFacts
} from '../services/nutritionService';

export const calculateNutrition = async (req: AuthRequest, res: Response) => {
  try {
    const ingredients = Array.isArray(req.body.ingredients) ? req.body.ingredients : [];
    const result = await calculateNutritionForIngredients(ingredients);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getNutritionFacts = async (req: AuthRequest, res: Response) => {
  try {
    const facts = await listNutritionFacts(req.query);
    res.json({ success: true, data: facts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const macroReport = async (req: AuthRequest, res: Response) => {
  try {
    const report = await generateNutritionReport(req.user!.userId, {
      ...req.query,
      ...req.body
    });
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
