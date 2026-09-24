import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const files = [];

function walk(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) walk(fullPath);
		else files.push(fullPath);
	}
}

walk(root);

const htmlFiles = files.filter((file) => file.endsWith(".html"));
const textFiles = files.filter((file) => /\.(?:html|css|js|svg)$/i.test(file));
const missing = [];
const brokenFragments = [];
const duplicateIds = [];
const externalReferences = new Set();

function pageFileFor(targetPath) {
	const cleanPath = targetPath.replace(/^\/+/, "");
	const direct = path.join(root, cleanPath);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
	if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
		const index = path.join(direct, "index.html");
		if (fs.existsSync(index)) return index;
	}
	if (!path.extname(direct)) {
		const index = path.join(direct, "index.html");
		if (fs.existsSync(index)) return index;
	}
	return direct;
}

function resolveReference(sourceFile, rawReference) {
	const reference = rawReference.trim().replace(/&amp;/g, "&");
	if (!reference || reference.includes("${") || reference.startsWith("data:") || reference.startsWith("blob:") || reference.startsWith("mailto:") || reference.startsWith("tel:") || reference.startsWith("javascript:")) return null;
	if (/^(?:https?:)?\/\//i.test(reference)) {
		externalReferences.add(reference);
		return null;
	}

	const [pathnamePart, fragment = ""] = reference.split("#", 2);
	const pathname = decodeURIComponent(pathnamePart.split("?")[0]);
	let targetFile;
	if (!pathname) targetFile = sourceFile;
	else if (pathname.startsWith("/")) targetFile = pageFileFor(pathname);
	else {
		const candidate = path.resolve(path.dirname(sourceFile), pathname);
		targetFile = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
			? path.join(candidate, "index.html")
			: !path.extname(candidate) && fs.existsSync(path.join(candidate, "index.html"))
				? path.join(candidate, "index.html")
				: candidate;
	}
	return { targetFile, fragment, reference };
}

for (const file of htmlFiles) {
	const source = fs.readFileSync(file, "utf8");
	const ids = [...source.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
	for (const id of new Set(ids)) {
		if (ids.filter((value) => value === id).length > 1) duplicateIds.push({ file, id });
	}

	const references = [];
	for (const match of source.matchAll(/\s(?:href|src|poster|action)=["']([^"']+)["']/g)) references.push(match[1]);
	for (const match of source.matchAll(/\ssrcset=["']([^"']+)["']/g)) {
		for (const candidate of match[1].split(",")) references.push(candidate.trim().split(/\s+/)[0]);
	}

	for (const rawReference of references) {
		const resolved = resolveReference(file, rawReference);
		if (!resolved) continue;
		if (!fs.existsSync(resolved.targetFile)) {
			missing.push({ source: file, reference: resolved.reference, target: resolved.targetFile });
			continue;
		}
		if (resolved.fragment && resolved.targetFile.endsWith(".html")) {
			const targetSource = fs.readFileSync(resolved.targetFile, "utf8");
			const escaped = resolved.fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			if (!new RegExp(`\\sid=["']${escaped}["']`).test(targetSource)) brokenFragments.push({ source: file, reference: resolved.reference });
		}
	}
}

for (const file of textFiles) {
	const source = fs.readFileSync(file, "utf8");
	for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
		const resolved = resolveReference(file, match[1]);
		if (resolved && !fs.existsSync(resolved.targetFile)) missing.push({ source: file, reference: resolved.reference, target: resolved.targetFile });
	}
}

const relative = (file) => path.relative(root, file);
console.log(JSON.stringify({
	htmlPages: htmlFiles.length,
	totalFiles: files.length,
	missing: missing.map((item) => ({ ...item, source: relative(item.source), target: relative(item.target) })),
	brokenFragments: brokenFragments.map((item) => ({ ...item, source: relative(item.source) })),
	duplicateIds: duplicateIds.map((item) => ({ ...item, file: relative(item.file) })),
	externalReferences: [...externalReferences].sort(),
}, null, 2));

if (missing.length || brokenFragments.length || duplicateIds.length) process.exitCode = 1;
