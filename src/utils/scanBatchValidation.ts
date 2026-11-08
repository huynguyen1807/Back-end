export type BoundingBox = [number, number, number, number]; // yMin, xMin, yMax, xMax in 0..1000
export function cleanBoundingBox(value: unknown): BoundingBox | undefined {
  if (!Array.isArray(value) || value.length !== 4 || value.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000)) return undefined;
  const [top, left, bottom, right] = value;
  if (bottom - top < 10 || right - left < 10) return undefined;
  return [top, left, bottom, right];
}
export function boxToPixels(box: BoundingBox, width: number, height: number) {
  const x = Math.floor(box[1] * width / 1000), y = Math.floor(box[0] * height / 1000);
  return { x, y, width: Math.max(1, Math.min(width - x, Math.ceil((box[3] - box[1]) * width / 1000))), height: Math.max(1, Math.min(height - y, Math.ceil((box[2] - box[0]) * height / 1000))) };
}
export function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
export function duplicateKey(foodName: string, categoryId: string) {
  return `${foodName.trim().normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ')}|${categoryId}`;
}
