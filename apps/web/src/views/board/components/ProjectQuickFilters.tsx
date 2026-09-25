import { useRouter } from "next/router";

import Badge from "~/components/Badge";
import LabelIcon from "~/components/LabelIcon";
import { formatToArray } from "~/utils/helpers";

interface Project {
  publicId: string;
  name: string;
  colourCode: string | null;
}

const ProjectQuickFilters = ({ projects }: { projects: Project[] }) => {
  const router = useRouter();

  const activeProjectId = formatToArray(router.query.projects)[0];

  const handleToggle = async (projectPublicId: string) => {
    const isActive = activeProjectId === projectPublicId;

    try {
      await router.push({
        pathname: router.pathname,
        query: {
          ...router.query,
          projects: isActive ? [] : [projectPublicId],
        },
      });
    } catch (error) {
      console.error(error);
    }
  };

  if (!projects.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {projects.map((project) => {
        const isSelected = activeProjectId === project.publicId;

        return (
          <button
            key={project.publicId}
            type="button"
            onClick={() => handleToggle(project.publicId)}
            className={`rounded-[5px] transition-opacity ${
              isSelected ? "opacity-100" : "opacity-60 hover:opacity-100"
            }`}
          >
            <Badge
              value={project.name}
              iconLeft={<LabelIcon colourCode={project.colourCode} />}
            />
          </button>
        );
      })}
    </div>
  );
};

export default ProjectQuickFilters;
