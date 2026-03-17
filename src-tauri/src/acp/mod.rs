//! ACP (Agent Client Protocol) client implementation.
//!
//! This module implements the client-side of the ACP protocol, allowing Faber
//! to communicate with agents that support ACP natively (Gemini CLI, OpenCode,
//! Copilot CLI, Cursor Agent) via structured JSON-RPC over stdio.
//!
//! # Architecture
//!
//! - [`client::AcpClient`] — Wraps `ClientSideConnection` with lifecycle management
//! - [`handler::FaberAcpHandler`] — Implements the ACP `Client` trait (responds to agent requests)
//! - [`capabilities`] — Filesystem and terminal capability implementations
//! - [`types`] — Faber-specific event payloads for Tauri event emission
//! - [`state`] — Global ACP state management (`AcpState`)

pub mod capabilities;
pub mod client;
pub mod handler;
pub mod permissions;
pub mod state;
pub mod types;

#[allow(unused_imports)]
pub use client::AcpClient;
#[allow(unused_imports)]
pub use state::AcpState;
