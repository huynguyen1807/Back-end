export type FoodCategoryLike = {
  _id?: any;
  categoryName?: string;
  displayName?: string;
  description?: string;
  aliases?: string[];
  keywords?: string[];
  foodExamples?: string[];
};

export type FoodCategoryValidationResult = {
  isMismatch: boolean;
  confidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  source?: 'DB' | 'GEMINI' | 'NONE';
  selectedCategoryId?: string;
  selectedCategoryName?: string;
  recommendedCategoryId?: string;
  recommendedCategoryName?: string;
  matchedCategoryIds: string[];
  reason?: string;
  warning?: string;
};

type ScoredCategory = {
  category: FoodCategoryLike;
  score: number;
  matchedTerms: string[];
};

const AMBIGUOUS_SINGLE_TERMS = new Set(['ca']);

const CATEGORY_HINTS: Array<{ terms: string[]; categoryKeys: string[] }> = [
  {
    terms: ['ca rot', 'carrot'],
    categoryKeys: ['vegetable', 'rau cu', 'cu qua'],
  },
  {
    terms: ['dua leo', 'dua chuot', 'cucumber', 'ca chua', 'tomato'],
    categoryKeys: ['vegetable', 'rau cu', 'cu qua'],
  },
  {
    terms: ['ca hoi', 'ca thu', 'ca basa', 'ca ngu', 'ca loc', 'ca ro', 'fish'],
    categoryKeys: ['fish', 'ca'],
  },
];

export function normalizeFoodText(value?: string) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCategoryId(category?: FoodCategoryLike) {
  return category?._id ? String(category._id) : undefined;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function getCategoryLabel(category?: FoodCategoryLike) {
  return cleanText(category?.displayName) || cleanText(category?.categoryName) || 'Chưa phân loại';
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? ''));
  if (typeof value === 'string') return [value];
  if (value === null || value === undefined) return [];
  return [String(value)];
}

function uniqueTerms(terms: unknown) {
  const seen = new Set<string>();
  return toStringList(terms)
    .map((term) => String(term ?? '').trim())
    .filter(Boolean)
    .filter((term) => {
      const key = normalizeFoodText(term);
      if (!key || key.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function splitTerms(value?: unknown) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/[,;|/\n]/g)
    .map((term) => term.trim())
    .filter(Boolean);
}

function hasTerm(foodName: string, term: string) {
  const source = normalizeFoodText(foodName);
  const normalizedTerm = normalizeFoodText(term);
  if (!source || !normalizedTerm) return false;
  if (AMBIGUOUS_SINGLE_TERMS.has(normalizedTerm) && source !== normalizedTerm) return false;

  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(source);
}

export function getFoodCategoryHintKeys(foodName: string) {
  const source = normalizeFoodText(foodName);
  if (!source) return [];

  const keys = new Set<string>();
  CATEGORY_HINTS.forEach((hint) => {
    if (hint.terms.some((term) => hasTerm(source, term))) {
      hint.categoryKeys.forEach((key) => keys.add(normalizeFoodText(key)));
    }
  });
  return Array.from(keys);
}

function categoryMatchesHint(category: FoodCategoryLike, hintKeys: string[]) {
  if (!hintKeys.length) return false;
  const terms = categoryTerms(category);
  const categoryKeys = [
    ...terms.names,
    ...terms.aliases,
    ...terms.keywords,
  ].map(normalizeFoodText);
  return hintKeys.some((hintKey) => categoryKeys.includes(hintKey));
}

function categoryTerms(category: FoodCategoryLike) {
  return {
    examples: uniqueTerms(category.foodExamples),
    keywords: uniqueTerms(category.keywords),
    aliases: uniqueTerms(category.aliases),
    names: uniqueTerms([cleanText(category.displayName), cleanText(category.categoryName)]),
    description: uniqueTerms(splitTerms(category.description)),
  };
}

function scoreCategory(foodName: string, category: FoodCategoryLike): ScoredCategory {
  const terms = categoryTerms(category);
  const matchedTerms: string[] = [];
  let score = 0;
  const hintKeys = getFoodCategoryHintKeys(foodName);

  if (categoryMatchesHint(category, hintKeys)) {
    matchedTerms.push('category hint');
    score += 12;
  }

  const apply = (items: string[], weight: number) => {
    for (const term of items) {
      if (hasTerm(foodName, term)) {
        matchedTerms.push(term);
        score += weight;
      }
    }
  };

  apply(terms.examples, 5);
  apply(terms.keywords, 4);
  apply(terms.aliases, 3);
  apply(terms.names, 2);
  apply(terms.description, 1);

  return { category, score, matchedTerms: uniqueTerms(matchedTerms) };
}

function confidenceFromScore(score: number): FoodCategoryValidationResult['confidence'] {
  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'NONE';
}

export function validateFoodCategoryWithDatabase(
  foodName: string,
  selectedCategoryId: any,
  categories: FoodCategoryLike[],
): FoodCategoryValidationResult {
  const selectedId = selectedCategoryId ? String(selectedCategoryId) : undefined;
  const selectedCategory = categories.find((category) => getCategoryId(category) === selectedId);
  const selectedCategoryName = getCategoryLabel(selectedCategory);

  if (!selectedCategory || !foodName.trim()) {
    return {
      isMismatch: false,
      confidence: 'NONE',
      selectedCategoryId: selectedId,
      selectedCategoryName,
      matchedCategoryIds: [],
    };
  }

  const scored = categories
    .map((category) => scoreCategory(foodName, category))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const matchedCategoryIds = scored
    .map((item) => getCategoryId(item.category))
    .filter((id): id is string => Boolean(id));

  const selectedMatch = scored.find((item) => getCategoryId(item.category) === selectedId);
  const selectedScore = selectedMatch?.score ?? 0;
  const best = scored[0];
  const second = scored[1];

  if (selectedScore > 0 && (!best || getCategoryId(best.category) === selectedId || selectedScore >= best.score)) {
    return {
      isMismatch: false,
      confidence: confidenceFromScore(selectedScore),
      source: 'DB',
      selectedCategoryId: selectedId,
      selectedCategoryName,
      matchedCategoryIds,
      reason: selectedMatch?.matchedTerms.length
        ? `Khớp với metadata: ${selectedMatch.matchedTerms.join(', ')}`
        : undefined,
    };
  }

  if (selectedScore > 0 && best && getCategoryId(best.category) !== selectedId) {
    const recommendedCategoryId = getCategoryId(best.category);
    const recommendedCategoryName = getCategoryLabel(best.category);
    const confidence = confidenceFromScore(best.score);
    const scoreGap = best.score - selectedScore;
    const shouldWarn = best.score >= 5 && scoreGap >= 3;

    if (shouldWarn) {
      return {
        isMismatch: Boolean(recommendedCategoryId && recommendedCategoryId !== selectedId),
        confidence,
        source: 'DB',
        selectedCategoryId: selectedId,
        selectedCategoryName,
        recommendedCategoryId,
        recommendedCategoryName,
        matchedCategoryIds,
        reason: best.matchedTerms.length
          ? `Danh mục phù hợp hơn khớp với metadata: ${best.matchedTerms.join(', ')}`
          : undefined,
        warning:
          recommendedCategoryId !== selectedId
            ? `Danh mục "${selectedCategoryName}" không khớp với thực phẩm "${foodName}". Theo dữ liệu food_categories, danh mục phù hợp hơn là "${recommendedCategoryName}".`
            : undefined,
      };
    }

    return {
      isMismatch: false,
      confidence: confidenceFromScore(selectedScore),
      source: 'DB',
      selectedCategoryId: selectedId,
      selectedCategoryName,
      matchedCategoryIds,
      reason: selectedMatch?.matchedTerms.length
        ? `Khớp một phần với metadata: ${selectedMatch.matchedTerms.join(', ')}`
        : undefined,
    };
  }

  const hasClearRecommendation = best && (!second || best.score > second.score);

  if (!hasClearRecommendation) {
    return {
      isMismatch: false,
      confidence: 'NONE',
      source: 'NONE',
      selectedCategoryId: selectedId,
      selectedCategoryName,
      matchedCategoryIds,
    };
  }

  const recommendedCategoryId = getCategoryId(best.category);
  const recommendedCategoryName = getCategoryLabel(best.category);
  const confidence = confidenceFromScore(best.score);

  return {
    isMismatch: recommendedCategoryId !== selectedId && confidence !== 'NONE',
    confidence,
    source: 'DB',
    selectedCategoryId: selectedId,
    selectedCategoryName,
    recommendedCategoryId,
    recommendedCategoryName,
    matchedCategoryIds,
    reason: best.matchedTerms.length
      ? `Khớp với metadata: ${best.matchedTerms.join(', ')}`
      : undefined,
    warning:
      recommendedCategoryId !== selectedId && confidence !== 'NONE'
        ? `Danh mục "${selectedCategoryName}" không khớp với thực phẩm "${foodName}". Theo dữ liệu food_categories, danh mục phù hợp hơn là "${recommendedCategoryName}".`
        : undefined,
  };
}
