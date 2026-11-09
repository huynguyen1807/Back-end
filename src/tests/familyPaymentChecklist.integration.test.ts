import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { PayOS } from '@payos/node';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Household } from '../models/household.model';
import { HouseholdMember } from '../models/householdMember.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { User } from '../models/user.model';
import { Subscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { PaymentTransaction } from '../models/paymentTransaction.model';
import { ShoppingList } from '../models/shoppingList.model';
import { FoodItem } from '../models/foodItem.model';
import { StorageLocation } from '../models/storageLocation.model';
import * as subscriptions from '../services/subscriptionService';
import * as households from '../services/householdService';
import * as shopping from '../services/shoppingListService';
import * as food from '../services/foodService';
import { addFamilyCalendarMonths } from '../utils/familyBillingPeriod';

// Never reads dotenv or an external Mongo URI. Only this newly spawned loopback
// replica set is used. Real models, indexes, queries and transactions are kept.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'freshfriends-task07-'));
let mongod: ChildProcess | undefined;
const orders = new Map<number, any>();
const sdk = new PayOS({ clientId: 'task07-synthetic', apiKey: 'task07-synthetic', checksumKey: 'task07-synthetic', logLevel: 'off',
  fetch: async () => { throw new Error('External payment network is forbidden'); } });
let providerCreates = 0;
const provider = { webhooks: sdk.webhooks, paymentRequests: {
  async create(input: any) {
    providerCreates++;
    const paymentLinkId = `test-${input.orderCode}`;
    orders.set(input.orderCode, { id: paymentLinkId, orderCode: input.orderCode, amount: input.amount,
      amountPaid: 0, amountRemaining: input.amount, status: 'PENDING' });
    return { paymentLinkId, orderCode: input.orderCode, amount: input.amount, currency: 'VND', status: 'PENDING', checkoutUrl: 'https://checkout.test.invalid/task07' };
  },
  async get(code: number) { assert.ok(orders.has(code)); return structuredClone(orders.get(code)); },
} };
const paymentFile = path.resolve(__dirname, '../services/paymentService.ts');
const serviceRequire = createRequire(paymentFile);
const compiled = ts.transpileModule(fs.readFileSync(paymentFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const paymentModule = { exports: {} as any };
vm.runInNewContext(compiled.outputText, { module: paymentModule, exports: paymentModule.exports, process: { env: {} },
  require(name: string) {
    return name === '../config/payos' ? { getPayOS: () => provider, getPayOSReturnUrls: () => ({ returnUrl: 'https://app.test.invalid/return', cancelUrl: 'https://app.test.invalid/cancel' }) } : serviceRequire(name);
  },
}, { filename: paymentFile });
const payments = paymentModule.exports;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const newId = () => new mongoose.Types.ObjectId();
const permission = { canViewInventory: true, canEditInventory: true, canViewShoppingList: true, canEditShoppingList: true, canInviteMember: false };
let plan: any;

before(async () => {
  const binary = path.join(os.homedir(), '.cache/mongodb-binaries/mongod-x64-win32-8.2.6.exe');
  assert.ok(fs.existsSync(binary), 'BLOCKED: cached local MongoDB binary is unavailable');
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  mongod = spawn(binary, ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', sandbox,
    '--replSet', 'freshfriends_task07', '--logpath', path.join(sandbox, 'mongod.log'), '--oplogSize', '32'], { windowsHide: true, stdio: 'ignore' });
  let spawnError: Error | undefined;
  mongod.on('error', error => { spawnError = error; });
  const uri = `mongodb://127.0.0.1:${port}/freshfriends_task07?directConnection=true`;
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/freshfriends_task07\?directConnection=true$/);
  const admin = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (spawnError) throw spawnError;
      try { await admin.connect(); ready = true; break; } catch { await pause(200); }
    }
    assert.ok(ready, 'BLOCKED: isolated mongod did not start');
    await admin.db('admin').command({ replSetInitiate: { _id: 'freshfriends_task07', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    let primary = false;
    for (let i = 0; i < 100; i++) {
      if ((await admin.db('admin').command({ hello: 1 })).isWritablePrimary) { primary = true; break; }
      await pause(100);
    }
    assert.ok(primary, 'BLOCKED: isolated replica set has no primary');
  } finally { await admin.close(); }
  await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 5000 });
  await Promise.all([Household, HouseholdMember, HouseholdInvitation, User, Subscription, SubscriptionPlan,
    PaymentTransaction, ShoppingList, FoodItem, StorageLocation].map(model => model.init()));
  plan = await SubscriptionPlan.create({ planName: 'Family Monthly', planCode: 'FAMILY_MONTHLY', scope: 'HOUSEHOLD',
    price: 49000, currency: 'VND', durationDays: 30, limits: { maxMembers: 6, maxFoodItems: 1000, maxStorageLocations: 10,
      familyCloudEnabled: true, multiStorageEnabled: true }, features: ['Shared inventory'], isActive: true });
  console.log(`TASK07 isolated MongoDB: ${uri}; temporary files: ${sandbox}`);
}, { timeout: 60000 });

after(async () => {
  await mongoose.disconnect();
  if (mongod && mongod.exitCode === null) {
    const exited = new Promise<void>(resolve => mongod!.once('exit', () => resolve()));
    mongod.kill();
    await exited;
  }
  // Retain local test logs/data for review. Never drop or clean any existing DB.
});

async function fixture(active = false) {
  const owner = await User.create({ fullName: 'Test owner', email: `${newId()}@task07.invalid`, passwordHash: 'synthetic' });
  const member = await User.create({ fullName: 'Test member', email: `${newId()}@task07.invalid`, passwordHash: 'synthetic' });
  const household = await Household.create({ householdName: 'TASK07 isolated fixture', ownerId: owner._id });
  const [ownerMembership, membership] = await HouseholdMember.create([
    { householdId: household._id, userId: owner._id, role: 'OWNER', permission: { ...permission, canInviteMember: true }, status: 'ACTIVE', joinedAt: new Date() },
    { householdId: household._id, userId: member._id, role: 'MEMBER', permission, status: 'ACTIVE', joinedAt: new Date() },
  ]);
  const context = { owner: String(owner._id), member: String(member._id), householdId: String(household._id), ownerMembership, membership };
  if (active) await Subscription.create({ userId: owner._id, householdId: household._id, scope: 'HOUSEHOLD', provider: 'PAYOS',
    planId: plan._id, planCode: 'FAMILY_MONTHLY', status: 'ACTIVE', activatedAt: new Date(), startDate: new Date(Date.now() - 10000), endDate: new Date(Date.now() + 86400000) });
  return context;
}
async function checkout(f: Awaited<ReturnType<typeof fixture>>) {
  return payments.createPayOSCheckout(f.owner, { householdId: f.householdId, planCode: 'FAMILY_MONTHLY' });
}
async function webhook(code: number, fields: any = {}) {
  const data = { orderCode: code, amount: 49000, currency: 'VND', paymentLinkId: `test-${code}`, reference: `ref-${code}`,
    transactionDateTime: '2026-11-09 12:00:00', description: 'Synthetic TASK07', accountNumber: '000000', code: '00', desc: 'success', ...fields };
  return { code: '00', success: true, desc: 'success', data, signature: await sdk.crypto.createSignatureFromObj(data, 'task07-synthetic') };
}
async function activate(f: Awaited<ReturnType<typeof fixture>>) {
  const order = await checkout(f);
  Object.assign(orders.get(order.orderCode), { status: 'PAID', amountPaid: 49000, amountRemaining: 0 });
  await payments.processPayOSWebhook(await webhook(order.orderCode));
  return order;
}

test('TC-01 verified purchase activates only the correct household', async () => {
  const f = await fixture(), other = await fixture();
  const order = await activate(f);
  const sub = await Subscription.findOne({ householdId: f.householdId });
  const payment = await PaymentTransaction.findOne({ orderCode: order.orderCode });
  assert.equal(sub?.status, 'ACTIVE'); assert.equal(String(payment?.subscriptionId), String(sub?._id));
  assert.equal(payment?.status, 'SUCCESS'); assert.equal(sub?.provider, 'PAYOS');
  assert.equal((await subscriptions.getHouseholdSubscription(f.owner, f.householdId)).hasPaidAccess, true);
  assert.equal((await subscriptions.getHouseholdSubscription(other.owner, other.householdId)).hasPaidAccess, false);
});

test('TC-02 failed and cancelled payments do not activate entitlement', async () => {
  for (const status of ['FAILED', 'CANCELLED']) {
    const f = await fixture(), order = await checkout(f);
    orders.get(order.orderCode).status = status;
    assert.equal((await payments.getPayOSPaymentStatus(f.owner, order.orderCode)).status, status);
    assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 0);
    assert.equal((await subscriptions.getHouseholdSubscription(f.member, f.householdId)).hasPaidAccess, false);
  }
});

test('TC-03 simultaneous duplicate webhooks apply entitlement once', async () => {
  const f = await fixture(), order = await checkout(f);
  Object.assign(orders.get(order.orderCode), { status: 'PAID', amountPaid: 49000, amountRemaining: 0 });
  const payload = await webhook(order.orderCode);
  await Promise.all([payments.processPayOSWebhook(payload), payments.processPayOSWebhook(payload)]);
  const before = await Subscription.findOne({ householdId: f.householdId });
  await payments.processPayOSWebhook(payload);
  assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 1);
  assert.equal((await Subscription.findById(before!._id))!.endDate.getTime(), before!.endDate.getTime());
});

test('TC-04 invalid signature and signed incorrect amount are rejected', async () => {
  const f = await fixture(), order = await checkout(f);
  Object.assign(orders.get(order.orderCode), { status: 'PAID', amountPaid: 49000, amountRemaining: 0 });
  const invalid = await webhook(order.orderCode); invalid.signature = 'invalid';
  await assert.rejects(payments.processPayOSWebhook(invalid), (e: any) => e.statusCode === 400);
  await assert.rejects(payments.processPayOSWebhook(await webhook(order.orderCode, { amount: 1 })), (e: any) => e.statusCode === 400);
  assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 0);
  assert.equal((await PaymentTransaction.findOne({ orderCode: order.orderCode }))!.status, 'PENDING');
});

test('TC-05 non-owner cannot initiate checkout', async () => {
  const f = await fixture(), before = providerCreates;
  await assert.rejects(payments.createPayOSCheckout(f.member, { householdId: f.householdId, planCode: 'FAMILY_MONTHLY' }), (e: any) => e.statusCode === 403);
  assert.equal(providerCreates, before); assert.equal(await PaymentTransaction.countDocuments({ householdId: f.householdId }), 0);
});

test('TC-06 expiry retains read access and removes paid edit capabilities', async () => {
  const f = await fixture(true);
  await Subscription.updateOne({ householdId: f.householdId }, { endDate: new Date(Date.now() - 1) });
  const status = await subscriptions.getHouseholdSubscription(f.member, f.householdId);
  assert.equal(status.hasPaidAccess, false); assert.equal(status.readOnly, true); assert.equal(status.canReadSharedData, true);
  assert.equal(status.capabilities.familyCloudEnabled, false); assert.equal(status.capabilities.multiStorageEnabled, false);
  await subscriptions.assertHouseholdSharedAccess(f.householdId, 'VIEW');
  await assert.rejects(subscriptions.assertHouseholdSharedAccess(f.householdId, 'EDIT'), (e: any) => e.statusCode === 403);
});

test('TC-07 renewal extends from max(now,end) once', async () => {
  for (const expired of [false, true]) {
    const f = await fixture(true);
    if (expired) await Subscription.updateOne({ householdId: f.householdId }, { endDate: new Date('2000-01-01'), status: 'EXPIRED' });
    const before = (await Subscription.findOne({ householdId: f.householdId }))!.endDate.getTime();
    const started = Date.now(), order = await activate(f);
    const after = (await Subscription.findOne({ householdId: f.householdId }))!.endDate.getTime();
    if (!expired) assert.equal(after, addFamilyCalendarMonths(new Date(before), 1).getTime());
    else assert.ok(after >= addFamilyCalendarMonths(new Date(started), 1).getTime() && after <= addFamilyCalendarMonths(new Date(), 1).getTime());
    await payments.processPayOSWebhook(await webhook(order.orderCode));
    assert.equal((await Subscription.findOne({ householdId: f.householdId }))!.endDate.getTime(), after);
    assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 1);
  }
});

test('TC-08 revoked edit permission blocks inventory writes', async () => {
  const f = await fixture(true);
  await HouseholdMember.updateOne({ _id: f.membership._id }, { 'permission.canEditInventory': false });
  const item = await FoodItem.create({ ownerType: 'HOUSEHOLD', householdId: f.householdId, categoryId: newId(), storageLocationId: newId(),
    foodName: 'Test rice', sourceType: 'MARKET', expiryType: 'MANUAL', purchaseDate: new Date(), expiryDate: new Date(Date.now() + 86400000), quantity: 1, unit: 'kg', createdBy: f.owner });
  const args = [String(item._id), f.member, 'HOUSEHOLD', f.householdId] as const;
  await assert.rejects(food.deleteFoodItem(...args), (e: any) => e.statusCode === 403);
  await assert.rejects(food.updateFoodItem(args[0], args[1], { quantity: 10 }, args[2], args[3]), (e: any) => e.statusCode === 403);
  const saved = await FoodItem.findById(item._id);
  assert.equal(saved!.quantity, 1); assert.equal(saved!.isDeleted, false);
});

test('TC-09 simultaneous shopping edits must not silently overwrite', async () => {
  const f = await fixture(true);
  const { updateShoppingListItemHandler } = await import('../controllers/shoppingListController');
  const app = express(); app.use(express.json());
  // Authentication is covered by TC-10. This route supplies fixture identities
  // to exercise the actual controller's 200/409 responses and persisted writes.
  app.patch('/lists/:id/items/:itemId', (req: any, _res, next) => {
    req.user = { userId: req.headers['x-test-member'] === 'member' ? f.member : f.owner }; next();
  }, updateShoppingListItemHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    for (const legacy of [false, true]) {
      const list = await ShoppingList.create({ ownerType: 'HOUSEHOLD', householdId: f.householdId, listName: 'Concurrency fixture',
        items: [{ foodName: 'Rice', quantity: 1, unit: 'kg' }] });
      if (legacy) await ShoppingList.collection.updateOne({ _id: list._id }, { $unset: { revision: '' } });
      const original = ShoppingList.findById;
      let reads = 0; let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      // Synchronize real reads only; all writes execute against the local DB.
      ShoppingList.findById = (async function (...args: any[]) {
        const doc = await (original as any).apply(ShoppingList, args);
        if (++reads === 2) release();
        await barrier; return doc;
      }) as any;
      try {
        const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/lists/${list._id}/items/${list.items[0]._id}`;
        const responses = await Promise.all([7, 9].map((quantity, i) => fetch(url, { method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Test-Member': i ? 'member' : 'owner' }, body: JSON.stringify({ quantity }) })));
        const bodies = await Promise.all(responses.map(response => response.json())) as any[];
        const saved = await (original as any).call(ShoppingList, list._id);
        const accepted = responses.filter(response => response.status === 200).length;
        console.log('TC-09 evidence', { legacy, httpStatuses: responses.map(response => response.status), savedQuantity: saved.items[0].quantity, revision: saved.revision });
        assert.equal(accepted, 1, 'Both conflicting edits returned success; one accepted value was silently overwritten');
        assert.ok(responses.some(response => response.status === 409));
        const winner = responses.findIndex(response => response.status === 200);
        const conflict = responses.findIndex(response => response.status === 409);
        assert.equal(bodies[conflict].success, false); assert.match(bodies[conflict].message, /Reload/);
        assert.equal(saved.items[0].quantity, bodies[winner].data.quantity); assert.equal(saved.revision, 1);
        // Retrying after re-reading succeeds without erasing the other field.
        const refreshed = await shopping.updateShoppingListItem(String(list._id), String(list.items[0]._id), f.member, { foodName: 'Fresh rice' });
        assert.equal(refreshed!.quantity, saved.items[0].quantity); assert.equal(refreshed!.foodName, 'Fresh rice');
      } finally { ShoppingList.findById = original; }
    }
    // Verify other writers use the same revision contract and retain responses.
    const list = await shopping.createShoppingList(f.owner, { ownerType: 'HOUSEHOLD', householdId: f.householdId, listName: 'Writer compatibility' });
    const item = await shopping.addShoppingListItem(String(list._id), f.owner, { foodName: 'Milk', quantity: 2, unit: 'l' });
    assert.equal(item.quantity, 2);
    await shopping.removeShoppingListItem(String(list._id), String(item._id), f.owner);
    const completed = await shopping.completeShoppingList(String(list._id), f.owner);
    assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.items.length, 0); assert.equal(completed.revision, 3);
    const personal = await shopping.addMissingIngredientsToShoppingList(f.owner, [{ foodName: 'Rice', quantity: 2, unit: 'kg' }]);
    const merged = await shopping.addMissingIngredientsToShoppingList(f.owner, [{ foodName: 'Rice', quantity: 3, unit: 'kg' }]);
    assert.equal(String(personal._id), String(merged._id)); assert.equal(merged.items[0].quantity, 5); assert.equal(merged.revision, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('TC-10 app and web requests for the same authenticated account return the same entitlement', async () => {
  const f = await fixture(true);
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'task07-synthetic-secret';
  const { protect } = await import('../middleware/authMiddleware');
  const { getHouseholdSubscriptionHandler } = await import('../controllers/subscriptionController');
  const app = express(); app.get('/api/households/:id/subscription', protect, getHouseholdSubscriptionHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const token = jwt.sign({ userId: f.member }, process.env.JWT_SECRET);
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/api/households/${f.householdId}/subscription`;
    const responses = await Promise.all(['native', 'web'].map(client => fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-Test-Client': client } })));
    for (const response of responses) assert.equal(response.status, 200);
    const [native, web] = await Promise.all(responses.map(response => response.json())) as any[];
    assert.deepEqual(native, web); assert.equal(web.data.hasPaidAccess, true); assert.equal(web.data.canManageSubscription, false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test('TC-11 accepting invitations cannot exceed the configured member limit', async () => {
  const f = await fixture(true);
  await SubscriptionPlan.updateOne({ _id: plan._id }, { 'limits.maxMembers': 3 });
  try {
    const users = await User.create([1, 2].map(() => ({ fullName: 'Candidate', email: `${newId()}@task07.invalid`, passwordHash: 'synthetic' })));
    const invitations = await HouseholdInvitation.create(users.map((user: any) => ({ householdId: f.householdId, invitedBy: f.owner,
      inviteEmail: user.email, inviteToken: String(newId()), status: 'PENDING', expiresAt: new Date(Date.now() + 86400000) })));
    // Two pre-existing reservations at the final slot must not overfill capacity.
    const first = await Promise.allSettled(invitations.map((invitation: any, i: number) => households.acceptHouseholdInvitation(String(users[i]._id), String(invitation._id))));
    assert.ok(first.every(result => result.status === 'rejected'));
    await households.cancelHouseholdInvitation(f.householdId, f.owner, String(invitations[1]._id));
    await households.acceptHouseholdInvitation(String(users[0]._id), String(invitations[0]._id));
    assert.equal(await HouseholdMember.countDocuments({ householdId: f.householdId, status: 'ACTIVE' }), 3);
    await assert.rejects(households.addHouseholdMember(f.householdId, f.owner, { email: users[1].email }));
  } finally { await SubscriptionPlan.updateOne({ _id: plan._id }, { 'limits.maxMembers': 6 }); }
});

test('TC-12 owner invariants and subscription associations survive household deletion', async () => {
  const f = await fixture(); await activate(f);
  await assert.rejects(households.removeHouseholdMember(f.householdId, f.owner, String(f.ownerMembership._id)));
  await assert.rejects(households.updateHouseholdMember(f.householdId, f.owner, String(f.ownerMembership._id), { role: 'MEMBER' }));
  await assert.rejects(households.deleteHousehold(f.householdId, f.member));
  const unchanged = await Household.findById(f.householdId);
  assert.equal(unchanged!.status, 'ACTIVE'); assert.equal(String(unchanged!.ownerId), f.owner);
  assert.equal((await HouseholdMember.findById(f.ownerMembership._id))!.role, 'OWNER');
  const subscription = await Subscription.findOne({ householdId: f.householdId });
  const pendingPayment = await checkout(f);
  const invitation = await HouseholdInvitation.create({ householdId: f.householdId, invitedBy: f.owner,
    inviteEmail: `${newId()}@task07.invalid`, inviteToken: String(newId()), status: 'PENDING', expiresAt: new Date(Date.now() + 86400000) });
  const location = await StorageLocation.create({ ownerType: 'HOUSEHOLD', householdId: f.householdId, storageName: 'Fixture fridge', storageType: 'REFRIGERATOR' });
  await households.deleteHousehold(f.householdId, f.owner);
  assert.equal((await Household.findById(f.householdId))!.status, 'INACTIVE');
  assert.equal(await HouseholdMember.countDocuments({ householdId: f.householdId, status: 'ACTIVE' }), 0);
  assert.equal((await HouseholdInvitation.findById(invitation._id))!.status, 'CANCELLED');
  const retained = await Subscription.findById(subscription!._id);
  assert.equal(String(retained!.householdId), f.householdId); assert.equal(String(retained!.userId), f.owner);
  assert.equal(String((await PaymentTransaction.findOne({ householdId: f.householdId }))!.subscriptionId), String(retained!._id));
  const transferred = await StorageLocation.findById(location._id);
  assert.equal(transferred!.ownerType, 'USER'); assert.equal(String(transferred!.userId), f.owner);
  await assert.rejects(subscriptions.getHouseholdSubscription(f.owner, f.householdId));
  await assert.rejects(checkout(f));
  Object.assign(orders.get(pendingPayment.orderCode), { status: 'PAID', amountPaid: 49000, amountRemaining: 0 });
  await assert.rejects(payments.processPayOSWebhook(await webhook(pendingPayment.orderCode)));
  assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 1);
  assert.equal((await Subscription.findById(subscription!._id))!.endDate.getTime(), retained!.endDate.getTime());
});
