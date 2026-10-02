import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';

// Build-time only. The website already contains Lucide + React; no new runtime
// dependency is added to the bot. Pass a package.json with those dependencies.
const sourcePackage = path.resolve(process.argv[2] || '../cenar-website-ui-rebuild/package.json');
const dependency = createRequire(sourcePackage);
const React = dependency('react');
const { renderToStaticMarkup } = dependency('react-dom/server');
const lucide = dependency('lucide-react');
const directory = fileURLToPath(new URL('../assets/emojis/ui26/', import.meta.url));
await fs.mkdir(directory, { recursive:true });
for (const asset of CORE_UI_EMOJI_ASSETS) {
  const icon = lucide[asset.glyph];
  if (!icon) throw new Error(`MISSING_LUCIDE_GLYPH:${asset.glyph}`);
  const markup = renderToStaticMarkup(React.createElement(icon));
  const children = markup.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
  if (!children) throw new Error(`INVALID_LUCIDE_SVG:${asset.glyph}`);
  const positive = asset.key === 'check';
  const negative = asset.key === 'cross' || asset.key === 'stop';
  const caution = asset.key === 'alert';
  const background = positive ? '#123F36' : negative ? '#492832' : caution ? '#513726' : '#173E3D';
  const border = positive ? '#62C8A7' : negative ? '#E19891' : '#DDA66D';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="5" y="5" width="118" height="118" rx="30" fill="${background}" stroke="${border}" stroke-width="5"/><path d="M29 16h37" stroke="#FFF0DD" stroke-width="3" stroke-linecap="round" opacity=".35"/><g transform="translate(25 25) scale(3.25)" fill="none" stroke="#FFF0DD" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${children}</g></svg>`;
  await fs.writeFile(path.join(directory,`${asset.name}.svg`),svg);
  await sharp(Buffer.from(svg)).resize(128,128).png({compressionLevel:9}).toFile(path.join(directory,asset.fileName));
}
await fs.copyFile(dependency.resolve('lucide-react/LICENSE'), path.join(directory,'LICENSE-LUCIDE.txt'));
console.log(`Rendered ${CORE_UI_EMOJI_ASSETS.length} original Cenar badges with attributed Lucide glyphs.`);
