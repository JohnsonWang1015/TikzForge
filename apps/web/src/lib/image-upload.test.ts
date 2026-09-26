import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@tikzforge/graphic-ir';
import {
  imageAttachmentName,
  imageAttachments,
  imageFileName,
  imagePathAfterUpload,
  type UploadedImage,
} from './image-upload';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

function upload(name: string): UploadedImage {
  return { href: PNG, name, naturalWidth: 2, naturalHeight: 1 };
}

describe('image upload names', () => {
  it('makes uploaded file names safe for \\includegraphics', () => {
    expect(imageFileName('My Figure (1).PNG', 'image/png')).toBe('My-Figure-1.png');
    expect(imageFileName('.hidden.jpeg', 'image/jpeg')).toBe('hidden.jpg');
    expect(imageFileName('圖片.png', 'image/png')).toBe('image.png');
  });

  it('keeps a chosen folder and stem but replaces the placeholder name', () => {
    expect(imagePathAfterUpload('example-image', upload('plot.png'))).toBe('plot.png');
    expect(imagePathAfterUpload(undefined, upload('plot.png'))).toBe('plot.png');
    expect(imagePathAfterUpload('figs/result.jpg', upload('plot.png'))).toBe('figs/result.png');
    expect(imagePathAfterUpload('figs/result', upload('plot.png'))).toBe('figs/result.png');
  });

  it('names attachments the way LaTeX looks them up', () => {
    expect(imageAttachmentName('fig.png', PNG)).toBe('fig.png');
    expect(imageAttachmentName('fig', PNG)).toBe('fig.png');
    expect(imageAttachmentName('fig', JPEG)).toBe('fig.jpg');
    expect(imageAttachmentName('fig.jpeg', JPEG)).toBe('fig.jpeg');
    expect(imageAttachmentName('fig.png', JPEG)).toBeUndefined();
    expect(imageAttachmentName('fig.png', undefined)).toBeUndefined();
  });

  it('collects each uploaded picture once', () => {
    const project = createEmptyProject();
    const a = createNode('image', { id: 'a' });
    a.source = 'fig.png';
    a.href = PNG;
    const b = { ...a, id: 'b' };
    const placeholder = createNode('image', { id: 'c' });
    project.elements = [a, b, placeholder];
    expect(imageAttachments(project)).toEqual([{ name: 'fig.png', data: 'iVBORw0KGgo=' }]);
  });
});
