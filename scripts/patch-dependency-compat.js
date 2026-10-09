import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const extractorEntry = require.resolve('@discord-player/extractor');
const extractorDist = path.dirname(extractorEntry);
const extractorFiles = [extractorEntry, path.join(extractorDist, 'index.mjs')];

// @discord-player/extractor 7.2.0 still calls the pre-21 file-type API
// (`fromFile`). file-type 21.3.4 contains the ASF/ZIP parser fixes but renamed
// that API to `fileTypeFromFile`. Keep the extractor's attachment feature
// working while retaining the patched parser.
for (const filename of extractorFiles) {
  const source = await readFile(filename, 'utf8');
  const patched = source.replaceAll('fileType.fromFile(', 'fileType.fileTypeFromFile(');
  if (patched === source && !source.includes('fileType.fileTypeFromFile(')) {
    throw new Error(`Expected file-type call was not found in ${filename}`);
  }
  if (patched !== source) await writeFile(filename, patched);
}

