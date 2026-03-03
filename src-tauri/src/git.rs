use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::cmd_no_window;
use crate::error::AppError;

// ── Path helpers ──

/// Strip the Windows extended-length path prefix (`\\?\`) that git and
/// other tools don't understand.  Returns the input unchanged on non-Windows.
pub fn strip_unc_prefix(path: &str) -> std::borrow::Cow<'_, str> {
    if cfg!(windows) {
        if let Some(stripped) = path.strip_prefix(r"\\?\") {
            return std::borrow::Cow::Owned(stripped.to_string());
        }
    }
    std::borrow::Cow::Borrowed(path)
}

// ── Types ──

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head_commit: Option<String>,
    pub is_main: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PullRequestResult {
    pub url: String,
    pub number: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchList {
    pub local: Vec<String>,
    pub remote: Vec<String>,
    pub current: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub parent_hashes: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub parent_hashes: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub subject: String,
    pub body: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefInfo {
    pub branches: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

pub struct BranchNameVars<'a> {
    pub task_id: Option<&'a str>,
    pub task_slug: Option<&'a str>,
}

// ── Branch naming ──

pub const DEFAULT_BRANCH_PATTERN: &str = "feat/{{task_id}}-{{task_slug}}";

/// Resolve a branch naming pattern with variable substitution.
///
/// Supported variables: `{{task_id}}`, `{{task_slug}}`, `{{timestamp}}`
pub fn resolve_branch_name(pattern: &str, vars: &BranchNameVars) -> String {
    let mut result = pattern.to_string();

    if let Some(id) = vars.task_id {
        result = result.replace("{{task_id}}", id);
    }
    if let Some(slug) = vars.task_slug {
        result = result.replace("{{task_slug}}", slug);
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    result = result.replace("{{timestamp}}", &ts.to_string());

    // Clean up: collapse multiple slashes, trim
    while result.contains("//") {
        result = result.replace("//", "/");
    }
    result.trim_matches('/').to_string()
}

/// Convert a branch name to a safe directory name.
pub fn sanitize_for_path(branch: &str) -> String {
    branch.replace('/', "-")
}

/// Default worktree base directory: `<repo_dir>-worktrees/`
pub fn default_worktree_base(repo_path: &Path) -> PathBuf {
    let parent = repo_path.parent().unwrap_or(repo_path);
    let name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".to_string());
    parent.join(format!("{name}-worktrees"))
}

// ── Git CLI helper ──

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = cmd_no_window("git")
        .args(args)
        .current_dir(cwd)
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| AppError::Git(format!("failed to execute git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(stderr.trim().to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run a git command that requires remote authentication.
///
/// Injects `gh auth git-credential` as the credential helper so that
/// `git push`/`git fetch`/etc. use the same GitHub CLI auth token.
/// This means the user only needs to run `gh auth login` once — no separate
/// SSH keys or git credential manager setup required.
fn run_git_remote(cwd: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = cmd_no_window("git")
        .arg("-c")
        .arg("credential.helper=!gh auth git-credential")
        .args(args)
        .current_dir(cwd)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| AppError::Git(format!("failed to execute git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(stderr.trim().to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

// ── Branch operations ──

/// List local branch names, sorted alphabetically.
pub fn list_branches(repo_path: &Path) -> Result<Vec<String>, AppError> {
    let output = run_git(repo_path, &["branch", "--list", "--format=%(refname:short)"])?;
    let mut branches: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    branches.sort();
    Ok(branches)
}

// ── Worktree operations ──

/// Create a new worktree with a new branch.
///
/// If the branch already exists, the worktree is created on the existing branch.
/// Returns metadata about the created worktree.
pub fn create_worktree(
    repo_path: &Path,
    branch_name: &str,
    base_ref: Option<&str>,
    worktree_base: Option<&Path>,
) -> Result<WorktreeInfo, AppError> {
    let base_dir = worktree_base
        .map(Path::to_path_buf)
        .unwrap_or_else(|| default_worktree_base(repo_path));
    let wt_path = base_dir.join(sanitize_for_path(branch_name));
    let wt_str = strip_unc_prefix(&wt_path.to_string_lossy()).into_owned();

    if wt_path.exists() {
        return Err(AppError::Validation(format!(
            "Worktree path already exists: {wt_str}"
        )));
    }

    std::fs::create_dir_all(&base_dir)?;

    // Attempt: create new branch + worktree
    let result = match base_ref {
        Some(base) => run_git(
            repo_path,
            &["worktree", "add", &wt_str, "-b", branch_name, base],
        ),
        None => run_git(
            repo_path,
            &["worktree", "add", &wt_str, "-b", branch_name],
        ),
    };

    match result {
        Ok(_) => {}
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("already exists") {
                // Branch exists — attach worktree to existing branch
                run_git(repo_path, &["worktree", "add", &wt_str, branch_name])?;
            } else {
                return Err(e);
            }
        }
    }

    let head = run_git(&wt_path, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());

    Ok(WorktreeInfo {
        path: wt_str,
        branch: Some(branch_name.to_string()),
        head_commit: head,
        is_main: false,
    })
}

/// List all worktrees for a repository.
pub fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>, AppError> {
    let output = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    let repo_canonical =
        std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

    let mut worktrees = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut head: Option<String> = None;
    let mut bare = false;

    // Porcelain entries are separated by blank lines; chain an extra empty
    // line so the final entry is flushed.
    for line in output.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if let Some(p) = path.take() {
                if !bare {
                    let canon =
                        std::fs::canonicalize(&p).unwrap_or_else(|_| PathBuf::from(&p));
                    worktrees.push(WorktreeInfo {
                        is_main: canon == repo_canonical,
                        path: p,
                        branch: branch.take(),
                        head_commit: head.take(),
                    });
                }
            }
            branch = None;
            head = None;
            bare = false;
        } else if let Some(p) = line.strip_prefix("worktree ") {
            path = Some(p.to_string());
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            head = Some(h.get(..7).unwrap_or(h).to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = Some(
                b.strip_prefix("refs/heads/")
                    .unwrap_or(b)
                    .to_string(),
            );
        } else if line == "bare" {
            bare = true;
        }
    }

    Ok(worktrees)
}

/// Delete a worktree and prune stale entries.
///
/// Tries a regular remove first; falls back to `--force` if needed.
/// If git doesn't recognise the worktree (already partially removed or
/// stale), removes the directory manually and prunes.
/// Always prunes afterward to keep the repository clean.
pub fn delete_worktree(repo_path: &Path, worktree_path: &Path) -> Result<(), AppError> {
    let wt_str = worktree_path.to_string_lossy().to_string();

    // If the directory no longer exists, just prune stale entries and return.
    if !worktree_path.exists() {
        let _ = run_git(repo_path, &["worktree", "prune"]);
        return Ok(());
    }

    // Try regular remove, then force remove.
    let removed = run_git(repo_path, &["worktree", "remove", &wt_str]).is_ok()
        || run_git(repo_path, &["worktree", "remove", "--force", &wt_str]).is_ok();

    if !removed {
        // Git doesn't recognise the path as a worktree (e.g. stale metadata).
        // Remove the directory manually and prune.
        tracing::warn!(worktree = wt_str, "git worktree remove failed, removing directory manually");
        if let Err(e) = std::fs::remove_dir_all(worktree_path) {
            return Err(AppError::Git(format!(
                "Failed to remove worktree directory: {e}"
            )));
        }
    }

    // Prune stale worktree entries (best-effort)
    let _ = run_git(repo_path, &["worktree", "prune"]);

    Ok(())
}

// ── Worktree cleanliness check ──

/// Check if a worktree is clean: no uncommitted changes and no commits ahead of base.
///
/// Returns `true` only if both `git status --porcelain` is empty and
/// `git rev-list --count HEAD ^<base>` is zero. Defaults to `false` on errors.
pub fn is_worktree_clean(worktree_path: &Path, base_branch: Option<&str>) -> bool {
    // Check for uncommitted changes
    let status = match run_git(worktree_path, &["status", "--porcelain"]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    if !status.trim().is_empty() {
        return false;
    }

    // Check for commits ahead of base
    if let Some(base) = base_branch {
        let base_ref = format!("^{base}");
        match run_git(worktree_path, &["rev-list", "--count", "HEAD", &base_ref]) {
            Ok(s) => return s.trim() == "0",
            Err(_) => return false,
        }
    }

    // No explicit base — check against main or master
    if let Ok(s) = run_git(worktree_path, &["rev-list", "--count", "HEAD", "^main"]) {
        return s.trim() == "0";
    }
    if let Ok(s) = run_git(worktree_path, &["rev-list", "--count", "HEAD", "^master"]) {
        return s.trim() == "0";
    }

    false
}

// ── Disk usage ──

/// Recursively compute disk usage of a directory in bytes.
pub fn get_disk_usage(path: &Path) -> Result<u64, AppError> {
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "Path does not exist: {}",
            path.display()
        )));
    }
    Ok(dir_size_recursive(path))
}

fn dir_size_recursive(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size_recursive(&entry.path());
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

// ── Diff operations ──

/// List all changed files (staged + unstaged + untracked) in a worktree.
///
/// The `staged` field reflects the git index (X column of porcelain output):
/// - `true` when the file has changes in the index (staged for commit)
/// - `false` for unstaged work-tree changes and untracked files
pub fn get_changed_files(worktree_path: &Path) -> Result<Vec<ChangedFile>, AppError> {
    let output = run_git(worktree_path, &["status", "--porcelain"])?;
    let mut files = Vec::new();

    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }

        let x = line.as_bytes()[0]; // index (staged) column
        let y = line.as_bytes()[1]; // work-tree column
        let path_str = &line[3..];

        // For renames, path contains "orig -> dest" — use dest
        let file_path = match path_str.find(" -> ") {
            Some(pos) => path_str[pos + 4..].to_string(),
            None => path_str.to_string(),
        };

        // X column != ' ' and != '?' means the file has staged changes
        let staged = x != b' ' && x != b'?';

        let status = match (x, y) {
            (b'?', b'?') => FileStatus::Untracked,
            (b'A', _) => FileStatus::Added,
            (b'R', _) => FileStatus::Renamed,
            (b'D', _) | (_, b'D') => FileStatus::Deleted,
            (b'M', _) | (_, b'M') => FileStatus::Modified,
            _ => FileStatus::Modified,
        };

        files.push(ChangedFile {
            path: file_path,
            status,
            staged,
        });
    }

    Ok(files)
}

/// List files that have been committed on this branch since it diverged from the base.
///
/// Finds the merge-base between the base branch and HEAD, then diffs from
/// that point. Only shows changes introduced by this branch — not changes
/// that landed on the base branch after the fork point.
///
/// Falls back to diffing the entire branch history if no merge-base exists
/// (e.g. unrelated histories).
pub fn get_branch_files(
    worktree_path: &Path,
    base_branch: Option<&str>,
) -> Result<Vec<ChangedFile>, AppError> {
    let output = match find_merge_base_range(worktree_path, base_branch) {
        Some(range) => run_git(worktree_path, &["diff", "--name-status", &range])?,
        // No merge-base: list all tracked files in HEAD as "added"
        None => run_git(worktree_path, &["diff-tree", "-r", "--name-status", "--root", "HEAD"])
            .unwrap_or_default(),
    };

    let mut files = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Format: "M\tpath" or "A\tpath" or "R100\told\tnew"
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let status_char = parts[0].as_bytes()[0];
        let file_path = match parts[1].find('\t') {
            Some(pos) => parts[1][pos + 1..].to_string(), // rename: use dest
            None => parts[1].to_string(),
        };

        let status = match status_char {
            b'A' => FileStatus::Added,
            b'D' => FileStatus::Deleted,
            b'R' => FileStatus::Renamed,
            b'M' => FileStatus::Modified,
            _ => FileStatus::Modified,
        };

        files.push(ChangedFile {
            path: file_path,
            status,
            staged: false, // not meaningful for committed files
        });
    }

    Ok(files)
}

/// Get a unified diff for a worktree, optionally limited to a single file.
///
/// Compares the working tree against HEAD, and also includes untracked files
/// as synthetic "new file" diffs so they're visible in the diff viewer.
pub fn get_file_diff(worktree_path: &Path, file_path: Option<&str>) -> Result<String, AppError> {
    let mut parts: Vec<String> = Vec::new();

    // 1. Standard diff (tracked changes: staged + unstaged vs HEAD)
    let tracked_diff = {
        let mut args = vec!["diff", "HEAD"];
        if let Some(fp) = file_path {
            args.push("--");
            args.push(fp);
        }
        run_git(worktree_path, &args).or_else(|_| {
            // No HEAD yet — diff staged changes
            let mut fallback = vec!["diff", "--cached"];
            if let Some(fp) = file_path {
                fallback.push("--");
                fallback.push(fp);
            }
            run_git(worktree_path, &fallback)
        })?
    };

    if !tracked_diff.trim().is_empty() {
        parts.push(tracked_diff);
    }

    // 2. Untracked files — generate synthetic diffs
    let untracked_files = get_untracked_files(worktree_path)?;

    let files_to_diff: Vec<&str> = match file_path {
        Some(fp) => {
            if untracked_files.iter().any(|f| f == fp) {
                vec![fp]
            } else {
                vec![]
            }
        }
        None => untracked_files.iter().map(|s| s.as_str()).collect(),
    };

    for fp in files_to_diff {
        if let Ok(synthetic) = build_new_file_diff(worktree_path, fp) {
            parts.push(synthetic);
        }
    }

    Ok(parts.join("\n"))
}

/// Get a unified diff of committed changes on this branch since it diverged from base.
///
/// Finds the merge-base to show only changes introduced by this branch.
pub fn get_branch_diff(
    worktree_path: &Path,
    file_path: Option<&str>,
    base_branch: Option<&str>,
) -> Result<String, AppError> {
    match find_merge_base_range(worktree_path, base_branch) {
        Some(range) => {
            let mut args = vec!["diff", &range as &str];
            if let Some(fp) = file_path {
                args.push("--");
                args.push(fp);
            }
            run_git(worktree_path, &args)
        }
        // No merge-base: diff HEAD against empty tree (shows all files as added)
        None => {
            let mut args = vec!["diff-tree", "-p", "--root", "HEAD"];
            if let Some(fp) = file_path {
                args.push("--");
                args.push(fp);
            }
            run_git(worktree_path, &args)
        }
    }
}

/// Compute a diff range for comparing a branch against its base.
///
/// Returns `Some(range)` with a `<merge-base>..HEAD` range string,
/// or `None` if no merge-base exists (unrelated histories).
fn find_merge_base_range(worktree_path: &Path, base_branch: Option<&str>) -> Option<String> {
    let base = base_branch.unwrap_or("main");

    if let Ok(mb) = run_git(worktree_path, &["merge-base", base, "HEAD"]) {
        let mb = mb.trim();
        if !mb.is_empty() {
            return Some(format!("{mb}..HEAD"));
        }
    }

    // Try "master" as fallback
    if base == "main" {
        if let Ok(mb) = run_git(worktree_path, &["merge-base", "master", "HEAD"]) {
            let mb = mb.trim();
            if !mb.is_empty() {
                return Some(format!("{mb}..HEAD"));
            }
        }
    }

    None
}

/// List untracked files (excluding ignored) in a worktree.
fn get_untracked_files(worktree_path: &Path) -> Result<Vec<String>, AppError> {
    let output = run_git(
        worktree_path,
        &["ls-files", "--others", "--exclude-standard"],
    )?;
    Ok(output
        .lines()
        .map(|l| l.to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Build a synthetic unified diff for a new (untracked) file, making it
/// appear as a full addition so diff viewers can render it.
fn build_new_file_diff(worktree_path: &Path, file_path: &str) -> Result<String, AppError> {
    let full_path = worktree_path.join(file_path);
    let content = std::fs::read_to_string(&full_path).map_err(|e| {
        AppError::Git(format!("Failed to read untracked file {file_path}: {e}"))
    })?;

    let lines: Vec<&str> = content.lines().collect();
    let count = lines.len();

    let mut diff = String::new();
    diff.push_str(&format!("diff --git a/{file_path} b/{file_path}\n"));
    diff.push_str("new file mode 100644\n");
    diff.push_str("--- /dev/null\n");
    diff.push_str(&format!("+++ b/{file_path}\n"));
    diff.push_str(&format!("@@ -0,0 +1,{count} @@\n"));
    for line in &lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }

    Ok(diff)
}

// ── Commit log operations ──

/// Fetch commit history in topological order.
///
/// Returns commits with full hash, short hash, parent hashes, author info,
/// timestamp, and subject. Supports pagination via `skip` and `max_count`.
pub fn commit_log(
    repo_path: &Path,
    max_count: u32,
    skip: u32,
    all_branches: bool,
) -> Result<Vec<CommitInfo>, AppError> {
    let max_flag = format!("--max-count={max_count}");
    let skip_flag = format!("--skip={skip}");

    let mut args = vec![
        "log",
        "--topo-order",
        "--format=%H|%h|%P|%an|%ae|%at|%s",
        &max_flag,
    ];

    if skip > 0 {
        args.push(&skip_flag);
    }

    if all_branches {
        args.push("--all");
    }

    let output = run_git(repo_path, &args)?;
    let mut commits = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Format: hash|short_hash|parent_hashes|author_name|author_email|timestamp|subject
        // Subject may contain | so we split at most 7 parts
        let parts: Vec<&str> = line.splitn(7, '|').collect();
        if parts.len() < 7 {
            continue;
        }

        let parent_hashes: Vec<String> = if parts[2].is_empty() {
            Vec::new()
        } else {
            parts[2].split(' ').map(|s| s.to_string()).collect()
        };

        commits.push(CommitInfo {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            parent_hashes,
            author_name: parts[3].to_string(),
            author_email: parts[4].to_string(),
            timestamp: parts[5].parse().unwrap_or(0),
            subject: parts[6].to_string(),
        });
    }

    Ok(commits)
}

/// Get branches and tags that point at a specific commit.
pub fn refs_for_commit(repo_path: &Path, commit_hash: &str) -> Result<RefInfo, AppError> {
    // Get branches containing this commit at their tip
    let branch_output = run_git(
        repo_path,
        &["branch", "--points-at", commit_hash, "--format=%(refname:short)"],
    )
    .unwrap_or_default();

    let branches: Vec<String> = branch_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    // Get tags pointing at this commit
    let tag_output = run_git(
        repo_path,
        &["tag", "--points-at", commit_hash],
    )
    .unwrap_or_default();

    let tags: Vec<String> = tag_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(RefInfo { branches, tags })
}

/// Bulk-fetch refs for a set of commit hashes using 2 `git for-each-ref` calls
/// (branches + tags) instead of 2×N per-commit subprocess spawns.
/// Returns a map from commit hash → RefInfo, only for commits that have refs.
pub fn refs_for_commits_bulk(
    repo_path: &Path,
    commit_hashes: &std::collections::HashSet<String>,
) -> Result<std::collections::HashMap<String, RefInfo>, AppError> {
    use std::collections::HashMap;

    let mut result: HashMap<String, RefInfo> = HashMap::new();

    // Helper: parse `for-each-ref` output lines of "%(objectname) %(refname:short)"
    // and match against the requested commit hashes.
    let mut parse_refs = |prefix: &str, is_branch: bool| {
        let output = run_git(
            repo_path,
            &["for-each-ref", "--format=%(objectname) %(refname:short)", prefix],
        )
        .unwrap_or_default();

        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Some((hash_part, name)) = line.split_once(' ') {
                // Match full or prefix (requested hashes may be short)
                let matching = commit_hashes.iter().find(|h| {
                    hash_part == h.as_str() || hash_part.starts_with(h.as_str())
                });
                if let Some(h) = matching {
                    let entry = result.entry(h.clone())
                        .or_insert_with(|| RefInfo { branches: Vec::new(), tags: Vec::new() });
                    if is_branch {
                        entry.branches.push(name.to_string());
                    } else {
                        entry.tags.push(name.to_string());
                    }
                }
            }
        }
    };

    parse_refs("refs/heads/", true);
    parse_refs("refs/tags/", false);

    Ok(result)
}

/// Get full commit detail including body and changed files.
pub fn commit_detail(repo_path: &Path, commit_hash: &str) -> Result<CommitDetail, AppError> {
    // Get commit metadata with body
    let format = "%H|%h|%P|%an|%ae|%at|%s%n%b%n---END_BODY---";
    let output = run_git(
        repo_path,
        &["log", "-1", &format!("--format={format}"), commit_hash],
    )?;

    let body_marker = "---END_BODY---";
    let first_line = output.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.splitn(7, '|').collect();
    if parts.len() < 7 {
        return Err(AppError::Git(format!("Failed to parse commit {commit_hash}")));
    }

    let parent_hashes: Vec<String> = if parts[2].is_empty() {
        Vec::new()
    } else {
        parts[2].split(' ').map(|s| s.to_string()).collect()
    };

    // Extract body: everything between first line and the marker
    let body = if let Some(marker_pos) = output.find(body_marker) {
        // Find end of first line including newline character
        let first_line_end = output.find('\n').map(|pos| pos + 1).unwrap_or(first_line.len());
        if first_line_end < marker_pos {
            output[first_line_end..marker_pos].trim().to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Get changed files
    let files_output = run_git(
        repo_path,
        &["diff-tree", "--no-commit-id", "-r", "--name-status", commit_hash],
    )
    .unwrap_or_default();

    let mut files = Vec::new();
    for line in files_output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let file_parts: Vec<&str> = line.splitn(2, '\t').collect();
        if file_parts.len() < 2 {
            continue;
        }
        let status_char = file_parts[0].as_bytes()[0];
        let file_path = match file_parts[1].find('\t') {
            Some(pos) => file_parts[1][pos + 1..].to_string(),
            None => file_parts[1].to_string(),
        };

        let status = match status_char {
            b'A' => FileStatus::Added,
            b'D' => FileStatus::Deleted,
            b'R' => FileStatus::Renamed,
            b'M' => FileStatus::Modified,
            _ => FileStatus::Modified,
        };

        files.push(ChangedFile {
            path: file_path,
            status,
            staged: false,
        });
    }

    Ok(CommitDetail {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        parent_hashes,
        author_name: parts[3].to_string(),
        author_email: parts[4].to_string(),
        timestamp: parts[5].parse().unwrap_or(0),
        subject: parts[6].to_string(),
        body,
        files,
    })
}

/// Get the current HEAD commit hash.
pub fn head_hash(repo_path: &Path) -> Result<String, AppError> {
    let output = run_git(repo_path, &["rev-parse", "HEAD"])?;
    Ok(output.trim().to_string())
}

// ── Merge operations ──

/// Merge a branch into the current branch of a repository.
///
/// Runs `git merge <branch>` in the given repo directory.
/// Uses `--allow-unrelated-histories` since worktree branches may have
/// been created from different base refs.
pub fn merge_branch(repo_path: &Path, branch_name: &str) -> Result<String, AppError> {
    run_git(
        repo_path,
        &["merge", "--allow-unrelated-histories", branch_name],
    )
}

// ── Staging & commit operations ──

/// Commit staged changes in a worktree.
///
/// Only commits files that have been staged (via `git add`). Returns the
/// short commit hash on success.
pub fn commit_staged(worktree_path: &Path, message: &str) -> Result<String, AppError> {
    run_git(worktree_path, &["commit", "-m", message])?;
    let hash = run_git(worktree_path, &["rev-parse", "--short", "HEAD"])?;
    Ok(hash.trim().to_string())
}

/// Stage a file in a worktree (git add).
pub fn stage_file(worktree_path: &Path, file_path: &str) -> Result<(), AppError> {
    run_git(worktree_path, &["add", "--", file_path])?;
    Ok(())
}

/// Unstage a file in a worktree (git reset HEAD).
pub fn unstage_file(worktree_path: &Path, file_path: &str) -> Result<(), AppError> {
    run_git(worktree_path, &["reset", "HEAD", "--", file_path])?;
    Ok(())
}

// ── Push / PR operations ──

/// Push the current branch to a remote.
///
/// Uses `gh auth git-credential` as the credential helper so that
/// authentication is handled by the GitHub CLI — no separate SSH key
/// or git credential manager setup needed.
pub fn push_branch(worktree_path: &Path, remote: Option<&str>) -> Result<String, AppError> {
    let branch = run_git(worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch.trim();
    let remote = remote.unwrap_or("origin");

    run_git_remote(worktree_path, &["push", "-u", remote, branch])?;
    Ok(branch.to_string())
}

/// Create a pull request using the `gh` CLI.
///
/// Requires `gh` to be installed and authenticated.
/// Returns the PR URL and number on success.
pub fn create_pull_request(
    worktree_path: &Path,
    title: &str,
    body: &str,
    base: Option<&str>,
) -> Result<PullRequestResult, AppError> {
    let base = base.unwrap_or("main");

    let output = cmd_no_window("gh")
        .args(["pr", "create", "--title", title, "--body", body, "--base", base])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| {
            AppError::Git(format!(
                "Failed to execute `gh` CLI. Is it installed? {e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("gh pr create failed: {}", stderr.trim())));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let url = stdout.trim().to_string();

    // Extract PR number from URL (e.g. https://github.com/owner/repo/pull/42)
    let number = url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    Ok(PullRequestResult { url, number })
}

// ── Branch info / sync operations ──

/// Get the current branch name.
pub fn get_current_branch(repo_path: &Path) -> Result<String, AppError> {
    let output = run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(output.trim().to_string())
}

/// Fetch from origin and compute ahead/behind counts relative to the upstream.
pub fn get_sync_status(repo_path: &Path) -> Result<SyncStatus, AppError> {
    let branch = get_current_branch(repo_path)?;

    // Fetch first (best-effort — remote may not exist)
    let _ = run_git_remote(repo_path, &["fetch", "origin"]);

    let upstream = format!("origin/{branch}");

    // Check if upstream ref exists
    let check = run_git(repo_path, &["rev-parse", "--verify", &upstream]);
    if check.is_err() {
        // No upstream tracking — report 0/0
        return Ok(SyncStatus { ahead: 0, behind: 0 });
    }

    let range = format!("HEAD...{upstream}");
    let output = run_git(repo_path, &["rev-list", "--count", "--left-right", &range])?;
    let parts: Vec<&str> = output.trim().split('\t').collect();

    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    Ok(SyncStatus { ahead, behind })
}

/// Pull from origin (fast-forward only). Errors if working tree is dirty.
pub fn git_pull(repo_path: &Path) -> Result<String, AppError> {
    // Check for dirty working tree
    let status = run_git(repo_path, &["status", "--porcelain"])?;
    if !status.trim().is_empty() {
        return Err(AppError::Git(
            "Working tree has uncommitted changes. Commit or stash them first.".to_string(),
        ));
    }

    // Fetch
    run_git_remote(repo_path, &["fetch", "origin"])?;

    let branch = get_current_branch(repo_path)?;
    let upstream = format!("origin/{branch}");

    // Check if fast-forward is possible
    let check = run_git(repo_path, &["merge-base", "--is-ancestor", "HEAD", &upstream]);
    if check.is_err() {
        return Err(AppError::Git(
            "Cannot fast-forward: local branch has diverged from remote. Use manual merge.".to_string(),
        ));
    }

    run_git_remote(repo_path, &["pull", "--ff-only"])?;
    Ok(format!("Pulled latest changes on {branch}"))
}

/// Push the current branch of the main repo to origin.
pub fn git_push_main(repo_path: &Path) -> Result<String, AppError> {
    let branch = get_current_branch(repo_path)?;
    run_git_remote(repo_path, &["push", "-u", "origin", &branch])?;
    Ok(format!("Pushed {branch} to origin"))
}

/// List all local and remote branches.
pub fn list_all_branches(repo_path: &Path) -> Result<BranchList, AppError> {
    let current = get_current_branch(repo_path)?;

    // Local branches
    let local_output = run_git(repo_path, &["branch", "--list", "--format=%(refname:short)"])?;
    let mut local: Vec<String> = local_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    local.sort();

    // Remote branches
    let remote_output = run_git(repo_path, &["branch", "-r", "--format=%(refname:short)"])?;
    let mut remote: Vec<String> = remote_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        // Strip "origin/" prefix
        .map(|l| l.strip_prefix("origin/").unwrap_or(&l).to_string())
        // Exclude HEAD pointer
        .filter(|l| l != "HEAD")
        // Exclude branches that exist locally (they'll be in the local list)
        .filter(|l| !local.contains(l))
        .collect();
    remote.sort();
    remote.dedup();

    Ok(BranchList {
        local,
        remote,
        current,
    })
}

/// Checkout a branch. If `is_remote`, creates a local tracking branch.
pub fn checkout_branch(repo_path: &Path, branch: &str, is_remote: bool) -> Result<String, AppError> {
    // Check for dirty working tree
    let status = run_git(repo_path, &["status", "--porcelain"])?;
    if !status.trim().is_empty() {
        return Err(AppError::Git(
            "Working tree has uncommitted changes. Commit or stash them first.".to_string(),
        ));
    }

    if is_remote {
        let remote_ref = format!("origin/{branch}");
        run_git(repo_path, &["checkout", "-b", branch, &remote_ref])?;
    } else {
        run_git(repo_path, &["checkout", branch])?;
    }

    Ok(format!("Switched to branch '{branch}'"))
}

/// Create a new branch without checking it out.
/// `base_ref` defaults to HEAD if not provided.
pub fn create_branch(repo_path: &Path, branch_name: &str, base_ref: Option<&str>) -> Result<String, AppError> {
    let mut args = vec!["branch", branch_name];
    if let Some(base) = base_ref {
        args.push(base);
    }
    run_git(repo_path, &args)?;
    Ok(format!("Created branch '{branch_name}'"))
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create a temp dir containing a `repo/` subdirectory with an initialized git
    /// repo and one initial commit.  Worktrees created via `default_worktree_base`
    /// will land in `<tmp>/repo-worktrees/` — still inside the `TempDir`.
    fn setup_repo() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let repo_path = tmp.path().join("repo");
        fs::create_dir(&repo_path).unwrap();

        let repo = git2::Repository::init(&repo_path).unwrap();

        // Configure user identity so CLI git commands work on CI runners
        // where no global git config exists.
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Initial commit so HEAD exists
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial commit", &tree, &[])
            .unwrap();

        (tmp, repo_path)
    }

    // ── Branch naming ──

    #[test]
    fn resolve_branch_name_basic() {
        let name = resolve_branch_name(
            "feat/{{task_id}}-{{task_slug}}",
            &BranchNameVars {
                task_id: Some("T-042"),
                task_slug: Some("add-auth"),
            },
        );
        assert_eq!(name, "feat/T-042-add-auth");
    }

    #[test]
    fn resolve_branch_name_missing_vars_kept_literal() {
        let name = resolve_branch_name(
            "feat/{{task_id}}-{{task_slug}}",
            &BranchNameVars {
                task_id: Some("T-001"),
                task_slug: None,
            },
        );
        assert_eq!(name, "feat/T-001-{{task_slug}}");
    }

    #[test]
    fn resolve_branch_name_with_timestamp() {
        let name = resolve_branch_name(
            "vibe/{{timestamp}}",
            &BranchNameVars {
                task_id: None,
                task_slug: None,
            },
        );
        assert!(name.starts_with("vibe/"));
        let ts_part = name.strip_prefix("vibe/").unwrap();
        assert!(ts_part.parse::<u64>().is_ok());
    }

    #[test]
    fn resolve_branch_name_cleans_slashes() {
        let name = resolve_branch_name(
            "/feat//{{task_id}}//",
            &BranchNameVars {
                task_id: Some("T-001"),
                task_slug: None,
            },
        );
        assert!(!name.starts_with('/'));
        assert!(!name.ends_with('/'));
        assert!(!name.contains("//"));
    }

    #[test]
    fn sanitize_for_path_replaces_slashes() {
        assert_eq!(sanitize_for_path("feat/T-001-auth"), "feat-T-001-auth");
    }

    #[test]
    fn default_worktree_base_appends_suffix() {
        let base = default_worktree_base(Path::new("/home/user/projects/myapp"));
        assert_eq!(
            base,
            PathBuf::from("/home/user/projects/myapp-worktrees")
        );
    }

    // ── Worktree CRUD ──

    #[test]
    fn create_and_list_worktree() {
        let (_tmp, repo_path) = setup_repo();

        let info = create_worktree(&repo_path, "feat/test-branch", None, None).unwrap();

        assert!(info.path.contains("feat-test-branch"));
        assert_eq!(info.branch.as_deref(), Some("feat/test-branch"));
        assert!(!info.is_main);
        assert!(info.head_commit.is_some());

        let list = list_worktrees(&repo_path).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|w| w.is_main));
        assert!(list.iter().any(|w| w.branch.as_deref() == Some("feat/test-branch")));
    }

    #[test]
    fn create_worktree_rejects_duplicate_path() {
        let (_tmp, repo_path) = setup_repo();

        create_worktree(&repo_path, "dupe-branch", None, None).unwrap();

        let result = create_worktree(&repo_path, "dupe-branch", None, None);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn create_worktree_with_base_ref() {
        let (_tmp, repo_path) = setup_repo();

        let info = create_worktree(&repo_path, "from-head", Some("HEAD"), None).unwrap();
        assert!(info.head_commit.is_some());
    }

    #[test]
    fn create_worktree_reuses_existing_branch() {
        let (_tmp, repo_path) = setup_repo();

        // Create a branch without a worktree
        run_git(&repo_path, &["branch", "existing-branch"]).unwrap();

        // Create worktree on the existing branch
        let info = create_worktree(&repo_path, "existing-branch", None, None).unwrap();
        assert_eq!(info.branch.as_deref(), Some("existing-branch"));
    }

    #[test]
    fn delete_worktree_removes_it() {
        let (_tmp, repo_path) = setup_repo();

        let info = create_worktree(&repo_path, "to-delete", None, None).unwrap();
        let wt_path = PathBuf::from(&info.path);
        assert!(wt_path.exists());

        delete_worktree(&repo_path, &wt_path).unwrap();
        assert!(!wt_path.exists());

        let list = list_worktrees(&repo_path).unwrap();
        assert_eq!(list.len(), 1); // only main
    }

    #[test]
    fn list_worktrees_main_only() {
        let (_tmp, repo_path) = setup_repo();

        let list = list_worktrees(&repo_path).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_main);
    }

    // ── Disk usage ──

    #[test]
    fn disk_usage_counts_files() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        fs::write(tmp.path().join("b.txt"), "world!").unwrap();
        fs::create_dir(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub/c.txt"), "nested").unwrap();

        let usage = get_disk_usage(tmp.path()).unwrap();
        // 5 + 6 + 6 = 17 bytes
        assert_eq!(usage, 17);
    }

    #[test]
    fn disk_usage_nonexistent_path() {
        let result = get_disk_usage(Path::new("/nonexistent/path/abc123"));
        assert!(result.is_err());
    }

    // ── Diff operations ──

    #[test]
    fn changed_files_detects_modifications() {
        let (_tmp, repo_path) = setup_repo();

        // Create and commit a file
        let file = repo_path.join("test.txt");
        fs::write(&file, "original").unwrap();
        run_git(&repo_path, &["add", "test.txt"]).unwrap();
        run_git(&repo_path, &["commit", "-m", "add test.txt"]).unwrap();

        // Modify the file
        fs::write(&file, "modified").unwrap();

        let files = get_changed_files(&repo_path).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "test.txt");
        assert_eq!(files[0].status, FileStatus::Modified);
        assert!(!files[0].staged); // unstaged modification
    }

    #[test]
    fn changed_files_detects_untracked() {
        let (_tmp, repo_path) = setup_repo();

        fs::write(repo_path.join("new.txt"), "untracked").unwrap();

        let files = get_changed_files(&repo_path).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new.txt");
        assert_eq!(files[0].status, FileStatus::Untracked);
        assert!(!files[0].staged);
    }

    #[test]
    fn changed_files_detects_staged_add() {
        let (_tmp, repo_path) = setup_repo();

        fs::write(repo_path.join("staged.txt"), "content").unwrap();
        run_git(&repo_path, &["add", "staged.txt"]).unwrap();

        let files = get_changed_files(&repo_path).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "staged.txt");
        assert_eq!(files[0].status, FileStatus::Added);
        assert!(files[0].staged);
    }

    #[test]
    fn changed_files_empty_when_clean() {
        let (_tmp, repo_path) = setup_repo();

        let files = get_changed_files(&repo_path).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn file_diff_returns_unified_diff() {
        let (_tmp, repo_path) = setup_repo();

        let file = repo_path.join("test.txt");
        fs::write(&file, "line1\n").unwrap();
        run_git(&repo_path, &["add", "test.txt"]).unwrap();
        run_git(&repo_path, &["commit", "-m", "add file"]).unwrap();

        fs::write(&file, "line1\nline2\n").unwrap();

        let diff = get_file_diff(&repo_path, Some("test.txt")).unwrap();
        assert!(diff.contains("+line2"));
    }

    #[test]
    fn file_diff_entire_worktree() {
        let (_tmp, repo_path) = setup_repo();

        let file = repo_path.join("a.txt");
        fs::write(&file, "hello\n").unwrap();
        run_git(&repo_path, &["add", "a.txt"]).unwrap();
        run_git(&repo_path, &["commit", "-m", "add a"]).unwrap();

        fs::write(&file, "changed\n").unwrap();

        let diff = get_file_diff(&repo_path, None).unwrap();
        assert!(diff.contains("a.txt"));
    }

    #[test]
    fn file_diff_no_changes_returns_empty() {
        let (_tmp, repo_path) = setup_repo();

        let diff = get_file_diff(&repo_path, None).unwrap();
        assert!(diff.is_empty());
    }
}
