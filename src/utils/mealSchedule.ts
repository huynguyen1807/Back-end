export type ScheduledMealType =
  | 'BREAKFAST'
  | 'LUNCH'
  | 'AFTERNOON'
  | 'DINNER'
  | 'LATE_NIGHT';

export const MEAL_SCHEDULE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const MEAL_TIME_SLOTS: Array<{
  mealType: ScheduledMealType;
  defaultTime: string;
  startMinute: number;
  endMinute: number;
}> = [
  { mealType: 'BREAKFAST', defaultTime: '07:30', startMinute: 4 * 60, endMinute: 10 * 60 + 59 },
  { mealType: 'LUNCH', defaultTime: '12:00', startMinute: 11 * 60, endMinute: 13 * 60 + 59 },
  { mealType: 'AFTERNOON', defaultTime: '15:30', startMinute: 14 * 60, endMinute: 17 * 60 + 59 },
  { mealType: 'DINNER', defaultTime: '19:00', startMinute: 18 * 60, endMinute: 22 * 60 + 59 },
  { mealType: 'LATE_NIGHT', defaultTime: '23:30', startMinute: 23 * 60, endMinute: 3 * 60 + 59 },
];

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function getDateTimeParts(value: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MEAL_SCHEDULE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function isValidPlanDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

export function toPlanDateKey(value: string | Date) {
  if (typeof value === 'string') {
    const candidate = value.slice(0, 10);
    if (isValidPlanDateKey(candidate)) return candidate;
    if (DATE_KEY_PATTERN.test(candidate)) throw new Error('planDate is invalid');
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('planDate is invalid');
  return getDateTimeParts(date).dateKey;
}

export function planDateFromKey(dateKey: string) {
  if (!isValidPlanDateKey(dateKey)) throw new Error('planDate must use YYYY-MM-DD format');
  return new Date(`${dateKey}T00:00:00+07:00`);
}

export function getCurrentPlanDateKey(now = new Date()) {
  return getDateTimeParts(now).dateKey;
}

function addDaysToDateKey(dateKey: string, days: number) {
  if (!isValidPlanDateKey(dateKey)) throw new Error('planDate is invalid');
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function getSchedulablePlanDateWindow(now = new Date()) {
  const minDateKey = getCurrentPlanDateKey(now);
  const [year, month, day] = minDateKey.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;

  return {
    minDateKey,
    maxDateKey: addDaysToDateKey(minDateKey, 13 - daysFromMonday),
  };
}

export function assertSchedulablePlanDate(planDate: string | Date, now = new Date()) {
  const dateKey = toPlanDateKey(planDate);
  const { minDateKey, maxDateKey } = getSchedulablePlanDateWindow(now);
  if (dateKey < minDateKey) {
    throw new Error('Cannot schedule a meal in the past');
  }
  if (dateKey > maxDateKey) {
    throw new Error('Cannot schedule a meal beyond the end of next week');
  }
  return dateKey;
}

export function normalizeScheduledTime(value: unknown) {
  const time = String(value || '').trim();
  if (!TIME_PATTERN.test(time)) {
    throw new Error('scheduledTime must use HH:mm format');
  }
  return time;
}

export function scheduledDateTime(dateKey: string, scheduledTime: string) {
  const time = normalizeScheduledTime(scheduledTime);
  const result = new Date(`${dateKey}T${time}:00+07:00`);
  if (Number.isNaN(result.getTime())) throw new Error('Scheduled date and time are invalid');
  return result;
}

export function assertSchedulableDateTime(
  planDate: string | Date,
  scheduledTime: unknown,
  now = new Date(),
) {
  const dateKey = toPlanDateKey(planDate);
  const time = normalizeScheduledTime(scheduledTime);
  const todayKey = getCurrentPlanDateKey(now);

  assertSchedulablePlanDate(dateKey, now);
  if (scheduledDateTime(dateKey, time).getTime() < now.getTime()) {
    throw new Error('Cannot schedule a meal at a time that has already passed');
  }

  return { dateKey, scheduledTime: time };
}

export function getMealTypeForScheduledTime(value: unknown): ScheduledMealType {
  const time = normalizeScheduledTime(value);
  const [hour, minute] = time.split(':').map(Number);
  const minuteOfDay = hour * 60 + minute;

  return MEAL_TIME_SLOTS.find((slot) => {
    if (slot.startMinute <= slot.endMinute) {
      return minuteOfDay >= slot.startMinute && minuteOfDay <= slot.endMinute;
    }
    return minuteOfDay >= slot.startMinute || minuteOfDay <= slot.endMinute;
  })?.mealType || 'LATE_NIGHT';
}

export function buildInventoryContextKey(ownerType?: string, householdId?: unknown) {
  if (ownerType === 'HOUSEHOLD' && householdId) return `HOUSEHOLD:${String(householdId)}`;
  return 'USER';
}
