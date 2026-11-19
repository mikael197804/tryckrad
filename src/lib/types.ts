export type Outcome = "1" | "X" | "2";

export type Odds = {
  one: number | null;
  x: number | null;
  two: number | null;
};

export type Distribution = {
  one: number;
  x: number;
  two: number;
};

export type TeamInfo = {
  id: number;
  name: string;
  shortName: string;
  type: "home" | "away";
};

export type UpcomingMatch = {
  drawNumber: number;
  closeTime: string;
  matchStart: string;
  description: string;
};

export type FatigueInfo = {
  level: "low" | "medium" | "high";
  gamesInWindow: number;
  hoursSincePrevious: number | null;
  hoursUntilNext: number | null;
  note: string;
  upcoming: UpcomingMatch[];
};

export type MatchAnalysis = {
  eventNumber: number;
  description: string;
  league: string;
  matchStart: string;
  matchId: number;
  home: TeamInfo;
  away: TeamInfo;
  odds: Odds;
  svenskaFolket: Distribution;
  favourite: Outcome;
  valueOutcomes: Outcome[];
  uncertainty: number;
  homeFatigue: FatigueInfo;
  awayFatigue: FatigueInfo;
  pick: Outcome[];
  pickReason: string;
  score1: number;
  scoreX: number;
  score2: number;
};

export type Article = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  matchedTeams: string[];
  drawNumbers: number[];
};

export type SystemPick = {
  eventNumber: number;
  description: string;
  outcomes: Outcome[];
  cover: "enkel" | "halv" | "hel";
  reason: string;
};

export type GeneratedSystem = {
  name: string;
  costKr: number;
  rows: number;
  picks: SystemPick[];
  summary: string;
  risk: "lågt" | "medel" | "högt";
};

export type DrawBundle = {
  drawNumber: number;
  productName: string;
  closeDescription: string;
  closeTime: string;
  openTime: string;
  rowPrice: number;
  netSale: string | null;
  sport: string;
  leagueSummary: string;
  matches: MatchAnalysis[];
  articles: Article[];
  systems: GeneratedSystem[];
  fatigueAlerts: string[];
};
