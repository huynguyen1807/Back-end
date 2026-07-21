import { Router } from 'express';

import healthRouter from './health';
import authRouter from './authRoutes';
import userRouter from './userRoutes';
import subscriptionRouter from './subscriptionRoutes';
import foodRouter from './foodRoutes';
import storageRouter from './storageRoutes';
import aiRouter from './aiRoutes';
import notificationRouter from './notificationRoutes';
import householdRouter from './householdRoutes';
import recipeRouter from './recipeRoutes';
import mealPlanRouter from './mealPlanRoutes';
import nutritionRouter from './nutritionRoutes';
import adminRouter from './adminRoutes';
import shoppingListRouter from './shoppingListRoutes';
import paymentRouter from './paymentRoutes';
import uploadRouter from './uploadRoutes';
import mapsRouter from './mapsRoutes';

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
apiRouter.use('/shopping-lists', shoppingListRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/maps', mapsRouter);
apiRouter.use('/storage-locations', storageRouter);
apiRouter.use('/storage', storageRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/households', householdRouter);
apiRouter.use('/upload', uploadRouter);

export default apiRouter;
