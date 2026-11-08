import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { attachScanImage, saveScanBatch, scanReviewData, ScanBatchError } from '../services/scanBatchService';
import { getStorageAdvice } from '../utils/storageGuidance';

const fail = (res: Response, error: unknown) => res.status(error instanceof ScanBatchError ? error.status : 500).json({ message: error instanceof ScanBatchError ? error.message : 'Chưa xử lý được lô quét. Vui lòng thử lại.' });
export async function uploadScanImage(req: AuthRequest, res: Response) {
  try {
    if (!req.file) throw new ScanBatchError('Vui lòng gửi ảnh đã dùng để quét.');
    res.json(await attachScanImage(req.user!.userId, String(req.params.id), req.file.buffer));
  } catch (error) { fail(res, error); }
}
export async function getScanReviewData(req: AuthRequest, res: Response) {
  try { res.json(await scanReviewData(req.user!.userId, String(req.params.id))); } catch (error) { fail(res, error); }
}
export async function saveScanItems(req: AuthRequest, res: Response) {
  try { res.json(await saveScanBatch(req.user!.userId, String(req.params.id), req.body)); } catch (error) { fail(res, error); }
}
export function storageGuidance(req: AuthRequest, res: Response) {
  const { foodName, foodState, storageType, storageProfile, packaging } = req.body ?? {};
  if (typeof foodName !== 'string' || foodName.length > 160 || !['RAW', 'COOKED', 'UNKNOWN'].includes(foodState) || typeof storageType !== 'string') { res.status(400).json({ message: 'Kiểm tra tên, trạng thái và nơi bảo quản.' }); return; }
  res.json(getStorageAdvice(foodName, foodState, storageType, { storageProfile, packaging }));
}
