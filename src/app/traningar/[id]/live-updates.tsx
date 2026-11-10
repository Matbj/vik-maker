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

    /** "denied" when logged out or Realtime is off, "offline" when the request didn't get through. */
    const fetchQueries = async (): Promise<WorkoutLiveQueries | "denied" | "offline"> => {
      try {
        const response = await fetch(`/api/realtime/workouts/${workoutId}`, {
          method: "POST",
          cache: "no-store",
          // The proxy redirects to the login page when the session has ended.
          redirect: "manual",
        });
        return response.ok ? ((await response.json()) as WorkoutLiveQueries) : "denied";
      } catch {
        return "offline";
      }
    };

    let expiresAt = 0;
    const scheduleRenew = (queries: WorkoutLiveQueries) => {
      expiresAt = Math.min(...Object.values(queries).map((query) => query.expiresAt));
      clearTimeout(renewTimer);
      renewTimer = setTimeout(renew, Math.max(0, expiresAt - Date.now() - RENEW_MARGIN_MS));
    };

    const renew = async () => {
      const queries = await fetchQueries();
      if (stopped) return;
      if (queries === "offline") {
        renewTimer = setTimeout(renew, RETRY_MS);
        return;
      }
      // Let the subscriptions expire.
      if (queries === "denied") return;
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
    const restart = (delay = RETRY_MS) => {
      if (restarting || stopped) return;
      restarting = true;
      clearTimeout(renewTimer);
      for (const subscription of subscriptions) subscription.unsubscribe();
      subscriptions = [];
      setTimeout(async () => {
        const queries = await fetchQueries();
        restarting = false;
        if (stopped || queries === "denied") return;
        if (queries === "offline") return restart();
        subscribe(queries);
        // Changes made while disconnected aren't replayed.
        scheduleRefresh();
      }, delay);
    };

    // A locked phone pauses the page, so the queries expire without being renewed.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= expiresAt) restart(0);
    };
    document.addEventListener("visibilitychange", onVisible);

    subscribe(firstQueries.current);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(renewTimer);
      clearTimeout(refreshTimer);
      client.close();
    };
  }, [workoutId, url, router]);

  return null;
}
