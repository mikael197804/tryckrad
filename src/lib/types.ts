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

export type TableContext = {
  rank: number | null;
  points: number | null;
  played: number | null;
  leagueSize: number | null;
  comfort: "fighting" | "mid" | "comfortable" | "unknown";
  rankGapToOpponent: number | null;
  note: string;
};

export type RestSignal = {
  level: "none" | "possible" | "likely";
  note: string;
  nextMatchDescription: string | null;
  nextOpponentRank: number | null;
  hoursUntilNext: number | null;
};

export type GoalAnalysis = {
  sport: "hockey" | "football";
  expectedGoals: number | null;
  likelyRange: string;
  over25ProbPct: number | null;
  over35ProbPct: number | null;
  over45ProbPct: number | null;
  over55ProbPct: number | null;
  mainLine: number | null;
  mainLineOverOdds: number | null;
  homeAttackNeed: "low" | "medium" | "high";
  awayAttackNeed: "low" | "medium" | "high";
  homeNeedNote: string;
  awayNeedNote: string;
  note: string;
};

export type LineupImpactItem = {
  side: "home" | "away";
  player: string;
  status: "out" | "doubt" | "returned";
  impact: "worse" | "better" | "neutral";
  severity: "low" | "medium" | "high";
  note: string;
  source: string;
};

export type LateLineupAnalysis = {
  windowActive: boolean;
  minutesToKickoff: number | null;
  homeImpact: "better" | "worse" | "neutral" | "unknown";
  awayImpact: "better" | "worse" | "neutral" | "unknown";
  items: LineupImpactItem[];
  oddsDriftNote: string | null;
  note: string;
  analyzedAt: string;
};

export type OutcomeValueInfo = {
  outcome: Outcome;
  odds: number | null;
  folkPct: number;
  isOverOdds: boolean;
  isValue: boolean;
  isTrashLongshot: boolean;
  scoreBoost: number;
  note: string;
};

export type ValueOddsInfo = {
  outcomes: OutcomeValueInfo[];
  bestValue: Outcome | null;
  overOddsOutcomes: Outcome[];
  folkOddsDisagree: boolean;
  note: string;
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
  homeTable: TableContext;
  awayTable: TableContext;
  homeRest: RestSignal;
  awayRest: RestSignal;
  goals: GoalAnalysis;
  lineup: LateLineupAnalysis;
  valueOdds: ValueOddsInfo;
  /** Måltipset: rank 1 = högst förväntat målantal */
  goalRank: number | null;
  malSelected: boolean;
  pick: Outcome[];
  pickReason: string;
  score1: number;
  scoreX: number;
  score2: number;
};

export type DrawBundle = {
  drawNumber: number;
  productName: string;
  productKind: "powerplay" | "topptipset" | "stryktipset" | "maltipset";
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
  tableAlerts: string[];
  restAlerts: string[];
  goalAlerts: string[];
  lineupAlerts: string[];
  valueAlerts: string[];
  /** Måltipset: de 8 högst rankade matchnumren */
  malTip: number[];
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
  kind?: "1x2" | "mal";
  /** Måltipset: markerade matchnummer (M8–M14) */
  malEventNumbers?: number[];
};
