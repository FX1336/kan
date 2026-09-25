import { and, count, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { projects } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(projects)
    .where(isNull(projects.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  projectInput: {
    name: string;
    colourCode: string;
    createdBy: string;
    boardId: number;
  },
) => {
  const [result] = await db
    .insert(projects)
    .values({
      publicId: generateUID(),
      name: projectInput.name,
      colourCode: projectInput.colourCode,
      createdBy: projectInput.createdBy,
      boardId: projectInput.boardId,
    })
    .returning({
      id: projects.id,
      publicId: projects.publicId,
      name: projects.name,
      colourCode: projects.colourCode,
    });

  return result;
};

export const getAllByPublicIds = (
  db: dbClient,
  projectPublicIds: string[],
) => {
  return db.query.projects.findMany({
    columns: {
      id: true,
    },
    where: inArray(projects.publicId, projectPublicIds),
  });
};

export const getByPublicId = async (
  db: dbClient,
  projectPublicId: string,
) => {
  return db.query.projects.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      colourCode: true,
    },
    where: eq(projects.publicId, projectPublicId),
  });
};

export const update = async (
  db: dbClient,
  projectInput: {
    projectPublicId: string;
    name: string;
    colourCode: string;
  },
) => {
  const [result] = await db
    .update(projects)
    .set({
      name: projectInput.name,
      colourCode: projectInput.colourCode,
    })
    .where(eq(projects.publicId, projectInput.projectPublicId))
    .returning({
      id: projects.id,
      publicId: projects.publicId,
      name: projects.name,
      colourCode: projects.colourCode,
    });

  return result;
};

export const softDelete = async (
  db: dbClient,
  args: {
    projectId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const [result] = await db
    .update(projects)
    .set({
      deletedAt: args.deletedAt,
      deletedBy: args.deletedBy,
    })
    .where(and(eq(projects.id, args.projectId), isNull(projects.deletedAt)))
    .returning({ id: projects.id });

  return result;
};

export const getWorkspaceAndProjectIdByProjectPublicId = async (
  db: dbClient,
  projectPublicId: string,
) => {
  const result = await db.query.projects.findFirst({
    columns: { id: true },
    where: eq(projects.publicId, projectPublicId),
    with: {
      board: {
        columns: { workspaceId: true },
      },
    },
  });

  return result
    ? {
        id: result.id,
        workspaceId: result.board.workspaceId,
      }
    : null;
};
