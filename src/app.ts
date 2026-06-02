import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import apiRouter from './routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api', apiRouter);

app.get('/', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'backend',
    docs: '/api/health'
  });
});

export default app;
