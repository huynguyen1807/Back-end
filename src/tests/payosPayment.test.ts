import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PayOS } from '@payos/node';
import { PaymentTransaction } from '../models/paymentTransaction.model';
import { Subscription } from '../models/subscription.model';
import { addFamilyCalendarMonths } from '../utils/familyBillingPeriod';

type Row = Record<string, any>;
const id = (n: number) => n.toString(16).padStart(24, '0');
const OWNER = id(1), MEMBER = id(2), HOUSE = id(10), PLAN = id(20);

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$and') return expected.every((part: Row) => matches(row, part));
    if (key === '$or') return expected.some((part: Row) => matches(row, part));
    const actual = row[key];
    if (expected === null) return actual == null;
    if (expected && typeof expected === 'object') return Object.entries(expected).every(([op, value]) => {
      if (op === '$exists') return (actual !== undefined) === value;
      if (op === '$lte') return actual <= (value as any);
      if (op === '$gt') return actual > (value as any);
      if (op === '$ne') return actual !== value;
      throw new Error(`Unsupported mock query ${op}`);
    });
    return String(actual) === String(expected);
  });
}

function load(file: string, dependencies: Row, env: Row = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require(name: string) {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, URL, process: { env } }, { filename });
  return module.exports;
}

function harness() {
  let state: Record<string, Row[]> = {
    households: [{ _id: HOUSE, ownerId: OWNER, status: 'ACTIVE', membershipRevision: 0 }],
    members: [{ _id: id(30), householdId: HOUSE, userId: OWNER, role: 'OWNER', status: 'ACTIVE' }],
    plans: [{ _id: PLAN, planCode: 'FAMILY_MONTHLY', scope: 'HOUSEHOLD', isActive: true, price: 49000, currency: 'VND', durationDays: 30,
      limits: { familyCloudEnabled: true, maxMembers: 6, maxFoodItems: 1000, maxStorageLocations: 10 } }],
    payments: [], subscriptions: [],
  };
  const session = { isolatedTestSession: true };
  let queue: Promise<unknown> = Promise.resolve();
  let counter = 100;
  let orderCounter = 1000;
  let failure = '';
  let createError: any;
  let onCreate: (() => Promise<void>) | undefined;
  const calls: string[] = [];
  const orders = new Map<number, Row>();
  const sdk = new PayOS({ clientId: 'synthetic-client', apiKey: 'synthetic-api', checksumKey: 'synthetic-checksum', logLevel: 'off',
    fetch: async () => { throw new Error('Network is forbidden in payment tests'); } });
  function mutate(row: Row, update: Row) {
    for (const [key, value] of Object.entries(update)) {
      if (key === '$set') Object.assign(row, structuredClone(value));
      else if (key === '$inc') for (const [field, amount] of Object.entries(value)) row[field] = (row[field] ?? 0) + Number(amount);
      else row[key] = structuredClone(value);
    }
  }
  function document(table: string, row?: Row): any {
    if (!row) return null;
    return Object.assign(structuredClone(row), {
      async save(this: Row, options: any) {
        assert.equal(options?.session, session);
        const { save: _save, ...fields } = this;
        if (table === 'payments') await new PaymentTransaction(fields).validate();
        if (table === 'subscriptions') await new Subscription(fields).validate();
        state[table][state[table].findIndex((item) => item._id === fields._id)] = structuredClone(fields);
        calls.push(`${table}.save`);
        if (failure === `${table}.save`) throw new Error('Injected database failure');
      },
    });
  }
  function model(table: string) {
    const query = (filter: Row, many = false): any => {
      function result(order?: Row) {
        let found = state[table].filter((row) => matches(row, filter));
        if (order) found = [...found].sort((a, b) => {
          for (const [key, direction] of Object.entries(order)) {
            if (a[key] > b[key]) return Number(direction);
            if (a[key] < b[key]) return -Number(direction);
          }
          return 0;
        });
        return many ? found.map((row) => document(table, row)) : document(table, found[0]);
      }
      return { populate() { return this; }, sort(order: Row) { return Promise.resolve(result(order)); },
        then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); } };
    };
    return {
      findOne(filter: Row) { return query(filter); }, find(filter: Row) { return query(filter, true); },
      async create(rows: Row[], options: any) {
        assert.equal(options?.session, session);
        const created: Row[] = rows.map((row) => ({ _id: id(counter++), ...structuredClone(row) }));
        for (const row of created) {
          if (table === 'payments') {
            await new PaymentTransaction(row).validate();
            if (state.payments.some((item) => item.orderCode === row.orderCode || (item.householdId === row.householdId && item.status === 'PENDING'))) throw Object.assign(new Error('duplicate'), { code: 11000 });
          }
          if (table === 'subscriptions') await new Subscription(row).validate();
          state[table].push(row);
        }
        calls.push(`${table}.create`);
        if (failure === `${table}.create`) throw new Error('Injected database failure');
        return created.map((row) => document(table, row));
      },
      async findOneAndUpdate(filter: Row, update: Row, options: any) {
        assert.equal(options?.session, session);
        const row = state[table].find((item) => matches(item, filter));
        if (!row) return null;
        mutate(row, update); return document(table, row);
      },
      async updateOne(filter: Row, update: Row) {
        const row = state[table].find((item) => matches(item, filter));
        if (row) mutate(row, update);
        return { matchedCount: row ? 1 : 0 };
      },
    };
  }
  const fakeMongoose = { Types: { ObjectId: { isValid: (value: string) => /^[a-f\d]{24}$/i.test(value) } }, connection: {
    // Serialized fake transactions validate boundaries and rollback, not actual
    // MongoDB write-conflict/retry/unique-index behavior across server processes.
    transaction(operation: (session: unknown) => Promise<unknown>) {
      const next = queue.catch(() => {}).then(async () => {
        const snapshot = structuredClone(state);
        try { return await operation(session); } catch (error) { state = snapshot; throw error; }
      });
      queue = next; return next;
    },
  } };
  const client = { webhooks: { verify: (payload: any) => sdk.webhooks.verify(payload) }, paymentRequests: {
    async create(input: Row) {
      calls.push('provider.create'); if (createError) throw createError;
      orders.set(input.orderCode, { id: `link-${input.orderCode}`, orderCode: input.orderCode, amount: input.amount,
        amountPaid: 0, amountRemaining: input.amount, status: 'PENDING' });
      if (onCreate) await onCreate();
      return { orderCode: input.orderCode, amount: input.amount, currency: 'VND', paymentLinkId: `link-${input.orderCode}`,
        checkoutUrl: `https://checkout.test.invalid/${input.orderCode}`, status: 'PENDING' };
    },
    async get(orderCode: number) {
      calls.push('provider.get'); const order = orders.get(orderCode);
      if (!order) throw Object.assign(new Error('No provider order'), { status: 404 });
      return structuredClone(order);
    },
  } };
  const api = load('services/paymentService.ts', {
    '../utils/familyBillingPeriod': { addFamilyCalendarMonths },
    mongoose: fakeMongoose, 'node:crypto': { randomInt: () => orderCounter++ },
    '../config/payos': { getPayOS: () => client, getPayOSReturnUrls: () => ({ returnUrl: 'https://app.test.invalid/return', cancelUrl: 'https://app.test.invalid/cancel' }) },
    './subscriptionService': { ensureDefaultSubscriptionPlans: async () => {}, revenueCatIndividualFilter: () => ({ scope: 'USER' }) },
    '../models/household.model': { Household: model('households') }, '../models/householdMember.model': { HouseholdMember: model('members') },
    '../models/subscription.model': { Subscription: model('subscriptions') }, '../models/subscriptionPlan.model': { SubscriptionPlan: model('plans') },
    '../models/paymentTransaction.model': { PaymentTransaction: model('payments') },
  });
  async function webhook(orderCode: number, fields: Row = {}) {
    const data = { orderCode, amount: 49000, currency: 'VND', paymentLinkId: `link-${orderCode}`, reference: `ref-${orderCode}`,
      transactionDateTime: '2026-11-09 12:00:00', description: 'Synthetic test', accountNumber: '000000', code: '00', desc: 'success', ...fields };
    return { code: '00', success: true, desc: 'success', data, signature: (await sdk.crypto.createSignatureFromObj(data, 'synthetic-checksum'))! };
  }
  function paid(orderCode: number) { const order = orders.get(orderCode)!; Object.assign(order, { status: 'PAID', amountPaid: order.amount, amountRemaining: 0 }); }
  const checkout = (input: Row = {}) => api.createPayOSCheckout(OWNER, { householdId: HOUSE, planCode: 'FAMILY_MONTHLY', ...input });
  return { api, state: () => state, orders, calls, webhook, paid, checkout,
    fail: (value: string) => { failure = value; },
    providerFailure: (value: any) => { createError = value; },
    duringCreate: (callback: () => Promise<void>) => { onCreate = callback; } };
}

test('checkout uses backend price and creates only PENDING with no subscription', async () => {
  const h = harness(); const result = await h.checkout({ amount: 1, price: 1 });
  assert.equal(result.amount, 49000); assert.equal(result.status, 'PENDING'); assert.ok(result.checkoutUrl);
  assert.equal(h.state().subscriptions.length, 0); assert.equal(h.state().payments[0].subscriptionId, undefined);
});

test('non-owner and removed owner cannot create or read checkout', async () => {
  const h = harness();
  await assert.rejects(h.api.createPayOSCheckout(MEMBER, { householdId: HOUSE, planCode: 'FAMILY_MONTHLY' }), (error: any) => error.statusCode === 403);
  assert.equal(h.calls.length, 0);
  const checkout = await h.checkout();
  await assert.rejects(h.api.getPayOSPaymentStatus(MEMBER, checkout.orderCode), (error: any) => error.statusCode === 404);
  h.state().members[0].status = 'REMOVED';
  await assert.rejects(h.api.getPayOSPaymentStatus(OWNER, checkout.orderCode), (error: any) => error.statusCode === 403);
});

test('inactive or unconfigured Family plans never reach provider checkout', async () => {
  for (const change of [{ isActive: false }, { currency: 'USD' }, { price: 0 }, { billingPeriodMonths: 0 }, { billingPeriodMonths: 12 }, { scope: 'USER' }]) {
    const h = harness(); Object.assign(h.state().plans[0], change);
    await assert.rejects(h.checkout(), (error: any) => error.statusCode === 400);
    assert.ok(!h.calls.includes('provider.create')); assert.equal(h.state().payments.length, 0);
  }
});

test('valid SDK-verified webhook activates the household in the same transaction as payment', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode);
  await h.api.processPayOSWebhook(await h.webhook(checkout.orderCode));
  const payment = h.state().payments[0], subscription = h.state().subscriptions[0];
  assert.equal(payment.status, 'SUCCESS'); assert.equal(payment.subscriptionId, subscription._id); assert.ok(payment.entitlementAppliedAt);
  assert.equal(subscription.householdId, HOUSE); assert.equal(subscription.scope, 'HOUSEHOLD'); assert.equal(subscription.provider, 'PAYOS');
  assert.equal(subscription.autoRenew, false); assert.ok(subscription.activatedAt);
});

test('duplicate and replayed webhooks never grant duration twice', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode); const payload = await h.webhook(checkout.orderCode);
  await h.api.processPayOSWebhook(payload); const end = h.state().subscriptions[0].endDate.getTime();
  await h.api.processPayOSWebhook(payload); await h.api.processPayOSWebhook(payload);
  assert.equal(h.state().subscriptions.length, 1); assert.equal(h.state().subscriptions[0].endDate.getTime(), end);
});

test('invalid SDK signature and signed wrong amount/link/currency never activate', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode);
  const invalid = await h.webhook(checkout.orderCode); invalid.signature = 'invalid';
  await assert.rejects(h.api.processPayOSWebhook(invalid), (error: any) => error.statusCode === 400);
  for (const fields of [{ amount: 1 }, { paymentLinkId: 'another-link' }, { currency: 'USD' }]) {
    await assert.rejects(h.api.processPayOSWebhook(await h.webhook(checkout.orderCode, fields)), (error: any) => error.statusCode === 400);
  }
  assert.equal(h.state().subscriptions.length, 0); assert.equal(h.state().payments[0].status, 'PENDING');
});

test('signed webhook still needs authoritative PAID status and exact paid amount', async () => {
  const h = harness(); const checkout = await h.checkout(); const payload = await h.webhook(checkout.orderCode);
  await h.api.processPayOSWebhook(payload); assert.equal(h.state().subscriptions.length, 0);
  h.paid(checkout.orderCode); h.orders.get(checkout.orderCode)!.amountPaid = 1;
  await assert.rejects(h.api.processPayOSWebhook(payload), (error: any) => error.statusCode === 400);
  assert.equal(h.state().subscriptions.length, 0);
});

test('signed non-success and signed unknown orders are acknowledged without activation', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode);
  await h.api.processPayOSWebhook(await h.webhook(checkout.orderCode, { code: '01' }));
  await h.api.processPayOSWebhook(await h.webhook(99999));
  assert.equal(h.state().subscriptions.length, 0);
});

for (const providerStatus of ['CANCELLED', 'EXPIRED', 'FAILED', 'UNDERPAID', 'PROCESSING']) {
  test(`provider ${providerStatus} is mapped without granting entitlement`, async () => {
    const h = harness(); const checkout = await h.checkout(); h.orders.get(checkout.orderCode)!.status = providerStatus;
    const result = await h.api.getPayOSPaymentStatus(OWNER, checkout.orderCode);
    assert.equal(result.status, ['CANCELLED', 'EXPIRED'].includes(providerStatus) ? 'CANCELLED' : providerStatus === 'FAILED' ? 'FAILED' : 'PENDING');
    assert.equal(h.state().subscriptions.length, 0);
  });
}

for (const point of ['subscriptions.create', 'payments.save']) {
  test(`payment and entitlement roll back if ${point} fails`, async () => {
    const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode); h.fail(point);
    await assert.rejects(h.api.processPayOSWebhook(await h.webhook(checkout.orderCode)), /Injected/);
    assert.equal(h.state().subscriptions.length, 0); assert.equal(h.state().payments[0].status, 'PENDING');
    h.fail(''); await h.api.processPayOSWebhook(await h.webhook(checkout.orderCode));
    assert.equal(h.state().subscriptions.length, 1);
  });
}

test('manual renewal adds the checkout snapshot duration to current end exactly once', async () => {
  const h = harness(); const first = await h.checkout(); h.paid(first.orderCode); await h.api.processPayOSWebhook(await h.webhook(first.orderCode));
  const oldEnd = h.state().subscriptions[0].endDate.getTime(); const renewal = await h.checkout();
  h.state().plans[0].billingPeriodMonths = 12; // Existing purchase retains its one-month snapshot.
  h.paid(renewal.orderCode); const payload = await h.webhook(renewal.orderCode);
  await h.api.processPayOSWebhook(payload); await h.api.processPayOSWebhook(payload);
  assert.equal(h.state().subscriptions[0].endDate.getTime(), addFamilyCalendarMonths(new Date(oldEnd), 1).getTime()); assert.equal(h.state().subscriptions.length, 1);
});

test('calendar checkout accepts month-based database plans and preserves the billing snapshot', async () => {
  const h = harness(); delete h.state().plans[0].durationDays; h.state().plans[0].billingPeriodMonths = 1;
  const order = await h.checkout(); assert.equal(h.state().payments[0].billingPeriodMonths, 1); assert.equal(h.state().payments[0].durationDays, undefined);
  h.paid(order.orderCode); await h.api.processPayOSWebhook(await h.webhook(order.orderCode));
  const row = h.state().subscriptions[0]; assert.equal(row.endDate.getTime(), addFamilyCalendarMonths(row.startDate, 1).getTime());
});

test('early monthly payment starts after trial and a second verified payment extends the queued paid period once', async () => {
  const h = harness(); const trialEnd = new Date(Date.now() + 20 * 86400000);
  h.state().subscriptions.push({ _id: id(90), userId: OWNER, householdId: HOUSE, scope: 'HOUSEHOLD', grantType: 'TRIAL',
    planId: PLAN, planCode: 'FAMILY_MONTHLY', status: 'ACTIVE', activatedAt: new Date(Date.now() - 86400000), startDate: new Date(Date.now() - 86400000), endDate: trialEnd, autoRenew: false });
  const first = await h.checkout(); h.paid(first.orderCode); await h.api.processPayOSWebhook(await h.webhook(first.orderCode));
  const paid = h.state().subscriptions.find(row => row.provider === 'PAYOS')!;
  assert.equal(paid.startDate.getTime(), trialEnd.getTime()); assert.equal(paid.endDate.getTime(), addFamilyCalendarMonths(trialEnd, 1).getTime());
  const firstEnd = paid.endDate; const second = await h.checkout(); h.paid(second.orderCode); const payload = await h.webhook(second.orderCode);
  await h.api.processPayOSWebhook(payload); await h.api.processPayOSWebhook(payload);
  const renewed = h.state().subscriptions.find(row => row.provider === 'PAYOS')!;
  assert.equal(renewed.startDate.getTime(), trialEnd.getTime()); assert.equal(renewed.endDate.getTime(), addFamilyCalendarMonths(firstEnd, 1).getTime());
  assert.equal(h.state().subscriptions.filter(row => row.grantType === 'TRIAL').length, 1); assert.equal(h.state().subscriptions.length, 2);
});

test('a trial owner can purchase yearly at database price and retain all remaining trial time', async () => {
  const h = harness(); const trialEnd = new Date(Date.now() + 15 * 86400000);
  h.state().plans.push({ ...structuredClone(h.state().plans[0]), _id: id(21), planCode: 'FAMILY_YEARLY', price: 499000, billingPeriodMonths: 12 });
  h.state().subscriptions.push({ _id: id(90), userId: OWNER, householdId: HOUSE, scope: 'HOUSEHOLD', grantType: 'TRIAL',
    planId: PLAN, planCode: 'FAMILY_MONTHLY', status: 'ACTIVE', activatedAt: new Date(Date.now() - 86400000), startDate: new Date(Date.now() - 86400000), endDate: trialEnd, autoRenew: false });
  const order = await h.checkout({ planCode: 'FAMILY_YEARLY', amount: 1 }); assert.equal(order.amount, 499000);
  h.paid(order.orderCode); await h.api.processPayOSWebhook(await h.webhook(order.orderCode, { amount: 499000 }));
  const paid = h.state().subscriptions.find(row => row.provider === 'PAYOS')!;
  assert.equal(paid.startDate.getTime(), trialEnd.getTime()); assert.equal(paid.endDate.getTime(), addFamilyCalendarMonths(trialEnd, 12).getTime());
});

test('expired renewal starts from now and does not reuse past remaining time', async () => {
  const h = harness(); const first = await h.checkout(); h.paid(first.orderCode); await h.api.processPayOSWebhook(await h.webhook(first.orderCode));
  h.state().subscriptions[0].status = 'EXPIRED'; h.state().subscriptions[0].endDate = new Date('2000-01-01');
  const before = Date.now(); const renewal = await h.checkout(); h.paid(renewal.orderCode); await h.api.processPayOSWebhook(await h.webhook(renewal.orderCode));
  assert.ok(h.state().subscriptions[0].endDate.getTime() >= addFamilyCalendarMonths(new Date(before), 1).getTime());
});

test('active monthly-to-yearly changes are rejected before requesting a new payment', async () => {
  const h = harness(); const first = await h.checkout(); h.paid(first.orderCode); await h.api.processPayOSWebhook(await h.webhook(first.orderCode));
  h.state().plans.push({ ...structuredClone(h.state().plans[0]), _id: id(21), planCode: 'FAMILY_YEARLY', durationDays: 365 });
  const calls = h.calls.filter((call) => call === 'provider.create').length;
  await assert.rejects(h.checkout({ planCode: 'FAMILY_YEARLY' }), (error: any) => error.statusCode === 409);
  assert.equal(h.calls.filter((call) => call === 'provider.create').length, calls);
});

test('checkout retries reuse the existing pending order instead of requesting another link', async () => {
  const h = harness(); const first = await h.checkout(); const second = await h.checkout();
  assert.equal(second.orderCode, first.orderCode); assert.equal(h.state().payments.length, 1);
  assert.equal(h.calls.filter((call) => call === 'provider.create').length, 1);
});

test('ambiguous provider timeout remains pending and cannot create duplicate orders', async () => {
  const h = harness(); h.providerFailure(new Error('synthetic timeout'));
  await assert.rejects(h.checkout(), (error: any) => error.statusCode === 503);
  assert.equal(h.state().payments[0].status, 'PENDING'); const retry = await h.checkout();
  assert.equal(retry.awaitingProvider, true); assert.equal(h.calls.filter((call) => call === 'provider.create').length, 1);
});

test('payment status reconciles a missed webhook, while a return URL alone cannot activate', async () => {
  const h = harness(); const checkout = await h.checkout({ success: true, status: 'PAID' });
  assert.equal(h.state().subscriptions.length, 0);
  h.paid(checkout.orderCode); const result = await h.api.getPayOSPaymentStatus(OWNER, String(checkout.orderCode));
  assert.equal(result.status, 'SUCCESS'); assert.equal(h.state().subscriptions.length, 1);
});

test('late failed or cancelled provider observations cannot overwrite SUCCESS', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode); await h.api.processPayOSWebhook(await h.webhook(checkout.orderCode));
  const end = h.state().subscriptions[0].endDate.getTime(); h.orders.get(checkout.orderCode)!.status = 'CANCELLED';
  assert.equal((await h.api.getPayOSPaymentStatus(OWNER, checkout.orderCode)).status, 'SUCCESS');
  await h.api.processPayOSWebhook(await h.webhook(checkout.orderCode));
  assert.equal(h.state().subscriptions[0].endDate.getTime(), end);
});

test('a webhook arriving before create-link response remains SUCCESS', async () => {
  const h = harness(); h.duringCreate(async () => {
    const orderCode = [...h.orders.keys()][0]; h.paid(orderCode); await h.api.processPayOSWebhook(await h.webhook(orderCode));
  });
  const result = await h.checkout(); assert.equal(result.status, 'SUCCESS'); assert.ok(result.checkoutUrl);
});

test('deactivated household cannot receive an entitlement after paying', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode); h.state().households[0].status = 'INACTIVE';
  await assert.rejects(h.api.processPayOSWebhook(await h.webhook(checkout.orderCode)), (error: any) => error.statusCode === 403);
  assert.equal(h.state().subscriptions.length, 0);
});

test('payment history still includes both RevenueCat and payOS transactions', async () => {
  const h = harness(); await h.checkout();
  h.state().payments.push({ _id: id(99), userId: OWNER, paymentGateway: 'REVENUECAT', transactionCode: 'RC-old', status: 'SUCCESS' });
  assert.equal((await h.api.getPaymentHistory(OWNER)).length, 2);
});

test('SDK configuration is lazy, disables automatic create retries and rejects unsafe redirect URLs', () => {
  const absent = load('config/payos.ts', { '@payos/node': { PayOS } });
  assert.throws(() => absent.getPayOS(), /not configured/);
  const config = load('config/payos.ts', { '@payos/node': { PayOS } }, {
    PAYOS_CLIENT_ID: 'synthetic-client', PAYOS_API_KEY: 'synthetic-api', PAYOS_CHECKSUM_KEY: 'synthetic-checksum',
    PAYOS_RETURN_URL: 'http://localhost:8081/payment-return', PAYOS_CANCEL_URL: 'https://app.test.invalid/payment-cancel',
  });
  const client = config.getPayOS(); assert.equal(client.maxRetries, 0); assert.equal(client.logLevel, 'off');
  assert.ok(config.getPayOSReturnUrls(123).returnUrl.includes('orderCode=123'));
  const unsafe = load('config/payos.ts', { '@payos/node': { PayOS } }, { PAYOS_RETURN_URL: 'http://public.test.invalid/return', PAYOS_CANCEL_URL: 'https://app.test.invalid/cancel' });
  assert.throws(() => unsafe.getPayOSReturnUrls(123), /HTTPS/);
});

test('native transaction schema compatibility is preserved and unverified payOS SUCCESS is rejected', async () => {
  const native = { userId: OWNER, planId: PLAN, subscriptionId: id(90), transactionCode: 'RC-test', paymentGateway: 'REVENUECAT',
    paymentMethod: 'IN_APP_PURCHASE', amount: 49000, currency: 'VND', status: 'SUCCESS' };
  await new PaymentTransaction(native).validate();
  const h = harness(); await h.checkout();
  await assert.rejects(new PaymentTransaction({ ...h.state().payments[0], status: 'SUCCESS', subscriptionId: id(90) }).validate());
});

test('two duplicate webhook deliveries have one winner in the serialized transaction model', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode);
  const payload = await h.webhook(checkout.orderCode);
  await Promise.all([h.api.processPayOSWebhook(payload), h.api.processPayOSWebhook(payload)]);
  assert.equal(h.state().subscriptions.length, 1);
  const subscription = h.state().subscriptions[0];
  assert.equal(subscription.endDate.getTime() - subscription.startDate.getTime(), 30 * 86400000);
});

test('replayed payment cannot reactivate a subscription that has since expired', async () => {
  const h = harness(); const checkout = await h.checkout(); h.paid(checkout.orderCode); const payload = await h.webhook(checkout.orderCode);
  await h.api.processPayOSWebhook(payload); h.state().subscriptions[0].status = 'EXPIRED';
  await h.api.processPayOSWebhook(payload);
  assert.equal(h.state().subscriptions[0].status, 'EXPIRED');
});

test('authenticated payOS routes and existing RevenueCat/history routes are preserved', () => {
  const routes: any[][] = [];
  const router = { post: (...args: any[]) => routes.push(['POST', ...args]), get: (...args: any[]) => routes.push(['GET', ...args]) };
  const protect = () => {};
  const handlers: Row = Object.fromEntries(['getPaymentHistoryHandler', 'revenueCatWebhookHandler', 'createPayOSCheckoutHandler', 'payOSWebhookHandler', 'getPayOSPaymentStatusHandler'].map((name) => [name, () => {}]));
  load('routes/paymentRoutes.ts', { express: { Router: () => router }, '../controllers/paymentController': handlers, '../middleware/authMiddleware': { protect } });
  assert.equal(routes.find((route) => route[1] === '/payos/checkout')?.[2], protect);
  assert.equal(routes.find((route) => route[1] === '/:orderCode/status')?.[2], protect);
  assert.equal(routes.find((route) => route[1] === '/history')?.[2], protect);
  assert.equal(routes.find((route) => route[1] === '/revenuecat/webhook')?.[2], handlers.revenueCatWebhookHandler);
  assert.equal(routes.find((route) => route[1] === '/payos/webhook')?.[2], handlers.payOSWebhookHandler);
});

test('payOS controllers return typed failures without exposing unknown provider errors', async () => {
  const h = harness();
  for (const [error, expectedStatus, text] of [
    [new h.api.PayOSPaymentError('Invalid payOS webhook signature', 400), 400, 'Invalid payOS webhook signature'],
    [new Error('synthetic private provider detail'), 503, 'payOS payment service is unavailable'],
  ] as const) {
    const controller = load('controllers/paymentController.ts', { '../services/paymentService': { ...h.api, processPayOSWebhook: async () => { throw error; } } });
    let status = 0; let body: any;
    const response = { status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; } };
    await controller.payOSWebhookHandler({ body: {} }, response);
    assert.equal(status, expectedStatus); assert.equal(body.message, text);
  }
});
