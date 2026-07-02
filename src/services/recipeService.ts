import { Recipe } from '../models/recipe.model';
import { calculateNutritionForIngredients } from './nutritionService';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const allowedRecipeFields = [
  'recipeName',
  'description',
  'imageUrl',
  'cookingSteps',
  'cookingTime',
  'difficulty',
  'calories',
  'macroSummary',
  'tags',
  'ingredients',
  'sourceType',
  'videoSourceId',
  'isActive'
];

async function buildRecipePayload(data: any, userId: string, isAdmin = false) {
  if (!data.recipeName?.trim()) throw new Error('recipeName is required');

  const payload: any = {};
  for (const field of allowedRecipeFields) {
    if (data[field] !== undefined) payload[field] = data[field];
  }

  payload.recipeName = data.recipeName.trim();
  payload.tags = Array.isArray(data.tags)
    ? data.tags.map((tag: string) => String(tag).trim()).filter(Boolean)
    : [];
  payload.cookingSteps = Array.isArray(data.cookingSteps)
    ? data.cookingSteps.map((step: string) => String(step).trim()).filter(Boolean)
    : [];
  payload.ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
  payload.sourceType = isAdmin ? (data.sourceType || 'SYSTEM') : 'USER_CREATED';

  const shouldCalculate =
    payload.ingredients.length > 0 &&
    (data.calories === undefined || data.macroSummary === undefined || data.recalculateNutrition);

  if (shouldCalculate) {
    const nutrition = await calculateNutritionForIngredients(payload.ingredients);
    payload.calories = nutrition.calories;
    payload.macroSummary = nutrition.macroSummary;
  }

  if (!payload.macroSummary) {
    payload.macroSummary = { protein: 0, carbs: 0, fat: 0 };
  }

  if (!isAdmin) {
    delete payload.isActive;
    delete payload.videoSourceId;
  }

  payload.createdBy = userId;
  return payload;
}

export async function listRecipes(userId: string, query: any = {}, isAdmin = false) {
  const filter: any = {};

  if (!isAdmin) {
    filter.isActive = true;
    filter.$or = [{ sourceType: 'SYSTEM' }, { createdBy: userId }];
  } else if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true' || query.isActive === true;
  }

  if (query.sourceType) filter.sourceType = query.sourceType;
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.tag) filter.tags = query.tag;
  if (query.q) filter.recipeName = new RegExp(escapeRegex(String(query.q)), 'i');
  if (query.mine === 'true') filter.createdBy = userId;

  return Recipe.find(filter)
    .populate('createdBy', 'fullName email role')
    .sort({ updatedAt: -1, recipeName: 1 });
}

export async function getRecipeById(recipeId: string, userId: string, isAdmin = false) {
  const filter: any = { _id: recipeId };
  if (!isAdmin) filter.isActive = true;

  const recipe = await Recipe.findOne(filter).populate('createdBy', 'fullName email role');
  if (!recipe) throw new Error('Recipe not found');
  return recipe;
}

export async function createRecipe(userId: string, data: any, isAdmin = false) {
  const payload = await buildRecipePayload(data, userId, isAdmin);
  return Recipe.create(payload);
}

export async function updateRecipe(recipeId: string, userId: string, data: any, isAdmin = false) {
  const filter: any = { _id: recipeId };
  if (!isAdmin) {
    filter.createdBy = userId;
    filter.isActive = true;
  }

  const recipe = await Recipe.findOne(filter);
  if (!recipe) throw new Error('Recipe not found or not editable');

  const merged = {
    ...recipe.toObject(),
    ...data,
    recipeName: data.recipeName ?? recipe.recipeName
  };
  const payload = await buildRecipePayload(merged, userId, isAdmin);
  delete payload.createdBy;

  return Recipe.findByIdAndUpdate(recipeId, payload, { new: true })
    .populate('createdBy', 'fullName email role');
}

export async function deleteRecipe(recipeId: string, userId: string, isAdmin = false) {
  const filter: any = { _id: recipeId };
  if (!isAdmin) {
    filter.createdBy = userId;
    filter.isActive = true;
  }

  const recipe = await Recipe.findOne(filter);
  if (!recipe) throw new Error('Recipe not found or not editable');

  await Recipe.findByIdAndUpdate(recipeId, { isActive: false });
  return { message: 'Recipe deleted successfully' };
}
