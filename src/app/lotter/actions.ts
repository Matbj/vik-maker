"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { playerRef, recordAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export type LotteryState = { error?: string; saved?: boolean };

const count = z.coerce.number().int().min(0).max(1000);

/** An empty field is left out, not zero. */
const optionalCount = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().int().min(1).max(1000).optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.iso.date().optional(),
);

const lotteryFields = z.object({
  name: z.string().trim().min(1).max(80),
  ticketPrice: z.coerce.number().int().min(0).max(10000),
  ticketsPerPlayer: optionalCount,
  dueOn: optionalDate,
});

const lotteryForm = lotteryFields.extend({ lotteryId: z.uuid() });

const ticketsForm = z.object({
  lotteryId: z.uuid(),
  playerId: z.uuid(),
  handedOut: count,
  paid: count,
  returned: count,
  // What the coach saw, so a change another coach just saved isn't overwritten.
  previousHandedOut: count,
  previousPaid: count,
  previousReturned: count,
});

const invalidLottery =
  "Fyll i ett namn och ett pris per lott. Antal lotter per spelare och sista dag kan lämnas tomma.";

function errorState(error: unknown, fallback: string): LotteryState {
  if (error instanceof UserError) return { error: error.message };
  console.error(error);
  return { error: fallback };
}

async function openLottery(id: string) {
  const { lotteries } = schema;
  const [lottery] = await getDb().select().from(lotteries).where(eq(lotteries.id, id));
  if (!lottery) throw new UserError("Lotteriförsäljningen finns inte längre.");
  if (lottery.closedAt) throw new UserError("Försäljningen är avslutad. Öppna den igen för att ändra något.");
  return lottery;
}

export async function createLottery(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = lotteryFields.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: invalidLottery };

  const [lottery] = await getDb()
    .insert(schema.lotteries)
    .values({
      name: form.data.name,
      ticketPrice: form.data.ticketPrice,
      ticketsPerPlayer: form.data.ticketsPerPlayer ?? null,
      dueOn: form.data.dueOn ?? null,
    })
    .returning();
  await recordAudit("lottery.create", () => ({
    lottery: { id: lottery.id, name: lottery.name },
    ticketPrice: lottery.ticketPrice,
    ticketsPerPlayer: lottery.ticketsPerPlayer,
    dueOn: lottery.dueOn,
  }));
  revalidatePath("/lotter");
  redirect(`/lotter/${lottery.id}`);
}

export async function updateLottery(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = lotteryForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: invalidLottery };

  try {
    const before = await openLottery(form.data.lotteryId);
    const after = {
      name: form.data.name,
      ticketPrice: form.data.ticketPrice,
      ticketsPerPlayer: form.data.ticketsPerPlayer ?? null,
      dueOn: form.data.dueOn ?? null,
    };
    await getDb().update(schema.lotteries).set(after).where(eq(schema.lotteries.id, before.id));
    await recordAudit("lottery.update", () => ({
      lottery: { id: before.id, name: after.name },
      before: {
        name: before.name,
        ticketPrice: before.ticketPrice,
        ticketsPerPlayer: before.ticketsPerPlayer,
        dueOn: before.dueOn,
      },
      after,
    }));
  } catch (error) {
    return errorState(error, "Det gick inte att spara försäljningen. Försök igen.");
  }
  revalidatePath("/lotter", "layout");
  return { saved: true };
}

export async function setLotteryClosed(formData: FormData) {
  const form = z
    .object({ lotteryId: z.uuid(), closed: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(formData));
  if (!form.success) return;

  const { lotteries } = schema;
  const closed = form.data.closed === "true";
  const changed = await getDb()
    .update(lotteries)
    .set({ closedAt: closed ? new Date() : null })
    .where(
      and(
        eq(lotteries.id, form.data.lotteryId),
        closed ? isNull(lotteries.closedAt) : sql`${lotteries.closedAt} is not null`,
      ),
    )
    .returning({ id: lotteries.id, name: lotteries.name });
  if (changed.length > 0) {
    await recordAudit(closed ? "lottery.close" : "lottery.reopen", () => ({ lottery: changed[0] }));
  }
  revalidatePath("/lotter", "layout");
}

export async function deleteLottery(formData: FormData) {
  const lotteryId = z.uuid().safeParse(formData.get("lotteryId"));
  if (!lotteryId.success) return;

  const removed = await getDb()
    .delete(schema.lotteries)
    .where(eq(schema.lotteries.id, lotteryId.data))
    .returning({ id: schema.lotteries.id, name: schema.lotteries.name });
  if (removed.length > 0) await recordAudit("lottery.delete", () => ({ lottery: removed[0] }));
  revalidatePath("/lotter", "layout");
  redirect("/lotter");
}

/** Hands the same number of tickets to every active player who hasn't been given any yet. */
export async function handOutToAll(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = z
    .object({ lotteryId: z.uuid(), tickets: z.coerce.number().int().min(1).max(1000) })
    .safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Skriv hur många lotter varje spelare ska få." };

  try {
    const lottery = await openLottery(form.data.lotteryId);
    // One statement, so a player another coach handed tickets to meanwhile keeps theirs.
    const { rows } = await getDb().execute(sql`
      insert into lottery_tickets (lottery_id, player_id, handed_out)
      select ${lottery.id}, p.id, ${form.data.tickets}
      from players p
      where p.active
        and exists (select 1 from lotteries l where l.id = ${lottery.id} and l.closed_at is null)
      on conflict (lottery_id, player_id) do update
        set handed_out = excluded.handed_out, updated_at = now()
        where lottery_tickets.handed_out = 0
      returning player_id
    `);
    const playerIds = rows.map((row) => String(row.player_id));
    if (playerIds.length > 0) {
      await recordAudit("lottery.hand_out_all", async () => ({
        lottery: { id: lottery.id, name: lottery.name },
        tickets: form.data.tickets,
        players: await Promise.all(playerIds.map(playerRef)),
      }));
    }
  } catch (error) {
    return errorState(error, "Det gick inte att dela ut lotterna. Försök igen.");
  }
  revalidatePath("/lotter", "layout");
  return { saved: true };
}

/** Saves how many tickets one player has been handed, paid for and handed back. */
export async function saveTickets(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = ticketsForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Skriv antal lotter med siffror, 0 eller mer." };
  const { lotteryId, playerId, handedOut, paid, returned } = form.data;
  if (paid + returned > handedOut) {
    return { error: "Betalda och tillbakalämnade lotter kan inte vara fler än de utdelade." };
  }
  const before = {
    handedOut: form.data.previousHandedOut,
    paid: form.data.previousPaid,
    returned: form.data.previousReturned,
  };
  if (before.handedOut === handedOut && before.paid === paid && before.returned === returned) {
    return { saved: true };
  }

  try {
    const lottery = await openLottery(lotteryId);
    // Only writes over the counts the coach saw, and a player without a row was seen as all zero.
    const { rows } = await getDb().execute(sql`
      insert into lottery_tickets (lottery_id, player_id, handed_out, paid, returned)
      select ${lotteryId}, ${playerId}, ${handedOut}, ${paid}, ${returned}
      where exists (select 1 from lotteries l where l.id = ${lotteryId} and l.closed_at is null)
        and (
          ${before.handedOut + before.paid + before.returned} = 0
          or exists (
            select 1 from lottery_tickets t where t.lottery_id = ${lotteryId} and t.player_id = ${playerId}
          )
        )
      on conflict (lottery_id, player_id) do update
        set handed_out = excluded.handed_out, paid = excluded.paid, returned = excluded.returned,
          updated_at = now()
        where lottery_tickets.handed_out = ${before.handedOut}
          and lottery_tickets.paid = ${before.paid}
          and lottery_tickets.returned = ${before.returned}
      returning player_id
    `);
    if (rows.length === 0) {
      throw new UserError("En annan ledare ändrade precis lotterna för spelaren. Kolla siffrorna och spara igen.");
    }
    await recordAudit("lottery.tickets", async () => ({
      lottery: { id: lottery.id, name: lottery.name },
      player: await playerRef(playerId),
      before,
      after: { handedOut, paid, returned },
    }));
  } catch (error) {
    return errorState(error, "Det gick inte att spara lotterna. Försök igen.");
  }
  revalidatePath("/lotter", "layout");
  return { saved: true };
}
