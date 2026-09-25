//! Safe, non-expanding lexer for the supported TikZ subset.

use tikzforge_tikz_ast::{SourceRange, Token, TokenKind};

pub fn lex(source: &str) -> Vec<Token> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    let mut line = 1;
    let mut column = 1;
    while index < chars.len() {
        let start_offset = index;
        let start_line = line;
        let start_column = column;
        let character = chars[index];
        let kind;
        let mut value = String::new();
        if character.is_whitespace() {
            kind = TokenKind::Whitespace;
            while index < chars.len() && chars[index].is_whitespace() {
                let next = chars[index];
                value.push(next);
                index += 1;
                if next == '\n' {
                    line += 1;
                    column = 1;
                } else {
                    column += 1;
                }
            }
        } else if character == '%' {
            kind = TokenKind::Comment;
            while index < chars.len() && chars[index] != '\n' {
                value.push(chars[index]);
                index += 1;
                column += 1;
            }
        } else if character == '\\' {
            kind = TokenKind::Command;
            value.push(character);
            index += 1;
            column += 1;
            while index < chars.len() && chars[index].is_ascii_alphabetic() {
                value.push(chars[index]);
                index += 1;
                column += 1;
            }
        } else {
            kind = match character {
                '{' => TokenKind::BraceOpen,
                '}' => TokenKind::BraceClose,
                '[' => TokenKind::BracketOpen,
                ']' => TokenKind::BracketClose,
                '(' => TokenKind::ParenOpen,
                ')' => TokenKind::ParenClose,
                ';' => TokenKind::Semicolon,
                _ if character.is_ascii_digit() || character == '-' => TokenKind::Number,
                _ if character.is_ascii_alphabetic() || character == '_' => TokenKind::Identifier,
                _ => TokenKind::Unknown,
            };
            value.push(character);
            index += 1;
            column += 1;
        }
        tokens.push(Token {
            kind,
            value,
            range: SourceRange {
                start_offset,
                end_offset: index,
                line: start_line,
                column: start_column,
            },
        });
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::lex;
    use tikzforge_tikz_ast::TokenKind;

    #[test]
    fn lexes_node_command_and_coordinates() {
        let tokens = lex(r"\node[draw] (A) at (0,0) {Hello};");
        assert!(tokens
            .iter()
            .any(|token| token.kind == TokenKind::Command && token.value == r"\node"));
        assert!(tokens
            .iter()
            .any(|token| token.kind == TokenKind::Semicolon));
    }
}
