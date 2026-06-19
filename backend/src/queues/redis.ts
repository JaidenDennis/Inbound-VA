import { Redis } from 'ioredis';
import { env } from '../config/index.js';
import { logger } from '../utils/index.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
