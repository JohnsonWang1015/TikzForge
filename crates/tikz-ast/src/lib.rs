//! Small source-mapped AST primitives shared by Rust parser consumers.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceRange {
    pub start_offset: usize,
    pub end_offset: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TokenKind {
    Command,
    Identifier,
    Number,
    Coordinate,
    BraceOpen,
    BraceClose,
    BracketOpen,
    BracketClose,
    ParenOpen,
    ParenClose,
    Semicolon,
    Operator,
    Whitespace,
    Comment,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub value: String,
    pub range: SourceRange,
}
