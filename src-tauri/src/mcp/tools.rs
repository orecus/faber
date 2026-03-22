use serde_json::json;

use super::protocol::ToolDefinition;

pub fn all_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "report_status".into(),
            description: "Report your current activity status to the IDE.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["working", "idle", "waiting"],
                        "description": "Current activity status"
                    },
                    "message": {
                        "type": "string",
                        "description": "Brief description of what you're doing"
                    },
                    "activity": {
                        "type": "string",
                        "description": "What kind of work you're doing (e.g. 'researching', 'exploring', 'planning', 'coding', 'testing', 'debugging', 'reviewing'). Optional — defaults to general working."
                    }
                },
                "required": ["status", "message"]
            }),
        },
        ToolDefinition {
            name: "report_progress".into(),
            description: "Report step-by-step progress to the IDE.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "current_step": {
                        "type": "integer",
                        "description": "Current step number (1-based)"
                    },
                    "total_steps": {
                        "type": "integer",
                        "description": "Total number of steps"
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the current step"
                    }
                },
                "required": ["current_step", "total_steps", "description"]
            }),
        },
        ToolDefinition {
            name: "report_files_changed".into(),
            description: "Report files you have created, modified, or deleted.".into(),
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
                                    "description": "Relative file path"
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
        ToolDefinition {
            name: "report_error".into(),
            description: "Report an error or blocker to the IDE.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "error": {
                        "type": "string",
                        "description": "Error message"
                    },
                    "details": {
                        "type": "string",
                        "description": "Optional additional details"
                    }
                },
                "required": ["error"]
            }),
        },
        ToolDefinition {
            name: "report_waiting".into(),
            description: "Report that you are waiting for user input or a decision.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "What you need from the user"
                    }
                },
                "required": ["question"]
            }),
        },
        ToolDefinition {
            name: "report_complete".into(),
            description: "Report that you have fully completed the task. Only call once per session when all work is done.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Summary of what was accomplished"
                    },
                    "files_changed": {
                        "type": "integer",
                        "description": "Number of files changed"
                    }
                },
                "required": ["summary"]
            }),
        },
        // ── Task management tools ──
        ToolDefinition {
            name: "get_task".into(),
            description: "Get task data (metadata + full markdown body). If task_id is omitted, returns the task associated with the current session.".into(),
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
        ToolDefinition {
            name: "update_task_plan".into(),
            description: "Update the implementation plan section of a task file. Replaces the content between ## Implementation Plan markers (or appends if no plan section exists).".into(),
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
        ToolDefinition {
            name: "update_task".into(),
            description: "Update task metadata (status, priority, labels, dependencies, etc.). Does NOT update the markdown body — use update_task_plan for that.".into(),
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
                        "enum": ["P0", "P1", "P2"],
                        "description": "New task priority"
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
                    }
                }
            }),
        },
        ToolDefinition {
            name: "list_tasks".into(),
            description: "List all tasks in the current project. Returns a compact summary (no body). Use get_task for full details on a specific task.".into(),
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
                    }
                }
            }),
        },
        ToolDefinition {
            name: "create_task".into(),
            description: "Create a new task in the current project. Returns the new task ID. Tasks are always created with status 'backlog'.".into(),
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
                        "enum": ["P0", "P1", "P2"],
                        "description": "Task priority (default: P2)"
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
                    }
                },
                "required": ["title"]
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_tools_returns_expected_count() {
        let tools = all_tools();
        assert_eq!(tools.len(), 11);
    }

    #[test]
    fn tool_names_are_unique() {
        let tools = all_tools();
        let mut names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 11);
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
}
