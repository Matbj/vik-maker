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

/** Exactly `teamSize` per team when there are enough players; anyone beyond that is a reserve. */
export function buildTeams(
  players: TeamPlayer[],
  options: { teamCount: number; teamSize: number; twoLeagues: boolean },
  random: () => number = Math.random,
): BuiltTeam[] {
  const { teamCount, teamSize, twoLeagues } = options;
  const mixed = shuffled(players, random);
  const playing = mixed.slice(0, teamCount * teamSize).sort((a, b) => a.levelRank - b.levelRank);
  const reserves = mixed.slice(teamCount * teamSize);

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
  const teams: BuiltTeam[] = drafted.flatMap(({ league, teams: playerIds }) =>
    playerIds.map((ids) => ({ name: `Team ${++teamNumber}`, league, playerIds: ids })),
  );
  if (reserves.length > 0) {
    teams.push({ name: "Reserves", league: null, playerIds: reserves.map((p) => p.id) });
  }
  return teams;
}
