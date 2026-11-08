import assert from 'node:assert/strict';
import test from 'node:test';
import { getStorageAdvice, getStorageGuidance, referenceFoodStatus } from './storageGuidance';
import { boxToPixels, cleanBoundingBox, duplicateKey, parseCalendarDate } from './scanBatchValidation';

test('salmon freezer guide is distinct from refrigerator and is a quality reminder', () => {
  const frozen = getStorageGuidance('Cá hồi phi lê', 'RAW', 'FREEZER')!;
  const chilled = getStorageGuidance('Cá hồi phi lê', 'RAW', 'REFRIGERATOR')!;
  assert.deepEqual([frozen.minDays, frozen.maxDays], [60, 90]);
  assert.equal(frozen.kind, 'QUALITY');
  assert.deepEqual([chilled.minDays, chilled.maxDays], [1, 3]);
  assert.match(frozen.temperature, /18/);
  assert.match(frozen.sourceUrl, /^https:\/\/www.foodsafety.gov\//);
});
test('unknown identity, state, or unsuitable storage never gets invented shelf life', () => {
  assert.equal(getStorageGuidance('Cá hồi', 'UNKNOWN', 'FREEZER'), null);
  assert.equal(getStorageGuidance('Cá hồi', 'RAW', 'OUTSIDE'), null);
  assert.equal(getStorageGuidance('Món không biết', 'RAW', 'REFRIGERATOR'), null);
  assert.equal(getStorageGuidance('Cá hồi đã nấu', 'COOKED', 'FREEZER'), null);
});
test('passing a reference reminder requires a check, not an expired-food conclusion', () => {
  const past = new Date('2026-10-01T12:00:00Z'), now = new Date('2026-11-08T12:00:00Z');
  assert.equal(referenceFoodStatus(past, 'REFERENCE', now), 'NEED_CHECK');
  assert.equal(referenceFoodStatus(past, 'PACKAGE', now), 'EXPIRED');
  assert.equal(referenceFoodStatus(new Date('2026-12-01T12:00:00Z'), 'REFERENCE', now), 'SAFE');
});
test('crop coordinates preserve axis order and stay inside the actual image', () => {
  const box = cleanBoundingBox([100, 200, 600, 800])!;
  assert.deepEqual(boxToPixels(box, 1600, 1000), { x: 320, y: 100, width: 960, height: 500 });
  assert.equal(cleanBoundingBox([800, 100, 100, 400]), undefined);
  assert.equal(cleanBoundingBox([-1, 0, 1000, 1000]), undefined);
  assert.equal(cleanBoundingBox([0, 0, 1, 1]), undefined);
  assert.equal(cleanBoundingBox(['0', 0, 1000, 1000]), undefined);
});
test('invalid calendar dates and accidental accent collisions are rejected', () => {
  assert.equal(parseCalendarDate('2026-02-31'), null);
  assert.equal(parseCalendarDate('2026-13-01'), null);
  assert(parseCalendarDate('2028-02-29'));
  assert.notEqual(duplicateKey('Cá', 'same'), duplicateKey('Cà', 'same'));
  assert.equal(duplicateKey('  Táo  đỏ ', 'a'), duplicateKey('TÁO ĐỎ', 'a'));
});

test('apples and pineapple require form, with separate whole and cut reminders', () => {
  assert.equal(getStorageGuidance('Táo đỏ', 'RAW', 'REFRIGERATOR'), null);
  const whole = getStorageGuidance('Táo đỏ', 'RAW', 'REFRIGERATOR', { storageProfile: 'WHOLE' })!;
  const cut = getStorageGuidance('Táo đỏ', 'RAW', 'REFRIGERATOR', { storageProfile: 'CUT' })!;
  assert.deepEqual([whole.minDays, whole.maxDays, whole.dateAnchor], [28, 42, 'PURCHASE']);
  assert.deepEqual([cut.minDays, cut.maxDays, cut.dateAnchor], [1, 2, 'HANDLING']);
  const pineapple = getStorageGuidance('Dứa', 'RAW', 'REFRIGERATOR', { storageProfile: 'CUT' })!;
  assert.deepEqual([pineapple.minDays, pineapple.maxDays], [3, 7]);
  assert.match(pineapple.sourceUrl, /gov.nl.ca/);
  assert.equal(getStorageGuidance('Dứa', 'RAW', 'OUTSIDE', { storageProfile: 'CUT' }), null);
  assert.match(getStorageAdvice('Dứa', 'RAW', 'OUTSIDE', { storageProfile: 'CUT' }).message, /tủ mát/);
});

test('ambiguous butter/avocado needs an explicit choice and unripe fruit is not assigned a date', () => {
  const advice = getStorageAdvice('Bơ', 'RAW', 'REFRIGERATOR');
  assert.equal(advice.guide, null);
  assert(advice.profiles.some((option) => option.value === 'BUTTER'));
  assert.equal(getStorageGuidance('Bơ', 'RAW', 'REFRIGERATOR', { storageProfile: 'RIPE_WHOLE' })!.minDays, 3);
  assert.equal(getStorageGuidance('Bơ', 'RAW', 'REFRIGERATOR', { storageProfile: 'RIPE_WHOLE' })!.dateAnchor, 'HANDLING');
  assert.equal(getStorageGuidance('Bơ', 'RAW', 'REFRIGERATOR', { storageProfile: 'BUTTER' })!.minDays, 30);
  assert.equal(getStorageGuidance('Bơ lạt', 'UNKNOWN', 'FREEZER', { storageProfile: 'BUTTER' })!.maxDays, 270);
  assert.equal(getStorageGuidance('Quả bơ', 'RAW', 'REFRIGERATOR', { storageProfile: 'UNRIPE_WHOLE' }), null);
  assert.match(getStorageAdvice('Quả bơ', 'RAW', 'OUTSIDE', { storageProfile: 'UNRIPE_WHOLE' }).message, /mỗi ngày/);
});

test('cheese profiles are restricted by opening state and product type', () => {
  assert.equal(getStorageGuidance('Phô mai', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'HARD_CHEESE' }), null);
  const opened = getStorageGuidance('Phô mai', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'HARD_CHEESE', packaging: 'OPENED' })!;
  assert.deepEqual([opened.minDays, opened.maxDays, opened.dateAnchor], [21, 28, 'HANDLING']);
  assert.equal(getStorageGuidance('Phô mai', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'HARD_CHEESE', packaging: 'SEALED' })!.minDays, 180);
  assert.equal(getStorageGuidance('Phô mai', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'COTTAGE_RICOTTA', packaging: 'OPENED' })!.minDays, 7);
  assert.equal(getStorageGuidance('Phô mai', 'UNKNOWN', 'FREEZER', { storageProfile: 'CREAM_CHEESE', packaging: 'OPENED' }), null);
  assert.equal(getStorageGuidance('Phô mai', 'COOKED', 'REFRIGERATOR', { storageProfile: 'HARD_CHEESE', packaging: 'SEALED' }), null);
});

test('milk advice distinguishes pasteurized from UHT without inventing a label expiry', () => {
  const pasteurized = getStorageGuidance('Sữa tươi', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'PASTEURIZED_MILK', packaging: 'SEALED' })!;
  assert.equal(pasteurized.minDays, 7);
  assert.equal(pasteurized.dateAnchor, 'PURCHASE', 'Opening cannot restart the milk storage clock');
  for (const packaging of ['SEALED', 'OPENED']) assert.equal(getStorageGuidance('Sữa tươi', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'UHT_MILK', packaging }), null);
  assert.match(getStorageAdvice('Sữa tươi', 'UNKNOWN', 'REFRIGERATOR', { storageProfile: 'UHT_MILK', packaging: 'SEALED' }).message, /nhà sản xuất/);
});

test('similar words and processed foods are not assigned fresh-food guidance', () => {
  for (const name of ['Dưa hấu', 'Dừa', 'Nước ép táo', 'Táo tàu', 'Gạo thơm', 'Bơ đậu phộng', 'Sữa hạnh nhân', 'Sữa tươi chưa tiệt trùng']) {
    assert.equal(getStorageGuidance(name, 'RAW', 'REFRIGERATOR', { storageProfile: 'WHOLE', packaging: 'SEALED' }), null, name);
  }
  assert.equal(getStorageAdvice('Thực phẩm chưa rõ', 'UNKNOWN', 'OUTSIDE').recommendedStorage, undefined);
});
