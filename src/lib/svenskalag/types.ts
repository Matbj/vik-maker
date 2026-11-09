/** Shapes we expect to extract from svenskalag.se. Adjust once we've seen real pages. */

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
  playerSvenskalagId: string;
  playerName: string;
  status: "attending" | "declined" | "unanswered";
};
