import { z } from "zod";

// ─── morgenstart.getFocusSuggestions ────────────────────────────
export const focusSuggestionSchema = z.object({
  cardPublicId: z.string(),
  title: z.string(),
  cardNumber: z.number().nullable(),
  dueDate: z.date().nullable(),
  isActive: z.boolean(),
  listPublicId: z.string(),
  listName: z.string(),
  boardPublicId: z.string(),
  boardName: z.string(),
});
