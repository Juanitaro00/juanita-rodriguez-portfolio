import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4332';
const outputDir = path.resolve('qa/screenshots/portfolio-421');
const viewports = [
  ['desktop', 1440, 1000],
  ['tablet', 768, 1024],
  ['mobile', 390, 844]
];

await mkdir(outputDir, { recursive: true });

const staticServer = spawn('python3', ['-m', 'http.server', '4334', '--bind', '127.0.0.1', '--directory', 'dist'], {
  stdio: ['ignore', 'ignore', 'pipe']
});

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--remote-debugging-port=9229',
  '--user-data-dir=/private/tmp/portfolio-421-cdp-qa',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForChrome() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9229/json/version');
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome DevTools no respondió a tiempo.');
}

async function waitForSite() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/proyectos/421-co/`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('El servidor local no respondió a tiempo.');
}

function createClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params);
  });
  return {
    ready,
    send(method, params = {}) {
      const callId = ++id;
      socket.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
    },
    once(method) {
      return new Promise((resolve) => {
        const handler = (params) => {
          listeners.set(method, (listeners.get(method) || []).filter((item) => item !== handler));
          resolve(params);
        };
        listeners.set(method, [...(listeners.get(method) || []), handler]);
      });
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) || []), listener]);
    },
    close() { socket.close(); }
  };
}

const report = [];

async function openPage(name, route, viewportName, width, height) {
  const response = await fetch(`http://127.0.0.1:9229/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await response.json();
  const client = createClient(target.webSocketDebuggerUrl);
  await client.ready;
  const errors = [];
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.text || 'Excepción de JavaScript'));
  client.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') errors.push(entry.text);
  });
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: `${baseUrl}${route}?qa=${Date.now()}` });
  await loaded;
  await sleep(1000);
  await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(500, innerHeight * .75)) {
        scrollTo(0, y);
        await wait(90);
      }
      const target = ${JSON.stringify(name)} === 'home' ? document.querySelector('#proyecto-421-co') : null;
      if (target) target.scrollIntoView({ block: 'start' }); else scrollTo(0, 0);
      await wait(1200);
    })()`,
    awaitPromise: true
  });

  const evaluation = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const iframe = document.querySelector('.c421-browser iframe');
      const iframeDocument = iframe?.contentDocument;
      return {
        title: document.title,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        brokenImages: [...document.images].filter((img) => {
          const style = getComputedStyle(img);
          const isVisibleVariant = style.display !== 'none' && style.visibility !== 'hidden';
          return isVisibleVariant && (!img.complete || img.naturalWidth === 0);
        }).map((img) => img.src),
        projectCardPresent: Boolean(document.querySelector('#proyecto-421-co')),
        projectLink: document.querySelector('#proyecto-421-co a[href*="421-co"]')?.getAttribute('href') || null,
        iframePresent: Boolean(iframe),
        iframePath: iframe?.contentWindow?.location?.pathname || null,
        iframeBrokenImages: iframeDocument ? [...iframeDocument.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src) : [],
        iframeOverflow: iframeDocument ? iframeDocument.documentElement.scrollWidth > iframeDocument.documentElement.clientWidth + 1 : false
      };
    })()`,
    returnByValue: true
  });

  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outputDir, `${name}-${viewportName}.png`);
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  if (name === 'project') {
    for (const [detailName, selector] of [['browser', '.c421-live'], ['result', '.c421-result']]) {
      await client.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'start' })` });
      await sleep(900);
      const detailScreenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(path.join(outputDir, `${detailName}-${viewportName}.png`), Buffer.from(detailScreenshot.data, 'base64'));
    }
  }
  report.push({ name, viewport: viewportName, ...evaluation.result.value, consoleErrors: errors, screenshot: file });
  client.close();
  await fetch(`http://127.0.0.1:9229/json/close/${target.id}`);
}

try {
  await waitForSite();
  await waitForChrome();
  for (const [viewportName, width, height] of viewports) {
    await openPage('home', '/', viewportName, width, height);
    await openPage('project', '/proyectos/421-co/', viewportName, width, height);
  }

  const response = await fetch(`http://127.0.0.1:9229/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await response.json();
  const client = createClient(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: `${baseUrl}/proyectos/421-co/` });
  await loaded;
  await sleep(1200);
  const navigation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const iframe = document.querySelector('.c421-browser iframe');
      if (!iframe) return [{ route: 'inicio', error: 'iframe no encontrado', brokenImages: 1 }];
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const results = [];
      for (const route of ['productos.html', 'Producto.html', 'contacto_.html', 'iniciar-sesion.html', 'registrarse.html']) {
        iframe.contentWindow.location.href = '/projects/421-co/' + route;
        await wait(650);
        results.push({
          route,
          path: iframe.contentWindow.location.pathname,
          title: iframe.contentDocument.title,
          brokenImages: [...iframe.contentDocument.images].filter((img) => !img.complete || img.naturalWidth === 0).length
        });
      }
      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  report.push({ name: 'iframe-navigation', routes: navigation.result.value });
  client.close();
  await fetch(`http://127.0.0.1:9229/json/close/${target.id}`);
} finally {
  chrome.kill('SIGTERM');
  staticServer.kill('SIGTERM');
}

await writeFile(path.resolve('qa/portfolio-421-report.json'), JSON.stringify(report, null, 2));
for (const item of report) {
  if (item.name === 'iframe-navigation') {
    for (const route of item.routes) console.log(`${route.brokenImages ? 'REVISAR' : 'OK'} iframe/${route.route} path=${route.path} images=${route.brokenImages}`);
    continue;
  }
  const hasIssues = item.horizontalOverflow || item.brokenImages.length || item.iframeBrokenImages.length || item.iframeOverflow || item.consoleErrors.length;
  console.log(`${hasIssues ? 'REVISAR' : 'OK'} ${item.name}/${item.viewport} overflow=${item.horizontalOverflow} images=${item.brokenImages.length} iframe=${item.iframePresent} iframeOverflow=${item.iframeOverflow} console=${item.consoleErrors.length}`);
}
