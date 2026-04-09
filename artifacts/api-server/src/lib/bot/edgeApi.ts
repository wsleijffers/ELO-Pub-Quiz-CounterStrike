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

export async function fetchPublicMatches(pageSize = 20): Promise<PublicMatchEntry[]> {
  const query = `
    query publicMatchesSearch(
      $pagination: StrawHatPaginationPageInput!
      $orderBy: PublicMatchesOrderBy!
      $direction: OrderDirection!
    ) {
      publicMatchesSearch(
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
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
      }
    }
  `;
  const variables = {
    pagination: { pageNumber: 1, pageSize },
    orderBy: "playedAt",
    direction: "desc",
  };
  const data = await edgeQuery(query, variables);
  return ((data as { publicMatchesSearch: { entries: PublicMatchEntry[] } }).publicMatchesSearch.entries);
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

export async function fetchAvailableEvents(page = 1) {
  const query = `
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
  const variables = {
    pagination: { pageNumber: page, pageSize: 10 },
    orderBy: "lastMatchPlayedAt",
    direction: "desc",
  };
  const data = await edgeQuery(query, variables);
  return (data as { matchesEventSearch: unknown }).matchesEventSearch;
}
