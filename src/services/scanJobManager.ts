import { randomUUID } from 'node:crypto';

export type ScanJobStage = 'queued' | 'recognizing' | 'enriching' | 'finishing' | 'completed';
export type ScanJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
const PROGRESS: Record<ScanJobStage, number> = { queued: 20, recognizing: 40, enriching: 75, finishing: 92, completed: 100 };

export class ScanJobError extends Error {
  constructor(message: string, public code = 'SCAN_FAILED', public retryAfterSeconds?: number) { super(message); }
}

export type ScanJobSnapshot<T> = {
  id: string; status: ScanJobStatus; stage: ScanJobStage; progress: number;
  createdAt: number; result?: T; error?: { message: string; code: string; retryAfterSeconds?: number };
};
type Runner<T> = (context: { signal: AbortSignal; onStage: (stage: ScanJobStage) => void }) => Promise<T>;
type Job<T> = ScanJobSnapshot<T> & { userId: string; controller: AbortController; run?: Runner<T> };

/** Process-local, bounded queue. Restarted/expired jobs return 404 so clients can retry. */
export function createScanJobManager<T>(options: { concurrency?: number; capacity?: number; timeoutMs?: number; ttlMs?: number } = {}) {
  const jobs = new Map<string, Job<T>>();
  const concurrency = options.concurrency ?? 2;
  const capacity = options.capacity ?? 10;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const ttlMs = options.ttlMs ?? 180_000;
  let running = 0;
  const isActive = (job: Job<T>) => job.status === 'queued' || job.status === 'processing';
  const snapshot = (job: Job<T>): ScanJobSnapshot<T> => ({
    id: job.id, status: job.status, stage: job.stage, progress: job.progress, createdAt: job.createdAt,
    result: job.status === 'completed' ? job.result : undefined, error: job.error,
  });
  const sweep = () => {
    for (const [id, job] of jobs) if (!isActive(job) && Date.now() - job.createdAt > ttlMs) jobs.delete(id);
  };
  function drain() {
    for (const job of jobs.values()) {
      if (running >= concurrency) break;
      if (job.status !== 'queued' || !job.run) continue;
      running++;
      job.status = 'processing';
      const run = job.run;
      job.run = undefined;
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          job.controller.abort();
          reject(new ScanJobError('Quét mất nhiều thời gian hơn dự kiến. Hãy thử ảnh rõ hơn hoặc thử lại.', 'SCAN_TIMEOUT'));
        }, timeoutMs);
        timer.unref?.();
      });
      void Promise.race([Promise.resolve().then(() => run({
        signal: job.controller.signal,
        onStage(stage) {
          if (!isActive(job) || job.controller.signal.aborted) return;
          if (!Number.isFinite(PROGRESS[stage]) || PROGRESS[stage] >= 100 || PROGRESS[stage] < job.progress) return;
          job.stage = stage;
          job.progress = Math.max(job.progress, PROGRESS[stage]);
        },
      })), deadline]).then((result) => {
        if (job.status === 'cancelled') return;
        job.status = 'completed'; job.stage = 'completed'; job.progress = 100; job.result = result;
      }).catch((error: unknown) => {
        if (job.status === 'cancelled') return;
        job.status = 'failed';
        job.error = error instanceof ScanJobError
          ? { message: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds }
          : { message: 'Chưa quét được ảnh. Vui lòng kiểm tra kết nối và thử lại.', code: 'SCAN_FAILED' };
      }).finally(() => { clearTimeout(timer!); running--; drain(); });
    }
  }
  return {
    create(userId: string, run: Runner<T>) {
      sweep();
      const active = [...jobs.values()].filter(isActive);
      if (active.length >= capacity || active.filter((job) => job.userId === userId).length >= 2) {
        throw new ScanJobError('Hệ thống đang bận. Vui lòng chờ lượt quét hiện tại hoặc thử lại sau.', 'SCAN_BUSY', 5);
      }
      const job: Job<T> = { id: randomUUID(), userId, status: 'queued', stage: 'queued', progress: 20, createdAt: Date.now(), controller: new AbortController(), run };
      jobs.set(job.id, job);
      // Return a stable queued response before starting work on the next microtask.
      const response = snapshot(job);
      queueMicrotask(drain);
      return response;
    },
    get(userId: string, id: string) {
      sweep();
      const job = jobs.get(id);
      return job?.userId === userId ? snapshot(job) : null;
    },
    cancel(userId: string, id: string) {
      const job = jobs.get(id);
      if (!job || job.userId !== userId) return false;
      if (isActive(job)) { job.status = 'cancelled'; job.controller.abort(); job.run = undefined; }
      return true;
    },
  };
}
