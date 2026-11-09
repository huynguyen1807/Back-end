import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import express from 'express';
import { User } from '../models/user.model';
import { Household } from '../models/household.model';
import { HouseholdMember } from '../models/householdMember.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { Subscription, FAMILY_TRIAL_INDEXES } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { PaymentTransaction } from '../models/paymentTransaction.model';
import { FoodItem } from '../models/foodItem.model';
import { StorageLocation } from '../models/storageLocation.model';
import { previewFamilyPlanCatalog, startHouseholdTrial, getHouseholdSubscription, assertHouseholdSharedAccess } from '../services/subscriptionService';
import { createHousehold, deleteHousehold, removeHouseholdMember } from '../services/householdService';
import { deleteFoodItem } from '../services/foodService';
import { addFamilyCalendarMonths } from '../utils/familyBillingPeriod';

// Explicitly authorized disposable MongoDB only. Never reads dotenv, an app
// connection URI or customer data; no app/server bootstrap or payOS imports.
const database = 'freshfriends_task04_trial_test';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'freshfriends-task04-trial-test-'));
let processHandle: ChildProcess | undefined;
let startupError: Error | undefined;
let monthly: any, yearly: any;
const DAY = 86400000;
const objectId = () => new mongoose.Types.ObjectId();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  const binary = path.join(os.homedir(), '.cache/mongodb-binaries/mongod-x64-win32-8.2.6.exe');
  assert.ok(fs.existsSync(binary), 'BLOCKED: authorized isolated MongoDB binary is unavailable');
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  processHandle = spawn(binary, ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', sandbox,
    '--replSet', 'freshfriends_task04_trial_test', '--oplogSize', '32', '--logpath', path.join(sandbox, 'mongod.log')],
  { windowsHide: true, stdio: 'ignore' });
  processHandle.on('error', error => { startupError = error; });
  const uri = `mongodb://127.0.0.1:${port}/${database}?directConnection=true`;
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/freshfriends_task04_trial_test\?directConnection=true$/);
  const admin = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
  try {
    let connected = false;
    for (let i = 0; i < 60; i++) {
      if (startupError) throw startupError;
      try { await admin.connect(); connected = true; break; } catch { await delay(200); }
    }
    assert.ok(connected, 'BLOCKED: isolated MongoDB did not start');
    await admin.db('admin').command({ replSetInitiate: { _id: 'freshfriends_task04_trial_test', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    let primary = false;
    for (let i = 0; i < 100; i++) {
      if ((await admin.db('admin').command({ hello: 1 })).isWritablePrimary) { primary = true; break; }
      await delay(100);
    }
    assert.ok(primary, 'BLOCKED: isolated MongoDB has no primary');
  } finally { await admin.close(); }
  await mongoose.connect(uri, { dbName: database, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  assert.equal(mongoose.connection.name, database); assert.equal(mongoose.connection.host, '127.0.0.1');
  for (const model of [User, Household, HouseholdMember, HouseholdInvitation, Subscription, SubscriptionPlan, PaymentTransaction, FoodItem, StorageLocation]) {
    await model.createCollection(); await model.createIndexes();
  }
  for (const index of FAMILY_TRIAL_INDEXES) await Subscription.collection.createIndex(index.key, index.options);
  [monthly, yearly] = await SubscriptionPlan.create(previewFamilyPlanCatalog());
  console.log(`TASK04 isolated test DB: ${uri}; artifacts: ${sandbox}`);
}, { timeout: 60000 });

after(async () => {
  await mongoose.disconnect();
  if (processHandle && processHandle.exitCode === null && !startupError) {
    const stopped = new Promise<void>(resolve => processHandle!.once('exit', () => resolve()));
    if (processHandle.kill()) await stopped;
  }
  // Keep this isolated run's logs for review; never drop or clean an app DB.
});

async function fixture() {
  const owner = await User.create({ fullName: 'Synthetic trial owner', email: `${objectId()}@task04.invalid`, passwordHash: 'synthetic' });
  const member = await User.create({ fullName: 'Synthetic trial member', email: `${objectId()}@task04.invalid`, passwordHash: 'synthetic' });
  const household = await createHousehold(String(owner._id), { householdName: 'TASK04 synthetic household' });
  const permission = { canViewInventory: true, canEditInventory: true, canViewShoppingList: true, canEditShoppingList: true, canInviteMember: false };
  const membership = await HouseholdMember.create({ householdId: household._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date(), permission });
  return { owner: String(owner._id), member: String(member._id), householdId: String(household._id), membership };
}
function trialRow(owner: string, householdId: string, start = new Date()) {
  return { userId: owner, householdId, scope: 'HOUSEHOLD', grantType: 'TRIAL', planId: monthly._id,
    planCode: 'FAMILY_MONTHLY', status: 'ACTIVE', activatedAt: start, startDate: start, endDate: new Date(start.getTime() + 30 * DAY), autoRenew: false };
}
const status = (value: number) => (error: any) => error.statusCode === value;

test('real catalog has approved database prices, calendar periods and identical limits; trial is not automatic', async () => {
  const plans = await SubscriptionPlan.find({ scope: 'HOUSEHOLD' }).sort({ billingPeriodMonths: 1 }).lean();
  assert.equal(plans.length, 2); assert.equal(plans[0].price, 49000); assert.equal(plans[1].price, 499000);
  assert.equal(plans[0].billingPeriodMonths, 1); assert.equal(plans[1].billingPeriodMonths, 12);
  assert.equal(plans[0].durationDays, undefined); assert.equal(plans[1].durationDays, undefined); assert.deepEqual(plans[0].limits, plans[1].limits);
  const f = await fixture(); assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 0);
  assert.equal((await getHouseholdSubscription(f.owner, f.householdId)).trialEligibility.eligible, true);
});

test('authenticated HTTP trial start grants one winner, rejects members and ignores client-controlled dates/payment', async () => {
  const f = await fixture();
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'task04-synthetic-jwt-secret';
  const { signToken } = await import('../utils/jwt');
  const { protect } = await import('../middleware/authMiddleware');
  const { startHouseholdTrialHandler } = await import('../controllers/subscriptionController');
  const app = express(); app.use(express.json()); app.post('/api/households/:id/subscription/trial', protect, startHouseholdTrialHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/api/households/${f.householdId}/subscription/trial`;
    const request = (userId: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({ userId, role: 'USER' })}` },
      body: JSON.stringify({ price: 0, endDate: '2999-01-01', startDate: '2000-01-01', autoRenew: true, provider: 'PAYOS' }) });
    assert.equal((await request(f.member)).status, 403);
    const started = Date.now();
    const results = await Promise.all([request(f.owner), request(f.owner)]);
    assert.deepEqual(results.map(response => response.status).sort(), [201, 409]);
    const row = await Subscription.findOne({ householdId: f.householdId });
    assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 1);
    assert.ok(row!.startDate.getTime() >= started && row!.startDate.getTime() <= Date.now());
    assert.equal(row!.endDate.getTime() - row!.startDate.getTime(), 30 * DAY); assert.equal(row!.provider, undefined); assert.equal(row!.autoRenew, false);
    assert.equal(await PaymentTransaction.countDocuments({ householdId: f.householdId }), 0);
    const member = await getHouseholdSubscription(f.member, f.householdId);
    assert.equal(member.isTrial, true); assert.equal(member.hasFamilyAccess, true); assert.equal(member.trialEligibility.eligible, false);
    console.log('TASK04 HTTP race statuses', results.map(response => response.status));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test('real unique indexes protect lifetime owner and household claims even for expired trials', async () => {
  const f = await fixture(); const past = new Date(Date.now() - 31 * DAY);
  await Subscription.create({ ...trialRow(f.owner, f.householdId, past), status: 'EXPIRED' });
  await assert.rejects(Subscription.create(trialRow(f.owner, String(objectId()))), (error: any) => error.code === 11000);
  await assert.rejects(Subscription.create(trialRow(f.member, f.householdId)), (error: any) => error.code === 11000);
  const owner = String(objectId());
  const results = await Promise.allSettled([Subscription.create(trialRow(owner, String(objectId()))), Subscription.create(trialRow(owner, String(objectId())))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 11000);
  const indexes = await Subscription.collection.indexes();
  for (const descriptor of FAMILY_TRIAL_INDEXES) assert.equal(indexes.find(index => index.name === descriptor.options.name)!.unique, true);
});

test('a real transaction rolls back both the inserted trial and household revision on failure', async () => {
  const f = await fixture(); const original = Subscription.create;
  Subscription.create = (async (...args: any[]) => { await (original as any).apply(Subscription, args); throw Error('Injected post-insert failure'); }) as any;
  try { await assert.rejects(startHouseholdTrial(f.owner, f.householdId), /Injected/); }
  finally { Subscription.create = original; }
  assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 0);
  assert.equal((await Household.findById(f.householdId))!.membershipRevision, 0);
  await startHouseholdTrial(f.owner, f.householdId); assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 1);
});

test('trial expiry preserves household data and denies a shared inventory mutation', async () => {
  const f = await fixture();
  await Subscription.create(trialRow(f.owner, f.householdId, new Date(Date.now() - 31 * DAY)));
  const location = await StorageLocation.create({ ownerType: 'HOUSEHOLD', householdId: f.householdId, storageName: 'Synthetic fridge', storageType: 'REFRIGERATOR' });
  const food = await FoodItem.create({ ownerType: 'HOUSEHOLD', householdId: f.householdId, categoryId: objectId(), storageLocationId: location._id,
    foodName: 'Synthetic rice', sourceType: 'MARKET', expiryType: 'MANUAL', purchaseDate: new Date(), expiryDate: new Date(Date.now() + DAY), quantity: 1, unit: 'kg', createdBy: f.owner });
  const result = await getHouseholdSubscription(f.member, f.householdId);
  assert.equal(result.readOnly, true); assert.equal(result.subscription!.status, 'EXPIRED'); assert.equal(result.canReadSharedData, true);
  await assertHouseholdSharedAccess(f.householdId, 'VIEW'); await assert.rejects(assertHouseholdSharedAccess(f.householdId, 'EDIT'), status(403));
  await assert.rejects(deleteFoodItem(String(food._id), f.member, 'HOUSEHOLD', f.householdId), status(403));
  assert.equal((await FoodItem.findById(food._id))!.isDeleted, false); assert.equal((await Household.findById(f.householdId))!.status, 'ACTIVE');
  assert.ok(await StorageLocation.findById(location._id)); assert.equal(await PaymentTransaction.countDocuments({ householdId: f.householdId }), 0);
});

test('household deletion does not reset trial eligibility, while shared members keep their own eligibility', async () => {
  const f = await fixture(); await startHouseholdTrial(f.owner, f.householdId);
  await removeHouseholdMember(f.householdId, f.owner, String(f.membership._id));
  const memberHouse = await createHousehold(f.member, { householdName: 'Former member own household' });
  await startHouseholdTrial(f.member, String(memberHouse._id));
  await deleteHousehold(f.householdId, f.owner);
  const replacement = await createHousehold(f.owner, { householdName: 'Replacement household' });
  await assert.rejects(startHouseholdTrial(f.owner, String(replacement._id)), status(409));
  assert.equal(await Subscription.countDocuments({ userId: f.owner, grantType: 'TRIAL' }), 1);
});

test('prior paid Family customers and currently active Family access cannot be replaced by a trial', async () => {
  const f = await fixture(); const past = new Date(Date.now() - 60 * DAY);
  const historical = await Household.create({ ownerId: f.owner, householdName: 'Historical synthetic household', status: 'INACTIVE' });
  const record = await Subscription.create({ userId: f.owner, householdId: historical._id, scope: 'HOUSEHOLD', provider: 'PAYOS',
    planId: monthly._id, planCode: 'FAMILY_MONTHLY', activatedAt: past, startDate: past, endDate: new Date(past.getTime() + 31 * DAY), status: 'EXPIRED' });
  await assert.rejects(startHouseholdTrial(f.owner, f.householdId), status(409)); assert.equal(await Subscription.countDocuments({ userId: f.owner }), 1);
  assert.equal((await Subscription.findById(record._id))!.status, 'EXPIRED');
  const active = await fixture();
  const paid = await Subscription.create({ userId: active.owner, householdId: active.householdId, scope: 'HOUSEHOLD', provider: 'PAYOS',
    planId: yearly._id, planCode: 'FAMILY_YEARLY', activatedAt: new Date(), startDate: new Date(), endDate: addFamilyCalendarMonths(new Date(), 12), status: 'ACTIVE' });
  await assert.rejects(startHouseholdTrial(active.owner, active.householdId), status(409));
  assert.equal((await Subscription.findById(paid._id))!.endDate.getTime(), paid.endDate.getTime());
});

test('scheduled verified paid records do not override the current trial before their start', async () => {
  const f = await fixture(); await startHouseholdTrial(f.owner, f.householdId);
  const trial = await Subscription.findOne({ householdId: f.householdId });
  const paid = await Subscription.create({ userId: f.owner, householdId: f.householdId, scope: 'HOUSEHOLD', grantType: 'PAID', provider: 'PAYOS',
    planId: yearly._id, planCode: 'FAMILY_YEARLY', activatedAt: new Date(), startDate: trial!.endDate,
    endDate: addFamilyCalendarMonths(trial!.endDate, 12), status: 'ACTIVE' });
  const current = await getHouseholdSubscription(f.owner, f.householdId);
  assert.equal(current.isTrial, true);
  assert.equal(current.scheduledSubscription!.id, String(paid._id));
  assert.equal(current.scheduledSubscription!.startDate.getTime(), trial!.endDate.getTime());
  assert.equal(current.scheduledSubscription!.endDate.getTime(), paid.endDate.getTime());
  // Advance fixture periods, not the host clock; all writes remain in this DB.
  const boundary = new Date(Date.now() - 1000), start = new Date(boundary.getTime() - 30 * DAY);
  await Subscription.updateOne({ _id: trial!._id }, { startDate: start, activatedAt: start, endDate: boundary });
  await Subscription.updateOne({ _id: paid._id }, { startDate: boundary, endDate: addFamilyCalendarMonths(boundary, 12) });
  const result = await getHouseholdSubscription(f.member, f.householdId);
  assert.equal(result.isTrial, false); assert.equal(result.hasFamilyAccess, true); assert.equal(result.subscription!.planCode, 'FAMILY_YEARLY');
  assert.equal(result.scheduledSubscription, null);
  assert.equal(await Subscription.countDocuments({ householdId: f.householdId }), 2);
});

test('existing invitation HTTP route distinguishes missing recipient from missing endpoint and accepts a registered account', async () => {
  const f = await fixture(); await startHouseholdTrial(f.owner, f.householdId);
  const candidate = await User.create({ fullName: 'Synthetic invitation recipient', email: `${objectId()}@task04.invalid`, passwordHash: 'synthetic' });
  const { signToken } = await import('../utils/jwt');
  const router = (await import('../routes/householdRoutes')).default;
  const app = express(); app.use(express.json()); app.use('/api/households', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/api/households/${f.householdId}/members`;
    const send = (email: string, userId = f.owner) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${signToken({ userId, role: 'USER' })}` }, body: JSON.stringify({ email }) });
    const missing = await send(`${objectId()}@task04.invalid`);
    assert.equal(missing.status, 404); const missingBody = await missing.json() as any;
    assert.equal(missingBody.success, false); assert.match(missingBody.message, /FreshFriends/);
    assert.equal((await send('not-an-email')).status, 400);
    assert.equal((await send(candidate.email, f.member)).status, 403);
    assert.equal((await send(`  ${candidate.email.toUpperCase()}  `)).status, 201);
    assert.equal((await send(candidate.email)).status, 409);
    assert.equal(await HouseholdInvitation.countDocuments({ householdId: f.householdId, inviteEmail: candidate.email, status: 'PENDING' }), 1);
    console.log('Invitation HTTP statuses verified: missing=404, invalid=400, member=403, registered=201, duplicate=409');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
