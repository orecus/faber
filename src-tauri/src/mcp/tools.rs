use serde_json::json;

use super::protocol::ToolDefinition;

/// Tool categories for mode-based filtering.
enum ToolCategory {
    /// Available in all sessions (status reporting, error, waiting, files changed)
    Universal,
    /// Task management tools — available in all sessions (users commonly manage tasks from vibe/chat)
    TaskManagement,
    /// Task completion signal — task and continuous sessions only
    TaskCompletion,
    /// Research completion signal — research sessions only
    ResearchCompletion,
}

struct ToolEntry {
    category: ToolCategory,
    definition: ToolDefinition,
}

/// Returns tools filtered for the given session mode.
///
/// - All modes: universal tools (status, progress, error, waiting, files_changed) + task management
/// - `task` / `continuous`: + `report_complete`
/// - `research`: + `report_researched`
/// - `breakdown` / `vibe` / `chat`: no completion tools
pub fn tools_for_mode(session_mode: Option<&str>) -> Vec<ToolDefinition> {
    let include_task_completion = matches!(session_mode, Some("task" | "continuous"));
    let include_research_completion = matches!(session_mode, Some("research"));

    tool_entries()
        .into_iter()
        .filter(|entry| match entry.category {
            ToolCategory::Universal | ToolCategory::TaskManagement => true,
            ToolCategory::TaskCompletion => include_task_completion,
            ToolCategory::ResearchCompletion => include_research_completion,
        })
        .map(|e| e.definition)
        .collect()
}

fn tool_entries() -> Vec<ToolEntry> {
    vec![
        ToolEntry {
            category: ToolCategory::Universal,
            definition: ToolDefinition {
                name: "report_status".into(),
                description: "Report your current activity status to the Faber IDE. \
                    Call this FIRST when you begin working (status: \"working\"). \
                    This updates the session card in the UI so the user can see what you're doing. \
                    Call again whenever your activity type changes (e.g. switching from coding to testing)."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "enum": ["working", "idle", "waiting"],
                            "description": "Current activity status. Use 'working' when actively doing work, 'idle' when paused, 'waiting' when blocked on user input."
                        },
                        "message": {
                            "type": "string",
                            "description": "Brief human-readable description of what you're doing right now"
                        },
                        "activity": {
                            "type": "string",
                            "description": "Activity category: 'researching', 'exploring', 'planning', 'coding', 'testing', 'debugging', or 'reviewing'. Shown as a badge in the UI."
                        }
                    },
                    "required": ["status", "message"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::Universal,
            definition: ToolDefinition {
                name: "report_progress".into(),
                description: "Report step-by-step progress to the Faber IDE. \
                    Call this BEFORE starting each major step of your work. \
                    The IDE displays a progress bar based on current_step/total_steps."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "current_step": {
                            "type": "integer",
                            "description": "Current step number (1-based)"
                        },
                        "total_steps": {
                            "type": "integer",
                            "description": "Total number of steps in your plan"
                        },
                        "description": {
                            "type": "string",
                            "description": "Description of the current step"
                        }
                    },
                    "required": ["current_step", "total_steps", "description"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::Universal,
            definition: ToolDefinition {
                name: "report_files_changed".into(),
                description: "Report files you have created, modified, or deleted. \
                    Call this after making file changes so the IDE can track what was modified."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "files": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "path": {
                                        "type": "string",
                                        "description": "Relative file path from project root"
                                    },
                                    "action": {
                                        "type": "string",
                                        "enum": ["created", "modified", "deleted"],
                                        "description": "What was done to the file"
                                    }
                                },
                                "required": ["path", "action"]
                            },
                            "description": "List of changed files"
                        }
                    },
                    "required": ["files"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::Universal,
            definition: ToolDefinition {
                name: "report_error".into(),
                description: "Report an error or blocker that prevents you from continuing. \
                    The IDE will display this as an error state on the session card. \
                    Use this for hard blockers like build failures, missing dependencies, or access issues. \
                    After calling this, stop working and wait for the user to address the issue."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "string",
                            "description": "Short error message describing the blocker"
                        },
                        "details": {
                            "type": "string",
                            "description": "Detailed context: stack traces, attempted fixes, what you tried"
                        }
                    },
                    "required": ["error"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::Universal,
            definition: ToolDefinition {
                name: "report_waiting".into(),
                description: "Report that you need user input or a decision before continuing. \
                    IMPORTANT: After calling this, you MUST stop working and wait. \
                    The IDE will pause the session and prompt the user with your question. \
                    The session will resume when the user responds. \
                    Use this when you face an ambiguity, need clarification, or need the user to choose between options."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "question": {
                            "type": "string",
                            "description": "Clear question or description of what you need from the user"
                        }
                    },
                    "required": ["question"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::TaskCompletion,
            definition: ToolDefinition {
                name: "report_complete".to_string(),
                description: "Signal that you have FULLY completed the task. \
                    IMPORTANT: Only call this ONCE, after ALL work is done — code written, tested, and verified. \
                    Calling this has permanent side effects: the task status moves to 'in-review' and \
                    in continuous mode the next task in the queue is automatically launched. \
                    Do NOT call prematurely (e.g. after just reading the task, or before verifying changes). \
                    If you need user input, use report_waiting instead. \
                    If you hit a blocker, use report_error instead."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Summary of what was accomplished — shown to the user for review"
                        },
                        "files_changed": {
                            "type": "integer",
                            "description": "Total number of files changed during this session"
                        }
                    },
                    "required": ["summary"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::ResearchCompletion,
            definition: ToolDefinition {
                name: "report_researched".into(),
                description: "Signal that your research and analysis is complete. \
                    Call this when you have finished exploring the codebase and analyzing approaches. \
                    The user will be prompted to decide whether to continue to implementation. \
                    If the task is in backlog status, it will be moved to ready. \
                    Make sure to save your findings using update_task_plan before calling this."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Summary of research findings and recommendations"
                        }
                    },
                    "required": ["summary"]
                }),
            },
        },
        // ── Task management tools (available in all sessions) ──
        ToolEntry {
            category: ToolCategory::TaskManagement,
            definition: ToolDefinition {
                name: "get_task".into(),
                description: "Fetch task data including metadata and full markdown body. \
                    If task_id is omitted, returns the task associated with the current session. \
                    Call this first to understand what you need to work on."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "Task ID (e.g. 'T-067'). Omit to use the current session's task."
                        }
                    }
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::TaskManagement,
            definition: ToolDefinition {
                name: "update_task_plan".into(),
                description: "Update the implementation plan section of a task file. \
                    Replaces the content between ## Implementation Plan markers, \
                    or appends a new plan section if none exists. \
                    Use this in research sessions to save your findings, \
                    or in task sessions to update the plan as you work."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "plan": {
                            "type": "string",
                            "description": "The new implementation plan content (markdown)"
                        },
                        "task_id": {
                            "type": "string",
                            "description": "Task ID. Omit to use the current session's task."
                        }
                    },
                    "required": ["plan"]
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::TaskManagement,
            definition: ToolDefinition {
                name: "update_task".into(),
                description: "Update task metadata (status, priority, labels, dependencies, etc.). \
                    Does NOT update the markdown body — use update_task_plan for that."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "Task ID (e.g. 'T-011'). Omit to use the current session's task."
                        },
                        "status": {
                            "type": "string",
                            "enum": ["backlog", "ready", "in-progress", "in-review", "done", "archived"],
                            "description": "New task status"
                        },
                        "priority": {
                            "type": "string",
                            "description": "New task priority (default levels: P0=Critical, P1=High, P2=Normal). Projects may configure custom priorities."
                        },
                        "title": {
                            "type": "string",
                            "description": "New task title"
                        },
                        "labels": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Replace task labels with this list"
                        },
                        "depends_on": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Replace task dependencies with this list of task IDs"
                        },
                        "github_issue": {
                            "type": "string",
                            "description": "GitHub issue reference (e.g. '#42' or 'owner/repo#42')"
                        },
                        "github_pr": {
                            "type": "string",
                            "description": "GitHub PR reference (e.g. '#43' or a URL)"
                        },
                        "task_type": {
                            "type": "string",
                            "enum": ["task", "epic"],
                            "description": "Task type (default: task)"
                        },
                        "epic_id": {
                            "type": "string",
                            "description": "Parent epic task ID (set to empty string to unassign)"
                        }
                    }
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::TaskManagement,
            definition: ToolDefinition {
                name: "list_tasks".into(),
                description: "List all tasks in the current project. Returns compact metadata (no body). \
                    Use get_task for full details on a specific task."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "enum": ["backlog", "ready", "in-progress", "in-review", "done", "archived"],
                            "description": "Filter tasks by status"
                        },
                        "label": {
                            "type": "string",
                            "description": "Filter tasks that have this label"
                        },
                        "task_type": {
                            "type": "string",
                            "enum": ["task", "epic"],
                            "description": "Filter by task type"
                        },
                        "epic_id": {
                            "type": "string",
                            "description": "Filter tasks belonging to this epic"
                        }
                    }
                }),
            },
        },
        ToolEntry {
            category: ToolCategory::TaskManagement,
            definition: ToolDefinition {
                name: "create_task".into(),
                description: "Create a new task in the current project. Returns the new task ID. \
                    Tasks are always created with status 'backlog'."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Task title"
                        },
                        "body": {
                            "type": "string",
                            "description": "Markdown body content (optional, defaults to standard template)"
                        },
                        "priority": {
                            "type": "string",
                            "description": "Task priority (default: P2). Projects may configure custom priorities."
                        },
                        "labels": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Task labels"
                        },
                        "depends_on": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Task IDs this depends on"
                        },
                        "task_type": {
                            "type": "string",
                            "enum": ["task", "epic"],
                            "description": "Task type (default: task)"
                        },
                        "epic_id": {
                            "type": "string",
                            "description": "Parent epic task ID"
                        }
                    },
                    "required": ["title"]
                }),
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    // Total: 5 universal + 5 task management + report_complete + report_researched = 12
    const TOTAL_TOOLS: usize = 12;
    // Universal (5) + task management (5) = 10
    const BASE_TOOLS: usize = 10;

    fn all_tools() -> Vec<ToolDefinition> {
        tool_entries().into_iter().map(|e| e.definition).collect()
    }

    #[test]
    fn all_tools_returns_expected_count() {
        assert_eq!(all_tools().len(), TOTAL_TOOLS);
    }

    #[test]
    fn tool_names_are_unique() {
        let tools = all_tools();
        let mut names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), TOTAL_TOOLS);
    }

    #[test]
    fn each_tool_has_input_schema() {
        for tool in all_tools() {
            assert!(tool.input_schema.is_object(), "{} missing schema", tool.name);
            assert!(
                tool.input_schema.get("type").is_some(),
                "{} schema missing type",
                tool.name
            );
        }
    }

    #[test]
    fn task_mode_gets_base_plus_complete() {
        let tools = tools_for_mode(Some("task"));
        assert_eq!(tools.len(), BASE_TOOLS + 1);
        assert!(tools.iter().any(|t| t.name == "report_complete"));
        assert!(!tools.iter().any(|t| t.name == "report_researched"));
    }

    #[test]
    fn continuous_mode_gets_base_plus_complete() {
        let tools = tools_for_mode(Some("continuous"));
        assert_eq!(tools.len(), BASE_TOOLS + 1);
        assert!(tools.iter().any(|t| t.name == "report_complete"));
    }

    #[test]
    fn research_mode_gets_base_plus_researched() {
        let tools = tools_for_mode(Some("research"));
        assert_eq!(tools.len(), BASE_TOOLS + 1);
        assert!(tools.iter().any(|t| t.name == "report_researched"));
        assert!(!tools.iter().any(|t| t.name == "report_complete"));
        assert!(tools.iter().any(|t| t.name == "get_task"));
        assert!(tools.iter().any(|t| t.name == "update_task_plan"));
    }

    #[test]
    fn breakdown_mode_gets_base_only() {
        let tools = tools_for_mode(Some("breakdown"));
        assert_eq!(tools.len(), BASE_TOOLS);
        assert!(!tools.iter().any(|t| t.name == "report_complete"));
        assert!(!tools.iter().any(|t| t.name == "report_researched"));
        assert!(tools.iter().any(|t| t.name == "create_task"));
    }

    #[test]
    fn vibe_mode_gets_base_tools() {
        let tools = tools_for_mode(Some("vibe"));
        assert_eq!(tools.len(), BASE_TOOLS);
        // Has universal tools
        assert!(tools.iter().any(|t| t.name == "report_status"));
        assert!(tools.iter().any(|t| t.name == "report_error"));
        assert!(tools.iter().any(|t| t.name == "report_waiting"));
        // Has task management tools
        assert!(tools.iter().any(|t| t.name == "get_task"));
        assert!(tools.iter().any(|t| t.name == "create_task"));
        // No completion tools
        assert!(!tools.iter().any(|t| t.name == "report_complete"));
        assert!(!tools.iter().any(|t| t.name == "report_researched"));
    }

    #[test]
    fn chat_mode_gets_base_tools() {
        let tools = tools_for_mode(Some("chat"));
        assert_eq!(tools.len(), BASE_TOOLS);
        assert!(tools.iter().any(|t| t.name == "get_task"));
    }

    #[test]
    fn none_mode_gets_base_tools() {
        let tools = tools_for_mode(None);
        assert_eq!(tools.len(), BASE_TOOLS);
    }
}
