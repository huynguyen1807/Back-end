import 'dotenv/config';

import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';

import { MealPlan } from '../models/mealPlan.model';
import { addMealToPlan } from '../services/mealPlanService';
import { getSchedulablePlanDateWindow } from '../utils/mealSchedule';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
    autoIndex: false,
  });

  const userId = new Types.ObjectId().toString();
  const planDate = getSchedulablePlanDateWindow().maxDateKey;

  try {
    await Promise.all([
      addMealToPlan(userId, {
        ownerType: 'USER',
        planDate,
        note: 'schedule-integration-test',
        meal: {
          mealType: 'BREAKFAST',
          recipeName: 'Schedule integration test lunch',
          scheduledTime: '12:50',
          calories: 250,
          macroSummary: { protein: 10, carbs: 30, fat: 8 },
        },
      }),
      addMealToPlan(userId, {
        ownerType: 'USER',
        planDate,
        note: 'schedule-integration-test',
        meal: {
          mealType: 'BREAKFAST',
          recipeName: 'Schedule integration test dinner',
          scheduledTime: '18:30',
          calories: 300,
          macroSummary: { protein: 15, carbs: 35, fat: 10 },
        },
      }),
    ]);

    const plans = await MealPlan.find({ userId, planDateKey: planDate }).lean();
    assert.equal(plans.length, 1, 'Concurrent scheduling must create exactly one daily plan');
    assert.equal(plans[0].meals.length, 2, 'Both meals must be persisted in the same plan');
    assert.equal(plans[0].meals.find((meal: any) => meal.scheduledTime === '12:50')?.mealType, 'LUNCH');
    assert.equal(plans[0].totalCalories, 550);

    const indexes = await MealPlan.collection.indexes();
    const uniqueIndex = indexes.find(
      (index) => index.name === 'unique_user_inventory_context_plan_day',
    );
    assert.equal(uniqueIndex?.unique, true, 'Daily meal plan unique index must exist');

    console.log('Meal plan persistence integration passed', {
      planCount: plans.length,
      mealCount: plans[0].meals.length,
      lunchMapping: plans[0].meals.find((meal: any) => meal.scheduledTime === '12:50')?.mealType,
      uniqueIndex: uniqueIndex?.name,
    });
  } finally {
    await MealPlan.deleteMany({ userId });
    const [missingDateKeys, missingContextKeys, testRows, duplicateGroups] = await Promise.all([
      MealPlan.countDocuments({ planDateKey: { $exists: false } }),
      MealPlan.countDocuments({ inventoryContextKey: { $exists: false } }),
      MealPlan.countDocuments({ note: 'schedule-integration-test' }),
      MealPlan.aggregate([
        {
          $group: {
            _id: {
              userId: '$userId',
              context: '$inventoryContextKey',
              date: '$planDateKey',
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ]),
    ]);
    assert.equal(testRows, 0, 'Temporary integration records must be removed');
    assert.equal(missingDateKeys, 0, 'All stored plans must have planDateKey');
    assert.equal(missingContextKeys, 0, 'All stored plans must have inventoryContextKey');
    assert.equal(duplicateGroups.length, 0, 'Stored plans must not contain duplicate day groups');
    console.log('Meal plan database audit passed', {
      missingDateKeys,
      missingContextKeys,
      testRows,
      duplicateGroups: duplicateGroups.length,
    });
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('Meal plan persistence integration failed', error);
  process.exitCode = 1;
});
