import { normalizeFoodText } from './foodCategoryValidation';

export type CanonicalNutritionUnit = 'g' | 'kg' | 'ml' | 'l' | 'item' | 'serving';

export function normalizeNutritionUnit(value?: string): CanonicalNutritionUnit | string {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  const normalized = normalizeFoodText(raw);

  if (['kg', 'kilogram', 'kilograms'].includes(lower)) return 'kg';
  if (['g', 'gram', 'grams'].includes(lower)) return 'g';
  if (['l', 'liter', 'litre', 'liters', 'litres'].includes(lower)) return 'l';
  if (['ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres'].includes(lower)) return 'ml';
  if (['serving', 'portion', 'phan', 'khau phan'].includes(normalized)) return 'serving';
  if (
    ['item', 'piece', 'pieces', 'count', 'cai', 'qua', 'trai', 'hop', 'goi', 'chai', 'lon'].includes(normalized)
  ) {
    return 'item';
  }

  return normalized || lower;
}

export function defaultNutritionBaseQuantity(unit?: string) {
  const normalized = normalizeNutritionUnit(unit);
  return ['g', 'kg', 'ml', 'l'].includes(normalized) ? 100 : 1;
}

export function convertNutritionQuantity(quantity: number, fromUnit?: string, toUnit?: string) {
  const from = normalizeNutritionUnit(fromUnit);
  const to = normalizeNutritionUnit(toUnit);

  if (!from || !to || from === to) return quantity;
  if (from === 'kg' && to === 'g') return quantity * 1000;
  if (from === 'g' && to === 'kg') return quantity / 1000;
  if (from === 'l' && to === 'ml') return quantity * 1000;
  if (from === 'ml' && to === 'l') return quantity / 1000;

  const fromIsCount = from === 'item' || from === 'serving';
  const toIsCount = to === 'item' || to === 'serving';
  const fromIsMass = from === 'g' || from === 'kg';
  const toIsMass = to === 'g' || to === 'kg';
  const grams = from === 'kg' ? quantity * 1000 : quantity;

  if (fromIsCount && toIsCount) return quantity;
  if (fromIsMass && toIsCount) return Math.max(0, grams / 100);
  if (fromIsCount && toIsMass) return to === 'kg' ? quantity / 10 : quantity * 100;

  return quantity;
}

export function resolveNutritionFactor(
  quantity: number,
  inputUnit?: string,
  nutritionUnit?: string,
  baseQuantity?: number,
) {
  const convertedQuantity = convertNutritionQuantity(Math.max(0, Number(quantity) || 0), inputUnit, nutritionUnit);
  const base = Number(baseQuantity) > 0
    ? Number(baseQuantity)
    : defaultNutritionBaseQuantity(nutritionUnit);

  return convertedQuantity / base;
}
