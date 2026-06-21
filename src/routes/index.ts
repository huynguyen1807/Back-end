import { Router } from 'express';

import healthRouter from './health';
import authRouter from './authRoutes';
import userRouter from './userRoutes';
import subscriptionRouter from './subscriptionRoutes';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/subscriptions', subscriptionRouter);

export default apiRouter;
