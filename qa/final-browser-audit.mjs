import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const serverPort = 4336;
const debugPort = 9236;
const baseUrl = `http://127.0.0.1:${serverPort}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const routes = ["/", "/proyectos/", "/proyectos/tailors-shop/", "/proyectos/regioo/", "/proyectos/421-co/", "/sobre-mi/", "/404.html"];
const viewports = [
	["desktop", 1440, 1000],
	["tablet", 768, 1024],
	["mobile", 390, 844],
];

const server = spawn("python3", ["-m", "http.server", String(serverPort), "--bind", "127.0.0.1", "--directory", "dist"], { stdio: "ignore" });
const chrome = spawn(chromePath, [
	"--headless=new",
	"--disable-gpu",
	"--disable-background-networking",
	"--disable-component-update",
	"--disable-sync",
	"--no-first-run",
	"--no-default-browser-check",
	`--remote-debugging-port=${debugPort}`,
	"--user-data-dir=/private/tmp/portfolio-final-cdp-qa",
	"about:blank",
], { stdio: "ignore" });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(url) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {}
		await sleep(250);
	}
	throw new Error(`No respondió: ${url}`);
}

function createClient(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	const pending = new Map();
	const listeners = new Map();
	let id = 0;
	const ready = new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	socket.addEventListener("message", ({ data }) => {
		const message = JSON.parse(data);
		if (message.id && pending.has(message.id)) {
			const operation = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) operation.reject(new Error(message.error.message));
			else operation.resolve(message.result);
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
		on(method, listener) { listeners.set(method, [...(listeners.get(method) || []), listener]); },
		once(method) {
			return new Promise((resolve) => {
				const handler = (params) => {
					listeners.set(method, (listeners.get(method) || []).filter((item) => item !== handler));
					resolve(params);
				};
				listeners.set(method, [...(listeners.get(method) || []), handler]);
			});
		},
		close() { socket.close(); },
	};
}

const report = [];

async function auditPage(route, viewport, width, height) {
	const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
	const target = await response.json();
	const client = createClient(target.webSocketDebuggerUrl);
	await client.ready;
	const consoleErrors = [];
	const failedRequests = [];
	const badResponses = [];
	client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => consoleErrors.push(exceptionDetails.exception?.description || exceptionDetails.text || "Excepción de JavaScript"));
	client.on("Log.entryAdded", ({ entry }) => { if (entry.level === "error") consoleErrors.push(entry.text); });
	client.on("Network.loadingFailed", ({ requestId, errorText, canceled }) => { if (!canceled) failedRequests.push({ requestId, errorText }); });
	client.on("Network.responseReceived", ({ response: networkResponse }) => {
		if (networkResponse.url.startsWith(baseUrl) && networkResponse.status >= 400) badResponses.push({ url: networkResponse.url, status: networkResponse.status });
	});
	await client.send("Page.enable");
	await client.send("Runtime.enable");
	await client.send("Log.enable");
	await client.send("Network.enable");
	await client.send("Network.setCacheDisabled", { cacheDisabled: true });
	await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
	const loaded = client.once("Page.loadEventFired");
	await client.send("Page.navigate", { url: `${baseUrl}${route}` });
	await loaded;
	await sleep(500);
	await client.send("Runtime.evaluate", {
		expression: `(async () => { const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(420, innerHeight * .7)) { scrollTo(0, y); await wait(80); } scrollTo(0, 0); await wait(500); })()`,
		awaitPromise: true,
	});
	const result = await client.send("Runtime.evaluate", {
		expression: `(() => ({
			title: document.title,
			lang: document.documentElement.lang,
			description: document.querySelector('meta[name="description"]')?.content || '',
			horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			overflowElements: [...document.querySelectorAll('body *')].filter((element) => {
				const rect = element.getBoundingClientRect();
				return rect.right > document.documentElement.clientWidth + 2 || rect.left < -2;
			}).slice(0, 20).map((element) => {
				const rect = element.getBoundingClientRect();
				return { tag: element.tagName, className: element.className || '', left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
			}),
			brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
			brokenVideos: [...document.querySelectorAll('video')].filter((video) => video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE).map((video) => ({ src: video.currentSrc || video.src, error: video.error?.code || null })),
			emptyInternalLinks: [...document.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')).filter((href) => !href || href === '#'),
			iframes: [...document.querySelectorAll('iframe')].map((frame) => ({ src: frame.getAttribute('src'), loaded: Boolean(frame.contentWindow), sameOriginTitle: (() => { try { return frame.contentDocument?.title || ''; } catch { return 'cross-origin'; } })() })),
		}))()`,
		returnByValue: true,
	});
	const item = { route, viewport, ...result.result.value, consoleErrors, failedRequests, badResponses };
	report.push(item);
	client.close();
	await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
}

try {
	await waitFor(`${baseUrl}/`);
	await waitFor(`http://127.0.0.1:${debugPort}/json/version`);
	for (const [viewport, width, height] of viewports) {
		for (const route of routes) await auditPage(route, viewport, width, height);
	}
} finally {
	chrome.kill("SIGTERM");
	server.kill("SIGTERM");
}

await writeFile(path.resolve("qa/final-browser-report.json"), JSON.stringify(report, null, 2));
let hasIssues = false;
for (const item of report) {
	const issues = item.horizontalOverflow || item.brokenImages.length || item.brokenVideos.length || item.emptyInternalLinks.length || item.consoleErrors.length || item.badResponses.length;
	if (issues) hasIssues = true;
	console.log(`${issues ? "REVISAR" : "OK"} ${item.viewport} ${item.route} overflow=${item.horizontalOverflow} images=${item.brokenImages.length} videos=${item.brokenVideos.length} links=${item.emptyInternalLinks.length} console=${item.consoleErrors.length} http=${item.badResponses.length}`);
}
if (hasIssues) process.exitCode = 1;
