import { expect, test } from '@playwright/test';

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
