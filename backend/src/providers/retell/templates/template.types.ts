import type { Client, ClientSettings } from '../../../types/index.js';

// The custom functions the Retell agent can invoke mid-call. Kept in one place
// so the template (tool specs) and the Phase 3 endpoints stay in sync.
export const RETELL_FUNCTION_NAMES = [
  'check_availability',
  'book_appointment',
  'book_consultation',
  'qualify_lead',
  'lookup_existing_client',
  'leave_staff_message',
  'schedule_callback',
  'request_human_handoff',
] as const;
export type RetellFunctionName = (typeof RETELL_FUNCTION_NAMES)[number];

export interface RetellToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** Provider-agnostic spec for one custom tool; mapped to Retell's CustomTool. */
export interface RetellToolSpec {
  name: RetellFunctionName;
  description: string;
  url: string;
  speak_during_execution?: boolean;
  parameters?: RetellToolParameters;
}

/** What a template produces for the Retell LLM (Response Engine). */
export interface ResponseEngineSpec {
  model?: string;
  general_prompt: string;
  begin_message: string;
  general_tools: RetellToolSpec[];
}

/** What a template produces for the Retell Agent. Locale kept to a supported subset. */
export interface AgentSpec {
  agent_name: string;
  voice_id: string;
  language: 'en-US' | 'en-GB' | 'en-AU' | 'es-ES' | 'es-419' | 'fr-FR' | 'multi';
  // Pacing / experience (warm, unhurried) and end-call timing so goodbyes
  // aren't cut off. All optional; the wrapper omits undefined values.
  responsiveness?: number;
  interruption_sensitivity?: number;
  enable_backchannel?: boolean;
  begin_message_delay_ms?: number;
  end_call_after_silence_ms?: number;
  reminder_trigger_ms?: number;
  reminder_max_count?: number;
}

export interface TemplateContext {
  client: Client;
  settings: ClientSettings;
  /** Absolute base for custom-function URLs, e.g. https://api.gravvia.com/functions/retell */
  functionBaseUrl: string;
  /** Fallback Retell voice id (from env) when the client has none set. */
  defaultVoiceId: string;
}

/** A reusable, vertical-specific agent template (med spa, dental, …). */
export interface AgentTemplate {
  vertical: string;
  build(ctx: TemplateContext): { responseEngine: ResponseEngineSpec; agent: AgentSpec };
}
