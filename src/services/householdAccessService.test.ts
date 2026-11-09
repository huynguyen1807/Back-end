import assert from 'node:assert/strict';
import test, { beforeEach, type TestContext } from 'node:test';
import { Household } from '../models/household.model';
import { HouseholdMember } from '../models/householdMember.model';
import { Subscription } from '../models/subscription.model';
import { assertHouseholdInventoryAccess, HouseholdAccessError } from './householdAccessService';

const context = { ownerType: 'HOUSEHOLD', householdId: 'household-a' };

beforeEach((t) => {
  (t as TestContext).mock.method(Subscription, 'findOne', (query: any) => ({
    populate() { return this; },
    async sort() {
      if (query.scope === 'HOUSEHOLD') return null;
      return {
        _id: 'legacy-sub', userId: 'owner', planCode: 'PREMIUM_MONTHLY', status: 'ACTIVE',
        startDate: new Date('2000-01-01'), endDate: new Date('2999-01-01'),
        planId: { planCode: 'PREMIUM_MONTHLY', scope: 'USER', limits: { maxMembers: 6, maxFoodItems: 1000, maxStorageLocations: 10, familyCloudEnabled: true } },
      };
    },
  }));
});

test('personal inventory never queries household data', async (t) => {
  t.mock.method(Household, 'findOne', () => { throw new Error('Unexpected household lookup'); });
  t.mock.method(HouseholdMember, 'findOne', () => { throw new Error('Unexpected member lookup'); });
  await assertHouseholdInventoryAccess({ ownerType: 'USER' }, 'user', 'VIEW');
  await assertHouseholdInventoryAccess({ ownerType: 'USER' }, 'user', 'EDIT');
});

for (const operation of ['VIEW', 'EDIT'] as const) {
  test(`${operation} uses the current household and membership scope`, async (t) => {
    t.mock.method(Household, 'findOne', async (query: any) => {
      assert.deepEqual(query, { _id: 'household-a', status: 'ACTIVE' });
      return { ownerId: 'owner', status: 'ACTIVE' };
    });
    t.mock.method(HouseholdMember, 'findOne', async (query: any) => {
      assert.deepEqual(query, { householdId: 'household-a', userId: 'user', status: 'ACTIVE' });
      return { role: 'MEMBER', status: 'ACTIVE', permission: { canViewInventory: operation === 'VIEW', canEditInventory: operation === 'EDIT' } };
    });
    await assertHouseholdInventoryAccess(context, 'user', operation);
  });

  for (const scenario of ['missing member', 'removed member', 'inactive household', 'missing household', 'permission revoked', 'owner mismatch'] as const) {
    test(`${operation} denies ${scenario}`, async (t) => {
      t.mock.method(Household, 'findOne', async () => scenario === 'missing household' ? null : { ownerId: 'owner', status: scenario === 'inactive household' ? 'INACTIVE' : 'ACTIVE' });
      t.mock.method(HouseholdMember, 'findOne', async () => scenario === 'missing member' ? null : {
        role: scenario === 'owner mismatch' ? 'OWNER' : 'MEMBER',
        status: scenario === 'removed member' ? 'REMOVED' : 'ACTIVE',
        permission: { canViewInventory: scenario !== 'permission revoked', canEditInventory: scenario !== 'permission revoked' },
      });
      await assert.rejects(assertHouseholdInventoryAccess(context, 'user', operation), HouseholdAccessError);
    });
  }
}

test('a consistent active owner retains access even if permission flags are false', async (t) => {
  t.mock.method(Household, 'findOne', async () => ({ ownerId: 'owner', status: 'ACTIVE' }));
  t.mock.method(HouseholdMember, 'findOne', async () => ({ role: 'OWNER', status: 'ACTIVE', permission: {} }));
  await assertHouseholdInventoryAccess(context, 'owner', 'VIEW');
  await assertHouseholdInventoryAccess(context, 'owner', 'EDIT');
});

test('ownerId alone does not bypass a missing or inconsistent owner membership', async (t) => {
  t.mock.method(Household, 'findOne', async () => ({ ownerId: 'owner', status: 'ACTIVE' }));
  t.mock.method(HouseholdMember, 'findOne', async () => ({ role: 'MEMBER', status: 'ACTIVE', permission: { canEditInventory: true } }));
  await assert.rejects(assertHouseholdInventoryAccess(context, 'owner', 'EDIT'), HouseholdAccessError);
});
