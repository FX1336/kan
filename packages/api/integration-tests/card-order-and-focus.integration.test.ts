import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

async function seedBoard(db: TestDbClient) {
  const { user, workspace } = await seedTestData(db);

  const [board] = await db
    .insert(schema.boards)
    .values({
      publicId: "brdtest12345",
      name: "Board",
      slug: "board",
      workspaceId: workspace.id,
      createdBy: user.id,
    })
    .returning();

  const [list] = await db
    .insert(schema.lists)
    .values({
      publicId: "lsttest12345",
      name: "List",
      index: 0,
      boardId: board!.id,
      createdBy: user.id,
    })
    .returning();

  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspace.id));

  return { user, workspace, board: board!, list: list!, member: member! };
}

async function insertCard(
  db: TestDbClient,
  listId: number,
  createdBy: string,
  values: {
    title: string;
    index: number;
    isArchived?: boolean;
    isActive?: boolean;
    dueDate?: Date | null;
  },
) {
  const [card] = await db
    .insert(schema.cards)
    .values({
      publicId: `c${values.title.padEnd(11, "x")}`.slice(0, 12),
      listId,
      createdBy,
      ...values,
    })
    .returning();
  return card!;
}

const titlesInOrder = async (db: TestDbClient, listId: number) => {
  const rows = await db
    .select({
      title: schema.cards.title,
      isArchived: schema.cards.isArchived,
    })
    .from(schema.cards)
    .where(eq(schema.cards.listId, listId))
    .orderBy(asc(schema.cards.index));
  return rows.filter((r) => !r.isArchived).map((r) => r.title);
};

describe("card ordering with archived cards", () => {
  it("moves a card to the visible position the client asked for", async () => {
    const db = await createTestDb();
    const { user, list } = await seedBoard(db);

    const a = await insertCard(db, list.id, user.id, { title: "A", index: 0 });
    await insertCard(db, list.id, user.id, {
      title: "B",
      index: 1,
      isArchived: true,
    });
    await insertCard(db, list.id, user.id, { title: "C", index: 2 });
    await insertCard(db, list.id, user.id, { title: "D", index: 3 });

    // Visible list is [A, C, D]; drag A to the last visible position (2).
    const newIndex = await cardRepo.resolveIndexIgnoringArchived(db, {
      listId: list.id,
      movingCardId: a.id,
      visibleIndex: 2,
    });
    await cardRepo.reorder(db, {
      cardId: a.id,
      newIndex,
      newListId: list.id,
    });

    expect(await titlesInOrder(db, list.id)).toEqual(["C", "D", "A"]);
  });

  it("places a card at the end when the visible index is past the end", async () => {
    const db = await createTestDb();
    const { user, list } = await seedBoard(db);

    await insertCard(db, list.id, user.id, { title: "A", index: 0 });
    await insertCard(db, list.id, user.id, {
      title: "B",
      index: 1,
      isArchived: true,
    });

    const index = await cardRepo.resolveIndexIgnoringArchived(db, {
      listId: list.id,
      movingCardId: -1,
      visibleIndex: 5,
    });

    expect(index).toBe(2);
  });
});

describe("morgenstart focus candidates", () => {
  it("returns due and active cards that are unassigned or assigned to the member", async () => {
    const db = await createTestDb();
    const { user, workspace, list, member } = await seedBoard(db);

    const [otherUser] = await db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: "Other",
        email: "other@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const [otherMember] = await db
      .insert(schema.workspaceMembers)
      .values({
        publicId: "wm0987654321",
        email: otherUser!.email,
        workspaceId: workspace.id,
        userId: otherUser!.id,
        createdBy: user.id,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .returning();

    const today = new Date("2026-09-29T09:00:00.000Z");
    const endOfToday = new Date("2026-09-29T23:59:59.999Z");
    const tomorrow = new Date("2026-09-30T09:00:00.000Z");

    await insertCard(db, list.id, user.id, {
      title: "Unassigned",
      index: 0,
      dueDate: today,
    });
    const mine = await insertCard(db, list.id, user.id, {
      title: "Mine",
      index: 1,
      dueDate: today,
    });
    const others = await insertCard(db, list.id, user.id, {
      title: "Others",
      index: 2,
      dueDate: today,
    });
    await insertCard(db, list.id, user.id, {
      title: "Tomorrow",
      index: 3,
      dueDate: tomorrow,
    });
    await insertCard(db, list.id, user.id, {
      title: "Active",
      index: 4,
      isActive: true,
    });
    await insertCard(db, list.id, user.id, {
      title: "Archived",
      index: 5,
      dueDate: today,
      isArchived: true,
    });

    await db.insert(schema.cardToWorkspaceMembers).values([
      { cardId: mine.id, workspaceMemberId: member.id },
      { cardId: others.id, workspaceMemberId: otherMember!.id },
    ]);

    const result = await cardRepo.getFocusCandidatesForMember(db, {
      workspaceId: workspace.id,
      workspaceMemberId: member.id,
      dueBefore: endOfToday,
    });

    expect(result.map((r) => r.title).sort()).toEqual(
      ["Active", "Mine", "Unassigned"].sort(),
    );
  });
});
