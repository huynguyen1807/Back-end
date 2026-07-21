import {
  defaultNutritionBaseQuantity,
  normalizeNutritionUnit,
  resolveNutritionFactor,
} from './nutritionUnits';

export type NutritionSnapshotSource = 'SCAN_AI' | 'ADMIN' | 'CATEGORY_ESTIMATE';

export type NutritionSnapshotValue = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  baseQuantity: number;
  unit: string;
  source: NutritionSnapshotSource;
  confidence: number;
  capturedAt: Date;
};

type ValidationResult = {
  value?: NutritionSnapshotValue;
  warning?: string;
};

const round = (value: number) => Math.round(value * 10) / 10;

export function validateNutritionSnapshot(value: any, fallbackUnit = 'g'): ValidationResult {
  if (!value || typeof value !== 'object') return { warning: 'Nutrition snapshot is empty' };

  let calories = Math.max(0, Number(value.calories) || 0);
  const protein = Math.max(0, Number(value.protein) || 0);
  const carbs = Math.max(0, Number(value.carbs) || 0);
  const fat = Math.max(0, Number(value.fat) || 0);
  const macroCalories = protein * 4 + carbs * 4 + fat * 9;

  if (!calories && macroCalories > 0) calories = round(macroCalories);
  if (!calories && !macroCalories) return { warning: 'Nutrition values are all zero' };

  const unit = normalizeNutritionUnit(value.unit || fallbackUnit);
  const baseQuantity = Number(value.baseQuantity) > 0
    ? Number(value.baseQuantity)
    : defaultNutritionBaseQuantity(unit);
  const referenceUnit = ['kg', 'g'].includes(unit) ? 'g' : ['l', 'ml'].includes(unit) ? 'ml' : unit;
  const referenceQuantity = ['g', 'ml'].includes(referenceUnit) ? 100 : 1;
  const factor = resolveNutritionFactor(referenceQuantity, referenceUnit, unit, baseQuantity);
  const perReference = {
    calories: calories * factor,
    protein: protein * factor,
    carbs: carbs * factor,
    fat: fat * factor,
  };

  if (
    perReference.calories > 900
    || perReference.protein > 100
    || perReference.carbs > 100
    || perReference.fat > 100
    || perReference.protein + perReference.carbs + perReference.fat > 115
  ) {
    return { warning: `Nutrition values exceed a realistic ${referenceQuantity}${referenceUnit} range` };
  }

  const perReferenceMacroCalories =
    perReference.protein * 4 + perReference.carbs * 4 + perReference.fat * 9;
  const allowedEnergyDifference = Math.max(60, perReference.calories * 0.45);
  if (
    perReference.calories > 0
    && perReferenceMacroCalories > 0
    && Math.abs(perReference.calories - perReferenceMacroCalories) > allowedEnergyDifference
  ) {
    return { warning: 'Calories do not agree with the supplied macronutrients' };
  }

  return {
    value: {
      calories: round(calories),
      protein: round(protein),
      carbs: round(carbs),
      fat: round(fat),
      baseQuantity,
      unit,
      source: ['SCAN_AI', 'ADMIN', 'CATEGORY_ESTIMATE'].includes(value.source)
        ? value.source
        : 'SCAN_AI',
      confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
      capturedAt: value.capturedAt ? new Date(value.capturedAt) : new Date(),
    },
  };
}
