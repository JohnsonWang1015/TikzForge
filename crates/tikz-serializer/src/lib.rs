//! Compiler-service helpers for source validation, document wrapping and TeX log parsing.

use std::path::Path;
use tikzforge_graphic_ir::CompileError;

pub const MAX_SOURCE_BYTES: usize = 512 * 1024;

/// Preamble used when the submitted source is a bare picture. The compiler image pre-warms its
/// offline Tectonic cache for exactly these packages and libraries
/// (`docker/compiler/warmup.tex`), so keep the two in sync.
pub const PICTURE_PREAMBLE: &str = "\\documentclass{standalone}
\\usepackage{tikz}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usetikzlibrary{arrows.meta,calc,positioning,shapes.geometric,fit,backgrounds}
\\begin{document}
";

pub fn validate_source(source: &str) -> Result<(), Vec<CompileError>> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(vec![CompileError::error(
            1,
            format!("Source exceeds the {} byte limit.", MAX_SOURCE_BYTES),
        )]);
    }
    let forbidden = [
        r"\write18",
        r"\immediate\write18",
        r"\input",
        r"\include",
        r"\openin",
        r"\openout",
        r"\@@input",
        "shell-escape",
    ];
    let mut errors = Vec::new();
    for needle in forbidden {
        if let Some(offset) = source.find(needle) {
            errors.push(CompileError::error(
                source[..offset].matches('\n').count() + 1,
                format!("Forbidden compiler construct: {needle}"),
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// A complete LaTeX document plus how many lines were prepended to the user's source, so TeX
/// line numbers can be mapped back onto the editor.
pub struct WrappedDocument {
    pub source: String,
    pub line_offset: usize,
}

pub fn document_source(source: &str) -> WrappedDocument {
    if source.contains(r"\documentclass") {
        WrappedDocument {
            source: source.to_owned(),
            line_offset: 0,
        }
    } else {
        WrappedDocument {
            source: format!("{PICTURE_PREAMBLE}{source}\n\\end{{document}}\n"),
            line_offset: PICTURE_PREAMBLE.matches('\n').count(),
        }
    }
}

/// Extracts line diagnostics from Tectonic output. Tectonic reports `error: main.tex:12: message`;
/// the raw TeX transcript it may append reports `! message` followed by `l.12 ...`.
pub fn parse_compile_errors(log: &str, line_offset: usize) -> Vec<CompileError> {
    let to_source_line = |line: usize| line.saturating_sub(line_offset).max(1);
    let mut errors: Vec<CompileError> = log
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("error: ")?;
            let (_, after_file) = rest.split_once(".tex:")?;
            let (number, message) = after_file.split_once(": ")?;
            let line_number = number.parse::<usize>().ok()?;
            Some(CompileError::error(
                to_source_line(line_number),
                message.trim(),
            ))
        })
        .collect();
    if errors.is_empty() {
        let mut pending: Option<&str> = None;
        for line in log.lines() {
            if let Some(message) = line.strip_prefix("! ") {
                pending = Some(message.trim());
                continue;
            }
            let Some(after_marker) = line.strip_prefix("l.") else {
                continue;
            };
            let digits: String = after_marker
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect();
            if let (Ok(line_number), Some(message)) = (digits.parse::<usize>(), pending.take()) {
                errors.push(CompileError::error(to_source_line(line_number), message));
            }
        }
    }
    errors.dedup_by(|a, b| a.line == b.line && a.message == b.message);
    errors
}

pub fn pdf_path(out_dir: &Path) -> std::path::PathBuf {
    out_dir.join("main.pdf")
}

#[cfg(test)]
mod tests {
    use super::{document_source, parse_compile_errors, validate_source, PICTURE_PREAMBLE};

    #[test]
    fn rejects_shell_escape_and_file_io() {
        let errors = validate_source(r"\write18{touch /tmp/pwned}").expect_err("must reject");
        assert!(!errors.is_empty());
    }

    #[test]
    fn wraps_picture_source_with_the_prewarmed_preamble() {
        let wrapped = document_source(r"\begin{tikzpicture}\end{tikzpicture}");
        for required in [
            r"\documentclass{standalone}",
            r"\usepackage{tikz}",
            r"\usepackage{pgfplots}",
            r"\pgfplotsset{compat=1.18}",
            r"\usepackage{amsmath}",
            r"\usepackage{amssymb}",
            r"\usetikzlibrary{arrows.meta,calc,positioning,shapes.geometric,fit,backgrounds}",
        ] {
            assert!(wrapped.source.contains(required), "missing {required}");
        }
        assert!(wrapped.source.contains(r"\end{document}"));
        assert_eq!(wrapped.line_offset, PICTURE_PREAMBLE.lines().count());
        assert_eq!(
            wrapped.source.lines().nth(wrapped.line_offset),
            Some(r"\begin{tikzpicture}\end{tikzpicture}")
        );
    }

    #[test]
    fn leaves_full_documents_untouched() {
        let source = "\\documentclass{article}\n\\begin{document}x\\end{document}";
        let wrapped = document_source(source);
        assert_eq!(wrapped.source, source);
        assert_eq!(wrapped.line_offset, 0);
    }

    #[test]
    fn maps_tectonic_errors_back_to_source_lines() {
        let log = "warning: accessing absolute path `/dev/null`\n\
                   error: main.tex:12: Undefined control sequence\n\
                   error: something bad happened inside XeTeX; its output follows:\n\
                   ! Undefined control sequence.\nl.12 \\bad";
        let errors = parse_compile_errors(log, 9);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, 3);
        assert_eq!(errors[0].message, "Undefined control sequence");
    }

    #[test]
    fn falls_back_to_tex_transcript_markers() {
        let errors = parse_compile_errors("! Missing $ inserted.\nl.12 bad command", 0);
        assert_eq!(errors[0].line, 12);
        assert_eq!(errors[0].message, "Missing $ inserted.");
    }
}
