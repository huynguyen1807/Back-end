import { FoodCategory } from '../models/foodCategory.model';
import { MealPlan } from '../models/mealPlan.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { NutritionReport } from '../models/nutritionReport.model';

type MacroSummary = {
  protein: number;
  carbs: number;
  fat: number;
};

type IngredientInput = {
  ingredientName?: string;
  foodName?: string;
  categoryId?: string;
  quantity?: number;
  unit?: string;
};

const emptyMacro = (): MacroSummary => ({ protein: 0, carbs: 0, fat: 0 });

const round = (value: number) => Math.round((Number(value) || 0) * 10) / 10;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function startOfDay(value: string | Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value: string | Date) {
  const date = startOfDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function resolveFactor(quantity: number, ingredientUnit?: string, factUnit?: string) {
  const qty = Number(quantity) || 0;

  if (!ingredientUnit || !factUnit) return qty;
  if (ingredientUnit.toLowerCase() === factUnit.toLowerCase()) return qty;

  return qty;
}

export function calculateMealTotals(meals: any[] = []) {
  const total = meals.reduce(
    (acc, meal) => {
      acc.calories += Number(meal.calories) || 0;
      acc.macroSummary.protein += Number(meal.macroSummary?.protein) || 0;
      acc.macroSummary.carbs += Number(meal.macroSummary?.carbs) || 0;
      acc.macroSummary.fat += Number(meal.macroSummary?.fat) || 0;
      return acc;
    },
    { calories: 0, macroSummary: emptyMacro() }
  );

  return {
    totalCalories: round(total.calories),
    macroSummary: {
      protein: round(total.macroSummary.protein),
      carbs: round(total.macroSummary.carbs),
      fat: round(total.macroSummary.fat)
    }
  };
}

export async function calculateNutritionForIngredients(ingredients: IngredientInput[] = []) {
  const totals = {
    calories: 0,
    macroSummary: emptyMacro()
  };
  const details = [];
  const unmatched = [];

  for (const ingredient of ingredients) {
    const foodName = (ingredient.ingredientName || ingredient.foodName || '').trim();
    const quantity = Number(ingredient.quantity) || 0;

    if (!foodName || quantity <= 0) continue;

    const query: any = {
      foodName: new RegExp(`^${escapeRegex(foodName)}$`, 'i'),
      status: 'OFFICIAL'
    };
    if (ingredient.categoryId) query.categoryId = ingredient.categoryId;

    let fact = await NutritionFact.findOne(query).sort({ source: 1 });

    if (!fact && ingredient.categoryId) {
      fact = await NutritionFact.findOne({
        foodName: new RegExp(`^${escapeRegex(foodName)}$`, 'i'),
        status: 'OFFICIAL'
      }).sort({ source: 1 });
    }

    if (!fact) {
      unmatched.push({
        ingredientName: foodName,
        quantity,
        unit: ingredient.unit
      });
      continue;
    }

    const factor = resolveFactor(quantity, ingredient.unit, fact.unit);
    const calories = factor * (Number(fact.caloriesPerUnit) || 0);
    const protein = factor * (Number(fact.protein) || 0);
    const carbs = factor * (Number(fact.carbs) || 0);
    const fat = factor * (Number(fact.fat) || 0);

    totals.calories += calories;
    totals.macroSummary.protein += protein;
    totals.macroSummary.carbs += carbs;
    totals.macroSummary.fat += fat;

    details.push({
      ingredientName: foodName,
      quantity,
      unit: ingredient.unit,
      nutritionFactId: fact._id,
      calories: round(calories),
      macroSummary: {
        protein: round(protein),
        carbs: round(carbs),
        fat: round(fat)
      }
    });
  }

  return {
    calories: round(totals.calories),
    macroSummary: {
      protein: round(totals.macroSummary.protein),
      carbs: round(totals.macroSummary.carbs),
      fat: round(totals.macroSummary.fat)
    },
    details,
    unmatched
  };
}

export async function resolveCategory(categoryId?: string, categoryName?: string, createdBy?: string) {
  if (categoryId) {
    const category = await FoodCategory.findById(categoryId);
    if (!category) throw new Error('Category not found');
    return category._id;
  }

  const name = categoryName?.trim();
  if (!name) throw new Error('categoryId or categoryName is required');

  const category = await FoodCategory.findOneAndUpdate(
    { categoryName: new RegExp(`^${escapeRegex(name)}$`, 'i') },
    { $setOnInsert: { categoryName: name, isActive: true, createdBy } },
    { new: true, upsert: true }
  );

  return category._id;
}

export async function listNutritionFacts(query: any = {}) {
  const filter: any = {};

  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.q) filter.foodName = new RegExp(escapeRegex(String(query.q)), 'i');

  return NutritionFact.find(filter)
    .populate('categoryId', 'categoryName')
    .sort({ foodName: 1 });
}

export async function generateNutritionReport(userId: string, data: any = {}) {
  const periodType = data.periodType === 'MONTH' ? 'MONTH' : 'WEEK';
  const startDate = startOfDay(data.startDate || new Date());
  const defaultDays = periodType === 'MONTH' ? 30 : 7;
  const endDate = data.endDate ? endOfDay(data.endDate) : endOfDay(addDays(startDate, defaultDays - 1));

  const plans = await MealPlan.find({
    userId,
    planDate: { $gte: startDate, $lte: endDate }
  }).sort({ planDate: 1 });

  const dailyMap = new Map<string, any>();
  for (const plan of plans) {
    const key = startOfDay(plan.planDate).toISOString();
    const existing = dailyMap.get(key) || {
      date: startOfDay(plan.planDate),
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    };

    existing.calories += Number(plan.totalCalories) || 0;
    existing.protein += Number(plan.macroSummary?.protein) || 0;
    existing.carbs += Number(plan.macroSummary?.carbs) || 0;
    existing.fat += Number(plan.macroSummary?.fat) || 0;
    dailyMap.set(key, existing);
  }

  const dailySummary = Array.from(dailyMap.values()).map((item) => ({
    date: item.date,
    calories: round(item.calories),
    protein: round(item.protein),
    carbs: round(item.carbs),
    fat: round(item.fat)
  }));

  const totals = dailySummary.reduce(
    (acc, day) => {
      acc.calories += day.calories;
      acc.protein += day.protein;
      acc.carbs += day.carbs;
      acc.fat += day.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const dayCount = Math.max(
    1,
    Math.floor((startOfDay(endDate).getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  const reportData = {
    userId,
    householdId: data.householdId,
    periodType,
    startDate,
    endDate,
    totalCalories: round(totals.calories),
    averageCalories: round(totals.calories / dayCount),
    totalProtein: round(totals.protein),
    totalCarbs: round(totals.carbs),
    totalFat: round(totals.fat),
    dailySummary,
    generatedAt: new Date()
  };

  return NutritionReport.findOneAndUpdate(
    { userId, periodType, startDate },
    reportData,
    { new: true, upsert: true }
  );
}
