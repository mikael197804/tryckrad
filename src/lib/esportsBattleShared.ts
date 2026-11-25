/**
 * Klientsäkra typer/helpers för Esports Battle (ingen Node fs).
 */

export type EsportsBattleMatch = {
  id: string;
  kickoff: string;
  homePlayer: string;
  homeTeam: string;
  awayPlayer: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  /** När resultatet först sparades hos oss. */
  savedAt?: string;
};

export type EsportsBattleDay = {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  playDateLabel: string;
  retentionHours: number;
  played: number | null;
  scheduled: number | null;
  goalsPerMatch: number | null;
  over65Pct: number | null;
  bttsPct: number | null;
  latestLabel: string | null;
  matches: EsportsBattleMatch[];
};

export const ESPORTS_BATTLE_RETENTION_MS = 3 * 60 * 60 * 1000;
export const ESPORTS_BATTLE_RETENTION_HOURS = 3;

/** Retention efter kickoff (matchtid). */
export function esportsBattleAnchorMs(m: EsportsBattleMatch): number {
  const kick = Date.parse(m.kickoff);
  if (Number.isFinite(kick)) return kick;
  const saved = m.savedAt ? Date.parse(m.savedAt) : NaN;
  return Number.isFinite(saved) ? saved : Date.now();
}

export function pruneEsportsBattleMatches(
  matches: EsportsBattleMatch[],
  now = Date.now()
): EsportsBattleMatch[] {
  return matches.filter((m) => {
    const at = esportsBattleAnchorMs(m);
    return Number.isFinite(at) && now - at <= ESPORTS_BATTLE_RETENTION_MS;
  });
}

export function mergeEsportsBattleMatches(
  ...groups: EsportsBattleMatch[][]
): EsportsBattleMatch[] {
  const byId = new Map<string, EsportsBattleMatch>();
  for (const group of groups) {
    for (const m of group) {
      if (!m?.id) continue;
      const prev = byId.get(m.id);
      if (!prev) {
        byId.set(m.id, {
          ...m,
          savedAt: m.savedAt || new Date().toISOString(),
        });
        continue;
      }
      byId.set(m.id, {
        ...prev,
        ...m,
        savedAt: prev.savedAt || m.savedAt || new Date().toISOString(),
        homeGoals: m.homeGoals ?? prev.homeGoals,
        awayGoals: m.awayGoals ?? prev.awayGoals,
        totalGoals:
          (m.homeGoals ?? prev.homeGoals) + (m.awayGoals ?? prev.awayGoals),
      });
    }
  }
  return pruneEsportsBattleMatches([...byId.values()]).sort(
    (a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)
  );
}
