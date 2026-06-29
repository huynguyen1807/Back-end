import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  addHouseholdMember,
  createHousehold,
  getHouseholdMembers,
  getMyHouseholds,
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

  if (
    message.includes('permission') ||
    message.includes('not a member') ||
    message.includes('Only owner') ||
    message.includes('cannot remove')
  ) {
    return 403;
  }

  if (message.includes('already')) {
    return 409;
  }

  return 500;
}

function handleHouseholdError(res: Response, error: any) {
  const message = error.message ?? 'Server error';
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
