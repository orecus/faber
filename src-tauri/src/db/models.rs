use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

// ── Enums ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskStatus {
    Backlog,
    Ready,
    InProgress,
    InReview,
    Done,
    Archived,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Ready => "ready",
            Self::InProgress => "in-progress",
            Self::InReview => "in-review",
            Self::Done => "done",
            Self::Archived => "archived",
        }
    }
}

impl fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TaskStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "backlog" => Ok(Self::Backlog),
            "ready" => Ok(Self::Ready),
            "in-progress" => Ok(Self::InProgress),
            "in-review" => Ok(Self::InReview),
            "done" => Ok(Self::Done),
            "archived" => Ok(Self::Archived),
            _ => Err(format!("invalid task status: {s}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Priority {
    P0,
    P1,
    P2,
}

impl Priority {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::P0 => "P0",
            Self::P1 => "P1",
            Self::P2 => "P2",
        }
    }
}

impl fmt::Display for Priority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Priority {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "P0" => Ok(Self::P0),
            "P1" => Ok(Self::P1),
            "P2" => Ok(Self::P2),
            _ => Err(format!("invalid priority: {s}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    Task,
    Vibe,
    Shell,
    Research,
}

impl SessionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Vibe => "vibe",
            Self::Shell => "shell",
            Self::Research => "research",
        }
    }
}

impl fmt::Display for SessionMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for SessionMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "task" => Ok(Self::Task),
            "vibe" => Ok(Self::Vibe),
            "shell" => Ok(Self::Shell),
            "research" => Ok(Self::Research),
            _ => Err(format!("invalid session mode: {s}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Starting,
    Running,
    Paused,
    Stopped,
    Finished,
    Error,
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Stopped => "stopped",
            Self::Finished => "finished",
            Self::Error => "error",
        }
    }
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for SessionStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "starting" => Ok(Self::Starting),
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            "stopped" => Ok(Self::Stopped),
            "finished" => Ok(Self::Finished),
            "error" => Ok(Self::Error),
            _ => Err(format!("invalid session status: {s}")),
        }
    }
}

// ── Structs ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub default_agent: Option<String>,
    pub default_model: Option<String>,
    pub branch_naming_pattern: Option<String>,
    pub instruction_file_path: Option<String>,
    pub icon_path: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct NewProject {
    pub name: String,
    pub path: String,
    pub default_agent: Option<String>,
    pub default_model: Option<String>,
    pub branch_naming_pattern: Option<String>,
    pub instruction_file_path: Option<String>,
}

pub struct UpdateProject {
    pub name: Option<String>,
    pub default_agent: Option<Option<String>>,
    pub default_model: Option<Option<String>>,
    pub branch_naming_pattern: Option<Option<String>>,
    pub instruction_file_path: Option<Option<String>>,
    pub icon_path: Option<Option<String>>,
    pub color: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub task_file_path: Option<String>,
    pub title: String,
    pub status: TaskStatus,
    pub priority: Priority,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub github_issue: Option<String>,
    pub github_pr: Option<String>,
    pub depends_on: Vec<String>,
    pub labels: Vec<String>,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct NewTask {
    pub id: String,
    pub project_id: String,
    pub task_file_path: Option<String>,
    pub title: String,
    pub status: Option<TaskStatus>,
    pub priority: Option<Priority>,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub github_issue: Option<String>,
    pub github_pr: Option<String>,
    pub depends_on: Vec<String>,
    pub labels: Vec<String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub task_id: Option<String>,
    pub name: Option<String>,
    pub mode: SessionMode,
    pub agent: String,
    pub model: Option<String>,
    pub status: SessionStatus,
    pub pid: Option<i64>,
    pub worktree_path: Option<String>,
    pub mcp_connected: bool,
    pub started_at: String,
    pub ended_at: Option<String>,
}

pub struct NewSession {
    pub project_id: String,
    pub task_id: Option<String>,
    pub name: Option<String>,
    pub mode: SessionMode,
    pub agent: String,
    pub model: Option<String>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub id: i64,
    pub scope: String,
    pub scope_id: Option<String>,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: i64,
    pub scope: String,
    pub scope_id: Option<String>,
    pub agent_name: String,
    pub model: Option<String>,
    pub flags: Vec<String>,
}

pub struct NewAgentConfig {
    pub scope: String,
    pub scope_id: Option<String>,
    pub agent_name: String,
    pub model: Option<String>,
    pub flags: Vec<String>,
}

// ── File Browser ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub extension: Option<String>,
}
