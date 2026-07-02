import { ShoppingList } from '../models/shoppingList.model';

type ShoppingIngredientInput = {
  ingredientName?: string;
  foodName?: string;
  categoryId?: any;
  quantity?: number;
  unit?: string;
};

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export async function getActiveShoppingLists(userId: string) {
  return ShoppingList.find({
    ownerType: 'USER',
    userId,
    status: 'ACTIVE'
  })
    .populate('items.categoryId', 'categoryName')
    .sort({ updatedAt: -1 });
}

export async function addMissingIngredientsToShoppingList(
  userId: string,
  items: ShoppingIngredientInput[] = []
) {
  const cleanItems = items
    .map((item) => ({
      foodName: String(item.foodName || item.ingredientName || '').trim(),
      categoryId: item.categoryId?._id || item.categoryId,
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      unit: String(item.unit || 'item').trim() || 'item'
    }))
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

  await list.save();
  return list.populate('items.categoryId', 'categoryName');
}

export async function updateShoppingListItem(
  userId: string,
  listId: string,
  itemId: string,
  data: { isPurchased?: boolean }
) {
  const list = await ShoppingList.findOne({
    _id: listId,
    ownerType: 'USER',
    userId,
    status: 'ACTIVE'
  });

  if (!list) throw new Error('shopping list not found');

  const item = list.items.id(itemId);
  if (!item) throw new Error('shopping list item not found');

  if (data.isPurchased !== undefined) {
    item.isPurchased = Boolean(data.isPurchased);
    item.purchasedAt = item.isPurchased ? new Date() : undefined;
    item.purchasedBy = item.isPurchased ? userId : undefined;
  }

  await list.save();
  return list.populate('items.categoryId', 'categoryName');
}
