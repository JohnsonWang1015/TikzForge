import { parseTikz } from '@tikzforge/tikz-parser';
import { renderProjectToSvg, sanitizeSvg } from '@tikzforge/svg-renderer';
import type { Diagnostic } from '@tikzforge/graphic-ir';
import { validateLatexSource } from '@/lib/security';

export const runtime = 'nodejs';

/** Longer than the compiler service's own budget (10 s Tectonic + 5 s PDF → SVG conversion). */
const COMPILER_TIMEOUT_MS = 20_000;

/** Compiler statuses whose body is shown to the user; anything else falls back to fast preview. */
const FORWARDED_STATUSES = new Set([200, 400, 422]);

type Renderer = 'tectonic' | 'fast';

interface RenderResult {
  success: boolean;
  svg?: string;
  compileTime?: number;
  log: string;
  errors: Diagnostic[];
  renderer?: Renderer;
}

interface RenderBody {
  source?: unknown;
}

function isRenderBody(value: unknown): value is RenderBody {
  return typeof value === 'object' && value !== null && 'source' in value;
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.severity === 'error' || item.severity === 'warning' || item.severity === 'info') &&
    typeof item.message === 'string' &&
    typeof item.line === 'number' &&
    typeof item.column === 'number'
  );
}

/** Rebuilds the compiler response field by field instead of forwarding untrusted JSON. */
function compilerResult(value: unknown): RenderResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.success !== 'boolean' || body.renderer !== 'tectonic') return undefined;
  if (!Array.isArray(body.errors) || !body.errors.every(isDiagnostic)) return undefined;
  if (body.success && typeof body.svg !== 'string') return undefined;
  return {
    success: body.success,
    svg: typeof body.svg === 'string' ? sanitizeSvg(body.svg) : undefined,
    compileTime: typeof body.compileTime === 'number' ? body.compileTime : undefined,
    log: typeof body.log === 'string' ? body.log : '',
    errors: body.errors.map(({ severity, message, line, column }) => ({
      severity,
      message,
      line,
      column,
    })),
    renderer: 'tectonic',
  };
}

async function compileRemotely(
  serviceUrl: string,
  source: string,
): Promise<{ status: number; result: RenderResult } | { unavailable: string }> {
  let remote: Response;
  try {
    remote = await fetch(`${serviceUrl.replace(/\/$/u, '')}/api/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
      signal: AbortSignal.timeout(COMPILER_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'is unreachable';
    return { unavailable: `LaTeX compiler ${reason}` };
  }
  let body: unknown;
  try {
    body = await remote.json();
  } catch {
    return { unavailable: `LaTeX compiler returned HTTP ${remote.status} without JSON` };
  }
  const result = compilerResult(body);
  if (!FORWARDED_STATUSES.has(remote.status) || !result) {
    const detail = result?.log ? `: ${result.log.trim().replace(/\.$/u, '')}` : '';
    return { unavailable: `LaTeX compiler returned HTTP ${remote.status}${detail}` };
  }
  return { status: remote.status, result };
}

function fastRender(source: string, started: number, note?: string): Response {
  const parsed = parseTikz(source);
  if (!parsed.valid) {
    return Response.json(
      {
        success: false,
        errors: parsed.diagnostics,
        log: [note, 'TikZ subset parser rejected the source.'].filter(Boolean).join(' '),
        renderer: 'fast',
      } satisfies RenderResult,
      { status: 422 },
    );
  }
  return Response.json({
    success: true,
    svg: sanitizeSvg(renderProjectToSvg(parsed.project, { fitToContent: true })),
    compileTime: Math.round(performance.now() - started),
    errors: [],
    log:
      note ??
      'Fast SVG preview rendered. Configure COMPILER_SERVICE_URL for accurate Tectonic compilation.',
    renderer: 'fast',
  } satisfies RenderResult);
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
  if (!compilerServiceUrl) return fastRender(body.source, started);
  const remote = await compileRemotely(compilerServiceUrl, body.source);
  if ('unavailable' in remote)
    return fastRender(
      body.source,
      started,
      `${remote.unavailable}; showing the fast preview instead.`,
    );
  return Response.json(remote.result, { status: remote.status });
}
