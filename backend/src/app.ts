import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/index.js';
import { logger } from './utils/index.js';
import { redis } from './queues/index.js';
import { registerAutomationSubscribers } from './automation/index.js';

// Routes
import { healthRoutes } from './routes/health.route.js';
import { clientRoutes } from './routes/clients.route.js';
import { bookingRoutes } from './routes/booking.route.js';
import { crmRoutes } from './routes/crm.route.js';
import { retellFunctionRoutes } from './routes/functions/retell-functions.route.js';
import { provisioningRoutes } from './routes/provisioning.route.js';
import { retellWebhookDispatcher } from './routes/webhooks/retell-dispatcher.route.js';
import { callStartedRoute } from './routes/webhooks/call-started.route.js';
import { callEndedRoute } from './routes/webhooks/call-ended.route.js';
import { transcriptRoute } from './routes/webhooks/transcript.route.js';
import { summaryRoute } from './routes/webhooks/summary.route.js';
import { authRoutes } from './dashboard-api/auth.route.js';
import { analyticsRoutes } from './dashboard-api/analytics.route.js';
import { adminRoutes } from './dashboard-api/admin.route.js';
import { userRoutes } from './dashboard-api/users.route.js';

export async function buildApp() {
  // Wire post-call automation (lead recovery, missed-call, confirmations) to events.
  registerAutomationSubscribers();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Security
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? ['https://dashboard.gravvia.com']
      : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    redis,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  // Capture the raw request body so webhook HMAC signatures can be verified
  // against the exact bytes the provider signed (re-serializing the parsed
  // body would change key order/whitespace and break verification).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // Error handler. Fastify 5 types the error param as `unknown`; annotate it as
  // FastifyError so statusCode/message are available.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Request error');
    if (error.statusCode) {
      reply.code(error.statusCode).send({ error: error.message });
    } else {
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(clientRoutes);
  await app.register(bookingRoutes);
  await app.register(crmRoutes);
  await app.register(retellFunctionRoutes);
  await app.register(provisioningRoutes);
  await app.register(retellWebhookDispatcher);
  await app.register(callStartedRoute);
  await app.register(callEndedRoute);
  await app.register(transcriptRoute);
  await app.register(summaryRoute);
  await app.register(analyticsRoutes);
  await app.register(adminRoutes);
  await app.register(userRoutes);

  return app;
}
