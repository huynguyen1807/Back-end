import { MealPlan } from '../models/mealPlan.model';
import { FoodItem } from '../models/foodItem.model';
import { AIGeneratedData } from '../models/aiGeneratedData.model';
import { Recipe } from '../models/recipe.model';
import { UserPreference } from '../models/userPreference.model';
import { VideoRecipeSource } from '../models/videoRecipeSource.model';
import {
  calculateMealTotals,
  calculateNutritionForIngredients,
  endOfDay,
  resolveNutritionForFood,
  startOfDay
} from './nutritionService';
import {
  AiRecipeDraft,
  AvailabilityStatus,
  generateAiRecipeDrafts,
  MealCalorieAllocation
} from './aiRecipeProvider';
import {
  extractRecipeFromVideoUrl,
  UnsupportedVideoPlatformError
} from './videoRecipeExtractor';
import { buildOwnerQuery, getInventoryOwnerContext } from './foodService';
import { normalizeFoodText } from '../utils/foodCategoryValidation';

type InventoryPriorityFood = {
  _id: any;
  foodName: string;
  quantity: number;
  unit: string;
  status: string;
  expiryDate: Date;
  daysUntilExpiry: number;
  categoryName?: string;
  categoryId?: any;
  calories?: number;
  macroSummary?: {
    protein: number;
    carbs: number;
    fat: number;
  };
};

type RecipeAvailabilityAnalysis = {
  status: AvailabilityStatus;
  matchedIngredients: string[];
  missingIngredients: Array<{
    ingredientName: string;
    quantity: number;
    unit: string;
    categoryId?: any;
    categoryName?: string;
  }>;
};

type UsedFoodInput = {
  foodItemId?: any;
  foodName?: string;
  quantityUsed?: number;
  quantity?: number;
  unit?: string;
  calories?: number;
  macroSummary?: {
    protein?: number;
    carbs?: number;
    fat?: number;
  };
};

function normalizeRecipeId(value: any) {
  const raw = value?._id || value;
  if (!raw) return undefined;

  const recipeId = String(raw).trim();
  if (!recipeId || recipeId === 'undefined' || recipeId === 'null') return undefined;
  return recipeId;
}

function normalizeFoodItemId(value: any) {
  const raw = value?._id || value;
  if (!raw) return undefined;
  const foodItemId = String(raw).trim();
  if (!foodItemId || foodItemId === 'undefined' || foodItemId === 'null') return undefined;
  return foodItemId;
}

function normalizeUnit(value?: string) {
  const rawUnit = String(value || '').trim();
  const unit = rawUnit.toLowerCase();
  const normalizedText = normalizeFoodText(rawUnit);
  if (['kg', 'kilogram', 'kilograms'].includes(unit)) return 'kg';
  if (['g', 'gram', 'grams'].includes(unit)) return 'g';
  if (['l', 'liter', 'litre', 'liters', 'litres'].includes(unit)) return 'l';
  if (['ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres'].includes(unit)) return 'ml';
  if (['item', 'piece', 'pieces', 'cai', 'qua', 'trai'].includes(normalizedText)) return 'item';
  if (['serving', 'portion', 'phan'].includes(normalizedText)) return 'serving';
  return unit;
}

function getUnitFamily(unit?: string) {
  const normalized = normalizeUnit(unit);
  if (normalized === 'kg' || normalized === 'g') return 'mass';
  if (normalized === 'l' || normalized === 'ml') return 'volume';
  if (normalized === 'item') return 'count';
  if (normalized === 'serving') return 'serving';
  return normalized || 'unknown';
}

function convertQuantity(quantity: number, fromUnit?: string, toUnit?: string) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  const value = Number(quantity) || 0;
  if (!from || !to || from === to) return value;

  if (getUnitFamily(from) !== getUnitFamily(to)) return null;

  if (from === 'kg' && to === 'g') return value * 1000;
  if (from === 'g' && to === 'kg') return value / 1000;
  if (from === 'l' && to === 'ml') return value * 1000;
  if (from === 'ml' && to === 'l') return value / 1000;

  return value;
}

function roundTwo(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function mealInventorySignature(meal: any) {
  return JSON.stringify(
    (meal.usedFoods || [])
      .map((item: any) => ({
        foodItemId: normalizeFoodItemId(item.foodItemId),
        quantityUsed: roundTwo(Number(item.quantityUsed) || 0),
        unit: normalizeUnit(item.unit),
      }))
      .filter((item: any) => item.foodItemId && item.quantityUsed > 0)
      .sort((a: any, b: any) => String(a.foodItemId).localeCompare(String(b.foodItemId)))
  );
}

function mealFingerprint(meal: any) {
  return JSON.stringify({
    mealType: meal?.mealType || '',
    recipeId: normalizeRecipeId(meal?.recipeId) || '',
    recipeName: normalize(meal?.recipeName || ''),
    scheduledTime: meal?.scheduledTime || '',
    inventory: mealInventorySignature(meal),
  });
}

function addMacros(a: any = {}, b: any = {}) {
  return {
    protein: roundTwo((Number(a.protein) || 0) + (Number(b.protein) || 0)),
    carbs: roundTwo((Number(a.carbs) || 0) + (Number(b.carbs) || 0)),
    fat: roundTwo((Number(a.fat) || 0) + (Number(b.fat) || 0)),
  };
}

async function resolveUsedFoods(meal: any, ownerQuery: any = {}): Promise<any[]> {
  const inputs: UsedFoodInput[] = Array.isArray(meal.usedFoods) ? meal.usedFoods : [];
  const resolved = [];

  for (const input of inputs) {
    const foodItemId = normalizeFoodItemId(input.foodItemId);
    const quantityUsed = Number(input.quantityUsed ?? input.quantity) || 0;
    if (!foodItemId || quantityUsed <= 0) continue;

    const food = await FoodItem.findOne({ _id: foodItemId, ...ownerQuery, isDeleted: false });
    if (!food) throw new Error(`Food item not found: ${foodItemId}`);

    const unit = input.unit || food.unit;
    const converted = convertQuantity(quantityUsed, unit, food.unit);
    if (converted === null) {
      throw new Error(`Unit ${unit} is not compatible with inventory unit ${food.unit} for ${food.foodName}`);
    }

    const nutrition = await resolveNutritionForFood({
      foodName: food.foodName,
      categoryId: getCategoryId(food.categoryId),
      quantity: quantityUsed,
      unit,
      nutritionSnapshot: food.nutritionSnapshot,
    });

    resolved.push({
      foodItemId,
      foodName: input.foodName?.trim() || food.foodName,
      quantityUsed: roundTwo(quantityUsed),
      unit,
      calories: Number(input.calories) > 0 ? roundTwo(Number(input.calories)) : nutrition.calories,
      macroSummary: hasMacroValue(input.macroSummary)
        ? {
            protein: roundTwo(Number(input.macroSummary?.protein) || 0),
            carbs: roundTwo(Number(input.macroSummary?.carbs) || 0),
            fat: roundTwo(Number(input.macroSummary?.fat) || 0),
          }
        : nutrition.macroSummary,
    });
  }

  return resolved;
}

async function applyFoodUsage(usedFoods: any[] = [], direction: 'consume' | 'restore', ownerQuery: any = {}) {
  for (const usage of usedFoods) {
    const foodItemId = normalizeFoodItemId(usage.foodItemId);
    const quantityUsed = Number(usage.quantityUsed) || 0;
    if (!foodItemId || quantityUsed <= 0) continue;

    const food = await FoodItem.findOne({ _id: foodItemId, ...ownerQuery, isDeleted: false });
    if (!food) throw new Error(`Food item not found: ${foodItemId}`);

    const converted = convertQuantity(quantityUsed, usage.unit, food.unit);
    if (converted === null) {
      throw new Error(`Unit ${usage.unit} is not compatible with inventory unit ${food.unit} for ${food.foodName}`);
    }

    if (direction === 'consume') {
      const currentQuantity = Number(food.quantity) || 0;
      if (converted > currentQuantity + 1e-9) {
        throw new Error(`Not enough ${food.foodName}. Available ${currentQuantity} ${food.unit}, requested ${quantityUsed} ${usage.unit}.`);
      }

      const nextQuantity = roundTwo(Math.max(0, currentQuantity - converted));
      food.quantity = nextQuantity;
      food.isConsumed = nextQuantity <= 0;
      food.consumedAt = nextQuantity <= 0 ? new Date() : undefined;
    } else {
      const nextQuantity = roundTwo((Number(food.quantity) || 0) + converted);
      food.quantity = nextQuantity;
      food.isConsumed = false;
      food.consumedAt = undefined;
    }

    await food.save();
  }
}

async function applyMealInventoryTransitions(oldMeals: any[] = [], newMeals: any[] = [], ownerQuery: any = {}) {
  const nextMeals = newMeals.map((meal) => ({ ...meal }));
  const usedOldIndexes = new Set<number>();
  const matchedOldMeals: any[] = [];

  const findMatchingOldMealIndex = (meal: any) => {
    const fingerprint = mealFingerprint(meal);
    return oldMeals.findIndex((oldMeal, oldIndex) => {
      return !usedOldIndexes.has(oldIndex) && mealFingerprint(oldMeal) === fingerprint;
    });
  };

  for (let index = 0; index < nextMeals.length; index++) {
    const meal = nextMeals[index] as any;
    const oldIndex = findMatchingOldMealIndex(meal);
    const oldMeal = oldIndex >= 0 ? (oldMeals[oldIndex] as any) : null;

    if (oldIndex >= 0) usedOldIndexes.add(oldIndex);
    matchedOldMeals[index] = oldMeal;
  }

  for (let index = 0; index < nextMeals.length; index++) {
    const meal = nextMeals[index] as any;
    const oldMeal = matchedOldMeals[index];
    const oldApplied = oldMeal?.status === 'COMPLETED' && oldMeal?.inventoryApplied;

    if (oldApplied && meal.status !== 'COMPLETED') {
      await applyFoodUsage(oldMeal.usedFoods || [], 'restore', ownerQuery);
      meal.inventoryApplied = false;
    }
  }

  for (let index = 0; index < oldMeals.length; index++) {
    const oldMeal = oldMeals[index] as any;
    const oldApplied = oldMeal?.status === 'COMPLETED' && oldMeal?.inventoryApplied;
    if (!usedOldIndexes.has(index) && oldApplied) {
      await applyFoodUsage(oldMeal.usedFoods || [], 'restore', ownerQuery);
    }
  }

  for (let index = 0; index < nextMeals.length; index++) {
    const meal = nextMeals[index] as any;
    const oldMeal = matchedOldMeals[index];
    const oldApplied = oldMeal?.status === 'COMPLETED' && oldMeal?.inventoryApplied;
    const sameCompletedMeal = oldApplied && meal.status === 'COMPLETED';

    if (meal.status === 'COMPLETED') {
      if (!sameCompletedMeal && (meal.usedFoods || []).length) {
        await applyFoodUsage(meal.usedFoods, 'consume', ownerQuery);
      }
      meal.inventoryApplied = Boolean((meal.usedFoods || []).length);
    } else {
      meal.inventoryApplied = false;
    }
  }

  return nextMeals;
}

async function resolveMealPayload(meal: any, ownerQuery: any = {}) {
  const recipeId = normalizeRecipeId(meal.recipeId);
  const usedFoods = await resolveUsedFoods(meal, ownerQuery);
  const payload: any = {
    mealType: meal.mealType,
    recipeId,
    recipeName: meal.recipeName,
    imageUrl: meal.imageUrl,
    scheduledTime: meal.scheduledTime,
    calories: Number(meal.calories) || 0,
    macroSummary: meal.macroSummary || { protein: 0, carbs: 0, fat: 0 },
    status: meal.status || 'PENDING',
    usedFoodItemIds: usedFoods.length
      ? usedFoods.map((item) => item.foodItemId)
      : Array.isArray(meal.usedFoodItemIds)
        ? meal.usedFoodItemIds.map(normalizeFoodItemId).filter(Boolean)
        : [],
    usedFoods,
    inventoryApplied: Boolean(meal.inventoryApplied)
  };

  if (!payload.mealType) throw new Error('mealType is required');

  if (recipeId) {
    try {
      const recipe = await Recipe.findById(recipeId);
      if (recipe?.isActive) {
        payload.recipeName = payload.recipeName || recipe.recipeName;
        payload.imageUrl = payload.imageUrl || recipe.imageUrl;
        payload.calories = Number(meal.calories) > 0
          ? Number(meal.calories)
          : Number(recipe.calories) || 0;
        payload.macroSummary = hasMacroValue(meal.macroSummary)
          ? meal.macroSummary
          : recipe.macroSummary || { protein: 0, carbs: 0, fat: 0 };
      } else if (payload.recipeName?.trim()) {
        delete payload.recipeId;
      } else {
        throw new Error('Recipe not found');
      }
    } catch (error) {
      if (!payload.recipeName?.trim()) throw new Error('Recipe not found');
      delete payload.recipeId;
    }
  }

  if (usedFoods.length) {
    const nutritionTotals = usedFoods.reduce(
      (acc, item) => ({
        calories: roundTwo(acc.calories + (Number(item.calories) || 0)),
        macroSummary: addMacros(acc.macroSummary, item.macroSummary),
      }),
      { calories: 0, macroSummary: { protein: 0, carbs: 0, fat: 0 } }
    );

    payload.calories = nutritionTotals.calories;
    payload.macroSummary = nutritionTotals.macroSummary;
  }

  if (!payload.recipeName?.trim()) throw new Error('recipeName is required');
  payload.recipeName = payload.recipeName.trim();

  return payload;
}

async function buildMealPlanPayload(userId: string, data: any, ownerQuery: any = {}) {
  if (!data.planDate) throw new Error('planDate is required');

  const meals = Array.isArray(data.meals)
    ? await Promise.all(data.meals.map((meal: any) => resolveMealPayload(meal, ownerQuery)))
    : [];
  const totals = calculateMealTotals(meals);

  return {
    userId,
    inventoryOwnerType: data.ownerType === 'HOUSEHOLD' ? 'HOUSEHOLD' : 'USER',
    householdId: data.ownerType === 'HOUSEHOLD' ? data.householdId : undefined,
    planDate: startOfDay(data.planDate),
    goal: data.goal,
    totalCalories: totals.totalCalories,
    macroSummary: totals.macroSummary,
    meals,
    generatedBy: data.generatedBy || 'USER',
    note: data.note
  };
}

function getStoredPlanOwnerQuery(plan: any) {
  return plan.inventoryOwnerType === 'HOUSEHOLD' && plan.householdId
    ? { ownerType: 'HOUSEHOLD', householdId: plan.householdId }
    : { ownerType: 'USER', userId: plan.userId };
}

async function backfillMealPlanNutrition(plan: any) {
  const ownerQuery = getStoredPlanOwnerQuery(plan);
  const resolvedMeals = await Promise.all(
    (plan.meals || []).map((meal: any) => resolveMealPayload(meal.toObject?.() || meal, ownerQuery)),
  );
  const totals = calculateMealTotals(resolvedMeals);
  const needsUpdate =
    Number(plan.totalCalories) !== totals.totalCalories ||
    !hasMacroValue(plan.macroSummary) ||
    resolvedMeals.some((meal: any, index: number) =>
      Number(meal.calories) !== Number(plan.meals?.[index]?.calories) ||
      (hasMacroValue(meal.macroSummary) && !hasMacroValue(plan.meals?.[index]?.macroSummary))
    );

  if (needsUpdate) {
    plan.meals = resolvedMeals;
    plan.totalCalories = totals.totalCalories;
    plan.macroSummary = totals.macroSummary;
    await plan.save();
  }

  return plan;
}

export async function listMealPlans(userId: string, query: any = {}) {
  const filter: any = { userId };

  if (query.ownerType || query.householdId) {
    const context = await getInventoryOwnerContext(userId, query.ownerType, query.householdId);
    if (context.ownerType === 'HOUSEHOLD') {
      filter.householdId = context.householdId;
      filter.inventoryOwnerType = { $in: ['HOUSEHOLD', null] };
    } else {
      filter.$or = [
        { inventoryOwnerType: 'USER' },
        { inventoryOwnerType: { $exists: false }, householdId: { $exists: false } },
      ];
    }
  }

  if (query.date) {
    filter.planDate = { $gte: startOfDay(query.date), $lte: endOfDay(query.date) };
  } else if (query.startDate || query.endDate) {
    filter.planDate = {};
    if (query.startDate) filter.planDate.$gte = startOfDay(query.startDate);
    if (query.endDate) filter.planDate.$lte = endOfDay(query.endDate);
  }

  const plans = await MealPlan.find(filter).sort({ planDate: 1, updatedAt: -1 });
  await Promise.all(plans.map(backfillMealPlanNutrition));
  return MealPlan.populate(plans, [
    { path: 'meals.recipeId', select: 'recipeName imageUrl calories macroSummary' },
    { path: 'meals.usedFoods.foodItemId', select: 'foodName quantity unit status' },
  ]);
}

export async function getMealPlanById(planId: string, userId: string) {
  const plan = await MealPlan.findOne({ _id: planId, userId })
    .populate('meals.recipeId', 'recipeName imageUrl calories macroSummary')
    .populate('meals.usedFoods.foodItemId', 'foodName quantity unit status');

  if (!plan) throw new Error('Meal plan not found');
  return plan;
}

export async function createMealPlan(userId: string, data: any) {
  const context = await getInventoryOwnerContext(userId, data.ownerType, data.householdId);
  const ownerQuery = buildOwnerQuery(context);
  const payload = await buildMealPlanPayload(userId, {
    ...data,
    ownerType: context.ownerType,
    householdId: context.householdId,
  }, ownerQuery);
  payload.meals = await applyMealInventoryTransitions([], payload.meals, ownerQuery);
  return MealPlan.create(payload);
}

export async function updateMealPlan(planId: string, userId: string, data: any) {
  const existing = await MealPlan.findOne({ _id: planId, userId });
  if (!existing) throw new Error('Meal plan not found');

  const context = await getInventoryOwnerContext(
    userId,
    existing.inventoryOwnerType || (existing.householdId ? 'HOUSEHOLD' : 'USER'),
    existing.householdId?.toString(),
  );
  const ownerQuery = buildOwnerQuery(context);
  const payload = await buildMealPlanPayload(userId, {
    ...existing.toObject(),
    ...data,
    ownerType: context.ownerType,
    householdId: context.householdId,
    planDate: data.planDate || existing.planDate,
    meals: data.meals || existing.meals
  }, ownerQuery);

  payload.meals = await applyMealInventoryTransitions(existing.meals || [], payload.meals, ownerQuery);
  const totals = calculateMealTotals(payload.meals);
  payload.totalCalories = totals.totalCalories;
  payload.macroSummary = totals.macroSummary;

  return MealPlan.findByIdAndUpdate(planId, payload, { returnDocument: 'after' })
    .populate('meals.recipeId', 'recipeName imageUrl calories macroSummary')
    .populate('meals.usedFoods.foodItemId', 'foodName quantity unit status');
}

export async function deleteMealPlan(planId: string, userId: string) {
  const existing = await MealPlan.findOne({ _id: planId, userId });
  if (!existing) throw new Error('Meal plan not found');

  const context = await getInventoryOwnerContext(
    userId,
    existing.inventoryOwnerType || (existing.householdId ? 'HOUSEHOLD' : 'USER'),
    existing.householdId?.toString(),
  );
  const ownerQuery = buildOwnerQuery(context);
  await applyMealInventoryTransitions(existing.meals || [], [], ownerQuery);
  await MealPlan.deleteOne({ _id: planId, userId });
  return { message: 'Meal plan deleted successfully' };
}

export async function getMealPlanSummary(userId: string, date: string | Date) {
  const plans = await MealPlan.find({
    userId,
    planDate: { $gte: startOfDay(date), $lte: endOfDay(date) }
  });

  const meals = plans.flatMap((plan) => plan.meals || []);
  const totals = calculateMealTotals(meals);

  return {
    date: startOfDay(date),
    mealCount: meals.length,
    ...totals
  };
}

function expiryPriority(expiryDate: Date) {
  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function normalize(value: string) {
  return normalizeFoodText(value || '');
}

function hasMacroValue(macroSummary: any) {
  return (
    Number(macroSummary?.protein) > 0 ||
    Number(macroSummary?.carbs) > 0 ||
    Number(macroSummary?.fat) > 0
  );
}

function getCategoryId(value: any) {
  const raw = value?._id || value;
  if (!raw) return undefined;
  const categoryId = String(raw).trim();
  if (!categoryId || categoryId === 'undefined' || categoryId === 'null') return undefined;
  return categoryId;
}

function getCategoryName(value: any) {
  return value && typeof value === 'object' ? value.categoryName : undefined;
}

function isBlockedByPreference(foodName: string, preference: any) {
  const normalized = normalize(foodName);
  const disliked = preference?.dislikedFoods || [];
  const allergies = preference?.allergies || [];
  return [...disliked, ...allergies].some((item: string) => {
    const preferenceText = normalize(item || '');
    return preferenceText && (normalized.includes(preferenceText) || preferenceText.includes(normalized));
  });
}

function buildPriorityReason(food: InventoryPriorityFood, calorieTarget: number, weather?: string) {
  const reasons = [];
  if (food.daysUntilExpiry <= 1) reasons.push('Nên dùng hôm nay');
  else if (food.daysUntilExpiry <= 3) reasons.push('Sắp hết hạn');
  if ((food.calories || 0) > 0) reasons.push(`${Math.round(food.calories || 0)} kcal`);
  if (weather) reasons.push(`Thời tiết: ${weather}`);
  if (calorieTarget) reasons.push(`Mục tiêu ${calorieTarget} kcal/ngày`);
  return reasons;
}

function detectVideoPlatform(videoUrl: string) {
  const url = videoUrl.toLowerCase();
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YOUTUBE';
  if (url.includes('tiktok.com')) return 'TIKTOK';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'FACEBOOK';
  return 'OTHER';
}

function recipeInventoryScore(recipe: any, foods: any[]) {
  const ingredientNames = (recipe.ingredients || []).map((ingredient: any) =>
    normalize(ingredient.ingredientName || '')
  );

  const matchedFoods = foods.filter((food) => {
    const foodName = normalize(food.foodName || '');
    return ingredientNames.some((ingredientName: string) =>
      foodName.includes(ingredientName) || ingredientName.includes(foodName)
    );
  });

  const nearExpiryBonus = matchedFoods.filter((food) => food.status === 'NEAR_EXPIRY').length * 3;
  const expiredPenalty = matchedFoods.filter((food) => food.status === 'EXPIRED').length * -4;

  return {
    score: matchedFoods.length * 5 + nearExpiryBonus + expiredPenalty,
    matchedFoods
  };
}

function hasFoodTerm(text: string, terms: string[]) {
  return terms.some((term) => {
    const normalizedTerm = normalizeFoodText(term);
    if (!normalizedTerm) return false;
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
  });
}

function isProteinFoodText(text: string) {
  return hasFoodTerm(text, [
    'thịt',
    'thịt bò',
    'thịt gà',
    'thịt heo',
    'thịt lợn',
    'gà',
    'bò',
    'heo',
    'lợn',
    'tôm',
    'trứng',
    'egg',
    'chicken',
    'beef',
    'pork',
    'fish',
    'shrimp',
    'tofu',
    'đậu hũ',
    'cá hồi',
    'cá thu',
    'cá basa',
    'cá ngừ',
    'cá lóc',
    'cá rô',
    'cá chép'
  ]);
}

function getFoodGroup(food: InventoryPriorityFood) {
  const text = normalize(`${food.foodName} ${food.categoryName || ''}`);
  if (hasFoodTerm(text, ['rau', 'cải', 'xà lách', 'cà rốt', 'cà chua', 'dưa leo', 'dưa chuột', 'bí', 'nấm', 'vegetable', 'salad', 'lettuce', 'tomato', 'carrot', 'mushroom'])) {
    return 'vegetable';
  }
  if (hasFoodTerm(text, ['chuối', 'táo', 'cam', 'dâu', 'xoài', 'nhãn', 'dưa hấu', 'fruit', 'banana', 'apple', 'orange', 'berry', 'mango'])) {
    return 'fruit';
  }
  if (isProteinFoodText(text)) {
    return 'protein';
  }
  if (hasFoodTerm(text, ['cơm', 'gạo', 'bún', 'mì', 'noodle', 'rice', 'pasta', 'khoai', 'bread', 'bánh mì', 'yến mạch', 'oat'])) {
    return 'carb';
  }
  if (hasFoodTerm(text, ['sữa', 'yogurt', 'yaourt', 'phô mai', 'milk', 'cheese'])) {
    return 'dairy';
  }
  return 'other';
}

function getPortionQuantity(food: InventoryPriorityFood) {
  const quantity = Number(food.quantity) || 1;
  const unit = normalize(food.unit || '');

  if (unit === 'g') return Math.min(quantity, getFoodGroup(food) === 'protein' ? 180 : 150);
  if (unit === 'ml') return Math.min(quantity, 250);
  if (unit === 'kg') return Math.min(quantity, 0.25);
  if (unit === 'l') return Math.min(quantity, 0.35);
  return Math.min(quantity, 1);
}

function estimatePortionCalories(food: InventoryPriorityFood) {
  const quantity = Number(food.quantity) || 0;
  if (!quantity || !(food.calories || 0)) return 0;
  return (Number(food.calories) || 0) * (getPortionQuantity(food) / quantity);
}

function isWithinCalorieRange(calories: number | undefined, min: number, max: number) {
  const value = Number(calories) || 0;
  if (value <= 0) return true;
  if (value < min) return false;
  return !Number.isFinite(max) || value <= max;
}

function roundOne(value: number) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function roundQuantity(value: number) {
  const quantity = Number(value) || 0;
  if (quantity < 1) return roundOne(quantity);
  return Math.round(quantity * 10) / 10;
}

function randomInt(min: number, max: number) {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  if (upper <= lower) return lower;
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

const BASIC_PANTRY_INGREDIENTS = new Set([
  'muoi',
  'duong',
  'tieu',
  'hat nem',
  'bot ngot',
  'mi chinh',
  'dau an',
  'dau olive',
  'nuoc mam',
  'nuoc tuong',
  'xi dau',
  'gia vi',
  'hanh ngo',
  'hanh la',
  'rau thom',
  'toi',
  'ot',
  'chanh'
]);

function isBasicPantryIngredient(name?: string) {
  const normalized = normalizeFoodText(name || '');
  if (!normalized) return false;
  if (BASIC_PANTRY_INGREDIENTS.has(normalized)) return true;
  return /^(muoi|duong|tieu|hat nem|bot ngot|mi chinh|dau an|dau olive|nuoc mam|nuoc tuong|xi dau|gia vi|hanh ngo|hanh la|rau thom|toi|ot|chanh)(\s|$)/.test(normalized);
}

function inferRecipeUnit(ingredientName: string, unit?: string, matchedFood?: InventoryPriorityFood) {
  const normalizedUnit = normalizeUnit(unit);
  const normalizedName = normalizeFoodText(ingredientName);
  const foodUnit = matchedFood?.unit;

  if (foodUnit) {
    const normalizedFoodUnit = normalizeUnit(foodUnit);
    if (['kg', 'g', 'ml', 'l'].includes(normalizedFoodUnit)) return normalizedFoodUnit;
    if (normalizedFoodUnit === 'item') {
      if (/trung|egg|tao|chuoi|cam|quyt|xoai|chanh|ca chua/.test(normalizedName)) return 'quả';
      return 'cái';
    }
  }
  if (['kg', 'g', 'ml', 'l'].includes(normalizedUnit)) return normalizedUnit;
  if (['qua', 'trai'].includes(normalizedUnit)) return 'quả';
  if (['cai', 'item', 'piece'].includes(normalizedUnit)) {
    if (/trung|egg|tao|chuoi|cam|quyt|xoai|chanh|ca chua/.test(normalizedName)) return 'quả';
    return 'cái';
  }
  if (/sua|milk|nuoc|juice|soup|canh/.test(normalizedName)) return 'ml';
  if (/trung|egg|tao|chuoi|cam|quyt|xoai|chanh|ca chua/.test(normalizedName)) return 'quả';
  return 'g';
}

function normalizeRecipeQuantity(quantity: number, unit: string, ingredientName = '') {
  const value = Number(quantity) > 0 ? Number(quantity) : 1;
  const normalizedUnit = normalizeUnit(unit);
  const normalizedName = normalizeFoodText(ingredientName);

  if (normalizedUnit === 'kg') return Math.max(0.05, Math.round(value * 20) / 20);
  if (normalizedUnit === 'g') {
    const base = value < 25 ? 25 : Math.round(value / 25) * 25;
    return Math.min(Math.max(base, 25), isProteinFoodText(normalizedName) ? 250 : 300);
  }
  if (normalizedUnit === 'l') return Math.max(0.05, Math.round(value * 20) / 20);
  if (normalizedUnit === 'ml') {
    const base = value < 25 ? 25 : Math.round(value / 25) * 25;
    return Math.min(Math.max(base, 25), 500);
  }
  if (normalizedUnit === 'item' || ['qua', 'cai'].includes(normalizeFoodText(unit))) {
    return Math.max(1, Math.round(value));
  }
  return Math.max(1, Math.round(value));
}

function estimateIngredientNutrition(ingredient: any) {
  const name = normalizeFoodText(ingredient.ingredientName || ingredient.foodName || '');
  const unit = normalizeUnit(ingredient.unit);
  const rawQuantity = Number(ingredient.quantity) || 0;
  let grams = rawQuantity;

  if (unit === 'kg') grams = rawQuantity * 1000;
  else if (unit === 'g') grams = rawQuantity;
  else if (unit === 'l') grams = rawQuantity * 1000;
  else if (unit === 'ml') grams = rawQuantity;
  else if (unit === 'item' || ['qua', 'cai'].includes(normalizeFoodText(ingredient.unit))) {
    grams = /trung|egg/.test(name) ? rawQuantity * 55 : rawQuantity * 100;
  } else {
    grams = rawQuantity * 100;
  }

  const per100 = isProteinFoodText(name)
    ? { calories: 170, protein: 21, carbs: 0, fat: 8 }
    : /gao|com|bun|mi|pho|khoai|bread|rice|noodle|oat/.test(name)
      ? { calories: 130, protein: 3, carbs: 28, fat: 1 }
      : /sua|yogurt|yaourt|milk|cheese/.test(name)
        ? { calories: 65, protein: 3.5, carbs: 5, fat: 3 }
        : /tao|chuoi|cam|xoai|nhan|fruit|banana|apple|orange|mango/.test(name)
          ? { calories: 60, protein: 0.8, carbs: 14, fat: 0.2 }
          : { calories: 35, protein: 1.5, carbs: 7, fat: 0.3 };

  const factor = grams / 100;
  return {
    calories: roundTwo(per100.calories * factor),
    macroSummary: {
      protein: roundTwo(per100.protein * factor),
      carbs: roundTwo(per100.carbs * factor),
      fat: roundTwo(per100.fat * factor)
    }
  };
}

async function calculateRecipeNutrition(ingredients: any[] = []) {
  const nutrition = await calculateNutritionForIngredients(ingredients);
  const unmatched = Array.isArray((nutrition as any).unmatched) ? (nutrition as any).unmatched : [];
  if (!unmatched.length) return nutrition;

  const estimated = unmatched.reduce(
    (acc: any, ingredient: any) => {
      const item = estimateIngredientNutrition(ingredient);
      acc.calories += item.calories;
      acc.macroSummary = addMacros(acc.macroSummary, item.macroSummary);
      return acc;
    },
    {
      calories: Number(nutrition.calories) || 0,
      macroSummary: nutrition.macroSummary || { protein: 0, carbs: 0, fat: 0 }
    }
  );

  return {
    ...nutrition,
    calories: roundTwo(estimated.calories),
    macroSummary: {
      protein: roundTwo(estimated.macroSummary.protein),
      carbs: roundTwo(estimated.macroSummary.carbs),
      fat: roundTwo(estimated.macroSummary.fat)
    }
  };
}

function allocateCaloriesToMealTypes(
  mealTypes: string[],
  calorieMin: number,
  calorieMax: number,
  calorieTarget: number
): MealCalorieAllocation[] {
  const count = Math.max(1, mealTypes.length);
  const finiteMax = Number.isFinite(calorieMax);
  const baseMin = Math.floor(Math.max(0, calorieMin) / count);
  const minRemainder = Math.max(0, calorieMin) - baseMin * count;
  const baseMax = finiteMax ? Math.floor(Math.max(calorieMax, calorieMin || calorieTarget) / count) : Infinity;
  const maxRemainder = finiteMax ? Math.max(calorieMax, calorieMin || calorieTarget) - baseMax * count : 0;
  const minSlots = mealTypes.map((mealType, index) => ({
    mealType,
    min: baseMin + (index < minRemainder ? 1 : 0),
    max: finiteMax ? baseMax + (index < maxRemainder ? 1 : 0) : Infinity
  }));
  const totalMin = minSlots.reduce((sum, item) => sum + item.min, 0);
  const totalMax = finiteMax
    ? minSlots.reduce((sum, item) => sum + Number(item.max), 0)
    : Math.max(totalMin + count * 250, calorieTarget);
  const totalTarget = finiteMax && totalMax > totalMin
    ? randomInt(totalMin, totalMax)
    : randomInt(Math.max(0, Math.round(calorieTarget * 0.9)), Math.max(1, Math.round(calorieTarget * 1.1)));
  let remaining = Math.max(0, totalTarget - totalMin);
  const weights = mealTypes.map(() => 0.7 + Math.random() * 0.8);
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;
  const targets = minSlots.map((slot, index) => {
    const capacity = Number.isFinite(slot.max) ? Math.max(0, Number(slot.max) - slot.min) : remaining;
    const proposed = Math.round((totalTarget - totalMin) * (weights[index] / weightSum));
    const extra = Math.min(capacity, proposed);
    remaining -= extra;
    return slot.min + extra;
  });

  let guard = 0;
  while (remaining > 0 && guard < 100) {
    const index = randomInt(0, targets.length - 1);
    const capacity = Number.isFinite(minSlots[index].max)
      ? Number(minSlots[index].max) - targets[index]
      : remaining;
    if (capacity > 0) {
      const extra = Math.min(remaining, capacity, randomInt(1, Math.max(1, Math.min(80, capacity))));
      targets[index] += extra;
      remaining -= extra;
    }
    guard += 1;
  }

  return minSlots.map((slot, index) => ({
    mealType: slot.mealType,
    min: slot.min,
    max: slot.max,
    target: targets[index]
  }));
}

function randomizeRecipeAllocation(allocation: MealCalorieAllocation): MealCalorieAllocation {
  const minimum = Math.max(1, Math.ceil(allocation.min));
  const maximum = Number.isFinite(allocation.max)
    ? Math.max(minimum, Math.floor(allocation.max))
    : Math.max(minimum, Math.round(allocation.target * 1.15));

  return {
    ...allocation,
    target: randomInt(minimum, maximum)
  };
}

function findAllocationForCalories(
  calories: number,
  allocations: MealCalorieAllocation[]
) {
  if (!allocations.length) return undefined;
  if (calories <= 0) return allocations[0];
  return allocations.find((allocation) =>
    isWithinCalorieRange(calories, allocation.min, allocation.max)
  );
}

function getMealTypeLabel(mealType: string) {
  const labels: Record<string, string> = {
    BREAKFAST: 'bữa sáng',
    LUNCH: 'bữa trưa',
    AFTERNOON: 'bữa chiều',
    DINNER: 'bữa tối',
    LATE_NIGHT: 'bữa khuya',
    SNACK: 'bữa phụ'
  };
  return labels[mealType] || mealType.toLowerCase();
}

function matchesIngredient(foodName: string, ingredientName: string) {
  const food = normalize(foodName || '');
  const ingredient = normalize(ingredientName || '');
  return Boolean(food && ingredient && (food.includes(ingredient) || ingredient.includes(food)));
}

function findMatchingFood(ingredient: any, foods: InventoryPriorityFood[]) {
  return foods.find((food) => {
    if (!matchesIngredient(food.foodName, ingredient.ingredientName)) return false;
    const requiredQty = Number(ingredient.quantity) || 0;
    const availableQty = Number(food.quantity) || 0;
    const convertedRequired = convertQuantity(requiredQty, ingredient.unit, food.unit);
    if (convertedRequired === null) return false;
    if (requiredQty <= 0) return availableQty > 0;
    return availableQty >= convertedRequired;
  });
}

function analyzeRecipeAvailability(
  ingredients: any[] = [],
  foods: InventoryPriorityFood[] = []
): RecipeAvailabilityAnalysis {
  const matchedIngredients: string[] = [];
  const missingIngredients: RecipeAvailabilityAnalysis['missingIngredients'] = [];

  ingredients
    .filter((ingredient) => ingredient.isRequired !== false && !isBasicPantryIngredient(ingredient.ingredientName))
    .forEach((ingredient) => {
      const matchedFood = findMatchingFood(ingredient, foods);
      if (matchedFood) {
        matchedIngredients.push(ingredient.ingredientName);
      } else {
        missingIngredients.push({
          ingredientName: ingredient.ingredientName,
          quantity: Number(ingredient.quantity) || 1,
          unit: ingredient.unit || 'g',
          categoryId: ingredient.categoryId,
          categoryName: ingredient.categoryName
        });
      }
    });

  return {
    status: missingIngredients.length ? 'MISSING_INGREDIENTS' : 'ENOUGH_INGREDIENTS',
    matchedIngredients,
    missingIngredients
  };
}

function attachRecommendationMetadata(recipe: any, metadata: any) {
  const plainRecipe = typeof recipe?.toObject === 'function' ? recipe.toObject() : { ...recipe };
  return {
    ...plainRecipe,
    availability: {
      canSchedule: metadata.availabilityStatus === 'ENOUGH_INGREDIENTS',
      matchedIngredients: metadata.matchedIngredients || [],
      missingIngredients: (metadata.missingIngredients || []).map((item: any) => item.ingredientName || item)
    },
    availabilityStatus: metadata.availabilityStatus,
    missingIngredients: metadata.missingIngredients || [],
    targetMealType: metadata.targetMealType,
    targetCalories: metadata.targetCalories,
    calorieRange: metadata.calorieRange
  };
}

function buildRecommendation(recipe: any, metadata: any) {
  return {
    recipe: attachRecommendationMetadata(recipe, metadata),
    score: metadata.score || 1,
    matchedFoods: metadata.matchedFoods || [],
    priorityReasons: metadata.priorityReasons || [],
    availabilityStatus: metadata.availabilityStatus,
    missingIngredients: metadata.missingIngredients || [],
    targetMealType: metadata.targetMealType,
    targetCalories: metadata.targetCalories,
    calorieRange: metadata.calorieRange
  };
}

function buildIngredientFromFood(food: InventoryPriorityFood) {
  const unit = inferRecipeUnit(food.foodName, food.unit, food);
  return {
    ingredientName: food.foodName,
    categoryId: food.categoryId,
    quantity: normalizeRecipeQuantity(getPortionQuantity(food), unit, food.foodName),
    unit,
    isRequired: true
  };
}

function buildRecipeSignature(foods: InventoryPriorityFood[]) {
  return foods.map((food) => normalize(food.foodName)).sort().join('|');
}

function buildIngredientSignature(ingredients: any[] = []) {
  return ingredients
    .map((ingredient) => normalize(ingredient.ingredientName || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

function buildStepSignature(steps: any[] = []) {
  return steps
    .map((step) => normalize(String(step || '').replace(/[^\p{L}\p{N}\s]/gu, '')))
    .filter(Boolean)
    .join('|');
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildFormulaSignature(ingredients: any[] = [], steps: any[] = []) {
  return `${buildIngredientSignature(ingredients)}::${buildStepSignature(steps)}`;
}

function buildFormulaTag(ingredients: any[] = [], steps: any[] = []) {
  return `FORMULA:${hashText(buildFormulaSignature(ingredients, steps))}`;
}

async function findExistingRecipeBySignature(
  userId: string,
  signature: string,
  signatureTag: string,
  recipeName?: string,
  stepSignature?: string
) {
  const candidates = await Recipe.find({
    isActive: true,
    $or: [
      { sourceType: 'SYSTEM' },
      { createdBy: userId, sourceType: 'AI_GENERATED' }
    ]
  });

  return candidates.find((recipe: any) => {
    const recipeTags = recipe.tags || [];
    const sameName = recipeName && normalize(recipe.recipeName || '') === normalize(recipeName);
    const sameIngredients = signature &&
      buildIngredientSignature(recipe.ingredients || []) === signature;
    const sameSteps = stepSignature &&
      buildStepSignature(recipe.cookingSteps || []) === stepSignature;
    return recipeTags.includes(signatureTag) ||
      sameName ||
      (sameIngredients && sameSteps);
  });
}

function choosePrimaryFood(foods: InventoryPriorityFood[]) {
  return foods.find((food) => getFoodGroup(food) === 'protein') ||
    foods.find((food) => getFoodGroup(food) === 'carb') ||
    foods[0];
}

function buildGeneratedRecipeName(foods: InventoryPriorityFood[], mealType: string) {
  const primary = choosePrimaryFood(foods);
  if (!primary) return 'Món gợi ý từ tủ thực phẩm';
  const others = foods.filter((food) => String(food._id) !== String(primary?._id));
  const sideNames = others.slice(0, 2).map((food) => food.foodName);
  const groups = new Set(foods.map(getFoodGroup));

  if (['SNACK', 'AFTERNOON', 'LATE_NIGHT'].includes(mealType) && (groups.has('fruit') || groups.has('dairy'))) {
    return `Sinh tố ${foods.slice(0, 3).map((food) => food.foodName).join(' và ')}`;
  }

  if (groups.has('vegetable') && !groups.has('carb') && foods.length >= 2) {
    return `Salad ${foods.slice(0, 3).map((food) => food.foodName).join(' và ')}`;
  }

  if (groups.has('carb') && foods.length >= 2) {
    return `${primary.foodName} trộn ${sideNames.join(' và ')}`.trim();
  }

  if (groups.has('protein') && sideNames.length) {
    return `${primary.foodName} xào ${sideNames.join(' và ')}`;
  }

  if (sideNames.length) {
    return buildSmartFallbackRecipeName(foods, mealType);
  }

  return `Món ${primary.foodName}`;
}

function buildCookingSteps(recipeName: string, foods: InventoryPriorityFood[], variant = 0) {
  const names = foods.map((food) => food.foodName).join(', ');
  const primary = choosePrimaryFood(foods);
  const primaryName = primary?.foodName || 'nguyên liệu chính';
  const techniqueSteps = [
    `Nấu chín ${primaryName} với lượng vừa đủ.`,
    `Áp chảo ${primaryName} đến khi chín thơm.`,
    `Nấu ${primaryName} thành phần nền mềm và dễ ăn.`,
    `Trộn ${primaryName} với rau/gia vị theo khẩu vị.`,
    `Làm nóng chảo, đảo nhanh ${primaryName} để giữ độ tươi.`
  ];

  return [
    `Sơ chế ${names}.`,
    techniqueSteps[variant % techniqueSteps.length],
    'Kết hợp các nguyên liệu còn lại, nêm gia vị theo khẩu vị.',
    `Trình bày và dùng ngay món ${recipeName}.`
  ];
}

function buildSmartFallbackRecipeName(foods: InventoryPriorityFood[], mealType: string, variant = 0) {
  const primary = choosePrimaryFood(foods);
  if (!primary) return 'Món ngon từ tủ thực phẩm';

  const grouped = foods.reduce<Record<string, InventoryPriorityFood[]>>((acc, food) => {
    const group = getFoodGroup(food);
    acc[group] = [...(acc[group] || []), food];
    return acc;
  }, {});
  const protein = grouped.protein?.[0]?.foodName;
  const carb = grouped.carb?.[0]?.foodName;
  const vegetable = grouped.vegetable?.[0]?.foodName;
  const fruit = grouped.fruit?.[0]?.foodName;
  const dairy = grouped.dairy?.[0]?.foodName;
  const secondary = vegetable || carb || fruit || dairy;

  if (['SNACK', 'AFTERNOON', 'LATE_NIGHT'].includes(mealType) && (fruit || dairy)) {
    const names = [
      fruit && dairy ? `Sữa chua ${fruit}` : '',
      fruit ? `Sinh tố ${fruit}` : '',
      fruit ? `Salad trái cây ${fruit}` : '',
      dairy ? `${dairy} ngũ cốc` : '',
      fruit ? `${fruit} dầm sữa chua` : ''
    ].filter(Boolean);
    return names[variant % names.length] || `Sữa chua ${primary.foodName}`;
  }

  if (protein && carb && vegetable) {
    const names = [
      `${protein} áp chảo ăn kèm ${carb}`,
      `Cơm ${protein} rau củ`,
      `${protein} sốt nhẹ ăn kèm ${carb}`,
      `Bát ${carb} ${protein} cân bằng`,
      `${protein} cuộn rau xanh`
    ];
    return names[variant % names.length];
  }

  if (protein && vegetable) {
    const names = [
      `${protein} xào rau củ`,
      `${protein} áp chảo rau xanh`,
      `Canh ${protein} rau củ`,
      `Salad ${protein} rau xanh`,
      `${protein} cuộn rau củ`
    ];
    return names[variant % names.length];
  }

  if (protein && carb) {
    const names = [
      `${protein} sốt nhẹ ăn kèm ${carb}`,
      `${carb} trộn ${protein}`,
      `Cháo ${protein}`,
      `${protein} áp chảo ăn kèm ${carb}`,
      `Bát ${carb} ${protein}`
    ];
    return names[variant % names.length];
  }

  if (carb && vegetable) {
    const names = [
      `${carb} rau củ`,
      `${carb} trộn rau xanh`,
      `Cháo ${carb} rau củ`,
      `Bát ${carb} thanh đạm`,
      `${vegetable} ăn kèm ${carb}`
    ];
    return names[variant % names.length];
  }

  if (protein) {
    const names = [
      `${protein} áp chảo`,
      `${protein} sốt gừng nhẹ`,
      `Canh ${protein}`,
      `${protein} nướng áp chảo`,
      `${protein} trộn rau thơm`
    ];
    return names[variant % names.length];
  }

  if (vegetable) return `Salad ${vegetable}`;
  if (fruit) return `Salad trái cây ${fruit}`;
  if (secondary) return `${primary.foodName} ăn kèm ${secondary}`;

  return `${primary.foodName} chế biến nhanh`;
}

function getUniqueFallbackName(
  foods: InventoryPriorityFood[],
  mealType: string,
  usedNames: Set<string>,
  startVariant: number
) {
  for (let offset = 0; offset < 8; offset += 1) {
    const variant = startVariant + offset;
    const recipeName = buildSmartFallbackRecipeName(foods, mealType, variant);
    const normalizedName = normalize(recipeName);
    if (!usedNames.has(normalizedName)) {
      usedNames.add(normalizedName);
      return { recipeName, variant };
    }
  }

  const variant = startVariant + usedNames.size;
  const recipeName = buildSmartFallbackRecipeName(foods, mealType, variant);
  usedNames.add(normalize(recipeName));
  return { recipeName, variant };
}

function buildComboPriorityReasons(foods: InventoryPriorityFood[], calorieTarget: number, weather?: string) {
  const reasons = new Set<string>();
  if (foods.length > 1) reasons.add(`Kết hợp ${foods.length} thực phẩm trong tủ`);
  foods.forEach((food) => buildPriorityReason(food, calorieTarget, weather).forEach((reason) => reasons.add(reason)));
  return Array.from(reasons).slice(0, 6);
}

function selectFoodCombo(
  priorityFoods: InventoryPriorityFood[],
  usedFoodIds: Set<string>,
  mealType: string,
  calorieTargetPerMeal: number,
  calorieMinPerMeal: number,
  calorieMaxPerMeal: number,
  remainingMealSlots: number
) {
  const unusedFoods = priorityFoods.filter((food) => !usedFoodIds.has(String(food._id)));
  if (!unusedFoods.length) return [];

  const remainingSlots = Math.max(1, remainingMealSlots);
  const targetSize = Math.min(4, Math.max(1, Math.ceil(unusedFoods.length / remainingSlots)));
  const combo: InventoryPriorityFood[] = [];
  const selectedGroups = new Set<string>();
  const maxCalories = Number.isFinite(calorieMaxPerMeal)
    ? Math.max(calorieMinPerMeal || 0, calorieMaxPerMeal)
    : Infinity;

  for (const food of unusedFoods) {
    const group = getFoodGroup(food);
    const currentCalories = combo.reduce((sum, item) => sum + estimatePortionCalories(item), 0);
    const nextCalories = currentCalories + estimatePortionCalories(food);
    const exceedsMax = nextCalories > maxCalories && combo.length > 0;
    const shouldAdd =
      !exceedsMax && (
      combo.length === 0 ||
      combo.length < Math.min(2, targetSize) ||
      (!selectedGroups.has(group) && nextCalories <= calorieTargetPerMeal * 1.25) ||
      (food.daysUntilExpiry <= 3 && combo.length < targetSize));

    if (!shouldAdd) continue;

    combo.push(food);
    selectedGroups.add(group);
    const calories = combo.reduce((sum, item) => sum + estimatePortionCalories(item), 0);
    if (combo.length >= targetSize && calories >= calorieMinPerMeal) break;
  }

  let comboCalories = combo.reduce((sum, item) => sum + estimatePortionCalories(item), 0);
  if (combo.length && comboCalories < calorieMinPerMeal) {
    for (const food of unusedFoods) {
      if (combo.some((item) => String(item._id) === String(food._id))) continue;
      const nextCalories = comboCalories + estimatePortionCalories(food);
      if (nextCalories > maxCalories) continue;
      combo.push(food);
      comboCalories = nextCalories;
      if (comboCalories >= calorieMinPerMeal || combo.length >= 5) break;
    }
  }

  if (combo.length) return combo;

  const fallback = unusedFoods
    .filter((food) => estimatePortionCalories(food) <= maxCalories || !Number.isFinite(maxCalories))
    .sort(
      (a, b) =>
        Math.abs(estimatePortionCalories(a) - calorieTargetPerMeal) -
        Math.abs(estimatePortionCalories(b) - calorieTargetPerMeal)
    )[0];

  return fallback ? [fallback] : [unusedFoods[0]];
}

function buildFallbackRecipeDrafts(
  priorityFoods: InventoryPriorityFood[],
  allocations: MealCalorieAllocation[],
  calorieTarget: number,
  weather?: string,
  existingRecipes: any[] = []
): AiRecipeDraft[] {
  const drafts: AiRecipeDraft[] = [];
  const usedFoodIds = new Set<string>();
  const usedNames = new Set<string>(
    existingRecipes.map((recipe) => normalize(recipe.recipeName || '')).filter(Boolean)
  );

  allocations.forEach((allocation, index) => {
    const combo = selectFoodCombo(
      priorityFoods,
      usedFoodIds,
      allocation.mealType,
      allocation.target,
      allocation.min,
      allocation.max,
      allocations.length - index
    );

    combo.forEach((food) => usedFoodIds.add(String(food._id)));
    if (combo.length) {
      const { recipeName, variant } = getUniqueFallbackName(
        combo,
        allocation.mealType,
        usedNames,
        index
      );
      drafts.push({
        recipeName,
        description: `Công thức gợi ý từ thực phẩm hiện có cho ${getMealTypeLabel(allocation.mealType)}.`,
        mealType: allocation.mealType,
        availabilityStatus: 'ENOUGH_INGREDIENTS',
        ingredients: combo.map(buildIngredientFromFood),
        cookingSteps: buildCookingSteps(recipeName, combo, variant),
        cookingTime: ['AFTERNOON', 'LATE_NIGHT'].includes(allocation.mealType) ? 10 : 20,
        difficulty: 'EASY',
        priorityReasons: buildComboPriorityReasons(combo, calorieTarget, weather)
      });
    }

    const baseFood = combo[0] || priorityFoods[index % Math.max(1, priorityFoods.length)];
    if (baseFood) {
      const extraName = getFoodGroup(baseFood) === 'fruit' ? 'sữa chua' : 'rau xanh';
      const missingNameBase = getFoodGroup(baseFood) === 'fruit'
        ? `Sữa chua ${baseFood.foodName}`
        : `${baseFood.foodName} sốt rau củ`;
      const missingName = usedNames.has(normalize(missingNameBase))
        ? getUniqueFallbackName([baseFood], allocation.mealType, usedNames, index + 3).recipeName
        : missingNameBase;
      usedNames.add(normalize(missingName));
      drafts.push({
        recipeName: missingName,
        description: 'Công thức có thể cần mua thêm vài nguyên liệu để món ăn đầy đủ hơn.',
        mealType: allocation.mealType,
        availabilityStatus: 'MISSING_INGREDIENTS',
        ingredients: [
          buildIngredientFromFood(baseFood),
          { ingredientName: extraName, quantity: getFoodGroup(baseFood) === 'fruit' ? 100 : 150, unit: 'g', isRequired: true }
        ],
        cookingSteps: [
          `Sơ chế ${baseFood.foodName}.`,
          `Chuẩn bị ${extraName}.`,
          'Chế biến nhanh, trình bày gọn và dùng ngay.'
        ],
        cookingTime: 15,
        difficulty: 'EASY',
        priorityReasons: ['Cần mua thêm nguyên liệu để món ăn đầy đủ hơn']
      });
    }
  });

  return drafts;
}

function sanitizeRecipeName(value: string | undefined, fallback: string) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  const banned = /\+|ket hop|kết hợp|breakfast with|lunch with|dinner with|snack with/i;
  if (!name || banned.test(name) || name.length > 72) return fallback;
  return name;
}

function sanitizeDraftIngredients(
  draft: AiRecipeDraft,
  priorityFoods: InventoryPriorityFood[],
  fallbackFoods: InventoryPriorityFood[]
) {
  const missingIngredients = Array.isArray(draft.missingIngredients)
    ? draft.missingIngredients.map((ingredient) => ({
        ingredientName: ingredient.ingredientName,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        isRequired: true
      }))
    : [];
  const baseIngredients = Array.isArray(draft.ingredients) && draft.ingredients.length
    ? draft.ingredients
    : fallbackFoods.map(buildIngredientFromFood);
  const rawIngredients = [...baseIngredients, ...missingIngredients].filter((ingredient, index, all) => {
    const name = normalize(String(ingredient.ingredientName || ''));
    return name &&
      !isBasicPantryIngredient(ingredient.ingredientName) &&
      all.findIndex((item) => normalize(String(item.ingredientName || '')) === name) === index;
  });

  return rawIngredients
    .map((ingredient) => {
      const ingredientName = String(ingredient.ingredientName || '').trim();
      if (!ingredientName) return null;
      const matchedFood = priorityFoods.find((food) => matchesIngredient(food.foodName, ingredientName));
      const unit = inferRecipeUnit(ingredientName, ingredient.unit, matchedFood);
      return {
        ingredientName: matchedFood?.foodName || ingredientName,
        categoryId: matchedFood?.categoryId,
        categoryName: (ingredient as any).categoryName,
        quantity: normalizeRecipeQuantity(Number(ingredient.quantity) > 0 ? Number(ingredient.quantity) : 1, unit, ingredientName),
        unit,
        isRequired: ingredient.isRequired !== false
      };
    })
    .filter(Boolean) as any[];
}

async function fitIngredientsToAllocation(
  ingredients: any[],
  allocation: MealCalorieAllocation,
  priorityFoods: InventoryPriorityFood[],
  availabilityStatus: AvailabilityStatus
) {
  let currentIngredients = ingredients.map((ingredient) => ({ ...ingredient }));
  let nutrition = await calculateRecipeNutrition(currentIngredients);
  const calories = Number(nutrition.calories) || 0;

  if (!calories || isWithinCalorieRange(calories, allocation.min, allocation.max)) {
    return { ingredients: currentIngredients, nutrition };
  }

  const scale = allocation.target / calories;
  if (!Number.isFinite(scale) || scale <= 0) return { ingredients: currentIngredients, nutrition };

  currentIngredients = currentIngredients.map((ingredient) => {
    const matchedFood = findMatchingFood(ingredient, priorityFoods);
    const scaledQuantity = normalizeRecipeQuantity((Number(ingredient.quantity) || 1) * scale, ingredient.unit, ingredient.ingredientName);
    const cappedQuantity =
      availabilityStatus === 'ENOUGH_INGREDIENTS' && matchedFood && normalize(matchedFood.unit) === normalize(ingredient.unit)
        ? Math.min(scaledQuantity, Number(matchedFood.quantity) || scaledQuantity)
        : scaledQuantity;

    return {
      ...ingredient,
      quantity: Math.max(0.1, cappedQuantity)
    };
  });

  nutrition = await calculateRecipeNutrition(currentIngredients);
  return { ingredients: currentIngredients, nutrition };
}

function dedupeRecommendations(items: any[]) {
  const seenNames = new Set<string>();
  const seenFormulaSignatures = new Set<string>();
  return items.filter((item) => {
    const recipeName = normalize(item.recipe?.recipeName || '');
    const formulaSignature = buildFormulaSignature(
      item.recipe?.ingredients || [],
      item.recipe?.cookingSteps || []
    );
    if (!recipeName && !formulaSignature) return false;
    if (recipeName && seenNames.has(recipeName)) return false;
    if (formulaSignature && seenFormulaSignatures.has(formulaSignature)) return false;
    if (recipeName) seenNames.add(recipeName);
    if (formulaSignature) seenFormulaSignatures.add(formulaSignature);
    return true;
  });
}

async function buildGeneratedRecipe(userId: string, foods: InventoryPriorityFood[], mealType: string, data: any) {
  const ingredients = foods.map(buildIngredientFromFood);
  const nutrition = await calculateRecipeNutrition(ingredients);
  const recipeName = buildSmartFallbackRecipeName(foods, mealType);
  const cookingSteps = buildCookingSteps(recipeName, foods);
  const priorityReasons = buildComboPriorityReasons(foods, Number(data.calorieTarget || 0), data.weather);
  const signature = buildIngredientSignature(ingredients);
  const signatureTag = buildFormulaTag(ingredients, cookingSteps);
  const existingRecipe = await findExistingRecipeBySignature(
    userId,
    signature,
    signatureTag,
    recipeName,
    buildStepSignature(cookingSteps)
  );

  if (existingRecipe && existingRecipe.sourceType !== 'AI_GENERATED') {
    return existingRecipe;
  }

  const tags = [
    'AI_GENERATED',
    mealType,
    signatureTag,
    foods.some((food) => food.status === 'NEAR_EXPIRY' || food.daysUntilExpiry <= 3) ? 'NEAR_EXPIRY' : 'INVENTORY',
    ...(data.weather ? [`WEATHER_${String(data.weather).toUpperCase()}`] : [])
  ];

  return Recipe.findOneAndUpdate(
    existingRecipe?._id
      ? { _id: existingRecipe._id }
      : {
          createdBy: userId,
          sourceType: 'AI_GENERATED',
          tags: signatureTag
        },
    {
      recipeName,
      description: `Gợi ý từ tủ thực phẩm: ${foods.map((food) => food.foodName).join(', ')}. ${priorityReasons.join(' - ')}`,
      cookingSteps,
      cookingTime: ['SNACK', 'AFTERNOON', 'LATE_NIGHT'].includes(mealType) ? 10 : 20,
      difficulty: 'EASY',
      calories: nutrition.calories,
      macroSummary: nutrition.macroSummary,
      tags,
      ingredients,
      sourceType: 'AI_GENERATED',
      createdBy: userId,
      isActive: true
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
}

async function buildGeneratedRecipeFromDraft(
  userId: string,
  draft: AiRecipeDraft,
  allocation: MealCalorieAllocation,
  priorityFoods: InventoryPriorityFood[],
  data: any
) {
  const fallbackFoods = selectFoodCombo(
    priorityFoods,
    new Set<string>(),
    allocation.mealType,
    allocation.target,
    allocation.min,
    allocation.max,
    1
  );
  const draftMealType = draft.mealType || allocation.mealType;
  const initialIngredients = sanitizeDraftIngredients(draft, priorityFoods, fallbackFoods);
  const requestedStatus = draft.availabilityStatus === 'MISSING_INGREDIENTS'
    ? 'MISSING_INGREDIENTS'
    : 'ENOUGH_INGREDIENTS';
  const fitted = await fitIngredientsToAllocation(
    initialIngredients,
    allocation,
    priorityFoods,
    requestedStatus
  );
  const ingredients = fitted.ingredients;
  const availability = analyzeRecipeAvailability(ingredients, priorityFoods);
  const availabilityStatus = availability.status;
  const matchedFoods = priorityFoods
    .filter((food) => ingredients.some((ingredient) => matchesIngredient(food.foodName, ingredient.ingredientName)))
    .map((food) => ({
      _id: food._id,
      foodName: food.foodName,
      status: food.status,
      expiryDate: food.expiryDate
    }));

  const fallbackName = buildSmartFallbackRecipeName(
    matchedFoods.length ? priorityFoods.filter((food) => matchedFoods.some((item) => String(item._id) === String(food._id))) : fallbackFoods,
    draftMealType
  );
  const recipeName = sanitizeRecipeName(draft.recipeName, fallbackName);
  const cookingSteps = Array.isArray(draft.steps) && draft.steps.length
    ? draft.steps.slice(0, 8)
    : Array.isArray(draft.cookingSteps) && draft.cookingSteps.length
      ? draft.cookingSteps.slice(0, 8)
      : buildCookingSteps(recipeName, fallbackFoods);
  const signature = buildIngredientSignature(ingredients);
  const signatureTag = buildFormulaTag(ingredients, cookingSteps);
  const existingRecipe = await findExistingRecipeBySignature(
    userId,
    signature,
    signatureTag,
    recipeName,
    buildStepSignature(cookingSteps)
  );
  const priorityReasons = [
    ...(Array.isArray(draft.priorityReasons) ? draft.priorityReasons : []),
    ...buildComboPriorityReasons(
      priorityFoods.filter((food) => matchedFoods.some((item) => String(item._id) === String(food._id))),
      Number(data.calorieTarget || 0),
      data.weather
    )
  ].filter(Boolean).slice(0, 6);

  const recipePayload = {
    recipeName,
    description:
      draft.description ||
      `Công thức gợi ý cho ${getMealTypeLabel(draftMealType)}. Mục tiêu khoảng ${allocation.target} kcal.`,
    cookingSteps,
    cookingTime: Number(draft.cookingTime) > 0 ? Number(draft.cookingTime) : 20,
    difficulty: draft.difficulty || 'EASY',
    calories: fitted.nutrition.calories,
    macroSummary: fitted.nutrition.macroSummary,
    tags: [
      'AI_GENERATED',
      draftMealType,
      availabilityStatus,
      signatureTag,
      `TARGET_${allocation.target}_KCAL`,
      ...(data.weather ? [`WEATHER_${String(data.weather).toUpperCase()}`] : [])
    ],
    ingredients,
    sourceType: 'AI_GENERATED',
    createdBy: userId,
    isActive: true
  };

  const recipe = await Recipe.findOneAndUpdate(
    existingRecipe?._id
      ? { _id: existingRecipe._id }
      : {
          createdBy: userId,
          sourceType: 'AI_GENERATED',
          tags: signatureTag
        },
    recipePayload,
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  return buildRecommendation(recipe, {
    score: availabilityStatus === 'ENOUGH_INGREDIENTS' ? 120 : 80,
    matchedFoods,
    priorityReasons,
    availabilityStatus,
    matchedIngredients: availability.matchedIngredients,
    missingIngredients: availability.missingIngredients,
    targetMealType: draftMealType,
    targetCalories: allocation.target,
    calorieRange: { min: allocation.min, max: allocation.max }
  });
}

export async function generateDailyMealPlan(userId: string, data: any = {}) {
  const planDate = startOfDay(data.planDate || new Date());
  const preference = await UserPreference.findOne({ userId });
  const calorieMin = Math.max(0, Number(data.calorieMin) || 0);
  const calorieMax = Number(data.calorieMax) > 0 ? Number(data.calorieMax) : Infinity;
  const fallbackTarget = preference?.calorieTarget || 2000;
  const calorieTarget = Number(data.calorieTarget) > 0
    ? Number(data.calorieTarget)
    : Number.isFinite(calorieMax)
      ? Math.round((calorieMin + calorieMax) / 2)
      : fallbackTarget;
  const selectedMealTypes = Array.isArray(data.mealTypes) && data.mealTypes.length
    ? data.mealTypes
    : preference?.defaultMealTypes?.length
      ? preference.defaultMealTypes
      : ['BREAKFAST', 'LUNCH', 'DINNER'];

  const inventoryContext = await getInventoryOwnerContext(userId, data.ownerType, data.householdId);
  const foods = await FoodItem.find({
    ...buildOwnerQuery(inventoryContext),
    isDeleted: false,
    isConsumed: false,
    quantity: { $gt: 0 },
    status: { $ne: 'EXPIRED' }
  })
    .populate('categoryId', 'categoryName')
    .sort({ expiryDate: 1 });

  const priorityFoods: InventoryPriorityFood[] = (await Promise.all(
    foods.map(async (food) => {
      const nutrition = await resolveNutritionForFood({
        foodName: food.foodName,
        categoryId: getCategoryId(food.categoryId),
        quantity: food.quantity,
        unit: food.unit,
        nutritionSnapshot: food.nutritionSnapshot,
      });

      return {
        _id: food._id,
        foodName: food.foodName,
        quantity: food.quantity,
        unit: food.unit,
        status: food.status,
        expiryDate: food.expiryDate,
        daysUntilExpiry: expiryPriority(food.expiryDate),
        categoryId: getCategoryId(food.categoryId),
        categoryName: getCategoryName(food.categoryId),
        calories: nutrition.calories,
        macroSummary: nutrition.macroSummary
      };
    })
  ))
    .filter((food) => !isBlockedByPreference(food.foodName, preference))
    .sort((a, b) => {
      const expiryScore = a.daysUntilExpiry - b.daysUntilExpiry;
      if (expiryScore !== 0) return expiryScore;
      return Math.abs((a.calories || 0) - calorieTarget) -
        Math.abs((b.calories || 0) - calorieTarget);
    });

  const calorieAllocations = allocateCaloriesToMealTypes(
    selectedMealTypes,
    calorieMin,
    calorieMax,
    calorieTarget
  );
  const generatedCalorieTarget = calorieAllocations.reduce(
    (sum, allocation) => sum + (Number(allocation.target) || 0),
    0
  );
  const recipes = await Recipe.find({
    isActive: true,
    $or: [
      { sourceType: 'SYSTEM' },
      { createdBy: userId }
    ]
  });
  const avoidRecipes = Array.isArray(data.avoidRecipes) ? data.avoidRecipes : [];
  const recipeReferences = [...avoidRecipes, ...recipes];
  const aiDrafts = await generateAiRecipeDrafts({
    priorityFoods,
    allocations: calorieAllocations,
    preference,
    calorieMin,
    calorieMax,
    calorieTarget: generatedCalorieTarget,
    bmiProfile: data.bmiProfile,
    existingRecipes: recipeReferences,
    weather: data.weather
  });
  const fallbackDrafts = buildFallbackRecipeDrafts(
    priorityFoods,
    calorieAllocations,
    generatedCalorieTarget,
    data.weather,
    recipeReferences
  );
  const draftPool = aiDrafts.length ? [...aiDrafts, ...fallbackDrafts] : fallbackDrafts;
  const generatedRecommendations = [];
  const usedDraftKeys = new Set<string>();

  for (const allocation of calorieAllocations) {
    const mealDrafts = draftPool
      .filter((draft) => !draft.mealType || draft.mealType === allocation.mealType)
      .filter((draft) => {
        const draftKey = `${normalize(draft.recipeName || '')}:${buildIngredientSignature(draft.ingredients || [])}:${buildStepSignature(draft.steps || draft.cookingSteps || [])}`;
        return !usedDraftKeys.has(draftKey);
      })
      .slice(0, 5);
    let acceptedForAllocation = 0;
    let closestOutOfRange: any = null;
    let closestOutOfRangeKey = '';

    for (const draft of mealDrafts) {
      const draftKey = `${normalize(draft.recipeName || '')}:${buildIngredientSignature(draft.ingredients || [])}:${buildStepSignature(draft.steps || draft.cookingSteps || [])}`;
      const recipeAllocation = randomizeRecipeAllocation(allocation);
      const recommendation = await buildGeneratedRecipeFromDraft(
        userId,
        { ...draft, mealType: allocation.mealType },
        recipeAllocation,
        priorityFoods,
        {
          ...data,
          calorieTarget: generatedCalorieTarget
        }
      );
      const recipeCalories = Number(recommendation.recipe?.calories) || 0;
      if (
        recipeCalories > 0 &&
        !isWithinCalorieRange(recipeCalories, allocation.min, allocation.max)
      ) {
        const distance = Math.min(
          Math.abs(recipeCalories - allocation.min),
          Number.isFinite(allocation.max) ? Math.abs(recipeCalories - allocation.max) : 0
        );
        if (!closestOutOfRange || distance < closestOutOfRange.distance) {
          closestOutOfRange = { recommendation, distance };
          closestOutOfRangeKey = draftKey;
        }
        continue;
      }
      usedDraftKeys.add(draftKey);
      generatedRecommendations.push(recommendation);
      acceptedForAllocation += 1;
    }

    if (!acceptedForAllocation && closestOutOfRange) {
      usedDraftKeys.add(closestOutOfRangeKey);
      generatedRecommendations.push(closestOutOfRange.recommendation);
    }
  }

  const scoredRecipes = recipes
    .map((recipe) => {
      const scoring = recipeInventoryScore(recipe, foods);
      const availability = analyzeRecipeAvailability(recipe.ingredients || [], priorityFoods);
      const allocation = findAllocationForCalories(
        Number(recipe.calories) || 0,
        calorieAllocations
      );
      return { recipe, availability, allocation, ...scoring };
    })
    .filter(
      (item) =>
        item.score > 0 &&
        Boolean(item.allocation)
    )
    .sort((a, b) => b.score - a.score);

  const recommendations = dedupeRecommendations([
    ...generatedRecommendations,
    ...scoredRecipes.map((item) =>
      buildRecommendation(item.recipe, {
        score: item.score,
        matchedFoods: item.matchedFoods.map((food) => ({
          _id: food._id,
          foodName: food.foodName,
          status: food.status,
          expiryDate: food.expiryDate
        })),
        priorityReasons: item.matchedFoods.some((food) => food.status === 'NEAR_EXPIRY')
          ? ['Phù hợp thực phẩm sắp hết hạn']
          : ['Phù hợp với tủ thực phẩm'],
        availabilityStatus: item.availability.status,
        matchedIngredients: item.availability.matchedIngredients,
        missingIngredients: item.availability.missingIngredients,
        targetMealType: item.allocation?.mealType || selectedMealTypes[0],
        targetCalories: item.allocation?.target || calorieTarget,
        calorieRange: {
          min: item.allocation?.min ?? calorieMin,
          max: item.allocation?.max ?? calorieMax
        }
      })
    )
  ]).sort((a, b) => Number(b.score) - Number(a.score));

  return {
    plan: null,
    generatedRecipes: generatedRecommendations.map((item) => item.recipe),
    inventoryPriority: priorityFoods,
    recommendations: recommendations.slice(0, 12),
    planDate,
    calorieTarget: generatedCalorieTarget,
    calorieRange: { min: calorieMin, max: calorieMax },
    mealCalorieAllocations: calorieAllocations,
    generatedCaloriesTotal: generatedRecommendations
      .filter((item) => item.availabilityStatus === 'ENOUGH_INGREDIENTS')
      .slice(0, selectedMealTypes.length)
      .reduce((sum, item) => sum + (Number(item.recipe?.calories) || 0), 0)
  };
}

export async function extractRecipeFromVideo(userId: string, data: any = {}) {
  const videoUrl = String(data.videoUrl || '').trim();
  if (!videoUrl) throw new Error('videoUrl is required');

  const platform = detectVideoPlatform(videoUrl);
  if (platform !== 'YOUTUBE') {
    throw new UnsupportedVideoPlatformError(platform);
  }

  const processingSource = await VideoRecipeSource.create({
    userId,
    videoUrl,
    platform,
    extractedText: '',
    extractedIngredients: [],
    missingIngredients: [],
    status: 'PROCESSING'
  });

  let extraction;
  try {
    extraction = await extractRecipeFromVideoUrl(videoUrl);
  } catch (error: any) {
    processingSource.status = 'FAILED';
    processingSource.extractedText = error?.message || 'extraction failed';
    await processingSource.save();
    throw error;
  }

  const { extractedRecipe } = extraction;

  const ingredientsForRecipe = extractedRecipe.ingredients.map((item) => ({
    ingredientName: item.ingredientName,
    quantity: item.quantity,
    unit: item.unit,
    isRequired: item.isRequired !== false
  }));

  const cookingSteps = extractedRecipe.cookingSteps.length
    ? extractedRecipe.cookingSteps
    : extractedRecipe.description
      ? [extractedRecipe.description]
      : ['Chưa có hướng dẫn chi tiết từ video.'];

  const tags = Array.from(
    new Set([
      'VIDEO_EXTRACTED',
      platform,
      ...(extractedRecipe.tags || []),
      extractedRecipe.cuisine ? `Ẩm thực ${extractedRecipe.cuisine}` : ''
    ].filter(Boolean))
  );

  const recipe = await Recipe.create({
    recipeName: extractedRecipe.recipeName,
    description: extractedRecipe.description,
    cookingSteps,
    cookingTime: extractedRecipe.cookingTime,
    difficulty: extractedRecipe.difficulty || 'EASY',
    calories: extractedRecipe.calories,
    macroSummary: extractedRecipe.macroSummary
      ? {
          protein: extractedRecipe.macroSummary.protein || 0,
          carbs: extractedRecipe.macroSummary.carbs || 0,
          fat: extractedRecipe.macroSummary.fat || 0
        }
      : undefined,
    tags,
    ingredients: ingredientsForRecipe,
    sourceType: 'VIDEO_EXTRACTED',
    videoSourceId: processingSource._id,
    createdBy: userId,
    isActive: true
  });

  processingSource.recipeId = recipe._id;
  processingSource.status = 'SUCCESS';
  processingSource.extractedText =
    extractedRecipe.description ||
    extractedRecipe.notes ||
    `Trích xuất bởi ${extraction.modelUsed}`;
  processingSource.extractedIngredients = ingredientsForRecipe;
  processingSource.missingIngredients = [];
  await processingSource.save();

  await AIGeneratedData.create({
    dataType: 'RECIPE',
    generatedContent: {
      recipeId: recipe._id,
      recipeName: recipe.recipeName,
      sourceType: 'VIDEO_EXTRACTED',
      videoSourceId: processingSource._id,
      modelUsed: extraction.modelUsed,
      servings: extractedRecipe.servings,
      cuisine: extractedRecipe.cuisine
    },
    status: 'PENDING_REVIEW'
  });

  return {
    source: processingSource,
    recipe,
    extractedRecipe: {
      recipeId: recipe._id,
      recipeName: recipe.recipeName,
      description: recipe.description,
      ingredients: ingredientsForRecipe,
      cookingSteps,
      cookingTime: recipe.cookingTime,
      difficulty: recipe.difficulty,
      calories: recipe.calories,
      servings: extractedRecipe.servings,
      cuisine: extractedRecipe.cuisine,
      macroSummary: recipe.macroSummary,
      tags,
      notes: extractedRecipe.notes,
      sourceType: 'VIDEO_EXTRACTED'
    }
  };
}
