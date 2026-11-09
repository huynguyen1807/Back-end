import fs from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { Subscription, FAMILY_TRIAL_INDEXES } from '../models/subscription.model';
import { previewFamilyPlanCatalog } from '../services/subscriptionService';

// Explicit operator command, never imported by application startup. Dry-run is
// the default; apply requires the fingerprint printed by the reviewed dry-run.
async function run() {
  const env = dotenv.parse(fs.readFileSync('.env'));
  const uri = env.MONGODB_URI;
  if (!uri) throw Error('Missing database configuration');
  const dbName = env.MONGODB_DB_NAME || 'freshfriends';
  const fingerprint = createHash('sha256').update(`${uri}|${dbName}`).digest('hex').slice(0, 12);
  const apply = process.argv.includes('--apply');
  const target = process.argv.find(value => value.startsWith('--target-fingerprint='))?.split('=')[1];
  if (apply && target !== fingerprint) throw Error('Explicit target fingerprint is required');
  await mongoose.connect(uri, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const filter = { planCode: { $in: ['FAMILY_MONTHLY', 'FAMILY_YEARLY'] } };
  const existing = await SubscriptionPlan.find(filter).lean();
  const preview = previewFamilyPlanCatalog(existing);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', database: dbName, targetFingerprint: fingerprint,
    plans: preview.map(plan => ({ planCode: plan.planCode, price: plan.price, currency: plan.currency,
      billingPeriodMonths: plan.billingPeriodMonths, limits: plan.limits, isActive: plan.isActive })) }, null, 2));
  if (!apply) return;
  const indexes = await Subscription.collection.indexes();
  for (const descriptor of FAMILY_TRIAL_INDEXES) {
    const found = indexes.find(index => index.name === descriptor.options.name);
    if (found && (!found.unique || JSON.stringify(found.key) !== JSON.stringify(descriptor.key)
      || JSON.stringify(found.partialFilterExpression) !== JSON.stringify(descriptor.options.partialFilterExpression))) throw Error('Existing trial index conflicts with approved configuration');
  }
  await mongoose.connection.transaction(async session => {
    const current = await SubscriptionPlan.find(filter, null, { session }).lean();
    for (const plan of previewFamilyPlanCatalog(current)) {
      const row = await SubscriptionPlan.findOne({ planCode: plan.planCode }, null, { session });
      if (row) { Object.assign(row, plan); row.durationDays = undefined; await row.save({ session }); }
      else await SubscriptionPlan.create([plan], { session });
    }
  });
  for (const descriptor of FAMILY_TRIAL_INDEXES) {
    if (!indexes.some(index => index.name === descriptor.options.name)) await Subscription.collection.createIndex(descriptor.key, descriptor.options);
  }
  const verified = await SubscriptionPlan.find(filter).select('planCode scope price currency billingPeriodMonths durationDays isActive').lean();
  console.log(JSON.stringify({ verifiedFamilyPlans: verified }, null, 2));
}

run().catch(() => { console.error('Family catalog configuration failed; credential details suppressed.'); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
