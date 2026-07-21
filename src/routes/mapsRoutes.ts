import { Router } from 'express';

import { getDirectionsHandler, getNearbyStoresHandler } from '../controllers/mapsController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);
router.get('/nearby-stores', getNearbyStoresHandler);
router.post('/directions', getDirectionsHandler);

export default router;
