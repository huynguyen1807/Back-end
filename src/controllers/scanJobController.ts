import { Response } from 'express';
import { createHash } from 'node:crypto';
import { AuthRequest } from '../middleware/authMiddleware';
import { ScanResult } from '../models/scanResult.model';
import { recognizeFoodsFromImage } from '../services/scanRecognitionService';
import { createScanJobManager, ScanJobError } from '../services/scanJobManager';

const scanJobs = createScanJobManager<Awaited<ReturnType<typeof recognizeFoodsFromImage>> & { scanResultId: string; capturedAt: string }>();

export function createScanJob(req: AuthRequest, res: Response) {
  if (!req.user) { res.status(401).json({ message: 'Unauthorized' }); return; }
  if (!req.file) { res.status(400).json({ message: 'Vui lòng chọn một ảnh thực phẩm.' }); return; }
  const userId = req.user.userId;
  const imageBuffer = req.file.buffer;
  const mimeType = req.file.mimetype;
  const ownerType = typeof req.query.ownerType === 'string' ? req.query.ownerType : undefined;
  const householdId = typeof req.query.householdId === 'string' ? req.query.householdId : undefined;
  try {
    const job = scanJobs.create(userId, async ({ signal, onStage }) => {
      const result = await recognizeFoodsFromImage({ userId, imageBuffer, mimeType, ownerType, householdId, signal, onStage });
      signal.throwIfAborted();
      if (result.errorCode) throw new ScanJobError(result.warnings[0] || 'Chưa thể nhận diện ảnh.', result.errorCode, result.retryAfterSeconds);
      onStage('finishing');
      const first = result.foods[0];
      const audit = await ScanResult.create({
        userId, ownerType: result.inventoryContext.ownerType, householdId: result.inventoryContext.householdId,
        scanType: 'FOOD_IMAGE', productName: first?.productName, confidenceScore: first?.confidence ?? 0,
        status: !first ? 'NEED_MANUAL_INPUT' : result.foods.some((food) => food.confidence < 0.65) ? 'LOW_CONFIDENCE' : 'SUCCESS',
        categoryId: first?.categoryId, storageLocationId: first?.storageSuggestion.storageLocationId,
        warnings: result.warnings, rawResult: result, imageSha256: createHash('sha256').update(imageBuffer).digest('hex'),
      });
      signal.throwIfAborted();
      return { ...result, scanResultId: String(audit._id), capturedAt: new Date().toISOString() };
    });
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof ScanJobError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds ?? 5));
      res.status(429).json({ message: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds });
    } else res.status(500).json({ message: 'Chưa khởi tạo được lượt quét. Vui lòng thử lại.' });
  }
}

export function getScanJob(req: AuthRequest, res: Response) {
  if (!req.user) { res.status(401).json({ message: 'Unauthorized' }); return; }
  const job = scanJobs.get(req.user.userId, String(req.params.id));
  if (!job) { res.status(404).json({ message: 'Lượt quét đã hết hạn hoặc máy chủ vừa khởi động lại. Vui lòng quét lại.', code: 'SCAN_EXPIRED' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.json(job);
}

export function cancelScanJob(req: AuthRequest, res: Response) {
  if (!req.user) { res.status(401).json({ message: 'Unauthorized' }); return; }
  if (!scanJobs.cancel(req.user.userId, String(req.params.id))) { res.status(404).json({ message: 'Không tìm thấy lượt quét.' }); return; }
  res.status(204).end();
}
