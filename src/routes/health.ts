import { Router } from 'express';

import { getDatabaseStatus } from '../config/database';

const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  const database = getDatabaseStatus();

  response.json({
    status: database.state === 'connected' ? 'ok' : 'degraded',
    service: 'backend',
    version: '1.0.0',
    database
  });
});

export default healthRouter;
