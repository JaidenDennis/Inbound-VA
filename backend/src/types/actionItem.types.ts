export type ActionItemStatus = 'pending' | 'done';

export interface ClientActionItem {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  status: ActionItemStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const ACTION_ITEM_STATUSES: ActionItemStatus[] = ['pending', 'done'];
