import 'dotenv/config';

import app from './app';
import { connectDatabase } from './config/database';

const port = Number(process.env.PORT ?? 4000);

async function bootstrap() {
  try {
    await connectDatabase();

    app.listen(port, '0.0.0.0', () => {
      console.log(`Backend server running on port ${port} (0.0.0.0)`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Backend startup failed: ${message}`);
    process.exit(1);
  }
}

void bootstrap();
