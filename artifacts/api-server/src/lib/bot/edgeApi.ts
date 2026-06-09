const EDGE_API_URL = "https://edge.skybox.gg/api/external";

async function edgeQuery(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(EDGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EDGE_API_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = (await response.json()) as { data: unknown; errors?: { message: string }[] };

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return data.data;
}

export interface PublicRoster {
  id: string;
  name: string;
  steamIds: string[];
  type: string;
}

export interface PublicMatchEntry {
  playedAt: string;
  rosterLeft: PublicRoster;
  rosterRight: PublicRoster;
  matches: {
    hash: string;
    map: string;
    alphaFinalScore: number;
    bravoFinalScore: number;
    winner: string;
  }[];
}

export async function fetchPublicMatches(
  pageSize = 50,
  pageNumber = 1,
  after?: string,
  before?: string,
): Promise<PublicMatchEntry[]> {
  const query = `
    query publicMatchesSearch(
      $pagination: StrawHatPaginationPageInput!
      $orderBy: PublicMatchesOrderBy!
      $direction: OrderDirection!
      $after: DateTime
      $before: DateTime
    ) {
      publicMatchesSearch(
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        after: $after
        before: $before
      ) {
        entries {
          playedAt
          rosterLeft { id name steamIds type }
          rosterRight { id name steamIds type }
          matches {
            hash
            map
            alphaFinalScore
            bravoFinalScore
            winner
          }
        }
        totalEntries
        totalPages
      }
    }
  `;
  const variables: Record<string, unknown> = {
    pagination: { pageNumber, pageSize },
    orderBy: "playedAt",
    direction: "desc",
    after: after ?? null,
    before: before ?? null,
  };
  const data = await edgeQuery(query, variables);
  const result = (data as { publicMatchesSearch: { entries: PublicMatchEntry[]; totalEntries: number; totalPages: number } }).publicMatchesSearch;
  return result.entries;
}

export async function fetchPlayerStatsForRosters(
  leftSteamIds: string[],
  rightSteamIds: string[],
  eventName: string | null = null
) {
  const [left, right] = await Promise.all([
    fetchPlayerStatsForRoster(leftSteamIds, eventName),
    fetchPlayerStatsForRoster(rightSteamIds, eventName),
  ]);
  return { left, right };
}

export async function fetchPlayerStatsForRoster(
  steamIds: string[],
  eventName: string | null = null
) {
  const query = `
    query matchesPlayerStats(
      $events: [String!]
      $public: Boolean
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesPlayerStats(
        events: $events
        public: $public
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        roundsFilters: $roundsFilters
      ) {
        playerStats {
          playerSteamId
          playerHandles
          mapsPlayed
          mapsWon
          roundsPlayed
          roundsWon
          kills
          deaths
          kasts
          assists
          hsKills
          damageGiven
          entryKills
          entryDeaths
          player { handle nationality }
        }
        totalMatches
      }
    }
  `;
  const variables = {
    events: eventName ? [eventName] : undefined,
    public: true,
    pagination: { pageNumber: 1, pageSize: 20 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: {
      rosterComparisons: [{ roster: steamIds }],
    },
  };
  const data = await edgeQuery(query, variables);
  return (data as { matchesPlayerStats: unknown }).matchesPlayerStats;
}

/**
 * Fetches aggregate player stats for an entire event from the EDGE API.
 * Returns a flat list of all players who participated, with their cumulative
 * stats across every match in that event.
 * Used for event-mode trivia where we ask "who led [event] in kills?" rather
 * than asking about a specific match.
 */
export async function fetchEventPlayerStats(eventName: string): Promise<unknown[]> {
  const query = `
    query matchesPlayerStats(
      $events: [String!]
      $public: Boolean
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesPlayerStats(
        events: $events
        public: $public
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        roundsFilters: $roundsFilters
      ) {
        playerStats {
          playerSteamId
          playerHandles
          mapsPlayed
          mapsWon
          roundsPlayed
          roundsWon
          kills
          deaths
          kasts
          assists
          hsKills
          damageGiven
          entryKills
          entryDeaths
          player { handle nationality }
        }
        totalMatches
      }
    }
  `;
  const variables = {
    events: [eventName],
    public: true,
    pagination: { pageNumber: 1, pageSize: 50 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: {},
  };
  try {
    const data = await edgeQuery(query, variables);
    const result = (data as { matchesPlayerStats: { playerStats: unknown[] } }).matchesPlayerStats;
    return result?.playerStats ?? [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetches per-player clutch statistics for a specific head-to-head match,
 * identified by the two rosters' Steam ID lists.
 * Returns 1v1 through 1v5 clutch attempts and wins for every player.
 */
export async function fetchClutchStats(
  leftSteamIds: string[],
  rightSteamIds: string[],
): Promise<unknown[]> {
  const query = `
    query matchesPlayerClutchStats(
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesPlayerClutchStats(
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        roundsFilters: $roundsFilters
      ) {
        playerClutchStats {
          playerSteamId
          playerHandles
          roundsPlayed
          clutch1v1Played
          clutch1v1Won
          clutch1v2Played
          clutch1v2Won
          clutch1v3Played
          clutch1v3Won
          clutch1v4Played
          clutch1v4Won
          clutch1v5Played
          clutch1v5Won
          player { handle }
        }
        totalMatches
      }
    }
  `;
  const variables = {
    pagination: { pageNumber: 1, pageSize: 20 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: {
      rosterComparisons: [
        { roster: leftSteamIds },
        { roster: rightSteamIds },
      ],
    },
  };
  try {
    const data = await edgeQuery(query, variables);
    const result = (data as { matchesPlayerClutchStats: { playerClutchStats: unknown[] } }).matchesPlayerClutchStats;
    return result?.playerClutchStats ?? [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetches bombsite attack/defend statistics for a specific head-to-head match.
 * Returns per-map, per-site (A/B) success rates for attack and defence.
 */
export async function fetchBombsiteStats(
  leftSteamIds: string[],
  rightSteamIds: string[],
): Promise<unknown[]> {
  const query = `
    query matchesBombsiteStats(
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesBombsiteStats(
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        roundsFilters: $roundsFilters
      ) {
        bombsiteStats {
          map
          site
          roundsAttackAttempts
          roundsAttackSuccess
          roundsDefendAttempts
          roundsDefendSuccess
          roundsAttackPostplantSuccess
          roundsDefendPostplantAttempts
          roundsDefendPostplantSuccess
        }
        totalMatches
      }
    }
  `;
  const variables = {
    pagination: { pageNumber: 1, pageSize: 20 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: {
      rosterComparisons: [
        { roster: leftSteamIds },
        { roster: rightSteamIds },
      ],
    },
  };
  try {
    const data = await edgeQuery(query, variables);
    const result = (data as { matchesBombsiteStats: { bombsiteStats: unknown[] } }).matchesBombsiteStats;
    return result?.bombsiteStats ?? [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetches veto statistics for a single team (identified by their Steam IDs),
 * showing how often they first-ban, second-ban, first-pick, or end up on each
 * map as a decider across their recent BO3 matches.
 *
 * Note: rosterComparisons is a required arg — we pass one roster (the team).
 * A head-to-head query (both rosters) returns empty; per-team history works.
 */
export async function fetchVetoStats(steamIds: string[]): Promise<unknown[]> {
  const query = `
    query vetoStats(
      $pagination: StrawHatPaginationPageInput!
      $orderBy: PublicMatchesOrderBy!
      $direction: OrderDirection!
      $rosterComparisons: [RosterComparison!]!
    ) {
      vetoStats(
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        rosterComparisons: $rosterComparisons
        publicLimitation: true
      ) {
        mapName
        preferenceScore
        bo3MapPoolCount
        bo3FirstBans { count }
        bo3SecondBans { count }
        bo3FirstPicks { count }
        bo3Deciders { count }
      }
    }
  `;
  const variables = {
    pagination: { pageNumber: 1, pageSize: 20 },
    orderBy: "playedAt",
    direction: "desc",
    rosterComparisons: [{ roster: steamIds }],
  };
  try {
    const data = await edgeQuery(query, variables);
    const result = (data as { vetoStats: unknown[] }).vetoStats;
    // Only return maps that actually appeared in BO3s (pool count > 0)
    return (result ?? []).filter((m) => (m as { bo3MapPoolCount: number }).bo3MapPoolCount > 0);
  } catch (err) {
    return [];
  }
}

export interface EventEntry {
  name: string;
  slug: string;
  lastMatchPlayedAt: string;
}

interface EventSearchResult {
  entries: EventEntry[];
  totalEntries: number;
  totalPages: number;
}

const EVENT_SEARCH_QUERY = `
  query matchesEventSearch(
    $pagination: StrawHatPaginationPageInput!
    $orderBy: MatchesEventsOrderBy!
    $direction: OrderDirection!
  ) {
    matchesEventSearch(
      pagination: $pagination
      orderBy: $orderBy
      direction: $direction
    ) {
      entries {
        name
        slug
        lastMatchPlayedAt
      }
      totalEntries
      totalPages
    }
  }
`;

export async function fetchAvailableEvents(page = 1): Promise<EventSearchResult> {
  const variables = {
    pagination: { pageNumber: page, pageSize: 25 },
    orderBy: "lastMatchPlayedAt",
    direction: "desc",
  };
  const data = await edgeQuery(EVENT_SEARCH_QUERY, variables);
  return (data as { matchesEventSearch: EventSearchResult }).matchesEventSearch;
}

/**
 * Fetches teams from recent public matches and returns a deduplicated,
 * alphabetically sorted list of team names.
 * Queries the last 30 days across multiple pages in parallel.
 */
export async function fetchTeamsFromRecentMatches(pages = 15): Promise<string[]> {
  const now = new Date();
  const after = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const before = now.toISOString().replace(/\.\d{3}Z$/, "Z");

  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) =>
      fetchPublicMatches(50, i + 1, after, before)
    )
  );

  const teamNames = new Set<string>();
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const match of result.value) {
        if (match.rosterLeft?.name) teamNames.add(match.rosterLeft.name);
        if (match.rosterRight?.name) teamNames.add(match.rosterRight.name);
      }
    }
  }

  return Array.from(teamNames).sort((a, b) => a.localeCompare(b));
}

/**
 * Fetches every page of events from the EDGE API and returns the full list,
 * sorted by most recently played first.
 */
export async function fetchAllEvents(): Promise<EventEntry[]> {
  // Fetch page 1 first to learn the total page count
  const first = await fetchAvailableEvents(1);
  const allEntries: EventEntry[] = [...first.entries];

  if (first.totalPages > 1) {
    // Fetch all remaining pages in parallel
    const remaining = await Promise.all(
      Array.from({ length: first.totalPages - 1 }, (_, i) =>
        fetchAvailableEvents(i + 2)
      )
    );
    for (const page of remaining) {
      allEntries.push(...page.entries);
    }
  }

  return allEntries;
}
