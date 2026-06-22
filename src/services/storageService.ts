import { StorageLocation } from '../models/storageLocation.model';
import { StorageRule } from '../models/storageRule.model';
import { FoodItem } from '../models/foodItem.model';

// ─── GET storage locations của user ──────────────────────────────────────────
export async function getStorageLocations(userId: string) {
  return StorageLocation.find({ ownerType: 'USER', userId, isActive: true }).sort({ isDefault: -1, storageName: 1 });
}

// ─── CREATE storage location ──────────────────────────────────────────────────
export async function createStorageLocation(userId: string, data: any) {
  const { storageName, storageType, description, isDefault } = data;

  if (!storageName || !storageType) throw new Error('storageName and storageType are required');

  // Nếu đặt default, unset default cũ
  if (isDefault) {
    await StorageLocation.updateMany({ userId, ownerType: 'USER' }, { isDefault: false });
  }

  return StorageLocation.create({
    ownerType: 'USER',
    userId,
    storageName: storageName.trim(),
    storageType,
    description,
    isDefault: isDefault ?? false,
    isActive: true,
  });
}

// ─── UPDATE storage location ──────────────────────────────────────────────────
export async function updateStorageLocation(locationId: string, userId: string, data: any) {
  const loc = await StorageLocation.findOne({ _id: locationId, userId, isActive: true });
  if (!loc) throw new Error('Storage location not found');

  if (data.isDefault) {
    await StorageLocation.updateMany({ userId, ownerType: 'USER' }, { isDefault: false });
  }

  return StorageLocation.findByIdAndUpdate(locationId, data, { new: true });
}

// ─── DELETE storage location ──────────────────────────────────────────────────
export async function deleteStorageLocation(locationId: string, userId: string) {
  const loc = await StorageLocation.findOne({ _id: locationId, userId, isActive: true });
  if (!loc) throw new Error('Storage location not found');

  // Check nếu có food items đang dùng location này
  const usageCount = await FoodItem.countDocuments({
    storageLocationId: locationId,
    isDeleted: false,
    isConsumed: false,
  });

  if (usageCount > 0) {
    throw new Error(`Cannot delete: ${usageCount} food item(s) are using this location`);
  }

  await StorageLocation.findByIdAndUpdate(locationId, { isActive: false });
  return { message: 'Storage location deleted' };
}

// ─── STORAGE SUGGESTION ───────────────────────────────────────────────────────
// Gợi ý vị trí lưu trữ tốt nhất cho 1 food item dựa vào categoryId
export async function getStorageSuggestion(userId: string, categoryId: string) {
  // Lấy tất cả storage rules của category này, ưu tiên rule có priority cao nhất
  const rules = await StorageRule.find({ categoryId, status: 'OFFICIAL' })
    .populate('categoryId', 'categoryName')
    .sort({ priority: -1, estimatedDays: -1 });

  if (!rules.length) {
    return { suggestion: null, message: 'No storage rules found for this category' };
  }

  // Lấy locations của user
  const userLocations = await StorageLocation.find({ userId, ownerType: 'USER', isActive: true });

  // Map từ storageType → user locations
  const suggestions = rules
    .map((rule) => {
      const matchedLocations = userLocations.filter((loc) => loc.storageType === rule.storageType);
      return {
        storageType: rule.storageType,
        estimatedDays: rule.estimatedDays,
        instruction: rule.instruction,
        warningMessage: rule.warningMessage,
        matchedLocations,
      };
    })
    .filter((s) => s.matchedLocations.length > 0); // chỉ gợi ý vị trí user đang có

  const bestRule = rules[0]; // rule ưu tiên cao nhất

  return {
    categoryId,
    bestStorageType: bestRule.storageType,
    estimatedDays: bestRule.estimatedDays,
    instruction: bestRule.instruction,
    warningMessage: bestRule.warningMessage,
    suggestions,
  };
}
