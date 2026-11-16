const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mongoose = require('mongoose');
const id = n => String(n).padStart(24, '0');
const OWNER = id(1), OTHER = id(2), HOUSE = id(3), ELSEWHERE = id(4);
function load(file, dependencies) {
  const filename = path.resolve(__dirname, '..', file), module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } });
  vm.runInNewContext(source.outputText, { module, exports: module.exports, require(name) {
    if (!(name in dependencies)) throw Error(`Unexpected network/DB dependency: ${name}`);
    return dependencies[name];
  } });
  return module.exports;
}
const Model = load('models/shoppingList.model.ts', { mongoose, './modelHelpers': {
  objectId: mongoose.Schema.Types.ObjectId, timestamps: { timestamps: true },
  existingModel: (_name, schema) => mongoose.model('ShoppingDestinationMemory', schema),
} }).ShoppingList;
function harness({ active = true, view = true, edit = true, member = true } = {}) {
  const records = new Map(); let next = 100, loaded, writes = 0, gates = 0;
  function document(data) { const doc = Model.hydrate(JSON.parse(JSON.stringify(data))); doc.populate = async () => doc; return doc; }
  function seed(data = {}) {
    const doc = new Model({ _id: id(next++), ownerType: 'USER', userId: OWNER, listName: 'Test', status: 'ACTIVE', items: [], ...data });
    records.set(String(doc._id), doc.toObject()); return String(doc._id);
  }
  const subscription = { FamilySubscriptionError: class extends Error {},
    async assertHouseholdSharedAccess() { gates++; if (!active) throw Error('Family access requires active subscription'); },
    async getHouseholdEntitlement() { return { ownerId: OTHER, canReadSharedData: true }; },
  };
  const shoppingModel = {
    async findById(value) { loaded = records.has(String(value)) ? document(records.get(String(value))) : null; return loaded; },
    async findOne(query) {
      const row = [...records.values()].find(row => Object.entries(query).every(([key, value]) =>
        String(key === 'createdFrom.type' ? row.createdFrom?.type : row[key]) === String(value)));
      loaded = row ? document(row) : null; return loaded;
    },
    async create(data) { const doc = new Model({ _id: id(next++), ...data }); await doc.validate(); writes++;
      records.set(String(doc._id), doc.toObject()); loaded = document(doc.toObject()); return loaded; },
    async findOneAndUpdate(query) { assert.equal(String(loaded._id), String(query._id));
      loaded.revision++; await loaded.validate(); records.set(String(loaded._id), loaded.toObject()); writes++; return loaded; },
  };
  const service = load('services/shoppingListService.ts', {
    mongoose, '../models/shoppingList.model': { ShoppingList: shoppingModel },
    '../models/household.model': { Household: { async findOne(query) { return String(query._id) === HOUSE ? { ownerId: OTHER } : null; } } },
    '../models/householdMember.model': { HouseholdMember: {
      async findOne(query) { return member && String(query.householdId) === HOUSE && query.userId === OWNER
        ? { role: 'MEMBER', permission: { canViewShoppingList: view, canEditShoppingList: edit } } : null; },
    } }, './subscriptionService': subscription,
  });
  const controller = load('controllers/shoppingListController.ts', { '../services/shoppingListService': service, '../services/subscriptionService': subscription });
  return { service, controller, seed, records, stats: () => ({ writes, gates }) };
}
const rice = { ingredientName: 'Rice', quantity: 1, unit: 'kg' };

test('legacy Planner callers still use a private Personal MEAL_PLAN list and merge existing items', async () => {
  const h = harness({ active: false });
  const first = await h.service.addMissingIngredientsToShoppingList(OWNER, [rice]);
  const second = await h.service.addMissingIngredientsToShoppingList(OWNER, [rice]);
  assert.equal(String(first._id), String(second._id)); assert.equal(second.ownerType, 'USER');
  assert.equal(String(second.userId), OWNER); assert.equal(second.items[0].quantity, 2);
  assert.equal(h.records.size, 1); assert.equal(h.stats().gates, 0);
});

test('explicit Personal and Family destinations update only the selected active list', async () => {
  for (const ownerType of ['USER', 'HOUSEHOLD']) {
    const h = harness(); const untouched = h.seed();
    const selected = h.seed(ownerType === 'USER' ? {} : { ownerType, userId: undefined, householdId: HOUSE });
    const result = await h.service.addMissingIngredientsToShoppingList(OWNER, [rice], { ownerType, listId: selected, ...(ownerType === 'HOUSEHOLD' ? { householdId: HOUSE } : {}) });
    assert.equal(String(result._id), selected); assert.equal(result.items.length, 1);
    assert.equal(h.records.get(untouched).items.length, 0); assert.equal(h.records.size, 2);
  }
});

test('Planner destination rejects other owners, mismatched context, inactive lists and invalid input without writes', async () => {
  for (const scenario of ['other-owner', 'wrong-context', 'wrong-household', 'completed', 'archived', 'bad-ownerType', 'null', 'personal-household']) {
    const h = harness(); const listId = h.seed({ ...(scenario === 'other-owner' ? { userId: OTHER } : {}),
      ...(scenario === 'wrong-context' ? { ownerType: 'HOUSEHOLD', userId: undefined, householdId: HOUSE } : {}),
      ...(scenario === 'wrong-household' ? { ownerType: 'HOUSEHOLD', userId: undefined, householdId: ELSEWHERE } : {}),
      ...(scenario === 'completed' ? { status: 'COMPLETED' } : {}), ...(scenario === 'archived' ? { status: 'ARCHIVED' } : {}),
    });
    const destination = scenario === 'null' ? null : { ownerType: scenario === 'bad-ownerType' ? 'INVALID' : scenario === 'wrong-household' ? 'HOUSEHOLD' : 'USER', listId,
      ...(['wrong-household', 'personal-household'].includes(scenario) ? { householdId: HOUSE } : {}) };
    await assert.rejects(h.service.addMissingIngredientsToShoppingList(OWNER, [rice], destination));
    assert.equal(h.stats().writes, 0); assert.equal(h.records.get(listId).items.length, 0);
  }
});

test('Family Planner destination respects expiration, membership and both existing permissions', async () => {
  for (const options of [{ active: false }, { member: false }, { view: false }, { edit: false }]) {
    const h = harness(options); const listId = h.seed({ ownerType: 'HOUSEHOLD', userId: undefined, householdId: HOUSE });
    await assert.rejects(h.service.addMissingIngredientsToShoppingList(OWNER, [rice], { ownerType: 'HOUSEHOLD', householdId: HOUSE, listId }));
    assert.equal(h.stats().writes, 0);
  }
});

test('missing-ingredients controller forwards the optional destination with its original response envelope', async () => {
  const h = harness(); const listId = h.seed(); let status, body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
  await h.controller.addMissingIngredientsHandler({ user: { userId: OWNER }, body: { items: [rice], destination: { ownerType: 'USER', listId } } }, res);
  assert.equal(status, 201); assert.equal(body.success, true); assert.equal(String(body.data._id), listId);
});

test('create/add/update/Planner consistently reject invalid item names, quantities, units and purchased types', async () => {
  const invalid = [{ foodName: '' }, { foodName: 'x'.repeat(81) }, { foodName: 12 }, { unit: '' }, { unit: 'x'.repeat(21) }, { unit: '<kg>' },
    { quantity: 0 }, { quantity: -1 }, { quantity: 100001 }, { quantity: 1e-7 }, { quantity: 1.2345 }, { quantity: true }, { quantity: null },
    { quantity: [] }, { quantity: Infinity }, { quantity: NaN }, { quantity: 'false' },
    { isPurchased: 'false' }, { isPurchased: 'true' }, { isPurchased: 0 }, { isPurchased: null }, { reason: 'UNKNOWN' }];
  for (const change of invalid) for (const mode of ['create', 'add', 'update', 'planner']) {
    const h = harness(), listId = h.seed({ items: [{ foodName: 'Rice', quantity: 1, unit: 'kg' }] });
    const input = { foodName: 'Rice', quantity: 1, unit: 'kg', ...change };
    const itemId = String(h.records.get(listId).items[0]._id);
    const call = mode === 'create' ? () => h.service.createShoppingList(OWNER, { listName: 'Invalid', items: [input] })
      : mode === 'add' ? () => h.service.addShoppingListItem(listId, OWNER, input)
        : mode === 'update' ? () => h.service.updateShoppingListItem(listId, itemId, OWNER, input)
          : () => h.service.addMissingIngredientsToShoppingList(OWNER, [input], { ownerType: 'USER', listId });
    await assert.rejects(call(), error => error.statusCode === 400, `${mode}: ${JSON.stringify(change)}`);
    assert.equal(h.stats().writes, 0);
  }
});

test('valid decimal quantities and existing numeric strings remain accepted on every write path', async () => {
  for (const quantity of [0.001, 1.001, 100000, '2.5', 1e-3]) {
    const h = harness(); const created = await h.service.createShoppingList(OWNER, { listName: 'Valid', items: [{ foodName: '  Rice  ', quantity, unit: ' kg ' }] });
    assert.equal(created.items[0].foodName, 'Rice'); assert.equal(created.items[0].unit, 'kg'); assert.equal(created.items[0].quantity, Number(quantity));
    const added = await h.service.addShoppingListItem(String(created._id), OWNER, { foodName: 'Milk', quantity, unit: 'l' });
    assert.equal(added.quantity, Number(quantity));
    await h.service.updateShoppingListItem(String(created._id), String(added._id), OWNER, { quantity });
  }
});

test('server controls purchase timestamps and user metadata across create/add/update', async () => {
  const h = harness(), before = Date.now();
  const created = await h.service.createShoppingList(OWNER, { listName: 'Metadata', items: [{ foodName: 'Rice', quantity: 1, unit: 'kg',
    isPurchased: true, purchasedAt: '1900-01-01', purchasedBy: OTHER, addedBy: OTHER }] });
  assert.equal(String(created.items[0].addedBy), OWNER); assert.equal(String(created.items[0].purchasedBy), OWNER);
  assert.ok(created.items[0].purchasedAt.getTime() >= before);
  const added = await h.service.addShoppingListItem(String(created._id), OWNER, { foodName: 'Milk', quantity: 1, unit: 'l',
    isPurchased: false, purchasedAt: '1900-01-01', purchasedBy: OTHER, addedBy: OTHER });
  assert.equal(added.purchasedAt, undefined); assert.equal(added.purchasedBy, undefined); assert.equal(String(added.addedBy), OWNER);
  const purchased = await h.service.updateShoppingListItem(String(created._id), String(added._id), OWNER, { isPurchased: true, purchasedAt: '1900-01-01', purchasedBy: OTHER });
  assert.equal(String(purchased.purchasedBy), OWNER); assert.ok(purchased.purchasedAt.getTime() >= before);
  const unpurchased = await h.service.updateShoppingListItem(String(created._id), String(added._id), OWNER, { isPurchased: false, purchasedAt: '1900-01-01', purchasedBy: OTHER });
  assert.equal(unpurchased.purchasedAt, undefined); assert.equal(unpurchased.purchasedBy, undefined);
});

test('Planner validates merged quantities before creating or saving and avoids decimal addition artifacts', async () => {
  const fresh = harness(); await assert.rejects(fresh.service.addMissingIngredientsToShoppingList(OWNER, [
    { ...rice, quantity: 100000 }, { ...rice, quantity: 0.001 },
  ]), error => error.statusCode === 400);
  assert.equal(fresh.records.size, 0); assert.equal(fresh.stats().writes, 0);
  const h = harness(); const listId = h.seed({ items: [{ foodName: 'Rice', unit: 'kg', quantity: 99999 }] });
  const snapshot = JSON.stringify(h.records.get(listId));
  await assert.rejects(h.service.addMissingIngredientsToShoppingList(OWNER, [{ ...rice, quantity: 2 }], { ownerType: 'USER', listId }), error => error.statusCode === 400);
  assert.equal(JSON.stringify(h.records.get(listId)), snapshot); assert.equal(h.stats().writes, 0);
  const decimal = harness(); const id = decimal.seed({ items: [{ foodName: 'Rice', unit: 'kg', quantity: 0.1 }] });
  const result = await decimal.service.addMissingIngredientsToShoppingList(OWNER, [{ ...rice, quantity: 0.2 }], { ownerType: 'USER', listId: id });
  assert.equal(result.items[0].quantity, 0.3);
});

test('invalid purchase payload returns HTTP 400 through the actual shopping controller', async () => {
  const h = harness(), listId = h.seed({ items: [{ foodName: 'Rice', quantity: 1, unit: 'kg' }] });
  let code, body; const res = { status(value) { code = value; return this; }, json(value) { body = value; } };
  await h.controller.updateShoppingListItemHandler({ user: { userId: OWNER }, params: { id: listId, itemId: String(h.records.get(listId).items[0]._id) }, body: { isPurchased: 'false' } }, res);
  assert.equal(code, 400); assert.equal(body.success, false); assert.equal(h.stats().writes, 0);
});
