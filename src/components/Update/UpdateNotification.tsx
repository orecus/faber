import { useCallback } from "react";
import { Download, Loader2, X, AlertCircle } from "lucide-react";
import { useUpdateStore } from "../../store/updateStore";

export default function UpdateNotification() {
  const status = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);
  const error = useUpdateStore((s) => s.error);
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate);

  const handleDismiss = useCallback(() => {
    dismissUpdate();
  }, [dismissUpdate]);

  const handleDownload = useCallback(() => {
    downloadAndInstall();
  }, [downloadAndInstall]);

  // Don't show for dismissed versions
  if (
    status === "available" &&
    updateInfo?.latest_version === dismissedVersion
  ) {
    return null;
  }

  // Only show when there's something to display
  if (status !== "available" && status !== "downloading" && status !== "installing" && status !== "error") {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl bg-card/90 backdrop-blur-md ring-1 ring-border/50 shadow-lg overflow-hidden">
      {/* Available state */}
      {status === "available" && updateInfo && (
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="text-sm font-medium text-foreground">
              Update Available
            </div>
            <button
              onClick={handleDismiss}
              className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            <span className="text-dim-foreground">{updateInfo.current_version}</span>
            {" → "}
            <span className="text-primary font-medium">{updateInfo.latest_version}</span>
          </div>
          {updateInfo.release_notes && (
            <div className="text-xs text-muted-foreground mb-3 line-clamp-3 leading-relaxed">
              {updateInfo.release_notes}
            </div>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Download size={13} />
            Download & Install
          </button>
        </div>
      )}

      {/* Downloading state */}
      {status === "downloading" && (
        <div className="p-4">
          <div className="text-sm font-medium text-foreground mb-2">
            Downloading Update...
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mb-1.5">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground text-right">
            {downloadProgress}%
          </div>
        </div>
      )}

      {/* Installing state */}
      {status === "installing" && (
        <div className="p-4 flex items-center gap-2.5">
          <Loader2 size={16} className="animate-spin text-primary shrink-0" />
          <div>
            <div className="text-sm font-medium text-foreground">
              Installing update...
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              The app will restart shortly
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5">
              <AlertCircle size={14} className="text-destructive shrink-0" />
              <div className="text-sm font-medium text-foreground">
                Update Failed
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          {error && (
            <div className="text-xs text-muted-foreground line-clamp-2">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
