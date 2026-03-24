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

export async function fetchPlayerStats(eventName: string | null = null, teamId: string | null = null) {
  const query = `
    query matchesPlayerStats(
      $teamId: ID
      $events: [String!]
      $public: Boolean
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesPlayerStats(
        teamId: $teamId
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
    teamId,
    events: eventName ? [eventName] : undefined,
    public: true,
    pagination: { pageNumber: 1, pageSize: 1 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: { rosterComparisons: [] },
  };
  const data = await edgeQuery(query, variables);
  return (data as { matchesPlayerStats: unknown }).matchesPlayerStats;
}

export async function fetchTeamStats(eventName: string | null = null, teamId: string | null = null) {
  const query = `
    query matchesTeamStats(
      $teamId: ID
      $events: [String!]
      $public: Boolean
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesTeamStats(
        teamId: $teamId
        events: $events
        public: $public
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        roundsFilters: $roundsFilters
      ) {
        teamStats {
          map
          mapsPlayed
          mapsWon
          mapsLost
          roundsPlayed
          roundsWon
          roundsLost
          kills
          deaths
          kasts
          damageGiven
        }
        totalMatches
      }
    }
  `;
  const variables = {
    teamId,
    events: eventName ? [eventName] : undefined,
    public: true,
    pagination: { pageNumber: 1, pageSize: 1 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: { rosterComparisons: [] },
  };
  const data = await edgeQuery(query, variables);
  return (data as { matchesTeamStats: unknown }).matchesTeamStats;
}

export async function fetchMatches(eventName: string | null = null, teamId: string | null = null) {
  const query = `
    query matchesSearch(
      $teamId: ID
      $events: [String!]
      $public: Boolean
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
    ) {
      matchesSearch(
        teamId: $teamId
        events: $events
        public: $public
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
      ) {
        entries {
          hash
          map
          teamAlphaClan
          teamBravoClan
          alphaFinalScore
          bravoFinalScore
          winner
          playedAt
          event { name }
          playerStats {
            playerSteamId
            playerHandles
            stats { kills deaths kasts damageGiven }
          }
        }
        totalEntries
      }
    }
  `;
  const variables = {
    teamId,
    events: eventName ? [eventName] : undefined,
    public: true,
    pagination: { pageNumber: 1, pageSize: 20 },
    orderBy: "timestamp",
    direction: "desc",
  };
  const data = await edgeQuery(query, variables);
  return (data as { matchesSearch: unknown }).matchesSearch;
}

export async function fetchClutchStats(eventName: string | null = null, teamId: string | null = null) {
  const query = `
    query matchesPlayerClutchStats(
      $teamId: ID
      $events: [String!]
      $public: Boolean
      $pagination: StrawHatPaginationPageInput!
      $orderBy: MatchesOrderBy!
      $direction: OrderDirection!
      $roundsFilters: RoundsFilters!
    ) {
      matchesPlayerClutchStats(
        teamId: $teamId
        events: $events
        public: $public
        pagination: $pagination
        orderBy: $orderBy
        direction: $direction
        roundsFilters: $roundsFilters
      ) {
        playerClutchStats {
          playerSteamId
          playerHandles
          clutch1v1Played
          clutch1v1Won
          clutch1v2Played
          clutch1v2Won
          clutch1v3Played
          clutch1v3Won
          player { handle }
        }
        totalMatches
      }
    }
  `;
  const variables = {
    teamId,
    events: eventName ? [eventName] : undefined,
    public: true,
    pagination: { pageNumber: 1, pageSize: 1 },
    orderBy: "timestamp",
    direction: "desc",
    roundsFilters: { rosterComparisons: [] },
  };
  const data = await edgeQuery(query, variables);
  return (data as { matchesPlayerClutchStats: unknown }).matchesPlayerClutchStats;
}
