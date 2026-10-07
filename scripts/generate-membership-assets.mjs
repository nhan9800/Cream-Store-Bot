import fs from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { MEMBER_ROLES } from '../src/config/membershipProgram.js';
import { roleColorsFor } from '../src/config/roleColors.js';

// Original vector badges; no remote asset host or extra runtime dependency.
const glyphs={
  ruby:'<path d="M25 60 22 37 37 46 48 26 59 46 74 37 71 60Z"/><path d="M28 68h40"/><circle cx="48" cy="49" r="4"/>',
  diamond:'<path d="m48 23 25 20-25 30-25-30Z"/><path d="M23 43h50M36 32l12 41 12-41M36 32h24"/>',
  elite:'<path d="M48 22c3 17 10 22 25 26-15 4-22 9-25 26-3-17-10-22-25-26 15-4 22-9 25-26Z"/><circle cx="48" cy="48" r="6"/>',
  vip:'<path d="m48 25 7 15 17 2-13 12 4 17-15-9-15 9 4-17-13-12 17-2Z"/>',
  active:'<path d="M30 38h36l5 32H25Z"/><path d="M38 40v-8a10 10 0 0 1 20 0v8"/><path d="m40 54 6 6 11-12"/>',
  explorer:'<circle cx="48" cy="48" r="25"/><path d="m58 37-7 14-14 7 7-14Z"/><path d="M48 18v8M48 70v8M18 48h8M70 48h8"/>',
};
const root=new URL('../assets/roles/',import.meta.url);
await fs.mkdir(root,{recursive:true});
for(const tier of MEMBER_ROLES){
  const color=roleColorsFor(tier.id);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${color.primaryColor}"/><stop offset="1" stop-color="${color.secondaryColor}"/></linearGradient></defs><circle cx="48" cy="48" r="44" fill="#171525"/><circle cx="48" cy="48" r="41" fill="none" stroke="url(#g)" stroke-width="3"/><g fill="none" stroke="url(#g)" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round">${glyphs[tier.key]}</g><circle cx="75" cy="21" r="3" fill="${color.primaryColor}"/></svg>`;
  await sharp(Buffer.from(svg)).resize(128,128).png({palette:true,effort:10}).toFile(fileURLToPath(new URL(`member26_${tier.key}.png`,root)));
}
console.log(`Generated ${MEMBER_ROLES.length} original membership badges.`);
