// 3D movie shelf, built from photos of the real one (data: shelf-data.js).
// Full view → click a shelf to fly in → hover/click (or tap) a movie for my Letterboxd entry.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCaseViewer, columns, shearAt, lean, bounds, pick } from "./case-viewer.js?v=1793690123";

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
  // The IMAX case runs the width of the top: its front photo while closed; click it and it turns
  // to the side photo, where the spines (and the box itself, The Odyssey) are clickable.
  let imaxBox = null, imaxFace = null, imaxOpen = false, imaxFlip = null;
  if (imaxRow) {
    const w = W, h = w / imaxRow.aspect, d = D;
    const side = new THREE.MeshStandardMaterial({ color: 0xd9d7e6, roughness: 0.45 });
    imaxRow._tex = tex(imaxRow.img);
    imaxRow._front = imaxRow.front ? tex(imaxRow.front) : imaxRow._tex;
    imaxFace = new THREE.MeshBasicMaterial({ map: imaxRow._front });
    const caseBox = imaxBox = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, imaxFace, side]);
    caseBox.position.set(0, y + h / 2, 0);
    caseBox.add(new THREE.LineSegments(new THREE.EdgesGeometry(caseBox.geometry), new THREE.LineBasicMaterial({ color: 0x05d9e8 })));
    shelf.add(caseBox);
    targets.unshift({ row: imaxRow, mesh: caseBox, w, h, cy: y + h / 2, z: caseBox.position.z + d / 2, x: caseBox.position.x, faceZ: d / 2 });
    y += h;
  }
  const totalH = y;
  shelf.position.y = -totalH / 2;


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

  // Turn the IMAX case to its side view (open) or back to the front photo: a quarter turn out, swap, a quarter turn back.
  const setImaxOpen = (open) => {
    if (!imaxBox || open === imaxOpen) return;
    imaxOpen = open;
    if (reduce) { imaxFace.map = open ? imaxRow._tex : imaxRow._front; imaxFace.needsUpdate = true; return; }
    imaxFlip = { t0: performance.now(), swapped: false };
  };
  const stepImax = (now) => {
    if (!imaxFlip) return;
    const k = Math.min(1, (now - imaxFlip.t0) / 700);
    if (k >= 0.5 && !imaxFlip.swapped) { imaxFace.map = imaxOpen ? imaxRow._tex : imaxRow._front; imaxFace.needsUpdate = true; imaxFlip.swapped = true; }
    const half = k < 0.5 ? ease(k * 2) : 1 - ease((k - 0.5) * 2); // 0 → 1 → 0
    imaxBox.rotation.y = (k < 0.5 ? 1 : -1) * half * (Math.PI / 2) * (imaxOpen ? 1 : -1);
    if (k === 1) { imaxBox.rotation.y = 0; imaxFlip = null; }
  };
  const imaxReady = (tg) => tg.row !== imaxRow || (imaxOpen && !imaxFlip);

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
    setImaxOpen(row === imaxRow);
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
      const act = h.tg.row === imaxRow ? "Click to open it" : focus < 0 ? "Click to look closer" : "Click to move here";
      return placeTip(e, `<strong>${esc(NAMES[h.tg.row.id])}</strong><span>${act}</span>`);
    }
    if (!imaxReady(h.tg)) return clearPick();
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
    if (!imaxReady(h.tg)) return;
    const p = pick(h.tg.row, h.u, h.v);
    if (!p) return clearPick();
    if (!p.it.u) return;
    openCase(h, p); // the case pops out; its panel has the Letterboxd link
  };
  // ---- pop-out 3D case (case-viewer.js): slides off the shelf, turns to face you, drag to spin it
  const cv = createCaseViewer({ renderer, camera, scene, touch, reduce, ui: box.querySelector(".case-ui"),
    onOpen: () => { clearPick(); box.classList.add("case-open"); controls.enabled = false; },
    onClose: () => { box.classList.remove("case-open"); controls.enabled = true; } });
  const { CASES, spineCanvas, sample, designSpine, spineArt, stillImgs, backCanvas } = cv;
  const openCase = (h, p) => cv.open({ row: h.tg.row, it: p.it, zone: p.zone, point: h.point });
  const rayAt = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  };
  if (location.search.includes("shelfdebug")) window.__shelf = { scene, camera, dimmer: cv.dimmer, pivot: cv.pivot, get viewer() { return cv.viewer; },
    // colors read from one spine photo, in bands down its length: __shelf.probe("criterion", 0)
    probe(rowId, k) {
      const tg = targets.find((t) => t.row.id === rowId), R = tg.row, it = columns(R)[k].it, [l, r] = bounds(R, k);
      const ph = spineCanvas(R, it, [lean(R, l, R.v[0]), lean(R, r, R.v[0]), lean(R, r, R.v[1]), lean(R, l, R.v[1])]);
      const out = [];
      for (let y = 0; y < 1; y += 0.05) out.push(y.toFixed(2) + " " + sample(ph, y, y + 0.05).map((n) => n | 0).join(","));
      return { title: it.t, w: ph.width, h: ph.height, bands: out };
    },
    // every designed spine of a row side by side over the page, for checking: __shelf.sheet("criterion")
    async sheet(rowId) {
      const tg = targets.find((t) => t.row.id === rowId), R = tg.row, out = document.createElement("canvas");
      const items = columns(R).map((cc, k) => ({ it: cc.it, k })).filter(({ it }) => it.u);
      await Promise.all(items.map(({ it }) => new Promise((ok) => { if (!it.sp || spineArt(it, ok)) ok(); })));
      const S = 0.32; out.width = items.length * 50; out.height = 1600 * S + 30;
      const g = out.getContext("2d"); g.fillStyle = "#222"; g.fillRect(0, 0, out.width, out.height);
      items.forEach(({ it, k }, n) => {
        const [l, r] = bounds(R, k), zone = [lean(R, l, R.v[0]), lean(R, r, R.v[0]), lean(R, r, R.v[1]), lean(R, l, R.v[1])];
        const d = designSpine(it, spineCanvas(R, it, zone), CASES[it.fm] || CASES.keep, spineArt(it));
        g.drawImage(d, n * 50 + 4, 4, 42, 1600 * S);
      });
      out.style.cssText = "position:fixed;left:0;top:0;z-index:9999;max-width:100vw;background:#222";
      document.body.appendChild(out);
      return items.length;
    },
    // a case's back, flat over the page: __shelf.back("Aftersun")
    async back(title) {
      const it = targets.flatMap((t) => t.row.items).find((x) => x.t === title); if (!it) return false;
      await Promise.all((it.st || []).map(() => new Promise((ok) => { if (stillImgs(it, ok).every(Boolean)) ok(); })));
      const c = backCanvas(it, stillImgs(it));
      c.style.cssText = "position:fixed;left:8px;top:8px;z-index:9999;height:94vh"; document.body.appendChild(c);
      return c;
    },
    // open a case by title, for checking designs: __shelf.open("Barry Lyndon")
    open(title) {
      for (const tg of targets) {
        const it = tg.row.items.find((x) => x.t === title); if (!it) continue;
        const k = columns(tg.row).findIndex((cc) => cc.it === it), R = tg.row;
        const zone = it.poly || (([l, r]) => [lean(R, l, R.v[0]), lean(R, r, R.v[0]), lean(R, r, R.v[1]), lean(R, l, R.v[1])])(bounds(R, k));
        openCase({ tg, point: tg.mesh.getWorldPosition(new THREE.Vector3()) }, { it, zone });
        return true;
      }
      return false;
    } };

  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY }; lastInteract = performance.now(); });
  canvas.addEventListener("pointermove", (e) => {
    if (cv.active) {
      if (down) { cv.spin(e.clientX - down.lastX, e.clientY - down.lastY); down.lastX = e.clientX; down.lastY = e.clientY; }
      const onCase = !down && cv.hit(rayAt(e));
      canvas.style.cursor = down ? "grabbing" : onCase && cv.reviewHit(ray) ? "pointer" : onCase ? "grab" : "zoom-out";
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
    if (cv.active) { // click the review on the back: read it; click the shelf around the case: put it back
      cv.endDrag();
      if (still) { if (!cv.hit(rayAt(e))) cv.close(); else if (cv.reviewHit(ray)) cv.openReview(); }
    }
    else if (still) tap(e);
    down = null;
  });
  canvas.addEventListener("pointerleave", () => { if (!selected) clearPick(); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (cv.active) cv.close(); else setFocus(-1); return; }
    if (cv.active && e.key === "Enter" && cv.it.u) { cv.openReview(); return; }
    if (cv.active) return;
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
    cv.step(now);
    stepImax(now);
    controls.update();
    renderer.clear();
    renderer.render(scene, camera);
    cv.render(); // second pass: the pulled-out case, always on top of the dimmed shelf
  });
  setFocus(-1);
  resize();
}
