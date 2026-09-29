import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as permissionRepo from "@kan/db/repository/permission.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { focusSuggestionSchema } from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

export const morgenstartRouter = createTRPCRouter({
  getFocusSuggestions: protectedProcedure
    .meta({
      openapi: {
        summary: "Get morning routine focus suggestions",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/morgenstart/focus-suggestions",
        description:
          "Retrieves cards due today, overdue, or already marked active for the current user in a workspace",
        tags: ["Morgenstart"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        dueBefore: z.date().optional(),
      }),
    )
    .output(z.array(focusSuggestionSchema))
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

      await assertPermission(ctx.db, userId, workspace.id, "board:view");

      const member = await permissionRepo.getMemberWithRole(
        ctx.db,
        userId,
        workspace.id,
      );

      if (!member) return [];

      const dueBefore = input.dueBefore ?? new Date();
      if (!input.dueBefore) dueBefore.setHours(23, 59, 59, 999);

      const candidates = await cardRepo.getFocusCandidatesForMember(ctx.db, {
        workspaceId: workspace.id,
        workspaceMemberId: member.id,
        dueBefore,
      });

      return candidates.map((candidate) => ({
        cardPublicId: candidate.publicId,
        title: candidate.title,
        cardNumber: candidate.cardNumber,
        dueDate: candidate.dueDate,
        isActive: candidate.isActive,
        listPublicId: candidate.listPublicId,
        listName: candidate.listName,
        boardPublicId: candidate.boardPublicId,
        boardName: candidate.boardName,
      }));
    }),
});
