// Shared TypeScript interfaces — mirrors Rust models exactly.
// Fields are snake_case (Tauri 2 / serde does NOT convert to camelCase).

export type TaskStatus = "backlog" | "ready" | "in-progress" | "in-review" | "done" | "archived";
export type Priority = "P0" | "P1" | "P2";
export type SessionMode = "task" | "vibe" | "shell" | "research" | "chat";
export type SessionTransport = "pty" | "acp";
export type SessionStatus = "starting" | "running" | "paused" | "stopped" | "finished" | "error";
export type ViewId = "dashboard" | "sessions" | "chat" | "task-detail" | "review" | "github" | "skills-rules" | "help";

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
  transport: SessionTransport;
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

// ── Task Activity types ──

export type TaskActivityEventType = "status" | "progress" | "files_changed" | "error" | "waiting" | "complete";

export interface TaskActivity {
  id: string;
  task_id: string;
  project_id: string;
  session_id: string | null;
  event_type: TaskActivityEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface AgentInfo {
  name: string;
  display_name: string;
  command: string;
  installed: boolean;
  default_model: string | null;
  supported_models: string[];
  /** Whether this agent supports ACP (natively or via an external adapter). */
  supports_acp: boolean;
  /** Whether the ACP adapter/binary is actually installed and available. */
  acp_installed: boolean;
  /** The ACP launch command (if different from the PTY command). */
  acp_command: string | null;
  /** Additional args needed to launch in ACP mode (e.g., ["--acp"]). */
  acp_args: string[];
  /** Shell command to install the ACP adapter (e.g., "npm install -g @zed-industries/claude-agent-acp"). Null for native ACP agents. */
  acp_install_command: string | null;
  /** npm package name for the ACP adapter (e.g., "@zed-industries/claude-agent-acp"). Null for native ACP agents. */
  acp_adapter_package: string | null;
  /** URL to the official install/download page for this agent's CLI tool. */
  cli_install_url: string | null;
  /** A short shell command hint for installing the CLI (e.g., "npm install -g ..."). */
  cli_install_hint: string | null;
}

// ── ACP Registry types ──

export interface AcpRegistryEntry {
  /** Registry agent ID (e.g. "claude-acp"). */
  registry_id: string;
  /** Faber's internal agent name (e.g. "claude-code"). */
  faber_agent_name: string;
  /** Display name from the registry. */
  name: string;
  /** Version from the registry. */
  registry_version: string;
  /** Description from the registry. */
  description: string;
  /** Repository URL. */
  repository: string | null;
  /** Authors list. */
  authors: string[];
  /** License string. */
  license: string | null;
  /** Icon URL from the CDN. */
  icon_url: string | null;
  /** Whether the agent CLI is installed locally. */
  cli_installed: boolean;
  /** Whether the ACP adapter is installed locally. */
  adapter_installed: boolean;
  /** Locally installed adapter package name (if any). */
  local_adapter_package: string | null;
  /** Locally installed adapter version (if detected via npm). */
  installed_version: string | null;
  /** Whether an update is available (registry version > local). */
  update_available: boolean;
  /** Install command from registry distribution. */
  install_command: string | null;
}

// ── ACP event types ──

export interface AcpMessageChunk {
  session_id: string;
  text: string;
}

/** Tool call content produced by the agent (matches Rust ToolCallContentItem). */
export type ToolCallContentItem =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; old_text: string | null; new_text: string }
  | { type: "terminal"; terminal_id: string };

export interface AcpToolCall {
  session_id: string;
  tool_call_id: string;
  title: string;
  kind: string;
  status: string;
  content?: ToolCallContentItem[];
}

export interface AcpToolCallUpdate {
  session_id: string;
  tool_call_id: string;
  status: string;
  title: string | null;
  content?: ToolCallContentItem[] | null;
}

export interface AcpPlanEntry {
  id: string;
  title: string;
  status: string;
}

export interface AcpPlanUpdate {
  session_id: string;
  entries: AcpPlanEntry[];
}

export interface AcpModeUpdate {
  session_id: string;
  mode: string;
}

export interface AcpSessionInfo {
  session_id: string;
  title: string | null;
}

export interface AcpPromptComplete {
  session_id: string;
  stop_reason: string;
}

export interface AcpError {
  session_id: string;
  error: string;
}

// ── ACP Permission types ──

export interface AcpPermissionOption {
  option_id: string;
  name: string;
  kind: string;
  description: string | null;
}

export interface AcpPermissionRequest {
  session_id: string;
  request_id: string;
  capability: string;
  detail: string;
  description: string;
  options: AcpPermissionOption[];
}

export interface AcpPermissionResponse {
  session_id: string;
  request_id: string;
  approved: boolean;
  timed_out: boolean;
}

// ── ACP available commands & config options ──

export interface AcpAvailableCommand {
  name: string;
  description: string;
  input_hint?: string;
}

export interface AcpAvailableCommandsUpdate {
  session_id: string;
  commands: AcpAvailableCommand[];
}

export interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

export interface AcpConfigSelectGroup {
  name: string;
  options: AcpConfigSelectOption[];
}

export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string;
  /** Semantic category: "mode", "model", "thought_level", or custom. */
  category?: string;
  current_value: string;
  /** Flat list of options (when ungrouped). */
  options: AcpConfigSelectOption[];
  /** Grouped options (when grouped). */
  groups: AcpConfigSelectGroup[];
}

export interface AcpConfigOptionUpdate {
  session_id: string;
  config_options: AcpConfigOption[];
}

/** Context window usage and cost data from ACP UsageUpdate. */
export interface AcpUsageData {
  /** Tokens currently in context. */
  used: number;
  /** Total context window size in tokens. */
  size: number;
  /** Cumulative session cost amount (if provided by agent). */
  cost_amount?: number;
  /** ISO 4217 currency code (e.g. "USD"). */
  cost_currency?: string;
}

export type PermissionAction = "auto_approve" | "ask" | "deny";

export interface PermissionRule {
  id: string;
  project_id: string;
  capability: string;
  path_pattern: string | null;
  command_pattern: string | null;
  action: PermissionAction;
  created_at: string;
}

export interface PermissionLogEntry {
  id: string;
  session_id: string;
  project_id: string;
  capability: string;
  detail: string;
  decision: string;
  decided_at: string;
}

// ── ACP accumulated chat state (frontend-only, built from ACP events) ──

/** Lightweight attachment record kept on user messages for display purposes. */
export interface AcpMessageAttachment {
  filename: string;
  mediaType: string;
  /** Data URL (for images) or empty string (for non-image files, to save memory). */
  url: string;
}

export interface AcpChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  /** Attachments sent with this user message. */
  attachments?: AcpMessageAttachment[];
  /** Thinking/reasoning text that preceded this agent message (populated when thinking stream completes). */
  thinkingText?: string;
  /** Duration in seconds of the thinking phase, if any. */
  thinkingDuration?: number;
  /** Whether this message represents an error (e.g. ACP prompt failure). */
  isError?: boolean;
  /** Whether this message is inter-tool narration (agent text between tool calls, not the final response). */
  isNarration?: boolean;
}

export interface AcpToolCallState {
  tool_call_id: string;
  title: string;
  kind: string;
  status: string; // "pending" | "in_progress" | "completed" | "failed"
  /** Index of the agent message this tool call is associated with. */
  messageIndex: number;
  /** Arrival timestamp for chronological ordering in the timeline. */
  timestamp: number;
  /** Content produced by the tool call (code, diffs, terminal output). */
  content?: ToolCallContentItem[];
}

/** A standalone thinking/reasoning block, positioned chronologically in the timeline. */
export interface AcpThinkingBlock {
  id: string;
  text: string;
  timestamp: number;
  /** Duration in seconds of the thinking phase. */
  duration?: number;
}

// ── ACP Capabilities ──

export interface AgentCapabilities {
  image: boolean;
  audio: boolean;
  embedded_context: boolean;
}

// ── Rule file types ──

export interface RuleFrontmatter {
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
}

export interface RuleFileInfo {
  agentName: string;
  displayName: string;
  path: string | null;
  relativePath: string;
  exists: boolean;
  scope: "project" | "global";
  category: "primary" | "nested" | "local" | "override";
  deprecated: boolean;
  deprecationHint: string | null;
  frontmatter: RuleFrontmatter | null;
}

export interface AgentRuleGroup {
  agentName: string;
  displayName: string;
  installed: boolean;
  projectRules: RuleFileInfo[];
  globalRules: RuleFileInfo[];
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

export interface GitHubComment {
  id: number;
  author: string;
  author_avatar: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubIssueDetail {
  issue: GitHubIssue;
  already_imported: boolean;
  existing_task_id: string | null;
  comments: GitHubComment[];
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

// ── Prompt Template types ──

export type PromptCategory = "session" | "action";

export interface PromptTemplate {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  category: PromptCategory;
  session_mode?: string;
  quick_action: boolean;
  builtin: boolean;
  sort_order: number;
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
