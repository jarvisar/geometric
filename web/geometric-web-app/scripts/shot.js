#!/usr/bin/env node
/*
 * Screenshot a page of the app with headless Chrome/Edge.
 *
 *   node scripts/shot.js <page> <query> <out.png> [width] [height]
 *   node scripts/shot.js dev/sheet.html "gens=truchet&variants=3" shots/truchet.png
 *   node scripts/shot.js index.html "" shots/app.png 1500 950
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [page = 'dev/sheet.html', query = '', out = 'shot.png', width = '1400', height = '1000'] = process.argv.slice(2);

const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) { console.error('No Chrome/Edge found; set CHROME=/path/to/browser'); process.exit(1); }

const file = path.resolve(__dirname, '..', 'src', page);
const url = 'file:///' + file.replace(/\\/g, '/') + (query ? (query.startsWith('#') ? query : '?' + query) : '');
const outPath = path.resolve(out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

// A unique profile per run so parallel screenshots don't hand off to each other.
const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pg-shot-'));
try {
    execFileSync(browser, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--allow-file-access-from-files', '--force-device-scale-factor=1',
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`, '--virtual-time-budget=30000',
        `--screenshot=${outPath}`, url,
    ], { stdio: 'ignore', timeout: 120000 });
} finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* profile still locked */ }
}
console.log(outPath);
