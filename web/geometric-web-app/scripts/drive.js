#!/usr/bin/env node
/*
 * Minimal Chrome DevTools Protocol driver for UI checks (no dependencies;
 * needs Node 22+ for the global WebSocket).
 *
 *   node scripts/drive.js <steps.js> [outDir] [width] [height]
 *
 * steps.js is the body of an async function with these helpers in scope:
 *   open(pageOrUrl)  sleep(ms)  evaluate(expr)  click(selector)  key(key, opts)
 *   shot(fileName)   wheel(x, y, deltaY)  drag(x0, y0, x1, y1)  log(...)
 * Console errors and uncaught exceptions from the page are printed.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [stepsFile, outDir = '.', width = '1500', height = '950'] = process.argv.slice(2);
if (!stepsFile) { console.error('usage: node scripts/drive.js <steps.js> [outDir] [width] [height]'); process.exit(1); }

const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) { console.error('No Chrome/Edge found; set CHROME=/path/to/browser'); process.exit(1); }

const SRC = path.resolve(__dirname, '..', 'src');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const port = 9300 + Math.floor(Math.random() * 600);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-drive-'));
    const proc = spawn(browser, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
        '--allow-file-access-from-files', `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
    ], { stdio: 'ignore' });

    let target;
    for (let i = 0; i < 100 && !target; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
            target = list.find(t => t.type === 'page');
        } catch (e) { /* not up yet */ }
        if (!target) await sleep(100);
    }
    if (!target) { console.error('Could not connect to the browser'); proc.kill(); process.exit(1); }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let nextId = 1;
    const pending = new Map();
    const waiters = [];
    let errors = 0;
    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
            return;
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            errors++;
            const d = msg.params.exceptionDetails;
            console.log('PAGE EXCEPTION:', (d.exception && d.exception.description) || d.text);
        } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
            if (msg.params.type === 'error') errors++;
            console.log(`PAGE ${msg.params.type.toUpperCase()}:`, msg.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' '));
        }
        for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].method === msg.method) { waiters[i].resolve(msg.params); waiters.splice(i, 1); }
        }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });
    const waitFor = method => new Promise(resolve => waiters.push({ method, resolve }));

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: false });

    const helpers = {
        sleep,
        log: (...a) => console.log(...a),
        async open(page) {
            const url = /^[a-z]+:/.test(page) ? page : 'file:///' + path.join(SRC, page).replace(/\\/g, '/');
            const loaded = waitFor('Page.loadEventFired');
            await send('Page.navigate', { url });
            // same-document (hash-only) navigations never fire a load event
            await Promise.race([loaded, sleep(8000)]);
            await sleep(300);
        },
        async evaluate(expr) {
            const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
            return r.result.value;
        },
        async click(sel) {
            const ok = await helpers.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
            if (!ok) throw new Error(`click: no element ${sel}`);
            await sleep(50);
        },
        async key(key, opts = {}) {
            const base = { key, code: opts.code || (key.length === 1 ? `Key${key.toUpperCase()}` : key), modifiers: (opts.ctrl ? 2 : 0) | (opts.shift ? 8 : 0) };
            if (key.length === 1) base.text = key;
            await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
            await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
            await sleep(50);
        },
        async wheel(x, y, deltaY) {
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
            await sleep(50);
        },
        async drag(x0, y0, x1, y1) {
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
            for (let i = 1; i <= 8; i++) {
                await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, button: 'left', buttons: 1 });
            }
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
            await sleep(50);
        },
        async shot(name) {
            const r = await send('Page.captureScreenshot', { format: 'png' });
            const file = path.resolve(outDir, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
            console.log('shot', file);
        },
    };

    const body = fs.readFileSync(stepsFile, 'utf8');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let failed = false;
    try {
        await new AsyncFunction(...Object.keys(helpers), body)(...Object.values(helpers));
    } catch (e) {
        failed = true;
        console.log('STEP FAILED:', e.message);
    }
    ws.close();
    proc.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked */ }
    console.log(errors ? `${errors} page error(s)` : 'no page errors');
    process.exit(failed || errors ? 1 : 0);
})();
