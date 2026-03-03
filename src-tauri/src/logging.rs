use std::path::PathBuf;
use tracing_appender::rolling::{self, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize the tracing subscriber with both stderr and file output.
///
/// Logs are written to `{app_data_dir}/logs/` with daily rotation.
/// Files are named `faber.YYYY-MM-DD.log`.
///
/// Returns the log directory path for use by the `get_log_directory` command.
pub fn init(app_data_dir: &std::path::Path) -> PathBuf {
    let log_dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).expect("failed to create log directory");

    // Daily rotating file appender — produces faber.YYYY-MM-DD.log
    // Keep only the 7 most recent log files to prevent unbounded disk usage.
    let file_appender = rolling::RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("faber")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_dir)
        .expect("failed to create rolling file appender");

    // Default filter: info level, with debug for faber modules when RUST_LOG is set
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("info,faber_lib=info,hyper=warn,tower=warn,axum=warn,tungstenite=warn")
    });

    // Stderr layer — compact, colored, for dev terminal
    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true)
        .with_ansi(true)
        .compact();

    // File layer — full timestamps, no ANSI codes
    let file_layer = fmt::layer()
        .with_writer(file_appender)
        .with_target(true)
        .with_ansi(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer)
        .with(file_layer)
        .init();

    log_dir
}
