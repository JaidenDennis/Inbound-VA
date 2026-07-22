import type { WorkflowDefinition } from '../../types/index.js';
import { logger } from '../../utils/index.js';

// Workflow registry — mirrors the template/plugin registries: definitions
// register here without touching the engine (open for extension, closed for
// modification). Adding workflow #26 = one declarative file + one register call.

const byId = new Map<string, WorkflowDefinition>();
const byIntent = new Map<string, WorkflowDefinition>();

function assertValid(def: WorkflowDefinition): void {
  if (!def.states.length) throw new Error(`Workflow ${def.id} declares no states`);
  for (const state of def.states) {
    if (!(state in def.transitions)) {
      throw new Error(`Workflow ${def.id}: state "${state}" missing from transitions map`);
    }
  }
  for (const [from, targets] of Object.entries(def.transitions)) {
    if (!def.states.includes(from)) {
      throw new Error(`Workflow ${def.id}: transitions references unknown state "${from}"`);
    }
    for (const to of targets) {
      if (!def.states.includes(to)) {
        throw new Error(`Workflow ${def.id}: transition ${from} → unknown state "${to}"`);
      }
    }
  }
  for (const guard of def.guards ?? []) {
    for (const state of guard.states) {
      if (!def.states.includes(state)) {
        throw new Error(`Workflow ${def.id}: guard "${guard.name}" references unknown state "${state}"`);
      }
    }
  }
}

export function registerWorkflow(def: WorkflowDefinition): void {
  assertValid(def);
  if (byId.has(def.id)) logger.warn({ workflowId: def.id }, 'Workflow re-registered (overwriting)');
  byId.set(def.id, def);
  for (const intent of def.intents) {
    const existing = byIntent.get(intent);
    if (existing && existing.id !== def.id) {
      throw new Error(`Intent "${intent}" already routes to workflow ${existing.id} (attempted: ${def.id})`);
    }
    byIntent.set(intent, def);
  }
}

export function getWorkflow(id: string): WorkflowDefinition | null {
  return byId.get(id) ?? null;
}

export function resolveWorkflowByIntent(intent: string): WorkflowDefinition | null {
  return byIntent.get(intent.trim().toLowerCase()) ?? null;
}

export function listWorkflows(): WorkflowDefinition[] {
  return [...byId.values()];
}

/** Test seam — clears all registrations. */
export function clearWorkflowRegistry(): void {
  byId.clear();
  byIntent.clear();
}
