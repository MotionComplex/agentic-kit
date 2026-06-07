import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

/**
 * Launch Chromium — plug-and-play. If the browser binary isn't installed yet
 * (fresh machine), download it automatically on first use, then retry. So a new
 * machine never needs a manual `playwright install` step; the tool self-provisions.
 *
 * Also retries transient launch failures (resource pressure / SIGSEGV).
 */
let triedInstall = false;

export async function launchChromium(attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chromium.launch();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || '');
      const browserMissing = /Executable doesn't exist|playwright install|browserType\.launch.*not found/i.test(msg);
      if (browserMissing && !triedInstall) {
        triedInstall = true;
        try {
          console.error('motion-trace: Chromium not found — installing it once (first run only)…');
          execSync('npx --yes playwright install chromium', { stdio: 'inherit' });
        } catch { /* fall through to retry/throw */ }
        continue; // retry immediately after install
      }
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}
