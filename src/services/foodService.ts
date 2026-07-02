import { FoodItem } from '../models/foodItem.model';
import { FoodCategory } from '../models/foodCategory.model';
import { StorageLocation } from '../models/storageLocation.model';
import { resolveNutritionForFood } from './nutritionService';

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

async function enrichFoodNutrition(item: any) {
  const raw = typeof item.toObject === 'function' ? item.toObject() : item;
  const categoryId = raw.categoryId?._id || raw.categoryId;
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
    }
  };
}

// ─── GET all food items của user ─────────────────────────────────────────────
export async function getFoodItems(userId: string, filter?: string) {
  const query: any = {
    ownerType: 'USER',
    userId,
    isDeleted: false,
    isConsumed: false,
  };

  if (filter === 'SAFE' || filter === 'NEAR_EXPIRY' || filter === 'EXPIRED') {
    query.status = filter;
  }

  const items = await FoodItem.find(query)
    .populate('categoryId', 'categoryName')
    .populate('storageLocationId', 'storageName storageType')
    .sort({ expiryDate: 1 });

  return Promise.all(items.map(enrichFoodNutrition));
}

// ─── GET single food item ─────────────────────────────────────────────────────
export async function getFoodItemById(foodId: string, userId: string) {
  const item = await FoodItem.findOne({ _id: foodId, userId, isDeleted: false })
    .populate('categoryId', 'categoryName description')
    .populate('storageLocationId', 'storageName storageType description');

  if (!item) throw new Error('Food item not found');
  return enrichFoodNutrition(item);
}

// ─── CREATE food item ─────────────────────────────────────────────────────────
export async function createFoodItem(userId: string, data: any) {
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
  const category = await FoodCategory.findById(categoryId);
  if (!category) throw new Error('Category not found');

  // Validate storage location belongs to user
  const location = await StorageLocation.findOne({ _id: storageLocationId, userId, isActive: true });
  if (!location) throw new Error('Storage location not found or not owned by user');

  const expiry = new Date(expiryDate);
  const purchase = new Date(purchaseDate);
  const status = computeFoodStatus(expiry);
  const freshnessScore = computeFreshnessScore(purchase, expiry);

  const foodItem = await FoodItem.create({
    ownerType: 'USER',
    userId,
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
    status,
    freshnessScore,
    createdBy: userId,
  });

  return enrichFoodNutrition(foodItem);
}

// ─── UPDATE food item ─────────────────────────────────────────────────────────
export async function updateFoodItem(foodId: string, userId: string, data: any) {
  const item = await FoodItem.findOne({ _id: foodId, userId, isDeleted: false });
  if (!item) throw new Error('Food item not found');

  const allowedFields = [
    'foodName', 'imageUrl', 'categoryId', 'storageLocationId',
    'purchaseDate', 'expiryDate', 'quantity', 'unit', 'sourceType', 'expiryType',
  ];

  const updateData: any = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  // Recalculate status & freshness if expiry changed
  const expiryDate = updateData.expiryDate ? new Date(updateData.expiryDate) : item.expiryDate;
  const purchaseDate = updateData.purchaseDate ? new Date(updateData.purchaseDate) : item.purchaseDate;
  updateData.status = computeFoodStatus(expiryDate);
  updateData.freshnessScore = computeFreshnessScore(purchaseDate, expiryDate);
  updateData.updatedBy = userId;

  const updated = await FoodItem.findByIdAndUpdate(foodId, updateData, { new: true })
    .populate('categoryId', 'categoryName')
    .populate('storageLocationId', 'storageName storageType');

  return enrichFoodNutrition(updated);
}

// ─── SOFT DELETE food item ────────────────────────────────────────────────────
export async function deleteFoodItem(foodId: string, userId: string) {
  const item = await FoodItem.findOne({ _id: foodId, userId, isDeleted: false });
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
  const item = await FoodItem.findOne({ _id: foodId, userId, isDeleted: false, isConsumed: false });
  if (!item) throw new Error('Food item not found or already consumed');

  await FoodItem.findByIdAndUpdate(foodId, {
    isConsumed: true,
    consumedAt: new Date(),
    updatedBy: userId,
  });

  return { message: 'Food item marked as consumed' };
}

// ─── GET food categories ──────────────────────────────────────────────────────
export async function getFoodCategories() {
  return FoodCategory.find({ isActive: true }).select('categoryName description').sort({ categoryName: 1 });
}

// ─── Summary stats ────────────────────────────────────────────────────────────
export async function getFoodSummary(userId: string) {
  const base = { ownerType: 'USER', userId, isDeleted: false, isConsumed: false };

  const [total, safe, nearExpiry, expired] = await Promise.all([
    FoodItem.countDocuments(base),
    FoodItem.countDocuments({ ...base, status: 'SAFE' }),
    FoodItem.countDocuments({ ...base, status: 'NEAR_EXPIRY' }),
    FoodItem.countDocuments({ ...base, status: 'EXPIRED' }),
  ]);

  return { total, safe, nearExpiry, expired };
}
