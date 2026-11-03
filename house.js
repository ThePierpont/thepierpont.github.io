// The 3D apartment (house.html): front door → living room → theater, more rooms to come.
// Cartoon look: toon-shaded rounded blocks with ink outlines, lit by neon (bloom makes it glow).
// Live bits: the theater screen shows my latest Letterboxd watch, the window shows DC's time and
// the Bitcoin block height, and the theater has my real movie shelf: walk up, lean into a row,
// and pull any movie out (the case pop-out is shared with the main page: case-viewer.js).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createCaseViewer, pick } from "./case-viewer.js?v=1793686901";

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
const textTexture = (text, font, color, glow = 0.25, core = 0.22) => {
  const c = document.createElement("canvas"), x = c.getContext("2d"), px = +font.match(/(\d+)px/)[1], pad = px * 0.35;
  x.font = font; c.width = Math.ceil(x.measureText(text).width + pad * 2); c.height = Math.ceil(px * 1.35 + pad * 2);
  x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillStyle = color; x.shadowColor = color; x.shadowBlur = px * glow; x.fillText(text, c.width / 2, c.height / 2);
  x.shadowBlur = 0; if (core) { x.globalAlpha = core; x.fillStyle = "#fff"; x.fillText(text, c.width / 2, c.height / 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
};
const sign = (text, height, x, y, z, { color = "#ff2a6d", font = "700 140px Rajdhani", rotY = 0, parent = scene, k = 1.5, glow, core } = {}) => {
  const t = textTexture(text, font, color, glow, core), w = (height * t.image.width) / t.image.height;
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
  // A narrow corridor running back from my door (+z), the way an apartment hallway does.
  const wallC = 0x2d2160, sideC = 0x251b4d, HW = 1.6;
  slab(2 * HW, 0.1, 12, 0x1b1430, 0, -0.05, 6); slab(2 * HW, 0.1, 12, 0x120d24, 0, H + 0.05, 6);
  slab(0.2, H, 12, sideC, -HW - 0.1, H / 2, 6); slab(0.2, H, 12, sideC, HW + 0.1, H / 2, 6); slab(2 * HW, H, 0.2, sideC, 0, H / 2, 12);
  // the front wall, with the door opening in the middle (it's also the living room's front wall)
  slab(5.3, H, 0.2, wallC, -3.35, H / 2, 0); slab(5.3, H, 0.2, wallC, 3.35, H / 2, 0);
  slab(1.4, H - 2.4, 0.2, wallC, 0, 2.4 + (H - 2.4) / 2, 0);
  for (const s of [-1, 1]) tube(0.04, 2.44, 0.04, 0x05d9e8, s * 0.74, 1.22, 0.12, { k: 1.3 });
  tube(1.52, 0.04, 0.04, 0x05d9e8, 0, 2.44, 0.12, { k: 1.3 });
  // the door, on a hinge at its left edge
  doorPivot = new THREE.Group(); doorPivot.position.set(-0.68, 0, 0); scene.add(doorPivot);
  block(1.36, 2.36, 0.08, 0xb3195a, 0.68, 1.18, 0, { parent: doorPivot, r: 0.03 });
  block(1.0, 0.9, 0.03, 0x8e1248, 0.68, 1.75, 0.05, { parent: doorPivot, r: 0.02 });
  block(1.0, 0.9, 0.03, 0x8e1248, 0.68, 0.62, 0.05, { parent: doorPivot, r: 0.02 });
  ball(0.055, 0xf9f002, 1.2, 1.12, 0.09, { parent: doorPivot });
  sign("1B", 0.16, 0.68, 2.08, 0.07, { parent: doorPivot, color: "#f9f002", font: "700 100px Rajdhani", k: 1.1 });
  addHot(doorPivot, "outside", "Come on in", touch ? "Tap to open the door" : "Click to open the door", () => go("living"));
  sign("PIERPONT", 0.55, 0, 2.93, 0.12, { color: "#ff2a6d", k: 1.7 }).userData.flicker = true;
  sign("APT 1B · DC", 0.12, -1.15, 1.7, 0.11, { color: "#05d9e8", font: "500 70px 'JetBrains Mono'", k: 1.2 });
  for (const s of [-1, 1]) tube(0.07, 0.32, 0.04, 0x05d9e8, s * 1.25, 2.1, 0.12, { k: 1.6 });
  const lamp = new THREE.PointLight(0x05d9e8, 5, 7); lamp.position.set(0, 2.3, 1.4); scene.add(lamp);
  const warm = new THREE.PointLight(0xff2a6d, 4, 7); warm.position.set(0, 2.9, 0.8); scene.add(warm);
  block(1.4, 0.03, 0.8, 0x3a2d63, 0, 0.015, 0.75, { r: 0.012 }); // doormat
  const mat = sign("WELCOME", 0.24, 0, 0.034, 0.75, { color: "#f9f002", k: 1.05 }); mat.rotation.x = -Math.PI / 2;
  // down the corridor: a runner, light strips overhead, glowing baseboards, a neighbour's door
  block(1.3, 0.02, 10.6, 0x3a1a4a, 0, 0.011, 6.6, { ink: false, r: 0.005 });
  for (const s of [-1, 1]) tube(0.02, 0.02, 10.6, 0x05d9e8, s * 0.66, 0.025, 6.6, { k: 1.1 });
  for (const zz of [1.4, 4.2, 7.0, 9.8]) tube(1.4, 0.03, 0.16, 0x9d8cff, 0, H - 0.03, zz, { k: 0.95 }); // soft violet strips, not glare
  tube(0.03, 0.03, 12, 0x05d9e8, -HW + 0.02, 0.03, 6, { k: 1.4 }); tube(0.03, 0.03, 12, 0xff2a6d, HW - 0.02, 0.03, 6, { k: 1.4 });
  const hall = new THREE.PointLight(0x9d8cff, 3, 9); hall.position.set(0, 3.0, 5.5); scene.add(hall);
  block(0.08, 2.3, 1.2, 0x3b2a75, HW - 0.04, 1.15, 3.1, { r: 0.03 }); // 1C, across the hall
  for (const dz of [-0.62, 0.62]) tube(0.03, 2.36, 0.03, 0x7b2cbf, HW - 0.06, 1.18, 3.1 + dz, { k: 1.3 });
  ball(0.045, 0xf9f002, HW - 0.1, 1.1, 2.6);
  sign("1C", 0.16, HW - 0.09, 2.6, 3.1, { color: "#b98cff", rotY: -Math.PI / 2, font: "700 100px Rajdhani", k: 1.2 });
  block(0.08, 2.3, 1.2, 0x3b2a75, -HW + 0.04, 1.15, 8.4, { r: 0.03 }); // 1A, further down
  sign("1A", 0.16, -HW + 0.09, 2.6, 8.4, { color: "#b98cff", rotY: Math.PI / 2, font: "700 100px Rajdhani", k: 1.2 });
};

// ---------- the living room (z 0 … -7) ----------
let windowTex, windowCanvas, windowGlass, mullion;
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
  windowCanvas = document.createElement("canvas"); windowCanvas.width = 2600; windowCanvas.height = 1000; // drawn in 2080 × 800 units, at 1.25× for sharpness
  windowTex = new THREE.CanvasTexture(windowCanvas); windowTex.colorSpace = THREE.SRGBColorSpace; windowTex.anisotropy = 8;
  // a touch under full brightness, so white text on the glass doesn't bloom (the neon is drawn with its own glow)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), new THREE.MeshBasicMaterial({ map: windowTex, toneMapped: false, color: new THREE.Color(0.8, 0.8, 0.8) }));
  glass.position.set(0, 1.9, -7.02); scene.add(glass);
  for (const s of [-1, 1]) tube(0.05, 2.06, 0.05, 0x05d9e8, s * 2.62, 1.9, -6.9, { k: 1.4 });
  for (const yy of [0.88, 2.92]) tube(5.3, 0.05, 0.05, 0x05d9e8, 0, yy, -6.9, { k: 1.4 });
  mullion = block(0.07, 2.0, 0.07, 0x140e2a, 0, 1.9, -6.95, { ink: false }); // hidden while the clock app is up
  block(5.5, 0.08, 0.34, 0x3a2a75, 0, 0.92, -6.8, { r: 0.02 });
  windowGlass = glass;
  addHot(glass, "living", "DC at night", touch ? "Tap to open the clock on the window" : "Click to open the clock on the window", () => openWindowApp());

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
  block(0.05, 1.55, 0.05, 0x221a40, 2.65, 0.8, -3.6, { r: 0.02 });
  block(0.4, 0.04, 0.4, 0x221a40, 2.65, 0.02, -3.6, { r: 0.02 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.36, 20, 1, true), toon(0xc85a8a, { emissive: 0x220612, side: THREE.DoubleSide }));
  shade.position.set(2.65, 1.72, -3.6); scene.add(shade);
  const lampLight = new THREE.PointLight(0xff4f8b, 3, 6); lampLight.position.set(2.65, 1.5, -3.6); scene.add(lampLight);
  // plant
  block(0.46, 0.5, 0.46, 0x5b3a8a, 5.45, 0.25, -6.4, { r: 0.05 });
  ball(0.34, 0x17b890, 5.45, 0.82, -6.4); ball(0.26, 0x1fd6a5, 5.25, 1.12, -6.35); ball(0.24, 0x149e7c, 5.62, 1.08, -6.5);
  // neon art: I stack sats
  sign("STACK SATS", 0.42, -5.88, 2.05, -4.8, { color: "#f7931a", rotY: Math.PI / 2, k: 0.92, glow: 0.08, core: 0 }); // just the letters: a tight glow keeps them readable
  tube(11.6, 0.03, 0.06, 0xff2a6d, 0, H - 0.03, -0.25, { k: 1.4 });
  const winLight = new THREE.PointLight(0x7b5cff, 6, 9); winLight.position.set(0, 2.2, -6.2); scene.add(winLight);
  const fill = new THREE.PointLight(0x05d9e8, 3, 10); fill.position.set(3.5, 2.6, -2); scene.add(fill);
};

// ---------- the theater (behind the living room's back wall: x -9 … 0, z -7 … -17) ----------
let screenTex, screenCanvas, latest = null;
const shelfFaces = []; // { row, mesh, w, h, imax? }: the clickable shelf photos
const buildTheater = () => {
  const wallC = 0x1d1340;
  slab(9, 0.1, 10, 0x120c22, -4.5, -0.05, -12); slab(9, 0.1, 10, 0x0c0818, -4.5, H + 0.05, -12);
  slab(0.2, H, 10, wallC, -9, H / 2, -12); slab(0.2, H, 9.8, wallC, 0, H / 2, -12.1); // stops short of the living room window
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
  for (const x of [-4.3, -2.7, -1.1]) { seat(x, 0, -12.6); seat(x, 0.3, -10.6); } // left aisle stays clear for the shelf
  for (const x of [-8.7, -0.3]) tube(0.04, 0.02, 9.6, 0x05d9e8, x, 0.02, -12, { k: 1.6 });
  // stars on the ceiling
  const pts = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) { pts[i * 3] = -8.8 + Math.random() * 8.6; pts[i * 3 + 1] = H - 0.01; pts[i * 3 + 2] = -7.2 - Math.random() * 9.6; }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pts, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, toneMapped: false }));
  scene.add(stars);
  // the movie shelf on the left wall, built from my real shelf photos (shelf-data.js) like the main page's,
  // and the IMAX case on its own stand beside it. Group space: x along the wall (toward the screen),
  // y up, z out of the wall into the room.
  const ROWS = window.SHELF || [], frameC = 0x2b1d55, W = 1.6, T = 0.05, D = 0.42;
  const tex = (src) => { const t = loader.load(src); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const bc = new THREE.Group(); bc.position.set(-8.9, 0, -14.6); bc.rotation.y = Math.PI / 2; scene.add(bc);
  let y = 0.12;
  block(W + 2 * T, 0.12, D, frameC, 0, 0.06, D / 2, { parent: bc, r: 0.02 });
  for (const row of ROWS.filter((r) => r.id !== "imax").reverse()) {
    const h = W / row.aspect;
    row._tex = tex(row.img);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, h), new THREE.MeshBasicMaterial({ map: row._tex, color: 0xe8e8e8 }));
    face.position.set(0, y + h / 2, D - 0.1); bc.add(face);
    shelfFaces.unshift({ row, mesh: face, w: W, h });
    y += h;
    block(W + 2 * T, T, D, frameC, 0, y + T / 2, D / 2, { parent: bc, r: 0.015 }); y += T;
  }
  for (const s of [-1, 1]) block(T, y, D, frameC, s * (W / 2 + T / 2), y / 2, D / 2, { parent: bc, r: 0.015 });
  block(W + 2 * T, y, 0.03, 0x120c22, 0, y / 2, 0.015, { parent: bc, ink: false });
  addHot(bc, "theater", "My movie shelf", touch ? "Tap to walk over and browse it" : "Click to walk over and browse it", () => go("shelf"));
  const imax = ROWS.find((r) => r.id === "imax");
  if (imax) {
    const st = new THREE.Group(); st.position.set(-8.9, 0, -12.65); st.rotation.y = Math.PI / 2; scene.add(st);
    const w = 1.3, h = w / imax.aspect;
    block(1.0, 1.05, 0.5, frameC, 0, 0.525, 0.25, { parent: st, r: 0.04 });
    block(w + 0.06, h + 0.06, 0.36, 0xd9d7e6, 0, 1.05 + h / 2 + 0.03, 0.27, { parent: st, r: 0.03 });
    imax._tex = tex(imax.img); imax._front = imax.front ? tex(imax.front) : imax._tex;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: imax._front, color: 0xe8e8e8 }));
    face.position.set(0, 1.05 + h / 2 + 0.03, 0.455); st.add(face);
    shelfFaces.unshift({ row: imax, mesh: face, w, h, imax: true });
    addHot(st, "theater", "IMAX case", touch ? "Tap to walk over and open it" : "Click to walk over and open it", () => go("shelf"));
  }
  sign("MY SHELF", 0.26, -8.85, 2.6, -12.65, { color: "#05d9e8", rotY: Math.PI / 2, k: 1.5 });
  // popcorn machine and a NOW SHOWING sign
  block(0.7, 0.8, 0.6, 0xd11e48, -1.1, 0.4, -14.6, { r: 0.05 });
  block(0.66, 0.62, 0.56, 0x05d9e8, -1.1, 1.12, -14.6, { mat: toon(0x05d9e8, { transparent: true, opacity: 0.28 }), r: 0.03 });
  block(0.76, 0.14, 0.66, 0xd11e48, -1.1, 1.5, -14.6, { r: 0.05 });
  for (let i = 0; i < 14; i++) ball(0.05, i % 3 ? 0xfff2b0 : 0xf9f002, -1.32 + (i % 5) * 0.11, 0.9 + Math.floor(i / 5) * 0.08, -14.6 + ((i * 37) % 5 - 2) * 0.08);
  sign("POPCORN", 0.14, -1.1, 1.68, -14.28, { color: "#f9f002", k: 1.3 });
  sign("NOW SHOWING", 0.32, -0.12, 2.65, -12.2, { color: "#ff2a6d", rotY: -Math.PI / 2, k: 1.5 }).userData.flicker = true;
  const dim = new THREE.PointLight(0x7b5cff, 3, 12); dim.position.set(-4.5, 3.0, -11); scene.add(dim);
};

// ---------- set dressing: the lived-in neon stuff ----------
// Everything here is decoration; a few pieces are clickable (the node, the arcade). `animators`
// run every frame (skipped with reduced motion).
const animators = [];
const canvasTex = (w, h, draw) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
};
const panel = (w, h, tex, x, y, z, { rotY = 0, k = 1, transparent = false, parent = scene } = {}) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent, toneMapped: false, depthWrite: !transparent, color: new THREE.Color(k, k, k) }));
  m.position.set(x, y, z); m.rotation.y = rotY; parent.add(m); return m;
};
// a cable hanging between points (dark rubber, or a thin glowing one)
const cable = (pts, color, r = 0.03, glow = false) => {
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => V(...q))), 40, r, 6), glow ? glowMat(color, 1.6) : toon(color));
  scene.add(m); return m;
};
let rainMesh = null;
const blinkers = []; // small LEDs that wink on and off: { mesh, rate, phase }
const led = (x, y, z, color, rate = 1, size = 0.03) => {
  const m = tube(size, size, 0.02, color, x, y, z, { k: 2.2 }); blinkers.push({ m, rate, phase: Math.random() * 10 }); return m;
};
const buildDecor = () => {
  // ---- hallway (on the front wall, where the doorstep camera can see it)
  block(0.17, 0.27, 0.04, 0x16102e, 0.98, 1.28, 0.12, { r: 0.02 }); // keypad
  for (let i = 0; i < 9; i++) tube(0.032, 0.032, 0.01, 0x05d9e8, 0.94 + (i % 3) * 0.04, 1.34 - Math.floor(i / 3) * 0.045, 0.145, { k: 1.4 });
  led(0.98, 1.17, 0.145, 0x2bff88, 0.25);
  const cam = new THREE.Group(); cam.position.set(1.32, 3.05, 0.25); cam.rotation.set(0.35, -0.5, 0); scene.add(cam);
  block(0.08, 0.2, 0.08, 0x221a40, 0, 0.1, -0.06, { parent: cam, r: 0.02 });
  block(0.34, 0.17, 0.17, 0xd9d7e6, 0, -0.02, 0.06, { parent: cam, r: 0.05 });
  ball(0.05, 0x111111, 0, -0.02, 0.16, { parent: cam });
  blinkers.push({ m: tube(0.03, 0.03, 0.02, 0xff2a6d, 0.12, 0.04, 0.15, { parent: cam, k: 2.6 }), rate: 0.8, phase: 0 });
  cable([[-1.45, 3.32, 0.2], [-1.3, 3.05, 3], [-1.45, 3.3, 6], [-1.3, 3.08, 9], [-1.45, 3.3, 11.8]], 0x16102e, 0.035); // cables run down the corridor
  cable([[1.45, 3.3, 0.2], [1.32, 3.1, 3.4], [1.45, 3.3, 6.5], [1.3, 3.12, 9.5], [1.45, 3.3, 11.8]], 0xff2a6d, 0.012, true);
  // an ad for the pizza place on the first floor, on the corridor wall
  const ad = panel(1.6, 1.0, canvasTex(640, 400, (x, w, h) => {
    x.fillStyle = "rgba(10,4,24,.6)"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "#f7931a"; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
    // a slice: crust, cheese, pepperoni
    x.save(); x.translate(130, 205); x.shadowColor = "#f9f002"; x.shadowBlur = 18;
    x.fillStyle = "#f9c74f"; x.beginPath(); x.moveTo(-70, -90); x.lineTo(70, -90); x.lineTo(0, 110); x.closePath(); x.fill();
    x.fillStyle = "#c8742a"; x.fillRect(-78, -108, 156, 26);
    x.shadowBlur = 0; x.fillStyle = "#e63946"; for (const [px, py] of [[-28, -50], [24, -40], [-4, 10], [8, 60]]) { x.beginPath(); x.arc(px, py, 14, 0, Math.PI * 2); x.fill(); }
    x.restore();
    x.textBaseline = "middle"; x.textAlign = "left";
    x.font = "500 28px 'JetBrains Mono'"; x.fillStyle = "#05d9e8"; x.shadowColor = "#05d9e8"; x.shadowBlur = 8; x.fillText("1ST FLOOR ↓", 250, 70);
    x.font = "700 128px Rajdhani"; x.fillStyle = "#ff7a1a"; x.shadowColor = "#ff7a1a"; x.shadowBlur = 22; x.fillText("PIZZA", 245, 160);
    x.font = "700 62px Rajdhani"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 14; x.fillText("OPEN 24 HOURS", 250, 260);
    x.font = "500 26px 'JetBrains Mono'"; x.fillStyle = "#d6d6e7"; x.shadowBlur = 0; x.fillText("BY THE SLICE · ALL NIGHT", 252, 330);
    for (let y = 0; y < h; y += 6) { x.fillStyle = "rgba(255,255,255,.05)"; x.fillRect(0, y, w, 2); }
  }), -1.585, 1.75, 2.0, { transparent: true, k: 1.1, rotY: Math.PI / 2 });
  animators.push((now) => { ad.material.opacity = Math.sin(now / 90) > 0.96 ? 0.35 : 0.92; }); // holo flicker
  panel(1.0, 0.62, canvasTex(500, 310, (x, w, h) => { // a spray-paint tag
    x.lineCap = "round"; x.lineJoin = "round";
    const stroke = (col, wd, path) => { x.strokeStyle = col; x.lineWidth = wd; x.shadowColor = col; x.shadowBlur = 14; x.beginPath(); path(); x.stroke(); };
    stroke("#ff2a6d", 26, () => { x.moveTo(70, 250); x.lineTo(95, 60); x.bezierCurveTo(200, 40, 210, 160, 105, 150); x.moveTo(230, 250); x.lineTo(255, 60); x.bezierCurveTo(360, 40, 370, 160, 265, 150); });
    stroke("#05d9e8", 9, () => { x.moveTo(60, 270); x.bezierCurveTo(200, 230, 330, 300, 450, 230); });
    x.shadowBlur = 0; x.fillStyle = "#ff2a6d"; for (const dx of [100, 140, 262]) x.fillRect(dx, 250, 7, 30 + (dx % 40));
  }), 1.585, 1.45, 1.0, { transparent: true, k: 1.15, rotY: -Math.PI / 2 }); // on the corridor wall, by my door

  // ---- living room
  // glowing baseboards and ceiling cables
  for (const [xx, col] of [[-5.88, 0x05d9e8], [5.88, 0xff2a6d]]) tube(0.03, 0.03, 6.8, col, xx, 0.03, -3.5, { k: 1.5 });
  for (const [x0, x1] of [[-3.8, -2.6], [2.6, 3.8], [-6, -5.2], [5.2, 6]]) tube(x1 - x0, 0.03, 0.03, 0x05d9e8, (x0 + x1) / 2, 0.03, -6.88, { k: 1.5 });
  cable([[-5.9, 3.38, -1.2], [-3.5, 2.95, -2.6], [-1.2, 3.3, -3.4]], 0x16102e, 0.03);
  cable([[5.9, 3.38, -5.6], [3.6, 2.9, -4.8], [1.5, 3.3, -5.4]], 0x16102e, 0.03);
  cable([[5.9, 3.36, -1.0], [4.2, 3.05, -2.0], [2.4, 3.34, -2.2]], 0x7b2cbf, 0.012, true);
  // my Bitcoin node: a little rack with blinking lights (beside the theater door)
  const node = new THREE.Group(); node.position.set(-5.62, 0, -3.7); node.rotation.y = Math.PI / 2; scene.add(node); // against the left wall
  block(0.62, 1.42, 0.5, 0x16102e, 0, 0.71, 0, { parent: node, r: 0.04 });
  for (let u = 0; u < 4; u++) {
    block(0.54, 0.24, 0.04, 0x241a4a, 0, 0.3 + u * 0.3, 0.25, { parent: node, r: 0.015, ink: false });
    for (let i = 0; i < 5; i++) blinkers.push({ m: tube(0.025, 0.025, 0.01, i % 3 ? 0x2bff88 : 0xf9f002, -0.2 + i * 0.05, 0.3 + u * 0.3, 0.275, { parent: node, k: 2.2 }), rate: 0.5 + Math.random() * 3, phase: Math.random() * 10 });
    const fan = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), glowMat(0x05d9e8, 1.2)); fan.position.set(0.17, 0.3 + u * 0.3, 0.275); node.add(fan);
  }
  sign("NODE", 0.12, 0, 1.52, 0.26, { parent: node, color: "#f9f002", font: "700 100px Rajdhani", k: 1.4 });
  addHot(node, "living", "My Bitcoin node", "Click for its status", () => toast(height ? `My node is synced to block ${height.toLocaleString()}. Don't trust, verify.` : "My node is syncing…"));
  // a chess table against the right wall, a game in progress: plays me at chess
  const ct = new THREE.Group(); ct.position.set(5.45, 0, -5.05); ct.rotation.y = -Math.PI / 2; scene.add(ct); // local +z faces into the room
  const wood = 0x5a3a2a;
  block(0.66, 0.05, 0.66, wood, 0, 0.74, 0, { parent: ct, r: 0.02 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 12), toon(wood)); stem.position.y = 0.37; ct.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.04, 20), toon(0x3a2418)); foot.position.y = 0.02; ct.add(foot);
  for (const o of [stem, foot]) { const ink = new THREE.Mesh(o.geometry, inkMat); ink.scale.set(1.12, 1.01, 1.12); o.add(ink); }
  const B = 0.52, sq = B / 8;
  const board = panel(B, B, canvasTex(512, 512, (x, w) => {
    const c = w / 8;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { x.fillStyle = (r + f) % 2 ? "#4b2f7a" : "#e9dfcc"; x.fillRect(f * c, r * c, c, c); }
    x.strokeStyle = "#05d9e8"; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, w - 8);
  }), 0, 0.768, 0, { parent: ct, k: 0.95 });
  board.rotation.x = -Math.PI / 2;
  // pieces, built from simple shapes. A middlegame: (file 0–7, rank 0–7, type, side)
  const piece = (f, r, type, white) => {
    const g = new THREE.Group(); g.position.set((f - 3.5) * sq, 0.77, (3.5 - r) * sq); ct.add(g);
    const col = white ? 0xf3eee6 : 0x24233a, m = toon(col), add = (geo, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
    add(new THREE.CylinderGeometry(0.019, 0.022, 0.012, 12), 0.006);
    if (type === "p") { add(new THREE.CylinderGeometry(0.008, 0.014, 0.03, 10), 0.026); add(new THREE.SphereGeometry(0.012, 10, 8), 0.046); }
    if (type === "r") { add(new THREE.CylinderGeometry(0.014, 0.016, 0.042, 10), 0.033); add(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 10), 0.058); }
    if (type === "n") { add(new THREE.CylinderGeometry(0.012, 0.016, 0.03, 10), 0.027); const h = add(new THREE.BoxGeometry(0.016, 0.03, 0.028), 0.055); h.rotation.x = white ? -0.4 : 0.4; }
    if (type === "b") { add(new THREE.CylinderGeometry(0.007, 0.015, 0.045, 10), 0.033); add(new THREE.SphereGeometry(0.012, 10, 8), 0.063); }
    if (type === "q" || type === "k") {
      add(new THREE.CylinderGeometry(0.009, 0.017, 0.06, 10), 0.04); add(new THREE.SphereGeometry(0.014, 10, 8), 0.076);
      if (type === "k") { add(new THREE.BoxGeometry(0.005, 0.022, 0.005), 0.098); add(new THREE.BoxGeometry(0.014, 0.005, 0.005), 0.1); }
    }
  };
  [[4, 0, "k", 1], [3, 2, "q", 1], [0, 0, "r", 1], [5, 0, "r", 1], [2, 2, "n", 1], [4, 3, "p", 1], [3, 3, "p", 1], [5, 1, "p", 1], [6, 1, "p", 1], [7, 2, "p", 1], [1, 1, "p", 1], [2, 3, "b", 1],
   [6, 7, "k", 0], [3, 7, "q", 0], [0, 7, "r", 0], [5, 7, "r", 0], [5, 5, "n", 0], [4, 4, "p", 0], [3, 5, "p", 0], [5, 6, "p", 0], [6, 6, "p", 0], [7, 5, "p", 0], [1, 6, "p", 0], [6, 4, "b", 0]]
    .forEach(([f, r, t, w]) => piece(f, r, t, !!w));
  // two stools
  for (const sx of [-0.55, 0.55]) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 18), toon(0x3b2f8f)); seat.position.set(sx, 0.48, 0.05); ct.add(seat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.45, 8), toon(0x221a40)); leg.position.set(sx, 0.225, 0.05); ct.add(leg);
    for (const o of [seat, leg]) { const ink = new THREE.Mesh(o.geometry, inkMat); ink.scale.set(1.12, 1.04, 1.12); o.add(ink); }
  }
  sign("♚ PLAY ME", 0.14, 0, 1.55, -0.32, { parent: ct, color: "#05d9e8", font: "700 100px Rajdhani", k: 1.0, glow: 0.1, core: 0 });
  const chessUser = S.chess?.username;
  if (chessUser) addHot(ct, "living", "Play me at chess", "Opens a challenge on Chess.com", () => window.open(`https://www.chess.com/play/online/new?opponent=${encodeURIComponent(chessUser)}`, "_blank", "noopener"));
  // the plant moves to the other corner to make room
  // hologram projector on the coffee table: a slowly turning wireframe gem
  block(0.26, 0.05, 0.26, 0x16102e, 0, 0.525, -5.95, { r: 0.02 });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 0.55, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x05d9e8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  beam.position.set(0, 0.83, -5.95); scene.add(beam);
  const gem = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.17, 0)), new THREE.LineBasicMaterial({ color: new THREE.Color(0x05d9e8).multiplyScalar(2), toneMapped: false }));
  gem.position.set(0, 1.25, -5.95); scene.add(gem);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.006, 6, 40), glowMat(0xff2a6d, 1.6)); halo.position.copy(gem.position); halo.rotation.x = Math.PI / 2; scene.add(halo);
  animators.push((now) => { gem.rotation.y = now / 1400; gem.rotation.x = Math.sin(now / 2300) * 0.4; gem.position.y = 1.25 + Math.sin(now / 900) * 0.03; halo.rotation.z = now / 2000; });
  // a little drone keeping watch near the ceiling
  const drone = new THREE.Group(); scene.add(drone);
  block(0.3, 0.08, 0.2, 0xd9d7e6, 0, 0, 0, { parent: drone, r: 0.03 });
  for (const [dx, dz] of [[-0.19, -0.12], [0.19, -0.12], [-0.19, 0.12], [0.19, 0.12]]) { const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.01, 4, 14), toon(0x221a40)); rotor.rotation.x = Math.PI / 2; rotor.position.set(dx, 0.04, dz); drone.add(rotor); }
  blinkers.push({ m: tube(0.035, 0.035, 0.03, 0x05d9e8, 0, -0.03, 0.11, { parent: drone, k: 2.4 }), rate: 1.6, phase: 0 });
  animators.push((now) => { drone.position.set(1.7 + Math.sin(now / 3100) * 0.5, 2.6 + Math.sin(now / 700) * 0.05, -3.4 + Math.cos(now / 2600) * 0.4); drone.rotation.y = Math.sin(now / 3100) * 0.5; });
  // posters on the side walls (drag to look around)
  const poster = (draw, x, z, rotY) => { block(0.95, 1.3, 0.04, 0x16102e, x, 1.75, z, { rot: [0, rotY, 0], r: 0.01 }); panel(0.85, 1.2, canvasTex(340, 480, draw), x + Math.sin(rotY) * 0.03, 1.75, z + Math.cos(rotY) * 0.03, { rotY, k: 1.05 }); };
  poster((x, w, h) => { // synthwave sun over a grid
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#14062e"); g.addColorStop(0.55, "#4a1172"); g.addColorStop(1, "#0a0418"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const sg = x.createLinearGradient(0, 120, 0, 300); sg.addColorStop(0, "#f9f002"); sg.addColorStop(1, "#ff2a6d"); x.fillStyle = sg; x.beginPath(); x.arc(w / 2, 250, 110, Math.PI, 0); x.fill();
    x.fillStyle = "#14062e"; for (let i = 0; i < 5; i++) x.fillRect(60, 200 + i * 12, 220, 3 + i);
    x.strokeStyle = "#05d9e8"; x.lineWidth = 2; for (let i = 0; i < 8; i++) { const y = 260 + i * i * 4; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
    for (let i = -6; i <= 6; i++) { x.beginPath(); x.moveTo(w / 2 + i * 12, 260); x.lineTo(w / 2 + i * 70, h); x.stroke(); }
    x.textAlign = "center"; x.font = "700 52px Rajdhani"; x.fillStyle = "#f4f3ff"; x.shadowColor = "#ff2a6d"; x.shadowBlur = 14; x.fillText("DC AFTER DARK", w / 2, 70);
  }, 5.9, -1.6, -Math.PI / 2);
  poster((x, w, h) => { // a retro coin
    x.fillStyle = "#120a2a"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#f7931a"; x.shadowColor = "#f7931a"; x.shadowBlur = 30; x.beginPath(); x.arc(w / 2, 200, 110, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = "700 160px Rajdhani"; x.fillStyle = "#fff"; x.fillText("₿", w / 2, 205);
    x.font = "700 86px Rajdhani"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 16; x.fillText("HODL", w / 2, 390);
    x.font = "500 22px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.shadowBlur = 0; x.fillText("21,000,000 · NO MORE", w / 2, 450);
  }, -5.9, -0.95, Math.PI / 2);
  // aquarium on a low cabinet (left wall, below the neon)
  block(1.3, 0.62, 0.5, 0x241a4a, -5.6, 0.31, -6.0, { rot: [0, Math.PI / 2, 0], r: 0.03 });
  block(1.2, 0.6, 0.42, 0x05d9e8, -5.6, 0.93, -6.0, { rot: [0, Math.PI / 2, 0], mat: new THREE.MeshBasicMaterial({ color: 0x0aa6c9, transparent: true, opacity: 0.35, toneMapped: false }), r: 0.02 });
  const tankLight = new THREE.PointLight(0x05d9e8, 2.5, 2.5); tankLight.position.set(-5.3, 1.1, -6.0); scene.add(tankLight);
  const fish = [0xff7a1a, 0xf9f002, 0xff2a6d].map((c, i) => {
    const f = new THREE.Group(); scene.add(f);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), glowMat(c, 1.1)); body.scale.set(1.5, 1, 0.6); f.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 6), glowMat(c, 1.1)); tail.rotation.z = Math.PI / 2; tail.position.x = -0.09; f.add(tail);
    return { f, i };
  });
  animators.push((now) => fish.forEach(({ f, i }) => {
    const t = now / (2600 + i * 700) + i * 2, z = -6.0 + Math.sin(t) * 0.45;
    f.position.set(-5.6 + Math.sin(t * 1.7) * 0.08, 0.85 + i * 0.12 + Math.sin(t * 3) * 0.03, z);
    f.rotation.y = Math.cos(t) > 0 ? -Math.PI / 2 : Math.PI / 2; // turn round at each end
  }));
  // rain running down the window (fades out while the clock app is on the glass)
  const rainTex = canvasTex(256, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.strokeStyle = "rgba(180,220,255,.55)"; x.lineWidth = 1.5;
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) { const px = rnd() * w, py = rnd() * h, len = 12 + rnd() * 30; x.beginPath(); x.moveTo(px, py); x.lineTo(px - 2, py + len); x.stroke(); }
    for (let i = 0; i < 40; i++) { x.fillStyle = "rgba(200,230,255,.4)"; x.beginPath(); x.arc(rnd() * w, rnd() * h, 1.5 + rnd() * 2, 0, Math.PI * 2); x.fill(); }
  });
  rainTex.wrapS = rainTex.wrapT = THREE.RepeatWrapping; rainTex.repeat.set(5, 1.2);
  rainMesh = panel(5.2, 2.0, rainTex, 0, 1.9, -7.0, { transparent: true, k: 1 }); rainMesh.material.opacity = 0.32; rainMesh.raycast = () => {}; // never blocks clicks on the glass
  animators.push((now, dt) => { rainTex.offset.y += dt * 0.00035; });

  // ---- theater
  for (const xx of [-7.75, -1.25]) {
    block(0.6, 1.1, 0.45, 0x16102e, xx, 0.8, -15.95, { r: 0.05 });
    for (const [yy, rr] of [[1.05, 0.15], [0.62, 0.1]]) { const cone = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.03, 8, 24), toon(0x3a2a75)); cone.position.set(xx, yy, -15.72); scene.add(cone); }
  }
  tube(7.6, 0.03, 0.03, 0xff2a6d, -4.5, 0.26, -15.59, { k: 1.6 });
  for (const zz of [-9.6, -14.9]) tube(0.04, 0.6, 0.04, 0x05d9e8, -0.12, 1.9, zz, { k: 1.4 });
  for (const zz of [-9.0, -11.4]) tube(0.04, 0.6, 0.04, 0x05d9e8, -8.88, 1.9, zz, { k: 1.4 }); // clear of the shelf and the IMAX stand
  sign("EXIT", 0.2, -4.5, 2.78, -7.12, { color: "#2bff88", rotY: Math.PI, k: 1.5 });
};

// ---------- the cats: Fin and Phoebe, napping, with their tree, bed and toys ----------
// Drawn from my photos: Fin is a big fluffy brown tabby with a white chin; Phoebe is a lean orange
// tabby, about half his size, with a white chin. Local space: the cat faces +x, curled on the spot.
const cat = ({ fur, stripe, chin, size = 1, fluffy = false, lean = false }, x, y, z, rotY = 0) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; g.scale.setScalar(size); scene.add(g);
  const sx = lean ? 1.45 : 1.3, sy = lean ? 0.5 : 0.64, sz = lean ? 0.85 : 1.08;
  const body = ball(0.2, fur, 0, 0.1, 0, { parent: g }); body.scale.set(sx, sy, sz);
  for (let i = 0; i < 4; i++) { // tabby stripes over the back
    const st = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.013, 4, 20, Math.PI * 0.75), toon(stripe));
    st.position.set(-0.15 + i * 0.1, 0.1, 0); st.rotation.set(0, Math.PI / 2, Math.PI * 0.12); st.scale.set(sz * 1.02, sy * 1.02, 1); g.add(st);
  }
  if (fluffy) { // tufts all round the curl, and a ruff at the chest
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ball(0.065, fur, Math.cos(a) * 0.24 * sx / 1.3, 0.1 + (i % 3) * 0.02, Math.sin(a) * 0.2 * sz, { parent: g }); }
    ball(0.1, chin, 0.17, 0.08, 0.04, { parent: g });
  }
  const head = new THREE.Group(); head.position.set(0.27, 0.09, 0.06); g.add(head); // chin resting on the front of the curl
  const skull = ball(lean ? 0.085 : 0.1, fur, 0, 0, 0, { parent: head });
  if (fluffy) { skull.scale.set(1.1, 1, 1.15); }
  ball(lean ? 0.05 : 0.058, chin, 0.06, -0.035, 0, { parent: head }); // white muzzle and chin
  for (const dz of [-0.03, 0.03]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.012), toon(stripe)); m.position.set(-0.02, 0.07, dz); head.add(m); } // forehead "M" marks
  const ears = [], earH = lean ? 0.085 : 0.07;
  for (const dz of [-0.055, 0.055]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(lean ? 0.038 : 0.035, earH, 4), toon(fur)); ear.position.set(-0.01, 0.085, dz * (lean ? 0.9 : 1)); ear.rotation.x = dz > 0 ? -0.3 : 0.3; head.add(ear);
    const ink = new THREE.Mesh(ear.geometry, inkMat); ink.scale.setScalar(1.3); ear.add(ink); ears.push(ear);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 4, 10, Math.PI), new THREE.MeshBasicMaterial({ color: 0x1a1020 })); lid.position.set(0.082, 0.015, dz * 0.68); lid.rotation.set(0, Math.PI / 2, Math.PI); head.add(lid); // closed eyes
  }
  ball(0.013, 0xffa0b4, 0.105, -0.008, 0, { parent: head }); // pink nose
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.2, fluffy ? 0.055 : 0.03, 8, 20, Math.PI * 1.1), toon(fluffy ? fur : stripe)); tail.rotation.set(Math.PI / 2, 0, 0.6); tail.position.set(0.02, 0.03, 0); tail.scale.set(sx / 1.3, sz, 1); g.add(tail);
  const tink = new THREE.Mesh(tail.geometry, inkMat); tink.scale.setScalar(1.06); tail.add(tink);
  // z's drifting up out of a nap
  const zs = [0, 1, 2].map((i) => { const z1 = sign("z", 0.07 + i * 0.015, 0.25, 0.3, 0.05, { parent: g, color: "#d6d6e7", font: "700 90px Rajdhani", k: 1.1 }); z1.material.opacity = 0; return z1; });
  const phase = Math.random() * 10;
  animators.push((now) => {
    const b = Math.sin(now / (lean ? 900 : 1200) + phase); body.scale.y = sy + b * 0.025; head.position.y = 0.09 + b * 0.006; // breathing
    zs.forEach((z1, i) => { const t = (now / 2600 + phase + i / 3) % 1; z1.position.set(0.25 + t * 0.12, 0.25 + t * 0.35, 0.05 - t * 0.05); z1.material.opacity = Math.sin(t * Math.PI) * 0.9; z1.lookAt(camera.position); });
    if (g.userData.twitch) { const k = (now - g.userData.twitch) / 500; ears.forEach((e, i) => { e.rotation.z = k < 1 ? Math.sin(k * Math.PI * 4) * 0.5 * (i ? 1 : -1) : 0; }); if (k >= 1) g.userData.twitch = 0; }
  });
  return g;
};
// A cat tree like theirs: dark gray carpet, cubbies with arched doorways, sisal posts, a perch on top.
// Group space: +z faces into the room, so it stands with its back flat to a wall.
const catTree = (x, z, rotY, { tall = 1.5 } = {}) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  const carpet = 0x3a3d4a, sisal = (px, pz, y0, h) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 12), toon(0xd2b07a)); m.position.set(px, y0 + h / 2, pz); g.add(m);
    const ink = new THREE.Mesh(m.geometry, inkMat); ink.scale.set(1.25, 1.01, 1.25); m.add(ink);
    for (let yy = y0 + 0.05; yy < y0 + h; yy += 0.08) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.061, 0.005, 4, 14), toon(0xb08a55)); r.rotation.x = Math.PI / 2; r.position.set(px, yy, pz); g.add(r); }
  };
  const cubby = (cx, cy, w, h) => { // a carpeted box with an arched hole in front
    block(w, h, 0.5, carpet, cx, cy + h / 2, 0, { parent: g, r: 0.04 });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(h * 0.3, 18, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x0c0c14 }));
    hole.position.set(cx, cy + h * 0.32, 0.252); g.add(hole);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.6, h * 0.32), new THREE.MeshBasicMaterial({ color: 0x0c0c14 })); door.position.set(cx, cy + h * 0.16, 0.252); g.add(door);
  };
  block(0.8, 0.08, 0.6, carpet, 0, 0.04, 0, { parent: g, r: 0.03 });
  cubby(-0.12, 0.08, 0.5, 0.42);
  sisal(0.28, 0.1, 0.08, tall * 0.5);
  block(0.75, 0.06, 0.55, carpet, 0, 0.08 + tall * 0.5, 0, { parent: g, r: 0.03 });
  cubby(0.1, 0.14 + tall * 0.5, 0.42, 0.36);
  sisal(-0.25, 0.08, 0.14 + tall * 0.5, tall * 0.36);
  const top = 0.14 + tall * 0.86;
  block(0.62, 0.06, 0.5, carpet, 0, top, 0, { parent: g, r: 0.03 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 24), toon(carpet)); rim.rotation.x = Math.PI / 2; rim.position.set(0, top + 0.06, 0); g.add(rim);
  // a sisal ball on a string, swinging a little (like theirs)
  const pom = new THREE.Group(); pom.position.set(0.3, 0.08 + tall * 0.5, 0.22); g.add(pom);
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), new THREE.MeshBasicMaterial({ color: 0xd6d6e7 })); str.position.y = -0.1; pom.add(str);
  ball(0.045, 0xe0a487, 0, -0.22, 0, { parent: pom });
  const ph = Math.random() * 10; animators.push((now) => { pom.rotation.z = Math.sin(now / 900 + ph) * 0.25; });
  return { g, perch: top + 0.04 };
};
// A round, cushy cat bed.
const catBed = (x, z) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.08, 24), toon(0x4a4d5e)); base.position.y = 0.04; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.1, 10, 28), toon(0x5c6072)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
  const ink = new THREE.Mesh(rim.geometry, inkMat); ink.scale.setScalar(1.04); rim.add(ink);
  return g;
};
// Their toys: Fin's green cactus plush, the wooden ball track, a sparkly purple mouse.
const cactus = (x, y, z, rotY) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  const trunk = block(0.5, 0.11, 0.11, 0x4cb54a, 0, 0.055, 0, { parent: g, r: 0.05 });
  block(0.15, 0.09, 0.09, 0x4cb54a, -0.05, 0.05, 0.11, { parent: g, r: 0.04, rot: [0, 0.6, 0] });
  for (let i = 0; i < 5; i++) ball(0.018, 0xff4a2a, 0.26, 0.06 + (i % 2) * 0.02, -0.03 + i * 0.015, { parent: g }); // the red flower
  return trunk;
};
const ballTrack = (x, z) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  [0.26, 0.21, 0.16].forEach((r, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 28), toon(0xd6a066)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.04 + i * 0.07; g.add(ring);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 28), toon(0xc48f55)); disc.position.y = 0.02 + i * 0.07; g.add(disc);
    const bl = ball(0.025, i === 1 ? 0x7a8a6a : 0xf0dcc0, r, 0.05 + i * 0.07, 0, { parent: g });
    const ph = i * 2; animators.push((now) => { const a = now / (1400 + i * 500) + ph; bl.position.set(Math.cos(a) * r, 0.05 + i * 0.07, Math.sin(a) * r); });
  });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 12), toon(0xd2b07a)); post.position.y = 0.4; g.add(post);
  return g;
};
const toyMouse = (x, y, z, rotY = 0, color = 0x9b3dd6) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  const b = ball(0.045, color, 0, 0.03, 0, { parent: g }); b.scale.set(1.5, 0.8, 1);
  b.material.emissive = new THREE.Color(color).multiplyScalar(0.25); // a bit of sparkle
  for (const dz of [-0.025, 0.025]) ball(0.016, 0xd07ae8, 0.04, 0.06, dz, { parent: g });
  const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.06, 0.02, 0), V(-0.12, 0.01, 0.04), V(-0.17, 0.01, -0.02)]), 10, 0.005, 4), toon(color)); g.add(t);
  return g;
};
const FIN = { fur: 0x9a8670, stripe: 0x3e342a, chin: 0xf2ece0, size: 1.15, fluffy: true };
const PHOEBE = { fur: 0xe39a4f, stripe: 0xb8692a, chin: 0xf6efe4, size: 0.62, lean: true };
const buildCats = () => {
  const napper = (g, name) => addHot(g, "living", name, "Shh… napping", () => { g.userData.twitch = performance.now(); toast(`Shh… ${name}'s napping.`); });
  // living room: Phoebe on top of the cat tree (back wall, left of the window), Fin in his bed (back wall, right)
  const tree = catTree(-3.2, -6.58, 0, { tall: 1.5 });
  napper(cat(PHOEBE, -3.22, tree.perch, -6.56, -1.2), "Phoebe");
  catBed(3.2, -6.5);
  napper(cat(FIN, 3.18, 0.12, -6.5, -1.9), "Fin");
  cactus(2.62, 0, -6.6, 0.4);
  ballTrack(-2.35, -6.55);
  toyMouse(-3.85, 0, -6.4, 0.9);
  // theater: their second tree against the right wall, by the popcorn machine
  const t2 = catTree(-0.42, -13.7, -Math.PI / 2, { tall: 1.2 });
  toyMouse(-0.75, t2.perch - 0.01, -13.75, 2.6);
  toyMouse(-8.4, 0, -10.2, 2.2, 0xff2a6d);
  // hallway: a toy mouse left on the doormat
  toyMouse(0.38, 0.03, 0.9, -0.5);
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
// The window doubles as a screen. Closed: a small readout in the corner (time + block height).
// Open (winApp → 1): CLOCK.APP grows out of that readout to fill most of the glass.
let winApp = 0, winAnim = null; // 0 closed … 1 open, and the open/close animation in progress
const drawHUD = (x, a) => {
  x.globalAlpha = a;
  x.fillStyle = "rgba(10,6,24,.55)"; x.fillRect(60, 52, 600, height ? 200 : 140);
  x.font = "500 34px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.textBaseline = "top"; x.fillText(`>> ${(S.location || "DC").toUpperCase()} · LOCAL TIME`, 86, 74);
  x.font = "700 96px Rajdhani"; x.fillStyle = "#05d9e8"; x.shadowColor = "#05d9e8"; x.shadowBlur = 18; x.fillText(clockFmt.format(new Date()), 84, 110); x.shadowBlur = 0;
  if (height) { x.font = "500 34px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.fillText(`BLOCK ${height.toLocaleString()}`, 86, 210); }
  x.globalAlpha = 1;
};
const drawWindow = () => {
  if (!windowCanvas) return;
  if (!skyline) drawSkyline();
  const x = windowCanvas.getContext("2d");
  x.setTransform(1.25, 0, 0, 1.25, 0, 0);
  x.drawImage(skyline, 0, 0);
  if (winApp < 0.35) drawHUD(x, 1 - winApp / 0.35);
  if (winApp > 0) drawApp(x, winApp);
  if (rainMesh) rainMesh.material.opacity = 0.32 * (1 - winApp); // rain clears off the glass while the app is up
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
    hint: touch ? "Tap the screen for my review · tap the shelf to browse it" : "Click the screen for my review · click the shelf to browse it" },
  shelf: { pos: V(-4.6, 1.72, -13.7), look: V(-8.75, 1.65, -13.7), name: "Movie shelf", yaw: 0.35,
    hint: touch ? "Tap a shelf to look closer" : "Click a shelf to look closer" },
};
const ORDER = ["outside", "living", "theater", "shelf"]; // the rooms, in walking order
const PATHS = { // waypoints for position and where the camera looks, from → to
  "outside>living": { pos: [V(0, 1.6, 5.4), V(0, 1.62, 2.2), V(0, 1.66, 0.4), V(0, 1.72, -0.6)], look: [V(0, 1.45, 0), V(0, 1.5, -3), V(0, 1.45, -6), V(0, 1.45, -7)] },
  "theater>shelf": { pos: [V(-4.5, 2.15, -8.2), V(-5.6, 1.95, -10.1), V(-5.0, 1.78, -12.6), V(-4.6, 1.72, -13.7)], look: [V(-4.5, 1.85, -17), V(-7.2, 1.7, -14.8), V(-8.75, 1.65, -13.9), V(-8.75, 1.65, -13.7)] },
  "living>theater": { pos: [V(0, 1.72, -0.6), V(-2.4, 1.72, -3.6), V(-4.5, 1.76, -6.1), V(-4.5, 1.95, -7.5), V(-4.5, 2.15, -8.2)], look: [V(0, 1.45, -7), V(-4.5, 1.6, -7.5), V(-4.5, 1.7, -10), V(-4.5, 1.8, -14), V(-4.5, 1.85, -17)] },
};
let room = "outside", flight = null, yaw = 0, pitch = 0, doorOpen = 0, doorTo = 0;
let focusRow = null; // the shelf row being looked at up close: { f, view }
const NAMES = { imax: "IMAX case", top: "A24 + Kill Bill", criterion: "Criterion Collection", steel: "4K + steelbooks", bottom: "Blu-ray + 4K" };
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const fly = (from, to, after) => {
  const fwd = PATHS[`${from}>${to}`], back = PATHS[`${to}>${from}`];
  const p = fwd || { pos: [...back.pos].reverse(), look: [...back.look].reverse() };
  if (reduce) { flight = null; room = to; after?.(); return; }
  flight = { t0: performance.now(), dur: 1700, pos: new THREE.CatmullRomCurve3(p.pos), look: new THREE.CatmullRomCurve3(p.look), yaw0: yaw, pitch0: pitch, after };
};
const lookAt = new THREE.Vector3(); // where the camera is looking now (kept by aim)
const flyTo = (pos, look, dur, after) => {
  if (reduce) { after?.(); return; }
  flight = { t0: performance.now(), dur, pos: new THREE.CatmullRomCurve3([camera.position.clone(), pos]), look: new THREE.CatmullRomCurve3([lookAt.clone(), look]), yaw0: yaw, pitch0: pitch, after };
};
let peekView = null; // ?debug only: a close-up camera for checking details
const view = () => peekView || focusRow?.view || winFocus?.view || VIEWS[room];
const setRoomUI = () => {
  const v = VIEWS[room];
  ui.room.textContent = focusRow ? `${v.name} · ${NAMES[focusRow.f.row.id] || ""}` : winFocus ? `${v.name} · Clock` : v.name;
  ui.hint.textContent = focusRow ? (focusRow.pan ? "Swipe along the shelf · tap a movie to pull it out" : touch ? "Tap a movie to pull it out" : "Click a movie to pull it out")
    : winFocus ? (touch ? "Tap a block to open it · tap off the window to close" : "Click a block to open it on mempool.space · click off the window to close")
    : v.hint;
  ui.back.hidden = room === "outside";
  document.title = room === "outside" ? "Pierpont's apartment" : `${v.name} · Pierpont's apartment`;
};
const go = (to) => {
  if (flight || cv.active) return;
  if (to === "screen") { if (room !== "theater") go("theater"); return latest?.link && window.open(latest.link, "_blank", "noopener"); }
  if (focusRow) return unfocus(() => go(to));
  if (winFocus) return closeWindowApp(() => go(to));
  if (to === room) return;
  hideTip();
  const from = room, a = ORDER.indexOf(from), b = ORDER.indexOf(to), route = [];
  for (let i = a; i !== b; i += Math.sign(b - a)) route.push(ORDER[i + Math.sign(b - a)]);
  const step = (i, cur) => {
    if (i >= route.length) return;
    const nxt = route[i];
    const launch = () => fly(cur, nxt, () => { room = nxt; setRoomUI(); if (nxt === "outside") doorTo = 0; step(i + 1, nxt); });
    if (cur === "outside" && nxt === "living" && doorOpen < 0.99) { doorTo = 1; setTimeout(launch, reduce ? 0 : 650); } else launch();
  };
  ui.hint.textContent = "";
  step(0, from);
};
const back = () => {
  if (cv.active) return cv.close();
  if (focusRow) return unfocus();
  if (winFocus) return closeWindowApp();
  if (room !== "outside") go(ORDER[ORDER.indexOf(room) - 1]);
};
ui.back.addEventListener("click", back);
document.querySelectorAll(".h-nav [data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
addEventListener("keydown", (e) => {
  if (e.key === "Escape") back();
  if (e.key === "Enter" && cv.active) cv.openReview();
});

let toastTimer;
const toast = (msg) => { ui.toast.textContent = msg; ui.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (ui.toast.hidden = true), 3200); };

// ---------- CLOCK.APP, on the window glass ----------
// Local time to the second, and a Bitcoin block clock (mempool.space): the latest blocks, price,
// fees, and how far along the halving and the next difficulty adjustment are.
const cur = S.bitcoin?.currency || "USD";
const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 });
const tz = S.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmtIn = (o) => { try { return new Intl.DateTimeFormat(undefined, { ...o, timeZone: tz }); } catch { return new Intl.DateTimeFormat(undefined, o); } };
const partsF = fmtIn({ hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: undefined }), dayF = fmtIn({ weekday: "long", month: "long", day: "numeric" });
const hmsF = fmtIn({ hour: "numeric", minute: "numeric", second: "numeric", hour12: false });
const api = (path) => fetch(`https://mempool.space/api${path}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
const since = (t) => { const m = Math.floor((Date.now() / 1000 - t) / 60); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} hr ${m % 60} min ago`; };
const btc = { tip: 0, blocks: [], price: 0, dayAgo: 0, spark: [], sats: 0, fee: 0, halv: null, diff: null };
const liveBlocks = async () => {
  const [blocks, prices, fees, diff] = await Promise.all([api("/v1/blocks"), api("/v1/prices"), api("/v1/fees/recommended"), api("/v1/difficulty-adjustment").catch(() => null)]);
  const tip = blocks[0], into = tip.height % 210000, left = 210000 - into;
  Object.assign(btc, { tip: tip.timestamp, blocks: blocks.slice(0, 6), price: prices[cur], sats: Math.round(1e8 / prices[cur]), fee: fees.fastestFee, diff,
    halv: { left, pct: into / 210000, eta: new Date(Date.now() + left * 600000).toLocaleDateString(undefined, { month: "short", year: "numeric" }) } });
  height = tip.height; drawWindow();
};
const trend = async () => { // the last week's price, a point a day (hour-rounded so responses cache)
  const hour = Math.floor(Date.now() / 3600000) * 3600;
  const pts = (await Promise.all([7, 6, 5, 4, 3, 2, 1].map((d) => api(`/v1/historical-price?currency=${cur}&timestamp=${hour - d * 86400}`).then((r) => r.prices[0]?.[cur]).catch(() => null)))).filter(Boolean);
  btc.dayAgo = pts[pts.length - 1]; btc.spark = btc.price ? [...pts, btc.price] : pts; drawWindow();
};
const APP = { x: 36, y: 36, w: 2008, h: 728 }, HUDR = { x: 60, y: 52, w: 600, h: 200 };
const tileRects = []; // where the block tiles are (canvas units), for clicks
const lerp = (a, b, t) => a + (b - a) * t;
const drawApp = (x, k) => {
  const e = ease(Math.min(1, k)), r = { x: lerp(HUDR.x, APP.x, e), y: lerp(HUDR.y, APP.y, e), w: lerp(HUDR.w, APP.w, e), h: lerp(HUDR.h, APP.h, e) };
  // the window frame, with clipped corners like the site's panels
  const cut = 28, frame = () => { x.beginPath(); x.moveTo(r.x, r.y); x.lineTo(r.x + r.w - cut, r.y); x.lineTo(r.x + r.w, r.y + cut); x.lineTo(r.x + r.w, r.y + r.h); x.lineTo(r.x + cut, r.y + r.h); x.lineTo(r.x, r.y + r.h - cut); x.closePath(); };
  x.globalAlpha = Math.min(1, k * 3);
  frame(); const g = x.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h); g.addColorStop(0, "rgba(30,22,74,.93)"); g.addColorStop(1, "rgba(10,8,24,.95)"); x.fillStyle = g; x.fill();
  x.strokeStyle = "#05d9e8"; x.lineWidth = 3; x.shadowColor = "#05d9e8"; x.shadowBlur = 24; frame(); x.stroke(); x.shadowBlur = 0;
  const c = Math.max(0, Math.min(1, (k - 0.6) / 0.4)); // the contents fade in once the frame has grown
  x.globalAlpha = c; tileRects.length = 0;
  if (c > 0) {
    const L = APP.x, T = APP.y, label = (t, px, py) => { x.font = "500 26px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.fillText(t, px, py); };
    x.textBaseline = "top";
    // title bar
    ["#ff2a6d", "#f9f002", "#05d9e8"].forEach((col, i) => { x.fillStyle = col; x.beginPath(); x.arc(L + 40 + i * 30, T + 36, 9, 0, Math.PI * 2); x.fill(); });
    x.font = "700 40px Rajdhani"; x.fillStyle = "#05d9e8"; x.shadowColor = "#05d9e8"; x.shadowBlur = 12; x.fillText("CLOCK.APP", L + 150, T + 16); x.shadowBlur = 0;
    x.fillStyle = "#05d9e8"; x.beginPath(); x.arc(L + 382, T + 37, 7, 0, Math.PI * 2); x.fill(); label("LIVE", L + 398, T + 23);
    x.textAlign = "right"; label(touch ? "TAP OFF THE WINDOW TO CLOSE" : "ESC OR CLICK OFF THE WINDOW TO CLOSE", L + APP.w - 40, T + 23); x.textAlign = "left";
    x.fillStyle = "rgba(157,157,192,.25)"; x.fillRect(L, T + 72, APP.w, 2);
    for (const dx of [665, 1315]) x.fillRect(L + dx, T + 96, 2, APP.h - 120);
    // 1 · local time
    const now = new Date(), p = Object.fromEntries(partsF.formatToParts(now).map((q) => [q.type, q.value]));
    const [hh, mm, ss] = hmsF.format(now).split(":").map(Number);
    const a1 = L + 40;
    label(`>> LOCAL TIME · ${(S.location || "DC").toUpperCase()}`, a1, T + 104);
    x.font = "700 210px Rajdhani"; x.fillStyle = "#05d9e8"; x.shadowColor = "#05d9e8"; x.shadowBlur = 30;
    const hm = `${p.hour}:${p.minute}`; x.fillText(hm, a1 - 6, T + 140); x.shadowBlur = 0;
    const hmW = x.measureText(hm).width;
    x.font = "500 50px 'JetBrains Mono'"; x.fillStyle = "#d6d6e7"; x.fillText(`:${p.second}`, a1 + hmW + 6, T + 252);
    if (p.dayPeriod) x.fillText(p.dayPeriod, a1 + hmW + 6, T + 198);
    x.font = "600 44px Inter"; x.fillStyle = "#f4f3ff"; x.fillText(dayF.format(now), a1, T + 380);
    const bar = (bx, by, bw, frac, col) => { x.fillStyle = "rgba(157,157,192,.25)"; x.fillRect(bx, by, bw, 8); x.fillStyle = col; x.shadowColor = col; x.shadowBlur = 12; x.fillRect(bx, by, bw * Math.max(0, Math.min(1, frac)), 8); x.shadowBlur = 0; };
    label("THIS MINUTE", a1, T + 460); bar(a1, T + 498, 580, ss / 59, "#05d9e8");
    const dayFrac = (hh * 3600 + mm * 60 + ss) / 86400;
    label(`TODAY · ${Math.round(dayFrac * 100)}% DONE`, a1, T + 540); bar(a1, T + 578, 580, dayFrac, "#ff2a6d");
    label(`TIME ZONE · ${tz.replace(/_/g, " ").toUpperCase()}`, a1, T + 640);
    // 2 · the block clock
    const a2 = L + 705;
    label(">> BITCOIN BLOCK CLOCK", a2, T + 104);
    x.font = "500 124px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 26;
    x.fillText(height ? height.toLocaleString() : "…", a2 - 4, T + 140); x.shadowBlur = 0;
    x.font = "500 34px Inter"; x.fillStyle = "#d6d6e7"; x.fillText(btc.tip ? `Last block found ${since(btc.tip)}` : "Checking the chain…", a2, T + 282);
    btc.blocks.forEach((b, i) => {
      const tx = a2 + (i % 3) * 200, ty = T + 346 + Math.floor(i / 3) * 176, w = 184, h = 160;
      const tg = x.createLinearGradient(tx, ty, tx + w, ty + h);
      if (i) { tg.addColorStop(0, "#5b2fb0"); tg.addColorStop(1, "#2a1563"); } else { tg.addColorStop(0, "#b8a60a"); tg.addColorStop(1, "#6b5e00"); }
      x.fillStyle = tg; x.fillRect(tx, ty, w, h);
      x.strokeStyle = i ? "rgba(185,140,255,.6)" : "#f9f002"; x.lineWidth = 2; x.strokeRect(tx, ty, w, h);
      x.font = "600 30px 'JetBrains Mono'"; x.fillStyle = "#f4f3ff"; x.fillText(b.height.toLocaleString(), tx + 14, ty + 14);
      x.font = "400 24px Inter"; x.fillStyle = "rgba(244,243,255,.85)";
      x.fillText(`${b.tx_count.toLocaleString()} txs`, tx + 14, ty + 62); x.fillText(`${(b.size / 1e6).toFixed(2)} MB`, tx + 14, ty + 92); x.fillText(since(b.timestamp), tx + 14, ty + 122);
      tileRects.push({ x: tx, y: ty, w, h, height: b.height });
    });
    // 3 · price and the slow clocks
    const a3 = L + 1355, w3 = APP.w - 1355 - 40;
    label("PRICE", a3, T + 104);
    x.font = "700 104px Rajdhani"; x.fillStyle = "#f4f3ff"; x.fillText(btc.price ? money(btc.price) : "…", a3, T + 132);
    if (btc.price && btc.dayAgo) {
      const pct = ((btc.price - btc.dayAgo) / btc.dayAgo) * 100;
      x.font = "500 30px 'JetBrains Mono'"; x.fillStyle = pct >= 0 ? "#05d9e8" : "#ff6b95"; x.fillText(`${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% TODAY`, a3, T + 244);
    }
    if (btc.spark.length > 1) {
      const lo = Math.min(...btc.spark), hi = Math.max(...btc.spark), sy = T + 300, sh = 100;
      x.beginPath(); btc.spark.forEach((v, i) => { const px = a3 + (i / (btc.spark.length - 1)) * w3, py = sy + sh - ((v - lo) / (hi - lo || 1)) * sh; i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.strokeStyle = "#f9f002"; x.lineWidth = 4; x.shadowColor = "#f9f002"; x.shadowBlur = 12; x.stroke(); x.shadowBlur = 0;
      label("LAST 7 DAYS", a3, sy + sh + 14);
    }
    const stat = (k2, v, px, py) => { label(k2, px, py); x.font = "600 36px Inter"; x.fillStyle = "#f4f3ff"; x.fillText(v, px, py + 32); };
    stat("SATS PER DOLLAR", btc.sats ? btc.sats.toLocaleString() : "…", a3, T + 460);
    stat("FEES, NEXT BLOCK", btc.fee ? `${btc.fee} sat/vB` : "…", a3 + 330, T + 460);
    if (btc.halv) { stat("NEXT HALVING", `~${btc.halv.eta} · ${btc.halv.left.toLocaleString()} blocks`, a3, T + 548); bar(a3, T + 626, w3, btc.halv.pct, "#f9f002"); }
    if (btc.diff) { const d = btc.diff; stat("DIFFICULTY ADJUSTMENT", `${d.difficultyChange >= 0 ? "+" : ""}${d.difficultyChange.toFixed(1)}% · ${d.remainingBlocks.toLocaleString()} blocks`, a3, T + 648); bar(a3, T + 726 - 10, w3, d.progressPercent / 100, "#05d9e8"); }
  }
  x.globalAlpha = 1;
};

// Opening the app: the camera stays where it is; only the glass changes.
let winFocus = null, appTimers = [];
const openWindowApp = () => {
  if (winFocus || flight) return;
  winFocus = {};
  hideTip(); setRoomUI(); mullion.visible = false;
  winAnim = { t0: performance.now(), from: winApp, to: 1 };
  liveBlocks().then(trend).catch((e) => console.warn("mempool:", e.message));
  appTimers = [setInterval(drawWindow, 1000), setInterval(() => liveBlocks().catch(() => {}), 20000)];
};
const closeWindowApp = (after) => {
  if (!winFocus) return after?.();
  winFocus = null; appTimers.forEach(clearInterval); hideTip(); setRoomUI();
  winAnim = { t0: performance.now(), from: winApp, to: 0 };
  after?.();
};
// Which block tile (if any) is under the pointer, on the glass?
const tileAt = (e) => {
  const hit = setRay(e).intersectObject(windowGlass, false)[0];
  if (!hit) return { off: true };
  const cx = hit.uv.x * 2080, cy = (1 - hit.uv.y) * 800;
  return { t: tileRects.find((t) => cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) };
};

// ---------- the movie shelf, up close ----------
// The pulled-out case (shared with the main page): it renders on top of the room in a second pass.
const cv = createCaseViewer({ renderer, camera, scene, touch, reduce, dim: 0.95, // the bloom pass blends in linear light, so it needs more to look as dark
  onOpen: () => { hideTip(); ui.hint.textContent = touch ? "Swipe to spin it · tap the review on the back · tap around it to put it back" : "Drag to spin it · click the review on the back · click around it to put it back"; },
  onClose: () => setRoomUI() });
// Lean in to one row: the camera squares up to it, close enough to pick a spine.
const focus = (f) => {
  if (focusRow?.f.imax && focusRow.f !== f) { focusRow.f.mesh.material.map = focusRow.f.row._front; }
  const c = f.mesh.getWorldPosition(new THREE.Vector3());
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
  let d = Math.max((f.h + 0.2) / 2 / Math.tan(vf), (f.w + 0.3) / 2 / Math.tan(hf)), pan = 0;
  // Tall screens: come in close enough to read the spines and swipe along the row (like the main page).
  if (camera.aspect < 0.8) { d = f.h / 0.45 / 2 / Math.tan(vf); pan = Math.max(0, (f.w + 0.1) / 2 - d * Math.tan(hf)); }
  const start = c.clone(); start.z += pan; // begin at the row's left end (+z is left, looking at the wall)
  focusRow = { f, view: { pos: start.clone().add(V(d, 0, 0)), look: start, yaw: pan ? 0 : 0.12 }, c, pan, d };
  if (f.imax) f.mesh.material.map = f.row._tex; // the IMAX case opens to its spines
  hideTip(); setRoomUI();
  flyTo(focusRow.view.pos, focusRow.view.look, 1000);
};
const unfocus = (after) => {
  if (!focusRow) return after?.();
  if (focusRow.f.imax) focusRow.f.mesh.material.map = focusRow.f.row._front;
  focusRow = null; hideTip(); setRoomUI();
  flyTo(VIEWS.shelf.pos, VIEWS.shelf.look, 900, after);
};
const describe = (it) => (it.r ? `My ${it.s} review` : it.m ? `Rated ${it.s}` : "Not on my Letterboxd yet");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// the outline of what's under the pointer, drawn on the photo
const hlLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x05d9e8, toneMapped: false }));
const hlFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x05d9e8, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
const showZone = (f, zone) => {
  if (!f) { hlLine.visible = hlFill.visible = false; return; }
  const pts = zone.map(([u, v]) => new THREE.Vector3((u - 0.5) * f.w, (0.5 - v) * f.h, 0.004));
  hlLine.geometry.setFromPoints(pts);
  hlFill.geometry.dispose(); hlFill.geometry = new THREE.ShapeGeometry(new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x, q.y))));
  hlFill.position.z = 0.003; f.mesh.add(hlLine); f.mesh.add(hlFill);
  hlLine.visible = hlFill.visible = true;
};
const WHOLE = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ---------- pointer: hover glow + tooltip, click to act, drag to look around ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hovered = null, down = null;
const setRay = (e) => {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray;
};
// Which shelf photo, and where on it (u right, v down), is under the pointer?
const faceAt = (e) => {
  const hit = setRay(e).intersectObjects(shelfFaces.map((f) => f.mesh), false)[0];
  return hit ? { f: shelfFaces.find((f) => f.mesh === hit.object), u: hit.uv.x, v: 1 - hit.uv.y, point: hit.point } : null;
};
// In the shelf view: a whole row to lean into, or (leaning in) the movie under the pointer.
const shelfPick = (e) => {
  const h = faceAt(e); if (!h) return null;
  if (focusRow?.f !== h.f) return { h, row: true };
  const p = pick(h.f.row, h.u, h.v);
  return p ? { h, p } : null;
};
const pickAt = (e) => {
  setRay(e);
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
const hideTip = () => { ui.tip.hidden = true; if (hovered) setGlow(hovered, false); hovered = null; canvas.style.cursor = ""; showZone(null); };
const showTip = (e, h) => {
  ui.tip.innerHTML = `<strong>${esc(h.label)}</strong>${[].concat(h.sub).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}`; ui.tip.hidden = false;
  const tw = ui.tip.offsetWidth, th = ui.tip.offsetHeight;
  ui.tip.style.transform = `translate(${Math.min(e.clientX + 16, innerWidth - tw - 8)}px, ${Math.min(e.clientY + 16, innerHeight - th - 8)}px)`;
};
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false }; try { canvas.setPointerCapture(e.pointerId); } catch {} });
canvas.addEventListener("pointermove", (e) => {
  if (cv.active) { // a case is out: drag spins it
    if (down) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.drag = true; cv.spin(e.clientX - down.lx, e.clientY - down.ly); down.lx = e.clientX; down.ly = e.clientY; }
    const on = !down && cv.hit(setRay(e));
    canvas.style.cursor = down ? "grabbing" : on && cv.reviewHit(ray) ? "pointer" : on ? "grab" : "zoom-out";
    return;
  }
  if (down) {
    if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down.drag = true; hideTip(); }
    if (down.drag && !flight && focusRow?.pan) { // slide along the row, within its ends
      const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
      const perPx = (2 * focusRow.d * Math.tan(hf)) / canvas.clientWidth, v = focusRow.view;
      const z = THREE.MathUtils.clamp(v.look.z + (e.clientX - down.lx) * perPx, focusRow.c.z - focusRow.pan, focusRow.c.z + focusRow.pan);
      v.look.z = v.pos.z = z; down.lx = e.clientX; down.ly = e.clientY;
      return;
    }
    if (down.drag && !flight) {
      const lim = view().yaw;
      yaw = THREE.MathUtils.clamp(yaw + (e.clientX - down.lx) * 0.004, -lim, lim);
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - down.ly) * 0.003, -0.3, 0.3);
      down.lx = e.clientX; down.ly = e.clientY;
      canvas.style.cursor = "grabbing";
    }
    return;
  }
  if (e.pointerType !== "mouse" || flight) return;
  if (winFocus) {
    const w = tileAt(e);
    if (w.t) { showTip(e, { label: `Block ${w.t.height.toLocaleString()}`, sub: "Open it on mempool.space ↗" }); canvas.style.cursor = "pointer"; }
    else { hideTip(); canvas.style.cursor = w.off ? "zoom-out" : "default"; }
    return;
  }
  if (room === "shelf") {
    const s = shelfPick(e);
    if (!s) { hideTip(); canvas.style.cursor = focusRow ? "zoom-out" : "grab"; return; }
    if (s.row) { showZone(s.h.f, WHOLE); showTip(e, { label: NAMES[s.h.f.row.id] || "Shelf", sub: "Click to look closer" }); canvas.style.cursor = "zoom-in"; return; }
    showZone(s.h.f, s.p.zone);
    if (s.p.it.u) { showTip(e, { label: s.p.it.t, sub: [describe(s.p.it), "Click to pull it out"] }); canvas.style.cursor = "pointer"; }
    else { showTip(e, { label: "Can't read this one yet", sub: "" }); canvas.style.cursor = "default"; }
    return;
  }
  const h = pickAt(e);
  if (h !== hovered) { if (hovered) setGlow(hovered, false); hovered = h; if (h) setGlow(h, true); }
  if (h) { showTip(e, h); canvas.style.cursor = "pointer"; } else { ui.tip.hidden = true; canvas.style.cursor = "grab"; }
});
canvas.addEventListener("pointerup", (e) => {
  const wasDrag = down?.drag; down = null; canvas.style.cursor = "";
  if (cv.active) { // the review on the back opens it; anywhere off the case puts it back
    cv.endDrag();
    if (!wasDrag) { if (!cv.hit(setRay(e))) cv.close(); else if (cv.reviewHit(ray)) cv.openReview(); }
    return;
  }
  if (wasDrag || flight) return;
  if (winFocus) {
    const w = tileAt(e);
    if (w.t) window.open(`https://mempool.space/block/${w.t.height}`, "_blank", "noopener");
    else if (w.off) closeWindowApp(); // off the glass: close the app
    return;
  }
  if (room === "shelf") {
    const s = shelfPick(e);
    if (!s) return focusRow && unfocus(); // clicking off the shelf steps back from the row
    if (s.row) return focus(s.h.f);
    if (s.p.it.u) cv.open({ row: s.h.f.row, it: s.p.it, zone: s.p.zone, point: s.h.point });
    return;
  }
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
  PATHS["theater>shelf"].pos[0].copy(VIEWS.theater.pos); PATHS["theater>shelf"].look[0].copy(VIEWS.theater.look);
  VIEWS.shelf.pos.x = tall ? -3.9 : -4.6; // step back on tall screens so the whole shelf fits across
  const sp = PATHS["theater>shelf"].pos; sp[sp.length - 1].copy(VIEWS.shelf.pos);
};
addEventListener("resize", resize);

const dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const aim = (pos, look, yw, pt) => {
  dir.subVectors(look, pos).applyAxisAngle(up, yw);
  dir.y += pt * dir.length();
  camera.position.copy(pos); lookAt.set(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z); camera.lookAt(lookAt);
};
const flickers = [];
const frame = (now) => {
  // the door eases open or shut
  doorOpen += (doorTo - doorOpen) * (reduce ? 1 : 0.08);
  doorPivot.rotation.y = -doorOpen * 1.85; // swings out into the hallway, clear of the living room view
  if (flight) {
    const k = Math.max(0, Math.min(1, (now - flight.t0) / flight.dur)), s = ease(k); // a frame's timestamp can predate the click that started this
    yaw = flight.yaw0 * (1 - s); pitch = flight.pitch0 * (1 - s);
    aim(flight.pos.getPoint(s), flight.look.getPoint(s), yaw, pitch);
    if (k === 1) { const a = flight.after; flight = null; a?.(); }
  } else {
    const v = view();
    aim(v.pos, v.look, yaw, pitch);
  }
  const dt = Math.min(100, now - (frame.last || now)); frame.last = now;
  if (!reduce) {
    for (const a of animators) a(now, dt);
    for (const b of blinkers) b.m.visible = Math.sin(now / 1000 * b.rate * 3 + b.phase) > -0.3;
  }
  if (!reduce) for (const s of flickers) { // neon that stutters now and then
    const on = Math.sin(now / 1000 * 1.3 + s.userData.seed) > -0.97 || Math.random() < 0.5;
    s.material.color.setScalar(on ? s.userData.k : s.userData.k * 0.35);
  }
  if (winAnim) { // the clock app growing out of (or shrinking back into) the corner readout
    const t = reduce ? 1 : Math.max(0, Math.min(1, (now - winAnim.t0) / 650));
    winApp = winAnim.from + (winAnim.to - winAnim.from) * t; drawWindow();
    if (t === 1) { if (!winAnim.to) mullion.visible = true; winAnim = null; }
  }
  cv.step(now);
  composer.render();
  cv.render(); // a pulled-out case, on top
};

if (location.search.includes("debug")) window.__house = { camera, scene, go, cv, shelfFaces, focus, openWindowApp, closeWindowApp,
  peek(p, l) { peekView = p ? { pos: V(...p), look: V(...l), yaw: 0 } : null; }, get room() { return room; }, set yaw(v) { yaw = v; } };

// ---------- start ----------
(async () => {
  await Promise.race([
    Promise.all(["700 140px Rajdhani", "500 34px 'JetBrains Mono'", "500 38px Inter", "600 40px Inter", "italic 400 38px Inter"].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  buildOutside(); buildLiving(); buildTheater(); buildDecor(); buildCats();
  scene.add(new THREE.AmbientLight(0x5b4a9a, 0.9));
  scene.add(new THREE.HemisphereLight(0x9d8cff, 0x1a0f30, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(3, 6, 4); scene.add(key);
  scene.traverse((o) => { if (o.userData.flicker) { o.userData.seed = Math.random() * 10; flickers.push(o); } });
  drawScreen(null); loadLive();
  resize(); setRoomUI(); aim(VIEWS.outside.pos, VIEWS.outside.look, 0, 0);
  renderer.setAnimationLoop(frame);
  setTimeout(() => ui.load.classList.add("done"), 250); // the shelf photos stream in after; nothing waits on them
})();
