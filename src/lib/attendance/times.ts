/** How long before a workout's start the coaches can begin filling in the attendance. */
export const ATTENDANCE_OPENS_BEFORE_MS = 15 * 60 * 1000;

/** How long after the last attendance edit the save to svenskalag.se waits, to collect a burst of taps. */
export const PUSH_DEBOUNCE_MS = 5_000;

/** How long an open page lets a save be waiting before it asks for it itself. */
export const PUSH_CATCH_UP_MS = 20_000;

/** Used for workouts without an end time. */
const DEFAULT_WORKOUT_MS = 2 * 60 * 60 * 1000;

export function workoutEnd(workout: { startsAt: Date; endsAt: Date | null }) {
  return workout.endsAt ?? new Date(workout.startsAt.getTime() + DEFAULT_WORKOUT_MS);
}
