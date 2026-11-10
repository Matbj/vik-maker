"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createRealtimeClient, type RawLiveQuerySubscription } from "@neon/realtime/client";
import type { WorkoutLiveQueries } from "@/lib/realtime/workout-live";

/** Renew this long before the sealed queries expire. */
const RENEW_MARGIN_MS = 10_000;
const RETRY_MS = 5_000;
/** Collects the rows of one transaction, and the coach's own action, into one refresh. */
const REFRESH_DELAY_MS = 300;

/**
 * Re-renders the workout page when its data changes elsewhere, such as another coach moving
 * a player or a sync. Renders nothing. The first queries come with the page, and later ones
 * from the renew route, which requires a logged-in coach.
 */
export function LiveUpdates({
  workoutId,
  url,
  initialQueries,
}: {
  workoutId: string;
  url: string;
  initialQueries: WorkoutLiveQueries;
}) {
  const router = useRouter();
  // The page sends new queries on every refresh, but the subscriptions renew their own.
  const firstQueries = useRef(initialQueries);

  useEffect(() => {
    const client = createRealtimeClient({ url, logLevel: "warn" });
    let subscriptions: RawLiveQuerySubscription<unknown>[] = [];
    let stopped = false;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };

    const fetchQueries = async (): Promise<WorkoutLiveQueries | null> => {
      try {
        const response = await fetch(`/api/realtime/workouts/${workoutId}`, {
          method: "POST",
          cache: "no-store",
          redirect: "error",
        });
        return response.ok ? ((await response.json()) as WorkoutLiveQueries) : null;
      } catch {
        return null;
      }
    };

    const scheduleRenew = (queries: WorkoutLiveQueries) => {
      const expiresAt = Math.min(...Object.values(queries).map((query) => query.expiresAt));
      renewTimer = setTimeout(renew, Math.max(0, expiresAt - Date.now() - RENEW_MARGIN_MS));
    };

    const renew = async () => {
      const queries = await fetchQueries();
      if (stopped) return;
      // Logged out or Realtime turned off: let the subscriptions expire.
      if (!queries) return;
      try {
        await Promise.all(Object.values(queries).map((query, i) => subscriptions[i]?.renew(query)));
        scheduleRenew(queries);
      } catch {
        restart();
      }
    };

    const subscribe = (queries: WorkoutLiveQueries) => {
      subscriptions = Object.values(queries).map((query) => {
        const subscription = client.subscribe(query, { materialize: false });
        let seenRows = false;
        subscription.onUpdate((update) => {
          // The first full set of rows is what the page already shows. Later ones follow a reconnect.
          if (update.type === "rows" && !seenRows) {
            seenRows = true;
            return;
          }
          scheduleRefresh();
        });
        subscription.onStateChange((state) => {
          if (state.status === "error") restart();
        });
        return subscription;
      });
      scheduleRenew(queries);
    };

    let restarting = false;
    const restart = () => {
      if (restarting || stopped) return;
      restarting = true;
      clearTimeout(renewTimer);
      for (const subscription of subscriptions) subscription.unsubscribe();
      subscriptions = [];
      setTimeout(async () => {
        const queries = await fetchQueries();
        restarting = false;
        if (stopped || !queries) return;
        subscribe(queries);
        // Changes made while disconnected aren't replayed.
        scheduleRefresh();
      }, RETRY_MS);
    };

    subscribe(firstQueries.current);

    return () => {
      stopped = true;
      clearTimeout(renewTimer);
      clearTimeout(refreshTimer);
      client.close();
    };
  }, [workoutId, url, router]);

  return null;
}
