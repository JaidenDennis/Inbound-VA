import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import type { ClientSettings, FAQ, PricingItem, Promotion, Service } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Client knowledge (services / pricing / faqs / promotions).
//
// Source of truth is RELATIONAL-FIRST (migration 012 tables) with JSONB
// FALLBACK to the locked client_settings columns, so existing clients keep
// working with no data migration and rows take precedence once created.
// knowledge.search is fully deterministic (token scoring) — no LLM involved.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientKnowledge {
  services: Service[];
  pricing: PricingItem[];
  faqs: FAQ[];
  promotions: Promotion[];
}

export interface KnowledgeSearchResult {
  faqs: FAQ[];
  services: Service[];
  pricing: PricingItem[];
  promotions: Promotion[];
  /** True when at least one section matched. */
  found: boolean;
}

interface ServiceRow {
  name: string;
  description: string | null;
  duration_minutes: number | null;
  price: number | null;
}
interface PricingRow {
  name: string;
  price: number;
  member_price: number | null;
  unit: string | null;
  notes: string | null;
  upsell_note: string | null;
}
interface FaqRow {
  question: string;
  answer: string;
  category: string | null;
}
interface PromotionRow {
  title: string;
  description: string | null;
  eligibility: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

async function fetchActive<T>(table: string, clientId: string): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('client_id', clientId)
    .eq('active', true);
  if (error) {
    logger.warn({ error, table, clientId }, 'Knowledge fetch failed; falling back to settings');
    return [];
  }
  return (data ?? []) as T[];
}

/** A promotion is live when now falls inside its (open-ended) date window. */
function inWindow(p: PromotionRow, now: Date): boolean {
  if (p.starts_at && new Date(p.starts_at) > now) return false;
  if (p.ends_at && new Date(p.ends_at) < now) return false;
  return true;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/** Deterministic relevance: matched-token count, +2 for a full-phrase hit. */
function score(queryTokens: string[], query: string, text: string): number {
  const haystack = text.toLowerCase();
  let s = queryTokens.filter((t) => haystack.includes(t)).length;
  if (query.trim().length > 3 && haystack.includes(query.trim().toLowerCase())) s += 2;
  return s;
}

function topMatches<T>(items: T[], toText: (item: T) => string, query: string, limit = 3): T[] {
  const tokens = tokenize(query);
  return items
    .map((item) => ({ item, s: score(tokens, query, toText(item)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.item);
}

export class KnowledgeService {
  /** Load a client's knowledge: relational rows first, settings JSONB fallback. */
  async load(clientId: string, settings?: ClientSettings | null, now = new Date()): Promise<ClientKnowledge> {
    const [svcRows, priceRows, faqRows, promoRows] = await Promise.all([
      fetchActive<ServiceRow>('services', clientId),
      fetchActive<PricingRow>('pricing', clientId),
      fetchActive<FaqRow>('faqs', clientId),
      fetchActive<PromotionRow>('promotions', clientId),
    ]);

    const services: Service[] = svcRows.length
      ? svcRows.map((r) => ({
          name: r.name,
          description: r.description ?? '',
          duration_minutes: r.duration_minutes ?? 60,
          price: r.price ?? undefined,
        }))
      : settings?.services ?? [];

    const pricing: PricingItem[] = priceRows.length
      ? priceRows.map((r) => ({
          name: r.name,
          price: Number(r.price),
          member_price: r.member_price != null ? Number(r.member_price) : undefined,
          unit: r.unit ?? undefined,
          notes: r.notes ?? undefined,
          upsell_note: r.upsell_note ?? undefined,
        }))
      : settings?.pricing ?? [];

    const faqs: FAQ[] = faqRows.length
      ? faqRows.map((r) => ({ question: r.question, answer: r.answer, category: r.category ?? undefined }))
      : settings?.faqs ?? [];

    const promotions: Promotion[] = promoRows.filter((p) => inWindow(p, now)).map((r) => ({
      title: r.title,
      description: r.description ?? '',
      eligibility: r.eligibility,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
    }));

    return { services, pricing, faqs, promotions };
  }

  /**
   * Settings with relational knowledge overlaid — what provisioning renders
   * into agent prompts and what slot validators see. The original settings
   * object is not mutated; JSONB values survive where no rows exist.
   */
  async settingsWithKnowledge(clientId: string, settings: ClientSettings): Promise<ClientSettings> {
    const knowledge = await this.load(clientId, settings);
    return {
      ...settings,
      services: knowledge.services,
      pricing: knowledge.pricing,
      faqs: knowledge.faqs,
    };
  }

  /** Deterministic search across the client's knowledge for the agent. */
  async search(
    clientId: string,
    query: string,
    settings?: ClientSettings | null,
    now = new Date()
  ): Promise<KnowledgeSearchResult & { activePromotions: Promotion[] }> {
    const knowledge = await this.load(clientId, settings, now);
    const faqs = topMatches(knowledge.faqs, (f) => `${f.question} ${f.answer}`, query);
    const services = topMatches(knowledge.services, (s) => `${s.name} ${s.description}`, query);
    const pricing = topMatches(
      knowledge.pricing,
      (p) => `${p.name} ${p.notes ?? ''} ${p.upsell_note ?? ''}`,
      query
    );
    const promotions = topMatches(
      knowledge.promotions,
      (p) => `${p.title} ${p.description} ${p.eligibility ?? ''}`,
      query
    );
    return {
      faqs,
      services,
      pricing,
      promotions,
      // All currently-live offers, regardless of query relevance — the
      // promotions workflow lists these directly.
      activePromotions: knowledge.promotions,
      found: Boolean(faqs.length || services.length || pricing.length || promotions.length),
    };
  }
}

export const knowledgeService = new KnowledgeService();
