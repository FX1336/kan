import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { boards } from "./boards";
import { cards } from "./cards";
import { imports } from "./imports";
import { users } from "./users";

export const projects = pgTable("project", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  publicId: varchar("publicId", { length: 12 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  colourCode: varchar("colourCode", { length: 12 }),
  createdBy: uuid("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt"),
  boardId: bigint("boardId", { mode: "number" })
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  importId: bigint("importId", { mode: "number" }).references(() => imports.id),
  deletedAt: timestamp("deletedAt"),
  deletedBy: uuid("deletedBy").references(() => users.id, {
    onDelete: "set null",
  }),
}).enableRLS();

export const projectsRelations = relations(projects, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [projects.createdBy],
    references: [users.id],
    relationName: "projectsCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [projects.deletedBy],
    references: [users.id],
    relationName: "projectsDeletedByUser",
  }),
  board: one(boards, {
    fields: [projects.boardId],
    references: [boards.id],
  }),
  cards: many(cards),
  import: one(imports, {
    fields: [projects.importId],
    references: [imports.id],
    relationName: "projectsImport",
  }),
}));
