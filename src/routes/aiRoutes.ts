import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware';
import { createScanJob, getScanJob, cancelScanJob } from '../controllers/scanJobController';
import { scanReceipt } from '../controllers/receiptScanController';
import { getScanReviewData, saveScanItems, storageGuidance, uploadScanImage } from '../controllers/scanBatchController';
import {
  recognizeFoodController,
  predictExpiryController,
  storageSuggestionsController,
  mealSuggestionsController,
  nutritionInfoController,
  analyzeRecipeVideoController,
  personalizedMenuController
} from '../controllers/aiController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const aiRouter = Router();

// Protect all AI routes with authentication middleware
aiRouter.use(protect);

const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) callback(null, true);
    else callback(new Error('Vui lòng dùng ảnh JPEG, PNG hoặc WebP.'));
  },
});
const receiveScanImage: import('express').RequestHandler = (req, res, next) => {
  scanUpload.single('image')(req, res, (error) => {
    if (error) {
      res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 8 MB.' : error.message });
      return;
    }
    next();
  });
};

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'].includes(file.mimetype)) callback(null, true);
    else callback(new Error('Vui lòng dùng video MP4, MOV, WebM hoặc AVI.'));
  },
});
const receiveRecipeVideo: import('express').RequestHandler = (req, res, next) => {
  videoUpload.single('video')(req, res, (error) => {
    if (error) {
      res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Video quá lớn. Vui lòng chọn video nhỏ hơn 50 MB.' : error.message });
      return;
    }
    next();
  });
};
aiRouter.post('/scan-jobs', receiveScanImage, createScanJob);
aiRouter.post('/scan-receipt', receiveScanImage, scanReceipt);
aiRouter.get('/scan-jobs/:id', getScanJob);
aiRouter.delete('/scan-jobs/:id', cancelScanJob);
aiRouter.post('/scan-batches/:id/image', receiveScanImage, uploadScanImage);
aiRouter.get('/scan-batches/:id/review', getScanReviewData);
aiRouter.post('/scan-batches/:id/items', saveScanItems);
aiRouter.post('/storage-guidance', storageGuidance);

aiRouter.post('/recognize-food', upload.single('image'), recognizeFoodController);
aiRouter.post('/predict-expiry', predictExpiryController);
aiRouter.post('/storage-suggestions', storageSuggestionsController);
aiRouter.post('/meal-suggestions', mealSuggestionsController);
aiRouter.post('/nutrition-info', nutritionInfoController);
aiRouter.post('/analyze-recipe-video', receiveRecipeVideo, analyzeRecipeVideoController);
aiRouter.post('/personalized-menu', personalizedMenuController);

export default aiRouter;
