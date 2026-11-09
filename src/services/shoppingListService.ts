import mongoose from 'mongoose';

import { HouseholdMember } from '../models/householdMember.model';
import { ShoppingList } from '../models/shoppingList.model';
import { Household } from '../models/household.model';
import { assertHouseholdSharedAccess, getHouseholdEntitlement, FamilySubscriptionError } from './subscriptionService';

type OwnerType = 'USER' | 'HOUSEHOLD';
type ShoppingListStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

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
    throw new Error('foodName is required');
  }
  if (foodName.length > MAX_FOOD_NAME_LENGTH) {
    throw new Error(`foodName must not exceed ${MAX_FOOD_NAME_LENGTH} characters`);
  }
}

function validateQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('quantity is required and must be greater than 0');
  }
  if (quantity > MAX_QUANTITY) {
    throw new Error(`quantity must not exceed ${MAX_QUANTITY}`);
  }
  const decimalPart = String(quantity).split('.')[1];
  if (decimalPart && decimalPart.length > 3) {
    throw new Error('quantity must not have more than 3 decimal places');
  }
}

function validateUnit(unit: string) {
  if (!unit) {
    throw new Error('unit is required');
  }
  if (unit.length > MAX_UNIT_LENGTH) {
    throw new Error(`unit must not exceed ${MAX_UNIT_LENGTH} characters`);
  }
  if (!UNIT_PATTERN.test(unit)) {
    throw new Error('unit contains invalid characters');
  }
}

function getActiveHouseholdMember(householdId: string, userId: string) {
  return HouseholdMember.findOne({ householdId, userId, status: 'ACTIVE' });
}

async function getViewableHouseholdIds(userId: string) {
  const memberships = await HouseholdMember.find({
    userId,
    status: 'ACTIVE',
    'permission.canViewShoppingList': true
  }).select('householdId');

  const visible = [];
  for (const membership of memberships) {
    try {
      const entitlement = await getHouseholdEntitlement(String(membership.householdId));
      if (entitlement.canReadSharedData) visible.push(membership.householdId);
    } catch (error) { if (!(error instanceof FamilySubscriptionError)) throw error; }
  }
  return visible;
}

async function ensureCanViewList(list: any, userId: string) {
  if (list.ownerType === 'USER') {
    const isOwner = list.userId?.toString() === userId;
    const isShared = list.sharedWith?.some((share: any) => share.userId?.toString() === userId);

    if (!isOwner && !isShared) {
      throw new Error('You do not have permission to view this shopping list');
    }

    return;
  }

  const member = await getActiveHouseholdMember(list.householdId?.toString(), userId);
  if (!member || !member.permission?.canViewShoppingList) {
    throw new Error('You do not have permission to view this shopping list');
  }
  await assertHouseholdSharedAccess(String(list.householdId), 'VIEW');
}

async function ensureCanEditList(list: any, userId: string) {
  if (list.ownerType === 'USER') {
    const isOwner = list.userId?.toString() === userId;
    const sharedAccess = list.sharedWith?.find((share: any) => share.userId?.toString() === userId);

    if (!isOwner && sharedAccess?.permission !== 'EDIT') {
      throw new Error('You do not have permission to edit this shopping list');
    }

    return;
  }

  const member = await getActiveHouseholdMember(list.householdId?.toString(), userId);
  const household = await Household.findOne({ _id: list.householdId, status: 'ACTIVE' });
  const owner = member?.role === 'OWNER' && String(household?.ownerId) === userId;
  const canEdit = household && (owner || (member?.role === 'MEMBER' && member.permission?.canEditShoppingList));

  if (!canEdit) {
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

export async function getShoppingLists(userId: string, status?: ShoppingListStatus | 'ALL') {
  const householdIds = await getViewableHouseholdIds(userId);
  const statusFilter = status && status !== 'ALL' ? { status } : { status: { $ne: 'ARCHIVED' } };

  return ShoppingList.find({
    ...statusFilter,
    $or: [
      { ownerType: 'USER', userId },
      { ownerType: 'USER', 'sharedWith.userId': userId },
      { ownerType: 'HOUSEHOLD', householdId: { $in: householdIds } }
    ]
  })
    .populate('householdId', 'householdName planType status')
    .populate('items.categoryId', 'categoryName')
    .sort({ updatedAt: -1 });
}

export async function getActiveShoppingLists(userId: string) {
  return getShoppingLists(userId, 'ACTIVE');
}

export async function createShoppingList(userId: string, data: any) {
  const ownerType = (data.ownerType ?? 'USER') as OwnerType;
  const listName = data.listName?.trim();

  if (!['USER', 'HOUSEHOLD'].includes(ownerType)) {
    throw new Error('ownerType must be USER or HOUSEHOLD');
  }

  if (!listName) {
    throw new Error('listName is required');
  }

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
      items: data.items ?? [],
      createdFrom: data.createdFrom ?? { type: 'MANUAL' }
    });
  }

  return ShoppingList.create({
    ownerType,
    userId,
    listName,
    visibility: data.visibility ?? 'PERSONAL',
    status: 'ACTIVE',
    items: data.items ?? [],
    createdFrom: data.createdFrom ?? { type: 'MANUAL' },
    sharedWith: data.sharedWith ?? []
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
  const foodName = data.foodName?.trim();
  const quantity = Number(data.quantity);
  const unit = data.unit?.trim();

  validateFoodName(foodName);
  validateQuantity(quantity);
  validateUnit(unit);

  list.items.push({
    itemId: data.itemId,
    foodName,
    categoryId: data.categoryId,
    quantity,
    unit,
    reason: data.reason ?? 'USER_ADDED',
    isPurchased: data.isPurchased ?? false,
    purchasedAt: data.isPurchased ? new Date() : undefined,
    addedBy: userId,
    purchasedBy: data.isPurchased ? userId : undefined
  });

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
  const item = list.items.id(itemId);

  if (!item) {
    throw new Error('Shopping list item not found');
  }

  if (data.foodName !== undefined) {
    const foodName = data.foodName.trim();
    validateFoodName(foodName);
    item.foodName = foodName;
  }
  if (data.categoryId !== undefined) item.categoryId = data.categoryId;
  if (data.quantity !== undefined) {
    const quantity = Number(data.quantity);
    validateQuantity(quantity);
    item.quantity = quantity;
  }
  if (data.unit !== undefined) {
    const unit = data.unit.trim();
    validateUnit(unit);
    item.unit = unit;
  }
  if (data.reason !== undefined) item.reason = data.reason;

  if (data.isPurchased !== undefined) {
    item.isPurchased = Boolean(data.isPurchased);
    item.purchasedAt = item.isPurchased ? new Date() : undefined;
    item.purchasedBy = item.isPurchased ? userId : undefined;
  }

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
  items: ShoppingIngredientInput[] = []
) {
  const cleanItems = items
    .map((item) => {
      const foodName = String(item.foodName || item.ingredientName || '').trim();
      const categoryId = item.categoryId?._id || item.categoryId;
      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const unit = String(item.unit || 'g').trim() || 'g';

      if (foodName) {
        validateFoodName(foodName);
        validateQuantity(quantity);
        validateUnit(unit);
      }

      return { foodName, categoryId, quantity, unit };
    })
    .filter((item) => item.foodName);

  if (!cleanItems.length) throw new Error('items are required');

  let list = await ShoppingList.findOne({
    ownerType: 'USER',
    userId,
    status: 'ACTIVE',
    'createdFrom.type': 'MEAL_PLAN'
  });

  if (!list) {
    list = await ShoppingList.create({
      ownerType: 'USER',
      userId,
      listName: 'Meal Plan Shopping List',
      visibility: 'PERSONAL',
      status: 'ACTIVE',
      createdFrom: { type: 'MEAL_PLAN' },
      items: []
    });
  }

  cleanItems.forEach((item) => {
    const existing = list!.items.find(
      (entry: any) =>
        !entry.isPurchased &&
        normalizeName(entry.foodName) === normalizeName(item.foodName) &&
        normalizeName(entry.unit) === normalizeName(item.unit)
    ) as any;

    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + item.quantity;
      existing.reason = 'MISSING_INGREDIENT';
    } else {
      list!.items.push({
        foodName: item.foodName,
        categoryId: item.categoryId,
        quantity: item.quantity,
        unit: item.unit,
        reason: 'MISSING_INGREDIENT',
        addedBy: userId
      } as any);
    }
  });

  const saved = await saveShoppingList(list);
  return saved.populate('items.categoryId', 'categoryName');
}
