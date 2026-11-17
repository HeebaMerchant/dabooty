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

function tilt(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 33 + char.charCodeAt(0)) % 997;
  return `${(hash % 7) - 3}deg`;
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
    countLabel(state.dishes.length, "dish", "dishes")
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

const LOCAL_KEY = "dbc-local";
let localMode = false;
let cloudMode = false;

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

function hydrateLocal(store) {
  return { ...blankState(), ...store };
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

function localRemove(kind, id) {
  const store = readLocal();
  const list = store[kind] || [];
  store[kind] = list.filter((entry) => entry.id !== id);
  writeLocal(store);
  return hydrateLocal(store);
}

async function enterCloud() {
  cloudMode = true;
  serverOk = true;
  try {
    await window.DaCloud.start((next) => useState(next));
  } catch {
    cloudMode = false;
    await enterLocal();
    toast("The shared table isn't open yet. This browser is keeping its own copy.");
  }
}

async function postJSON(url, payload) {
  if (cloudMode) return window.DaCloud.post(url, payload);
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
  if (cloudMode || localMode) return;
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
  if (cloudMode) {
    useState(await window.DaCloud.remove(kind, id));
    return;
  }
  if (localMode) {
    useState(await localRemove(kind, id));
    return;
  }
  const res = await fetch(`/api/${kind}/${id}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "That one stayed put.");
  useState(data.state);
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
  if (window.DaCloud && window.DaCloud.available()) enterCloud();
  else refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 8000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

boot();
