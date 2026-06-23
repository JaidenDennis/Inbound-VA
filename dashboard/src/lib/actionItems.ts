export type ActionItemStatus = 'pending' | 'done';

export interface ActionItem {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  status: ActionItemStatus;
  created_at: string;
}
