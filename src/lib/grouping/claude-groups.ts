import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "@/lib/env";
import { UserError } from "@/lib/errors";
import {
  findGroupingProblems,
  findSizeProblems,
  findSeparationProblems,
  findSpreadProblems,
  findSpreadSeparationProblems,
  type LevelGroupProposal,
  type PlayerPair,
  type SpreadGroup,
  type SpreadPlacement,
} from "./level-groups";
import {
  findLeagueMixProblems,
  findLeagueOrderProblems,
  findLevelBalanceProblems,
  findTeamProblems,
  findUnevenLeagueProblems,
  leagueSizes,
  type ProposedTeam,
} from "./teams";
import type { PlayerWithHistory } from "./workout-players";

const ATTEMPTS = 3;

const proposalSchema = z.object({
  groups: z.array(
    z.object({ name: z.string(), levelCodes: z.array(z.string()), playerIds: z.array(z.string()) }),
  ),
});

const spreadSchema = z.object({
  placements: z.array(z.object({ playerId: z.string(), groupId: z.string() })),
});

const teamsSchema = z.object({
  teams: z.array(z.object({ league: z.number().nullable(), playerIds: z.array(z.string()) })),
});

const PREFERENCES_PROMPT = `"keepApart" lists pairs of players the coaches would very much rather not have together. Avoid putting both in the same group or team, and only do it when there is really no reasonable way around it. "coachNotes" holds the coaches' own guidance; follow it wherever it doesn't break the rules above.`;

const TEAMS_PROMPT = `You split the youth football players at one training session into teams for small games, for their coaches. Each player has a home level set by the coaches, and levels are listed strongest first.

Use exactly teamCount teams, put every player on exactly one team, and make team sizes differ by at most one. Make the teams even in strength by spreading the players of each home level evenly over the teams, so every team gets a similar mix of levels and the games are close. Never sort the teams by level: with 4 teams and 8 A players, each team gets two A players, not one team all of them.

"recentTeams" lists the teams from recent workouts, newest first. Avoid putting the same players together again when you can, so everyone gets to play with different teammates.

Each player's history is newest first.`;

const SINGLE_LEAGUE_PROMPT = `All teams play in one league, so set "league" to null on every team.`;

const LEAGUES_PROMPT = `Split the teams into leagueCount leagues by strength: league 1 gets the strongest players, league 2 the next, and league 3, if there is one, the weakest. Order the players by home level: nobody may play in a weaker league than a player with a weaker home level, so a B1 player never goes in league 3 while a C player is in league 2. Players of the same level can be split across neighbouring leagues to make the numbers work. "teamsPerLeague" gives how many teams each league has, league 1 first. Set "league" to the league's number on every team. Teams within a league play each other, so give them exactly the same number of players, such as 4 v 4 rather than 5 v 4, and keep them even in strength. When the players don't divide evenly, move a player or two between neighbouring leagues so that whole leagues get the bigger teams, and leave at most one league with uneven teams. A C player shouldn't share a league with A players. Within each league, spread the players of each level evenly over its teams.`;

const KEEP_GROUPS_PROMPT = `"currentGroups" lists the leveled groups the coaches have already made for this workout, strongest first. The coaches want the teams to stay as close to those groups as possible, so move as few players away from their groupmates as you can. With as many teams as groups, make each team one group. With more teams than groups, split each group into teams and keep those teams even with each other. With fewer teams than groups, combine neighbouring groups. With several leagues, the stronger groups go in the lower-numbered leagues. Only move a player when the rules on team count, team sizes and leagues require it, or to honour "keepApart". Staying close to the groups comes before evening out strength between teams from different groups, before ordering the leagues by home level, and before "recentTeams". Players who aren't in any group can go on any team.`;

const SYSTEM_PROMPT = `You split the youth football players at one training session into leveled groups for their coaches. Each player has a home level set by the coaches. Levels are listed strongest first.

Group players so everyone in a group is of similar level. Group sizes should differ by at most one. When a merged or crowded group ends up too big, even the sizes out with a chain of one-level moves through the neighbouring groups rather than leaving them uneven: with groups A + B1, B2 and C of 8, 6 and 5 players, move one B1 player down to the B2 group and one B2 player down to the C group, giving 7, 6 and 6. Choose the players who are most due for that move. Use exactly the requested number of groups, ordered strongest first, and give each group the adjacent levels it plays at. When there are fewer groups than levels, merge adjacent levels. When there are more groups than levels, split a level across groups.

Don't simply copy the home levels: rotate some players so the groups stay fresh and fair, usually a small minority of each level.
- A player who has trained regularly and stayed at their home level for the last several workouts should be more likely to spend this workout one level up, for example a B1 player trying A.
- A player who has missed several recent workouts should be more likely to spend this workout one level down, for example an A player easing back in with B1. The same applies between all levels.
- Avoid moving the same player in consecutive workouts when others are due.

Hard rule: a player may never play more than one level away from their home level. A player with no home level can go in any group.

Name each group after a god from Greek or Norse mythology, using the common Swedish spelling. The name must start with the letter of the group's strongest level, so an A group could be Athena, Apollon or Asa-Tor, a B group Balder, Brage or Boreas, and a C group Chronos, Chaos or Circe. A group playing B1 + B2 starts with B. If no god fits, use another figure from those myths. Every name must be different, and vary the names from one time to the next.

Each player's history is newest first. "attended" says if they trained, and "played" is the levels of the group they were in, or null if no groups were made that day. Every player must be placed exactly once, using their given id.`;

const SPREAD_PROMPT = `Players at a youth football training session have already been split into groups or teams by their coaches. Some more players have now turned up. Place each new player in one of the existing groups, and never change anyone already placed.

Each group lists the levels it plays at, strongest first, and the home levels of its members. Levels are listed strongest first. Members marked absent aren't there, so they don't count towards a group's size or strength, and new players can fill their spots.

Leveled groups have levels. Put a new player in a group of similar level, and never more than one level away from their home level. A player with no home level can go anywhere. A player who has missed several recent workouts leans towards their own level or one below, and a regular who has stayed at their level can sometimes go one up.

Teams have no levels. Keep every team even in both size and strength, comparing the members' home levels. Teams in a league should stay comparable to each other. League 1 has the strongest players and higher-numbered leagues weaker ones, so put new players in a league that matches their level, and avoid having a C player in the same league as A players.

Each player's history is newest first. Every new player must be placed exactly once, using the given ids.`;

/**
 * Calls Claude until an answer passes the rules in code. Preferences get the same
 * retries, but the last answer is accepted if it only misses those.
 */
async function askClaude<T>(
  system: string,
  input: string,
  schema: z.ZodType<T>,
  findProblems: (answer: T) => string[],
  findPreferenceProblems: (answer: T) => string[] = () => [],
): Promise<T> {
  const client = new Anthropic({ apiKey: requireEnv("CLAUDE_API_KEY") });

  let feedback = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const response = await client.messages.parse({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: `${input}${feedback}` }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new UserError("Resultatet gick inte att använda. Försök igen.");
    }

    const rules = findProblems(response.parsed_output);
    const preferences = findPreferenceProblems(response.parsed_output);
    if (rules.length === 0 && (preferences.length === 0 || attempt === ATTEMPTS - 1)) {
      return response.parsed_output;
    }
    const problems = [...rules, ...preferences];
    feedback = `\n\nA previous attempt was rejected. Fix these problems:\n${problems.join("\n")}`;
  }

  throw new UserError("Resultatet bröt mot reglerna flera gånger. Försök igen.");
}

type Preferences = { keepApart: PlayerPair[]; notes: string };

/** Keeps only the pairs where both players are in this request, under their throwaway ids. */
function anonymousPairs(pairs: PlayerPair[], aliases: Map<string, string>): PlayerPair[] {
  return pairs.flatMap(([a, b]) => {
    const aliasA = aliases.get(a);
    const aliasB = aliases.get(b);
    return aliasA && aliasB ? [[aliasA, aliasB] as PlayerPair] : [];
  });
}

/**
 * Asks Claude for leveled groups and checks the answer against the rules in code.
 * Players are sent under throwaway ids, so no names leave the app.
 */
export async function proposeLevelGroups(
  players: PlayerWithHistory[],
  levelOrder: string[],
  groupCount: number,
  preferences: Preferences,
): Promise<LevelGroupProposal[]> {
  const aliases = new Map(players.map((p, i) => [p.id, `p${i + 1}`]));
  const realIds = new Map([...aliases].map(([real, alias]) => [alias, real]));
  const anonymous = players.map((p) => ({ ...p, id: aliases.get(p.id)! }));
  const keepApart = anonymousPairs(preferences.keepApart, aliases);
  const input = JSON.stringify({
    groupCount,
    levelsStrongestFirst: levelOrder,
    players: anonymous.map(({ id, levelCode, history }) => ({ id, homeLevel: levelCode, history })),
    keepApart,
    coachNotes: preferences.notes,
  });

  const { groups } = await askClaude(
    `${SYSTEM_PROMPT}\n\n${PREFERENCES_PROMPT}`,
    input,
    proposalSchema,
    ({ groups: proposed }) => findGroupingProblems(proposed, anonymous, levelOrder, groupCount),
    ({ groups: proposed }) => [
      ...findSeparationProblems(proposed, keepApart),
      ...findSizeProblems(proposed),
    ],
  );
  return groups.map((group) => ({
    name: group.name.trim(),
    levelCodes: group.levelCodes,
    playerIds: group.playerIds.map((id) => realIds.get(id)!),
  }));
}

/**
 * Asks Claude for even teams, optionally split into two or three leagues by level.
 * With currentGroups, the teams stay as close to those groups as possible.
 */
export async function proposeTeams(
  players: PlayerWithHistory[],
  levelOrder: string[],
  options: { teamCount: number; leagueCount: number },
  recentTeams: string[][][],
  currentGroups: string[][],
  preferences: Preferences,
): Promise<ProposedTeam[]> {
  const aliases = new Map(players.map((p, i) => [p.id, `p${i + 1}`]));
  const realIds = new Map([...aliases].map(([real, alias]) => [alias, real]));
  const anonymous = players.map((p) => ({ ...p, id: aliases.get(p.id)! }));
  const keepApart = anonymousPairs(preferences.keepApart, aliases);
  const groupsToKeep = currentGroups
    .map((group) => group.flatMap((id) => aliases.get(id) ?? []))
    .filter((group) => group.length > 0);
  const input = JSON.stringify({
    ...options,
    ...(options.leagueCount > 1 && { teamsPerLeague: leagueSizes(options.teamCount, options.leagueCount) }),
    levelsStrongestFirst: levelOrder,
    players: anonymous.map(({ id, levelCode, history }) => ({ id, homeLevel: levelCode, history })),
    recentTeams: recentTeams.map((teams) =>
      teams.map((team) => team.flatMap((id) => aliases.get(id) ?? [])),
    ),
    ...(groupsToKeep.length > 0 && { currentGroups: groupsToKeep }),
    keepApart,
    coachNotes: preferences.notes,
  });

  const { teams } = await askClaude(
    [
      TEAMS_PROMPT,
      options.leagueCount > 1 ? LEAGUES_PROMPT : SINGLE_LEAGUE_PROMPT,
      ...(groupsToKeep.length > 0 ? [KEEP_GROUPS_PROMPT] : []),
      PREFERENCES_PROMPT,
    ].join("\n\n"),
    input,
    teamsSchema,
    ({ teams: proposed }) => findTeamProblems(proposed, anonymous, options),
    ({ teams: proposed }) => [
      ...findSeparationProblems(proposed, keepApart),
      ...findLeagueMixProblems(proposed, anonymous, levelOrder, options.leagueCount),
      ...findUnevenLeagueProblems(proposed, options.leagueCount),
      // Kept groups already rotate players a level up or down, so they set the order and mix instead.
      ...(groupsToKeep.length > 0
        ? []
        : [
            ...findLeagueOrderProblems(proposed, anonymous, levelOrder, options.leagueCount),
            ...findLevelBalanceProblems(proposed, anonymous, levelOrder, options.leagueCount),
          ]),
    ],
  );
  return teams
    .map((team) => ({
      league: options.leagueCount > 1 ? team.league : null,
      playerIds: team.playerIds.map((id) => realIds.get(id)!),
    }))
    .sort((a, b) => (a.league ?? 0) - (b.league ?? 0));
}

/** Asks Claude where new players should go in groups or teams that already exist. */
export async function proposeSpread(
  newPlayers: PlayerWithHistory[],
  groups: SpreadGroup[],
  levelOrder: string[],
  preferences: Preferences,
): Promise<SpreadPlacement[]> {
  const aliases = new Map(newPlayers.map((p, i) => [p.id, `p${i + 1}`]));
  groups
    .flatMap((group) => group.members)
    .forEach((member, i) => aliases.set(member.id, `m${i + 1}`));
  const realPlayerIds = new Map([...aliases].map(([real, alias]) => [alias, real]));
  const realGroupIds = new Map(groups.map((g, i) => [`g${i + 1}`, g.id]));
  const anonymousPlayers = newPlayers.map((p) => ({ ...p, id: aliases.get(p.id)! }));
  const anonymousGroups = groups.map((g, i) => ({
    ...g,
    id: `g${i + 1}`,
    members: g.members.map((m) => ({ ...m, id: aliases.get(m.id)! })),
  }));
  const keepApart = anonymousPairs(preferences.keepApart, aliases);
  const input = JSON.stringify({
    levelsStrongestFirst: levelOrder,
    groups: anonymousGroups.map(({ id, levelCodes, league, members }) => ({
      id,
      levels: levelCodes,
      league,
      members: members.map((m) => ({ id: m.id, homeLevel: m.levelCode, absent: m.absent })),
    })),
    newPlayers: anonymousPlayers.map(({ id, levelCode, history }) => ({ id, homeLevel: levelCode, history })),
    keepApart,
    coachNotes: preferences.notes,
  });

  const { placements } = await askClaude(
    `${SPREAD_PROMPT}\n\n${PREFERENCES_PROMPT}`,
    input,
    spreadSchema,
    ({ placements: proposed }) =>
      findSpreadProblems(proposed, anonymousPlayers, anonymousGroups, levelOrder),
    ({ placements: proposed }) => findSpreadSeparationProblems(proposed, anonymousGroups, keepApart),
  );
  return placements.map(({ playerId, groupId }) => ({
    playerId: realPlayerIds.get(playerId)!,
    groupId: realGroupIds.get(groupId)!,
  }));
}
