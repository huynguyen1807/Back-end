import { createHash } from 'node:crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { ScanResult } from '../models/scanResult.model';
import { getInventoryOwnerContext } from '../services/foodService';
import { recognizeReceipt, ReceiptScanError } from '../services/receiptRecognitionService';

export async function scanReceipt(req: AuthRequest, res: Response) {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ message: 'Vui lòng gửi ảnh hóa đơn.' });
    return;
  }

  try {
    const userId = req.user.userId;
    const ownerType = typeof req.query.ownerType === 'string' ? req.query.ownerType : undefined;
    const householdId = typeof req.query.householdId === 'string' ? req.query.householdId : undefined;
    const context = await getInventoryOwnerContext(userId, ownerType, householdId);
    const receipt = await recognizeReceipt(req.file.buffer, req.file.mimetype);
    if (!receipt.items.length) {
      res.status(422).json({ message: 'Chưa tìm thấy dòng thực phẩm trên hóa đơn. Hãy thử ảnh rõ hơn hoặc thêm món thủ công.' });
      return;
    }

    const scan = await ScanResult.create({
      userId,
      ownerType: context.ownerType,
      householdId: context.householdId,
      scanType: 'FOOD_IMAGE',
      status: receipt.items.some((item) => item.confidence < 0.65) ? 'LOW_CONFIDENCE' : 'SUCCESS',
      purchaseDate: receipt.purchaseDate ? new Date(`${receipt.purchaseDate}T00:00:00+07:00`) : undefined,
      confidenceScore: receipt.items.reduce((sum, item) => sum + item.confidence, 0) / receipt.items.length,
      imageSha256: createHash('sha256').update(req.file.buffer).digest('hex'),
      rawResult: { source: 'RECEIPT_OCR', itemCount: receipt.items.length },
    });

    res.status(201).json({
      scanResultId: String(scan._id),
      capturedAt: new Date().toISOString(),
      purchaseDate: receipt.purchaseDate,
      inventoryContext: {
        ownerType: context.ownerType,
        householdId: context.householdId ? String(context.householdId) : undefined,
      },
      warnings: receipt.items.some((item) => item.confidence < 0.65)
        ? ['Một số dòng hóa đơn chưa rõ. Vui lòng kiểm tra tên và số lượng trước khi lưu.']
        : [],
      items: receipt.items,
    });
  } catch (error) {
    const status = error instanceof ReceiptScanError ? error.status : 500;
    res.status(status).json({
      message: error instanceof ReceiptScanError
        ? error.message
        : 'Chưa xử lý được hóa đơn. Vui lòng thử lại.',
    });
  }
}
