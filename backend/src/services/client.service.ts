import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { onboardingService } from './onboarding.service.js';
import type { Client, ClientSettings } from '../types/index.js';

export class ClientService {
  async findByPhoneNumber(phoneNumber: string): Promise<Client | null> {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .contains('phone_numbers', [phoneNumber])
      .eq('status', 'active')
      .maybeSingle();
    return data as Client | null;
  }

  async findById(clientId: string): Promise<Client | null> {
    const { data } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
    return data as Client | null;
  }

  async findByAgentId(agentId: string): Promise<Client | null> {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('retell_agent_id', agentId)
      .eq('status', 'active')
      .maybeSingle();
    return data as Client | null;
  }

  async getSettings(clientId: string): Promise<ClientSettings | null> {
    const { data } = await supabase
      .from('client_settings')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle();
    return data as ClientSettings | null;
  }

  async list(page = 1, limit = 20): Promise<{ data: Client[]; count: number }> {
    const from = (page - 1) * limit;
    const { data, count } = await supabase
      .from('clients')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    return { data: (data ?? []) as Client[], count: count ?? 0 };
  }

  async create(payload: Partial<Client>): Promise<Client> {
    const { data, error } = await supabase.from('clients').insert(payload).select().single();
    if (error) throw new Error(error.message);
    // Create default settings + seed the 8 onboarding milestones.
    await supabase.from('client_settings').insert({ client_id: data.id });
    await onboardingService.seedForClient(data.id);
    logger.info({ clientId: data.id }, 'Client created');
    return data as Client;
  }

  async update(clientId: string, payload: Partial<Client>): Promise<Client> {
    const { data, error } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', clientId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Client;
  }

  async updateSettings(clientId: string, payload: Partial<ClientSettings>): Promise<ClientSettings> {
    const { data, error } = await supabase
      .from('client_settings')
      .update(payload)
      .eq('client_id', clientId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ClientSettings;
  }
}

export const clientService = new ClientService();
