import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

/**
 * Skill levels a player can be mapped to (A, B1, B2, C).
 * Stored as a table rather than an enum so the coaches can rename or add
 * levels later without a migration.
 */
export const levels = pgTable("levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // "A" | "B1" | "B2" | "C"
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/** The team's players and which level they belong to. */
export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** The player's id on svenskalag.se, used to match booked workouts. */
    svenskalagId: text("svenskalag_id"),
    levelId: uuid("level_id").references(() => levels.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("players_svenskalag_id_idx").on(t.svenskalagId)],
);

/** A workout (training session) synced from svenskalag.se. */
export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    svenskalagId: text("svenskalag_id").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    /** Whatever we scraped, kept for debugging the integration. */
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("workouts_svenskalag_id_idx").on(t.svenskalagId)],
);

export const attendanceStatus = pgEnum("attendance_status", [
  "attending",
  "declined",
  "unanswered",
]);

export const attendanceCheckStatus = pgEnum("attendance_check_status", [
  "present",
  "absent",
  "unchecked",
]);

/** Each player's answer to a workout, and the coaches' attendance check on it. */
export const workoutAttendance = pgTable(
  "workout_attendance",
  {
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** What the player answered. */
    status: attendanceStatus("status").notNull().default("unanswered"),
    /** What the coaches recorded in the attendance check on the workout. */
    checkStatus: attendanceCheckStatus("check_status").notNull().default("unchecked"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.playerId] })],
);

/** A generated training group for one workout, e.g. "A" or "B1 + B2". */
export const workoutGroups = pgTable("workout_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutId: uuid("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const workoutGroupMembers = pgTable(
  "workout_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => workoutGroups.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.playerId] })],
);

export type Level = typeof levels.$inferSelect;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;
export type WorkoutGroup = typeof workoutGroups.$inferSelect;
