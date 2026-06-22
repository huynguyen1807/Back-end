import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  getStorageLocations,
  createStorageLocation,
  updateStorageLocation,
  deleteStorageLocation,
  getStorageSuggestion,
} from '../services/storageService';

// GET /api/storage-locations
export const listStorageLocations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const locations = await getStorageLocations(userId);
    res.json({ success: true, data: locations });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/storage-locations
export const createLocation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const location = await createStorageLocation(userId, req.body);
    res.status(201).json({ success: true, data: location });
  } catch (error: any) {
    const status = error.message.includes('required') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// PUT /api/storage-locations/:id
export const updateLocation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const location = await updateStorageLocation(req.params.id as string, userId, req.body);
    res.json({ success: true, data: location });
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// DELETE /api/storage-locations/:id
export const deleteLocation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await deleteStorageLocation(req.params.id as string, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : error.message.includes('Cannot delete') ? 409 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

// GET /api/storage/suggestion?categoryId=xxx
export const storageSuggestion = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { categoryId } = req.query;

    if (!categoryId) {
      res.status(400).json({ success: false, message: 'categoryId is required' });
      return;
    }

    const suggestion = await getStorageSuggestion(userId, categoryId as string);
    res.json({ success: true, data: suggestion });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
