export interface RetellCallStartedPayload {
  event: 'call_started';
  call: {
    call_id: string;
    agent_id: string;
    call_status: string;
    start_timestamp: number;
    from_number: string;
    to_number: string;
    direction: 'inbound' | 'outbound';
    metadata?: Record<string, unknown>;
  };
}

export interface RetellCallEndedPayload {
  event: 'call_ended';
  call: {
    call_id: string;
    agent_id: string;
    call_status: string;
    start_timestamp: number;
    end_timestamp: number;
    duration_ms: number;
    from_number: string;
    to_number: string;
    direction: 'inbound' | 'outbound';
    recording_url?: string;
    metadata?: Record<string, unknown>;
    call_analysis?: {
      call_summary?: string;
      user_sentiment?: string;
      agent_sentiment?: string;
      call_successful?: boolean;
      custom_analysis_data?: Record<string, unknown>;
    };
  };
}

export interface RetellTranscriptPayload {
  event: 'call_transcript';
  call: {
    call_id: string;
    agent_id: string;
  };
  transcript: Array<{
    role: 'agent' | 'user';
    content: string;
    words?: Array<{
      word: string;
      start: number;
      end: number;
    }>;
  }>;
}

export interface RetellSummaryPayload {
  event: 'call_analyzed';
  call: {
    call_id: string;
    agent_id: string;
    call_analysis: {
      call_summary: string;
      user_sentiment: string;
      custom_analysis_data?: Record<string, unknown>;
    };
  };
}

export type RetellWebhookPayload =
  | RetellCallStartedPayload
  | RetellCallEndedPayload
  | RetellTranscriptPayload
  | RetellSummaryPayload;
