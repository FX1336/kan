import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as projectRepo from "@kan/db/repository/project.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

const projectSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable(),
});

export const projectRouter = createTRPCRouter({
  byPublicId: protectedProcedure
    .meta({
      openapi: {
        summary: "Get a project by public ID",
        method: "GET",
        path: "/projects/{projectPublicId}",
        description: "Retrieves a project by its public ID",
        tags: ["Projects"],
        protect: true,
      },
    })
    .input(z.object({ projectPublicId: z.string().min(12) }))
    .output(projectSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const project =
        await projectRepo.getWorkspaceAndProjectIdByProjectPublicId(
          ctx.db,
          input.projectPublicId,
        );

      if (!project)
        throw new TRPCError({
          message: `Project with public ID ${input.projectPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        project.workspaceId,
        "board:view",
      );

      const result = await projectRepo.getByPublicId(
        ctx.db,
        input.projectPublicId,
      );

      if (!result)
        throw new TRPCError({
          message: `Project with public ID ${input.projectPublicId} not found`,
          code: "NOT_FOUND",
        });

      return {
        publicId: result.publicId,
        name: result.name,
        colourCode: result.colourCode,
      };
    }),
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a project",
        method: "POST",
        path: "/projects",
        description: "Creates a new project",
        tags: ["Projects"],
        protect: true,
      },
    })
    .input(
      z.object({
        name: z.string().min(1).max(36),
        boardPublicId: z.string().min(12),
        colourCode: z.string().length(7),
      }),
    )
    .output(projectSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const board = await boardRepo.getWorkspaceAndBoardIdByBoardPublicId(
        ctx.db,
        input.boardPublicId,
      );

      if (!board)
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, board.workspaceId, "board:edit");

      const result = await projectRepo.create(ctx.db, {
        name: input.name,
        colourCode: input.colourCode,
        createdBy: userId,
        boardId: board.id,
      });

      if (!result)
        throw new TRPCError({
          message: `Failed to create project`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return {
        publicId: result.publicId,
        name: result.name,
        colourCode: result.colourCode,
      };
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a project",
        method: "PUT",
        path: "/projects/{projectPublicId}",
        description: "Updates a project by its public ID",
        tags: ["Projects"],
        protect: true,
      },
    })
    .input(
      z.object({
        projectPublicId: z.string().min(12),
        name: z.string().min(1).max(36),
        colourCode: z.string().length(7),
      }),
    )
    .output(projectSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const project =
        await projectRepo.getWorkspaceAndProjectIdByProjectPublicId(
          ctx.db,
          input.projectPublicId,
        );

      if (!project)
        throw new TRPCError({
          message: `Project with public ID ${input.projectPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        project.workspaceId,
        "board:edit",
      );

      const result = await projectRepo.update(ctx.db, input);

      if (!result)
        throw new TRPCError({
          message: `Failed to update project`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return {
        publicId: result.publicId,
        name: result.name,
        colourCode: result.colourCode,
      };
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a project",
        method: "DELETE",
        path: "/projects/{projectPublicId}",
        description: "Deletes a project by its public ID",
        tags: ["Projects"],
        protect: true,
      },
    })
    .input(z.object({ projectPublicId: z.string().min(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const project =
        await projectRepo.getWorkspaceAndProjectIdByProjectPublicId(
          ctx.db,
          input.projectPublicId,
        );

      if (!project)
        throw new TRPCError({
          message: `Project with public ID ${input.projectPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        project.workspaceId,
        "board:edit",
      );

      await cardRepo.clearProjectFromAllCards(ctx.db, project.id);

      await projectRepo.softDelete(ctx.db, {
        projectId: project.id,
        deletedAt: new Date(),
        deletedBy: userId,
      });

      return { success: true };
    }),
});
