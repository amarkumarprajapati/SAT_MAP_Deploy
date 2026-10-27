// Isolated production-browser smoke test. No runtime dependency or user profile.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.PREVIEW_URL || 'http://127.0.0.1:3001';
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('This smoke test only accepts localhost previews.');
}
const profile = await mkdtemp(join(tmpdir(), 'ltmap-smoke-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const pending = new Map();
const errors = [];
const requests = [];
const requestUrls = new Map();
const network = new Map();
const warnings = [];
const checks = [];
const measurements = {};
const scenario = process.env.SMOKE_SCENARIO || 'startup';
let sequence = 0;
let buffer = '';
let session;
chrome.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task?.reject(new Error(JSON.stringify(message.error)));
      else task?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails);
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(value => value.description || value.value));
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') {
      warnings.push(message.params.args.map(value => value.description || value.value));
    } else if (message.method === 'Network.requestWillBeSent') {
      requestUrls.set(message.params.requestId, message.params.request.url);
      network.set(message.params.requestId, { url: message.params.request.url, state: 'pending' });
    } else if (message.method === 'Network.responseReceived') {
      const record = network.get(message.params.requestId);
      if (record) record.status = message.params.response.status;
    } else if (message.method === 'Network.loadingFinished') {
      const record = network.get(message.params.requestId);
      if (record) record.state = 'complete';
    } else if (message.method === 'Network.loadingFailed') {
      const record = network.get(message.params.requestId);
      if (record) record.state = 'failed';
      requests.push({ ...message.params, url: requestUrls.get(message.params.requestId) });
    } else if (message.method === 'Fetch.requestPaused') {
      // Deterministic visual-test locations, confined to the localhost geo API.
      const location = scenario === 'buildings' ? { lat: 40.7128, lon: -74.006 } : { lat: 46.02, lon: 7.75 };
      const satelliteFixture = {
        satellites: Array.from({ length: 200 }, (_, i) => ({ name: `RENDER TEST ${i}`, noradId: String(90000 + i),
          lat: -60 + (i % 20) * 6, lng: -170 + Math.floor(i / 20) * 34, alt: 550, color: '#38bdf8', category: 'comms', mission: 'Render test' })),
        timestamp: new Date().toISOString(), total: 200, category_counts: { comms: 200 },
      };
      const payload = new URL(message.params.request.url).pathname === '/api/satellites'
        ? satelliteFixture : { status: 'success', city: 'Visual test location', ...location };
      void command('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      }).catch(error => errors.push(String(error)));
    }
  }
});
function command(method, params = {}, sessionId = session) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId: sessionId ?? undefined })}\0`);
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function check(name, expression) {
  checks.push({ name, passed: Boolean(await evaluate(expression)) });
}
async function click(label) {
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => [b.getAttribute('aria-label'), b.getAttribute('title'), b.textContent.trim()].some(text => text?.toLowerCase() === ${JSON.stringify(label.toLowerCase())})); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)}); button.scrollIntoView({block: 'nearest'}); button.click(); })()`);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
  console.error('Browser test timed out');
  chrome.kill();
  process.exitCode = 1;
}, 100_000);
try {
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }));
  await command('Page.bringToFront');
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.enable');
  const system = await command('SystemInfo.getInfo', {}, null);
  measurements.graphics = { devices: system.gpu.devices, renderer: system.gpu.auxAttributes?.glRenderer, features: system.gpu.featureStatus };
  if (scenario === 'imagery') await command('Fetch.enable', { patterns: [{ urlPattern: `${new URL(url).origin}/api/geo*` }] });
  if (scenario === 'satellites') await command('Fetch.enable', { patterns: [{ urlPattern: `${new URL(url).origin}/api/satellites` }] });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `window.__previewLongTasks = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__previewLongTasks.push({start: Math.round(e.startTime), ms: Math.round(e.duration)}); }).observe({type: 'longtask', buffered: true});` });
  if (scenario === 'recovery') await command('Network.setBlockedURLs', { urls: [`${new URL(url).origin}/dark-matter-style.json*`] });
  await command('Emulation.setDeviceMetricsOverride', scenario === 'mobile'
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
    : { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url });
  if (process.env.PROBE_MAP_NETWORK) {
    const probe = await command('Runtime.evaluate', {
      expression: `Promise.all(['https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json','https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json','https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/2/2/1.mvt','https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/531/363.png'].map(async url => { try { const r = await fetch(url, {signal: AbortSignal.timeout(12000)}); return {url, status:r.status, bytes:(await r.arrayBuffer()).byteLength}; } catch(e) { return {url, error:String(e)}; } }))`,
      awaitPromise: true, returnByValue: true,
    });
    console.log('Network probe:', JSON.stringify(probe.result));
  }
  // Wait for asynchronous module workers, style loading and initial data layers.
  await new Promise(resolve => setTimeout(resolve, 25_000));
  const visual = await command('Page.captureScreenshot', { format: 'jpeg', quality: 75 });
  await writeFile(join(profile, 'visual.jpg'), Buffer.from(visual.data, 'base64'));
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(profile, 'preview.png'), Buffer.from(screenshot.data, 'base64'));
  checks.push({ name: 'No camera or renderer failures', passed: !warnings.some(w => /Projection switch failed|TypeError|Satellite picking unavailable|Map initialization failed/.test(JSON.stringify(w))) });
  measurements.mapNetwork = [...network.values()].filter(r => /cartocdn|maplibre|dark-matter-style/.test(r.url));
  measurements.visibility = await evaluate(`({hidden: document.hidden, state: document.visibilityState})`);
  const report = { scenario, checks, measurements, page: JSON.parse(result.result.value), errors, warnings, failedRequests: requests, screenshot: join(profile, 'preview.png') };
  await writeFile(join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ scenario, checks, measurements, errors, warnings, failedRequests: requests, report: join(profile, 'report.json'), screenshot: report.screenshot }, null, 2));
  process.exitCode = errors.length || checks.some(c => !c.passed) ? 1 : 0;
} finally {
  clearTimeout(deadline);
  await command('Browser.close', {}, undefined).catch(() => {});
  chrome.kill();
}    if (scenario === 'imagery') {
      await click('Satellite View'); await pause(8000);
      await check('Satellite basemap loads imagery tiles', `performance.getEntriesByType('resource').some(r => r.name.includes('World_Imagery'))`);
      measurements.longTasks = await evaluate('window.__previewLongTasks');
    }

