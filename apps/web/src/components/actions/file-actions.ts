'use client';

import { parseCsvPoints } from '@/lib/csv';
import { pickFile } from '@/lib/file-picker';
import { readImageFile } from '@/lib/image-upload';
import { useProjectStore } from '@/stores/project-store';

/** Lets the user choose a PNG/JPEG and embeds it in the image node `id`. */
export async function uploadImageToNode(id: string): Promise<void> {
  const file = await pickFile('image/png,image/jpeg');
  if (!file) return;
  try {
    useProjectStore.getState().applyImageUpload(id, await readImageFile(file));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'The image could not be read.');
  }
}

/** Lets the user choose a CSV/TSV file and replaces the data of plot `id` with its x,y rows. */
export async function importPlotCsv(id: string): Promise<void> {
  const file = await pickFile('.csv,.tsv,.txt,.dat,text/csv,text/plain');
  if (!file) return;
  const data = parseCsvPoints(await file.text());
  if (!data.length) {
    window.alert('No numeric x,y rows were found in this file.');
    return;
  }
  useProjectStore.getState().updateElement(id, { data }, 'Import plot data');
}
