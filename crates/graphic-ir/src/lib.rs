//! Rust-side wire types for the compiler boundary.
//!
//! The JSON shape must match what the web app's `/api/render` route returns, because that route
//! forwards compiler-service responses to the browser unchanged.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderRequest {
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Mirrors `Diagnostic` in `packages/graphic-ir`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileError {
    pub severity: Severity,
    pub message: String,
    pub line: usize,
    pub column: usize,
}

impl CompileError {
    pub fn error(line: usize, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            message: message.into(),
            line,
            column: 1,
        }
    }
}

/// Which engine produced a preview. The compiler service only ever sends `Tectonic`; the web app
/// sends `Fast` for its own IR renderer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Renderer {
    Tectonic,
    Fast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderResponse {
    pub success: bool,
    pub svg: Option<String>,
    #[serde(rename = "compileTime")]
    pub compile_time_ms: u128,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub renderer: Renderer,
}

#[cfg(test)]
mod tests {
    use super::{CompileError, RenderResponse, Renderer};

    #[test]
    fn serializes_the_web_render_contract() {
        let response = RenderResponse {
            success: false,
            svg: None,
            compile_time_ms: 42,
            log: String::new(),
            errors: vec![CompileError::error(3, "Undefined control sequence.")],
            renderer: Renderer::Tectonic,
        };
        let json = serde_json::to_value(&response).expect("serializable");
        assert_eq!(json["compileTime"], 42);
        assert!(json.get("compile_time_ms").is_none());
        assert_eq!(json["renderer"], "tectonic");
        assert_eq!(json["errors"][0]["severity"], "error");
        assert_eq!(json["errors"][0]["line"], 3);
        assert_eq!(json["errors"][0]["column"], 1);
    }
}
