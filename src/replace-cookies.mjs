import fs from 'fs';
import path from 'path';
import { validateCookieFile, checkCookieHealth } from './lib/cookie-health.mjs';

const [,, incomingPath] = process.argv;
if (!incomingPath) {
  console.error('Usage: npm run cookie:replace -- <path-to-new-cookies.json>');
  process.exit(2);
}

const targetPath = path.resolve('data/cookies.json');
const sourcePath = path.resolve(incomingPath);
const backupDir = path.resolve('data/backups');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

(async () => {
  const valid = validateCookieFile(sourcePath);
  if (!valid.ok) {
    console.error(`[cookie:replace] source invalid: ${valid.code} - ${valid.detail}`);
    process.exit(1);
  }

  ensureDir(path.dirname(targetPath));
  ensureDir(backupDir);

  if (fs.existsSync(targetPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(targetPath, path.join(backupDir, `cookies-${stamp}.json`));
  }

  const tempTarget = `${targetPath}.tmp`;
  fs.copyFileSync(sourcePath, tempTarget);

  const health = await checkCookieHealth(tempTarget);
  if (!health.ok) {
    fs.unlinkSync(tempTarget);
    console.error(`[cookie:replace] health failed: ${health.code} - ${health.detail}`);
    process.exit(1);
  }

  fs.renameSync(tempTarget, targetPath);
  console.log('[cookie:replace] success: data/cookies.json updated and health-check passed.');
})();
