import { describe, it, expect } from 'vitest';
import { sanitizeAgentReadback } from '../dashboard-api/my-agent.sanitize.js';

/**
 * The lockout this guards against.
 *
 * GET /my-agent echoes stored settings into the editor; PATCH /my-agent
 * validates them strictly. So a stored value that falls outside the current
 * schema — set by an older template, a direct DB edit, or a schema that
 * tightened after the row was written — makes the record permanently
 * un-editable: the form loads the bad value, sends it back untouched, and the
 * save is rejected. The user cannot fix it, because every save carries the
 * poison along with their actual change.
 *
 * The fix is to sanitize on the way OUT, so the editor never holds a value the
 * API would refuse. Sanitizing on the way in would be wrong — that would
 * silently discard what a user typed.
 */
describe('sanitizeAgentReadback', () => {
  const VOICES = ['11labs-Amy', '11labs-Emily'];
  const TONES = ['warm', 'professional'];
  const STYLES = ['concise', 'detailed'];
  const PERSONALITIES = ['helpful', 'patient'];
  const opts = { voices: VOICES, tones: TONES, styles: STYLES, personalities: PERSONALITIES };

  it('drops notification emails that are not addresses', () => {
    const out = sanitizeAgentReadback(
      { notification_emails: ['ops@example.com', 'placeholder', '', 'staff@example.com'] },
      opts
    );
    expect(out.notification_emails).toEqual(['ops@example.com', 'staff@example.com']);
  });

  it('clears a voice the console does not offer', () => {
    expect(sanitizeAgentReadback({ voice_id: '11labs-Nonexistent' }, opts).voice_id).toBe('');
    expect(sanitizeAgentReadback({ voice_id: '11labs-Emily' }, opts).voice_id).toBe('11labs-Emily');
  });

  it('clears character fields that are not in their option lists', () => {
    const out = sanitizeAgentReadback(
      { agent_tone: 'sardonic', agent_response_style: 'concise', agent_personality: '' },
      opts
    );
    expect(out.agent_tone).toBe('');
    expect(out.agent_response_style).toBe('concise');
    expect(out.agent_personality).toBe('');
  });

  it('nulls numeric voice settings that fall outside their accepted range', () => {
    const out = sanitizeAgentReadback(
      { responsiveness: 0.1, interruption_sensitivity: 0.95, voice_temperature: 9 },
      opts
    );
    expect(out.responsiveness).toBeNull();
    expect(out.interruption_sensitivity).toBe(0.95);
    expect(out.voice_temperature).toBeNull();
  });

  it('drops pronunciation entries the schema would refuse', () => {
    const out = sanitizeAgentReadback(
      {
        pronunciation_dictionary: [
          { word: 'Gravvia', alphabet: 'ipa', phoneme: 'ˈɡrævia' },
          { word: 'Bad', alphabet: 'sampa', phoneme: 'b{d' },
          { word: '', alphabet: 'ipa', phoneme: 'x' },
          { word: 'NoPhoneme', alphabet: 'cmu', phoneme: '' },
        ],
      },
      opts
    );
    expect(out.pronunciation_dictionary).toEqual([
      { word: 'Gravvia', alphabet: 'ipa', phoneme: 'ˈɡrævia' },
    ]);
  });

  it('leaves a clean record untouched', () => {
    const clean = {
      voice_id: '11labs-Amy',
      agent_tone: 'warm',
      agent_response_style: 'detailed',
      agent_personality: 'helpful',
      responsiveness: 0.85,
      interruption_sensitivity: 0.95,
      voice_temperature: 0.6,
      notification_emails: ['ops@example.com'],
      pronunciation_dictionary: [{ word: 'A', alphabet: 'cmu', phoneme: 'EY' }],
    };
    expect(sanitizeAgentReadback(clean, opts)).toMatchObject(clean);
  });

  it('tolerates a record with none of these fields set', () => {
    const out = sanitizeAgentReadback({}, opts);
    expect(out.notification_emails).toEqual([]);
    expect(out.pronunciation_dictionary).toEqual([]);
    expect(out.voice_id).toBe('');
  });
});
