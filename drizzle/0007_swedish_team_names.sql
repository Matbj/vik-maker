UPDATE "workout_groups" SET "name" = regexp_replace("name", '^Team ', 'Lag ') WHERE "kind" = 'team' AND "name" ~ '^Team [0-9]+$';
