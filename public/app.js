const CAT_LABEL = {
  main: "Main",
  side: "Side",
  dessert: "Dessert",
  drink: "Drink",
  other: "Extra"
};

const CAT_STORY = {
  main: "mains",
  side: "sides",
  dessert: "desserts",
  drink: "drinks",
  other: "extras"
};

const state = { dishes: [], photos: [], files: [], rsvps: [], thanks: [] };
let category = "";
let rsvpStatus = "in";
let activeFilter = "all";
let clashId = "";
let serverOk = true;
let booted = false;
let seenDishes = new Set();
let photoQueue = [];
let fileQueue = [];
let photoUrls = [];
let suppressClick = false;
let lastCountMinute = "";
let lastSnapshot = "";

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function whoName() {
  return $("#who").value.trim();
}

function nameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function requireName() {
  const input = $("#who");
  const name = input.value.trim();
  if (name) return name;
  shake(input);
  input.focus();
  toast("Add your name first.");
  return "";
}

function shake(node) {
  node.classList.remove("shake");
  void node.offsetWidth;
  node.classList.add("shake");
}

function toast(message) {
  const node = el("div", { class: "toast", role: "status" }, message);
  $("#toasts").append(node);
  setTimeout(() => node.remove(), 3400);
}

function flashStamp() {}

function popConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#9d2c3a", "#e07a2f", "#e4b133", "#2f5d45", "#f4eadc", "#c44536"];
  const bits = Array.from({ length: 84 }, () => ({
    x: canvas.width * (0.35 + Math.random() * 0.3),
    y: canvas.height * 0.32,
    vx: (Math.random() - 0.5) * 13,
    vy: Math.random() * -13 - 3,
    g: 0.28 + Math.random() * 0.14,
    w: 6 + Math.random() * 7,
    h: 8 + Math.random() * 8,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.32
  }));
  let frame = 0;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bits.forEach((bit) => {
      bit.vy += bit.g;
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.rot += bit.vr;
      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.rot);
      ctx.fillStyle = bit.color;
      ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h);
      ctx.restore();
    });
    frame += 1;
    if (frame < 95) requestAnimationFrame(draw);
    else canvas.remove();
  };
  draw();
}

function feastStart() {
  return new Date(2026, 10, 20, 21, 0, 0, 0);
}

function renderCountdown() {
  const now = new Date();
  const start = feastStart();
  const label = `${start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · 9pm`;
  $("#when-label").textContent = label;
  $("#stamp-date").textContent = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const count = $("#countdown");
  count.replaceChildren();
  if (now >= start) {
    count.append(el("div", {}, [el("strong", {}, "Now"), el("span", {}, "9pm")]));
    $("#count-text").textContent = `It's ${label}.`;
    return;
  }
  let remain = start.getTime() - now.getTime();
  const days = Math.floor(remain / 86400000);
  remain -= days * 86400000;
  const hours = Math.floor(remain / 3600000);
  remain -= hours * 3600000;
  const minutes = Math.floor(remain / 60000);
  const seconds = Math.floor((remain - minutes * 60000) / 1000);
  [["Days", days], ["Hours", hours], ["Min", minutes], ["Sec", seconds]].forEach(([unit, value]) => {
    count.append(el("div", {}, [el("strong", {}, String(value).padStart(2, "0")), el("span", {}, unit)]));
  });
  const minuteKey = `${days}:${hours}:${minutes}`;
  if (minuteKey !== lastCountMinute) {
    lastCountMinute = minuteKey;
    $("#count-text").textContent = `${days} days, ${hours} hours, and ${minutes} minutes until ${label}.`;
  }
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function tilt(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 33 + char.charCodeAt(0)) % 997;
  return `${(hash % 7) - 3}deg`;
}

function fileKind(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  if (["ppt", "pptx", "pps", "ppsx"].includes(ext)) return "PPT";
  if (ext === "pdf") return "PDF";
  if (ext === "key") return "KEY";
  return "DOC";
}

function setCategory(next) {
  category = next;
  document.querySelectorAll("#cat-pills button").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.cat === next));
  });
}

function setHint(message, kind) {
  const hint = $("#dish-hint");
  hint.textContent = message;
  hint.className = `hint${kind ? ` ${kind}` : ""}`;
}

function liveCheck() {
  const value = $("#dish-name").value;
  const submit = $("#dish-submit");
  if (!value.trim()) {
    setHint("Choose a classic, or name your own.", "");
    submit.disabled = false;
    clashId = "";
    return;
  }
  const result = window.DishCheck.inspect(state.dishes, value);
  if (result.status === "clear") {
    setHint("This one is open.", "clear");
    submit.disabled = false;
    clashId = "";
    return;
  }
  if (result.status === "duplicate" || result.status === "similar") {
    setHint(`${result.conflict.by} already claimed ${result.conflict.dish}.`, "bad");
    submit.disabled = true;
    clashId = result.conflict.id;
    return;
  }
  if (result.status === "vague") {
    setHint("Use the full name.", "warn");
    submit.disabled = true;
    clashId = "";
    return;
  }
  setHint("Name the dish.", "warn");
  submit.disabled = true;
  clashId = "";
}

function applySuggestion(item) {
  $("#dish-name").value = item.dish;
  setCategory(item.category);
  liveCheck();
  $("#dish-name").focus();
}

function focusCat(cat) {
  activeFilter = cat;
  renderDishes();
  $("#spread").scrollIntoView({ behavior: "smooth", block: "start" });
}

function render() {
  renderStats();
  renderSeats();
  renderIdeas();
  renderDishes();
  renderLane();
  renderFiles();
  liveCheck();
  seenDishes = new Set(state.dishes.map((dish) => dish.id));
  booted = true;
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderStats() {
  const coming = state.rsvps.filter((seat) => seat.status === "in").length;
  $("#stats").textContent = [
    countLabel(coming, "coming", "coming"),
    countLabel(state.dishes.length, "dish", "dishes"),
    countLabel(state.photos.length, "memory", "memories"),
    countLabel(state.files.length, "deck", "decks")
  ].join(" · ");
}

function renderSeats() {
  const list = $("#guest-list");
  const order = { in: 0, maybe: 1, out: 2 };
  const seats = [...state.rsvps].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  const label = { in: "Coming", maybe: "Maybe", out: "Can't make it" };
  list.replaceChildren();
  if (!seats.length) {
    list.append(el("li", { class: "guest empty" }, "No seats saved yet."));
    return;
  }
  seats.forEach((seat) => {
    list.append(el("li", { class: `guest ${seat.status}` }, [
      el("div", {}, [
        el("strong", {}, seat.by),
        seat.note ? el("em", {}, seat.note) : null
      ]),
      el("span", {}, label[seat.status] || "")
    ]));
  });
}

function renderIdeas() {
  const box = $("#ideas");
  box.replaceChildren();
  window.DishCheck.SUGGESTIONS.forEach((item) => {
    const taken = window.DishCheck.inspect(state.dishes, item.dish).status !== "clear";
    const btn = el("button", {
      type: "button",
      class: taken ? "chip taken" : "chip",
      disabled: taken || null
    }, taken ? `${item.dish} · taken` : item.dish);
    if (!taken) btn.addEventListener("click", () => applySuggestion(item));
    box.append(btn);
  });
}

function renderDishes() {
  const grid = $("#dish-grid");
  const groups = [
    ["main", "Mains"],
    ["side", "Sides"],
    ["dessert", "Desserts"],
    ["drink", "Drinks"],
    ["other", "Extras"]
  ];
  grid.replaceChildren();
  if (!state.dishes.length) {
    grid.append(el("p", { class: "empty-card" }, "Nothing claimed yet."));
    return;
  }
  groups.forEach(([cat, label]) => {
    const items = state.dishes.filter((dish) => dish.category === cat);
    if (!items.length) return;
    const block = el("section", { class: "menu-group" }, [el("h3", {}, label)]);
    items.forEach((dish) => {
      block.append(el("article", {
        class: `menu-row${clashId === dish.id ? " clash" : ""}`,
        id: `dish-${dish.id}`
      }, [
        el("div", {}, [
          el("strong", {}, dish.dish),
          dish.note ? el("p", {}, dish.note) : null,
          el("p", { class: "byline" }, dish.by)
        ]),
        el("button", { type: "button", class: "mini", "data-remove": "dishes", "data-id": dish.id }, "Remove")
      ]));
    });
    grid.append(block);
  });
}

function renderLane() {
  const lane = $("#lane");
  lane.replaceChildren();
  if (!state.photos.length) {
    lane.append(el("p", { class: "empty-card" }, "No photos yet."));
    return;
  }
  state.photos.forEach((photo) => {
    lane.append(el("figure", { class: "photo-card", "data-open": photo.id }, [
      el("img", { src: photo.url || `/uploads/${encodeURIComponent(photo.file)}`, alt: photo.caption || "Memory" }),
      el("figcaption", {}, photo.caption || "Untitled"),
      el("p", { class: "meta" }, [photo.era, photo.by].filter(Boolean).join(" · ")),
      el("button", { type: "button", class: "mini", "data-remove": "photos", "data-id": photo.id }, "Remove")
    ]));
  });
}

function renderFiles() {
  const box = $("#folders");
  box.replaceChildren();
  if (!state.files.length) {
    box.append(el("p", { class: "empty-card" }, "No files yet."));
    return;
  }
  [...state.files].reverse().forEach((file) => {
    box.append(el("article", { class: "file-row" }, [
      el("div", {}, [
        el("span", { class: "file-kind" }, fileKind(file.name)),
        el("strong", {}, file.name),
        el("p", { class: "byline" }, `${file.by} · ${formatBytes(file.size)}`)
      ]),
      el("div", { class: "folder-actions" }, [
        el("a", { href: file.url || `/uploads/${encodeURIComponent(file.file)}`, download: file.name }, "Download"),
        el("button", { type: "button", class: "mini", "data-remove": "files", "data-id": file.id }, "Remove")
      ])
    ]));
  });
}

const LOCAL_KEY = "dbc-local";
let localMode = false;

function blankState() {
  return { dishes: [], photos: [], files: [], rsvps: [], thanks: [] };
}

function readLocal() {
  try {
    return { ...blankState(), ...JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") };
  } catch {
    return blankState();
  }
}

function writeLocal(next) {
  const copy = {
    dishes: next.dishes || [],
    photos: (next.photos || []).map(({ url, ...item }) => item),
    files: (next.files || []).map(({ url, ...item }) => item),
    rsvps: next.rsvps || [],
    thanks: next.thanks || []
  };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

function blobDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("dbc-blobs", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("blobs")) req.result.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function blobPut(id, blob) {
  return blobDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function blobGet(id) {
  return blobDb().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction("blobs", "readonly").objectStore("blobs").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function blobDel(id) {
  return blobDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

async function hydrateLocal(store) {
  const next = { ...blankState(), ...store };
  for (const photo of next.photos) {
    const blob = await blobGet(photo.file).catch(() => null);
    if (blob) photo.url = URL.createObjectURL(blob);
  }
  for (const file of next.files) {
    const blob = await blobGet(file.file).catch(() => null);
    if (blob) file.url = URL.createObjectURL(blob);
  }
  return next;
}

async function enterLocal() {
  localMode = true;
  serverOk = false;
  useState(await hydrateLocal(readLocal()));
}

async function localPost(url, payload) {
  const store = readLocal();
  if (url === "/api/dishes") {
    const dish = String(payload.dish || "").trim();
    const result = window.DishCheck.inspect(store.dishes, dish);
    if (result.status === "duplicate" || result.status === "similar") {
      const error = new Error(`${result.conflict.by} already claimed ${result.conflict.dish}.`);
      error.status = 409;
      error.payload = { state: store };
      throw error;
    }
    if (result.status !== "clear") {
      const error = new Error("Name the dish.");
      error.status = 400;
      throw error;
    }
    store.dishes.push({
      id: crypto.randomUUID(),
      by: payload.by,
      dish,
      note: String(payload.note || "").trim(),
      category: payload.category,
      createdAt: new Date().toISOString()
    });
  } else if (url === "/api/rsvps") {
    const by = String(payload.by || "").trim();
    const existing = store.rsvps.find((seat) => seat.by.trim().toLowerCase() === by.toLowerCase());
    if (existing) {
      existing.status = payload.status;
      existing.note = String(payload.note || "").trim();
    } else {
      store.rsvps.push({
        id: crypto.randomUUID(),
        by,
        status: payload.status,
        note: String(payload.note || "").trim(),
        createdAt: new Date().toISOString()
      });
    }
  }
  writeLocal(store);
  return { state: await hydrateLocal(store) };
}

async function localUpload(url, formData) {
  const store = readLocal();
  const by = String(formData.get("by") || "").trim();
  if (url === "/api/photos") {
    const caption = String(formData.get("caption") || "").trim();
    const era = String(formData.get("era") || "").trim();
    for (const file of formData.getAll("photos")) {
      if (!(file instanceof File)) continue;
      const id = crypto.randomUUID();
      await blobPut(id, file);
      store.photos.push({
        id,
        file: id,
        by,
        caption,
        era,
        createdAt: new Date().toISOString(),
        url: URL.createObjectURL(file)
      });
    }
  } else if (url === "/api/files") {
    for (const file of formData.getAll("files")) {
      if (!(file instanceof File)) continue;
      const id = crypto.randomUUID();
      await blobPut(id, file);
      store.files.push({
        id,
        file: id,
        name: file.name,
        by,
        size: file.size,
        createdAt: new Date().toISOString(),
        url: URL.createObjectURL(file)
      });
    }
  }
  writeLocal(store);
  return { state: store };
}

async function localRemove(kind, id) {
  const store = readLocal();
  const list = store[kind] || [];
  const item = list.find((entry) => entry.id === id);
  store[kind] = list.filter((entry) => entry.id !== id);
  if (item && (kind === "photos" || kind === "files")) await blobDel(item.file).catch(() => {});
  writeLocal(store);
  return hydrateLocal(store);
}

async function postJSON(url, payload) {
  if (localMode) return localPost(url, payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || "Try that again.");
    error.payload = data;
    error.status = res.status;
    throw error;
  }
  return data;
}

function upload(url, formData, onProgress) {
  if (localMode) {
    if (onProgress) onProgress(1);
    return localUpload(url, formData);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else {
        const error = new Error(body.message || "The upload dropped. Try again.");
        error.payload = body;
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("The upload dropped. Try again."));
    xhr.send(formData);
  });
}

function useState(next) {
  if (!next) return;
  const snap = JSON.stringify(next);
  if (snap === lastSnapshot) return;
  lastSnapshot = snap;
  state.dishes = next.dishes || [];
  state.photos = next.photos || [];
  state.files = next.files || [];
  state.rsvps = next.rsvps || [];
  state.thanks = next.thanks || [];
  render();
}

async function refresh() {
  if (localMode) return;
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("offline");
    const data = await res.json();
    if (!Array.isArray(data.dishes)) throw new Error("offline");
    serverOk = true;
    useState(data);
  } catch {
    await enterLocal();
  }
}

async function removeItem(kind, id) {
  if (localMode) {
    useState(await localRemove(kind, id));
    return;
  }
  const res = await fetch(`/api/${kind}/${id}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "That one stayed put.");
  useState(data.state);
}

function stagePhotos(files) {
  files.forEach((file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const okType = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) || file.type.startsWith("image/");
    if (!okType || file.type === "image/svg+xml") {
      toast("Use a JPG, PNG, WEBP, or GIF so everyone can see it.");
      return;
    }
    photoQueue.push(file);
  });
  photoQueue = photoQueue.slice(0, 8);
  renderPhotoQueue();
}

function renderPhotoQueue() {
  photoUrls.forEach((url) => URL.revokeObjectURL(url));
  photoUrls = [];
  const box = $("#photo-preview");
  box.replaceChildren();
  photoQueue.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    photoUrls.push(url);
    box.append(el("div", { class: "preview" }, [
      el("img", { src: url, alt: "" }),
      el("button", { type: "button", class: "mini", onclick: () => { photoQueue.splice(index, 1); renderPhotoQueue(); } }, "Remove")
    ]));
  });
}

function renderFileQueue() {
  const box = $("#file-preview");
  box.replaceChildren();
  fileQueue.forEach((file, index) => {
    box.append(el("div", { class: "preview" }, [
      el("span", {}, file.name),
      el("button", {
        type: "button",
        class: "mini",
        onclick: () => {
          fileQueue.splice(index, 1);
          renderFileQueue();
        }
      }, "Remove")
    ]));
  });
}

function stageFiles(files) {
  const allowed = ["ppt", "pptx", "pps", "ppsx", "pdf", "key", "doc", "docx"];
  files.forEach((file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) {
      toast("Bring a PowerPoint, Keynote, PDF, or Word file.");
      return;
    }
    fileQueue.push(file);
  });
  fileQueue = fileQueue.slice(0, 6);
  renderFileQueue();
}

function wireDrop(zone, input, browse, onFiles) {
  browse.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.click();
  });
  zone.addEventListener("click", () => input.click());
  ["dragenter", "dragover"].forEach((type) => {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("is-hot");
    });
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-hot"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-hot");
    onFiles([...event.dataTransfer.files]);
  });
  input.addEventListener("change", () => {
    onFiles([...input.files]);
    input.value = "";
  });
}

function openLightbox(photo) {
  $("#lightbox-img").src = photo.url || `/uploads/${encodeURIComponent(photo.file)}`;
  $("#lightbox-img").alt = photo.caption;
  $("#lightbox-cap").textContent = [photo.caption, photo.era, photo.by].filter(Boolean).join(" · ");
  $("#lightbox").hidden = false;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  $("#lightbox-img").removeAttribute("src");
}

function bind() {
  $("#who").addEventListener("input", () => {
    localStorage.setItem("dbc-name", $("#who").value.trim());
    renderSeats();
  });

  document.querySelectorAll("#cat-pills button").forEach((btn) => {
    btn.addEventListener("click", () => setCategory(btn.dataset.cat));
  });

  document.querySelectorAll("#rsvp-form [data-rsvp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      rsvpStatus = btn.dataset.rsvp;
      document.querySelectorAll("#rsvp-form [data-rsvp]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === btn));
      });
    });
  });

  $("#dish-name").addEventListener("input", liveCheck);

  $("#dish-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const by = requireName();
    if (!by) return;
    const dish = $("#dish-name").value.trim();
    const result = window.DishCheck.inspect(state.dishes, dish);
    if (result.status === "duplicate" || result.status === "similar") {
      flashStamp("Already claimed");
      liveCheck();
      return;
    }
    if (result.status !== "clear") {
      flashStamp("Name the dish");
      liveCheck();
      return;
    }
    if (!category) {
      shake($("#cat-pills"));
      toast("Pick main, side, dessert, drink, or extra.");
      return;
    }
    const submit = $("#dish-submit");
    submit.disabled = true;
    try {
      const data = await postJSON("/api/dishes", {
        by,
        dish,
        note: $("#dish-note").value,
        category
      });
      $("#dish-name").value = "";
      $("#dish-note").value = "";
      useState(data.state);
      toast(`${dish} is on the menu.`);
    } catch (error) {
      if (error.payload?.state) useState(error.payload.state);
      flashStamp(error.status === 409 ? "Already claimed" : "Hold up");
      toast(error.message);
    } finally {
      liveCheck();
    }
  });

  $("#rsvp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const by = requireName();
    if (!by) return;
    try {
      const data = await postJSON("/api/rsvps", { by, status: rsvpStatus, note: $("#rsvp-note").value });
      useState(data.state);
      toast("Seat saved.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#copy-menu").addEventListener("click", async () => {
    const groups = [
      ["main", "Mains"],
      ["side", "Sides"],
      ["dessert", "Desserts"],
      ["drink", "Drinks"],
      ["other", "Extras"]
    ];
    const lines = ["Da Booty Club Friendsgiving", $("#when-label").textContent, ""];
    if (!state.dishes.length) lines.push("The menu is still open.");
    groups.forEach(([cat, label]) => {
      const items = state.dishes.filter((dish) => dish.category === cat);
      if (!items.length) return;
      lines.push(label);
      items.forEach((dish) => lines.push(`- ${dish.dish} (${dish.by})`));
      lines.push("");
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      toast("Menu copied.");
    } catch {
      toast("Couldn't copy the menu.");
    }
  });

  wireDrop($("#photo-drop"), $("#photo-input"), $("#photo-browse"), stagePhotos);
  wireDrop($("#file-drop"), $("#file-input"), $("#file-browse"), stageFiles);

  $("#photo-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const by = requireName();
    if (!by) return;
    if (!photoQueue.length) {
      toast("Add a photo to pin.");
      return;
    }
    const data = new FormData();
    data.set("by", by);
    data.set("caption", $("#photo-caption").value);
    data.set("era", $("#photo-era").value);
    photoQueue.forEach((file) => data.append("photos", file));
    const bar = $("#photo-progress");
    bar.hidden = false;
    bar.firstElementChild.style.width = "0%";
    try {
      const body = await upload("/api/photos", data, (ratio) => {
        bar.firstElementChild.style.width = `${Math.round(ratio * 100)}%`;
      });
      photoQueue = [];
      renderPhotoQueue();
      $("#photo-caption").value = "";
      useState(body.state);
      toast("Photo added.");
    } catch (error) {
      toast(error.message);
    } finally {
      setTimeout(() => { bar.hidden = true; }, 400);
    }
  });

  $("#file-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const by = requireName();
    if (!by) return;
    if (!fileQueue.length) {
      toast("Choose a file first.");
      return;
    }
    const data = new FormData();
    data.set("by", by);
    fileQueue.forEach((file) => data.append("files", file));
    const bar = $("#file-progress");
    bar.hidden = false;
    bar.firstElementChild.style.width = "0%";
    try {
      const body = await upload("/api/files", data, (ratio) => {
        bar.firstElementChild.style.width = `${Math.round(ratio * 100)}%`;
      });
      fileQueue = [];
      renderFileQueue();
      useState(body.state);
      toast("File added.");
    } catch (error) {
      toast(error.message);
    } finally {
      setTimeout(() => { bar.hidden = true; }, 400);
    }
  });

  document.body.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-remove]");
    if (!btn) return;
    event.stopPropagation();
    if (btn.dataset.armed !== "yes") {
      btn.dataset.armed = "yes";
      btn.textContent = "Yes, remove";
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.armed = "";
        btn.textContent = "Remove";
      }, 2500);
      return;
    }
    try {
      await removeItem(btn.dataset.remove, btn.dataset.id);
    } catch (error) {
      toast(error.message);
    }
  });

  $("#lane").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const card = event.target.closest("[data-open]");
    if (!card) return;
    const photo = state.photos.find((item) => item.id === card.dataset.open);
    if (photo) openLightbox(photo);
  });

  $("#lightbox").addEventListener("click", (event) => {
    if (event.target === $("#lightbox") || event.target.closest(".lightbox-close")) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLightbox();
  });

  document.addEventListener("paste", (event) => {
    const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/") && file.type !== "image/svg+xml");
    if (!images.length) return;
    event.preventDefault();
    stagePhotos(images);
    $("#lane-section").scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Photo ready. Add a caption, then save it.");
  });

  const links = [...document.querySelectorAll(".bar nav a")];
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => link.classList.toggle("is-on", link.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  links.forEach((link) => {
    const section = document.querySelector(link.getAttribute("href"));
    if (section) observer.observe(section);
  });
}

function bindScroll() {
  const landing = $("#landing");
  const line = $("#scroll-line");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    if (line) line.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    if (!landing || reduce) return;
    const depth = Math.min(1, Math.max(0, y / (landing.offsetHeight * 0.92)));
    landing.style.setProperty("--p", depth.toFixed(4));
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  update();
  document.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
}

function boot() {
  const saved = localStorage.getItem("dbc-name");
  if (saved) $("#who").value = saved;
  bind();
  bindScroll();
  renderCountdown();
  setInterval(renderCountdown, 1000);
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 8000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

boot();
