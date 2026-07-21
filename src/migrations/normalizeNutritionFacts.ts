import 'dotenv/config';

import mongoose from 'mongoose';

import { FoodCategory } from '../models/foodCategory.model';
import { FoodItem } from '../models/foodItem.model';
import { MealPlan } from '../models/mealPlan.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { Recipe } from '../models/recipe.model';
import {
  calculateMealTotals,
  calculateNutritionForIngredients,
  resolveNutritionForFood,
} from '../services/nutritionService';
import { defaultNutritionBaseQuantity } from '../utils/nutritionUnits';

type NutritionSeed = {
  foodName: string;
  aliases: string[];
  categoryName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  unit?: 'g' | 'ml';
};

const NUTRITION_SEEDS: NutritionSeed[] = [
  { foodName: 'Apple', aliases: ['Táo', 'Táo đỏ', 'Red apple', 'Apples', 'Red apples'], categoryName: 'Fruit', calories: 52, protein: 0.3, carbs: 13.8, fat: 0.2 },
  { foodName: 'Banana', aliases: ['Chuối'], categoryName: 'Fruit', calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  { foodName: 'Pineapple', aliases: ['Dứa', 'Thơm', 'Khóm'], categoryName: 'Fruit', calories: 50, protein: 0.5, carbs: 13.1, fat: 0.1 },
  { foodName: 'Longan', aliases: ['Nhãn', 'Nhãn lồng'], categoryName: 'Fruit', calories: 60, protein: 1.3, carbs: 15.1, fat: 0.1 },
  { foodName: 'Carrot', aliases: ['Cà rốt', 'Carrots', 'Da Lat carrots'], categoryName: 'Vegetable', calories: 41, protein: 0.9, carbs: 9.6, fat: 0.2 },
  { foodName: 'Cucumber', aliases: ['Dưa leo', 'Dưa chuột'], categoryName: 'Vegetable', calories: 15, protein: 0.7, carbs: 3.6, fat: 0.1 },
  { foodName: 'Tomato', aliases: ['Cà chua', 'Tomatoes'], categoryName: 'Vegetable', calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
  { foodName: 'Broccoli', aliases: ['Bông cải xanh', 'Súp lơ xanh'], categoryName: 'Vegetable', calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4 },
  { foodName: 'Lettuce', aliases: ['Xà lách', 'Rau xà lách'], categoryName: 'Vegetable', calories: 15, protein: 1.4, carbs: 2.9, fat: 0.2 },
  { foodName: 'Cabbage', aliases: ['Bắp cải', 'Cải bắp'], categoryName: 'Vegetable', calories: 25, protein: 1.3, carbs: 5.8, fat: 0.1 },
  { foodName: 'Radish', aliases: ['Củ cải'], categoryName: 'Vegetable', calories: 16, protein: 0.7, carbs: 3.4, fat: 0.1 },
  { foodName: 'Bell pepper', aliases: ['Ớt chuông'], categoryName: 'Vegetable', calories: 31, protein: 1, carbs: 6, fat: 0.3 },
  { foodName: 'Chicken breast', aliases: ['Ức gà', 'Thịt ức gà'], categoryName: 'Meat', calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  { foodName: 'Beef', aliases: ['Thịt bò'], categoryName: 'Meat', calories: 250, protein: 26, carbs: 0, fat: 15 },
  { foodName: 'Pork', aliases: ['Thịt heo', 'Thịt lợn'], categoryName: 'Meat', calories: 242, protein: 27, carbs: 0, fat: 14 },
  { foodName: 'Salmon', aliases: ['Cá hồi'], categoryName: 'Fish', calories: 208, protein: 20, carbs: 0, fat: 13 },
  { foodName: 'Chicken egg', aliases: ['Trứng', 'Trứng gà'], categoryName: 'Egg', calories: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  { foodName: 'Whole milk', aliases: ['Sữa', 'Sữa tươi', 'Sữa nguyên kem'], categoryName: 'Dairy', calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, unit: 'ml' },
  { foodName: 'Cooked rice', aliases: ['Cơm', 'Cơm trắng'], categoryName: 'Cooked Food', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3 },
  { foodName: 'Bread', aliases: ['Bánh mì'], categoryName: 'Dry Food', calories: 265, protein: 9, carbs: 49, fat: 3.2 },
];

async function upsertNutritionSeeds() {
  const categories = await FoodCategory.find({ isActive: true }).select('categoryName').lean();
  let changed = 0;

  for (const seed of NUTRITION_SEEDS) {
    const category = categories.find((item) => item.categoryName.toLowerCase() === seed.categoryName.toLowerCase());
    if (!category) continue;

    const result = await NutritionFact.collection.updateOne(
      { foodName: new RegExp(`^${seed.foodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      {
        $set: {
          aliases: seed.aliases,
          categoryId: category._id,
          caloriesPerUnit: seed.calories,
          protein: seed.protein,
          carbs: seed.carbs,
          fat: seed.fat,
          unit: seed.unit || 'g',
          baseQuantity: 100,
          source: 'ADMIN',
          status: 'OFFICIAL',
        },
        $setOnInsert: { foodName: seed.foodName },
      },
      { upsert: true },
    );
    changed += result.modifiedCount + result.upsertedCount;
  }

  return changed;
}

function hasMacros(value: any) {
  return Number(value?.protein) > 0 || Number(value?.carbs) > 0 || Number(value?.fat) > 0;
}

async function backfillRecipeNutrition() {
  const recipes = await Recipe.find({ isActive: { $ne: false }, 'ingredients.0': { $exists: true } });
  let updated = 0;

  for (const recipe of recipes) {
    const nutrition = await calculateNutritionForIngredients(recipe.ingredients || []);
    if (!nutrition.details.length || Number(nutrition.calories) <= 0) continue;

    if (
      Number(recipe.calories) !== nutrition.calories ||
      Number(recipe.macroSummary?.protein) !== nutrition.macroSummary.protein ||
      Number(recipe.macroSummary?.carbs) !== nutrition.macroSummary.carbs ||
      Number(recipe.macroSummary?.fat) !== nutrition.macroSummary.fat
    ) {
      recipe.calories = nutrition.calories;
      recipe.macroSummary = nutrition.macroSummary;
      await recipe.save();
      updated += 1;
    }
  }

  return updated;
}

async function backfillMealPlanNutrition() {
  const plans = await MealPlan.find({});
  let updated = 0;

  for (const plan of plans) {
    let changed = false;
    for (const meal of plan.meals as any[]) {
      const usedFoods = Array.isArray(meal.usedFoods) ? meal.usedFoods : [];
      if (usedFoods.length) {
        let calories = 0;
        const macroSummary = { protein: 0, carbs: 0, fat: 0 };
        for (const usage of usedFoods) {
          const food = await FoodItem.findById(usage.foodItemId);
          if (!food) continue;
          const nutrition = await resolveNutritionForFood({
            foodName: food.foodName,
            categoryId: String(food.categoryId),
            quantity: usage.quantityUsed,
            unit: usage.unit || food.unit,
            nutritionSnapshot: food.nutritionSnapshot,
          });
          if (
            Number(usage.calories) !== nutrition.calories ||
            Number(usage.macroSummary?.protein) !== nutrition.macroSummary.protein ||
            Number(usage.macroSummary?.carbs) !== nutrition.macroSummary.carbs ||
            Number(usage.macroSummary?.fat) !== nutrition.macroSummary.fat
          ) {
            usage.calories = nutrition.calories;
            usage.macroSummary = nutrition.macroSummary;
            changed = true;
          }
          calories += nutrition.calories;
          macroSummary.protein += nutrition.macroSummary.protein;
          macroSummary.carbs += nutrition.macroSummary.carbs;
          macroSummary.fat += nutrition.macroSummary.fat;
        }
        if (
          Number(meal.calories) !== calories ||
          Number(meal.macroSummary?.protein) !== macroSummary.protein ||
          Number(meal.macroSummary?.carbs) !== macroSummary.carbs ||
          Number(meal.macroSummary?.fat) !== macroSummary.fat
        ) {
          meal.calories = calories;
          meal.macroSummary = macroSummary;
          changed = true;
        }
      } else if (meal.recipeId) {
        const recipe = await Recipe.findById(meal.recipeId).select('calories macroSummary');
        if (recipe && (Number(recipe.calories) > 0 || hasMacros(recipe.macroSummary))) {
          const recipeCalories = Number(recipe.calories) || 0;
          if (
            Number(meal.calories) !== recipeCalories ||
            Number(meal.macroSummary?.protein) !== Number(recipe.macroSummary?.protein) ||
            Number(meal.macroSummary?.carbs) !== Number(recipe.macroSummary?.carbs) ||
            Number(meal.macroSummary?.fat) !== Number(recipe.macroSummary?.fat)
          ) {
            meal.calories = recipeCalories;
            meal.macroSummary = recipe.macroSummary;
            changed = true;
          }
        }
      }
    }

    const totals = calculateMealTotals(plan.meals || []);
    if (
      Number(plan.totalCalories) !== totals.totalCalories ||
      Number(plan.macroSummary?.protein) !== totals.macroSummary.protein ||
      Number(plan.macroSummary?.carbs) !== totals.macroSummary.carbs ||
      Number(plan.macroSummary?.fat) !== totals.macroSummary.fat
    ) {
      plan.totalCalories = totals.totalCalories;
      plan.macroSummary = totals.macroSummary;
      changed = true;
    }

    if (changed) {
      await plan.save();
      updated += 1;
    }
  }

  return updated;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
    autoIndex: false,
  });

  const massFacts = await NutritionFact.collection.updateMany(
    { baseQuantity: { $exists: false }, unit: { $in: ['g', 'kg', 'ml', 'l'] } },
    { $set: { baseQuantity: 100 } },
  );
  const countFacts = await NutritionFact.collection.updateMany(
    { baseQuantity: { $exists: false }, unit: { $nin: ['g', 'kg', 'ml', 'l'] } },
    { $set: { baseQuantity: defaultNutritionBaseQuantity('item') } },
  );
  const normalizedFacts = massFacts.modifiedCount + countFacts.modifiedCount;

  const nutritionSeedsChanged = await upsertNutritionSeeds();
  const userPlans = await MealPlan.updateMany(
    { inventoryOwnerType: { $ne: 'USER' }, householdId: { $exists: false } },
    { $set: { inventoryOwnerType: 'USER' } },
  );
  const householdPlans = await MealPlan.updateMany(
    { householdId: { $exists: true, $ne: null }, inventoryOwnerType: { $ne: 'HOUSEHOLD' } },
    { $set: { inventoryOwnerType: 'HOUSEHOLD' } },
  );
  const recipesUpdated = await backfillRecipeNutrition();
  const nutritionPlansUpdated = await backfillMealPlanNutrition();

  console.log(JSON.stringify({
    ok: true,
    normalizedFacts,
    nutritionSeedsChanged,
    mealPlansUpdated: userPlans.modifiedCount + householdPlans.modifiedCount,
    recipesUpdated,
    nutritionPlansUpdated,
  }, null, 2));
  await mongoose.disconnect();
}

void main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  try {
    await mongoose.disconnect();
  } catch (_) {
    // no-op
  }
  process.exit(1);
});
