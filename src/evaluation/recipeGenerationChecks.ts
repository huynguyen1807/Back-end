/**
 * Các hàm kiểm tra tự động cho công thức AI (`AiRecipeDraft`) — tách ra từ
 * `scripts/evaluateRecipeGeneration.ts` để dùng chung với
 * `scripts/buildRecipeTuningDataset.ts` (script lọc dữ liệu "sạch" để fine-tune), tránh lặp
 * logic ở 2 nơi rồi lệch nhau.
 */
import type { AiRecipeDraft } from '../services/aiRecipeProvider';
import type { RecipeGenEvalScenario } from './recipeGenerationDataset';
import { normalizeFoodText } from '../utils/foodCategoryValidation';

export const UNIT_WHITELIST = new Set(['g', 'kg', 'ml', 'l', 'quả', 'cái']);
export const PANTRY_BLOCKLIST = [
  'muoi', 'duong', 'tieu', 'dau an', 'nuoc mam', 'nuoc tuong', 'toi', 'ot',
  'rau thom', 'hanh la', 'ngo', 'gia vi',
];
export const FORBIDDEN_NAME_PATTERNS = [/\+/, / kết hợp /i, /breakfast with/i, /lunch with/i, /dinner with/i];

export type RecipeCheck = {
  nameOk: boolean;
  calorieOk: boolean;
  ingredientsSourcedOk: boolean;
  missingNotPantryOk: boolean;
  unitsOk: boolean;
};

export function buildIngredientSignature(ingredients: Array<{ ingredientName?: string }> = []) {
  return ingredients
    .map((ingredient) => normalizeFoodText(ingredient.ingredientName || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

export function checkName(recipeName: string): boolean {
  if (!recipeName.trim()) return false;
  return !FORBIDDEN_NAME_PATTERNS.some((pattern) => pattern.test(recipeName));
}

export function checkCalories(draft: AiRecipeDraft, scenario: RecipeGenEvalScenario): boolean {
  const allocation = scenario.input.allocations.find((a) => a.mealType === draft.mealType);
  if (!allocation || !draft.calories) return true;
  const tolerance = 0.3;
  const lower = allocation.min * (1 - tolerance);
  const upper = allocation.max * (1 + tolerance);
  return draft.calories >= lower && draft.calories <= upper;
}

export function checkIngredientsSourced(draft: AiRecipeDraft, scenario: RecipeGenEvalScenario): boolean {
  if (draft.availabilityStatus !== 'ENOUGH_INGREDIENTS') return true;
  const inventoryKeys = new Set(scenario.input.priorityFoods.map((f) => normalizeFoodText(f.foodName)));
  const ingredients = draft.ingredients || [];
  if (!ingredients.length) return false;
  return ingredients.every((ingredient) => {
    const key = normalizeFoodText(ingredient.ingredientName || '');
    if (!key) return false;
    return inventoryKeys.has(key) || PANTRY_BLOCKLIST.includes(key) ||
      Array.from(inventoryKeys).some((invKey) => key.includes(invKey) || invKey.includes(key));
  });
}

export function checkMissingNotPantry(draft: AiRecipeDraft): boolean {
  if (draft.availabilityStatus !== 'MISSING_INGREDIENTS') return true;
  const missing = draft.missingIngredients || [];
  return missing.every((ingredient) => {
    const key = normalizeFoodText(ingredient.ingredientName || '');
    return !PANTRY_BLOCKLIST.some((pantryKey) => key === pantryKey || key.includes(pantryKey));
  });
}

export function checkUnits(draft: AiRecipeDraft): boolean {
  const all = [...(draft.ingredients || []), ...(draft.missingIngredients || [])];
  if (!all.length) return true;
  return all.every((ingredient) => !ingredient.unit || UNIT_WHITELIST.has(ingredient.unit));
}

export function checkDraft(draft: AiRecipeDraft, scenario: RecipeGenEvalScenario): RecipeCheck {
  return {
    nameOk: checkName(draft.recipeName || ''),
    calorieOk: checkCalories(draft, scenario),
    ingredientsSourcedOk: checkIngredientsSourced(draft, scenario),
    missingNotPantryOk: checkMissingNotPantry(draft),
    unitsOk: checkUnits(draft),
  };
}

export function isFullyValid(check: RecipeCheck): boolean {
  return check.nameOk && check.calorieOk && check.ingredientsSourcedOk && check.missingNotPantryOk && check.unitsOk;
}
