import mongoose from 'mongoose';

import { HouseholdMember } from '../models/householdMember.model';
import { ShoppingList } from '../models/shoppingList.model';

type OwnerType = 'USER' | 'HOUSEHOLD';
type ShoppingListStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

function assertValidObjectId(id: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${label} is invalid`);
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

  return memberships.map((membership) => membership.householdId);
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
  const canEdit =
    member?.role === 'OWNER' ||
    member?.role === 'ADMIN' ||
    member?.permission?.canEditShoppingList;

  if (!canEdit) {
    throw new Error('You do not have permission to edit this shopping list');
  }
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
    .sort({ updatedAt: -1 });
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

    const member = await getActiveHouseholdMember(householdId, userId);
    const canCreate =
      member?.role === 'OWNER' ||
      member?.role === 'ADMIN' ||
      member?.permission?.canEditShoppingList;

    if (!canCreate) {
      throw new Error('You do not have permission to create a shared shopping list');
    }

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
  return list.populate('householdId', 'householdName planType status');
}

export async function addShoppingListItem(listId: string, userId: string, data: any) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  const foodName = data.foodName?.trim();

  if (!foodName) {
    throw new Error('foodName is required');
  }
  if (data.quantity === undefined || Number(data.quantity) < 0) {
    throw new Error('quantity is required and must be greater than or equal to 0');
  }
  if (!data.unit?.trim()) {
    throw new Error('unit is required');
  }

  list.items.push({
    itemId: data.itemId,
    foodName,
    categoryId: data.categoryId,
    quantity: Number(data.quantity),
    unit: data.unit.trim(),
    reason: data.reason ?? 'USER_ADDED',
    isPurchased: data.isPurchased ?? false,
    purchasedAt: data.isPurchased ? new Date() : undefined,
    addedBy: userId,
    purchasedBy: data.isPurchased ? userId : undefined
  });

  await list.save();
  return list.items[list.items.length - 1];
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

  if (data.foodName !== undefined) item.foodName = data.foodName.trim();
  if (data.categoryId !== undefined) item.categoryId = data.categoryId;
  if (data.quantity !== undefined) item.quantity = Number(data.quantity);
  if (data.unit !== undefined) item.unit = data.unit.trim();
  if (data.reason !== undefined) item.reason = data.reason;

  if (data.isPurchased !== undefined) {
    item.isPurchased = Boolean(data.isPurchased);
    item.purchasedAt = item.isPurchased ? new Date() : undefined;
    item.purchasedBy = item.isPurchased ? userId : undefined;
  }

  await list.save();
  return item;
}

export async function removeShoppingListItem(listId: string, itemId: string, userId: string) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  const item = list.items.id(itemId);

  if (!item) {
    throw new Error('Shopping list item not found');
  }

  item.deleteOne();
  await list.save();

  return { message: 'Shopping list item removed' };
}

export async function completeShoppingList(listId: string, userId: string) {
  const list = await findAccessibleList(listId, userId, 'EDIT');
  list.status = 'COMPLETED';
  await list.save();

  return list;
}
