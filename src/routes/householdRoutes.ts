import { Router } from 'express';

import {
  addHouseholdMemberHandler,
  createHouseholdHandler,
  getHouseholdMembersHandler,
  getMyHouseholdsHandler,
  removeHouseholdMemberHandler,
  updateHouseholdMemberHandler
} from '../controllers/householdController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.post('/', createHouseholdHandler);
router.get('/me', getMyHouseholdsHandler);
router.post('/:id/members', addHouseholdMemberHandler);
router.get('/:id/members', getHouseholdMembersHandler);
router.patch('/:id/members/:memberId', updateHouseholdMemberHandler);
router.delete('/:id/members/:memberId', removeHouseholdMemberHandler);

export default router;