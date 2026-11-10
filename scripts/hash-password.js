#!/usr/bin/env node
// Makes the OWNER_PASSWORD_HASH value. The password is read from stdin, so it never lands
// in shell history:
//   node scripts/hash-password.js | npx wrangler secret put OWNER_PASSWORD_HASH
// (type the password, press Enter, then Ctrl+D on macOS/Linux or Ctrl+Z Enter on Windows)
import { hashPassword } from '../src/auth.js';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, '');
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}
process.stdout.write(await hashPassword(password));
