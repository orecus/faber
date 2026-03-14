import {
  AlertTriangle,
  CircleDot,
  GitPullRequestArrow,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";

import type { LucideIcon } from "lucide-react";

interface GitHubAuthGateProps {
  /** The feature name (e.g. "issues", "pull requests") for display text */
  feature: string;
  /** Icon to show in the empty state */
  icon?: LucideIcon;
  /** Whether the repo has a remote configured */
  hasRemote: boolean;
  /** Callback to open the GitHub settings dialog */
  onOpenSettings?: () => void;
  /** Content to render when auth is OK and remote is available */
  children: React.ReactNode;
}

/**
 * Shared component that gates GitHub-dependent content on auth + remote status.
 * Shows appropriate empty states with links to GitHub settings when auth is
 * broken or no remote is configured.
 *
 * Changes/Commits tabs should NOT use this — they're pure git operations.
 */
export default function GitHubAuthGate({
  feature,
  icon: Icon,
  hasRemote,
  onOpenSettings,
  children,
}: GitHubAuthGateProps) {
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);
  const refreshGhAuth = useAppStore((s) => s.refreshGhAuth);

  // No remote configured
  if (!hasRemote) {
    const FallbackIcon = Icon ?? CircleDot;
    return (
      <div className="flex flex-1 h-full flex-col items-center justify-center text-muted-foreground">
        <FallbackIcon className="mb-3 size-10 opacity-30" />
        <p className="text-sm font-medium text-foreground">
          No remote configured
        </p>
        <p className="mt-1 text-xs text-center max-w-xs">
          This project has no git remote. Add a remote to browse {feature}.
        </p>
      </div>
    );
  }

  // Auth is broken
  const authBroken =
    ghAuthStatus &&
    (!ghAuthStatus.installed ||
      !ghAuthStatus.authenticated ||
      ghAuthStatus.has_scope_warnings);

  if (authBroken) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <AlertTriangle className="mb-3 size-10 opacity-40 text-warning" />
        <p className="text-sm font-medium text-foreground">
          GitHub authentication issue
        </p>
        <p className="mt-1 text-xs text-center max-w-xs">
          {!ghAuthStatus?.installed
            ? `GitHub CLI (gh) is not installed. Install it to browse ${feature}.`
            : !ghAuthStatus?.authenticated
              ? `GitHub CLI is not authenticated. Run \`gh auth login\` to browse ${feature}.`
              : `Token is missing required scopes: ${ghAuthStatus.missing_scopes.join(", ")}. Update your token to browse ${feature}.`}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshGhAuth}
            leftIcon={<RefreshCw className="size-3" />}
            hoverEffect="scale"
            clickEffect="scale"
          >
            Re-check auth
          </Button>
          {onOpenSettings && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenSettings}
              leftIcon={<Settings className="size-3" />}
              hoverEffect="scale"
              clickEffect="scale"
            >
              GitHub Settings
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Auth is OK — render children
  return <>{children}</>;
}

/**
 * Helper to determine the default icon for each feature type
 */
export function getFeatureIcon(feature: string): LucideIcon {
  switch (feature) {
    case "issues":
      return CircleDot;
    case "pull requests":
      return GitPullRequestArrow;
    default:
      return CircleDot;
  }
}
