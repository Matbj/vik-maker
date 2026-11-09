import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "@/lib/env";
import { findGroupingProblems, type LevelGroupProposal } from "./level-groups";
import type { PlayerWithHistory } from "./workout-players";

const ATTEMPTS = 2;

const proposalSchema = z.object({
  groups: z.array(z.object({ levelCodes: z.array(z.string()), playerIds: z.array(z.string()) })),
});

const SYSTEM_PROMPT = `You split the youth football players at one training session into leveled groups for their coaches. Each player has a home level set by the coaches. Levels are listed strongest first.

Group players so everyone in a group is of similar level, and keep the groups fairly even in size. Use exactly the requested number of groups, ordered strongest first, and give each group the adjacent levels it plays at. When there are fewer groups than levels, merge adjacent levels. When there are more groups than levels, split a level across groups.

Don't simply copy the home levels: rotate some players so the groups stay fresh and fair, usually a small minority of each level.
- A player who has trained regularly and stayed at their home level for the last several workouts should be more likely to spend this workout one level up, for example a B1 player trying A.
- A player who has missed several recent workouts should be more likely to spend this workout one level down, for example an A player easing back in with B1. The same applies between all levels.
- Avoid moving the same player in consecutive workouts when others are due.

Hard rule: a player may never play more than one level away from their home level. A player with no home level can go in any group.

Each player's history is newest first. "attended" says if they trained, and "played" is the levels of the group they were in, or null if no groups were made that day. Every player must be placed exactly once, using their given id.`;

/**
 * Asks Claude for leveled groups and checks the answer against the rules in code.
 * Players are sent under throwaway ids, so no names leave the app.
 */
export async function proposeLevelGroups(
  players: PlayerWithHistory[],
  levelOrder: string[],
  groupCount: number,
): Promise<LevelGroupProposal[]> {
  const client = new Anthropic({ apiKey: requireEnv("CLAUDE_API_KEY") });
  const realIds = new Map(players.map((p, i) => [`p${i + 1}`, p.id]));
  const anonymous = players.map((p, i) => ({ ...p, id: `p${i + 1}` }));
  const input = JSON.stringify({
    groupCount,
    levelsStrongestFirst: levelOrder,
    players: anonymous.map(({ id, levelCode, history }) => ({ id, homeLevel: levelCode, history })),
  });

  let feedback = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const response = await client.messages.parse({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(proposalSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${input}${feedback}` }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error("Claude didn't return usable groups. Please try again.");
    }

    const { groups } = response.parsed_output;
    const problems = findGroupingProblems(groups, anonymous, levelOrder, groupCount);
    if (problems.length === 0) {
      return groups.map((group) => ({
        levelCodes: group.levelCodes,
        playerIds: group.playerIds.map((id) => realIds.get(id)!),
      }));
    }
    feedback = `\n\nA previous attempt was rejected. Fix these problems:\n${problems.join("\n")}`;
  }

  throw new Error("Claude's groups broke the level rules twice. Please try again.");
}
