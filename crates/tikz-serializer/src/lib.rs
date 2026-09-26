//! Compiler-service helpers for source validation and bounded output.

use std::path::Path;
use tikzforge_graphic_ir::{CompileError, RenderResponse};

pub const MAX_SOURCE_BYTES: usize = 512 * 1024;

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

pub fn fallback_response(source: &str, elapsed_ms: u128) -> RenderResponse {
    let escaped = source
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    RenderResponse {
        success: true,
        svg: Some(format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="720" height="160"><rect width="100%" height="100%" fill="#0b1020"/><text x="24" y="48" fill="#e6edf7" font-family="sans-serif" font-size="18">TikzForge compiler fallback</text><text x="24" y="86" fill="#91a4c6" font-family="monospace" font-size="12">{escaped}</text></svg>"##
        )),
        compile_time_ms: elapsed_ms,
        log: "Fast fallback renderer used; configure TECTONIC_BIN for accurate compilation.".into(),
        errors: Vec::new(),
    }
}

pub fn document_source(source: &str) -> String {
    if source.contains(r"\documentclass") {
        source.to_owned()
    } else {
        format!(
            "\\documentclass{{standalone}}\n\\usepackage{{tikz}}\n\\usepackage{{pgfplots}}\n\\pgfplotsset{{compat=1.18}}\n\\begin{{document}}\n{source}\n\\end{{document}}\n"
        )
    }
}

pub fn parse_compile_errors(log: &str) -> Vec<CompileError> {
    log.lines()
        .filter_map(|line| {
            let marker = line.find("l.")?;
            let digits: String = line[marker + 2..]
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect();
            let line_number = digits.parse::<usize>().ok()?;
            Some(CompileError::error(line_number, line.trim()))
        })
        .collect()
}

pub fn pdf_path(out_dir: &Path) -> std::path::PathBuf {
    out_dir.join("main.pdf")
}

#[cfg(test)]
mod tests {
    use super::{document_source, parse_compile_errors, validate_source};

    #[test]
    fn rejects_shell_escape_and_file_io() {
        let errors = validate_source(r"\write18{touch /tmp/pwned}").expect_err("must reject");
        assert!(!errors.is_empty());
    }

    #[test]
    fn wraps_picture_source_as_a_standalone_document() {
        let source = document_source(r"\begin{tikzpicture}\end{tikzpicture}");
        assert!(source.contains(r"\usepackage{tikz}"));
        assert!(source.contains(r"\end{document}"));
    }

    #[test]
    fn extracts_tex_line_diagnostics() {
        let errors = parse_compile_errors("! error\nl.12 bad command");
        assert_eq!(errors[0].line, 12);
    }
}
