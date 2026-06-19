export type CallStatus =
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'transferred';
export type CallDirection = 'inbound' | 'outbound';
export type HandoffStatus = 'pending' | 'connected' | 'missed' | 'resolved';

export interface Call {
  id: string;
  client_id: string;
  contact_id: string | null;
  retell_call_id: string;
  direction: CallDirection;
  from_number: string;
  to_number: string;
  status: CallStatus;
  duration_seconds: number | null;
  recording_url: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  call_id: string;
  client_id: string;
  contact_id: string | null;
  intent: string | null;
  sentiment: string | null;
  lead_captured: boolean;
  booking_requested: boolean;
  handoff_requested: boolean;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CallTranscript {
  id: string;
  call_id: string;
  client_id: string;
  transcript: TranscriptTurn[];
  word_count: number;
  created_at: string;
}

export interface TranscriptTurn {
  role: 'agent' | 'user';
  content: string;
  timestamp_ms: number;
}

export interface CallSummary {
  id: string;
  call_id: string;
  client_id: string;
  summary: string;
  action_items: string[];
  key_topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  follow_up_required: boolean;
  created_at: string;
}

export interface Contact {
  id: string;
  client_id: string;
  external_crm_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  notes: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StaffNotification {
  id: string;
  client_id: string;
  call_id: string | null;
  type: 'handoff' | 'lead' | 'booking' | 'escalation';
  status: HandoffStatus;
  message: string;
  recipient_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
