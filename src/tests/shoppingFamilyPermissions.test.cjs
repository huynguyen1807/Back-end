const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const OWNER = '000000000000000000000001', MEMBER = '000000000000000000000002';
const HOUSE = '000000000000000000000003', LIST = '000000000000000000000004', ITEM = '000000000000000000000005';
function load(file, dependencies) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require(name) {
    if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return module.exports;
}

// Isolated service/controller tests. No dotenv, app startup, MongoDB or provider.
function harness({ userId = MEMBER, role = 'MEMBER', view = true, edit = true,
  memberStatus = 'ACTIVE', householdStatus = 'ACTIVE', missing = false, familyActive = true } = {}) {
  const member = { userId, householdId: HOUSE, role, status: memberStatus,
    permission: { canViewShoppingList: view, canEditShoppingList: edit } };
  const household = { _id: HOUSE, ownerId: OWNER, status: householdStatus };
  let writes = 0; const gates = [];
  const item = { _id: ITEM, foodName: 'Rice', quantity: 1, unit: 'kg', isPurchased: false,
    deleteOne() { list.items.splice(list.items.indexOf(this), 1); } };
  const list = { _id: LIST, ownerType: 'HOUSEHOLD', householdId: HOUSE, status: 'ACTIVE', revision: 0,
    items: [item], async populate() { return this; }, async validate() {}, $getChanges() { return {}; } };
  list.items.id = value => list.items.find(entry => entry._id === value);
  class FamilySubscriptionError extends Error { statusCode = 403; }
  const subscription = { FamilySubscriptionError,
    async getHouseholdEntitlement() {
      if (householdStatus !== 'ACTIVE') throw new FamilySubscriptionError('Inactive household');
      return { ownerId: OWNER, canReadSharedData: true };
    },
    async assertHouseholdSharedAccess(_id, mode) {
      gates.push(mode);
      if (mode === 'EDIT' && !familyActive) throw new FamilySubscriptionError('Family access expired');
    },
  };
  const service = load('services/shoppingListService.ts', {
    mongoose: { Types: { ObjectId: { isValid: value => /^[a-f\d]{24}$/i.test(value) } } },
    '../models/householdMember.model': { HouseholdMember: {
      async findOne(query) { return !missing && member.status === query.status && member.userId === query.userId ? member : null; },
      find(query) { return { async select() { return !missing && member.status === query.status && member.userId === query.userId
        && (member.role === 'OWNER' || member.permission.canViewShoppingList === true) ? [member] : []; } }; },
    } },
    '../models/household.model': { Household: { async findOne(query) { return household.status === query.status ? household : null; } } },
    '../models/shoppingList.model': { ShoppingList: {
      async findById() { return list; },
      find(query) { return { populate() { return this; }, async sort() {
        return query.ownerType === 'HOUSEHOLD' ? [list]
          : query.$or.some(part => part.ownerType === 'HOUSEHOLD' && part.householdId.$in.includes(HOUSE)) ? [list] : [];
      } }; },
      async create() { writes++; return list; },
      async findOneAndUpdate() { writes++; list.revision++; return list; },
    } },
    './subscriptionService': subscription,
  });
  const controller = load('controllers/shoppingListController.ts', {
    '../services/shoppingListService': service, '../services/subscriptionService': subscription,
  });
  return { service, controller, list, gates, userId, writes: () => writes };
}
const mutations = {
  create: h => h.service.createShoppingList(h.userId, { ownerType: 'HOUSEHOLD', householdId: HOUSE, listName: 'Shared' }),
  add: h => h.service.addShoppingListItem(LIST, h.userId, { foodName: 'Milk', quantity: 1, unit: 'l' }),
  edit: h => h.service.updateShoppingListItem(LIST, ITEM, h.userId, { quantity: 2 }),
  purchase: h => h.service.updateShoppingListItem(LIST, ITEM, h.userId, { isPurchased: true }),
  unpurchase: h => h.service.updateShoppingListItem(LIST, ITEM, h.userId, { isPurchased: false }),
  delete: h => h.service.removeShoppingListItem(LIST, ITEM, h.userId),
  complete: h => h.service.completeShoppingList(LIST, h.userId),
};

for (const view of [false, true]) for (const edit of [false, true]) {
  test(`member permissions view=${view}, edit=${edit} apply to collection, detail and every mutation`, async () => {
    const h = harness({ view, edit });
    assert.equal((await h.service.getShoppingLists(MEMBER)).length, view ? 1 : 0);
    if (view) await h.service.getShoppingListById(LIST, MEMBER);
    else await assert.rejects(h.service.getShoppingListById(LIST, MEMBER), /permission/);
    for (const operation of Object.values(mutations)) {
      const fixture = harness({ view, edit });
      if (view && edit) { await operation(fixture); assert.equal(fixture.writes(), 1); assert.deepEqual(fixture.gates, ['EDIT']); }
      else { await assert.rejects(operation(fixture), /permission/); assert.equal(fixture.writes(), 0); assert.deepEqual(fixture.gates, []); }
    }
  });
}

for (const scenario of [
  { name: 'removed member', memberStatus: 'REMOVED' },
  { name: 'inactive membership', memberStatus: 'INACTIVE' },
  { name: 'nonmember', missing: true },
  { name: 'inactive household', householdStatus: 'INACTIVE' },
  { name: 'OWNER role with different ownerId', role: 'OWNER' },
  { name: 'ownerId with MEMBER role', userId: OWNER },
]) {
  test(`${scenario.name} cannot list, read or mutate shared lists`, async () => {
    const h = harness(scenario);
    assert.equal((await h.service.getShoppingLists(h.userId)).length, 0);
    await assert.rejects(h.service.getShoppingListById(LIST, h.userId), /permission/);
    for (const operation of Object.values(mutations)) {
      const fixture = harness(scenario);
      await assert.rejects(operation(fixture), /permission/); assert.equal(fixture.writes(), 0);
    }
  });
}

test('consistent active Owner can list/read/write with both permission flags false', async () => {
  const options = { userId: OWNER, role: 'OWNER', view: false, edit: false };
  const h = harness(options);
  assert.equal((await h.service.getShoppingLists(OWNER)).length, 1);
  await h.service.getShoppingListById(LIST, OWNER);
  for (const operation of Object.values(mutations)) {
    const fixture = harness(options); await operation(fixture);
    assert.equal(fixture.writes(), 1); assert.deepEqual(fixture.gates, ['EDIT']);
  }
});

test('expiration still permits reads but denies all writes, including Owner overrides', async () => {
  for (const options of [{}, { userId: OWNER, role: 'OWNER', view: false, edit: false }]) {
    const h = harness({ ...options, familyActive: false });
    assert.equal((await h.service.getShoppingLists(h.userId)).length, 1);
    await h.service.getShoppingListById(LIST, h.userId);
    for (const operation of Object.values(mutations)) {
      const fixture = harness({ ...options, familyActive: false });
      await assert.rejects(operation(fixture), /expired/); assert.equal(fixture.writes(), 0);
    }
  }
});

test('controller denies edit-without-view with HTTP 403 before changing any data', async () => {
  const h = harness({ view: false, edit: true });
  let status, body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  await h.controller.updateShoppingListItemHandler({ user: { userId: MEMBER }, params: { id: LIST, itemId: ITEM }, body: { isPurchased: true } }, res);
  assert.equal(status, 403); assert.equal(body.success, false);
  assert.equal(h.list.items[0].isPurchased, false); assert.equal(h.writes(), 0);
});

test('scoped Family refresh enforces membership/view and still permits expired read access', async () => {
  for (const options of [{}, { familyActive: false }, { view: false }, { missing: true }, { memberStatus: 'REMOVED' }]) {
    const h = harness(options);
    const reading = h.service.getShoppingLists(MEMBER, 'ACTIVE', { ownerType: 'HOUSEHOLD', householdId: HOUSE });
    if (options.view === false || options.missing || options.memberStatus) await assert.rejects(reading, /permission/);
    else assert.equal((await reading).length, 1);
    assert.equal(h.writes(), 0);
  }
});
