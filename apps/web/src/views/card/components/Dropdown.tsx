import { t } from "@lingui/core/macro";
import {
  HiEllipsisHorizontal,
  HiHashtag,
  HiLink,
  HiOutlineCheckCircle,
  HiOutlineDocumentDuplicate,
  HiOutlineTrash,
} from "react-icons/hi2";
import { IoArchiveOutline } from "react-icons/io5";

import { authClient } from "@kan/auth/client";

import Dropdown from "~/components/Dropdown";
import { usePermissions } from "~/hooks/usePermissions";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

export default function CardDropdown({
  cardPublicId,
  isTemplate,
  boardPublicId,
  cardCreatedBy,
  ticketNumber,
  listPublicId,
  cardIndex,
  isArchived,
}: {
  cardPublicId: string;
  isTemplate?: boolean;
  boardPublicId?: string;
  cardCreatedBy?: string | null;
  ticketNumber?: string | null;
  listPublicId?: string;
  cardIndex?: number;
  isArchived?: boolean;
}) {
  const { openModal } = useModal();
  const { showPopup } = usePopup();
  const { canEditCard, canDeleteCard } = usePermissions();
  const { data: session } = authClient.useSession();
  const utils = api.useUtils();
  const isCreator = cardCreatedBy && session?.user.id === cardCreatedBy;

  const duplicateCard = api.card.duplicate.useMutation({
    onSuccess: () => {
      showPopup({
        header: t`Card duplicated`,
        icon: "success",
        message: t`Card duplicated successfully.`,
      });
    },
    onError: () => {
      showPopup({
        header: t`Unable to duplicate card`,
        icon: "error",
        message: t`Please try again.`,
      });
    },
    onSettled: async () => {
      await utils.board.byId.invalidate();
    },
  });

  const toggleArchivedCard = api.card.update.useMutation({
    onSuccess: (_data, variables) => {
      showPopup({
        header: variables.isArchived ? t`Card archived` : t`Card restored`,
        icon: "success",
        message: variables.isArchived
          ? t`The card has been archived.`
          : t`The card has been restored to its list.`,
      });
    },
    onError: () => {
      showPopup({
        header: t`Unable to update card`,
        icon: "error",
        message: t`Please try again.`,
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const handleCopyCardLink = async () => {
    const path =
      isTemplate && boardPublicId
        ? `/templates/${boardPublicId}/cards/${cardPublicId}`
        : `/cards/${cardPublicId}`;
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      showPopup({
        header: t`Link copied`,
        icon: "success",
        message: t`Card URL copied to clipboard`,
      });
    } catch (error) {
      console.error(error);
      showPopup({
        header: t`Unable to copy link`,
        icon: "error",
        message: t`Please try again.`,
      });
    }
  };

  const handleCopyTicketId = async () => {
    if (!ticketNumber) return;
    try {
      await navigator.clipboard.writeText(ticketNumber);
      showPopup({
        header: t`ID copied`,
        icon: "success",
        message: t`Ticket ID copied to clipboard`,
      });
    } catch (error) {
      console.error(error);
      showPopup({
        header: t`Unable to copy ID`,
        icon: "error",
        message: t`Please try again.`,
      });
    }
  };

  const items = [
    {
      label: t`Copy card link`,
      action: handleCopyCardLink,
      icon: <HiLink className="h-[16px] w-[16px] text-dark-900" />,
    },
    ...(ticketNumber
      ? [
          {
            label: t`Copy ticket ID`,
            action: handleCopyTicketId,
            icon: <HiHashtag className="h-[16px] w-[16px] text-dark-900" />,
          },
        ]
      : []),
    ...(canEditCard
      ? [
          {
            label: t`Add checklist`,
            action: () => openModal("ADD_CHECKLIST"),
            icon: (
              <HiOutlineCheckCircle className="h-[16px] w-[16px] text-dark-900" />
            ),
          },
          {
            label: t`Duplicate card`,
            action: () => {
              if (!listPublicId || cardIndex === undefined) return;
              duplicateCard.mutate({
                cardPublicId,
                listPublicId,
                index: cardIndex + 1,
                copyLabels: true,
                copyProject: true,
                copyMembers: true,
                copyChecklists: true,
              });
            },
            icon: (
              <HiOutlineDocumentDuplicate className="h-[16px] w-[16px] text-dark-900" />
            ),
            disabled: duplicateCard.isPending || !listPublicId,
          },
          {
            label: isArchived ? t`Restore card` : t`Archive card`,
            action: () =>
              toggleArchivedCard.mutate({
                cardPublicId,
                isArchived: !isArchived,
              }),
            icon: (
              <IoArchiveOutline className="h-[16px] w-[16px] text-dark-900" />
            ),
            disabled: toggleArchivedCard.isPending,
          },
        ]
      : []),
    ...(canDeleteCard || isCreator
      ? [
          {
            label: t`Delete card`,
            action: () => openModal("DELETE_CARD"),
            icon: (
              <HiOutlineTrash className="h-[16px] w-[16px] text-dark-900" />
            ),
          },
        ]
      : []),
  ];

  if (items.length === 0) {
    return null;
  }

  return (
    <Dropdown items={items} ariaLabel={t`Card options`}>
      <HiEllipsisHorizontal className="h-5 w-5 text-dark-900" />
    </Dropdown>
  );
}
