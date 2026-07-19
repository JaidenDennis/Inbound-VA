import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { CrmConnection, GhlBlueprint, JwtPayload } from '../types/index.js';

// ── auth: real assertClientAccess, fake requirePermission driven by currentUser ──
let currentUser: JwtPayload | null = null;
const permissionsRequired: string[] = [];

vi.mock('../middleware/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/index.js')>();
  return {
    ...actual,
    requirePermission: (permission: string) => {
      permissionsRequired.push(permission);
      return async (request: { user?: JwtPayload }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
        if (!currentUser) return reply.code(401).send({ error: 'Unauthorized' });
        request.user = currentUser;
      };
    },
  };
});

const state: {
  pendingRun: { entity_id: string } | null;
  getRow: Record<string, unknown> | null;
} = { pendingRun: null, getRow: null };

vi.mock('../db/index.js', () => {
  // Both crm_sync_logs reads end in maybeSingle(); the selected columns
  // distinguish the pending-run guard ('entity_id') from the GET ('*').
  const makeChain = (selectArg: string) => {
    const chain = {
      eq: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({
        data: selectArg === 'entity_id' ? state.pendingRun : state.getRow,
      })),
    };
    return chain;
  };
  return {
    supabase: {
      from: vi.fn(() => ({ select: vi.fn((arg: string) => makeChain(arg)) })),
    },
  };
});

const activeGhlConnection = vi.fn();
vi.mock('../crm/ghl-connection.js', () => ({
  activeGhlConnection: (clientId: string) => activeGhlConnection(clientId),
}));

const queueAdd = vi.fn(async () => undefined);
vi.mock('../queues/index.js', () => ({ crmSyncQueue: { add: queueAdd } }));

const persistProvisionRun = vi.fn(async () => undefined);
vi.mock('../crm/ghl-provisioning.service.js', () => ({
  persistProvisionRun,
  initialProvisionSteps: () => [
    { step: 'pipeline', status: 'pending', created: 0, updated: 0, skipped: 0 },
  ],
}));

const getSettings = vi.fn(async (_id: string): Promise<{ ghl_blueprint: unknown } | null> => null);
const writeAuditLog = vi.fn(async (_entry: unknown) => undefined);
vi.mock('../services/index.js', () => ({
  clientService: { getSettings: (id: string) => getSettings(id) },
  writeAuditLog: (entry: unknown) => writeAuditLog(entry),
}));

const { crmProvisioningRoutes } = await import('../routes/crm-provisioning.route.js');
const { buildIdempotencyKey } = await import('../utils/index.js');

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

function platformUser(): JwtPayload {
  return { sub: 'u1', email: 'admin@x.com', role: 'super_admin', clientId: null, iat: 0, exp: 0 };
}

function scopedUser(clientId: string): JwtPayload {
  return { sub: 'u2', email: 'a@x.com', role: 'admin', clientId, iat: 0, exp: 0 };
}

function connection(overrides: Partial<CrmConnection> = {}): CrmConnection {
  return { id: 'conn_1', client_id: CLIENT_ID, crm_type: 'gohighlevel', needs_reauth: false, is_active: true, ...overrides } as CrmConnection;
}

function validBlueprint(): GhlBlueprint {
  return {
    name: 'custom-bp',
    pipeline: { name: 'P', stages: ['New'] },
    customFields: [],
    tags: ['t'],
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  // Mirror app.ts's global handler: ZodError → 400 validation response.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: error.flatten().fieldErrors });
    }
    reply.code(500).send({ error: 'Internal server error' });
  });
  await app.register(crmProvisioningRoutes);
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  currentUser = platformUser();
  state.pendingRun = null;
  state.getRow = null;
  activeGhlConnection.mockReset().mockResolvedValue(connection());
  queueAdd.mockClear();
  persistProvisionRun.mockClear();
  getSettings.mockReset().mockResolvedValue(null);
  writeAuditLog.mockClear();
  app = await buildApp();
});

function post(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/crm/ghl/provision', payload: body });
}

describe('POST /crm/ghl/provision', () => {
  it('registers with crm:write and the GET with crm:read', () => {
    expect(permissionsRequired).toContain('crm:write');
    expect(permissionsRequired).toContain('crm:read');
  });

  it('401s without a user', async () => {
    currentUser = null;
    const res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(401);
  });

  it('403s a user scoped to another client', async () => {
    currentUser = scopedUser('99999999-2222-3333-4444-555555555555');
    const res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(403);
  });

  it('400s an unknown blueprint name', async () => {
    const res = await post({ clientId: CLIENT_ID, blueprint: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Unknown blueprint');
  });

  it('400s an invalid inline blueprint via schema validation', async () => {
    const res = await post({ clientId: CLIENT_ID, blueprint: { name: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('400s an invalid stored client_settings blueprint', async () => {
    getSettings.mockResolvedValue({ ghl_blueprint: { name: 'broken' } });
    const res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('ghl_blueprint is invalid');
  });

  it('404s without an active connection', async () => {
    activeGhlConnection.mockResolvedValue(null);
    const res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(404);
  });

  it('409s when the connection needs re-auth', async () => {
    activeGhlConnection.mockResolvedValue(connection({ needs_reauth: true }));
    const res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(409);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('409s with the existing runId when a run is already pending', async () => {
    state.pendingRun = { entity_id: 'run_existing' };
    const res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(409);
    expect(res.json().runId).toBe('run_existing');
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('202s, inserts the pending run row and enqueues with a runId-scoped jobId', async () => {
    const res = await post({ clientId: CLIENT_ID, blueprint: 'client-inbound' });
    expect(res.statusCode).toBe(202);
    const { runId } = res.json() as { runId: string };
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);

    expect(persistProvisionRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId, status: 'pending', blueprintName: 'client-inbound' }),
      { attempts: 0 }
    );
    expect(queueAdd).toHaveBeenCalledWith(
      'provision',
      expect.objectContaining({ kind: 'provision', runId, blueprintName: 'client-inbound' }),
      { jobId: buildIdempotencyKey('ghl-provision', 'conn_1', runId) }
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'crm.provision.requested', entityId: runId })
    );
  });

  it('falls back to the stored client blueprint, then client-inbound', async () => {
    getSettings.mockResolvedValue({ ghl_blueprint: validBlueprint() });
    let res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(202);
    expect(queueAdd).toHaveBeenLastCalledWith(
      'provision',
      expect.objectContaining({ blueprintName: 'custom-bp' }),
      expect.anything()
    );

    getSettings.mockResolvedValue(null);
    res = await post({ clientId: CLIENT_ID });
    expect(res.statusCode).toBe(202);
    expect(queueAdd).toHaveBeenLastCalledWith(
      'provision',
      expect.objectContaining({ blueprintName: 'client-inbound' }),
      expect.anything()
    );
  });
});

describe('GET /crm/ghl/provision/:runId', () => {
  const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('404s an unknown run', async () => {
    const res = await app.inject({ method: 'GET', url: `/crm/ghl/provision/${RUN_ID}` });
    expect(res.statusCode).toBe(404);
  });

  it('403s cross-tenant access to a run', async () => {
    state.getRow = { client_id: 'other-client', status: 'pending', payload: {} };
    currentUser = scopedUser(CLIENT_ID);
    const res = await app.inject({ method: 'GET', url: `/crm/ghl/provision/${RUN_ID}` });
    expect(res.statusCode).toBe(403);
  });

  it('returns the run with per-step results', async () => {
    state.getRow = {
      client_id: CLIENT_ID,
      status: 'success',
      error_message: null,
      attempts: 1,
      created_at: '2026-07-18T00:00:00Z',
      updated_at: '2026-07-18T00:01:00Z',
      payload: {
        blueprintName: 'gravvia-sales',
        steps: [{ step: 'pipeline', status: 'success', created: 1, updated: 0, skipped: 0 }],
      },
    };
    const res = await app.inject({ method: 'GET', url: `/crm/ghl/provision/${RUN_ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      runId: RUN_ID,
      clientId: CLIENT_ID,
      status: 'success',
      blueprintName: 'gravvia-sales',
      steps: [expect.objectContaining({ step: 'pipeline', status: 'success' })],
      attempts: 1,
    });
  });
});
