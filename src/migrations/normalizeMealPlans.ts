import 'dotenv/config';

import mongoose from 'mongoose';

import { MealPlan } from '../models/mealPlan.model';
import { calculateMealTotals } from '../services/nutritionService';
import {
  buildInventoryContextKey,
  planDateFromKey,
  toPlanDateKey,
} from '../utils/mealSchedule';

function normalizeId(value: any) {
  return String(value?._id || value || '');
}

function mealKey(meal: any) {
  const usedFoods = (meal.usedFoods || [])
    .map((item: any) => ({
      foodItemId: normalizeId(item.foodItemId),
      quantityUsed: Number(item.quantityUsed) || 0,
      unit: String(item.unit || '').toLowerCase(),
    }))
    .sort((a: any, b: any) => a.foodItemId.localeCompare(b.foodItemId));

  return JSON.stringify({
    mealType: meal.mealType || '',
    recipeId: normalizeId(meal.recipeId),
    recipeName: String(meal.recipeName || '').trim().toLowerCase(),
    scheduledTime: meal.scheduledTime || '',
    usedFoods,
  });
}

function mergeMeals(plans: any[]) {
  const meals = new Map<string, any>();

  plans.forEach((plan) => {
    (plan.meals || []).forEach((meal: any) => {
      const raw = meal.toObject?.() || meal;
      const key = mealKey(raw);
      const current = meals.get(key);
      const shouldReplace = !current
        || (!current.inventoryApplied && raw.inventoryApplied)
        || (current.status !== 'COMPLETED' && raw.status === 'COMPLETED');
      if (shouldReplace) meals.set(key, raw);
    });
  });

  return Array.from(meals.values());
}

async function normalizeMealPlans() {
  const plans = await MealPlan.find({}).sort({ updatedAt: -1, createdAt: -1 });
  const groups = new Map<string, any[]>();

  plans.forEach((plan: any) => {
    const ownerType = plan.inventoryOwnerType === 'HOUSEHOLD' && plan.householdId
      ? 'HOUSEHOLD'
      : 'USER';
    const planDateKey = toPlanDateKey(plan.planDate);
    const inventoryContextKey = buildInventoryContextKey(ownerType, plan.householdId);
    const key = `${normalizeId(plan.userId)}|${inventoryContextKey}|${planDateKey}`;
    const current = groups.get(key) || [];
    current.push(plan);
    groups.set(key, current);
  });

  let updated = 0;
  let merged = 0;
  let removed = 0;

  for (const group of groups.values()) {
    const primary = group[0];
    const ownerType = primary.inventoryOwnerType === 'HOUSEHOLD' && primary.householdId
      ? 'HOUSEHOLD'
      : 'USER';
    const planDateKey = toPlanDateKey(primary.planDate);
    const inventoryContextKey = buildInventoryContextKey(ownerType, primary.householdId);
    const meals = mergeMeals(group);
    const totals = calculateMealTotals(meals);

    await MealPlan.collection.updateOne(
      { _id: primary._id },
      {
        $set: {
          inventoryOwnerType: ownerType,
          inventoryContextKey,
          planDateKey,
          planDate: planDateFromKey(planDateKey),
          meals,
          totalCalories: totals.totalCalories,
          macroSummary: totals.macroSummary,
        },
        ...(ownerType === 'USER' ? { $unset: { householdId: '' } } : {}),
      },
    );
    updated += 1;

    if (group.length > 1) {
      const duplicateIds = group.slice(1).map((plan) => plan._id);
      const result = await MealPlan.collection.deleteMany({ _id: { $in: duplicateIds } });
      merged += 1;
      removed += result.deletedCount;
    }
  }

  await MealPlan.collection.createIndex(
    { userId: 1, inventoryContextKey: 1, planDateKey: 1 },
    {
      name: 'unique_user_inventory_context_plan_day',
      unique: true,
      partialFilterExpression: {
        inventoryContextKey: { $type: 'string' },
        planDateKey: { $type: 'string' },
      },
    },
  );

  return { scanned: plans.length, updated, mergedGroups: merged, removedDuplicates: removed };
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
    autoIndex: false,
  });

  try {
    const result = await normalizeMealPlans();
    console.log('Meal plan migration completed', result);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('Meal plan migration failed', error);
  process.exitCode = 1;
});
