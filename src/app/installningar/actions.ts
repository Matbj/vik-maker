"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { GROUPING_NOTES_KEY } from "@/lib/grouping/preferences";

export type SettingsState = { error?: string; saved?: boolean };

const pairForm = z.object({ playerA: z.uuid(), playerB: z.uuid() });

export async function addSeparation(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const form = pairForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Välj två spelare." };
  if (form.data.playerA === form.data.playerB) return { error: "Välj två olika spelare." };

  const [playerAId, playerBId] = [form.data.playerA, form.data.playerB].sort();
  await getDb()
    .insert(schema.playerSeparations)
    .values({ playerAId, playerBId })
    .onConflictDoNothing();
  revalidatePath("/installningar");
  return {};
}

export async function removeSeparation(formData: FormData) {
  const form = z
    .object({ playerAId: z.uuid(), playerBId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!form.success) return;

  await getDb()
    .delete(schema.playerSeparations)
    .where(
      and(
        eq(schema.playerSeparations.playerAId, form.data.playerAId),
        eq(schema.playerSeparations.playerBId, form.data.playerBId),
      ),
    );
  revalidatePath("/installningar");
}

export async function saveGroupingNotes(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const value = z.string().max(2000).safeParse(formData.get("notes"));
  if (!value.success) return { error: "Anteckningarna får vara högst 2000 tecken." };

  await getDb()
    .insert(schema.appSettings)
    .values({ key: GROUPING_NOTES_KEY, value: value.data.trim() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });
  revalidatePath("/installningar");
  return { saved: true };
}
