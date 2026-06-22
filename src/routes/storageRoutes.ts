import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import {
  listStorageLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  storageSuggestion,
} from '../controllers/storageController';

const router = Router();

router.use(protect);

router.get('/suggestion', storageSuggestion);   // GET /api/storage/suggestion?categoryId=xxx
router.get('/', listStorageLocations);           // GET /api/storage-locations
router.post('/', createLocation);                // POST /api/storage-locations
router.put('/:id', updateLocation);              // PUT /api/storage-locations/:id
router.delete('/:id', deleteLocation);           // DELETE /api/storage-locations/:id

export default router;
