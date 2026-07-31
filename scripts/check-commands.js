import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(__dirname, '../src/commands');

async function validateCommands() {
  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
  const commandNames = new Set();
  let hasError = false;

  for (const file of files) {
    const filePath = path.join(commandsDir, file);
    try {
      const module = await import(`file://${filePath}`);
      const command = module.default || module.command || module;

      if (!command) {
        console.error(`❌ [check:commands] Lỗi: ${file} không export command.`);
        hasError = true;
        continue;
      }

      if (!command.data || !command.data.name) {
        console.error(`❌ [check:commands] Lỗi: ${file} thiếu command.data.name.`);
        hasError = true;
        continue;
      }

      if (commandNames.has(command.data.name)) {
        console.error(`❌ [check:commands] Lỗi: Trùng lặp command name '${command.data.name}' ở file ${file}.`);
        hasError = true;
        continue;
      }

      if (typeof command.execute !== 'function') {
        console.error(`❌ [check:commands] Lỗi: ${file} thiếu hàm execute().`);
        hasError = true;
        continue;
      }

      commandNames.add(command.data.name);
    } catch (err) {
      console.error(`❌ [check:commands] Lỗi parse ${file}:`, err.message);
      hasError = true;
    }
  }

  if (hasError) {
    console.error('Command registry validation failed!');
    process.exit(1);
  } else {
    console.log(`✅ Đã kiểm tra ${files.length} commands hợp lệ.`);
    process.exit(0);
  }
}

validateCommands();
