import { env } from "@/lib/env";
import { defaultSyncRange, syncWorkouts } from "@/lib/svenskalag/sync";

export const maxDuration = 300;

/** Called by Vercel Cron, which sends CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json(await syncWorkouts(defaultSyncRange()));
}
