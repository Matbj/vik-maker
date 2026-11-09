/** Rules for leveled groups. Pure functions, so they can check anything Claude proposes. */

export type LevelGroupProposal = { name: string; levelCodes: string[]; playerIds: string[] };
export type GroupingPlayer = { id: string; levelCode: string | null };

/** How far a player's own level is from a group's levels, and in which direction. */
export function levelMove(
  homeCode: string | null,
  groupCodes: string[],
  levelOrder: string[],
): { steps: number; direction: "up" | "down" | null } {
  const home = homeCode ? levelOrder.indexOf(homeCode) : -1;
  const indexes = groupCodes.map((code) => levelOrder.indexOf(code));
  if (home === -1 || indexes.length === 0) return { steps: 0, direction: null };

  // Levels are ordered strongest first, so a lower index is a stronger level.
  const strongest = Math.min(...indexes);
  const weakest = Math.max(...indexes);
  if (home > weakest) return { steps: home - weakest, direction: "up" };
  if (home < strongest) return { steps: strongest - home, direction: "down" };
  return { steps: 0, direction: null };
}

/** Everything wrong with a proposal. Empty means it can be used. */
export function findGroupingProblems(
  groups: LevelGroupProposal[],
  players: GroupingPlayer[],
  levelOrder: string[],
  groupCount: number,
): string[] {
  const problems: string[] = [];
  if (groups.length !== groupCount) {
    problems.push(`Expected ${groupCount} groups but got ${groups.length}.`);
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const placed = new Set<string>();
  let previousWeakest = -1;

  groups.forEach((group, i) => {
    const label = `Group ${i + 1}`;
    if (group.playerIds.length === 0) problems.push(`${label} has no players.`);

    const indexes = group.levelCodes.map((code) => levelOrder.indexOf(code));
    if (indexes.length === 0 || indexes.includes(-1)) {
      problems.push(`${label} must use levels from: ${levelOrder.join(", ")}.`);
      return;
    }
    const contiguous = indexes.every((index, n) => n === 0 || index === indexes[n - 1] + 1);
    if (!contiguous) problems.push(`${label} must list adjacent levels, strongest first.`);
    if (indexes[0] < previousWeakest) problems.push(`${label} is out of order, strongest group first.`);
    previousWeakest = indexes[indexes.length - 1];

    for (const id of group.playerIds) {
      const player = byId.get(id);
      if (!player) {
        problems.push(`${label} has unknown player ${id}.`);
      } else if (placed.has(id)) {
        problems.push(`Player ${id} is in more than one group.`);
      } else if (levelMove(player.levelCode, group.levelCodes, levelOrder).steps > 1) {
        problems.push(`Player ${id} (${player.levelCode}) moves more than one level in ${label}.`);
      }
      placed.add(id);
    }
  });

  const missing = players.filter((p) => !placed.has(p.id)).map((p) => p.id);
  if (missing.length > 0) problems.push(`Players not placed: ${missing.join(", ")}.`);

  const names = groups.map((group) => group.name.trim().toLowerCase());
  if (names.includes("") || new Set(names).size !== names.length) {
    problems.push("Every group needs its own name.");
  }
  groups.forEach((group, i) => {
    const letter = group.levelCodes[0]?.[0]?.toLowerCase();
    if (letter && !names[i].startsWith(letter)) {
      problems.push(`The name of group ${i + 1} must start with ${letter.toUpperCase()}.`);
    }
  });
  return problems;
}

/** Groups should be even, but level limits can make that impossible, so this is a preference. */
export function findSizeProblems(groups: LevelGroupProposal[]): string[] {
  const sizes = groups.map((group) => group.playerIds.length);
  if (Math.max(...sizes) - Math.min(...sizes) <= 1) return [];
  return [
    `Group sizes are ${sizes.join(", ")} but should differ by at most one. Even them out with a chain of one-level moves between neighbouring groups, for example one player from a larger group down to the next group and one from that group down to the smaller one.`,
  ];
}

export type PlayerPair = [string, string];

/** Pairs the coaches would rather keep apart that ended up in the same group. */
export function findSeparationProblems(groups: { playerIds: string[] }[], pairs: PlayerPair[]): string[] {
  if (groups.length < 2) return [];
  return pairs.flatMap(([a, b]) =>
    groups.some((group) => group.playerIds.includes(a) && group.playerIds.includes(b))
      ? [`Players ${a} and ${b} must not be in the same group.`]
      : [],
  );
}

export type SpreadGroup = {
  id: string;
  levelCodes: string[];
  league: number | null;
  members: { id: string; levelCode: string | null; absent: boolean }[];
};
export type SpreadPlacement = { playerId: string; groupId: string };

/** Keep-apart pairs that end up together once the new players are placed. */
export function findSpreadSeparationProblems(
  placements: SpreadPlacement[],
  groups: SpreadGroup[],
  keepApart: PlayerPair[],
): string[] {
  return findSeparationProblems(
    groups.map((group) => ({
      playerIds: [
        ...group.members.filter((member) => !member.absent).map((member) => member.id),
        ...placements.filter((p) => p.groupId === group.id).map((p) => p.playerId),
      ],
    })),
    keepApart,
  );
}

/** Everything wrong with where new players were put. Empty means it can be used. */
export function findSpreadProblems(
  placements: SpreadPlacement[],
  newPlayers: GroupingPlayer[],
  groups: SpreadGroup[],
  levelOrder: string[],
): string[] {
  const problems: string[] = [];
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const playersById = new Map(newPlayers.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const added = new Map<string, number>();

  for (const { playerId, groupId } of placements) {
    const player = playersById.get(playerId);
    const group = groupsById.get(groupId);
    if (!player) {
      problems.push(`Unknown player ${playerId}.`);
    } else if (!group) {
      problems.push(`Unknown group ${groupId}.`);
    } else if (placed.has(playerId)) {
      problems.push(`Player ${playerId} was placed more than once.`);
    } else if (levelMove(player.levelCode, group.levelCodes, levelOrder).steps > 1) {
      problems.push(`Player ${playerId} (${player.levelCode}) moves more than one level in ${groupId}.`);
    }
    placed.add(playerId);
    added.set(groupId, (added.get(groupId) ?? 0) + 1);
  }

  const missing = newPlayers.filter((p) => !placed.has(p.id)).map((p) => p.id);
  if (missing.length > 0) problems.push(`Players not placed: ${missing.join(", ")}.`);

  // Teams must stay even, counting only the players who are actually there.
  const teams = groups.filter((g) => g.levelCodes.length === 0);
  for (const league of new Set(teams.map((t) => t.league))) {
    const sizes = teams
      .filter((t) => t.league === league)
      .map((t) => ({ id: t.id, size: t.members.filter((m) => !m.absent).length }));
    const before = sizes.map((t) => t.size);
    const after = sizes.map((t) => t.size + (added.get(t.id) ?? 0));
    const allowedGap = Math.max(1, Math.max(...before) - Math.min(...before));
    if (Math.max(...after) - Math.min(...after) > allowedGap) {
      problems.push(`Teams are too uneven after placing players: ${after.join(", ")}.`);
    }
  }
  return problems;
}
