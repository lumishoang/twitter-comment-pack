import { loadConfig } from './config.mjs';
import { checkCookieHealth } from './lib/cookie-health.mjs';

const cfg = loadConfig();
const result = await checkCookieHealth(cfg.cookiesFile);
if (result.ok) {
  console.log(`[cookie:check] OK - ${result.detail}`);
  process.exit(0);
}
console.error(`[cookie:check] FAIL ${result.code} - ${result.detail}`);
process.exit(1);
