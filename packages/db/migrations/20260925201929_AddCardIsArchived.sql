ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.archived.added' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.archived.removed' BEFORE 'card.archived';--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "isArchived" boolean DEFAULT false NOT NULL;