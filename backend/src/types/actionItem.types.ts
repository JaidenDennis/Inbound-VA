export type ActionItemStatus = 'pending' | 'done';

/**
 * Where an item belongs in the product.
 *
 * `onboarding` is the narrow case — a step in the bounded, one-time sequence
 * that runs before go-live, shown on the Onboarding page. `operations` is
 * everything else: ongoing work, shown in the Work Queue. The split exists
 * because Onboarding listed the table unfiltered, so operational work created
 * months after launch appeared as though the client were still being onboarded.
 */
export type ActionItemCategory = 'onboarding' | 'operations';

export const ACTION_ITEM_CATEGORIES: ActionItemCategory[] = ['onboarding', 'operations'];

export interface ClientActionItem {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  status: ActionItemStatus;
  /** Defaults to 'operations' in the database — see migration 033. */
  category: ActionItemCategory;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const ACTION_ITEM_STATUSES: ActionItemStatus[] = ['pending', 'done'];
