import { t } from "@lingui/core/macro";
import { HiMiniPlus } from "react-icons/hi2";

import Badge from "~/components/Badge";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface ProjectSelectorProps {
  cardPublicId: string;
  projects: {
    key: string;
    value: string;
    selected: boolean;
    leftIcon: React.ReactNode;
  }[];
  isLoading: boolean;
  disabled?: boolean;
}

export default function ProjectSelector({
  cardPublicId,
  projects,
  isLoading,
  disabled = false,
}: ProjectSelectorProps) {
  const utils = api.useUtils();
  const { openModal } = useModal();
  const { showPopup } = usePopup();

  const setProject = api.card.setProject.useMutation({
    onMutate: async (update) => {
      await utils.card.byId.cancel();

      const previousCard = utils.card.byId.getData({ cardPublicId });

      utils.card.byId.setData({ cardPublicId }, (oldCard) => {
        if (!oldCard) return oldCard;

        if (update.projectPublicId === null) {
          return { ...oldCard, project: null };
        }

        const project = projects.find(
          (project) => project.key === update.projectPublicId,
        );

        return {
          ...oldCard,
          project: {
            publicId: update.projectPublicId,
            name: project?.value ?? "",
            colourCode: null,
          },
        };
      });

      return { previousCard };
    },
    onError: (_error, _newProject, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      showPopup({
        header: t`Unable to update project`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const selectedProject = projects.find((project) => project.selected);

  return (
    <>
      {isLoading ? (
        <div className="flex w-full">
          <div className="h-full w-[175px] animate-pulse rounded-[5px] bg-light-300 dark:bg-dark-300" />
        </div>
      ) : (
        <CheckboxDropdown
          items={projects}
          handleSelect={(_, project) => {
            setProject.mutate({
              cardPublicId,
              projectPublicId:
                selectedProject?.key === project.key ? null : project.key,
            });
          }}
          handleEdit={
            disabled
              ? undefined
              : (projectPublicId) => openModal("EDIT_PROJECT", projectPublicId)
          }
          handleCreate={disabled ? undefined : () => openModal("NEW_PROJECT")}
          createNewItemLabel={t`Create new project`}
          ariaLabel={t`Project`}
          disabled={disabled}
          asChild
        >
          {selectedProject ? (
            <div className="flex flex-wrap gap-x-0.5">
              <Badge
                value={selectedProject.value}
                iconLeft={selectedProject.leftIcon}
              />
            </div>
          ) : (
            <div
              className={`flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 pl-2 text-left text-sm text-neutral-900 dark:border-dark-50 dark:text-dark-1000 ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100"}`}
            >
              <HiMiniPlus size={22} className="pr-2" />
              {t`Add project`}
            </div>
          )}
        </CheckboxDropdown>
      )}
    </>
  );
}
