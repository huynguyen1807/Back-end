import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { isValidObjectId } from 'mongoose';
import cloudinary from '../config/cloudinary';
import { ScanResult } from '../models/scanResult.model';
import { FoodItem } from '../models/foodItem.model';
import { FoodCategory } from '../models/foodCategory.model';
import { StorageLocation } from '../models/storageLocation.model';
import { buildOwnerQuery, createFoodItem, getInventoryOwnerContext } from './foodService';
import { boxToPixels, cleanBoundingBox, duplicateKey, parseCalendarDate } from '../utils/scanBatchValidation';
import { FoodState, getStorageGuidance } from '../utils/storageGuidance';

export class ScanBatchError extends Error { constructor(message: string, public status = 400) { super(message); } }
const ownerLocks = new Map<string, Promise<unknown>>();
async function withOwnerLock<T>(key: string, operation: () => Promise<T>) {
  const previous = ownerLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  ownerLocks.set(key, next);
  try { return await next; } finally { if (ownerLocks.get(key) === next) ownerLocks.delete(key); }
}
export async function ownedScan(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new ScanBatchError('Không tìm thấy lô quét.', 404);
  const scan = await ScanResult.findOne({ _id: id, userId });
  if (!scan) throw new ScanBatchError('Không tìm thấy lô quét.', 404);
  try { await getInventoryOwnerContext(userId, scan.ownerType ?? 'USER', scan.householdId ? String(scan.householdId) : undefined); }
  catch { throw new ScanBatchError('Bạn không còn quyền truy cập kho của lô này.', 403); }
  return scan;
}

export async function attachScanImage(userId: string, id: string, buffer: Buffer) {
  const scan = await ownedScan(userId, id);
  if (!scan.imageSha256 || scan.imageSha256 !== createHash('sha256').update(buffer).digest('hex')) throw new ScanBatchError('Ảnh không khớp lượt quét. Vui lòng quét lại ảnh đã chọn.');
  if (!scan.imageUrl) {
    const asset = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        public_id: `freshfriends/scans/${userId}/${id}`, resource_type: 'image', overwrite: false, timeout: 45_000,
      }, (error, result) => error ? reject(error) : result ? resolve(result) : reject(new Error('No uploaded image')));
      Readable.from(buffer).pipe(stream);
    });
    scan.imageUrl = asset.secure_url; scan.imagePublicId = asset.public_id;
    scan.imageWidth = asset.width; scan.imageHeight = asset.height; scan.imageVersion = asset.version;
    await scan.save();
  }
  return { imageUrl: scan.imageUrl, width: scan.imageWidth, height: scan.imageHeight };
}

export async function scanReviewData(userId: string, id: string) {
  const scan = await ownedScan(userId, id);
  const context = await getInventoryOwnerContext(userId, scan.ownerType ?? 'USER', scan.householdId ? String(scan.householdId) : undefined);
  const lockKey = context.ownerType === 'HOUSEHOLD' ? `household:${context.householdId}` : `user:${userId}`;
  return withOwnerLock(lockKey, async () => {
  const latestScan = await ownedScan(userId, id);
  const [categories, existing] = await Promise.all([
    FoodCategory.find({ isActive: true }).select('categoryName displayName').sort({ sortOrder: 1 }).lean(),
    FoodItem.find({ ...buildOwnerQuery(context), isDeleted: false, isConsumed: false, quantity: { $gt: 0 } })
      .select('foodName categoryId quantity unit purchaseDate containerLabel scanResultId scanItemKey expiryDate expiryBasis storageStartedAt foodState packaging imageBoundingBox').lean(),
  ]);
  return { categories, existing, purchaseDate: latestScan.purchaseDate ? new Date(latestScan.purchaseDate).toISOString().slice(0, 10) : undefined };
  });
}

type SavedRow = { clientItemId: string; status: 'saved' | 'duplicate' | 'failed'; item?: any; alreadySaved?: boolean; message?: string; duplicates?: any[] };
export async function saveScanBatch(userId: string, id: string, body: any) {
  const scan = await ownedScan(userId, id);
  const context = await getInventoryOwnerContext(userId, scan.ownerType ?? 'USER', scan.householdId ? String(scan.householdId) : undefined);
  const purchase = parseCalendarDate(body.purchaseDate);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (!purchase || body.purchaseDate > today) throw new ScanBatchError('Ngày mua phải hợp lệ và không nằm trong tương lai.');
  if (!['SUPERMARKET', 'MARKET'].includes(body.sourceType)) throw new ScanBatchError('Vui lòng chọn nơi mua.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 48) throw new ScanBatchError('Chọn từ 1 đến 48 món / phần để lưu.');
  if (!scan.imageUrl) throw new ScanBatchError('Ảnh tổng chưa được lưu. Hãy thử lưu lại.');
  const keys = body.items.map((item: any) => item?.clientItemId);
  if (keys.some((key: any) => typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(key)) || new Set(keys).size !== keys.length) throw new ScanBatchError('Mã món không hợp lệ hoặc bị lặp trong yêu cầu.');
  const lockKey = context.ownerType === 'HOUSEHOLD' ? `household:${context.householdId}` : `user:${userId}`;
  return withOwnerLock(lockKey, async () => {
    const currentScan = await ownedScan(userId, id);
    if (currentScan.purchaseDate && new Date(currentScan.purchaseDate).toISOString().slice(0, 10) !== body.purchaseDate) throw new ScanBatchError(`Lô này đã lưu với ngày mua ${new Date(currentScan.purchaseDate).toISOString().slice(0, 10)}. Giữ ngày đó để lưu tiếp những món còn lại.`);
    const inventory: any[] = await FoodItem.find({ ...buildOwnerQuery(context), isDeleted: false, isConsumed: false, quantity: { $gt: 0 } }).lean();
    const sources = new Map<string, any>([[id, currentScan]]);
    const results: SavedRow[] = [];
    for (const draft of body.items) {
      const clientItemId = draft.clientItemId;
      const provenanceQuery = { createdBy: userId, scanResultId: id, scanItemKey: clientItemId };
      const existingSaved = await FoodItem.findOne(provenanceQuery).populate('categoryId', 'categoryName displayName').populate('storageLocationId', 'storageName storageType');
      if (existingSaved) { results.push({ clientItemId, status: 'saved', item: existingSaved, alreadySaved: true }); continue; }
      try {
        const name = typeof draft.foodName === 'string' ? draft.foodName.trim() : '';
        const quantity = Number(draft.quantity), expiry = parseCalendarDate(draft.expiryDate), stored = parseCalendarDate(draft.storageStartedAt);
        if (!name || name.length > 160 || !isValidObjectId(draft.categoryId)) throw new ScanBatchError('Bổ sung tên và danh mục của món.');
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000 || !['kg', 'g', 'ml', 'l', 'quả', 'cái'].includes(draft.unit)) throw new ScanBatchError('Số lượng hoặc đơn vị không hợp lệ.');
        if (!['RAW', 'COOKED', 'UNKNOWN'].includes(draft.foodState) || !['SEALED', 'OPENED', 'PORTIONED', 'UNKNOWN'].includes(draft.packaging)) throw new ScanBatchError('Kiểm tra trạng thái và bao gói của món.');
        if (!['REFRIGERATOR', 'FREEZER', 'OUTSIDE', 'PANTRY', 'KITCHEN_CABINET'].includes(draft.storageType)) throw new ScanBatchError('Chọn nơi bảo quản hợp lệ.');
        if (!expiry || !stored || stored < purchase || draft.storageStartedAt > today || expiry < stored) throw new ScanBatchError('Kiểm tra ngày mua, ngày bắt đầu bảo quản và mốc ngày.');
        if (!['REFERENCE', 'PACKAGE', 'USER'].includes(draft.expiryBasis)) throw new ScanBatchError('Chọn nguồn ngày: bao bì, tự nhập hoặc tham khảo.');
        const packageExpiryDate = draft.expiryBasis === 'PACKAGE' ? expiry : draft.packageExpiryDate ? parseCalendarDate(draft.packageExpiryDate) : null;
        if (draft.packageExpiryDate && !packageExpiryDate) throw new ScanBatchError('Ngày trên bao bì không hợp lệ.');
        if (draft.expiryBasis === 'REFERENCE' && packageExpiryDate && expiry > packageExpiryDate) throw new ScanBatchError('Đã có hạn bao bì sớm hơn. Gợi ý không được tự kéo dài ngày này; kiểm tra hướng dẫn của nhà sản xuất.');
        const guide = getStorageGuidance(name, draft.foodState as FoodState, draft.storageType, { storageProfile: draft.storageProfile, packaging: draft.packaging });
        if (draft.expiryBasis === 'REFERENCE') {
          if (!guide) throw new ScanBatchError('Chưa có hướng dẫn phù hợp. Hãy nhập ngày theo bao bì hoặc tự xác nhận.');
          const days = Math.round((expiry.getTime() - (guide.dateAnchor === 'PURCHASE' ? purchase : stored).getTime()) / 86400000);
          if (days < guide.minDays || days > guide.maxDays) throw new ScanBatchError('Mốc tham khảo không khớp điều kiện hiện tại. Áp dụng lại gợi ý hoặc chọn ngày tự nhập.');
        }
        const containerLabel = typeof draft.containerLabel === 'string' ? draft.containerLabel.trim().slice(0, 80) : '';
        const duplicates = inventory.filter((food) => duplicateKey(food.foodName, String(food.categoryId)) === duplicateKey(name, draft.categoryId)
          && !(String(food.scanResultId) === id && food.containerLabel && containerLabel && food.containerLabel !== containerLabel));
        if (duplicates.length && draft.duplicateDecision !== 'NEW_LOT') {
          results.push({ clientItemId, status: 'duplicate', message: 'Kho đã có món tương tự. Xác nhận đây là lô mới hoặc bỏ chọn để tránh thêm trùng.', duplicates: duplicates.map((food) => ({ _id: food._id, foodName: food.foodName, quantity: food.quantity, unit: food.unit, containerLabel: food.containerLabel, purchaseDate: food.purchaseDate })) });
          continue;
        }
        const sourceId = typeof draft.sourceScanId === 'string' ? draft.sourceScanId : id;
        let source = sources.get(sourceId);
        if (!source) {
          source = await ownedScan(userId, sourceId);
          if (source.ownerType !== currentScan.ownerType || String(source.householdId ?? '') !== String(currentScan.householdId ?? '')) throw new ScanBatchError('Ảnh bổ sung thuộc kho khác.');
          sources.set(sourceId, source);
        }
        if (!source.imageUrl) throw new ScanBatchError('Ảnh nguồn của món chưa được lưu. Hãy thử lại.');
        let imageUrl: string | undefined;
        const box = cleanBoundingBox(draft.boundingBox);
        if (draft.imageMode !== 'NONE') {
          if (!box || !source.imagePublicId || !source.imageWidth || !source.imageHeight) throw new ScanBatchError('Chọn vùng ảnh đúng món hoặc chọn không dùng ảnh riêng.');
          const pixels = boxToPixels(box, source.imageWidth, source.imageHeight);
          imageUrl = cloudinary.url(source.imagePublicId, { secure: true, resource_type: 'image', version: source.imageVersion,
            transformation: [{ crop: 'crop', gravity: 'north_west', ...pixels }, { crop: 'limit', width: 640, height: 640, quality: 'auto', fetch_format: 'auto' }] });
        }
        let location = await StorageLocation.findOne({ ...buildOwnerQuery(context), storageType: draft.storageType, isActive: true }).sort({ isDefault: -1 });
        if (!location) location = await StorageLocation.create({ ...buildOwnerQuery(context), storageType: draft.storageType, storageName: ({ REFRIGERATOR: 'Tủ lạnh', FREEZER: 'Ngăn đông', OUTSIDE: 'Bên ngoài', PANTRY: 'Tủ khô', KITCHEN_CABINET: 'Tủ bếp' } as Record<string, string>)[draft.storageType], isDefault: true, isActive: true });
        const item = await createFoodItem(userId, {
          foodName: name, categoryId: draft.categoryId, storageLocationId: String(location._id), imageUrl,
          sourceType: body.sourceType, expiryType: draft.expiryBasis === 'PACKAGE' ? 'SCANNED' : 'MANUAL',
          purchaseDate: body.purchaseDate, expiryDate: draft.expiryDate, quantity, unit: draft.unit,
        }, context.ownerType, context.householdId ? String(context.householdId) : undefined, { allowCategoryAi: false, provenance: {
          scanResultId: id, scanItemKey: clientItemId, originalImageUrl: currentScan.imageUrl,
          imageSourceScanId: sourceId, itemSourceImageUrl: source.imageUrl, imageBoundingBox: draft.imageMode === 'NONE' ? undefined : box,
          containerLabel, foodState: draft.foodState, packaging: draft.packaging, storageProfile: typeof draft.storageProfile === 'string' ? draft.storageProfile.slice(0, 40) : undefined, storageStartedAt: stored,
          expiryBasis: draft.expiryBasis, packageExpiryDate: packageExpiryDate ?? undefined, storageGuide: draft.expiryBasis === 'REFERENCE' ? guide : undefined,
        } });
        inventory.push({ ...(item as any), categoryId: draft.categoryId, scanResultId: id, containerLabel });
        results.push({ clientItemId, status: 'saved', item });
      } catch (error: any) {
        // A response/enrichment failure after insertion must never create a second
        // inventory item when the user retries the same scan row.
        const recovered = await FoodItem.findOne(provenanceQuery).populate('categoryId', 'categoryName displayName').populate('storageLocationId', 'storageName storageType');
        if (recovered) { results.push({ clientItemId, status: 'saved', item: recovered, alreadySaved: true }); continue; }
        results.push({ clientItemId, status: 'failed', message: error instanceof ScanBatchError ? error.message : 'Chưa lưu được món này. Kiểm tra thông tin hoặc thử lại.' });
      }
    }
    if (results.some((row) => row.status === 'saved') && !currentScan.purchaseDate) { currentScan.purchaseDate = purchase; await currentScan.save(); }
    return { results, savedCount: results.filter((row) => row.status === 'saved').length };
  });
}
