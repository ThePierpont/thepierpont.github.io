// 3D movie shelf, built from photos of the real one (data: shelf-data.js).
// Full view → click a shelf to fly in → hover/click (or tap) a movie for my Letterboxd entry.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ROWS = window.SHELF || [];
const box = document.getElementById("shelf3d");
const NAMES = { imax: "IMAX case", top: "A24 + Kill Bill", criterion: "Criterion Collection", steel: "4K + steelbooks", bottom: "Blu-ray + 4K" };

if (box && ROWS.length) {
  try { init(); } catch (e) { console.warn("shelf:", e); box.classList.add("no-3d"); }
}

function init() {
  const canvas = box.querySelector("canvas"), tip = box.querySelector(".shelf-tip");
  const label = box.querySelector(".shelf-label"), hint = box.querySelector(".shelf-hint");
  const btn = (act) => box.querySelector(`[data-act="${act}"]`);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false; // cleared by hand so the pulled-out case can be drawn in a second pass
  const scene = new THREE.Scene(), shelf = new THREE.Group();
  scene.add(shelf);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enablePan: false, enableZoom: false, enableDamping: true, dampingFactor: 0.08,
    minAzimuthAngle: -0.55, maxAzimuthAngle: 0.55, minPolarAngle: Math.PI / 2 - 0.4, maxPolarAngle: Math.PI / 2 + 0.4 });
  // Phones scroll the page with one finger, so turning is mouse-only; taps still pick.
  if (touch) { controls.enableRotate = false; canvas.style.touchAction = "pan-y"; }

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const pink = new THREE.PointLight(0xff2a6d, 40, 40); pink.position.set(-5, 6, 7); scene.add(pink);
  const cyan = new THREE.PointLight(0x05d9e8, 30, 40); cyan.position.set(6, 1, 6); scene.add(cyan);

  // ---- build the bookcase: cubbies stacked bottom-up, the IMAX case on top
  const W = 4, T = 0.12, D = 1.0;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1c3a, roughness: 0.55, metalness: 0.3 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xff2a6d, transparent: true, opacity: 0.85 });
  const loader = new THREE.TextureLoader();
  const tex = (src) => {
    const t = loader.load(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const board = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(x, y, z);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat));
    shelf.add(m);
  };

  const targets = []; // every clickable face: { row, mesh, w, h, center (world), faceZ }
  const imaxRow = ROWS.find((r) => r.id === "imax");
  const cubbyRows = ROWS.filter((r) => r.id !== "imax");
  let y = 0;
  board(W + 2 * T, T, D, 0, -T / 2, 0);
  for (const row of [...cubbyRows].reverse()) {
    const h = W / row.aspect;
    row._tex = tex(row.img); // kept so the pop-out case can cut its spine from the photo
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, h), new THREE.MeshBasicMaterial({ map: row._tex }));
    face.position.set(0, y + h / 2, -D / 2 + 0.03);
    shelf.add(face);
    targets.unshift({ row, mesh: face, w: W, h, cy: y + h / 2, z: face.position.z });
    board(T, h, D, -W / 2 - T / 2, y + h / 2, 0);
    board(T, h, D, W / 2 + T / 2, y + h / 2, 0);
    y += h;
    board(W + 2 * T, T, D, 0, y + T / 2, 0);
    y += T;
  }
  if (imaxRow) {
    const w = 2.3, h = w / imaxRow.aspect, d = 1.1;
    const side = new THREE.MeshStandardMaterial({ color: 0xd9d7e6, roughness: 0.45 });
    imaxRow._tex = tex(imaxRow.img);
    const caseBox = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, new THREE.MeshBasicMaterial({ map: imaxRow._tex }), side]);
    caseBox.position.set(-W / 2 - T + w / 2, y + h / 2, D / 2 - d / 2);
    caseBox.add(new THREE.LineSegments(new THREE.EdgesGeometry(caseBox.geometry), new THREE.LineBasicMaterial({ color: 0x05d9e8 })));
    shelf.add(caseBox);
    targets.unshift({ row: imaxRow, mesh: caseBox, w, h, cy: y + h / 2, z: caseBox.position.z + d / 2, x: caseBox.position.x, faceZ: d / 2 });
    y += h;
  }
  const totalH = y;
  shelf.position.y = -totalH / 2;

  // ---- which movie is at a texture point (u right, v down, both 0..1)
  const inPoly = (p, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const columns = (row) => row._cols ||= row.items.map((it, i) => ({ it, i })).filter((c) => c.it.c !== undefined);
  // Spines can lean differently across a shelf: `shear` is one number, or [lean at the left edge, lean at the right edge].
  const shearAt = (row, u) => Array.isArray(row.shear) ? row.shear[0] + (row.shear[1] - row.shear[0]) * u : row.shear;
  const lean = (row, b, vv) => [b + shearAt(row, b) * (vv - row.midV), vv];
  const bounds = (row, k) => {
    const cols = columns(row), c = cols[k].it.c;
    const left = k ? (cols[k - 1].it.c + c) / 2 : row.u[0];
    const right = k < cols.length - 1 ? (cols[k + 1].it.c + c) / 2 : row.u[1];
    return [left, right];
  };
  const pick = (row, u, v) => {
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

  // ---- highlight: neon outline + soft fill drawn on the face
  const hlLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x05d9e8 }));
  const hlFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x05d9e8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  hlLine.renderOrder = hlFill.renderOrder = 10;
  const showZone = (tg, zone) => {
    if (!tg) { hlLine.visible = hlFill.visible = false; return; }
    const pts = zone.map(([u, v]) => new THREE.Vector3((u - 0.5) * tg.w, (0.5 - v) * tg.h, (tg.faceZ || 0) + 0.01));
    hlLine.geometry.setFromPoints(pts);
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
    hlFill.geometry.dispose(); hlFill.geometry = new THREE.ShapeGeometry(shape);
    hlFill.position.z = (tg.faceZ || 0) + 0.008;
    tg.mesh.add(hlLine); tg.mesh.add(hlFill);
    hlLine.visible = hlFill.visible = true;
  };
  const wholeFace = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // ?shelfdebug draws every click zone, to check they line up with the photos.
  if (location.search.includes("shelfdebug")) {
    const dbg = new THREE.LineBasicMaterial({ color: 0xf9f002 });
    for (const tg of targets) {
      const zones = tg.row.items.map((it) => it.poly).filter(Boolean);
      columns(tg.row).forEach((_, k) => {
        const [l, r] = bounds(tg.row, k), R = tg.row;
        zones.push([lean(R, l, R.v[0]), lean(R, r, R.v[0]), lean(R, r, R.v[1]), lean(R, l, R.v[1])]);
      });
      for (const z of zones) {
        const pts = z.map(([u, v]) => new THREE.Vector3((u - 0.5) * tg.w, (0.5 - v) * tg.h, (tg.faceZ || 0) + 0.012));
        tg.mesh.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), dbg));
      }
    }
  }

  // ---- camera: full view or one shelf
  // On tall screens (phones) a whole row is too small to read, so the camera zooms in on its height
  // and you swipe sideways along it ("pan mode").
  let focus = -1, anim = null, lastInteract = performance.now(), panX = 0, panHalf = 0, panMode = false;
  const halfFov = () => {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    return [vf, Math.atan(Math.tan(vf) * camera.aspect)];
  };
  const fit = (w, h) => {
    const [vf, hf] = halfFov();
    return Math.max(h / 2 / Math.tan(vf), w / 2 / Math.tan(hf)) * 1.06;
  };
  const goal = () => {
    panMode = false;
    if (focus < 0) return { t: new THREE.Vector3(0, 0, 0), d: fit(W + 1.2, totalH + 0.8) };
    const tg = targets[focus], [vf, hf] = halfFov();
    let d = fit(tg.w + 0.25, tg.h + 0.25);
    const dTall = (tg.h * 1.45) / 2 / Math.tan(vf); // row fills about two thirds of the height
    if (dTall < d * 0.8) { d = dTall; panMode = true; }
    panHalf = Math.max(0, (tg.w + 0.3 - 2 * d * Math.tan(hf)) / 2);
    panX = THREE.MathUtils.clamp(panX, -panHalf, panHalf);
    return { t: new THREE.Vector3((tg.x || 0) + panX, tg.cy - totalH / 2, tg.z), d };
  };
  const flyTo = (instant) => {
    const g = goal(), toPos = g.t.clone().add(new THREE.Vector3(0, 0, g.d));
    if (instant || reduce) { camera.position.copy(toPos); controls.target.copy(g.t); controls.update(); anim = null; return; }
    anim = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toP: toPos, toT: g.t };
  };
  const setFocus = (i) => {
    focus = i;
    panX = -Infinity; // start at the left end of the row; goal() clamps it
    shelf.rotation.y = 0;
    flyTo();
    controls.enableRotate = !touch && !panMode;
    clearPick();
    const row = focus >= 0 ? targets[focus].row : null;
    box.classList.toggle("focused", focus >= 0);
    label.textContent = row ? `${NAMES[row.id] || row.id} · ${row.items.filter((x) => x.u).length} films` : "My shelf";
    hint.textContent = focus < 0 ? (touch ? "Tap a shelf to look closer" : "Click a shelf to look closer · drag to turn")
      : (panMode ? (touch ? "Swipe sideways · tap a movie" : "Drag sideways · click a movie") : (touch ? "Tap a movie" : "Click a movie for my Letterboxd"));
    btn("prev").disabled = focus <= 0;
    btn("next").disabled = focus < 0 || focus >= targets.length - 1;
  };
  btn("back").addEventListener("click", () => setFocus(-1));
  btn("prev").addEventListener("click", () => setFocus(Math.max(0, focus - 1)));
  btn("next").addEventListener("click", () => setFocus(Math.min(targets.length - 1, focus + 1)));

  // ---- pointer: hover (mouse), click/tap
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let selected = null;
  const hitAt = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObjects(targets.map((t) => t.mesh), false)) {
      const tg = targets.find((t) => t.mesh === h.object);
      if (tg.faceZ && h.face.materialIndex !== 4) continue; // IMAX case: only its front face has movies
      return { tg, i: targets.indexOf(tg), u: h.uv.x, v: 1 - h.uv.y, point: h.point };
    }
    return null;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const describe = (it) => it.r ? `My ${it.s} review` : it.m ? `Rated ${it.s}` : "Not on my Letterboxd yet";
  const placeTip = (e, html, interactive) => {
    tip.innerHTML = html; tip.hidden = false; tip.classList.toggle("interactive", !!interactive);
    const r = box.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 14, yy = e.clientY - r.top + 14;
    if (x + tw > r.width - 8) x = r.width - tw - 8;
    if (yy + th > r.height - 8) yy = e.clientY - r.top - th - 14;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, yy)}px)`;
  };
  const clearPick = () => { showZone(null); tip.hidden = true; selected = null; canvas.style.cursor = ""; };
  const hover = (e) => {
    const h = hitAt(e);
    if (!h) return clearPick();
    if (focus < 0 || h.i !== focus) {
      showZone(h.tg, wholeFace); canvas.style.cursor = "zoom-in";
      return placeTip(e, `<strong>${esc(NAMES[h.tg.row.id])}</strong><span>${focus < 0 ? "Click to look closer" : "Click to move here"}</span>`);
    }
    const p = pick(h.tg.row, h.u, h.v);
    if (!p) return clearPick();
    showZone(h.tg, p.zone);
    canvas.style.cursor = p.it.u ? "pointer" : "default";
    placeTip(e, p.it.u ? `<strong>${esc(p.it.t)}</strong><span>${esc(describe(p.it))}</span><span>Click to pull it out</span>` : `<strong>Can't read this one yet</strong>`);
  };
  const tap = (e) => {
    const h = hitAt(e);
    if (!h) return clearPick();
    if (focus < 0 || h.i !== focus) return setFocus(h.i);
    const p = pick(h.tg.row, h.u, h.v);
    if (!p) return clearPick();
    if (!p.it.u) return;
    openCase(h, p); // the case pops out; its panel has the Letterboxd link
  };
  // ---- pop-out 3D case: slides off the shelf, turns to face you, drag to spin it
  // Sizes in decimetres (w × h × d). The side color of standard keepcases is read from the photo.
  const CASES = {
    keep: { w: 1.35, h: 1.71, d: 0.13 }, criterion: { w: 1.36, h: 1.72, d: 0.15 },
    steel: { w: 1.36, h: 1.72, d: 0.1 }, a24: { w: 1.42, h: 1.86, d: 0.17 }, box: { w: 1.5, h: 1.9, d: 0.42 },
  };
  // The dimmer rides on the camera in the shelf scene; the case lives in its own scene, drawn on top
  // in a second pass, with a pivot that follows the camera so the case can be placed in front of it.
  scene.add(camera);
  const dimmer = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x05050a, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  dimmer.position.z = -1; dimmer.renderOrder = 20; camera.add(dimmer);
  const caseScene = new THREE.Scene(), pivot = new THREE.Object3D();
  pivot.matrixAutoUpdate = false; caseScene.add(pivot);
  caseScene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const caseLight = new THREE.PointLight(0xffffff, 0, 30); caseLight.position.set(1.5, 2, 1); pivot.add(caseLight);
  const casePink = new THREE.PointLight(0xff2a6d, 6, 20); casePink.position.set(-3, 1, -2); pivot.add(casePink);
  const caseCyan = new THREE.PointLight(0x05d9e8, 5, 20); caseCyan.position.set(3, -1.5, -2); pivot.add(caseCyan);
  const ui = box.querySelector(".case-ui");
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
  const sideMaterial = (fm, spine) => {
    if (fm === "steel") return new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.3 });
    if (fm === "criterion") return new THREE.MeshStandardMaterial({ color: 0xe9e9f1, roughness: 0.15, transparent: true, opacity: 0.92 });
    if (fm === "box") return new THREE.MeshStandardMaterial({ color: 0xe8e6f0, roughness: 0.5 });
    if (fm === "a24") { const [r, g, b] = avgColor(spine, 0.2, 0.6); return new THREE.MeshStandardMaterial({ color: new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear(), roughness: 0.6 }); }
    const [r, g, b] = avgColor(spine, 0, 0.05); // a keepcase's top cap: blue = Blu-ray, else black 4K
    return new THREE.MeshStandardMaterial({ color: b > r + 25 && b > g ? 0x1c4fb0 : 0x111114, roughness: 0.35, metalness: 0.1 });
  };
  // The back cover: my rating and review, styled like the site.
  const backCanvas = (it) => {
    const c = document.createElement("canvas"); c.width = 600; c.height = 760;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 760); g.addColorStop(0, "#1c1c3a"); g.addColorStop(1, "#0a0a12");
    x.fillStyle = g; x.fillRect(0, 0, 600, 760);
    x.strokeStyle = "rgba(5,217,232,.08)"; x.lineWidth = 1;
    for (let i = 0; i < 600; i += 30) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 760); x.stroke(); }
    for (let i = 0; i < 760; i += 30) { x.beginPath(); x.moveTo(0, i); x.lineTo(600, i); x.stroke(); }
    x.fillStyle = "#ff2a6d"; x.fillRect(40, 48, 80, 4);
    const wrap = (text, font, lh, maxLines, y, color) => {
      x.font = font; x.fillStyle = color;
      const words = text.split(/\s+/); let line = "", n = 0;
      for (const w of words) {
        const t = line ? line + " " + w : w;
        if (x.measureText(t).width > 520 && line) { x.fillText(line, 40, y); y += lh; line = w; if (++n >= maxLines - 1) { line += "…"; break; } }
        else line = t;
      }
      if (line) { x.fillText(line, 40, y); y += lh; }
      return y;
    };
    let y = wrap(it.t, "700 52px Rajdhani, sans-serif", 54, 3, 110, "#f4f3ff");
    x.font = "22px 'JetBrains Mono', monospace"; x.fillStyle = "#9d9dc0";
    x.fillText([it.y, it.d].filter(Boolean).join("  /  ").slice(0, 44), 40, y + 6); y += 70;
    if (it.s) { x.font = "48px sans-serif"; x.fillStyle = "#f9f002"; x.shadowColor = "rgba(249,240,2,.6)"; x.shadowBlur = 14; x.fillText(it.s, 40, y); x.shadowBlur = 0; y += 60; }
    if (it.rv) wrap(`“${it.rv}”`, "italic 26px Inter, sans-serif", 38, 7, y + 10, "#d6d6e7");
    else wrap(it.m ? "Rated on Letterboxd, no review yet." : "Not on my Letterboxd yet.", "26px Inter, sans-serif", 38, 2, y + 10, "#9d9dc0");
    for (let i = 0; i < 46; i++) { x.fillStyle = "#f4f3ff"; x.fillRect(40 + i * 5, 650, (i * 7) % 3 + 1, 56); } // decorative barcode
    x.font = "18px 'JetBrains Mono', monospace"; x.fillStyle = "#ff2a6d"; x.fillText("PIERPONT.BLOG", 330, 700);
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

  const viewSize = (dist) => { const [vf, hf] = halfFov(); return [2 * dist * Math.tan(hf), 2 * dist * Math.tan(vf)]; };
  const openCase = (h, p) => {
    if (viewer) closeCase(true);
    const it = p.it, dims = CASES[it.fm] || CASES.keep;
    const spine = spineCanvas(h.tg.row, it, p.zone);
    const spineTex = new THREE.CanvasTexture(spine); spineTex.colorSpace = THREE.SRGBColorSpace;
    const backTex = new THREE.CanvasTexture(backCanvas(it)); backTex.colorSpace = THREE.SRGBColorSpace;
    const side = sideMaterial(it.fm, spine);
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
    const scale = Math.min((vh * 0.55) / dims.h, (vw * 0.68) / dims.w);
    const from = camera.worldToLocal(h.point.clone());
    viewer = { group, it, t0: performance.now(), from, to: new THREE.Vector3(0, vh * 0.11, -dist), s0: scale * 0.25, s1: scale,
      r0: Math.PI / 2, r1: -0.45, opening: true, spinY: -0.45, spinX: 0.08 };
    group.position.copy(from); group.scale.setScalar(viewer.s0); group.rotation.set(0, viewer.r0, 0);
    clearPick();
    ui.hidden = false;
    ui.querySelector(".case-title").textContent = it.t;
    ui.querySelector(".case-sub").textContent = [it.y, it.d].filter(Boolean).join(", ");
    const link = ui.querySelector(".case-link");
    link.href = it.u; link.textContent = it.r ? `Read my ${it.s} review ↗` : it.m ? `My ${it.s} rating ↗` : "Open on Letterboxd ↗";
    box.classList.add("case-open");
    controls.enabled = false;
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
    ui.hidden = true; box.classList.remove("case-open");
    controls.enabled = true;
    if (instant || reduce) { done(); viewer = null; dimmer.material.opacity = 0; caseLight.intensity = 0; return; }
    v.closing = performance.now(); v.done = done;
  };
  ui.querySelector(".case-close").addEventListener("click", () => closeCase());
  if (location.search.includes("shelfdebug")) window.__shelf = { scene, camera, dimmer, pivot, get viewer() { return viewer; } };
  const stepViewer = (now) => {
    const v = viewer; if (!v) return;
    if (v.closing) {
      const k = Math.min(1, (now - v.closing) / 450), s = ease(k);
      v.group.position.lerpVectors(v.to, v.from, s);
      v.group.scale.setScalar(THREE.MathUtils.lerp(v.s1, v.s0, s));
      v.group.rotation.y = THREE.MathUtils.lerp(v.spinY, Math.PI / 2, s);
      dimmer.material.opacity = 0.82 * (1 - s); caseLight.intensity = 18 * (1 - s);
      if (k === 1) { v.done(); viewer = null; }
      return;
    }
    const k = Math.min(1, (now - v.t0) / 800), s = ease(k);
    v.group.position.lerpVectors(v.from, v.to, s);
    v.group.scale.setScalar(THREE.MathUtils.lerp(v.s0, v.s1, s));
    dimmer.material.opacity = 0.82 * s; caseLight.intensity = 18 * s;
    if (v.opening) { v.group.rotation.y = THREE.MathUtils.lerp(v.r0, v.r1, s); if (k === 1) v.opening = false; }
    else {
      if (!v.dragging && !reduce) v.spinY += Math.sin(now / 1800) * 0.0008; // a slight drift so it feels alive
      v.group.rotation.set(v.spinX, v.spinY, 0);
    }
  };
  const caseHit = (e) => {
    if (!viewer) return false;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(viewer.group, true).length > 0;
  };

  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY }; lastInteract = performance.now(); });
  canvas.addEventListener("pointermove", (e) => {
    if (viewer) {
      // Drag to turn the case all the way round (and tilt it a little).
      if (down && !viewer.opening && !viewer.closing) {
        viewer.dragging = true;
        viewer.spinY += (e.clientX - down.lastX) * 0.012;
        viewer.spinX = THREE.MathUtils.clamp(viewer.spinX + (e.clientY - down.lastY) * 0.008, -0.6, 0.6);
        down.lastX = e.clientX; down.lastY = e.clientY;
      }
      canvas.style.cursor = down ? "grabbing" : caseHit(e) ? "grab" : "default";
      return;
    }
    if (down && panMode && focus >= 0) {
      // Slide along the row: move camera and target together, within the row's ends.
      const [, hf] = halfFov(), perPx = (2 * camera.position.distanceTo(controls.target) * Math.tan(hf)) / canvas.clientWidth;
      const next = THREE.MathUtils.clamp(panX - (e.clientX - down.lastX) * perPx, -panHalf, panHalf), dx = next - panX;
      panX = next; down.lastX = e.clientX;
      camera.position.x += dx; controls.target.x += dx; anim = null;
      if (Math.abs(e.clientX - down.x) > 6 && !selected) clearPick();
      return;
    }
    if (e.pointerType === "mouse" && !(down && e.buttons)) hover(e);
  });
  canvas.addEventListener("pointerup", (e) => {
    const still = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
    if (viewer) { viewer.dragging = false; if (still && !caseHit(e)) closeCase(); } // click off the case: put it back
    else if (still) tap(e);
    down = null;
  });
  canvas.addEventListener("pointerleave", () => { if (!selected) clearPick(); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (viewer) closeCase(); else setFocus(-1); return; }
    if (viewer) return;
    if (e.key === "ArrowUp" && focus > 0) { e.preventDefault(); setFocus(focus - 1); }
    if (e.key === "ArrowDown" && focus < targets.length - 1) { e.preventDefault(); setFocus(focus + 1); }
  });

  // ---- size + render loop (paused while the shelf is off screen)
  const resize = () => {
    const { width, height } = box.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    flyTo(true);
  };
  new ResizeObserver(resize).observe(box);
  let visible = true;
  new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(box);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  renderer.setAnimationLoop((now) => {
    if (!visible) return;
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / 750), s = ease(k);
      camera.position.lerpVectors(anim.fromP, anim.toP, s);
      controls.target.lerpVectors(anim.fromT, anim.toT, s);
      if (k === 1) anim = null;
    }
    // A slow sway in the full view until someone interacts.
    if (focus < 0 && !reduce && now - lastInteract > 4000) shelf.rotation.y = Math.sin(now / 2600) * 0.16;
    stepViewer(now);
    controls.update();
    renderer.clear();
    renderer.render(scene, camera);
    if (viewer) { // second pass: the pulled-out case, always on top of the dimmed shelf
      camera.updateMatrixWorld();
      pivot.matrix.copy(camera.matrixWorld); pivot.updateMatrixWorld(true);
      renderer.clearDepth();
      renderer.render(caseScene, camera);
    }
  });
  setFocus(-1);
  resize();
}
