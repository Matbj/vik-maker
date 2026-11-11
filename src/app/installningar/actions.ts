"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { playerRef, recordAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { GROUPING_NOTES_KEY } from "@/lib/grouping/preferences";
import { runDailySync } from "@/lib/svenskalag/sync";

export type SettingsState = { error?: string; saved?: boolean };

export type SyncState = { error?: string; workouts?: number };

/** Runs the daily sync now, for a coach who doesn't want to wait for it. */
export async function syncNow(): Promise<SyncState> {
  try {
    const result = await runDailySync();
    revalidatePath("/", "layout");
    await recordAudit("sync.run", () => ({
      workouts: result.workouts,
      players: result.players,
      coaches: result.coaches,
    }));
    return { workouts: result.workouts };
  } catch (error) {
    console.error("the sync started from the settings page failed:", error);
    return {
      error:
        error instanceof UserError
          ? error.message
          : "Synkningen med svenskalag.se misslyckades. Försök igen om en liten stund.",
    };
  }
}

const pairForm = z.object({ playerA: z.uuid(), playerB: z.uuid() });

function recordSeparation(
  action: "separation.add" | "separation.remove",
  playerAId: string,
  playerBId: string,
) {
  return recordAudit(action, async () => ({
    playerA: await playerRef(playerAId),
    playerB: await playerRef(playerBId),
  }));
}

export async function addSeparation(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const form = pairForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Välj två spelare." };
  if (form.data.playerA === form.data.playerB) return { error: "Välj två olika spelare." };

  const [playerAId, playerBId] = [form.data.playerA, form.data.playerB].sort();
  const added = await getDb()
    .insert(schema.playerSeparations)
    .values({ playerAId, playerBId })
    .onConflictDoNothing()
    .returning({ playerAId: schema.playerSeparations.playerAId });
  if (added.length > 0) await recordSeparation("separation.add", playerAId, playerBId);
  revalidatePath("/installningar");
  return {};
}

export async function removeSeparation(formData: FormData) {
  const form = z
    .object({ playerAId: z.uuid(), playerBId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!form.success) return;

  const removed = await getDb()
    .delete(schema.playerSeparations)
    .where(
      and(
        eq(schema.playerSeparations.playerAId, form.data.playerAId),
        eq(schema.playerSeparations.playerBId, form.data.playerBId),
      ),
    )
    .returning({ playerAId: schema.playerSeparations.playerAId });
  if (removed.length > 0) {
    await recordSeparation("separation.remove", form.data.playerAId, form.data.playerBId);
  }
  revalidatePath("/installningar");
}

export async function saveGroupingNotes(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const value = z.string().max(2000).safeParse(formData.get("notes"));
  if (!value.success) return { error: "Anteckningarna får vara högst 2000 tecken." };

  const db = getDb();
  const notes = value.data.trim();
  const [previous] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, GROUPING_NOTES_KEY));
  await db
    .insert(schema.appSettings)
    .values({ key: GROUPING_NOTES_KEY, value: notes })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });
  if ((previous?.value ?? "") !== notes) {
    await recordAudit("grouping_notes.update", () => ({
      before: previous?.value ?? "",
      after: notes,
    }));
  }
  revalidatePath("/installningar");
  return { saved: true };
}
