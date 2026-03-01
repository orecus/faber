// Shared TypeScript interfaces — mirrors Rust models exactly.
// Fields are snake_case (Tauri 2 / serde does NOT convert to camelCase).

export type TaskStatus = "backlog" | "ready" | "in-progress" | "in-review" | "done" | "archived";
export type Priority = "P0" | "P1" | "P2";
export type SessionMode = "task" | "vibe" | "shell" | "research";
export type SessionStatus = "starting" | "running" | "paused" | "stopped" | "finished" | "error";
export type ViewId = "dashboard" | "sessions" | "task-detail" | "review" | "github" | "skills-rules" | "help";

export interface Project {
  id: string;
  name: string;
  path: string;
  default_agent: string | null;
  default_model: string | null;
  branch_naming_pattern: string | null;
  instruction_file_path: string | null;
  icon_path: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectInfo {
  project: Project;
  current_branch: string | null;
  has_config_file: boolean;
  instruction_file: string | null;
}

export interface Task {
  id: string;
  project_id: string;
  task_file_path: string | null;
  title: string;
  status: TaskStatus;
  priority: Priority;
  agent: string | null;
  model: string | null;
  branch: string | null;
  worktree_path: string | null;
  github_issue: string | null;
  github_pr: string | null;
  depends_on: string[];
  labels: string[];
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  task_id: string | null;
  name: string | null;
  mode: SessionMode;
  agent: string;
  model: string | null;
  status: SessionStatus;
  pid: number | null;
  worktree_path: string | null;
  mcp_connected: boolean;
  started_at: string;
  ended_at: string | null;
}

// ── File Browser types ──

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  extension: string | null;
}

// ── MCP event types ──

export interface McpStatusUpdate {
  session_id: string;
  status: string;
  message: string;
  activity: string | null;
  project_id: string | null;
}

export interface McpProgressUpdate {
  session_id: string;
  current_step: number;
  total_steps: number;
  description: string;
}

export interface McpWaiting {
  session_id: string;
  question: string;
  project_id: string | null;
}

export interface McpError {
  session_id: string;
  error: string;
  details: string | null;
  project_id: string | null;
}

export interface McpComplete {
  session_id: string;
  summary: string;
  files_changed: number | null;
  project_id: string | null;
}

export interface McpInfo {
  port: number;
  active_sessions: number;
  sidecar_path: string | null;
}

export interface McpSessionState {
  status?: string;
  message?: string;
  activity?: string;
  current_step?: number;
  total_steps?: number;
  description?: string;
  waiting?: boolean;
  waiting_question?: string;
  error?: boolean;
  error_message?: string;
  completed?: boolean;
  summary?: string;
}

export interface TaskFileContent {
  task: Task;
  body: string;
}

export interface AgentInfo {
  name: string;
  display_name: string;
  command: string;
  installed: boolean;
  default_model: string | null;
  supported_models: string[];
}

export interface ShellInfo {
  name: string;
  path: string;
}

// ── Git / Diff types ──

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head_commit: string | null;
  is_main: boolean;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
}

export interface PullRequestResult {
  url: string;
  number: number;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  parent_hashes: string[];
  author_name: string;
  author_email: string;
  timestamp: number;
  subject: string;
}

export interface CommitDetail {
  hash: string;
  short_hash: string;
  parent_hashes: string[];
  author_name: string;
  author_email: string;
  timestamp: number;
  subject: string;
  body: string;
  files: ChangedFile[];
}

export interface RefInfo {
  branches: string[];
  tags: string[];
}

export interface CommitRefEntry {
  hash: string;
  refs: RefInfo;
}

// ── Git sync types ──

export interface SyncStatus {
  ahead: number;
  behind: number;
}

export interface BranchList {
  local: string[];
  remote: string[];
  current: string;
}

// ── GitHub CLI types ──

export interface GhAuthStatus {
  installed: boolean;
  authenticated: boolean;
  username: string | null;
  error: string | null;
  /** How the token was sourced: "keyring", "GITHUB_TOKEN", "GH_TOKEN", etc. */
  token_source: string | null;
  /** Scopes reported as missing by `gh auth status` (e.g. ["read:org"]). */
  missing_scopes: string[];
  /** `true` when authenticated but `missing_scopes` is non-empty. */
  has_scope_warnings: boolean;
}

// ── GitHub Issues types ──

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubUser {
  login: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  created_at: string;
  updated_at: string;
  url: string;
}

export interface GitHubIssueWithImportStatus {
  issue: GitHubIssue;
  already_imported: boolean;
  existing_task_id: string | null;
}

export interface ImportResult {
  imported_count: number;
  skipped_count: number;
  tasks: Task[];
}

// ── GitHub Pull Request types ──

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  author: GitHubUser;
  created_at: string;
  updated_at: string;
  head_ref_name: string;
  base_ref_name: string;
  url: string;
  is_draft: boolean;
  review_decision: string | null;
  labels: GitHubLabel[];
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GitHubPRFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitHubPRReview {
  author: string;
  state: string;
}

export interface GitHubPRDetail extends GitHubPR {
  body: string;
  files: GitHubPRFile[];
  reviews: GitHubPRReview[];
  mergeable: string | null;
  merge_state_status: string | null;
}

export interface GitHubIssueCreated {
  number: number;
  url: string;
}

// ── GitHub Sync types ──

export interface GitHubLabelFull {
  name: string;
  color: string;
  description: string | null;
}

export type GitHubLabelMapping = Partial<Record<TaskStatus, string>>;

// ── Agent Usage types ──

export interface UsageWindow {
  label: string;
  utilization: number;       // 0-100
  resets_at: string | null;  // ISO 8601
}

export interface AgentUsageData {
  agent_name: string;
  display_name: string;
  windows: UsageWindow[];
  error: string | null;
  needs_auth: boolean;
}

// ── Update types ──

export interface UpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string;
  release_notes: string | null;
  date: string | null;
}

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "error";

// ── Documentation types ──

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  icon: string;
  order: number;
}

export interface DocContent {
  slug: string;
  title: string;
  body: string;
}

// ── Continuous Mode types ──

export type BranchingStrategy = "independent" | "chained";
export type ContinuousStatus = "running" | "paused" | "completed";
export type QueueItemStatus = "pending" | "running" | "completed" | "error";

export interface ContinuousQueueItem {
  task_id: string;
  status: QueueItemStatus;
  session_id: string | null;
  error: string | null;
}

export interface ContinuousRun {
  project_id: string;
  status: ContinuousStatus;
  queue: ContinuousQueueItem[];
  current_index: number;
  strategy: BranchingStrategy;
  base_branch: string | null;
  agent_name: string | null;
  model: string | null;
  last_branch: string | null;
}

export interface ContinuousModeUpdate {
  project_id: string;
  run: ContinuousRun;
}

export interface ContinuousModeFinished {
  project_id: string;
  completed_count: number;
}
