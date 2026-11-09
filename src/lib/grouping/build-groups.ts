/**
 * Builds leveled training groups for one workout.
 * Pure function: no DB or I/O, so it's easy to test and tweak.
 *
 * Current rule (deliberately simple, to be refined with the coaches):
 * one group per level, in level order. Players without a level end up in
 * an "Unassigned" group so nobody is silently dropped.
 */

export type GroupingLevel = { id: string; code: string; sortOrder: number };
export type GroupingPlayer = { id: string; name: string; levelId: string | null };
export type BuiltGroup = { name: string; levelCodes: string[]; playerIds: string[] };

export function buildGroups(levels: GroupingLevel[], attending: GroupingPlayer[]): BuiltGroup[] {
  const ordered = [...levels].sort((a, b) => a.sortOrder - b.sortOrder);
  const byLevel = new Map<string, string[]>();
  const unassigned: string[] = [];

  for (const player of attending) {
    if (player.levelId && ordered.some((l) => l.id === player.levelId)) {
      const list = byLevel.get(player.levelId) ?? [];
      list.push(player.id);
      byLevel.set(player.levelId, list);
    } else {
      unassigned.push(player.id);
    }
  }

  const groups: BuiltGroup[] = ordered
    .map((level) => ({
      name: level.code,
      levelCodes: [level.code],
      playerIds: byLevel.get(level.id) ?? [],
    }))
    .filter((g) => g.playerIds.length > 0);

  if (unassigned.length > 0) {
    groups.push({ name: "Unassigned", levelCodes: [], playerIds: unassigned });
  }
  return groups;
}
