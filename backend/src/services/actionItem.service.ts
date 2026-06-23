import { supabase } from '../db/index.js';
import type { ActionItemStatus, ClientActionItem } from '../types/index.js';

export interface CreateActionItemInput {
  clientId: string;
  title: string;
  description?: string | null;
  createdBy: string;
}

export interface UpdateActionItemInput {
  title?: string;
  description?: string | null;
  status?: ActionItemStatus;
}

export class ActionItemService {
  async listForClient(clientId: string): Promise<ClientActionItem[]> {
    const { data } = await supabase
      .from('client_action_items')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    return (data ?? []) as ClientActionItem[];
  }

  async findById(id: string): Promise<ClientActionItem | null> {
    const { data } = await supabase.from('client_action_items').select('*').eq('id', id).maybeSingle();
    return data as ClientActionItem | null;
  }

  async create(input: CreateActionItemInput): Promise<ClientActionItem> {
    const { data, error } = await supabase
      .from('client_action_items')
      .insert({
        client_id: input.clientId,
        title: input.title,
        description: input.description ?? null,
        status: 'pending',
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ClientActionItem;
  }

  async update(id: string, patch: UpdateActionItemInput): Promise<ClientActionItem> {
    const fields: Record<string, unknown> = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.description !== undefined) fields.description = patch.description;
    if (patch.status !== undefined) fields.status = patch.status;

    const { data, error } = await supabase
      .from('client_action_items')
      .update(fields)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ClientActionItem;
  }
}

export const actionItemService = new ActionItemService();
