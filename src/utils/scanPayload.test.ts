import assert from 'node:assert/strict';
import test from 'node:test';
import { getDistinctScanFoods, MAX_SCAN_FOODS, parseScanPayload } from './scanPayload';

test('separate visible foods retain their own classification and quantity', () => {
  const parsed = parseScanPayload(JSON.stringify({ foods: [
    { foodName: 'Cà chua', categoryName: 'Rau củ', estimatedQuantity: { quantity: 3, unit: 'quả' }, confidence: 0.9 },
    { foodName: 'Cá hồi', categoryName: 'Hải sản', estimatedQuantity: { quantity: 400, unit: 'g' }, confidence: 0.8 },
  ] }));
  assert(parsed);
  const foods = getDistinctScanFoods(parsed);
  assert.equal(foods.length, 2);
  assert.equal(foods[0].categoryName, 'Rau củ');
  assert.equal(foods[1].estimatedQuantity?.quantity, 400);
});

test('candidate alternatives never become extra foods; legacy results still work', () => {
  const legacy = { foodName: 'Táo', candidates: [{ foodName: 'Lê', confidence: 0.4 }] };
  assert.equal(getDistinctScanFoods(legacy).length, 1);
  assert.equal(getDistinctScanFoods(legacy)[0].foodName, 'Táo');
  assert.deepEqual(getDistinctScanFoods({ isFood: false, foodName: 'Cái bàn' }), []);
  assert.deepEqual(getDistinctScanFoods({ foods: [] }), []);
});

test('duplicate food types merge without stripping Vietnamese diacritics', () => {
  const foods = getDistinctScanFoods({ foods: [{ foodName: ' Táo ' }, { foodName: 'TÁO' }, { foodName: 'Cá' }, { foodName: 'Cà' }] });
  assert.deepEqual(foods.map((food) => food.foodName), ['Táo', 'Cá', 'Cà']);
});

test('provider output is bounded and malformed fields cannot crash enrichment', () => {
  const foods = getDistinctScanFoods({ foods: [null, 42, { foodName: 'Trứng', categoryName: {}, estimatedQuantity: { unit: {} }, candidates: [null, { foodName: 'Trứng vịt', categoryName: 42 }] }] as any });
  assert.equal(foods.length, 1);
  assert.equal(foods[0].categoryName, undefined);
  assert.equal(foods[0].estimatedQuantity?.unit, undefined);
  assert.equal(foods[0].candidates?.[0].categoryName, undefined);
  assert.equal(getDistinctScanFoods({ foods: Array.from({ length: 30 }, (_, n) => ({ foodName: `Món ${n}` })) }).length, MAX_SCAN_FOODS);
});

test('invalid JSON and invalid root schemas fail while empty results remain valid', () => {
  assert.equal(parseScanPayload('not json'), null);
  assert.equal(parseScanPayload('{"unexpected":true}'), null);
  assert.equal(parseScanPayload('[]'), null);
  assert.deepEqual(parseScanPayload('```json\n{"foods":[]}\n```'), { foods: [] });
});
