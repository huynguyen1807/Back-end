export const MAX_SCAN_FOODS = 12;
import { cleanBoundingBox, BoundingBox } from './scanBatchValidation';

export type GeminiScanCandidate = {
  foodName?: string;
  normalizedName?: string;
  categoryName?: string;
  confidence?: number;
  reason?: string;
};

export type GeminiScanFood = GeminiScanCandidate & {
  boundingBox?: BoundingBox;
  visibility?: 'CLEAR' | 'PACKAGED' | 'OCCLUDED';
  foodState?: 'RAW' | 'COOKED' | 'UNKNOWN';
  isFood?: boolean;
  candidates?: GeminiScanCandidate[];
  visualEvidence?: string[];
  estimatedQuantity?: { quantity?: number; unit?: string };
  preferredStorageType?: string;
  estimatedExpiryDays?: number;
  nutritionPer100g?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  warnings?: string[];
};

export type GeminiScanResult = GeminiScanFood & { foods?: GeminiScanFood[] };

function cleanCandidate(candidate: GeminiScanCandidate): GeminiScanCandidate {
  return {
    foodName: typeof candidate.foodName === 'string' ? candidate.foodName.trim().slice(0, 160) : undefined,
    normalizedName: typeof candidate.normalizedName === 'string' ? candidate.normalizedName.slice(0, 160) : undefined,
    categoryName: typeof candidate.categoryName === 'string' ? candidate.categoryName.slice(0, 160) : undefined,
    confidence: Number.isFinite(Number(candidate.confidence)) ? Math.max(0, Math.min(1, Number(candidate.confidence))) : 0,
    reason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 240) : undefined,
  };
}

export function parseScanPayload(text: string): GeminiScanResult | null {
  const clean = text.replace(/```(?:json)?/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(clean.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as GeminiScanResult;
    // An empty foods array is a valid no-food result. Other malformed payloads
    // should fail rather than silently become a successful empty scan.
    if (!Array.isArray(value.foods) && typeof value.foodName !== 'string' && value.isFood !== false) return null;
    return value;
  } catch {
    return null;
  }
}

export function getDistinctScanFoods(parsed: GeminiScanResult): GeminiScanFood[] {
  if (parsed.isFood === false) return [];
  const foods = Array.isArray(parsed.foods) ? parsed.foods : [parsed];
  const seen = new Set<string>();
  return foods.filter((food): food is GeminiScanFood => {
    if (!food || typeof food !== 'object' || food.isFood === false || typeof food.foodName !== 'string' || !food.foodName.trim()) return false;
    // Candidates are alternative identities for ONE object, never extra foods.
    const key = food.foodName.trim().toLocaleLowerCase('vi').normalize('NFC');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SCAN_FOODS).map((food) => ({
    ...food, ...cleanCandidate(food),
    boundingBox: cleanBoundingBox(food.boundingBox),
    visibility: ['CLEAR', 'PACKAGED', 'OCCLUDED'].includes(food.visibility ?? '') ? food.visibility : 'OCCLUDED',
    foodState: ['RAW', 'COOKED'].includes(food.foodState ?? '') ? food.foodState : 'UNKNOWN',
    candidates: Array.isArray(food.candidates) ? food.candidates.filter((candidate) => candidate && typeof candidate === 'object').slice(0, 3).map(cleanCandidate) : [],
    estimatedQuantity: {
      quantity: Number(food.estimatedQuantity?.quantity),
      unit: typeof food.estimatedQuantity?.unit === 'string' ? food.estimatedQuantity.unit : undefined,
    },
  }));
}
