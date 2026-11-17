(function () {
  const SDK = "https://www.gstatic.com/firebasejs/11.6.0";
  const CATEGORIES = new Set(["main", "side", "dessert", "drink", "other"]);
  const RSVP = new Set(["in", "maybe", "out"]);
  let db = null;
  let fs = null;
  let ready = null;

  function config() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return null;
    return cfg;
  }

  function cleanText(value, max) {
    const text = String(value ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(text).slice(0, max).join("");
  }

  function blank() {
    return { dishes: [], photos: [], files: [], rsvps: [], thanks: [] };
  }

  function asList(value) {
    return Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
  }

  function normalize(data) {
    const source = data || {};
    return {
      dishes: asList(source.dishes),
      photos: asList(source.photos),
      files: asList(source.files),
      rsvps: asList(source.rsvps),
      thanks: asList(source.thanks)
    };
  }

  function fail(message, status, store) {
    const error = new Error(message);
    error.status = status || 400;
    if (store) error.payload = { state: store };
    return error;
  }

  function loadSdk() {
    if (ready) return ready;
    ready = Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`)
    ]).then(([appMod, firestoreMod]) => {
      const app = appMod.initializeApp(config());
      fs = firestoreMod;
      db = firestoreMod.getFirestore(app);
    });
    return ready;
  }

  function tableRef() {
    return fs.doc(db, "potluck", "table");
  }

  async function mutate(change) {
    await loadSdk();
    let result = null;
    await fs.runTransaction(db, async (tx) => {
      const ref = tableRef();
      const snap = await tx.get(ref);
      const store = normalize(snap.exists() ? snap.data() : {});
      const error = change(store);
      if (error) throw error;
      tx.set(ref, store);
      result = store;
    });
    return { state: result };
  }

  function addDish(store, payload) {
    const by = cleanText(payload.by, 40);
    const dish = cleanText(payload.dish, 80);
    const note = cleanText(payload.note, 140);
    const category = String(payload.category || "");
    if (!by) return fail("Sign your name first.");
    if (!CATEGORIES.has(category)) return fail("Pick what kind of dish it is.");
    if (store.dishes.length >= 80) return fail("The table is full. Clear a dish before adding another.");
    const result = window.DishCheck.inspect(store.dishes, dish);
    if (result.status === "empty") return fail("Name the actual dish.");
    if (result.status === "vague") return fail(`"${dish}" is too broad. Name the dish.`);
    if (result.status === "similar" || result.status === "duplicate") {
      return fail(`${result.conflict.by} already claimed ${result.conflict.dish}.`, 409, store);
    }
    store.dishes.push({
      id: crypto.randomUUID(),
      by,
      dish,
      note,
      category,
      createdAt: new Date().toISOString()
    });
    return null;
  }

  function addRsvp(store, payload) {
    const by = cleanText(payload.by, 40);
    const note = cleanText(payload.note, 80);
    const status = String(payload.status || "");
    if (!by) return fail("Sign your name first.");
    if (!RSVP.has(status)) return fail("Say if you're in, maybe, or out.");
    const existing = store.rsvps.find((seat) => seat.by.trim().toLowerCase() === by.toLowerCase());
    if (existing) {
      existing.status = status;
      existing.note = note;
      existing.updatedAt = new Date().toISOString();
    } else {
      store.rsvps.push({
        id: crypto.randomUUID(),
        by,
        status,
        note,
        createdAt: new Date().toISOString()
      });
    }
    return null;
  }

  async function post(url, payload) {
    return mutate((store) => {
      if (url === "/api/dishes") return addDish(store, payload);
      if (url === "/api/rsvps") return addRsvp(store, payload);
      return fail("That one isn't on the table.");
    });
  }

  async function remove(kind, id) {
    if (kind !== "dishes" && kind !== "rsvps") throw fail("That one stayed put.");
    await loadSdk();
    const result = await mutate((store) => {
      const list = store[kind];
      if (!Array.isArray(list)) return fail("That one stayed put.");
      if (!list.some((entry) => entry.id === id)) return fail("That one already left.");
      store[kind] = list.filter((entry) => entry.id !== id);
      return null;
    });
    return result.state;
  }

  function start(apply) {
    return loadSdk().then(() => new Promise((resolve, reject) => {
      let opened = false;
      fs.onSnapshot(tableRef(), (snap) => {
        apply(normalize(snap.exists() ? snap.data() : {}));
        if (!opened) {
          opened = true;
          resolve();
        }
      }, (error) => {
        if (!opened) reject(error);
      });
    }));
  }

  window.DaCloud = {
    available: () => Boolean(config()),
    start,
    post,
    remove
  };
})();
