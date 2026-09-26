import { describe, expect, it } from 'vitest';
import { MAX_IMAGES, validateImageAttachments, validateLatexSource } from './security';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQ==';

const messages = (source: string) => validateLatexSource(source).map((error) => error.message);

describe('validateLatexSource', () => {
  it('allows \\includegraphics with a plain relative file name', () => {
    expect(messages(String.raw`\node {\includegraphics[width=2cm,height=1cm]{fig.png}};`)).toEqual(
      [],
    );
    expect(messages(String.raw`\includegraphics {example-image}`)).toEqual([]);
    expect(messages(String.raw`\includegraphics[width=1cm]{figs/sub/plot_1.jpg}`)).toEqual([]);
  });

  it('rejects other \\include commands and unsafe picture names', () => {
    expect(messages(String.raw`\include{chapter}`)).toEqual([
      'Compiler security policy rejects \\include.',
    ]);
    expect(messages(String.raw`\includeonly{x}`)).toHaveLength(1);
    for (const source of [
      String.raw`\includegraphics{/etc/passwd}`,
      String.raw`\includegraphics{../x.png}`,
      String.raw`\includegraphics{\x}`,
      String.raw`\includegraphics*{fig.png}`,
      String.raw`\includegraphics[width=\x]{a b.png}`,
      String.raw`\includegraphics`,
    ])
      expect(messages(source), source).toEqual([
        '\\includegraphics only accepts a plain relative file name.',
      ]);
  });

  it('still rejects file and shell primitives', () => {
    expect(messages(String.raw`\input{x}`)).toHaveLength(1);
    expect(messages(String.raw`\immediate\write18{ls}`).length).toBeGreaterThan(0);
  });
});

describe('validateImageAttachments', () => {
  it('accepts PNG and JPEG files with plain names', () => {
    const images = [
      { name: 'fig.png', data: PNG },
      { name: 'figs/photo.jpeg', data: JPEG },
    ];
    expect(validateImageAttachments(images)).toEqual({ images, errors: [] });
    expect(validateImageAttachments(undefined)).toEqual({ images: [], errors: [] });
  });

  it('rejects bad names, content, encodings and counts', () => {
    const reject = (value: unknown) =>
      validateImageAttachments(value).errors.map((error) => error.message);
    expect(reject('fig.png')).toHaveLength(1);
    expect(reject([{ name: '../fig.png', data: PNG }])[0]).toContain('plain relative name');
    expect(reject([{ name: 'fig.gif', data: PNG }])[0]).toContain('plain relative name');
    expect(reject([{ name: 'fig.jpg', data: PNG }])[0]).toContain('not a JPEG file');
    expect(reject([{ name: 'fig.png', data: 'not base64!' }])[0]).toContain('not valid base64');
    expect(
      reject([
        { name: 'a.png', data: PNG },
        { name: 'a.png', data: PNG },
      ])[0],
    ).toContain('attached twice');
    expect(
      reject([
        { name: 'a.png', data: PNG },
        { name: 'a.png/b.png', data: PNG },
      ])[0],
    ).toContain("another image's folder");
    const many = Array.from({ length: MAX_IMAGES + 1 }, (_, index) => ({
      name: `f${index}.png`,
      data: PNG,
    }));
    expect(reject(many)[0]).toContain(`At most ${MAX_IMAGES}`);
  });
});
