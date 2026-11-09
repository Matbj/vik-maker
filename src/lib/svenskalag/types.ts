/** Shapes we extract from svenskalag.se. */

export type SvenskalagWorkout = {
  /** svenskalag's own id for the activity (from the URL or a data attribute). */
  id: string;
  title: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
};

export type SvenskalagAttendance = {
  workoutId: string;
  memberSvenskalagId: string;
  memberName: string;
  role: "player" | "coach";
  /** What the member answered. */
  response: "attending" | "declined" | "unanswered";
  /** What the coaches recorded in the attendance check. Null until attendance is registered. */
  coachCheck: "present" | "absent" | null;
};
