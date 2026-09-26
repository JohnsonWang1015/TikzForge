import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    monaco?: {
      editor: { getModels(): Array<{ getValue(): string; setValue(value: string): void }> };
    };
  }
}

/** Replaces the whole TikZ source as a paste would (no auto-indent), then waits for the parse. */
async function setSource(page: Page, source: string): Promise<void> {
  await page.getByTestId('new-project').click();
  await page.locator('.monaco-editor').first().waitFor();
  await page.evaluate((text) => window.monaco?.editor.getModels()[0]?.setValue(text), source);
  await page.waitForTimeout(700);
}

async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => window.monaco?.editor.getModels()[0]?.getValue() ?? '');
}

async function drag(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no canvas bounds`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const formattedSource = String.raw`\begin{tikzpicture}[node distance=1.5cm]
  % stages of the pipeline
  \node[draw] (a) {Input};
  \node[draw, right=of a] (b) {Model};   % keep this comment

  \node[draw, below=2cm of b] (c) {Out};
  \draw[->] (a) -- (b);
  \draw[->] (b) -- (c);
  \foreach \i in {1,...,3} {\node[draw, circle] (n\i) at (\i*1.5, -5) {\i};}
\end{tikzpicture}`;

const tikzSource = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {Input};
\node[draw, rounded corners, fill=blue!10] (B) at (4,0) {Transformer};
\draw[->] (A) -- (B);
\end{tikzpicture}`;

test('studio loads and supports the core visual workflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('TikzForge', { exact: true })).toBeVisible();
  await expect(page.getByTestId('diagram-canvas')).toBeVisible();
  await page.getByTestId('new-project').click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const node = page.locator('[data-testid^="canvas-element-node_"]').first();
  await expect(node).toBeVisible();
  const nameField = page.locator('textarea').last();
  await nameField.fill('Server');
  await expect(page.locator('.view-lines')).toContainText('Server');
  const box = await node.boundingBox();
  if (!box) throw new Error('new node has no canvas bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect(page.locator('.view-lines')).toContainText('at (');

  const editor = page.locator('.monaco-editor').first();
  await editor.click({ position: { x: 90, y: 28 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(tikzSource);
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="canvas-element-A"]')).toBeVisible();
  await expect(page.locator('[data-testid="canvas-element-B"]')).toBeVisible();
  await page.getByTestId('compile-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Fast preview ready')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('iframe[title="TikzForge SVG preview"]')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Project JSON/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.tikzproject');
});

test('render API returns SVG and rejects shell escape', async ({ request }) => {
  const response = await request.post('/api/render', { data: { source: tikzSource } });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { success: boolean; svg: string; renderer: string };
  expect(body.success).toBeTruthy();
  expect(body.svg).toContain('<svg');
  expect(body.renderer).toBe('fast');

  const rejected = await request.post('/api/render', {
    data: { source: String.raw`\write18{touch /tmp/pwned}` },
  });
  expect(rejected.status()).toBe(400);
});

test('canvas edits patch only the changed TikZ statement', async ({ page }) => {
  await page.goto('/');
  await setSource(page, formattedSource);
  await expect(page.getByTestId('canvas-element-c')).toBeVisible();
  expect(await editorText(page)).toBe(formattedSource);
  await drag(page, 'canvas-element-c', 120, 40);
  const after = await editorText(page);
  const before = formattedSource.split('\n');
  const changed = after.split('\n').filter((line, index) => line !== before[index]);
  expect(changed).toHaveLength(1);
  expect(changed[0]).toMatch(/^ {2}\\node\[draw\] \(c\) at \(/u);
  expect(after).toContain('% keep this comment');
  expect(after).toContain('\\foreach \\i in {1,...,3}');
});

test('raw TikZ is previewed on the canvas and never rewritten', async ({ page }) => {
  await page.goto('/');
  await setSource(page, formattedSource);
  const chip = page.locator('.raw-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('foreach');
  await expect(page.locator('.raw-preview')).toHaveCount(3);
  await chip.click();
  await expect(page.getByText('Visual editing is disabled for this block.')).toBeVisible();
  await drag(page, 'canvas-element-a', 0, -60);
  expect(await editorText(page)).toContain(
    '\\foreach \\i in {1,...,3} {\\node[draw, circle] (n\\i) at (\\i*1.5, -5) {\\i};}',
  );
});

test('resizing a node fixes its size in TikZ', async ({ page }) => {
  await page.goto('/');
  await setSource(page, formattedSource);
  await page.getByTestId('canvas-element-a').click();
  const handle = page.locator('.selection-handle');
  const box = await handle.boundingBox();
  if (!box) throw new Error('resize handle is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => editorText(page))
    .toMatch(/\\node\[draw, minimum width=[\d.]+cm, minimum height=[\d.]+cm\] \(a\)/u);
});

test('undo and redo restore both the canvas and the source', async ({ page }) => {
  await page.goto('/');
  await setSource(page, formattedSource);
  const original = await editorText(page);
  await page.getByTestId('canvas-element-c').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const moved = await editorText(page);
  expect(moved).not.toBe(original);
  expect(moved).toMatch(/\(c\) at \(/u);
  await page.keyboard.press('ControlOrMeta+Z');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => editorText(page)).toContain('\\node[draw, below=');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(() => editorText(page)).toMatch(/\(c\) at \(/u);
  await expect(page.getByText('% keep this comment', { exact: false })).toBeVisible();
});

test('PGFPlots plots render on the canvas and edit through the data editor', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByRole('button', { name: 'Plot' }).click();
  const plot = page.locator('[data-testid^="canvas-element-plot_"]');
  await expect(plot).toBeVisible();
  await expect.poll(() => editorText(page)).toContain('\\begin{axis}[at={(');
  await expect.poll(() => editorText(page)).toContain('coordinates { (1,2) (2,4) (3,3) }');
  const firstY = page.locator('.plot-table tbody tr').first().locator('input').nth(1);
  await firstY.fill('7');
  await expect.poll(() => editorText(page)).toContain('coordinates { (1,7) (2,4) (3,3) }');
  await drag(page, (await plot.getAttribute('data-testid')) ?? '', 60, 0);
  await expect.poll(() => editorText(page)).toContain('coordinates { (1,7) (2,4) (3,3) }');
});

test('typing TikZ keeps canvas ids stable for unnamed edges', async ({ page }) => {
  await page.goto('/');
  await setSource(page, formattedSource);
  const edges = page.locator('[data-testid^="canvas-element-edge_"]');
  await expect(edges).toHaveCount(2);
  const ids = await edges.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-testid')),
  );
  await edges.first().click({ force: true });
  const editor = page.locator('.monaco-editor').first();
  await editor.click({ position: { x: 90, y: 28 } });
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.insertText('  % a new comment');
  await page.waitForTimeout(700);
  const after = await edges.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-testid')),
  );
  expect(after).toEqual(ids);
});

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

test('right-clicking a node opens its actions menu', async ({ page }) => {
  await page.goto('/');
  await setSource(page, tikzSource);
  const menu = page.getByTestId('canvas-context-menu');
  await page.getByTestId('canvas-element-A').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.getByTestId('canvas-element-A').click();
  await page.getByTestId('canvas-element-B').click({ modifiers: ['Shift'] });
  await page.getByTestId('canvas-element-B').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Connect A → B' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-testid^="canvas-element-"]')).toHaveCount(5);

  await page.getByTestId('diagram-canvas').click({ button: 'right', position: { x: 20, y: 400 } });
  await expect(menu.getByRole('menuitem', { name: 'Select all' })).toBeVisible();
});

test('side panels can be resized by dragging their edges', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.locator('.sidebar');
  const before = (await sidebar.boundingBox())?.width ?? 0;
  const handle = await page.getByTestId('resize-sidebar').boundingBox();
  if (!handle) throw new Error('resize handle has no bounds');
  await page.mouse.move(handle.x, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(before + 80, 0);
  const inspector = page.locator('.inspector');
  const inspectorBefore = (await inspector.boundingBox())?.width ?? 0;
  await page.getByTestId('resize-inspector').focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await inspector.boundingBox())?.width)
    .toBeCloseTo(inspectorBefore + 16, 0);
  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(before + 80, 0);
});

test('image nodes embed an uploaded picture and emit \\includegraphics', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('example-image');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('image-upload').click();
  await (await chooser).setFiles({ name: 'My plot.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(page.locator('[data-testid^="canvas-element-node_"] image')).toHaveCount(1);
  await expect(page.getByTestId('image-path')).toHaveValue('My-plot.png');
  const source = await editorText(page);
  expect(source).toMatch(/\\includegraphics\[width=3\.2cm,height=3\.2cm\]\{My-plot\.png\}/u);

  const response = await page.request.post('/api/render', {
    data: { source, images: [{ name: 'My-plot.png', data: pngBytes.toString('base64') }] },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).svg).toContain('data:image/png;base64,');
});

test('plot data can be imported from a CSV file', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByRole('button', { name: 'Plot' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('plot-import-csv').click();
  await (
    await chooser
  ).setFiles({
    name: 'data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y\n0,1\n1,4\n2,9\n'),
  });
  await expect.poll(() => editorText(page)).toContain('coordinates { (0,1) (1,4) (2,9) }');
});
