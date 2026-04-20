import { cp, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const webDist = join(coreRoot, '..', 'web', 'dist');
const outDir = join(coreRoot, 'dist', 'web');

try {
  await stat(webDist);
} catch {
  console.error(
    `[textportico] Web UI build not found at ${webDist}. Run: pnpm --filter @textportico/web build`,
  );
  process.exit(1);
}

await cp(webDist, outDir, { recursive: true });
console.log(`[textportico] Copied web UI to ${outDir}`);
