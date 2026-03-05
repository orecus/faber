import { AlertTriangle, Check, Copy, RotateCcw } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

/**
 * React Error Boundary that wraps the main content area.
 *
 * Catches unhandled rendering errors and displays a recovery UI
 * instead of crashing the entire app. Sidebar and top bar remain
 * functional so the user can navigate away or reload.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary] Uncaught rendering error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  private handleCopy = async () => {
    const { error, errorInfo } = this.state;
    const report = [
      `Error: ${error?.message ?? "Unknown error"}`,
      `\nStack:\n${error?.stack ?? "No stack trace"}`,
      `\nComponent Stack:\n${errorInfo?.componentStack ?? "No component stack"}`,
      `\nTimestamp: ${new Date().toISOString()}`,
      `User Agent: ${navigator.userAgent}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(report);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: select a textarea — but for simplicity just log
      console.log("[ErrorBoundary] Error report:\n", report);
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, copied } = this.state;
    const message = error?.message ?? "An unexpected error occurred";

    return (
      <div className="flex items-center justify-center h-full w-full p-8"
           style={{ gridArea: "content" }}>
        <div className="flex flex-col items-center gap-6 max-w-md w-full">
          {/* Icon */}
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-destructive/10 ring-1 ring-destructive/20">
            <AlertTriangle size={22} className="text-destructive" />
          </div>

          {/* Heading + description */}
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="text-base font-semibold text-foreground">
              Something went wrong
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This view encountered an error and could not render. You can try
              recovering, reload the app, or copy the error details for a bug report.
            </p>
          </div>

          {/* Error message box */}
          <div className="w-full rounded-lg bg-muted/50 ring-1 ring-border/60 px-4 py-3 overflow-auto max-h-32">
            <p className="text-xs text-muted-foreground font-mono break-words whitespace-pre-wrap">
              {message}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleRecover}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw size={14} />
              Try again
            </button>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reload app
            </button>
            <button
              onClick={this.handleCopy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-success" />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy error
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
