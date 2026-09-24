import { spawn } from "node:child_process";

const serverPort = 4337;
const debugPort = 9237;
const baseUrl = `http://127.0.0.1:${serverPort}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const server = spawn("python3", ["-m", "http.server", String(serverPort), "--bind", "127.0.0.1", "--directory", "dist"], { stdio: "ignore" });
const chrome = spawn(chromePath, [
	"--headless=new",
	"--disable-gpu",
	"--no-first-run",
	"--no-default-browser-check",
	`--remote-debugging-port=${debugPort}`,
	"--user-data-dir=/private/tmp/portfolio-final-interaction-qa",
	"about:blank",
], { stdio: "ignore" });

async function waitFor(url) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try { if ((await fetch(url)).ok) return; } catch {}
		await sleep(250);
	}
	throw new Error(`No respondió: ${url}`);
}

function createClient(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	const pending = new Map();
	let id = 0;
	const ready = new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	socket.addEventListener("message", ({ data }) => {
		const message = JSON.parse(data);
		if (!message.id || !pending.has(message.id)) return;
		const operation = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) operation.reject(new Error(message.error.message));
		else operation.resolve(message.result);
	});
	return {
		ready,
		send(method, params = {}) {
			const callId = ++id;
			socket.send(JSON.stringify({ id: callId, method, params }));
			return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
		},
		close() { socket.close(); },
	};
}

async function openPage(route) {
	const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
	const target = await response.json();
	const client = createClient(target.webSocketDebuggerUrl);
	await client.ready;
	await client.send("Page.enable");
	await client.send("Runtime.enable");
	await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
	await client.send("Page.navigate", { url: `${baseUrl}${route}` });
	await sleep(1200);
	return { client, target };
}

async function evaluate(client, expression) {
	const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	return result.result.value;
}

const report = {};
try {
	await waitFor(`${baseUrl}/`);
	await waitFor(`http://127.0.0.1:${debugPort}/json/version`);

	const home = await openPage("/");
	report.home = await evaluate(home.client, `(async () => {
		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		const books = [];
		for (const name of ['arepamia', 'claravision', 'pandacha']) {
			const openButton = document.querySelector('[data-' + name + '-open]');
			const dialog = document.querySelector('[data-' + name + '-dialog]');
			openButton?.click();
			await wait(950);
			const before = dialog?.querySelector('[data-book-current]')?.textContent?.trim();
			dialog?.querySelector('[data-book-next]')?.click();
			await wait(850);
			const after = dialog?.querySelector('[data-book-current]')?.textContent?.trim();
			const image = dialog?.querySelector('[data-book-image]');
			dialog?.querySelector('[data-' + name + '-close]')?.click();
			await wait(50);
			books.push({ name, opened: Boolean(before), before, after, advanced: Number(after) === Number(before) + 1, imageLoaded: Boolean(image?.complete && image?.naturalWidth), closed: !dialog?.open });
		}

		const carousels = [];
		for (const carousel of document.querySelectorAll('[data-generative-carousel]')) {
			const before = carousel.querySelector('[data-generative-status]')?.textContent?.trim();
			carousel.querySelector('[data-generative-next]')?.click();
			await wait(950);
			const after = carousel.querySelector('[data-generative-status]')?.textContent?.trim();
			const cards = [...carousel.querySelectorAll('[data-generative-card]')];
			const center = cards.filter((card) => card.dataset.position === 'center');
			carousels.push({ changed: Boolean(before && after && before !== after), oneCenter: center.length === 1, centerControls: center[0]?.querySelector('video')?.controls === true, sideControlsDisabled: cards.filter((card) => card.dataset.position !== 'center').every((card) => card.querySelector('video')?.controls === false) });
		}

		const projectLinks = [...document.querySelectorAll('a[href^="/proyectos/"]')].map((link) => ({ href: link.getAttribute('href'), target: link.target, rel: link.rel }));
		return { books, carousels, projectLinks };
	})()`);
	home.client.close();
	await fetch(`http://127.0.0.1:${debugPort}/json/close/${home.target.id}`);

	const tailors = await openPage("/proyectos/tailors-shop/");
	report.tailors = await evaluate(tailors.client, `(async () => {
		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		const results = [];
		for (const tab of document.querySelectorAll('[data-phase-tab]')) {
			tab.click();
			await wait(40);
			const id = tab.dataset.phaseTab;
			results.push({ id, selected: tab.getAttribute('aria-selected') === 'true', panelVisible: document.querySelector('[data-phase-panel="' + id + '"]')?.hidden === false, hash: location.hash === '#' + id });
		}
		return results;
	})()`);
	tailors.client.close();
	await fetch(`http://127.0.0.1:${debugPort}/json/close/${tailors.target.id}`);
} finally {
	chrome.kill("SIGTERM");
	server.kill("SIGTERM");
}

const ok = report.home?.books.every((item) => item.opened && item.advanced && item.imageLoaded && item.closed)
	&& report.home?.carousels.length === 2
	&& report.home.carousels.every((item) => item.changed && item.oneCenter && item.centerControls && item.sideControlsDisabled)
	&& report.home?.projectLinks.length > 0
	&& report.home.projectLinks.every((link) => link.target === "_blank" && link.rel.includes("noreferrer"))
	&& report.tailors?.length === 5
	&& report.tailors.every((item) => item.selected && item.panelVisible && item.hash);

console.log(JSON.stringify({ ok, ...report }, null, 2));
if (!ok) process.exitCode = 1;
