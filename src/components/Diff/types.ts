/** Shared diff types used by all diff rendering paths. */

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  isNewFile?: boolean;
  isDeleted?: boolean;
}
