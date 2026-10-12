//! Route the transport's `tracing` events to the host (os_log on iOS).

use std::{
    io::Write,
    sync::{Arc, OnceLock, RwLock},
};

use tracing_subscriber::{EnvFilter, fmt::MakeWriter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

#[uniffi::export(with_foreign)]
pub trait LogSink: Send + Sync {
    fn log(&self, level: LogLevel, message: String);
}

static SINK: RwLock<Option<Arc<dyn LogSink>>> = RwLock::new(None);
static INSTALLED: OnceLock<()> = OnceLock::new();

/// Install (or replace) the log sink. `filter` uses `RUST_LOG` syntax, for
/// example `info` or `info,connect_transport=debug`. The filter is fixed by
/// the first call; later calls only swap the sink.
#[uniffi::export]
pub fn set_log_sink(sink: Arc<dyn LogSink>, filter: String) {
    *SINK.write().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    INSTALLED.get_or_init(|| {
        let filter = EnvFilter::try_new(&filter).unwrap_or_else(|_| EnvFilter::new("info"));
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(MakeSink)
            .with_target(true)
            .without_time()
            .try_init();
    });
}

struct MakeSink;

impl<'a> MakeWriter<'a> for MakeSink {
    type Writer = SinkWriter;

    fn make_writer(&'a self) -> Self::Writer {
        SinkWriter {
            level: LogLevel::Info,
            buffer: Vec::new(),
        }
    }

    fn make_writer_for(&'a self, meta: &tracing::Metadata<'_>) -> Self::Writer {
        let level = match *meta.level() {
            tracing::Level::ERROR => LogLevel::Error,
            tracing::Level::WARN => LogLevel::Warn,
            tracing::Level::INFO => LogLevel::Info,
            tracing::Level::DEBUG => LogLevel::Debug,
            tracing::Level::TRACE => LogLevel::Trace,
        };
        SinkWriter {
            level,
            buffer: Vec::new(),
        }
    }
}

/// Buffers one formatted event and hands it to the sink when dropped.
struct SinkWriter {
    level: LogLevel,
    buffer: Vec<u8>,
}

impl Write for SinkWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for SinkWriter {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let message = String::from_utf8_lossy(&self.buffer).trim_end().to_owned();
        let sink = SINK.read().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(sink) = sink {
            sink.log(self.level, message);
        }
    }
}
