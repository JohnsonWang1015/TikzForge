import { renderProjectToSvg } from '@tikzforge/svg-renderer';
import { isEdgeElement, isNodeElement, type Project } from '@tikzforge/graphic-ir';
import { serializeProject } from '@tikzforge/tikz-serializer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export type ExportFormat = 'tikz' | 'latex' | 'svg' | 'pdf' | 'png' | 'json';

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function color(value: string, fallback: [number, number, number]): ReturnType<typeof rgb> {
  const match = value.match(/^#([0-9a-f]{6})$/iu);
  if (!match) return rgb(...fallback);
  const hex = match[1] ?? '';
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
}

async function createPdf(project: Project): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([project.canvas.width, project.canvas.height]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const toY = (y: number) => project.canvas.height - y;
  for (const element of project.elements) {
    if (isEdgeElement(element)) {
      const from = project.elements.find((candidate) => candidate.id === element.from);
      const to = project.elements.find((candidate) => candidate.id === element.to);
      if (!from || !to || !isNodeElement(from) || !isNodeElement(to)) continue;
      page.drawLine({
        start: { x: from.x, y: toY(from.y) },
        end: { x: to.x, y: toY(to.y) },
        color: color(element.style.stroke, [0.57, 0.64, 0.78]),
        thickness: element.style.lineWidth,
      });
      continue;
    }
    if (!isNodeElement(element)) continue;
    const fill =
      element.style.fill === 'transparent' || element.style.fill === 'none'
        ? undefined
        : color(element.style.fill, [0.06, 0.09, 0.15]);
    const border = color(element.style.stroke, [0.43, 0.51, 0.65]);
    const x = element.x - element.width / 2;
    const y = project.canvas.height - element.y - element.height / 2;
    if (element.type === 'circle' || element.type === 'ellipse')
      page.drawEllipse({
        x: element.x,
        y: toY(element.y),
        xScale: element.width / 2,
        yScale: element.height / 2,
        color: fill,
        borderColor: border,
        borderWidth: element.style.lineWidth,
      });
    else
      page.drawRectangle({
        x,
        y,
        width: element.width,
        height: element.height,
        color: fill,
        borderColor: border,
        borderWidth: element.style.lineWidth,
      });
    if (element.text)
      page.drawText(element.text, {
        x: element.x - font.widthOfTextAtSize(element.text, element.style.fontSize) / 2,
        y: toY(element.y) - element.style.fontSize / 3,
        size: element.style.fontSize,
        font,
        color: color(element.style.textColor, [0.9, 0.94, 1]),
      });
  }
  return pdf.save();
}

async function createPng(project: Project): Promise<Blob> {
  const svg = renderProjectToSvg(project);
  const image = new Image();
  image.decoding = 'async';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not rasterize SVG preview.'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable.');
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))),
      'image/png',
    ),
  );
}

export async function exportProject(project: Project, format: ExportFormat): Promise<void> {
  const name =
    project.metadata.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/giu, '-')
      .replace(/^-|-$/gu, '') || 'tikzforge-project';
  if (format === 'svg') {
    download(`${name}.svg`, renderProjectToSvg(project), 'image/svg+xml');
    return;
  }
  if (format === 'pdf') {
    downloadBlob(
      `${name}.pdf`,
      new Blob([(await createPdf(project)) as BlobPart], { type: 'application/pdf' }),
    );
    return;
  }
  if (format === 'png') {
    downloadBlob(`${name}.png`, await createPng(project));
    return;
  }
  if (format === 'json') {
    download(`${name}.tikzproject`, JSON.stringify(project, null, 2), 'application/json');
    return;
  }
  download(
    `${name}.${format === 'latex' ? 'tex' : 'tikz'}`,
    serializeProject(project, { includeDocument: format === 'latex' }),
    'text/plain',
  );
}

export function projectAsDownloadText(project: Project, format: ExportFormat): string {
  if (format === 'svg') return renderProjectToSvg(project);
  if (format === 'json') return JSON.stringify(project, null, 2);
  return serializeProject(project, { includeDocument: format === 'latex' });
}
