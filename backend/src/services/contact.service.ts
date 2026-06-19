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
