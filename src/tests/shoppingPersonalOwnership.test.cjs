const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mongoose = require('mongoose');

// Actual service/controller and Mongoose validation; all persistence is mocked.
// Never loads dotenv, app startup, a network client or a database connection.
function load(file, dependencies) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  vm.runInNewContext(source.outputText, { module, exports: module.exports, require(name) {
    if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } }, { filename });
  return module.exports;
}
const { ShoppingList: Model } = load('models/shoppingList.model.ts', { mongoose, './modelHelpers': {
  objectId: mongoose.Schema.Types.ObjectId, timestamps: { timestamps: true },
  existingModel: (_name, schema) => mongoose.model('Shop01MemoryShoppingList', schema),
} });
const id = value => String(value).padStart(24, '0');
const OWNER = id(1), OTHER = id(2), HOUSE = id(3);

function matches(row, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(part => matches(row, part));
    if (expected && typeof expected === 'object') {
      if ('$ne' in expected) return String(row[key]) !== String(expected.$ne);
      if ('$in' in expected) return expected.$in.some(value => String(value) === String(row[key]));
    }
    return String(row[key]) === String(expected);
  });
}
function harness({ family = true } = {}) {
  const records = new Map(); let writes = 0, entitlementChecks = 0, sequence = 100;
  const queries = [];
  class FamilySubscriptionError extends Error { statusCode = 403; }
  function seed(data = {}) {
    const doc = new Model({ _id: id(sequence++), ownerType: 'USER', userId: data.ownerType === 'HOUSEHOLD' ? undefined : OWNER,
      listName: 'Personal', status: 'ACTIVE', items: [], ...data });
    doc.populate = async () => doc;
    records.set(String(doc._id), doc);
    return doc;
  }
  const service = load('services/shoppingListService.ts', {
    mongoose,
    '../models/shoppingList.model': { ShoppingList: {
      async create(data) { const doc = seed(data); await doc.validate(); writes++; return doc; },
      async findById(value) { return records.get(String(value)) ?? null; },
      find(query) {
        queries.push(query);
        return { populate() { return this; }, async sort() { return [...records.values()].filter(row => matches(row, query)); } };
      },
      async findOneAndUpdate(query) {
        const doc = records.get(String(query._id));
        if (!doc) return null;
        writes++; doc.revision++; return doc;
      },
    } },
    '../models/householdMember.model': { HouseholdMember: {
      find() { return { async select() { return family ? [{ householdId: HOUSE, role: 'OWNER', permission: {} }] : []; } }; },
      async findOne(query) { return family && String(query.householdId) === HOUSE
        ? { role: query.userId === OWNER ? 'OWNER' : 'MEMBER', permission: { canViewShoppingList: true, canEditShoppingList: true } } : null; },
    } },
    '../models/household.model': { Household: { async findOne() { return family ? { ownerId: OWNER } : null; } } },
    './subscriptionService': { FamilySubscriptionError,
      async getHouseholdEntitlement() { entitlementChecks++; return { ownerId: OWNER, canReadSharedData: family }; },
      async assertHouseholdSharedAccess() { entitlementChecks++; if (!family) throw new FamilySubscriptionError('Family access required'); },
    },
  });
  const controller = load('controllers/shoppingListController.ts', {
    '../services/shoppingListService': service, '../services/subscriptionService': { FamilySubscriptionError },
  });
  return { service, controller, seed, queries, stats: () => ({ writes, entitlementChecks }) };
}
const add = { foodName: 'Rice', quantity: 1, unit: 'kg' };

test('Free owner can create, read, add, edit, purchase/unpurchase, delete and complete without Family checks', async () => {
  const h = harness({ family: false });
  const list = await h.service.createShoppingList(OWNER, { listName: 'Free list' });
  assert.equal(String(list.userId), OWNER);
  assert.equal(await h.service.getShoppingListById(String(list._id), OWNER), list);
  const item = await h.service.addShoppingListItem(String(list._id), OWNER, add);
  const itemId = String(item._id);
  await h.service.updateShoppingListItem(String(list._id), itemId, OWNER, { foodName: 'Brown rice', quantity: 2, unit: 'g', isPurchased: true });
  assert.equal(item.foodName, 'Brown rice'); assert.equal(item.quantity, 2);
  assert.equal(item.isPurchased, true); assert.equal(String(item.purchasedBy), OWNER); assert.ok(item.purchasedAt);
  await h.service.updateShoppingListItem(String(list._id), itemId, OWNER, { isPurchased: false });
  assert.equal(item.isPurchased, false); assert.equal(item.purchasedBy, undefined); assert.equal(item.purchasedAt, undefined);
  await h.service.removeShoppingListItem(String(list._id), itemId, OWNER);
  assert.equal(list.items.length, 0);
  await h.service.completeShoppingList(String(list._id), OWNER);
  assert.equal(list.status, 'COMPLETED'); assert.equal(h.stats().entitlementChecks, 0);
});

test('create ignores client ownership/sharing for explicit or default USER context', async () => {
  for (const ownerType of [undefined, 'USER']) {
    const h = harness({ family: false });
    const list = await h.service.createShoppingList(OWNER, { ownerType, userId: OTHER, householdId: HOUSE,
      listName: 'Private', visibility: 'SHARED', sharedWith: [{ userId: OTHER, permission: 'EDIT' }] });
    assert.equal(String(list.userId), OWNER); assert.equal(list.householdId, undefined);
    assert.equal(list.visibility, 'PERSONAL'); assert.equal(list.sharedWith.length, 0);
    await assert.rejects(h.service.getShoppingListById(String(list._id), OTHER), /permission/);
  }
});

for (const permission of [undefined, 'VIEW', 'EDIT']) {
  test(`non-owner cannot read or mutate Personal list with historical sharing ${permission ?? 'absent'}`, async () => {
    const h = harness();
    const list = h.seed({ visibility: permission ? 'SHARED' : 'PERSONAL',
      sharedWith: permission ? [{ userId: OTHER, permission }] : [], items: [add] });
    const listId = String(list._id), itemId = String(list.items[0]._id);
    const before = JSON.stringify(list.toObject());
    const calls = [
      () => h.service.getShoppingListById(listId, OTHER),
      () => h.service.addShoppingListItem(listId, OTHER, add),
      () => h.service.updateShoppingListItem(listId, itemId, OTHER, { quantity: 5 }),
      () => h.service.updateShoppingListItem(listId, itemId, OTHER, { isPurchased: true }),
      () => h.service.updateShoppingListItem(listId, itemId, OTHER, { isPurchased: false }),
      () => h.service.removeShoppingListItem(listId, itemId, OTHER),
      () => h.service.completeShoppingList(listId, OTHER),
    ];
    for (const call of calls) await assert.rejects(call(), /permission/);
    assert.equal(JSON.stringify(list.toObject()), before);
    assert.equal(h.stats().writes, 0); assert.equal(h.stats().entitlementChecks, 0);
  });
}

test('collection queries include only owned Personal lists while retaining authorized Household lists', async () => {
  const h = harness();
  const mine = h.seed();
  h.seed({ userId: OTHER, sharedWith: [{ userId: OWNER, permission: 'EDIT' }] });
  const completed = h.seed({ status: 'COMPLETED' });
  h.seed({ status: 'ARCHIVED' });
  const shared = h.seed({ ownerType: 'HOUSEHOLD', userId: undefined, householdId: HOUSE });
  h.seed({ ownerType: 'HOUSEHOLD', userId: undefined, householdId: id(99) });
  const ids = rows => rows.map(row => String(row._id)).sort();
  assert.deepEqual(ids(await h.service.getActiveShoppingLists(OWNER)), ids([mine, shared]));
  assert.deepEqual(ids(await h.service.getShoppingLists(OWNER, 'COMPLETED')), ids([completed]));
  // Preserve the existing status filter: ALL currently excludes ARCHIVED.
  assert.deepEqual(ids(await h.service.getShoppingLists(OWNER, 'ALL')), ids([mine, completed, shared]));
  assert.equal(JSON.stringify(h.queries).includes('sharedWith'), false);
});

test('owner still edits legacy shared Personal list without erasing historical sharing fields', async () => {
  const h = harness({ family: false });
  const list = h.seed({ visibility: 'SHARED', sharedWith: [{ userId: OTHER, permission: 'EDIT' }], items: [add] });
  const sharing = JSON.stringify(list.sharedWith);
  await h.service.updateShoppingListItem(String(list._id), String(list.items[0]._id), OWNER, { quantity: 2 });
  assert.equal(list.items[0].quantity, 2); assert.equal(list.visibility, 'SHARED');
  assert.equal(JSON.stringify(list.sharedWith), sharing);
  assert.equal(h.stats().entitlementChecks, 0);
});

test('Household create/read/member mutation still use the existing Family access guards', async () => {
  const h = harness();
  const list = await h.service.createShoppingList(OWNER, { ownerType: 'HOUSEHOLD', householdId: HOUSE, listName: 'Family' });
  assert.equal(list.ownerType, 'HOUSEHOLD'); assert.equal(list.visibility, 'SHARED'); assert.equal(list.userId, undefined);
  await h.service.getShoppingListById(String(list._id), OTHER);
  await h.service.addShoppingListItem(String(list._id), OTHER, add);
  assert.equal(list.items.length, 1); assert.equal(h.stats().entitlementChecks, 3);
});

test('existing controller returns HTTP 403 for former shared user read/write/complete', async () => {
  const h = harness(); const list = h.seed({ sharedWith: [{ userId: OTHER, permission: 'EDIT' }], items: [add] });
  for (const handler of ['getShoppingListHandler', 'addShoppingListItemHandler', 'updateShoppingListItemHandler', 'removeShoppingListItemHandler', 'completeShoppingListHandler']) {
    let status, body;
    const response = { status(value) { status = value; return this; }, json(value) { body = value; } };
    await h.controller[handler]({ user: { userId: OTHER }, params: { id: String(list._id), itemId: String(list.items[0]._id) }, body: add }, response);
    assert.equal(status, 403); assert.equal(body.success, false);
  }
  assert.equal(h.stats().writes, 0);
});

test('context-scoped collection reads isolate Personal/Family and preserve the legacy combined response', async () => {
  const h = harness(); const mine = h.seed(); h.seed({ userId: OTHER, sharedWith: [{ userId: OWNER, permission: 'EDIT' }] });
  const shared = h.seed({ ownerType: 'HOUSEHOLD', userId: undefined, householdId: HOUSE });
  const personal = await h.service.getShoppingLists(OWNER, 'ACTIVE', { ownerType: 'USER' });
  assert.deepEqual(personal.map(row => String(row._id)), [String(mine._id)]);
  assert.equal(h.stats().entitlementChecks, 0);
  const family = await h.service.getShoppingLists(OWNER, 'ACTIVE', { ownerType: 'HOUSEHOLD', householdId: HOUSE });
  assert.deepEqual(family.map(row => String(row._id)), [String(shared._id)]);
  const all = await h.service.getShoppingLists(OWNER, 'ACTIVE'); assert.equal(all.length, 2);
  for (const context of [{ ownerType: 'INVALID' }, { ownerType: 'USER', householdId: HOUSE }, { ownerType: 'HOUSEHOLD' }]) {
    await assert.rejects(h.service.getShoppingLists(OWNER, 'ACTIVE', context));
  }
});
