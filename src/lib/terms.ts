/*
 * Term names are free text ("Fall 2026", "Spring 2027") chosen by Residence
 * Life, so nothing in the database orders them by time. Plain alphabetical
 * puts Spring above Fall; this sorts newest first by year, then by season,
 * and falls back to alphabetical for anything it can't parse.
 */

const SEASON_ORDER: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
  autumn: 3,
};

function termKey(term: string): { year: number; season: number } | null {
  const year = term.match(/\b(\d{4})\b/);
  if (!year) return null;
  const season = Object.keys(SEASON_ORDER).find((s) =>
    term.toLowerCase().includes(s),
  );
  return {
    year: Number(year[1]),
    season: season ? SEASON_ORDER[season] : -1,
  };
}

/** Newest term first. Safe for `Array.prototype.sort`. */
export function compareTermsNewestFirst(a: string, b: string): number {
  const ka = termKey(a);
  const kb = termKey(b);
  if (ka && kb) {
    return kb.year - ka.year || kb.season - ka.season || b.localeCompare(a);
  }
  if (ka) return -1; // parseable terms ahead of the rest
  if (kb) return 1;
  return b.localeCompare(a);
}
