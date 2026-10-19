import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as workspaceTransferRepo from "@kan/db/repository/workspaceTransfer.repo";

import {
  importWorkspaceResponseSchema,
  workspaceTransferSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

export const transferRouter = createTRPCRouter({
  exportWorkspace: protectedProcedure
    .meta({
      openapi: {
        summary: "Export a workspace",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/export",
        description:
          "Exports all of a workspace's boards, lists, cards, labels and projects as a single JSON payload",
        tags: ["Workspaces"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: z.string().min(12) }))
    .output(workspaceTransferSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, workspace.id, "workspace:view");

      const result = await workspaceTransferRepo.exportWorkspace(
        ctx.db,
        workspace.id,
      );

      if (!result)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });

      return result;
    }),
  importWorkspace: protectedProcedure
    .meta({
      openapi: {
        summary: "Import a workspace export",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/import",
        description:
          "Imports boards from a previously exported JSON payload into the given workspace. Boards are matched by public ID: existing boards are updated, new ones are created.",
        tags: ["Workspaces"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        data: workspaceTransferSchema,
      }),
    )
    .output(importWorkspaceResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, workspace.id, "board:create");

      let boardsCreated = 0;
      let boardsUpdated = 0;

      for (const board of input.data.boards) {
        const { created } = await workspaceTransferRepo.importBoard(ctx.db, {
          workspaceId: workspace.id,
          createdBy: userId,
          board,
        });

        if (created) boardsCreated++;
        else boardsUpdated++;
      }

      return { boardsCreated, boardsUpdated };
    }),
});
