/** Add a Family billing period in UTC, clamping an unavailable day to month-end. */
export function addFamilyCalendarMonths(value: Date, months: 1 | 12): Date {
  if (!Number.isFinite(value.getTime()) || (months !== 1 && months !== 12)) {
    throw new Error('Invalid Family calendar billing period');
  }
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(result.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  result.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid Family calendar billing result');
  return result;
}
