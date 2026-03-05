/**
 * Error formatting utilities for user-facing error messages.
 *
 * The Rust backend already maps most technical errors to friendly messages
 * via `AppError::user_message()`. This module handles:
 * 1. Normalizing unknown error types to strings
 * 2. Stripping redundant prefixes from Rust error categories
 * 3. Adding contextual hints based on where the error occurred
 */

/** Contexts for adding action hints to error messages. */
export type ErrorContext =
  | "agent-launch"
  | "git-pull"
  | "git-push"
  | "github-pr"
  | "github-cli"
  | "plugin"
  | "skill"
  | "settings"
  | "file";

/**
 * Normalize an unknown error value to a clean, user-friendly string.
 *
 * - Extracts `.message` from Error objects
 * - Strips Rust `AppError` category prefixes that may still appear
 *   (e.g. "IO error: ..." → "...")
 * - Falls back to a generic message for empty/null values
 */
export function formatError(error: unknown): string {
  const raw = errorToString(error);
  return cleanErrorMessage(raw);
}

/**
 * Format an error with an additional contextual hint appended.
 *
 * Example:
 *   formatErrorWithHint(err, "agent-launch")
 *   → "Could not start the process. Make sure the agent CLI is installed and available on your PATH."
 *
 * If the error message already contains the hint text, the hint is not duplicated.
 */
export function formatErrorWithHint(
  error: unknown,
  context: ErrorContext,
): string {
  const message = formatError(error);
  const hint = contextHints[context];

  if (!hint) return message;
  // Don't duplicate if the backend already included the hint
  if (message.toLowerCase().includes(hint.toLowerCase())) return message;

  return `${message}\n${hint}`;
}

// ── Internal helpers ──

const categoryPrefixes = [
  "Database error: ",
  "Git error: ",
  "IO error: ",
  "Validation error: ",
  "Not found: ",
  "Keyring error: ",
  // Also handle "GitHub CLI error:" from our Rust mapping
  "GitHub CLI error: ",
];

const contextHints: Record<ErrorContext, string> = {
  "agent-launch":
    "Make sure the agent CLI is installed and available on your PATH.",
  "git-pull":
    "Check your remote configuration and network connection.",
  "git-push":
    "Check your remote configuration and authentication.",
  "github-pr":
    'Verify your GitHub authentication with `gh auth status`.',
  "github-cli":
    "Is the GitHub CLI (`gh`) installed and authenticated?",
  plugin:
    "Is the Claude Code CLI installed and up to date?",
  skill:
    "Make sure npm/npx is installed and available on your PATH.",
  settings:
    "Check file permissions on the app data directory.",
  file:
    "Check that the file exists and you have the right permissions.",
};

/** Convert an unknown error to a string. */
function errorToString(error: unknown): string {
  if (error === null || error === undefined) {
    return "An unknown error occurred";
  }
  if (typeof error === "string") {
    return error || "An unknown error occurred";
  }
  if (error instanceof Error) {
    return error.message || "An unknown error occurred";
  }
  // Tauri IPC errors come as plain strings
  return String(error) || "An unknown error occurred";
}

/**
 * Strip redundant category prefixes.
 *
 * The Rust `user_message()` now returns clean messages for most errors,
 * but unmapped errors still carry a prefix like "IO error: ...".
 * For those, we strip the prefix since the UI context already indicates
 * what kind of operation failed.
 */
function cleanErrorMessage(msg: string): string {
  for (const prefix of categoryPrefixes) {
    if (msg.startsWith(prefix)) {
      const stripped = msg.slice(prefix.length).trim();
      if (stripped) return stripped;
    }
  }
  return msg;
}
