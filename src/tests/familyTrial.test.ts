import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { Subscription, FAMILY_TRIAL_INDEXES } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { addFamilyCalendarMonths } from '../utils/familyBillingPeriod';

// No dotenv, Mongo connection, provider request, or writes outside this fixture.
type Row = Record<string, any>;
const id = (n: number) => n.toString(16).padStart(24, '0');
const OWNER = id(1), MEMBER = id(2), OTHER = id(3), HOUSE = id(10), MONTH = id(20), YEAR = id(21);
const DAY = 86400000;
const limits = { maxMembers: 6, maxFoodItems: 1000, maxStorageLocations: 10, familyCloudEnabled: true, multiStorageEnabled: true, macroReportEnabled: false };

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every((part: Row) => matches(row, part));
    if (key === '$or') return value.some((part: Row) => matches(row, part));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([operator, target]) => {
      if (operator === '$exists') return (actual !== undefined) === target;
      if (operator === '$ne') return actual !== target;
      if (operator === '$in') return (target as unknown[]).includes(actual);
      if (operator === '$lte') return actual <= (target as any);
      if (operator === '$gt') return actual > (target as any);
      throw Error(`Unsupported fixture query ${operator}`);
    });
    return String(actual) === String(value);
  });
}

function load(relative: string, dependencies: Row, date: DateConstructor = Date) {
  const file = path.resolve(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const module = { exports: {} as any };
  vm.runInNewContext(source.outputText, { module, exports: module.exports, Date: date, require(name: string) {
    if (!(name in dependencies)) throw Error(`Unexpected dependency (network/DB access forbidden): ${name}`);
    return dependencies[name];
  } }, { filename: file });
  return module.exports;
}

function harness() {
  let time = Date.parse('2026-01-31T12:34:56.789Z');
  class ClockDate extends Date { constructor(value?: any) { super(value === undefined ? time : value); } static now() { return time; } }
  let state: Record<string, Row[]> = {
    households: [{ _id: HOUSE, ownerId: OWNER, status: 'ACTIVE', membershipRevision: 0 }],
    members: [{ householdId: HOUSE, userId: OWNER, role: 'OWNER', status: 'ACTIVE', permission: { canViewInventory: true, canEditInventory: true } },
      { householdId: HOUSE, userId: MEMBER, role: 'MEMBER', status: 'ACTIVE', permission: { canViewInventory: true, canEditInventory: true } }],
    plans: [{ _id: MONTH, planName: 'Family Monthly', planCode: 'FAMILY_MONTHLY', scope: 'HOUSEHOLD', price: 49000,
      currency: 'VND', billingPeriodMonths: 1, limits: { ...limits }, isActive: true },
      { _id: YEAR, planName: 'Family Yearly', planCode: 'FAMILY_YEARLY', scope: 'HOUSEHOLD', price: 499000,
        currency: 'VND', billingPeriodMonths: 12, limits: { ...limits }, isActive: true }], subscriptions: [],
  };
  let indexes: Row[] = FAMILY_TRIAL_INDEXES.map(({ key, options }) => structuredClone({ key, ...options }));
  const session = { isolatedMockSession: true };
  const writes: string[] = [];
  let failCreate = false, duplicate = false, sequence = 100;
  let queue: Promise<unknown> = Promise.resolve();
  function query(table: string, filter: Row): any {
    let populate = false;
    const result = (order?: Row) => {
      let rows = state[table].filter(row => matches(row, filter));
      if (order) rows = [...rows].sort((a, b) => {
        for (const [key, direction] of Object.entries(order)) {
          if (a[key] > b[key]) return Number(direction);
          if (a[key] < b[key]) return -Number(direction);
        }
        return 0;
      });
      const row = rows[0];
      return row ? { ...structuredClone(row), ...(populate ? { planId: state.plans.find(plan => plan._id === row.planId) } : {}) } : null;
    };
    return { populate() { populate = true; return this; }, sort(order: Row) { return Promise.resolve(result(order)); },
      then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); } };
  }
  function model(table: string) {
    return { findOne(filter: Row) { return query(table, filter); }, async findOneAndUpdate(filter: Row, update: Row, options: any) {
      assert.equal(options.session, session); const row = state[table].find(row => matches(row, filter));
      if (!row) return null;
      assert.equal(table, 'households'); row.membershipRevision += update.$inc.membershipRevision; writes.push('household-lock');
      return structuredClone(row);
    } };
  }
  const subscriptions = { ...model('subscriptions'), collection: { async indexes() { return indexes; } },
    async create(rows: Row[], options: any) {
      assert.equal(options.session, session);
      const created = [];
      for (const row of rows) {
        await new Subscription(row).validate();
        if (duplicate || state.subscriptions.some(old => old.grantType === 'TRIAL' && (old.userId === row.userId || old.householdId === row.householdId))) {
          throw Object.assign(Error('Synthetic unique index conflict'), { code: 11000 });
        }
        const next = { _id: id(sequence++), ...structuredClone(row) }; state.subscriptions.push(next); created.push(next); writes.push('trial-create');
      }
      if (failCreate) throw Error('Injected trial save failure');
      return created;
    } };
  const dependencies = {
    mongoose: { Types: { ObjectId: { isValid: (value: string) => /^[a-f\d]{24}$/i.test(value) } }, connection: {
      // Serialized mock only: validates rollback and request outcomes, not real
      // MongoDB write conflicts or index deployment. No DB is connected.
      transaction(operation: (session: any) => Promise<unknown>) {
        const next = queue.catch(() => {}).then(async () => {
          const before = structuredClone(state);
          try { return await operation(session); } catch (error) { state = before; throw error; }
        });
        queue = next; return next;
      },
    } },
    '../models/subscription.model': { Subscription: subscriptions }, '../models/subscriptionPlan.model': { SubscriptionPlan: model('plans') },
    '../models/household.model': { Household: model('households') }, '../models/householdMember.model': { HouseholdMember: model('members') },
  };
  const service = load('services/subscriptionService.ts', dependencies, ClockDate as DateConstructor);
  const controller = load('controllers/subscriptionController.ts', { '../services/subscriptionService': service }, ClockDate as DateConstructor);
  const paid = (fields: Row = {}) => {
    const row = { _id: id(sequence++), userId: OWNER, householdId: HOUSE, scope: 'HOUSEHOLD', provider: 'PAYOS',
      planId: MONTH, planCode: 'FAMILY_MONTHLY', status: 'ACTIVE', activatedAt: new Date(time - DAY), startDate: new Date(time - DAY),
      endDate: new Date(time + DAY), autoRenew: false, ...fields };
    state.subscriptions.push(row); return row;
  };
  const addHousehold = (householdId: string, ownerId = OWNER) => {
    state.households.push({ _id: householdId, ownerId, status: 'ACTIVE', membershipRevision: 0 });
    state.members.push({ householdId, userId: ownerId, role: 'OWNER', status: 'ACTIVE', permission: {} });
  };
  return { service, controller, state: () => state, writes, paid, addHousehold, time: () => time,
    at: (value: number) => { time = value; }, indexes: (value: Row[]) => { indexes = value; },
    fail: () => { failCreate = true; }, duplicate: () => { duplicate = true; } };
}
const status = (code: number) => (error: any) => error.statusCode === code;

test('eligible household metadata never automatically starts a trial; explicit owner activation lasts exactly 30 UTC days', async () => {
  const h = harness(); const metadata = await h.service.getHouseholdSubscription(OWNER, HOUSE);
  assert.equal(metadata.trialEligibility.eligible, true); assert.equal(metadata.hasPaidAccess, false); assert.equal(h.writes.length, 0);
  const result = await h.service.startHouseholdTrial(OWNER, HOUSE);
  const row = h.state().subscriptions[0];
  assert.equal(result.grantType, 'TRIAL'); assert.equal(row.startDate.getTime(), h.time());
  assert.equal(row.endDate.getTime() - row.startDate.getTime(), 30 * DAY); assert.equal(row.activatedAt.getTime(), h.time());
  assert.equal(row.startDate.toISOString(), '2026-01-31T12:34:56.789Z'); assert.equal(row.autoRenew, false); assert.equal(row.provider, undefined);
  const member = await h.service.getHouseholdSubscription(MEMBER, HOUSE);
  assert.equal(member.hasFamilyAccess, true); assert.equal(member.hasPaidAccess, true); assert.equal(member.isTrial, true);
  assert.equal(member.trialEligibility.eligible, false); assert.equal(member.canManageSubscription, false);
});

test('members, removed owners and inconsistent ownership cannot start trials', async () => {
  for (const scenario of ['member', 'removed', 'changed', 'inactive']) {
    const h = harness(); let user = OWNER;
    if (scenario === 'member') user = MEMBER;
    if (scenario === 'removed') h.state().members[0].status = 'REMOVED';
    if (scenario === 'changed') h.state().households[0].ownerId = OTHER;
    if (scenario === 'inactive') h.state().households[0].status = 'INACTIVE';
    await assert.rejects(h.service.startHouseholdTrial(user, HOUSE), status(403)); assert.equal(h.writes.length, 0);
  }
  await assert.rejects(harness().service.startHouseholdTrial(OWNER, 'bad'), status(400));
});

test('trial eligibility survives expiry, household deactivation and creating a different household', async () => {
  const h = harness(); await h.service.startHouseholdTrial(OWNER, HOUSE); h.at(h.time() + 31 * DAY);
  h.state().households[0].status = 'INACTIVE'; h.state().members[0].status = 'REMOVED'; h.addHousehold(id(11));
  await assert.rejects(h.service.startHouseholdTrial(OWNER, id(11)), status(409));
  assert.equal(h.state().subscriptions.length, 1); assert.equal(h.state().households[1].membershipRevision, 0);
});

test('a new owner cannot restart the same household trial', async () => {
  const h = harness(); await h.service.startHouseholdTrial(OWNER, HOUSE); h.at(h.time() + 31 * DAY);
  h.state().households[0].ownerId = MEMBER; h.state().members[0].status = 'REMOVED'; h.state().members[1].role = 'OWNER';
  await assert.rejects(h.service.startHouseholdTrial(MEMBER, HOUSE), status(409)); assert.equal(h.state().subscriptions.length, 1);
});

test('sharing another owner trial does not consume the member future owner eligibility', async () => {
  const h = harness(); await h.service.startHouseholdTrial(OWNER, HOUSE);
  h.state().members[1].status = 'REMOVED'; h.addHousehold(id(11), MEMBER);
  const result = await h.service.startHouseholdTrial(MEMBER, id(11));
  assert.equal(result.grantType, 'TRIAL'); assert.equal(h.state().subscriptions.length, 2);
});

test('previous paid Family grants disqualify an owner, including legacy, expired and scheduled records', async () => {
  for (const fields of [{ status: 'EXPIRED', endDate: new Date('2000-01-01') }, { status: 'CANCELLED' },
    { grantType: 'PAID' }, { startDate: new Date('2999-01-01'), endDate: new Date('2999-02-01') }]) {
    const h = harness(); h.paid({ householdId: id(99), ...fields });
    await assert.rejects(h.service.startHouseholdTrial(OWNER, HOUSE), status(409)); assert.equal(h.state().subscriptions.length, 1);
  }
});

test('active paid Family and active legacy Premium access are preserved without migration', async () => {
  for (const legacy of [false, true]) {
    const h = harness();
    if (legacy) {
      h.state().plans.push({ _id: id(22), planCode: 'PREMIUM_MONTHLY', scope: 'USER', limits, isActive: true });
      h.state().subscriptions.push({ _id: id(101), userId: OWNER, planId: id(22), planCode: 'PREMIUM_MONTHLY',
        status: 'ACTIVE', startDate: new Date(h.time() - DAY), endDate: new Date(h.time() + 60 * DAY) });
    } else h.paid();
    const before = structuredClone(h.state().subscriptions);
    await assert.rejects(h.service.startHouseholdTrial(OWNER, HOUSE), status(409));
    assert.deepEqual(h.state().subscriptions, before); assert.equal(h.state().households[0].membershipRevision, 0);
  }
});

test('an unverified pending payment grant cannot disqualify or activate a household', async () => {
  const h = harness(); h.paid({ status: 'PENDING', activatedAt: undefined });
  assert.equal((await h.service.getHouseholdSubscription(OWNER, HOUSE)).hasPaidAccess, false);
  await h.service.startHouseholdTrial(OWNER, HOUSE); assert.equal(h.state().subscriptions.filter(row => row.grantType === 'TRIAL').length, 1);
});

test('trial expiry is enforced exactly at endDate, retains readable data and never charges or renews', async () => {
  const h = harness(); await h.service.startHouseholdTrial(OWNER, HOUSE);
  const end = h.state().subscriptions[0].endDate.getTime(); h.at(end - 1);
  assert.equal((await h.service.getHouseholdSubscription(MEMBER, HOUSE)).hasFamilyAccess, true);
  h.at(end); const before = structuredClone(h.state()); const writes = h.writes.length;
  const expired = await h.service.getHouseholdSubscription(OWNER, HOUSE);
  assert.equal(expired.subscription.status, 'EXPIRED'); assert.equal(expired.hasFamilyAccess, false); assert.equal(expired.readOnly, true);
  assert.equal(expired.canReadSharedData, true); assert.equal(expired.capabilities.familyCloudEnabled, false);
  await h.service.assertHouseholdSharedAccess(HOUSE, 'VIEW'); await assert.rejects(h.service.assertHouseholdSharedAccess(HOUSE, 'EDIT'), status(403));
  assert.deepEqual(h.state(), before); assert.equal(h.writes.length, writes); assert.equal(h.state().subscriptions[0].autoRenew, false);
});

test('trial reuses configured limits, including zero quotas and disabled multi-storage', async () => {
  const h = harness(); Object.assign(h.state().plans[0].limits, { maxMembers: 3, maxFoodItems: 0, maxStorageLocations: 2, multiStorageEnabled: false });
  await h.service.startHouseholdTrial(OWNER, HOUSE); const result = await h.service.getHouseholdSubscription(MEMBER, HOUSE);
  assert.equal(result.limits.maxMembers, 3); assert.equal(result.limits.maxFoodItems, 0); assert.equal(result.limits.maxStorageLocations, 2);
  assert.equal(result.capabilities.multiStorageEnabled, false);
});

test('resolver keeps trial access until scheduled verified paid starts, without granting future paid access early', async () => {
  const h = harness(); await h.service.startHouseholdTrial(OWNER, HOUSE);
  const end = h.state().subscriptions[0].endDate;
  h.paid({ grantType: 'PAID', planId: YEAR, planCode: 'FAMILY_YEARLY', startDate: end,
    endDate: addFamilyCalendarMonths(end, 12), activatedAt: new Date(h.time() + 1000) });
  h.at(h.time() + 2000);
  const before = structuredClone(h.state()); const writes = h.writes.length;
  const trial = await h.service.getHouseholdSubscription(MEMBER, HOUSE);
  assert.equal(trial.isTrial, true);
  assert.equal(trial.scheduledSubscription.planCode, 'FAMILY_YEARLY');
  assert.equal(new Date(trial.scheduledSubscription.startDate).getTime(), end.getTime());
  assert.equal(new Date(trial.scheduledSubscription.endDate).getTime(), addFamilyCalendarMonths(end, 12).getTime());
  assert.deepEqual(h.state(), before); assert.equal(h.writes.length, writes);
  h.at(end.getTime()); const paid = await h.service.getHouseholdSubscription(MEMBER, HOUSE);
  assert.equal(paid.isTrial, false); assert.equal(paid.hasFamilyAccess, true); assert.equal(paid.subscription.planCode, 'FAMILY_YEARLY');
  assert.equal(paid.scheduledSubscription, null);
  h.at(new Date(paid.subscription.endDate).getTime()); assert.equal((await h.service.getHouseholdSubscription(MEMBER, HOUSE)).readOnly, true);
});

test('scheduled purchase metadata excludes unverified, cancelled and other-owner grants', async () => {
  for (const fields of [{ activatedAt: undefined }, { activatedAt: new Date('2099-01-01') },
    { status: 'PENDING' }, { status: 'CANCELLED' }, { userId: OTHER }]) {
    const h = harness(); await h.service.startHouseholdTrial(OWNER, HOUSE);
    const startDate = h.state().subscriptions[0].endDate;
    h.paid({ grantType: 'PAID', startDate, endDate: addFamilyCalendarMonths(startDate, 1), ...fields });
    const result = await h.service.getHouseholdSubscription(OWNER, HOUSE);
    assert.equal(result.isTrial, true); assert.equal(result.scheduledSubscription, null);
  }
});

test('missing or weakened lifetime indexes fail closed without any writes', async () => {
  for (const wrong of ['missing', 'not-unique', 'active-only']) {
    const h = harness();
    const indexes: Row[] = FAMILY_TRIAL_INDEXES.map(({ key, options }) => structuredClone({ key, ...options }));
    const target = indexes.find(index => index.name === 'unique_family_trial_owner_lifetime')!;
    if (wrong === 'missing') indexes.splice(indexes.indexOf(target), 1);
    if (wrong === 'not-unique') target.unique = false;
    if (wrong === 'active-only') target.partialFilterExpression = { ...target.partialFilterExpression, status: 'ACTIVE' };
    h.indexes(indexes); await assert.rejects(h.service.startHouseholdTrial(OWNER, HOUSE), status(503)); assert.equal(h.writes.length, 0);
  }
});

test('simultaneous requests have one winner in the serialized transaction fixture; unique conflicts return 409', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.service.startHouseholdTrial(OWNER, HOUSE), h.service.startHouseholdTrial(OWNER, HOUSE)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(h.state().subscriptions.length, 1);
  const denied = results.find(result => result.status === 'rejected') as PromiseRejectedResult; assert.equal(denied.reason.statusCode, 409);
  const conflict = harness(); conflict.duplicate(); await assert.rejects(conflict.service.startHouseholdTrial(OWNER, HOUSE), status(409));
  assert.equal(conflict.state().subscriptions.length, 0); assert.equal(conflict.state().households[0].membershipRevision, 0);
});

test('trial save failure rolls back claim and household revision', async () => {
  const h = harness(); h.fail(); await assert.rejects(h.service.startHouseholdTrial(OWNER, HOUSE), /Injected/);
  assert.equal(h.state().subscriptions.length, 0); assert.equal(h.state().households[0].membershipRevision, 0);
});

test('calendar periods preserve UTC time and clamp month-end and leap days', () => {
  for (const [start, months, end] of [
    ['2026-01-31T12:34:56.789Z', 1, '2026-02-28T12:34:56.789Z'],
    ['2024-01-31T12:34:56.789Z', 1, '2024-02-29T12:34:56.789Z'],
    ['2026-12-31T12:34:56.789Z', 1, '2027-01-31T12:34:56.789Z'],
    ['2024-02-29T12:34:56.789Z', 12, '2025-02-28T12:34:56.789Z'],
    ['2023-03-01T12:34:56.789Z', 12, '2024-03-01T12:34:56.789Z'],
  ] as const) {
    const date = new Date(start); assert.equal(addFamilyCalendarMonths(date, months).toISOString(), end); assert.equal(date.toISOString(), start);
  }
  assert.throws(() => addFamilyCalendarMonths(new Date('bad'), 1));
  assert.throws(() => addFamilyCalendarMonths(new Date(), 2 as 1));
});

test('Family catalog preview sets approved VND prices and calendar months without mutating records or writing', () => {
  const h = harness(); const input = structuredClone(h.state().plans); const before = structuredClone(input);
  input[0].limits.maxFoodItems = 0; input[1].limits.maxFoodItems = 0; input[0].isActive = false;
  const preview = h.service.previewFamilyPlanCatalog(input);
  assert.equal(preview[0].price, 49000); assert.equal(preview[1].price, 499000);
  assert.equal(preview[0].billingPeriodMonths, 1); assert.equal(preview[1].billingPeriodMonths, 12);
  assert.equal(preview[0].durationDays, undefined); assert.equal(preview[1].durationDays, undefined);
  assert.equal(preview[0].limits.maxFoodItems, 0); assert.equal(preview[1].limits.maxFoodItems, 0); assert.equal(preview[0].isActive, false);
  assert.equal(h.writes.length, 0); assert.deepEqual(h.state().plans, before);
  const defaults = h.service.previewFamilyPlanCatalog(); assert.equal(defaults[0].limits.maxMembers, 6);
  assert.equal(defaults[0].limits.maxFoodItems, 1000); assert.equal(defaults[0].limits.maxStorageLocations, 10);
  assert.deepEqual(defaults[0].limits, defaults[1].limits);
});

test('catalog preview reports incompatible approved limits rather than overwriting them', () => {
  const h = harness(); h.state().plans[1].limits.maxMembers = 3;
  assert.throws(() => h.service.previewFamilyPlanCatalog(h.state().plans), /conflicting/);
  h.state().plans[1].limits.maxMembers = 6; h.state().plans[0].scope = 'USER';
  assert.throws(() => h.service.previewFamilyPlanCatalog(h.state().plans), /scope conflicts/);
});

test('schemas accept calendar Family plans and legacy Individual records, but reject mixed durations and paid trials', async () => {
  const h = harness();
  for (const plan of h.service.previewFamilyPlanCatalog()) await new SubscriptionPlan(plan).validate();
  await new SubscriptionPlan({ planName: 'Premium Monthly', planCode: 'PREMIUM_MONTHLY', price: 123, currency: 'VND', durationDays: 30, limits }).validate();
  const calendar = h.service.previewFamilyPlanCatalog()[0];
  await assert.rejects(new SubscriptionPlan({ ...calendar, durationDays: 30 }).validate());
  await assert.rejects(new SubscriptionPlan({ ...calendar, billingPeriodMonths: 12 }).validate());
  await h.service.startHouseholdTrial(OWNER, HOUSE); const trial = h.state().subscriptions[0];
  for (const change of [{ provider: 'PAYOS' }, { autoRenew: true }, { scope: 'USER' }, { endDate: new Date(trial.startDate.getTime() + 31 * DAY) }]) {
    await assert.rejects(new Subscription({ ...trial, ...change }).validate());
  }
  const indexes = FAMILY_TRIAL_INDEXES;
  for (const name of ['unique_family_trial_owner_lifetime', 'unique_family_trial_household_lifetime']) {
    const index = indexes.find(({ options }) => options.name === name)!;
    assert.equal(index.options.unique, true); assert.deepEqual(index.options.partialFilterExpression, { scope: 'HOUSEHOLD', grantType: 'TRIAL' });
    assert.equal(Subscription.schema.indexes().some(([, options]: [any, any]) => options.name === name), false, 'Unapproved startup must not deploy trial indexes');
  }
});

test('trial controller returns the existing envelope and never accepts client dates, price or payment fields', async () => {
  const h = harness(); let code = 0, body: any;
  const res = { status(value: number) { code = value; return this; }, json(value: any) { body = value; } };
  const request = { user: { userId: OWNER }, params: { id: HOUSE }, body: { price: 0, startDate: '2000-01-01', endDate: '2999-01-01', provider: 'PAYOS', autoRenew: true } };
  await h.controller.startHouseholdTrialHandler(request, res);
  assert.equal(code, 201); assert.equal(body.success, true); assert.equal(body.data.startDate.getTime(), h.time());
  await h.controller.startHouseholdTrialHandler(request, res); assert.equal(code, 409); assert.equal(body.success, false);
  const source = fs.readFileSync(path.resolve(__dirname, '../routes/householdRoutes.ts'), 'utf8');
  assert.ok(source.includes("router.post('/:id/subscription/trial', startHouseholdTrialHandler)"));
  assert.ok(source.indexOf('router.use(protect)') < source.indexOf("router.post('/:id/subscription/trial'"));
});
