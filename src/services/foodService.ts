import { FoodItem } from '../models/foodItem.model';
import { FoodCategory } from '../models/foodCategory.model';
import { StorageLocation } from '../models/storageLocation.model';
import { HouseholdMember } from '../models/householdMember.model';
import { Notification } from '../models/notification.model';
import { resolveNutritionForFood } from './nutritionService';
import {
  FoodCategoryLike,
  FoodCategoryValidationResult,
} from '../utils/foodCategoryValidation';
import { classifyFoodCategory } from './foodCategoryClassifierService';

const CATEGORY_SELECT = 'categoryName displayName description aliases keywords foodExamples sortOrder';

export async function getInventoryOwnerContext(userId: string) {
  const membership = await HouseholdMember.findOne({ userId, status: 'ACTIVE' }).sort({ joinedAt: 1 });

  if (membership) {
    return {
      ownerType: 'HOUSEHOLD',
      householdId: membership.householdId,
      userId
    };
  }

  return {
    ownerType: 'USER',
    userId
  };
}

export function buildOwnerQuery(context: any) {
  return context.ownerType === 'HOUSEHOLD'
    ? { ownerType: 'HOUSEHOLD', householdId: context.householdId }
    : { ownerType: 'USER', userId: context.userId };
}

// ─── Tính status dựa vào expiryDate ──────────────────────────────────────────
export function computeFoodStatus(expiryDate: Date): string {
  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'EXPIRED';
  if (diffDays <= 3) return 'NEAR_EXPIRY';
  return 'SAFE';
}

// ─── Tính freshnessScore (0–100) ─────────────────────────────────────────────
export function computeFreshnessScore(purchaseDate: Date, expiryDate: Date): number {
  const now = new Date();
  const total = expiryDate.getTime() - purchaseDate.getTime();
  const remaining = expiryDate.getTime() - now.getTime();
  if (total <= 0) return 0;
  const score = Math.round((remaining / total) * 100);
  return Math.max(0, Math.min(100, score));
}

function getCategoryId(item: any) {
  const category = item?.categoryId;
  if (!category) return undefined;
  return typeof category === 'object' ? category._id : category;
}

async function loadActiveCategories(): Promise<FoodCategoryLike[]> {
  return FoodCategory.find({ isActive: true }).select(CATEGORY_SELECT).sort({ sortOrder: 1, categoryName: 1 }).lean();
}

function applyCategoryValidationStatus(status: string, validation?: FoodCategoryValidationResult) {
  if (status === 'EXPIRED') return status;
  return validation?.isMismatch ? 'NEED_CHECK' : status;
}

function neutralCategoryValidation(): FoodCategoryValidationResult {
  return {
    isMismatch: false,
    confidence: 'NONE',
    matchedCategoryIds: [],
  };
}

async function createCategoryMismatchNotification(userId: string, foodItem: any, validation?: FoodCategoryValidationResult) {
  if (!validation?.isMismatch || !validation.warning) return;

  const exists = await Notification.findOne({
    userId,
    foodItemId: foodItem._id,
    type: 'STORAGE_WARNING',
    title: 'Cần kiểm tra danh mục',
  });

  if (exists) return;

  await Notification.create({
    userId,
    foodItemId: foodItem._id,
    householdId: foodItem.householdId,
    title: 'Cần kiểm tra danh mục',
    message: validation.warning,
    type: 'STORAGE_WARNING',
    priority: 'MEDIUM',
    isRead: false,
  });
}

async function enforceCategoryValidation(item: any, userId: string, categories?: FoodCategoryLike[], allowAi = false) {
  try {
    const raw = typeof item.toObject === 'function' ? item.toObject() : item;
    const categoryList = categories ?? await loadActiveCategories();
    const validation = await classifyFoodCategory({
      foodName: raw.foodName,
      selectedCategoryId: getCategoryId(raw),
      categories: categoryList,
      allowAi,
    });
    const nextStatus = applyCategoryValidationStatus(raw.status, validation);

    if (nextStatus !== raw.status) {
      if (typeof item.set === 'function') {
        item.set('status', nextStatus);
      } else {
        item.status = nextStatus;
      }
      await FoodItem.findByIdAndUpdate(raw._id, { status: nextStatus, updatedBy: userId });
    }

    if (validation.isMismatch) {
      await createCategoryMismatchNotification(userId, raw, validation);
    }

    return validation;
  } catch (error) {
    console.error('[food category validation error]', error);
    return neutralCategoryValidation();
  }
}

async function normalizeInventoryCategoryStatuses(context: any, userId: string) {
  const categories = await loadActiveCategories();
  const items = await FoodItem.find({
    ...buildOwnerQuery(context),
    isDeleted: false,
    isConsumed: false,
    quantity: { $gt: 0 },
  }).populate('categoryId', CATEGORY_SELECT);

  await Promise.all(items.map((item) => enforceCategoryValidation(item, userId, categories)));
}

async function enrichFoodNutrition(
  item: any,
  categoryValidation?: FoodCategoryValidationResult,
  categories?: FoodCategoryLike[],
) {
  const raw = typeof item.toObject === 'function' ? item.toObject() : item;
  const categoryId = getCategoryId(raw);
  const categoryList = categories ?? await loadActiveCategories();
  let resolvedCategoryValidation = categoryValidation ?? neutralCategoryValidation();
  if (!categoryValidation) {
    try {
      resolvedCategoryValidation = await classifyFoodCategory({
        foodName: raw.foodName,
        selectedCategoryId: categoryId,
        categories: categoryList,
        allowAi: false,
      });
    } catch (error) {
      console.error('[food category response validation error]', error);
      resolvedCategoryValidation = neutralCategoryValidation();
    }
  }
  const nutrition = await resolveNutritionForFood({
    foodName: raw.foodName,
    categoryId,
    quantity: raw.quantity,
    unit: raw.unit
  });

  return {
    ...raw,
    calories: nutrition.calories,
    macroSummary: nutrition.macroSummary,
    nutrition: {
      calories: nutrition.calories,
      macroSummary: nutrition.macroSummary,
      matched: nutrition.matched,
      nutritionFactId: nutrition.nutritionFactId,
      unit: nutrition.unit
    },
    categoryValidation: resolvedCategoryValidation,
    categoryWarning: resolvedCategoryValidation.warning,
    recommendedCategoryName: resolvedCategoryValidation.recommendedCategoryName,
  };
}

// ─── GET all food items của user ─────────────────────────────────────────────
export async function getFoodItems(userId: string, filter?: string) {
  const context = await getInventoryOwnerContext(userId);
  await normalizeInventoryCategoryStatuses(context, userId);
  const query: any = {
    ...buildOwnerQuery(context),
    isDeleted: false,
    isConsumed: false,
    quantity: { $gt: 0 },
  };

  if (filter === 'SAFE' || filter === 'NEAR_EXPIRY' || filter === 'EXPIRED' || filter === 'NEED_CHECK') {
    query.status = filter;
  }

  const items = await FoodItem.find(query)
    .populate('categoryId', CATEGORY_SELECT)
    .populate('storageLocationId', 'storageName storageType')
    .sort({ expiryDate: 1 });

  const categories = await loadActiveCategories();
  return Promise.all(items.map(async (item) => enrichFoodNutrition(item, await enforceCategoryValidation(item, userId, categories), categories)));
}

// ─── GET single food item ─────────────────────────────────────────────────────
export async function getFoodItemById(foodId: string, userId: string) {
  const context = await getInventoryOwnerContext(userId);
  const item = await FoodItem.findOne({ _id: foodId, ...buildOwnerQuery(context), isDeleted: false })
    .populate('categoryId', CATEGORY_SELECT)
    .populate('storageLocationId', 'storageName storageType description');

  if (!item) throw new Error('Food item not found');
  const categories = await loadActiveCategories();
  return enrichFoodNutrition(item, await enforceCategoryValidation(item, userId, categories), categories);
}

// ─── CREATE food item ─────────────────────────────────────────────────────────
export async function createFoodItem(userId: string, data: any) {
  const context = await getInventoryOwnerContext(userId);
  const {
    categoryId,
    storageLocationId,
    foodName,
    imageUrl,
    sourceType,
    expiryType,
    purchaseDate,
    expiryDate,
    quantity,
    unit,
  } = data;

  // Validate required fields
  if (!categoryId || !storageLocationId || !foodName || !sourceType || !expiryType || !purchaseDate || !expiryDate || !quantity || !unit) {
    throw new Error('Missing required fields');
  }

  // Validate category exists
  const category = await FoodCategory.findOne({ _id: categoryId, isActive: true });
  if (!category) throw new Error('Category not found');

  // Validate storage location belongs to user
  const location = await StorageLocation.findOne({ _id: storageLocationId, ...buildOwnerQuery(context), isActive: true });
  if (!location) throw new Error('Storage location not found or not available for this inventory');

  const expiry = new Date(expiryDate);
  const purchase = new Date(purchaseDate);
  const status = computeFoodStatus(expiry);
  const categories = await loadActiveCategories();
  const categoryValidation = await classifyFoodCategory({
    foodName: foodName.trim(),
    selectedCategoryId: category._id,
    categories,
    allowAi: true,
  });
  const freshnessScore = computeFreshnessScore(purchase, expiry);

  const foodItem = await FoodItem.create({
    ...buildOwnerQuery(context),
    categoryId,
    storageLocationId,
    foodName: foodName.trim(),
    imageUrl,
    sourceType,
    expiryType,
    purchaseDate: purchase,
    expiryDate: expiry,
    quantity,
    unit,
    status: applyCategoryValidationStatus(status, categoryValidation),
    freshnessScore,
    createdBy: userId,
  });

  const created = await FoodItem.findById(foodItem._id)
    .populate('categoryId', CATEGORY_SELECT)
    .populate('storageLocationId', 'storageName storageType');

  await createCategoryMismatchNotification(userId, foodItem, categoryValidation);
  return enrichFoodNutrition(created ?? foodItem, categoryValidation, categories);
}

// ─── UPDATE food item ─────────────────────────────────────────────────────────
export async function updateFoodItem(foodId: string, userId: string, data: any) {
  const context = await getInventoryOwnerContext(userId);
  const item = await FoodItem.findOne({ _id: foodId, ...buildOwnerQuery(context), isDeleted: false });
  if (!item) throw new Error('Food item not found');

  const allowedFields = [
    'foodName', 'imageUrl', 'categoryId', 'storageLocationId',
    'purchaseDate', 'expiryDate', 'quantity', 'unit', 'sourceType', 'expiryType',
  ];

  const updateData: any = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  if (updateData.storageLocationId) {
    const location = await StorageLocation.findOne({
      _id: updateData.storageLocationId,
      ...buildOwnerQuery(context),
      isActive: true
    });
    if (!location) throw new Error('Storage location not found or not available for this inventory');
  }

  const nextCategoryId = updateData.categoryId ?? item.categoryId;
  const category = await FoodCategory.findOne({ _id: nextCategoryId, isActive: true });
  if (!category) throw new Error('Category not found');

  const nextQuantity = updateData.quantity !== undefined
    ? Number(updateData.quantity)
    : Number(item.quantity);

  if (nextQuantity <= 0) {
    updateData.quantity = 0;
    updateData.isConsumed = true;
    updateData.consumedAt = new Date();
    updateData.updatedBy = userId;

    const consumed = await FoodItem.findByIdAndUpdate(foodId, updateData, { returnDocument: 'after' })
      .populate('categoryId', CATEGORY_SELECT)
      .populate('storageLocationId', 'storageName storageType');

    if (!consumed) throw new Error('Food item not found');
    return enrichFoodNutrition(consumed, neutralCategoryValidation(), await loadActiveCategories());
  }

  // Recalculate status & freshness if expiry changed
  const expiryDate = updateData.expiryDate ? new Date(updateData.expiryDate) : item.expiryDate;
  const purchaseDate = updateData.purchaseDate ? new Date(updateData.purchaseDate) : item.purchaseDate;
  const categories = await loadActiveCategories();
  const categoryValidation = await classifyFoodCategory({
    foodName: (updateData.foodName ?? item.foodName).trim(),
    selectedCategoryId: category._id,
    categories,
    allowAi: true,
  });
  updateData.status = applyCategoryValidationStatus(computeFoodStatus(expiryDate), categoryValidation);
  updateData.freshnessScore = computeFreshnessScore(purchaseDate, expiryDate);
  updateData.updatedBy = userId;

  const updated = await FoodItem.findByIdAndUpdate(foodId, updateData, { returnDocument: 'after' })
    .populate('categoryId', CATEGORY_SELECT)
    .populate('storageLocationId', 'storageName storageType');

  if (!updated) throw new Error('Food item not found');

  await createCategoryMismatchNotification(userId, updated, categoryValidation);
  return enrichFoodNutrition(updated, categoryValidation, categories);
}

// ─── SOFT DELETE food item ────────────────────────────────────────────────────
export async function deleteFoodItem(foodId: string, userId: string) {
  const context = await getInventoryOwnerContext(userId);
  const item = await FoodItem.findOne({ _id: foodId, ...buildOwnerQuery(context), isDeleted: false });
  if (!item) throw new Error('Food item not found');

  await FoodItem.findByIdAndUpdate(foodId, {
    isDeleted: true,
    deletedAt: new Date(),
    updatedBy: userId,
  });

  return { message: 'Food item deleted successfully' };
}

// ─── MARK as consumed ─────────────────────────────────────────────────────────
export async function markFoodConsumed(foodId: string, userId: string) {
  const context = await getInventoryOwnerContext(userId);
  const item = await FoodItem.findOne({
    _id: foodId,
    ...buildOwnerQuery(context),
    isDeleted: false,
    isConsumed: false,
    quantity: { $gt: 0 },
  });
  if (!item) throw new Error('Food item not found or already consumed');

  await FoodItem.findByIdAndUpdate(foodId, {
    quantity: 0,
    isConsumed: true,
    consumedAt: new Date(),
    updatedBy: userId,
  });

  return { message: 'Food item marked as consumed' };
}

// ─── GET food categories ──────────────────────────────────────────────────────
export async function getFoodCategories() {
  return FoodCategory.find({ isActive: true }).select(CATEGORY_SELECT).sort({ sortOrder: 1, categoryName: 1 });
}

// ─── Summary stats ────────────────────────────────────────────────────────────
export async function getFoodSummary(userId: string) {
  const context = await getInventoryOwnerContext(userId);
  await normalizeInventoryCategoryStatuses(context, userId);
  const base = {
    ...buildOwnerQuery(context),
    isDeleted: false,
    isConsumed: false,
    quantity: { $gt: 0 },
  };

  const [total, safe, nearExpiry, expired, needCheck] = await Promise.all([
    FoodItem.countDocuments(base),
    FoodItem.countDocuments({ ...base, status: 'SAFE' }),
    FoodItem.countDocuments({ ...base, status: 'NEAR_EXPIRY' }),
    FoodItem.countDocuments({ ...base, status: 'EXPIRED' }),
    FoodItem.countDocuments({ ...base, status: 'NEED_CHECK' }),
  ]);

  return { total, safe, nearExpiry, expired, needCheck };
}
