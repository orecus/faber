use std::collections::HashMap;
use std::path::Path;

use regex::Regex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::cmd_no_window;
use crate::db;
use crate::db::models::Task;
use crate::error::AppError;
use crate::tasks;

// ── Auth check ──

/// Result of checking `gh` CLI installation and authentication status.
#[derive(Debug, Clone, Serialize)]
pub struct GhAuthStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub username: Option<String>,
    pub error: Option<String>,
    /// How the token was sourced: "keyring", "GITHUB_TOKEN", "GH_TOKEN", "oauth_token", etc.
    pub token_source: Option<String>,
    /// Scopes that `gh auth status` reported as missing (e.g. "read:org").
    pub missing_scopes: Vec<String>,
    /// `true` when authenticated but `missing_scopes` is non-empty.
    pub has_scope_warnings: bool,
}

/// Check if `gh` CLI is installed and the user is authenticated.
///
/// Runs `gh auth status` which returns exit code 0 if authenticated.
/// Also runs `gh auth status --active` to extract the username.
pub fn check_gh_auth() -> GhAuthStatus {
    // First check if gh is installed
    let installed = cmd_no_window("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !installed {
        return GhAuthStatus {
            installed: false,
            authenticated: false,
            username: None,
            error: Some("GitHub CLI (gh) is not installed".to_string()),
            token_source: None,
            missing_scopes: vec![],
            has_scope_warnings: false,
        };
    }

    // Check auth status
    let output = match cmd_no_window("gh")
        .args(["auth", "status"])
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            return GhAuthStatus {
                installed: true,
                authenticated: false,
                username: None,
                error: Some(format!("Failed to run gh auth status: {e}")),
                token_source: None,
                missing_scopes: vec![],
                has_scope_warnings: false,
            };
        }
    };

    // Combine stdout + stderr — gh uses both depending on version
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    // If exit code is non-zero AND every account line shows "X Failed to log in",
    // then authentication is truly broken.
    if !output.status.success() {
        // Log full error details server-side only; send generic message to frontend
        // to avoid leaking internal auth details (partial tokens, scope info, etc.)
        tracing::debug!(output = %text.trim(), "gh auth status failed");
        return GhAuthStatus {
            installed: true,
            authenticated: false,
            username: None,
            error: Some("GitHub CLI authentication failed. Run `gh auth login` to authenticate.".to_string()),
            token_source: None,
            missing_scopes: vec![],
            has_scope_warnings: false,
        };
    }

    // ── Parse token source ──
    // gh outputs lines like:
    //   "✓ Logged in to github.com account foo (GITHUB_TOKEN)"
    //   "✓ Logged in to github.com account foo (keyring)"
    let token_source = text.lines().find_map(|line| {
        if let Some(pos) = line.rfind('(') {
            if let Some(end) = line[pos..].find(')') {
                let source = &line[pos + 1..pos + end];
                if !source.is_empty() {
                    return Some(source.to_string());
                }
            }
        }
        None
    });

    // ── Parse missing scopes ──
    // gh outputs lines like:
    //   "! Missing required token scopes: 'read:org', 'admin:public_key'"
    //   "- Missing required scopes: 'read:org'"
    let missing_scopes_re = Regex::new(
        r"(?i)missing\s+required\s+(?:token\s+)?scopes?:\s*(.+)"
    ).unwrap();

    let scope_re = Regex::new(r"'([^']+)'").unwrap();
    let mut missing_scopes: Vec<String> = Vec::new();
    for line in text.lines() {
        if let Some(caps) = missing_scopes_re.captures(line) {
            let scopes_str = &caps[1];
            // Extract quoted scope names: 'read:org', 'admin:public_key'
            for scope_cap in scope_re.captures_iter(scopes_str) {
                let scope = scope_cap[1].to_string();
                if !missing_scopes.contains(&scope) {
                    missing_scopes.push(scope);
                }
            }
        }
    }

    let has_scope_warnings = !missing_scopes.is_empty();

    // ── Extract username ──
    let username = text.lines().find_map(|line| {
        // gh outputs: "Logged in to github.com account username (..."
        if let Some(pos) = line.find("account ") {
            let after = &line[pos + 8..];
            let name = after.split_whitespace().next().unwrap_or("");
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
        None
    });

    GhAuthStatus {
        installed: true,
        authenticated: true,
        username,
        error: None,
        token_source,
        missing_scopes,
        has_scope_warnings,
    }
}

// ── Types from `gh` CLI (camelCase JSON output) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
}

/// A GitHub issue as returned by `gh issue list --json ...`.
/// Fields are camelCase to match `gh` CLI JSON output.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueRaw {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<GitHubLabel>,
    pub assignees: Vec<GitHubUser>,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
}

/// A GitHub issue serialized to the frontend (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<GitHubLabel>,
    pub assignees: Vec<GitHubUser>,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
}

impl From<GitHubIssueRaw> for GitHubIssue {
    fn from(raw: GitHubIssueRaw) -> Self {
        Self {
            number: raw.number,
            title: raw.title,
            body: raw.body,
            state: raw.state,
            labels: raw.labels,
            assignees: raw.assignees,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            url: raw.url,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GitHubIssueWithImportStatus {
    pub issue: GitHubIssue,
    pub already_imported: bool,
    pub existing_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported_count: usize,
    pub skipped_count: usize,
    pub tasks: Vec<Task>,
}

// ── CLI helpers ──

/// Detect the GitHub repo slug (owner/repo) for a local repo.
pub fn detect_repo_slug(repo_path: &Path) -> Result<String, AppError> {
    let output = cmd_no_window("gh")
        .args(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| {
            AppError::Io(format!(
                "Failed to run `gh` CLI. Is it installed? Error: {e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!(
            "gh repo view failed: {stderr}"
        )));
    }

    let slug = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if slug.is_empty() {
        return Err(AppError::Git(
            "Could not detect GitHub repo slug".to_string(),
        ));
    }
    Ok(slug)
}

/// Validate a GitHub state filter against an allowlist.
fn validate_state_filter(state: &str) -> Result<&str, AppError> {
    match state {
        "open" | "closed" | "all" | "merged" => Ok(state),
        _ => Err(AppError::Validation(format!("Invalid state filter: {state}"))),
    }
}

/// Fetch issues from GitHub using `gh issue list`.
pub fn fetch_issues(
    repo_path: &Path,
    state: &str,
    limit: u32,
) -> Result<Vec<GitHubIssue>, AppError> {
    let state = validate_state_filter(state)?;
    let limit_str = limit.to_string();
    let output = cmd_no_window("gh")
        .args([
            "issue",
            "list",
            "--state",
            state,
            "--limit",
            &limit_str,
            "--json",
            "number,title,body,state,labels,assignees,createdAt,updatedAt,url",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| {
            AppError::Io(format!(
                "Failed to run `gh issue list`. Is `gh` installed? Error: {e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!(
            "gh issue list failed: {stderr}"
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw_issues: Vec<GitHubIssueRaw> = serde_json::from_str(&stdout).map_err(|e| {
        AppError::Validation(format!("Failed to parse gh output: {e}"))
    })?;

    Ok(raw_issues.into_iter().map(GitHubIssue::from).collect())
}

/// Parse dependency references from a GitHub issue body.
///
/// Scans for patterns like:
/// - "depends on #123", "depends on owner/repo#123"
/// - "blocked by #45"
/// - "requires #67"
/// - "after #89"
///
/// Returns a list of issue refs in `owner/repo#number` format.
pub fn parse_body_dependencies(body: &str, repo_slug: &str) -> Vec<String> {
    // Pattern: (depends on|blocked by|requires|after) optional-whitespace (owner/repo)?#number
    let re = Regex::new(
        r"(?i)(?:depends\s+on|blocked\s+by|requires|after)\s+(?:([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+))?#(\d+)"
    ).unwrap();

    let mut refs = Vec::new();
    for cap in re.captures_iter(body) {
        let slug = cap.get(1)
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| repo_slug.to_string());
        let number = &cap[2];
        let issue_ref = format!("{slug}#{number}");
        if !refs.contains(&issue_ref) {
            refs.push(issue_ref);
        }
    }
    refs
}

/// A deferred file write to be executed after releasing the DB lock.
pub struct DeferredFileWrite {
    pub path: std::path::PathBuf,
    pub content: String,
}

/// Result of the DB-only phase of import_issues.
pub struct ImportPrepared {
    pub result: ImportResult,
    /// Task files and TODOS.md to write after releasing the DB lock.
    pub deferred_writes: Vec<DeferredFileWrite>,
}

impl ImportPrepared {
    /// Execute all deferred file writes (call after releasing DB lock).
    pub fn write_files(self) -> ImportResult {
        for write in &self.deferred_writes {
            if let Some(parent) = write.path.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    tracing::warn!(%e, path = %parent.display(), "Failed to create task dir");
                    continue;
                }
            }
            if let Err(e) = std::fs::write(&write.path, &write.content) {
                tracing::warn!(%e, path = %write.path.display(), "Failed to write task file");
            }
        }
        self.result
    }
}

/// Prepare a single GitHub issue for import: build the task data and upsert to DB.
/// File writes are deferred into `DeferredFileWrite` entries.
fn prepare_single_issue(
    conn: &Connection,
    project_id: &str,
    tasks_dir: &Path,
    issue: &GitHubIssue,
    repo_slug: &str,
    next_task_num: &mut u32,
) -> Result<(Task, DeferredFileWrite), AppError> {
    *next_task_num += 1;
    let task_id = format!("T-{:03}", *next_task_num);
    let slug = tasks::slugify(&issue.title);
    let filename = format!("{task_id}-{slug}.md");
    let file_path = tasks_dir.join(&filename);

    let today = today_str();
    let github_issue_ref = format!("{repo_slug}#{}", issue.number);

    // Map GitHub labels to task labels
    let labels: Vec<String> = issue.labels.iter().map(|l| l.name.clone()).collect();

    // Map priority from labels if possible
    let priority = labels
        .iter()
        .find_map(|l| match l.to_lowercase().as_str() {
            "p0" | "critical" | "urgent" => Some("P0"),
            "p1" | "high" | "important" => Some("P1"),
            _ => None,
        })
        .unwrap_or("P2")
        .to_string();

    let frontmatter = tasks::TaskFrontmatter {
        id: task_id.clone(),
        title: issue.title.clone(),
        status: "backlog".to_string(),
        priority,
        created: today,
        depends_on: vec![],
        labels,
        agent: None,
        model: None,
        branch: None,
        github_issue: Some(github_issue_ref),
        github_pr: None,
    };

    // Compose body from issue body.
    // Escape standalone YAML frontmatter delimiters (---) in issue body
    // to prevent them from corrupting task file parsing.
    let safe_body = issue.body.replace("\n---\n", "\n\\---\n");
    let body = if safe_body.is_empty() {
        format!(
            "## Objective\n\nImported from GitHub issue [#{}]({}).\n\n## Acceptance Criteria\n\n- [ ] \n",
            issue.number, issue.url
        )
    } else {
        format!(
            "## GitHub Issue [#{}]({})\n\n{}\n",
            issue.number, issue.url, safe_body
        )
    };

    let content = tasks::serialize_task_file(&frontmatter, &body)?;

    // Upsert into DB (no file I/O)
    let parsed = tasks::parse_task_file(&content, &file_path)?;
    let new_task = tasks::to_new_task(&parsed, project_id);
    let task = db::tasks::upsert(conn, &new_task)?;

    let deferred = DeferredFileWrite {
        path: file_path,
        content,
    };

    Ok((task, deferred))
}

/// Import a single GitHub issue as a local task file.
/// This is the legacy all-in-one version that performs file I/O immediately.
/// Prefer `prepare_issues` + `ImportPrepared::write_files` for lock-conscious callers.
#[cfg(test)]
pub fn import_single_issue(
    conn: &Connection,
    project_id: &str,
    tasks_dir: &Path,
    issue: &GitHubIssue,
    repo_slug: &str,
) -> Result<Task, AppError> {
    std::fs::create_dir_all(tasks_dir)?;

    // Determine next task number from directory scan (legacy behavior)
    let mut next_num = current_max_task_num_from_dir(tasks_dir);
    let (task, deferred) =
        prepare_single_issue(conn, project_id, tasks_dir, issue, repo_slug, &mut next_num)?;
    std::fs::write(&deferred.path, &deferred.content)?;
    Ok(task)
}

/// Scan directory for the current maximum T-NNN number.
fn current_max_task_num_from_dir(tasks_dir: &Path) -> u32 {
    let mut max_num: u32 = 0;
    if tasks_dir.is_dir() {
        for entry in std::fs::read_dir(tasks_dir).into_iter().flatten().flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if let Some(rest) = name_str.strip_prefix("T-") {
                if let Some(num_str) = rest.split(|c: char| !c.is_ascii_digit()).next() {
                    if let Ok(n) = num_str.parse::<u32>() {
                        max_num = max_num.max(n);
                    }
                }
            }
        }
    }
    max_num
}

/// Get the current maximum task number from the DB for a project.
fn current_max_task_num_from_db(conn: &Connection, project_id: &str) -> u32 {
    conn.query_row(
        "SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) FROM tasks WHERE project_id = ?1",
        rusqlite::params![project_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Batch import multiple GitHub issues. DB operations and file I/O are separated:
/// all DB reads/writes happen here, file writes are deferred into `ImportPrepared`.
///
/// Callers should:
/// 1. Hold the DB lock and call `prepare_issues()`
/// 2. Release the DB lock
/// 3. Call `ImportPrepared::write_files()` to flush task files + TODOS.md
pub fn prepare_issues(
    conn: &Connection,
    project_id: &str,
    project_path: &Path,
    issues: &[GitHubIssue],
    repo_slug: &str,
) -> Result<ImportPrepared, AppError> {
    let tasks_dir = project_path.join(".agents").join("tasks");

    // Get existing tasks to check for already-imported issues
    let existing_tasks = db::tasks::list_by_project(conn, project_id)?;
    let imported_refs: Vec<String> = existing_tasks
        .iter()
        .filter_map(|t| t.github_issue.clone())
        .collect();

    let mut imported_count = 0;
    let mut skipped_count = 0;
    let mut created_tasks = Vec::new();
    let mut deferred_writes: Vec<DeferredFileWrite> = Vec::new();

    // Start numbering from the max of DB and directory scan
    let mut next_num = current_max_task_num_from_db(conn, project_id)
        .max(current_max_task_num_from_dir(&tasks_dir));

    for issue in issues {
        let issue_ref = format!("{repo_slug}#{}", issue.number);
        if imported_refs.contains(&issue_ref) {
            skipped_count += 1;
            continue;
        }

        let (task, deferred) =
            prepare_single_issue(conn, project_id, &tasks_dir, issue, repo_slug, &mut next_num)?;
        created_tasks.push(task);
        deferred_writes.push(deferred);
        imported_count += 1;
    }

    // Second pass: resolve GitHub issue dependencies to task IDs
    if imported_count > 0 {
        // Build combined map: issue_ref → task_id (existing + newly imported)
        let issue_map = get_imported_issue_map(conn, project_id)?;

        // For each newly created task, parse its source issue body for dependencies
        let issue_lookup: HashMap<String, &GitHubIssue> = issues
            .iter()
            .map(|i| (format!("{repo_slug}#{}", i.number), i))
            .collect();

        for (idx, task) in created_tasks.iter_mut().enumerate() {
            let issue_ref = match &task.github_issue {
                Some(r) => r.clone(),
                None => continue,
            };
            let issue = match issue_lookup.get(&issue_ref) {
                Some(i) => i,
                None => continue,
            };

            let dep_refs = parse_body_dependencies(&issue.body, repo_slug);
            if dep_refs.is_empty() {
                continue;
            }

            // Resolve issue refs to task IDs
            let resolved: Vec<String> = dep_refs
                .iter()
                .filter_map(|r| issue_map.get(r).cloned())
                .collect();

            if resolved.is_empty() {
                continue;
            }

            // Re-serialize the deferred content with updated depends_on, and re-upsert to DB
            let deferred = &deferred_writes[idx];
            if let Ok(mut parsed) = tasks::parse_task_file(&deferred.content, &deferred.path) {
                parsed.frontmatter.depends_on = resolved.clone();
                if let Ok(new_content) = tasks::serialize_task_file(&parsed.frontmatter, &parsed.body) {
                    // Update the deferred write with new content
                    deferred_writes[idx].content = new_content;
                    // Re-upsert with updated depends_on
                    let new_task = tasks::to_new_task(&parsed, project_id);
                    if let Ok(updated) = db::tasks::upsert(conn, &new_task) {
                        *task = updated;
                    }
                }
            }
        }

    }

    // Regenerate TODOS.md after import (even if all issues were skipped),
    // to stay consistent with other task-modifying operations.
    // Only write if disk task files are enabled for this project.
    if tasks::task_files_enabled(conn, project_id) {
        let todos_content = tasks::generate_todos_md(conn, project_id)?;
        deferred_writes.push(DeferredFileWrite {
            path: project_path.join("TODOS.md"),
            content: todos_content,
        });
    }

    Ok(ImportPrepared {
        result: ImportResult {
            imported_count,
            skipped_count,
            tasks: created_tasks,
        },
        deferred_writes,
    })
}

/// Legacy all-in-one import that holds `conn` for the entire duration.
/// Prefer `prepare_issues` + `ImportPrepared::write_files` for lock-conscious callers.
#[cfg(test)]
pub fn import_issues(
    conn: &Connection,
    project_id: &str,
    project_path: &Path,
    issues: &[GitHubIssue],
    repo_slug: &str,
) -> Result<ImportResult, AppError> {
    let prepared = prepare_issues(conn, project_id, project_path, issues, repo_slug)?;
    Ok(prepared.write_files())
}

/// Build a map of `"owner/repo#number"` -> task_id for already-imported issues.
pub fn get_imported_issue_map(
    conn: &Connection,
    project_id: &str,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let tasks = db::tasks::list_by_project(conn, project_id)?;
    let mut map = std::collections::HashMap::new();
    for task in tasks {
        if let Some(ref gh) = task.github_issue {
            map.insert(gh.clone(), task.id.clone());
        }
    }
    Ok(map)
}

// ── GitHub sync helpers ──

/// Extract the issue number from a ref like "owner/repo#42" → "42"
pub fn parse_issue_number(issue_ref: &str) -> Option<String> {
    issue_ref.split('#').next_back().map(|s| s.to_string())
}

/// Close a GitHub issue via `gh issue close`.
/// Optionally post a comment first.
pub fn close_issue(
    repo_path: &Path,
    issue_ref: &str,
    comment: Option<&str>,
) -> Result<(), AppError> {
    let number = parse_issue_number(issue_ref)
        .ok_or_else(|| AppError::Validation(format!("Invalid issue ref: {issue_ref}")))?;

    if let Some(comment_text) = comment {
        let _ = cmd_no_window("gh")
            .args(["issue", "comment", &number, "--body", comment_text])
            .current_dir(repo_path)
            .output();
    }

    let output = cmd_no_window("gh")
        .args(["issue", "close", &number])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue close: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue close failed: {stderr}")));
    }
    Ok(())
}

/// Reopen a GitHub issue via `gh issue reopen`.
pub fn reopen_issue(repo_path: &Path, issue_ref: &str) -> Result<(), AppError> {
    let number = parse_issue_number(issue_ref)
        .ok_or_else(|| AppError::Validation(format!("Invalid issue ref: {issue_ref}")))?;

    let output = cmd_no_window("gh")
        .args(["issue", "reopen", &number])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue reopen: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue reopen failed: {stderr}")));
    }
    Ok(())
}

/// Add a label to a GitHub issue.
pub fn add_label(repo_path: &Path, issue_ref: &str, label: &str) -> Result<(), AppError> {
    let number = parse_issue_number(issue_ref)
        .ok_or_else(|| AppError::Validation(format!("Invalid issue ref: {issue_ref}")))?;

    let output = cmd_no_window("gh")
        .args(["issue", "edit", &number, "--add-label", label])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue edit: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue edit --add-label failed: {stderr}")));
    }
    Ok(())
}

/// Remove a label from a GitHub issue (non-fatal if label doesn't exist).
pub fn remove_label(repo_path: &Path, issue_ref: &str, label: &str) -> Result<(), AppError> {
    let number = parse_issue_number(issue_ref)
        .ok_or_else(|| AppError::Validation(format!("Invalid issue ref: {issue_ref}")))?;

    let output = cmd_no_window("gh")
        .args(["issue", "edit", &number, "--remove-label", label])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue edit: {e}")))?;

    // Non-fatal: label may not exist on the issue
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(%stderr, "GitHub remove_label non-fatal error");
    }
    Ok(())
}

/// A full label from the repository (includes description).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubLabelFull {
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

/// Fetch all labels for the repository.
pub fn fetch_repo_labels(repo_path: &Path) -> Result<Vec<GitHubLabelFull>, AppError> {
    let output = cmd_no_window("gh")
        .args(["label", "list", "--json", "name,color,description", "--limit", "200"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh label list: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh label list failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let labels: Vec<GitHubLabelFull> = serde_json::from_str(&stdout)
        .map_err(|e| AppError::Validation(format!("Failed to parse label list: {e}")))?;
    Ok(labels)
}

// ── Pull Request types ──

/// A GitHub PR as returned by `gh pr list --json ...`.
/// Fields are camelCase to match `gh` CLI JSON output.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPRRaw {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub author: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub labels: Vec<GitHubLabel>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
}

/// A GitHub PR serialized to the frontend (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct GitHubPR {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub author: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub labels: Vec<GitHubLabel>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
}

impl From<GitHubPRRaw> for GitHubPR {
    fn from(raw: GitHubPRRaw) -> Self {
        Self {
            number: raw.number,
            title: raw.title,
            state: raw.state,
            author: raw.author,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            head_ref_name: raw.head_ref_name,
            base_ref_name: raw.base_ref_name,
            url: raw.url,
            is_draft: raw.is_draft,
            review_decision: raw.review_decision,
            labels: raw.labels,
            additions: raw.additions,
            deletions: raw.deletions,
            changed_files: raw.changed_files,
        }
    }
}

/// A file changed in a PR.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubPRFile {
    pub path: String,
    pub additions: u64,
    pub deletions: u64,
}

/// A review on a PR.
#[derive(Debug, Clone, Deserialize)]
pub struct GitHubPRReviewRaw {
    pub author: GitHubUser,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitHubPRReview {
    pub author: String,
    pub state: String,
}

/// Detailed PR info as returned by `gh pr view --json ...`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPRDetailRaw {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub author: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub labels: Vec<GitHubLabel>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub body: String,
    pub files: Vec<GitHubPRFile>,
    pub reviews: Vec<GitHubPRReviewRaw>,
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
}

/// Detailed PR info serialized to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct GitHubPRDetail {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub author: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub labels: Vec<GitHubLabel>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub body: String,
    pub files: Vec<GitHubPRFile>,
    pub reviews: Vec<GitHubPRReview>,
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
}

impl From<GitHubPRDetailRaw> for GitHubPRDetail {
    fn from(raw: GitHubPRDetailRaw) -> Self {
        Self {
            number: raw.number,
            title: raw.title,
            state: raw.state,
            author: raw.author,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            head_ref_name: raw.head_ref_name,
            base_ref_name: raw.base_ref_name,
            url: raw.url,
            is_draft: raw.is_draft,
            review_decision: raw.review_decision,
            labels: raw.labels,
            additions: raw.additions,
            deletions: raw.deletions,
            changed_files: raw.changed_files,
            body: raw.body,
            files: raw.files,
            reviews: raw.reviews.into_iter().map(|r| GitHubPRReview {
                author: r.author.login,
                state: r.state,
            }).collect(),
            mergeable: raw.mergeable,
            merge_state_status: raw.merge_state_status,
        }
    }
}

/// Result of creating a GitHub issue.
#[derive(Debug, Clone, Serialize)]
pub struct GitHubIssueCreated {
    pub number: u64,
    pub url: String,
}

/// PR status as returned by `gh pr view`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrStatus {
    pub state: String,
    pub merged: bool,
    pub merged_at: Option<String>,
}

/// Check the status of a pull request.
pub fn check_pr_status(repo_path: &Path, pr_url: &str) -> Result<PrStatus, AppError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrViewRaw {
        state: String,
        merged_at: Option<String>,
    }

    let output = cmd_no_window("gh")
        .args(["pr", "view", pr_url, "--json", "state,mergedAt"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh pr view: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh pr view failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: PrViewRaw = serde_json::from_str(&stdout)
        .map_err(|e| AppError::Validation(format!("Failed to parse pr view: {e}")))?;

    Ok(PrStatus {
        merged: raw.merged_at.is_some(),
        state: raw.state,
        merged_at: raw.merged_at,
    })
}

// ── Pull Request CLI helpers ──

/// Fetch pull requests from GitHub using `gh pr list`.
pub fn fetch_pull_requests(
    repo_path: &Path,
    state: &str,
    limit: u32,
) -> Result<Vec<GitHubPR>, AppError> {
    let state = validate_state_filter(state)?;
    let limit_str = limit.to_string();
    let output = cmd_no_window("gh")
        .args([
            "pr",
            "list",
            "--state",
            state,
            "--limit",
            &limit_str,
            "--json",
            "number,title,state,author,createdAt,updatedAt,headRefName,baseRefName,url,isDraft,reviewDecision,labels,additions,deletions,changedFiles",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| {
            AppError::Io(format!(
                "Failed to run `gh pr list`. Is `gh` installed? Error: {e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh pr list failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw_prs: Vec<GitHubPRRaw> = serde_json::from_str(&stdout).map_err(|e| {
        AppError::Validation(format!("Failed to parse gh pr list output: {e}"))
    })?;

    Ok(raw_prs.into_iter().map(GitHubPR::from).collect())
}

/// Fetch detailed info for a single pull request.
pub fn fetch_pr_detail(
    repo_path: &Path,
    number: u64,
) -> Result<GitHubPRDetail, AppError> {
    let number_str = number.to_string();
    let output = cmd_no_window("gh")
        .args([
            "pr",
            "view",
            &number_str,
            "--json",
            "number,title,state,author,createdAt,updatedAt,headRefName,baseRefName,url,isDraft,reviewDecision,labels,additions,deletions,changedFiles,body,files,reviews,mergeable,mergeStateStatus",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| {
            AppError::Io(format!("Failed to run `gh pr view`: {e}"))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh pr view failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: GitHubPRDetailRaw = serde_json::from_str(&stdout).map_err(|e| {
        AppError::Validation(format!("Failed to parse gh pr view output: {e}"))
    })?;

    Ok(GitHubPRDetail::from(raw))
}

/// Merge a pull request using `gh pr merge`.
pub fn merge_pull_request(
    repo_path: &Path,
    number: u64,
    method: &str,
) -> Result<(), AppError> {
    let number_str = number.to_string();
    let method_flag = match method {
        "squash" => "--squash",
        "rebase" => "--rebase",
        "merge" => "--merge",
        _ => return Err(AppError::Validation(format!("Invalid merge method: {method}"))),
    };

    let output = cmd_no_window("gh")
        .args(["pr", "merge", &number_str, method_flag, "--delete-branch"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh pr merge: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh pr merge failed: {stderr}")));
    }
    Ok(())
}

/// Close a pull request using `gh pr close`.
pub fn close_pull_request(
    repo_path: &Path,
    number: u64,
) -> Result<(), AppError> {
    let number_str = number.to_string();
    let output = cmd_no_window("gh")
        .args(["pr", "close", &number_str])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh pr close: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh pr close failed: {stderr}")));
    }
    Ok(())
}

// ── Issue creation/update CLI helpers ──

/// Create a new GitHub issue using `gh issue create`.
pub fn create_issue(
    repo_path: &Path,
    title: &str,
    body: &str,
    labels: &[String],
) -> Result<GitHubIssueCreated, AppError> {
    let mut args = vec![
        "issue".to_string(),
        "create".to_string(),
        "--title".to_string(),
        title.to_string(),
        "--body".to_string(),
        body.to_string(),
    ];

    for label in labels {
        args.push("--label".to_string());
        args.push(label.clone());
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = cmd_no_window("gh")
        .args(&args_refs)
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue create: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue create failed: {stderr}")));
    }

    // gh issue create outputs the issue URL to stdout
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Extract issue number from URL like https://github.com/owner/repo/issues/42
    let number = stdout
        .rsplit('/')
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Could not parse issue number from gh output: {stdout}"
            ))
        })?;

    Ok(GitHubIssueCreated {
        number,
        url: stdout,
    })
}

/// Update an existing GitHub issue using `gh issue edit`.
pub fn update_issue(
    repo_path: &Path,
    number: u64,
    title: &str,
    body: &str,
) -> Result<(), AppError> {
    let number_str = number.to_string();
    let output = cmd_no_window("gh")
        .args([
            "issue", "edit", &number_str,
            "--title", title,
            "--body", body,
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue edit: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue edit failed: {stderr}")));
    }
    Ok(())
}

/// Fetch a single GitHub issue using `gh issue view`.
pub fn fetch_single_issue(
    repo_path: &Path,
    number: u64,
) -> Result<GitHubIssue, AppError> {
    let number_str = number.to_string();
    let output = cmd_no_window("gh")
        .args([
            "issue",
            "view",
            &number_str,
            "--json",
            "number,title,body,state,labels,assignees,createdAt,updatedAt,url",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue view: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue view failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: GitHubIssueRaw = serde_json::from_str(&stdout).map_err(|e| {
        AppError::Validation(format!("Failed to parse gh issue view output: {e}"))
    })?;

    Ok(GitHubIssue::from(raw))
}

// ── Issue Comments ──

/// A single comment on a GitHub issue.
#[derive(Debug, Clone, Serialize)]
pub struct GitHubComment {
    pub id: u64,
    pub author: String,
    pub author_avatar: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Raw shape returned by `gh issue view --json comments`.
#[derive(Debug, Deserialize)]
struct GitHubCommentRaw {
    author: GitHubCommentAuthor,
    body: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt", default)]
    updated_at: Option<String>,
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubCommentAuthor {
    login: String,
    #[serde(rename = "avatarUrl", default)]
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubCommentsResponse {
    comments: Vec<GitHubCommentRaw>,
}

/// Fetch all comments on a GitHub issue via `gh issue view --json comments`.
pub fn fetch_issue_comments(
    repo_path: &Path,
    issue_number: u64,
) -> Result<Vec<GitHubComment>, AppError> {
    let number_str = issue_number.to_string();
    let output = cmd_no_window("gh")
        .args([
            "issue",
            "view",
            &number_str,
            "--json",
            "comments",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue view: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue view failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let response: GitHubCommentsResponse = serde_json::from_str(&stdout).map_err(|e| {
        AppError::Validation(format!("Failed to parse gh issue comments output: {e}"))
    })?;

    let comments = response
        .comments
        .into_iter()
        .enumerate()
        .map(|(i, raw)| {
            // gh CLI doesn't always return a numeric id for comments;
            // use the string id hash or fall back to index.
            let id = raw
                .id
                .as_ref()
                .and_then(|s| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse::<u64>().ok())
                .unwrap_or(i as u64);
            GitHubComment {
                id,
                author: raw.author.login,
                author_avatar: raw.author.avatar_url,
                body: raw.body,
                created_at: raw.created_at.clone(),
                updated_at: raw.updated_at.unwrap_or_else(|| raw.created_at),
            }
        })
        .collect();

    Ok(comments)
}

/// Post a comment on a GitHub issue via `gh issue comment`.
pub fn post_issue_comment(
    repo_path: &Path,
    issue_number: u64,
    body: &str,
) -> Result<(), AppError> {
    let number_str = issue_number.to_string();
    let output = cmd_no_window("gh")
        .args(["issue", "comment", &number_str, "--body", body])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run gh issue comment: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh issue comment failed: {stderr}")));
    }

    Ok(())
}

fn today_str() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    let (y, m, d) = days_to_civil(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

fn days_to_civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_issue_raw_deserialize() {
        let json = r#"[{
            "number": 42,
            "title": "Fix the bug",
            "body": "It's broken",
            "state": "OPEN",
            "labels": [{"name": "bug", "color": "d73a4a"}],
            "assignees": [{"login": "octocat"}],
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
            "url": "https://github.com/owner/repo/issues/42"
        }]"#;

        let issues: Vec<GitHubIssueRaw> = serde_json::from_str(json).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].number, 42);
        assert_eq!(issues[0].title, "Fix the bug");
        assert_eq!(issues[0].labels[0].name, "bug");
        assert_eq!(issues[0].assignees[0].login, "octocat");
    }

    #[test]
    fn github_issue_conversion() {
        let raw = GitHubIssueRaw {
            number: 1,
            title: "Test".into(),
            body: "Body".into(),
            state: "OPEN".into(),
            labels: vec![],
            assignees: vec![],
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
            url: "https://github.com/o/r/issues/1".into(),
        };

        let issue: GitHubIssue = raw.into();
        assert_eq!(issue.number, 1);
        assert_eq!(issue.title, "Test");
    }

    #[test]
    fn import_single_issue_creates_file() {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        db::projects::create(
            &conn,
            &crate::db::models::NewProject {
                name: "test".into(),
                path: "/tmp/test".into(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();
        let pid = db::projects::list(&conn).unwrap()[0].id.clone();

        let tmp = tempfile::TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");

        let issue = GitHubIssue {
            number: 42,
            title: "Fix login bug".into(),
            body: "The login form is broken.".into(),
            state: "OPEN".into(),
            labels: vec![GitHubLabel {
                name: "bug".into(),
                color: "d73a4a".into(),
            }],
            assignees: vec![],
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
            url: "https://github.com/owner/repo/issues/42".into(),
        };

        let task = import_single_issue(&conn, &pid, &tasks_dir, &issue, "owner/repo").unwrap();

        assert_eq!(task.id, "T-001");
        assert_eq!(task.title, "Fix login bug");
        assert_eq!(task.github_issue, Some("owner/repo#42".to_string()));
        assert!(task.labels.contains(&"bug".to_string()));

        // Verify file on disk
        let file_path = tasks_dir.join("T-001-fix-login-bug.md");
        assert!(file_path.exists());
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("github_issue: owner/repo#42"));
        assert!(content.contains("The login form is broken."));
    }

    #[test]
    fn import_issues_skips_duplicates() {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        let tmp = tempfile::TempDir::new().unwrap();

        db::projects::create(
            &conn,
            &crate::db::models::NewProject {
                name: "test".into(),
                path: tmp.path().to_string_lossy().into_owned(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();
        let pid = db::projects::list(&conn).unwrap()[0].id.clone();

        let issue1 = GitHubIssue {
            number: 1,
            title: "First issue".into(),
            body: "".into(),
            state: "OPEN".into(),
            labels: vec![],
            assignees: vec![],
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
            url: "https://github.com/o/r/issues/1".into(),
        };

        let issue2 = GitHubIssue {
            number: 2,
            title: "Second issue".into(),
            body: "".into(),
            state: "OPEN".into(),
            labels: vec![],
            assignees: vec![],
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
            url: "https://github.com/o/r/issues/2".into(),
        };

        // Import first batch
        let result = import_issues(&conn, &pid, tmp.path(), &[issue1.clone(), issue2], "o/r").unwrap();
        assert_eq!(result.imported_count, 2);
        assert_eq!(result.skipped_count, 0);
        assert_eq!(result.tasks.len(), 2);

        // Re-import with same issue #1 should skip it
        let result2 = import_issues(&conn, &pid, tmp.path(), &[issue1], "o/r").unwrap();
        assert_eq!(result2.imported_count, 0);
        assert_eq!(result2.skipped_count, 1);
    }

    #[test]
    fn parse_body_deps_basic() {
        let deps = parse_body_dependencies(
            "This depends on #42 and is blocked by #10.\nAlso requires #5.",
            "owner/repo",
        );
        assert_eq!(deps, vec![
            "owner/repo#42".to_string(),
            "owner/repo#10".to_string(),
            "owner/repo#5".to_string(),
        ]);
    }

    #[test]
    fn parse_body_deps_cross_repo() {
        let deps = parse_body_dependencies(
            "Depends on other/lib#99",
            "owner/repo",
        );
        assert_eq!(deps, vec!["other/lib#99".to_string()]);
    }

    #[test]
    fn parse_body_deps_case_insensitive() {
        let deps = parse_body_dependencies(
            "BLOCKED BY #7\nAfter #3",
            "o/r",
        );
        assert_eq!(deps, vec!["o/r#7".to_string(), "o/r#3".to_string()]);
    }

    #[test]
    fn parse_body_deps_no_duplicates() {
        let deps = parse_body_dependencies(
            "Depends on #1. Also depends on #1.",
            "o/r",
        );
        assert_eq!(deps, vec!["o/r#1".to_string()]);
    }

    #[test]
    fn parse_body_deps_empty() {
        let deps = parse_body_dependencies(
            "Just a regular issue body with #123 mention but no dependency keyword.",
            "o/r",
        );
        assert!(deps.is_empty());
    }

    #[test]
    fn priority_mapping_from_labels() {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        db::projects::create(
            &conn,
            &crate::db::models::NewProject {
                name: "test".into(),
                path: "/tmp/test".into(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();
        let pid = db::projects::list(&conn).unwrap()[0].id.clone();

        let tmp = tempfile::TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");

        let issue = GitHubIssue {
            number: 1,
            title: "Critical fix".into(),
            body: "".into(),
            state: "OPEN".into(),
            labels: vec![GitHubLabel {
                name: "critical".into(),
                color: "ff0000".into(),
            }],
            assignees: vec![],
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
            url: "https://github.com/o/r/issues/1".into(),
        };

        let task = import_single_issue(&conn, &pid, &tasks_dir, &issue, "o/r").unwrap();
        assert_eq!(task.priority, crate::db::models::Priority::P0);
    }
}
