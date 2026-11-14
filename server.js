const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const DishCheck = require("./public/dish-check");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const UPLOADS = path.join(DATA, "uploads");
const STORE = path.join(DATA, "store.json");
const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_JSON = 1024 * 200;
const MAX_UPLOAD = 40 * 1024 * 1024;

const CATEGORIES = new Set(["main", "side", "dessert", "drink", "other"]);
const RSVP = new Set(["in", "maybe", "out"]);
const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const PHOTO_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif"
};
const DOC_EXT = new Set([".ppt", ".pptx", ".pps", ".ppsx", ".pdf", ".key", ".doc", ".docx"]);
const DOC_MIME = {
  "application/pdf": ".pdf",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"
};
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

fs.mkdirSync(UPLOADS, { recursive: true });

function emptyStore() {
  return { dishes: [], photos: [], files: [], rsvps: [], thanks: [] };
}

function readStore() {
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE, "utf8")) };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE);
}

function cleanText(value, max) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, max).join("");
}

function nameKey(name) {
  return name.toLowerCase();
}

function removeUpload(filename) {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) return;
  const full = path.join(UPLOADS, filename);
  if (full.startsWith(`${UPLOADS}${path.sep}`) && fs.existsSync(full)) fs.unlinkSync(full);
}

function cleanFilename(name) {
  const base = path.basename(String(name || "")).replace(/[\u0000-\u001F]/g, "");
  return Array.from(base).slice(0, 120).join("") || "file";
}

function ideasFor(dishes) {
  return DishCheck.SUGGESTIONS.filter((item) => DishCheck.inspect(dishes, item.dish).status === "clear").slice(0, 3);
}

function send(res, status, body, headers = {}) {
  const isJson = body && typeof body === "object" && !Buffer.isBuffer(body);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(isJson ? JSON.stringify(body) : String(body ?? ""));
  res.writeHead(status, {
    "Content-Length": payload.length,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    ...(isJson ? { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } : {}),
    ...headers
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        const err = new Error("too big");
        err.code = "LIMIT";
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function parseMultipart(buffer, boundary) {
  const parts = [];
  const delim = Buffer.from(`--${boundary}`);
  let cursor = buffer.indexOf(delim);
  if (cursor < 0) return parts;
  cursor += delim.length;
  while (cursor < buffer.length) {
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;
    const next = buffer.indexOf(delim, cursor);
    if (next < 0) break;
    let chunk = buffer.subarray(cursor, next);
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 13 && chunk[chunk.length - 1] === 10) {
      chunk = chunk.subarray(0, chunk.length - 2);
    }
    const sep = chunk.indexOf("\r\n\r\n");
    if (sep >= 0) {
      const headerText = chunk.subarray(0, sep).toString("utf8");
      const body = chunk.subarray(sep + 4);
      const headers = {};
      headerText.split("\r\n").forEach((line) => {
        const idx = line.indexOf(":");
        if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      });
      const disp = headers["content-disposition"] || "";
      const name = /name="([^"]*)"/.exec(disp)?.[1] || /name=([^;\s]+)/.exec(disp)?.[1] || "";
      const filename = /filename="([^"]*)"/.exec(disp)?.[1] || /filename=([^;\s]+)/.exec(disp)?.[1] || "";
      parts.push({
        name,
        filename,
        type: (headers["content-type"] || "").split(";")[0].trim().toLowerCase(),
        body
      });
    }
    cursor = next + delim.length;
  }
  return parts;
}

function extOf(filename, mime, allowed, mimes) {
  const ext = path.extname(filename || "").toLowerCase();
  if (allowed.has(ext)) return ext;
  return mimes[mime] || "";
}

function collectParts(parts, field, allowed, mimes, maxEach, typeMessage) {
  const fields = {};
  const files = [];
  parts.forEach((part) => {
    if (part.filename) {
      if (part.name !== field) return;
      const ext = extOf(part.filename, part.type, allowed, mimes);
      if (!ext) {
        const err = new Error(typeMessage);
        err.code = "BAD_TYPE";
        throw err;
      }
      if (part.body.length > maxEach) {
        const err = new Error("too big");
        err.code = "LIMIT_FILE_SIZE";
        throw err;
      }
      if (part.body.length) files.push({ originalname: part.filename, buffer: part.body, ext });
      return;
    }
    if (part.name && fields[part.name] == null) fields[part.name] = part.body.toString("utf8");
  });
  return { fields, files };
}

function saveFiles(files) {
  return files.map((file) => {
    const filename = `${crypto.randomUUID()}${file.ext}`;
    fs.writeFileSync(path.join(UPLOADS, filename), file.buffer);
    return { ...file, filename, size: file.buffer.length };
  });
}

function discardSaved(files) {
  files.forEach((file) => removeUpload(file.filename));
}

async function readPayload(req) {
  const type = String(req.headers["content-type"] || "");
  const announced = Number(req.headers["content-length"] || 0);
  const limit = type.includes("multipart/form-data") ? MAX_UPLOAD : MAX_JSON;
  if (announced > limit) {
    const err = new Error("too big");
    err.code = "LIMIT";
    throw err;
  }
  const body = await readBody(req, limit);
  if (type.includes("application/json")) {
    try {
      return { json: body.length ? JSON.parse(body.toString("utf8")) : {} };
    } catch {
      const err = new Error("bad json");
      err.code = "BAD_JSON";
      throw err;
    }
  }
  if (type.includes("multipart/form-data")) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    const boundary = (match?.[1] || match?.[2] || "").trim();
    if (!boundary) {
      const err = new Error("bad form");
      err.code = "BAD_TYPE";
      throw err;
    }
    return { parts: parseMultipart(body, boundary) };
  }
  return { json: {} };
}

function publicFile(requestPath) {
  const raw = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedRoot = path.resolve(PUBLIC);
  const resolved = path.resolve(resolvedRoot, `.${raw}`);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

function serveStatic(res, requestPath) {
  const full = publicFile(requestPath);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    send(res, 404, "That page isn't on the table.", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const ext = path.extname(full).toLowerCase();
  const headers = { "Content-Type": STATIC_TYPES[ext] || "application/octet-stream" };
  if (ext === ".html" || ext === ".css" || ext === ".js") headers["Cache-Control"] = "no-cache";
  send(res, 200, fs.readFileSync(full), headers);
}

function serveUpload(res, requestPath) {
  const base = path.basename(requestPath);
  const full = path.join(UPLOADS, base);
  if (!full.startsWith(`${UPLOADS}${path.sep}`) || !fs.existsSync(full)) {
    send(res, 404, "That file already left.", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const ext = path.extname(base).toLowerCase();
  const headers = { "Content-Type": STATIC_TYPES[ext] || "application/octet-stream", "Cache-Control": "public, max-age=604800" };
  if (!PHOTO_EXT.has(ext)) {
    const doc = readStore().files.find((item) => item.file === base);
    const ascii = String(doc?.name || base).replace(/[^\x20-\x7E]/g, "").replace(/"/g, "") || "download";
    headers["Content-Disposition"] = `attachment; filename="${ascii}"`;
  }
  send(res, 200, fs.readFileSync(full), headers);
}

function dishRoutes(req, res, pathname, payload) {
  if (req.method === "GET" && pathname === "/api/state") {
    send(res, 200, readStore());
    return true;
  }
  if (req.method === "GET" && pathname === "/api/health") {
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/check") {
    const store = readStore();
    const result = DishCheck.inspect(store.dishes, payload.json?.dish);
    send(res, 200, {
      status: result.status,
      conflict: result.conflict ? { id: result.conflict.id, by: result.conflict.by, dish: result.conflict.dish } : null,
      ideas: result.status === "clear" ? [] : ideasFor(store.dishes)
    });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/dishes") {
    const store = readStore();
    const by = cleanText(payload.json?.by, 40);
    const dish = cleanText(payload.json?.dish, 80);
    const note = cleanText(payload.json?.note, 140);
    const category = String(payload.json?.category || "");
    if (!by) return send(res, 400, { message: "Sign your name first." }), true;
    if (!CATEGORIES.has(category)) return send(res, 400, { message: "Pick what kind of dish it is." }), true;
    if (store.dishes.length >= 80) {
      send(res, 400, { message: "The table is full. Clear a dish before adding another." });
      return true;
    }
    const result = DishCheck.inspect(store.dishes, dish);
    if (result.status === "empty") return send(res, 400, { message: "Name the actual dish." }), true;
    if (result.status === "vague") {
      send(res, 400, {
        message: `“${dish}” is too broad. Name the dish — pumpkin pie, not just pie.`,
        ideas: ideasFor(store.dishes)
      });
      return true;
    }
    if (result.status === "similar" || result.status === "duplicate") {
      const owner = result.conflict;
      send(res, 409, {
        message: `${owner.by} already claimed ${owner.dish}.`,
        detail: "Pick a different dish so the table stays balanced.",
        conflict: { id: owner.id, by: owner.by, dish: owner.dish },
        ideas: ideasFor(store.dishes),
        state: store
      });
      return true;
    }
    const entry = { id: crypto.randomUUID(), by, dish, note, category, createdAt: new Date().toISOString() };
    store.dishes.push(entry);
    writeStore(store);
    send(res, 201, { dish: entry, state: store });
    return true;
  }
  return false;
}

function mutateRoutes(req, res, pathname, payload) {
  const dishId = pathname.match(/^\/api\/dishes\/([0-9a-f-]{36})$/i);
  if (req.method === "DELETE" && dishId) {
    const store = readStore();
    const next = store.dishes.filter((dish) => dish.id !== dishId[1]);
    if (next.length === store.dishes.length) return send(res, 404, { message: "That dish already left." }), true;
    store.dishes = next;
    writeStore(store);
    send(res, 200, { state: store });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/rsvps") {
    const store = readStore();
    const by = cleanText(payload.json?.by, 40);
    const note = cleanText(payload.json?.note, 80);
    const status = String(payload.json?.status || "");
    if (!by) return send(res, 400, { message: "Sign your name first." }), true;
    if (!RSVP.has(status)) return send(res, 400, { message: "Say if you're in, maybe, or out." }), true;
    const existing = store.rsvps.find((seat) => nameKey(seat.by) === nameKey(by));
    if (existing) {
      existing.status = status;
      existing.note = note;
      existing.updatedAt = new Date().toISOString();
    } else {
      store.rsvps.push({ id: crypto.randomUUID(), by, status, note, createdAt: new Date().toISOString() });
    }
    writeStore(store);
    send(res, 201, { state: store });
    return true;
  }
  const rsvpId = pathname.match(/^\/api\/rsvps\/([0-9a-f-]{36})$/i);
  if (req.method === "DELETE" && rsvpId) {
    const store = readStore();
    store.rsvps = store.rsvps.filter((seat) => seat.id !== rsvpId[1]);
    writeStore(store);
    send(res, 200, { state: store });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/thanks") {
    const store = readStore();
    const by = cleanText(payload.json?.by, 40);
    const message = cleanText(payload.json?.message, 160);
    if (!by) return send(res, 400, { message: "Sign your name first." }), true;
    if (message.length < 2) return send(res, 400, { message: "Write one good thing." }), true;
    if (store.thanks.length >= 40) return send(res, 400, { message: "The wall is full of good things." }), true;
    const repeat = store.thanks.find((note) => nameKey(note.by) === nameKey(by) && note.message.toLowerCase() === message.toLowerCase());
    if (repeat) return send(res, 409, { message: "You already put that one on the wall." }), true;
    store.thanks.push({ id: crypto.randomUUID(), by, message, createdAt: new Date().toISOString() });
    writeStore(store);
    send(res, 201, { state: store });
    return true;
  }
  const thanksId = pathname.match(/^\/api\/thanks\/([0-9a-f-]{36})$/i);
  if (req.method === "DELETE" && thanksId) {
    const store = readStore();
    store.thanks = store.thanks.filter((note) => note.id !== thanksId[1]);
    writeStore(store);
    send(res, 200, { state: store });
    return true;
  }
  return false;
}

function uploadRoutes(req, res, pathname, payload) {
  if (req.method === "POST" && (pathname === "/api/photos" || pathname === "/api/files")) {
    const photos = pathname === "/api/photos";
    const { fields, files } = collectParts(
      payload.parts || [],
      photos ? "photos" : "files",
      photos ? PHOTO_EXT : DOC_EXT,
      photos ? PHOTO_MIME : DOC_MIME,
      photos ? 10 * 1024 * 1024 : 25 * 1024 * 1024,
      photos ? "Use a JPG, PNG, WEBP, or GIF so everyone can see it." : "Bring a PowerPoint, Keynote, PDF, or Word file."
    );
    if (files.length > (photos ? 8 : 6)) {
      send(res, 400, { message: "That's more files than the table can hold at once." });
      return true;
    }
    const by = cleanText(fields.by, 40);
    if (!by || !files.length) {
      send(res, 400, { message: !by ? "Sign your name first." : photos ? "Add a photo to pin." : "Drop a deck or a PDF." });
      return true;
    }
    const store = readStore();
    const bucket = photos ? store.photos : store.files;
    const cap = photos ? 40 : 30;
    if (bucket.length + files.length > cap) {
      send(res, 400, { message: photos ? "Memory lane is full. Take one down before adding more." : "The pile is full. Remove a file first." });
      return true;
    }
    const saved = saveFiles(files);
    try {
      const createdAt = new Date().toISOString();
      if (photos) {
        const caption = cleanText(fields.caption, 140);
        const era = cleanText(fields.era, 40);
        saved.forEach((file) => {
          store.photos.push({
            id: crypto.randomUUID(),
            by,
            caption: caption || "A Da Booty Club original",
            era,
            file: file.filename,
            createdAt
          });
        });
      } else {
        saved.forEach((file) => {
          store.files.push({
            id: crypto.randomUUID(),
            by,
            name: cleanFilename(file.originalname),
            file: file.filename,
            size: file.size,
            createdAt
          });
        });
      }
      writeStore(store);
      send(res, 201, { state: store });
    } catch (err) {
      discardSaved(saved);
      throw err;
    }
    return true;
  }
  const photoId = pathname.match(/^\/api\/photos\/([0-9a-f-]{36})$/i);
  if (req.method === "DELETE" && photoId) {
    const store = readStore();
    const photo = store.photos.find((item) => item.id === photoId[1]);
    if (!photo) return send(res, 404, { message: "That photo already came down." }), true;
    store.photos = store.photos.filter((item) => item.id !== photoId[1]);
    writeStore(store);
    removeUpload(photo.file);
    send(res, 200, { state: store });
    return true;
  }
  const fileId = pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  if (req.method === "DELETE" && fileId) {
    const store = readStore();
    const doc = store.files.find((item) => item.id === fileId[1]);
    if (!doc) return send(res, 404, { message: "That file is already gone." }), true;
    store.files = store.files.filter((item) => item.id !== fileId[1]);
    writeStore(store);
    removeUpload(doc.file);
    send(res, 200, { state: store });
    return true;
  }
  return false;
}

async function onRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) {
      const payload = req.method === "GET" || req.method === "DELETE" ? { json: {} } : await readPayload(req);
      if (dishRoutes(req, res, pathname, payload)) return;
      if (mutateRoutes(req, res, pathname, payload)) return;
      if (uploadRoutes(req, res, pathname, payload)) return;
      send(res, 404, { message: "That isn't on the menu." });
      return;
    }
    if (pathname.startsWith("/uploads/")) {
      serveUpload(res, pathname);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "That move isn't on the menu.", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    serveStatic(res, pathname);
  } catch (err) {
    if (res.headersSent) return;
    if (err.code === "LIMIT" || err.code === "LIMIT_FILE_SIZE") {
      send(res, 400, { message: "That file is too big. Photos up to 10MB, decks up to 25MB." });
      return;
    }
    if (err.code === "BAD_TYPE") {
      send(res, 400, { message: err.message || "That file type stays home." });
      return;
    }
    if (err.code === "BAD_JSON") {
      send(res, 400, { message: "That request got mashed. Try again." });
      return;
    }
    console.error(err);
    send(res, 500, { message: "Something in the kitchen broke. Try again." });
  }
}

function listen(port) {
  const server = http.createServer(onRequest);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && !process.env.PORT && port < BASE_PORT + 10) {
      listen(port + 1);
      return;
    }
    console.error(err);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Da Booty Club is serving at http://localhost:${port}`);
    lanUrls(port).forEach((item) => console.log(`Friends on this Wi-Fi can open ${item}`));
  });
}

function lanUrls(port) {
  const urls = [];
  let nets = {};
  try {
    nets = os.networkInterfaces();
  } catch {
    return urls;
  }
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

listen(BASE_PORT);
