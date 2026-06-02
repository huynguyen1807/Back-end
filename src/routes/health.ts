import { Router } from 'express';

const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'backend',
    version: '1.0.0'
  });
});

export default healthRouter;
