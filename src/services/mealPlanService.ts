import { GoogleGenerativeAI } from '@google/generative-ai';

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

type AvailabilityStatus = 'ENOUGH_INGREDIENTS' | 'MISSING_INGREDIENTS';

type MealCalorieAllocation = {
  mealType: string;
  min: number;
  max: number;
  target: number;
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

type AiRecipeDraft = {
  recipeName?: string;
  description?: string;
  mealType?: string;
  availabilityStatus?: AvailabilityStatus;
  calories?: number;
  macroSummary?: {
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  ingredients?: Array<{
    ingredientName?: string;
    quantity?: number;
    unit?: string;
    isRequired?: boolean;
  }>;
  missingIngredients?: Array<{
    ingredientName?: string;
    quantity?: number;
    unit?: string;
    categoryName?: string;
  }>;
  steps?: string[];
  cookingSteps?: string[];
  cookingTime?: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  priorityReasons?: string[];
};

function normalizeRecipeId(value: any) {
  const raw = value?._id || value;
  if (!raw) return undefined;

  const recipeId = String(raw).trim();
  if (!recipeId || recipeId === 'undefined' || recipeId === 'null') return undefined;
  return recipeId;
}

async function resolveMealPayload(meal: any) {
  const recipeId = normalizeRecipeId(meal.recipeId);
  const payload: any = {
    mealType: meal.mealType,
    recipeId,
    recipeName: meal.recipeName,
    imageUrl: meal.imageUrl,
    scheduledTime: meal.scheduledTime,
    calories: Number(meal.calories) || 0,
    macroSummary: meal.macroSummary || { protein: 0, carbs: 0, fat: 0 },
    status: meal.status || 'PENDING',
    usedFoodItemIds: Array.isArray(meal.usedFoodItemIds) ? meal.usedFoodItemIds : []
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

  if (!payload.recipeName?.trim()) throw new Error('recipeName is required');
  payload.recipeName = payload.recipeName.trim();

  return payload;
}

async function buildMealPlanPayload(userId: string, data: any) {
  if (!data.planDate) throw new Error('planDate is required');

  const meals = Array.isArray(data.meals)
    ? await Promise.all(data.meals.map((meal: any) => resolveMealPayload(meal)))
    : [];
  const totals = calculateMealTotals(meals);

  return {
    userId,
    householdId: data.householdId,
    planDate: startOfDay(data.planDate),
    goal: data.goal,
    totalCalories: totals.totalCalories,
    macroSummary: totals.macroSummary,
    meals,
    generatedBy: data.generatedBy || 'USER',
    note: data.note
  };
}

export async function listMealPlans(userId: string, query: any = {}) {
  const filter: any = { userId };

  if (query.date) {
    filter.planDate = { $gte: startOfDay(query.date), $lte: endOfDay(query.date) };
  } else if (query.startDate || query.endDate) {
    filter.planDate = {};
    if (query.startDate) filter.planDate.$gte = startOfDay(query.startDate);
    if (query.endDate) filter.planDate.$lte = endOfDay(query.endDate);
  }

  return MealPlan.find(filter)
    .populate('meals.recipeId', 'recipeName imageUrl calories macroSummary')
    .sort({ planDate: 1, updatedAt: -1 });
}

export async function getMealPlanById(planId: string, userId: string) {
  const plan = await MealPlan.findOne({ _id: planId, userId })
    .populate('meals.recipeId', 'recipeName imageUrl calories macroSummary');

  if (!plan) throw new Error('Meal plan not found');
  return plan;
}

export async function createMealPlan(userId: string, data: any) {
  const payload = await buildMealPlanPayload(userId, data);
  return MealPlan.create(payload);
}

export async function updateMealPlan(planId: string, userId: string, data: any) {
  const existing = await MealPlan.findOne({ _id: planId, userId });
  if (!existing) throw new Error('Meal plan not found');

  const payload = await buildMealPlanPayload(userId, {
    ...existing.toObject(),
    ...data,
    planDate: data.planDate || existing.planDate,
    meals: data.meals || existing.meals
  });

  return MealPlan.findByIdAndUpdate(planId, payload, { new: true })
    .populate('meals.recipeId', 'recipeName imageUrl calories macroSummary');
}

export async function deleteMealPlan(planId: string, userId: string) {
  const deleted = await MealPlan.findOneAndDelete({ _id: planId, userId });
  if (!deleted) throw new Error('Meal plan not found');
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
  return value.trim().toLowerCase();
}

function getGenAI(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const hasApiKey = apiKey && apiKey !== 'your_actual_api_key_here';
  return hasApiKey ? new GoogleGenerativeAI(apiKey) : null;
}

function parseJsonFromAiText<T>(text: string, fallback: T): T {
  try {
    const cleanText = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(cleanText);
  } catch (error) {
    return fallback;
  }
}

function hasMacroValue(macroSummary: any) {
  return (
    Number(macroSummary?.protein) > 0 ||
    Number(macroSummary?.carbs) > 0 ||
    Number(macroSummary?.fat) > 0
  );
}

function getCategoryId(value: any) {
  return value?._id || value;
}

function getCategoryName(value: any) {
  return typeof value === 'object' ? value?.categoryName : undefined;
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
  if (food.daysUntilExpiry <= 1) reasons.push('Use today');
  else if (food.daysUntilExpiry <= 3) reasons.push('Near expiry');
  if ((food.calories || 0) > 0) reasons.push(`${Math.round(food.calories || 0)} kcal`);
  if (weather) reasons.push(`Weather: ${weather}`);
  if (calorieTarget) reasons.push(`Target ${calorieTarget} kcal/day`);
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

function getFoodGroup(food: InventoryPriorityFood) {
  const text = normalize(`${food.foodName} ${food.categoryName || ''}`);
  if (/gà|bo|bò|heo|lợn|thịt|cá|tôm|trứng|egg|chicken|beef|pork|fish|shrimp|tofu|đậu/.test(text)) {
    return 'protein';
  }
  if (/cơm|gạo|bún|mì|noodle|rice|pasta|khoai|bread|bánh mì|yến mạch|oat/.test(text)) {
    return 'carb';
  }
  if (/rau|cải|xà lách|cà rốt|cà chua|dưa leo|bí|nấm|vegetable|salad|lettuce|tomato|carrot|mushroom/.test(text)) {
    return 'vegetable';
  }
  if (/chuối|táo|cam|dâu|xoài|fruit|banana|apple|orange|berry|mango/.test(text)) {
    return 'fruit';
  }
  if (/sữa|yogurt|yaourt|phô mai|milk|cheese/.test(text)) {
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

function allocateCaloriesToMealTypes(
  mealTypes: string[],
  calorieMin: number,
  calorieMax: number,
  calorieTarget: number
): MealCalorieAllocation[] {
  const count = Math.max(1, mealTypes.length);
  const finiteMax = Number.isFinite(calorieMax);
  const baseMin = Math.floor(calorieMin / count);
  const minRemainder = calorieMin - baseMin * count;
  const baseMax = finiteMax ? Math.floor(calorieMax / count) : Infinity;
  const maxRemainder = finiteMax ? calorieMax - baseMax * count : 0;
  const baseTarget = Math.floor(calorieTarget / count);
  const targetRemainder = calorieTarget - baseTarget * count;

  return mealTypes.map((mealType, index) => ({
    mealType,
    min: baseMin + (index < minRemainder ? 1 : 0),
    max: finiteMax ? baseMax + (index < maxRemainder ? 1 : 0) : Infinity,
    target: baseTarget + (index < targetRemainder ? 1 : 0)
  }));
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
    BREAKFAST: 'bua sang',
    LUNCH: 'bua trua',
    AFTERNOON: 'bua chieu',
    DINNER: 'bua toi',
    LATE_NIGHT: 'bua khuya',
    SNACK: 'bua phu'
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
    if (requiredQty <= 0) return availableQty > 0;
    return availableQty >= requiredQty || normalize(food.unit || '') !== normalize(ingredient.unit || '');
  });
}

function analyzeRecipeAvailability(
  ingredients: any[] = [],
  foods: InventoryPriorityFood[] = []
): RecipeAvailabilityAnalysis {
  const matchedIngredients: string[] = [];
  const missingIngredients: RecipeAvailabilityAnalysis['missingIngredients'] = [];

  ingredients
    .filter((ingredient) => ingredient.isRequired !== false)
    .forEach((ingredient) => {
      const matchedFood = findMatchingFood(ingredient, foods);
      if (matchedFood) {
        matchedIngredients.push(ingredient.ingredientName);
      } else {
        missingIngredients.push({
          ingredientName: ingredient.ingredientName,
          quantity: Number(ingredient.quantity) || 1,
          unit: ingredient.unit || 'serving',
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
  return {
    ingredientName: food.foodName,
    categoryId: food.categoryId,
    quantity: getPortionQuantity(food),
    unit: food.unit || 'serving',
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
    const sameSteps = stepSignature &&
      buildStepSignature(recipe.cookingSteps || []) === stepSignature;
    return recipeTags.includes(signatureTag) ||
      buildIngredientSignature(recipe.ingredients || []) === signature ||
      sameName ||
      sameSteps;
  });
}

function choosePrimaryFood(foods: InventoryPriorityFood[]) {
  return foods.find((food) => getFoodGroup(food) === 'protein') ||
    foods.find((food) => getFoodGroup(food) === 'carb') ||
    foods[0];
}

function buildGeneratedRecipeName(foods: InventoryPriorityFood[], mealType: string) {
  const primary = choosePrimaryFood(foods);
  if (!primary) return 'Món gợi ý từ inventory';
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
    return `${primary.foodName} bowl ${sideNames.join(' và ')}`.trim();
  }

  if (groups.has('protein') && sideNames.length) {
    return `${primary.foodName} xào ${sideNames.join(' và ')}`;
  }

  if (sideNames.length) {
    return buildSmartFallbackRecipeName(foods, mealType);
  }

  return `Món ${primary.foodName}`;
}

function buildCookingSteps(recipeName: string, foods: InventoryPriorityFood[]) {
  const names = foods.map((food) => food.foodName).join(', ');
  const primary = choosePrimaryFood(foods);
  const primaryName = primary?.foodName || 'nguyên liệu chính';

  return [
    `Sơ chế ${names}.`,
    `Nấu chín ${primaryName} với lượng vừa đủ.`,
    'Kết hợp các nguyên liệu còn lại, nêm gia vị theo khẩu vị.',
    `Trình bày và dùng ngay món ${recipeName}.`
  ];
}

function buildSmartFallbackRecipeName(foods: InventoryPriorityFood[], mealType: string) {
  const primary = choosePrimaryFood(foods);
  if (!primary) return 'Mon ngon tu inventory';

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

  if (['SNACK', 'AFTERNOON', 'LATE_NIGHT'].includes(mealType) && (fruit || dairy)) {
    if (fruit && dairy) return `Sua chua ${fruit}`;
    if (fruit) return `Sinh to ${fruit}`;
    if (dairy) return `${dairy} ngu coc`;
  }

  if (protein && carb && vegetable) return `${protein} ap chao an kem ${carb}`;
  if (protein && vegetable) return `${protein} xao rau cu`;
  if (protein && carb) return `${protein} sot nhe an kem ${carb}`;
  if (carb && vegetable) return `${carb} rau cu`;
  if (protein) return `${protein} ap chao`;
  if (vegetable) return `Salad ${vegetable}`;
  if (fruit) return `Salad trai cay ${fruit}`;

  return `${primary.foodName} che bien nhanh`;
}

function buildComboPriorityReasons(foods: InventoryPriorityFood[], calorieTarget: number, weather?: string) {
  const reasons = new Set<string>();
  if (foods.length > 1) reasons.add(`Kết hợp ${foods.length} thực phẩm trong inventory`);
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

function buildAiRecipePrompt(input: {
  priorityFoods: InventoryPriorityFood[];
  allocations: MealCalorieAllocation[];
  preference: any;
  calorieMin: number;
  calorieMax: number;
  calorieTarget: number;
  weather?: string;
}) {
  const inventory = input.priorityFoods.slice(0, 30).map((food) => ({
    foodName: food.foodName,
    categoryName: food.categoryName,
    quantity: food.quantity,
    unit: food.unit,
    status: food.status,
    daysUntilExpiry: food.daysUntilExpiry,
    calories: food.calories,
    macroSummary: food.macroSummary
  }));

  return `You are a smart Vietnamese meal-planning chef.
Create recipe recommendations from this user inventory. Use realistic cooking knowledge and common recipe standards.

Hard rules:
- Return raw JSON only. No markdown.
- Recipe names must be natural dish names in Vietnamese or readable Vietnamese without patterns like "A + B", "A ket hop B", "Breakfast with ...", "Lunch with ...".
- Make recipes diverse. Do not repeat the same formula.
- For ENOUGH_INGREDIENTS recipes, only use available inventory ingredients and do not require missing items.
- For MISSING_INGREDIENTS recipes, you may add reasonable missing ingredients, but include all ingredients in the recipe.
- Calories must target the provided meal slot allocation. The total selected slots should stay in the daily range ${input.calorieMin}-${Number.isFinite(input.calorieMax) ? input.calorieMax : 'unlimited'} kcal.
- Prefer near-expiry foods, user preferences, and balanced macros.

User preferences:
${JSON.stringify(input.preference || {}, null, 2)}

Weather context:
${input.weather || 'not provided'}

Meal calorie allocations:
${JSON.stringify(input.allocations, null, 2)}

Inventory:
${JSON.stringify(inventory, null, 2)}

Return a JSON array with 2 recipes per meal slot if possible. Each object:
{
  "recipeName": "natural dish name",
  "description": "short Vietnamese description",
  "mealType": "BREAKFAST | LUNCH | AFTERNOON | DINNER | LATE_NIGHT",
  "availabilityStatus": "ENOUGH_INGREDIENTS | MISSING_INGREDIENTS",
  "calories": estimated recipe kcal,
  "macroSummary": { "protein": grams, "carbs": grams, "fat": grams },
  "ingredients": [
    { "ingredientName": "name", "quantity": number, "unit": "g|ml|item|serving", "isRequired": true }
  ],
  "missingIngredients": [
    { "ingredientName": "name", "quantity": number, "unit": "g|ml|item|serving", "categoryName": "optional category" }
  ],
  "steps": ["step 1", "step 2", "step 3"],
  "cookingTime": number,
  "difficulty": "EASY | MEDIUM | HARD",
  "priorityReasons": ["reason"]
}`;
}

async function generateAiRecipeDrafts(input: {
  priorityFoods: InventoryPriorityFood[];
  allocations: MealCalorieAllocation[];
  preference: any;
  calorieMin: number;
  calorieMax: number;
  calorieTarget: number;
  weather?: string;
}): Promise<AiRecipeDraft[]> {
  const genAI = getGenAI();
  if (!genAI || !input.priorityFoods.length) return [];

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const response = await model.generateContent(buildAiRecipePrompt(input));
    return normalizeAiRecipeDrafts(
      parseJsonFromAiText<AiRecipeDraft[]>(response.response.text(), []),
      input.allocations
    );
  } catch (error: any) {
    console.error('[GEMINI smart meal recipe error]', error.message);
    return [];
  }
}

function normalizeAiRecipeDrafts(
  drafts: AiRecipeDraft[],
  allocations: MealCalorieAllocation[]
): AiRecipeDraft[] {
  const validMealTypes = new Set(allocations.map((allocation) => allocation.mealType));

  return (Array.isArray(drafts) ? drafts : [])
    .map((draft, index) => {
      const mealType = validMealTypes.has(String(draft.mealType))
        ? String(draft.mealType)
        : allocations[index % Math.max(1, allocations.length)]?.mealType;
      const availabilityStatus: AvailabilityStatus =
        draft.availabilityStatus === 'MISSING_INGREDIENTS'
          ? 'MISSING_INGREDIENTS'
          : 'ENOUGH_INGREDIENTS';

      return {
        ...draft,
        mealType,
        availabilityStatus,
        calories: Number(draft.calories) || undefined,
        macroSummary: draft.macroSummary
          ? {
              protein: Number(draft.macroSummary.protein) || 0,
              carbs: Number(draft.macroSummary.carbs) || 0,
              fat: Number(draft.macroSummary.fat) || 0
            }
          : undefined,
        steps: Array.isArray(draft.steps) ? draft.steps : draft.cookingSteps
      };
    })
    .filter(
      (draft) =>
        Boolean(String(draft.recipeName || '').trim()) &&
        Boolean(draft.mealType) &&
        (Array.isArray(draft.ingredients) || Array.isArray(draft.missingIngredients))
    );
}

function buildFallbackRecipeDrafts(
  priorityFoods: InventoryPriorityFood[],
  allocations: MealCalorieAllocation[],
  calorieTarget: number,
  weather?: string
): AiRecipeDraft[] {
  const drafts: AiRecipeDraft[] = [];
  const usedFoodIds = new Set<string>();

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
      const recipeName = buildSmartFallbackRecipeName(combo, allocation.mealType);
      drafts.push({
        recipeName,
        description: `Recipe generated from available inventory for ${getMealTypeLabel(allocation.mealType)}.`,
        mealType: allocation.mealType,
        availabilityStatus: 'ENOUGH_INGREDIENTS',
        ingredients: combo.map(buildIngredientFromFood),
        cookingSteps: buildCookingSteps(recipeName, combo),
        cookingTime: ['AFTERNOON', 'LATE_NIGHT'].includes(allocation.mealType) ? 10 : 20,
        difficulty: 'EASY',
        priorityReasons: buildComboPriorityReasons(combo, calorieTarget, weather)
      });
    }

    const baseFood = combo[0] || priorityFoods[index % Math.max(1, priorityFoods.length)];
    if (baseFood) {
      const extraName = getFoodGroup(baseFood) === 'fruit' ? 'yogurt' : 'rau xanh';
      drafts.push({
        recipeName:
          getFoodGroup(baseFood) === 'fruit'
            ? `Sua chua ${baseFood.foodName}`
            : `${baseFood.foodName} sot rau cu`,
        description: 'Recipe suggestion may need a few extra ingredients from shopping list.',
        mealType: allocation.mealType,
        availabilityStatus: 'MISSING_INGREDIENTS',
        ingredients: [
          buildIngredientFromFood(baseFood),
          { ingredientName: extraName, quantity: 1, unit: 'serving', isRequired: true }
        ],
        cookingSteps: [
          `So che ${baseFood.foodName}.`,
          `Chuan bi ${extraName} va gia vi vua an.`,
          'Che bien nhanh, trinh bay gon va dung ngay.'
        ],
        cookingTime: 15,
        difficulty: 'EASY',
        priorityReasons: ['Can mua them nguyen lieu de mon an day du hon']
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
    return name && all.findIndex((item) => normalize(String(item.ingredientName || '')) === name) === index;
  });

  return rawIngredients
    .map((ingredient) => {
      const ingredientName = String(ingredient.ingredientName || '').trim();
      if (!ingredientName) return null;
      const matchedFood = priorityFoods.find((food) => matchesIngredient(food.foodName, ingredientName));
      return {
        ingredientName: matchedFood?.foodName || ingredientName,
        categoryId: matchedFood?.categoryId,
        categoryName: (ingredient as any).categoryName,
        quantity: Number(ingredient.quantity) > 0 ? roundQuantity(Number(ingredient.quantity)) : 1,
        unit: ingredient.unit || matchedFood?.unit || 'serving',
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
  let nutrition = await calculateNutritionForIngredients(currentIngredients);
  const calories = Number(nutrition.calories) || 0;

  if (!calories || isWithinCalorieRange(calories, allocation.min, allocation.max)) {
    return { ingredients: currentIngredients, nutrition };
  }

  const scale = allocation.target / calories;
  if (!Number.isFinite(scale) || scale <= 0) return { ingredients: currentIngredients, nutrition };

  currentIngredients = currentIngredients.map((ingredient) => {
    const matchedFood = findMatchingFood(ingredient, priorityFoods);
    const scaledQuantity = roundQuantity((Number(ingredient.quantity) || 1) * scale);
    const cappedQuantity =
      availabilityStatus === 'ENOUGH_INGREDIENTS' && matchedFood && normalize(matchedFood.unit) === normalize(ingredient.unit)
        ? Math.min(scaledQuantity, Number(matchedFood.quantity) || scaledQuantity)
        : scaledQuantity;

    return {
      ...ingredient,
      quantity: Math.max(0.1, cappedQuantity)
    };
  });

  nutrition = await calculateNutritionForIngredients(currentIngredients);
  return { ingredients: currentIngredients, nutrition };
}

function dedupeRecommendations(items: any[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const signature = buildIngredientSignature(item.recipe?.ingredients || []);
    const stepSignature = buildStepSignature(item.recipe?.cookingSteps || []);
    const key = `${normalize(item.recipe?.recipeName || '')}:${signature}:${stepSignature}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildGeneratedRecipe(userId: string, foods: InventoryPriorityFood[], mealType: string, data: any) {
  const ingredients = foods.map(buildIngredientFromFood);
  const nutrition = await calculateNutritionForIngredients(ingredients);
  const recipeName = buildSmartFallbackRecipeName(foods, mealType);
  const cookingSteps = buildCookingSteps(recipeName, foods);
  const priorityReasons = buildComboPriorityReasons(foods, Number(data.calorieTarget || 0), data.weather);
  const signature = buildRecipeSignature(foods);
  const signatureTag = `FORMULA:${signature}`;
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
      description: `AI suggestion generated from inventory: ${foods.map((food) => food.foodName).join(', ')}. ${priorityReasons.join(' - ')}`,
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
    { new: true, upsert: true, setDefaultsOnInsert: true }
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
  const signatureTag = `FORMULA:${signature}`;
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
      `AI recipe for ${getMealTypeLabel(draftMealType)}. Target ${allocation.target} kcal.`,
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
    { new: true, upsert: true, setDefaultsOnInsert: true }
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

  const foods = await FoodItem.find({
    userId,
    ownerType: 'USER',
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
        unit: food.unit
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
  const aiDrafts = await generateAiRecipeDrafts({
    priorityFoods,
    allocations: calorieAllocations,
    preference,
    calorieMin,
    calorieMax,
    calorieTarget,
    weather: data.weather
  });
  const fallbackDrafts = buildFallbackRecipeDrafts(
    priorityFoods,
    calorieAllocations,
    calorieTarget,
    data.weather
  );
  const draftPool = aiDrafts.length ? [...aiDrafts, ...fallbackDrafts] : fallbackDrafts;
  const generatedRecommendations = [];

  for (const allocation of calorieAllocations) {
    const mealDrafts = draftPool
      .filter((draft) => !draft.mealType || draft.mealType === allocation.mealType)
      .slice(0, 4);

    for (const draft of mealDrafts) {
      const recommendation = await buildGeneratedRecipeFromDraft(
        userId,
        { ...draft, mealType: allocation.mealType },
        allocation,
        priorityFoods,
        {
          ...data,
          calorieTarget
        }
      );
      const recipeCalories = Number(recommendation.recipe?.calories) || 0;
      if (
        recipeCalories > 0 &&
        !isWithinCalorieRange(recipeCalories, allocation.min, allocation.max)
      ) {
        continue;
      }
      generatedRecommendations.push(recommendation);
    }
  }

  const recipes = await Recipe.find({
    isActive: true,
    $or: [
      { sourceType: 'SYSTEM' },
      { createdBy: userId }
    ]
  });
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
          ? ['Near expiry match']
          : ['Inventory match'],
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
    calorieTarget,
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
  const urlParts = videoUrl
    .replace(/^https?:\/\//, '')
    .split(/[/?#=&_-]+/)
    .filter(Boolean);
  const readableTokens = urlParts
    .slice(-6)
    .map((part) => part.replace(/\d+/g, '').trim())
    .filter((part) => part.length > 2);

  const recipeName = data.recipeName || readableTokens.join(' ') || 'Video extracted recipe';
  const extractedIngredients = Array.isArray(data.ingredients) && data.ingredients.length
    ? data.ingredients
    : [
        { ingredientName: 'Main ingredient', quantity: 1, unit: 'serving' },
        { ingredientName: 'Seasoning', quantity: 1, unit: 'serving' }
      ];

  const source = await VideoRecipeSource.create({
    userId,
    videoUrl,
    platform,
    extractedText: data.extractedText || `Recipe draft extracted from ${platform} video.`,
    extractedIngredients,
    missingIngredients: [],
    status: 'SUCCESS'
  });

  const generatedRecipe = {
    recipeName,
    description: `Draft extracted from ${platform} video.`,
    ingredients: extractedIngredients,
    sourceType: 'VIDEO_EXTRACTED',
    videoSourceId: source._id,
    tags: ['VIDEO_EXTRACTED']
  };

  await AIGeneratedData.create({
    dataType: 'RECIPE',
    generatedContent: generatedRecipe,
    status: 'PENDING_REVIEW'
  });

  return {
    source,
    extractedRecipe: generatedRecipe
  };
}
