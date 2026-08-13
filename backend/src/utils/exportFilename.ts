/**
 * Naming for files that leave the building.
 *
 * An export lands in a Downloads folder beside exports from every other tool
 * the operator uses. Leading with the vendor ("gravvia-money-…") answers a
 * question nobody asked; leading with the company answers the one they have,
 * especially for staff who handle several tenants in a sitting.
 *
 * Shared with the dashboard, which sets `link.download` on blob downloads and
 * so overrides whatever Content-Disposition the server sent. Both sides must
 * agree or the same export arrives under two different names.
 */

/** Longest slug we will emit. Keeps the whole filename inside sane limits. */
const MAX_SLUG = 60;

/**
 * A business name reduced to filename-safe characters.
 *
 * Deliberately not transliterated: mapping "Café" to "Cafe" needs a table that
 * is wrong for some language sooner or later, and a wrong transliteration is
 * harder to recognise than a missing character. Unrepresentable characters
 * become separators, which collapse.
 */
export function companySlug(name: string | null | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    // Apostrophes vanish rather than becoming separators, so "Mike's" reads as
    // "mikes" and not "mike-s".
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');

  // A name of pure punctuation, or an absent one, still needs a filename.
  return slug || 'client';
}

/**
 * `<company>-<what>-<when>.<ext>` — the order an operator scans in.
 *
 * @param stamp already-formatted date, typically the range end as YYYY-MM-DD
 */
export function exportFilename(
  companyName: string | null | undefined,
  kind: string,
  stamp: string,
  extension = 'csv'
): string {
  return `${companySlug(companyName)}-${kind}-${stamp}.${extension}`;
}
