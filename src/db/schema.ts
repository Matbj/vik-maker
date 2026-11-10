import {
  boolean,
  index,
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
import { sql } from "drizzle-orm";

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

/** The team's coaches (leaders on svenskalag.se), kept apart from the players. */
export const coaches = pgTable(
  "coaches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** The coach's id on svenskalag.se. */
    svenskalagId: text("svenskalag_id").notNull(),
    /** Lower-case, from svenskalag.se's contact list. Null means the coach can't log in. */
    email: text("email"),
    /** As written in svenskalag.se's contact list. Mobile if there is one, otherwise the other number. */
    phone: text("phone"),
    /** The coach's role in svenskalag.se's contact list, in Swedish, such as "Tränare". */
    role: text("role"),
    ...timestamps,
  },
  (t) => [uniqueIndex("coaches_svenskalag_id_idx").on(t.svenskalagId)],
);

/** The login code a coach was last emailed. One per coach; a new code replaces the old. */
export const loginCodes = pgTable("login_codes", {
  coachId: uuid("coach_id")
    .primaryKey()
    .references(() => coaches.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** How many codes were sent since sendWindowStartedAt, to cap the emails per hour. */
  sendCount: integer("send_count").notNull().default(1),
  sendWindowStartedAt: timestamp("send_window_started_at", { withTimezone: true }).notNull(),
});

/** A logged-in coach's browser. The cookie holds the token, this table only its hash. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  coachId: uuid("coach_id")
    .notNull()
    .references(() => coaches.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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

export const playerResponse = pgEnum("player_response", [
  "attending",
  "declined",
  "unanswered",
]);

export const coachCheck = pgEnum("coach_check", ["present", "absent"]);

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
    playerResponse: playerResponse("player_response").notNull().default("unanswered"),
    /** What the coaches recorded in the attendance check. Null until attendance is registered. */
    coachCheck: coachCheck("coach_check"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.playerId] })],
);

export const workoutGroupKind = pgEnum("workout_group_kind", ["level", "team"]);

/** Each coach's answer to a workout, and the attendance check on them. */
export const workoutCoachAttendance = pgTable(
  "workout_coach_attendance",
  {
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    coachId: uuid("coach_id")
      .notNull()
      .references(() => coaches.id, { onDelete: "cascade" }),
    /** What the coach answered. */
    response: playerResponse("response").notNull().default("unanswered"),
    /** What was recorded in the attendance check. Null until attendance is registered. */
    coachCheck: coachCheck("coach_check"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.coachId] })],
);

/** A generated group for one workout: a leveled group such as "B1 + B2", or a team. */
export const workoutGroups = pgTable("workout_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutId: uuid("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  kind: workoutGroupKind("kind").notNull().default("level"),
  name: text("name").notNull(),
  /** The levels a leveled group plays at, strongest first. Empty for teams. */
  levelCodes: text("level_codes").array().notNull().default(sql`'{}'::text[]`),
  /** 1 or 2 when the teams are split into two leagues. */
  league: integer("league"),
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
    /** Spread into the group after it was created, because they turned up late. */
    addedLate: boolean("added_late").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.playerId] })],
);

/** Two players the coaches don't want in the same group or team. Stored with the lower id first. */
export const playerSeparations = pgTable(
  "player_separations",
  {
    playerAId: uuid("player_a_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    playerBId: uuid("player_b_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.playerAId, t.playerBId] })],
);

/** Free-form settings the coaches can change, such as notes for the grouping. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  ...timestamps,
});

/** What logged-in coaches have done. The keys in `details` say what each id in it refers to. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coachId: uuid("coach_id").references(() => coaches.id, { onDelete: "set null" }),
    /** Kept next to the id so an entry stays readable if the coach is removed. */
    coachName: text("coach_name").notNull(),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);

export type Level = typeof levels.$inferSelect;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Coach = typeof coaches.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;
export type WorkoutGroup = typeof workoutGroups.$inferSelect;
