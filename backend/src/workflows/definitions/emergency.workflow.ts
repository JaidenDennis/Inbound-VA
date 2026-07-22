import type { WorkflowDefinition } from '../../types/index.js';

// emergency — system capability. The REAL emergency path is a hard rule in the
// base agent prompt: deliver the predefined emergency-services response and
// call the emergency_flag tool immediately, with NO routing round-trip. This
// definition exists so that if a model routes the "emergency" intent anyway,
// the engine still lands it on the same guidance instead of a fallback.

export const emergencyWorkflow: WorkflowDefinition = {
  id: 'emergency',
  capability: 'system',
  intents: ['emergency'],
  scopes: ['system'],
  slots: [],
  states: ['flagged'],
  transitions: {
    flagged: [],
  },
  outcomes: ['flagged'],
  guidance: {
    flagged:
      'Say exactly: "If this is a medical emergency or you are in immediate danger, please hang up and dial ' +
      '9-1-1 or your local emergency number right now." Then call the emergency_flag tool with a short ' +
      'description. Do not attempt to troubleshoot, advise, or continue normal support.',
  },
};
