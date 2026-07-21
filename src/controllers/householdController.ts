import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  acceptHouseholdInvitation,
  addHouseholdMember,
  cancelHouseholdInvitation,
  createHousehold,
  deleteHousehold,
  getHouseholdInvitations,
  getHouseholdMembers,
  getMyHouseholds,
  getMyHouseholdInvitations,
  rejectHouseholdInvitation,
  removeHouseholdMember,
  updateHouseholdMember
} from '../services/householdService';

function getStatusCode(message: string) {
  if (message.includes('required') || message.includes('invalid') || message.includes('must be')) {
    return 400;
  }

  if (message.includes('not found')) {
    return 404;
  }

  if (message.includes('expired')) {
    return 410;
  }

  if (message.includes('requires') || message.includes('limit reached')) {
    return 403;
  }

  if (
    message.includes('permission') ||
    message.includes('not a member') ||
    message.includes('Only owner') ||
    message.includes('cannot remove')
  ) {
    return 403;
  }

  if (message.includes('already') || message.includes('pending')) {
    return 409;
  }

  return 500;
}

function handleHouseholdError(res: Response, error: any) {
  const message =
    error.code === 11000
      ? 'User is already a household member'
      : error.message ?? 'Server error';
  const status = getStatusCode(message);
  res.status(status).json({ success: false, message });
}

export const createHouseholdHandler = async (req: AuthRequest, res: Response) => {
  try {
    const household = await createHousehold(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: household });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const getMyHouseholdsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const households = await getMyHouseholds(req.user!.userId);
    res.json({ success: true, data: households });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const deleteHouseholdHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteHousehold(req.params.id as string, req.user!.userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const getHouseholdMembersHandler = async (req: AuthRequest, res: Response) => {
  try {
    const members = await getHouseholdMembers(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: members });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const addHouseholdMemberHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await addHouseholdMember(req.params.id as string, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const getHouseholdInvitationsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const invitations = await getHouseholdInvitations(req.params.id as string, req.user!.userId);
    res.json({ success: true, data: invitations });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const getMyHouseholdInvitationsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const invitations = await getMyHouseholdInvitations(req.user!.userId);
    res.json({ success: true, data: invitations });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const acceptHouseholdInvitationHandler = async (req: AuthRequest, res: Response) => {
  try {
    const member = await acceptHouseholdInvitation(
      req.user!.userId,
      req.params.invitationId as string
    );

    res.status(201).json({ success: true, data: member });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const rejectHouseholdInvitationHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await rejectHouseholdInvitation(
      req.user!.userId,
      req.params.invitationId as string
    );

    res.json({ success: true, ...result });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const cancelHouseholdInvitationHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await cancelHouseholdInvitation(
      req.params.id as string,
      req.user!.userId,
      req.params.invitationId as string
    );

    res.json({ success: true, ...result });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const updateHouseholdMemberHandler = async (req: AuthRequest, res: Response) => {
  try {
    const member = await updateHouseholdMember(
      req.params.id as string,
      req.user!.userId,
      req.params.memberId as string,
      req.body
    );

    res.json({ success: true, data: member });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};

export const removeHouseholdMemberHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await removeHouseholdMember(
      req.params.id as string,
      req.user!.userId,
      req.params.memberId as string
    );

    res.json({ success: true, ...result });
  } catch (error: any) {
    handleHouseholdError(res, error);
  }
};
