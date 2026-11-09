/** Rules for leveled groups. Pure functions, so they can check anything Claude proposes. */

export type LevelGroupProposal = { levelCodes: string[]; playerIds: string[] };
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
  return problems;
}

/** "A", "B1 + B2", and a number when several groups share the same levels. */
export function levelGroupNames(groups: { levelCodes: string[] }[]) {
  const base = groups.map((g) => g.levelCodes.join(" + "));
  const seen = new Map<string, number>();
  return base.map((name) => {
    if (base.filter((other) => other === name).length === 1) return name;
    const number = (seen.get(name) ?? 0) + 1;
    seen.set(name, number);
    return `${name} (${number})`;
  });
}
