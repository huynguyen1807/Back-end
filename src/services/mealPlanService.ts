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

async function findExistingRecipeBySignature(userId: string, signature: string, signatureTag: string) {
  const candidates = await Recipe.find({
    isActive: true,
    $or: [
      { sourceType: 'SYSTEM' },
      { createdBy: userId, sourceType: 'AI_GENERATED' }
    ]
  });

  return candidates.find((recipe: any) => {
    const recipeTags = recipe.tags || [];
    return recipeTags.includes(signatureTag) ||
      buildIngredientSignature(recipe.ingredients || []) === signature;
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
    return `${primary.foodName} kết hợp ${sideNames.join(' và ')}`;
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

function dedupeRecommendations(items: any[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.recipe?._id || item.recipe?.recipeName || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildGeneratedRecipe(userId: string, foods: InventoryPriorityFood[], mealType: string, data: any) {
  const ingredients = foods.map(buildIngredientFromFood);
  const nutrition = await calculateNutritionForIngredients(ingredients);
  const recipeName = buildGeneratedRecipeName(foods, mealType);
  const priorityReasons = buildComboPriorityReasons(foods, Number(data.calorieTarget || 0), data.weather);
  const signature = buildRecipeSignature(foods);
  const signatureTag = `FORMULA:${signature}`;
  const existingRecipe = await findExistingRecipeBySignature(userId, signature, signatureTag);

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
      cookingSteps: buildCookingSteps(recipeName, foods),
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

  const generatedRecipes = [];
  const usedFoodIds = new Set<string>();

  for (const [index, mealType] of selectedMealTypes.entries()) {
    const comboFoods = selectFoodCombo(
      priorityFoods,
      usedFoodIds,
      mealType,
      calorieTarget,
      calorieMin,
      calorieMax,
      selectedMealTypes.length - index
    );
    if (!comboFoods.length) break;

    comboFoods.forEach((food) => usedFoodIds.add(String(food._id)));
    const recipe = await buildGeneratedRecipe(userId, comboFoods, mealType, {
      ...data,
      calorieTarget
    });
    generatedRecipes.push({
      recipe,
      score: Math.max(
        1,
        100 - Math.max(0, Math.min(...comboFoods.map((food) => food.daysUntilExpiry))) * 8
      ),
      matchedFoods: comboFoods.map((food) => ({
        _id: food._id,
        foodName: food.foodName,
        status: food.status,
        expiryDate: food.expiryDate
      })),
      priorityReasons: buildComboPriorityReasons(comboFoods, calorieTarget, data.weather)
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
    .filter(
      (item) =>
        item.score > 0 &&
        isWithinCalorieRange(Number(item.recipe.calories) || 0, calorieMin, calorieMax)
    )
    .sort((a, b) => b.score - a.score);

  const recommendations = dedupeRecommendations([
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
  ]).sort((a, b) => Number(b.score) - Number(a.score));

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
