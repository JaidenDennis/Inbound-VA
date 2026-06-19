import pino from 'pino';
import { env } from '../config/index.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  base: { service: 'gravvia-backend' },
});
