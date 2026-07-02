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

async function resolveMealPayload(meal: any) {
  const payload: any = {
    mealType: meal.mealType,
    recipeId: meal.recipeId,
    recipeName: meal.recipeName,
    imageUrl: meal.imageUrl,
    scheduledTime: meal.scheduledTime,
    calories: Number(meal.calories) || 0,
    macroSummary: meal.macroSummary || { protein: 0, carbs: 0, fat: 0 },
    status: meal.status || 'PENDING',
    usedFoodItemIds: Array.isArray(meal.usedFoodItemIds) ? meal.usedFoodItemIds : []
  };

  if (!payload.mealType) throw new Error('mealType is required');

  if (payload.recipeId) {
    const recipe = await Recipe.findById(payload.recipeId);
    if (!recipe || !recipe.isActive) throw new Error('Recipe not found');

    payload.recipeName = payload.recipeName || recipe.recipeName;
    payload.imageUrl = payload.imageUrl || recipe.imageUrl;
    payload.calories = Number(meal.calories) > 0
      ? Number(meal.calories)
      : Number(recipe.calories) || 0;
    payload.macroSummary = hasMacroValue(meal.macroSummary)
      ? meal.macroSummary
      : recipe.macroSummary || { protein: 0, carbs: 0, fat: 0 };
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

function getMealLabel(mealType: string) {
  if (mealType === 'BREAKFAST') return 'Breakfast';
  if (mealType === 'LUNCH') return 'Lunch';
  if (mealType === 'DINNER') return 'Dinner';
  return 'Snack';
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

async function buildGeneratedRecipe(userId: string, food: InventoryPriorityFood, mealType: string, data: any) {
  const ingredient = {
    ingredientName: food.foodName,
    categoryId: food.categoryId,
    quantity: Number(food.quantity) || 1,
    unit: food.unit || 'serving',
    isRequired: true
  };
  const nutrition = await calculateNutritionForIngredients([ingredient]);
  const mealLabel = getMealLabel(mealType);
  const recipeName = `${mealLabel} with ${food.foodName}`;
  const priorityReasons = buildPriorityReason(food, Number(data.calorieTarget || 0), data.weather);
  const tags = [
    'AI_GENERATED',
    mealType,
    food.status === 'NEAR_EXPIRY' || food.daysUntilExpiry <= 3 ? 'NEAR_EXPIRY' : 'INVENTORY',
    ...(data.weather ? [`WEATHER_${String(data.weather).toUpperCase()}`] : [])
  ];

  return Recipe.findOneAndUpdate(
    {
      recipeName,
      createdBy: userId,
      sourceType: 'AI_GENERATED'
    },
    {
      recipeName,
      description: `AI suggestion generated from inventory item "${food.foodName}". ${priorityReasons.join(' - ')}`,
      cookingSteps: [
        `Prepare ${food.foodName}.`,
        'Season to taste.',
        `Cook and serve for ${mealLabel.toLowerCase()}.`
      ],
      cookingTime: mealType === 'SNACK' ? 10 : 20,
      difficulty: 'EASY',
      calories: nutrition.calories,
      macroSummary: nutrition.macroSummary,
      tags,
      ingredients: [ingredient],
      sourceType: 'AI_GENERATED',
      createdBy: userId,
      isActive: true
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function generateDailyMealPlan(userId: string, data: any = {}) {
  const planDate = startOfDay(data.planDate || new Date());
  const preference = await UserPreference.findOne({ userId });
  const calorieTarget = Number(data.calorieTarget || preference?.calorieTarget || 2000);
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
      return Math.abs((a.calories || 0) - calorieTarget / selectedMealTypes.length) -
        Math.abs((b.calories || 0) - calorieTarget / selectedMealTypes.length);
    });

  const generatedRecipes = [];
  const usedFoodIds = new Set<string>();

  for (const mealType of selectedMealTypes) {
    const food = priorityFoods.find((item) => !usedFoodIds.has(String(item._id)));
    if (!food) break;
    usedFoodIds.add(String(food._id));
    const recipe = await buildGeneratedRecipe(userId, food, mealType, {
      ...data,
      calorieTarget
    });
    generatedRecipes.push({
      recipe,
      score: Math.max(1, 100 - Math.max(0, food.daysUntilExpiry) * 8),
      matchedFoods: [
        {
          _id: food._id,
          foodName: food.foodName,
          status: food.status,
          expiryDate: food.expiryDate
        }
      ],
      priorityReasons: buildPriorityReason(food, calorieTarget, data.weather)
    });
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
      return { recipe, ...scoring };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const recommendations = [
    ...generatedRecipes,
    ...scoredRecipes.map((item) => ({
      recipe: item.recipe,
      score: item.score,
      matchedFoods: item.matchedFoods.map((food) => ({
        _id: food._id,
        foodName: food.foodName,
        status: food.status,
        expiryDate: food.expiryDate
      })),
      priorityReasons: item.matchedFoods.some((food) => food.status === 'NEAR_EXPIRY')
        ? ['Near expiry match']
        : ['Inventory match']
    }))
  ];

  return {
    plan: null,
    generatedRecipes: generatedRecipes.map((item) => item.recipe),
    inventoryPriority: priorityFoods,
    recommendations: recommendations.slice(0, 12),
    planDate,
    calorieTarget
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
