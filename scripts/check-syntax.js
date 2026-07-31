import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

function getAllJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllJsFiles(filePath, fileList);
    } else if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.mjs')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const jsFiles = getAllJsFiles(srcDir);
let hasError = false;

console.log(`Checking syntax for ${jsFiles.length} files...`);

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`Syntax error in ${file}:`);
    console.error(result.stderr);
    hasError = true;
  }
}

if (hasError) {
  console.error('Syntax check failed!');
  process.exit(1);
} else {
  console.log('Syntax check passed!');
}
