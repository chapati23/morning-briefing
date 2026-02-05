/**
 * Polymarket Correlation Mappings
 *
 * Maps prediction market patterns to traditional market implications.
 * Used to surface actionable trading signals from Polymarket movements.
 */

// ============================================================================
// Types
// ============================================================================

export interface MarketImplication {
  readonly asset: string;
  readonly direction: "long" | "short";
  readonly rationale: string;
}

interface MarketCorrelation {
  readonly patterns: readonly string[];
  readonly category: string;
  readonly implications: readonly MarketImplication[];
}

// ============================================================================
// Correlation Mappings
// ============================================================================

const MARKET_CORRELATIONS: readonly MarketCorrelation[] = [
  // Monetary Policy
  {
    patterns: [
      "fed",
      "fomc",
      "rate cut",
      "rate hike",
      "interest rate",
      "powell",
    ],
    category: "monetary-policy",
    implications: [
      {
        asset: "TLT",
        direction: "long",
        rationale: "Rate cuts -> bond prices up",
      },
      {
        asset: "QQQ",
        direction: "long",
        rationale: "Rate cuts -> growth stocks up",
      },
      {
        asset: "XLF",
        direction: "short",
        rationale: "Rate cuts -> bank margins compress",
      },
    ],
  },

  // Geopolitical - Middle East
  {
    patterns: [
      "iran",
      "israel",
      "middle east",
      "oil",
      "opec",
      "saudi",
      "gaza",
      "houthi",
    ],
    category: "geopolitical-energy",
    implications: [
      {
        asset: "USO",
        direction: "long",
        rationale: "Conflict -> oil supply risk",
      },
      { asset: "XLE", direction: "long", rationale: "Energy sector benefits" },
      {
        asset: "LMT",
        direction: "long",
        rationale: "Defense spending increase",
      },
    ],
  },

  // Geopolitical - Asia
  {
    patterns: ["china", "taiwan", "semiconductor", "tsmc", "xi jinping"],
    category: "geopolitical-asia",
    implications: [
      {
        asset: "TSM",
        direction: "short",
        rationale: "Supply chain disruption risk",
      },
      {
        asset: "SMH",
        direction: "short",
        rationale: "Semiconductor supply risk",
      },
      { asset: "INDA", direction: "short", rationale: "Regional instability" },
    ],
  },

  // Geopolitical - Europe/Russia
  {
    patterns: ["russia", "ukraine", "putin", "nato", "zelensky"],
    category: "geopolitical-europe",
    implications: [
      {
        asset: "EWG",
        direction: "short",
        rationale: "European energy/security risk",
      },
      { asset: "UNG", direction: "long", rationale: "Natural gas supply risk" },
      {
        asset: "LMT",
        direction: "long",
        rationale: "Defense spending increase",
      },
    ],
  },

  // US Politics - Republican / Trump Administration
  {
    patterns: [
      "trump",
      "vance",
      "republican",
      "gop",
      "maga",
      "desantis",
      "haley",
      "ramaswamy",
      "youngkin",
      "scott",
    ],
    category: "us-politics-right",
    implications: [
      { asset: "XLE", direction: "long", rationale: "Pro-fossil fuel policy" },
      {
        asset: "TAN",
        direction: "short",
        rationale: "Renewable subsidies at risk",
      },
      { asset: "XLF", direction: "long", rationale: "Deregulation expected" },
      { asset: "GEO", direction: "long", rationale: "Immigration enforcement" },
    ],
  },

  // US Politics - Democrat / 2028 Candidates
  {
    patterns: [
      "newsom",
      "whitmer",
      "shapiro",
      "buttigieg",
      "pritzker",
      "democrat",
      "democratic",
      "dnc",
      "ocasio",
      "aoc",
    ],
    category: "us-politics-left",
    implications: [
      {
        asset: "TAN",
        direction: "long",
        rationale: "Renewable energy support",
      },
      { asset: "XLV", direction: "long", rationale: "Healthcare expansion" },
      {
        asset: "XLE",
        direction: "short",
        rationale: "Fossil fuel restrictions",
      },
      { asset: "ICLN", direction: "long", rationale: "Clean energy policy" },
    ],
  },

  // Trump Admin - DOGE / Government Efficiency
  {
    patterns: [
      "doge",
      "musk",
      "government efficiency",
      "spending cuts",
      "ramaswamy",
    ],
    category: "trump-admin-doge",
    implications: [
      {
        asset: "TSLA",
        direction: "long",
        rationale: "Musk political influence",
      },
      {
        asset: "LMT",
        direction: "short",
        rationale: "Defense spending cuts risk",
      },
      {
        asset: "GD",
        direction: "short",
        rationale: "Government contractor risk",
      },
    ],
  },

  // Economic - Recession
  {
    patterns: [
      "recession",
      "gdp",
      "unemployment",
      "jobs report",
      "nonfarm",
      "jobless",
    ],
    category: "economic-recession",
    implications: [
      { asset: "TLT", direction: "long", rationale: "Flight to safety" },
      {
        asset: "XLY",
        direction: "short",
        rationale: "Consumer discretionary hurt",
      },
      { asset: "GLD", direction: "long", rationale: "Safe haven demand" },
    ],
  },

  // Economic - Inflation
  {
    patterns: ["inflation", "cpi", "pce", "price index", "core inflation"],
    category: "economic-inflation",
    implications: [
      { asset: "TIP", direction: "long", rationale: "Inflation protection" },
      { asset: "TLT", direction: "short", rationale: "Higher rates expected" },
      { asset: "GLD", direction: "long", rationale: "Inflation hedge" },
    ],
  },

  // Trade Policy
  {
    patterns: [
      "tariff",
      "trade war",
      "sanction",
      "import",
      "export ban",
      "trade deal",
    ],
    category: "trade-policy",
    implications: [
      { asset: "EEM", direction: "short", rationale: "Emerging markets hurt" },
      {
        asset: "IWM",
        direction: "short",
        rationale: "Small caps more exposed",
      },
      {
        asset: "DBA",
        direction: "long",
        rationale: "Agricultural commodities up",
      },
    ],
  },

  // Crypto Regulation
  {
    patterns: [
      "bitcoin etf",
      "sec crypto",
      "crypto regulation",
      "stablecoin",
      "gensler",
      "crypto ban",
    ],
    category: "crypto-regulation",
    implications: [
      {
        asset: "COIN",
        direction: "long",
        rationale: "Regulatory clarity bullish",
      },
      { asset: "MSTR", direction: "long", rationale: "Bitcoin proxy benefits" },
    ],
  },

  // Tech Regulation
  {
    patterns: ["antitrust", "breakup", "monopoly", "ftc", "doj lawsuit"],
    category: "tech-regulation",
    implications: [
      {
        asset: "META",
        direction: "short",
        rationale: "Antitrust enforcement risk",
      },
      { asset: "GOOGL", direction: "short", rationale: "Breakup risk" },
      { asset: "AMZN", direction: "short", rationale: "Regulatory scrutiny" },
    ],
  },
];

// ============================================================================
// Category Exclusions
// ============================================================================

/**
 * Categories to exclude from analysis.
 * These have high volume but no traditional market relevance.
 */
const EXCLUDED_CATEGORIES: readonly string[] = [
  "sports",
  "entertainment",
  "gaming",
  "esports",
  "pop culture",
  "celebrities",
];

// ============================================================================
// Matching Logic
// ============================================================================

/**
 * Find correlation mappings that match a market title.
 * Returns all matching correlations (a market can match multiple patterns).
 */
const findMatchingCorrelations = (
  marketTitle: string,
): readonly MarketCorrelation[] => {
  const titleLower = marketTitle.toLowerCase();

  return MARKET_CORRELATIONS.filter((correlation) =>
    correlation.patterns.some((pattern) =>
      titleLower.includes(pattern.toLowerCase()),
    ),
  );
};

/**
 * Get all unique trading implications for a market.
 * Deduplicates by asset if the same asset appears in multiple correlations.
 */
export const getImplicationsForMarket = (
  marketTitle: string,
): readonly MarketImplication[] => {
  const correlations = findMatchingCorrelations(marketTitle);
  const implications = correlations.flatMap((c) => c.implications);

  // Deduplicate by asset (keep first occurrence)
  const seen = new Set<string>();
  return implications.filter((imp) => {
    if (seen.has(imp.asset)) return false;
    seen.add(imp.asset);
    return true;
  });
};

/**
 * Sports and gaming keywords to filter out from titles.
 * Used when category is null or missing.
 */
const SPORTS_KEYWORDS: readonly string[] = [
  // Traditional sports
  "nba",
  "nfl",
  "mlb",
  "nhl",
  "pga",
  "ufc",
  "mma",
  "wnba",
  "football",
  "basketball",
  "baseball",
  "hockey",
  "soccer",
  "super bowl",
  "finals",
  "playoffs",
  "championship",
  "champion",
  "spread:",
  "moneyline",
  "over/under",
  "total points",
  // NBA teams
  "hornets",
  "lakers",
  "celtics",
  "warriors",
  "heat",
  "bulls",
  "knicks",
  "thunder",
  "nuggets",
  "bucks",
  "suns",
  "grizzlies",
  "timberwolves",
  "rockets",
  "pacers",
  "spurs",
  "mavericks",
  "clippers",
  "nets",
  "hawks",
  "cavaliers",
  "pistons",
  "raptors",
  "wizards",
  "magic",
  "sixers",
  "blazers",
  // NFL teams
  "chiefs",
  "eagles",
  "cowboys",
  "patriots",
  "ravens",
  "bills",
  "dolphins",
  "jets",
  "bengals",
  "steelers",
  "browns",
  "texans",
  "colts",
  "jaguars",
  "titans",
  "broncos",
  "raiders",
  "chargers",
  "seahawks",
  "49ers",
  "cardinals",
  "rams",
  "packers",
  "vikings",
  "bears",
  "lions",
  "saints",
  "falcons",
  "panthers",
  "buccaneers",
  "commanders",
  "giants",
  // MLB teams
  "yankees",
  "dodgers",
  "braves",
  "astros",
  "mets",
  "phillies",
  "padres",
  "red sox",
  "cubs",
  "white sox",
  "mariners",
  "giants",
  "cardinals",
  // Soccer
  "premier league",
  "la liga",
  "serie a",
  "bundesliga",
  "champions league",
  "uefa",
  "fifa",
  "world cup",
  // Esports
  "counter-strike",
  "csgo",
  "cs2",
  "valorant",
  "league of legends",
  "lol",
  "dota",
  "overwatch",
  "esports",
  "e-sports",
  "faze",
  "fnatic",
  "g2",
  "map winner",
  "match winner",
  // Generic sports patterns
  " vs. ",
  " vs ",
];

/**
 * Patterns for short-term price bets that shouldn't be considered "market moving".
 * These are essentially binary bets on daily price movements.
 */
const SHORT_TERM_PRICE_PATTERNS: readonly RegExp[] = [
  /will the price of .+ be (above|below|less than|greater than|over|under) \$/i,
  /\b(bitcoin|ethereum|eth|btc|solana|sol)\b.+\b(up or down|above|below)\b.+\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // Event titles like "Bitcoin price on February 2?"
  /\b(bitcoin|ethereum|eth|btc|solana|sol|crypto)\b.+price.+on\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
  // Generic daily price question
  /\bprice\b.+on\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+/i,
];

/**
 * Check if a category should be excluded from analysis.
 */
export const isExcludedCategory = (category: string): boolean => {
  const categoryLower = category.toLowerCase();
  return EXCLUDED_CATEGORIES.some(
    (excluded) =>
      categoryLower.includes(excluded) || excluded.includes(categoryLower),
  );
};

/**
 * Check if a market title indicates sports content.
 * Used as a fallback when category is null.
 */
export const isSportsTitle = (title: string): boolean => {
  const titleLower = title.toLowerCase();
  return SPORTS_KEYWORDS.some((keyword) => titleLower.includes(keyword));
};

/**
 * Check if a market is a short-term price bet (daily crypto price predictions).
 * These aren't really "market moving" - they're just volatility bets.
 */
export const isShortTermPriceBet = (title: string): boolean => {
  return SHORT_TERM_PRICE_PATTERNS.some((pattern) => pattern.test(title));
};
