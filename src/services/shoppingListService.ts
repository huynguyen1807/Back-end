import mongoose from 'mongoose';

import { HouseholdMember } from '../models/householdMember.model';
import { ShoppingList } from '../models/shoppingList.model';
import { Household } from '../models/household.model';
import { assertHouseholdSharedAccess, getHouseholdEntitlement, FamilySubscriptionError } from './subscriptionService';

type OwnerType = 'USER' | 'HOUSEHOLD';
type ShoppingListStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
type ShoppingDestination = { ownerType: OwnerType; householdId?: string; listId?: string };

type ShoppingIngredientInput = {
  ingredientName?: string;
  foodName?: string;
  categoryId?: any;
  quantity?: number;
  unit?: string;
};

const MAX_FOOD_NAME_LENGTH = 80;
const MAX_UNIT_LENGTH = 20;
const MAX_QUANTITY = 100000;
const UNIT_PATTERN = /^[\p{L}\d\s./-]+$/u;
const ITEM_REASONS = ['MISSING_INGREDIENT', 'USER_ADDED', 'LOW_STOCK', 'VIDEO_RECIPE'];

export class ShoppingListValidationError extends Error {
  readonly statusCode = 400;
}

export class ShoppingListConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Shopping list changed. Reload it and try again.');
    this.name = 'ShoppingListConflictError';
  }
}

async function saveShoppingList(list: any) {
  await list.validate();
  const revision = list.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new ShoppingListConflictError();
  const changes = list.$getChanges();
  // Hydrating a legacy row can include the default in $set. Revision must be
  // changed only by $inc, otherwise MongoDB rejects the overlapping updates.
  if (changes.$set) delete changes.$set.revision;
  // Legacy rows have no revision. Only one writer may claim revision zero;
  // $inc initializes it atomically without a migration or an unconditional save.
  const saved = await ShoppingList.findOneAndUpdate({
    _id: list._id,
    ...(revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }),
  }, { ...changes, $inc: { ...changes.$inc, revision: 1 } }, { returnDocument: 'after', runValidators: true });
  if (!saved) throw new ShoppingListConflictError();
  return saved;
}

function assertValidObjectId(id: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${label} is invalid`);
  }
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function validateFoodName(foodName: string) {
  if (!foodName) {
    throw new ShoppingListValidationError('foodName is required');
  }
  if (foodName.length > MAX_FOOD_NAME_LENGTH) {
    throw new ShoppingListValidationError(`foodName must not exceed ${MAX_FOOD_NAME_LENGTH} characters`);
  }
}

function validateQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ShoppingListValidationError('quantity is required and must be greater than 0');
  }
  if (quantity > MAX_QUANTITY) {
    throw new ShoppingListValidationError(`quantity must not exceed ${MAX_QUANTITY}`);
  }
  const [coefficient, exponent = '0'] = String(quantity).toLowerCase().split('e');
  if ((coefficient.split('.')[1]?.length ?? 0) - Number(exponent) > 3) {
    throw new ShoppingListValidationError('quantity must not have more than 3 decimal places');
  }
}

function validateUnit(unit: string) {
  if (!unit) {
    throw new ShoppingListValidationError('unit is required');
  }
  if (unit.length > MAX_UNIT_LENGTH) {
    throw new ShoppingListValidationError(`unit must not exceed ${MAX_UNIT_LENGTH} characters`);
  }
  if (!UNIT_PATTERN.test(unit)) {
    throw new ShoppingListValidationError('unit contains invalid characters');
  }
}

function trimmedText(value: unknown, field: string) {
  if (typeof value !== 'string') throw new ShoppingListValidationError(`${field} must be a string`);
  return value.trim();
}

function itemQuantity(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new ShoppingListValidationError('quantity is invalid');
  const quantity = Number(value); validateQuantity(quantity); return quantity;
}

function purchasedStatus(value: unknown) {
  if (typeof value !== 'boolean') throw new ShoppingListValidationError('isPurchased must be a boolean');
  return value;
}

function itemReason(value: unknown) {
  if (typeof value !== 'string' || !ITEM_REASONS.includes(value)) throw new ShoppingListValidationError('reason is invalid');
  return value;
}

function normalizedItem(data: any, userId: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ShoppingListValidationError('item is invalid');
  const foodName = trimmedText(data.foodName, 'foodName'), unit = trimmedText(data.unit, 'unit');
  validateFoodName(foodName); validateUnit(unit);
  const quantity = itemQuantity(data.quantity);
  const isPurchased = data.isPurchased === undefined ? false : purchasedStatus(data.isPurchased);
  const categoryId = data.categoryId?._id ?? data.categoryId;
  if (categoryId != null) assertValidObjectId(String(categoryId), 'categoryId');
  if (data.itemId != null) assertValidObjectId(String(data.itemId), 'itemId');
  return { itemId: data.itemId, foodName, categoryId, quantity, unit,
    reason: itemReason(data.reason === undefined ? 'USER_ADDED' : data.reason), isPurchased,
    addedBy: userId, purchasedAt: isPurchased ? new Date() : undefined, purchasedBy: isPurchased ? userId : undefined };
}

function getActiveHouseholdMember(householdId: string, userId: string) {
  return HouseholdMember.findOne({ householdId, userId, status: 'ACTIVE' });
}

function canAccessHouseholdList(member: any, ownerId: unknown, userId: string, mode: 'VIEW' | 'EDIT') {
  if (!member || !ownerId) return false;
  const isOwner = String(ownerId) === userId;
  if (member.role === 'OWNER') return isOwner;
  return member.role === 'MEMBER' && !isOwner && member.permission?.canViewShoppingList === true
    && (mode === 'VIEW' || member.permission?.canEditShoppingList === true);
}

async function getViewableHouseholdIds(userId: string) {
  const memberships = await HouseholdMember.find({
    userId,
    status: 'ACTIVE',
    $or: [{ role: 'OWNER' }, { 'permission.canViewShoppingList': true }]
  }).select('householdId role permission');

  const visible = [];
  for (const membership of memberships) {
    try {
      const entitlement = await getHouseholdEntitlement(String(membership.householdId));
      if (entitlement.canReadSharedData && canAccessHouseholdList(membership, entitlement.ownerId, userId, 'VIEW')) {
        visible.push(membership.householdId);
      }
    } catch (error) { if (!(error instanceof FamilySubscriptionError)) throw error; }
  }
  return visible;
}

async function ensureCanViewList(list: any, userId: string) {
  if (list.ownerType === 'USER') {
    const isOwner = list.userId?.toString() === userId;
    if (!isOwner) {
      throw new Error('You do not have permission to view this shopping list');
    }

    return;
  }

  const member = await getActiveHouseholdMember(list.householdId?.toString(), userId);
  const household = await Household.findOne({ _id: list.householdId, status: 'ACTIVE' });
  if (!household || !canAccessHouseholdList(member, household.ownerId, userId, 'VIEW')) {
    throw new Error('You do not have permission to view this shopping list');
  }
  await assertHouseholdSharedAccess(String(list.householdId), 'VIEW');
}

async function ensureCanEditList(list: any, userId: string) {
  if (list.ownerType === 'USER') {
    const isOwner = list.userId?.toString() === userId;
    if (!isOwner) {
      throw new Error('You do not have permission to edit this shopping list');
    }

    return;
  }

  const member = await getActiveHouseholdMember(list.householdId?.toString(), userId);
  const household = await Household.findOne({ _id: list.householdId, status: 'ACTIVE' });
  if (!household || !canAccessHouseholdList(member, household.ownerId, userId, 'EDIT')) {
    throw new Error('You do not have permission to edit this shopping list');
  }
  await assertHouseholdSharedAccess(String(list.householdId), 'EDIT');
}

async function findAccessibleList(listId: string, userId: string, mode: 'VIEW' | 'EDIT') {
  assertValidObjectId(listId, 'shoppingListId');

  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw new Error('Shopping list not found');
  }

  if (mode === 'EDIT') {
    await ensureCanEditList(list, userId);
  } else {
    await ensureCanViewList(list, userId);
  }

  return list;
}

export async function getShoppingLists(userId: string, status?: ShoppingListStatus | 'ALL', context?: { ownerType: OwnerType; householdId?: string }) {
  const statusFilter = status && status !== 'ALL' ? { status } : { status: { $ne: 'ARCHIVED' } };
  let ownership: any;
  if (context !== undefined) {
    if (!context || !['USER', 'HOUSEHOLD'].includes(context.ownerType)) throw new ShoppingListValidationError('ownerType is invalid');
    if (context.ownerType === 'USER') {
      if (context.householdId !== undefined) throw new ShoppingListValidationError('Personal householdId is invalid');
      ownership = { ownerType: 'USER', userId };
    } else {
      if (!context.householdId) throw new ShoppingListValidationError('householdId is required');
      assertValidObjectId(context.householdId, 'householdId');
      await ensureCanViewList({ ownerType: 'HOUSEHOLD', householdId: context.householdId }, userId);
      ownership = { ownerType: 'HOUSEHOLD', householdId: context.householdId };
    }
  } else {
    const householdIds = await getViewableHouseholdIds(userId);
    ownership = { $or: [{ ownerType: 'USER', userId }, { ownerType: 'HOUSEHOLD', householdId: { $in: householdIds } }] };
  }

  return ShoppingList.find({
    ...statusFilter,
    ...ownership,
  })
    .populate('householdId', 'householdName planType status')
    .populate('items.categoryId', 'categoryName')
    .sort({ updatedAt: -1 });
}

export async function getActiveShoppingLists(userId: string) {
  return getShoppingLists(userId, 'ACTIVE');
}

export async function createShoppingList(userId: string, data: any) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ShoppingListValidationError('list payload is invalid');
  const ownerType = (data.ownerType ?? 'USER') as OwnerType;
  const listName = typeof data.listName === 'string' ? data.listName.trim() : '';

  if (!['USER', 'HOUSEHOLD'].includes(ownerType)) {
    throw new Error('ownerType must be USER or HOUSEHOLD');
  }

  if (!listName) {
    throw new Error('listName is required');
  }
  if (data.items !== undefined && !Array.isArray(data.items)) throw new ShoppingListValidationError('items must be an array');
  const items = (data.items ?? []).map((item: any) => normalizedItem(item, userId));

  if (ownerType === 'HOUSEHOLD') {
    const householdId = data.householdId;
    if (!householdId) {
      throw new Error('householdId is required');
    }
    assertValidObjectId(householdId, 'householdId');

    await ensureCanEditList({ ownerType: 'HOUSEHOLD', householdId }, userId);

    return ShoppingList.create({
      ownerType,
      householdId,
      listName,
      visibility: 'SHARED',
      status: 'ACTIVE',
      items,
      createdFrom: data.createdFrom ?? { type: 'MANUAL' }
    });
  }

  return ShoppingList.create({
    ownerType,
    userId,
    listName,
    // Personal ownership comes only from the authenticated user. Ignore
    // sharing input; historical sharing fields are retained on existing rows.
    visibility: 'PERSONAL',
    status: 'ACTIVE',
    items,
    createdFrom: data.createdFrom ?? { type: 'MANUAL' },
    sharedWith: []
  });
}

export async function getShoppingListById(listId: string, userId: string) {
  const list = await findAccessibleList(listId, userId, 'VIEW');
  return list.populate([
    { path: 'householdId', select: 'householdName planType status' },
    { path: 'items.categoryId', select: 'categoryName' }
  ]);
}

export async function addShoppingListItem(listId: string, userId: string, data: any) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  list.items.push(normalizedItem(data, userId));

  const saved = await saveShoppingList(list);
  return saved.items[saved.items.length - 1];
}

export async function updateShoppingListItem(
  listId: string,
  itemId: string,
  userId: string,
  data: any
) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ShoppingListValidationError('item payload is invalid');
  const item = list.items.id(itemId);

  if (!item) {
    throw new Error('Shopping list item not found');
  }

  const changes: Record<string, any> = {};
  if (data.foodName !== undefined) {
    const foodName = trimmedText(data.foodName, 'foodName');
    validateFoodName(foodName);
    changes.foodName = foodName;
  }
  if (data.categoryId !== undefined) changes.categoryId = data.categoryId;
  if (data.quantity !== undefined) {
    changes.quantity = itemQuantity(data.quantity);
  }
  if (data.unit !== undefined) {
    const unit = trimmedText(data.unit, 'unit');
    validateUnit(unit);
    changes.unit = unit;
  }
  if (data.reason !== undefined) changes.reason = itemReason(data.reason);

  if (data.isPurchased !== undefined) {
    changes.isPurchased = purchasedStatus(data.isPurchased);
    changes.purchasedAt = changes.isPurchased ? new Date() : undefined;
    changes.purchasedBy = changes.isPurchased ? userId : undefined;
  }
  Object.assign(item, changes);

  const saved = await saveShoppingList(list);
  return saved.items.id(itemId);
}

export async function removeShoppingListItem(listId: string, itemId: string, userId: string) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  const item = list.items.id(itemId);

  if (!item) {
    throw new Error('Shopping list item not found');
  }

  item.deleteOne();
  await saveShoppingList(list);

  return { message: 'Shopping list item removed' };
}

export async function completeShoppingList(listId: string, userId: string) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  list.status = 'COMPLETED';
  const saved = await saveShoppingList(list);

  return saved.populate('items.categoryId', 'categoryName');
}

export async function addMissingIngredientsToShoppingList(
  userId: string,
  items: ShoppingIngredientInput[] = [],
  destination?: ShoppingDestination,
) {
  if (!Array.isArray(items) || !items.length) throw new ShoppingListValidationError('items are required');
  const cleanItems = items.map((item: any) => normalizedItem({ ...item, foodName: item?.foodName ?? item?.ingredientName,
    quantity: item?.quantity === undefined ? 1 : item.quantity, unit: item?.unit === undefined ? 'g' : item.unit }, userId));

  const ownerType = destination === undefined ? 'USER' : destination?.ownerType;
  if (!['USER', 'HOUSEHOLD'].includes(ownerType)) throw new Error('Shopping destination ownerType is invalid');
  if (ownerType === 'USER' && destination?.householdId !== undefined) throw new Error('Personal destination householdId is invalid');
  const householdId = destination?.householdId;
  if (ownerType === 'HOUSEHOLD') {
    if (!householdId) throw new Error('householdId is required');
    assertValidObjectId(householdId, 'householdId');
    await ensureCanEditList({ ownerType, householdId }, userId);
  }
  let list: any;
  if (destination?.listId !== undefined) {
    list = await findAccessibleList(destination.listId, userId, 'EDIT');
    if (list.ownerType !== ownerType || (ownerType === 'HOUSEHOLD' && String(list.householdId) !== householdId)) {
      throw new Error('Shopping destination context is invalid');
    }
    if (list.status !== 'ACTIVE') throw new Error('Shopping destination list must be ACTIVE');
  } else {
    list = await ShoppingList.findOne({ ownerType, ...(ownerType === 'USER' ? { userId } : { householdId }),
      status: 'ACTIVE', 'createdFrom.type': 'MEAL_PLAN' });
    if (list) await ensureCanEditList(list, userId);
  }

  // Validate the entire merge before creating or changing a stored list.
  const merged: any[] = (list?.items ?? []).map((item: any) => item.toObject?.() ?? { ...item });
  cleanItems.forEach((item) => {
    const existing = merged.find(
      (entry: any) =>
        !entry.isPurchased &&
        normalizeName(entry.foodName) === normalizeName(item.foodName) &&
        normalizeName(entry.unit) === normalizeName(item.unit)
    ) as any;

    if (existing) {
      const previous = itemQuantity(existing.quantity);
      const total = (Math.round(previous * 1000) + Math.round(item.quantity * 1000)) / 1000;
      validateQuantity(total); existing.quantity = total;
      existing.reason = 'MISSING_INGREDIENT';
    } else {
      merged.push({
        foodName: item.foodName,
        categoryId: item.categoryId,
        quantity: item.quantity,
        unit: item.unit,
        reason: 'MISSING_INGREDIENT',
        addedBy: userId
      } as any);
    }
  });

  if (!list) list = await createShoppingList(userId, {
    ownerType, ...(ownerType === 'HOUSEHOLD' ? { householdId } : {}), listName: 'Meal Plan Shopping List',
    createdFrom: { type: 'MEAL_PLAN' }, items: [],
  });
  list.items = merged;
  const saved = await saveShoppingList(list);
  return saved.populate('items.categoryId', 'categoryName');
}
