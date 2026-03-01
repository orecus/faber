use std::collections::HashMap;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::pty::{self, PtyState};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn spawn_pty(
    state: State<'_, PtyState>,
    app: AppHandle,
    session_id: String,
    command: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), AppError> {
    pty::spawn(
        &state,
        &app,
        session_id,
        &command,
        &args.unwrap_or_default(),
        cwd.as_deref(),
        env.as_ref(),
        cols.unwrap_or(80),
        rows.unwrap_or(24),
        false, // Direct IPC spawns don't need login shell wrapping
    )
}

#[tauri::command]
pub fn write_pty(state: State<'_, PtyState>, session_id: String, data: String) -> Result<(), AppError> {
    pty::write(&state, &session_id, &data)
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    pty::resize(&state, &session_id, cols, rows)
}

#[tauri::command]
pub fn kill_pty(state: State<'_, PtyState>, session_id: String) -> Result<(), AppError> {
    pty::kill(&state, &session_id)
}

#[tauri::command]
pub fn list_pty_sessions(state: State<'_, PtyState>) -> Result<Vec<String>, AppError> {
    pty::list_sessions(&state)
}
