import { config } from "dotenv";

config({ path: ".env.local" });

// Imported after dotenv so env.ts sees .env.local. Prints counts only, never names.
async function main() {
  const { SvenskalagClient } = await import("../src/lib/svenskalag/client");
  const { defaultSyncRange, syncWorkouts } = await import("../src/lib/svenskalag/sync");
  const range = defaultSyncRange();

  if (!process.argv.includes("--dry-run")) {
    console.log(await syncWorkouts(range));
    return;
  }

  const client = new SvenskalagClient();
  for (const workout of await client.fetchWorkouts(range)) {
    const attendance = await client.fetchAttendance(workout.id);
    const count = (test: (a: (typeof attendance)[number]) => boolean) => attendance.filter(test).length;
    console.log(workout.startsAt.toISOString(), workout.id, workout.title, workout.location ?? "-", {
      attending: count((a) => a.playerResponse === "attending"),
      declined: count((a) => a.playerResponse === "declined"),
      unanswered: count((a) => a.playerResponse === "unanswered"),
      present: count((a) => a.coachCheck === "present"),
      absent: count((a) => a.coachCheck === "absent"),
      unchecked: count((a) => a.coachCheck === null),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
