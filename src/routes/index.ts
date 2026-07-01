import { Router } from 'express';

import healthRouter from './health';
import authRouter from './authRoutes';
import userRouter from './userRoutes';
import subscriptionRouter from './subscriptionRoutes';
import foodRouter from './foodRoutes';
import storageRouter from './storageRoutes';
import householdRouter from './householdRoutes';
import recipeRouter from './recipeRoutes';
import mealPlanRouter from './mealPlanRoutes';
import nutritionRouter from './nutritionRoutes';
import adminRouter from './adminRoutes';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/subscriptions', subscriptionRouter);
apiRouter.use('/foods', foodRouter);
apiRouter.use('/recipes', recipeRouter);
apiRouter.use('/meal-plans', mealPlanRouter);
apiRouter.use('/nutrition', nutritionRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/storage-locations', storageRouter);
apiRouter.use('/storage', storageRouter);
apiRouter.use('/households', householdRouter);

export default apiRouter;
