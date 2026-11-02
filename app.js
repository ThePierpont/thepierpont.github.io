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
  const hide = (id) => { document.getElementById(id).hidden = true; document.querySelector(`.bar a[href="#${id}"]`)?.parentElement.remove(); };
  const ext = (url) => url && !url.startsWith("mailto:") && !url.startsWith("#") ? ' target="_blank" rel="noopener"' : "";

  const photos = S.photos || [], fits = S.fits || [], M = S.music || {}, tracks = M.tracks || [];
  const screen = S.screen || [], books = S.reading || [], log = S.log || [], C = S.contact || {};
  const links = S.links || [];

  // ---- bindings
  document.querySelectorAll("[data-bind]").forEach((el) => { const v = S[el.dataset.bind]; if (v) el.textContent = v; });
  document.querySelectorAll("[data-bind-date]").forEach((el) => { const v = S[el.dataset.bindDate]; el.dateTime = v; el.textContent = fmtDate(v, { month: "long", day: "numeric" }); });
  $("[data-bind=initial]").textContent = (S.name || "T")[0];
  $(".name").dataset.text = S.name || "";
  document.title = S.name || "Home";
  $("#year").textContent = new Date().getFullYear();

  // ---- hero
  $("#portrait").innerHTML = media(S.portrait, S.name + "portrait", `Portrait of ${S.name}`);
  $("#socials").innerHTML = links.map((l) => `<li><a href="${esc(l.url)}"${ext(l.url)}>${esc(l.label)}</a></li>`).join("");
  $("#socials").hidden = !links.length;

  // ---- live clock
  const clockFmt = (() => {
    try { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: S.timezone || undefined }); }
    catch { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }); }
  })();
  const tick = () => { const t = clockFmt.format(new Date()); document.querySelectorAll("[data-clock], #clock-small").forEach((el) => (el.textContent = t)); };

  // ---- right now board
  const song = tracks[0];
  const shot = photos[0];
  const show = screen.find((s) => s.status === "watching") || screen[0];
  const fit = fits[0];
  const book = books.find((b) => b.status === "reading") || books[0];
  const note = log[0];
  const tiles = [];
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
  if (shot) tiles.push(`
    <a class="tile t-photo" href="#photos" data-open="0">
      <div class="media">${media(shot.src, shot.caption, shot.caption)}</div>
      <div class="cap"><p class="label">Latest photo</p><h3>${esc(shot.caption)}</h3><p class="sub">${esc(shot.place || "")}</p></div>
    </a>`);
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
      <p class="label">Newest pickup</p>
      <div class="t-thumb"><div class="media">${media(fit.src, fit.item, fit.item)}</div>
      <div><h3>${esc(fit.item)}</h3><p class="sub">${esc(fit.brand || "")}</p></div></div>
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
      <div><div class="clock" data-clock></div><p class="sub">${esc(S.location || "")}</p></div>
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
  $("#facts").innerHTML = (S.facts || []).map((f) => `<div><dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd></div>`).join("");

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
      <div class="cap"><span>${esc(p.caption)}</span><span>${fmtDate(p.date, { month: "short", year: "numeric" })}</span></div>
    </button>`).join("");
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
  const addNostrPhotos = (list) => {
    if (!list.length) return;
    const known = new Set(gallery.map((p) => p.src));
    gallery = gallery.concat(list.filter((p) => !known.has(p.src))).sort((a, b) => b.ts - a.ts);
    renderGallery();
    const p = gallery[0], tile = $(".t-photo");
    if (tile && p.nostr) tile.innerHTML = `
      <div class="media">${media(p.src, p.caption, p.caption || "Latest photo")}</div>
      <div class="cap"><p class="label">Latest photo</p><h3>${esc(p.caption || "New on Nostr")}</h3><p class="sub">${fmtDate(p.date, { month: "short", day: "numeric" })}</p></div>`;
  };
  const lb = $("#lightbox");
  let cur = 0;
  const show_ = (i) => {
    cur = (i + gallery.length) % gallery.length;
    const p = gallery[cur];
    $("#lb-img").innerHTML = media(p.src, p.caption || p.src, p.caption || "Photo", p.ratio);
    $("#lb-cap").innerHTML = esc([p.caption, p.place, fmtDate(p.date)].filter(Boolean).join(", ")) +
      (p.link ? ` <a href="${esc(p.link)}" target="_blank" rel="noopener">View on Primal ↗</a>` : "");
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]"); if (!b) return;
    e.preventDefault(); show_(+b.dataset.open); lb.showModal();
  });
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

  // ---- last.fm: live "Now playing" tile (checked every 30s) + top tracks for "On repeat"
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

    const renderNowPlaying = (t) => {
      const tile = $(".t-play");
      if (!tile) return;
      const live = t["@attr"]?.nowplaying === "true";
      tile.innerHTML = `
        <div class="art media">${media(art(t.image), t.name + t.artist["#text"], `${t.name} cover art`)}</div>
        <div class="info">
          <p class="label${live ? "" : " idle"}"><span class="eq${live ? "" : " idle"}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${live ? "Now playing" : `Last played, ${ago(+t.date.uts)}`}</p>
          <h3><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a></h3>
          <p class="sub">${esc(t.artist["#text"])}</p>
        </div>`;
    };
    const pollRecent = async (limit) => {
      const list = [].concat((await lfm("user.getrecenttracks", `&limit=${limit}`)).recenttracks.track || []);
      list.forEach((t) => { const u = art(t.image); if (u) artCache.set(key(t.artist["#text"], t.name), u); });
      if (list[0]) renderNowPlaying(list[0]);
    };
    const loadTop = async () => {
      // Fall back to longer periods while there isn't much history yet.
      let top = [], period;
      for (period of ["7day", "1month", "overall"]) {
        top = [].concat((await lfm("user.gettoptracks", `&period=${period}&limit=8`)).toptracks.track || []);
        if (top.length >= 5) break;
      }
      if (!top.length) return;
      await Promise.all(top.map(async (t) => {
        const k = key(t.artist.name, t.name);
        if (artCache.has(k)) return;
        try {
          const info = await lfm("track.getInfo", `&artist=${encodeURIComponent(t.artist.name)}&track=${encodeURIComponent(t.name)}&autocorrect=1`);
          const u = art(info.track?.album?.image);
          if (u) artCache.set(k, u);
        } catch {}
      }));
      const when = { "7day": "this week", "1month": "this month", overall: "all time" }[period];
      renderTracks(top.map((t) => ({
        src: artCache.get(key(t.artist.name, t.name)) || "",
        title: t.name, artist: t.artist.name, link: t.url,
        note: `${t.playcount} ${+t.playcount === 1 ? "play" : "plays"} ${when}`,
      })), "↗", "Open on Last.fm:");
      const src = $("#music-source");
      src.textContent = `Most played ${when}, via Last.fm ↗`; src.href = profile; src.hidden = false;
    };

    pollRecent(200).then(loadTop).catch((e) => console.warn("last.fm:", e.message));
    setInterval(() => { if (!document.hidden) pollRecent(1).catch(() => {}); }, 30000);
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
        <div><h3>${esc(b.title.split(":")[0])}</h3><p class="sub">${esc(b.author)} ${rating(b.rating)}</p></div></div>`;
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
        <div><h3>${esc(d.title)}</h3><p class="sub">${d.rating ? `<span class="stars">${stars(d.rating)}</span>` : esc(d.year)}${d.liked ? '<span class="heart" aria-label="Liked">♥</span>' : ""}</p></div></div>`;
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
      <div class="actions"><a class="btn btn-violet" href="${href}" target="_blank" rel="noopener">Find me on Primal</a>${profile?.lud16 ? '<button class="btn btn-zap open-zap" type="button">⚡ Zap</button>' : ""}<button class="btn copy-npub" type="button">Copy npub</button></div>`;
    card.querySelector(".copy-npub").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(npub); e.target.textContent = "Copied"; }
      catch { e.target.textContent = "Couldn't copy"; }
      setTimeout(() => (e.target.textContent = "Copy npub"), 2000);
    });
    const soc = $("#socials");
    if (!soc.querySelector(".nostr-link")) soc.insertAdjacentHTML("afterbegin", `<li><a class="nostr-link" target="_blank" rel="noopener">Nostr</a></li>`);
    soc.querySelector(".nostr-link").href = href;
    const notesSrc = $("#notes-source"); if (!notesSrc.hidden) notesSrc.href = href;
    if (profile?.lud16 && !soc.querySelector(".open-zap")) soc.querySelector(".nostr-link").parentElement.insertAdjacentHTML("afterend", '<li><a class="open-zap" href="#">⚡ Zap</a></li>');
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
    const posts = notes.slice(0, 8).map(parse);
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
      tile.innerHTML = `<p class="label">Latest note, ${fmtDate(iso(first.date), { month: "short", day: "numeric" })}</p><h3>${esc(head.slice(0, 70))}</h3>${rest.join(" ").trim() ? `<p>${esc(rest.join(" ").trim().slice(0, 160))}</p>` : ""}`;
    }
  };
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
    return [...urls].map((src) => ({ src, caption, date, ts: ev.created_at * 1000, link, nostr: true }));
  };
  window.addEventListener("DOMContentLoaded", () => initNostr().catch((e) => console.warn("nostr:", e)));

  const say = (t, err) => { smsg.textContent = t; smsg.className = "form-status" + (err ? " err" : ""); };
  $("#status-edit-open").addEventListener("click", () => { sform.status.value = statusEl.textContent; say(""); dlg.showModal(); });
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

  // ---- nav: mobile menu + current section
  const toggle = $(".menu"), list = $("#nav-list");
  toggle.addEventListener("click", () => { const o = list.classList.toggle("open"); toggle.setAttribute("aria-expanded", o); });
  list.addEventListener("click", (e) => { if (e.target.closest("a")) { list.classList.remove("open"); toggle.setAttribute("aria-expanded", false); } });
  const navLinks = [...list.querySelectorAll("a")];
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main section[id]").forEach((s) => io.observe(s));
})();
