import 'dotenv/config';

import { verifyMailConnection } from '../config/mail';

async function main() {
  try {
    await verifyMailConnection();
    console.log('[SMTP] Connection and authentication succeeded.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SMTP error';
    console.error(`[SMTP] Verification failed: ${message}`);
    process.exitCode = 1;
  }
}

void main();
