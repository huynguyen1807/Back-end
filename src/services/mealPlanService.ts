import { MealPlan } from '../models/mealPlan.model';
import { FoodItem } from '../models/foodItem.model';
import { AIGeneratedData } from '../models/aiGeneratedData.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { Recipe } from '../models/recipe.model';
import { UserPreference } from '../models/userPreference.model';
import { VideoRecipeSource } from '../models/videoRecipeSource.model';
import { calculateMealTotals, endOfDay, startOfDay } from './nutritionService';

type InventoryPriorityFood = {
  _id: any;
  foodName: string;
  quantity: number;
  unit: string;
  status: string;
  expiryDate: Date;
  daysUntilExpiry: number;
  categoryName?: string;
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
    payload.calories = meal.calories !== undefined ? Number(meal.calories) : Number(recipe.calories) || 0;
    payload.macroSummary = meal.macroSummary || recipe.macroSummary || { protein: 0, carbs: 0, fat: 0 };
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
    totalCalories: data.totalCalories ?? totals.totalCalories,
    macroSummary: data.macroSummary ?? totals.macroSummary,
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

async function createFallbackMeal(food: any, mealType: string, calorieTarget: number) {
  const fact = await NutritionFact.findOne({
    foodName: new RegExp(`^${food.foodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    status: 'OFFICIAL'
  });

  const quantity = Number(food.quantity) || 1;
  const calories = fact ? Math.round(quantity * Number(fact.caloriesPerUnit || 0)) : Math.round(calorieTarget / 4);

  return {
    mealType,
    recipeName: `Use ${food.foodName}`,
    scheduledTime: mealType === 'BREAKFAST' ? '08:00' : mealType === 'LUNCH' ? '12:30' : mealType === 'DINNER' ? '19:00' : '15:30',
    calories,
    macroSummary: {
      protein: fact ? Math.round(quantity * Number(fact.protein || 0)) : 0,
      carbs: fact ? Math.round(quantity * Number(fact.carbs || 0)) : 0,
      fat: fact ? Math.round(quantity * Number(fact.fat || 0)) : 0
    },
    status: 'PENDING',
    usedFoodItemIds: [food._id]
  };
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

  const priorityFoods: InventoryPriorityFood[] = foods
    .map((food) => ({
      _id: food._id,
      foodName: food.foodName,
      quantity: food.quantity,
      unit: food.unit,
      status: food.status,
      expiryDate: food.expiryDate,
      daysUntilExpiry: expiryPriority(food.expiryDate),
      categoryName: typeof food.categoryId === 'object' ? (food.categoryId as any).categoryName : undefined
    }))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const recipes = await Recipe.find({ isActive: true, sourceType: { $in: ['SYSTEM', 'AI_GENERATED'] } });
  const scoredRecipes = recipes
    .map((recipe) => {
      const scoring = recipeInventoryScore(recipe, foods);
      return { recipe, ...scoring };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const meals: any[] = [];
  const usedRecipeIds = new Set<string>();

  for (const mealType of selectedMealTypes) {
    const candidate = scoredRecipes.find((item) => !usedRecipeIds.has(item.recipe._id.toString()));
    if (candidate) {
      usedRecipeIds.add(candidate.recipe._id.toString());
      meals.push({
        mealType,
        recipeId: candidate.recipe._id,
        recipeName: candidate.recipe.recipeName,
        imageUrl: candidate.recipe.imageUrl,
        scheduledTime: mealType === 'BREAKFAST' ? '08:00' : mealType === 'LUNCH' ? '12:30' : mealType === 'DINNER' ? '19:00' : '15:30',
        calories: Number(candidate.recipe.calories) || Math.round(calorieTarget / selectedMealTypes.length),
        macroSummary: candidate.recipe.macroSummary || { protein: 0, carbs: 0, fat: 0 },
        status: 'PENDING',
        usedFoodItemIds: candidate.matchedFoods.map((food) => food._id)
      });
      continue;
    }

    const fallbackFood = priorityFoods[meals.length % Math.max(1, priorityFoods.length)];
    if (fallbackFood) {
      meals.push(await createFallbackMeal(fallbackFood, mealType, calorieTarget));
    }
  }

  const totals = calculateMealTotals(meals);
  const payload = {
    userId,
    planDate,
    goal: data.goal || preference?.dietaryGoal || 'HEALTHY_EATING',
    totalCalories: totals.totalCalories,
    macroSummary: totals.macroSummary,
    meals,
    generatedBy: 'AI',
    note: `Generated from ${priorityFoods.length} inventory item(s), prioritizing near-expiry food.`
  };

  const plan = await MealPlan.findOneAndUpdate(
    { userId, planDate },
    payload,
    { new: true, upsert: true }
  ).populate('meals.recipeId', 'recipeName imageUrl calories macroSummary');

  return {
    plan,
    inventoryPriority: priorityFoods,
    recommendations: scoredRecipes.slice(0, 8).map((item) => ({
      recipe: item.recipe,
      score: item.score,
      matchedFoods: item.matchedFoods.map((food) => ({
        _id: food._id,
        foodName: food.foodName,
        status: food.status,
        expiryDate: food.expiryDate
      }))
    })),
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
