import { z } from "zod";
import { currentCoach } from "@/lib/auth/sessions";
import { sealLotteryLiveQueries } from "@/lib/realtime/live-queries";

/** Renews the live queries of an open lottery page, like the workout page's route. */
export async function POST(_request: Request, { params }: RouteContext<"/api/realtime/lotteries/[id]">) {
  if (!(await currentCoach())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const queries = await sealLotteryLiveQueries(id);
  if (!queries) return new Response("Not found", { status: 404 });
  return Response.json(queries, { headers: { "Cache-Control": "private, no-store" } });
}
