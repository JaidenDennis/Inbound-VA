import { supabase } from '../db/index.js';

/**
 * White-label branding (migration 027).
 *
 * THE DESIGN DOC CALLS THIS "LOW BUILD COST". IN THIS DESIGN SYSTEM IT IS NOT.
 *
 * DESIGN.md reserves chroma for state: green, amber and red mean good, fair and
 * bad, and interactive affordance is deliberately achromatic *so that a
 * call-to-action can never be misread as a healthy row*. That single rule is
 * what lets an operator scan a page of lamps and trust what they see. A
 * client-supplied accent sitting in the lamp hue range destroys it — a teal
 * "Save" button is fine, a green one is a status claim.
 *
 * So branding is scoped to the surfaces that cannot collide with state:
 *
 *   logo_url       replaces the monogram tile in the rail
 *   wordmark_text  replaces the product name in the header
 *   primary_hex    the login panel housing and the digest email header. Nowhere
 *                  else, and never on a control.
 *
 * And a hex in a lamp hue range is REJECTED at save time with an explanation.
 * Silently substituting a nearby colour would be worse: the client sees their
 * brand ignored and no reason why, and files a bug we would have to explain
 * anyway.
 */

export interface Branding {
  logo_url: string | null;
  primary_hex: string | null;
  wordmark_text: string | null;
}

export const EMPTY_BRANDING: Branding = { logo_url: null, primary_hex: null, wordmark_text: null };

export class BrandingError extends Error {
  constructor(
    message: string,
    readonly code: 'lamp-hue' | 'bad-hex' | 'bad-logo'
  ) {
    super(message);
    this.name = 'BrandingError';
  }
}

/**
 * Hue bands owned by the status lamps, with headroom.
 *
 * Centred on the lamp cores in design-tokens.ts — bad #DC3B30 (~4°), fair
 * #E0921A (~39°), good #1FA35F (~150°) — and widened until a colour inside the
 * band would read as "that status, slightly off" rather than as a brand.
 *
 * This does exclude a lot of the wheel. That is the honest consequence of
 * spending chroma on meaning, and the rejection message says so.
 */
const LAMP_HUE_BANDS: Array<{ from: number; to: number; lamp: string }> = [
  { from: 340, to: 20, lamp: 'the red "bad" lamp' },
  { from: 25, to: 55, lamp: 'the amber "fair" lamp' },
  { from: 90, to: 170, lamp: 'the green "good" lamp' },
];

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);

  return { h: (h + 360) % 360, s, l };
}

function inBand(hue: number, band: { from: number; to: number }): boolean {
  // Wrapping band (340→20) needs the OR; the others need the AND.
  return band.from > band.to ? hue >= band.from || hue <= band.to : hue >= band.from && hue <= band.to;
}

/**
 * Reject an accent that would be mistaken for a status.
 *
 * Near-greys pass regardless of hue: a desaturated colour cannot read as a lamp,
 * and a client whose brand is charcoal should not be told their black is too
 * green.
 */
export function assertAccentAllowed(hex: string): void {
  const hsl = hexToHsl(hex);
  if (!hsl) {
    throw new BrandingError(`"${hex}" is not a 6-digit hex colour, e.g. #2F6FED.`, 'bad-hex');
  }

  if (hsl.s < 0.18) return;

  const band = LAMP_HUE_BANDS.find((b) => inBand(hsl.h, b));
  if (!band) return;

  throw new BrandingError(
    `${hex} is too close to ${band.lamp}. In this dashboard, green, amber and red mean ` +
      `good, fair and bad on every screen — using one of those hues as your accent would make ` +
      `buttons and headings read as status. Pick a colour outside those ranges (blues, teals, ` +
      `purples, magentas and neutrals all work), or leave the accent unset and we will use ours.`,
    'lamp-hue'
  );
}

/** Logos must be a plain https URL — an inline data: or javascript: URI is not. */
function assertLogoAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BrandingError('The logo must be a full URL, starting with https://', 'bad-logo');
  }
  if (parsed.protocol !== 'https:') {
    throw new BrandingError('The logo URL must use https.', 'bad-logo');
  }
}

export function validateBranding(input: Partial<Branding>): Branding {
  const next: Branding = { ...EMPTY_BRANDING };

  if (input.primary_hex) {
    assertAccentAllowed(input.primary_hex);
    next.primary_hex = input.primary_hex.startsWith('#') ? input.primary_hex : `#${input.primary_hex}`;
  }
  if (input.logo_url) {
    assertLogoAllowed(input.logo_url);
    next.logo_url = input.logo_url;
  }
  if (input.wordmark_text) {
    next.wordmark_text = input.wordmark_text.slice(0, 40);
  }

  return next;
}

export async function readBranding(clientId: string): Promise<Branding> {
  const { data } = await supabase.from('clients').select('branding').eq('id', clientId).maybeSingle();
  const stored = (data as { branding: Partial<Branding> | null } | null)?.branding ?? {};
  return { ...EMPTY_BRANDING, ...stored };
}

export async function writeBranding(clientId: string, input: Partial<Branding>): Promise<Branding> {
  const branding = validateBranding(input);
  const { error } = await supabase.from('clients').update({ branding }).eq('id', clientId);
  if (error) throw new Error(`Failed to save branding: ${error.message}`);
  return branding;
}

/** Inline style for the digest email header. Falls back to the product ink. */
export function brandingHeaderStyle(branding: Branding): string {
  const background = branding.primary_hex ?? '#1a1f1f';
  const hsl = hexToHsl(background);
  // Pick readable text rather than assuming a dark brand colour.
  const color = hsl && hsl.l > 0.62 ? '#1a1f1f' : '#ffffff';
  return `background:${background};color:${color};padding:14px 18px;border-radius:8px`;
}

export const brandingService = {
  readBranding,
  writeBranding,
  validateBranding,
  assertAccentAllowed,
  brandingHeaderStyle,
  BrandingError,
};
