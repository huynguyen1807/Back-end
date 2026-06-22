import { Router } from 'express';

import healthRouter from './health';
import authRouter from './authRoutes';
import userRouter from './userRoutes';
import subscriptionRouter from './subscriptionRoutes';
import foodRouter from './foodRoutes';
import storageRouter from './storageRoutes';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/subscriptions', subscriptionRouter);
apiRouter.use('/foods', foodRouter);
apiRouter.use('/storage-locations', storageRouter);
apiRouter.use('/storage', storageRouter);

export default apiRouter;
