/** Builds even teams from the players' levels. Pure, apart from the injected randomness. */

export type TeamPlayer = { id: string; levelRank: number };
export type BuiltTeam = { name: string; league: number | null; playerIds: string[] };

function shuffled<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Deals players out back and forth, so no team gets all the strongest picks. */
function snakeDraft(players: TeamPlayer[], teamCount: number) {
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  players.forEach((player, i) => {
    const round = Math.floor(i / teamCount);
    const position = i % teamCount;
    teams[round % 2 === 0 ? position : teamCount - 1 - position].push(player.id);
  });
  return teams;
}

/** Everyone plays: team sizes differ by at most one within a league. */
export function buildTeams(
  players: TeamPlayer[],
  options: { teamCount: number; twoLeagues: boolean },
  random: () => number = Math.random,
): BuiltTeam[] {
  const { teamCount, twoLeagues } = options;
  // Shuffled first, so the sort only fixes the level order and teams vary within it.
  const playing = shuffled(players, random).sort((a, b) => a.levelRank - b.levelRank);

  const firstLeagueTeams = twoLeagues ? Math.ceil(teamCount / 2) : teamCount;
  const firstLeaguePlayers = Math.round((playing.length * firstLeagueTeams) / teamCount);
  const drafted = [
    {
      league: twoLeagues ? 1 : null,
      teams: snakeDraft(playing.slice(0, firstLeaguePlayers), firstLeagueTeams),
    },
    ...(twoLeagues
      ? [{ league: 2, teams: snakeDraft(playing.slice(firstLeaguePlayers), teamCount - firstLeagueTeams) }]
      : []),
  ];

  let teamNumber = 0;
  return drafted.flatMap(({ league, teams }) =>
    teams.map((playerIds) => ({ name: `Team ${++teamNumber}`, league, playerIds })),
  );
}
