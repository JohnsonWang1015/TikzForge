import {
  DEFAULT_IMAGE_PATH,
  isImageDataUrl,
  isImagePath,
  type Project,
} from '@tikzforge/graphic-ir';

/** Uploaded pictures live in the project (and localStorage), so keep them small. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const IMAGE_EXTENSION = /\.(?:png|jpe?g|pdf|eps)$/iu;

export interface UploadedImage {
  href: string;
  /** File name as the user uploaded it, made safe for `\includegraphics`. */
  name: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** Turns an arbitrary file name into a plain `\includegraphics` name with the right extension. */
export function imageFileName(fileName: string, mime: string): string {
  const extension = EXTENSIONS[mime] ?? '.png';
  const stem = fileName
    .replace(IMAGE_EXTENSION, '')
    .replace(/[^A-Za-z0-9_.-]+/gu, '-')
    .replace(/^[^A-Za-z0-9_]+/u, '')
    .slice(0, 60)
    .replace(/[-.]+$/u, '');
  return `${stem || 'image'}${extension}`;
}

/**
 * The `\includegraphics` name after an upload: a name the user chose keeps its folder and stem,
 * the default placeholder takes the uploaded file's name; either way the extension matches.
 */
export function imagePathAfterUpload(current: string | undefined, upload: UploadedImage): string {
  if (!current || current === DEFAULT_IMAGE_PATH || !isImagePath(current)) return upload.name;
  const extension = upload.name.slice(upload.name.lastIndexOf('.'));
  const path = `${current.replace(IMAGE_EXTENSION, '')}${extension}`;
  return isImagePath(path) ? path : upload.name;
}

/** The file an image node's data is sent to the compiler as, or undefined if it has none. */
export function imageAttachmentName(path: string | undefined, href: string | undefined) {
  if (!isImagePath(path) || !isImageDataUrl(href)) return undefined;
  const extension = href.startsWith('data:image/png') ? '.png' : '.jpg';
  const matches = extension === '.png' ? /\.png$/iu : /\.jpe?g$/iu;
  if (matches.test(path)) return path;
  return IMAGE_EXTENSION.test(path) ? undefined : `${path}${extension}`;
}

/** Uploaded pictures to send with a compile, named as the TikZ `\includegraphics` finds them. */
export function imageAttachments(project: Project): Array<{ name: string; data: string }> {
  const attachments = new Map<string, string>();
  for (const element of project.elements) {
    if (element.type !== 'image') continue;
    const name = imageAttachmentName(element.source, element.href);
    if (name && element.href && !attachments.has(name))
      attachments.set(name, element.href.slice(element.href.indexOf(',') + 1));
  }
  return [...attachments].map(([name, data]) => ({ name, data }));
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function naturalSize(href: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The file is not a readable PNG or JPEG image.'));
    image.src = href;
  });
}

/** Reads a user-chosen PNG/JPEG; rejects with a message suitable for showing to the user. */
export async function readImageFile(file: File): Promise<UploadedImage> {
  if (!EXTENSIONS[file.type]) throw new Error('Only PNG and JPEG images are supported.');
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error(`Images must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`);
  const href = await readAsDataUrl(file);
  if (!isImageDataUrl(href)) throw new Error('The file is not a readable PNG or JPEG image.');
  const size = await naturalSize(href);
  return {
    href,
    name: imageFileName(file.name, file.type),
    naturalWidth: size.width,
    naturalHeight: size.height,
  };
}
