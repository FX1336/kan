import { t } from "@lingui/core/macro";

import Button from "~/components/Button";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

export function DeleteProjectConfirmation({
  projectPublicId,
  refetch,
}: {
  projectPublicId: string;
  refetch: () => void;
}) {
  const { closeModal, closeModals } = useModal();
  const { showPopup } = usePopup();

  const deleteProjectMutation = api.project.delete.useMutation({
    onSuccess: () => {
      refetch();
      closeModals(2);
    },
    onError: () =>
      showPopup({
        header: t`Error deleting project`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      }),
  });

  const handleDeleteProject = () => {
    deleteProjectMutation.mutate({
      projectPublicId,
    });
  };

  return (
    <div className="p-5">
      <div className="flex w-full flex-col justify-between pb-4">
        <h2 className="text-md pb-4 font-medium text-neutral-900 dark:text-dark-1000">
          {t`Are you sure you want to delete this project?`}
        </h2>
        <p className="text-sm font-medium text-light-900 dark:text-dark-900">
          {t`This action can't be undone.`}
        </p>
      </div>
      <div className="mt-5 flex justify-end space-x-2 sm:mt-6">
        <Button variant="secondary" onClick={() => closeModal()}>
          {t`Cancel`}
        </Button>
        <Button onClick={handleDeleteProject}>{t`Delete`}</Button>
      </div>
    </div>
  );
}
