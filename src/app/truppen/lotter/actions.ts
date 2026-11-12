"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { playerRef, recordAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export type LotteryState = { error?: string; saved?: boolean };

const count = z.coerce.number().int().min(0).max(1000);

/** An empty field is left out, not zero. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());
}

const lotteryFields = z.object({
  name: z.string().trim().min(1).max(80),
  dueOn: optional(z.iso.date()),
});

const kindFields = z.object({
  id: optional(z.uuid()),
  name: z.string().trim().min(1).max(60),
  ticketPrice: z.coerce.number().int().min(0).max(10000),
  teamShare: optional(z.coerce.number().int().min(0).max(10000)),
  ticketsPerPlayer: optional(z.coerce.number().int().min(1).max(1000)),
});

type KindInput = z.infer<typeof kindFields>;

const invalidLottery =
  "Fyll i ett namn på försäljningen, och ett namn och ett pris för varje sorts lott. Lagets del kan inte vara mer än priset. Lagets del, antal per spelare och sista dag kan lämnas tomma.";

const ticketsChangedElsewhere =
  "En annan ledare ändrade precis lotterna för spelaren. Kolla siffrorna och spara igen.";

function errorState(error: unknown, fallback: string): LotteryState {
  if (error instanceof UserError) return { error: error.message };
  console.error(error);
  return { error: fallback };
}

/** The kinds are repeated fields, one set per row of the form, in order. */
function parseKinds(formData: FormData): KindInput[] | null {
  const ids = formData.getAll("kindId");
  const names = formData.getAll("kindName");
  const prices = formData.getAll("kindPrice");
  const shares = formData.getAll("kindTeamShare");
  const perPlayer = formData.getAll("kindPerPlayer");
  const kinds = z
    .array(kindFields)
    .min(1)
    .max(10)
    .safeParse(
      names.map((name, i) => ({
        id: ids[i],
        name,
        ticketPrice: prices[i],
        teamShare: shares[i],
        ticketsPerPlayer: perPlayer[i],
      })),
    );
  if (!kinds.success) return null;
  return kinds.data.some((kind) => (kind.teamShare ?? 0) > kind.ticketPrice) ? null : kinds.data;
}

function kindValues(kind: KindInput, sortOrder: number) {
  return {
    name: kind.name,
    ticketPrice: kind.ticketPrice,
    teamShare: kind.teamShare ?? null,
    ticketsPerPlayer: kind.ticketsPerPlayer ?? null,
    sortOrder,
  };
}

async function openLottery(id: string) {
  const { lotteries } = schema;
  const [lottery] = await getDb().select().from(lotteries).where(eq(lotteries.id, id));
  if (!lottery) throw new UserError("Lotteriförsäljningen finns inte längre.");
  if (lottery.closedAt) throw new UserError("Försäljningen är avslutad. Öppna den igen för att ändra något.");
  return lottery;
}

async function loadKinds(lotteryId: string) {
  const { lotteryKinds } = schema;
  return getDb()
    .select({
      id: lotteryKinds.id,
      name: lotteryKinds.name,
      ticketPrice: lotteryKinds.ticketPrice,
      teamShare: lotteryKinds.teamShare,
      ticketsPerPlayer: lotteryKinds.ticketsPerPlayer,
    })
    .from(lotteryKinds)
    .where(eq(lotteryKinds.lotteryId, lotteryId))
    .orderBy(asc(lotteryKinds.sortOrder));
}

export async function createLottery(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = lotteryFields.safeParse(Object.fromEntries(formData));
  const kinds = parseKinds(formData);
  if (!form.success || !kinds) return { error: invalidLottery };

  const db = getDb();
  const id = randomUUID();
  const lottery = { id, name: form.data.name, dueOn: form.data.dueOn ?? null };
  const kindRows = kinds.map((kind, i) => ({ ...kindValues(kind, i), lotteryId: id }));
  await db.batch([db.insert(schema.lotteries).values(lottery), db.insert(schema.lotteryKinds).values(kindRows)]);
  await recordAudit("lottery.create", () => ({
    lottery: { id, name: lottery.name },
    dueOn: lottery.dueOn,
    kinds: kindRows.map(({ name, ticketPrice, teamShare, ticketsPerPlayer }) => ({
      name,
      ticketPrice,
      teamShare,
      ticketsPerPlayer,
    })),
  }));
  revalidatePath("/truppen/lotter");
  redirect(`/truppen/lotter/${id}`);
}

export async function updateLottery(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = lotteryFields.extend({ lotteryId: z.uuid() }).safeParse(Object.fromEntries(formData));
  const kinds = parseKinds(formData);
  if (!form.success || !kinds) return { error: invalidLottery };

  try {
    const before = await openLottery(form.data.lotteryId);
    const kindsBefore = await loadKinds(before.id);
    const keptIds = new Set(kinds.flatMap((kind) => (kind.id ? [kind.id] : [])));
    const removed = kindsBefore.filter((kind) => !keptIds.has(kind.id));

    const db = getDb();
    const { lotteries, lotteryKinds, lotteryTickets } = schema;
    if (removed.length > 0) {
      const [handedOut] = await db
        .select({ name: lotteryKinds.name })
        .from(lotteryTickets)
        .innerJoin(lotteryKinds, eq(lotteryKinds.id, lotteryTickets.kindId))
        .where(and(inArray(lotteryTickets.kindId, removed.map((kind) => kind.id)), sql`${lotteryTickets.handedOut} > 0`))
        .limit(1);
      if (handedOut) {
        throw new UserError(`${handedOut.name} har redan delats ut till spelare och kan inte tas bort.`);
      }
    }

    const after = { name: form.data.name, dueOn: form.data.dueOn ?? null };
    const statements: BatchItem<"pg">[] = [
      db.update(lotteries).set(after).where(eq(lotteries.id, before.id)),
      ...kinds.map((kind, i) =>
        kind.id
          ? db
              .update(lotteryKinds)
              .set(kindValues(kind, i))
              .where(and(eq(lotteryKinds.id, kind.id), eq(lotteryKinds.lotteryId, before.id)))
          : db.insert(lotteryKinds).values({ ...kindValues(kind, i), lotteryId: before.id }),
      ),
    ];
    if (removed.length > 0) {
      statements.push(
        db.delete(lotteryKinds).where(
          and(
            eq(lotteryKinds.lotteryId, before.id),
            inArray(lotteryKinds.id, removed.map((kind) => kind.id)),
            // A kind handed out meanwhile is kept.
            sql`not exists (select 1 from lottery_tickets t where t.kind_id = ${lotteryKinds.id} and t.handed_out > 0)`,
          ),
        ),
      );
    }
    // One atomic batch, so the sale is never left with half its kinds changed.
    await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    await recordAudit("lottery.update", () => ({
      lottery: { id: before.id, name: after.name },
      before: {
        name: before.name,
        dueOn: before.dueOn,
        kinds: kindsBefore.map(({ name, ticketPrice, teamShare, ticketsPerPlayer }) => ({
          name,
          ticketPrice,
          teamShare,
          ticketsPerPlayer,
        })),
      },
      after: {
        ...after,
        kinds: kinds.map(({ name, ticketPrice, teamShare, ticketsPerPlayer }) => ({
          name,
          ticketPrice,
          teamShare: teamShare ?? null,
          ticketsPerPlayer: ticketsPerPlayer ?? null,
        })),
      },
    }));
  } catch (error) {
    return errorState(error, "Det gick inte att spara försäljningen. Försök igen.");
  }
  revalidatePath("/truppen/lotter", "layout");
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
  revalidatePath("/truppen/lotter", "layout");
}

export async function deleteLottery(formData: FormData) {
  const lotteryId = z.uuid().safeParse(formData.get("lotteryId"));
  if (!lotteryId.success) return;

  const removed = await getDb()
    .delete(schema.lotteries)
    .where(eq(schema.lotteries.id, lotteryId.data))
    .returning({ id: schema.lotteries.id, name: schema.lotteries.name });
  if (removed.length > 0) await recordAudit("lottery.delete", () => ({ lottery: removed[0] }));
  revalidatePath("/truppen/lotter", "layout");
  redirect("/truppen/lotter");
}

/** Hands every kind's usual number of tickets to a player who hasn't been handed any in the sale yet. */
export async function handOutUsual(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = z
    .object({ lotteryId: z.uuid(), playerId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Det gick inte att dela ut lotterna. Ladda om sidan och försök igen." };
  const { lotteryId, playerId } = form.data;

  try {
    const lottery = await openLottery(lotteryId);
    // One statement, so tickets another coach handed the player meanwhile are kept.
    const { rows } = await getDb().execute(sql`
      insert into lottery_tickets (kind_id, player_id, handed_out, handed_out_at)
      select k.id, p.id, k.tickets_per_player, now()
      from players p
      cross join lottery_kinds k
      join lotteries l on l.id = k.lottery_id and l.closed_at is null
      where k.lottery_id = ${lotteryId}
        and k.tickets_per_player is not null
        and p.id = ${playerId}
        and not exists (
          select 1 from lottery_tickets t
          join lottery_kinds tk on tk.id = t.kind_id
          where tk.lottery_id = ${lotteryId} and t.player_id = p.id and t.handed_out > 0
        )
      on conflict (kind_id, player_id) do update
        set handed_out = excluded.handed_out, handed_out_at = excluded.handed_out_at, updated_at = now()
        where lottery_tickets.handed_out = 0
      returning player_id
    `);
    if (rows.length === 0) throw new UserError(ticketsChangedElsewhere);
    const kinds = await loadKinds(lotteryId);
    await recordAudit("lottery.hand_out", async () => ({
      lottery: { id: lottery.id, name: lottery.name },
      player: await playerRef(playerId),
      kinds: kinds
        .filter((kind) => kind.ticketsPerPlayer !== null)
        .map((kind) => ({ id: kind.id, name: kind.name, tickets: kind.ticketsPerPlayer })),
    }));
  } catch (error) {
    return errorState(error, "Det gick inte att dela ut lotterna. Försök igen.");
  }
  revalidatePath("/truppen/lotter", "layout");
  return { saved: true };
}

const ticketCounts = z.object({ handedOut: count, paid: count, returned: count });
type TicketInput = z.infer<typeof ticketCounts>;

/**
 * Saves how many tickets of each kind one player has been handed, paid for and handed back.
 * Each kind sends its counts and the counts the coach saw, named `handedOut.<kind id>` and
 * `previous.handedOut.<kind id>`, so a change another coach just saved isn't overwritten.
 */
export async function saveTickets(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const ids = z.object({ lotteryId: z.uuid(), playerId: z.uuid() }).safeParse(Object.fromEntries(formData));
  const kindIds = z.array(z.uuid()).min(1).max(10).safeParse(formData.getAll("kindId"));
  if (!ids.success || !kindIds.success) return { error: "Lotterna kunde inte sparas. Ladda om sidan och försök igen." };
  const { lotteryId, playerId } = ids.data;

  const entries: { kindId: string; after: TicketInput; before: TicketInput }[] = [];
  for (const kindId of kindIds.data) {
    const read = (prefix: string) =>
      ticketCounts.safeParse({
        handedOut: formData.get(`${prefix}handedOut.${kindId}`),
        paid: formData.get(`${prefix}paid.${kindId}`),
        returned: formData.get(`${prefix}returned.${kindId}`),
      });
    const after = read("");
    const before = read("previous.");
    if (!after.success || !before.success) return { error: "Skriv antal lotter med siffror, 0 eller mer." };
    if (after.data.paid + after.data.returned > after.data.handedOut) {
      return { error: "Betalda och tillbakalämnade lotter kan inte vara fler än de utdelade." };
    }
    const changed = (Object.keys(after.data) as (keyof typeof after.data)[]).some(
      (key) => after.data[key] !== before.data[key],
    );
    if (changed) entries.push({ kindId, after: after.data, before: before.data });
  }
  if (entries.length === 0) return { saved: true };

  try {
    const lottery = await openLottery(lotteryId);
    const values = sql.join(
      entries.map(
        ({ kindId, after, before }) =>
          sql`(${kindId}::uuid, ${after.handedOut}::int, ${after.paid}::int, ${after.returned}::int, ${before.handedOut}::int, ${before.paid}::int, ${before.returned}::int)`,
      ),
      sql`, `,
    );
    // Writes nothing unless every kind still has the counts the coach saw. A missing row was seen as all zero.
    const { rows } = await getDb().execute(sql`
      with input (kind_id, handed_out, paid, returned, seen_handed_out, seen_paid, seen_returned) as (
        values ${values}
      ),
      seen as (
        select bool_and(
          coalesce(t.handed_out, 0) = i.seen_handed_out
          and coalesce(t.paid, 0) = i.seen_paid
          and coalesce(t.returned, 0) = i.seen_returned
        ) as unchanged
        from input i
        left join lottery_tickets t on t.kind_id = i.kind_id and t.player_id = ${playerId}
      )
      insert into lottery_tickets (kind_id, player_id, handed_out, paid, returned, handed_out_at)
      select i.kind_id, ${playerId}, i.handed_out, i.paid, i.returned, case when i.handed_out > 0 then now() end
      from input i
      join lottery_kinds k on k.id = i.kind_id and k.lottery_id = ${lotteryId}
      join lotteries l on l.id = k.lottery_id and l.closed_at is null
      where (select unchanged from seen)
      on conflict (kind_id, player_id) do update
        set handed_out = excluded.handed_out, paid = excluded.paid, returned = excluded.returned,
          handed_out_at = case when excluded.handed_out > 0 then coalesce(lottery_tickets.handed_out_at, now()) end,
          updated_at = now()
      returning kind_id
    `);
    if (rows.length === 0) throw new UserError(ticketsChangedElsewhere);
    const kinds = await loadKinds(lotteryId);
    await recordAudit("lottery.tickets", async () => ({
      lottery: { id: lottery.id, name: lottery.name },
      player: await playerRef(playerId),
      kinds: entries.map(({ kindId, before, after }) => ({
        kind: { id: kindId, name: kinds.find((kind) => kind.id === kindId)?.name },
        before,
        after,
      })),
    }));
  } catch (error) {
    return errorState(error, "Det gick inte att spara lotterna. Försök igen.");
  }
  revalidatePath("/truppen/lotter", "layout");
  return { saved: true };
}

/** Takes back all of a player's tickets in a sale, as long as none are paid for or handed back. */
export async function undoHandOut(_previous: LotteryState, formData: FormData): Promise<LotteryState> {
  const form = z.object({ lotteryId: z.uuid(), playerId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Det gick inte att ångra utdelningen. Ladda om sidan och försök igen." };
  const { lotteryId, playerId } = form.data;

  try {
    const lottery = await openLottery(lotteryId);
    // One statement, so a payment another coach registered meanwhile stops it.
    const { rows } = await getDb().execute(sql`
      delete from lottery_tickets t
      using lottery_kinds k
      where k.id = t.kind_id
        and k.lottery_id = ${lotteryId}
        and t.player_id = ${playerId}
        and not exists (
          select 1 from lottery_tickets t2
          join lottery_kinds k2 on k2.id = t2.kind_id
          where k2.lottery_id = ${lotteryId} and t2.player_id = ${playerId} and (t2.paid > 0 or t2.returned > 0)
        )
      returning k.name, t.handed_out
    `);
    if (rows.length === 0) {
      throw new UserError("Spelaren har redan betalt eller lämnat tillbaka lotter, så utdelningen kan inte ångras.");
    }
    await recordAudit("lottery.undo_hand_out", async () => ({
      lottery: { id: lottery.id, name: lottery.name },
      player: await playerRef(playerId),
      kinds: rows.map((row) => ({ name: row.name, handedOut: row.handed_out })),
    }));
  } catch (error) {
    return errorState(error, "Det gick inte att ångra utdelningen. Försök igen.");
  }
  revalidatePath("/truppen/lotter", "layout");
  return { saved: true };
}
