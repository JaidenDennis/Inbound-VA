import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { writeAuditLog } from '../services/index.js';
import type { User } from '../types/index.js';

// bcryptjs is a pure JS impl – add to package.json
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Tight per-route rate limit so credential stuffing / brute force on the only
  // unauthenticated endpoint is throttled per IP (the global limiter is looser).
  app.post('/auth/login', {
    config: {
      rateLimit: {
        max: env.AUTH_RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW_MS,
      },
    },
  }, async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);
    // Users are always stored with a lowercased email (see UserService.create),
    // so normalize the input to keep login case-insensitive.
    const normalizedEmail = email.trim().toLowerCase();

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, (user as User & { password_hash: string }).password_hash);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        clientId: user.client_id,
      },
      { expiresIn: '7d' }
    );

    // Update last login
    await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

    await writeAuditLog({ userId: user.id, action: 'auth.login', ipAddress: request.ip });

    reply.send({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  });

  app.get('/auth/me', {
    preHandler: async (req, reply) => {
      try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
    },
    handler: async (request, reply) => {
      const payload = request.user as { sub: string };
      const { data: user } = await supabase.from('users').select('id,email,name,role,client_id').eq('id', payload.sub).single();
      reply.send(user);
    },
  });
}
