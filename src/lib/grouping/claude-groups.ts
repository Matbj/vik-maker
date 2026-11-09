import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "@/lib/env";
import {
  findGroupingProblems,
  findSpreadProblems,
  type LevelGroupProposal,
  type SpreadGroup,
  type SpreadPlacement,
} from "./level-groups";
import type { PlayerWithHistory } from "./workout-players";

const ATTEMPTS = 2;

const proposalSchema = z.object({
  groups: z.array(z.object({ levelCodes: z.array(z.string()), playerIds: z.array(z.string()) })),
});

const spreadSchema = z.object({
  placements: z.array(z.object({ playerId: z.string(), groupId: z.string() })),
});

const SYSTEM_PROMPT = `You split the youth football players at one training session into leveled groups for their coaches. Each player has a home level set by the coaches. Levels are listed strongest first.

Group players so everyone in a group is of similar level, and keep the groups fairly even in size. Use exactly the requested number of groups, ordered strongest first, and give each group the adjacent levels it plays at. When there are fewer groups than levels, merge adjacent levels. When there are more groups than levels, split a level across groups.

Don't simply copy the home levels: rotate some players so the groups stay fresh and fair, usually a small minority of each level.
- A player who has trained regularly and stayed at their home level for the last several workouts should be more likely to spend this workout one level up, for example a B1 player trying A.
- A player who has missed several recent workouts should be more likely to spend this workout one level down, for example an A player easing back in with B1. The same applies between all levels.
- Avoid moving the same player in consecutive workouts when others are due.

Hard rule: a player may never play more than one level away from their home level. A player with no home level can go in any group.

Each player's history is newest first. "attended" says if they trained, and "played" is the levels of the group they were in, or null if no groups were made that day. Every player must be placed exactly once, using their given id.`;

const SPREAD_PROMPT = `Players at a youth football training session have already been split into groups or teams by their coaches. Some more players have now turned up. Place each new player in one of the existing groups, and never change anyone already placed.

Each group lists the levels it plays at, strongest first, and the home levels of its members. Levels are listed strongest first. Members marked absent aren't there, so they don't count towards a group's size or strength, and new players can fill their spots.

Leveled groups have levels. Put a new player in a group of similar level, and never more than one level away from their home level. A player with no home level can go anywhere. A player who has missed several recent workouts leans towards their own level or one below, and a regular who has stayed at their level can sometimes go one up.

Teams have no levels. Keep every team even in both size and strength, comparing the members' home levels. Teams in a league should stay comparable to each other. League 1 has the stronger players, so put stronger new players there, and avoid having a C player in the same league as A players.

Each player's history is newest first. Every new player must be placed exactly once, using the given ids.`;

/** Calls Claude until an answer passes the rules in code. */
async function askClaude<T>(
  system: string,
  input: string,
  schema: z.ZodType<T>,
  findProblems: (answer: T) => string[],
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
      throw new Error("Claude didn't return a usable answer. Please try again.");
    }

    const problems = findProblems(response.parsed_output);
    if (problems.length === 0) return response.parsed_output;
    feedback = `\n\nA previous attempt was rejected. Fix these problems:\n${problems.join("\n")}`;
  }

  throw new Error("Claude's answer broke the rules twice. Please try again.");
}

/**
 * Asks Claude for leveled groups and checks the answer against the rules in code.
 * Players are sent under throwaway ids, so no names leave the app.
 */
export async function proposeLevelGroups(
  players: PlayerWithHistory[],
  levelOrder: string[],
  groupCount: number,
): Promise<LevelGroupProposal[]> {
  const realIds = new Map(players.map((p, i) => [`p${i + 1}`, p.id]));
  const anonymous = players.map((p, i) => ({ ...p, id: `p${i + 1}` }));
  const input = JSON.stringify({
    groupCount,
    levelsStrongestFirst: levelOrder,
    players: anonymous.map(({ id, levelCode, history }) => ({ id, homeLevel: levelCode, history })),
  });

  const { groups } = await askClaude(SYSTEM_PROMPT, input, proposalSchema, ({ groups: proposed }) =>
    findGroupingProblems(proposed, anonymous, levelOrder, groupCount),
  );
  return groups.map((group) => ({
    levelCodes: group.levelCodes,
    playerIds: group.playerIds.map((id) => realIds.get(id)!),
  }));
}

/** Asks Claude where new players should go in groups or teams that already exist. */
export async function proposeSpread(
  newPlayers: PlayerWithHistory[],
  groups: SpreadGroup[],
  levelOrder: string[],
): Promise<SpreadPlacement[]> {
  const realPlayerIds = new Map(newPlayers.map((p, i) => [`p${i + 1}`, p.id]));
  const realGroupIds = new Map(groups.map((g, i) => [`g${i + 1}`, g.id]));
  const anonymousPlayers = newPlayers.map((p, i) => ({ ...p, id: `p${i + 1}` }));
  const anonymousGroups = groups.map((g, i) => ({ ...g, id: `g${i + 1}` }));
  const input = JSON.stringify({
    levelsStrongestFirst: levelOrder,
    groups: anonymousGroups.map(({ id, levelCodes, league, members }) => ({
      id,
      levels: levelCodes,
      league,
      members: members.map((m) => ({ homeLevel: m.levelCode, absent: m.absent })),
    })),
    newPlayers: anonymousPlayers.map(({ id, levelCode, history }) => ({ id, homeLevel: levelCode, history })),
  });

  const { placements } = await askClaude(SPREAD_PROMPT, input, spreadSchema, ({ placements: proposed }) =>
    findSpreadProblems(proposed, anonymousPlayers, anonymousGroups, levelOrder),
  );
  return placements.map(({ playerId, groupId }) => ({
    playerId: realPlayerIds.get(playerId)!,
    groupId: realGroupIds.get(groupId)!,
  }));
}
