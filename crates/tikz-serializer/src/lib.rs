//! Compiler-service helpers for source validation, document wrapping and TeX log parsing.

use std::{collections::HashSet, path::Path};
use tikzforge_graphic_ir::{CompileError, ImageAttachment};

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

const INCLUDEGRAPHICS: &str = r"\includegraphics";

pub const MAX_IMAGES: usize = 16;
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_TOTAL_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMAGE_NAME_CHARS: usize = 128;

fn line_of(source: &str, offset: usize) -> usize {
    source[..offset].matches('\n').count() + 1
}

/// One path segment: it cannot start with `.`, so `..` and hidden files are impossible.
fn is_plain_segment(segment: &str) -> bool {
    let mut characters = segment.chars();
    segment.len() <= 64
        && matches!(characters.next(), Some(first) if first.is_ascii_alphanumeric() || first == '_')
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
        })
}

/// A relative path of one to four plain segments, so it can only name a file inside the scratch
/// directory.
fn is_plain_relative_name(name: &str) -> bool {
    let segments = name.split('/').count();
    (1..=4).contains(&segments) && name.split('/').all(is_plain_segment)
}

/// Whether `rest`, which starts with `\include`, is exactly the `\includegraphics` control word.
fn is_includegraphics(rest: &str) -> bool {
    rest.strip_prefix(INCLUDEGRAPHICS)
        .is_some_and(|after| !after.starts_with(|character: char| character.is_ascii_alphabetic()))
}

/// Accepts `[options]{name}` (options optional) with a literal, plain relative file name.
fn has_plain_graphics_argument(after: &str) -> bool {
    let mut rest = after.trim_start();
    if let Some(options) = rest.strip_prefix('[') {
        let Some(end) = options.find(['[', ']']) else {
            return false;
        };
        if options.as_bytes()[end] != b']' {
            return false;
        }
        rest = options[end + 1..].trim_start();
    }
    let Some(argument) = rest.strip_prefix('{') else {
        return false;
    };
    argument
        .find('}')
        .is_some_and(|end| is_plain_relative_name(&argument[..end]))
}

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
        r"\openin",
        r"\openout",
        r"\@@input",
        "shell-escape",
    ];
    let mut errors = Vec::new();
    for needle in forbidden {
        if let Some(offset) = source.find(needle) {
            errors.push(CompileError::error(
                line_of(source, offset),
                format!("Forbidden compiler construct: {needle}"),
            ));
        }
    }
    // `\include` is forbidden, but `\includegraphics` may read a plain relative file name.
    let mut reported_include = false;
    for (offset, _) in source.match_indices(r"\include") {
        let rest = &source[offset..];
        if !is_includegraphics(rest) {
            if !reported_include {
                reported_include = true;
                errors.push(CompileError::error(
                    line_of(source, offset),
                    r"Forbidden compiler construct: \include",
                ));
            }
        } else if !has_plain_graphics_argument(&rest[INCLUDEGRAPHICS.len()..]) {
            errors.push(CompileError::error(
                line_of(source, offset),
                r"\includegraphics only accepts a plain relative file name.",
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn base64_sextet(byte: u8) -> Option<u32> {
    let value = match byte {
        b'A'..=b'Z' => byte - b'A',
        b'a'..=b'z' => byte - b'a' + 26,
        b'0'..=b'9' => byte - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => return None,
    };
    Some(u32::from(value))
}

/// Decodes padded standard base64 (RFC 4648 §4) without whitespace.
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let chunks = text.as_bytes().chunks_exact(4);
    if !chunks.remainder().is_empty() {
        return None;
    }
    let groups = chunks.len();
    let mut output = Vec::with_capacity(groups * 3);
    for (index, chunk) in chunks.enumerate() {
        let padding = chunk.iter().rev().take_while(|&&byte| byte == b'=').count();
        if padding > 2 || (padding > 0 && index + 1 != groups) {
            return None;
        }
        let mut group = 0u32;
        for &byte in &chunk[..4 - padding] {
            group = (group << 6) | base64_sextet(byte)?;
        }
        group <<= 6 * padding;
        output.extend_from_slice(&group.to_be_bytes()[1..4 - padding]);
    }
    Some(output)
}

/// The file signature an image name's extension promises (PNG or JPEG only).
fn image_signature(name: &str) -> Option<&'static [u8]> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some(b"\x89PNG\r\n\x1a\n")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some(&[0xFF, 0xD8, 0xFF])
    } else {
        None
    }
}

fn decode_image(image: &ImageAttachment) -> Result<Vec<u8>, String> {
    let name = &image.name;
    if name.len() > MAX_IMAGE_NAME_CHARS || !is_plain_relative_name(name) {
        return Err(format!(
            "Image name \"{name}\" must be a plain relative file name."
        ));
    }
    let Some(signature) = image_signature(name) else {
        return Err(format!("Image \"{name}\" must end in .png, .jpg or .jpeg."));
    };
    let too_large = || format!("Image \"{name}\" exceeds the {MAX_IMAGE_BYTES} byte limit.");
    if image.data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err(too_large());
    }
    let bytes = decode_base64(&image.data)
        .ok_or_else(|| format!("Image \"{name}\" is not valid base64."))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    if !bytes.starts_with(signature) {
        return Err(format!("Image \"{name}\" is not a PNG or JPEG file."));
    }
    Ok(bytes)
}

/// Validates uploaded images and decodes them into `(relative path, bytes)` pairs that are safe
/// to write inside the per-request scratch directory.
pub fn validate_images(
    images: &[ImageAttachment],
) -> Result<Vec<(String, Vec<u8>)>, Vec<CompileError>> {
    if images.len() > MAX_IMAGES {
        return Err(vec![CompileError::error(
            1,
            format!("At most {MAX_IMAGES} images can be compiled at once."),
        )]);
    }
    let names: HashSet<&str> = images.iter().map(|image| image.name.as_str()).collect();
    let mut seen = HashSet::new();
    let mut errors = Vec::new();
    let mut decoded = Vec::new();
    let mut total = 0usize;
    for image in images {
        let name = image.name.as_str();
        // `a.png` and `a.png/b.png` cannot both exist on disk.
        let clashes = name
            .match_indices('/')
            .any(|(offset, _)| names.contains(&name[..offset]));
        if !seen.insert(name) || clashes {
            errors.push(CompileError::error(
                1,
                format!("Image \"{name}\" is listed twice or clashes with another image's folder."),
            ));
            continue;
        }
        match decode_image(image) {
            Ok(bytes) => {
                total += bytes.len();
                decoded.push((name.to_owned(), bytes));
            }
            Err(message) => errors.push(CompileError::error(1, message)),
        }
    }
    if total > MAX_TOTAL_IMAGE_BYTES {
        errors.push(CompileError::error(
            1,
            format!("Images exceed the {MAX_TOTAL_IMAGE_BYTES} byte total limit."),
        ));
    }
    if errors.is_empty() {
        Ok(decoded)
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
    use super::{
        document_source, parse_compile_errors, validate_images, validate_source, MAX_IMAGES,
        PICTURE_PREAMBLE,
    };
    use tikzforge_graphic_ir::ImageAttachment;

    /// A 2×2 PNG.
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

    fn image(name: &str, data: &str) -> ImageAttachment {
        ImageAttachment {
            name: name.into(),
            data: data.into(),
        }
    }

    #[test]
    fn rejects_shell_escape_and_file_io() {
        let errors = validate_source(r"\write18{touch /tmp/pwned}").expect_err("must reject");
        assert!(!errors.is_empty());
    }

    #[test]
    fn allows_includegraphics_with_plain_relative_names() {
        for source in [
            r"\node {\includegraphics[width=2cm,height=1cm]{fig.png}};",
            r"\node {\includegraphics{example-image}};",
            "\\node {\\includegraphics [width=\\linewidth]\n  {figs/plot_1.jpeg}};",
        ] {
            assert!(validate_source(source).is_ok(), "rejected {source}");
        }
    }

    #[test]
    fn rejects_include_and_unsafe_graphics_names() {
        for source in [
            r"\include{chapter}",
            r"\includeonly{chapter}",
            r"\includegraphics{/etc/passwd}",
            r"\includegraphics{../x.png}",
            r"\includegraphics{figs/../../x.png}",
            r"\includegraphics{\x}",
            r"\includegraphics[width=1cm]\x",
            r"\includegraphics*{fig.png}",
        ] {
            assert!(validate_source(source).is_err(), "accepted {source}");
        }
        let errors = validate_source("ok\n\\includegraphics{/etc/passwd}").expect_err("unsafe");
        assert_eq!(errors[0].line, 2);
        assert!(errors[0].message.contains("plain relative file name"));
    }

    #[test]
    fn decodes_valid_png_attachments() {
        let decoded = validate_images(&[image("fig.png", PNG), image("figs/b.PNG", PNG)])
            .expect("valid images");
        assert_eq!(decoded[0].0, "fig.png");
        assert_eq!(decoded[1].0, "figs/b.PNG");
        assert!(decoded[0].1.starts_with(b"\x89PNG"));
        assert_eq!(decoded[0].1.len(), 79);
    }

    #[test]
    fn rejects_bad_attachments() {
        let cases = [
            (image("fig.png", "/9j/4AAQ"), "not a PNG or JPEG"),
            (image("fig.jpg", PNG), "not a PNG or JPEG"),
            (image("../fig.png", PNG), "plain relative file name"),
            (image("/tmp/fig.png", PNG), "plain relative file name"),
            (image("fig.gif", PNG), "must end in"),
            (image("fig.png", "iVBORw0KGgo"), "not valid base64"),
            (image("fig.png", "iVBO$w0KGgo="), "not valid base64"),
        ];
        for (attachment, expected) in cases {
            let errors =
                validate_images(std::slice::from_ref(&attachment)).expect_err(&attachment.name);
            assert!(
                errors[0].message.contains(expected),
                "{}: {}",
                attachment.name,
                errors[0].message
            );
        }
        let duplicate = validate_images(&[image("fig.png", PNG), image("fig.png", PNG)]);
        assert!(duplicate.is_err());
        let clash = validate_images(&[image("a.png", PNG), image("a.png/b.png", PNG)]);
        assert!(clash.is_err());
        let many: Vec<_> = (0..=MAX_IMAGES)
            .map(|index| image(&format!("f{index}.png"), PNG))
            .collect();
        assert!(validate_images(&many).is_err());
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
