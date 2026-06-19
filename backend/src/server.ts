import { buildApp } from './app.js';
import { env } from './config/index.js';
import { logger } from './utils/index.js';

async function start(): Promise<void> {
  const app = await buildApp();

  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await app.close();
    logger.info('Server closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Gravvia Engage API started');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
