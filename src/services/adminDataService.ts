import { AdminAuditLog } from '../models/adminAuditLog.model';
import { AIGeneratedData } from '../models/aiGeneratedData.model';
import { FoodCategory } from '../models/foodCategory.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { StorageRule } from '../models/storageRule.model';
import {
  createRecipe,
  deleteRecipe,
  getRecipeById,
  listRecipes,
  updateRecipe
} from './recipeService';
import { listNutritionFacts, resolveCategory } from './nutritionService';
import { normalizeFoodText } from '../utils/foodCategoryValidation';
import { defaultNutritionBaseQuantity } from '../utils/nutritionUnits';

async function logAdminAction(
  adminId: string,
  action: string,
  targetCollection: string,
  targetId: any,
  oldValue: any,
  newValue: any
) {
  await AdminAuditLog.create({
    adminId,
    action,
    targetCollection,
    targetId,
    oldValue,
    newValue
  });
}

function normalizeStringList(value: any) {
  if (value === undefined) return undefined;
  const rawList = Array.isArray(value) ? value : String(value).split(',');
  const seen = new Set<string>();

  return rawList
    .map((item: any) => String(item).trim())
    .filter(Boolean)
    .filter((item: string) => {
      const key = normalizeFoodText(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function assertUniqueCategoryName(categoryName: string, ignoreCategoryId?: string) {
  const normalized = normalizeFoodText(categoryName);
  const categories = await FoodCategory.find({}).select('categoryName displayName').lean();
  const duplicate = categories.find((category: any) => {
    if (ignoreCategoryId && String(category._id) === String(ignoreCategoryId)) return false;
    return normalizeFoodText(category.categoryName) === normalized || normalizeFoodText(category.displayName) === normalized;
  });

  if (duplicate) {
    throw new Error(`Food category "${categoryName}" duplicates existing category "${duplicate.displayName || duplicate.categoryName}"`);
  }
}

export async function listAdminNutritionFacts(query: any = {}) {
  return listNutritionFacts(query);
}

export async function createAdminNutritionFact(adminId: string, data: any) {
  const categoryId = await resolveCategory(data.categoryId, data.categoryName, adminId);

  if (!data.foodName?.trim()) throw new Error('foodName is required');
  if (data.caloriesPerUnit === undefined) throw new Error('caloriesPerUnit is required');
  if (!data.unit) throw new Error('unit is required');

  const created = await NutritionFact.create({
    foodName: data.foodName.trim(),
    aliases: normalizeStringList(data.aliases) ?? [],
    categoryId,
    caloriesPerUnit: Number(data.caloriesPerUnit),
    unit: data.unit,
    baseQuantity: Number(data.baseQuantity) > 0
      ? Number(data.baseQuantity)
      : defaultNutritionBaseQuantity(data.unit),
    protein: Number(data.protein) || 0,
    carbs: Number(data.carbs) || 0,
    fat: Number(data.fat) || 0,
    source: data.source || 'ADMIN',
    status: data.status || 'OFFICIAL',
    createdBy: adminId,
    reviewedBy: data.status === 'OFFICIAL' ? adminId : undefined
  });

  await logAdminAction(adminId, 'CREATE_NUTRITION_FACT', 'nutrition_facts', created._id, null, created);
  return created;
}

export async function updateAdminNutritionFact(adminId: string, factId: string, data: any) {
  const existing = await NutritionFact.findById(factId);
  if (!existing) throw new Error('Nutrition fact not found');

  const updateData: any = {};
  const fields = ['foodName', 'caloriesPerUnit', 'baseQuantity', 'unit', 'protein', 'carbs', 'fat', 'source', 'status'];

  for (const field of fields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  if (data.categoryId || data.categoryName) {
    updateData.categoryId = await resolveCategory(data.categoryId, data.categoryName, adminId);
  }
  if (data.aliases !== undefined) updateData.aliases = normalizeStringList(data.aliases);

  if (updateData.foodName) updateData.foodName = updateData.foodName.trim();
  if (updateData.caloriesPerUnit !== undefined) updateData.caloriesPerUnit = Number(updateData.caloriesPerUnit);
  if (updateData.baseQuantity !== undefined) {
    updateData.baseQuantity = Number(updateData.baseQuantity);
    if (!(updateData.baseQuantity > 0)) throw new Error('baseQuantity must be greater than 0');
  }
  if (updateData.protein !== undefined) updateData.protein = Number(updateData.protein) || 0;
  if (updateData.carbs !== undefined) updateData.carbs = Number(updateData.carbs) || 0;
  if (updateData.fat !== undefined) updateData.fat = Number(updateData.fat) || 0;
  if (updateData.status === 'OFFICIAL') updateData.reviewedBy = adminId;

  const updated = await NutritionFact.findByIdAndUpdate(factId, updateData, { returnDocument: 'after' })
    .populate('categoryId', 'categoryName');

  await logAdminAction(adminId, 'UPDATE_NUTRITION_FACT', 'nutrition_facts', factId, existing, updated);
  return updated;
}

export async function deleteAdminNutritionFact(adminId: string, factId: string) {
  const existing = await NutritionFact.findById(factId);
  if (!existing) throw new Error('Nutrition fact not found');

  await NutritionFact.findByIdAndDelete(factId);
  await logAdminAction(adminId, 'DELETE_NUTRITION_FACT', 'nutrition_facts', factId, existing, null);
  return { message: 'Nutrition fact deleted successfully' };
}

export async function listAdminRecipes(adminId: string, query: any = {}) {
  return listRecipes(adminId, query, true);
}

export async function getAdminRecipe(adminId: string, recipeId: string) {
  return getRecipeById(recipeId, adminId, true);
}

export async function createAdminRecipe(adminId: string, data: any) {
  const recipe = await createRecipe(adminId, data, true);
  await logAdminAction(adminId, 'CREATE_RECIPE', 'recipes', recipe._id, null, recipe);
  return recipe;
}

export async function updateAdminRecipe(adminId: string, recipeId: string, data: any) {
  const oldValue = await getRecipeById(recipeId, adminId, true);
  const updated = await updateRecipe(recipeId, adminId, data, true);
  await logAdminAction(adminId, 'UPDATE_RECIPE', 'recipes', recipeId, oldValue, updated);
  return updated;
}

export async function deleteAdminRecipe(adminId: string, recipeId: string) {
  const oldValue = await getRecipeById(recipeId, adminId, true);
  const result = await deleteRecipe(recipeId, adminId, true);
  await logAdminAction(adminId, 'DELETE_RECIPE', 'recipes', recipeId, oldValue, null);
  return result;
}

export async function listAdminFoodCategories(query: any = {}) {
  const filter: any = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true' || query.isActive === true;
  if (query.q) filter.categoryName = new RegExp(String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  return FoodCategory.find(filter).sort({ sortOrder: 1, categoryName: 1 });
}

export async function createAdminFoodCategory(adminId: string, data: any) {
  if (!data.categoryName?.trim()) throw new Error('categoryName is required');
  await assertUniqueCategoryName(data.categoryName.trim());
  if (data.displayName?.trim()) await assertUniqueCategoryName(data.displayName.trim());

  const created = await FoodCategory.create({
    categoryName: data.categoryName.trim(),
    displayName: data.displayName?.trim(),
    description: data.description,
    aliases: normalizeStringList(data.aliases) ?? [],
    keywords: normalizeStringList(data.keywords) ?? [],
    foodExamples: normalizeStringList(data.foodExamples) ?? [],
    sortOrder: Number(data.sortOrder) || 0,
    isActive: data.isActive ?? true,
    createdBy: adminId
  });

  await logAdminAction(adminId, 'CREATE_FOOD_CATEGORY', 'food_categories', created._id, null, created);
  return created;
}

export async function updateAdminFoodCategory(adminId: string, categoryId: string, data: any) {
  const existing = await FoodCategory.findById(categoryId);
  if (!existing) throw new Error('Food category not found');

  const updateData: any = {};
  if (data.categoryName !== undefined) {
    await assertUniqueCategoryName(data.categoryName.trim(), categoryId);
    updateData.categoryName = data.categoryName.trim();
  }
  if (data.displayName !== undefined) {
    if (data.displayName?.trim()) await assertUniqueCategoryName(data.displayName.trim(), categoryId);
    updateData.displayName = data.displayName?.trim();
  }
  if (data.description !== undefined) updateData.description = data.description;
  if (data.aliases !== undefined) updateData.aliases = normalizeStringList(data.aliases);
  if (data.keywords !== undefined) updateData.keywords = normalizeStringList(data.keywords);
  if (data.foodExamples !== undefined) updateData.foodExamples = normalizeStringList(data.foodExamples);
  if (data.sortOrder !== undefined) updateData.sortOrder = Number(data.sortOrder) || 0;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const updated = await FoodCategory.findByIdAndUpdate(categoryId, updateData, { returnDocument: 'after' });
  await logAdminAction(adminId, 'UPDATE_FOOD_CATEGORY', 'food_categories', categoryId, existing, updated);
  return updated;
}

export async function deleteAdminFoodCategory(adminId: string, categoryId: string) {
  const existing = await FoodCategory.findById(categoryId);
  if (!existing) throw new Error('Food category not found');

  const updated = await FoodCategory.findByIdAndUpdate(categoryId, { isActive: false }, { returnDocument: 'after' });
  await logAdminAction(adminId, 'DELETE_FOOD_CATEGORY', 'food_categories', categoryId, existing, updated);
  return { message: 'Food category deactivated successfully' };
}

export async function listAdminStorageRules(query: any = {}) {
  const filter: any = {};
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.storageType) filter.storageType = query.storageType;
  if (query.status) filter.status = query.status;

  return StorageRule.find(filter)
    .populate('categoryId', 'categoryName')
    .sort({ priority: -1, updatedAt: -1 });
}

export async function createAdminStorageRule(adminId: string, data: any) {
  const categoryId = await resolveCategory(data.categoryId, data.categoryName, adminId);
  if (!data.storageType) throw new Error('storageType is required');
  if (data.estimatedDays === undefined) throw new Error('estimatedDays is required');

  const created = await StorageRule.findOneAndUpdate(
    { categoryId, storageType: data.storageType },
    {
      categoryId,
      storageType: data.storageType,
      estimatedDays: Number(data.estimatedDays),
      instruction: data.instruction,
      warningMessage: data.warningMessage,
      priority: Number(data.priority) || 0,
      source: data.source || 'ADMIN',
      status: data.status || 'OFFICIAL',
      createdBy: adminId,
      reviewedBy: data.status === 'OFFICIAL' ? adminId : undefined
    },
    { returnDocument: 'after', upsert: true }
  ).populate('categoryId', 'categoryName');

  await logAdminAction(adminId, 'UPSERT_STORAGE_RULE', 'storage_rules', created._id, null, created);
  return created;
}

export async function updateAdminStorageRule(adminId: string, ruleId: string, data: any) {
  const existing = await StorageRule.findById(ruleId);
  if (!existing) throw new Error('Storage rule not found');

  const updateData: any = {};
  const fields = ['storageType', 'estimatedDays', 'instruction', 'warningMessage', 'priority', 'source', 'status'];
  for (const field of fields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }
  if (data.categoryId || data.categoryName) {
    updateData.categoryId = await resolveCategory(data.categoryId, data.categoryName, adminId);
  }
  if (updateData.estimatedDays !== undefined) updateData.estimatedDays = Number(updateData.estimatedDays);
  if (updateData.priority !== undefined) updateData.priority = Number(updateData.priority) || 0;
  if (updateData.status === 'OFFICIAL') updateData.reviewedBy = adminId;

  const updated = await StorageRule.findByIdAndUpdate(ruleId, updateData, { returnDocument: 'after' })
    .populate('categoryId', 'categoryName');
  await logAdminAction(adminId, 'UPDATE_STORAGE_RULE', 'storage_rules', ruleId, existing, updated);
  return updated;
}

export async function deleteAdminStorageRule(adminId: string, ruleId: string) {
  const existing = await StorageRule.findById(ruleId);
  if (!existing) throw new Error('Storage rule not found');

  await StorageRule.findByIdAndDelete(ruleId);
  await logAdminAction(adminId, 'DELETE_STORAGE_RULE', 'storage_rules', ruleId, existing, null);
  return { message: 'Storage rule deleted successfully' };
}

export async function listAdminAiGeneratedData(query: any = {}) {
  const filter: any = {};
  if (query.status) filter.status = query.status;
  if (query.dataType) filter.dataType = query.dataType;

  return AIGeneratedData.find(filter).sort({ createdAt: -1 });
}

async function applyAiGeneratedContent(adminId: string, dataType: string, content: any) {
  if (dataType === 'FOOD_CATEGORY') {
    return createAdminFoodCategory(adminId, content);
  }
  if (dataType === 'STORAGE_RULE') {
    return createAdminStorageRule(adminId, content);
  }
  if (dataType === 'NUTRITION_FACT') {
    return createAdminNutritionFact(adminId, { ...content, status: 'OFFICIAL' });
  }
  if (dataType === 'RECIPE') {
    return createAdminRecipe(adminId, { ...content, sourceType: 'AI_GENERATED', isActive: true });
  }

  throw new Error('Unsupported AI data type');
}

export async function reviewAdminAiGeneratedData(adminId: string, aiDataId: string, data: any) {
  const item = await AIGeneratedData.findById(aiDataId);
  if (!item) throw new Error('AI-generated data not found');

  const action = data.action === 'REJECT' ? 'REJECT' : 'APPROVE';
  let officialRecord = null;

  if (action === 'APPROVE') {
    officialRecord = await applyAiGeneratedContent(adminId, item.dataType, item.generatedContent);
  }

  item.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  item.reviewedBy = adminId as any;
  item.reviewNote = data.reviewNote;
  item.reviewedAt = new Date();
  await item.save();

  await logAdminAction(
    adminId,
    `${action}_AI_GENERATED_DATA`,
    'ai_generated_data',
    item._id,
    null,
    { item, officialRecord }
  );

  return { item, officialRecord };
}
