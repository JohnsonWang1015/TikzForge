import type { Diagnostic } from '@tikzforge/graphic-ir';

const FORBIDDEN = [
  /\\write18/iu,
  /\\immediate\s*\\write18/iu,
  /\\(?:input|include|openin|openout)/iu,
  /shell-escape/iu,
];

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
    const line = source.slice(0, match.index).split('\n').length;
    diagnostics.push({
      severity: 'error',
      message: `Compiler security policy rejects ${match[0]}.`,
      line,
      column: 1,
      code: 'SECURITY_FORBIDDEN',
    });
  }
  return diagnostics;
}
