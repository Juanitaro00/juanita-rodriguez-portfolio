import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4210';
const outputDir = path.resolve('qa/screenshots');
const routes = [
  ['inicio', 'index.html'],
  ['productos', 'productos.html'],
  ['producto', 'Producto.html'],
  ['contacto', 'contacto_.html'],
  ['login', 'iniciar-sesion.html'],
  ['registro', 'registrarse.html']
];
const viewports = [
  ['desktop', 1440, 1000],
  ['laptop', 1024, 900],
  ['tablet', 768, 1024],
  ['small-tablet', 744, 1024],
  ['mobile', 390, 844]
];

await mkdir(outputDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--remote-debugging-port=9223',
  '--user-data-dir=/private/tmp/421-cdp-qa',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForChrome() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9223/json/version');
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome DevTools no respondió a tiempo.');
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

try {
  await waitForChrome();
  for (const [routeName, route] of routes) {
    for (const [viewportName, width, height] of viewports) {
      const targetResponse = await fetch(`http://127.0.0.1:9223/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
      const target = await targetResponse.json();
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
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width <= 744
      });
      const loaded = client.once('Page.loadEventFired');
      await client.send('Page.navigate', { url: `${baseUrl}/${route}?qa=${Date.now()}` });
      await loaded;
      await sleep(900);
      const interactionEvaluation = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const checks = {};
          if (${width} <= 1100) {
            const toggle = document.querySelector('.menu-toggle');
            toggle?.click();
            checks.mobileMenuOpens = document.querySelector('.respmenu')?.classList.contains('is-open') === true;
            toggle?.click();
          }
          const route = ${JSON.stringify(routeName)};
          if (route === 'productos') {
            const input = document.querySelector('.busqueda-input');
            input.value = 'taza';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const cards = [...document.querySelectorAll('.cafegrid, .merchgrid2, .merchgrid2-partedos')];
            checks.searchFilters = cards.filter(card => !card.hidden).length === 1;
          }
          if (route === 'producto') {
            localStorage.removeItem('421-cart');
            document.querySelector('[data-quantity="increase"]')?.click();
            document.querySelector('[data-add-cart]')?.click();
            document.querySelector('.cart-toggle')?.click();
            checks.quantityChanges = document.querySelector('[data-quantity-value]')?.textContent === '2';
            checks.cartAddsProduct = document.querySelector('.cart-items')?.textContent.includes('CoRAJE') === true;
            checks.cartOpens = document.querySelector('.cart-panel')?.classList.contains('is-open') === true;
          }
          if (route === 'contacto') {
            document.querySelector('#email').value = 'qa@example.com';
            document.querySelector('.formulario-contacto form').requestSubmit();
            checks.contactValidates = document.querySelector('.form-status')?.textContent.includes('Mensaje preparado') === true;
          }
          if (route === 'login') {
            document.querySelector('#usuario').value = 'qa';
            document.querySelector('#contrasena').value = 'segura';
            document.querySelector('.boton-iniciar').click();
            checks.loginResponds = document.querySelector('.form-status')?.textContent.includes('Sesión local iniciada') === true;
          }
          if (route === 'registro') {
            document.querySelector('#nombreCompleto').value = 'QA';
            document.querySelector('#email').value = 'qa@example.com';
            document.querySelector('#contrasena').value = 'segura';
            document.querySelector('#confirmarContrasena').value = 'segura';
            document.querySelector('.boton-registrar').click();
            checks.registrationResponds = document.querySelector('.form-status')?.textContent.includes('Registro local completado') === true;
          }
          return checks;
        })()`,
        returnByValue: true
      });
      const evaluation = await client.send('Runtime.evaluate', {
        expression: `(() => ({
          title: document.title,
          url: location.href,
          viewportWidth: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          overflowingElements: [...document.querySelectorAll('body *')].filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.right > innerWidth + 1 || rect.left < -1;
          }).slice(0, 12).map(element => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right)
          })),
          brokenImages: [...document.images].filter(img => !img.complete || img.naturalWidth === 0).map(img => img.getAttribute('src')),
          emptyLinks: [...document.querySelectorAll('a')].filter(a => !a.getAttribute('href')).map(a => a.textContent.trim()),
          menuVisible: Boolean(document.querySelector('.menu-toggle')),
          cartVisible: Boolean(document.querySelector('.cart-toggle'))
        }))()`,
        returnByValue: true
      });
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const file = path.join(outputDir, `${routeName}-${viewportName}.png`);
      await writeFile(file, Buffer.from(screenshot.data, 'base64'));
      report.push({ route: routeName, viewport: viewportName, ...evaluation.result.value, interactionChecks: interactionEvaluation.result.value, consoleErrors: errors, screenshot: file });
      client.close();
      await fetch(`http://127.0.0.1:9223/json/close/${target.id}`);
    }
  }
} finally {
  chrome.kill('SIGTERM');
}

await writeFile(path.resolve('qa/report.json'), JSON.stringify(report, null, 2));
for (const item of report) {
  const interactionFailures = Object.values(item.interactionChecks).filter(value => value !== true).length;
  const status = item.horizontalOverflow || item.brokenImages.length || item.emptyLinks.length || item.consoleErrors.length || interactionFailures ? 'REVISAR' : 'OK';
  console.log(`${status} ${item.route}/${item.viewport} overflow=${item.horizontalOverflow} images=${item.brokenImages.length} links=${item.emptyLinks.length} console=${item.consoleErrors.length} interactions=${interactionFailures}`);
}
