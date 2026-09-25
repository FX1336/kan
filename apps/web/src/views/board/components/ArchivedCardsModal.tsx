import Link from "next/link";
import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { HiOutlineArchiveBoxXMark } from "react-icons/hi2";

import Button from "~/components/Button";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePermissions } from "~/hooks/usePermissions";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

interface ArchivedCardsModalProps {
  boardPublicId: string;
  cardPrefix: string;
  isTemplate: boolean;
  cardReturnQuery: string;
}

export function ArchivedCardsModal({
  boardPublicId,
  cardPrefix,
  isTemplate,
  cardReturnQuery,
}: ArchivedCardsModalProps) {
  const { canEditCard } = usePermissions();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const { dateLocale } = useLocalisation();

  const { data: archivedCards, isLoading } = api.card.getArchived.useQuery(
    { boardPublicId },
    { enabled: !!boardPublicId },
  );

  const restoreCard = api.card.update.useMutation({
    onError: () => {
      showPopup({
        header: t`Unable to restore card`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSuccess: () => {
      showPopup({
        header: t`Card restored`,
        message: t`The card has been restored to its list.`,
        icon: "success",
      });
    },
    onSettled: async () => {
      await utils.card.getArchived.invalidate({ boardPublicId });
      await utils.board.byId.invalidate();
    },
  });

  const cardHref = (cardPublicId: string) =>
    isTemplate
      ? `/templates/${boardPublicId}/cards/${cardPublicId}${cardReturnQuery}`
      : `/cards/${cardPublicId}${cardReturnQuery}`;

  return (
    <div className="p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-dark-1000">
        {t`Archived cards`}
      </h2>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-10 w-full animate-pulse rounded-[5px] bg-light-200 dark:bg-dark-200" />
          <div className="h-10 w-full animate-pulse rounded-[5px] bg-light-200 dark:bg-dark-200" />
        </div>
      ) : !archivedCards?.length ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <HiOutlineArchiveBoxXMark className="h-8 w-8 text-light-700 dark:text-dark-800" />
          <p className="text-sm text-light-900 dark:text-dark-900">
            {t`No archived cards`}
          </p>
        </div>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-light-200 overflow-y-auto rounded-md border border-light-200 dark:divide-dark-300 dark:border-dark-300">
          {archivedCards.map((card) => (
            <li
              key={card.publicId}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={cardHref(card.publicId)}
                  className="truncate text-sm font-medium text-light-1000 hover:underline dark:text-dark-1000"
                >
                  {card.cardNumber != null
                    ? `${cardPrefix}-${card.cardNumber} `
                    : ""}
                  {card.title}
                </Link>
                <span className="truncate text-xs text-light-800 dark:text-dark-800">
                  {card.listName}
                  {card.updatedAt &&
                    ` · ${t`Archived`} ${format(card.updatedAt, "do MMM yyyy", { locale: dateLocale })}`}
                </span>
              </div>
              {canEditCard && (
                <Button
                  variant="secondary"
                  size="xs"
                  isLoading={
                    restoreCard.isPending &&
                    restoreCard.variables?.cardPublicId === card.publicId
                  }
                  onClick={() =>
                    restoreCard.mutate({
                      cardPublicId: card.publicId,
                      isArchived: false,
                    })
                  }
                >
                  {t`Restore`}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
