import { Router } from 'express';

import healthRouter from './health';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);

export default apiRouter;
