-- Rename column and preserve data, indexes, and constraints
ALTER TABLE "users" RENAME COLUMN "firebase_uid" TO "supabase_uid";
