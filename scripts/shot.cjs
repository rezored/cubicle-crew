// Визуален тест: headless Chrome -> PNG кадри + конзолни грешки + външни заявки.
// usage: node scripts/shot.cjs <url> <outPrefix> <width> <height> <dpr> <ms1,ms2,...> [evalJs] [preEvalJs]
// напр.: node scripts/shot.cjs "http://localhost:4317/?demo=showcase" out/a 1600 900 1 3000,8000
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const [url, out, W = '1280', H = '720', DPR = '1', times = '3000', evalJs, preEval] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(require('os').tmpdir(), 'po-chrome-prof-' + port);
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let target;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json`); const j = await r.json(); target = j.find((t) => t.type === 'page'); if (target) break; } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const logs = [], ext = [];
  ws.on('message', (m) => {
    const d = JSON.parse(m);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result || d.error); pend.delete(d.id); return; }
    if (d.method === 'Runtime.consoleAPICalled') logs.push(`[console.${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description).join(' '));
    if (d.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Log.entryAdded') logs.push(`[log.${d.params.entry.level}] ${d.params.entry.text} ${d.params.entry.url || ''}`);
    if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (!/^(https?|wss?):\/\/(localhost|127\.0\.0\.1)/.test(u) && !u.startsWith('data:') && !u.startsWith('about:')) ext.push(u); }
    if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) logs.push(`[http ${d.params.response.status}] ${d.params.response.url}`);
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: +DPR, mobile: false });
  await send('Page.navigate', { url });
  const t0 = Date.now();
  for (const [k, ms] of times.split(',').map(Number).entries()) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (preEval && k === 0) { await send('Runtime.evaluate', { expression: preEval }); await sleep(300); }
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${out}-${k}.png`, Buffer.from(r.data, 'base64'));
  }
  if (evalJs) { const r = await send('Runtime.evaluate', { expression: evalJs, returnByValue: true, awaitPromise: true }); console.log('EVAL:', JSON.stringify(r.result?.value ?? r)); }
  console.log('LOGS:', logs.length ? '\n' + logs.join('\n') : 'none');
  console.log('EXTERNAL REQUESTS:', ext.length ? ext.join(', ') : 'none');
  ws.close(); chrome.kill();
  setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
