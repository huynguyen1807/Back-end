import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReceiptRecognition } from './receiptRecognition';

test('parses receipt items and a valid purchase date', () => {
  const receipt = parseReceiptRecognition('```json\n{"purchaseDate":"2026-11-09","items":[{"foodName":"Cà rốt Đà Lạt","quantity":2,"unit":"cái","confidence":0.94}]}\n```');
  assert.equal(receipt?.purchaseDate, '2026-11-09');
  assert.deepEqual(receipt?.items, [{
    foodName: 'Cà rốt Đà Lạt',
    quantity: 2,
    unit: 'cái',
    confidence: 0.94,
    categoryName: undefined,
  }]);
});

test('drops malformed rows, bounds confidence, and defaults unknown units', () => {
  const receipt = parseReceiptRecognition(JSON.stringify({
    purchaseDate: '2026-02-31',
    items: [
      { foodName: 'Trứng gà', quantity: 3, unit: 'hộp', confidence: 4 },
      { foodName: '', quantity: 2, unit: 'cái', confidence: 0.9 },
      { foodName: 'Sữa', quantity: -1, unit: 'l', confidence: 0.9 },
    ],
  }));
  assert.equal(receipt?.purchaseDate, undefined);
  assert.deepEqual(receipt?.items, [{
    foodName: 'Trứng gà',
    quantity: 3,
    unit: 'cái',
    confidence: 1,
    categoryName: undefined,
  }]);
});

test('rejects invalid response schemas and caps item count', () => {
  assert.equal(parseReceiptRecognition('not json'), null);
  assert.equal(parseReceiptRecognition('{"rows":[]}'), null);
  const receipt = parseReceiptRecognition(JSON.stringify({
    items: Array.from({ length: 60 }, (_, index) => ({
      foodName: `Món ${index}`,
      quantity: 1,
      unit: 'cái',
      confidence: 0.8,
    })),
  }));
  assert.equal(receipt?.items.length, 48);
});
