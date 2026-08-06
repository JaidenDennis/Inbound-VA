import { supabase } from '../db/index.js';
import type { Contact } from '../types/index.js';

export class ContactService {
  async findByPhone(clientId: string, phone: string): Promise<Contact | null> {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('client_id', clientId)
      .eq('phone', phone)
      .maybeSingle();
    return data as Contact | null;
  }

  async findByEmail(clientId: string, email: string): Promise<Contact | null> {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('client_id', clientId)
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();
    return data as Contact | null;
  }

  async findById(contactId: string): Promise<Contact | null> {
    const { data } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
    return data as Contact | null;
  }

  async upsertByPhone(
    clientId: string,
    phone: string,
    data: Partial<Contact>
  ): Promise<Contact> {
    const existing = await this.findByPhone(clientId, phone);
    if (existing) {
      const { data: updated, error } = await supabase
        .from('contacts')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated as Contact;
    }

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({ client_id: clientId, phone, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return created as Contact;
  }

  /**
   * Upsert keyed on whichever identifier the source has. Voice callers always
   * arrive with a phone number, but outbound/enrichment sources (Clay) often
   * have only an email, and contacts.phone is NOT NULL — so a phoneless lead
   * is stored with an empty phone and deduped on email instead.
   *
   * Phone wins when both are present: it is the identifier inbound calls match
   * on, so keying elsewhere would fork the contact when that lead calls in.
   *
   * `tags` and `custom_fields` are merged into whatever the contact already
   * has rather than replacing it — the same person can be touched by several
   * sources (an outbound push, then an inbound call), and neither should erase
   * the other's segmentation.
   */
  async upsertByIdentity(
    clientId: string,
    identity: { phone?: string; email?: string },
    data: Partial<Contact>
  ): Promise<Contact> {
    const phone = identity.phone?.trim();
    const email = identity.email?.trim().toLowerCase();
    if (!phone && !email) {
      throw new Error('upsertByIdentity requires a phone or an email');
    }

    const existing = phone
      ? await this.findByPhone(clientId, phone)
      : await this.findByEmail(clientId, email as string);

    if (existing) {
      const { data: updated, error } = await supabase
        .from('contacts')
        .update({
          ...data,
          ...(data.tags ? { tags: [...new Set([...(existing.tags ?? []), ...data.tags])] } : {}),
          ...(data.custom_fields
            ? { custom_fields: { ...(existing.custom_fields ?? {}), ...data.custom_fields } }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated as Contact;
    }

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({ client_id: clientId, phone: phone ?? '', email: email ?? null, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return created as Contact;
  }

  async list(clientId: string, page = 1, limit = 50): Promise<{ data: Contact[]; count: number }> {
    const from = (page - 1) * limit;
    const { data, count } = await supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    return { data: (data ?? []) as Contact[], count: count ?? 0 };
  }
}

export const contactService = new ContactService();
