import { Notice } from "@/components/notice";

export default function WorkoutsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Upcoming workouts</h1>
      <Notice title="Not connected to svenskalag.se yet">
        Booked workouts will show up here once the svenskalag.se sync is built. Each workout
        will get leveled groups (A, B1, B2, C) based on who has booked.
      </Notice>
    </section>
  );
}
