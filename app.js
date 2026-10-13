(() => {
  "use strict";

  const TABLE = "list_items";

  // Roughly the order you walk a Trader Joe's; unknown categories land before "Other".
  const CATEGORY_ORDER = [
    "Fresh Fruits & Veggies", "Flowers & Plants", "Bakery", "Fresh Prepared Foods",
    "Dips, Sauces & Dressings", "Cheese", "Dairy & Eggs", "Meat, Seafood & Plant-based",
    "For the Pantry", "Snacks & Sweets", "Coffee & Tea", "Juices & More", "Non-Dairy Bev",
    "Sodas & Mixers", "Water (Sparkling & Still)", "Wine, Beer & Liquor", "From The Freezer",
    "Household Essentials", "For the Face & Body", "Pet Stuff", "Nutritional Supplements",
  ];

  const LS = { items: "tj.items.v1", pending: "tj.pending.v1", custom: "tj.custom.v1", password: "tj.editPassword.v1" };
  const MAX_SUGGESTIONS = 8;

  const $ = (id) => document.getElementById(id);
  const els = {
    q: $("q"), sugg: $("suggestions"), list: $("list"), done: $("done"),
    doneItems: $("done-items"), doneCount: $("done-count"), clear: $("clear"), sync: $("sync"),
    account: $("account"), viewonly: $("viewonly"),
    viewonlySignin: $("viewonly-signin"), signin: $("signin"), signinForm: $("signin-form"),
    password: $("password"), signinError: $("signin-error"),
  };

  // ---------- Local storage (wrapped: private mode can throw) ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ---------- State ----------
  // items: what the list looks like on this phone (server state + unsynced local changes).
  // pending: local changes not yet confirmed by Supabase, replayed in order.
  let items = new Map(load(LS.items, []).map((i) => [i.id, i]));
  let pending = load(LS.pending, []);
  let custom = load(LS.custom, []); // [{ n, c }] items typed in that aren't in the catalog
  let pool = [];                     // searchable products: custom + catalog
  let catalog = [];
  // The shared editing password, remembered on this phone. The database checks it on every change.
  let editPassword = load(LS.password, "");
  let canEdit = !!editPassword;

  let flushing = false, pulling = false, syncError = null;

  const persist = () => { save(LS.items, [...items.values()]); save(LS.pending, pending); };
  const opId = (op) => (op.kind === "delete" ? op.id : op.item.id);

  function apply(map, op) {
    if (op.kind === "delete") map.delete(op.id);
    else map.set(op.item.id, { ...map.get(op.item.id), ...op.item });
  }

  // ---------- Supabase sync ----------
  const cfg = window.TJ_CONFIG;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const toRow = (i) => ({ id: i.id, name: i.name, category: i.category, checked: i.checked, created_at: i.created_at });
  const WRONG_PASSWORD = "28P01"; // raised by save_item/delete_item in supabase/password.sql

  // Network failures, auth problems, a missing table, or server errors are worth retrying later;
  // anything else means Supabase rejected this specific change, so drop it rather than block the queue.
  function retryable(res) {
    const s = res.status;
    return !s || s >= 500 || [401, 403, 404, 408, 429].includes(s);
  }

  function queue(op) {
    pending = pending.filter((p) => opId(p) !== opId(op)); // newest change per item wins
    pending.push(op);
    apply(items, op);
    persist();
    render();
    flush();
  }

  async function flush() {
    if (flushing || !canEdit) return;
    flushing = true;
    updateStatus();
    try {
      while (pending.length) {
        const op = pending[0];
        const res = op.kind === "delete"
          ? await db.rpc("delete_item", { pw: editPassword, item_id: op.id })
          : await db.rpc("save_item", {
            pw: editPassword, item_id: op.item.id, item_name: op.item.name, item_category: op.item.category,
            item_checked: op.item.checked, item_created_at: op.item.created_at,
          });
        if (res.error?.code === WRONG_PASSWORD) { setPassword(""); break; } // password was changed
        if (res.error) {
          if (retryable(res)) { syncError = res.error; break; }
          console.warn("Supabase rejected a change; dropping it", res.error, op);
        } else {
          syncError = null;
        }
        pending = pending.filter((p) => p !== op);
        persist();
      }
    } finally {
      flushing = false;
      updateStatus();
    }
  }

  async function pull() {
    if (pulling) return;
    pulling = true;
    updateStatus();
    try {
      const { data, error } = await db.from(TABLE)
        .select("id,name,category,checked,created_at")
        .order("created_at");
      if (error) { syncError = error; return; }
      const next = new Map(data.map((r) => [r.id, r]));
      for (const op of pending) apply(next, op);
      items = next;
      syncError = null;
      persist();
      render();
    } finally {
      pulling = false;
      updateStatus();
    }
  }

  async function fullSync() {
    await flush();
    await pull();
  }

  // Live updates. iOS drops the connection when the app is backgrounded, and a channel that
  // errored doesn't always rejoin by itself, so tear it down and resubscribe when that happens.
  let channel = null, resubscribeTimer = null;

  function subscribe() {
    clearTimeout(resubscribeTimer);
    const old = channel;
    channel = null;
    if (old) db.removeChannel(old);
    const ch = db.channel("list_items")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (p) => {
        const id = p.eventType === "DELETE" ? p.old.id : p.new.id;
        if (!id || pending.some((op) => opId(op) === id)) return; // our own unsynced change wins
        if (p.eventType === "DELETE") items.delete(id);
        else items.set(id, toRow(p.new));
        persist();
        render();
      })
      .subscribe((status) => {
        if (ch !== channel) return; // a replaced channel reporting in
        if (status === "SUBSCRIBED") pull();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(resubscribeTimer);
          resubscribeTimer = setTimeout(subscribe, 5000);
        }
      });
    channel = ch;
  }

  function ensureLive() {
    if (!channel || channel.state !== "joined") subscribe();
  }

  function updateStatus() {
    let state = "ok", label = "Synced";
    const n = pending.length;
    if (!navigator.onLine) { state = "offline"; label = n ? `Offline · ${n} unsynced` : "Offline"; }
    else if (flushing || pulling) { state = "busy"; label = "Syncing…"; }
    else if (syncError) { state = "error"; label = n ? `Not synced · ${n}` : "Not synced"; }
    else if (n) { state = "busy"; label = "Syncing…"; }
    els.sync.dataset.state = state;
    els.sync.querySelector(".label").textContent = label;
    els.sync.title = syncError ? `${syncError.message || syncError}\nTap to retry` : "Tap to sync now";
  }

  // ---------- List actions ----------
  const findByName = (name) => {
    const k = name.toLowerCase();
    for (const i of items.values()) if (i.name.toLowerCase() === k) return i;
    return null;
  };

  function addItem(name, category) {
    if (!canEdit) return;
    name = name.trim().replace(/\s+/g, " ");
    if (!name) return;
    const existing = findByName(name);
    if (existing) {
      if (existing.checked) queue({ kind: "upsert", item: { ...existing, checked: false } });
      flash(existing.id);
      return;
    }
    const item = { id: uuid(), name, category: category || "Other", checked: false, created_at: new Date().toISOString() };
    queue({ kind: "upsert", item });
    flash(item.id);
  }

  function toggle(id) {
    if (!canEdit) return;
    const item = items.get(id);
    if (item) queue({ kind: "upsert", item: { ...item, checked: !item.checked } });
  }

  function remove(id) {
    if (canEdit && items.has(id)) queue({ kind: "delete", id });
  }

  function clearChecked() {
    if (!canEdit) return;
    const done = [...items.values()].filter((i) => i.checked);
    if (!done.length) return;
    if (!confirm(`Remove ${done.length} checked item${done.length === 1 ? "" : "s"} from the list?`)) return;
    for (const i of done) queue({ kind: "delete", id: i.id });
  }

  function flash(id) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`.item[data-id="${id}"]`);
      if (!el) return;
      el.classList.remove("flash");
      void el.offsetWidth; // restart the animation
      el.classList.add("flash");
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  // ---------- Rendering ----------
  const catRank = (c) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i >= 0 ? i : c === "Other" ? 1000 : 999;
  };

  function itemRow(item) {
    const li = document.createElement("li");
    li.className = "item" + (item.checked ? " checked" : "");
    li.dataset.id = item.id;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "toggle";
    toggleBtn.setAttribute("aria-pressed", String(item.checked));
    const box = document.createElement("span");
    box.className = "box";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name;
    toggleBtn.append(box, name);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove";
    removeBtn.setAttribute("aria-label", `Remove ${item.name}`);
    removeBtn.textContent = "×";

    li.append(toggleBtn, removeBtn);
    return li;
  }

  function render() {
    const all = [...items.values()];
    const open = all.filter((i) => !i.checked);
    const done = all.filter((i) => i.checked).sort((a, b) => a.name.localeCompare(b.name));

    const groups = new Map();
    for (const i of open) {
      const c = i.category || "Other";
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(i);
    }

    const sections = [...groups.entries()]
      .sort(([a], [b]) => catRank(a) - catRank(b) || a.localeCompare(b))
      .map(([cat, list]) => {
        const section = document.createElement("section");
        section.className = "group";
        const h = document.createElement("h2");
        h.textContent = cat;
        const ul = document.createElement("ul");
        ul.className = "items";
        list.sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((i) => ul.append(itemRow(i)));
        section.append(h, ul);
        return section;
      });

    if (!open.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      const strong = document.createElement("strong");
      strong.textContent = all.length ? "Everything's in the cart" : canEdit ? "Your list is empty" : "The list is empty";
      empty.append(strong, !canEdit ? "Nothing to buy right now."
        : all.length ? "Clear the checked items when you're done." : "Search above to add Trader Joe's items.");
      sections.push(empty);
    }

    els.list.replaceChildren(...sections);
    els.done.hidden = !done.length;
    els.doneCount.textContent = done.length ? `(${done.length})` : "";
    els.doneItems.replaceChildren(...done.map(itemRow));
  }

  // ---------- Search ----------
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’"]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const entry = (p, isCustom = false) => {
    const key = norm(p.n);
    return { n: p.n, c: p.c, key, words: key.split(" "), custom: isCustom };
  };

  function rebuildPool() {
    const seen = new Set();
    pool = [];
    for (const e of [...custom.map((p) => entry(p, true)), ...catalog]) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      pool.push(e);
    }
  }

  function search(q) {
    const nq = norm(q);
    if (!nq) return [];
    const toks = nq.split(" ");
    const hits = [];
    for (const p of pool) {
      let score;
      if (p.key.startsWith(nq)) score = 0;
      else if (toks.every((t) => p.words.some((w) => w.startsWith(t)))) score = 1;
      else if (toks.every((t) => p.key.includes(t))) score = 2;
      else continue;
      hits.push({ p, score });
    }
    hits.sort((a, b) => a.score - b.score || a.p.n.length - b.p.n.length || a.p.n.localeCompare(b.p.n));
    return hits.slice(0, MAX_SUGGESTIONS).map((h) => h.p);
  }

  let options = [];   // what's currently shown: { n, c, addCustom? }
  let active = 0;

  function showSuggestions() {
    const q = els.q.value.trim();
    if (!q) return hideSuggestions();
    const results = search(q);
    options = results.map((p) => ({ n: p.n, c: p.c }));
    if (!results.some((p) => p.key === norm(q))) options.push({ n: q, c: "Other", addCustom: true });
    active = 0;

    els.sugg.replaceChildren(...options.map((o, idx) => {
      const li = document.createElement("li");
      li.id = `opt-${idx}`;
      li.setAttribute("role", "option");
      li.dataset.idx = idx;
      const onList = !o.addCustom && findByName(o.n);
      if (o.addCustom) li.className = "s-custom";
      else if (onList && !onList.checked) li.className = "s-on-list";
      const name = document.createElement("span");
      name.className = "s-name";
      name.textContent = o.addCustom ? `Add “${o.n}”` : o.n;
      const cat = document.createElement("span");
      cat.className = "s-cat";
      cat.textContent = o.addCustom ? "Custom item" : onList && !onList.checked ? `${o.c} · on your list` : o.c;
      li.append(name, cat);
      return li;
    }));
    els.sugg.hidden = false;
    els.q.setAttribute("aria-expanded", "true");
    highlight();
  }

  function hideSuggestions() {
    els.sugg.hidden = true;
    els.sugg.replaceChildren();
    els.q.setAttribute("aria-expanded", "false");
    els.q.removeAttribute("aria-activedescendant");
    options = [];
  }

  function highlight() {
    [...els.sugg.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    const cur = els.sugg.children[active];
    if (cur) { els.q.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); }
  }

  function choose(idx) {
    const o = options[idx];
    if (!o) return;
    if (o.addCustom) {
      const name = o.n.trim().replace(/\s+/g, " ");
      if (!custom.some((p) => norm(p.n) === norm(name))) {
        custom.push({ n: name, c: "Other" });
        save(LS.custom, custom);
        rebuildPool();
      }
    }
    addItem(o.n, o.c);
    els.q.value = "";
    hideSuggestions();
    els.q.focus();
  }

  // ---------- Editing password ----------
  // Anyone can read the list; changes need the shared password. The database functions in
  // supabase/password.sql enforce that; this only decides what the UI offers.
  function setPassword(pw) {
    editPassword = pw;
    save(LS.password, pw);
    const was = canEdit;
    canEdit = !!pw;
    if (!canEdit && pending.length) { pending = []; persist(); pull(); } // changes we can no longer make
    if (canEdit && !was) flush();
    render();
    renderAccount();
  }

  // If the password was changed on another phone, drop back to view-only here.
  async function recheckPassword() {
    if (!editPassword) return;
    const { data, error } = await db.rpc("check_editor_password", { pw: editPassword });
    if (!error && data === false) setPassword("");
  }

  function renderAccount() {
    document.body.classList.toggle("view-only", !canEdit);
    els.account.textContent = canEdit ? "Sign out" : "Sign in";
    els.viewonly.hidden = canEdit;
    if (!canEdit) hideSuggestions();
  }

  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

  function openSignin() {
    showError(els.signinError, "");
    els.password.value = "";
    els.signin.showModal();
    els.password.focus();
  }

  async function signIn(e) {
    e.preventDefault();
    const pw = els.password.value;
    const btn = els.signinForm.querySelector(".primary");
    btn.disabled = true;
    showError(els.signinError, "");
    const { data, error } = await db.rpc("check_editor_password", { pw });
    btn.disabled = false;
    if (error) {
      showError(els.signinError, "Couldn't check the password. Check your connection and try again.");
      return;
    }
    if (data !== true) {
      showError(els.signinError, "That password isn't right.");
      els.password.select();
      return;
    }
    els.password.value = "";
    els.signin.close();
    setPassword(pw);
    fullSync();
  }

  function signOut() {
    if (!confirm("Sign out? You'll still be able to see the list, but not change it.")) return;
    setPassword("");
  }

  els.account.addEventListener("click", () => (canEdit ? signOut() : openSignin()));
  els.viewonlySignin.addEventListener("click", openSignin);
  els.signinForm.addEventListener("submit", signIn);
  els.signin.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => els.signin.close()));

  // ---------- Events ----------
  els.q.addEventListener("input", showSuggestions);
  els.q.addEventListener("focus", showSuggestions);
  els.q.addEventListener("blur", () => setTimeout(hideSuggestions, 150));
  els.q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && options.length) { e.preventDefault(); active = (active + 1) % options.length; highlight(); }
    else if (e.key === "ArrowUp" && options.length) { e.preventDefault(); active = (active - 1 + options.length) % options.length; highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { els.q.value = ""; hideSuggestions(); }
  });

  // Keep the keyboard up while tapping a suggestion.
  els.sugg.addEventListener("pointerdown", (e) => e.preventDefault());
  els.sugg.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-idx]");
    if (li) choose(Number(li.dataset.idx));
  });

  document.addEventListener("click", (e) => {
    const row = e.target.closest(".item");
    if (!row) return;
    if (e.target.closest(".remove")) remove(row.dataset.id);
    else if (e.target.closest(".toggle")) toggle(row.dataset.id);
  });

  els.clear.addEventListener("click", clearChecked);
  els.sync.addEventListener("click", () => { fullSync(); ensureLive(); });

  window.addEventListener("online", () => { fullSync(); ensureLive(); });
  window.addEventListener("offline", updateStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { fullSync(); ensureLive(); recheckPassword(); }
  });

  // ---------- Start ----------
  render();
  renderAccount();
  updateStatus();
  rebuildPool();
  recheckPassword();

  fetch("data/catalog.json")
    .then((r) => r.json())
    .then((data) => {
      catalog = data.map((p) => entry(p));
      rebuildPool();
      if (document.activeElement === els.q) showSuggestions();
    })
    .catch((err) => console.error("Couldn't load the product catalog", err));

  fullSync();
  subscribe();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker failed", err));
  }
})();
