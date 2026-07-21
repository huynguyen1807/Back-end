import { FoodCategory } from '../models/foodCategory.model';
import { MealPlan } from '../models/mealPlan.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { NutritionReport } from '../models/nutritionReport.model';
import { normalizeFoodText } from '../utils/foodCategoryValidation';
import {
  convertNutritionQuantity,
  defaultNutritionBaseQuantity,
  normalizeNutritionUnit,
  resolveNutritionFactor,
} from '../utils/nutritionUnits';

type MacroSummary = {
  protein: number;
  carbs: number;
  fat: number;
};

export type NutritionReference = {
  calories: number;
  macroSummary: MacroSummary;
  basisQuantity: number;
  basisUnit: string;
};

type IngredientInput = {
  ingredientName?: string;
  foodName?: string;
  categoryId?: string;
  quantity?: number;
  unit?: string;
  nutritionSnapshot?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    baseQuantity?: number;
    unit?: string;
    source?: string;
    confidence?: number;
  };
};

const emptyMacro = (): MacroSummary => ({ protein: 0, carbs: 0, fat: 0 });

const round = (value: number) => Math.round((Number(value) || 0) * 10) / 10;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function startOfDay(value: string | Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value: string | Date) {
  const date = startOfDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function normalizeName(value?: string) {
  return normalizeFoodText(value || '');
}

function containsNormalizedFoodPhrase(source: string, phrase: string) {
  if (!source || !phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(source);
}

export async function findNutritionFactForFood(foodName: string, categoryId?: any) {
  const name = foodName.trim();
  if (!name) return null;

  const baseQuery: any = { status: 'OFFICIAL' };
  if (categoryId) baseQuery.categoryId = categoryId;

  let fact = await NutritionFact.findOne({
    ...baseQuery,
    $or: [
      { foodName: new RegExp(`^${escapeRegex(name)}$`, 'i') },
      { aliases: new RegExp(`^${escapeRegex(name)}$`, 'i') },
    ]
  }).sort({ source: 1 });

  if (!fact) {
    fact = await NutritionFact.findOne({
      ...baseQuery,
      foodName: new RegExp(escapeRegex(name), 'i')
    }).sort({ source: 1 });
  }

  if (!fact) {
    const candidates = await NutritionFact.find(baseQuery).sort({ source: 1, foodName: 1 }).limit(80);
    const normalizedFoodName = normalizeName(name);
    fact = candidates.find((candidate) => {
      const normalizedFactName = normalizeName(candidate.foodName);
      const candidateNames = [normalizedFactName, ...(candidate.aliases || []).map((alias: string) => normalizeName(alias))];
      return candidateNames.some((candidateName: string) =>
        candidateName.length >= 3 && (
          normalizedFoodName === candidateName ||
          containsNormalizedFoodPhrase(normalizedFoodName, candidateName) ||
          containsNormalizedFoodPhrase(candidateName, normalizedFoodName)
        )
      );
    }) || null;
  }

  if (!fact) {
    fact = await NutritionFact.findOne({
      $or: [
        { foodName: new RegExp(`^${escapeRegex(name)}$`, 'i') },
        { aliases: new RegExp(`^${escapeRegex(name)}$`, 'i') },
      ],
      status: 'OFFICIAL'
    }).sort({ source: 1 });
  }

  if (!fact) {
    const globalCandidates = await NutritionFact.find({ status: 'OFFICIAL' })
      .sort({ source: 1, foodName: 1 })
      .limit(160);
    const normalizedFoodName = normalizeName(name);
    fact = globalCandidates.find((candidate) => {
      const normalizedFactName = normalizeName(candidate.foodName);
      const candidateNames = [normalizedFactName, ...(candidate.aliases || []).map((alias: string) => normalizeName(alias))];
      return candidateNames.some((candidateName: string) => candidateName.length >= 3 && (
        normalizedFoodName === candidateName ||
        containsNormalizedFoodPhrase(normalizedFoodName, candidateName) ||
        containsNormalizedFoodPhrase(candidateName, normalizedFoodName)
      ));
    }) || null;
  }

  return fact;
}

type CategoryBaseline = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  unit: 'g' | 'ml';
};

const CATEGORY_BASELINES: Array<{ keys: string[]; nutrition: CategoryBaseline }> = [
  { keys: ['fruit', 'trai cay'], nutrition: { calories: 60, protein: 0.7, carbs: 15, fat: 0.3, unit: 'g' } },
  { keys: ['vegetable', 'rau cu'], nutrition: { calories: 35, protein: 1.8, carbs: 7, fat: 0.3, unit: 'g' } },
  { keys: ['meat', 'thit'], nutrition: { calories: 200, protein: 26, carbs: 0, fat: 10, unit: 'g' } },
  { keys: ['fish', 'ca'], nutrition: { calories: 180, protein: 22, carbs: 0, fat: 10, unit: 'g' } },
  { keys: ['seafood', 'hai san'], nutrition: { calories: 110, protein: 20, carbs: 2, fat: 2, unit: 'g' } },
  { keys: ['egg', 'trung'], nutrition: { calories: 143, protein: 13, carbs: 0.7, fat: 9.5, unit: 'g' } },
  { keys: ['dairy', 'sua'], nutrition: { calories: 65, protein: 3.4, carbs: 5, fat: 3.5, unit: 'ml' } },
  { keys: ['dry food', 'do kho', 'luong thuc'], nutrition: { calories: 350, protein: 10, carbs: 70, fat: 4, unit: 'g' } },
  { keys: ['cooked food', 'thuc an chin', 'mon an'], nutrition: { calories: 150, protein: 8, carbs: 18, fat: 5, unit: 'g' } },
  { keys: ['frozen food', 'dong lanh'], nutrition: { calories: 150, protein: 12, carbs: 10, fat: 7, unit: 'g' } },
];

async function resolveCategoryBaseline(categoryId?: string) {
  if (!categoryId) return null;
  const category = await FoodCategory.findById(categoryId)
    .select('categoryName displayName aliases')
    .lean();
  if (!category) return null;

  const categoryTerms = [category.categoryName, category.displayName, ...(category.aliases || [])]
    .map((value) => normalizeName(value))
    .filter(Boolean);
  return CATEGORY_BASELINES.find((baseline) =>
    baseline.keys.some((key) => categoryTerms.some((term) => term === key || term.includes(key)))
  )?.nutrition || null;
}

function calculateFromSource(
  quantity: number,
  inputUnit: string | undefined,
  source: { calories?: number; protein?: number; carbs?: number; fat?: number; unit?: string; baseQuantity?: number },
) {
  const factor = resolveNutritionFactor(quantity, inputUnit, source.unit, source.baseQuantity);
  return {
    calories: round(factor * (Number(source.calories) || 0)),
    macroSummary: {
      protein: round(factor * (Number(source.protein) || 0)),
      carbs: round(factor * (Number(source.carbs) || 0)),
      fat: round(factor * (Number(source.fat) || 0)),
    },
  };
}

function buildNutritionReference(
  source: { calories?: number; protein?: number; carbs?: number; fat?: number; unit?: string; baseQuantity?: number },
): NutritionReference {
  return {
    calories: round(Number(source.calories) || 0),
    macroSummary: {
      protein: round(Number(source.protein) || 0),
      carbs: round(Number(source.carbs) || 0),
      fat: round(Number(source.fat) || 0),
    },
    basisQuantity: Number(source.baseQuantity) > 0
      ? Number(source.baseQuantity)
      : defaultNutritionBaseQuantity(source.unit),
    basisUnit: String(source.unit || 'g'),
  };
}

export function calculateNutritionFromReference(
  reference: NutritionReference,
  quantity: number,
  unit: string,
) {
  return calculateFromSource(quantity, unit, {
    calories: reference.calories,
    protein: reference.macroSummary.protein,
    carbs: reference.macroSummary.carbs,
    fat: reference.macroSummary.fat,
    unit: reference.basisUnit,
    baseQuantity: reference.basisQuantity,
  });
}

export function buildInventoryNutritionDisplay(
  nutrition: {
    calories: number;
    macroSummary: MacroSummary;
    referenceNutrition?: NutritionReference;
  },
  inventoryQuantity: number,
  inventoryUnit?: string,
) {
  const normalizedUnit = normalizeNutritionUnit(inventoryUnit);
  const quantity = Math.max(0, Number(inventoryQuantity) || 0);
  const total = { calories: nutrition.calories, macroSummary: nutrition.macroSummary };
  const reference = nutrition.referenceNutrition;

  if (!reference || quantity <= 0) {
    return { ...total, basisQuantity: quantity, basisUnit: normalizedUnit || inventoryUnit || '', isTotalInventory: true };
  }

  const baseUnit = ['g', 'kg'].includes(normalizedUnit)
    ? 'g'
    : ['ml', 'l'].includes(normalizedUnit)
      ? 'ml'
      : undefined;

  if (baseUnit) {
    const baseAmount = convertNutritionQuantity(quantity, normalizedUnit, baseUnit);
    if (baseAmount >= 100) {
      return {
        ...calculateNutritionFromReference(reference, 100, baseUnit),
        basisQuantity: 100,
        basisUnit: baseUnit,
        isTotalInventory: false,
      };
    }
    return {
      ...total,
      basisQuantity: round(baseAmount),
      basisUnit: baseUnit,
      isTotalInventory: true,
    };
  }

  if (quantity > 1) {
    return {
      calories: round(total.calories / quantity),
      macroSummary: {
        protein: round(total.macroSummary.protein / quantity),
        carbs: round(total.macroSummary.carbs / quantity),
        fat: round(total.macroSummary.fat / quantity),
      },
      basisQuantity: 1,
      basisUnit: normalizedUnit || inventoryUnit || 'item',
      isTotalInventory: false,
    };
  }

  return {
    ...total,
    basisQuantity: quantity,
    basisUnit: normalizedUnit || inventoryUnit || 'item',
    isTotalInventory: true,
  };
}

export async function resolveNutritionForFood(input: IngredientInput) {
  const foodName = (input.ingredientName || input.foodName || '').trim();
  const quantity = Number(input.quantity) || 0;

  if (!foodName || quantity <= 0) {
    return {
      calories: 0,
      macroSummary: emptyMacro(),
      nutritionFactId: undefined,
      matched: false,
      estimated: false,
      source: 'UNAVAILABLE',
      unit: undefined,
      baseQuantity: undefined,
      referenceNutrition: undefined,
    };
  }

  const fact = await findNutritionFactForFood(foodName, input.categoryId);
  if (fact) {
    const totals = calculateFromSource(quantity, input.unit, {
      calories: fact.caloriesPerUnit,
      protein: fact.protein,
      carbs: fact.carbs,
      fat: fact.fat,
      unit: fact.unit,
      baseQuantity: fact.baseQuantity || defaultNutritionBaseQuantity(fact.unit),
    });

    return {
      ...totals,
      nutritionFactId: fact._id,
      matched: true,
      estimated: false,
      source: 'NUTRITION_FACT',
      unit: fact.unit,
      baseQuantity: fact.baseQuantity || defaultNutritionBaseQuantity(fact.unit),
      referenceNutrition: buildNutritionReference({
        calories: fact.caloriesPerUnit,
        protein: fact.protein,
        carbs: fact.carbs,
        fat: fact.fat,
        unit: fact.unit,
        baseQuantity: fact.baseQuantity || defaultNutritionBaseQuantity(fact.unit),
      }),
    };
  }

  if (input.nutritionSnapshot && Number(input.nutritionSnapshot.calories) > 0) {
    const snapshot = input.nutritionSnapshot;
    const totals = calculateFromSource(quantity, input.unit, snapshot);
    return {
      ...totals,
      nutritionFactId: undefined,
      matched: true,
      estimated: snapshot.source !== 'ADMIN',
      source: snapshot.source || 'SCAN_AI',
      unit: snapshot.unit,
      baseQuantity: snapshot.baseQuantity,
      referenceNutrition: buildNutritionReference(snapshot),
    };
  }

  const baseline = await resolveCategoryBaseline(input.categoryId);
  if (baseline) {
    const totals = calculateFromSource(quantity, input.unit, {
      ...baseline,
      baseQuantity: 100,
    });
    return {
      ...totals,
      nutritionFactId: undefined,
      matched: true,
      estimated: true,
      source: 'CATEGORY_ESTIMATE',
      unit: baseline.unit,
      baseQuantity: 100,
      referenceNutrition: buildNutritionReference({ ...baseline, baseQuantity: 100 }),
    };
  }

  return {
    calories: 0,
    macroSummary: emptyMacro(),
    nutritionFactId: undefined,
    matched: false,
    estimated: false,
    source: 'UNAVAILABLE',
    unit: undefined,
    baseQuantity: undefined,
    referenceNutrition: undefined,
  };
}

export function calculateMealTotals(meals: any[] = []) {
  const total = meals.reduce(
    (acc, meal) => {
      acc.calories += Number(meal.calories) || 0;
      acc.macroSummary.protein += Number(meal.macroSummary?.protein) || 0;
      acc.macroSummary.carbs += Number(meal.macroSummary?.carbs) || 0;
      acc.macroSummary.fat += Number(meal.macroSummary?.fat) || 0;
      return acc;
    },
    { calories: 0, macroSummary: emptyMacro() }
  );

  return {
    totalCalories: round(total.calories),
    macroSummary: {
      protein: round(total.macroSummary.protein),
      carbs: round(total.macroSummary.carbs),
      fat: round(total.macroSummary.fat)
    }
  };
}

export async function calculateNutritionForIngredients(ingredients: IngredientInput[] = []) {
  const totals = {
    calories: 0,
    macroSummary: emptyMacro()
  };
  const details = [];
  const unmatched = [];

  for (const ingredient of ingredients) {
    const foodName = (ingredient.ingredientName || ingredient.foodName || '').trim();
    const quantity = Number(ingredient.quantity) || 0;

    if (!foodName || quantity <= 0) continue;

    const nutrition = await resolveNutritionForFood(ingredient);

    if (!nutrition.matched) {
      unmatched.push({
        ingredientName: foodName,
        quantity,
        unit: ingredient.unit
      });
      continue;
    }

    totals.calories += nutrition.calories;
    totals.macroSummary.protein += nutrition.macroSummary.protein;
    totals.macroSummary.carbs += nutrition.macroSummary.carbs;
    totals.macroSummary.fat += nutrition.macroSummary.fat;

    details.push({
      ingredientName: foodName,
      quantity,
      unit: ingredient.unit,
      nutritionFactId: nutrition.nutritionFactId,
      calories: nutrition.calories,
      macroSummary: nutrition.macroSummary
    });
  }

  return {
    calories: round(totals.calories),
    macroSummary: {
      protein: round(totals.macroSummary.protein),
      carbs: round(totals.macroSummary.carbs),
      fat: round(totals.macroSummary.fat)
    },
    details,
    unmatched
  };
}

export async function resolveCategory(categoryId?: string, categoryName?: string, createdBy?: string) {
  if (categoryId) {
    const category = await FoodCategory.findById(categoryId);
    if (!category) throw new Error('Category not found');
    return category._id;
  }

  const name = categoryName?.trim();
  if (!name) throw new Error('categoryId or categoryName is required');

  const normalizedName = normalizeFoodText(name);
  const existingCategories = await FoodCategory.find({}).select('categoryName displayName').lean();
  const existing = existingCategories.find((category: any) => {
    return normalizeFoodText(category.categoryName) === normalizedName || normalizeFoodText(category.displayName) === normalizedName;
  });

  if (existing?._id) return existing._id;

  const category = await FoodCategory.create({
    categoryName: name,
    displayName: name,
    isActive: true,
    createdBy
  });

  return category._id;
}

export async function listNutritionFacts(query: any = {}) {
  const filter: any = {};

  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.q) filter.foodName = new RegExp(escapeRegex(String(query.q)), 'i');

  return NutritionFact.find(filter)
    .populate('categoryId', 'categoryName')
    .sort({ foodName: 1 });
}

export async function generateNutritionReport(userId: string, data: any = {}) {
  const periodType = data.periodType === 'MONTH' ? 'MONTH' : 'WEEK';
  const startDate = startOfDay(data.startDate || new Date());
  const defaultDays = periodType === 'MONTH' ? 30 : 7;
  const endDate = data.endDate ? endOfDay(data.endDate) : endOfDay(addDays(startDate, defaultDays - 1));

  const planFilter: any = {
    userId,
    planDate: { $gte: startDate, $lte: endDate }
  };
  if (data.ownerType === 'HOUSEHOLD' && data.householdId) {
    planFilter.householdId = data.householdId;
  } else if (data.ownerType === 'USER') {
    planFilter.$or = [
      { inventoryOwnerType: 'USER' },
      { inventoryOwnerType: { $exists: false }, householdId: { $exists: false } },
    ];
  }
  const plans = await MealPlan.find(planFilter).sort({ planDate: 1 });

  const dailyMap = new Map<string, any>();
  for (const plan of plans) {
    const key = startOfDay(plan.planDate).toISOString();
    const existing = dailyMap.get(key) || {
      date: startOfDay(plan.planDate),
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    };

    existing.calories += Number(plan.totalCalories) || 0;
    existing.protein += Number(plan.macroSummary?.protein) || 0;
    existing.carbs += Number(plan.macroSummary?.carbs) || 0;
    existing.fat += Number(plan.macroSummary?.fat) || 0;
    dailyMap.set(key, existing);
  }

  const dailySummary = Array.from(dailyMap.values()).map((item) => ({
    date: item.date,
    calories: round(item.calories),
    protein: round(item.protein),
    carbs: round(item.carbs),
    fat: round(item.fat)
  }));

  const totals = dailySummary.reduce(
    (acc, day) => {
      acc.calories += day.calories;
      acc.protein += day.protein;
      acc.carbs += day.carbs;
      acc.fat += day.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const dayCount = Math.max(
    1,
    Math.floor((startOfDay(endDate).getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  const reportData = {
    userId,
    householdId: data.ownerType === 'HOUSEHOLD' ? data.householdId : undefined,
    periodType,
    startDate,
    endDate,
    totalCalories: round(totals.calories),
    averageCalories: round(totals.calories / dayCount),
    totalProtein: round(totals.protein),
    totalCarbs: round(totals.carbs),
    totalFat: round(totals.fat),
    dailySummary,
    generatedAt: new Date()
  };

  return NutritionReport.findOneAndUpdate(
    {
      userId,
      periodType,
      startDate,
      ...(data.ownerType === 'HOUSEHOLD' && data.householdId
        ? { householdId: data.householdId }
        : { householdId: { $exists: false } }),
    },
    reportData,
    { returnDocument: 'after', upsert: true }
  );
}
