import { Router } from 'express';

import {
  acceptHouseholdInvitationHandler,
  addHouseholdMemberHandler,
  cancelHouseholdInvitationHandler,
  createHouseholdHandler,
  getHouseholdInvitationsHandler,
  getHouseholdMembersHandler,
  getMyHouseholdInvitationsHandler,
  getMyHouseholdsHandler,
  rejectHouseholdInvitationHandler,
  removeHouseholdMemberHandler,
  updateHouseholdMemberHandler
} from '../controllers/householdController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.post('/', createHouseholdHandler);
router.get('/me', getMyHouseholdsHandler);
router.get('/invitations/me', getMyHouseholdInvitationsHandler);
router.post('/invitations/:invitationId/accept', acceptHouseholdInvitationHandler);
router.post('/invitations/:invitationId/reject', rejectHouseholdInvitationHandler);
router.post('/:id/members', addHouseholdMemberHandler);
router.get('/:id/members', getHouseholdMembersHandler);
router.get('/:id/invitations', getHouseholdInvitationsHandler);
router.delete('/:id/invitations/:invitationId', cancelHouseholdInvitationHandler);
router.patch('/:id/members/:memberId', updateHouseholdMemberHandler);
router.delete('/:id/members/:memberId', removeHouseholdMemberHandler);

export default router;
