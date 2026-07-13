import { GoogleGenerativeAI } from '@google/generative-ai';

export type AvailabilityStatus = 'ENOUGH_INGREDIENTS' | 'MISSING_INGREDIENTS';

export type MealCalorieAllocation = {
  mealType: string;
  min: number;
  max: number;
  target: number;
};

export type BmiProfile = {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  gender?: string;
  activityLevel?: string;
  goal?: string;
  bmi?: number;
  category?: string;
  categoryLabel?: string;
};

export type AiRecipeFood = {
  foodName: string;
  quantity: number;
  unit: string;
  status: string;
  daysUntilExpiry: number;
  categoryName?: string;
  calories?: number;
  macroSummary?: {
    protein: number;
    carbs: number;
    fat: number;
  };
};

export type AiRecipeDraft = {
  recipeName?: string;
  description?: string;
  mealType?: string;
  availabilityStatus?: AvailabilityStatus;
  calories?: number;
  macroSummary?: {
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  ingredients?: Array<{
    ingredientName?: string;
    quantity?: number;
    unit?: string;
    isRequired?: boolean;
  }>;
  missingIngredients?: Array<{
    ingredientName?: string;
    quantity?: number;
    unit?: string;
    categoryName?: string;
  }>;
  steps?: string[];
  cookingSteps?: string[];
  cookingTime?: number;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  priorityReasons?: string[];
};

type ExistingRecipeReference = {
  recipeName?: string;
  ingredients?: any[];
  cookingSteps?: any[];
  calories?: number;
  tags?: string[];
};

type GenerateAiRecipeDraftsInput = {
  priorityFoods: AiRecipeFood[];
  allocations: MealCalorieAllocation[];
  preference: any;
  calorieMin: number;
  calorieMax: number;
  calorieTarget: number;
  bmiProfile?: BmiProfile;
  existingRecipes?: ExistingRecipeReference[];
  weather?: string;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function buildIngredientSignature(ingredients: any[] = []) {
  return ingredients
    .map((ingredient) => normalize(ingredient.ingredientName || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

function buildStepSignature(steps: any[] = []) {
  return steps
    .map((step) => normalize(String(step || '').replace(/[^\p{L}\p{N}\s]/gu, '')))
    .filter(Boolean)
    .join('|');
}

function getGenAI(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const hasApiKey = apiKey && apiKey !== 'your_actual_api_key_here';
  return hasApiKey ? new GoogleGenerativeAI(apiKey) : null;
}

function getGeminiModelNames() {
  const configuredModels = (process.env.GEMINI_MODEL || process.env.GEMINI_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(new Set([
    ...configuredModels,
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest'
  ]));
}

function parseJsonFromAiText<T>(text: string, fallback: T): T {
  try {
    const cleanText = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(cleanText);
  } catch (error) {
    try {
      const arrayStart = text.indexOf('[');
      const arrayEnd = text.lastIndexOf(']');
      if (arrayStart >= 0 && arrayEnd > arrayStart) {
        return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      }

      const objectStart = text.indexOf('{');
      const objectEnd = text.lastIndexOf('}');
      if (objectStart >= 0 && objectEnd > objectStart) {
        return JSON.parse(text.slice(objectStart, objectEnd + 1));
      }
    } catch (nestedError) {
      return fallback;
    }

    return fallback;
  }
}

function buildAiRecipePrompt(input: GenerateAiRecipeDraftsInput) {
  const inventory = input.priorityFoods.slice(0, 30).map((food) => ({
    foodName: food.foodName,
    categoryName: food.categoryName,
    quantity: food.quantity,
    unit: food.unit,
    status: food.status,
    daysUntilExpiry: food.daysUntilExpiry,
    calories: food.calories,
    macroSummary: food.macroSummary
  }));
  const existingRecipes = (input.existingRecipes || []).slice(0, 40).map((recipe) => ({
    recipeName: recipe.recipeName,
    ingredientSignature: buildIngredientSignature(recipe.ingredients || []),
    stepSignature: buildStepSignature(recipe.cookingSteps || []),
    calories: recipe.calories,
    tags: recipe.tags || []
  }));

  return `You are a smart Vietnamese meal-planning chef.
Create recipe recommendations from this user inventory. Use realistic cooking knowledge and common recipe standards.

Hard rules:
- Return raw JSON only. No markdown.
- All user-facing fields must use Vietnamese with proper accents: recipeName, description, steps, and priorityReasons.
- Recipe names must be natural Vietnamese dish names without patterns like "A + B", "A ket hop B", "Breakfast with ...", "Lunch with ...".
- Make recipes diverse. Do not repeat the same formula, first ingredient, cooking technique, or dish structure.
- Cross-check against common Vietnamese and home-cooking recipe patterns. Use realistic dishes, not ingredient mashups.
- Rotate cooking techniques across the list: salad, soup, stir-fry, braise, pan-sear, porridge, rice bowl, noodle bowl, smoothie, yogurt bowl, rolls.
- For ENOUGH_INGREDIENTS recipes, only use available inventory ingredients and do not require missing items.
- For MISSING_INGREDIENTS recipes, you may add reasonable missing ingredients, but include all ingredients in the recipe.
- Calories must target the provided meal slot allocation. The total selected slots should stay in the daily range ${input.calorieMin}-${Number.isFinite(input.calorieMax) ? input.calorieMax : 'unlimited'} kcal.
- Prefer near-expiry foods, user preferences, and balanced macros.
- Use BMI context when available. If BMI is not provided, assume a generally healthy adult and avoid extreme diet advice.
- Avoid recipes already listed in Existing recipe references. Change the real dish type, core ingredients, and cooking technique instead of only renaming.
- For missing-ingredient recipes, suggest realistic Vietnamese or common home-cooking dishes that may need extra ingredients; do not repeat the same base formula.

User preferences:
${JSON.stringify(input.preference || {}, null, 2)}

BMI context:
${input.bmiProfile ? JSON.stringify(input.bmiProfile, null, 2) : 'not provided; use standard healthy adult meal assumptions'}

Weather context:
${input.weather || 'not provided'}

Meal calorie allocations:
${JSON.stringify(input.allocations, null, 2)}

Existing recipe references to avoid duplicating:
${JSON.stringify(existingRecipes, null, 2)}

Inventory:
${JSON.stringify(inventory, null, 2)}

Return a JSON array with 3 diverse recipes per meal slot if possible. Each object:
{
  "recipeName": "natural dish name",
  "description": "mô tả ngắn bằng tiếng Việt có dấu",
  "mealType": "BREAKFAST | LUNCH | AFTERNOON | DINNER | LATE_NIGHT",
  "availabilityStatus": "ENOUGH_INGREDIENTS | MISSING_INGREDIENTS",
  "calories": estimated recipe kcal,
  "macroSummary": { "protein": grams, "carbs": grams, "fat": grams },
  "ingredients": [
    { "ingredientName": "name", "quantity": number, "unit": "g|ml|item|serving", "isRequired": true }
  ],
  "missingIngredients": [
    { "ingredientName": "name", "quantity": number, "unit": "g|ml|item|serving", "categoryName": "optional category" }
  ],
  "steps": ["step 1", "step 2", "step 3"],
  "cookingTime": number,
  "difficulty": "EASY | MEDIUM | HARD",
  "priorityReasons": ["lý do ưu tiên bằng tiếng Việt có dấu"]
}`;
}

function normalizeAiRecipeDrafts(
  drafts: AiRecipeDraft[],
  allocations: MealCalorieAllocation[]
): AiRecipeDraft[] {
  const validMealTypes = new Set(allocations.map((allocation) => allocation.mealType));

  return (Array.isArray(drafts) ? drafts : [])
    .map((draft, index) => {
      const mealType = validMealTypes.has(String(draft.mealType))
        ? String(draft.mealType)
        : allocations[index % Math.max(1, allocations.length)]?.mealType;
      const availabilityStatus: AvailabilityStatus =
        draft.availabilityStatus === 'MISSING_INGREDIENTS'
          ? 'MISSING_INGREDIENTS'
          : 'ENOUGH_INGREDIENTS';

      return {
        ...draft,
        mealType,
        availabilityStatus,
        calories: Number(draft.calories) || undefined,
        macroSummary: draft.macroSummary
          ? {
              protein: Number(draft.macroSummary.protein) || 0,
              carbs: Number(draft.macroSummary.carbs) || 0,
              fat: Number(draft.macroSummary.fat) || 0
            }
          : undefined,
        steps: Array.isArray(draft.steps) ? draft.steps : draft.cookingSteps
      };
    })
    .filter(
      (draft) =>
        Boolean(String(draft.recipeName || '').trim()) &&
        Boolean(draft.mealType) &&
        (Array.isArray(draft.ingredients) || Array.isArray(draft.missingIngredients))
    );
}

export async function generateAiRecipeDrafts(
  input: GenerateAiRecipeDraftsInput
): Promise<AiRecipeDraft[]> {
  const genAI = getGenAI();
  if (!genAI || !input.priorityFoods.length) return [];
  const prompt = buildAiRecipePrompt(input);
  const errors: string[] = [];

  for (const modelName of getGeminiModelNames()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.95,
          topP: 0.95,
          topK: 40
        }
      });
      const response = await model.generateContent(prompt);
      const parsed = parseJsonFromAiText<any>(response.response.text(), []);
      const drafts = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.recipes)
          ? parsed.recipes
          : [];

      if (!drafts.length) {
        errors.push(`${modelName}: empty response`);
        continue;
      }

      return normalizeAiRecipeDrafts(drafts, input.allocations);
    } catch (error: any) {
      errors.push(`${modelName}: ${error.message || 'unknown error'}`);
    }
  }

  if (errors.length) {
    console.error('[GEMINI smart meal recipe error]', errors.join(' | '));
  }

  return [];
}
