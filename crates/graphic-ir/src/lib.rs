//! Rust-side wire types for the compiler boundary.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderRequest {
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileError {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderResponse {
    pub success: bool,
    pub svg: Option<String>,
    pub compile_time_ms: u128,
    pub log: String,
    pub errors: Vec<CompileError>,
}
