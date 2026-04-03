/**
 * Input adapters that convert different diff sources into the shared DiffFile format.
 * Both adapters produce the same output — only the input differs.
 */

import { parsePatch, structuredPatch } from "diff";
import type { DiffFile, DiffHunk, DiffLine } from "./types";

/**
 * Parse a unified diff string (e.g. `git diff` output) into DiffFile[].
 * Handles multi-file diffs with proper file path extraction.
 */
export function fromUnifiedDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];

  const patches = parsePatch(raw);
  return patches.map((patch) => {
    // Extract path — strip "a/" and "b/" prefixes from git diff output
    const oldPath = patch.oldFileName?.replace(/^a\//, "") ?? "";
    const newPath = patch.newFileName?.replace(/^b\//, "") ?? "";
    const isNewFile = oldPath === "/dev/null";
    const isDeleted = newPath === "/dev/null";
    const path = isDeleted ? oldPath : newPath;

    const hunks: DiffHunk[] = patch.hunks.map((h) => {
      const lines: DiffLine[] = [];
      let oldLineNo = h.oldStart;
      let newLineNo = h.newStart;

      for (const rawLine of h.lines) {
        const prefix = rawLine[0];
        const text = rawLine.slice(1);

        if (prefix === "+") {
          lines.push({ type: "add", text, oldLineNo: null, newLineNo: newLineNo++ });
        } else if (prefix === "-") {
          lines.push({ type: "remove", text, oldLineNo: oldLineNo++, newLineNo: null });
        } else {
          // Context line (space prefix) or "\ No newline at end of file"
          if (prefix === "\\") continue;
          lines.push({ type: "context", text, oldLineNo: oldLineNo++, newLineNo: newLineNo++ });
        }
      }

      return { oldStart: h.oldStart, newStart: h.newStart, lines };
    });

    return { path, hunks, isNewFile, isDeleted };
  });
}

/**
 * Compute a diff between two text strings and return a single DiffFile.
 * Used by ACP tool calls that provide old/new text content.
 */
export function fromTexts(
  path: string,
  oldText: string | null,
  newText: string,
): DiffFile {
  const isNewFile = oldText === null;
  const old = oldText ?? "";

  const patch = structuredPatch(path, path, old, newText, undefined, undefined, {
    context: 3,
  });

  const hunks: DiffHunk[] = patch.hunks.map((h) => {
    const lines: DiffLine[] = [];
    let oldLineNo = h.oldStart;
    let newLineNo = h.newStart;

    for (const rawLine of h.lines) {
      const prefix = rawLine[0];
      const text = rawLine.slice(1);

      if (prefix === "+") {
        lines.push({ type: "add", text, oldLineNo: null, newLineNo: newLineNo++ });
      } else if (prefix === "-") {
        lines.push({ type: "remove", text, oldLineNo: oldLineNo++, newLineNo: null });
      } else {
        if (prefix === "\\") continue;
        lines.push({ type: "context", text, oldLineNo: oldLineNo++, newLineNo: newLineNo++ });
      }
    }

    return { oldStart: h.oldStart, newStart: h.newStart, lines };
  });

  return { path, hunks, isNewFile };
}
