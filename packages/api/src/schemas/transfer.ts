import { z } from "zod";

// Shared between the export output and the import input: the export's
// output IS the shape an import expects to receive back.

const transferChecklistItemSchema = z.object({
  publicId: z.string().min(12).max(12),
  title: z.string().min(1).max(500),
  completed: z.boolean(),
  index: z.number().int().min(0),
});

const transferChecklistSchema = z.object({
  publicId: z.string().min(12).max(12),
  name: z.string().min(1).max(255),
  index: z.number().int().min(0),
  items: z.array(transferChecklistItemSchema),
});

const transferCommentSchema = z.object({
  publicId: z.string().min(12).max(12),
  comment: z.string().min(1),
  createdByEmail: z.string().email().nullable(),
  createdAt: z.coerce.date(),
});

const transferLabelSchema = z.object({
  publicId: z.string().min(12).max(12),
  name: z.string().min(1).max(36),
  colourCode: z.string().nullable(),
});

const transferProjectSchema = z.object({
  publicId: z.string().min(12).max(12),
  name: z.string().min(1).max(36),
  colourCode: z.string().nullable(),
});

const transferCardSchema = z.object({
  publicId: z.string().min(12).max(12),
  title: z.string().min(1).max(2000),
  description: z.string().max(10000).nullable(),
  index: z.number().int().min(0),
  dueDate: z.coerce.date().nullable(),
  isActive: z.boolean(),
  isArchived: z.boolean(),
  labelPublicIds: z.array(z.string().min(12).max(12)),
  projectPublicId: z.string().min(12).max(12).nullable(),
  memberEmails: z.array(z.string().email()),
  checklists: z.array(transferChecklistSchema),
  comments: z.array(transferCommentSchema),
});

const transferListSchema = z.object({
  publicId: z.string().min(12).max(12),
  name: z.string().min(1).max(255),
  index: z.number().int().min(0),
  cards: z.array(transferCardSchema),
});

const transferBoardSchema = z.object({
  publicId: z.string().min(12).max(12),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  visibility: z.enum(["private", "public"]),
  labels: z.array(transferLabelSchema),
  projects: z.array(transferProjectSchema),
  lists: z.array(transferListSchema),
});

export const workspaceTransferSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  workspace: z.object({ name: z.string() }),
  boards: z.array(transferBoardSchema),
});

export type WorkspaceTransferPayload = z.infer<typeof workspaceTransferSchema>;

export const importWorkspaceResponseSchema = z.object({
  boardsCreated: z.number(),
  boardsUpdated: z.number(),
});
