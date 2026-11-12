import { z } from "zod";
import { currentCoach } from "@/lib/auth/sessions";
import { sealWorkoutLiveQueries } from "@/lib/realtime/live-queries";

/**
 * Renews the live queries of an open workout page before they expire, so a coach who
 * logs out or loses access stops getting updates within a minute. The proxy already
 * requires a login, and this checks it again as the answer is a bearer capability.
 */
export async function POST(_request: Request, { params }: RouteContext<"/api/realtime/workouts/[id]">) {
  if (!(await currentCoach())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const queries = await sealWorkoutLiveQueries(id);
  if (!queries) return new Response("Not found", { status: 404 });
  return Response.json(queries, { headers: { "Cache-Control": "private, no-store" } });
}
