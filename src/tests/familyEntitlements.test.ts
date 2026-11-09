import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { Subscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { addFamilyCalendarMonths } from '../utils/familyBillingPeriod';

type Row = Record<string, any>;
const OWNER = '000000000000000000000001', MEMBER = '000000000000000000000002';
const HOUSE = '000000000000000000000010', LIST = '000000000000000000000020';
const past = () => new Date('2000-01-01'), future = () => new Date('2999-01-01');
const limits = () => ({ maxMembers: 6, maxFoodItems: 1000, maxStorageLocations: 10, familyCloudEnabled: true, multiStorageEnabled: true });

function load(file: string, dependencies: Row) {
  const filename = path.resolve(__dirname, '..', file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, process: { env: {} }, require(name: string) {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } }, { filename });
  return module.exports;
}

function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$and') return value.every((part: Row) => matches(row, part));
    if (key === '$or') return value.some((part: Row) => matches(row, part));
    const actual = row[key];
    if (value === null) return actual == null;
    if (value && typeof value === 'object') return Object.entries(value).every(([operator, target]) => {
      if (operator === '$exists') return (actual !== undefined) === target;
      if (operator === '$in') return (target as any[]).includes(actual);
      if (operator === '$ne') return actual !== target;
      if (operator === '$lte') return actual <= (target as any);
      if (operator === '$gt') return actual > (target as any);
      throw new Error(`Unsupported query operator: ${operator}`);
    });
    return actual === value;
  });
}

function harness() {
  const household: Row = { _id: HOUSE, ownerId: OWNER, status: 'ACTIVE' };
  const members: Row[] = [
    { householdId: HOUSE, userId: OWNER, status: 'ACTIVE', role: 'OWNER', permission: {} },
    { householdId: HOUSE, userId: MEMBER, status: 'ACTIVE', role: 'MEMBER', permission: { canViewInventory: true, canEditInventory: true, canViewShoppingList: true, canEditShoppingList: true } },
  ];
  const plans: Row[] = [
    { _id: 'free', scope: 'USER', planCode: 'FREE', price: 0, isActive: true, limits: { ...limits(), familyCloudEnabled: false } },
    { _id: 'premium', scope: 'USER', planCode: 'PREMIUM_MONTHLY', price: 123, isActive: true, limits: limits() },
    { _id: 'family', scope: 'HOUSEHOLD', planCode: 'FAMILY_MONTHLY', price: 456, isActive: true, limits: limits() },
  ];
  const subscriptions: Row[] = [];
  const events: Row[] = [];
  const reads: Row[] = [];
  const mutations: string[] = [];
  const counts = { food: 0, storage: 0 };
  function query(rows: Row[], filter: Row, many = false): any {
    let populate = false;
    function result(order?: Row) {
      let found = rows.filter((row) => matches(row, filter));
      if (order) found = [...found].sort((a, b) => {
        for (const [key, direction] of Object.entries(order)) {
          if (a[key] > b[key]) return Number(direction);
          if (a[key] < b[key]) return -Number(direction);
        }
        return 0;
      });
      const wrap = (row: Row) => ({ ...row, ...(populate ? { planId: plans.find((plan) => plan._id === row.planId) ?? null } : {}), toObject: () => ({ ...row }) });
      return many ? found.map(wrap) : found[0] ? wrap(found[0]) : null;
    }
    return { populate() { populate = true; return this; }, sort(order: Row) { return Promise.resolve(result(order)); },
      then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); } };
  }
  const subscriptionModel = {
    findOne(filter: Row) { reads.push(filter); return query(subscriptions, filter); },
    async updateMany(filter: Row, update: Row) { for (const row of subscriptions.filter((item) => matches(item, filter))) Object.assign(row, update); },
    async findOneAndUpdate(filter: Row, update: Row) {
      let row = subscriptions.find((item) => matches(item, filter));
      if (!row) { row = { _id: `sub-${subscriptions.length}` }; subscriptions.push(row); }
      Object.assign(row, update); return row;
    },
  };
  const planModel = {
    findOne(filter: Row) { return query(plans, filter); },
    find(filter: Row) { return query(plans, filter, true); },
    async findOneAndUpdate(filter: Row, update: Row) {
      if (!plans.some((plan) => matches(plan, filter))) plans.push({ _id: `plan-${plans.length}`, ...update.$setOnInsert });
    },
  };
  const householdModel = { async findOne(filter: Row) { return matches(household, filter) ? household : null; } };
  const memberModel = {
    async findOne(filter: Row) { return members.find((member) => matches(member, filter)) ?? null; },
    find(filter: Row) { return { async select() { return members.filter((member) => matches(member, filter)); } }; },
  };
  const dependencies: Row = {
    '../utils/familyBillingPeriod': { addFamilyCalendarMonths },
    'node:crypto': { randomInt: () => 1 },
    '../config/payos': { getPayOS() { throw new Error('RevenueCat must not initialize payOS'); } },
    mongoose: { Types: { ObjectId: { isValid: (value: string) => /^[a-f\d]{24}$/i.test(value) } } },
    '../models/subscription.model': { Subscription: subscriptionModel },
    '../models/subscriptionPlan.model': { SubscriptionPlan: planModel },
    '../models/household.model': { Household: householdModel },
    '../models/householdMember.model': { HouseholdMember: memberModel },
  };
  const service = load('services/subscriptionService.ts', dependencies);
  const access = load('services/householdAccessService.ts', { ...dependencies, './subscriptionService': service });
  const list: Row = { _id: LIST, ownerType: 'HOUSEHOLD', householdId: HOUSE,
    async populate() { return this; }, async save() { mutations.push('list-save'); } };
  const shopping = load('services/shoppingListService.ts', { ...dependencies, './subscriptionService': service,
    '../models/shoppingList.model': { ShoppingList: { async findById() { return list; }, async create() { mutations.push('list-create'); return {}; } } },
  });
  const payment = load('services/paymentService.ts', { ...dependencies, './subscriptionService': service,
    '../models/paymentTransaction.model': { PaymentTransaction: { async exists() { return false; }, async create(event: Row) { events.push(event); } } },
  });
  const inventoryDependencies = {
    ...dependencies, './subscriptionService': service, './householdAccessService': access,
    '../models/storageLocation.model': { StorageLocation: {
      async countDocuments() { return counts.storage; },
      async create() { mutations.push('storage-create'); return {}; },
      async updateMany() { mutations.push('storage-default-update'); },
    } },
    '../models/storageRule.model': { StorageRule: {} },
    '../models/foodItem.model': { FoodItem: { async countDocuments() { return counts.food; } } },
    '../models/foodCategory.model': { FoodCategory: {} },
    '../models/notification.model': { Notification: {} },
    './nutritionService': {}, './foodCategoryClassifierService': {},
    '../utils/nutritionValidation': {}, '../utils/storageGuidance': {},
  };
  const storage = load('services/storageService.ts', inventoryDependencies);
  const food = load('services/foodService.ts', inventoryDependencies);
  function legacy(fields: Row = {}): Row { const row = { _id: 'legacy', userId: OWNER, planId: 'premium', planCode: 'PREMIUM_MONTHLY', status: 'ACTIVE', startDate: past(), endDate: future(), ...fields }; subscriptions.push(row); return row; }
  function family(fields: Row = {}): Row { const row = { _id: 'family-sub', userId: OWNER, scope: 'HOUSEHOLD', householdId: HOUSE, provider: 'PAYOS', activatedAt: past(), planId: 'family', planCode: 'FAMILY_MONTHLY', status: 'ACTIVE', startDate: past(), endDate: future(), ...fields }; subscriptions.push(row); return row; }
  return { service, access, shopping, payment, storage, food, counts, legacy, family, household, members, plans, subscriptions, events, reads, mutations, list };
}

test('individual API retains legacy records and never selects a household entitlement', async () => {
  const h = harness(); h.legacy(); h.family();
  const current = await h.service.getUserCurrentSubscription(OWNER);
  assert.equal(current.planCode, 'PREMIUM_MONTHLY'); assert.equal(current.appUserId, OWNER); assert.equal(current.isPremium, true);
});

test('default plan initialization preserves configured prices, limits and availability', async () => {
  const h = harness(); h.plans[1].isActive = false; h.plans[1].limits.maxFoodItems = 7;
  await h.service.ensureDefaultSubscriptionPlans();
  assert.equal(h.plans[1].price, 123); assert.equal(h.plans[1].limits.maxFoodItems, 7); assert.equal(h.plans[1].isActive, false);
});

test('plan catalogue keeps the individual response by default and exposes Family only by scope', async () => {
  const h = harness();
  const individual = await h.service.getAllSubscriptionPlans();
  const family = await h.service.getAllSubscriptionPlans('HOUSEHOLD');
  assert.ok(individual.every((plan: Row) => plan.scope === 'USER'));
  assert.deepEqual(family.map((plan: Row) => plan.planCode), ['FAMILY_MONTHLY']);
});

test('initialization does not create or price Family plans', async () => {
  const h = harness(); h.plans.splice(2, 1);
  assert.equal((await h.service.getAllSubscriptionPlans('HOUSEHOLD')).length, 0);
  assert.ok(!h.plans.some((plan) => plan.planCode.startsWith('FAMILY')));
});

test('an unpaid household has metadata but no shared-data access', async () => {
  const h = harness(); const result = await h.service.getHouseholdSubscription(OWNER, HOUSE);
  assert.equal(result.canManageSubscription, true); assert.equal(result.hasPaidAccess, false);
  assert.equal(result.canReadSharedData, false); assert.equal(result.subscription, null);
  for (const operation of ['VIEW', 'EDIT']) await assert.rejects(h.access.assertHouseholdInventoryAccess({ ownerType: 'HOUSEHOLD', householdId: HOUSE }, OWNER, operation), (error: any) => error.statusCode === 403);
});

test('active Family grants only the configured household capabilities and limits', async () => {
  const h = harness(); h.family(); h.plans[2].limits.maxMembers = 3;
  const result = await h.service.getHouseholdSubscription(MEMBER, HOUSE);
  assert.equal(result.hasPaidAccess, true); assert.equal(result.source, 'HOUSEHOLD');
  assert.equal(result.limits.maxMembers, 3); assert.equal(result.canManageSubscription, false);
  assert.equal((await h.service.getUserCurrentSubscription(MEMBER)).isPremium, false);
});

test('a member personal Premium or another household subscription cannot pay for this household', async () => {
  const h = harness(); h.legacy({ userId: MEMBER }); h.family({ householdId: 'another-household' });
  assert.equal((await h.service.getHouseholdEntitlement(HOUSE)).hasPaidAccess, false);
});

test('owner and member obtain the same backend entitlement while only owner can manage it', async () => {
  const h = harness(); h.family();
  const owner = await h.service.getHouseholdSubscription(OWNER, HOUSE);
  const member = await h.service.getHouseholdSubscription(MEMBER, HOUSE);
  assert.equal(owner.subscription.id, member.subscription.id);
  assert.equal(owner.hasPaidAccess, member.hasPaidAccess);
  assert.equal(owner.canManageSubscription, true); assert.equal(member.canManageSubscription, false);
});

test('legacy owner Premium remains available without migrating subscription data', async () => {
  const h = harness(); const legacy = h.legacy(); delete h.plans[1].limits.maxMembers;
  const before = JSON.stringify(legacy);
  const result = await h.service.getHouseholdEntitlement(HOUSE);
  assert.equal(result.hasPaidAccess, true); assert.equal(result.source, 'LEGACY_OWNER'); assert.equal(result.limits.maxMembers, 6);
  assert.equal(JSON.stringify(legacy), before);
});

for (const fields of [{ status: 'EXPIRED', endDate: past() }, { status: 'CANCELLED' }, { endDate: new Date() }, { startDate: future() }]) {
  test(`inactive Family is read-only and cannot fall back to active owner Premium: ${Object.keys(fields).join(',')}`, async () => {
    const h = harness(); h.legacy(); h.family(fields);
    const result = await h.service.getHouseholdEntitlement(HOUSE);
    assert.equal(result.source, 'HOUSEHOLD'); assert.equal(result.hasPaidAccess, false); assert.equal(result.readOnly, true);
    await h.access.assertHouseholdInventoryAccess({ ownerType: 'HOUSEHOLD', householdId: HOUSE }, MEMBER, 'VIEW');
    await assert.rejects(h.access.assertHouseholdInventoryAccess({ ownerType: 'HOUSEHOLD', householdId: HOUSE }, MEMBER, 'EDIT'), (error: any) => error.statusCode === 403);
  });
}

test('pending unverified Family does not revoke an existing legacy entitlement or grant access itself', async () => {
  const h = harness(); const pending = h.family({ status: 'PENDING', activatedAt: undefined }); h.legacy();
  assert.equal((await h.service.getHouseholdEntitlement(HOUSE)).source, 'LEGACY_OWNER');
  h.subscriptions.splice(h.subscriptions.indexOf(pending) + 1);
  assert.equal((await h.service.getHouseholdEntitlement(HOUSE)).hasPaidAccess, false);
});

test('expired legacy Premium retains read access without paid capabilities', async () => {
  const h = harness(); h.legacy({ endDate: past(), status: 'EXPIRED' });
  const result = await h.service.getHouseholdEntitlement(HOUSE);
  assert.equal(result.canReadSharedData, true); assert.equal(result.hasPaidAccess, false);
});

test('Family requires matching owner, plan scope and complete configured quotas', async () => {
  for (const invalid of ['owner', 'scope', 'quota']) {
    const h = harness(); const sub = h.family();
    if (invalid === 'owner') sub.userId = MEMBER;
    if (invalid === 'scope') h.plans[2].scope = 'USER';
    if (invalid === 'quota') delete h.plans[2].limits.maxStorageLocations;
    assert.equal((await h.service.getHouseholdEntitlement(HOUSE)).hasPaidAccess, false);
  }
});

test('subscription metadata rejects nonmembers, removed members and inactive households', async () => {
  const h = harness(); h.family();
  await assert.rejects(h.service.getHouseholdSubscription('outsider', HOUSE), (error: any) => error.statusCode === 403);
  h.members[1].status = 'REMOVED';
  await assert.rejects(h.service.getHouseholdSubscription(MEMBER, HOUSE), (error: any) => error.statusCode === 403);
  h.household.status = 'INACTIVE';
  await assert.rejects(h.service.getHouseholdSubscription(OWNER, HOUSE), (error: any) => error.statusCode === 403);
});

test('paid entitlement never bypasses a revoked member permission', async () => {
  const h = harness(); h.family(); h.members[1].permission.canEditInventory = false;
  await assert.rejects(h.access.assertHouseholdInventoryAccess({ ownerType: 'HOUSEHOLD', householdId: HOUSE }, MEMBER, 'EDIT'), (error: any) => error.statusCode === 403);
});

test('personal operations never query Family subscriptions', async () => {
  const h = harness();
  await h.access.assertHouseholdInventoryAccess({ ownerType: 'USER' }, MEMBER, 'EDIT');
  assert.equal(h.reads.length, 0);
});

test('expired Family shopping remains readable, but create and complete are forbidden', async () => {
  const h = harness(); h.family({ status: 'EXPIRED', endDate: past() });
  await h.shopping.getShoppingListById(LIST, MEMBER);
  await assert.rejects(h.shopping.createShoppingList(MEMBER, { ownerType: 'HOUSEHOLD', householdId: HOUSE, listName: 'Shared' }), (error: any) => error.statusCode === 403);
  await assert.rejects(h.shopping.completeShoppingList(LIST, MEMBER), (error: any) => error.statusCode === 403);
  assert.equal(h.mutations.length, 0);
});

test('unpaid household cannot read a shared shopping list, while personal shopping still works', async () => {
  const h = harness();
  await assert.rejects(h.shopping.getShoppingListById(LIST, MEMBER), (error: any) => error.statusCode === 403);
  await h.shopping.createShoppingList(MEMBER, { ownerType: 'USER', listName: 'Personal' });
  assert.deepEqual(h.mutations, ['list-create']);
});

test('household food uses Family quota including a configured zero instead of owner Premium quota', async () => {
  for (const limit of [0, 2]) {
    const h = harness(); h.family(); h.legacy(); h.plans[2].limits.maxFoodItems = limit; h.counts.food = limit;
    await assert.rejects(h.food.createFoodItem(MEMBER, {
      categoryId: 'category', storageLocationId: 'storage', foodName: 'Food', sourceType: 'MARKET',
      expiryType: 'MANUAL', purchaseDate: '2026-01-01', expiryDate: '2026-01-02', quantity: 1, unit: 'g',
    }, 'HOUSEHOLD', HOUSE), (error: any) => error.statusCode === 403);
  }
});

test('household storage checks quota and multi-storage before resetting defaults or writing', async () => {
  for (const multiStorage of [true, false]) {
    const h = harness(); h.family(); h.counts.storage = multiStorage ? 10 : 1;
    h.plans[2].limits.multiStorageEnabled = multiStorage;
    await assert.rejects(h.storage.createStorageLocation(MEMBER, { storageName: 'Fridge', storageType: 'REFRIGERATOR', isDefault: true }, 'HOUSEHOLD', HOUSE), (error: any) => error.statusCode === 403);
    assert.equal(h.mutations.length, 0);
  }
});

test('personal storage does not inherit household limits or require a paid plan', async () => {
  const h = harness();
  await h.storage.createStorageLocation(MEMBER, { storageName: 'Fridge', storageType: 'REFRIGERATOR' }, 'USER');
  assert.deepEqual(h.mutations, ['storage-create']); assert.equal(h.reads.length, 0);
});

test('RevenueCat expiry changes only its own individual or legacy subscriptions', async () => {
  const h = harness(); const legacy = h.legacy(); const family = h.family();
  const other = h.legacy({ _id: 'other-provider', scope: 'USER', provider: 'PAYOS' });
  await h.payment.processRevenueCatWebhook({ event: { id: 'expire', type: 'EXPIRATION', app_user_id: OWNER } });
  assert.equal(legacy.status, 'EXPIRED'); assert.equal(family.status, 'ACTIVE'); assert.equal(other.status, 'ACTIVE');
});

test('RevenueCat cancellation and billing issue preserve Family entitlement and its renewal state', async () => {
  for (const type of ['CANCELLATION', 'BILLING_ISSUE']) {
    const h = harness(); const legacy = h.legacy({ autoRenew: true }); const family = h.family({ autoRenew: true });
    await h.payment.processRevenueCatWebhook({ event: { id: type, type, app_user_id: OWNER } });
    assert.equal(legacy.autoRenew, false); assert.equal(family.autoRenew, true); assert.equal(family.status, 'ACTIVE');
  }
});

test('RevenueCat activation stamps USER scope without updating a Family subscription', async () => {
  const h = harness(); const family = h.family();
  await h.payment.processRevenueCatWebhook({ event: { id: 'purchase', type: 'INITIAL_PURCHASE', app_user_id: OWNER, product_id: 'monthly', purchased_at_ms: past().getTime(), expiration_at_ms: future().getTime() } });
  const individual = h.subscriptions.find((row) => row.scope === 'USER');
  assert.equal(individual?.provider, 'REVENUECAT'); assert.equal(family.planCode, 'FAMILY_MONTHLY'); assert.equal(h.events.length, 1);
});

test('schema requires household target and verified activation, preserving legacy records', async () => {
  const base = { userId: OWNER, planId: HOUSE, startDate: past(), endDate: future() };
  await new Subscription({ ...base, planCode: 'PREMIUM_MONTHLY', status: 'ACTIVE' }).validate();
  await assert.rejects(new Subscription({ ...base, scope: 'HOUSEHOLD', planCode: 'FAMILY_MONTHLY', status: 'ACTIVE' }).validate());
  await new Subscription({ ...base, scope: 'HOUSEHOLD', householdId: HOUSE, provider: 'PAYOS', activatedAt: past(), planCode: 'FAMILY_MONTHLY', status: 'ACTIVE' }).validate();
  await assert.rejects(new SubscriptionPlan({ scope: 'HOUSEHOLD', planName: 'Family Monthly', planCode: 'FAMILY_MONTHLY', price: 100, currency: 'VND', durationDays: 30 }).validate());
});

test('subscription controllers preserve root individual responses and wrapped household responses', async () => {
  const h = harness(); h.family();
  const controller = load('controllers/subscriptionController.ts', { '../services/subscriptionService': h.service });
  let body: any; let status = 200;
  const response = { status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; } };
  await controller.getCurrentSubscription({ user: { userId: MEMBER } }, response);
  assert.equal(body.planCode, 'FREE'); assert.equal(body.appUserId, MEMBER); assert.equal(body.data, undefined);
  await controller.getHouseholdSubscriptionHandler({ user: { userId: MEMBER }, params: { id: HOUSE } }, response);
  assert.equal(body.success, true); assert.equal(body.data.householdId, HOUSE);
  await controller.getHouseholdSubscriptionHandler({ user: { userId: 'outsider' }, params: { id: HOUSE } }, response);
  assert.equal(status, 403);
  await controller.getSubscriptionPlans({ query: { scope: 'INVALID' } }, response);
  assert.equal(status, 400);
});
