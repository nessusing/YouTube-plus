// WXT builds a RegExp from the entrypoint's absolute path without escaping it,
// so a project directory with regex metacharacters (our "yt++") crashes the
// build with "Nothing to repeat". Escape the path. Idempotent; runs on
// postinstall. Drop this once WXT escapes it upstream.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'node_modules/wxt/dist/internal/builders/vite/plugins/remove-entrypoint-main-function.mjs';
const bad = 'new RegExp(`^${absPath}$`)';
const good = 'new RegExp(`^${absPath.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`)';

const src = readFileSync(file, 'utf8');
if (src.includes(good)) process.exit(0);
if (!src.includes(bad)) {
  console.warn(`[patch-wxt] pattern not found in ${file}; WXT changed, check whether the patch is still needed`);
  process.exit(0);
}
writeFileSync(file, src.replace(bad, () => good));
console.log('[patch-wxt] escaped entrypoint path RegExp');
