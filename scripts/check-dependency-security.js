import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const extractorEntry = require.resolve('@discord-player/extractor');
const extractorDist = path.dirname(extractorEntry);
const extractorSource = await readFile(extractorEntry, 'utf8');
const extractor = require('@discord-player/extractor');
const fileType = await import('file-type');

if (typeof extractor.AttachmentExtractor !== 'function') {
  throw new Error('AttachmentExtractor is not exported by @discord-player/extractor');
}
if (typeof fileType.fileTypeFromFile !== 'function') {
  throw new Error('Patched file-type API is unavailable');
}
if (!extractorSource.includes('fileType.fileTypeFromFile(')) {
  throw new Error(`Extractor compatibility patch is missing in ${extractorEntry}`);
}
const esmSource = await readFile(path.join(extractorDist, 'index.mjs'), 'utf8');
if (!esmSource.includes('fileType.fileTypeFromFile(')) {
  throw new Error('Extractor ESM compatibility patch is missing');
}

console.log('[deps] file-type patched API and Discord Player extractor verified');

