// Dependency-free Chrome Web Store packaging.
// Usage:
//   node scripts/build.js          build dist/unpacked and dist/intermission-<version>.zip
//   node scripts/build.js --check  validate only, write nothing

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "unpacked");
const CHECK_ONLY = process.argv.includes("--check");

const RUNTIME_FILES = [
  "manifest.json",
  "background.js",
  "storage.js",
  "interceptor.js",
  "interceptor.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "content/en.json",
  "content/bn.json",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

const ICON_SIZES = {
  "icons/icon16.png": 16,
  "icons/icon32.png": 32,
  "icons/icon48.png": 48,
  "icons/icon128.png": 128
};

function fail(message) {
  console.error(`BUILD FAILED: ${message}`);
  process.exit(1);
}

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    fail(`missing runtime file: ${rel}`);
  }
  return fs.readFileSync(abs);
}

function readJson(rel) {
  try {
    return JSON.parse(read(rel).toString("utf8"));
  } catch (error) {
    fail(`${rel} is not valid JSON: ${error.message}`);
  }
}

function pngSize(buffer, rel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    fail(`${rel} is not a PNG`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function flattenKeys(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenKeys(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      flattenKeys(item, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [prefix];
}

function sameKeys(first, second) {
  const a = new Set(flattenKeys(first));
  const b = new Set(flattenKeys(second));
  const missingInSecond = [...a].filter((key) => !b.has(key));
  const missingInFirst = [...b].filter((key) => !a.has(key));
  return { missingInSecond, missingInFirst };
}

function scanText(rel, text) {
  const checks = [
    { name: "remote script", pattern: /<script[^>]+src\s*=\s*["']https?:\/\//i },
    { name: "remote stylesheet", pattern: /<link[^>]+href\s*=\s*["']https?:\/\//i },
    { name: "remote importScripts", pattern: /importScripts\s*\(\s*["']https?:\/\//i },
    { name: "remote fetch", pattern: /fetch\s*\(\s*["']https?:\/\//i },
    { name: "remote CSS import", pattern: /@import\s+(?:url\()?\s*["']?https?:\/\//i },
    { name: "absolute Windows path", pattern: /[A-Za-z]:\\(?:[^\\\s"'`<>]+\\)*[^\\\s"'`<>]*/ },
    { name: "absolute Windows path", pattern: /[A-Za-z]:\/(?:Users|home|Documents|Desktop|Projects|src|dev|tmp|work)\// },
    { name: "absolute Unix home path", pattern: /["'`]\/(?:Users|home)\// }
  ];
  for (const check of checks) {
    const match = text.match(check.pattern);
    if (match) fail(`${rel} contains a ${check.name}: ${match[0].slice(0, 120)}`);
  }
}

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const en = readJson("content/en.json");
const bn = readJson("content/bn.json");

if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (manifest.name !== "Intermission") fail(`unexpected manifest name: ${manifest.name}`);
if (manifest.version !== pkg.version) {
  fail(`manifest version ${manifest.version} does not match package.json ${pkg.version}`);
}
if (!Array.isArray(manifest.permissions)
  || manifest.permissions.slice().sort().join(",") !== "scripting,storage") {
  fail(`unexpected permissions: ${JSON.stringify(manifest.permissions)}`);
}
if (!Array.isArray(manifest.optional_host_permissions)
  || manifest.optional_host_permissions.slice().sort().join(",") !== "http://*/*,https://*/*") {
  fail(`unexpected optional_host_permissions: ${JSON.stringify(manifest.optional_host_permissions)}`);
}
if (manifest.host_permissions) fail("host_permissions must not be required at install time");

const keys = sameKeys(en, bn);
if (keys.missingInSecond.length || keys.missingInFirst.length) {
  fail(`content banks differ; missing in bn: ${keys.missingInSecond.join(", ") || "none"}; missing in en: ${keys.missingInFirst.join(", ") || "none"}`);
}

const referenced = new Set();
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
for (const item of manifest.background?.scripts || []) referenced.add(item);
for (const item of Object.values(manifest.icons || {})) referenced.add(item);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
for (const item of Object.values(manifest.action?.default_icon || {})) referenced.add(item);
if (manifest.options_page) referenced.add(manifest.options_page);
if (manifest.options_ui?.page) referenced.add(manifest.options_ui.page);
for (const script of manifest.content_scripts || []) {
  for (const item of script.js || []) referenced.add(item);
  for (const item of script.css || []) referenced.add(item);
}
for (const resource of manifest.web_accessible_resources || []) {
  for (const item of resource.resources || []) referenced.add(item);
}
for (const rel of referenced) {
  if (!RUNTIME_FILES.includes(rel)) fail(`manifest references a file outside the allowlist: ${rel}`);
}

const files = RUNTIME_FILES.map((rel) => ({ rel, data: read(rel) }));
for (const file of files) {
  if (file.rel.endsWith(".json")) {
    try {
      JSON.parse(file.data.toString("utf8"));
    } catch (error) {
      fail(`${file.rel} is not valid JSON: ${error.message}`);
    }
  }
  if (file.rel.endsWith(".js") || file.rel.endsWith(".html") || file.rel.endsWith(".css")) {
    scanText(file.rel, file.data.toString("utf8"));
  }
  if (ICON_SIZES[file.rel]) {
    const size = pngSize(file.data, file.rel);
    if (size.width !== ICON_SIZES[file.rel] || size.height !== ICON_SIZES[file.rel]) {
      fail(`${file.rel} is ${size.width}x${size.height}, expected ${ICON_SIZES[file.rel]}x${ICON_SIZES[file.rel]}`);
    }
  }
}

const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
if (!changelog.includes(manifest.version)) fail(`CHANGELOG.md does not mention ${manifest.version}`);

console.log(`Validated ${files.length} runtime files for Intermission ${manifest.version}.`);
if (CHECK_ONLY) {
  console.log("Check only: no files written.");
  process.exit(0);
}

// Minimal deterministic ZIP writer (stored entries, fixed timestamp).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 0x21; // 1980-01-01

  for (const entry of entries) {
    const name = Buffer.from(entry.rel.replaceAll("\\", "/"), "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function verifyZip(zip, entries) {
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) fail("ZIP end record missing");
  const count = zip.readUInt16LE(endOffset + 10);
  if (count !== entries.length) fail(`ZIP has ${count} entries, expected ${entries.length}`);
  let offset = zip.readUInt32LE(endOffset + 16);
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) fail("ZIP central directory is corrupt");
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const expected = entries.find((entry) => entry.rel.replaceAll("\\", "/") === name);
    if (!expected) fail(`unexpected ZIP entry: ${name}`);
    if (method !== 0) fail(`ZIP entry is compressed: ${name}`);
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) fail(`ZIP local header is corrupt: ${name}`);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + size);
    if (data.length !== expected.data.length) fail(`ZIP data length mismatch: ${name}`);
    if (crc32(data) !== crc) fail(`ZIP CRC mismatch: ${name}`);
    seen.add(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (seen.size !== entries.length) fail("ZIP is missing entries");
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const file of files) {
  const destination = path.join(STAGE, file.rel);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, file.data);
}

const zip = createZip(files);
verifyZip(zip, files);
const zipPath = path.join(DIST, `intermission-${manifest.version}.zip`);
fs.writeFileSync(zipPath, zip);

console.log(`Staged unpacked build: ${path.relative(ROOT, STAGE)}`);
console.log(`Wrote ${path.relative(ROOT, zipPath)} (${zip.length} bytes, ${files.length} files).`);
