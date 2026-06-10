import dotenv from 'dotenv';

import app from './app';
import { connectDatabase } from './config/database';

dotenv.config();

const port = Number(process.env.PORT ?? 4000);

async function bootstrap() {
  try {
    await connectDatabase();

    app.listen(port, () => {
      console.log(`Backend server running on port ${port}`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Backend startup failed: ${message}`);
    process.exit(1);
  }
}

void bootstrap();
