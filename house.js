// The 3D apartment (house.html): front door → living room → theater, more rooms to come.
// Cartoon look: toon-shaded rounded blocks with ink outlines, lit by neon (bloom makes it glow).
// Live bits: the theater screen shows my latest Letterboxd watch, the window shows DC's time and
// the Bitcoin block height, and the theater bookcase opens the 3D movie shelf.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const S = window.SITE || {};
const $ = (s) => document.querySelector(s);
const canvas = $("#house");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = matchMedia("(pointer: coarse)").matches;
const ui = { room: $("#h-room"), back: $("#h-back"), hint: $("#h-hint"), tip: $("#h-tip"), toast: $("#h-toast"), load: $("#h-load") };

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
catch (e) { document.body.classList.add("no-3d"); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07050f);
scene.fog = new THREE.Fog(0x07050f, 16, 34);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 80);
const loader = new THREE.TextureLoader();

// ---------- materials + building blocks ----------
const H = 3.4; // ceiling height (metres)
const grad = new THREE.DataTexture(new Uint8Array([80, 80, 80, 255, 165, 165, 165, 255, 255, 255, 255, 255]), 3, 1);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true; // three flat bands of light: the cartoon look
const toon = (color, o = {}) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...o });
const glowMat = (color, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
const inkMat = new THREE.MeshBasicMaterial({ color: 0x05030a, side: THREE.BackSide });
const lineMat = new THREE.LineBasicMaterial({ color: 0x05030a });

// A chunky rounded block with a cartoon ink outline (a slightly bigger, inside-out black copy).
const block = (w, h, d, color, x, y, z, { parent = scene, r = 0.07, mat, ink = true, rot } = {}) => {
  const geo = new RoundedBoxGeometry(w, h, d, 3, Math.max(0.004, Math.min(r, Math.min(w, h, d) / 2 - 0.002)));
  const m = new THREE.Mesh(geo, mat || toon(color));
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  if (ink) { const o = 0.045, hull = new THREE.Mesh(geo, inkMat); hull.scale.set((w + o) / w, (h + o) / h, (d + o) / d); m.add(hull); }
  parent.add(m);
  return m;
};
// Walls, floors, ceilings: plain boxes with ink edges.
const slab = (w, h, d, color, x, y, z, { parent = scene } = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y, z);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), lineMat));
  parent.add(m);
  return m;
};
const ball = (r, color, x, y, z, { parent = scene } = {}) => {
  const geo = new THREE.SphereGeometry(r, 18, 14), m = new THREE.Mesh(geo, toon(color));
  m.position.set(x, y, z); const hull = new THREE.Mesh(geo, inkMat); hull.scale.setScalar(1 + 0.05 / r); m.add(hull);
  parent.add(m); return m;
};
// A neon tube: a thin glowing bar.
const tube = (w, h, d, color, x, y, z, { parent = scene, k = 2.2 } = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glowMat(color, k)); m.position.set(x, y, z); parent.add(m); return m;
};
// Neon lettering, drawn on a canvas with a glow and a hot white core.
const textTexture = (text, font, color) => {
  const c = document.createElement("canvas"), x = c.getContext("2d"), px = +font.match(/(\d+)px/)[1], pad = px * 0.35;
  x.font = font; c.width = Math.ceil(x.measureText(text).width + pad * 2); c.height = Math.ceil(px * 1.35 + pad * 2);
  x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = color; x.shadowColor = color; x.shadowBlur = px * 0.25; x.fillText(text, c.width / 2, c.height / 2);
  x.shadowBlur = 0; x.globalAlpha = 0.22; x.fillStyle = "#fff"; x.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
};
const sign = (text, height, x, y, z, { color = "#ff2a6d", font = "700 140px Rajdhani", rotY = 0, parent = scene, k = 1.5 } = {}) => {
  const t = textTexture(text, font, color), w = (height * t.image.width) / t.image.height;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, height), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(k, k, k) }));
  m.position.set(x, y, z); m.rotation.y = rotY; m.userData.k = k; parent.add(m);
  return m;
};
// "Coming soon" tape across a door.
const tape = (x, y, z, rotY, w = 1.3) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  block(w, 0.12, 0.02, 0xf9f002, 0, 0.15, 0, { parent: g, rot: [0, 0, 0.32], r: 0.008 });
  block(w, 0.12, 0.02, 0xf9f002, 0, -0.15, 0.01, { parent: g, rot: [0, 0, -0.3], r: 0.008 });
  return g;
};

// ---------- clickable spots ----------
const hot = []; // { obj, room, label, sub, act }
const addHot = (obj, room, label, sub, act) => { obj.userData.hot = hot.length; hot.push({ obj, room, label, sub, act }); };

// ---------- the front hallway (outside the apartment, +z) ----------
let doorPivot;
const buildOutside = () => {
  const wallC = 0x2d2160;
  slab(8, 0.1, 12, 0x1b1430, 0, -0.05, 6); slab(8, 0.1, 12, 0x120d24, 0, H + 0.05, 6);
  slab(0.2, H, 12, 0x251b4d, -4, H / 2, 6); slab(0.2, H, 12, 0x251b4d, 4, H / 2, 6); slab(8, H, 0.2, 0x251b4d, 0, H / 2, 12);
  // the front wall, with the door opening in the middle (shared with the living room)
  slab(3.3, H, 0.2, wallC, -2.35, H / 2, 0); slab(3.3, H, 0.2, wallC, 2.35, H / 2, 0);
  slab(1.4, H - 2.4, 0.2, wallC, 0, 2.4 + (H - 2.4) / 2, 0);
  for (const s of [-1, 1]) tube(0.04, 2.44, 0.04, 0x05d9e8, s * 0.74, 1.22, 0.12, { k: 1.3 });
  tube(1.52, 0.04, 0.04, 0x05d9e8, 0, 2.44, 0.12, { k: 1.3 });
  // the door, on a hinge at its left edge
  doorPivot = new THREE.Group(); doorPivot.position.set(-0.68, 0, 0); scene.add(doorPivot);
  const door = block(1.36, 2.36, 0.08, 0xb3195a, 0.68, 1.18, 0, { parent: doorPivot, r: 0.03 });
  block(1.0, 0.9, 0.03, 0x8e1248, 0.68, 1.75, 0.05, { parent: doorPivot, r: 0.02 });
  block(1.0, 0.9, 0.03, 0x8e1248, 0.68, 0.62, 0.05, { parent: doorPivot, r: 0.02 });
  ball(0.055, 0xf9f002, 1.2, 1.12, 0.09, { parent: doorPivot });
  sign("1B", 0.16, 0.68, 2.08, 0.07, { parent: doorPivot, color: "#f9f002", font: "700 100px Rajdhani", k: 1.1 });
  addHot(doorPivot, "outside", "Come on in", touch ? "Tap to open the door" : "Click to open the door", () => go("living"));
  sign("PIERPONT", 0.55, 0, 2.93, 0.12, { color: "#ff2a6d", k: 1.7 }).userData.flicker = true;
  sign("APT 1B · DC", 0.13, 1.35, 1.65, 0.11, { color: "#05d9e8", font: "500 70px 'JetBrains Mono'", k: 1.2 });
  for (const s of [-1, 1]) { tube(0.08, 0.34, 0.04, 0x05d9e8, s * 1.45, 2.05, 0.12, { k: 1.6 }); }
  const lamp = new THREE.PointLight(0x05d9e8, 5, 7); lamp.position.set(0, 2.3, 1.4); scene.add(lamp);
  const warm = new THREE.PointLight(0xff2a6d, 4, 7); warm.position.set(0, 2.9, 0.8); scene.add(warm);
  // doormat and a plant
  block(1.4, 0.03, 0.8, 0x3a2d63, 0, 0.015, 0.75, { r: 0.012 });
  const mat = sign("WELCOME", 0.24, 0, 0.034, 0.75, { color: "#f9f002", k: 1.05 }); mat.rotation.x = -Math.PI / 2;
  block(0.42, 0.46, 0.42, 0x5b3a8a, 2.4, 0.23, 0.55, { r: 0.05 });
  ball(0.28, 0x17b890, 2.4, 0.72, 0.55); ball(0.22, 0x1fd6a5, 2.25, 0.95, 0.5); ball(0.2, 0x149e7c, 2.56, 0.92, 0.62);
  tube(7.6, 0.03, 0.06, 0x7b2cbf, 0, H - 0.03, 6, { k: 1.8 });
};

// ---------- the living room (z 0 … -7) ----------
let windowTex, windowCanvas;
const buildLiving = () => {
  const wallC = 0x2a1f58;
  slab(12, 0.1, 7, 0x1c1436, 0, -0.05, -3.5); slab(12, 0.1, 7, 0x140e2a, 0, H + 0.05, -3.5);
  slab(0.2, H, 7, wallC, -6, H / 2, -3.5); slab(0.2, H, 7, wallC, 6, H / 2, -3.5);
  // back wall: theater doorway | wall | window | wall | music door
  slab(0.8, H, 0.2, wallC, -5.6, H / 2, -7);
  slab(1.4, H - 2.4, 0.2, wallC, -4.5, 2.4 + (H - 2.4) / 2, -7);
  slab(1.2, H, 0.2, wallC, -3.2, H / 2, -7);
  slab(5.2, 0.9, 0.2, wallC, 0, 0.45, -7);
  slab(5.2, H - 2.9, 0.2, wallC, 0, 2.9 + (H - 2.9) / 2, -7);
  slab(1.2, H, 0.2, wallC, 3.2, H / 2, -7);
  slab(1.4, H - 2.4, 0.2, wallC, 4.5, 2.4 + (H - 2.4) / 2, -7);
  slab(0.8, H, 0.2, wallC, 5.6, H / 2, -7);

  // theater doorway (open, framed in cyan)
  for (const s of [-1, 1]) tube(0.04, 2.44, 0.04, 0x05d9e8, -4.5 + s * 0.72, 1.22, -6.88);
  tube(1.48, 0.04, 0.04, 0x05d9e8, -4.5, 2.44, -6.88);
  const theaterSign = sign("THEATER", 0.34, -4.5, 2.8, -6.88, { color: "#05d9e8", k: 1.6 });
  // an invisible plane filling the doorway takes the clicks; the sign above lights up on hover
  const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.9), new THREE.MeshBasicMaterial({ visible: false }));
  doorway.position.set(-4.5, 1.45, -6.95); scene.add(doorway);
  addHot(doorway, "living", "Theater", "My latest watch and the movie shelf", () => go("theater"));
  doorway.userData.glow = [theaterSign];

  // rooms still being built: closed doors with tape
  const soon = (name, x, z, rotY, lx, lz) => {
    const g = new THREE.Group(); scene.add(g);
    const d = block(1.36, 2.36, 0.08, 0x3b2a75, 0, 1.18, 0, { parent: g, r: 0.03 });
    ball(0.05, 0xf9f002, 0.52, 1.12, 0.07, { parent: g });
    g.position.set(x, 0, z); g.rotation.y = rotY;
    const label = sign(name, 0.3, lx, 2.8, lz, { color: "#b98cff", rotY, k: 1.3 });
    tape(x + Math.sin(rotY) * 0.06, 1.25, z + Math.cos(rotY) * 0.06, rotY);
    addHot(g, "living", name.charAt(0) + name.slice(1).toLowerCase(), "Under construction", () => toast(`The ${name.toLowerCase()} room is under construction. Check back soon.`));
    g.userData.glow = [label];
    return g;
  };
  soon("MUSIC", 4.5, -6.92, 0, 4.5, -6.88);
  soon("CLOSET", -5.86, -1.9, Math.PI / 2, -5.88, -1.9);
  soon("GALLERY", 5.86, -3.6, -Math.PI / 2, 5.88, -3.6);

  // the window onto DC (a canvas: skyline + a little HUD with the time and block height)
  windowCanvas = document.createElement("canvas"); windowCanvas.width = 2080; windowCanvas.height = 800;
  windowTex = new THREE.CanvasTexture(windowCanvas); windowTex.colorSpace = THREE.SRGBColorSpace; windowTex.anisotropy = 8;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), new THREE.MeshBasicMaterial({ map: windowTex, toneMapped: false }));
  glass.position.set(0, 1.9, -7.02); scene.add(glass);
  for (const s of [-1, 1]) tube(0.05, 2.06, 0.05, 0x05d9e8, s * 2.62, 1.9, -6.9, { k: 1.4 });
  for (const yy of [0.88, 2.92]) tube(5.3, 0.05, 0.05, 0x05d9e8, 0, yy, -6.9, { k: 1.4 });
  block(0.07, 2.0, 0.07, 0x140e2a, 0, 1.9, -6.95, { ink: false });
  block(5.5, 0.08, 0.34, 0x3a2a75, 0, 0.92, -6.8, { r: 0.02 });
  addHot(glass, "living", "DC at night", "Live: local time and the latest Bitcoin block", () => toast(`It's ${clockFmt.format(new Date())} in DC${height ? `. Bitcoin is at block ${height.toLocaleString()}.` : "."}`));

  // couch facing the window, coffee table, lamp, rug, plant, neon art
  block(5, 0.025, 3.2, 0x3d1f63, 0, 0.013, -5.2, { ink: false, r: 0.01 });
  block(4.6, 0.03, 2.8, 0x4c2680, 0, 0.02, -5.2, { ink: false, r: 0.01 });
  const couchC = 0x3b2f8f;
  block(3.0, 0.42, 1.0, couchC, 0, 0.31, -4.7);
  block(3.0, 0.7, 0.28, couchC, 0, 0.75, -4.22, { r: 0.12 });
  for (const s of [-1, 1]) block(0.3, 0.62, 1.04, couchC, s * 1.5, 0.42, -4.7, { r: 0.12 });
  for (const s of [-1, 1]) block(1.36, 0.16, 0.8, 0x4a3aa8, s * 0.7, 0.6, -4.78, { r: 0.07 });
  block(0.5, 0.42, 0.14, 0xff4f8b, -1.0, 0.86, -4.45, { rot: [0, 0, 0.22], r: 0.06 });
  block(0.46, 0.4, 0.14, 0x0fc4d2, 1.0, 0.86, -4.45, { rot: [0, 0, -0.18], r: 0.06 });
  block(1.6, 0.08, 0.7, 0x4b2f6e, 0, 0.46, -5.95, { r: 0.03 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(0.07, 0.42, 0.07, 0x2a1a45, sx * 0.7, 0.21, -5.95 + sz * 0.28, { r: 0.02 });
  // a Rubik's cube (like the one on my real shelf) and a mug
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), [0xff7a1a, 0xf4f3ff, 0xf9f002, 0x2b2b2b, 0x1f8bff, 0xff2a6d].map((c) => toon(c)));
  cube.position.set(0.42, 0.585, -5.9); cube.rotation.y = 0.6; scene.add(cube);
  const ch = new THREE.Mesh(cube.geometry, inkMat); ch.scale.setScalar(1.25); cube.add(ch);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.11, 16), toon(0xf4f3ff)); mug.position.set(-0.4, 0.555, -5.95); scene.add(mug);
  const mh = new THREE.Mesh(mug.geometry, inkMat); mh.scale.setScalar(1.18); mug.add(mh);
  // floor lamp
  block(0.05, 1.55, 0.05, 0x221a40, 2.35, 0.8, -4.3, { r: 0.02 });
  block(0.4, 0.04, 0.4, 0x221a40, 2.35, 0.02, -4.3, { r: 0.02 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.36, 20, 1, true), toon(0xff7aa8, { emissive: 0x3a0a20, side: THREE.DoubleSide }));
  shade.position.set(2.35, 1.72, -4.3); scene.add(shade);
  const lampLight = new THREE.PointLight(0xff4f8b, 4, 6); lampLight.position.set(2.35, 1.5, -4.3); scene.add(lampLight);
  // plant
  block(0.46, 0.5, 0.46, 0x5b3a8a, 5.25, 0.25, -6.25, { r: 0.05 });
  ball(0.34, 0x17b890, 5.25, 0.82, -6.25); ball(0.26, 0x1fd6a5, 5.05, 1.12, -6.2); ball(0.24, 0x149e7c, 5.42, 1.08, -6.35);
  // neon art: I stack sats
  sign("STACK SATS", 0.42, -5.88, 2.05, -4.8, { color: "#f9f002", rotY: Math.PI / 2, k: 1.45 }).userData.flicker = true;
  tube(11.6, 0.03, 0.06, 0xff2a6d, 0, H - 0.03, -0.25, { k: 1.4 });
  const winLight = new THREE.PointLight(0x7b5cff, 6, 9); winLight.position.set(0, 2.2, -6.2); scene.add(winLight);
  const fill = new THREE.PointLight(0x05d9e8, 3, 10); fill.position.set(3.5, 2.6, -2); scene.add(fill);
};

// ---------- the theater (behind the living room's back wall: x -9 … 0, z -7 … -17) ----------
let screenTex, screenCanvas, latest = null;
const buildTheater = () => {
  const wallC = 0x1d1340;
  slab(9, 0.1, 10, 0x120c22, -4.5, -0.05, -12); slab(9, 0.1, 10, 0x0c0818, -4.5, H + 0.05, -12);
  slab(0.2, H, 10, wallC, -9, H / 2, -12); slab(0.2, H, 10, wallC, 0, H / 2, -12);
  slab(9, H, 0.2, wallC, -4.5, H / 2, -17); slab(3, H, 0.2, wallC, -7.5, H / 2, -7);
  // the screen: a canvas showing my latest Letterboxd watch
  block(6.5, 3.7, 0.12, 0x0b0816, -4.5, 2.0, -16.86, { r: 0.04 });
  screenCanvas = document.createElement("canvas"); screenCanvas.width = 1600; screenCanvas.height = 900;
  screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 3.43), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(-4.5, 2.0, -16.79); scene.add(screen);
  addHot(screen, "theater", "Now showing", "Click to read my review on Letterboxd", () => latest?.link && window.open(latest.link, "_blank", "noopener"));
  for (const x of [-8.15, -0.85]) block(0.9, 3.5, 0.3, 0x8c1650, x, 1.75, -16.6, { r: 0.14 });
  block(7.6, 0.25, 1.2, 0x2a1a52, -4.5, 0.125, -16.2, { r: 0.04 });
  const glow = new THREE.PointLight(0x9ad7ff, 5, 11); glow.position.set(-4.5, 2.0, -15.3); scene.add(glow);
  // seats: two rows, the back one on a riser
  block(9, 0.3, 2.6, 0x1a1130, -4.5, 0.15, -10.3, { ink: false, r: 0.01 });
  const seat = (x, y, z) => {
    block(0.9, 0.4, 0.82, 0x6b1d9b, x, y + 0.3, z, { r: 0.1 });
    block(0.9, 0.85, 0.22, 0x6b1d9b, x, y + 0.72, z + 0.38, { r: 0.1 });
    for (const s of [-1, 1]) block(0.12, 0.55, 0.84, 0x4b1470, x + s * 0.5, y + 0.38, z, { r: 0.05 });
  };
  for (const x of [-6.4, -4.5, -2.6]) { seat(x, 0, -12.6); seat(x, 0.3, -10.6); }
  for (const x of [-8.7, -0.3]) tube(0.04, 0.02, 9.6, 0x05d9e8, x, 0.02, -12, { k: 1.6 });
  // stars on the ceiling
  const pts = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) { pts[i * 3] = -8.8 + Math.random() * 8.6; pts[i * 3 + 1] = H - 0.01; pts[i * 3 + 2] = -7.2 - Math.random() * 9.6; }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pts, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, toneMapped: false }));
  scene.add(stars);
  // the bookcase on the left wall: my real shelf photos; opens the 3D shelf
  const shelf = new THREE.Group(); scene.add(shelf);
  block(0.45, 2.95, 3.0, 0x2b1d55, -8.72, 1.6, -14.2, { parent: shelf, r: 0.05 });
  ["top", "criterion", "steel", "bottom"].forEach((row, i) => {
    const t = loader.load(`images/shelf/${row}.jpg`, (tt) => {
      const a = tt.image.width / tt.image.height, want = 2.7 / 0.6; // crop each photo to a band of spines
      if (a < want) { tt.repeat.set(1, a / want); tt.offset.set(0, (1 - a / want) / 2); }
      else { tt.repeat.set(want / a, 1); tt.offset.set((1 - want / a) / 2, 0); }
    });
    t.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.6), new THREE.MeshBasicMaterial({ map: t }));
    p.position.set(-8.48, 2.68 - i * 0.7, -14.2); p.rotation.y = Math.PI / 2; shelf.add(p);
    block(0.4, 0.05, 2.9, 0x3a2a75, -8.6, 2.68 - i * 0.7 - 0.33, -14.2, { parent: shelf, r: 0.02 });
  });
  const shelfSign = sign("MY SHELF", 0.22, -8.47, 3.2, -14.2, { color: "#05d9e8", rotY: Math.PI / 2, k: 1.5 });
  addHot(shelf, "theater", "My movie shelf", "Click to browse every movie I own", openShelf);
  shelf.userData.glow = [shelfSign];
  // popcorn machine and a NOW SHOWING sign
  block(0.7, 0.8, 0.6, 0xd11e48, -1.1, 0.4, -14.6, { r: 0.05 });
  block(0.66, 0.62, 0.56, 0x05d9e8, -1.1, 1.12, -14.6, { mat: toon(0x05d9e8, { transparent: true, opacity: 0.28 }), r: 0.03 });
  block(0.76, 0.14, 0.66, 0xd11e48, -1.1, 1.5, -14.6, { r: 0.05 });
  for (let i = 0; i < 14; i++) ball(0.05, i % 3 ? 0xfff2b0 : 0xf9f002, -1.32 + (i % 5) * 0.11, 0.9 + Math.floor(i / 5) * 0.08, -14.6 + ((i * 37) % 5 - 2) * 0.08);
  sign("POPCORN", 0.14, -1.1, 1.68, -14.28, { color: "#f9f002", k: 1.3 });
  sign("NOW SHOWING", 0.32, -0.12, 2.65, -12.2, { color: "#ff2a6d", rotY: -Math.PI / 2, k: 1.5 }).userData.flicker = true;
  const dim = new THREE.PointLight(0x7b5cff, 3, 12); dim.position.set(-4.5, 3.0, -11); scene.add(dim);
};

// ---------- live canvases ----------
const clockFmt = (() => {
  try { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: S.timezone || undefined }); }
  catch { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }); }
})();
let height = 0, skyline = null;
const drawSkyline = () => { // drawn once; the HUD is layered on top every few seconds
  const c = document.createElement("canvas"); c.width = 2080; c.height = 800; const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 800); g.addColorStop(0, "#0b0424"); g.addColorStop(0.65, "#3a1062"); g.addColorStop(1, "#ff4f8b");
  x.fillStyle = g; x.fillRect(0, 0, 2080, 800);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`; x.fillRect(rnd() * 2080, rnd() * 420, 2 + rnd() * 2, 2 + rnd() * 2); }
  x.fillStyle = "#ffe9f5"; x.shadowColor = "#ff9fc8"; x.shadowBlur = 40; x.beginPath(); x.arc(1700, 150, 62, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
  const layer = (color, base, min, max, lit) => {
    for (let px = -20; px < 2100;) {
      const w = 60 + rnd() * 110, h = min + rnd() * (max - min);
      x.fillStyle = color; x.fillRect(px, base - h, w, h + 400);
      if (lit) for (let wy = base - h + 16; wy < base - 10; wy += 26) for (let wx = px + 10; wx < px + w - 12; wx += 22)
        if (rnd() < 0.34) { x.fillStyle = rnd() < 0.7 ? "#ffd36b" : "#05d9e8"; x.fillRect(wx, wy, 9, 12); }
      px += w + 6;
    }
  };
  layer("#24104a", 690, 140, 300, false);
  // the Capitol dome and the Washington Monument, cartoon style
  x.fillStyle = "#1a0b38";
  x.fillRect(560, 560, 420, 160); x.fillRect(680, 500, 180, 70);
  x.beginPath(); x.ellipse(770, 500, 95, 105, 0, Math.PI, 0); x.fill(); x.fillRect(762, 360, 16, 50);
  x.beginPath(); x.moveTo(1290, 230); x.lineTo(1322, 260); x.lineTo(1338, 720); x.lineTo(1242, 720); x.lineTo(1258, 260); x.closePath(); x.fill();
  x.fillStyle = "#ff2a6d"; x.shadowColor = "#ff2a6d"; x.shadowBlur = 20; x.beginPath(); x.arc(1290, 252, 7, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
  layer("#12082a", 800, 60, 170, true);
  skyline = c;
};
const drawWindow = () => {
  if (!windowCanvas) return;
  if (!skyline) drawSkyline();
  const x = windowCanvas.getContext("2d");
  x.drawImage(skyline, 0, 0);
  x.fillStyle = "rgba(10,6,24,.55)"; x.fillRect(60, 52, 600, height ? 200 : 140);
  x.font = "500 34px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.textBaseline = "top"; x.fillText(`>> ${(S.location || "DC").toUpperCase()} · LOCAL TIME`, 86, 74);
  x.font = "700 96px Rajdhani"; x.fillStyle = "#05d9e8"; x.shadowColor = "#05d9e8"; x.shadowBlur = 18; x.fillText(clockFmt.format(new Date()), 84, 110); x.shadowBlur = 0;
  if (height) { x.font = "500 34px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.fillText(`BLOCK ${height.toLocaleString()}`, 86, 210); }
  windowTex.needsUpdate = true;
};
const stars = (n) => "★".repeat(Math.floor(n)) + (n % 1 ? "½" : "");
const wrap = (x, text, maxW, maxLines) => {
  const out = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > maxW && line) { out.push(line); line = w; if (out.length === maxLines) break; } else line = t;
  }
  if (out.length < maxLines && line) out.push(line);
  else if (out.length === maxLines) out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, "…");
  return out;
};
const drawScreen = (poster) => {
  const x = screenCanvas.getContext("2d"), W = 1600, Hh = 900;
  const g = x.createLinearGradient(0, 0, W, Hh); g.addColorStop(0, "#160a3a"); g.addColorStop(1, "#08040f");
  x.fillStyle = g; x.fillRect(0, 0, W, Hh);
  for (let y = 0; y < Hh; y += 4) { x.fillStyle = "rgba(255,255,255,.025)"; x.fillRect(0, y, W, 1); }
  x.textBaseline = "top";
  if (!latest) { x.font = "700 90px Rajdhani"; x.fillStyle = "#f4f3ff"; x.fillText("Loading the feature…", 120, 380); screenTex.needsUpdate = true; return; }
  if (poster) {
    x.drawImage(poster, 100, 130, 420, 630);
    x.strokeStyle = "#05d9e8"; x.lineWidth = 4; x.shadowColor = "#05d9e8"; x.shadowBlur = 18; x.strokeRect(100, 130, 420, 630); x.shadowBlur = 0;
  }
  const L = poster ? 600 : 120, MW = W - L - 100;
  x.font = "500 34px 'JetBrains Mono'"; x.fillStyle = "#05d9e8"; x.fillText("NOW SHOWING · MY LATEST WATCH", L, 140);
  x.font = "700 104px Rajdhani"; x.fillStyle = "#f4f3ff";
  let y = 196; for (const l of wrap(x, latest.title, MW, 2)) { x.fillText(l, L, y); y += 100; }
  x.font = "500 38px Inter"; x.fillStyle = "#9d9dc0";
  const when = latest.watched ? new Date(latest.watched + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  x.fillText([latest.year, when && `watched ${when}`].filter(Boolean).join("  ·  "), L, y + 14); y += 80;
  if (latest.rating) { x.font = "80px sans-serif"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 16; x.fillText(stars(latest.rating) + (latest.liked ? " " : ""), L, y); x.shadowBlur = 0; if (latest.liked) { x.fillStyle = "#ff2a6d"; x.fillText("♥", L + x.measureText(stars(latest.rating) + " ").width, y); } y += 110; }
  if (latest.review) {
    x.font = "italic 400 38px Inter"; x.fillStyle = "#d6d6e7";
    for (const l of wrap(x, `“${latest.review.replace(/\s+/g, " ").trim()}”`, MW, 4)) { x.fillText(l, L, y); y += 52; }
  }
  x.font = "500 30px 'JetBrains Mono'"; x.fillStyle = "#ff2a6d"; x.fillText(touch ? "TAP THE SCREEN TO READ MY REVIEW ↗" : "CLICK THE SCREEN TO READ MY REVIEW ↗", L, 790);
  screenTex.needsUpdate = true;
};
const loadLive = () => {
  fetch("data/feeds.json", { cache: "no-cache" }).then((r) => r.json()).then((f) => {
    latest = f.letterboxd?.diary?.[0] || null;
    if (!latest) return drawScreen(null);
    const img = new Image();
    img.onload = () => drawScreen(img); img.onerror = () => drawScreen(null);
    img.src = `data/now-showing.jpg?${encodeURIComponent(latest.published || latest.title)}`;
  }).catch(() => drawScreen(null));
  const tip = () => fetch("https://mempool.space/api/blocks/tip/height").then((r) => r.text()).then((t) => { height = +t || height; drawWindow(); }).catch(() => {});
  tip(); setInterval(tip, 120000);
  drawWindow(); setInterval(drawWindow, 15000);
};

// ---------- camera: fixed spots, glided between along curves ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const VIEWS = {
  outside: { pos: V(0, 1.6, 5.4), look: V(0, 1.45, 0), name: "Front door", yaw: 0.4,
    hint: touch ? "Tap the door to come in" : "Click the door to come in" },
  living: { pos: V(0, 1.72, -0.6), look: V(0, 1.45, -7), name: "Living room", yaw: 0.8,
    hint: touch ? "Tap a doorway · swipe to look around" : "Click a doorway · drag to look around" },
  theater: { pos: V(-4.5, 2.15, -8.2), look: V(-4.5, 1.85, -17), name: "Theater", yaw: 0.65,
    hint: touch ? "Tap the screen for my review · tap the bookcase for my shelf" : "Click the screen for my review · click the bookcase for my shelf" },
};
const PATHS = { // waypoints for position and where the camera looks, from → to
  "outside>living": { pos: [V(0, 1.6, 5.4), V(0, 1.62, 2.2), V(0, 1.66, 0.4), V(0, 1.72, -0.6)], look: [V(0, 1.45, 0), V(0, 1.5, -3), V(0, 1.45, -6), V(0, 1.45, -7)] },
  "living>theater": { pos: [V(0, 1.72, -0.6), V(-2.4, 1.72, -3.6), V(-4.5, 1.76, -6.1), V(-4.5, 1.95, -7.5), V(-4.5, 2.15, -8.2)], look: [V(0, 1.45, -7), V(-4.5, 1.6, -7.5), V(-4.5, 1.7, -10), V(-4.5, 1.8, -14), V(-4.5, 1.85, -17)] },
};
let room = "outside", flight = null, yaw = 0, pitch = 0, doorOpen = 0, doorTo = 0;
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const fly = (from, to, after) => {
  const fwd = PATHS[`${from}>${to}`], back = PATHS[`${to}>${from}`];
  const p = fwd || { pos: [...back.pos].reverse(), look: [...back.look].reverse() };
  if (reduce) { flight = null; room = to; after?.(); return; }
  flight = { t0: performance.now(), dur: 1700, pos: new THREE.CatmullRomCurve3(p.pos), look: new THREE.CatmullRomCurve3(p.look), yaw0: yaw, pitch0: pitch, after };
};
const setRoomUI = () => {
  const v = VIEWS[room];
  ui.room.textContent = v.name; ui.hint.textContent = v.hint; ui.back.hidden = room === "outside";
  document.title = room === "outside" ? "Pierpont's apartment" : `${v.name} · Pierpont's apartment`;
};
const go = (to) => {
  if (flight || to === room) return;
  hideTip();
  if (to === "screen") { if (room !== "theater") go("theater"); return latest?.link && window.open(latest.link, "_blank", "noopener"); }
  if (to === "shelf") { if (room !== "theater") go("theater"); return openShelf(); }
  const from = room;
  const route = { outside: { living: ["living"], theater: ["living", "theater"] }, living: { outside: ["outside"], theater: ["theater"] }, theater: { living: ["living"], outside: ["living", "outside"] } }[from][to];
  const step = (i, cur) => {
    if (i >= route.length) return;
    const nxt = route[i];
    const launch = () => fly(cur, nxt, () => { room = nxt; setRoomUI(); if (nxt === "outside") doorTo = 0; step(i + 1, nxt); });
    if (cur === "outside" && nxt === "living" && doorOpen < 0.99) { doorTo = 1; setTimeout(launch, reduce ? 0 : 650); } else launch();
  };
  ui.hint.textContent = "";
  step(0, from);
};
const back = () => go(room === "theater" ? "living" : "outside");
ui.back.addEventListener("click", back);
document.querySelectorAll(".h-nav [data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#h-shelf").open) back(); });

let toastTimer;
const toast = (msg) => { ui.toast.textContent = msg; ui.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (ui.toast.hidden = true), 3200); };

// ---------- the shelf pop-up (the main page's 3D shelf, loaded the first time) ----------
const shelfDlg = $("#h-shelf");
let shelfLoaded = false;
function openShelf() {
  shelfDlg.showModal();
  if (!shelfLoaded) { shelfLoaded = true; import(`./shelf.js${new URL(import.meta.url).search}`); }
}
$("#h-shelf-close").addEventListener("click", () => shelfDlg.close());
shelfDlg.addEventListener("click", (e) => { if (e.target === shelfDlg) shelfDlg.close(); });
shelfDlg.addEventListener("cancel", (e) => { if ($("#shelf3d").classList.contains("case-open")) e.preventDefault(); }); // Esc puts a pulled-out case back first

// ---------- pointer: hover glow + tooltip, click to act, drag to look around ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hovered = null, down = null;
const pickAt = (e) => {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const objs = hot.filter((h) => h.room === room).map((h) => h.obj);
  for (const hit of ray.intersectObjects(objs, true)) {
    let o = hit.object; while (o && o.userData.hot === undefined) o = o.parent;
    if (o) return hot[o.userData.hot];
  }
  return null;
};
const setGlow = (h, on) => {
  const list = h.obj.userData.glow || [];
  h.obj.traverse((o) => { if (o.material?.isMeshToonMaterial) o.material.emissive.setHex(on ? 0x2a0c22 : 0); });
  for (const s of list) s.material.color.setScalar(on ? s.userData.k * 1.5 : s.userData.k);
};
const hideTip = () => { ui.tip.hidden = true; if (hovered) setGlow(hovered, false); hovered = null; canvas.style.cursor = ""; };
const showTip = (e, h) => {
  ui.tip.innerHTML = `<strong>${h.label}</strong><span>${h.sub}</span>`; ui.tip.hidden = false;
  const tw = ui.tip.offsetWidth, th = ui.tip.offsetHeight;
  ui.tip.style.transform = `translate(${Math.min(e.clientX + 16, innerWidth - tw - 8)}px, ${Math.min(e.clientY + 16, innerHeight - th - 8)}px)`;
};
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (down) {
    if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down.drag = true; hideTip(); }
    if (down.drag && !flight) {
      const lim = VIEWS[room].yaw;
      yaw = THREE.MathUtils.clamp(yaw + (e.clientX - down.lx) * 0.004, -lim, lim);
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - down.ly) * 0.003, -0.3, 0.3);
      down.lx = e.clientX; down.ly = e.clientY;
      canvas.style.cursor = "grabbing";
    }
    return;
  }
  if (e.pointerType !== "mouse" || flight) return;
  const h = pickAt(e);
  if (h !== hovered) { if (hovered) setGlow(hovered, false); hovered = h; if (h) setGlow(h, true); }
  if (h) { showTip(e, h); canvas.style.cursor = "pointer"; } else { ui.tip.hidden = true; canvas.style.cursor = "grab"; }
});
canvas.addEventListener("pointerup", (e) => {
  const wasDrag = down?.drag; down = null; canvas.style.cursor = "";
  if (wasDrag || flight) return;
  const h = pickAt(e);
  if (h) { hideTip(); h.act(); }
});
canvas.addEventListener("pointerleave", hideTip);

// ---------- size, loop ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const resize = () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  // Keep about 75° across on any screen (phones get a taller view; swipe to look around).
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(37)) / camera.aspect)), 50, 78);
  camera.updateProjectionMatrix();
  // Tall screens: sit over the back row in the theater, so the screen isn't half hidden by seats.
  const tall = camera.aspect < 0.8;
  VIEWS.theater.pos.set(-4.5, tall ? 2.45 : 2.15, tall ? -9.6 : -8.2);
  VIEWS.theater.look.set(-4.5, tall ? 2.05 : 1.85, -17);
  const end = PATHS["living>theater"]; end.pos[end.pos.length - 1].copy(VIEWS.theater.pos); end.look[end.look.length - 1].copy(VIEWS.theater.look);
};
addEventListener("resize", resize);

const dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const aim = (pos, look, yw, pt) => {
  dir.subVectors(look, pos).applyAxisAngle(up, yw);
  dir.y += pt * dir.length();
  camera.position.copy(pos); camera.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
};
const flickers = [];
const frame = (now) => {
  if (shelfDlg.open) return; // the shelf has its own renderer; pause the house meanwhile
  // the door eases open or shut
  doorOpen += (doorTo - doorOpen) * (reduce ? 1 : 0.08);
  doorPivot.rotation.y = -doorOpen * 1.85; // swings out into the hallway, clear of the living room view
  if (flight) {
    const k = Math.min(1, (now - flight.t0) / flight.dur), s = ease(k);
    yaw = flight.yaw0 * (1 - s); pitch = flight.pitch0 * (1 - s);
    aim(flight.pos.getPoint(s), flight.look.getPoint(s), yaw, pitch);
    if (k === 1) { const a = flight.after; flight = null; a?.(); }
  } else {
    const v = VIEWS[room];
    aim(v.pos, v.look, yaw, pitch);
  }
  if (!reduce) for (const s of flickers) { // neon that stutters now and then
    const on = Math.sin(now / 1000 * 1.3 + s.userData.seed) > -0.97 || Math.random() < 0.5;
    s.material.color.setScalar(on ? s.userData.k : s.userData.k * 0.35);
  }
  composer.render();
};

if (location.search.includes("debug")) window.__house = { camera, scene, go, get room() { return room; }, set yaw(v) { yaw = v; } };

// ---------- start ----------
(async () => {
  await Promise.race([
    Promise.all(["700 140px Rajdhani", "500 34px 'JetBrains Mono'", "500 38px Inter", "italic 400 38px Inter"].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  buildOutside(); buildLiving(); buildTheater();
  scene.add(new THREE.AmbientLight(0x5b4a9a, 0.9));
  scene.add(new THREE.HemisphereLight(0x9d8cff, 0x1a0f30, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(3, 6, 4); scene.add(key);
  scene.traverse((o) => { if (o.userData.flicker) { o.userData.seed = Math.random() * 10; flickers.push(o); } });
  drawScreen(null); loadLive();
  resize(); setRoomUI(); aim(VIEWS.outside.pos, VIEWS.outside.look, 0, 0);
  renderer.setAnimationLoop(frame);
  setTimeout(() => ui.load.classList.add("done"), 250); // the shelf photos stream in after; nothing waits on them
})();
