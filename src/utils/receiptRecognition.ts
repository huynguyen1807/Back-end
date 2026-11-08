export type ReceiptItem = {
  foodName: string;
  quantity: number;
  unit: 'kg' | 'g' | 'ml' | 'l' | 'quả' | 'cái';
  confidence: number;
  categoryName?: string;
  categoryId?: string;
};

export type ReceiptRecognition = {
  purchaseDate?: string;
  items: ReceiptItem[];
};

const VALID_UNITS = new Set(['kg', 'g', 'ml', 'l', 'quả', 'cái']);

export function parseReceiptRecognition(text: string): ReceiptRecognition | null {
  const clean = text.replace(/```(?:json)?/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(clean.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (!Array.isArray(value.items)) return null;

    const items = value.items.flatMap((entry): ReceiptItem[] => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      const foodName = typeof item.foodName === 'string' ? item.foodName.trim().slice(0, 160) : '';
      const quantity = Number(item.quantity);
      if (!foodName || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) return [];
      const rawUnit = typeof item.unit === 'string' ? item.unit.trim().toLocaleLowerCase('vi') : '';
      const rawConfidence = Number(item.confidence);
      return [{
        foodName,
        quantity,
        unit: VALID_UNITS.has(rawUnit) ? rawUnit as ReceiptItem['unit'] : 'cái',
        confidence: Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0,
        categoryName: typeof item.categoryName === 'string' ? item.categoryName.trim().slice(0, 80) : undefined,
      }];
    }).slice(0, 48);

    let purchaseDate: string | undefined;
    if (typeof value.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.purchaseDate)) {
      const date = new Date(`${value.purchaseDate}T12:00:00Z`);
      if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.purchaseDate) {
        purchaseDate = value.purchaseDate;
      }
    }

    return { purchaseDate, items };
  } catch {
    return null;
  }
}
