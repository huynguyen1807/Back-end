import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { normalizeFoodText } from '../utils/foodCategoryValidation';

// Execute actual service/controller code with isolated dependencies. No model,
// dotenv, provider SDK or database connection is loaded by this harness.
function load(relative: string, dependencies: Record<string, any>) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require: (name: string) => dependencies[name] ?? {},
  }, { filename });
  return module.exports;
}

function harness(options: { view?: boolean; edit?: boolean; member?: boolean; household?: string } = {}) {
  const hits: string[] = [];
  const householdId = options.household ?? 'household-a';
  const membership = options.member === false ? null : {
    role: 'MEMBER', status: 'ACTIVE', permission: { canViewInventory: options.view ?? true, canEditInventory: options.edit ?? false },
  };
  const memberModel = { findOne: () => Object.assign(Promise.resolve(membership), { sort: () => Promise.resolve(membership) }) };
  const access = load('services/householdAccessService.ts', {
    './subscriptionService': { assertHouseholdSharedAccess: async () => ({ hasPaidAccess: true }) },
    '../models/household.model': { Household: { findOne: async () => ({ ownerId: 'owner', status: 'ACTIVE' }) } },
    '../models/householdMember.model': { HouseholdMember: memberModel },
  });
  const foodModel = {
    find: () => { hits.push('food-read'); throw new Error('Food read reached'); },
    findOne: async (query: any) => { hits.push('food-lookup'); return query.householdId === 'household-a' || (query.ownerType === 'USER' && query.userId === 'user') ? { _id: 'food-a', quantity: 10, unit: 'g', save: async () => { hits.push('food-write'); } } : null; },
    findByIdAndUpdate: async () => { hits.push('food-write'); },
    countDocuments: async () => { hits.push('food-count'); return 0; },
  };
  const locationModel = {
    find: () => { hits.push('storage-read'); throw new Error('Storage read reached'); },
    findOne: async (query: any) => query.householdId === 'household-a' || (query.ownerType === 'USER' && query.userId === 'user') ? { _id: 'storage-a' } : null,
    create: async () => { hits.push('storage-write'); },
    updateMany: async () => { hits.push('storage-default-write'); },
    findByIdAndUpdate: async () => { hits.push('storage-write'); },
  };
  const deps: Record<string, any> = {
    './householdAccessService': access,
    '../models/householdMember.model': { HouseholdMember: memberModel },
    '../models/foodItem.model': { FoodItem: foodModel },
    '../models/storageLocation.model': { StorageLocation: locationModel },
    '../models/foodCategory.model': { FoodCategory: { find: () => { hits.push('category-read'); throw new Error('Category read reached'); } } },
    '../models/userPreference.model': { UserPreference: { findOne: async () => null } },
    '../utils/foodCategoryValidation': { normalizeFoodText },
    '../utils/mealSchedule': {
      assertSchedulablePlanDate: () => '2099-01-01',
      toPlanDateKey: () => '2099-01-01',
      planDateFromKey: () => new Date('2099-01-01T00:00:00Z'),
    },
  };
  const food = load('services/foodService.ts', deps);
  const storage = load('services/storageService.ts', deps);
  const savedPlan = {
    inventoryOwnerType: 'HOUSEHOLD', householdId, meals: [],
    toObject() { return this; },
    async populate() { hits.push('plan-populate'); return this; },
  };
  const meal = load('services/mealPlanService.ts', {
    ...deps, './foodService': food,
    '../models/mealPlan.model': { MealPlan: {
      findOne: async () => savedPlan,
      find: () => Object.assign(Promise.resolve([savedPlan]), { sort: () => Promise.resolve([savedPlan]) }),
      deleteOne: async () => { hits.push('plan-delete'); },
    } },
  });
  return { hits, access, food, storage, meal, householdId, savedPlan };
}

const denied = (error: any) => error?.statusCode === 403;

for (const name of ['createFoodItem', 'updateFoodItem', 'deleteFoodItem', 'markFoodConsumed']) {
  test(`revoked edit permission blocks ${name} before any resource access`, async () => {
    const h = harness();
    const args = name === 'createFoodItem' ? ['user', {}, 'HOUSEHOLD', h.householdId]
      : name === 'updateFoodItem' ? ['food-a', 'user', {}, 'HOUSEHOLD', h.householdId]
      : ['food-a', 'user', 'HOUSEHOLD', h.householdId];
    await assert.rejects(h.food[name](...args), denied);
    assert.deepEqual(h.hits, []);
  });
}

test('food list/detail/summary reject members without view permission', async () => {
  for (const [name, args] of [
    ['getFoodItems', ['user', undefined, 'HOUSEHOLD', 'household-a']],
    ['getFoodItemById', ['food-a', 'user', 'HOUSEHOLD', 'household-a']],
    ['getFoodSummary', ['user', 'HOUSEHOLD', 'household-a']],
  ] as const) {
    const h = harness({ view: false });
    await assert.rejects(h.food[name](...args), denied);
    assert.deepEqual(h.hits, []);
  }
});

test('storage reads and all mutations enforce the appropriate permission', async () => {
  for (const [name, args, view] of [
    ['getStorageLocations', ['user', 'HOUSEHOLD', 'household-a'], false],
    ['getStorageSuggestion', ['user', 'category', 'HOUSEHOLD', 'household-a'], false],
    ['createStorageLocation', ['user', { storageName: 'Fridge', storageType: 'REFRIGERATOR' }, 'HOUSEHOLD', 'household-a'], true],
    ['updateStorageLocation', ['storage-a', 'user', {}, 'HOUSEHOLD', 'household-a'], true],
    ['deleteStorageLocation', ['storage-a', 'user', 'HOUSEHOLD', 'household-a'], true],
  ] as const) {
    const h = harness({ view });
    await assert.rejects(h.storage[name](...args), denied);
    assert.deepEqual(h.hits, []);
  }
});

test('removed membership is rejected with 403 before resource access', async () => {
  const h = harness({ member: false });
  await assert.rejects(h.food.deleteFoodItem('food-a', 'user', 'HOUSEHOLD', h.householdId), denied);
  assert.deepEqual(h.hits, []);
});

test('authorized household and personal delete workflows still reach mutation', async () => {
  const h = harness({ edit: true });
  await h.food.deleteFoodItem('food-a', 'user', 'HOUSEHOLD', h.householdId);
  assert.deepEqual(h.hits, ['food-lookup', 'food-write']);
  h.hits.length = 0;
  // An explicit USER scope is retained, rather than silently selecting household.
  await h.food.deleteFoodItem('food-a', 'user', 'USER');
  assert.deepEqual(h.hits, ['food-lookup', 'food-write']);
});

test('resource IDs from another household never reach a write', async () => {
  const h = harness({ edit: true, household: 'household-b' });
  await assert.rejects(h.food.deleteFoodItem('food-a', 'user', 'HOUSEHOLD', h.householdId), /Food item not found/);
  await assert.rejects(h.storage.updateStorageLocation('storage-a', 'user', {}, 'HOUSEHOLD', h.householdId), /Storage location not found/);
  assert.ok(!h.hits.some((hit) => hit.includes('write')));
});

test('household ownership update is denied before unsetting existing defaults', async () => {
  const h = harness({ edit: true });
  await assert.rejects(h.storage.updateStorageLocation('storage-a', 'user', { householdId: 'household-b', isDefault: true }, 'HOUSEHOLD', h.householdId), denied);
  assert.deepEqual(h.hits, []);
});

test('storage updates cannot move personal resources into a household or use update operators', async () => {
  for (const payload of [{ ownerType: 'HOUSEHOLD', householdId: 'household-b' }, { $set: { householdId: 'household-b' } }, { 'householdId.value': 'household-b' }]) {
    const h = harness();
    await assert.rejects(h.storage.updateStorageLocation('storage-a', 'user', payload, 'USER'), denied);
    assert.deepEqual(h.hits, []);
  }
});

test('planner update/delete reject revoked view access before inventory mutation', async () => {
  const h = harness({ view: false });
  await assert.rejects(h.meal.updateMealPlan('plan', 'user', {}), denied);
  await assert.rejects(h.meal.deleteMealPlan('plan', 'user'), denied);
  assert.deepEqual(h.hits, []);
});

test('planner detail, unscoped list and summary enforce the saved household context', async () => {
  for (const call of [
    (meal: any) => meal.getMealPlanById('plan', 'user'),
    (meal: any) => meal.listMealPlans('user'),
    (meal: any) => meal.getMealPlanSummary('user', '2099-01-01'),
  ]) {
    const h = harness({ view: false });
    await assert.rejects(call(h.meal), denied);
    assert.deepEqual(h.hits, []);
  }
});

test('planner cannot restore household stock after edit permission is revoked', async () => {
  const h = harness();
  (h.savedPlan.meals as any[]) = [{ status: 'COMPLETED', inventoryApplied: true, usedFoods: [{ foodItemId: 'food-a', quantityUsed: 1, unit: 'g' }] }];
  await assert.rejects(h.meal.deleteMealPlan('plan', 'user'), denied);
  assert.deepEqual(h.hits, []);
});

test('view-only members can read their household plan without edit permission', async () => {
  const h = harness();
  await h.meal.getMealPlanById('plan', 'user');
  assert.deepEqual(h.hits, ['plan-populate', 'plan-populate']);
});

test('authorized planner stock restoration still completes before deleting the plan', async () => {
  const h = harness({ edit: true });
  (h.savedPlan.meals as any[]) = [{ status: 'COMPLETED', inventoryApplied: true, usedFoods: [{ foodItemId: 'food-a', quantityUsed: 1, unit: 'g' }] }];
  await h.meal.deleteMealPlan('plan', 'user');
  assert.deepEqual(h.hits, ['food-lookup', 'food-write', 'plan-delete']);
});

test('authorized storage update preserves the existing operation', async () => {
  const h = harness({ edit: true });
  await h.storage.updateStorageLocation('storage-a', 'user', { storageName: 'New name' }, 'HOUSEHOLD', h.householdId);
  assert.deepEqual(h.hits, ['storage-write']);
});

test('food, storage and planner controllers return 403 for typed access failures', async () => {
  const h = harness();
  for (const [file, service, handler] of [
    ['food', 'listFoods', 'getFoodItems'],
    ['storage', 'listStorageLocations', 'getStorageLocations'],
    ['mealPlan', 'listPlans', 'listMealPlans'],
  ]) {
    const controller = load(`controllers/${file}Controller.ts`, {
      '../services/householdAccessService': h.access,
      [`../services/${file}Service`]: { [handler]: async () => { throw new h.access.HouseholdAccessError(); } },
    });
    let status = 0;
    let body: any;
    const res = { status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; } };
    await controller[service]({ user: { userId: 'user' }, query: {} }, res);
    assert.equal(status, 403);
    assert.equal(body.success, false);
  }
});
