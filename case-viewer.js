// The pulled-out movie case, shared by the 3D shelf (shelf.js) and the apartment (house.js):
// it slides off the shelf, turns to face you, spins when dragged, and its back links to my review.
// Also the shelf-photo helpers both use to find which movie is under the pointer.
import * as THREE from "three";

// ---- which movie is at a texture point on a shelf-row photo (u right, v down, both 0..1)
export const inPoly = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const columns = (row) => row._cols ||= row.items.map((it, i) => ({ it, i })).filter((c) => c.it.c !== undefined);
// Spines can lean differently across a shelf: `shear` is one number, or [lean at the left edge, lean at the right edge].
export const shearAt = (row, u) => Array.isArray(row.shear) ? row.shear[0] + (row.shear[1] - row.shear[0]) * u : row.shear;
export const lean = (row, b, vv) => [b + shearAt(row, b) * (vv - row.midV), vv];
export const bounds = (row, k) => {
  const cols = columns(row), c = cols[k].it.c;
  const left = k ? (cols[k - 1].it.c + c) / 2 : row.u[0];
  const right = k < cols.length - 1 ? (cols[k + 1].it.c + c) / 2 : row.u[1];
  return [left, right];
};
export const pick = (row, u, v) => {
  for (const it of row.items) if (it.poly && inPoly([u, v], it.poly)) return { it, zone: it.poly };
  if (v < row.v[0] || v > row.v[1]) return null;
  const cols = columns(row);
  for (let k = 0; k < cols.length; k++) {
    const [l, r] = bounds(row, k);
    // Inside this spine if we're right of its left edge and left of its right edge, both leaned to this height.
    if (u >= lean(row, l, v)[0] && u < lean(row, r, v)[0]) {
      if (cols[k].it.skip) return null; // takes up space, but isn't a movie to link
      return { it: cols[k].it, zone: [lean(row, l, row.v[0]), lean(row, r, row.v[0]), lean(row, r, row.v[1]), lean(row, l, row.v[1])] };
    }
  }
  return null;
};

// ---- pop-out case
// host: { renderer, camera, scene, touch, reduce, ui (the .case-ui element, optional), onOpen, onClose,
//         dim (how dark the scene behind an open case gets, 0..1) }
export function createCaseViewer({ renderer, camera, scene, touch = false, reduce = false, ui = null, onOpen, onClose, dim = 0.82 }) {
  // ---- pop-out 3D case: slides off the shelf, turns to face you, drag to spin it
  // Sizes in decimetres (w × h × d). The side color of standard keepcases is read from the photo.
  const CASES = {
    keep: { w: 1.35, h: 1.71, d: 0.13 }, criterion: { w: 1.36, h: 1.72, d: 0.15 },
    steel: { w: 1.36, h: 1.72, d: 0.1 }, a24: { w: 1.42, h: 1.86, d: 0.17 }, box: { w: 1.5, h: 1.9, d: 0.42 },
  };
  // The dimmer rides on the camera in the host's scene; the case lives in its own scene, drawn on top
  // in a second pass, with a pivot that follows the camera so the case can be placed in front of it.
  if (!camera.parent) scene.add(camera);
  const dimmer = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x05050a, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  dimmer.position.z = -1; dimmer.renderOrder = 20; camera.add(dimmer);
  const caseScene = new THREE.Scene(), pivot = new THREE.Object3D();
  pivot.matrixAutoUpdate = false; caseScene.add(pivot);
  caseScene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const caseLight = new THREE.PointLight(0xffffff, 0, 30); caseLight.position.set(1.5, 2, 1); pivot.add(caseLight);
  const casePink = new THREE.PointLight(0xff2a6d, 6, 20); casePink.position.set(-3, 1, -2); pivot.add(casePink);
  const caseCyan = new THREE.PointLight(0x05d9e8, 5, 20); caseCyan.position.set(3, -1.5, -2); pivot.add(caseCyan);
  const loader = new THREE.TextureLoader();
  const posterCache = new Map();
  let viewer = null; // { group, it, anim, spinning }

  // Cut this movie's spine out of the row photo, straightening its lean.
  const spineCanvas = (row, it, zone) => {
    const img = row._tex.image, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const us = zone.map((p) => p[0]), vs = zone.map((p) => p[1]);
    const c = document.createElement("canvas"), x = c.getContext("2d");
    if (it.poly) {
      const sx = Math.min(...us) * iw, sy = Math.min(...vs) * ih, sw = (Math.max(...us) - Math.min(...us)) * iw, sh = (Math.max(...vs) - Math.min(...vs)) * ih;
      if (it.flat) { // lying on its side in the photo: turn it upright
        c.width = sh; c.height = sw; x.translate(sh, 0); x.rotate(Math.PI / 2);
      } else { c.width = sw; c.height = sh; }
      x.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      return c;
    }
    const [l, r] = bounds(row, columns(row).findIndex((cc) => cc.it === it));
    const s = shearAt(row, (l + r) / 2) * (iw / ih), lpx = l * iw, midY = row.midV * ih, top = row.v[0] * ih;
    c.width = Math.max(8, (r - l) * iw); c.height = (row.v[1] - row.v[0]) * ih;
    x.setTransform(1, 0, -s, 1, -lpx + s * midY, -top);
    x.drawImage(img, 0, 0);
    return c;
  };
  const avgColor = (c, y0, y1) => {
    const d = c.getContext("2d").getImageData(0, Math.floor(c.height * y0), c.width, Math.max(1, Math.floor(c.height * (y1 - y0)))).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return [r / n, g / n, b / n];
  };

  // ---- designed spines: crisp, typeset versions of each format's spine, colored from the real one in the photo.
  // (Nobody publishes official spine art, so the photo only supplies the colors.)
  // The spine's main color between two heights: the most common color (so title lettering and glare
  // don't muddy it), averaged within that color's bucket.
  const sample = (c, y0, y1, wide) => { // wide: use the full width (bands on angled cases sit off-center)
    const x0 = Math.floor(c.width * (wide ? 0.05 : 0.2)), w = Math.max(1, Math.floor(c.width * (wide ? 0.9 : 0.6)));
    const d = c.getContext("2d").getImageData(x0, Math.floor(c.height * y0), w, Math.max(1, Math.floor(c.height * (y1 - y0)))).data;
    const bins = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] >> 5) * 64 + (d[i + 1] >> 5) * 8 + (d[i + 2] >> 5);
      const b = bins.get(k) || [0, 0, 0, 0]; b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; bins.set(k, b);
    }
    let top = [0, 0, 0, 0];
    for (const b of bins.values()) if (b[3] > top[3]) top = b;
    return top[3] ? [top[0] / top[3], top[1] / top[3], top[2] / top[3]] : [40, 40, 50];
  };
  const css = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;
  const ink = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#121216" : "#f4f3ff");
  // Blu-ray keepcases are blue: call it one only when most of the cap's center is clearly blue
  // (a zone's edges can catch a neighbor's cap).
  const isBlueCap = (photo) => {
    const x0 = Math.floor(photo.width * 0.35), w = Math.max(1, Math.floor(photo.width * 0.3));
    const d = photo.getContext("2d").getImageData(x0, 0, w, Math.max(1, Math.floor(photo.height * 0.05))).data;
    let blue = 0, n = 0;
    for (let i = 0; i < d.length; i += 4, n++) if (d[i + 2] > d[i] + 40 && d[i + 2] > d[i + 1] + 15) blue++;
    return blue / n > 0.5;
  };
  // Title running down the spine (top to bottom, the US convention), sized to fit.
  const spineText = (x, text, W, from, to, font, color, track = 0, atTop = false) => {
    const len = to - from, size0 = 100;
    x.font = font.replace("{s}", size0);
    const w0 = x.measureText(text).width + track * text.length * size0;
    const size = Math.min(W * 0.52, (len * 0.92 / w0) * size0);
    x.save();
    x.font = font.replace("{s}", size); x.fillStyle = color; x.textBaseline = "middle"; x.textAlign = "center";
    if ("letterSpacing" in x) x.letterSpacing = `${track * size}px`;
    const tw = Math.min(len, (x.measureText(text).width || 0));
    x.translate(W / 2, atTop ? from + tw / 2 : from + len / 2); x.rotate(Math.PI / 2); x.fillText(text, 0, 0);
    x.restore();
  };
  // Official spine art (A24 ships theirs blank in the shop photos): loaded once, shared.
  const artCache = new Map();
  const spineArt = (it, onReady) => {
    if (!it.sp) return null;
    let img = artCache.get(it.sp);
    if (!img) { img = new Image(); img.src = it.sp; artCache.set(it.sp, img); }
    if (!img.complete && onReady) img.addEventListener("load", onReady, { once: true });
    return img.complete && img.naturalWidth ? img : null;
  };
  // The first near-white row going down (or up) from a point: where a colored section ends.
  const whiteRow = (c, from, step) => {
    const g = c.getContext("2d"), xm = Math.floor(c.width / 2);
    for (let y = Math.floor(c.height * from); y > 0 && y < c.height; y += step) {
      const [r, gg, b] = g.getImageData(xm, y, 1, 1).data;
      if (r > 215 && gg > 215 && b > 215) return y;
    }
    return Math.floor(c.height * (step > 0 ? 0.6 : 0.85));
  };
  const designSpine = (it, photo, dims, art) => {
    const H = 1600, W = Math.max(64, Math.round(H * dims.d / dims.h));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d"), fill = (col, y0, y1) => { x.fillStyle = col; x.fillRect(0, H * y0, W, H * (y1 - y0)); };
    const title = it.t.replace(/^Monty Python's /, "");
    if (it.fm === "criterion") {
      // The color band sits at a different height on each spine: take the lower stretch most unlike the body.
      const body = sample(photo, 0.08, 0.5), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      let band = sample(photo, 0.72, 0.86), best = -1;
      for (let y = 0.52; y < 0.9; y += 0.03) { const s = sample(photo, y, y + 0.03, true); if (dist(s, body) > best) { best = dist(s, body); band = s; } }
      fill(css(body), 0, 1);
      fill(css(band), 0.6, 0.92);
      spineText(x, title.toUpperCase(), W, H * 0.04, H * 0.56, "600 {s}px Inter, sans-serif", ink(body), 0.04);
      spineText(x, "THE CRITERION COLLECTION", W, H * 0.64, H * 0.9, "600 {s}px Inter, sans-serif", ink(band), 0.12);
      x.font = `600 ${W * 0.26}px 'JetBrains Mono', monospace`; x.fillStyle = ink(body); x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(it.n || ""), W / 2, H * 0.96);
    } else if (it.fm === "steel") {
      const g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "#7c828b"); g.addColorStop(0.45, "#d6dae0"); g.addColorStop(0.55, "#c3c8cf"); g.addColorStop(1, "#80868f");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      for (let i = 0; i < H; i += 3) { x.fillStyle = `rgba(255,255,255,${(i * 7919 % 13) / 260})`; x.fillRect(0, i, W, 1); } // brushed grain
      spineText(x, title.toUpperCase(), W, H * 0.08, H * 0.86, "700 {s}px Rajdhani, sans-serif", "rgba(255,255,255,.55)", 0.06);
      x.translate(-1.5, -1.5);
      spineText(x, title.toUpperCase(), W, H * 0.08, H * 0.86, "700 {s}px Rajdhani, sans-serif", "#2b2e35", 0.06);
    } else if (it.fm === "keep") {
      const blue = isBluray(it, photo), body = sample(photo, 0.3, 0.75);
      fill(blue ? "#1c4fb0" : "#111114", 0, 1);
      fill(css(body), 0.16, 0.97);
      // format badge near the top, like real 4K / Blu-ray spines
      x.fillStyle = blue ? "#1c4fb0" : "#f4f3ff"; x.fillRect(W * 0.12, H * 0.045, W * 0.76, H * 0.095);
      spineText(x, blue ? "BLU-RAY" : "4K ULTRA HD", W, H * 0.05, H * 0.135, "700 {s}px Inter, sans-serif", blue ? "#f4f3ff" : "#111114", 0.06);
      spineText(x, title.toUpperCase(), W, H * 0.2, H * 0.92, "700 {s}px Rajdhani, sans-serif", ink(body), 0.03);
    } else if (it.fm === "a24" && art) {
      // A24's own spine: their colors, bands and barcode, with the title and logo set where they print them.
      x.drawImage(art, 0, 0, W, H);
      const body = sample(c, 0.05, 0.3), titleEnd = whiteRow(c, 0.2, 2), footTop = whiteRow(c, 0.97, -2);
      spineText(x, title, W, H * 0.035, titleEnd - H * 0.04, "700 {s}px Inter, sans-serif", ink(body), 0, true);
      const foot = sample(c, footTop / H + 0.02, 0.97);
      spineText(x, "A24", W, footTop + (H - footTop) * 0.25, H - (H - footTop) * 0.25, "800 {s}px Inter, sans-serif", ink(foot), 0.02);
    } else if (it.fm === "a24") {
      const body = sample(photo, 0.12, 0.5), foot = sample(photo, 0.88, 0.97);
      fill(css(body), 0, 1);
      fill("#f4f3ff", 0.68, 0.84);
      for (let i = 0; i < 34; i++) { x.fillStyle = "#121216"; x.fillRect(W * 0.18, H * (0.695 + i * 0.0038), W * 0.64, (i * 5) % 3 + 1); } // barcode band
      fill(css(foot), 0.88, 1);
      spineText(x, title, W, H * 0.05, H * 0.62, "700 {s}px Rajdhani, sans-serif", ink(body), 0.02);
    } else {
      const body = sample(photo, 0.2, 0.8);
      fill(css(body), 0, 1);
      spineText(x, title.toUpperCase(), W, H * 0.08, H * 0.92, "700 {s}px Rajdhani, sans-serif", ink(body), 0.05);
    }
    return c;
  };

  const isBluray = (it, photo) => (it.disc ? it.disc === "bd" : isBlueCap(photo)); // format read off the spine, else guessed from the cap
  const sideMaterial = (it, spine) => {
    const fm = it.fm;
    if (fm === "steel") return new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.3 });
    if (fm === "criterion") return new THREE.MeshStandardMaterial({ color: 0xe9e9f1, roughness: 0.15, transparent: true, opacity: 0.92 });
    if (fm === "box") return new THREE.MeshStandardMaterial({ color: 0xe8e6f0, roughness: 0.5 });
    if (fm === "a24") { const [r, g, b] = avgColor(spine, 0.2, 0.6); return new THREE.MeshStandardMaterial({ color: new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear(), roughness: 0.6 }); }
    return new THREE.MeshStandardMaterial({ color: isBluray(it, spine) ? 0x1c4fb0 : 0x111114, roughness: 0.35, metalness: 0.1 }); // blue Blu-ray, black 4K
  };
  // The back cover, laid out like my sketch: title and year, two stills, my review, then the stars.
  const stillCache = new Map();
  const stillImgs = (it, onReady) => (it.st || []).map((src) => {
    let img = stillCache.get(src);
    if (!img) { img = new Image(); img.src = src; stillCache.set(src, img); }
    if (!img.complete && onReady) img.addEventListener("load", onReady, { once: true });
    return img.complete && img.naturalWidth ? img : null;
  });
  // Draw an image into a box like CSS object-fit: cover, centered on `fx` (0..1) across.
  const coverInto = (x, img, bx, by, bw, bh, fx = 0.5) => {
    const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.max(bw / iw, bh / ih), sw = bw / s, sh = bh / s;
    x.drawImage(img, Math.min(iw - sw, Math.max(0, iw * fx - sw / 2)), (ih - sh) / 2, sw, sh, bx, by, bw, bh);
  };
  const backCanvas = (it, stills = []) => {
    const c = document.createElement("canvas"); c.width = 600; c.height = 760;
    const x = c.getContext("2d"), M = 36;
    const g = x.createLinearGradient(0, 0, 0, 760); g.addColorStop(0, "#1c1c3a"); g.addColorStop(1, "#0a0a12");
    x.fillStyle = g; x.fillRect(0, 0, 600, 760);
    x.strokeStyle = "rgba(5,217,232,.07)"; x.lineWidth = 1;
    for (let i = 0; i < 600; i += 30) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 760); x.stroke(); }
    for (let i = 0; i < 760; i += 30) { x.beginPath(); x.moveTo(0, i); x.lineTo(600, i); x.stroke(); }

    // title (shrunk to fit one line) and year
    const year = String(it.y || "");
    x.font = "26px 'JetBrains Mono', monospace"; const yw = year ? x.measureText(year).width + 18 : 0;
    let size = 44; x.font = `700 ${size}px Rajdhani, sans-serif`;
    while (x.measureText(it.t).width > 528 - yw && size > 24) x.font = `700 ${--size}px Rajdhani, sans-serif`;
    let title = it.t; while (x.measureText(title).width > 528 - yw && title.length > 4) title = title.slice(0, -2) + "…";
    x.textBaseline = "alphabetic"; x.fillStyle = "#f4f3ff"; x.shadowColor = "rgba(255,42,109,.55)"; x.shadowBlur = 12;
    x.fillText(title, M, 74); x.shadowBlur = 0;
    if (year) { x.font = "26px 'JetBrains Mono', monospace"; x.fillStyle = "#05d9e8"; x.textAlign = "right"; x.fillText(year, 600 - M, 74); x.textAlign = "left"; }

    // two stills: a tall one on the left, a wide one on the right (just one still → one wide photo)
    const two = (it.st || []).length > 1;
    const boxes = two ? [[M, 100, 196, 262], [M + 214, 100, 600 - 2 * M - 214, 262]] : [[M, 100, 600 - 2 * M, 262]];
    boxes.forEach(([bx, by, bw, bh], i) => {
      x.fillStyle = "#14142b"; x.fillRect(bx, by, bw, bh);
      const img = stills[i];
      if (img) coverInto(x, img, bx, by, bw, bh);
      x.strokeStyle = "rgba(5,217,232,.7)"; x.lineWidth = 2; x.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    });

    const rule = (yy) => { x.fillStyle = "#ff2a6d"; x.shadowColor = "rgba(255,42,109,.7)"; x.shadowBlur = 8; x.fillRect(M, yy, 600 - 2 * M, 2); x.shadowBlur = 0; };
    rule(392);

    // my review, as big as it fits between the rules
    const text = it.rv ? `“${it.rv}”` : it.m ? "Rated on Letterboxd, no review yet." : "Not on my Letterboxd yet.";
    const lines = (font) => {
      x.font = font; const out = []; let line = "";
      for (const w of text.split(/\s+/)) { const t = line ? line + " " + w : w; if (x.measureText(t).width > 600 - 2 * M && line) { out.push(line); line = w; } else line = t; }
      if (line) out.push(line); return out;
    };
    let fs = 30, ls;
    while ((ls = lines(`${it.rv ? "italic " : ""}${fs}px Inter, sans-serif`)).length * fs * 1.4 > 168 && fs > 16) fs -= 1;
    x.fillStyle = it.rv ? "#d6d6e7" : "#9d9dc0"; x.textBaseline = "middle";
    const top = 494 - (ls.length * fs * 1.4) / 2 + (fs * 1.4) / 2;
    ls.slice(0, 7).forEach((l, n) => x.fillText(l, M, top + n * fs * 1.4));
    // this whole stretch is a link (see reviewHit)
    x.font = "17px 'JetBrains Mono', monospace"; x.fillStyle = "#05d9e8"; x.textBaseline = "alphabetic";
    x.fillText(it.r ? "CLICK TO READ ON LETTERBOXD ↗" : "CLICK TO OPEN ON LETTERBOXD ↗", M, 606);

    rule(620);
    // the star rating, in its own box
    x.strokeStyle = "rgba(249,240,2,.8)"; x.lineWidth = 2; x.shadowColor = "rgba(249,240,2,.5)"; x.shadowBlur = 10;
    x.strokeRect(M + 40, 644, 600 - 2 * M - 80, 84); x.shadowBlur = 0;
    x.textAlign = "center";
    if (it.s) { x.font = "52px sans-serif"; x.fillStyle = "#f9f002"; x.shadowColor = "rgba(249,240,2,.6)"; x.shadowBlur = 14; x.fillText(it.s, 300, 688); x.shadowBlur = 0; }
    else { x.font = "22px 'JetBrains Mono', monospace"; x.fillStyle = "#9d9dc0"; x.fillText("NO RATING YET", 300, 688); }
    x.textAlign = "left";
    return c;
  };
  const coverTexture = (it, onReady) => {
    if (!it.f) return null;
    if (posterCache.has(it.f)) return posterCache.get(it.f);
    const t = loader.load(it.f, onReady, undefined, () => {});
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    posterCache.set(it.f, t);
    return t;
  };
  const coverFit = (t, aspect) => { // crop the cover image to the case's front, like CSS object-fit: cover
    const img = t.image; if (!img || !img.width) return;
    const a = img.width / img.height;
    if (a > aspect) { t.repeat.set(aspect / a, 1); t.offset.set((1 - aspect / a) / 2, 0); }
    else { t.repeat.set(1, a / aspect); t.offset.set(0, (1 - a / aspect) / 2); }
  };

  const viewSize = (dist) => {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
    return [2 * dist * Math.tan(hf), 2 * dist * Math.tan(vf)];
  };
  // Pull a case out: `row` is its shelf row (for the spine photo), `zone` its outline on the photo,
  // `point` where on the shelf (world space) it starts from.
  const openCase = ({ row, it, zone, point }) => {
    if (viewer) closeCase(true);
    const dims = CASES[it.fm] || CASES.keep;
    const spine = spineCanvas(row, it, zone); // the real spine from the photo: used for its colors
    const spineTex = new THREE.CanvasTexture(designSpine(it, spine, dims, spineArt(it, () => {
      spineTex.image = designSpine(it, spine, dims, spineArt(it)); spineTex.needsUpdate = true;
    }))); spineTex.colorSpace = THREE.SRGBColorSpace;
    spineTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const backTex = new THREE.CanvasTexture(backCanvas(it, stillImgs(it, () => {
      backTex.image = backCanvas(it, stillImgs(it)); backTex.needsUpdate = true;
    }))); backTex.colorSpace = THREE.SRGBColorSpace;
    backTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const side = sideMaterial(it, spine);
    const aspect = dims.w / dims.h;
    const front = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: it.fm === "steel" ? 0.35 : 0.45, metalness: it.fm === "steel" ? 0.5 : 0 });
    const ct = coverTexture(it, (t) => { coverFit(t, aspect); front.map = t; front.color.set(0xffffff); front.needsUpdate = true; });
    if (ct && ct.image && ct.image.width) { coverFit(ct, aspect); front.map = ct; front.color.set(0xffffff); }
    // BoxGeometry faces: +x (opening edge), -x (spine), +y, -y, +z (front), -z (back)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), [
      side, new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.4 }), side, side, front,
      new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.5 }),
    ]);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xff2a6d, transparent: true, opacity: 0.5 })));
    const group = new THREE.Group(); group.add(mesh);
    pivot.add(group);
    // Start where the spine was on the shelf, spine facing you; end centered, front turned toward you.
    const dist = 4, [vw, vh] = viewSize(dist);
    const scale = Math.min((vh * 0.8) / dims.h, (vw * 0.8) / dims.w); // nearly fills the view: no caption under it
    camera.updateMatrixWorld();
    const from = camera.worldToLocal(point.clone());
    viewer = { group, it, t0: performance.now(), from, to: new THREE.Vector3(0, 0, -dist), s0: scale * 0.25, s1: scale,
      r0: Math.PI / 2, r1: -0.45, opening: true, spinY: -0.45, spinX: 0.08 };
    group.position.copy(from); group.scale.setScalar(viewer.s0); group.rotation.set(0, viewer.r0, 0);
    if (ui) {
      ui.querySelector(".case-title").textContent = it.t;
      ui.querySelector(".case-sub").textContent = [it.y, it.d].filter(Boolean).join(", ");
      ui.querySelector(".case-hint").textContent = `${touch ? "Swipe" : "Drag"} to turn it. ${touch ? "Tap" : "Click"} the review on the back, or press Enter, to read it. ${touch ? "Tap" : "Click"} around it or press Escape to put it back.`;
    }
    onOpen?.(it);
    if (reduce) { viewer.t0 = -1e9; }
  };
  const closeCase = (instant) => {
    if (!viewer) return;
    const v = viewer;
    const done = () => {
      pivot.remove(v.group);
      // Free this case's geometry, materials and spine/back textures; posters stay cached for next time.
      v.group.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => { if (m.map?.isCanvasTexture) m.map.dispose(); m.dispose(); }); });
    };
    onClose?.();
    if (instant || reduce) { done(); viewer = null; dimmer.material.opacity = 0; caseLight.intensity = 0; return; }
    v.closing = performance.now(); v.done = done;
  };
  const stepViewer = (now) => {
    const v = viewer; if (!v) return;
    if (v.closing) {
      if (v.homeY === undefined) { // turn back the short way, however far it was spun
        const turns = Math.round((v.spinY - Math.PI / 2) / (2 * Math.PI));
        v.homeY = Math.PI / 2 + turns * 2 * Math.PI; v.fromX = v.spinX; v.fromY = v.spinY;
      }
      const k = Math.min(1, (now - v.closing) / 900), s = smooth(k);
      v.group.position.lerpVectors(v.to, v.from, s);
      v.group.position.z += Math.sin(Math.PI * s) * 0.6; // a gentle arc out toward you on the way back
      v.group.scale.setScalar(THREE.MathUtils.lerp(v.s1, v.s0, s));
      v.group.rotation.set(THREE.MathUtils.lerp(v.fromX, 0, s), THREE.MathUtils.lerp(v.fromY, v.homeY, s), 0);
      dimmer.material.opacity = dim * (1 - s); caseLight.intensity = 18 * (1 - s);
      if (k === 1) { v.done(); viewer = null; }
      return;
    }
    const k = Math.min(1, (now - v.t0) / 900), s = smooth(k);
    v.group.position.lerpVectors(v.from, v.to, s);
    if (v.opening) v.group.position.z += Math.sin(Math.PI * s) * 0.6;
    v.group.scale.setScalar(THREE.MathUtils.lerp(v.s0, v.s1, s));
    dimmer.material.opacity = dim * s; caseLight.intensity = 18 * s;
    if (v.opening) { v.group.rotation.y = THREE.MathUtils.lerp(v.r0, v.r1, s); if (k === 1) v.opening = false; }
    else {
      if (!v.dragging && !reduce) v.spinY += Math.sin(now / 1800) * 0.0008; // a slight drift so it feels alive
      v.group.rotation.set(v.spinX, v.spinY, 0);
    }
  };
  // Is this ray (set from the camera by the host) on the case? Its body only: the neon outline
  // (a child) would count clicks well outside the case.
  const caseHit = (ray) => !!viewer && ray.intersectObject(viewer.group.children[0], false).length > 0;
  // On the review stretch of the back cover? (back = face 5; the review sits between the two rules)
  const reviewHit = (ray) => {
    if (!viewer || viewer.opening || viewer.closing || !viewer.it.u) return false;
    const h = ray.intersectObject(viewer.group.children[0], false)[0];
    return !!h && h.face.materialIndex === 5 && h.uv.y > 1 - 620 / 760 && h.uv.y < 1 - 392 / 760;
  };
  const openReview = () => viewer && window.open(viewer.it.u, "_blank", "noopener");
  // Drag to turn the case all the way round (and tilt it a little).
  const spin = (dx, dy) => {
    if (!viewer || viewer.opening || viewer.closing) return;
    viewer.dragging = true;
    viewer.spinY += dx * 0.012;
    viewer.spinX = THREE.MathUtils.clamp(viewer.spinX + dy * 0.008, -0.6, 0.6);
  };
  // Second pass, after the host has drawn its scene: the case, always on top.
  const render = () => {
    if (!viewer) return;
    camera.updateMatrixWorld();
    pivot.matrix.copy(camera.matrixWorld); pivot.updateMatrixWorld(true);
    const auto = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(null); renderer.clearDepth(); renderer.render(caseScene, camera);
    renderer.autoClear = auto;
  };
  const smooth = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2); // softer start and landing for the case
  return {
    open: openCase, close: closeCase, step: stepViewer, render, hit: caseHit, reviewHit, openReview, spin,
    endDrag: () => { if (viewer) viewer.dragging = false; },
    get active() { return !!viewer; }, get busy() { return !!viewer && (viewer.opening || !!viewer.closing); },
    get it() { return viewer?.it; },
    // for the ?shelfdebug tools
    CASES, spineCanvas, sample, designSpine, spineArt, stillImgs, backCanvas, dimmer, pivot, get viewer() { return viewer; },
  };
}