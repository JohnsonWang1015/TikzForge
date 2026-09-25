import { parseTikz } from '@tikzforge/tikz-parser';
import { renderProjectToSvg, sanitizeSvg } from '@tikzforge/svg-renderer';
import type { Diagnostic } from '@tikzforge/graphic-ir';
import { validateLatexSource } from '@/lib/security';

export const runtime = 'nodejs';

interface RenderBody {
  source?: unknown;
}

function isRenderBody(value: unknown): value is RenderBody {
  return typeof value === 'object' && value !== null && 'source' in value;
}

export async function POST(request: Request): Promise<Response> {
  const started = performance.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        success: false,
        errors: [
          { severity: 'error', message: 'Request body must be valid JSON.', line: 1, column: 1 },
        ] satisfies Diagnostic[],
      },
      { status: 400 },
    );
  }
  if (!isRenderBody(body) || typeof body.source !== 'string') {
    return Response.json(
      {
        success: false,
        errors: [
          { severity: 'error', message: 'Expected a source string.', line: 1, column: 1 },
        ] satisfies Diagnostic[],
      },
      { status: 400 },
    );
  }
  const securityErrors = validateLatexSource(body.source);
  if (securityErrors.some((error) => error.severity === 'error')) {
    return Response.json(
      { success: false, errors: securityErrors, log: 'Rejected by compiler security policy.' },
      { status: 400 },
    );
  }
  const compilerServiceUrl = process.env.COMPILER_SERVICE_URL;
  if (compilerServiceUrl) {
    try {
      const remote = await fetch(`${compilerServiceUrl.replace(/\/$/u, '')}/api/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: body.source }),
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
      const remoteBody = (await remote.json()) as unknown;
      if (typeof remoteBody === 'object' && remoteBody !== null && 'success' in remoteBody)
        return Response.json(remoteBody, { status: remote.status });
    } catch {
      // The local fast renderer below remains available when the optional compiler service is down.
    }
  }
  const parsed = parseTikz(body.source);
  if (!parsed.valid) {
    return Response.json(
      {
        success: false,
        errors: parsed.diagnostics,
        log: 'TikZ subset parser rejected the source.',
      },
      { status: 422 },
    );
  }
  const svg = sanitizeSvg(renderProjectToSvg(parsed.project));
  return Response.json({
    success: true,
    svg,
    compileTime: Math.round(performance.now() - started),
    log: 'Fast SVG preview rendered. Configure COMPILER_SERVICE_URL for accurate Tectonic compilation.',
  });
}
