import { generateDiagramFromPrompt } from '@/lib/ai';
import { validateProject, type Project } from '@tikzforge/graphic-ir';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const prompt =
    typeof body === 'object' && body !== null && 'prompt' in body && typeof body.prompt === 'string'
      ? body.prompt.trim()
      : '';
  if (!prompt)
    return Response.json({ error: 'Describe the diagram you want to generate.' }, { status: 400 });
  if (prompt.length > 4_000)
    return Response.json({ error: 'Prompt is limited to 4,000 characters.' }, { status: 400 });
  try {
    const result = generateDiagramFromPrompt(prompt);
    const validation = validateProject(result.project);
    if (!validation.valid)
      return Response.json(
        { error: validation.errors.map((item) => item.message).join(' ') },
        { status: 422 },
      );
    return Response.json({
      project: result.project satisfies Project,
      explanation: result.explanation,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Generation failed.' },
      { status: 500 },
    );
  }
}
