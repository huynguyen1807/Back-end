import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSchedulableDateTime,
  getMealTypeForScheduledTime,
  getSchedulablePlanDateWindow,
  toPlanDateKey,
} from './mealSchedule';

const noonInVietnam = new Date('2026-07-21T05:00:00.000Z');

test('rejects a date in the past', () => {
  assert.throws(
    () => assertSchedulableDateTime('2026-07-20', '18:30', noonInVietnam),
    /past/,
  );
});

test('rejects an impossible calendar date', () => {
  assert.throws(
    () => assertSchedulableDateTime('2026-02-30', '18:30', noonInVietnam),
    /invalid/,
  );
});

test('rejects a time that has passed today', () => {
  assert.throws(
    () => assertSchedulableDateTime('2026-07-21', '11:59', noonInVietnam),
    /already passed/,
  );
});

test('accepts a future time today', () => {
  assert.deepEqual(
    assertSchedulableDateTime('2026-07-21', '12:50', noonInVietnam),
    { dateKey: '2026-07-21', scheduledTime: '12:50' },
  );
});

test('allows dates through Sunday next week and rejects later dates', () => {
  assert.deepEqual(getSchedulablePlanDateWindow(noonInVietnam), {
    minDateKey: '2026-07-21',
    maxDateKey: '2026-08-02',
  });
  assert.doesNotThrow(
    () => assertSchedulableDateTime('2026-08-02', '18:30', noonInVietnam),
  );
  assert.throws(
    () => assertSchedulableDateTime('2026-08-03', '18:30', noonInVietnam),
    /end of next week/,
  );
});

test('maps every schedule boundary without overlapping adjacent slots', () => {
  assert.equal(getMealTypeForScheduledTime('03:59'), 'LATE_NIGHT');
  assert.equal(getMealTypeForScheduledTime('04:00'), 'BREAKFAST');
  assert.equal(getMealTypeForScheduledTime('10:59'), 'BREAKFAST');
  assert.equal(getMealTypeForScheduledTime('11:00'), 'LUNCH');
  assert.equal(getMealTypeForScheduledTime('13:59'), 'LUNCH');
  assert.equal(getMealTypeForScheduledTime('14:00'), 'AFTERNOON');
  assert.equal(getMealTypeForScheduledTime('17:59'), 'AFTERNOON');
  assert.equal(getMealTypeForScheduledTime('18:00'), 'DINNER');
  assert.equal(getMealTypeForScheduledTime('22:59'), 'DINNER');
  assert.equal(getMealTypeForScheduledTime('23:00'), 'LATE_NIGHT');
});

test('keeps the Vietnam calendar day when MongoDB serializes local midnight as UTC', () => {
  assert.equal(toPlanDateKey(new Date('2026-07-20T17:00:00.000Z')), '2026-07-21');
});
