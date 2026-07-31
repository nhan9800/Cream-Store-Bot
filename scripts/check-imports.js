import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

function getAllJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllJsFiles(filePath, fileList);
    } else if (file.endsWith('.js') && !file.includes('deploy-commands') && !file.includes('index.js') && !file.includes('bootstrap.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const jsFiles = getAllJsFiles(srcDir);
let hasError = false;

console.log(`Checking imports for ${jsFiles.length} files...`);

for (const file of jsFiles) {
  try {
    // dynamically import each module to see if it throws immediately
    // use a query param to bust cache just in case
    await import(`file://${file}?t=${Date.now()}`);
  } catch (err) {
    // Ignore DiscordToken missing errors since this is a smoke test without .env
    if (err.message && (err.message.includes('Token') || err.message.includes('token') || err.message.includes('Discord API'))) {
      continue;
    }
    // Better-sqlite3 will throw if DB path is invalid, but we mock or ignore it for imports
    console.error(`Import error in ${file}:`);
    console.error(err);
    hasError = true;
  }
}

if (hasError) {
  console.error('Import check failed!');
  process.exit(1);
} else {
  console.log('Import check passed!');
  process.exit(0);
}
