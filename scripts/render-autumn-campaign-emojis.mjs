import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const directory = fileURLToPath(new URL('../assets/campaigns/emojis/', import.meta.url));
for (const subject of ['ticket', 'cup', 'spark', 'leaves']) {
  const name = `cenar_autumn_202610_${subject}`;
  const source = path.join(directory, `${name}.svg`);
  const output = path.join(directory, `${name}.png`);
  await sharp(await fs.readFile(source)).resize(128, 128).png({ compressionLevel: 9 }).toFile(output);
  const stat = await fs.stat(output);
  if (stat.size > 256 * 1024) throw new Error(`EMOJI_TOO_LARGE:${name}`);
  console.log(`${name}: ${stat.size} bytes`);
}
