import { isImagePath, type Diagnostic } from '@tikzforge/graphic-ir';

// Keep in sync with `validate_source`/`validate_images` in crates/tikz-serializer/src/lib.rs.
const FORBIDDEN = [
  /\\write18/iu,
  /\\immediate\s*\\write18/iu,
  /\\(?:input|openin|openout)/iu,
  /shell-escape/iu,
];

const INCLUDE = /\\include/giu;
const INCLUDEGRAPHICS = '\\includegraphics';
/** What may follow `\includegraphics`: an optional option list, then a literal file name. */
const GRAPHICS_ARGUMENTS = /^\s*(?:\[[^[\]]*\])?\s*\{([^{}]*)\}/u;

export const MAX_IMAGES = 16;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;

/** An uploaded picture sent with a render request; `data` is base64 without a `data:` prefix. */
export interface ImageAttachment {
  name: string;
  data: string;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function forbidden(message: string, line: number): Diagnostic {
  return { severity: 'error', message, line, column: 1, code: 'SECURITY_FORBIDDEN' };
}

/**
 * `\include…` is rejected except for the exact control word `\includegraphics` with a plain
 * relative file name, so a picture can't be read from outside the compile directory.
 */
function includeDiagnostics(source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const match of source.matchAll(INCLUDE)) {
    const index = match.index;
    const end = index + INCLUDEGRAPHICS.length;
    const graphics =
      source.startsWith(INCLUDEGRAPHICS, index) && !/[A-Za-z]/u.test(source[end] ?? '');
    if (!graphics) {
      diagnostics.push(
        forbidden(`Compiler security policy rejects ${match[0]}.`, lineOf(source, index)),
      );
      continue;
    }
    const name = GRAPHICS_ARGUMENTS.exec(source.slice(end))?.[1];
    if (!isImagePath(name))
      diagnostics.push(
        forbidden(
          '\\includegraphics only accepts a plain relative file name.',
          lineOf(source, index),
        ),
      );
  }
  return diagnostics;
}

export function validateLatexSource(source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (source.length > 512_000)
    diagnostics.push({
      severity: 'error',
      message: 'Source exceeds the 512 KB render limit.',
      line: 1,
      column: 1,
      code: 'SECURITY_SIZE',
    });
  for (const pattern of FORBIDDEN) {
    const match = pattern.exec(source);
    if (!match) continue;
    diagnostics.push(
      forbidden(`Compiler security policy rejects ${match[0]}.`, lineOf(source, match.index)),
    );
  }
  diagnostics.push(...includeDiagnostics(source));
  return diagnostics;
}

function decodedLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function startsWithSignature(data: string, signature: number[]): boolean {
  let head: string;
  try {
    head = atob(data.slice(0, 12));
  } catch {
    return false;
  }
  return signature.every((byte, index) => head.charCodeAt(index) === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** Checks uploaded pictures before they are forwarded to (or rendered instead of) the compiler. */
export function validateImageAttachments(value: unknown): {
  images: ImageAttachment[];
  errors: Diagnostic[];
} {
  const images: ImageAttachment[] = [];
  const errors: Diagnostic[] = [];
  const reject = (message: string) => errors.push(forbidden(message, 1));
  if (value === undefined) return { images, errors };
  if (!Array.isArray(value)) {
    reject('Images must be a list of { name, data } objects.');
    return { images, errors };
  }
  if (value.length > MAX_IMAGES) reject(`At most ${MAX_IMAGES} images can be compiled at once.`);
  const names = new Set<string>();
  let total = 0;
  for (const item of value.slice(0, MAX_IMAGES) as unknown[]) {
    const { name, data } = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    if (typeof name !== 'string' || typeof data !== 'string') {
      reject('Images must be a list of { name, data } objects.');
      continue;
    }
    const label = JSON.stringify(name.slice(0, 80));
    if (!isImagePath(name) || !/\.(?:png|jpe?g)$/iu.test(name)) {
      reject(`Image ${label} needs a plain relative name ending in .png, .jpg or .jpeg.`);
      continue;
    }
    if (names.has(name)) {
      reject(`Image ${label} is attached twice.`);
      continue;
    }
    names.add(name);
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) {
      reject(`Image ${label} is not valid base64.`);
      continue;
    }
    const size = decodedLength(data);
    total += size;
    if (size > MAX_IMAGE_BYTES) {
      reject(`Image ${label} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
      continue;
    }
    const png = /\.png$/iu.test(name);
    if (!startsWithSignature(data, png ? PNG_SIGNATURE : JPEG_SIGNATURE)) {
      reject(`Image ${label} is not a ${png ? 'PNG' : 'JPEG'} file.`);
      continue;
    }
    images.push({ name, data });
  }
  for (const name of names)
    if ([...names].some((other) => other.startsWith(`${name}/`)))
      reject(`Image ${JSON.stringify(name)} clashes with another image's folder.`);
  if (total > MAX_TOTAL_IMAGE_BYTES)
    reject(`Images may total at most ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024} MB.`);
  return { images, errors };
}
