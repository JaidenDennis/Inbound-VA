import { describe, it, expect, vi, beforeEach } from 'vitest';

// ContactService.upsertByIdentity — the write path shared by inbound voice
// (phone identity) and outbound enrichment (email identity, no phone). The
// same person can be touched by both, so neither source may erase the other's
// data.

let existingRow: Record<string, unknown> | null = null;
let lastUpdate: Record<string, unknown> | null = null;
let lastInsert: Record<string, unknown> | null = null;
let lastFilter: { column: string; value: unknown } | null = null;

vi.mock('../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn((column: string, value: unknown) => {
            lastFilter = { column, value };
            return {
              maybeSingle: vi.fn(() => Promise.resolve({ data: existingRow, error: null })),
            };
          }),
        })),
      })),
      update: vi.fn((row: Record<string, unknown>) => {
        lastUpdate = row;
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({ data: { ...existingRow, ...row }, error: null })
              ),
            })),
          })),
        };
      }),
      insert: vi.fn((row: Record<string, unknown>) => {
        lastInsert = row;
        return {
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: { id: 'new-1', ...row }, error: null })),
          })),
        };
      }),
    })),
  },
}));

const { contactService } = await import('../services/contact.service.js');

describe('ContactService.upsertByIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingRow = null;
    lastUpdate = null;
    lastInsert = null;
    lastFilter = null;
  });

  it('inserts an email-only lead with an empty phone (contacts.phone is NOT NULL)', async () => {
    const contact = await contactService.upsertByIdentity(
      'c1',
      { email: 'James@PorterLaw.com' },
      { first_name: 'James' }
    );
    expect(contact.id).toBe('new-1');
    expect(lastInsert).toMatchObject({
      client_id: 'c1',
      phone: '',
      email: 'james@porterlaw.com',
      first_name: 'James',
    });
    // Identity lookup fell back to email.
    expect(lastFilter).toEqual({ column: 'email', value: 'james@porterlaw.com' });
  });

  it('keys on phone when both identifiers are present', async () => {
    await contactService.upsertByIdentity(
      'c1',
      { phone: '+19047605971', email: 'a@b.com' },
      { first_name: 'Sarah' }
    );
    expect(lastFilter).toEqual({ column: 'phone', value: '+19047605971' });
  });

  it('merges tags and custom fields instead of replacing them', async () => {
    existingRow = {
      id: 'ct1',
      tags: ['lead', 'voice'],
      custom_fields: { 'Interest Level': 'Warm', 'Preferred Time': 'mornings' },
    };

    await contactService.upsertByIdentity(
      'c1',
      { phone: '+19047605971' },
      {
        tags: ['clay', 'outbound-lead', 'voice'],
        custom_fields: { 'Interest Level': 'Hot', 'Company Industry': 'Dental' },
      }
    );

    expect(lastUpdate?.tags).toEqual(['lead', 'voice', 'clay', 'outbound-lead']);
    expect(lastUpdate?.custom_fields).toEqual({
      'Preferred Time': 'mornings',
      'Interest Level': 'Hot', // newer value wins on conflict
      'Company Industry': 'Dental',
    });
  });

  it('leaves tags and custom fields alone when the caller sends neither', async () => {
    existingRow = { id: 'ct1', tags: ['voice'], custom_fields: { a: 1 } };
    await contactService.upsertByIdentity('c1', { phone: '+19047605971' }, { first_name: 'Sarah' });
    expect(lastUpdate).not.toHaveProperty('tags');
    expect(lastUpdate).not.toHaveProperty('custom_fields');
    expect(lastUpdate).toMatchObject({ first_name: 'Sarah' });
  });

  it('rejects a lead with no identifier at all', async () => {
    await expect(contactService.upsertByIdentity('c1', {}, {})).rejects.toThrow(
      /requires a phone or an email/
    );
  });
});
