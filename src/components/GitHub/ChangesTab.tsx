import { useAppStore } from "../../store/appStore";
import DiffView from "../Review/DiffView";

interface ChangesTabProps {
  projectId: string;
}

export default function ChangesTab({ projectId }: ChangesTabProps) {
  const projectInfo = useAppStore((s) => s.projectInfo);
  const projectPath = projectInfo?.project.path ?? null;

  // Empty state when project path is unavailable
  if (!projectPath) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No project path available
        </p>
      </div>
    );
  }

  return (
    <DiffView
      path={projectPath}
      projectId={projectId}
      variant="embedded"
    />
  );
}
