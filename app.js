// Renders the page from window.SITE (content.js). You shouldn't need to edit this.
(function () {
  const S = window.SITE || {};
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Placeholder art gets a stable hue per item, kept in the cyan→violet→magenta range.
  const hue = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 997; return 185 + (h % 160); };
  const media = (src, key, alt, ratio) => src
    ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`
    : `<div class="ph" style="--h:${hue(key)};${ratio ? `--r:${esc(ratio)}` : ""}" role="img" aria-label="${esc(alt)}"></div>`;
  const fmtDate = (d, opts = { month: "short", day: "numeric", year: "numeric" }) => {
    if (!d) return "";
    const t = new Date(d + "T00:00:00");
    return isNaN(t) ? esc(d) : t.toLocaleDateString(undefined, opts);
  };
  const rating = (n) => n ? `<span class="rating" role="img" aria-label="Rated ${n} out of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>` : "";
  const hide = (id) => { document.getElementById(id).hidden = true; };
  const ext = (url) => url && !url.startsWith("mailto:") && !url.startsWith("#") ? ' target="_blank" rel="noopener"' : "";

  const photos = S.photos || [], fits = S.fits || [], M = S.music || {}, tracks = M.tracks || [];
  const screen = S.screen || [], books = S.reading || [], log = S.log || [], C = S.contact || {};
  const links = S.links || [];

  // ---- bindings
  document.querySelectorAll("[data-bind]").forEach((el) => { const v = S[el.dataset.bind]; if (v) el.textContent = v; });
  document.querySelectorAll("[data-bind-date]").forEach((el) => { const v = S[el.dataset.bindDate]; el.dateTime = v; el.textContent = fmtDate(v, { month: "long", day: "numeric" }); });
  $(".name").dataset.text = S.name || "";
  document.title = S.name || "Home";
  $("#year").textContent = new Date().getFullYear();

  // ---- hero
  $("#portrait").innerHTML = media(S.portrait, S.name + "portrait", `Portrait of ${S.name}`);
  $("#socials").innerHTML = links.map((l) => `<li><a href="${esc(l.url)}"${ext(l.url)}>${esc(l.label)}</a></li>`).join("");
  // "Play me": opens Chess.com's new-game screen with you already picked as the opponent.
  // It goes last; the Nostr and Zap me buttons are added in front of it once your profile loads.
  if (S.chess?.username) $("#socials").insertAdjacentHTML("beforeend", `
    <li><a class="chess-link" href="https://www.chess.com/play/online/new?opponent=${encodeURIComponent(S.chess.username)}" target="_blank" rel="noopener">
      <svg class="king" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 1h2v2.5h2.5v2H13V8h-2V5.5H8.5v-2H11z"/><path d="M6.5 9.5h11l-2 7.5h-7z"/><path d="M6 18h12v2H6zM4.5 21h15v2h-15z"/></svg>Play me</a></li>`);
  // The 3D apartment (house.html), behind a door code for now.
  $("#socials").insertAdjacentHTML("beforeend", `<li><a class="tour-link" href="house"><svg class="king" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 2 10h3v11h5v-6h4v6h5V10h3z"/></svg>Apartment tour</a></li>`);
  $("#socials").hidden = !$("#socials").children.length;

  // ---- live clock
  const clockFmt = (() => {
    try { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: S.timezone || undefined }); }
    catch { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }); }
  })();
  const dayFmt = (() => {
    try { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: S.timezone || undefined }); }
    catch { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }); }
  })();
  const tick = () => {
    const now = new Date(), t = clockFmt.format(now);
    document.querySelectorAll("[data-clock], #clock-small").forEach((el) => (el.textContent = t));
    document.querySelectorAll("[data-today]").forEach((el) => (el.textContent = dayFmt.format(now)));
  };

  // ---- right now board
  const song = tracks[0];
  const shot = photos[0];
  const show = screen.find((s) => s.status === "watching") || screen[0];
  const fit = fits[0];
  const book = books.find((b) => b.status === "reading") || books[0];
  const note = log[0];
  const tiles = [];
  // Latest photo: a wide banner across the top of the board, with its date and how to see the rest.
  const camera = (S.facts || []).find((f) => /shoot/i.test(f.k))?.v || "";
  const photoTile = (p, count) => `
      <div class="media">${media(p.src, p.caption, p.caption || "Latest photo")}</div>
      <div class="cap">
        <p class="label">Latest photo${p.date ? `, ${fmtDate(p.date, { month: "short", day: "numeric" })}` : ""}${p.place ? ` · ${esc(p.place)}` : ""}</p>
        <p class="more-info">${count} photo${count === 1 ? "" : "s"}${camera ? ` · Shot on ${esc(camera)}` : ""}<span class="go">See all ↓</span></p>
      </div>`;
  const shortDate = (d) => fmtDate(d, { month: "short", day: "numeric" });
  if (song) tiles.push(`
    <article class="tile t-play">
      <div class="art media">${media(song.src, song.title + song.artist, `${song.title} cover art`)}</div>
      <div class="info">
        <p class="label"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Now playing</p>
        <h3>${song.link ? `<a href="${esc(song.link)}"${ext(song.link)}>${esc(song.title)}</a>` : esc(song.title)}</h3>
        <p class="sub">${esc(song.artist)}</p>
      </div>
    </article>`);
  else if (S.lastfm?.user) tiles.push(`
    <article class="tile t-play">
      <div class="art media">${media("", "lastfm", "")}</div>
      <div class="info"><p class="label idle"><span class="eq idle" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Now playing</p><h3>Checking Last.fm…</h3></div>
    </article>`);
  if (shot) tiles.unshift(`<a class="tile t-photo" href="#photos" data-open="0">${photoTile(shot, photos.length)}</a>`);
  if (show) tiles.push(`
    <a class="tile t-watch" href="#watching">
      <p class="label">${show.status === "watching" ? "Watching" : "Last watched"}</p>
      <div class="t-thumb"><div class="media">${media(show.src, show.title, show.title)}</div>
      <div><h3>${esc(show.title)}</h3><p class="sub">${esc(show.note || show.year || "")}</p></div></div>
    </a>`);
  else if (S.trakt?.user || S.connectors?.letterboxd) tiles.push(`
    <a class="tile t-watch" href="#watching"><p class="label">Watching</p><h3>Checking…</h3></a>`);
  if (fit) tiles.push(`
    <a class="tile t-fit" href="#closet">
      <p class="label">Newest pickup${fit.date ? `, ${shortDate(fit.date)}` : ""}</p>
      <div class="t-thumb"><div class="media">${media(fit.src, fit.item, fit.item)}</div>
      <div><h3>${esc(fit.item)}</h3><p class="sub">${esc(fit.brand || "")}</p></div></div>
      <div class="extra-row">${fit.tag ? `<span class="chip">${esc(fit.tag)}</span>` : ""}${fits.length > 1 ? `<span class="sub">+${fits.length - 1} more in the closet</span>` : ""}</div>
    </a>`);
  if (book) tiles.push(`
    <a class="tile t-read" href="#notes">
      <p class="label">${book.status === "reading" ? "Reading" : "Last read"}</p>
      <h3>${esc(book.title)}</h3><p class="sub">${esc(book.author)}</p>
    </a>`);
  else if (S.connectors?.goodreads) tiles.push(`
    <a class="tile t-read" href="#notes"><p class="label">Reading</p><h3>Checking Goodreads…</h3></a>`);
  if (note) tiles.push(`
    <a class="tile t-note" href="#notes">
      <p class="label">Latest note, ${fmtDate(note.date, { month: "short", day: "numeric" })}</p>
      <h3>${esc(note.title)}</h3><p>${esc(note.body)}</p>
    </a>`);
  else if (S.nostr?.npub) tiles.push(`
    <a class="tile t-note" href="#notes"><p class="label">Latest note</p><h3>Checking Nostr…</h3></a>`);
  tiles.push(`
    <div class="tile t-place">
      <p class="label">Local time</p>
      <div><div class="clock" data-clock></div><p class="sub">${esc(S.location || "")} · <span data-today></span></p></div>
    </div>`);
  if (S.bitcoin?.show) tiles.push(`
    <a class="tile t-btc" href="https://mempool.space" target="_blank" rel="noopener" aria-label="Bitcoin network stats on mempool.space">
      <div class="btc-block">
        <p class="label">Bitcoin block height</p>
        <div class="height" id="btc-height">…</div>
        <p class="sub" id="btc-ago"></p>
      </div>
      <div class="btc-price">
        <p class="label">Price</p>
        <div class="price"><span id="btc-price">…</span><span class="chg" id="btc-chg"></span></div>
        <svg class="spark" id="btc-spark" viewBox="0 0 200 48" preserveAspectRatio="none" role="img" aria-label="Price over the last 7 days"></svg>
      </div>
      <dl class="btc-stats">
        <div><dt>Sats per ${esc(S.bitcoin.currency === "USD" ? "dollar" : S.bitcoin.currency)}</dt><dd id="btc-sats">…</dd></div>
        <div><dt>Fees</dt><dd id="btc-fees">…</dd></div>
        <div><dt>Next halving</dt><dd id="btc-halving">…</dd></div>
      </dl>
    </a>`);
  $("#bento").innerHTML = tiles.join("");
  document.querySelectorAll(".tile").forEach((t, i) => t.style.setProperty("--i", i));
  tick(); setInterval(tick, 15000);

  // ---- bitcoin strip (mempool.space): height/price/fees every 30s, 7-day trend every 30 min
  if (S.bitcoin?.show) {
    const cur = S.bitcoin.currency || "USD";
    const api = (p) => fetch(`https://mempool.space/api${p}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 });
    const HALVING = 210000;
    let tipTime = 0, lastPrice = 0, dayAgo = 0;

    const showAgo = () => {
      if (!tipTime) return;
      const m = Math.floor((Date.now() / 1000 - tipTime) / 60);
      $("#btc-ago").textContent = m < 1 ? "New block just now" : `Last block ${m} min ago`;
    };
    const showChange = () => {
      if (!lastPrice || !dayAgo) return;
      const pct = ((lastPrice - dayAgo) / dayAgo) * 100;
      const el = $("#btc-chg");
      el.textContent = `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% today`;
      el.className = "chg " + (pct >= 0 ? "up" : "down");
    };
    const live = async () => {
      const [blocks, prices, fees] = await Promise.all([api("/v1/blocks"), api("/v1/prices"), api("/v1/fees/recommended")]);
      const tip = blocks[0];
      tipTime = tip.timestamp;
      const left = Math.ceil((tip.height + 1) / HALVING) * HALVING - tip.height;
      const eta = new Date(Date.now() + left * 600000).toLocaleDateString(undefined, { month: "short", year: "numeric" });
      $("#btc-height").textContent = tip.height.toLocaleString();
      $("#btc-halving").innerHTML = `~${esc(eta)}<small>${left.toLocaleString()} blocks</small>`;
      lastPrice = prices[cur];
      $("#btc-price").textContent = money(lastPrice);
      $("#btc-sats").textContent = Math.round(1e8 / lastPrice).toLocaleString();
      $("#btc-fees").textContent = `${fees.fastestFee} sat/vB`;
      showAgo(); showChange();
    };
    const trend = async () => {
      // Hourly-rounded timestamps so the browser can reuse responses.
      const hour = Math.floor(Date.now() / 3600000) * 3600;
      const days = [7, 6, 5, 4, 3, 2, 1].map((d) => hour - d * 86400);
      const pts = (await Promise.all(days.map((t) => api(`/v1/historical-price?currency=${cur}&timestamp=${t}`).then((r) => r.prices[0]?.[cur]))))
        .filter(Boolean);
      dayAgo = pts[pts.length - 1];
      if (lastPrice) pts.push(lastPrice);
      if (pts.length < 2) return;
      const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
      const xy = pts.map((p, i) => [(i / (pts.length - 1)) * 200, 44 - ((p - lo) / span) * 40]);
      const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      $("#btc-spark").innerHTML = `
        <polygon class="area" points="0,48 ${line} 200,48"></polygon>
        <polyline class="line" points="${line}"></polyline>`;
      showChange();
    };
    live().then(trend).catch((e) => console.warn("mempool:", e.message));
    setInterval(() => { if (!document.hidden) live().catch(() => {}); }, 30000);
    setInterval(() => { if (!document.hidden) trend().catch(() => {}); }, 1800000);
    setInterval(showAgo, 15000);
  }

  // ---- about
  $("#about-body").innerHTML = (S.about || []).map((p) => `<p>${esc(p)}</p>`).join("");
  $("#about-body").hidden = !(S.about || []).length;
  // ↗ = opens another site, ↓ = jumps to a section of this page.
  const factValue = (f) => f.url ? `<a href="${esc(f.url)}"${ext(f.url)}>${esc(f.v)} ${f.url.startsWith("#") ? "↓" : "↗"}</a>`
    : f.album ? `<button type="button" class="fact-album" data-album="${esc(f.album)}">${esc(f.v)}<span class="sr"> (open the ${esc(f.k.toLowerCase())} photo album)</span></button>`
    : esc(f.v);
  $("#facts").innerHTML = (S.facts || []).map((f) => `<div${f.url || f.album ? ' class="linked"' : ""}><dt>${esc(f.k)}</dt><dd>${factValue(f)}</dd></div>`).join("");

  // ---- "See all" folding: show the first few items, expand on request.
  // Re-run the returned function after the list re-renders.
  const fold = (box, btn, { wide, narrow, noun }) => {
    const mq = matchMedia("(max-width: 560px)");
    let open = false;
    const apply = () => {
      const kids = [...box.children], limit = mq.matches ? narrow : wide;
      kids.forEach((k, i) => k.classList.toggle("extra", i >= limit));
      box.classList.toggle("folded", !open);
      btn.hidden = kids.length <= limit;
      btn.textContent = open ? "Show fewer" : `See all ${kids.length} ${noun}`;
      btn.setAttribute("aria-expanded", open);
    };
    btn.addEventListener("click", () => {
      open = !open;
      apply();
      if (!open) box.scrollIntoView({ block: "start" }); // collapsing: jump back to the top of the list
    });
    mq.addEventListener("change", apply);
    return apply;
  };

  // ---- photos + lightbox
  // `gallery` starts as the photos in content.js; photos posted on Nostr get merged in by date.
  let gallery = photos.map((p) => ({ ...p, ts: Date.parse((p.date || "1970-01-01") + "T12:00:00") }));
  if (!photos.length && !S.nostr?.npub) hide("photos");
  const foldGallery = fold($("#gallery"), $("#gallery-more"), { wide: 9, narrow: 6, noun: "photos" });
  const renderGallery = () => {
    gallery = gallery.filter((p) => !p.broken);
    $("#photos").hidden = !gallery.length;
    $("#photos-count").textContent = `${gallery.length} ${gallery.length === 1 ? "shot" : "shots"}`;
    $("#gallery").innerHTML = gallery.map((p, i) => `
    <button class="shot" data-open="${i}" aria-label="Open photo: ${esc(p.caption || "photo")}">
      <div class="media">${media(p.src, p.caption || p.src, p.caption || "Photo", p.ratio)}</div>
    </button>`).join(""); // captions stay as alt text only, no visible description
    foldGallery();
  };
  // Old Nostr images sometimes vanish from their hosts; drop any that fail to load.
  $("#gallery").addEventListener("error", (e) => {
    const shot = e.target.closest?.(".shot");
    if (!shot) return;
    gallery[+shot.dataset.open].broken = true;
    renderGallery();
  }, true);
  renderGallery();
  // Media hosts (Blossom, nostr.build) name files by their SHA-256, so the same file
  // re-posted, or mirrored on another host, shares that 64-character code.
  const fileKey = (src) => (src.match(/[0-9a-f]{64}/i)?.[0] || src).toLowerCase();
  const hidden = new Set((S.nostr?.hidePhotos || []).map(fileKey));
  const addNostrPhotos = (list) => {
    if (!list.length) return;
    const known = new Set(gallery.map((p) => fileKey(p.src)));
    const fresh = list.filter((p) => {
      const k = fileKey(p.src);
      if (hidden.has(k) || known.has(k)) return false;
      known.add(k);
      return true;
    });
    gallery = gallery.concat(fresh).sort((a, b) => b.ts - a.ts);
    renderGallery();
    const p = gallery[0], tile = $(".t-photo");
    if (tile) tile.innerHTML = photoTile(p, gallery.length);
  };
  const lb = $("#lightbox");
  let cur = 0, lbList = gallery; // the viewer steps through either the whole wall or one album
  const show_ = (i) => {
    cur = (i + lbList.length) % lbList.length;
    const p = lbList[cur];
    $("#lb-img").innerHTML = media(p.src, p.caption || p.src, p.caption || "Photo", p.ratio);
    $("#lb-cap").innerHTML = esc(fmtDate(p.date)) +
      (p.link ? ` <a href="${esc(p.link)}" target="_blank" rel="noopener">View on Primal ↗</a>` : "");
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]"); if (!b) return;
    e.preventDefault(); lbList = gallery; show_(+b.dataset.open); lb.showModal();
  });

  // ---- albums (e.g. Cats): every photo on the wall tagged for that album, in a grid
  const albums = S.albums || {};
  const inAlbum = (p, name) => p.album === name ||
    (p.hashtags || []).some((h) => (albums[name]?.hashtags || []).includes(h.toLowerCase()));
  const albumDlg = $("#album");
  let albumList = [];
  const openAlbum = (name) => {
    albumList = gallery.filter((p) => inAlbum(p, name));
    $("#album-h").textContent = albums[name]?.title || name;
    $("#album-count").textContent = `${albumList.length} ${albumList.length === 1 ? "photo" : "photos"}`;
    $("#album-grid").innerHTML = albumList.length ? albumList.map((p, i) => `
      <button class="album-shot" data-album-i="${i}" aria-label="Open photo: ${esc(p.caption || "photo")}">
        ${media(p.src, p.caption || p.src, p.caption || "Photo")}
      </button>`).join("") : `<p class="album-empty">No photos in this album yet.</p>`;
    albumDlg.showModal();
  };
  document.addEventListener("click", (e) => {
    const f = e.target.closest(".fact-album");
    if (f) return openAlbum(f.dataset.album);
    const a = e.target.closest("[data-album-i]");
    if (a) { lbList = albumList; show_(+a.dataset.albumI); lb.showModal(); }
  });
  albumDlg.querySelector(".album-close").addEventListener("click", () => albumDlg.close());
  albumDlg.addEventListener("click", (e) => { if (e.target === albumDlg) albumDlg.close(); });
  lb.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => show_(cur + +b.dataset.step)));
  lb.querySelector(".lb-close").addEventListener("click", () => lb.close());
  lb.addEventListener("click", (e) => { if (e.target === lb) lb.close(); });
  lb.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") show_(cur + 1); if (e.key === "ArrowLeft") show_(cur - 1); });

  // ---- closet
  if (!fits.length) hide("closet");
  $("#fits").innerHTML = fits.map((f) => `
    <article class="fit">
      <div class="media">${media(f.src, f.item, f.item)}</div>
      <div class="row"><h3>${f.link ? `<a href="${esc(f.link)}"${ext(f.link)}>${esc(f.item)}</a>` : esc(f.item)}</h3>${f.tag ? `<span class="chip">${esc(f.tag)}</span>` : ""}</div>
      <div class="brand">${esc(f.brand || "")}${f.date ? `, ${fmtDate(f.date, { month: "short", day: "numeric" })}` : ""}</div>
      ${f.note ? `<p>${esc(f.note)}</p>` : ""}
    </article>`).join("");

  // ---- music
  const LF = S.lastfm || {};
  const hasLastfm = !!(LF.user && LF.apiKey);
  if (!tracks.length && !M.playlistEmbed && !hasLastfm) hide("music");
  const renderTracks = (list, icon = "▶", verb = "Play") => {
    $("#tracks").innerHTML = list.map((t) => `
    <li>
      <div class="media">${media(t.src, t.title + t.artist, `${t.title} cover art`)}</div>
      <div><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div>${t.note ? `<div class="n">${esc(t.note)}</div>` : ""}</div>
      ${t.link ? `<a class="play" href="${esc(t.link)}"${ext(t.link)} aria-label="${verb} ${esc(t.title)}">${icon}</a>` : "<span></span>"}
    </li>`).join("");
  };
  renderTracks(tracks);
  if (M.playlistEmbed) {
    $("#player").innerHTML = `<iframe src="${esc(M.playlistEmbed)}" title="Playlist" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
  } else {
    $("#player").hidden = true;
    $(".music").classList.add("solo");
  }

  // ---- last.fm: live "Now playing" tile + "Recently played" list (both checked every 30s)
  if (hasLastfm) {
    const lfm = (method, params = "") =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(LF.user)}&api_key=${encodeURIComponent(LF.apiKey)}&format=json${params}`)
        .then((r) => r.json())
        .then((d) => { if (d.error) throw new Error(d.message); return d; });
    // Last.fm serves this grey star when it has no art; treat it as missing.
    const art = (imgs) => { const u = (imgs || []).slice(-1)[0]?.["#text"] || ""; return u.includes("2a96cbd8b46e442fc41c2b86b821562f") ? "" : u; };
    const artCache = new Map();
    const key = (artist, name) => `${artist}|${name}`.toLowerCase();
    const ago = (uts) => {
      const s = Date.now() / 1000 - uts;
      if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
      if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
      return new Date(uts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const profile = `https://www.last.fm/user/${encodeURIComponent(LF.user)}`;

    const renderNowPlaying = (t, prev) => {
      const tile = $(".t-play");
      if (!tile) return;
      const live = t["@attr"]?.nowplaying === "true", album = t.album?.["#text"] || "";
      tile.innerHTML = `
        <div class="art media">${media(art(t.image), t.name + t.artist["#text"], `${t.name} cover art`)}</div>
        <div class="info">
          <p class="label${live ? "" : " idle"}"><span class="eq${live ? "" : " idle"}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${live ? "Now playing" : `Last played, ${ago(+t.date.uts)}`}</p>
          <h3><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a></h3>
          <p class="sub">${esc(t.artist["#text"])}${album && album !== t.name ? ` · <i>${esc(album)}</i>` : ""}</p>
          ${prev ? `<p class="before">Before that: <a href="${esc(prev.url)}" target="_blank" rel="noopener">${esc(prev.name)}</a>, ${esc(prev.artist["#text"])}</p>` : ""}
        </div>`;
    };
    // "Recently played": your latest songs, newest first, each song once.
    const renderRecent = async (list) => {
      const seen = new Set(), recent = [];
      for (const t of list) {
        const k = key(t.artist["#text"], t.name);
        if (!seen.has(k)) { seen.add(k); recent.push(t); }
        if (recent.length === 8) break;
      }
      if (!recent.length) return;
      await Promise.all(recent.map(async (t) => {
        const k = key(t.artist["#text"], t.name);
        if (artCache.has(k)) return;
        artCache.set(k, ""); // look each song up once
        try {
          const info = await lfm("track.getInfo", `&artist=${encodeURIComponent(t.artist["#text"])}&track=${encodeURIComponent(t.name)}&autocorrect=1`);
          const u = art(info.track?.album?.image);
          if (u) artCache.set(k, u);
        } catch {}
      }));
      renderTracks(recent.map((t) => ({
        src: artCache.get(key(t.artist["#text"], t.name)) || "",
        title: t.name, artist: t.artist["#text"], link: t.url,
      })), "↗", "Open on Last.fm:");
      const src = $("#music-source");
      src.textContent = "via Last.fm ↗"; src.href = profile; src.hidden = false;
    };
    const pollRecent = async (limit) => {
      const list = [].concat((await lfm("user.getrecenttracks", `&limit=${limit}`)).recenttracks.track || []);
      list.forEach((t) => { const u = art(t.image); if (u) artCache.set(key(t.artist["#text"], t.name), u); });
      if (list[0]) renderNowPlaying(list[0], list.find((x) => x.name !== list[0].name));
      await renderRecent(list);
    };

    pollRecent(50).catch((e) => console.warn("last.fm:", e.message));
    setInterval(() => { if (!document.hidden) pollRecent(50).catch(() => {}); }, 30000);
  }

  // ---- watching
  // `screenItems` starts as the hand-entered list; Trakt adds your TV shows on top.
  let screenItems = [...screen], screenFilter = "all";
  if (!screen.length && !S.trakt?.user && !S.connectors?.letterboxd) hide("watching");
  const statusText = { watching: "Watching", finished: "Finished", dropped: "Dropped", next: "Up next", watched: "Watched" };
  const renderScreen = () => {
    const types = new Set(screenItems.map((s) => s.type));
    $(".seg").hidden = types.size < 2; // filter only matters with both movies and shows
    $("#screen").hidden = $("#screen-head").hidden = !screenItems.length;
    $("#screen-head h3").textContent = types.size === 1 && types.has("show") ? "TV" : "On screen";
    $("#screen").innerHTML = screenItems.filter((s) => screenFilter === "all" || s.type === screenFilter).map((s) => {
      const pill = s.status ? `<span class="pill ${esc(s.status)}">${esc(statusText[s.status] || s.status)}</span>` : "";
      const art = `${media(s.src, s.title, `${s.title} poster`)}${pill}`;
      return `
      <article class="poster">
        ${s.link ? `<a class="media" href="${esc(s.link)}" target="_blank" rel="noopener">${art}</a>` : `<div class="media">${art}</div>`}
        <h3>${esc(s.title)}</h3>
        <div class="meta"><span>${s.type === "show" ? "Show" : "Film"}${s.year ? `, ${esc(s.year)}` : ""}</span>${rating(s.rating)}</div>
        ${s.note ? `<p>${esc(s.note)}</p>` : ""}
      </article>`;
    }).join("");
  };
  renderScreen();
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    screenFilter = b.dataset.filter;
    renderScreen();
  }));

  // ---- trakt: TV shows from your Trakt history, what's on right now, and your watchlist.
  // The Client ID is read-only and safe to be public. Your Trakt profile must be public.
  const TR = S.trakt || {};
  if (TR.user && TR.clientId) {
    const tr = (path) => fetch(`https://api.trakt.tv${path}`, {
      headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": TR.clientId },
    }).then((r) => {
      if (r.status === 204) return null; // nothing playing
      if (!r.ok) throw new Error(`Trakt answered ${r.status}`);
      return r.json();
    });
    const user = encodeURIComponent(TR.user);
    const poster = (show) => { const p = show.images?.poster?.[0]; return p ? (p.startsWith("http") ? p : `https://${p}`) : ""; };
    const ep = (e) => e ? `Season ${e.season}, episode ${e.number}` : "";
    const since = (iso) => {
      const days = (Date.now() - Date.parse(iso)) / 86400000;
      return days < 1 ? "today" : days < 2 ? "yesterday" : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    Promise.all([
      tr(`/users/${user}/watching?extended=images`).catch(() => null),
      tr(`/users/${user}/history/shows?limit=100&extended=images`),
      tr(`/users/${user}/watchlist/shows?extended=images`).catch(() => []),
    ]).then(([now, history, watchlist]) => {
      // History is newest first, so the first entry per show is the latest episode watched.
      const shows = new Map();
      for (const h of history || []) {
        const id = h.show.ids.trakt;
        if (!shows.has(id)) shows.set(id, { show: h.show, last: h.episode, at: h.watched_at });
      }
      const live = now?.type === "episode" ? now : null;
      const items = [...shows.values()].slice(0, 10).map(({ show, last, at }) => {
        const playing = live && live.show.ids.trakt === show.ids.trakt;
        const recent = Date.now() - Date.parse(at) < 30 * 86400000;
        return {
          src: poster(show), title: show.title, type: "show", year: show.year,
          status: playing || recent ? "watching" : "watched",
          note: playing ? `On now: ${ep(live.episode)}` : `${ep(last)}, ${since(at)}`,
          link: `https://trakt.tv/shows/${show.ids.slug}`,
        };
      });
      const watched = new Set(shows.keys());
      (watchlist || []).filter((w) => w.show && !watched.has(w.show.ids.trakt)).slice(0, 4).forEach((w) => items.push({
        src: poster(w.show), title: w.show.title, type: "show", year: w.show.year, status: "next",
        note: "On the watchlist", link: `https://trakt.tv/shows/${w.show.ids.slug}`,
      }));
      screenItems = items.concat(screen.filter((s) => s.type !== "show"));
      $("#watching").hidden = false;
      renderScreen();
      const src = $("#screen-source");
      src.href = `https://trakt.tv/users/${user}`; src.hidden = false;

      // Something on right now takes over the "Watching" tile.
      const tile = $(".t-watch");
      if (live && tile) {
        tile.href = `https://trakt.tv/shows/${live.show.ids.slug}`; tile.target = "_blank"; tile.rel = "noopener";
        tile.innerHTML = `
          <p class="label live"><span class="pulse" aria-hidden="true"></span>Watching now</p>
          <div class="t-thumb"><div class="media">${media(poster(live.show), live.show.title, `${live.show.title} poster`)}</div>
          <div><h3>${esc(live.show.title)}</h3><p class="sub">${esc(ep(live.episode))}</p></div></div>`;
      }
    }).catch((e) => console.warn("trakt:", e.message));
  }

  // ---- reading + notes
  const bookState = { reading: "Reading now", finished: "Finished", next: "Up next" };
  const renderBooks = (list) => {
    $("#reading-col").hidden = !list.length;
    $("#books").innerHTML = list.map((b) => {
      const title = b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.title)}</a>` : esc(b.title);
      return `
    <li class="${esc(b.status || "")}${b.src ? " has-cover" : ""}">
      ${b.src ? `<img class="cover" src="${esc(b.src)}" alt="" loading="lazy">` : ""}
      <div class="info">
        <div class="top"><span class="t">${title}</span><span class="state">${esc(bookState[b.status] || b.status || "")}</span></div>
        <div class="top"><span class="a">${esc(b.author)}</span>${rating(b.rating)}</div>
        ${b.note ? `<p>“${esc(b.note)}”</p>` : ""}
      </div>
    </li>`;
    }).join("");
  };
  renderBooks(books);
  // Goodreads (via data/feeds.json, written by connectors/fetch_feeds.py) replaces the hand-entered list.
  const renderGoodreads = (g) => {
    const list = (g.books || []).map((b) => ({ title: b.title, author: b.author, status: "finished", rating: b.rating, note: b.review, src: b.cover, link: b.link }));
    if (!list.length) return;
    renderBooks(list);
    $("#notes").hidden = false;
    const src = $("#reading-source"); src.href = g.profile; src.hidden = false;
    const b = list[0], tile = $(".t-read");
    if (tile) {
      tile.href = b.link || "#notes";
      if (b.link) { tile.target = "_blank"; tile.rel = "noopener"; }
      tile.innerHTML = `
        <p class="label">Last read</p>
        <div class="t-thumb">${b.src ? `<div class="media"><img src="${esc(b.src)}" alt=""></div>` : ""}
        <div><h3>${esc(b.title.split(":")[0])}</h3><p class="sub">${esc(b.author)} ${rating(b.rating)}</p></div></div>
        ${b.note ? `<p class="quote">“${esc(b.note)}”</p>` : ""}`;
    }
  };
  $("#log").innerHTML = log.map((n) => `
    <article class="entry"><time datetime="${esc(n.date)}">${fmtDate(n.date, { month: "short", day: "numeric", year: "numeric" })}</time><div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></div></article>`).join("");
  if (!log.length) $("#notes-col").hidden = true; // Nostr posts may fill it in once they load
  if (!books.length && !log.length && !S.nostr?.npub && !S.connectors?.goodreads) hide("notes");

  // ---- contact
  if (C.email) {
    $("#email-row").innerHTML = `<a href="mailto:${esc(C.email)}">${esc(C.email)}</a><button class="copy" type="button">Copy</button>`;
    $(".copy").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(C.email); e.target.textContent = "Copied"; }
      catch { e.target.textContent = "Couldn't copy"; }
      setTimeout(() => (e.target.textContent = "Copy"), 2000);
    });
  }
  $("#links").innerHTML = links.map((l) => `
    <li><a href="${esc(l.url)}"${ext(l.url)}><span class="k">${esc(l.label)}</span><span class="v">${esc(l.value)}</span></a></li>`).join("");

  const form = $("#contact-form"), status = $("#form-status");
  if (!C.email && !C.formEndpoint) { form.hidden = true; $(".contact").classList.add("solo"); }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "form-status";
    if (!form.checkValidity()) { status.textContent = "Add your name, a valid email, and a message."; status.classList.add("err"); return; }
    const data = new FormData(form);
    if (C.formEndpoint) {
      status.textContent = "Sending…";
      try {
        const r = await fetch(C.formEndpoint, { method: "POST", body: data, headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error();
        form.reset(); status.textContent = "Message sent. I'll get back to you.";
      } catch { status.textContent = "Message didn't send. Email me directly instead."; status.classList.add("err"); }
    } else if (C.email) {
      const body = `${data.get("message")}\n\n${data.get("name")} (${data.get("email")})`;
      location.href = `mailto:${C.email}?subject=${encodeURIComponent("Hey from your site")}&body=${encodeURIComponent(body)}`;
      status.textContent = "Opening your email app…";
    }
  });

  // ---- shelf list: every movie on the 3D shelf as plain links (screen readers, and the fallback without WebGL)
  if (window.SHELF) {
    const seenFilm = new Set();
    $("#shelf-list").innerHTML = window.SHELF.flatMap((r) => r.items).filter((it) => it.u && !seenFilm.has(it.u) && seenFilm.add(it.u))
      .map((it) => `<li><a href="${esc(it.u)}" target="_blank" rel="noopener">${esc(it.t)}</a>${it.s ? ` <span>${esc(it.s)}</span>` : ""}</li>`).join("");
  } else {
    $("#shelf3d").hidden = true;
  }

  // ---- connectors: data/feeds.json is written by connectors/fetch_feeds.py
  const stars = (r) => r ? "★".repeat(Math.floor(r)) + (r % 1 ? "½" : "") : "";
  const renderLetterboxd = (lb) => {
    const diary = lb.diary || [], lists = lb.lists || [];
    if (!diary.length && !lists.length) return;
    $("#letterboxd").hidden = false;
    $("#lb-profile").href = lb.profile;
    $("#lb-diary").innerHTML = diary.map((d) => `
      <article class="poster">
        <a class="media" href="${esc(d.link)}" target="_blank" rel="noopener" aria-label="${esc(d.title)} on Letterboxd">
          ${media(d.poster, d.title, `${d.title} poster`)}${d.rewatch ? '<span class="pill">Rewatch</span>' : ""}
        </a>
        <h3>${esc(d.title)}</h3>
        <div class="meta"><span>${esc(d.year)}</span><span>${d.rating ? `<span class="stars" aria-label="Rated ${d.rating} out of 5">${stars(d.rating)}</span>` : ""}${d.liked ? '<span class="heart" aria-label="Liked">♥</span>' : ""}</span></div>
        <p>Watched ${fmtDate(d.watched, { month: "short", day: "numeric" })}</p>
        ${d.review ? `<p class="review">“${esc(d.review)}”</p>` : ""}
      </article>`).join("");
    fold($("#lb-diary"), $("#lb-more"), { wide: 5, narrow: 4, noun: "films" })();
    $("#lb-lists-head").hidden = !lists.length;
    $("#lb-lists").innerHTML = lists.map((l) => `
      <a class="list-card" href="${esc(l.link)}" target="_blank" rel="noopener">
        <span class="count">${l.ranked ? "Ranked, " : ""}${l.count} ${l.count === 1 ? "film" : "films"}</span>
        <h4>${esc(l.title)}</h4>
        ${l.description ? `<p>${esc(l.description)}</p>` : ""}
        <ul>${l.films.map((f, i) => `<li>${l.ranked ? `<b>${i + 1}</b> ` : ""}${esc(f.title)}</li>`).join("")}${l.count > l.films.length ? `<li>+${l.count - l.films.length} more</li>` : ""}</ul>
      </a>`).join("");

    // Latest diary entry takes over the "Watching" tile at the top.
    const d = diary[0], tile = $(".t-watch");
    if (d && tile) {
      tile.href = d.link; tile.target = "_blank"; tile.rel = "noopener";
      tile.innerHTML = `
        <p class="label">Just watched</p>
        <div class="t-thumb"><div class="media">${media(d.poster, d.title, `${d.title} poster`)}</div>
        <div><h3>${esc(d.title)}</h3><p class="sub">${esc(d.year)}${d.watched ? ` · watched ${esc(fmtDate(d.watched, { month: "short", day: "numeric" }))}` : ""}</p>
        <p class="sub">${d.rating ? `<span class="stars">${stars(d.rating)}</span>` : ""}${d.liked ? '<span class="heart" aria-label="Liked">♥</span>' : ""}${d.rewatch ? '<span class="rewatch">rewatch</span>' : ""}</p></div></div>
        ${d.review ? `<p class="quote">“${esc(d.review.replace(/\s+/g, " ").trim())}”</p>` : ""}`;
    }
  };
  fetch("data/feeds.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((feeds) => {
      if (!feeds) return;
      if (feeds.letterboxd) renderLetterboxd(feeds.letterboxd);
      if (feeds.goodreads) renderGoodreads(feeds.goodreads);
      const day = (feeds.updated || "").slice(0, 10);
      if (day > (S.updated || "")) {
        const el = $("[data-bind-date=updated]");
        el.dateTime = day; el.textContent = fmtDate(day, { month: "long", day: "numeric" });
      }
    })
    .catch(() => {}); // no feeds file (or opened as a local file): the site works without it

  // ---- nostr: profile link + live status (NIP-38 "general" status, kind 30315)
  // Anyone can open the editor, but an update only goes through when it's signed by the
  // npub in content.js, and visitors only ever display events with a valid signature from it.
  const N = S.nostr || {};
  const relays = N.relays?.length ? N.relays : ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
  const statusEl = $("#status-text"), dlg = $("#status-dialog"), sform = $("#status-form"), smsg = $("#status-msg");
  let NT = null, pool = null, pubkey = null, profileMeta = null;

  const applyStatus = (ev) => {
    const exp = ev.tags.find((t) => t[0] === "expiration");
    if (exp && +exp[1] < Date.now() / 1000) return;
    statusEl.textContent = ev.content.trim() || S.status || "";
  };
  // Every Nostr link opens in Primal: profiles at /p/, posts at /e/, long-form at /a/.
  const primal = (id) => `https://primal.net/${/^(npub|nprofile)/.test(id) ? "p" : id.startsWith("naddr") ? "a" : "e"}/${id}`;
  let profileHref = "";
  const renderNostrCard = (profile) => {
    const npub = NT.nip19.npubEncode(pubkey);
    const name = profile?.display_name || profile?.name || S.name || "Me";
    // A Primal name (e.g. pierpont@primal.net) gets the short primal.net/pierpont address.
    const handle = profile?.nip05?.toLowerCase().match(/^([a-z0-9._-]+)@primal\.net$/)?.[1];
    const href = profileHref = handle && handle !== "_" ? `https://primal.net/${handle}` : primal(npub);
    const card = $("#nostr-card");
    card.hidden = false;
    card.innerHTML = `
      ${profile?.picture ? `<img class="avatar" src="${esc(profile.picture)}" alt="">` : `<span class="avatar ph" style="--h:${hue(npub)}"></span>`}
      <div class="who">${esc(name)}</div>
      <div class="npub">${npub.slice(0, 18)}…${npub.slice(-8)}</div>
      <div class="actions"><a class="btn btn-violet" href="${href}" target="_blank" rel="noopener">Find me on Primal</a>${profile?.lud16 ? '<button class="btn btn-zap open-zap" type="button">⚡ Zap me</button>' : ""}<button class="btn copy-npub" type="button">Copy npub</button></div>`;
    card.querySelector(".copy-npub").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(npub); e.target.textContent = "Copied"; }
      catch { e.target.textContent = "Couldn't copy"; }
      setTimeout(() => (e.target.textContent = "Copy npub"), 2000);
    });
    const soc = $("#socials");
    if (!soc.querySelector(".nostr-link")) soc.insertAdjacentHTML("afterbegin", `<li><a class="nostr-link" target="_blank" rel="noopener">Nostr</a></li>`);
    soc.querySelector(".nostr-link").href = href;
    const notesSrc = $("#notes-source"); if (!notesSrc.hidden) notesSrc.href = href;
    if (profile?.lud16 && !soc.querySelector(".open-zap")) soc.querySelector(".nostr-link").parentElement.insertAdjacentHTML("afterend", '<li><a class="open-zap" href="#">⚡ Zap me</a></li>');
    soc.hidden = false;
    profileMeta = profile;
  };

  // Nostr posts take over the Notes list and the "Latest note" tile. Replies are skipped.
  const IMG = /\.(jpe?g|png|gif|webp|avif)(\?|$)/i;
  const renderNotes = (notes) => {
    if (!notes.length) return;
    const npub = NT.nip19.npubEncode(pubkey);
    const parse = (ev) => {
      const imeta = new Set(ev.tags.filter((t) => t[0] === "imeta").flatMap((t) => t.filter((x) => x.startsWith("url ")).map((x) => x.slice(4))));
      const urls = ev.content.match(/https?:\/\/[^\s]+/g) || [];
      const imgs = urls.filter((u) => imeta.has(u) || IMG.test(u));
      let text = ev.content;
      imgs.forEach((u) => (text = text.split(u).join("")));
      return { imgs, text: text.replace(/\n{3,}/g, "\n\n").trim(), link: primal(NT.nip19.noteEncode(ev.id)), date: new Date(ev.created_at * 1000) };
    };
    const linkify = (t) => esc(t)
      .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 38)}${u.length > 46 ? "…" : ""}</a>`)
      .replace(/nostr:((?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+)/g, (m, id) => `<a href="${primal(id)}" target="_blank" rel="noopener">${id.slice(0, 12)}…</a>`);
    const iso = (d) => d.toISOString().slice(0, 10);
    const posts = notes.slice(0, 3).map(parse); // the three most recent; older ones live on Primal
    $("#log").innerHTML = posts.map((p) => `
      <article class="entry"><time datetime="${iso(p.date)}">${fmtDate(iso(p.date))}</time><div>
        ${p.text ? `<p class="note-text">${linkify(p.text)}</p>` : ""}
        ${p.imgs.length ? `<div class="note-imgs">${p.imgs.slice(0, 4).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join("")}</div>` : ""}
        <a class="permalink" href="${p.link}" target="_blank" rel="noopener">View on Primal ↗</a>
      </div></article>`).join("");
    $("#notes-col").hidden = false;
    $("#notes").hidden = false;
    const src = $("#notes-source"); src.href = profileHref || primal(npub); src.hidden = false;

    const first = posts[0], tile = $(".t-note");
    const plain = first.text.replace(/https?:\/\/\S+/g, "").trim();
    const [head, ...rest] = (plain || (first.imgs.length ? "New photos" : "New post")).split("\n");
    if (tile) {
      tile.href = first.link; tile.target = "_blank"; tile.rel = "noopener";
      tile.innerHTML = `<p class="label">Latest note, ${fmtDate(iso(first.date), { month: "short", day: "numeric" })}</p><h3>${esc(head.slice(0, 70))}</h3>${rest.join(" ").trim() ? `<p>${esc(rest.join(" ").trim().slice(0, 160))}</p>` : ""}
        <p class="extra-row"><span class="sub">Posted on Nostr${first.imgs.length ? ` · ${first.imgs.length} photo${first.imgs.length > 1 ? "s" : ""}` : ""}</span><span class="go">Read on Primal ↗</span></p>`;
    }
  };
  // ---- guestbook: NIP-22 comments (kind 1111) on this site's URL, signed by each visitor.
  // Every entry's signature is checked, so nobody can post under someone else's name.
  const GB = S.guestbook || {};
  const gbRoot = GB.url || location.origin + "/";
  let gbEntries = [], gbProfiles = new Map(), foldGuestbook = null;
  const gbHidden = () => new Set((GB.hide || []).map((x) => {
    try { const d = NT.nip19.decode(x.trim()); return d.type === "nevent" ? d.data.id : d.data; } catch { return x.trim(); }
  }));
  const ago = (ts) => {
    const s = Date.now() / 1000 - ts;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const renderGuestbook = () => {
    const list = $("#gb-list");
    list.innerHTML = gbEntries.length ? gbEntries.map((e) => {
      const p = gbProfiles.get(e.pubkey) || {};
      const npub = NT.nip19.npubEncode(e.pubkey);
      const name = p.display_name || p.name || `${npub.slice(0, 12)}…`;
      return `
      <li class="gb-entry${e.pubkey === pubkey ? " owner" : ""}">
        ${p.picture ? `<img class="gb-avatar" src="${esc(p.picture)}" alt="" loading="lazy">` : `<span class="gb-avatar ph" style="--h:${hue(npub)}"></span>`}
        <div>
          <div class="gb-meta"><a href="${primal(npub)}" target="_blank" rel="noopener">${esc(name)}</a>${e.pubkey === pubkey ? '<span class="chip">Me</span>' : ""}<time datetime="${new Date(e.created_at * 1000).toISOString()}">${ago(e.created_at)}</time></div>
          <p>${esc(e.content.trim())}</p>
        </div>
      </li>`;
    }).join("") : `<li class="gb-empty">No notes yet. Be the first to sign.</li>`;
    foldGuestbook ||= fold(list, $("#gb-more"), { wide: 6, narrow: 4, noun: "notes" });
    foldGuestbook();
  };
  const loadGuestbook = async () => {
    $("#guestbook").hidden = false;
    const hidden = gbHidden();
    const found = await pool.querySync(relays, { kinds: [1111], "#I": [gbRoot], limit: 200 }, { maxWait: 4000 });
    const seen = new Set();
    gbEntries = found
      .filter((e) => !seen.has(e.id) && seen.add(e.id)
        && e.tags.some((t) => t[0] === "k" && t[1] === "web") // top-level notes, not replies to notes
        && !hidden.has(e.id) && !hidden.has(e.pubkey) && e.content.trim() && NT.verifyEvent(e))
      .sort((a, b) => b.created_at - a.created_at);
    renderGuestbook();
    const authors = [...new Set(gbEntries.map((e) => e.pubkey))];
    if (!authors.length) return;
    const profiles = await pool.querySync(relays.concat("wss://purplepag.es"), { kinds: [0], authors }, { maxWait: 4000 });
    profiles.filter((e) => NT.verifyEvent(e)).sort((a, b) => a.created_at - b.created_at)
      .forEach((e) => { try { gbProfiles.set(e.pubkey, JSON.parse(e.content)); } catch {} });
    renderGuestbook();
  };

  const gbForm = $("#gb-form"), gbMsg = $("#gb-msg");
  const gbSay = (t, err) => { gbMsg.textContent = t; gbMsg.className = "form-status" + (err ? " err" : ""); };
  gbForm.msg.addEventListener("input", () => ($("#gb-count").textContent = `${gbForm.msg.value.length} / 280`));
  gbForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = gbForm.msg.value.trim();
    if (!text) return gbSay("Write something first.", true);
    if (!pool) return gbSay("The guestbook couldn't connect to Nostr. Reload and try again.", true);
    if (!window.nostr) return gbSay("Signing needs a Nostr signer: Alby or nos2x in your browser, or Nostore in Safari on iPhone. New to Nostr? Start at primal.net.", true);
    try {
      gbSay("Approve the request in your signer…");
      const signed = await window.nostr.signEvent({
        kind: 1111, created_at: Math.floor(Date.now() / 1000), content: text,
        tags: [["I", gbRoot], ["K", "web"], ["i", gbRoot], ["k", "web"], ["p", pubkey]],
      });
      if (!NT.verifyEvent(signed)) throw new Error("the signature didn't check out");
      gbSay("Posting…");
      const results = await Promise.allSettled(pool.publish(relays, signed));
      if (!results.some((r) => r.status === "fulfilled")) throw new Error("no relay accepted it, try again");
      gbEntries = [signed, ...gbEntries.filter((x) => x.id !== signed.id)];
      if (!gbProfiles.has(signed.pubkey)) {
        pool.querySync(relays.concat("wss://purplepag.es"), { kinds: [0], authors: [signed.pubkey] }, { maxWait: 4000 })
          .then((ps) => { const p = ps.filter((x) => NT.verifyEvent(x)).sort((a, b) => b.created_at - a.created_at)[0]; if (p) { try { gbProfiles.set(p.pubkey, JSON.parse(p.content)); renderGuestbook(); } catch {} } });
      }
      renderGuestbook();
      gbForm.reset(); $("#gb-count").textContent = "0 / 280";
      gbSay("Signed. Thanks for stopping by.");
    } catch (err) { gbSay(`Your note didn't post: ${err.message || err}`, true); }
  });

  const initNostr = async () => {
    NT = window.NostrTools;
    if (!N.npub || !NT) return;
    try {
      const d = NT.nip19.decode(N.npub.trim());
      if (d.type !== "npub") throw new Error();
      pubkey = d.data;
    } catch { console.warn("content.js: nostr.npub isn't a valid npub"); return; }
    pool = new NT.SimplePool();
    renderNostrCard(null);
    if (S.guestbook?.show) loadGuestbook().catch((e) => console.warn("guestbook:", e.message));
    const events = await pool.querySync(relays, { kinds: [0, 30315], authors: [pubkey] }, { maxWait: 4000 });
    const valid = events.filter((e) => e.pubkey === pubkey && NT.verifyEvent(e));
    const newest = (pred) => valid.filter(pred).sort((a, b) => b.created_at - a.created_at)[0];
    const profile = newest((e) => e.kind === 0);
    const live = newest((e) => e.kind === 30315 && e.tags.some((t) => t[0] === "d" && t[1] === "general"));
    if (profile) { try { renderNostrCard(JSON.parse(profile.content)); } catch {} }
    if (live) applyStatus(live);

    // Kind 1 = regular posts, kind 20 = picture posts (Olas and other photo apps).
    // Relays drop older posts, so Primal's archive is asked too. Its events are still checked
    // against your signature below, so nothing it returns can be faked.
    const [fromRelays, fromPrimal] = await Promise.all([
      pool.querySync(relays, { kinds: [1, 20], authors: [pubkey], limit: 100 }, { maxWait: 4000 }),
      primalHistory(pubkey).catch(() => []),
    ]);
    const seen = new Set();
    const mine = fromRelays.concat(fromPrimal.filter((e) => e.kind === 1 || e.kind === 20))
      .filter((e) => e.pubkey === pubkey && !e.tags.some((t) => t[0] === "e") && !seen.has(e.id) && seen.add(e.id) && NT.verifyEvent(e))
      .sort((a, b) => b.created_at - a.created_at);
    renderNotes(mine.filter((e) => e.kind === 1));
    // Optional `photosSince` (YYYY-MM-DD) keeps older posts' images off the wall; empty = all of them.
    const since = N.photosSince ? Date.parse(N.photosSince + "T00:00:00") / 1000 : 0;
    addNostrPhotos(mine.filter((e) => e.created_at >= since).flatMap(nostrPhotos));
  };

  // Your posts from Primal's archive (the same request Primal's profile page makes).
  const primalAuthored = (pk, limit, until) => new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://cache2.primal.net/v1");
    const sub = "site" + Math.random().toString(36).slice(2, 8), out = [];
    const done = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(out); };
    const timer = setTimeout(done, 6000);
    ws.onopen = () => ws.send(JSON.stringify(["REQ", sub, { cache: ["feed", { pubkey: pk, notes: "authored", limit, ...(until ? { until } : {}) }] }]));
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d[1] !== sub) return;
      if (d[0] === "EVENT" && d[2]?.pubkey === pk) out.push(d[2]);
      if (d[0] === "EOSE") done();
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("Primal archive unreachable")); };
  });

  // Your whole posting history, 100 posts per page, newest first (up to 500 posts).
  const primalHistory = async (pk) => {
    const all = new Map();
    let until;
    for (let i = 0; i < 5; i++) {
      const page = (await primalAuthored(pk, 100, until)).filter((e) => (e.kind === 1 || e.kind === 20) && !all.has(e.id));
      page.forEach((e) => all.set(e.id, e));
      if (page.length < 100) break;
      until = Math.min(...page.map((e) => e.created_at)) - 1;
    }
    return [...all.values()];
  };

  // Every image in a post becomes its own photo on the wall, captioned with the post's text.
  const nostrPhotos = (ev) => {
    const imeta = ev.tags.filter((t) => t[0] === "imeta").map((t) => Object.fromEntries(t.slice(1).map((x) => [x.slice(0, x.indexOf(" ")), x.slice(x.indexOf(" ") + 1)])));
    const urls = new Set(imeta.filter((m) => m.url && (!m.m || m.m.startsWith("image/"))).map((m) => m.url));
    (ev.content.match(/https?:\/\/[^\s]+/g) || []).filter((u) => IMG.test(u)).forEach((u) => urls.add(u));
    if (!urls.size) return [];
    const caption = ev.content.replace(/https?:\/\/\S+/g, "").replace(/nostr:\S+/g, "").trim().split("\n")[0].slice(0, 80);
    const date = new Date(ev.created_at * 1000).toISOString().slice(0, 10);
    const link = primal(NT.nip19.noteEncode(ev.id));
    const hashtags = ev.tags.filter((t) => t[0] === "t").map((t) => t[1].toLowerCase()); // e.g. #cats puts it in the Cats album
    return [...urls].map((src) => ({ src, caption, date, ts: ev.created_at * 1000, link, hashtags, nostr: true }));
  };
  window.addEventListener("DOMContentLoaded", () => initNostr().catch((e) => console.warn("nostr:", e)));

  const say = (t, err) => { smsg.textContent = t; smsg.className = "form-status" + (err ? " err" : ""); };
  const openStatus = () => { sform.status.value = statusEl.textContent; say(""); dlg.showModal(); };
  $("#status-edit-open").addEventListener("click", openStatus);
  // Owner shortcut: pierpont.blog/#status opens the editor directly (bookmark it on your phone).
  const statusFromHash = () => { if (location.hash === "#status") { openStatus(); history.replaceState(null, "", location.pathname + location.search); } };
  window.addEventListener("hashchange", statusFromHash);
  statusFromHash();
  $("#status-cancel").addEventListener("click", () => dlg.close());
  sform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = sform.status.value.trim();
    if (!text) return say("Type a status first.", true);
    if (!pubkey) return say("Add your npub to content.js first.", true);
    if (!window.nostr) return say("No Nostr signer found in this browser. Use a signer extension (Alby or nos2x, or Nostore in Safari on iPhone), or set your status in a Nostr app like Damus, Amethyst, or Nostrudel.", true);
    try {
      if ((await window.nostr.getPublicKey()) !== pubkey) return say("That signer isn't the Nostr account linked to this site.", true);
      say("Approve the request in your signer…");
      const signed = await window.nostr.signEvent({ kind: 30315, created_at: Math.floor(Date.now() / 1000), tags: [["d", "general"]], content: text });
      if (signed.pubkey !== pubkey || !NT.verifyEvent(signed)) throw new Error("the signature didn't check out");
      say("Publishing…");
      const results = await Promise.allSettled(pool.publish(relays, signed));
      if (!results.some((r) => r.status === "fulfilled")) throw new Error("no relay accepted it, try again");
      applyStatus(signed);
      say("Status updated.");
      setTimeout(() => dlg.close(), 900);
    } catch (err) { say(`Status didn't update: ${err.message || err}`, true); }
  });

  // ---- zaps: LNURL-pay invoice from the Lightning address on the Nostr profile (NIP-57).
  // The zap request is signed with a throwaway key, so it shows on Nostr as an anonymous zap.
  const zapDlg = $("#zap-dialog"), zform = $("#zap-form"), zpay = $("#zap-pay"), zmsg = $("#zap-msg"), zwait = $("#zap-wait");
  let lnurl = null, zapSub = null, invoice = "";
  const zsay = (t, err) => { zmsg.textContent = t; zmsg.className = "form-status" + (err ? " err" : ""); };
  const zapForm = () => { zapSub?.close(); zapSub = null; zform.hidden = false; zpay.hidden = true; zpay.classList.remove("paid"); zsay(""); };
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".open-zap")) return;
    e.preventDefault();
    zapForm(); zapDlg.showModal();
  });
  zapDlg.querySelector(".zap-close").addEventListener("click", () => zapDlg.close());
  zapDlg.addEventListener("close", () => { zapSub?.close(); zapSub = null; });
  zapDlg.addEventListener("click", (e) => { if (e.target === zapDlg) zapDlg.close(); });
  $("#zap-back").addEventListener("click", zapForm);
  zform.custom.addEventListener("input", () => zform.querySelectorAll("[name=amt]").forEach((r) => (r.checked = false)));
  zform.querySelectorAll("[name=amt]").forEach((r) => r.addEventListener("change", () => (zform.custom.value = "")));
  $("#zap-copy").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(invoice); e.target.textContent = "Copied"; }
    catch { e.target.textContent = "Couldn't copy"; }
    setTimeout(() => (e.target.textContent = "Copy invoice"), 2000);
  });
  zform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sats = Math.floor(+zform.custom.value || +(zform.querySelector("[name=amt]:checked")?.value || 0));
    if (!(sats >= 1)) return zsay("Pick an amount first.", true);
    if (!profileMeta?.lud16) return zsay("Zaps aren't set up yet.", true);
    zsay("Creating invoice…");
    try {
      if (!lnurl) {
        const [user, domain] = profileMeta.lud16.split("@");
        lnurl = await (await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`)).json();
      }
      const msats = sats * 1000;
      if (msats < lnurl.minSendable || msats > lnurl.maxSendable) throw new Error(`pick between ${Math.ceil(lnurl.minSendable / 1000)} and ${Math.floor(lnurl.maxSendable / 1000).toLocaleString()} sats`);
      const comment = zform.comment.value.trim().slice(0, lnurl.commentAllowed || 0);
      const url = new URL(lnurl.callback);
      url.searchParams.set("amount", msats);
      if (lnurl.allowsNostr && lnurl.nostrPubkey) {
        const req = NT.nip57.makeZapRequest({ profile: pubkey, event: null, amount: msats, comment, relays });
        url.searchParams.set("nostr", JSON.stringify(NT.finalizeEvent(req, NT.generateSecretKey())));
      } else if (comment) url.searchParams.set("comment", comment);
      const res = await (await fetch(url)).json();
      if (!res.pr) throw new Error(res.reason || "the wallet didn't return an invoice");
      invoice = res.pr;

      const qr = qrcode(0, "M");
      qr.addData(("lightning:" + invoice).toUpperCase(), "Alphanumeric");
      qr.make();
      $("#zap-qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: "Lightning invoice QR code" });
      $("#zap-amount").textContent = `⚡ ${sats.toLocaleString()} sats`;
      $("#zap-open").href = "lightning:" + invoice;
      zwait.textContent = "Waiting for payment…";
      zform.hidden = true; zpay.hidden = false;

      // The receipt (kind 9735) is published by the recipient's wallet once the invoice is paid.
      zapSub = pool.subscribeMany(relays, [{ kinds: [9735], "#p": [pubkey], since: Math.floor(Date.now() / 1000) - 60 }], {
        onevent(ev) {
          if (ev.pubkey !== lnurl.nostrPubkey || ev.tags.find((t) => t[0] === "bolt11")?.[1] !== invoice) return;
          zpay.classList.add("paid");
          zwait.textContent = "⚡ Received. Thank you!";
          zapSub?.close(); zapSub = null;
        },
      });
    } catch (err) { zsay(`Couldn't create an invoice: ${err.message || err}`, true); }
  });

  // ---- motion: each section rises in the first time it scrolls into view, images fade in once loaded.
  // Skipped entirely for reduced motion. The hero and its tiles have their own load-in animation.
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    document.documentElement.classList.add("motion");
    const seen = (img) => img.classList.add("ok");
    document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") seen(e.target); }, true);
    document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") seen(e.target); }, true);
    document.querySelectorAll("img").forEach((img) => { if (img.complete) seen(img); });
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -10% 0px" });
    document.querySelectorAll("main > section").forEach((s) => {
      if (s.classList.contains("hero") || s.querySelector(".tile")) return;
      s.classList.add("reveal"); io.observe(s);
    });
  }
})();
