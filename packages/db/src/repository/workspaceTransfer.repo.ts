import { and, asc, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  projects,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const exportWorkspace = async (db: dbClient, workspaceId: number) => {
  const workspace = await db.query.workspaces.findFirst({
    columns: { name: true },
    where: eq(workspaces.id, workspaceId),
  });

  if (!workspace) return null;

  const boardRows = await db.query.boards.findMany({
    columns: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
    },
    where: and(
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      eq(boards.type, "regular"),
    ),
    orderBy: asc(boards.name),
  });

  const exportedBoards = [];

  for (const board of boardRows) {
    const boardLabels = await db.query.labels.findMany({
      columns: { publicId: true, name: true, colourCode: true },
      where: and(eq(labels.boardId, board.id), isNull(labels.deletedAt)),
    });

    const boardProjects = await db.query.projects.findMany({
      columns: { publicId: true, name: true, colourCode: true },
      where: and(eq(projects.boardId, board.id), isNull(projects.deletedAt)),
    });

    const boardLists = await db.query.lists.findMany({
      columns: { id: true, publicId: true, name: true, index: true },
      where: and(eq(lists.boardId, board.id), isNull(lists.deletedAt)),
      orderBy: asc(lists.index),
    });

    const exportedLists = [];

    for (const list of boardLists) {
      const listCards = await db.query.cards.findMany({
        columns: {
          publicId: true,
          title: true,
          description: true,
          index: true,
          dueDate: true,
          isActive: true,
          isArchived: true,
        },
        where: and(eq(cards.listId, list.id), isNull(cards.deletedAt)),
        orderBy: asc(cards.index),
        with: {
          labels: {
            with: { label: { columns: { publicId: true } } },
          },
          project: { columns: { publicId: true } },
          members: {
            with: {
              member: { columns: { email: true, deletedAt: true } },
            },
          },
          checklists: {
            columns: { publicId: true, name: true, index: true },
            where: isNull(checklists.deletedAt),
            orderBy: asc(checklists.index),
            with: {
              items: {
                columns: {
                  publicId: true,
                  title: true,
                  completed: true,
                  index: true,
                },
                where: isNull(checklistItems.deletedAt),
                orderBy: asc(checklistItems.index),
              },
            },
          },
          comments: {
            columns: { publicId: true, comment: true, createdAt: true },
            where: isNull(comments.deletedAt),
            orderBy: asc(comments.createdAt),
            with: {
              createdBy: { columns: { email: true } },
            },
          },
        },
      });

      exportedLists.push({
        publicId: list.publicId,
        name: list.name,
        index: list.index,
        cards: listCards.map((card) => ({
          publicId: card.publicId,
          title: card.title,
          description: card.description,
          index: card.index,
          dueDate: card.dueDate,
          isActive: card.isActive,
          isArchived: card.isArchived,
          labelPublicIds: card.labels.map((l) => l.label.publicId),
          projectPublicId: card.project?.publicId ?? null,
          memberEmails: card.members
            .filter((m) => m.member && m.member.deletedAt === null)
            .map((m) => m.member.email),
          checklists: card.checklists.map((checklist) => ({
            publicId: checklist.publicId,
            name: checklist.name,
            index: checklist.index,
            items: checklist.items.map((item) => ({
              publicId: item.publicId,
              title: item.title,
              completed: item.completed,
              index: item.index,
            })),
          })),
          comments: card.comments.map((comment) => ({
            publicId: comment.publicId,
            comment: comment.comment,
            createdByEmail: comment.createdBy?.email ?? null,
            createdAt: comment.createdAt,
          })),
        })),
      });
    }

    exportedBoards.push({
      publicId: board.publicId,
      name: board.name,
      slug: board.slug,
      visibility: board.visibility,
      labels: boardLabels,
      projects: boardProjects,
      lists: exportedLists,
    });
  }

  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    workspace: { name: workspace.name },
    boards: exportedBoards,
  };
};

interface ImportCard {
  publicId: string;
  title: string;
  description: string | null;
  index: number;
  dueDate: Date | null;
  isActive: boolean;
  isArchived: boolean;
  labelPublicIds: string[];
  projectPublicId: string | null;
  memberEmails: string[];
  checklists: {
    publicId: string;
    name: string;
    index: number;
    items: {
      publicId: string;
      title: string;
      completed: boolean;
      index: number;
    }[];
  }[];
  comments: {
    publicId: string;
    comment: string;
    createdByEmail: string | null;
    createdAt: Date;
  }[];
}

interface ImportBoard {
  publicId: string;
  name: string;
  slug: string;
  visibility: "private" | "public";
  labels: { publicId: string; name: string; colourCode: string | null }[];
  projects: { publicId: string; name: string; colourCode: string | null }[];
  lists: {
    publicId: string;
    name: string;
    index: number;
    cards: ImportCard[];
  }[];
}

export const importBoard = async (
  db: dbClient,
  args: {
    workspaceId: number;
    createdBy: string;
    board: ImportBoard;
  },
): Promise<{ created: boolean }> => {
  return db.transaction(async (tx) => {
    const existingBoard = await tx.query.boards.findFirst({
      columns: { id: true },
      where: and(
        eq(boards.publicId, args.board.publicId),
        eq(boards.workspaceId, args.workspaceId),
      ),
    });

    const created = !existingBoard;
    let boardId: number;

    if (existingBoard) {
      boardId = existingBoard.id;
      await tx
        .update(boards)
        .set({ name: args.board.name, updatedAt: new Date() })
        .where(eq(boards.id, boardId));
    } else {
      let slug = args.board.slug;
      const slugTaken = await tx.query.boards.findFirst({
        columns: { id: true },
        where: and(
          eq(boards.slug, slug),
          eq(boards.workspaceId, args.workspaceId),
          isNull(boards.deletedAt),
        ),
      });
      if (slugTaken) slug = `${slug}-${generateUID()}`;

      const [inserted] = await tx
        .insert(boards)
        .values({
          publicId: args.board.publicId,
          name: args.board.name,
          slug,
          visibility: args.board.visibility,
          workspaceId: args.workspaceId,
          createdBy: args.createdBy,
          type: "regular",
        })
        .returning({ id: boards.id });

      if (!inserted) throw new Error("Failed to create board");
      boardId = inserted.id;
    }

    // ---------- Labels ----------
    const labelIdMap = new Map<string, number>();
    for (const label of args.board.labels) {
      const existing = await tx.query.labels.findFirst({
        columns: { id: true },
        where: and(
          eq(labels.publicId, label.publicId),
          eq(labels.boardId, boardId),
        ),
      });

      if (existing) {
        await tx
          .update(labels)
          .set({ name: label.name, colourCode: label.colourCode })
          .where(eq(labels.id, existing.id));
        labelIdMap.set(label.publicId, existing.id);
      } else {
        const [inserted] = await tx
          .insert(labels)
          .values({
            publicId: label.publicId,
            name: label.name,
            colourCode: label.colourCode,
            boardId,
            createdBy: args.createdBy,
          })
          .returning({ id: labels.id });
        if (inserted) labelIdMap.set(label.publicId, inserted.id);
      }
    }

    // ---------- Projects ----------
    const projectIdMap = new Map<string, number>();
    for (const project of args.board.projects) {
      const existing = await tx.query.projects.findFirst({
        columns: { id: true },
        where: and(
          eq(projects.publicId, project.publicId),
          eq(projects.boardId, boardId),
        ),
      });

      if (existing) {
        await tx
          .update(projects)
          .set({ name: project.name, colourCode: project.colourCode })
          .where(eq(projects.id, existing.id));
        projectIdMap.set(project.publicId, existing.id);
      } else {
        const [inserted] = await tx
          .insert(projects)
          .values({
            publicId: project.publicId,
            name: project.name,
            colourCode: project.colourCode,
            boardId,
            createdBy: args.createdBy,
          })
          .returning({ id: projects.id });
        if (inserted) projectIdMap.set(project.publicId, inserted.id);
      }
    }

    // ---------- Lists ----------
    const listIdMap = new Map<string, number>();
    for (const list of args.board.lists) {
      const existing = await tx.query.lists.findFirst({
        columns: { id: true },
        where: and(
          eq(lists.publicId, list.publicId),
          eq(lists.boardId, boardId),
        ),
      });

      if (existing) {
        await tx
          .update(lists)
          .set({ name: list.name, index: list.index })
          .where(eq(lists.id, existing.id));
        listIdMap.set(list.publicId, existing.id);
      } else {
        const [inserted] = await tx
          .insert(lists)
          .values({
            publicId: list.publicId,
            name: list.name,
            index: list.index,
            boardId,
            createdBy: args.createdBy,
          })
          .returning({ id: lists.id });
        if (inserted) listIdMap.set(list.publicId, inserted.id);
      }
    }

    // ---------- Workspace member resolution cache ----------
    const memberCache = new Map<
      string,
      { id: number; userId: string | null } | null
    >();
    const resolveMember = async (email: string) => {
      if (memberCache.has(email)) return memberCache.get(email) ?? null;
      const member = await tx.query.workspaceMembers.findFirst({
        columns: { id: true, userId: true },
        where: and(
          eq(workspaceMembers.email, email),
          eq(workspaceMembers.workspaceId, args.workspaceId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      memberCache.set(email, member ?? null);
      return member ?? null;
    };

    // ---------- Cards ----------
    for (const list of args.board.lists) {
      const listId = listIdMap.get(list.publicId);
      if (!listId) continue;

      for (const card of list.cards) {
        const existingCard = await tx.query.cards.findFirst({
          columns: { id: true },
          where: eq(cards.publicId, card.publicId),
        });

        const projectId = card.projectPublicId
          ? (projectIdMap.get(card.projectPublicId) ?? null)
          : null;

        let cardId: number;
        if (existingCard) {
          cardId = existingCard.id;
          await tx
            .update(cards)
            .set({
              title: card.title,
              description: card.description,
              index: card.index,
              dueDate: card.dueDate,
              isActive: card.isActive,
              isArchived: card.isArchived,
              listId,
              projectId,
              deletedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(cards.id, cardId));

          await tx
            .delete(cardsToLabels)
            .where(eq(cardsToLabels.cardId, cardId));
          await tx
            .delete(cardToWorkspaceMembers)
            .where(eq(cardToWorkspaceMembers.cardId, cardId));
        } else {
          const [inserted] = await tx
            .insert(cards)
            .values({
              publicId: card.publicId,
              title: card.title,
              description: card.description,
              index: card.index,
              dueDate: card.dueDate,
              isActive: card.isActive,
              isArchived: card.isArchived,
              listId,
              projectId,
              createdBy: args.createdBy,
            })
            .returning({ id: cards.id });
          if (!inserted) continue;
          cardId = inserted.id;
        }

        const labelIds = card.labelPublicIds
          .map((publicId) => labelIdMap.get(publicId))
          .filter((id): id is number => id !== undefined);
        if (labelIds.length) {
          await tx
            .insert(cardsToLabels)
            .values(labelIds.map((labelId) => ({ cardId, labelId })));
        }

        const memberIds: number[] = [];
        for (const email of card.memberEmails) {
          const member = await resolveMember(email);
          if (member) memberIds.push(member.id);
        }
        if (memberIds.length) {
          await tx.insert(cardToWorkspaceMembers).values(
            memberIds.map((workspaceMemberId) => ({
              cardId,
              workspaceMemberId,
            })),
          );
        }

        for (const checklist of card.checklists) {
          const existingChecklist = await tx.query.checklists.findFirst({
            columns: { id: true },
            where: eq(checklists.publicId, checklist.publicId),
          });

          let checklistId: number;
          if (existingChecklist) {
            checklistId = existingChecklist.id;
            await tx
              .update(checklists)
              .set({
                name: checklist.name,
                index: checklist.index,
                updatedAt: new Date(),
              })
              .where(eq(checklists.id, checklistId));
          } else {
            const [inserted] = await tx
              .insert(checklists)
              .values({
                publicId: checklist.publicId,
                name: checklist.name,
                index: checklist.index,
                cardId,
                createdBy: args.createdBy,
              })
              .returning({ id: checklists.id });
            if (!inserted) continue;
            checklistId = inserted.id;
          }

          for (const item of checklist.items) {
            const existingItem = await tx.query.checklistItems.findFirst({
              columns: { id: true },
              where: eq(checklistItems.publicId, item.publicId),
            });

            if (existingItem) {
              await tx
                .update(checklistItems)
                .set({
                  title: item.title,
                  completed: item.completed,
                  index: item.index,
                  updatedAt: new Date(),
                })
                .where(eq(checklistItems.id, existingItem.id));
            } else {
              await tx.insert(checklistItems).values({
                publicId: item.publicId,
                title: item.title,
                completed: item.completed,
                index: item.index,
                checklistId,
                createdBy: args.createdBy,
              });
            }
          }
        }

        for (const comment of card.comments) {
          const existingComment = await tx.query.comments.findFirst({
            columns: { id: true },
            where: eq(comments.publicId, comment.publicId),
          });

          if (existingComment) {
            await tx
              .update(comments)
              .set({ comment: comment.comment, updatedAt: new Date() })
              .where(eq(comments.id, existingComment.id));
          } else {
            const author = comment.createdByEmail
              ? await resolveMember(comment.createdByEmail)
              : null;

            await tx.insert(comments).values({
              publicId: comment.publicId,
              comment: comment.comment,
              cardId,
              createdBy: author?.userId ?? args.createdBy,
              createdAt: comment.createdAt,
            });
          }
        }
      }
    }

    return { created };
  });
};
