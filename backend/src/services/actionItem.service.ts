import { supabase } from '../db/index.js';
import type { ActionItemCategory, ActionItemStatus, ClientActionItem } from '../types/index.js';

export interface CreateActionItemInput {
  clientId: string;
  title: string;
  description?: string | null;
  createdBy: string;
  /** Omitted means 'operations', matching the column default in migration 033. */
  category?: ActionItemCategory;
}

export interface UpdateActionItemInput {
  title?: string;
  description?: string | null;
  status?: ActionItemStatus;
}

export class ActionItemService {
  /**
   * @param category narrows to one bucket. Omitted returns every category,
   *   which is what the platform-wide views and older callers expect — adding
   *   the filter must not silently change what they see.
   */
  async listForClient(clientId: string, category?: ActionItemCategory): Promise<ClientActionItem[]> {
    let query = supabase
      .from('client_action_items')
      .select('*')
      .eq('client_id', clientId);

    if (category) query = query.eq('category', category);

    const { data } = await query.order('created_at', { ascending: true });
    return (data ?? []) as ClientActionItem[];
  }

  /**
   * Every client's outstanding items — the staff view of "who owes us what".
   * Client name is joined so the list is readable without a second lookup.
   */
  async listAllForPlatform(): Promise<ClientActionItem[]> {
    const { data } = await supabase
      .from('client_action_items')
      .select('*, clients(id, name)')
      .order('status', { ascending: true })
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
        // Written explicitly rather than left to the column default, so the
        // value is visible in the audit trail the route wraps this in.
        category: input.category ?? 'operations',
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
