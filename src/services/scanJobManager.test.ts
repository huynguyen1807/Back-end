import assert from 'node:assert/strict';
import test from 'node:test';
import { createScanJobManager, ScanJobError } from './scanJobManager';

const sleep = (ms = 1) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Job did not settle'); await sleep(); }
}

test('progress comes from stages and reaches 100 only after the result resolves', async () => {
  const manager = createScanJobManager<string>();
  let finish!: (value: string) => void;
  const job = manager.create('owner', async ({ onStage }) => {
    onStage('recognizing'); onStage('enriching'); onStage('recognizing'); onStage('completed');
    return new Promise<string>((resolve) => { finish = resolve; });
  });
  assert.equal(job.progress, 20);
  await until(() => Boolean(finish));
  assert.equal(manager.get('owner', job.id)?.progress, 75);
  assert.equal(manager.get('owner', job.id)?.stage, 'enriching');
  assert.equal(manager.get('owner', job.id)?.result, undefined);
  assert.equal(manager.get('stranger', job.id), null);
  assert.equal(manager.cancel('stranger', job.id), false);
  finish('two foods');
  await until(() => manager.get('owner', job.id)?.status === 'completed');
  assert.equal(manager.get('owner', job.id)?.progress, 100);
  assert.equal(manager.get('owner', job.id)?.result, 'two foods');
});

test('cancellation aborts the runner and late results cannot revive the job', async () => {
  const manager = createScanJobManager<string>();
  let finish!: (value: string) => void;
  let signal!: AbortSignal;
  const job = manager.create('owner', async (context) => { signal = context.signal; return new Promise<string>((resolve) => { finish = resolve; }); });
  await until(() => Boolean(finish));
  manager.cancel('owner', job.id);
  assert.equal(signal.aborted, true);
  finish('late result'); await sleep(5);
  assert.equal(manager.get('owner', job.id)?.status, 'cancelled');
  assert.equal(manager.get('owner', job.id)?.result, undefined);
});

test('queued cancellation never starts work and concurrency is bounded', async () => {
  const manager = createScanJobManager<string>({ concurrency: 1 });
  let release!: (value: string) => void;
  let secondStarted = false;
  const first = manager.create('a', async () => new Promise<string>((resolve) => { release = resolve; }));
  const second = manager.create('b', async () => { secondStarted = true; return 'second'; });
  await until(() => Boolean(release));
  assert.equal(manager.get('b', second.id)?.status, 'queued');
  manager.cancel('b', second.id); release('first');
  await until(() => manager.get('a', first.id)?.status === 'completed');
  assert.equal(secondStarted, false);
});

test('deadline produces a retryable error and per-user load is capped', async () => {
  const manager = createScanJobManager<string>({ timeoutMs: 15 });
  const job = manager.create('a', async () => new Promise(() => {}));
  manager.create('a', async () => 'queued');
  assert.throws(() => manager.create('a', async () => 'third'), ScanJobError);
  await until(() => manager.get('a', job.id)?.status === 'failed');
  assert.equal(manager.get('a', job.id)?.error?.code, 'SCAN_TIMEOUT');
  assert(manager.get('a', job.id)!.progress < 100);
});

test('provider errors preserve retry hints while unexpected errors stay private', async () => {
  const manager = createScanJobManager();
  const quota = manager.create('a', async () => { throw new ScanJobError('Thử lại sau', 'GEMINI_QUOTA_EXCEEDED', 60); });
  const secret = manager.create('b', async () => { throw new Error('secret credential and connection'); });
  await until(() => manager.get('a', quota.id)?.status === 'failed' && manager.get('b', secret.id)?.status === 'failed');
  assert.equal(manager.get('a', quota.id)?.error?.retryAfterSeconds, 60);
  assert(!manager.get('b', secret.id)?.error?.message.includes('secret'));
});

test('expired completed jobs disappear', async () => {
  const manager = createScanJobManager({ ttlMs: 15 });
  const job = manager.create('a', async () => 'done');
  await until(() => manager.get('a', job.id)?.status === 'completed');
  await sleep(20);
  assert.equal(manager.get('a', job.id), null);
});
