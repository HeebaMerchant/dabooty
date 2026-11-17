(function () {
  const SDK = "https://www.gstatic.com/firebasejs/11.6.0";
  const CATEGORIES = new Set(["main", "side", "dessert", "drink", "other"]);
  const RSVP = new Set(["in", "maybe", "out"]);
  const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  const DOC_EXT = new Set(["ppt", "pptx", "pps", "ppsx", "pdf", "key", "doc", "docx"]);

  let db = null;
  let storage = null;
  let fs = null;
  let st = null;
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

  function storageMessage(error) {
    const code = String((error && error.code) || "");
    const message = String((error && error.message) || "");
    if (code === "storage/unauthorized" || message.includes("402") || message.includes("Blaze") || message.includes("billing")) {
      return "Photos and files need Firebase Storage on the Blaze plan. Seats and dishes still save.";
    }
    return "The upload dropped. Try again.";
  }

  function loadSdk() {
    if (ready) return ready;
    ready = Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`),
      import(`${SDK}/firebase-storage.js`)
    ]).then(([appMod, firestoreMod, storageMod]) => {
      const app = appMod.initializeApp(config());
      fs = firestoreMod;
      st = storageMod;
      db = firestoreMod.getFirestore(app);
      storage = storageMod.getStorage(app);
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

  function extOf(file) {
    return String(file.name || "").split(".").pop().toLowerCase();
  }

  async function putBlob(folder, id, file, onProgress, index, total) {
    const fileRef = st.ref(storage, `${folder}/${id}`);
    const task = st.uploadBytesResumable(fileRef, file, { contentType: file.type || "application/octet-stream" });
    await new Promise((resolve, reject) => {
      task.on("state_changed", (snap) => {
        if (!onProgress || !snap.totalBytes) return;
        onProgress((index + snap.bytesTransferred / snap.totalBytes) / total);
      }, reject, resolve);
    });
    const url = await st.getDownloadURL(fileRef);
    return { fileRef, url };
  }

  async function upload(url, formData, onProgress) {
    await loadSdk();
    const photos = url === "/api/photos";
    const by = cleanText(formData.get("by"), 40);
    const incoming = formData.getAll(photos ? "photos" : "files").filter((file) => file instanceof File);
    if (!by) throw fail("Sign your name first.");
    if (!incoming.length) throw fail(photos ? "Add a photo to pin." : "Drop a deck or a PDF.");
    const allowed = photos ? PHOTO_EXT : DOC_EXT;
    const limit = photos ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    incoming.forEach((file) => {
      if (!allowed.has(extOf(file))) throw fail(photos ? "Use a JPG, PNG, WEBP, or GIF so everyone can see it." : "Bring a PowerPoint, Keynote, PDF, or Word file.");
      if (file.size > limit) throw fail(photos ? "Each photo needs to be under 10MB." : "Each file needs to be under 25MB.");
    });
    const caption = cleanText(formData.get("caption"), 140);
    const era = cleanText(formData.get("era"), 40);
    const createdAt = new Date().toISOString();
    const saved = [];
    try {
      for (let index = 0; index < incoming.length; index += 1) {
        const file = incoming[index];
        const id = crypto.randomUUID();
        const fileRef = st.ref(storage, `${photos ? "photos" : "files"}/${id}`);
        saved.push({ fileRef, entry: null });
        const uploaded = await putBlob(photos ? "photos" : "files", id, file, onProgress, index, incoming.length);
        saved[saved.length - 1].entry = photos
          ? { id, by, caption: caption || "A Da Booty Club original", era, file: id, url: uploaded.url, createdAt }
          : { id, by, name: cleanText(file.name, 120) || "file", file: id, size: file.size, url: uploaded.url, createdAt };
      }
      return await mutate((store) => {
        const bucket = photos ? store.photos : store.files;
        const cap = photos ? 40 : 30;
        if (bucket.length + saved.length > cap) {
          return fail(photos ? "Memory lane is full. Take one down before adding more." : "The pile is full. Remove a file first.");
        }
        saved.forEach((item) => {
          if (item.entry) bucket.push(item.entry);
        });
        return null;
      });
    } catch (error) {
      await Promise.all(saved.map((item) => st.deleteObject(item.fileRef).catch(() => {})));
      if (error && error.payload) throw error;
      throw fail(storageMessage(error));
    }
  }

  async function remove(kind, id) {
    await loadSdk();
    let storedName = "";
    const result = await mutate((store) => {
      const list = store[kind];
      if (!Array.isArray(list)) return fail("That one stayed put.");
      const item = list.find((entry) => entry.id === id);
      if (!item) return fail("That one already left.");
      storedName = item.file || "";
      store[kind] = list.filter((entry) => entry.id !== id);
      return null;
    });
    if (storedName && (kind === "photos" || kind === "files")) {
      const folder = kind === "photos" ? "photos" : "files";
      await st.deleteObject(st.ref(storage, `${folder}/${storedName}`)).catch(() => {});
    }
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
    upload,
    remove
  };
})();
