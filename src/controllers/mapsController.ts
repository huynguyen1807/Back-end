import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import { getDirections, getNearbyStores } from '../services/mapsService';

function handleMapsError(res: Response, error: any) {
  const message = error?.message ?? 'Map service error';
  const isInputError = message.includes('must contain');
  const isMissingKey = message.includes('not configured');
  res.status(isInputError ? 400 : isMissingKey ? 503 : 502).json({ success: false, message });
}

export const getNearbyStoresHandler = async (req: AuthRequest, res: Response) => {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const radius = req.query.radius ? Number(req.query.radius) : 2000;
    const stores = await getNearbyStores({ latitude, longitude }, radius);
    res.json({ success: true, data: stores });
  } catch (error) {
    handleMapsError(res, error);
  }
};

export const getDirectionsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const route = await getDirections(req.body.from, req.body.to);
    res.json({ success: true, data: route });
  } catch (error) {
    handleMapsError(res, error);
  }
};
