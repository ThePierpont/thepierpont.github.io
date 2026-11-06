// The 3D apartment (house.html): front door → living room → theater, more rooms to come.
// Look: physically based materials lit by neon and city light, with soft reflections, ambient occlusion
// and bloom. A step towards real, not all the way (the cartoon version is tagged apartment-cartoon-v1).
// Live bits: the theater screen shows my latest Letterboxd watch, the window shows DC's time and
// the Bitcoin block height, and the theater has my real movie shelf: walk up, lean into a row,
// and pull any movie out (the case pop-out is shared with the main page: case-viewer.js).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCaseViewer, pick } from "./case-viewer.js?v=1793944054";

const S = window.SITE || {};
const $ = (s) => document.querySelector(s);
const canvas = $("#house");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = matchMedia("(pointer: coarse)").matches;
const ui = { room: $("#h-room"), back: $("#h-back"), hint: $("#h-hint"), tip: $("#h-tip"), toast: $("#h-toast"), load: $("#h-load") };

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
catch (e) { document.body.classList.add("no-3d"); throw e; }
// Phones get a lighter build (and this is as heavy as the phone version goes): simpler matte shading
// instead of PBR, no shadows, no ambient occlusion, lower resolution and a cheaper bloom. Desktop gets it all.
const lite = touch || location.search.includes("lite"); // ?lite previews the phone build on a computer
/* Resolution. Desktop draws at most ~2.6 million pixels a frame however big the window or retina the screen (a
   1300 x 770 window on a 2x display would otherwise be 4 million), then a quality factor trims that further if the
   frame rate drops and gives it back when there's headroom. Phones keep their fixed 1.15. */
const PIX_BUDGET = 2.6e6; let quality = 1;
const basePR = () => lite ? Math.min(devicePixelRatio, 1.15) : Math.min(devicePixelRatio, 2, Math.sqrt(PIX_BUDGET / (innerWidth * innerHeight)));
renderer.setPixelRatio(basePR());
let shadowDirty = 0; /* shadow maps are redrawn only until this time (something moved), not every frame */
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Tone mapping: Khronos "PBR Neutral" (written in by hand, three r160 predates it). It leaves the
// mid-tones alone and only rolls off the highlights, so neon keeps its colour instead of going pastel.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace("vec3 CustomToneMapping( vec3 color ) { return color; }", `
vec3 CustomToneMapping( vec3 color ) {
  const float startC = 0.76; const float desat = 0.15;
  color *= toneMappingExposure;
  float x = min( color.r, min( color.g, color.b ) );
  color -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < startC ) return color;
  float d = 1.0 - startC, np = 1.0 - d * d / ( peak + d - startC );
  color *= np / peak;
  return mix( color, vec3( np ), 1.0 - 1.0 / ( desat * ( peak - np ) + 1.0 ) );
}`);
renderer.toneMapping = THREE.CustomToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07050f);
scene.fog = new THREE.Fog(0x07050f, 16, 34);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 80);
const loader = new THREE.TextureLoader();
// Photoscanned props (Poly Haven, CC0, no credit required), desktop only: real objects where a built one wouldn't do.
// images/models: Camera_01 (a vintage 35 mm rangefinder, 2k textures) and desk_lamp_arm_01 (a clamp-on anglepoise, 1k).
// `fit` runs once the model is in; any glass that asks for refraction is given plain glossy glass instead
// (refraction would cost a whole extra render of the room every frame).
/* the scans aren't needed to get in the door: they download quietly once the apartment is up and the page is idle */
const afterLoad = (fn) => { const go = () => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 800));
  const t0 = performance.now(), wait = () => (document.getElementById("h-load")?.classList.contains("done") || performance.now() - t0 > 20000 ? setTimeout(go, 1200) : setTimeout(wait, 200)); wait(); };
/* desktop: wall-sized WebP copies of the site photos (images/house) for the prints and frames; clicking one still opens the full original */
const wallSrc = (src) => (lite ? src : src.replace(/^images\/([^/]+)\.(jpe?g|png)$/i, "images/house/$1.webp"));
const loadWall = (src, ok) => loader.load(wallSrc(src), ok, undefined, () => wallSrc(src) !== src && loader.load(src, ok));
const gltfLoader = new GLTFLoader(), loadedModels = {};
const scan = (name, url, parent, fit) => afterLoad(() => gltfLoader.load(url, (g) => {
  const m = g.scene; m.traverse((o) => { if (!o.isMesh) return; o.castShadow = o.receiveShadow = true; const mt = o.material;
    if (mt?.transmission > 0) { mt.transmission = 0; mt.transparent = true; mt.opacity = 0.55; mt.roughness = Math.min(mt.roughness, 0.08); mt.depthWrite = false; } });
  loadedModels[name] = m; parent.add(m); m.updateMatrixWorld(true); fit(m); renderer.shadowMap.needsUpdate = true;
}, undefined, (e) => console.warn("scan", name, e)));

// ---------- materials + building blocks ----------
const H = 3.4; // ceiling height (metres)
// Every surface is a standard (PBR) material: satin by default, so the neon and the city catch in it.
// (Still called `toon` from the cartoon days, so the build code stays the same.)
const toon = (color, o = {}) => {
  if (!lite) return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04, ...o });
  const { roughness, metalness, ...rest } = o; // phones: Lambert (one cheap diffuse term per light), shiny metal gets Phong
  return metalness > 0.5 ? new THREE.MeshPhongMaterial({ color, shininess: 50, specular: 0x555a66, ...rest }) : new THREE.MeshLambertMaterial({ color, ...rest });
};
// soft fabric: fully matte, with a fine woven texture you only notice up close
let weaveTex;
const fabricM = (color) => {
  weaveTex ||= (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    x.fillStyle = "#808080"; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 4) { x.fillStyle = "rgba(255,255,255,.18)"; x.fillRect(i, 0, 2, 128); x.fillStyle = "rgba(0,0,0,.16)"; x.fillRect(0, i, 128, 2); }
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.12})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t; })();
  return lite ? new THREE.MeshLambertMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, bumpMap: weaveTex, bumpScale: 0.6 });
};
const glowMat = (color, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
// Foliage (desktop): curved, tapering leaf blades with a midrib crease, waxy and a little see-through
// at the edges of the light. `leafy` fans `n` of them out of a pot at (x, y, z) in `parent`.
// Phones keep the old simple cone leaves.
const bladeGeo = (len, wid, bend) => {
  const g = new THREE.PlaneGeometry(wid, len, 2, 8); g.translate(0, len / 2, 0); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len, x = p.getX(i);
    p.setX(i, x * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (1 - t * 0.35)); // pointed tip, narrow base
    p.setZ(i, bend * t * t * len - Math.abs(x) * 0.35); // arching over, and folded along the midrib
  }
  g.computeVertexNormals(); return g;
};
const leafMats = new Map();
const leafM = (c) => { if (!leafMats.has(c)) leafMats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0, side: THREE.DoubleSide })); return leafMats.get(c); };
const leafy = (parent, x, y, z, { n = 9, len = 0.6, wid = 0.07, bend = 0.5, tilt = 0.35, colors = [0x1f8f5a, 0x2aa56a, 0x17784a], seed = 1 } = {}) => {
  let r = seed * 9301; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const piv = new THREE.Group(); piv.position.set(x, y, z); piv.rotation.y = i * 2.39996 + rnd() * 0.4;
    const l = len * (0.7 + rnd() * 0.5), m = new THREE.Mesh(bladeGeo(l, wid * (0.8 + rnd() * 0.4), bend * (0.6 + rnd() * 0.8)), leafM(colors[i % colors.length]));
    m.rotation.x = tilt * (0.4 + rnd() * 1.1); piv.add(m); parent.add(piv);
  }
};
// the cartoon ink outlines are retired: anything still made with these is simply not drawn
const inkMat = new THREE.MeshBasicMaterial({ visible: false });
const lineMat = new THREE.LineBasicMaterial({ visible: false });

// A rounded block (tighter radii than the cartoon days, so edges read as made, not inflated).
const block = (w, h, d, color, x, y, z, { parent = scene, r = 0.07, mat, ink = false, rot } = {}) => { // mat may be undefined: the plain colour is used
  r = Math.min(r, 0.045);
  const geo = new RoundedBoxGeometry(w, h, d, 3, Math.max(0.004, Math.min(r, Math.min(w, h, d) / 2 - 0.002)));
  const m = new THREE.Mesh(geo, mat || toon(color));
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  if (ink && false) { const o = 0.045, hull = new THREE.Mesh(geo, inkMat); hull.scale.set((w + o) / w, (h + o) / h, (d + o) / d); m.add(hull); }
  parent.add(m);
  return m;
};
// Walls, floors, ceilings: plain boxes with ink edges.
const slab = (w, h, d, color, x, y, z, { parent = scene } = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};
const ball = (r, color, x, y, z, { parent = scene } = {}) => {
  const geo = new THREE.SphereGeometry(r, 18, 14), m = new THREE.Mesh(geo, toon(color));
  m.position.set(x, y, z);
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
let cautionT = null;
const tape = (x, y, z, rotY, w = 1.3) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  if (lite) { block(w, 0.12, 0.02, 0xf9f002, 0, 0.15, 0, { parent: g, rot: [0, 0, 0.32], r: 0.008 });
    block(w, 0.12, 0.02, 0xf9f002, 0, -0.15, 0.01, { parent: g, rot: [0, 0, -0.3], r: 0.008 }); return g; }
  /* desktop: printed vinyl caution tape, hazard stripes and a line of text, lying with a slight ripple */
  cautionT ||= (() => { const t = canvasTex(1024, 96, (x, cw, ch) => { x.fillStyle = "#f2d21b"; x.fillRect(0, 0, cw, ch);
      x.fillStyle = "#111"; for (let i = -2; i < 40; i++) { x.beginPath(); x.moveTo(i * 60, 0); x.lineTo(i * 60 + 28, 0); x.lineTo(i * 60 - 4, ch); x.lineTo(i * 60 - 32, ch); x.fill(); }
      x.fillStyle = "#f2d21b"; x.fillRect(0, 26, cw, 44); x.fillStyle = "#111"; x.font = "700 34px Rajdhani"; x.textBaseline = "middle";
      for (let px = 20; px < cw; px += 360) x.fillText("UNDER CONSTRUCTION · KEEP OUT", px, 49); }); t.wrapS = THREE.RepeatWrapping; return t; })();
  const vinyl = new THREE.MeshStandardMaterial({ map: cautionT, roughness: 0.35, metalness: 0, side: THREE.DoubleSide, roughnessMap: wearTex() });
  for (const [yy, rz, zz] of [[0.15, 0.32, 0], [-0.15, -0.3, 0.004]]) {
    const len = w * 1.05, geo = new THREE.PlaneGeometry(len, 0.075, 40, 1), pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, 0.004 * Math.sin(pp.getX(i) * 22) + 0.006 * Math.sin(pp.getX(i) * 5)); geo.computeVertexNormals(); /* a little ripple: tape never lies dead flat */
    const m = new THREE.Mesh(geo, vinyl); m.position.set(0, yy, zz); m.rotation.z = rz; m.castShadow = true; g.add(m); }
  return g;
};

// Wear: no real surface has an even finish. A shared map of smudges, scuffs and dust breaks up the
// highlights on floors, walls and doors (used as their roughness map; the base roughness still sets the level).
let wearT = null;
const wearTex = () => wearT ||= (() => {
  const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d");
  x.fillStyle = "#e6e6e6"; x.fillRect(0, 0, 512, 512); // mostly the base finish
  let sd = 5; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) { const g = x.createRadialGradient(0, 0, 0, 0, 0, 1); const k = r(); g.addColorStop(0, `rgba(${k < 0.5 ? 255 : 120},${k < 0.5 ? 255 : 120},${k < 0.5 ? 255 : 120},${0.08 + r() * 0.14})`); g.addColorStop(1, "rgba(0,0,0,0)");
    x.save(); x.translate(r() * 512, r() * 512); x.rotate(r() * 6.3); x.scale(30 + r() * 120, 10 + r() * 50); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 1, 0, 6.3); x.fill(); x.restore(); } // smudges and polished patches
  for (let i = 0; i < 400; i++) { x.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.15})`; x.lineWidth = 0.6 + r(); const px = r() * 512, py = r() * 512, a = r() * 6.3, l = 4 + r() * 30; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); } // fine scuffs
  for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.25})`; x.fillRect(r() * 512, r() * 512, 1, 1); } // dust
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.colorSpace = THREE.NoColorSpace; return t;
})();
// ---------- clickable spots ----------
const hot = []; // { obj, room, label, sub, act }
const addHot = (obj, room, label, sub, act) => { obj.userData.hot = hot.length; hot.push({ obj, room, label, sub, act }); };

// ---------- the front hallway (outside the apartment, +z) ----------
let doorPivot, steelTex;
const steelM = (tint) => toon(tint, { map: steelTex, metalness: 0.75, roughness: 0.36 }); // brushed steel, made in buildOutside
const buildOutside = () => {
  // The building's hallway: it runs left and right (x), my door is partway along the near wall,
  // and there are neighbours on both sides and across the hall behind you. It fades out both ways.
  const wallC = 0x2d2160, L = 16, Dp = 5.2; // half its length, and its depth (door wall z = 0, opposite wall z = Dp)
  // Finishes: matte graphite wall panels with fine seams over a darker lower band, a tiled floor,
  // a plain ceiling with recessed light panels. Quiet, so the doors, signs and ads do the talking.
  const wallTex = (len) => { const t = canvasTex(512, 1160, (x, w, h) => {
    x.fillStyle = "#2b3042"; x.fillRect(0, 0, w, h);
    const band = h * (1 - 1.05 / H), head = h * (1 - 2.62 / H); x.fillStyle = "#3a4052"; x.fillRect(0, band, w, h - band); // a lower band of pressed metal, 1.05 m tall
    for (let y = band + 14; y < h - 34; y += 12) { x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, y, w, 2); } // its ribs
    x.fillStyle = "#23273a"; x.fillRect(0, 0, w, head); // a darker frieze above door height
    x.fillStyle = "#151824"; x.fillRect(0, band - 6, w, 10); x.fillRect(0, head - 4, w, 8); x.fillRect(0, 0, 6, h); // the reveals, and the seam between panels
    x.fillStyle = "rgba(255,255,255,.05)"; x.fillRect(8, head + 4, 3, band - head - 12); // a soft highlight on the panel edge
    x.fillStyle = "#5a6178"; for (const [fx, fy] of [[22, head + 18], [w - 22, head + 18], [22, band - 20], [w - 22, band - 20]]) { x.beginPath(); x.arc(fx, fy, 4, 0, Math.PI * 2); x.fill(); } // fasteners
    x.fillStyle = "#14161f"; x.fillRect(0, h - 30, w, 30); // skirting
  }); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 1.5, 1); return t; };
  const finish = (w, h, d, map, x, y, z, color = 0xffffff) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color, { map })); m.position.set(x, y, z); scene.add(m); return m; };
  const floorTex = canvasTex(512, 512, (x, w) => {
    const n = 2, c = w / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 22 + ((i * 7 + j * 3) % 3) * 3; x.fillStyle = `rgb(${v},${v + 2},${v + 9})`; x.fillRect(i * c, j * c, c, c); }
    const gl = x.createLinearGradient(0, 0, w, w); gl.addColorStop(0.3, "rgba(255,255,255,0)"); gl.addColorStop(0.5, "rgba(170,200,255,.07)"); gl.addColorStop(0.7, "rgba(255,255,255,0)"); x.fillStyle = gl; x.fillRect(0, 0, w, w); // a wet sheen
    x.strokeStyle = "#0e0f16"; x.lineWidth = 4; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * c, 0); x.lineTo(i * c, w); x.stroke(); x.beginPath(); x.moveTo(0, i * c); x.lineTo(w, i * c); x.stroke(); }
  }); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set((2 * L) / 1.2, Dp / 1.2);
  finish(2 * L, 0.1, Dp, floorTex, 0, -0.05, Dp / 2).material.roughness = 0.3; // wet-look polished tiles
  slab(2 * L, 0.1, Dp, 0x1c1e28, 0, H + 0.05, Dp / 2);
  finish(2 * L, H, 0.2, wallTex(2 * L), 0, H / 2, Dp + 0.1); // across the hall
  for (const s of [-1, 1]) finish(0.2, H, Dp, wallTex(Dp), s * (L + 0.1), H / 2, Dp / 2);
  // the near wall, with my door's opening in the middle (it's also the living room's front wall)
  finish(L - 0.7, H, 0.2, wallTex(L - 0.7), -(L + 0.7) / 2, H / 2, 0); finish(L - 0.7, H, 0.2, wallTex(L - 0.7), (L + 0.7) / 2, H / 2, 0);
  slab(1.4, H - 2.4, 0.2, 0x353a4c, 0, 2.4 + (H - 2.4) / 2, 0);
  for (const s of [-1, 1]) tube(lite ? 0.04 : 0.02, 2.44, lite ? 0.04 : 0.02, 0x05d9e8, s * 0.74, 1.22, 0.12, { k: 1.3 });
  tube(1.52, lite ? 0.04 : 0.02, lite ? 0.04 : 0.02, 0x05d9e8, 0, 2.44, 0.12, { k: 1.3 });
  if (!lite) { const ch = frostM(0x05d9e8); ch.opacity = 0.45; // the frosted covers of the LED channels, in an aluminium extrusion
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new RoundedBoxGeometry(0.044, 2.44, 0.044, 2, 0.008), ch); m.position.set(s * 0.74, 1.22, 0.12); scene.add(m); block(0.052, 2.44, 0.02, 0, s * 0.74, 1.22, 0.092, { r: 0.003, mat: steelM(0x8a8f9c) }); }
    const t = new THREE.Mesh(new RoundedBoxGeometry(1.52, 0.044, 0.044, 2, 0.008), ch); t.position.set(0, 2.44, 0.12); scene.add(t); block(1.52, 0.052, 0.02, 0, 0, 2.44, 0.092, { r: 0.003, mat: steelM(0x8a8f9c) }); }
  // Doors are pressed steel, not wood: brushed grain, a soft sheen and a couple of factory seams.
  steelTex = canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = "#8e96a8"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) { // brushed grain, running up the door
      const v = Math.random(); x.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.03 + v * 0.05})` : `rgba(0,0,0,${0.04 + v * 0.06})`;
      x.fillRect(Math.random() * w, Math.random() * h * 0.3, 1 + Math.random() * 1.5, h * (0.3 + Math.random() * 0.7));
    }
    const sheen = x.createLinearGradient(0, 0, w, h); sheen.addColorStop(0, "rgba(255,255,255,0)"); sheen.addColorStop(0.45, "rgba(255,255,255,.12)"); sheen.addColorStop(0.6, "rgba(255,255,255,0)");
    x.fillStyle = sheen; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, h * 0.42, w, 3); // a factory seam
    x.fillStyle = "rgba(255,255,255,.12)"; x.fillRect(0, h * 0.42 + 3, w, 1);
  });
  const steel = steelM;
  // ribs and a kick plate: the parts that make a sheet of steel read as a door
  const steelDetail = (g, w, cx, front, tint) => {
    for (let i = 0; i < 3; i++) block(w - 0.3, 0.035, 0.02, 0, cx, 0.5 + i * 0.12, front, { parent: g, r: 0.008, mat: steel(0xc4cad8) });
    block(w - 0.06, 0.2, 0.015, 0x2a2e3a, cx, 0.12, front, { parent: g, r: 0.006, ink: false, mat: lite ? undefined : (() => { const m = steelM(0x3a3f4a); m.roughnessMap = wearTex(); m.roughness = 0.5; return m; })() }); // the kick plate, scuffed
  };
  // my door: a single steel panel that slides straight up into the wall above the opening
  doorPivot = new THREE.Group(); doorPivot.position.set(-0.68, 0, 0); scene.add(doorPivot);
  block(1.36, 2.36, 0.08, 0, 0.68, 1.18, 0, { parent: doorPivot, r: 0.03, mat: steel(0x6c7389) }); // gunmetal, a shade darker so the neon P stands out
  steelDetail(doorPivot, 1.36, 0.68, 0.045, 0x6c7389);
  // a tall pin pad set into the door where a handle would be: a little readout, keys running down, a status light
  const padG = new THREE.Group(); doorPivot.add(padG);
  block(0.17, 0.5, 0.025, 0x101219, 1.2, 1.15, 0.045, { parent: padG, r: 0.012 });
  tube(0.12, 0.035, 0.01, 0x05d9e8, 1.2, 1.35, 0.06, { parent: padG, k: 0.9 });
  for (let i = 0; i < 12; i++) tube(0.028, 0.028, 0.01, 0x05d9e8, 1.155 + (i % 3) * 0.045, 1.28 - Math.floor(i / 3) * 0.055, 0.06, { parent: padG, k: 1.3 });
  keypadLed = tube(0.05, 0.012, 0.01, 0xff3b5c, 1.2, 0.96, 0.06, { parent: padG, k: 2.2 }); // red while locked
  addHot(padG, "outside", "Door keypad", touch ? "Tap to enter the code" : "Click to enter the code", () => go("living"));
  blinkers.push({ m: keypadLed, rate: 0.25, phase: 0 });
  sign("4B", 0.16, 0.68, 2.16, 0.05, { parent: doorPivot, color: "#f9f002", font: "700 100px Rajdhani", k: 1.1 });
  addHot(doorPivot, "outside", "Come on in", touch ? "Tap to open the door" : "Click to open the door", () => go("living"));
  // a neon P on the door itself (it rides up with the door)
  // a bare neon P held on by magnets: it stands just off the steel on little chrome pucks, its shadow on the door behind
  for (const [mx, my] of [[0.56, 1.48], [0.56, 1.84], [0.78, 1.74]]) { // behind the stem and the bowl, so they only catch the light from an angle
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), toon(0xd4d8e2)); puck.rotation.x = Math.PI / 2; puck.position.set(mx, my, 0.06); doorPivot.add(puck);
  }
  const pShadow = sign("P", 1.5, 0.715, 1.625, 0.042, { parent: doorPivot, color: "#05060a", font: "700 260px Rajdhani", k: 1, glow: 0, core: 0 }); pShadow.material.opacity = 0.6;
  sign("P", 1.5, 0.68, 1.66, 0.082, { parent: doorPivot, color: "#ff2a6d", font: "700 260px Rajdhani", k: 1.9, glow: 0.3 }).userData.flicker = true;
  sign("APT 4B · DC", 0.12, -1.15, 1.7, 0.11, { color: "#05d9e8", font: "500 70px 'JetBrains Mono'", k: 1.2 });
  for (const s of [-1, 1]) { block(0.12, 0.34, 0.08, 0x14161f, s * 1.25, 2.1, 0.12, { r: 0.02, mat: lite ? undefined : steelM(0x3a3f4a) }); tube(lite ? 0.05 : 0.03, 0.28, lite ? 0.02 : 0.012, 0x05d9e8, s * 1.25, 2.1, 0.165, { k: 1.1 });
    if (!lite) { const fr = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.3, 0.03, 3, 0.01), frostM(0x05d9e8)); fr.position.set(s * 1.25, 2.1, 0.168); scene.add(fr); } } // sconces: a frosted diffuser over the light
  const lamp = new THREE.PointLight(0x05d9e8, 3.5, 6); lamp.position.set(0, 2.3, 1.4); scene.add(lamp);
  const warm = new THREE.PointLight(0xff2a6d, 2.5, 6); warm.position.set(0, 2.9, 0.8); scene.add(warm);
  block(1.4, 0.03, 0.8, 0x1c1f2a, 0, 0.015, 0.75, { r: 0.012 }); // doormat, rubber
  const mat = sign("WELCOME", 0.24, 0, 0.034, 0.75, { color: "#f9f002", k: 1.05 }); mat.rotation.x = -Math.PI / 2;
  // the neighbours: recessed metal frames, lit number plates and a little status light
  const doorTones = [0x9aa2b4, 0x8f98a6, 0xa3a6b0, 0x939cb0]; // steel tints, a little different from batch to batch
  let nIdx = 0;
  const neighbour = (x, z, back, label) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); if (back) g.rotation.y = Math.PI; scene.add(g);
    block(1.42, 2.5, 0.06, 0x4a5064, 0, 1.25, 0.03, { parent: g, r: 0.02 }); // frame
    const tint = doorTones[nIdx++ % doorTones.length];
    block(1.2, 2.3, 0.08, 0, 0, 1.15, 0.06, { parent: g, r: 0.02, mat: steel(tint) }); // steel, slides up like mine
    steelDetail(g, 1.2, 0, 0.105, tint);
    tube(0.025, 0.42, 0.015, 0xb8c4e0, 0.46, 1.1, 0.105, { parent: g, k: 0.8 }); // a flush light strip, no handle
    block(0.34, 0.15, 0.03, 0x14161f, 0, 2.66, 0.07, { parent: g, r: 0.01 });
    sign(label, 0.11, 0, 2.66, 0.09, { parent: g, color: "#dfe6ff", font: "600 100px 'JetBrains Mono'", k: 1.0, glow: 0.05, core: 0 });
    blinkers.push({ m: tube(0.025, 0.025, 0.02, nIdx % 3 ? 0x2bff88 : 0xff3b5c, -0.46, 1.3, 0.11, { parent: g, k: 2.0 }), rate: 0.05, phase: nIdx }); // occupied / away
    block(1.0, 0.025, 0.55, 0x1e2029, 0, 0.012, 0.42, { parent: g, r: 0.01, ink: false }); // their mat
  };
  neighbour(-5.2, 0.1, false, "4A"); neighbour(5.2, 0.1, false, "4C"); neighbour(10.4, 0.1, false, "4D"); // on the face of my wall, which is 0.1 thick each side of z 0
  neighbour(8.6, Dp, true, "4E"); neighbour(2.8, Dp, true, "4F"); neighbour(-2.6, Dp, true, "4G"); neighbour(-8.4, Dp, true, "4H");
  // the lift at the far end (down to the pizza place)
  const lift = new THREE.Group(); lift.position.set(-10.6, 0, 0); scene.add(lift);
  block(1.9, 2.7, 0.1, 0x3a3d4a, 0, 1.35, 0.05, { parent: lift, r: 0.02 });
  for (const s of [-1, 1]) block(0.8, 2.4, 0.05, 0xb8bcc8, s * 0.41, 1.2, 0.12, { parent: lift, r: 0.01 });
  tube(0.02, 2.4, 0.02, 0x05d9e8, 0, 1.2, 0.15, { parent: lift, k: 1.4 });
  sign("LIFT", 0.2, 0, 2.95, 0.12, { parent: lift, color: "#05d9e8", k: 1.3 });
  block(0.14, 0.26, 0.04, 0x16102e, 1.15, 1.25, 0.06, { parent: lift, r: 0.02 });
  sign("▼", 0.1, 1.15, 1.25, 0.09, { parent: lift, color: "#f9f002", font: "700 90px Rajdhani", k: 1.4 });
  // down the hall: a runner, light strips overhead, glowing baseboards, a couple of lights
  for (let xx = -L + 2; xx < L; xx += 4) { // recessed ceiling panels
    block(1.3, 0.04, 0.7, 0x14161f, xx, H - 0.02, Dp / 2, { ink: false, r: 0.01 });
    tube(1.2, 0.01, 0.6, 0xb8c4e0, xx, H - 0.045, Dp / 2, { k: 0.42 });
  }
  for (const zz of [0.16, Dp - 0.16]) tube(2 * L, 0.02, 0.02, 0x7fb8d8, 0, H - 0.08, zz, { k: 0.55 }); // a quiet cove glow where wall meets ceiling
  // straight pipe runs up by the ceiling, clamped every couple of metres (never sagging)
  for (const zz of [0.2, Dp - 0.2]) for (const [dy, r, c] of [[0.12, 0.035, 0x6c7389], [0.2, 0.022, 0xb36b2c]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * L, lite ? 12 : 28), lite ? steelM(c) : new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: c === 0xb36b2c ? 0.3 : 0.42, map: steelTex, roughnessMap: wearTex() })); pipe.rotation.z = Math.PI / 2; pipe.position.set(0, H - dy, zz + (zz < 1 ? 0.02 : -0.02)); scene.add(pipe); }
  for (let xx = -L + 1; xx < L; xx += 2.2) for (const zz of [0.17, Dp - 0.17]) block(0.04, 0.14, 0.07, 0x1a1d28, xx, H - 0.15, zz, { r: 0.01, ink: false });
  for (const xx of [-8, 0, 8]) { const hl = new THREE.PointLight(0xc8d0ff, 2.4, 9); hl.position.set(xx, 3.0, Dp / 2); hl.userData.shadow = xx === 0 ? 2 : 0; scene.add(hl); if (!lite && xx) { hl.userData.borrow = { c: hl.color.getHex(), i: hl.intensity, d: hl.distance, p: hl.position.clone() }; borrowed.push(hl); } }
};

// the hallway, lived in: windows onto the city at both ends, warm sconces against the cool light,
// neon traced round the neighbours' doors, plants, vents and a utility panel by the lift
const buildHallMore = () => {
  const L = 16, Dp = 5.2;
  const glowT = canvasTex(256, 256, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 6, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const pool = (w, h, color, op, x, y, z, rotX = 0, rotY = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: glowT, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.set(rotX, rotY, 0); m.position.set(x, y, z); m.raycast = () => {}; scene.add(m); return m; };
  // a window at each end of the hall: a tall slot of neon city in the rain, framed in rounded neon
  const cityT = (seed) => canvasTex(512, 900, (x, w, h) => {
    let sd = seed; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const sky = x.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#07051a"); sky.addColorStop(0.6, "#2a0b3d"); sky.addColorStop(1, "#5a1450"); x.fillStyle = sky; x.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 3; layer++) { const shade = ["#140f2e", "#0f0b22", "#08061a"][layer];
      for (let bx = -20; bx < w; bx += 40 + r() * 60) { const bw = 40 + r() * 70 + layer * 20, top = h * (0.12 + r() * 0.4 + layer * 0.12); x.fillStyle = shade; x.fillRect(bx, top, bw, h - top);
        for (let wy = top + 10; wy < h; wy += 14) for (let wx = bx + 6; wx < bx + bw - 6; wx += 10) if (r() < 0.12) { x.fillStyle = r() < 0.7 ? "rgba(255,214,150,.55)" : "rgba(5,217,232,.6)"; x.fillRect(wx, wy, 4, 6); }
        if (r() < 0.35) { const sc = ["#ff2a6d", "#05d9e8", "#f9f002", "#ff6bd5"][Math.floor(r() * 4)]; x.fillStyle = sc; x.shadowColor = sc; x.shadowBlur = 16; x.fillRect(bx + bw * 0.4, top + 20, 8, 80 + r() * 120); x.shadowBlur = 0; } } }
    x.strokeStyle = "rgba(200,220,255,.08)"; x.lineWidth = 1; for (let i = 0; i < 120; i++) { const rx = r() * w, ry = r() * h; x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx - 4, ry + 26); x.stroke(); } // rain on the glass
  });
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * (L - 0.01), 0, Dp / 2); g.rotation.y = -s * Math.PI / 2; scene.add(g);
    panel(2.2, 2.7, cityT(s > 0 ? 11 : 29), 0, 1.65, 0.0, { parent: g, k: 0.95 });
    block(2.36, 0.12, 0.12, 0, 0, 0.27, 0.02, { parent: g, r: 0.02, mat: steelM(0x6c7389) }); // sill
    const curve = new THREE.CurvePath(), rr = 0.25, W = 1.14, Ht = 1.4, cy = 1.65; // a rounded neon frame
    const P = (a, b) => V(a, cy + b, 0.04);
    for (const [a, b, c] of [[P(-W + rr, Ht), P(W - rr, Ht)], [P(W, Ht - rr), P(W, -Ht + rr)], [P(W - rr, -Ht), P(-W + rr, -Ht)], [P(-W, -Ht + rr), P(-W, Ht - rr)]]) curve.add(new THREE.LineCurve3(a, b));
    for (const [cx, cy2, a0] of [[W - rr, Ht - rr, 0], [W - rr, -Ht + rr, -Math.PI / 2], [-W + rr, -Ht + rr, Math.PI], [-W + rr, Ht - rr, Math.PI / 2]]) {
      const pts = []; for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * (Math.PI / 2); pts.push(V(cx + Math.cos(a) * rr, cy + cy2 + Math.sin(a) * rr, 0.04)); } g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.014, 6), glowMat(s > 0 ? 0xff2a6d : 0x05d9e8, 1.4))); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.014, 6), glowMat(s > 0 ? 0xff2a6d : 0x05d9e8, 1.4)));
    pool(3.4, 2.4, s > 0 ? 0xff2a6d : 0x05d9e8, 0.12, s * (L - 1.2), 0.004, Dp / 2, -Math.PI / 2); // the city's colour on the wet floor
    const l = new THREE.PointLight(s > 0 ? 0xff4f8b : 0x3fd8ff, 1.6, 6); l.position.set(s * (L - 0.8), 1.8, Dp / 2); scene.add(l); if (!lite) { l.userData.borrow = { c: l.color.getHex(), i: l.intensity, d: l.distance, p: l.position.clone() }; borrowed.push(l); }
    // a big planter under each window
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 40), lite ? steelM(0x2a2e3a) : new THREE.MeshStandardMaterial({ color: 0x3a3d46, roughness: 0.9 })); pot.position.set(s * (L - 0.5), 0.25, Dp / 2 + 1.5); scene.add(pot);
    if (!lite) { const soil = new THREE.Mesh(new THREE.CircleGeometry(0.25, 40), new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 1 })); soil.rotation.x = -Math.PI / 2; soil.position.set(s * (L - 0.5), 0.501, Dp / 2 + 1.5); scene.add(soil); }
    if (!lite) leafy(scene, s * (L - 0.5), 0.48, Dp / 2 + 1.5, { n: 22, len: 1.15, wid: 0.15, bend: 0.6, tilt: 0.62, seed: s + 3 });
    else for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.9 + (k % 3) * 0.2, 5), toon(k % 2 ? 0x2f8f4e : 0x3fae5e)); leaf.position.set(s * (L - 0.5) + Math.cos(a) * 0.1, 0.9, Dp / 2 + 1.5 + Math.sin(a) * 0.1); leaf.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); scene.add(leaf); }
  }
  // warm amber sconces between the doors, each washing its bit of wall
  for (const [x, back] of [[-4.0, false], [3.9, false], [-4.05, true], [1.55, true], [4.25, true]]) {
    const z = back ? Dp - 0.11 : 0.11, f = back ? -1 : 1;
    block(0.1, 0.42, 0.04, 0, x, 2.05, z + f * 0.01, { mat: steelM(0x9aa2b4), r: 0.01, ink: false });
    tube(lite ? 0.045 : 0.028, lite ? 0.32 : 0.3, lite ? 0.03 : 0.014, 0xffa040, x, 2.05, z + f * 0.035, { k: 1.25 });
    if (!lite) { const fr = new THREE.Mesh(new RoundedBoxGeometry(0.056, 0.34, 0.036, 3, 0.012), frostM(0xffa040)); fr.position.set(x, 2.05, z + f * 0.037); scene.add(fr); } // its frosted diffuser
    pool(1.2, 1.6, 0xffa040, 0.22, x, 2.0, z + f * 0.002, 0, back ? Math.PI : 0);
    pool(0.9, 0.7, 0xffa040, 0.06, x, 0.004, z + f * 0.5, -Math.PI / 2);
  }
  for (const [x, z] of [[-4, 1.0], [4.1, Dp - 1.0]]) { const l = new THREE.PointLight(0xffa040, 1.4, 4.5); l.position.set(x, 2.1, z); scene.add(l); }
  // neon traced round each neighbour's door frame (a thin line, not a glow)
  for (const [x, back] of [[-5.2, false], [5.2, false], [10.4, false], [8.6, true], [2.8, true], [-2.6, true], [-8.4, true]]) {
    const z = back ? Dp - 0.075 : 0.075 + 0.1, c = back ? 0xff2a6d : 0x7ff6ff;
    for (const sx of [-1, 1]) tube(lite ? 0.016 : 0.009, 2.5, lite ? 0.016 : 0.009, c, x + sx * 0.73, 1.25, z, { k: 0.75 });
    tube(1.48, lite ? 0.016 : 0.009, lite ? 0.016 : 0.009, c, x, 2.51, z, { k: 0.75 });
    if (!lite) { const gm = frostM(c); gm.opacity = 0.42; // the glass tube round each run
      for (const sx of [-1, 1]) { const g1 = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 2.5, 12), gm); g1.position.set(x + sx * 0.73, 1.25, z); scene.add(g1); }
      const g2 = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.5, 12), gm); g2.rotation.z = Math.PI / 2; g2.position.set(x, 2.51, z); scene.add(g2);
      for (const sx of [-1, 1]) { const el = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), gm); el.position.set(x + sx * 0.73, 2.51, z); scene.add(el); } } // and the bends at the corners
  }
  // a reflection of my door's neon on the floor in front of it
  pool(1.9, 1.2, 0x05d9e8, 0.1, 0, 0.034, 1.3, -Math.PI / 2); pool(0.9, 0.6, 0xff2a6d, 0.12, 0, 0.036, 0.6, -Math.PI / 2);
  // a planter by my door
  { const box = block(0.7, 0.42, 0.3, 0, 2.6, 0.21, 0.3, { r: 0.02, mat: steelM(0x6c7389) });
    if (!lite) { const soil = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 1 })); soil.rotation.x = -Math.PI / 2; soil.position.set(2.6, 0.421, 0.3); scene.add(soil); }
    if (!lite) for (let k = 0; k < 4; k++) leafy(scene, 2.4 + k * 0.13, 0.4, 0.3, { n: 10, len: 0.4, wid: 0.075, bend: 0.9, tilt: 0.75, seed: k + 11, colors: [0x2f8f4e, 0x3fae5e, 0x24733f] });
    else for (let k = 0; k < 7; k++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), toon(k % 2 ? 0x2f8f4e : 0x3fae5e)); leaf.scale.set(1, 0.6 + (k % 3) * 0.25, 1); leaf.position.set(2.36 + k * 0.08, 0.5 + (k % 2) * 0.08, 0.3 + ((k % 3) - 1) * 0.05); scene.add(leaf); }
    tube(0.6, 0.012, 0.012, 0xb48cff, 2.6, 0.43, 0.46, { k: 0.6 }); }
  // low vents along both walls
  for (const [x, back] of [[-1.6, false], [7.0, false], [-12.6, true], [6.9, true], [13.8, false]]) {
    const z = back ? Dp - 0.12 : 0.12; const v = block(0.5, 0.18, 0.02, 0x181a24, x, 0.3, z, { r: 0.01, ink: false });
    for (let k = 0; k < 4; k++) block(0.44, 0.012, 0.01, 0x0b0c12, x, 0.24 + k * 0.04, z + (back ? -0.012 : 0.012), { ink: false, r: 0.002 });
  }
  // a utility panel by the lift: breaker readouts, status lights and a warning label
  { const ux = -12.25, z = 0.13; block(0.52, 0.8, 0.06, 0x1c1f2a, ux, 1.45, z, { r: 0.02 });
    for (let k = 0; k < 6; k++) blinkers.push({ m: tube(0.02, 0.02, 0.01, k % 4 ? 0x2bff88 : 0xf9f002, ux - 0.15 + (k % 3) * 0.15, 1.7 - Math.floor(k / 3) * 0.1, z + 0.035, { k: 2 }), rate: 0.3 + k * 0.4, phase: k });
    panel(0.42, 0.14, canvasTex(420, 140, (x, w, h) => { x.fillStyle = "#f9f002"; x.fillRect(0, 0, w, h); x.fillStyle = "#14161f"; for (let i = -2; i < 12; i++) { x.beginPath(); x.moveTo(i * 40, 0); x.lineTo(i * 40 + 20, 0); x.lineTo(i * 40 + 60, h); x.lineTo(i * 40 + 40, h); x.fill(); }
      x.fillStyle = "#f9f002"; x.fillRect(40, 30, w - 80, h - 60); x.fillStyle = "#14161f"; x.font = "700 46px Rajdhani"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("⚡ HV · 480V", w / 2, h / 2 + 2); }), ux, 1.2, z + 0.035, { k: 0.85 });
    sign("UTIL 4", 0.06, ux, 1.78, z + 0.035, { color: "#9d9dc0", font: "500 70px 'JetBrains Mono'", k: 1, glow: 0, core: 0 }); }
};
// ---------- the living room (z 0 … -7) ----------
let windowTex, windowCanvas, windowGlass, mullion;
// frosted glass over a light source (desktop): the diffuser of a real fitting
const frostM = (c) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.5, emissive: new THREE.Color(c), emissiveIntensity: 0.5, depthWrite: false });
// ---------- leather upholstery (desktop): shared by the lounge set and the theater ----------
  // Desktop: the set the reference shows. Glossy white leather with real stitched seams and a fine grain,
// cushions that bulge between their pleats, recessed grooves machined into the hard shell, one cyan LED
// strip under the seat, and black end-caps on the arms. The leather carries a bump map painted here
// (grain, seams, pleats), so the highlights break the way leather does.
const leatherTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#808080"; x.fillRect(0, 0, w, h);
  let sd = 9; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h / 30; i++) { const k = r() < 0.5 ? 0 : 255; x.fillStyle = `rgba(${k},${k},${k},${0.12 + r() * 0.2})`; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } // grain
  draw(x, w, h, r); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t; };
const seam = (x, ax, ay, bx, by) => { x.strokeStyle = "rgba(0,0,0,.85)"; x.lineWidth = 4; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 1.5; x.setLineDash([4, 5]); x.beginPath(); x.moveTo(ax, ay + 2); x.lineTo(bx, by + 2); x.stroke(); x.setLineDash([]); }; // a stitched seam: a groove with the thread catching light
const cushBump = (n) => leatherTex(512, 256, (x, w, h) => { // a cushion in n panels: a pleat at each panel line, a stitched seam round the edge
  for (let i = 1; i < n; i++) { const px = (w / n) * i; const g = x.createLinearGradient(px - 22, 0, px + 22, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(0,0,0,.75)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(px - 22, 0, 44, h); seam(x, px, 14, px, h - 14); }
  seam(x, 14, 14, w - 14, 14); seam(x, 14, h - 14, w - 14, h - 14); seam(x, 14, 14, 14, h - 14); seam(x, w - 14, 14, w - 14, h - 14); });
const seatBump = cushBump(3), backBump = cushBump(2);
const shellBump = leatherTex(512, 512, (x, w, h) => { seam(x, 0, h * 0.5, w, h * 0.5); seam(x, 0, h * 0.5 + 10, w, h * 0.5 + 10); }); // the frame: grain, a double stitched seam
const plainBump = leatherTex(256, 256, () => {});
const leather = (tint, bump, rough = 0.3, scale = 0.9) => new THREE.MeshStandardMaterial({ color: tint, roughness: rough, metalness: 0.02, bumpMap: bump, bumpScale: scale, roughnessMap: wearTex() });
// a cushion that bulges: a box rounded hard, its top and sides pushed out between the pleats
const pillow = (w, h, d, n, bump) => {
  const geo = new RoundedBoxGeometry(w, h, d, 10, Math.min(h, d) * 0.42), p = geo.attributes.position, nrm = geo.attributes.normal, v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); q.fromBufferAttribute(nrm, i);
    const u = Math.min(1, Math.max(0, v.x / w + 0.5)), t = Math.max(0, v.y / (h / 2)); // t: 1 on the top face
    const f = u * n - Math.floor(u * n), dist = Math.abs(u * n - Math.round(u * n)); // where we are in the panel, and how near a panel line
    const crease = u > 0.03 && u < 0.97 ? Math.exp(-((dist * 6) ** 2)) : 0;
    const puff = Math.max(0, 1 - Math.pow(2 * Math.abs(u - 0.5), 1.6)); // fullest in the middle of the cushion
    v.addScaledVector(q, h * (0.14 * Math.pow(puff, 0.7) * (0.25 + 0.75 * t) + 0.04 * Math.sin(f * Math.PI) * t - 0.06 * crease * t)); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); const m = new THREE.Mesh(geo, bump); m.castShadow = m.receiveShadow = true; return m; };

/* ---------- the two side rooms, desktop only: the Music room and the Closet ----------
   Each sits behind a steel door that slides into the wall. A room is hidden (no draw calls, no shadows) until you
   walk in, and borrows the hallway's far lights while you're there, so the number of lights, and with it the cost of
   every shader in the apartment, stays exactly as it was. */
const SIDE = {
  music: { rig: [[0xffb878, 10, 9, 5.5, 2.6, -10.0], [0xff4f8b, 4.5, 7, 7.0, 2.2, -10.8], [0x4fd8ff, 4, 7, 4.0, 2.2, -10.0], [0xffd2a0, 7, 6, 5.5, 2.3, -12.0]] },
  closet: { rig: [[0xfff0dc, 3.2, 6, -8.1, 2.9, -3.9], [0xffe2c0, 2.4, 6, -9.2, 2.7, -2.0], [0x9a7bff, 1.2, 5, -7.0, 2.6, -1.0], [0xfff6e8, 1.6, 7, -8.0, 3.0, -1.6]] },
};
const borrowed = [];
const sideShow = (key) => { if (lite) return;
  for (const k in SIDE) if (SIDE[k].group) SIDE[k].group.visible = k === key;
  const rig = key && SIDE[key].rig;
  borrowed.forEach((l, i) => { const h = l.userData.borrow, r = rig?.[i];
    if (r) { l.color.setHex(r[0]); l.intensity = r[1]; l.distance = r[2]; l.position.set(r[3], r[4], r[5]); }
    else { l.color.setHex(h.c); l.intensity = h.i; l.distance = h.d; l.position.copy(h.p); } }); };
const sideActive = () => { for (const k in SIDE) if (SIDE[k].group?.visible) return k; return null; };
let sideT = 0;
/* the door: frames it in neon, slides along the wall (hidden inside its thickness) */
const sideDoor = (key, name, x, z, rotY, slide, color, sub, inPos, inRot) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  const d = block(1.38, 2.38, 0.07, 0, 0, 1.19, 0, { parent: g, r: 0.02, mat: steelM(0x5c6378) });
  const kick = steelM(0x3a3f4a); kick.roughnessMap = wearTex(); kick.roughness = 0.5;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) block(1.06, 0.035, 0.012, 0, 0, 0.5 + i * 0.12, s * 0.04, { parent: g, r: 0.005, mat: steelM(0xc4cad8) });
    block(1.3, 0.2, 0.01, 0, 0, 0.12, s * 0.04, { parent: g, r: 0.004, mat: kick }); }
  const n = V(Math.sin(rotY), 0, Math.cos(rotY)), t = V(Math.cos(rotY), 0, -Math.sin(rotY)), f = V(x, 0, z).addScaledVector(n, 0.12);
  /* a neon frame on the living room's side, and the room's name above it */
  const glowT = (w, h, along, y) => { const off = f.clone().addScaledVector(t, along); return Math.abs(n.x) > 0.5 ? tube(0.04, h, w, color, off.x, y, off.z, { k: 1.2 }) : tube(w, h, 0.04, color, off.x, y, off.z, { k: 1.2 }); };
  for (const s of [-1, 1]) glowT(0.04, 2.44, s * 0.72, 1.22); glowT(1.48, 0.04, 0, 2.44);
  const label = sign(name, 0.3, f.x, 2.8, f.z, { color: "#b98cff", rotY, k: 1.3 });
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.5), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(f.x, 1.25, f.z); hit.rotation.y = rotY; scene.add(hit);
  addHot(hit, "living", name.charAt(0) + name.slice(1).toLowerCase(), sub, () => go(key)); hit.userData.glow = [label]; hit.userData.fromCat = true;
  Object.assign(SIDE[key], { door: g, base: g.position.clone(), slide: V(...slide), open: 0, to: 0 });
  const out = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.5), new THREE.MeshBasicMaterial({ visible: false })); out.position.set(inPos[0], 1.25, inPos[1]); out.rotation.y = inRot; scene.add(out);
  addHot(out, key, "Living room", touch ? "Tap to head back" : "Click to head back", () => go("living"));
};
const sideGroup = (key, build) => { const n = scene.children.length; build(); const g = new THREE.Group(); for (const o of scene.children.slice(n)) g.add(o); scene.add(g); g.visible = false; SIDE[key].group = g; };
const std = (color, roughness = 0.6, metalness = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });
const boxWall = (tex, w, h, d, x, y, z, len) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(0xffffff, { map: tex(len) })); m.position.set(x, y, z); scene.add(m); return m; };
const panelTex = (base, seam, band) => (len) => { const t = canvasTex(512, 1160, (x, w, h) => { x.fillStyle = base; x.fillRect(0, 0, w, h); x.fillStyle = seam; x.fillRect(0, 0, 3, h); for (const yy of [h * 0.3, h * 0.66]) x.fillRect(0, yy, w, 2);
    let sd = 11; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); for (let i = 0; i < 2400; i++) { x.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${r() * 0.03})`; x.fillRect(r() * w, r() * h, 2, 2); }
    x.fillStyle = band; x.fillRect(0, h - 28, w, 28); }); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 1.4, 1); return t; };
const stoneFloor = (sx, sz, base) => { const t = canvasTex(512, 512, (x, w) => { x.fillStyle = base; x.fillRect(0, 0, w, w); let sd = 3; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${0.012 + r() * 0.025})`; x.fillRect(r() * w, r() * w, 1 + r() * 4, 1 + r() * 4); } x.fillStyle = "rgba(0,0,0,.45)"; x.fillRect(0, 0, w, 3); x.fillRect(0, 0, 3, w); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(sx / 1.4, sz / 1.4); return t; };
const flatRug = (w, d, x, z, draw, bump = 3) => { const t = canvasTex(1024, Math.round((1024 * d) / w), draw), b = softTex(noise(51, 0.6, 30, 230, 1), 20, 14);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(0xffffff, 1, 0, { map: t, bumpMap: b, bumpScale: bump })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.014, z); m.receiveShadow = true; scene.add(m); return m; };

/* ---- what's in the closet: each piece from content.js, drawn as a hanging garment ----
   Painted on a canvas (the alpha is its silhouette), then the sheet is bulged and rippled so light falls across the
   folds. The prints are cut from the real product photos. */
const GARB = [
  [/manners-hoodie/, { kind: "hoodie", c: "#1b1b20", edge: "#0d0d11", print: ["images/house/closet-pubkey-manners-hoodie-studio.webp", 0.41, 0.46, 0.18, 0.12, "lighten", 0.42] }],
  [/you-lose/, { kind: "long", c: "#e6e5e0", edge: "#bdbcb6", print: ["images/house/closet-pubkey-you-lose-tee-studio.webp", 0.375, 0.27, 0.25, 0.53, "multiply", 0.3] }],
  [/lived-in/, { kind: "tee", c: "#efeeea", edge: "#c6c5bf" }],
  [/rustico/, { kind: "jacket", c: "#26365a", edge: "#141d33" }],
  [/seafarer/, { kind: "knit", c: "#2a3a58", edge: "#172238" }],
];
const garment = (fit) => { const o = GARB.find(([re]) => re.test(fit.src))?.[1] || { kind: "tee", c: "#8a8d99", edge: "#5c5e68" }, W = 512, H0 = 768;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H0; const x = cv.getContext("2d"); let sd = 17; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const short = o.kind === "tee", broad = o.kind === "jacket" ? 8 : 0, hem = o.kind === "jacket" ? 668 : short ? 610 : 640;
  const shape = () => { x.beginPath(); x.moveTo(206, 66); x.quadraticCurveTo(150, 84, 106 - broad, 128);
    if (short) { x.lineTo(84, 268); x.quadraticCurveTo(116, 288, 146, 276); x.lineTo(156, 232); }
    else { x.bezierCurveTo(78 - broad, 280, 62 - broad, 440, 60 - broad, 590); x.quadraticCurveTo(90, 608, 122, 594); x.bezierCurveTo(128, 450, 146, 330, 156, 240); }
    x.lineTo(150, hem); x.quadraticCurveTo(256, hem + 12, 362, hem); x.lineTo(356, 240);
    if (short) { x.lineTo(366, 276); x.quadraticCurveTo(396, 288, 428, 268); x.lineTo(406 + broad, 128); }
    else { x.bezierCurveTo(366, 330, 384, 450, 390, 594); x.quadraticCurveTo(422, 608, 452 + broad, 590); x.bezierCurveTo(450 + broad, 440, 434 + broad, 280, 406 + broad, 128); }
    x.quadraticCurveTo(362, 84, 306, 66); x.quadraticCurveTo(256, 96, 206, 66); x.closePath(); };
  const paint = () => { x.clearRect(0, 0, W, H0);
    if (o.kind === "hoodie") { x.fillStyle = "#101014"; x.beginPath(); x.ellipse(256, 74, 86, 54, 0, 0, 6.3); x.fill(); } /* the hood, fallen behind the neck */
    x.save(); shape(); x.fillStyle = o.c; x.fill(); x.clip();
    /* weave or knit, the part a bump map catches */
    if (o.kind === "knit") { for (let i = 0; i < W; i += 7) { x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(i, 0, 3, H0); x.fillStyle = "rgba(0,0,0,.22)"; x.fillRect(i + 4, 0, 2, H0); } }
    else if (o.kind === "jacket") { for (let i = 0; i < 9000; i++) { x.fillStyle = r() < 0.5 ? "rgba(120,150,210,.05)" : "rgba(0,0,0,.08)"; x.fillRect(r() * W, r() * H0, 2, 1); } }
    else for (let i = 0; i < 7000; i++) { x.fillStyle = r() < 0.5 ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.035)"; x.fillRect(r() * W, r() * H0, 1, 2); }
    /* soft shade down the sides, and the drape hanging from the shoulders */
    const g = x.createLinearGradient(150, 0, 362, 0); g.addColorStop(0, "rgba(0,0,0,.2)"); g.addColorStop(0.22, "rgba(0,0,0,0)"); g.addColorStop(0.78, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.2)"); x.fillStyle = g; x.fillRect(150, 0, 212, H0);
    x.filter = "blur(6px)"; x.lineCap = "round"; for (let i = 0; i < 12; i++) { const px = 170 + r() * 172, top = 150 + r() * 140; x.strokeStyle = r() < 0.55 ? "rgba(0,0,0,.1)" : "rgba(255,255,255,.05)"; x.lineWidth = 5 + r() * 10; x.beginPath(); x.moveTo(px, top); x.bezierCurveTo(px + (r() - 0.5) * 30, top + 120, px + (r() - 0.5) * 40, top + 240, px + (r() - 0.5) * 24, hem); x.stroke(); } x.filter = "none";
    /* where the sleeves lie against the body */
    if (!short) { x.strokeStyle = "rgba(0,0,0,.5)"; x.lineWidth = 3; x.beginPath(); x.moveTo(156, 236); x.lineTo(152, hem); x.moveTo(356, 236); x.lineTo(360, hem); x.stroke(); }
    x.strokeStyle = "rgba(0,0,0,.28)"; x.lineWidth = 2; x.beginPath(); x.moveTo(114, 134); x.quadraticCurveTo(150, 190, 156, 240); x.moveTo(398, 134); x.quadraticCurveTo(362, 190, 356, 240); x.stroke();
    const rib = (y0, y1, x0, x1) => { x.fillStyle = "rgba(0,0,0,.14)"; x.fillRect(x0, y0, x1 - x0, y1 - y0); x.fillStyle = "rgba(255,255,255,.07)"; for (let i = x0; i < x1; i += 5) x.fillRect(i, y0, 2, y1 - y0); x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(x0, y0, x1 - x0, 2); };
    if (o.kind === "knit" || o.kind === "hoodie") { rib(hem - 40, hem + 12, 140, 372); rib(556, 612, 50, 130); rib(556, 612, 382, 462); }
    if (o.kind === "long") { rib(hem - 8, hem + 12, 140, 372); rib(570, 612, 50, 130); rib(570, 612, 382, 462); }
    if (short) { x.strokeStyle = "rgba(0,0,0,.16)"; x.lineWidth = 2; x.beginPath(); x.moveTo(150, hem - 14); x.lineTo(362, hem - 14); x.moveTo(86, 256); x.quadraticCurveTo(116, 274, 146, 262); x.moveTo(366, 262); x.quadraticCurveTo(396, 274, 426, 256); x.stroke(); }
    if (o.kind === "hoodie") { x.fillStyle = "rgba(255,255,255,.04)"; x.strokeStyle = "rgba(0,0,0,.65)"; x.lineWidth = 3; x.beginPath(); x.moveTo(176, 590); x.lineTo(196, 470); x.lineTo(316, 470); x.lineTo(336, 590); x.closePath(); x.fill(); x.stroke();
      x.strokeStyle = "#d8d8dc"; x.lineWidth = 4; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(256 + s * 22, 96); x.bezierCurveTo(256 + s * 24, 150, 256 + s * 16, 180, 256 + s * 20, 216); x.stroke(); } }
    if (o.kind === "jacket") { /* lapels over a dark shirt front, two buttons, pocket flaps */
      x.fillStyle = "#c9d3e6"; x.beginPath(); x.moveTo(218, 64); x.lineTo(294, 64); x.lineTo(262, 330); x.lineTo(250, 330); x.closePath(); x.fill();
      x.fillStyle = "#1d2a4a"; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(256 + s * 42, 62); x.lineTo(256 + s * 92, 192); x.lineTo(256 + s * 66, 214); x.lineTo(256 + s * 4, 372); x.lineTo(256 + s * 2, 330); x.closePath(); x.fill(); x.strokeStyle = "rgba(0,0,0,.6)"; x.lineWidth = 2; x.stroke(); }
      x.strokeStyle = "rgba(0,0,0,.55)"; x.lineWidth = 3; x.beginPath(); x.moveTo(256, 372); x.quadraticCurveTo(262, 520, 300, hem); x.stroke();
      x.fillStyle = "#0e1424"; for (const y of [392, 452]) { x.beginPath(); x.arc(264, y, 8, 0, 6.3); x.fill(); }
      x.strokeStyle = "rgba(0,0,0,.5)"; x.lineWidth = 3; for (const [a, b, c] of [[172, 236, 500], [290, 346, 500], [302, 344, 248]]) { x.beginPath(); x.moveTo(a, c); x.lineTo(b, c - 2); x.stroke(); } }
    /* the neck: a shadowed opening with a ribbed collar */
    x.restore(); if (o.kind !== "jacket") { x.strokeStyle = o.edge; x.lineWidth = 14; x.beginPath(); x.moveTo(206, 66); x.quadraticCurveTo(256, 102, 306, 66); x.stroke(); x.fillStyle = "#08080b"; x.beginPath(); x.moveTo(214, 62); x.quadraticCurveTo(256, 90, 298, 62); x.quadraticCurveTo(256, 50, 214, 62); x.fill(); } };
  paint();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (o.print) { const [src, u, v, uw, vh, mode, wid] = o.print, im = new Image(); im.onload = () => { const sw = uw * im.width, sh = vh * im.height, dw = W * wid, dh = (dw * sh) / sw; const pc = document.createElement("canvas"); pc.width = Math.round(sw); pc.height = Math.round(sh); const px = pc.getContext("2d"); px.drawImage(im, u * im.width, v * im.height, sw, sh, 0, 0, pc.width, pc.height);
      /* lift just the ink off the photo: the coloured print from the pale tee, the white letters from the black hoodie */
      const dt = px.getImageData(0, 0, pc.width, pc.height), a = dt.data; for (let i = 0; i < a.length; i += 4) { const mx = Math.max(a[i], a[i + 1], a[i + 2]), mn = Math.min(a[i], a[i + 1], a[i + 2]); a[i + 3] = mode === "lighten" ? Math.min(255, Math.max(0, (mx - 90) * 2.2)) : Math.min(255, Math.max(0, (mx - mn - 14) * 3.2)); } px.putImageData(dt, 0, 0);
      x.save(); shape(); x.clip(); x.drawImage(pc, 256 - dw / 2, o.kind === "hoodie" ? 240 : 158, dw, dh); x.restore(); t.needsUpdate = true; }; im.src = src; }
  const G = new THREE.PlaneGeometry(0.74, 0.88, 28, 40), p = G.attributes.position, sw = o.kind === "jacket" ? 0.055 : 0.04;
  for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), u = px / 0.36, k = Math.max(0, 1 - u * u);
    p.setZ(i, sw * 1.15 * Math.pow(k, 0.6) * (0.8 + 0.2 * Math.sin(py * 3)) + 0.006 * Math.sin(px * 34 + py * 5) + 0.004 * Math.sin(px * 61 - py * 9) * (0.44 - py)); }
  G.computeVertexNormals();
  const M = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: o.kind === "knit" ? 2.5 : 1, roughness: o.kind === "jacket" ? 0.72 : 0.92, alphaTest: 0.5, side: THREE.DoubleSide });
  const m = new THREE.Mesh(G, M); m.castShadow = true; return m; };
const hanger = (parent) => { const steel = steelM(0xb8bfcc), hook = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0035, 8, 24, Math.PI * 1.4), steel); hook.position.set(0, 0.075, 0); hook.rotation.z = -0.3; parent.add(hook);
  const pts = [[-0.19, -0.03], [-0.06, 0.03], [0, 0.05], [0.06, 0.03], [0.19, -0.03]].map(([a, b]) => V(a, b, 0)), bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.006, 8), steel); parent.add(bar); };
const stack = (x, y, z, n, w, d, c) => { for (let i = 0; i < n; i++) { const b = block(w, 0.045, d, 0, x + (i % 2 ? 0.004 : -0.004), y + 0.024 + i * 0.047, z, { r: 0.02, mat: fabricM(c) }); b.rotation.y = (i % 3 - 1) * 0.012; } };

const buildCloset = () => {
  const X0 = -10.4, X1 = -6.1, Z0 = -0.25, Z1 = -5.25, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2, fits = (S.fits || []).filter((f) => f.src).slice(0, 5);
  const tex = panelTex("#20222e", "#151620", "#101118");
  { const f = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0 + 0.1, 0.1, Z0 - Z1 + 0.2), toon(0xffffff, { map: stoneFloor(4.4, 5.2, "#17181f"), roughness: 0.34 })); f.position.set(CX + 0.05, -0.05, CZ); scene.add(f); }
  slab(X1 - X0 + 0.1, 0.1, Z0 - Z1 + 0.2, 0x0d0e14, CX + 0.05, H + 0.05, CZ);
  boxWall(tex, X1 - X0, H, 0.1, CX, H / 2, Z0 + 0.05, X1 - X0); boxWall(tex, X1 - X0, H, 0.1, CX, H / 2, Z1 - 0.05, X1 - X0); boxWall(tex, 0.1, H, Z0 - Z1, X0 - 0.05, H / 2, CZ, Z0 - Z1);
  /* the door wall, seen from in here */
  boxWall(tex, 0.06, H, 0.95, -6.13, H / 2, -0.725, 0.95); boxWall(tex, 0.06, H, 2.65, -6.13, H / 2, -3.925, 2.65); slab(0.06, H - 2.4, 1.4, 0x20222e, -6.13, 2.4 + (H - 2.4) / 2, -1.9);
  /* cove light all round, warm */
  for (const z of [Z0 - 0.02, Z1 + 0.02]) tube(X1 - X0, 0.025, 0.025, 0xffb066, CX, H - 0.07, z, { k: 0.9 });
  for (const x of [X0 + 0.02, X1 - 0.05]) tube(0.025, 0.025, Z0 - Z1, 0xb98cff, x, H - 0.07, CZ, { k: 0.85 });
  flatRug(2.7, 3.4, CX - 0.2, CZ, (x, w, h) => { x.fillStyle = "#3a3c48"; x.fillRect(0, 0, w, h); x.strokeStyle = "#5c5f70"; x.lineWidth = 10; x.strokeRect(34, 34, w - 68, h - 68); x.strokeStyle = "#2a2c36"; x.lineWidth = 3; x.strokeRect(54, 54, w - 108, h - 108); });

  /* the back wall: five lit bays, each piece hanging face-out over steel drawers */
  const carbon = std(0x101116, 0.32, 0.2, { roughnessMap: wearTex() });
  block(X1 - X0 - 0.1, 0.72, 0.46, 0, CX, 0.36, Z1 + 0.23, { r: 0.012, mat: steelM(0x3c414e) });
  block(X1 - X0 - 0.1, 0.03, 0.5, 0, CX, 0.735, Z1 + 0.25, { r: 0.01, mat: carbon }); tube(X1 - X0 - 0.2, 0.012, 0.012, 0xffc98a, CX, 0.712, Z1 + 0.49, { k: 1.05 });
  for (let i = 0; i < 5; i++) { const bx = -9.6 + i * 0.75; for (const y of [0.2, 0.52]) { block(0.68, 0.28, 0.012, 0, bx, y, Z1 + 0.466, { r: 0.004, mat: steelM(0x565c6b) }); block(0.3, 0.012, 0.018, 0, bx, y + 0.1, Z1 + 0.478, { r: 0.004, mat: steelM(0xc4cad8) }); } }
  block(X1 - X0 - 0.1, 0.03, 0.46, 0, CX, 2.66, Z1 + 0.23, { r: 0.01, mat: carbon }); tube(X1 - X0 - 0.2, 0.012, 0.012, 0xffd9a8, CX, 2.636, Z1 + 0.42, { k: 1.25 });
  for (let i = 0; i <= 5; i++) block(0.025, 1.92, 0.44, 0, -9.975 + i * 0.75, 1.71, Z1 + 0.22, { r: 0.006, mat: steelM(0x4a5060) });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, X1 - X0 - 0.2, 16), steelM(0xd2d8e2)); rail.rotation.z = Math.PI / 2; rail.position.set(CX, 2.42, Z1 + 0.24); scene.add(rail);
  /* a warm wash down each bay's back panel */
  const washT = canvasTex(64, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,206,158,.3)"); g.addColorStop(0.55, "rgba(255,180,120,.08)"); g.addColorStop(1, "rgba(255,180,120,.015)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  for (let i = 0; i < 5; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.9), new THREE.MeshBasicMaterial({ map: washT, transparent: true, depthWrite: false, toneMapped: false })); w.position.set(-9.6 + i * 0.75, 1.7, Z1 + 0.012); scene.add(w); }
  /* storage up top: labelled steel bins */
  ["KNITS", "DENIM", "TEES", "BELTS", "SHOES"].forEach((t, i) => { const bx = -9.6 + i * 0.75; block(0.6, 0.34, 0.36, 0, bx, 2.85, Z1 + 0.22, { r: 0.012, mat: steelM(0x2f333e) });
    panel(0.3, 0.09, canvasTex(192, 58, (x, w, h) => { x.fillStyle = "#e8e6dc"; x.fillRect(0, 0, w, h); x.fillStyle = "#14141c"; x.font = "700 38px Rajdhani"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(t, w / 2, h / 2 + 2); }), bx, 2.85, Z1 + 0.402, { k: 0.8 }); });
  const stepTo = (obj, name, fit, pos, look) => { const open = () => fit.link && window.open(fit.link, "_blank", "noopener");
    if (spot?.g === obj) return open();
    openSpot(obj, name, { pos, look }, { hint: `${tapWord} it again for the product page · ${tapWord.toLowerCase()} away to step back`, self: true, only: (o) => o === obj, hover: (h) => (h?.obj === obj ? { label: fit.item, sub: `${fit.brand} · ${tapWord} for the product page` } : null), click: (h) => (h?.obj === obj ? open() : closeSpot()) }); };
  fits.forEach((fit, i) => { const bx = -9.6 + i * 0.75, g = new THREE.Group(); g.position.set(bx, 2.36, Z1 + 0.24); scene.add(g); hanger(g);
    const m = garment(fit); m.position.y = -0.37; g.add(m);
    addHot(g, "closet", fit.item, `${fit.brand}${fit.tag ? " · " + fit.tag : ""}`, () => stepTo(g, fit.item, fit, V(bx, 1.8, Z1 + 1.55), V(bx, 1.82, Z1 + 0.2))); });
  /* the far wall: the same pieces as lit product cards */
  const fmt = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }).toUpperCase() : "");
  fits.forEach((fit, i) => { const z = -0.95 - i * 0.84, g = new THREE.Group(); g.position.set(X0 + 0.02, 0, z); g.rotation.y = Math.PI / 2; scene.add(g);
    block(0.68, 1.14, 0.05, 0, 0, 1.56, 0.01, { parent: g, r: 0.012, mat: steelM(0x3a3f4c) });
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.74, 0.74, 0.72), toneMapped: false })); pic.position.set(0, 1.67, 0.04); g.add(pic);
    const src = wallSrc(fit.src); loader.load(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; const im = t.image, c = document.createElement("canvas"); c.width = 620; c.height = 820; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 620, 820);
      const k = Math.min(600 / im.width, 800 / im.height), w = im.width * k, h = im.height * k; x.drawImage(im, 310 - w / 2, 410 - h / 2, w, h); const ct = new THREE.CanvasTexture(c); ct.colorSpace = THREE.SRGBColorSpace; ct.anisotropy = 8; pic.material.map = ct; pic.material.needsUpdate = true; t.dispose(); });
    const tag = panel(0.62, 0.2, canvasTex(620, 200, (x, w, h) => { x.fillStyle = "#101119"; x.fillRect(0, 0, w, h); x.fillStyle = "#f4f3ff"; x.font = "700 38px Rajdhani"; let s = fit.item; while (x.measureText(s).width > w - 40 && s.length > 8) s = s.slice(0, -2); x.fillText(s === fit.item ? s : `${s}…`, 20, 62);
      x.font = "500 22px 'JetBrains Mono'"; x.fillStyle = "#b98cff"; x.fillText(fit.brand.toUpperCase(), 20, 106); x.fillStyle = "#9d9dc0"; x.fillText(`${fit.tag ? fit.tag.toUpperCase() + " · " : ""}${fmt(fit.date)}`, 20, 150); }), 0, 1.13, 0.04, { parent: g, k: 0.95 });
    tube(0.62, 0.012, 0.012, 0xfff0dc, 0, 2.14, 0.06, { parent: g, k: 1.1 });
    addHot(g, "closet", fit.item, `${fit.brand} · ${tapWord} to look closer`, () => stepTo(g, fit.item, fit, V(X0 + 1.45, 1.56, z), V(X0, 1.56, z))); });
  /* the island: drawers, a glass top with a light under it, and what's lying out */
  const IX = -8.45, IZ = -2.75;
  block(0.86, 0.84, 1.46, 0, IX, 0.42, IZ, { r: 0.015, mat: steelM(0x424753) });
  for (const s of [-1, 1]) for (const y of [0.2, 0.56]) for (const z of [-0.36, 0.36]) { block(0.012, 0.3, 0.66, 0, IX + s * 0.436, y, IZ + z, { r: 0.004, mat: steelM(0x5a606f) }); block(0.018, 0.012, 0.26, 0, IX + s * 0.446, y + 0.1, IZ + z, { r: 0.004, mat: steelM(0xc4cad8) }); }
  block(0.92, 0.018, 1.52, 0, IX, 0.86, IZ, { r: 0.008, mat: std(0x07080c, 0.08, 0.1) }); tube(0.9, 0.012, 1.5, 0x4a3a7a, IX, 0.845, IZ, { k: 0.8 });
  stack(IX - 0.1, 0.87, IZ - 0.42, 5, 0.34, 0.27, 0xefeeea); stack(IX + 0.14, 0.87, IZ + 0.42, 2, 0.34, 0.27, 0x2a3a58); stack(IX + 0.14, 0.964, IZ + 0.42, 1, 0.34, 0.27, 0x1b1b20);
  /* a lint roller: two cats live here */
  { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.11, 24), std(0xe9e6da, 0.75)); r.rotation.x = Math.PI / 2; r.position.set(IX - 0.16, 0.9, IZ + 0.3); scene.add(r); const hd = block(0.018, 0.018, 0.16, 0, IX - 0.28, 0.894, IZ + 0.3, { r: 0.006, mat: std(0x1b1d24, 0.4) }); hd.rotation.y = Math.PI / 2; }
  /* a tall steel mirror by the door, lit down both sides */
  { const mx = -7.2, mz = Z0 - 0.03; block(1.06, 2.56, 0.04, 0, mx, 1.3, mz, { r: 0.01, mat: steelM(0x2c303a) }); /* a real mirror, cheaply: the room captured once into a cube map and looked up with its reflection corrected to the room's box, so it stays put as you move (a glossy metal would just show a blinding spot of ceiling light) */
    const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType }), cubeC = new THREE.CubeCamera(0.05, 12, cubeRT); cubeC.position.set(CX, 1.6, CZ); scene.add(cubeC);
    const mirM = new THREE.ShaderMaterial({ uniforms: { tRoom: { value: cubeRT.texture }, bMin: { value: V(X0, 0, Z1) }, bMax: { value: V(X1 - 0.03, H, Z0) }, c0: { value: cubeC.position } },
      vertexShader: "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `uniform samplerCube tRoom; uniform vec3 bMin, bMax, c0; varying vec3 vW;
        void main() { vec3 v = normalize(vW - cameraPosition), r = reflect(v, vec3(0.0, 0.0, -1.0)); vec3 t1 = (bMax - vW) / r, t2 = (bMin - vW) / r, tm = max(t1, t2); float d = min(min(tm.x, tm.y), tm.z); vec3 hit = vW + r * d - c0;
          gl_FragColor = vec4(textureCube(tRoom, hit).rgb * vec3(0.86, 0.88, 0.9), 1.0); }` });
    const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 2.4), mirM); mir.rotation.y = Math.PI; mir.position.set(mx, 1.3, mz - 0.024); scene.add(mir);
    let snapped = false; animators.push(() => { if (snapped || room !== "closet" || flight) return; snapped = true; mir.visible = false; SIDE.closet.door.position.copy(SIDE.closet.base); /* shut, in the reflection */ cubeC.update(renderer, scene); mir.visible = true; });
    for (const s of [-1, 1]) tube(0.012, 2.4, 0.012, 0xfff0dc, mx + s * 0.5, 1.3, mz - 0.03, { k: 0.85 }); }
  /* the other side wall: the rest of the wardrobe, hung side-on, with a chunky seat in front of it to put your boots on */
  const cloths = [0x1c1e27, 0x2c3140, 0x4a4f5e, 0x161721, 0x35405a, 0x5c4a3e, 0x20242f].map((c) => fabricM(c)); const rx0 = -10.15, rx1 = -8.15, rz = Z0 - 0.3;
  /* a coat seen edge-on: shoulders sloping from the hanger, the cloth falling in soft waves */
  const hungG = [3.1, 5.3, 7.7].map((ph) => { const g = new THREE.BoxGeometry(0.05, 1, 0.5, 2, 16, 14), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) - 0.5, z = p.getZ(i), top = Math.max(0, 1 + y / 0.16), sl = 1 - 0.5 * top * top; p.setXYZ(i, p.getX(i) * (0.55 + 0.45 * Math.min(1, -y * 4)) + Math.sin(z * 15 + y * 4 + ph) * 0.016 * Math.min(1, -y * 3), y, z * sl); } g.computeVertexNormals(); return g; });
  const sRail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, rx1 - rx0, 16), steelM(0xd2d8e2)); sRail.rotation.z = Math.PI / 2; sRail.position.set((rx0 + rx1) / 2, 2.3, rz); scene.add(sRail);
  { let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); for (let px = rx0 + 0.08; px < rx1 - 0.05; px += 0.085 + r() * 0.05) { const h = 0.75 + r() * 0.45, c = new THREE.Mesh(hungG[Math.floor(r() * 3)], cloths[Math.floor(r() * cloths.length)]); c.scale.set(0.8 + r() * 0.6, h, 1); c.position.set(px, 2.26, rz); c.castShadow = true; c.rotation.x = (r() - 0.5) * 0.03; scene.add(c); const hk = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 6, 16, Math.PI * 1.4), steelM(0xb8bfcc)); hk.rotation.y = Math.PI / 2; hk.position.set(px, 2.3, rz); scene.add(hk); } }
  block(2.05, 0.03, 0.5, 0, (rx0 + rx1) / 2, 2.52, rz, { r: 0.01, mat: carbon }); tube(1.95, 0.012, 0.012, 0xffd9a8, (rx0 + rx1) / 2, 2.5, rz - 0.2, { k: 1.1 });
  { const seat = pillow(1.05, 0.2, 0.5, 2, leather(0x8a5230, seatBump, 0.42, 1)); seat.position.set(-9.15, 0.42, -1.25); seat.rotation.y = 0.04; scene.add(seat); block(0.96, 0.3, 0.42, 0, -9.15, 0.16, -1.25, { r: 0.02, mat: steelM(0x2c303a) }); }
  catBed(-6.72, -4.32, 0.36);
  /* a plant in the corner, and the wardrobe's little controller on the wall */
  { const p = new THREE.Group(); p.position.set(-10.08, 0, -4.42); scene.add(p); const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.36, 28), std(0x3a3d46, 0.9)); pot.position.y = 0.18; p.add(pot); leafy(p, 0, 0.35, 0, { n: 18, len: 0.75, wid: 0.08, bend: 0.5, tilt: 0.6, seed: 23 }); }
  { block(0.03, 0.2, 0.3, 0, -6.15, 1.42, -0.8, { r: 0.008, mat: std(0x0b0c12, 0.18) }); panel(0.26, 0.16, canvasTex(260, 160, (x, w, h) => { x.fillStyle = "#061018"; x.fillRect(0, 0, w, h); x.font = "500 18px 'JetBrains Mono'"; x.fillStyle = "#7ff6ff"; x.fillText("WARDROBE // OK", 14, 30); x.fillStyle = "#9d9dc0"; x.fillText("HUM 46%   21.0C", 14, 62); x.fillText("LINT: CRITICAL", 14, 92); x.fillStyle = "#ff2a6d"; x.fillText("2 CATS DETECTED", 14, 124); }), -6.17, 1.42, -0.8, { rotY: -Math.PI / 2, k: 0.9 }); }
};

/* the record room: what I've really been playing, from Last.fm. Sleeves on the wall are my top albums; the screen and the turntable follow the current track */
const MUSIC = { spin: false, live: false, track: null, sleeves: [], loaded: false, draw: null, label: null };
const lfmCall = (method, params = "") => fetch(`https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(S.lastfm.user)}&api_key=${S.lastfm.apiKey}&format=json${params}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
const lfmArt = (imgs) => { const u = (imgs || []).slice(-1)[0]?.["#text"] || ""; return u.includes("2a96cbd8b46e442fc41c2b86b821562f") ? "" : u; };
const loadMusic = () => { if (!S.lastfm?.user) return;
  const coverLoader = new THREE.TextureLoader(); coverLoader.setCrossOrigin("anonymous");
  if (!MUSIC.loaded) { MUSIC.loaded = true;
    lfmCall("user.gettopalbums", "&period=6month&limit=40").then((d) => { const seen = new Set(), list = [].concat(d.topalbums?.album || []).filter((a) => { const u = lfmArt(a.image); if (!u || seen.has(u)) return false; seen.add(u); return true; }).slice(0, MUSIC.sleeves.length);
      if (list.length) MUSIC.layout(list.length);
      MUSIC.sleeves.forEach((sl, i) => { const a = list[i]; if (!a) return; const h = hot[sl.userData.hot]; h.label = a.name; h.sub = `${a.artist?.name || ""} · ${a.playcount} plays`; h.act = () => window.open(a.url, "_blank", "noopener");
        coverLoader.load(lfmArt(a.image), (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; sl.material.map = t; sl.material.color.setScalar(1); sl.material.needsUpdate = true; }); }); }).catch((e) => console.warn("last.fm albums:", e)); }
  lfmCall("user.getrecenttracks", "&limit=6").then((d) => { const list = [].concat(d.recenttracks?.track || []), t = list[0]; if (!t) return; const live = t["@attr"]?.nowplaying === "true"; MUSIC.live = live; if (live) MUSIC.spin = true; const changed = MUSIC.track?.url !== t.url || MUSIC.wasLive !== live; MUSIC.track = t; MUSIC.recent = list.slice(1, 5); MUSIC.wasLive = live; if (!changed) return; MUSIC.draw?.(null);
    const u = lfmArt(t.image); if (u) { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { MUSIC.draw?.(im); if (MUSIC.label) { const ct = new THREE.CanvasTexture((() => { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 256, 256); return c; })()); ct.colorSpace = THREE.SRGBColorSpace; MUSIC.label.material.map = ct; MUSIC.label.material.needsUpdate = true; } }; im.src = u; } }).catch((e) => console.warn("last.fm tracks:", e)); };
const buildMusic = () => {
  const X0 = 1.7, X1 = 9.3, Z0 = -7.11, Z1 = -13.7, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
  const tex = panelTex("#1e1a28", "#120f1a", "#0c0a12");
  { const f = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.1, Z0 - Z1 + 0.11), toon(0xffffff, { map: stoneFloor(7.6, 6.7, "#14131b"), roughness: 0.3 })); f.position.set(CX, -0.05, (-7 + Z1) / 2); scene.add(f); }
  slab(X1 - X0, 0.1, Z0 - Z1 + 0.11, 0x0a0a10, CX, H + 0.05, (-7 + Z1) / 2);
  boxWall(tex, 2.1, H, 0.1, 2.75, H / 2, Z0 - 0.05, 2.1); boxWall(tex, 4.1, H, 0.1, 7.25, H / 2, Z0 - 0.05, 4.1); slab(1.4, H - 2.4, 0.1, 0x1e1a28, 4.5, 2.4 + (H - 2.4) / 2, Z0 - 0.05);
  boxWall(tex, X1 - X0, H, 0.1, CX, H / 2, Z1 - 0.05, X1 - X0); boxWall(tex, 0.1, H, Z0 - Z1, X0 - 0.05, H / 2, CZ, Z0 - Z1); boxWall(tex, 0.1, H, Z0 - Z1, X1 + 0.05, H / 2, CZ, Z0 - Z1);
  /* magenta down the sides and amber across the ends, like the living room next door */
  for (const x of [X0 + 0.02, X1 - 0.02]) tube(0.025, 0.025, Z0 - Z1, 0xff2a6d, x, H - 0.07, CZ, { k: 1.0 });
  for (const z of [Z0 - 0.12, Z1 + 0.02]) tube(X1 - X0, 0.025, 0.025, 0xffa040, CX, H - 0.07, z, { k: 1.0 });
  flatRug(3.9, 3.0, CX, -10.4, (x, w, h) => { x.fillStyle = "#22202c"; x.fillRect(0, 0, w, h); x.strokeStyle = "#8f4a2c"; x.lineWidth = 7; for (let i = 0; i < 9; i++) { x.globalAlpha = 0.25 + i * 0.07; x.beginPath(); for (let px = 0; px <= w; px += 8) { const y = h / 2 + Math.sin(px * 0.012 + i * 0.5) * (30 + i * 26) * Math.sin(px / w * Math.PI); px ? x.lineTo(px, y) : x.moveTo(px, y); } x.stroke(); } x.globalAlpha = 1; x.fillStyle = "#111016"; x.fillRect(0, 0, w, 16); x.fillRect(0, h - 16, w, 16); }, 4);
  /* acoustic felt panels on the far wall behind the speakers */
  const felt = [fabricM(0x2c2738), fabricM(0x37304a), fabricM(0x231f2e)];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) if (i < 3 || i > 8 || j === 0 && false) block(0.56, 1.46, 0.05, 0, 2.2 + i * 0.6, 0.86 + j * 1.5, Z1 + 0.03, { r: 0.018, mat: felt[(i * 3 + j) % 3] });
  /* the screen: what's playing */
  const sc = document.createElement("canvas"); sc.width = 1280; sc.height = 720; const scT = new THREE.CanvasTexture(sc); scT.colorSpace = THREE.SRGBColorSpace; scT.anisotropy = 8;
  block(3.08, 1.76, 0.06, 0, CX, 2.24, Z1 + 0.04, { r: 0.012, mat: std(0x0a0a0e, 0.22, 0.4) });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.6875), new THREE.MeshBasicMaterial({ map: scT, toneMapped: false, color: new THREE.Color(0.9, 0.9, 0.9) })); screen.position.set(CX, 2.24, Z1 + 0.075); scene.add(screen);
  MUSIC.draw = (im) => { const x = sc.getContext("2d"), t = MUSIC.track, w = 1280, h = 720, g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#150c26"); g.addColorStop(1, "#08070f"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(255,255,255,.04)"; x.lineWidth = 1; for (let i = 0; i < w; i += 40) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); } for (let i = 0; i < h; i += 40) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
    if (im) x.drawImage(im, 60, 60, 420, 420); else { x.fillStyle = "#1b1630"; x.fillRect(60, 60, 420, 420); x.strokeStyle = "#ff2a6d"; x.lineWidth = 2; x.beginPath(); x.arc(270, 270, 120, 0, 6.3); x.stroke(); x.beginPath(); x.arc(270, 270, 24, 0, 6.3); x.stroke(); }
    x.textBaseline = "top"; x.font = "500 26px 'JetBrains Mono'"; x.fillStyle = MUSIC.live ? "#2bff88" : "#9d9dc0"; x.fillText(t ? (MUSIC.live ? ">> NOW PLAYING" : ">> LAST PLAYED") : ">> STANDBY", 530, 66);
    const fit = (s, f, mw) => { x.font = f; let o = s; while (x.measureText(o).width > mw && o.length > 4) o = o.slice(0, -2); return o === s ? s : `${o}…`; };
    if (t) { x.fillStyle = "#f4f3ff"; x.shadowColor = "#ff2a6d"; x.shadowBlur = 14; x.fillText(fit(t.name, "700 74px Rajdhani", 700), 530, 112); x.shadowBlur = 0; x.fillStyle = "#7ff6ff"; x.fillText(fit(t.artist["#text"], "600 46px Rajdhani", 700), 530, 202); x.fillStyle = "#b5b3cc"; const al = t.album?.["#text"]; if (al) x.fillText(fit(al, "500 34px Rajdhani", 700), 530, 262); }
    else { x.fillStyle = "#f4f3ff"; x.font = "700 74px Rajdhani"; x.fillText("Warming up", 530, 112); }
    x.font = "500 20px 'JetBrains Mono'"; x.fillStyle = "#6d6b88"; x.fillText("BEFORE THAT", 530, 332); x.font = "500 30px Rajdhani"; (MUSIC.recent || []).slice(0, 3).forEach((r, i) => { x.fillStyle = "#d6d6e7"; x.fillText(fit(`${r.name}  —  ${r.artist["#text"]}`, "500 30px Rajdhani", 700), 530, 366 + i * 40); });
    x.fillStyle = "#6d6b88"; x.font = "500 20px 'JetBrains Mono'"; x.fillText("LAST.FM // THEPIERPONT", 60, 520); for (let i = 0; i < 58; i++) { const v = 18 + 110 * Math.abs(Math.sin(i * 0.41) * Math.cos(i * 0.13 + (t ? t.name.length : 1))); x.fillStyle = `hsl(${320 - i * 2.4},90%,62%)`; x.fillRect(60 + i * 20, 684 - v, 12, v); }
    scT.needsUpdate = true; };
  MUSIC.draw(null);
  addHot(screen, "music", "Now playing", "Open it on Last.fm", () => { const u = MUSIC.track?.url; if (u) window.open(u, "_blank", "noopener"); });
  /* the speakers: tall gloss monoliths with real cones and a phase plug, up on steel feet */
  const gloss = std(0x09090c, 0.14, 0.15, { roughnessMap: wearTex() }), coneG = new THREE.LatheGeometry([[0.015, 0], [0.04, 0.0015], [0.09, 0.016], [0.102, 0.03], [0.112, 0.033], [0.118, 0.03]].map(([a, b]) => new THREE.Vector2(a, b)), 48), coneM = std(0x34343c, 0.6), woofers = [];
  for (const sx of [3.05, 7.95]) { const sp = new THREE.Group(); sp.position.set(sx, 0, -13.05); sp.rotation.y = (sx < CX ? 1 : -1) * 0.14; scene.add(sp);
    block(0.5, 1.5, 0.46, 0, 0, 0.87, 0, { parent: sp, r: 0.03, mat: gloss }); block(0.56, 0.06, 0.52, 0, 0, 0.03, 0, { parent: sp, r: 0.01, mat: steelM(0x7c8392) }); for (const a of [-1, 1]) for (const b of [-1, 1]) { const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.008, 0.09, 12), steelM(0xc4cad8)); ft.position.set(a * 0.2, 0.08, b * 0.17); sp.add(ft); }
    for (const [y, k] of [[0.42, 1.65], [0.86, 1.2], [1.28, 0.42]]) { const cn = new THREE.Mesh(coneG, k < 0.5 ? steelM(0xc4cad8) : coneM); cn.rotation.x = Math.PI / 2; cn.scale.set(k, k, k); cn.position.set(0, y, 0.228); sp.add(cn); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.122 * k, 0.006, 8, 48), steelM(0xa8afbc)); ring.position.set(0, y, 0.232); sp.add(ring); if (k > 1.5) woofers.push(cn); }
    tube(0.3, 0.008, 0.008, sx < CX ? 0x4fd8ff : 0xff2a6d, 0, 1.56, 0.234, { parent: sp, k: 1.2 }); }
  /* the credenza: steel with a carbon top and a warm strip beneath */
  const CZn = -13.25, carbon = std(0x101116, 0.28, 0.2, { roughnessMap: wearTex() });
  block(3.0, 0.5, 0.56, 0, CX, 0.31, CZn, { r: 0.015, mat: steelM(0x3e4350) }); block(3.06, 0.03, 0.62, 0, CX, 0.575, CZn, { r: 0.01, mat: carbon }); tube(2.9, 0.012, 0.012, 0xffa040, CX, 0.05, CZn + 0.28, { k: 1.1 });
  for (let i = 0; i < 4; i++) block(0.7, 0.42, 0.012, 0, CX - 1.08 + i * 0.72, 0.31, CZn + 0.284, { r: 0.004, mat: steelM(0x565c6b) });
  /* the turntable, a real one: gloss plinth, weighted platter, grooved vinyl with the current album on its label, an S-less straight arm */
  const TT = new THREE.Group(); TT.position.set(CX - 0.62, 0.59, CZn + 0.02); scene.add(TT);
  block(0.5, 0.075, 0.4, 0, 0, 0.0375, 0, { parent: TT, r: 0.012, mat: gloss });
  for (const a of [-1, 1]) for (const b of [-1, 1]) { const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.016, 16), steelM(0x8a91a0)); ft.position.set(a * 0.21, -0.002, b * 0.16); TT.add(ft); }
  const platter = new THREE.Group(); platter.position.set(-0.06, 0.08, 0); TT.add(platter);
  platter.add(new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.018, 64), steelM(0xb8bfcc))); platter.children[0].position.y = 0.009;
  const grooves = canvasTex(1024, 1024, (x, w) => { x.fillStyle = "#050507"; x.beginPath(); x.arc(w / 2, w / 2, w / 2, 0, 6.3); x.fill(); for (let r0 = 170; r0 < 505; r0 += 1.6) { x.strokeStyle = `rgba(255,255,255,${0.018 + Math.random() * 0.03})`; x.lineWidth = 0.7; x.beginPath(); x.arc(w / 2, w / 2, r0, 0, 6.3); x.stroke(); } x.fillStyle = "#050507"; for (const r0 of [260, 345, 420]) { x.strokeStyle = "rgba(0,0,0,.9)"; x.lineWidth = 5; x.beginPath(); x.arc(w / 2, w / 2, r0, 0, 6.3); x.stroke(); }
    const sh = x.createConicGradient(0.7, w / 2, w / 2); sh.addColorStop(0, "rgba(255,255,255,.2)"); sh.addColorStop(0.09, "rgba(255,255,255,0)"); sh.addColorStop(0.5, "rgba(255,255,255,.18)"); sh.addColorStop(0.59, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(255,255,255,.2)"); x.globalCompositeOperation = "source-atop"; x.fillStyle = sh; x.fillRect(0, 0, w, w); });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 96), std(0xffffff, 0.3, 0.1, { map: grooves })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; platter.add(disc);
  MUSIC.label = new THREE.Mesh(new THREE.CircleGeometry(0.05, 48), std(0xff2a6d, 0.5)); MUSIC.label.rotation.x = -Math.PI / 2; MUSIC.label.position.y = 0.0205; platter.add(MUSIC.label);
  { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.028, 12), steelM(0xe0e4ec)); sp.position.y = 0.032; platter.add(sp); }
  const arm = new THREE.Group(); arm.position.set(0.19, 0.11, -0.13); TT.add(arm);
  { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.06, 20), steelM(0x9aa1b0)); post.position.y = -0.012; arm.add(post); const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.26, 12), steelM(0xd8dce4)); beam.rotation.x = Math.PI / 2; beam.position.z = 0.13; arm.add(beam);
    const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 20), steelM(0x6c7389)); cw.rotation.x = Math.PI / 2; cw.position.z = -0.03; arm.add(cw); block(0.018, 0.01, 0.04, 0, 0, -0.004, 0.27, { parent: arm, r: 0.003, mat: std(0x15151a, 0.4) }); }
  tube(0.008, 0.008, 0.008, 0x2bff88, 0.2, 0.08, 0.17, { parent: TT, k: 1.6 });
  addHot(TT, "music", "Turntable", touch ? "Tap to drop the needle" : "Click to drop the needle", () => { MUSIC.spin = !MUSIC.spin; });
  /* the amp: brushed face, two amber VU meters whose needles ride the music, big knobs */
  const AX = CX + 0.42, AZ = CZn + 0.03; block(0.72, 0.17, 0.42, 0, AX, 0.676, AZ, { r: 0.01, mat: steelM(0x8f96a5) });
  const vuT = canvasTex(256, 128, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#ffcf7a"); g.addColorStop(1, "#d9892e"); x.fillStyle = g; x.fillRect(0, 0, w, h); x.strokeStyle = "#2a1605"; x.lineWidth = 2; x.beginPath(); x.arc(w / 2, 170, 120, -2.4, -0.74); x.stroke(); for (let i = 0; i <= 10; i++) { const a = -2.4 + i * 0.166; x.beginPath(); x.moveTo(w / 2 + Math.cos(a) * 120, 170 + Math.sin(a) * 120); x.lineTo(w / 2 + Math.cos(a) * 132, 170 + Math.sin(a) * 132); x.strokeStyle = i > 7 ? "#a4140c" : "#2a1605"; x.stroke(); } x.fillStyle = "#2a1605"; x.font = "700 18px 'JetBrains Mono'"; x.textAlign = "center"; x.fillText("VU", w / 2, 108); });
  const needles = [-0.15, 0.03].map((dx) => { panel(0.14, 0.07, vuT, AX + dx, 0.692, AZ + 0.212, { k: 0.95 }); const n = new THREE.Group(); n.position.set(AX + dx, 0.664, AZ + 0.214); scene.add(n); const b = block(0.002, 0.066, 0.001, 0, 0, 0.033, 0, { parent: n, r: 0.0005, mat: new THREE.MeshBasicMaterial({ color: 0x170b02 }) }); b.castShadow = false; n.rotation.z = 0.7; return n; });
  for (const dx of [0.22, 0.3]) { const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.03, 32), steelM(0xd8dce4)); kn.rotation.x = Math.PI / 2; kn.position.set(AX + dx, 0.676, AZ + 0.222); scene.add(kn); }
  /* headphones on a steel stand, for the late-night shift */
  { const hx = CX + 1.18, hz = CZn; const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.012, 32), steelM(0x6c7389)); ped.position.set(hx, 0.596, hz); scene.add(ped); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.22, 12), steelM(0xc4cad8)); rod.position.set(hx, 0.70, hz); scene.add(rod);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 10, 48, Math.PI), std(0x18181d, 0.5)); band.position.set(hx, 0.76, hz); scene.add(band); for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 32), leather(0x24232b, plainBump, 0.5, 0.5)); cup.rotation.z = Math.PI / 2; cup.position.set(hx + s * 0.075, 0.742, hz); scene.add(cup); } }
  /* the wall of records: my top albums, each on a small steel ledge, backlit */
  const SZ = 0.54, COLS = 6, ROWS = 3, wallZ = -10.4; const wallGlow = tube(0.012, 0.012, 1, 0xffb066, X0 + 0.05, 2.78, wallZ, { k: 1.0 });
  for (let i = 0; i < COLS * ROWS; i++) { const g = new THREE.Group(); scene.add(g);
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(SZ, SZ), new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.42 })); sl.rotation.y = Math.PI / 2; sl.position.x = 0.018; g.add(sl);
    block(0.014, SZ + 0.03, SZ + 0.03, 0, 0, 0, 0, { parent: g, r: 0.004, mat: std(0x0a0a0e, 0.35) }); block(0.05, 0.008, SZ + 0.02, 0, 0.002, -SZ / 2 - 0.02, 0, { parent: g, r: 0.003, mat: steelM(0xa8afbc) });
    addHot(sl, "music", "From the record wall", "Loading…", () => {}); sl.userData.slot = g; MUSIC.sleeves.push(sl); }
  /* the wall is as big as the collection: covers centred, three rows, more columns as more albums turn up */
  MUSIC.layout = (n) => { const cols = Math.max(1, Math.ceil(n / ROWS)); MUSIC.sleeves.forEach((sl, i) => { const g = sl.userData.slot; g.visible = i < n; if (i >= n) return; const c = Math.floor(i / ROWS), r = i % ROWS; g.position.set(X0 + 0.04, 2.3 - r * 0.66, wallZ + ((cols - 1) / 2 - c) * 0.72); }); wallGlow.scale.z = cols * 0.72 + 0.1; };
  MUSIC.layout(12);
  /* the chair: one huge, soft, cognac leather lounge, facing the sound */
  { const ch = new THREE.Group(); ch.position.set(CX, 0, -10.2); scene.add(ch); const cog = leather(0x8e4f2a, seatBump, 0.38, 1), cogB = leather(0x8e4f2a, backBump, 0.38, 1), cogP = leather(0x7a4323, plainBump, 0.42, 0.8);
    block(1.14, 0.1, 0.98, 0, 0, 0.11, 0, { parent: ch, r: 0.03, mat: steelM(0x2c303a) }); tube(1.0, 0.012, 0.012, 0xffa040, 0, 0.05, -0.47, { parent: ch, k: 1.0 });
    const seat = pillow(0.92, 0.26, 0.86, 1, cog); seat.position.set(0, 0.32, -0.04); ch.add(seat); const back = pillow(0.92, 0.2, 0.68, 1, cogB); back.rotation.x = -Math.PI / 2 + 0.2; back.position.set(0, 0.74, 0.38); ch.add(back);
    for (const s of [-1, 1]) { const armC = pillow(0.74, 0.3, 0.2, 1, cogP); armC.rotation.y = Math.PI / 2; armC.rotation.x = 0; armC.position.set(s * 0.56, 0.5, 0.02); ch.add(armC); } const hd = pillow(0.56, 0.12, 0.2, 1, cogP); hd.rotation.x = -Math.PI / 2 + 0.2; hd.position.set(0, 1.08, 0.3); ch.add(hd);
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.022, 48), std(0x0a0a0e, 0.12)); tb.position.set(1.1, 0.5, 0.0); ch.add(tb); const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 16), steelM(0xc4cad8)); leg.position.set(1.1, 0.25, 0); ch.add(leg); const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.014, 32), steelM(0x6c7389)); ft.position.set(1.1, 0.008, 0); ch.add(ft);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.033, 0.085, 24), std(0xe0ddd2, 0.3)); mug.position.set(1.14, 0.555, -0.05); ch.add(mug); }
  /* crates of records on the floor by the wall */
  { let sd = 9; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); for (const [cx, cz] of [[2.38, -12.75], [2.38, -7.85]]) { const cr = steelM(0x4a5060); block(0.42, 0.34, 0.42, 0, cx, 0.17, cz, { r: 0.012, mat: std(0x1c1d24, 0.5, 0.2) }); for (let i = 0; i < 12; i++) { const s = block(0.34, 0.34, 0.012, 0, cx, 0.3, cz - 0.16 + i * 0.029, { r: 0.003, mat: std(new THREE.Color().setHSL(r(), 0.45, 0.28), 0.5) }); s.rotation.x = -0.14; } } }
  /* the right-hand wall: a long neon waveform, over felt panels */
  { for (let i = 0; i < 7; i++) block(0.05, 1.7, 0.74, 0, X1 - 0.03, 1.0 + 0 * i, -8.0 - i * 0.82, { r: 0.016, mat: felt[i % 3] }); const pts = []; for (let i = 0; i <= 220; i++) { const u = i / 220, z = -7.9 - u * 5.0, env = Math.sin(u * Math.PI); pts.push(V(X1 - 0.09, 2.3 + Math.sin(u * 44) * Math.sin(u * 11) * 0.26 * env, z)); } scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 480, 0.0085, 6), glowMat(0xff2a6d, 1.25))); }
  /* tall plants either side of the door, where the light falls */
  for (const [px, pz, sd] of [[8.72, -7.72, 31], [2.28, -13.15, 37]]) { const p = new THREE.Group(); p.position.set(px, 0, pz); scene.add(p); const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.42, 28), std(0x3a3d46, 0.9)); pot.position.y = 0.21; p.add(pot); leafy(p, 0, 0.4, 0, { n: 22, len: 0.95, wid: 0.09, bend: 0.5, tilt: 0.6, seed: sd }); }
  animators.push((now, dt) => { if (!SIDE.music.group?.visible || reduce && !MUSIC.spin) return; const k = (MUSIC.armK = (MUSIC.armK || 0) + ((MUSIC.spin ? 1 : 0) - (MUSIC.armK || 0)) * 0.03);
    if (k > 0.02) platter.rotation.y -= (dt || 16) * 0.00349 * Math.min(1, k * 1.3); arm.rotation.y = 0.05 - k * 0.42; /* the arm crosses onto the record */
    const beat = MUSIC.spin ? Math.abs(Math.sin(now / 230)) * Math.pow(Math.abs(Math.sin(now / 1840)), 0.6) : 0; needles.forEach((n, i) => { const v = 0.7 - k * (0.5 + beat * (i ? 0.64 : 0.76) + Math.sin(now / (i ? 96 : 73)) * 0.06); n.rotation.z = v; }); woofers.forEach((w) => { const s = 1.65 + beat * 0.012 * k; w.scale.z = s; }); });
  animators.push((now) => { if (!SIDE.music.group?.visible || now < (MUSIC.pollT || 0)) return; MUSIC.pollT = now + 30000; loadMusic(); });
};

const buildLiving = () => {
  // Dark gunmetal wall panels (seams, a lower band, a few rivets), a dark glossy floor, a dark ceiling.
  // Neon does the outlining: cove light round the ceiling, a rounded frame round the window, tubes either side of it.
  const panTex = (len, tall = H) => { const t = canvasTex(512, 1160, (x, w, h) => {
    x.fillStyle = "#1d2232"; x.fillRect(0, 0, w, h);
    const band = h * (1 - 0.9 / H); x.fillStyle = "#161a27"; x.fillRect(0, band, w, h - band);
    x.fillStyle = "#0e1019"; x.fillRect(0, 0, 5, h); x.fillRect(0, band - 4, w, 7); x.fillRect(0, h * 0.18, w, 3);
    x.fillStyle = "rgba(255,255,255,.035)"; for (let i = 24; i < w; i += 46) x.fillRect(i, h * 0.18 + 6, 2, band - h * 0.18 - 14); // fine vertical ribbing
    x.fillStyle = "#2a3044"; for (const [rx, ry] of [[14, 14], [w - 14, 14], [14, band - 18], [w - 14, band - 18]]) { x.beginPath(); x.arc(rx, ry, 4, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = "#0b0d14"; x.fillRect(0, h - 26, w, 26); // skirting
  }); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 1.2, 1); return t; };
  const wall = (w, h, d, x, y, z, len) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(0xffffff, { map: panTex(len) })); m.position.set(x, y, z); scene.add(m); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), lineMat)); return m; };
  const plain = 0x1d2232;
  const floorTex = canvasTex(512, 512, (x, w) => { x.fillStyle = "#0c0d14"; x.fillRect(0, 0, w, w); x.fillStyle = "rgba(255,255,255,.035)"; x.fillRect(0, 0, w, 3); x.fillRect(0, 0, 3, w); x.fillStyle = "rgba(120,170,255,.05)"; x.fillRect(20, 20, w - 40, w * 0.4); }); // big glossy tiles with a sheen
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(12 / 1.5, 7 / 1.5);
  { const f = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 7), toon(0xffffff, { map: floorTex, roughness: 0.28 })); f.position.set(0, -0.05, -3.5); scene.add(f); }
  slab(12, 0.1, 7, 0x0b0c12, 0, H + 0.05, -3.5);
  if (lite) wall(0.2, H, 7, -6, H / 2, -3.5, 7);
  else { wall(0.2, H, 1.2, -6, H / 2, -0.6, 1.2); wall(0.2, H, 4.4, -6, H / 2, -4.8, 4.4); slab(0.2, H - 2.4, 1.4, plain, -6, 2.4 + (H - 2.4) / 2, -1.9); } // on desktop, with the closet's doorway
  wall(0.2, H, 2.9, 6, H / 2, -1.45, 2.9); wall(0.2, H, 2.7, 6, H / 2, -5.65, 2.7); slab(0.2, H - 2.4, 1.4, plain, 6, 2.4 + (H - 2.4) / 2, -3.6); // the right wall, with the gallery doorway
  // back wall: theater doorway | wall | window | wall | music door
  wall(0.8, H, 0.2, -5.6, H / 2, -7, 0.8);
  slab(1.4, H - 2.4, 0.2, plain, -4.5, 2.4 + (H - 2.4) / 2, -7);
  wall(1.2, H, 0.2, -3.2, H / 2, -7, 1.2);
  slab(5.2, 0.9, 0.2, 0x161a27, 0, 0.45, -7);
  slab(5.2, H - 2.9, 0.2, plain, 0, 2.9 + (H - 2.9) / 2, -7);
  wall(1.2, H, 0.2, 3.2, H / 2, -7, 1.2);
  slab(1.4, H - 2.4, 0.2, plain, 4.5, 2.4 + (H - 2.4) / 2, -7);
  wall(0.8, H, 0.2, 5.6, H / 2, -7, 0.8);
  // cove light where the walls meet the ceiling: magenta down the sides, amber across the ends
  for (const s of [-1, 1]) tube(0.025, 0.025, 6.8, 0xff2a6d, s * 5.88, H - 0.07, -3.5, { k: 1.1 });
  for (const z of [-0.12, -6.88]) tube(11.7, 0.025, 0.025, 0xffa040, 0, H - 0.07, z, { k: 1.0 });
  // tidy pipe runs along the top of the side walls, on brackets, dropping to the floor in the back corners
  for (const s of [-1, 1]) {
    for (const [y, r] of [[3.08, 0.035], [3.17, 0.025]]) { const pp = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6.8, 12), steelM(0x6c7389)); pp.rotation.x = Math.PI / 2; pp.position.set(s * 5.84, y, -3.5); scene.add(pp); }
    for (let z = -0.6; z > -6.9; z -= 1.1) block(0.06, 0.18, 0.04, 0x2a2e3a, s * 5.86, 3.1, z, { r: 0.01, ink: false });
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.08, 12), steelM(0x6c7389)); drop.position.set(s * 5.84, 1.54, -6.84); scene.add(drop);
    block(0.1, 0.06, 0.1, 0x2a2e3a, s * 5.84, 3.08, -6.84, { r: 0.02 }); // the elbow
  }
  // a junction box with status lights, up by the closet door
  block(0.06, 0.34, 0.26, 0x2a2e3a, -5.87, 2.45, -0.6, { r: 0.02 });
  for (let i = 0; i < 3; i++) blinkers.push({ m: tube(0.01, 0.02, 0.02, [0x2bff88, 0xf9f002, 0x2bff88][i], -5.835, 2.52 - i * 0.07, -0.66, { k: 2 }), rate: 0.4 + i * 0.7, phase: i });

  // theater doorway (open, framed in cyan)
  for (const s of [-1, 1]) tube(0.04, 2.44, 0.04, 0x05d9e8, -4.5 + s * 0.72, 1.22, -6.88);
  tube(1.48, 0.04, 0.04, 0x05d9e8, -4.5, 2.44, -6.88);
  const theaterSign = sign("THEATER", 0.36, -4.5, 2.8, -6.88, { color: "#7ff6ff", font: "700 160px Rajdhani", k: 1.0, glow: 0.06, core: 0 }); // tight glow, so it reads
  // an invisible plane filling the doorway takes the clicks; the sign above lights up on hover
  const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.9), new THREE.MeshBasicMaterial({ visible: false }));
  doorway.position.set(-4.5, 1.45, -6.95); scene.add(doorway);
  addHot(doorway, "living", "Theater", "My latest watch and the movie shelf", () => go("theater"));
  doorway.userData.glow = [theaterSign]; doorway.userData.fromCat = true;
  // the same doorway from the theater side: from the movie shelf, clicking it walks you back to your seat
  const shelfExit = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.9), new THREE.MeshBasicMaterial({ visible: false }));
  shelfExit.position.set(-4.5, 1.45, -7.1); shelfExit.rotation.y = Math.PI; scene.add(shelfExit);
  addHot(shelfExit, "shelf", "Back to the theater", touch ? "Tap to go back to your seat" : "Click to go back to your seat", () => go("theater"));

  // rooms still being built: closed doors with tape
  const soon = (name, x, z, rotY, lx, lz) => {
    const g = new THREE.Group(); scene.add(g);
    const d = block(1.36, 2.36, 0.08, 0x3b2a75, 0, 1.18, 0, { parent: g, r: 0.03 });
    const knob = ball(0.05, 0xf9f002, 0.52, 1.12, 0.07, { parent: g });
    if (!lite) { /* desktop: a steel sliding door like mine, no handle. Ribs, a scuffed kick plate, a dark access panel with a red locked light */
      knob.visible = false; d.material = steelM(0x5c6378);
      for (let i = 0; i < 3; i++) block(1.06, 0.035, 0.02, 0, 0, 0.5 + i * 0.12, 0.045, { parent: g, r: 0.008, mat: steelM(0xc4cad8) });
      const kick = steelM(0x3a3f4a); kick.roughnessMap = wearTex(); kick.roughness = 0.5; block(1.3, 0.2, 0.015, 0, 0, 0.12, 0.045, { parent: g, r: 0.006, mat: kick });
      block(0.14, 0.4, 0.02, 0, 0.5, 1.15, 0.046, { parent: g, r: 0.01, mat: new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.15 }) });
      tube(0.05, 0.012, 0.01, 0xff3b5c, 0.5, 0.98, 0.058, { parent: g, k: 2.0 }); } /* locked */
    g.position.set(x, 0, z); g.rotation.y = rotY;
    const label = sign(name, 0.3, lx, 2.8, lz, { color: "#b98cff", rotY, k: 1.3 });
    tape(x + Math.sin(rotY) * 0.06, 1.25, z + Math.cos(rotY) * 0.06, rotY);
    addHot(g, "living", name.charAt(0) + name.slice(1).toLowerCase(), "Under construction", () => toast(`The ${name.toLowerCase()} room is under construction. Check back soon.`));
    g.userData.glow = [label];
    return g;
  };
  if (lite) { soon("MUSIC", 4.5, -6.92, 0, 4.5, -6.88); soon("CLOSET", -5.86, -1.9, Math.PI / 2, -5.88, -1.9); }
  else { sideDoor("music", "MUSIC", 4.5, -7.0, 0, [1.42, 0, 0], 0xff2a6d, "Records, and what I'm playing right now", [4.5, -7.12], Math.PI);
    sideDoor("closet", "CLOSET", -6.0, -1.9, Math.PI / 2, [0, 0, -1.42], 0xb98cff, "Recent pickups, hung up properly", [-6.11, -1.9], -Math.PI / 2); }
  // the gallery doorway (open, framed in neon like the theater's), on the right wall
  for (const s of [-1, 1]) tube(0.04, 2.44, 0.04, 0xf9f002, 5.88, 1.22, -3.6 + s * 0.72, { k: 1.2 });
  tube(0.04, 0.04, 1.48, 0xf9f002, 5.88, 2.44, -3.6, { k: 1.2 });
  const gallerySign = sign("GALLERY", 0.3, 5.88, 2.8, -3.6, { color: "#fff27a", font: "700 160px Rajdhani", rotY: -Math.PI / 2, k: 1.0, glow: 0.06, core: 0 });
  const gdoor = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), new THREE.MeshBasicMaterial({ visible: false })); gdoor.position.set(5.95, 1.2, -3.6); gdoor.rotation.y = -Math.PI / 2; scene.add(gdoor);
  addHot(gdoor, "living", "Gallery", "My photos, hung properly", () => go("gallery")); gdoor.userData.glow = [gallerySign]; gdoor.userData.fromCat = true;

  // the window onto DC (a canvas: skyline + a little HUD with the time and block height)
  windowCanvas = document.createElement("canvas"); windowCanvas.width = 2600; windowCanvas.height = 1000; // drawn in 2080 × 800 units, at 1.25× for sharpness
  windowTex = new THREE.CanvasTexture(windowCanvas); windowTex.colorSpace = THREE.SRGBColorSpace; windowTex.anisotropy = 8;
  // a touch under full brightness, so white text on the glass doesn't bloom (the neon is drawn with its own glow)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), new THREE.MeshBasicMaterial({ map: windowTex, toneMapped: false, color: new THREE.Color(0.8, 0.8, 0.8) }));
  glass.position.set(0, 1.9, -7.02); scene.add(glass);
  const roundRect = (w, h, r, z) => { // a closed loop with rounded corners, for neon tube frames
    const pts = [], c = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
    for (const [cx, cy, a0] of c) for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * (Math.PI / 2); pts.push(V(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); }
    return new THREE.CatmullRomCurve3(pts, true, "centripetal");
  };
  { const inner = new THREE.Mesh(new THREE.TubeGeometry(roundRect(5.36, 2.16, 0.22, 0), 160, 0.026, 8, true), glowMat(0x05d9e8, 1.3)); inner.position.set(0, 1.9, -6.9); scene.add(inner);
    const outer = new THREE.Mesh(new THREE.TubeGeometry(roundRect(5.62, 2.42, 0.32, 0), 160, 0.012, 6, true), glowMat(0xff2a6d, 1.1)); outer.position.set(0, 1.9, -6.89); scene.add(outer); }
  for (const s of [-1, 1]) tube(0.03, 2.7, 0.03, 0xff2a6d, s * 3.02, 1.7, -6.88, { k: 1.2 }); // pink tubes standing either side
  // (the city is a still now: its traffic is baked in as long-exposure light trails, see drawSkyline)
  mullion = block(0.07, 2.0, 0.07, 0x140e2a, 0, 1.9, -6.95, { ink: false }); // hidden while the clock app is up
  block(5.5, 0.08, 0.34, 0, 0, 0.92, -6.8, { r: 0.02, mat: steelM(0x6c7389) }); // the sill
  windowGlass = glass;
  addHot(glass, "living", "DC at night", touch ? "Tap to open the clock on the window" : "Click to open the clock on the window", () => openWindowApp());

  // couch facing the window, coffee table, lamp, rug, plant, neon art
  { const rugTex = canvasTex(1024, 640, (x, w, h) => {
      x.fillStyle = "#1a1c24"; x.fillRect(0, 0, w, h);
      const zig = 64; x.lineWidth = 22; x.lineJoin = "miter";
      for (let y = -zig; y < h + zig; y += zig) { x.strokeStyle = (y / zig) % 2 ? "#c9ccd6" : "#2a2d38"; x.beginPath(); for (let px = 0, up = true; px <= w + zig; px += zig, up = !up) x.lineTo(px, y + (up ? 0 : zig * 0.6)); x.stroke(); }
      x.strokeStyle = "#0e1018"; x.lineWidth = 28; x.strokeRect(14, 14, w - 28, h - 28); x.strokeStyle = "#c9ccd6"; x.lineWidth = 4; x.strokeRect(34, 34, w - 68, h - 68);
    });
    const rugM = fabricM(0xffffff); rugM.map = rugTex; rugM.bumpScale = 1.2; const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.0), rugM); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, -5.2); scene.add(rug);
    if (!lite) { /* a deep pile you can see, and a bound edge round it */
      rugM.bumpMap = softTex(noise(51, 0.6, 30, 230, 1), 22, 14); rugM.bumpScale = 3.5; rug.receiveShadow = true; rug.position.y = 0.016;
      const bind = new THREE.MeshStandardMaterial({ color: 0x121318, roughness: 1, bumpMap: rugM.bumpMap, bumpScale: 2 });
      for (const [w, d, x, z] of [[4.86, 0.05, 0, -3.7], [4.86, 0.05, 0, -6.7], [0.05, 3.0, -2.43, -5.2], [0.05, 3.0, 2.43, -5.2]]) block(w, 0.022, d, 0, x, 0.011, z, { r: 0.008, mat: bind }); } }
  // Lounge furniture: white composite on recessed dark bases, cyan light lines, chunky chamfered arms with
  // little screens set into their tops. A three-seat sofa facing the window, an armchair beside it, the coffee table.
  const shell = 0xc9ced8, cush = 0x9fa6b5; // pale composite frame, grey woven cushions
  const uiTex = (w, h, big) => canvasTex(w, h, (x) => {
    x.fillStyle = "#081018"; x.fillRect(0, 0, w, h); x.strokeStyle = "#05d9e8"; x.lineWidth = 3; x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = "#05d9e8"; x.font = `600 ${big ? 34 : 24}px 'JetBrains Mono'`; x.fillText(big ? "LOUNGE · AMBIENT" : "21°", 16, big ? 48 : 40);
    for (let i = 0; i < (big ? 4 : 5); i++) { x.fillStyle = i === 2 ? "#ff2a6d" : "rgba(5,217,232,.7)"; x.fillRect(16, (big ? 72 : 66) + i * (big ? 24 : 30), 30 + ((i * 47) % (big ? 220 : 90)), big ? 10 : 12); }
  });
  const armUI = uiTex(160, 256), tableUI = uiTex(420, 200, true);

  const armGeo = (() => { // the arm's end profile: square at the bottom, the top outer corner chamfered off
    const p = new THREE.Shape(); p.moveTo(0, 0); p.lineTo(0.4, 0); p.lineTo(0.4, 0.62); p.lineTo(0.28, 0.84); p.lineTo(0, 0.84); p.closePath();
    const g = new THREE.ExtrudeGeometry(p, { depth: 1.0, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; })();
  // `seats` cushions wide; group space: front of the seat at -z
  const lounge = (seats, x, z, rotY) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
    const sw = 0.88, W = seats * sw, D = 0.98;
    block(W + 0.7, 0.07, D - 0.12, 0x14161f, 0, 0.035, 0, { parent: g, r: 0.01, ink: false }); // the dark base it floats on
    tube(W + 0.6, 0.012, 0.012, 0x05d9e8, 0, 0.04, -D / 2 + 0.06, { parent: g, k: 0.9 }); // underglow
    if (lite) block(W, 0.35, D, shell, 0, 0.245, 0, { parent: g, r: 0.03 }); // the plinth
    else { const pl = block(W, 0.35, D, shell, 0, 0.245, 0, { parent: g, r: 0.02, mat: leather(0xdfe3ea, shellBump, 0.28, 2.0) }); pl.material.bumpMap.repeat.set(W / 1.2, 1);
      for (const gz of [-0.08, 0.08]) block(W - 0.1, 0.012, 0.012, 0x3a3f4a, 0, 0.245 + gz, -D / 2 + 0.004, { parent: g, r: 0.004, mat: new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 }) }); } // grooves machined into the front
    tube(W, 0.014, 0.01, 0x05d9e8, 0, 0.2, -D / 2 - 0.006, { parent: g, k: 1.0 }); // a light line along its front
    for (let i = 0; i < seats; i++) { if (lite) block(sw - 0.04, 0.26, D - 0.18, cush, (i - (seats - 1) / 2) * sw, 0.55, -0.07, { parent: g, r: 0.05, mat: fabricM(cush) });
      else { const c = pillow(sw - 0.04, 0.26, D - 0.18, 3, leather(0xeceef4, seatBump, 0.3, 2.6)); c.position.set((i - (seats - 1) / 2) * sw, 0.55, -0.07); g.add(c); } } // seat cushions
    block(W, 0.62, 0.16, shell, 0, 0.73, D / 2 - 0.08, { parent: g, r: 0.02, mat: lite ? undefined : leather(0xdfe3ea, shellBump, 0.28, 2.0) }); // the back
    if (!lite) { const dark = () => new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 });
      for (const gy of [0.6, 0.86]) block(W - 0.1, 0.012, 0.012, 0, 0, gy, D / 2 + 0.004, { parent: g, r: 0.004, mat: dark() }); // grooves across the back
      for (let k = 1; k < seats; k++) block(0.012, 0.272, 0.012, 0, (k - seats / 2) * sw, 0.73, D / 2 + 0.004, { parent: g, r: 0.004, mat: dark() }); } // and one between each section, closing the panels
    for (let i = 0; i < seats; i++) { if (lite) block(sw - 0.06, 0.42, 0.18, cush, (i - (seats - 1) / 2) * sw, 0.9, D / 2 - 0.24, { parent: g, r: 0.06, rot: [0.12, 0, 0], mat: fabricM(cush) });
      else { const c = pillow(sw - 0.06, 0.42, 0.18, 2, leather(0xeceef4, backBump, 0.3, 2.6)); c.rotation.set(0.12, 0, 0); c.position.set((i - (seats - 1) / 2) * sw, 0.9, D / 2 - 0.24); g.add(c); } } // back cushions
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, lite ? toon(shell) : leather(0xdfe3ea, plainBump, 0.26, 1.2)); arm.position.set(s * W / 2, 0.07, 0); arm.scale.x = s; g.add(arm);
      arm.add(new THREE.LineSegments(new THREE.EdgesGeometry(armGeo, 25), lineMat));
      if (!lite) { arm.castShadow = arm.receiveShadow = true;
        block(0.012, 0.44, 0.82, 0, s * (W / 2 + 0.404), 0.5, 0, { parent: g, r: 0.004, mat: new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.18, metalness: 0.3 }) }); // the dark glossy panel set into the arm's end, as on the reference
        tube(0.006, 0.006, 0.7, 0x05d9e8, s * (W / 2 + 0.408), 0.27, 0, { parent: g, k: 0.8 }); // its thin light strip
        block(0.36, 0.014, 0.9, 0x2a2e38, s * (W / 2 + 0.2), 0.915, 0.1, { parent: g, r: 0.004, mat: new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 }) }); } // a recessed groove along the arm top
      const scr = panel(0.2, 0.34, armUI, s * (W / 2 + 0.14), 0.913, -0.15, { parent: g, k: 0.9 }); scr.rotation.x = -Math.PI / 2; // a screen in the arm top
      tube(0.01, 0.014, D - 0.04, 0x05d9e8, s * (W / 2 + 0.401), 0.27, 0, { parent: g, k: 1.0 }); // the light line carries on round the arms
    }
    return g;
  };
  lounge(3, 0, -4.7, 0);
  lounge(1, -2.35, -5.45, -Math.PI / 2); // the armchair, beside the coffee table and facing it
  // an invisible box over the couch takes the click: sit down and look out at the city
  const couchHit = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.95, 1.1), new THREE.MeshBasicMaterial({ visible: false }));
  couchHit.position.set(0, 0.5, -4.7); scene.add(couchHit);
  addHot(couchHit, "living", "The couch", touch ? "Tap to sit down" : "Click to sit down", () => sitDown(couchHit));
  // two throw pillows for colour
  block(0.46, 0.4, 0.13, 0xff4f8b, -1.1, 0.86, -4.5, { rot: [0.12, 0, 0.22], r: 0.06 });
  block(0.42, 0.38, 0.13, 0x0fc4d2, 1.12, 0.86, -4.5, { rot: [0.12, 0, -0.18], r: 0.06 });
  // the coffee table: a white slab on a dark base, a light line all round, vents, a screen set into the top
  block(1.5, 0.05, 0.7, 0x14161f, 0, 0.025, -5.95, { r: 0.01, ink: false });
  block(1.6, 0.32, 0.8, shell, 0, 0.21, -5.95, { r: 0.03, mat: lite ? undefined : leather(0xdfe3ea, plainBump, 0.26, 1.2) });
  block(1.66, 0.05, 0.86, 0xf0f2f7, 0, 0.395, -5.95, { r: 0.02, mat: lite ? undefined : leather(0xeceef4, shellBump, 0.24, 2.0) }); // the top, at 0.42
  if (!lite) { // the reference's table: a groove round the top's edge, dark inset panels on the sides with their slots, chamfer lines on the body
    const dark = () => new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6 }), glossy = () => new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.18, metalness: 0.3 });
    for (const dz of [-0.38, 0.38]) block(1.5, 0.012, 0.012, 0, 0, 0.421, -5.95 + dz, { r: 0.004, mat: dark() });
    for (const dx of [-0.75, 0.75]) block(0.012, 0.012, 0.76, 0, dx, 0.421, -5.95, { r: 0.004, mat: dark() });
    block(0.55, 0.012, 0.012, 0, -0.45, 0.421, -5.95, { r: 0.004, mat: dark() }); // a groove splitting the top beside the screen
    for (const dz of [-0.404, 0.404]) { block(0.9, 0.2, 0.012, 0, 0, 0.17, -5.95 + dz, { r: 0.004, mat: glossy() }); // inset dark panels, front and back
      for (let i = 0; i < 6; i++) block(0.014, 0.12, 0.016, 0, -0.3 + i * 0.12, 0.17, -5.95 + dz, { r: 0.003, mat: dark() }); } // their slots
    for (const dx of [-0.804, 0.804]) block(0.012, 0.2, 0.5, 0, dx, 0.17, -5.95, { r: 0.004, mat: glossy() }); // and on the ends
  }
  for (const dz of [-0.403, 0.403]) tube(1.6, 0.012, 0.01, 0x05d9e8, 0, 0.29, -5.95 + dz, { k: 1.0 });
  for (const dx of [-0.803, 0.803]) tube(0.01, 0.012, 0.8, 0x05d9e8, dx, 0.29, -5.95, { k: 1.0 });
  if (lite) for (let i = 0; i < 4; i++) block(0.2, 0.014, 0.01, 0x14161f, -0.45 + i * 0.3, 0.15, -5.95 + 0.403, { r: 0.004, ink: false }); // vents
  { const t = panel(0.42, 0.2, tableUI, 0.5, 0.4215, -6.08, { k: 0.9 }); t.rotation.x = -Math.PI / 2; }
  // a mug
  const glaze = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.14, metalness: 0, roughnessMap: wearTex() }); // fired ceramic with a gloss glaze
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.11, 32, 1, !lite), lite ? toon(0xf4f3ff) : glaze(0xf4f3ff)); mug.position.set(-0.62, 0.475, -6.12); scene.add(mug); if (!lite) mug.material.side = THREE.DoubleSide; // open at the top, so you see inside
  if (!lite) { const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 10, 24, Math.PI), glaze(0xf4f3ff)); handle.position.set(0.055, 0.005, 0); handle.rotation.z = -Math.PI / 2; mug.add(handle);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32), new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.08 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.038; mug.add(coffee); const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32), mug.material); bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.054; mug.add(bottom); mug.castShadow = true; }
  const mh = new THREE.Mesh(mug.geometry, inkMat); mh.scale.setScalar(1.18); mug.add(mh);
  // a halo lamp: two neon rings turning slowly around a floating orb, on a slim black stem
  // (desktop: a real luminaire. Machined steel base and stem, the rings frosted acrylic tubes lit from inside and
  // carried on steel spokes from a hub, a bracket up from the stem holding the hub, the orb a frosted glass globe)
  const lamp = new THREE.Group(); lamp.position.set(2.6, 0, -4.75); scene.add(lamp);
  const frosted = (c) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.5, emissive: new THREE.Color(c), emissiveIntensity: 0.5, depthWrite: false });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.05, 48), lite ? toon(0x16102e) : steelM(0x4a4e5a)); base.position.y = 0.025; lamp.add(base);
  if (!lite) { const foot = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.006, 6, 48), new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.9 })); foot.rotation.x = Math.PI / 2; foot.position.y = 0.004; lamp.add(foot); // a rubber foot
    const chamfer = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.004, 6, 48), steelM(0xb8bcc8)); chamfer.rotation.x = Math.PI / 2; chamfer.position.y = 0.05; lamp.add(chamfer); } // the bright machined edge
  const baseInk = new THREE.Mesh(base.geometry, inkMat); baseInk.scale.set(1.06, 1.2, 1.06); base.add(baseInk);
  const rimLight = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.008, 6, 32), glowMat(0x05d9e8, 1.3)); rimLight.rotation.x = Math.PI / 2; rimLight.position.y = 0.05; lamp.add(rimLight);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 1.15, 24), lite ? toon(0x16102e) : steelM(0x8a8f9c)); stem.position.y = 0.62; lamp.add(stem);
  if (!lite) { const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.06, 24), steelM(0x4a4e5a)); collar.position.y = 0.08; lamp.add(collar);
    for (let i = 0; i < 12; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.006), steelM(0x2a2e38)); const a = (i / 12) * Math.PI * 2; rib.position.set(Math.cos(a) * 0.034, 0.08, Math.sin(a) * 0.034); rib.rotation.y = -a; lamp.add(rib); } } // a knurled collar
  const stemInk = new THREE.Mesh(stem.geometry, inkMat); stemInk.scale.set(1.5, 1.01, 1.5); stem.add(stemInk);
  tube(0.012, 0.9, 0.012, 0xff2a6d, 0.022, 0.62, 0, { parent: lamp, k: 1.1 }); // a thin light line up the stem
  const halo = new THREE.Group(); halo.position.y = 1.58; lamp.add(halo);
  const ring = (R, r, color, k) => { // on desktop: a glowing core inside a frosted tube, on three steel spokes from the hub
    const g = new THREE.Group(); const core = new THREE.Mesh(new THREE.TorusGeometry(R, lite ? r : r * 0.5, 10, 64), glowMat(color, k)); g.add(core);
    if (!lite) { g.add(new THREE.Mesh(new THREE.TorusGeometry(R, r, 12, 64), frosted(color)));
      const gun = new THREE.MeshStandardMaterial({ color: 0x3a3d46, metalness: 0.8, roughness: 0.4 });
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.018, 24), gun)); // its bearing collar round the hub
      for (let i = 0; i < 3; i++) { const len = R - 0.046, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 8), gun); sp.rotation.z = Math.PI / 2; sp.position.x = 0.036 + len / 2; const piv = new THREE.Group(); piv.rotation.y = (i / 3) * Math.PI * 2; piv.add(sp); g.add(piv); } }
    return g; };
  const outer = ring(0.34, 0.022, 0xff2a6d, 1.25); halo.add(outer); if (!lite) outer.position.y = 0.012;
  const inner = ring(0.24, 0.014, 0x05d9e8, 1.2); halo.add(inner); if (!lite) inner.position.y = -0.012;
  if (!lite) { const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 24), steelM(0x4a4e5a)); halo.add(hub); // the hub the rings turn on
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.34, 12), steelM(0x8a8f9c)); arm.position.y = -0.19; halo.add(arm); } // and the bracket holding it up from the stem
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), toon(0x16102e)); clamp.position.y = -0.36; halo.add(clamp);
  const orbG = new THREE.Group(); orbG.position.y = lite ? 0 : 0.1; halo.add(orbG); // desktop: the globe sits up on the hub, not inside it
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 32, 24), lite ? glowMat(0xffd6ea, 1.15) : frosted(0xffd6ea)); orbG.add(orb);
  if (!lite) { orb.material.opacity = 0.62; orb.material.emissiveIntensity = 0.9; orb.add(new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), glowMat(0xfff0f6, 1.6))); } // the LED pellet inside the frosted globe
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, "rgba(255,42,109,.45)"); g.addColorStop(1, "rgba(255,42,109,0)"); x.fillStyle = g; x.fillRect(0, 0, w, w);
  }), transparent: true, depthWrite: false, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.032; lamp.add(pool); pool.visible = lite; // soft light on the rug (desktop: the lamp's own light and shadow do this)
  const lampLight = new THREE.PointLight(0xff4f8b, 2.6, 6); lampLight.position.set(2.6, 1.58, -4.75); lampLight.userData.shadow = 2; scene.add(lampLight);
  animators.push((now) => {
    outer.rotation.y = now / 3200; inner.rotation.y = -now / 2300; inner.rotation.x = Math.sin(now / 2600) * 0.35;
    orb.position.y = Math.sin(now / 900) * 0.03; lampLight.intensity = 2.6 + Math.sin(now / 1300) * 0.25; // a slow breathe
  });
  // a PC tower in the corner by the chess table: dark steel, a glass side facing the room, fans glowing inside
  {
    const pc = new THREE.Group(); pc.position.set(5.5, 0, -6.45); scene.add(pc); // glass on the -x side (towards the room), front facing +z
    // the case is open on the glass side: a steel body at the back, a frame round the glass, the parts in between
    block(0.24, 0.66, 0.56, 0, 0.03, 0.36, 0, { parent: pc, r: 0.02, mat: steelM(0x4a5064) });
    for (const y of [0.05, 0.67]) block(0.07, 0.04, 0.56, 0, -0.115, y, 0, { parent: pc, r: 0.01, mat: steelM(0x4a5064) });
    for (const z of [-0.265, 0.265]) block(0.07, 0.66, 0.03, 0, -0.115, 0.36, z, { parent: pc, r: 0.01, mat: steelM(0x4a5064) });
    for (const dz of [-0.22, 0.22]) block(0.28, 0.03, 0.06, 0x14161f, 0, 0.015, dz, { parent: pc, r: 0.01 }); // feet
    block(0.004, 0.58, 0.5, 0x0b0c12, -0.091, 0.36, 0, { parent: pc, ink: false }); // the dark back of the inside
    const fans = [];
    for (let i = 0; i < 3; i++) { // three intake fans down the front, behind the glass
      const fan = new THREE.Group(); fan.position.set(-0.12, 0.18 + i * 0.17, 0.17); fan.rotation.y = -Math.PI / 2; pc.add(fan);
      fan.add(new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.007, 6, 28), glowMat(i === 1 ? 0xff2a6d : 0x05d9e8, 1.2)));
      const blades = new THREE.Group(); fan.add(blades);
      for (let b = 0; b < 5; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.003), toon(0x2a2e3a)); bl.position.x = 0.028; const arm = new THREE.Group(); arm.rotation.z = (b / 5) * Math.PI * 2; arm.add(bl); blades.add(arm); }
      fans.push(blades);
    }
    block(0.03, 0.05, 0.3, 0x1b1e27, -0.11, 0.34, -0.08, { parent: pc, r: 0.008, ink: false }); // the graphics card...
    tube(0.004, 0.012, 0.28, 0xff2a6d, -0.127, 0.34, -0.08, { parent: pc, k: 1.2 }); // ...with its light bar
    const cooler = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 24), glowMat(0x7ff6ff, 1.1)); cooler.rotation.y = Math.PI / 2; cooler.position.set(-0.12, 0.52, -0.1); pc.add(cooler); // CPU cooler ring
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.58), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.1, depthWrite: false }));
    glass.rotation.y = -Math.PI / 2; glass.position.set(-0.152, 0.36, 0); pc.add(glass);
    tube(0.012, 0.012, 0.004, 0x2bff88, 0.09, 0.62, 0.281, { parent: pc, k: 2 }); // power light
    tube(0.004, 0.5, 0.004, 0x05d9e8, -0.1, 0.36, 0.281, { parent: pc, k: 0.9 }); // a light line down the front
    animators.push((now, dt) => { if (!reduce) fans.forEach((f, i) => { f.rotation.z += dt * (0.006 + i * 0.001); }); });
  }
  // neon art: I stack sats
  sign("STACK SATS", 0.42, -5.88, 2.05, -4.8, { color: "#f7931a", rotY: Math.PI / 2, k: 0.92, glow: 0.08, core: 0 }); // just the letters: a tight glow keeps them readable
  tube(11.6, 0.03, 0.06, 0xff2a6d, 0, H - 0.03, -0.25, { k: 1.4 });
  winLight = new THREE.PointLight(0x5a8fff, lite ? 4.5 : 2.0, 9); winLight.position.set(0, 2.2, -6.2); winLight.userData.shadow = 1; scene.add(winLight); // cool city light
  const fill = new THREE.PointLight(0x05d9e8, 1.2, 10); fill.position.set(3.5, 2.6, -2); scene.add(fill);
  // neon caught in the glossy floor: soft pools under the window and the tubes
  const floorGlow = (w, d, x, z, col, o) => { const t = canvasTex(256, 128, (c, cw, ch) => { const gr = c.createRadialGradient(cw / 2, ch / 2, 4, cw / 2, ch / 2, cw / 2); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.fillRect(0, 0, cw, ch); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.raycast = () => {}; scene.add(m); };
  floorGlow(5.6, 1.4, 0, -6.4, "rgba(5,217,232,1)", 0.22); for (const s of [-1, 1]) floorGlow(0.9, 1.0, s * 3.02, -6.6, "rgba(255,42,109,1)", 0.3);
  // the media wall, by the front door: a hologram home screen over an electric fireplace
  { const hudC = document.createElement("canvas"); hudC.width = 1100; hudC.height = 560;
    const hudT = new THREE.CanvasTexture(hudC); hudT.colorSpace = THREE.SRGBColorSpace;
    const drawHome = () => { const x = hudC.getContext("2d"), W = 1100, Hh = 560, G = "#36ffb0", C = "#05d9e8";
      x.clearRect(0, 0, W, Hh); x.fillStyle = "rgba(6,40,30,.35)"; x.fillRect(0, 0, W, Hh);
      x.strokeStyle = G; x.lineWidth = 4; x.shadowColor = G; x.shadowBlur = 16; x.strokeRect(10, 10, W - 20, Hh - 20); x.shadowBlur = 0;
      x.fillStyle = G; x.font = "700 44px Rajdhani"; x.fillText("APT 4B // HOME", 40, 70); x.font = "500 22px 'JetBrains Mono'"; x.fillStyle = C; x.fillText("ALL SYSTEMS NOMINAL", 40, 104);
      const now = new Date(), rows = [["CLIMATE", "21°C"], ["POWER", "3.2 kW"], ["NETWORK", "ONLINE"], ["FIN", "HOME"], ["PHOEBE", "HOME"]];
      rows.forEach(([k, v], i) => { x.fillStyle = "rgba(54,255,176,.75)"; x.font = "500 24px 'JetBrains Mono'"; x.fillText(k, 40, 160 + i * 52); x.fillStyle = "#e9fff6"; x.fillText(v, 230, 160 + i * 52); x.fillStyle = "rgba(54,255,176,.25)"; x.fillRect(40, 172 + i * 52, 330, 2); });
      // a globe of rings and a little bar chart, like a city status board
      x.strokeStyle = G; x.lineWidth = 2; for (const r of [70, 110, 150]) { x.beginPath(); x.arc(640, 300, r, 0, Math.PI * 2); x.stroke(); }
      x.beginPath(); x.ellipse(640, 300, 150, 50, 0, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.ellipse(640, 300, 50, 150, 0, 0, Math.PI * 2); x.stroke();
      const a = now.getTime() / 900; x.fillStyle = C; x.beginPath(); x.arc(640 + Math.cos(a) * 150, 300 + Math.sin(a) * 50, 7, 0, Math.PI * 2); x.fill();
      for (let i = 0; i < 8; i++) { const bh = 30 + ((i * 53 + now.getSeconds() * 7) % 110); x.fillStyle = i === 5 ? "#ff2a6d" : "rgba(5,217,232,.8)"; x.fillRect(850 + i * 26, 460 - bh, 16, bh); }
      x.fillStyle = "rgba(255,255,255,.05)"; for (let y = 0; y < Hh; y += 5) x.fillRect(0, y, W, 2); // scan lines
      hudT.needsUpdate = true; };
    drawHome(); setInterval(drawHome, 500);
    const hud = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.12), new THREE.MeshBasicMaterial({ map: hudT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    hud.position.set(-3.2, 1.95, -0.16); hud.rotation.y = Math.PI; hud.raycast = () => {}; scene.add(hud);
    animators.push((now) => { hud.material.opacity = reduce ? 0.9 : Math.sin(now / 71) > 0.985 ? 0.5 : 0.88 + Math.sin(now / 300) * 0.06; });
    for (const s of [-1, 1]) block(0.05, 0.05, 0.05, 0x2a2e3a, -3.2 + s * 1.12, 2.5, -0.13, { r: 0.01 }); // the emitters it hangs from
    // the fireplace: a long recessed slot in a steel surround, flames flickering inside, warm light spilling out
    block(2.3, 0.56, 0.14, 0, -3.2, 0.55, -0.17, { r: 0.02, mat: steelM(0x4a5064) });
    block(2.0, 0.34, 0.02, 0x07080c, -3.2, 0.55, -0.245, { r: 0.01, ink: false });
    const flameT = canvasTex(512, 128, (x, w, h) => { for (let i = 0; i < 40; i++) { const fx = (i / 40) * w + Math.sin(i * 7) * 8, fh = 50 + ((i * 37) % 60); const gr = x.createLinearGradient(0, h, 0, h - fh); gr.addColorStop(0, "rgba(255,190,90,1)"); gr.addColorStop(0.5, "rgba(255,110,40,.85)"); gr.addColorStop(1, "rgba(255,60,20,0)"); x.fillStyle = gr; x.beginPath(); x.moveTo(fx - 9, h); x.quadraticCurveTo(fx - 4, h - fh * 0.6, fx, h - fh); x.quadraticCurveTo(fx + 4, h - fh * 0.6, fx + 9, h); x.fill(); } });
    flameT.wrapS = THREE.RepeatWrapping;
    const flames = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.3), new THREE.MeshBasicMaterial({ map: flameT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    flames.position.set(-3.2, 0.54, -0.26); flames.rotation.y = Math.PI; flames.raycast = () => {}; scene.add(flames);
    let fireU = null;
    if (!lite) { /* desktop: a bioethanol burner. Flames drawn by a shader (layered noise rising and curling, thinning as they climb,
        blue at the base and gold at the tips), on a bed of river stones, behind a glass screen */
      flames.visible = false; fireU = { time: { value: 0 } };
      const fm = new THREE.ShaderMaterial({ uniforms: fireU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `uniform float time; varying vec2 vUv;
          float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
          float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * n(p); p *= 2.03; a *= 0.5; } return v; }
          void main() {
            vec2 uv = vUv; float y = uv.y;
            vec2 q = vec2(uv.x * 14.0, y * 2.2 - time * 1.5);
            float warp = fbm(q * 0.55 + vec2(time * 0.25, 0.0));
            float f = fbm(q + vec2(warp * 1.4, 0.0));
            float ends = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
            float shape = f * 1.4 - y * 1.55 - 0.02;
            float a = smoothstep(0.12, 0.5, shape) * ends;
            vec3 col = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.82, 0.42), smoothstep(0.25, 0.85, shape));
            col = mix(col, vec3(0.25, 0.45, 1.0), smoothstep(0.14, 0.0, y) * 0.55);
            gl_FragColor = vec4(col * a * 0.8, a);
          }` });
      const fire = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.32), fm); fire.position.set(-3.2, 0.56, -0.262); fire.rotation.y = Math.PI; fire.raycast = () => {}; scene.add(fire);
      const stoneM = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.55, metalness: 0 });
      let sd = 9; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 26; i++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.028 + rnd() * 0.018, 16, 10), stoneM); st.scale.set(1.3, 0.55, 0.9); st.position.set(-4.15 + i * 0.076 + rnd() * 0.02, 0.405, -0.252 - rnd() * 0.015); st.rotation.y = rnd() * 3; scene.add(st); } /* river stones on the burner */
      const ember = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.03), glowMat(0xff6a20, 1.4)); ember.position.set(-3.2, 0.395, -0.249); ember.rotation.y = Math.PI; scene.add(ember); /* the burner glowing between them */
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.34), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false })); screen.position.set(-3.2, 0.55, -0.2475 - 0.02); screen.rotation.y = Math.PI; screen.raycast = () => {}; scene.add(screen); } /* the glass screen */
    const fireLight = new THREE.PointLight(0xff9a3c, 2.4, 5); fireLight.position.set(-3.2, 0.7, -0.7); scene.add(fireLight);
    floorGlow(2.6, 1.2, -3.2, -0.7, "rgba(255,150,60,1)", 0.25);
    animators.push((now, dt) => { if (reduce) return; if (fireU) fireU.time.value = now / 1000; flameT.offset.x += dt * 0.00012; flames.scale.y = 0.9 + Math.sin(now / 130) * 0.06 + Math.sin(now / 47) * 0.04; fireLight.intensity = 2.2 + Math.sin(now / 90) * 0.3 + Math.sin(now / 37) * 0.2; }); }
  // plants along the window sill, and a tall one by the door
  { const leafC = [0x1fb87a, 0x2bd68f, 0x169a66];
    const plant = (x, y, z, size, tall) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(size); scene.add(g);
      block(0.16, 0.14, 0.16, 0, 0, 0.07, 0, { parent: g, r: 0.03, mat: lite ? steelM(0x4a5064) : new THREE.MeshStandardMaterial({ color: 0x4a4e58, roughness: 0.92 }) });
      if (!lite) { const soil = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 1 })); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.141; g.add(soil); }
      if (!lite) leafy(g, 0, 0.13, 0, tall ? { n: 20, len: 0.75, wid: 0.085, bend: 0.55, tilt: 0.6, seed: x * 7 } : { n: 14, len: 0.34, wid: 0.06, bend: 1.0, tilt: 0.85, seed: x * 7 + 2 });
      else for (let i = 0; i < (tall ? 9 : 6); i++) { const a = i * 2.4, lf = new THREE.Mesh(new THREE.ConeGeometry(0.035, tall ? 0.5 + (i % 3) * 0.12 : 0.22 + (i % 3) * 0.05, 4), toon(leafC[i % 3]));
        lf.position.set(Math.cos(a) * 0.03, tall ? 0.38 : 0.22, Math.sin(a) * 0.03); lf.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35); g.add(lf); const ink = new THREE.Mesh(lf.geometry, inkMat); ink.scale.setScalar(1.12); lf.add(ink); }
      return g; };
    for (const [px, sz] of [[-2.3, 1], [-1.7, 0.8], [1.3, 1.1], [2.1, 0.85]]) plant(px, 0.96, -6.82, sz, false); // clear of the Capitol and the Monument
    plant(-1.05, 0, -0.45, 1.6, true); }
};

// ---------- the theater (behind the living room's back wall: x -9 … 0, z -7 … -17) ----------
let screenTex, screenCanvas, latest = null;
const shelfFaces = []; // { row, mesh, w, h, imax? }: the clickable shelf photos
const buildTheater = () => {
  // Walls in dark acoustic slats (vertical fins with shadow gaps), a dark composite floor
  const slatTex = (len) => { const t = canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = "#1a1c2b"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#202335" : "#1d2031"; x.fillRect(i * 32 + 4, 0, 24, h); x.fillStyle = "rgba(255,255,255,.04)"; x.fillRect(i * 32 + 4, 0, 2, h); }
    x.fillStyle = "#101119"; x.fillRect(0, h - 22, w, 22); // skirting
  }); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 0.8, 1); return t; };
  const wall = (w, h, d, x, y, z, len) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(0xffffff, { map: slatTex(len) })); m.position.set(x, y, z); scene.add(m); return m; };
  slab(9, 0.1, 10, 0x15161f, -4.5, -0.05, -12); slab(9, 0.1, 10, 0x0c0d14, -4.5, H + 0.05, -12);
  wall(0.2, H, 10, -9, H / 2, -12, 10); wall(0.2, H, 9.8, 0, H / 2, -12.1, 9.8); // the right one stops short of the living room window
  wall(9, H, 0.2, -4.5, H / 2, -17, 9); wall(3, H, 0.2, -7.5, H / 2, -7, 3);
  wall(2.6, H, 0.1, -1.3, H / 2, -7.16, 2.6); // behind the living room window's left half, which would otherwise look into the living room
  // the screen: a canvas showing my latest Letterboxd watch
  block(6.5, 3.7, 0.12, 0x0b0816, -4.5, 2.0, -16.86, { r: 0.04 });
  screenCanvas = document.createElement("canvas"); screenCanvas.width = 1600; screenCanvas.height = 900;
  screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 3.43), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(-4.5, 2.0, -16.79); scene.add(screen);
  addHot(screen, "theater", "Now showing", "Click to read my review on Letterboxd", () => latest?.link && window.open(latest.link, "_blank", "noopener"));
  // steel speaker towers either side of the screen, each with three glowing driver rings
  for (const x of [-8.15, -0.85]) {
    block(0.7, 3.3, 0.4, 0, x, 1.65, -16.6, { r: 0.05, mat: steelM(0x4a5064) });
    const grille = block(0.56, 3.0, 0.02, 0x0b0c12, x, 1.65, -16.39, { r: 0.01, ink: false }); // the grille
    const rings = [0.7, 1.5, 2.3].map((y, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(i === 0 ? 0.2 : 0.14, 0.012, 6, 32), glowMat(i === 1 ? 0xff2a6d : 0x05d9e8, 1.0)); ring.position.set(x, y, -16.37); scene.add(ring); return ring; });
    if (!lite) { /* desktop: piano-black cabinets, a woven cloth grille with the drivers' rims pressing through it, a small status light */
      rings.forEach((rg) => (rg.visible = false));
      const cab = scene.children[scene.children.indexOf(grille) - 1]; if (cab?.isMesh) cab.material = new THREE.MeshStandardMaterial({ color: 0x0a0a0d, roughness: 0.14, metalness: 0.1, roughnessMap: wearTex() });
      const cloth = canvasTex(256, 1372, (c, w, h) => { c.fillStyle = "#121318"; c.fillRect(0, 0, w, h);
        for (let yy = 0; yy < h; yy += 3) { c.fillStyle = "rgba(255,255,255,.035)"; c.fillRect(0, yy, w, 1); } for (let xx = 0; xx < w; xx += 3) { c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(xx, 0, 1, h); } /* the weave */
        for (const [cy, rr] of [[h * (1 - 0.7 / 3.0 + 0.05), 92], [h * (1 - 1.5 / 3.0 + 0.05), 64], [h * (1 - 2.3 / 3.0 + 0.05), 64]]) { c.strokeStyle = "rgba(0,0,0,.55)"; c.lineWidth = 6; c.beginPath(); c.arc(w / 2, cy, rr, 0, 6.3); c.stroke(); c.fillStyle = "rgba(0,0,0,.2)"; c.beginPath(); c.arc(w / 2, cy, rr * 0.4, 0, 6.3); c.fill(); } }); /* the drivers behind it */
      grille.material = new THREE.MeshStandardMaterial({ map: cloth, bumpMap: cloth, bumpScale: 2, roughness: 1, metalness: 0 });
      tube(0.03, 0.006, 0.004, 0x05d9e8, x, 0.22, -16.375, { k: 1.3 }); } /* a small status light at the base */
  }
  block(7.6, 0.25, 1.2, 0x1b1e27, -4.5, 0.125, -16.2, { r: 0.04 }); // the stage
  tube(7.5, 0.015, 0.015, 0x05d9e8, -4.5, 0.25, -15.6, { k: 0.9 }); // and its edge light
  // a projector on the ceiling at the back, throwing a faint beam onto the screen
  block(0.5, 0.18, 0.4, 0, -4.5, H - 0.2, -8.2, { r: 0.03, mat: steelM(0x6c7389) });
  block(0.04, 0.12, 0.04, 0x2a2e3a, -4.5, H - 0.05, -8.2, { ink: false });
  const lensP = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), glowMat(0xdfe6ff, 1.2)); lensP.position.set(-4.5, H - 0.2, -8.41); lensP.rotation.y = Math.PI; scene.add(lensP);
  { const from = V(-4.5, H - 0.2, -8.42), to = V(-4.5, 2.0, -16.75), len = from.distanceTo(to);
    // a square pyramid (4-sided cone, turned so its sides are flat), wide end at the screen, squashed to 16:9
    const geo = new THREE.CylinderGeometry(4.3, 0.04, len, 4, 1, true); geo.rotateY(Math.PI / 4);
    const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x5a8fb8, transparent: true, opacity: 0.012, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide }));
    cone.position.copy(from).lerp(to, 0.5); cone.lookAt(to); cone.rotateX(Math.PI / 2); cone.scale.set(1, 1, 0.56); cone.raycast = () => {}; scene.add(cone); }
  const glow = new THREE.PointLight(0x9ad7ff, lite ? 5 : 2.5, 11); glow.position.set(-4.5, 2.0, -15.3); glow.userData.shadow = 1; scene.add(glow);
  // seats: two rows of steel-framed recliners, the back one on a riser with a step light
  block(9, 0.3, 2.6, 0x15161f, -4.5, 0.15, -10.3, { ink: false, r: 0.01 });
  tube(8.8, 0.012, 0.012, 0x05d9e8, -4.5, 0.29, -11.6, { k: 0.8 });
  const seat = (x, y, z) => {
    block(0.62, 0.08, 0.7, 0, x, y + 0.06, z, { r: 0.02, mat: steelM(0x4a5064) }); // base
    if (lite) { block(0.82, 0.2, 0.78, 0x2b2f3d, x, y + 0.36, z, { r: 0.08 }); // seat cushion
      block(0.82, 0.8, 0.2, 0x2b2f3d, x, y + 0.78, z + 0.36, { r: 0.08, rot: [-0.12, 0, 0] }); // reclined back
      block(0.5, 0.18, 0.14, 0x353a4c, x, y + 1.12, z + 0.4, { r: 0.06 }); } // headrest
    else { // desktop: stuffed dark leather cushions with stitched seams, the back and headrest bulging towards you
      const dk = (b, sc) => leather(0x2e3240, b, 0.38, sc);
      const sc = pillow(0.78, 0.2, 0.74, 3, dk(seatBump, 2.4)); sc.position.set(x, y + 0.36, z); scene.add(sc);
      const bk = pillow(0.78, 0.2, 0.8, 2, dk(backBump, 2.4)); bk.rotation.x = -Math.PI / 2 - 0.12; bk.position.set(x, y + 0.78, z + 0.36); scene.add(bk);
      const hd = pillow(0.5, 0.16, 0.18, 1, dk(plainBump, 1.5)); hd.rotation.x = -Math.PI / 2 - 0.12; hd.position.set(x, y + 1.14, z + 0.39); scene.add(hd);
      block(0.7, 0.05, 0.72, 0, x, y + 0.24, z, { r: 0.01, mat: new THREE.MeshStandardMaterial({ color: 0x15171f, roughness: 0.6 }) }); // the frame pan the cushion sits in
    }
    for (const s of [-1, 1]) {
      block(0.1, 0.42, 0.84, 0, x + s * 0.46, y + 0.34, z, { r: 0.03, mat: steelM(0x9aa2b4) }); // steel armrests
      tube(0.012, 0.012, 0.7, 0x05d9e8, x + s * 0.46, y + 0.56, z, { k: 0.9 }); // with a light strip along the top
      if (!lite) { const cup = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 8, 32), new THREE.MeshStandardMaterial({ color: 0x1b1e27, roughness: 0.5 })); cup.rotation.x = Math.PI / 2; cup.position.set(x + s * 0.46, y + 0.555, z - 0.34); scene.add(cup);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), new THREE.MeshStandardMaterial({ color: 0x07080c, roughness: 0.9 })); hole.rotation.x = -Math.PI / 2; hole.position.set(x + s * 0.46, y + 0.552, z - 0.34); scene.add(hole); } // a cup holder at the end of each arm
    }
  };
  for (const x of [-4.3, -2.7, -1.1]) { seat(x, 0, -12.6); seat(x, 0.3, -10.6); } // left aisle stays clear for the shelf
  for (const x of [-8.7, -0.3]) tube(0.04, 0.02, 9.6, 0x05d9e8, x, 0.02, -12, { k: 1.6 });
  // stars on the ceiling
  const pts = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) { pts[i * 3] = -8.8 + Math.random() * 8.6; pts[i * 3 + 1] = H - 0.01; pts[i * 3 + 2] = -7.2 - Math.random() * 9.6; }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pts, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, toneMapped: false }));
  scene.add(stars);
  if (!lite) { /* desktop: a fibre-optic star ceiling. Dark acoustic fabric in panels; the stars soft round points of mixed size,
      warm white with the odd faint blue or amber one, a third of them twinkling slowly */
    stars.visible = false;
    const fab = canvasTex(512, 512, (x, w, h) => { x.fillStyle = "#0e1018"; x.fillRect(0, 0, w, h); let sd = 3; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 9000; i++) { const v = 8 + r() * 22; x.fillStyle = `rgb(${v},${v + 1},${v + 8})`; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1); } /* the weave */
      x.fillStyle = "#05060a"; x.fillRect(0, 0, w, 4); x.fillRect(0, 0, 4, h); }); /* a seam between panels */
    fab.wrapS = fab.wrapT = THREE.RepeatWrapping; fab.repeat.set(9 / 1.5, 10 / 1.5);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 10), new THREE.MeshStandardMaterial({ map: fab, bumpMap: fab, bumpScale: 1.5, roughness: 1, metalness: 0 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(-4.5, H - 0.004, -12); ceil.receiveShadow = true; scene.add(ceil);
    const N = 240, pos = new Float32Array(N * 3), size = new Float32Array(N), col = new Float32Array(N * 3), tw = new Float32Array(N * 2); let sd = 17; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) { pos[i * 3] = -8.8 + r() * 8.6; pos[i * 3 + 1] = H - 0.012; pos[i * 3 + 2] = -7.2 - r() * 9.6; size[i] = 0.008 + Math.pow(r(), 3) * 0.03;
      const k = r(), c = k < 0.08 ? [0.6, 0.75, 1] : k < 0.14 ? [1, 0.78, 0.5] : [1, 0.95, 0.86]; col.set(c, i * 3); tw[i * 2] = r() < 0.33 ? 0.5 + r() * 1.5 : 0; tw[i * 2 + 1] = r() * 6.28; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); sg.setAttribute("size", new THREE.BufferAttribute(size, 1)); sg.setAttribute("color", new THREE.BufferAttribute(col, 3)); sg.setAttribute("tw", new THREE.BufferAttribute(tw, 2));
    const starU = { time: { value: 0 }, scale: { value: 800 } };
    const fibre = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: starU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      vertexShader: `attribute float size; attribute vec3 color; attribute vec2 tw; uniform float time, scale; varying vec3 vC; varying float vB;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.5, size * scale / -mv.z);
          vC = color; vB = tw.x > 0.0 ? 0.55 + 0.45 * sin(time * tw.x + tw.y) : 1.0; }`,
      fragmentShader: `varying vec3 vC; varying float vB; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 5.0) + 0.6 * exp(-d * d * 40.0); if (a < 0.02) discard; gl_FragColor = vec4(vC * a * vB * 1.3, a); }` }));
    fibre.frustumCulled = false; fibre.raycast = () => {}; scene.add(fibre);
    animators.push((now) => { starU.time.value = now / 1000; starU.scale.value = renderer.domElement.height * 0.9; }); }
  // the movie shelf on the left wall, built from my real shelf photos (shelf-data.js) like the main page's,
  // and the IMAX case on its own stand beside it. Group space: x along the wall (toward the screen),
  // y up, z out of the wall into the room.
  const ROWS = window.SHELF || [], frameC = 0x2b1d55, W = 1.6, T = 0.05, D = 0.42;
  const frameM = lite ? undefined : new THREE.MeshStandardMaterial({ color: frameC, roughness: 0.42, metalness: 0.05, roughnessMap: wearTex() }); // satin powder-coat, a little worn
  const tex = (src) => { const t = loader.load(src); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const bc = new THREE.Group(); bc.position.set(-8.9, 0, -14.6); bc.rotation.y = Math.PI / 2; scene.add(bc);
  let y = 0.12;
  block(W + 2 * T, 0.12, D, frameC, 0, 0.06, D / 2, { parent: bc, r: 0.02, mat: frameM });
  for (const row of ROWS.filter((r) => r.id !== "imax").reverse()) {
    const h = W / row.aspect;
    row._tex = tex(row.img);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, h), new THREE.MeshBasicMaterial({ map: row._tex, color: 0xe8e8e8 }));
    face.position.set(0, y + h / 2, D - 0.1); bc.add(face);
    shelfFaces.unshift({ row, mesh: face, w: W, h });
    y += h;
    block(W + 2 * T, T, D, frameC, 0, y + T / 2, D / 2, { parent: bc, r: 0.015, mat: frameM }); y += T;
  }
  for (const s of [-1, 1]) block(T, y, D, frameC, s * (W / 2 + T / 2), y / 2, D / 2, { parent: bc, r: 0.015, mat: frameM });
  block(W + 2 * T, y, 0.03, 0x120c22, 0, y / 2, 0.015, { parent: bc, ink: false });
  addHot(bc, "theater", "My movie shelf", touch ? "Tap to walk over and browse it" : "Click to walk over and browse it", () => go("shelf"));
  const imax = ROWS.find((r) => r.id === "imax");
  if (imax) {
    const st = new THREE.Group(); st.position.set(-8.9, 0, -12.65); st.rotation.y = Math.PI / 2; scene.add(st);
    const w = 1.3, h = w / imax.aspect;
    block(1.0, 1.05, 0.5, frameC, 0, 0.525, 0.25, { parent: st, r: 0.04, mat: frameM });
    block(w + 0.06, h + 0.06, 0.36, 0xd9d7e6, 0, 1.05 + h / 2 + 0.03, 0.27, { parent: st, r: 0.03 });
    imax._tex = tex(imax.img); imax._front = imax.front ? tex(imax.front) : imax._tex;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: imax._front, color: 0xe8e8e8 }));
    face.position.set(0, 1.05 + h / 2 + 0.03, 0.455); st.add(face);
    shelfFaces.unshift({ row: imax, mesh: face, w, h, imax: true });
    addHot(st, "theater", "IMAX case", touch ? "Tap to walk over and open it" : "Click to walk over and open it", () => go("shelf"));
  }
  sign("MY SHELF", 0.26, -8.85, 2.6, -12.65, { color: "#05d9e8", rotY: Math.PI / 2, k: 1.5 });
  // popcorn machine: a cinema popcorn cart in steel and glass. A cabinet with a smoked door, a glass case on steel
  // posts with a kettle hanging inside and a warm-lit mound of popcorn (kernels pop out of the kettle and land on it),
  // a marquee of chasing bulbs on the roof, and a hologram bucket turning above. Its front faces the seats (+z).
  {
    const pm = new THREE.Group(); pm.position.set(-1.1, 0, -14.6); scene.add(pm);
    const B = (w, h, d, x, y, z, o) => block(w, h, d, o.c ?? 0, x, y, z, { parent: pm, r: o.r ?? 0.02, mat: o.mat, ink: o.ink ?? true });
    // the cabinet
    for (const [fx, fz] of [[-0.3, -0.24], [0.3, -0.24], [-0.3, 0.24], [0.3, 0.24]]) B(0.06, 0.05, 0.06, fx, 0.025, fz, { c: 0x14161f, r: 0.01 });
    B(0.72, 0.76, 0.6, 0, 0.43, 0, { mat: steelM(0x9aa2b4), r: 0.04 });
    B(0.52, 0.46, 0.012, 0, 0.42, 0.301, { c: 0x0b0c12, r: 0.01, ink: false }); // smoked glass door
    B(0.02, 0.2, 0.02, 0.22, 0.42, 0.31, { mat: steelM(0xc4cad8), r: 0.008 }); // its pull
    tube(0.62, 0.014, 0.012, 0xf9f002, 0, 0.74, 0.305, { parent: pm, k: 0.9 }); // a light line under the counter
    B(0.74, 0.03, 0.62, 0, 0.825, 0, { mat: steelM(0x6c7389), r: 0.01 }); // the counter top
    // the glass case: four steel corner posts, glass all round
    const CH = 0.6, CB = 0.84; // case height, case bottom
    for (const [px, pz] of [[-0.34, -0.28], [0.34, -0.28], [-0.34, 0.28], [0.34, 0.28]]) B(0.035, CH, 0.035, px, CB + CH / 2, pz, { mat: steelM(0xc4cad8), r: 0.008 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.66, CH, 0.54), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.1, depthWrite: false }));
    glass.position.y = CB + CH / 2; pm.add(glass);
    tube(0.6, 0.006, 0.006, 0xbfefff, 0, CB + CH - 0.03, 0.27, { parent: pm, k: 0.5 }); // a glint along the top of the front pane
    // a warm light inside, and the mound of popcorn it shines on
    const warm = new THREE.PointLight(0xffd27a, 0.35, 1.2); warm.position.set(0, CB + CH - 0.08, 0); pm.add(warm);
    tube(0.5, 0.01, 0.04, 0xffe2a0, 0, CB + CH - 0.012, 0, { parent: pm, k: 0.6 });
    /* desktop: popped kernels are puffy, lumpy little clouds, not crystals. A few shapes made once and shared, lightly glossy with butter */
    const kernelShapes = lite ? null : [1, 2, 3, 4].map((seed) => { const g = new THREE.SphereGeometry(1, 22, 16), p = g.attributes.position, v = new THREE.Vector3(); /* indexed, so the shading is smooth */
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = Math.sin(v.x * 5 + seed) * Math.sin(v.y * 4.3 + seed * 2) * Math.sin(v.z * 4.7 - seed); const lobes = 0.78 + 0.32 * Math.max(0, n) + 0.08 * Math.sin(v.x * 11 + v.z * 9 + seed);
        v.multiplyScalar(lobes); v.y *= 0.85; p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; });
    let kn = 0; const kernel = (r) => { if (lite) return new THREE.IcosahedronGeometry(r, 0); const g = kernelShapes[kn++ % 4].clone(); g.scale(r, r, r); return g; };
    const cream = lite ? toon(0xe9d9ad) : new THREE.MeshStandardMaterial({ color: 0xf4ead0, roughness: 0.55 }), butter = lite ? toon(0xdcb85a) : new THREE.MeshStandardMaterial({ color: 0xe8c86a, roughness: 0.3 });
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()), x = Math.cos(a) * rr * 0.3, z = Math.sin(a) * rr * 0.24;
      const k = new THREE.Mesh(kernel(0.022 + rnd() * 0.012), rnd() < 0.3 ? butter : cream);
      k.position.set(x, CB + 0.02 + (1 - rr) * 0.16 * (0.6 + rnd() * 0.4), z); k.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); pm.add(k);
    }
    // the kettle, hanging from the roof and tipped a little toward the front, brimming
    const kettle = new THREE.Group(); kettle.position.set(0.06, CB + CH - 0.2, -0.02); kettle.rotation.x = 0.25; pm.add(kettle);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.11, 24, 1, true), steelM(0xc4cad8)); pot.material.side = THREE.DoubleSide; kettle.add(pot);
    const potBase = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), steelM(0x6c7389)); potBase.rotation.x = Math.PI / 2; potBase.position.y = -0.055; kettle.add(potBase);
    for (let i = 0; i < 12; i++) { const k = new THREE.Mesh(kernel(0.022), i % 3 ? cream : butter); const a = i * 0.52; k.position.set(Math.cos(a) * 0.07, 0.055 + (i % 2) * 0.015, Math.sin(a) * 0.07); kettle.add(k); }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.17, 8), steelM(0x6c7389)); rod.position.set(0.06, CB + CH - 0.085, -0.02); pm.add(rod);
    // popping: a few kernels jump out of the kettle, arc over and drop onto the pile
    const pops = [0, 1, 2, 3, 4, 5].map((i) => { const k = new THREE.Mesh(kernel(0.024), i % 2 ? cream : butter); pm.add(k); return { k, ph: i / 6, dx: (i % 3 - 1) * 0.12, dz: ((i * 7) % 3 - 1) * 0.08 }; });
    // the roof: a steel cap with a vent dome, and a marquee of bulbs along the front
    B(0.78, 0.08, 0.66, 0, CB + CH + 0.04, 0, { mat: steelM(0x6c7389), r: 0.03 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steelM(0x9aa2b4)); dome.position.y = CB + CH + 0.08; pm.add(dome);
    { const ink = new THREE.Mesh(dome.geometry, inkMat); ink.scale.setScalar(1.06); dome.add(ink); }
    const bulbs = [];
    for (let i = 0; i < 11; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), glowMat(0xffd27a, 1)); b.position.set(-0.35 + i * 0.07, CB + CH + 0.04, 0.335); pm.add(b); bulbs.push(b); }
    // the hologram above it
    const holo = (color, o) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const HY = CB + CH + 0.42;
    const pb = new THREE.Group(); pb.position.y = HY; pm.add(pb);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.2, 10, 1, true), holo(0xff2a6d, 0.45)); pb.add(bucket);
    pb.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.13, 0.09, 0.2, 10)), new THREE.LineBasicMaterial({ color: new THREE.Color(0xff7aa8).multiplyScalar(1.4), toneMapped: false })));
    for (let i = 0; i < 7; i++) { const k = new THREE.Mesh(kernel(0.035), holo(0xfff2b0, 0.4)); k.position.set(Math.cos(i * 0.9) * 0.07, 0.11 + (i % 3) * 0.025, Math.sin(i * 0.9) * 0.07); pb.add(k); }
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.11, 24), holo(0xf9f002, 0.45)); pad.rotation.x = -Math.PI / 2; pad.position.y = CB + CH + 0.225; pm.add(pad); // the emitter, on top of the dome
    sign("POPCORN", 0.12, -1.1, HY + 0.3, -14.6, { color: "#f9f002", k: 1.15 });
    animators.push((now) => {
      if (reduce) return;
      pb.rotation.y = now / 1600; pb.position.y = HY + Math.sin(now / 800) * 0.02; bucket.material.opacity = Math.sin(now / 90) > 0.98 ? 0.18 : 0.45;
      const chase = Math.floor(now / 140); bulbs.forEach((b, i) => { b.material.color.setHex((i + chase) % 3 ? 0x8a6a30 : 0xffe2a0); }); // chasing marquee
      for (const p of pops) { // out of the kettle, up, over and down onto the pile
        const t = (now / 1400 + p.ph) % 1, k = p.k;
        k.position.set(0.06 + p.dx * t, CB + CH - 0.16 + Math.sin(t * Math.PI) * 0.12 - t * (CH - 0.32), -0.02 + p.dz * t + t * 0.04);
        k.rotation.set(t * 9, t * 7, 0); k.visible = t < 0.96;
      }
    });
  }
  sign("NOW SHOWING", 0.32, -0.12, 2.65, -12.2, { color: "#ff2a6d", rotY: -Math.PI / 2, k: 1.5 }).userData.flicker = true;
  const dim = new THREE.PointLight(0x7b5cff, 3, 12); dim.position.set(-4.5, 3.0, -11); scene.add(dim);
  // touch-ups to match the living room: cove neon round the ceiling, framed posters, plants in the back corners,
  // and the screen's glow caught in the floor
  for (const x of [-8.88, -0.12]) tube(0.025, 0.025, 9.7, 0xff2a6d, x, H - 0.07, -12, { k: 1.0 });
  for (const z of [-7.12, -16.88]) tube(8.7, 0.025, 0.025, 0xffa040, -4.5, H - 0.07, z, { k: 0.9 });
  const posterArt = (title, tag, c1, c2, kind) => canvasTex(360, 540, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c1); g.addColorStop(1, c2); x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (kind === 0) { x.fillStyle = "rgba(255,220,120,.9)"; x.beginPath(); x.arc(w / 2, 220, 110, 0, Math.PI * 2); x.fill(); x.fillStyle = c2; for (let y = 200; y < 340; y += 18) x.fillRect(0, y, w, 7); }
    if (kind === 1) { x.strokeStyle = "rgba(127,246,255,.85)"; x.lineWidth = 3; for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(w / 2, 240, 30 + i * 26, 0, Math.PI * 2); x.stroke(); } x.fillStyle = "#fff"; x.beginPath(); x.arc(w / 2, 240, 14, 0, Math.PI * 2); x.fill(); }
    if (kind === 2) { x.fillStyle = "rgba(0,0,0,.5)"; for (let i = 0; i < 9; i++) { const bh = 120 + ((i * 53) % 200); x.fillRect(i * 42, 380 - bh, 36, bh); } x.fillStyle = "#ff2a6d"; x.fillRect(0, 380, w, 4); }
    if (kind === 3) { x.strokeStyle = "rgba(255,255,255,.75)"; x.lineWidth = 2; for (let i = -10; i < 20; i++) { x.beginPath(); x.moveTo(w / 2, 300); x.lineTo(i * 40, h); x.stroke(); } for (let y = 300; y < h; y += 24) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); } }
    x.fillStyle = "#fff"; x.font = "700 52px Rajdhani"; x.textAlign = "center"; x.fillText(title, w / 2, 450);
    x.font = "500 17px 'JetBrains Mono'"; x.fillStyle = "rgba(255,255,255,.8)"; x.fillText(tag, w / 2, 485);
    x.font = "400 11px Inter"; x.fillStyle = "rgba(255,255,255,.5)"; x.fillText("A PIERPONT HOUSE FEATURE · COMING SOON", w / 2, 520); x.textAlign = "left";
  });
  [["NEON TIDE", "THE CITY NEVER SLEEPS", "#ff4f8b", "#2a0b3a", 0, -0.12, -8.7, -Math.PI / 2, "#ff2a6d"],
   ["LAST SIGNAL", "SOMEONE IS LISTENING", "#0b3a5a", "#050816", 1, -0.12, -10.5, -Math.PI / 2, "#05d9e8"],
   ["ORBITAL", "ALL ABOARD AT MIDNIGHT", "#3a1062", "#0b0424", 2, -8.88, -8.7, Math.PI / 2, "#b98cff"],
   ["GRIDRUNNER", "NO SPEED LIMIT", "#1f3cff", "#05030f", 3, -8.88, -10.5, Math.PI / 2, "#f9f002"]].forEach(([t, tag, c1, c2, kind, px, pz, rotY, neonC], i) => {
    // each frame shows the #1 film of one of my Letterboxd lists once data/feeds.json loads (made-up art until then);
    // click it for that list's top 5
    const off = Math.sin(rotY) * 0.03, offz = Math.cos(rotY) * 0.03;
    const pg = new THREE.Group(); scene.add(pg);
    block(0.04, 1.36, 0.94, 0x0b0c12, px, 1.75, pz, { r: 0.01, parent: pg });
    const art = panel(0.84, 1.26, posterArt(t, tag, c1, c2, kind), px + Math.sin(rotY) * 0.025, 1.75, pz, { rotY, k: 0.95, parent: pg });
    const capC = document.createElement("canvas"); capC.width = 420; capC.height = 70; const capT = new THREE.CanvasTexture(capC); capT.colorSpace = THREE.SRGBColorSpace;
    const cap = panel(0.84, 0.14, capT, px + Math.sin(rotY) * 0.025, 0.95, pz, { rotY, k: 1, transparent: true, parent: pg });
    const hotIx = hot.length;
    addHot(pg, "theater", "One of my lists", touch ? "Tap for the top 5" : "Click for the top 5", () => listPosters[i]?.list && openList(listPosters[i].list));
    listPosters[i] = { art, capC, capT, hotIx, neonC };
    const fr = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, -0.69, -0.48), V(0, 0.69, -0.48), V(0, 0.69, 0.48), V(0, -0.69, 0.48)], true, "catmullrom", 0), 40, 0.008, 6, true), glowMat(new THREE.Color(neonC).getHex(), 1.0));
    fr.position.set(px + off, 1.75, pz + offz * 0); scene.add(fr);
  });
  // tall plants in the back corners
  for (const [px, pz] of [[-8.45, -7.55], [-0.55, -7.55]]) {
    const g = new THREE.Group(); g.position.set(px, 0, pz); scene.add(g);
    block(0.3, 0.36, 0.3, 0, 0, 0.18, 0, { parent: g, r: 0.04, mat: lite ? steelM(0x4a5064) : new THREE.MeshStandardMaterial({ color: 0x4a4e58, roughness: 0.92 }) });
    if (!lite) { const soil = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 1 })); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.361; g.add(soil); }
    if (!lite) leafy(g, 0, 0.34, 0, { n: 24, len: 1.35, wid: 0.14, bend: 0.6, tilt: 0.6, seed: px });
    else for (let i = 0; i < 11; i++) { const a = i * 2.3, lf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.8 + (i % 4) * 0.18, 4), toon([0x1fb87a, 0x2bd68f, 0x169a66][i % 3]));
      lf.position.set(Math.cos(a) * 0.05, 0.75, Math.sin(a) * 0.05); lf.rotation.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3); g.add(lf); const ink = new THREE.Mesh(lf.geometry, inkMat); ink.scale.setScalar(1.1); lf.add(ink); }
  }
  // the screen's glow, caught in the floor in front of the stage
  { const t = canvasTex(256, 128, (c, cw, ch) => { const gr = c.createRadialGradient(cw / 2, ch / 2, 4, cw / 2, ch / 2, cw / 2); gr.addColorStop(0, "rgba(154,215,255,1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.fillRect(0, 0, cw, ch); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(-4.5, 0.006, -14.6); m.raycast = () => {}; scene.add(m); }
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
// ---------- the kitchen: front-right corner of the living room ----------
// A bar shaped like a backwards J: the long side runs parallel to the front wall and seats three,
// then curves round at the end by the front door and runs into the wall, with the stove on that stretch.
// Its open end, by the gallery door, is the way in. Fridge and food shelves stand against the right wall.
/* ---------- kitchenware (desktop): a real pan profile, spun on a lathe ----------
   r: rim radius, h: wall height; the floor is flat, the wall flares out; open side up (+y) */
const panGeo = (r, h, base = 0.82) => {
  const pts = [V(0, 0, 0), V(r * base, 0, 0), V(r * (base + 0.06), h * 0.15, 0), V(r * 0.97, h * 0.75, 0), V(r, h, 0), V(r - 0.004, h, 0), V(r * 0.96 - 0.004, h * 0.75, 0), V(r * base, 0.004, 0), V(0, 0.004, 0)];
  const g = new THREE.LatheGeometry(pts.map((q) => new THREE.Vector2(q.x, q.y)), 64); g.computeVertexNormals(); return g;
};
const panMat = (kind) => kind === "iron" ? new THREE.MeshStandardMaterial({ color: 0x1c1d22, metalness: 0.6, roughness: 0.55, roughnessMap: wearTex(), side: THREE.DoubleSide })
  : kind === "copper" ? new THREE.MeshStandardMaterial({ color: 0xc8744a, metalness: 0.95, roughness: 0.28, roughnessMap: wearTex(), side: THREE.DoubleSide })
  : new THREE.MeshStandardMaterial({ color: 0xc4c9d4, metalness: 0.92, roughness: 0.3, map: steelTex, roughnessMap: wearTex(), side: THREE.DoubleSide });
/* a label printed on a canvas: a band of colour, a name, a line of small print */
const label = (name, bg, fg, sub = "", { w = 256, h = 256, stripe = null } = {}) => canvasTex(w, h, (x) => {
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (stripe) { x.fillStyle = stripe; x.fillRect(0, h * 0.62, w, h * 0.12); }
  x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
  let size = Math.round(h * 0.2); x.font = `700 ${size}px Rajdhani`; while (x.measureText(name).width > w * 0.86 && size > 10) { size -= 2; x.font = `700 ${size}px Rajdhani`; }
  x.fillText(name, w / 2, h * 0.42);
  if (sub) { x.font = `500 ${Math.round(h * 0.07)}px Inter`; x.globalAlpha = 0.8; x.fillText(sub, w / 2, h * 0.84); x.globalAlpha = 1; }
});
const buildKitchen = () => {
  // the counter outline in plan (shape x = world x, shape y = -world z)
  const J = new THREE.Shape();
  J.moveTo(4.6, 2.8); J.lineTo(2.1, 2.8); J.absarc(2.1, 2.2, 0.6, Math.PI / 2, Math.PI, false);
  J.lineTo(1.5, 0.1); J.lineTo(2.1, 0.1); J.lineTo(2.1, 2.2); J.lineTo(4.6, 2.2); J.absarc(4.6, 2.5, 0.3, -Math.PI / 2, Math.PI / 2, false);
  const slabOf = (depth, color, y, mat) => {
    const geo = new THREE.ExtrudeGeometry(J, { depth, bevelEnabled: false, curveSegments: 20 });
    const m = new THREE.Mesh(geo, mat || toon(color)); m.rotation.x = -Math.PI / 2; m.position.y = y; scene.add(m);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lineMat)); return m;
  };
  // desktop: a brushed dark steel body and a polished quartz top (speckled, a few faint veins, a mirror-ish finish)
  const quartz = lite ? null : (() => { const t = canvasTex(512, 512, (x, w, h) => { x.fillStyle = "#e4e7ee"; x.fillRect(0, 0, w, h);
      let sd = 21; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 5000; i++) { const k = r(); x.fillStyle = k < 0.5 ? `rgba(90,95,110,${0.15 + r() * 0.3})` : `rgba(255,255,255,${0.3 + r() * 0.5})`; x.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
      x.strokeStyle = "rgba(120,126,145,.22)"; x.lineWidth = 1.5; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(r() * w, r() * h); x.bezierCurveTo(r() * w, r() * h, r() * w, r() * h, r() * w, r() * h); x.stroke(); } });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.2, metalness: 0, bumpMap: t, bumpScale: 0.25, roughnessMap: wearTex() }); })();
  slabOf(0.95, 0x3a3f4e, 0, lite ? null : steelM(0x4a4f5e)); // a dark steel body
  slabOf(0.05, 0xd9dde6, 0.95, quartz); // a pale composite top
  tube(2.5, 0.015, 0.015, 0x05d9e8, 3.35, 0.9, -2.82, { k: 0.8 }); // a light line under the lip, on the seating side
  { const chk = canvasTex(256, 256, (x, w) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#1b1d26" : "#2b2e3a"; x.fillRect(i * w / 4, j * w / 4, w / 4, w / 4); } }); // dark checker tiles inside the J
    chk.wrapS = chk.wrapT = THREE.RepeatWrapping; chk.repeat.set(4.3 / 1.2, 2.1 / 1.2);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.1), toon(0xffffff, { map: chk })); fl.rotation.x = -Math.PI / 2; fl.position.set(3.75, 0.013, -1.15); scene.add(fl); }

  // the stove: a glass induction top on the stretch by the door, two rings on
  const hob = panel(0.5, 0.75, canvasTex(256, 384, (x, w, h) => {
    x.fillStyle = "#0b0c12"; x.fillRect(0, 0, w, h);
    const ring = (cx, cy, r, on) => { x.strokeStyle = on ? "#ff5a1f" : "#3a3d4a"; x.lineWidth = on ? 7 : 4; x.shadowColor = "#ff5a1f"; x.shadowBlur = on ? 18 : 0;
      for (const rr of [r, r * 0.62]) { x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke(); } };
    ring(78, 100, 52, true); ring(180, 110, 40, false); ring(78, 250, 40, false); ring(180, 240, 52, true);
    x.shadowBlur = 0; x.fillStyle = "#05d9e8"; for (let i = 0; i < 5; i++) x.fillRect(60 + i * 30, 345, 14, 6); // touch controls
  }), 1.8, 1.003, -0.85, { k: 1 });
  hob.rotation.x = -Math.PI / 2; // flat on the counter, its long side along the stretch
  if (!lite) { const ht = hob.material.map; hob.material = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.16, roughnessMap: wearTex(), metalness: 0, emissive: 0xffffff, emissiveMap: ht, emissiveIntensity: 1 }); } /* glossy black ceramic glass, the rings and touch controls glowing through it */
  // a steel pan on the front ring with a steak searing in it
  const pan = new THREE.Group(); pan.position.set(1.9, 1.005, -0.76); scene.add(pan);
  const panBody = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.035, 28), steelM(0x8a92a6)); panBody.position.y = 0.018; pan.add(panBody);
  if (!lite) { panBody.visible = false; const pb = new THREE.Mesh(panGeo(0.135, 0.04), panMat("steel")); pb.castShadow = pb.receiveShadow = true; pan.add(pb);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.108, 48), new THREE.MeshStandardMaterial({ color: 0x2a2620, metalness: 0.7, roughness: 0.45 })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.0045; pan.add(floor); } /* the pan floor, darkened by cooking */
  const panInk = new THREE.Mesh(panBody.geometry, inkMat); panInk.scale.set(1.06, 1.15, 1.06); panBody.add(panInk);
  const panIn = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.004, 28), toon(0x23262f)); panIn.position.y = 0.034; pan.add(panIn); panIn.visible = lite;
  if (lite) block(0.028, 0.02, 0.2, 0x1b1e27, 0, 0.03, 0.22, { parent: pan, r: 0.008 }); // the handle, toward the wall
  else { const hd = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0.032, 0.128), V(0, 0.042, 0.18), V(0, 0.055, 0.32)]), 24, 0.008, 12), panMat("steel")); hd.castShadow = true; pan.add(hd);
    for (const dx of [-0.012, 0.012]) { const rv = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), panMat("steel")); rv.position.set(dx, 0.03, 0.13); pan.add(rv); } } /* a riveted steel handle, rising toward the wall */
  const steak = new THREE.Group(); steak.position.y = 0.046; steak.rotation.y = 0.5; pan.add(steak);
  if (lite) { block(0.17, 0.028, 0.11, 0x8a4326, 0, 0, 0, { parent: steak, r: 0.012 });
    for (const dx of [-0.05, 0, 0.05]) block(0.012, 0.004, 0.1, 0x3a1a0e, dx, 0.015, 0, { parent: steak, rot: [0, 0.5, 0], r: 0.002, ink: false }); // sear marks
    block(0.06, 0.006, 0.03, 0xf2ece0, 0.07, 0.016, 0.03, { parent: steak, r: 0.003, ink: false }); } // a pat of butter
  else { /* a ribeye seared in butter, as the recipe on the wall says: an irregular steak with rounded edges and a real crust,
      a rendered fat cap down one side, a pat of butter slumping as it melts, foaming brown butter round it, garlic and thyme for basting */
    steak.position.y = 0.0055; /* on the pan floor */
    const rnd = (() => { let sd = 11; return () => ((sd = (sd * 16807) % 2147483647) / 2147483647); })();
    const outline = new THREE.CatmullRomCurve3([[0.09, 0.008], [0.076, 0.044], [0.04, 0.058], [0.008, 0.046], [-0.022, 0.06], [-0.062, 0.053], [-0.088, 0.022], [-0.091, -0.018], [-0.067, -0.05], [-0.02, -0.058], [0.03, -0.051], [0.064, -0.039], [0.084, -0.016]].map(([x, y]) => V(x, y, 0)), true, "centripetal");
    const shape = new THREE.Shape(outline.getPoints(64).map((q) => new THREE.Vector2(q.x, q.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0035, bevelSegments: 4, curveSegments: 64 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0.003, 0); /* lying flat, its underside on the pan */
    const crust = canvasTex(512, 512, (x, w, h) => { /* the seared face, in the steak's own coordinates (the shape's metres, mapped to the canvas) */
      const g = x.createRadialGradient(w * 0.5, h * 0.52, 20, w / 2, h / 2, w * 0.55); g.addColorStop(0, "#4a200c"); g.addColorStop(0.65, "#361607"); g.addColorStop(1, "#1e0b03"); x.fillStyle = g; x.fillRect(0, 0, w, h); /* a deep mahogany sear, darkest at the edges */
      x.save(); x.rotate(0.5); for (let i = -60; i < 120; i++) { x.strokeStyle = `rgba(${rnd() < 0.5 ? '15,5,1' : '110,58,26'},${0.12 + rnd() * 0.2})`; x.lineWidth = 1 + rnd() * 2; x.beginPath(); x.moveTo(-200, i * 6); x.lineTo(900, i * 6 + (rnd() - 0.5) * 10); x.stroke(); } x.restore(); /* the grain of the muscle under the crust */
      for (let i = 0; i < 420; i++) { const px = rnd() * w, py = rnd() * h, r = 4 + rnd() * 12; const gg = x.createRadialGradient(px, py, 0, px, py, r); const dark = rnd() < 0.5;
        gg.addColorStop(0, dark ? "rgba(30,13,5,.32)" : "rgba(160,92,42,.3)"); gg.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gg; x.fillRect(px - r, py - r, r * 2, r * 2); } /* the Maillard crust: dark, caramel, mottled */
      for (let i = 0; i < 2600; i++) { x.fillStyle = rnd() < 0.6 ? `rgba(18,7,2,${0.3 + rnd() * 0.5})` : `rgba(210,140,70,${0.2 + rnd() * 0.4})`; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.5, 1 + rnd() * 2.5); } /* char specks and glints */
      const fy = h * 0.13; const fg = x.createLinearGradient(0, 0, 0, fy + 24); fg.addColorStop(0, "#8a5226"); fg.addColorStop(0.3, "#d9a35e"); fg.addColorStop(0.75, "#e8bf80"); fg.addColorStop(1, "rgba(232,191,128,0)"); x.fillStyle = fg; x.fillRect(0, 0, w, fy + 24); /* the fat cap, rendered golden along the top edge */
      for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(120,64,24,${rnd() * 0.5})`; x.fillRect(rnd() * w, rnd() * (fy + 20), 2, 2); } });
    crust.repeat.set(1 / 0.19, 1 / 0.135); crust.offset.set(0.5, 0.5); /* the shape spans about 19 x 13.5 cm */
    const juice = canvasTex(256, 256, (x, w, h) => { x.fillStyle = "#a8a8a8"; x.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { const px = rnd() * w, py = rnd() * h, r = 1.5 + rnd() * 4; x.fillStyle = "#5c5c5c"; x.beginPath(); x.ellipse(px, py, r, r * 0.6, rnd() * 3, 0, 6.3); x.fill(); } }); /* glossy beads of juice and butter on the crust */
    juice.repeat.copy(crust.repeat); juice.offset.copy(crust.offset); crust.colorSpace = THREE.SRGBColorSpace; juice.colorSpace = THREE.NoColorSpace;
    const face = new THREE.MeshStandardMaterial({ map: crust, bumpMap: crust, bumpScale: 5, roughnessMap: juice, roughness: 0.85, metalness: 0 });
    const sideT = canvasTex(512, 64, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#1e0b03"); g.addColorStop(0.35, "#4a2210"); g.addColorStop(0.5, "#5a2c16"); g.addColorStop(0.65, "#4a2210"); g.addColorStop(1, "#1a0902"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(20,8,2,${rnd() * 0.5})`; x.fillRect(rnd() * w, rnd() * h, 2, 1); } }); sideT.wrapS = THREE.RepeatWrapping; sideT.repeat.set(8, 1);
    const side = new THREE.MeshStandardMaterial({ map: sideT, bumpMap: sideT, bumpScale: 2, roughness: 0.5 });
    const sm = new THREE.Mesh(geo, [face, side]); sm.castShadow = sm.receiveShadow = true; steak.add(sm);
    const top = 0.003 + 0.012 + 0.003;
    /* butter: a pat slumping as it melts, half-sliding off the steak */
    const bt = new THREE.Mesh(sculpt(0.011, (u) => { u.y = u.y > 0 ? u.y * 0.42 : u.y * 0.12; u.x *= 1.25; const sag = Math.max(0, 1 - u.y * 3); u.x *= 1 + 0.12 * sag; u.z *= 1 + 0.12 * sag; }, 32, 16), new THREE.MeshStandardMaterial({ color: 0xf3e2a6, roughness: 0.22, transparent: true, opacity: 0.92 }));
    bt.position.set(-0.03, top - 0.0004, 0.018); bt.rotation.y = 0.5; bt.castShadow = true; steak.add(bt);
    /* foaming brown butter round the steak: golden-brown, bubbled, fading out toward the pan wall */
    const foam = canvasTex(256, 256, (x, w, h) => { x.clearRect(0, 0, w, h); const g = x.createRadialGradient(w / 2, h / 2, w * 0.22, w / 2, h / 2, w / 2); g.addColorStop(0, "rgba(176,112,40,.95)"); g.addColorStop(0.6, "rgba(196,138,58,.7)"); g.addColorStop(1, "rgba(196,138,58,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const a = rnd() * 6.28, d = w * (0.22 + rnd() * 0.26), r = 0.5 + rnd() * 1.6; x.strokeStyle = `rgba(255,236,190,${0.12 + rnd() * 0.22})`; x.lineWidth = 1; x.beginPath(); x.arc(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, r, 0, 6.3); x.stroke(); }
      for (let i = 0; i < 160; i++) { const a = rnd() * 6.28, d = w * (0.25 + rnd() * 0.2); x.fillStyle = `rgba(70,36,10,${rnd() * 0.6})`; x.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2, 2); } }); /* bubbles, and browned milk solids */
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.105, 64), new THREE.MeshStandardMaterial({ map: foam, transparent: true, roughness: 0.12, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.scale.set(1.08, 0.9, 1); pool.position.y = 0.0004; steak.add(pool);
    /* two garlic cloves, browned where they touch the pan, and a sprig of thyme */
    const garlic = new THREE.MeshStandardMaterial({ color: 0xe6d7b0, roughness: 0.45, map: canvasTex(64, 64, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#f2e6c4"); g.addColorStop(1, "#a8743a"); x.fillStyle = g; x.fillRect(0, 0, w, h); }) });
    for (const [gx, gz, ry] of [[-0.098, 0.03, 0.4], [0.085, -0.062, -1.1]]) { const c = new THREE.Mesh(sculpt(0.012, (u) => { u.x *= 1.5; u.y *= 0.8; u.z *= 0.9; u.z += 0.35 * (u.x * u.x) - 0.2; }, 24, 16), garlic); c.position.set(gx, 0.009, gz); c.rotation.set(0, ry, 0.15); c.castShadow = true; steak.add(c); }
    const sprig = new THREE.Group(); sprig.position.set(-0.03, 0.002, -0.075); sprig.rotation.y = 0.35; steak.add(sprig);
    const stemM = new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.8 }), leafM = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.6 });
    sprig.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.05, 0.004, 0), V(-0.01, 0.006, 0.004), V(0.03, 0.005, -0.002), V(0.06, 0.004, 0.003)]), 16, 0.0011, 5), stemM));
    for (let i = 0; i < 22; i++) { const t = i / 21, lf = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 6, 4), leafM); lf.scale.set(1.6, 0.4, 0.8); lf.position.set(-0.05 + t * 0.11, 0.0055, (i % 2 ? 1 : -1) * 0.003); lf.rotation.y = (i % 2 ? 0.6 : -0.6); sprig.add(lf); } } /* thyme leaves along the stem */
  // a little steam curling up off it
  const wisp = lite ? null : canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.4, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, w, w); });
  const puffs = [...Array(lite ? 4 : 10).keys()].map((i, _, all) => {
    const m = lite ? new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe8ecf4, transparent: true, opacity: 0, depthWrite: false }))
      : new THREE.Sprite(new THREE.SpriteMaterial({ map: wisp, color: 0xf0e8e0, transparent: true, opacity: 0, depthWrite: false })); /* desktop: soft, see-through wisps */
    m.raycast = () => {}; pan.add(m); return { m, ph: i / (lite ? 4 : 10) };
  });
  animators.push((now) => { if (reduce) return; for (const p of puffs) {
    const t = (now / 2400 + p.ph) % 1; p.m.position.set(Math.sin(t * 6 + p.ph * 9) * 0.04, 0.07 + t * 0.42, Math.cos(t * 5 + p.ph * 7) * 0.03);
    if (lite) { p.m.scale.setScalar(0.5 + t * 1.8); p.m.material.opacity = Math.sin(t * Math.PI) * 0.09; } else { p.m.scale.setScalar(0.05 + t * 0.22); p.m.material.opacity = Math.sin(t * Math.PI) ** 1.5 * 0.13; p.m.material.rotation = t * 2 + p.ph * 6; }
  } });
  // a slim hood hanging over it, lit underneath
  block(0.7, 0.1, 0.95, 0, 1.8, 2.35, -0.85, { r: 0.02, mat: steelM(0x9aa2b4) });
  tube(0.6, 0.01, 0.85, 0xffe2b8, 1.8, 2.295, -0.85, { k: 0.75 });
  for (const dz of [-0.3, 0.3]) block(0.02, 1.0, 0.02, 0x2a2e3a, 1.8, 2.9, -0.85 + dz, { ink: false });
  const hobLight = new THREE.PointLight(0xffc78a, 1.4, 3); hobLight.position.set(1.8, 2.1, -0.85); scene.add(hobLight);

  // dinner on the long side: three places
  for (const x of [2.6, 3.4, 4.2]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.014, 32), lite ? toon(0xf4f3ff) : new THREE.MeshStandardMaterial({ color: 0xf4f3ff, roughness: 0.14, roughnessMap: wearTex() })); plate.position.set(x, 1.007, -2.6); scene.add(plate);
    if (!lite) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.006, 8, 48), plate.material); rim.rotation.x = Math.PI / 2; rim.position.set(x, 1.016, -2.6); scene.add(rim); } // the raised rim
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, lite ? 14 : 32, 1, !lite), lite ? new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35 })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    glass.position.set(x + 0.2, 1.06, -2.45); scene.add(glass);
    if (!lite) { const water = new THREE.Mesh(new THREE.CylinderGeometry(0.0315, 0.0295, 0.065, 32), new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.03, transparent: true, opacity: 0.55, depthWrite: false })); water.position.set(x + 0.2, 1.035, -2.45); scene.add(water);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.5 })); foot.position.set(x + 0.2, 1.003, -2.45); scene.add(foot); } // water, and the thick base of the glass
    // a stool outside: steel post, round seat, a glowing foot ring
    const st = new THREE.Group(); st.position.set(x, 0, -3.22); scene.add(st);
    const parts = [
      [new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24), toon(0x2a2e3a), 0.015],
      [new THREE.CylinderGeometry(0.028, 0.028, 0.72, 12), steelM(0xc4cad8), 0.38],
      [new THREE.CylinderGeometry(0.2, 0.18, 0.06, 24), toon(0x2b2f3d), 0.75],
    ];
    if (!lite) { /* desktop: a weighted steel base with a rubber foot, a brushed post, a padded leather seat on a steel pan */
      parts[0][1] = steelM(0x4a4f5e); parts[0][0] = new THREE.CylinderGeometry(0.2, 0.22, 0.03, 48); parts[1][0] = new THREE.CylinderGeometry(0.028, 0.028, 0.72, 32);
      parts[2][0] = new THREE.CylinderGeometry(0.18, 0.17, 0.03, 48); parts[2][1] = steelM(0x3a3f4a); parts[2][2] = 0.735;
      const cush = new THREE.Mesh(sculpt(0.19, (u) => { u.y = u.y > 0 ? u.y * 0.3 : u.y * 0.08; }, 48, 24), leather(0x2b2f3d, plainBump, 0.4, 1.4)); cush.position.y = 0.755; cush.castShadow = cush.receiveShadow = true; st.add(cush);
      const foot = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.006, 6, 48), new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.9 })); foot.rotation.x = Math.PI / 2; foot.position.y = 0.004; st.add(foot);
      const rest = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.009, 12, 48), new THREE.MeshStandardMaterial({ color: 0xd4d8e2, metalness: 0.95, roughness: 0.2 })); rest.rotation.x = Math.PI / 2; rest.position.y = 0.3; st.add(rest); /* a chrome footrest ring */
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2, arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 8), rest.material); arm.rotation.z = Math.PI / 2; arm.position.set(Math.cos(a) * 0.088, 0.3, Math.sin(a) * 0.088); arm.rotation.y = -a; st.add(arm); } } /* on three spokes */
    for (const [g, m, y] of parts) { const o = new THREE.Mesh(g, m); o.position.y = y; o.castShadow = o.receiveShadow = !lite; st.add(o); const ink = new THREE.Mesh(g, inkMat); ink.scale.set(1.1, 1.08, 1.1); o.add(ink); }
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.15, lite ? 0.012 : 0.004, 8, 32), glowMat(0x05d9e8, 1.1)); ringM.rotation.x = Math.PI / 2; ringM.position.y = lite ? 0.3 : 0.288; st.add(ringM); /* desktop: a thin LED under the chrome ring */
  }

  // the fridge against the right wall: brushed steel, French doors, a little screen
  const fr = new THREE.Group(); fr.position.set(5.53, 0, -0.62); fr.rotation.y = -Math.PI / 2; scene.add(fr); // local +z faces into the kitchen
  block(0.86, 2.0, 0.72, 0, 0, 1.0, 0, { parent: fr, r: 0.03, mat: steelM(0xaab2c2) });
  block(0.008, 1.36, 0.01, 0x1a1d28, 0, 1.3, 0.362, { parent: fr, ink: false }); // the seam between the doors
  block(0.84, 0.008, 0.01, 0x1a1d28, 0, 0.6, 0.362, { parent: fr, ink: false }); // and above the freezer drawer
  for (const dx of [-0.06, 0.06]) tube(0.015, 0.5, 0.01, 0xb8c4e0, dx, 1.3, 0.365, { parent: fr, k: 0.7 }); // flush light strips, no handles
  tube(0.4, 0.012, 0.01, 0xb8c4e0, 0, 0.5, 0.365, { parent: fr, k: 0.7 });
  panel(0.24, 0.16, canvasTex(240, 160, (x, w, h) => {
    x.fillStyle = "#081018"; x.fillRect(0, 0, w, h); x.fillStyle = "#05d9e8"; x.font = "600 44px 'JetBrains Mono'"; x.fillText("3°C", 16, 56);
    x.font = "500 20px 'JetBrains Mono'"; x.fillStyle = "#d6d6e7"; x.fillText("OAT MILK · LOW", 16, 100); x.fillText("EGGS · 4", 16, 130);
  }), -0.26, 1.62, 0.366, { parent: fr, k: 0.9 });

  // open steel shelving beside it, stocked
  const sh = new THREE.Group(); sh.position.set(5.7, 0, -1.68); sh.rotation.y = -Math.PI / 2; scene.add(sh);
  for (const dx of [-0.45, 0.45]) for (const dz of [-0.17, 0.17]) block(0.03, 2.0, 0.03, 0x2a2e3a, dx, 1.0, dz, { parent: sh, r: 0.008, ink: false });
  const food = [0xff7a1a, 0xf9f002, 0xff2a6d, 0x2bff88, 0xd6d6e7, 0x05d9e8, 0xb98cff, 0xc2185b, 0xffb86b];
  /* desktop: proper groceries, each a different product. Generic names, no brands */
  const BOX = [["OATS", "#e9dcc0", "#5a3a1a", "WHOLE ROLLED", "#c9a25a"], ["RICE", "#f4f1ea", "#1f4e79", "JASMINE · 2 KG", "#1f4e79"], ["TEA", "#2b4a3a", "#f1e6c8", "SENCHA · 40 BAGS", "#c9a25a"], ["CEREAL", "#c0392b", "#fff4d6", "MULTIGRAIN", "#f4c542"]];
  const CAN = [["TOMATOES", "#b8322a", "#fff1e0"], ["BEANS", "#2e5d3a", "#f3ead0"], ["COCONUT", "#f2efe8", "#3a2a1a"], ["CHICKPEAS", "#d9a441", "#3a2410"]];
  const JAR = [[0xe6c27a, "PASTA"], [0x8a3a22, "LENTILS"], [0xf3ead2, "RICE"], [0x3a2416, "COFFEE"]];
  const CUP = [["SHOYU", "#c0392b"], ["MISO", "#e0a030"], ["SPICY", "#1a1a1a"]];
  const paper = (map, r = 0.7) => new THREE.MeshStandardMaterial({ map, roughness: r }), tin = new THREE.MeshStandardMaterial({ color: 0xc4c9d4, metalness: 0.9, roughness: 0.32, map: steelTex });
  const seen = [0, 0, 0, 0]; /* a running count per kind, so neighbouring items are different products */
  const pantryItem = (kind, _n, x, y) => { const n = seen[kind]++;
    if (kind === 0) { const [nm, bg, fg, sub, st] = BOX[n % BOX.length], side = paper(canvasTex(64, 64, (c) => { c.fillStyle = bg; c.fillRect(0, 0, 64, 64); }));
      const front = paper(label(nm, bg, fg, sub, { w: 192, h: 320, stripe: st }));
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.07), [side, side, side, side, front, side]); b.position.set(x + 0.06, y + 0.123, -0.04); b.castShadow = b.receiveShadow = true; sh.add(b); return 0.14; }
    if (kind === 1) { const [nm, bg, fg] = CAN[n % CAN.length], lm = paper(label(nm, bg, fg, "400 G", { w: 512, h: 160 }), 0.5);
      for (const dz of [-0.06, 0.06]) { const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 32), [lm, tin, tin]); can.position.set(x + 0.04, y + 0.067, dz); can.rotation.y = Math.PI / 2; can.castShadow = can.receiveShadow = true; sh.add(can);
        for (const yy of [-0.054, 0.054]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.0025, 6, 32), tin); rim.rotation.x = Math.PI / 2; rim.position.set(x + 0.04, y + 0.067 + yy, dz); sh.add(rim); } } return 0.09; }
    if (kind === 2) { const [col, nm] = JAR[n % JAR.length], bits = canvasTex(128, 128, (c, w) => { c.fillStyle = "#" + new THREE.Color(col).getHexString(); c.fillRect(0, 0, w, w); let sd = n + 3; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); for (let i = 0; i < 260; i++) { c.fillStyle = r() < 0.5 ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.2)"; c.beginPath(); c.ellipse(r() * w, r() * w, 2 + r() * 4, 1.5 + r() * 2.5, r() * 3, 0, 6.3); c.fill(); } });
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 32), new THREE.MeshStandardMaterial({ map: bits, bumpMap: bits, bumpScale: 1.5, roughness: 0.8 })); fill.position.set(x + 0.05, y + 0.064, 0); sh.add(fill); /* what's in it */
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })); glass.position.set(x + 0.05, y + 0.077, 0); sh.add(glass);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.022, 32), new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.7, roughness: 0.35 })); lid.position.set(x + 0.05, y + 0.153, 0); sh.add(lid);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.022), paper(label(nm, "#f4f1ea", "#2a2a2a", "", { w: 160, h: 70 }))); tag.position.set(x + 0.05, y + 0.07, 0.0455); sh.add(tag); return 0.1; } /* a hand-written label */
    const [nm, bg] = CUP[n % CUP.length], cm = paper(label(nm, bg, "#ffffff", "NOODLES", { w: 512, h: 200 }), 0.55);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.038, 0.1, 32, 1, true), cm); cup.material.side = THREE.DoubleSide; cup.rotation.y = Math.PI / 2; cup.position.set(x + 0.05, y + 0.062, 0.02); cup.castShadow = true; sh.add(cup);
    const foil = new THREE.Mesh(new THREE.CircleGeometry(0.051, 32), new THREE.MeshStandardMaterial({ color: 0xd8dbe2, metalness: 0.85, roughness: 0.4 })); foil.rotation.x = -Math.PI / 2; foil.position.set(x + 0.05, y + 0.113, 0.02); sh.add(foil); /* the foil lid */
    return 0.11; };
  let f = 0;
  for (const y of [0.3, 0.8, 1.3, 1.8]) {
    block(0.92, 0.025, 0.36, 0, 0, y, 0, { parent: sh, r: 0.006, mat: steelM(0xc4cad8) });
    for (let x = -0.38; x < 0.4; ) {
      const kind = (f * 7 + Math.round(y * 10)) % 4, c = food[f++ % food.length];
      if (!lite) { x += pantryItem(kind, f, x, y); continue; }
      if (kind === 0) { block(0.12, 0.22, 0.07, c, x + 0.06, y + 0.12, -0.04, { parent: sh, r: 0.01 }); x += 0.14; } // a box
      else if (kind === 1) { for (const dz of [-0.06, 0.06]) { const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 14), toon(c)); can.position.set(x + 0.04, y + 0.067, dz); sh.add(can); } x += 0.09; } // cans
      else if (kind === 2) { const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 14), toon(c)); jar.position.set(x + 0.05, y + 0.077, 0); sh.add(jar); const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.025, 14), steelM(0x9aa2b4)); lid.position.set(x + 0.05, y + 0.155, 0); sh.add(lid); x += 0.11; } // a jar
      else { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.038, 0.1, 14), toon(c)); cup.position.set(x + 0.05, y + 0.062, 0.02); sh.add(cup); x += 0.11; } // noodle cups
    }
  }
};
// ---------- the gallery: behind the living room's right wall (x 6.1 – 13.1, z -0.25 – -6.9) ----------
// Every photo from the site, framed and hung on charcoal walls under track lights, each with a little label.
// A bench to sit and look; a desk against the front wall with a film camera and an orange iPhone 17 Pro Max.
const buildGallery = () => {
  const X0 = 6.1, X1 = 13.1, Z0 = -0.25, Z1 = -6.9, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
  const wallTex = (len) => { const t = canvasTex(512, 1160, (x, w, h) => {
    x.fillStyle = "#1f2130"; x.fillRect(0, 0, w, h); x.fillStyle = "#191b27"; x.fillRect(0, 0, 3, h); // matte charcoal, faint seams
    x.fillStyle = "#14151e"; x.fillRect(0, h - 28, w, 28); }); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 1.6, 1); return t; };
  const wall = (w, h, d, x, y, z, len) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(0xffffff, { map: wallTex(len) })); m.position.set(x, y, z); scene.add(m); return m; };
  const floorT = canvasTex(512, 512, (x, w) => { x.fillStyle = "#1b1d25"; x.fillRect(0, 0, w, w); let sd = 3; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${0.015 + r() * 0.02})`; x.fillRect(r() * w, r() * w, 1 + r() * 3, 1 + r() * 3); } x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, 0, w, 2); x.fillRect(0, 0, 2, w); }); // polished concrete
  floorT.wrapS = floorT.wrapT = THREE.RepeatWrapping; floorT.repeat.set(3, 3);
  { const f = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0 + 0.2, 0.1, Z0 - Z1 + 0.2), toon(0xffffff, { map: floorT })); f.position.set(CX, -0.05, CZ); scene.add(f); }
  slab(X1 - X0 + 0.2, 0.1, Z0 - Z1 + 0.2, 0x0e0f16, CX, H + 0.05, CZ);
  wall(X1 - X0, H, 0.1, CX, H / 2, Z0 + 0.05, X1 - X0); wall(X1 - X0, H, 0.1, CX, H / 2, Z1 - 0.05, X1 - X0); wall(0.1, H, Z0 - Z1, X1 + 0.05, H / 2, CZ, Z0 - Z1);
  // a picture rail with a fine light line, and cove light in amber
  for (const [w, d, x, z] of [[X1 - X0, 0.03, CX, Z0 - 0.02], [X1 - X0, 0.03, CX, Z1 + 0.02], [0.03, Z0 - Z1, X1 - 0.02, CZ], [0.03, 1.2, X0 + 0.12, -1.2], [0.03, 1.4, X0 + 0.12, -5.9]]) {
    block(w, 0.04, d, 0, x, 2.95, z, { mat: steelM(0x6c7389), r: 0.005, ink: false }); tube(w, 0.008, d, 0x7ff6ff, x, 2.925, z, { k: 0.7 }); }
  for (const z of [Z0 - 0.02, Z1 + 0.02]) tube(X1 - X0, 0.025, 0.025, 0xffa040, CX, H - 0.07, z, { k: 0.85 });
  tube(0.025, 0.025, Z0 - Z1, 0xffa040, X1 - 0.02, H - 0.07, CZ, { k: 0.85 });
  // track lighting: a steel track round the ceiling a metre in from the walls
  for (const [w, d, x, z] of [[X1 - X0 - 2, 0.04, CX, Z0 - 1], [X1 - X0 - 2, 0.04, CX, Z1 + 1], [0.04, Z0 - Z1 - 2, X1 - 1, CZ], [0.04, Z0 - Z1 - 2, X0 + 1, CZ]]) block(w, 0.04, d, 0x2a2e3a, x, H - 0.04, z, { r: 0.01, ink: false });
  for (const [x, z] of [[CX - 1.5, CZ], [CX + 1.5, CZ]]) { const l = new THREE.PointLight(0xfff1dc, 3, 8); l.position.set(x, 2.8, z); l.userData.shadow = x < CX ? 2 : 0; scene.add(l); }
  { const l = new THREE.PointLight(lite ? 0xfff1dc : 0xffc98a, lite ? 1.2 : 0.35, 5); l.position.set(11.6, 2.2, -1.2); scene.add(l); } // over the desk: on desktop, low and warm, so the lamp does the work
  // the photos: each frame faces into the room; slots in hanging order, newest first
  const slots = [ // [x, y, z, rotY]
    [X1 - 0.02, 1.6, -1.35, -Math.PI / 2], [X1 - 0.02, 1.6, -2.85, -Math.PI / 2], [X1 - 0.02, 1.6, -4.35, -Math.PI / 2], [X1 - 0.02, 1.6, -5.85, -Math.PI / 2],
    [11.6, 1.6, Z1 + 0.02, 0], [10.1, 1.6, Z1 + 0.02, 0], [8.6, 1.6, Z1 + 0.02, 0], [7.1, 1.6, Z1 + 0.02, 0],
    [X0 + 0.02, 1.6, -5.85, Math.PI / 2], [X0 + 0.02, 1.6, -1.35, Math.PI / 2],
    [7.1, 1.6, Z0 - 0.02, Math.PI], [8.6, 1.6, Z0 - 0.02, Math.PI], [10.1, 1.6, Z0 - 0.02, Math.PI], [11.6, 2.05, Z0 - 0.02, Math.PI],
  ];
  const photos = (S.photos || []).filter((p) => p.src).slice(0, slots.length);
  const glowT = canvasTex(256, 256, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 8, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(255,241,220,.9)"); gr.addColorStop(1, "rgba(255,241,220,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const fmtDate = (d) => d ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
  photos.forEach((ph, i) => {
    const [x, y, z, rotY] = slots[i], g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
    const fr = block(1, 1, 0.04, 0x0b0c12, 0, 0, 0.02, { parent: g, r: 0.01 }), mat = block(1, 1, 0.01, 0, 0, 0, 0.042, { parent: g, r: 0.004, ink: false, mat: new THREE.MeshBasicMaterial({ color: 0xcfcac0 }) }); // frame and mat
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x2a2e3a, toneMapped: false })); pic.position.z = 0.049; g.add(pic);
    const fit = (aspect) => { const long = 0.92, w = aspect >= 1 ? long : long * aspect, h = aspect >= 1 ? long / aspect : long;
      pic.scale.set(w, h, 1); mat.scale.set(w + 0.12, h + 0.12, 1); fr.scale.set(w + 0.18, h + 0.18, 1); return h; };
    const [rw, rh] = String(ph.ratio || "3/2").split("/").map(Number); let h = fit(rw / (rh || 1) || 1.5);
    const label = panel(0.42, 0.11, canvasTex(420, 110, (c, cw, chh) => { c.fillStyle = "#e9e6de"; c.fillRect(0, 0, cw, chh); c.fillStyle = "#1b1d25"; c.font = "600 26px Inter"; c.fillText((ph.caption || "").slice(0, 32), 14, 42);
      c.font = "400 19px Inter"; c.fillStyle = "#555a66"; c.fillText([ph.place, fmtDate(ph.date)].filter(Boolean).join(" · ").slice(0, 40), 14, 80); }), 0, 0, 0.045, { parent: g, k: 0.85 });
    const placeLabel = (hh) => label.position.set(0.0, -hh / 2 - 0.2, 0.045);
    placeLabel(h);
    loadWall(ph.src, (t) => { t.colorSpace = THREE.SRGBColorSpace; pic.material.map = t; pic.material.color.setScalar(0.88); pic.material.needsUpdate = true; placeLabel(fit(t.image.width / t.image.height)); });
    // a warm wash of light on the wall round it, and a track head aimed at it
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: glowT, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })); wash.position.set(0, 0.15, 0.005); wash.raycast = () => {}; g.add(wash);
    const head = new THREE.Group(); head.position.set(0, H - 0.1 - y, 0.95); g.add(head);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.12, 14), steelM(0x2a2e3a)); can.rotation.x = 0.9; head.add(can);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 14), glowMat(0xfff1dc, 1.2)); lens.position.set(0, -0.04, -0.05); lens.rotation.x = Math.PI / 2 + 0.9; head.add(lens);
    const beamLen = Math.hypot(0.95, H - 0.1 - y), beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.4, beamLen, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1dc, transparent: true, opacity: 0.014, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(0, (H - 0.1 - y) / 2, 0.48); beam.rotation.x = -Math.atan2(0.95, H - 0.1 - y); beam.raycast = () => {}; g.add(beam);
    addHot(g, "gallery", ph.caption || "A photo", touch ? "Tap to see it large" : "Click to see it large", () => { openPhotos("Gallery", photos); showPhoto(i); });
  });
  // a bench in the middle to sit and look
  block(0.5, 0.08, 2.0, 0, CX + 0.6, 0.42, CZ, { r: 0.02, mat: steelM(0x9aa2b4) });
  if (lite) block(0.44, 0.08, 1.9, 0xc2410c, CX + 0.6, 0.5, CZ, { r: 0.03 }); // a burnt-orange cushion
  else { const c = pillow(1.9, 0.09, 0.44, 4, leather(0xc2410c, cushBump(4), 0.4, 2.4)); c.rotation.y = Math.PI / 2; c.position.set(CX + 0.6, 0.505, CZ); scene.add(c); } // stitched burnt-orange leather, in four panels
  for (const dz of [-0.8, 0.8]) block(0.42, 0.4, 0.06, 0, CX + 0.6, 0.2, CZ + dz, { r: 0.01, mat: steelM(0x6c7389) });
  for (const dx of [-0.2, 0.2]) tube(0.012, 0.012, 1.7, 0xff2a6d, CX + 0.6 + dx, 0.37, CZ, { k: 0.9 }); // a neon line under each edge of the seat
  // glossy floor pools under each wall of photos
  for (const [w, d, x, z] of [[0.9, Z0 - Z1 - 1, X1 - 0.6, CZ], [X1 - X0 - 1, 0.9, CX, Z1 + 0.6]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: glowT, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false })); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.005, z); p.raycast = () => {}; scene.add(p); }
  // the desk, against the front wall, facing into the room
  const D = new THREE.Group(); D.position.set(11.6, 0, Z0 - 0.38); scene.add(D); // local -z faces into the room
  block(1.5, 0.04, 0.66, 0, 0, 0.75, 0, { parent: D, r: 0.01, mat: steelM(0x8a92a6) });
  tube(1.46, 0.01, 0.01, 0x05d9e8, 0, 0.725, -0.33, { parent: D, k: 0.8 });
  for (const sx of [-0.7, 0.7]) block(0.04, 0.73, 0.6, 0, sx, 0.365, 0, { parent: D, r: 0.01, mat: steelM(0x6c7389) });
  // a monitor with a photo open in an editor
  block(0.04, 0.3, 0.04, 0x2a2e3a, 0, 0.92, 0.16, { parent: D, ink: false }); block(0.22, 0.015, 0.14, 0x2a2e3a, 0, 0.775, 0.16, { parent: D, r: 0.005, ink: false });
  block(0.72, 0.44, 0.025, 0x0b0c12, 0, 1.22, 0.15, { parent: D, r: 0.01, mat: lite ? undefined : new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.3 }) });
  if (!lite) { const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.69, 0.41), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false })); gl.position.set(0, 1.22, 0.1335); gl.rotation.y = Math.PI; D.add(gl); // the glass over the panel
    const led = tube(0.006, 0.003, 0.004, 0xd6ffe8, 0.32, 1.006, 0.135, { parent: D, k: 1.4 }); led.rotation.y = Math.PI; // the power light
    D.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.0, 1.0, 0.17), V(0.02, 0.86, 0.22), V(0.3, 0.78, 0.31), V(0.72, 0.6, 0.33)]), 24, 0.004, 8), new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.7 }))); } // its cable, down the back
  const edC = document.createElement("canvas"); edC.width = 720; edC.height = 420; const edT = new THREE.CanvasTexture(edC); edT.colorSpace = THREE.SRGBColorSpace;
  const drawEditor = (img) => { const x = edC.getContext("2d"); x.fillStyle = "#15161d"; x.fillRect(0, 0, 720, 420);
    x.fillStyle = "#22242e"; x.fillRect(0, 0, 720, 28); x.fillStyle = "#9d9dc0"; x.font = "500 14px 'JetBrains Mono'"; x.fillText("DEVELOP · " + (photos[0]?.caption || "").toUpperCase().slice(0, 40), 12, 19);
    if (img) { const a = img.width / img.height, bw = 500, bh = 360, w = a > bw / bh ? bw : bh * a, hh = a > bw / bh ? bw / a : bh; x.drawImage(img, 20 + (bw - w) / 2, 44 + (bh - hh) / 2, w, hh); }
    x.fillStyle = "#1c1e27"; x.fillRect(540, 28, 180, 392);
    ["EXPOSURE", "CONTRAST", "HIGHLIGHTS", "SHADOWS", "WHITES", "GRAIN"].forEach((k, n) => { x.fillStyle = "#9d9dc0"; x.font = "500 12px 'JetBrains Mono'"; x.fillText(k, 552, 62 + n * 52); x.fillStyle = "#3a3d4a"; x.fillRect(552, 72 + n * 52, 150, 3); x.fillStyle = "#05d9e8"; x.fillRect(552 + 40 + ((n * 37) % 90), 67 + n * 52, 4, 13); });
    edT.needsUpdate = true; };
  drawEditor(null); if (photos[0]) { const im = new Image(); im.onload = () => drawEditor(im); im.onerror = () => { if (im.src.includes("/house/")) im.src = photos[0].src; }; im.src = wallSrc(photos[0].src); }
  const screen = panel(0.68, 0.4, edT, 0, 1.22, 0.135, { parent: D, k: 0.85 }); screen.rotation.y = Math.PI;
  if (!lite) { /* the screen lights the desk: a soft cool wash the size of the panel, facing into the room, matched to the editor's dark UI */
    const sl = new THREE.RectAreaLight(0x9fb8d8, 1.1, 0.68, 0.4); sl.position.set(0, 1.22, 0.125); sl.lookAt(0, 0.6, -1.2); D.add(sl); }
  // the film camera: a black body with a silver top plate, the prism hump, a lens, the advance lever and a dial
  const chrome = (c = 0xd4d8e2) => lite ? steelM(c) : new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.3, roughnessMap: wearTex() }); /* satin chrome: bright, but not a mirror under the track lights */
  const cam = new THREE.Group(); cam.position.set(-0.2, 0.77, -0.1); cam.scale.setScalar(1.25); cam.rotation.y = Math.PI + 0.45; D.add(cam); // lens toward the room
  if (!lite) scan("camera", "images/models/Camera_01/Camera_01_2k.gltf?w=1", D, (m) => { cam.visible = false; cam.traverse((o) => { if (o.isMesh) o.raycast = () => {}; }); m.userData.hot = cam.userData.hot; m.position.set(0.42, 0.77, -0.04); m.rotation.y = Math.PI + 0.45; }); // a real 35 mm rangefinder, scanned
  block(0.15, 0.085, 0.055, 0x1c1f27, 0, 0.0425, 0, { parent: cam, r: 0.01, ink: false, mat: lite ? undefined : leather(0x1c1f27, plainBump, 0.62, 1.0) }); // pebbled leatherette
  block(0.152, 0.022, 0.057, 0, 0, 0.074, 0, { parent: cam, r: 0.006, mat: chrome(), ink: false });
  if (!lite) { const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 16), chrome()); btn.position.set(0.055, 0.088, 0.012); cam.add(btn); // the shutter button
    block(0.018, 0.004, 0.02, 0, 0, 0.113, -0.004, { parent: cam, r: 0.001, mat: chrome(0x9aa2b4), ink: false }); } // the hot shoe
  { const prism = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.034, 0.03, 4), chrome()); prism.rotation.y = Math.PI / 4; prism.position.set(0, 0.098, 0); prism.scale.set(1.1, 1, 0.9); cam.add(prism); }
  { const lensC = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.06, 32), lite ? toon(0x14161c) : new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.45 })); lensC.rotation.x = Math.PI / 2; lensC.position.set(0, 0.042, 0.055); cam.add(lensC);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.003, 6, 32), chrome(0xc4cad8)); ring.position.set(0, 0.042, 0.07); cam.add(ring);
    if (!lite) for (const zz of [0.038, 0.052]) { const grip = new THREE.Mesh(new THREE.TorusGeometry(0.0315, 0.0025, 6, 48), new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.8 })); grip.position.set(0, 0.042, zz); cam.add(grip); } // the focus and aperture grip rings
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.024, 32), lite ? new THREE.MeshBasicMaterial({ color: 0x2a3a6a }) : new THREE.MeshStandardMaterial({ color: 0x0a1428, metalness: 0.4, roughness: 0.04 })); glass.position.set(0, 0.042, 0.0851); cam.add(glass);
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.006, 10), new THREE.MeshBasicMaterial({ color: 0xffffff })); glint.position.set(0.008, 0.05, 0.0855); cam.add(glint); }
  block(0.03, 0.004, 0.012, 0, 0.05, 0.088, -0.01, { parent: cam, r: 0.002, mat: chrome(), ink: false }); // advance lever
  { const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 32), chrome(0x9aa2b4)); dial.position.set(-0.045, 0.09, 0); cam.add(dial);
    if (!lite) for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, k = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.009, 0.002), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.6 })); k.position.set(-0.045 + Math.cos(a) * 0.012, 0.09, Math.sin(a) * 0.012); k.rotation.y = -a; cam.add(k); } } // knurling on the dial
  // the iPhone 17 Pro Max in orange, lying face down so its camera plateau shows (no logos)
  const ph = new THREE.Group(); ph.position.set(0.16, 0.7705, -0.12); ph.rotation.y = Math.PI - 0.3; ph.scale.setScalar(1.25); D.add(ph);
  if (!lite) { /* desktop: the iPhone built properly, at true size, face down. A rounded-rectangle aluminium frame with the glass
    back set in it, the full-width camera plateau with three ringed lenses, the flash, the LiDAR, the mic, the buttons down the
    sides and the port and speaker holes along the bottom. The built one above is hidden and stops catching clicks. */
    ph.visible = false; ph.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
    const rr = (w, h, r) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false); sh.lineTo(w / 2, h / 2 - r); sh.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false); sh.lineTo(-w / 2 + r, h / 2); sh.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false); sh.lineTo(-w / 2, -h / 2 + r); sh.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false); return sh; };
    const slab = (w, h, r, t, mat, bevel = 0) => { const g = new THREE.ExtrudeGeometry(rr(w, h, r), { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 }); g.rotateX(Math.PI / 2); g.scale(1, 1, -1); g.computeVertexNormals(); /* extruded up from the desk, +y */ const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; };
    const alu = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.75, roughness: 0.38, roughnessMap: wearTex() }), gloss = (c, r = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 });
    const p2 = new THREE.Group(); p2.position.set(-0.52, 0.7705, -0.21); p2.rotation.y = Math.PI + 0.25; D.add(p2); p2.userData.hot = ph.userData.hot;
    const frame = slab(0.078, 0.163, 0.011, 0.0083, alu(0xe8702c), 0.001); frame.position.y = 0.001; p2.add(frame); /* the frame, standing on its face */
    const back = slab(0.075, 0.16, 0.0095, 0.0006, gloss(0xf26a1b, 0.08)); back.position.y = 0.0093; p2.add(back); /* the glass back */
    const plateau = slab(0.072, 0.05, 0.008, 0.0024, alu(0xe8702c)); plateau.position.set(0, 0.0099, 0.052); p2.add(plateau); /* the camera plateau, full width */
    for (const [lx, lz] of [[-0.021, 0.062], [-0.021, 0.042], [-0.004, 0.052]]) { /* three lenses in their rings */
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0082, 0.0082, 0.0036, 40), new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 0.85, roughness: 0.3 })); barrel.position.set(lx, 0.0141, lz); p2.add(barrel);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0074, 0.0007, 8, 40), new THREE.MeshStandardMaterial({ color: 0xd8dae0, metalness: 0.95, roughness: 0.2 })); ring.rotation.x = Math.PI / 2; ring.position.set(lx, 0.0159, lz); p2.add(ring);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.0064, 32), new THREE.MeshStandardMaterial({ color: 0x0b1a3a, metalness: 0.4, roughness: 0.03 })); glass.rotation.x = -Math.PI / 2; glass.position.set(lx, 0.01595, lz); p2.add(glass);
      const glint = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); glint.rotation.x = -Math.PI / 2; glint.position.set(lx + 0.002, 0.016, lz + 0.002); p2.add(glint); }
    const dot = (x, z, r, c) => { const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshStandardMaterial({ color: c, roughness: 0.3 })); d.rotation.x = -Math.PI / 2; d.position.set(x, 0.01235, z); p2.add(d); };
    dot(0.018, 0.064, 0.0032, 0xfff4dc); dot(0.018, 0.047, 0.0032, 0x15161c); dot(0.018, 0.038, 0.0008, 0x0a0a0c); /* the flash, the LiDAR, the mic */
    const btn = (x, z, len) => { const b = new THREE.Mesh(new RoundedBoxGeometry(0.0022, 0.004, len, 2, 0.0008), alu(0xe8702c)); b.position.set(x, 0.0045, z); p2.add(b); };
    btn(-0.0395, 0.052, 0.0105); btn(-0.0395, 0.038, 0.0105); btn(-0.0395, 0.064, 0.006); btn(0.0395, 0.045, 0.02); btn(0.0395, -0.02, 0.016); /* volume, volume, action; power, camera control */
    const port = new THREE.Mesh(new RoundedBoxGeometry(0.009, 0.0032, 0.0016, 2, 0.0012), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.8 })); port.position.set(0, 0.0042, -0.0815); p2.add(port);
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.0016, 8), port.material); h.rotation.x = Math.PI / 2; h.position.set(sx * (0.012 + k * 0.0032), 0.0042, -0.0815); p2.add(h); } /* speaker and mic holes */
    /* a low-profile 75% keyboard in front of the monitor: an aluminium case, a backlit plate, staggered keycaps with printed legends */
    const kb = new THREE.Group(); kb.position.set(0, 0.77, -0.1); kb.rotation.y = 0.04; D.add(kb);
    const U = 0.0175, caseM = new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.6, roughness: 0.42, roughnessMap: wearTex() });
    const cs2 = new THREE.Mesh(new RoundedBoxGeometry(0.305, 0.011, 0.122, 3, 0.004), caseM); cs2.position.y = 0.0055; cs2.castShadow = cs2.receiveShadow = true; kb.add(cs2);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.11), new THREE.MeshStandardMaterial({ color: 0x0a1a1e, roughness: 0.6, emissive: 0x05d9e8, emissiveIntensity: 0.45 })); plate.rotation.x = -Math.PI / 2; plate.position.y = 0.0111; kb.add(plate); /* the backlight shows between the keys */
    const rows = [[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], [1,1,1,1,1,1,1,1,1,1,1,1,1,2], [1.5,1,1,1,1,1,1,1,1,1,1,1,1,1.5], [1.75,1,1,1,1,1,1,1,1,1,1,1,2.25], [2.25,1,1,1,1,1,1,1,1,1,1,2.75], [1.25,1.25,1.25,6.25,1.25,1.25,1,1,1]];
    const legends = [["ESC","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12","DEL","⏏"], ["`","1","2","3","4","5","6","7","8","9","0","-","=","⌫"], ["TAB","Q","W","E","R","T","Y","U","I","O","P","[","]","\\"], ["CAPS","A","S","D","F","G","H","J","K","L",";","'","⏎"], ["⇧","Z","X","C","V","B","N","M",",",".","/","⇧"], ["CTRL","⌥","⌘","","⌘","⌥","←","↓","→"]];
    const keyM = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.72, roughnessMap: wearTex() }), accentM = new THREE.MeshStandardMaterial({ color: 0xe8702c, roughness: 0.6 });
    const lc = document.createElement("canvas"); lc.width = 1220; lc.height = 460; const lx = lc.getContext("2d"); lx.fillStyle = "rgba(0,0,0,0)"; lx.clearRect(0, 0, 1220, 460); lx.textAlign = "center"; lx.textBaseline = "middle"; lx.fillStyle = "#cfd3dc";
    const kw = 0.29, kd = 0.105; /* the key field, in metres, mapped onto the legends canvas */
    rows.forEach((row, ri) => { let x = -kw / 2; const z = -kd / 2 + ri * U + U / 2;
      row.forEach((u, ki) => { const w = u * U, cx = x + w / 2, isEsc = ri === 0 && ki === 0;
        const key = new THREE.Mesh(new RoundedBoxGeometry(w - 0.0018, 0.0045, U - 0.0018, 2, 0.0012), isEsc ? accentM : keyM); key.position.set(cx, 0.0111 + 0.00225, z); key.castShadow = key.receiveShadow = true; kb.add(key);
        const t = legends[ri][ki] || ""; if (t) { lx.font = `${t.length > 2 ? 500 : 600} ${t.length > 2 ? 16 : 24}px 'JetBrains Mono'`; lx.fillText(t, ((cx + kw / 2) / kw) * 1220, (1 - (z + kd / 2) / kd) * 460 + 6); } /* the plane lies flat with its v axis pointing away, so the canvas rows run back to front */
        x += w; }); });
    const lt2 = new THREE.CanvasTexture(lc); lt2.colorSpace = THREE.SRGBColorSpace; lt2.anisotropy = 8;
    const legendPlane = new THREE.Mesh(new THREE.PlaneGeometry(kw, kd), new THREE.MeshBasicMaterial({ map: lt2, transparent: true, depthWrite: false })); legendPlane.rotation.x = -Math.PI / 2; legendPlane.position.y = 0.0111 + 0.0045 + 0.00015; kb.add(legendPlane);
    /* a wireless mouse beside it: a humped shell with its button split and scroll wheel */
    const mo = new THREE.Group(); mo.position.set(-0.29, 0.77, -0.1); mo.rotation.y = -0.2; D.add(mo);
    const mg = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mp = mg.attributes.position, mv = new THREE.Vector3();
    for (let i = 0; i < mp.count; i++) { mv.fromBufferAttribute(mp, i); const t = mv.z; /* -1 front … +1 back */ const hump = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((t * 0.5 + 0.25) * Math.PI)); const waist = 1 - 0.12 * Math.exp(-(((t - 0.1) / 0.5) ** 2)); mp.setXYZ(i, mv.x * 0.031 * waist, mv.y * 0.02 * hump, mv.z * 0.06); } mg.computeVertexNormals();
    const shell = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x1e2128, roughness: 0.5, metalness: 0.05, roughnessMap: wearTex() })); shell.castShadow = shell.receiveShadow = true; mo.add(shell);
    const sole = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.9 })); sole.rotation.x = Math.PI / 2; sole.scale.set(0.031, 0.058, 1); sole.position.y = 0.0005; mo.add(sole);
    const split = new THREE.Mesh(new THREE.BoxGeometry(0.0008, 0.0024, 0.03), new THREE.MeshStandardMaterial({ color: 0x07080c, roughness: 0.9 })); split.position.set(0, 0.0128, -0.04); split.rotation.x = -0.28; mo.add(split);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0048, 0.0055, 28), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.95 })); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.0155, -0.03); mo.add(wheel);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.0016, 0.013), split.material); slot.position.set(0, 0.0145, -0.03); mo.add(slot);
  }
  block(0.078, 0.0083, 0.163, 0xf26a1b, 0, 0.00415, 0, { parent: ph, r: 0.004, ink: false, mat: lite ? undefined : new THREE.MeshStandardMaterial({ color: 0xf26a1b, metalness: 0.2, roughness: 0.2 }) }); block(0.08, 0.004, 0.165, 0x2a1408, 0, 0.002, 0, { parent: ph, r: 0.004, ink: false, mat: lite ? undefined : new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.08 }) }); // the body, on its glass front
  block(0.074, 0.003, 0.042, 0xe35f14, 0, 0.0093, 0.056, { parent: ph, r: 0.003, ink: false, mat: lite ? undefined : new THREE.MeshStandardMaterial({ color: 0xe35f14, metalness: 0.65, roughness: 0.32 }) }); // the full-width camera plateau, anodised
  for (const [lx, lz] of [[-0.018, 0.066], [-0.018, 0.046], [0.002, 0.056]]) { const lr = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 32), lite ? toon(0x1a1a1e) : new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.85, roughness: 0.3 })); lr.position.set(lx, 0.0115, lz); ph.add(lr);
    const lg = new THREE.Mesh(new THREE.CircleGeometry(0.006, 24), lite ? new THREE.MeshBasicMaterial({ color: 0x23304a }) : new THREE.MeshStandardMaterial({ color: 0x0c1830, metalness: 0.4, roughness: 0.04 })); lg.rotation.x = -Math.PI / 2; lg.position.set(lx, 0.0136, lz); ph.add(lg); }
  { const fl = new THREE.Mesh(new THREE.CircleGeometry(0.003, 10), new THREE.MeshBasicMaterial({ color: 0xfff6dc })); fl.rotation.x = -Math.PI / 2; fl.position.set(0.024, 0.0107, 0.066); ph.add(fl); }
  // a few prints, film canisters and a loupe
  photos.slice(1, 4).forEach((p, k) => { const pg = new THREE.PlaneGeometry(0.15, 0.1, lite ? 1 : 12, lite ? 1 : 8);
    if (!lite) { const pp = pg.attributes.position; for (let i = 0; i < pp.count; i++) pp.setZ(i, 0.008 * ((pp.getX(i) / 0.075) ** 2) + 0.003 * ((pp.getY(i) / 0.05) ** 2)); pg.computeVertexNormals(); } // the corners curl up
    const pr = new THREE.Mesh(pg, lite ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, roughnessMap: wearTex() }));
    if (!lite) { const border = new THREE.Mesh(pg.clone(), new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.6 })); border.scale.set(1.1, 1.12, 1); border.position.z = -0.0006; pr.add(border); } /* the white border */
    pr.rotation.set(-Math.PI / 2, 0, -0.3 + k * 0.35); pr.position.set(lite ? 0.48 + k * 0.05 : -0.6 - k * 0.03, 0.772 + k * 0.0006, lite ? -0.05 - k * 0.04 : 0.14 - k * 0.04); D.add(pr);
    loadWall(p.src, (t) => { t.colorSpace = THREE.SRGBColorSpace; pr.material.map = t; pr.material.color.setScalar(0.9); pr.material.needsUpdate = true; }); });
  for (const [cx2, cz2, c, cap] of (lite ? [[-0.45, -0.15, 0xf9d02a, 0x8e929c], [-0.5, -0.2, 0x14161c, 0x2a2d36]] : [[0.6, -0.27, 0xf9d02a, 0x8e929c], [0.66, -0.21, 0x14161c, 0x2a2d36]])) {
    const fc = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, lite ? 14 : 32), lite ? toon(c) : new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })); fc.position.set(cx2, 0.795, cz2); D.add(fc);
    if (!lite) { const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.0152, 0.0152, 0.007, 32), new THREE.MeshStandardMaterial({ color: cap, roughness: 0.75 })); lid.position.set(cx2, 0.8235, cz2); D.add(lid);
      const groove = new THREE.Mesh(new THREE.TorusGeometry(0.0142, 0.0012, 6, 32), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.8 })); groove.rotation.x = Math.PI / 2; groove.position.set(cx2, 0.819, cz2); D.add(groove); } } // the cap and the seam under it
  if (!lite) { const cs = new THREE.Group(); cs.position.set(0.69, 0.77, -0.31); cs.rotation.z = Math.PI / 2; cs.rotation.y = 0.6; D.add(cs); // a metal 35 mm cassette, lying on its side
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.038, 32), new THREE.MeshStandardMaterial({ color: 0x8a8f9c, metalness: 0.85, roughness: 0.35 })); body.position.y = 0.0125; cs.add(body);
    for (const yy of [-0.0065, 0.0315]) { const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.002, 32), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6 })); rim.position.y = yy; cs.add(rim); }
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6 })); spool.position.y = 0.037; cs.add(spool);
    block(0.03, 0.004, 0.012, 0, -0.018, 0.012, 0, { parent: cs, r: 0.001, mat: new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6 }) }); // the felt lip
    const lbl = new THREE.Mesh(new THREE.CylinderGeometry(0.0127, 0.0127, 0.022, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xf9d02a, roughness: 0.6 })); lbl.position.y = 0.0125; cs.add(lbl); } // the label round it
  { const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, lite ? 0.04 : 0.03, 32, 1, !lite), lite ? new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.6 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    if (!lite) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.004, 10, 40), new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.45 })); rim.rotation.x = Math.PI / 2; rim.position.set(-0.68, 0.807, 0.06); D.add(rim); // the black rim
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.015, 32, 16), new THREE.MeshStandardMaterial({ color: 0xeaf4ff, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.55 })); lens.scale.set(1, 0.45, 1); lens.position.set(-0.68, 0.808, 0.06); D.add(lens); } /* the thick glass element */
    lp.position.set(lite ? 0.6 : -0.68, 0.792, lite ? -0.13 : 0.06); D.add(lp); }
  // a desk lamp, a chair, and a red darkroom safelight on the wall
  { const lampG = new THREE.Group(); D.add(lampG); const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 20), steelM(0x6c7389)); base.position.set(-0.62, 0.78, 0.18); lampG.add(base);
    lampG.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.62, 0.79, 0.18), V(-0.64, 1.15, 0.14), V(-0.55, 1.28, 0.02), V(-0.46, 1.22, -0.06)]), 20, 0.008, 6), steelM(0xc4cad8)));
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, lite ? 18 : 40, 1, true), steelM(0x2a2e3a)); sh.material.side = THREE.DoubleSide; sh.position.set(-0.45, 1.19, -0.07); lampG.add(sh);
    if (!lite) { const inner = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.064, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.6, side: THREE.BackSide, emissive: 0xffd9a0, emissiveIntensity: 0.35 })); inner.position.set(-0.45, 1.19, -0.07); lampG.add(inner); // the lit inside of the shade
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), glowMat(0xffe7c0, 1.3)); bulb.position.set(-0.45, 1.165, -0.07); lampG.add(bulb); }
    const lt = new THREE.PointLight(lite ? 0xffd9a0 : 0xffb46a, lite ? 0.3 : 0.6, lite ? 1.2 : 1.6); lt.position.set(-0.45, 1.12, -0.08); D.add(lt); // tungsten-warm on desktop
    if (!lite) scan("lamp", "images/models/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf?w=1", D, (m) => { lampG.visible = false; m.position.set(-0.75, 0.77, -0.1); m.rotation.y = -Math.PI / 2; m.updateMatrixWorld(true); /* clamped on the desk's left end: its springs lean out over open air, the shade swings in over the desk */
      const b = new THREE.Box3().setFromObject(m), dp = D.getWorldPosition(V(0, 0, 0)); lt.intensity = 0.25; lt.position.set(b.max.x - 0.07 - dp.x, b.max.y - 0.16 - dp.y, (b.min.z + b.max.z) / 2 - dp.z); // a faint fill inside the shade; the real light is the cone below
      const sp = new THREE.SpotLight(0xffb46a, 1.6, 2.0, Math.PI / 4.2, 0.7, 1.2); /* soft: a reading pool, not a floodlight */ sp.position.copy(lt.position).add(V(0, -0.05, 0)); sp.target.position.set(lt.position.x + 0.12, 0, lt.position.z + 0.06); D.add(sp); D.add(sp.target);
      sp.castShadow = true; sp.shadow.mapSize.setScalar(1024); sp.shadow.bias = -0.0005; sp.shadow.normalBias = 0.02; sp.shadow.camera.near = 0.05; sp.shadow.camera.far = 2.2; renderer.shadowMap.needsUpdate = true; }); /* a tungsten cone thrown down from the shade onto the desk, the keyboard and mouse casting real shadows in it */ } /* the light moves into the scanned shade */ // a real clamp-on anglepoise, scanned
  { const ch = new THREE.Group(); ch.position.set(0.05, 0, -0.72); D.add(ch);
    if (lite) { block(0.48, 0.07, 0.46, 0x2b2f3d, 0, 0.5, 0, { parent: ch, r: 0.04 }); block(0.46, 0.5, 0.06, 0x2b2f3d, 0, 0.82, -0.22, { parent: ch, r: 0.04, rot: [0.08, 0, 0] }); }
    else { const st = pillow(0.48, 0.07, 0.46, 2, leather(0x2b2f3d, backBump, 0.38, 2.0)); st.position.y = 0.5; ch.add(st);
      const bk = pillow(0.46, 0.06, 0.5, 2, leather(0x2b2f3d, backBump, 0.38, 2.0)); bk.rotation.x = Math.PI / 2 + 0.08; bk.position.set(0, 0.82, -0.22); ch.add(bk); } // stitched leather
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 10), steelM(0xc4cad8)); post.position.y = 0.25; ch.add(post);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; block(0.26, 0.025, 0.03, 0, Math.cos(a) * 0.13, 0.03, Math.sin(a) * 0.13, { parent: ch, r: 0.01, mat: steelM(0x6c7389), rot: [0, -a, 0] }); } }
  { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.06), toon(0x1a1a1e)); sl.position.set(12.55, 2.25, Z0 - 0.04); scene.add(sl);
    const red = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.06), glowMat(0xff2a3a, 1.1)); red.position.set(12.55, 2.25, Z0 - 0.071); red.rotation.y = Math.PI; scene.add(red);
    const rl = new THREE.PointLight(0xff2a3a, 0.8, 2); rl.position.set(12.55, 2.1, Z0 - 0.3); scene.add(rl); }
  // the desk can be sat at: a close-up over the camera and the phone
  const deskHit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), new THREE.MeshBasicMaterial({ visible: false })); deskHit.position.set(11.6, 0.6, Z0 - 0.45); scene.add(deskHit);
  addHot(deskHit, "gallery", "My desk", touch ? "Tap to sit at it" : "Click to sit at it", () => openSpot(deskHit, "Desk", { pos: V(11.6, 1.35, Z0 - 1.35), look: V(11.6, 0.9, Z0 - 0.35) }, {
    hint: `${tapWord} the computer, the camera or the phone · ${tapWord.toLowerCase()} anywhere else to get up`,
    hover: (h) => (h && h.obj !== deskHit ? h : null), click: (h) => (h && h.obj !== deskHit ? h.act() : closeSpot()) }));
  const slideshow = () => { if (sitePhotos.length) { openPhotos("Gallery", sitePhotos); showPhoto(0); } };
  addHot(screen, "gallery", "Photo library", `Every photo on the site · ${tapWord.toLowerCase()} to browse`, () => openLibrary());
  addHot(cam, "gallery", "Film camera", `${tapWord} for a slideshow`, slideshow); addHot(ph, "gallery", "iPhone 17 Pro Max", `Cosmic Orange · ${tapWord.toLowerCase()} for a slideshow`, slideshow);
};
// the kitchen, lived in: a back counter along the wall with the sink and a coffee machine, cabinets over it lit
// underneath, a hologram recipe on the backsplash, pans hanging over the bar, a pink neon EAT, bits and pieces about
const buildKitchenMore = () => {
  const steelDark = steelM(0x3a3f4e);
  block(2.95, 0.9, 0.6, 0, 3.625, 0.45, -0.42, { r: 0.02, mat: steelDark }); // base cabinets
  block(3.0, 0.05, 0.64, 0xd9dde6, 3.625, 0.925, -0.43, { r: 0.01 }); // the worktop
  tube(2.9, 0.012, 0.01, 0x05d9e8, 3.625, 0.06, -0.73, { k: 0.8 }); // kick light
  for (let i = 0; i < 4; i++) block(0.004, 0.7, 0.01, 0x14161f, 2.4 + i * 0.7, 0.45, -0.725, { ink: false }); // door seams
  // the sink, and its faucet
  block(0.5, 0.02, 0.36, 0x14161f, 2.9, 0.952, -0.44, { r: 0.01, ink: false });
  const faucet = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(2.9, 0.95, -0.2), V(2.9, 1.22, -0.22), V(2.9, 1.24, -0.36), V(2.9, 1.1, -0.42)]), 20, 0.012, 8), steelM(0xc4cad8)); scene.add(faucet);
  // a coffee machine with a glowing ready light
  block(0.26, 0.36, 0.28, 0, 4.55, 1.13, -0.32, { r: 0.03, mat: steelM(0x9aa2b4) });
  block(0.18, 0.1, 0.02, 0x0b0c12, 4.55, 1.2, -0.17, { r: 0.01, ink: false });
  blinkers.push({ m: tube(0.03, 0.01, 0.01, 0x2bff88, 4.55, 1.2, -0.158, { k: 1.6 }), rate: 0.15, phase: 0 });
  { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 32), lite ? toon(0xf4f3ff) : new THREE.MeshStandardMaterial({ color: 0xf4f3ff, roughness: 0.14 })); cup.position.set(4.55, 0.985, -0.22); scene.add(cup); }
  // bottles, jars and a cutting board along the worktop
  [[3.35, 0xff7a1a], [3.45, 0x2bff88], [3.54, 0xb98cff]].forEach(([bx, c], k) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2 + k * 0.03, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55 })); b.position.set(bx, 1.05 + k * 0.015, -0.26); scene.add(b); });
  for (let k = 0; k < 4; k++) { const j = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12), toon([0xffd27a, 0xff2a6d, 0xf2ead8, 0x7a5236][k])); j.position.set(3.9 + k * 0.08, 0.99, -0.24); scene.add(j); }
  block(0.34, 0.025, 0.22, 0x8a6a48, 4.05, 0.962, -0.5, { r: 0.008 }); // cutting board
  block(0.18, 0.006, 0.03, 0xc4cad8, 4.08, 0.978, -0.5, { r: 0.002, ink: false }); // the knife on it
  // upper cabinets with a warm strip of light under them, and a backsplash
  block(2.95, 0.5, 0.36, 0, 3.625, 2.25, -0.3, { r: 0.02, mat: steelDark });
  for (let i = 0; i < 4; i++) block(0.004, 0.42, 0.01, 0x14161f, 2.4 + i * 0.7, 2.25, -0.482, { ink: false });
  tube(2.85, 0.012, 0.012, 0xffc78a, 3.625, 1.995, -0.44, { k: 1.0 });
  { const warm = new THREE.PointLight(0xffc78a, 1.2, 2.2); warm.position.set(3.6, 1.8, -0.5); scene.add(warm); }
  block(2.95, 1.02, 0.02, 0x1b1e27, 3.625, 1.46, -0.115, { r: 0.005, ink: false }); // dark glass backsplash
  // the recipe, as a green hologram on the backsplash
  const rc = canvasTex(720, 400, (x, w, h) => {
    const G = "#36ffb0"; x.fillStyle = "rgba(6,40,30,.35)"; x.fillRect(0, 0, w, h); x.strokeStyle = G; x.lineWidth = 3; x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = G; x.font = "700 40px Rajdhani"; x.fillText("TONIGHT // STEAK, PAN-SEARED", 28, 58);
    x.font = "500 22px 'JetBrains Mono'"; x.fillStyle = "#e9fff6";
    ["01  PAT DRY · SALT · PEPPER", "02  PAN SMOKING HOT, OIL", "03  3 MIN A SIDE, DON'T TOUCH", "04  BUTTER · GARLIC · BASTE", "05  REST 5 MIN"].forEach((t, k) => x.fillText(t, 30, 110 + k * 40));
    x.fillStyle = G; x.font = "700 64px Rajdhani"; x.fillText("02:47", 520, 330); x.font = "500 18px 'JetBrains Mono'"; x.fillText("TIMER", 528, 250);
    x.strokeStyle = "rgba(54,255,176,.6)"; x.lineWidth = 6; x.beginPath(); x.arc(590, 300, 70, -Math.PI / 2, Math.PI * 0.9); x.stroke();
    x.fillStyle = "rgba(255,255,255,.05)"; for (let y = 0; y < h; y += 5) x.fillRect(0, y, w, 2);
  });
  const recipe = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.7), new THREE.MeshBasicMaterial({ map: rc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  recipe.position.set(3.75, 1.45, -0.14); recipe.rotation.y = Math.PI; scene.add(recipe);
  recipe.userData.fromKitchen = true;
  addHot(recipe, "living", "Tonight's recipe", touch ? "Tap to read it" : "Click to read it", () => openRecipe());
  // an invisible box over the bar and the counters: click the kitchen to step inside it
  const kitchenHit = new THREE.Mesh(new THREE.BoxGeometry(3.7, 1.1, 2.75), new THREE.MeshBasicMaterial({ visible: false }));
  kitchenHit.position.set(3.35, 0.55, -1.475); scene.add(kitchenHit);
  addHot(kitchenHit, "living", "The kitchen", touch ? "Tap to step inside" : "Click to step inside", () => openKitchen(kitchenHit)); kitchenHit.userData.fromCat = "spot";
  animators.push((now) => { recipe.material.opacity = reduce ? 0.85 : Math.sin(now / 77) > 0.986 ? 0.45 : 0.85; });
  // a rail over the bar with pans and a ladle hanging
  { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.8, 10), steelM(0xc4cad8)); rail.rotation.z = Math.PI / 2; rail.position.set(3.4, 2.5, -1.55); scene.add(rail);
    for (const dx of [-0.85, 0.85]) block(0.015, 0.9, 0.015, 0x2a2e3a, 3.4 + dx, 2.95, -1.55, { ink: false });
    for (const [hx, r] of [[2.8, 0.13], [3.25, 0.1], [3.7, 0.15]]) { // pans, hanging face-on
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6), steelM(0x9aa2b4)); hook.position.set(hx, 2.45, -1.55); scene.add(hook);
      block(0.025, 0.16, 0.02, 0x14161f, hx, 2.32, -1.55, { r: 0.006, mat: lite ? undefined : panMat(r > 0.14 ? "iron" : "steel") }); // handle
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.035, 24), steelM(0x6c7389)); pan.rotation.x = Math.PI / 2; pan.position.set(hx, 2.24 - r, -1.55); scene.add(pan);
      if (!lite) { pan.visible = false; const kind = r > 0.14 ? "iron" : r > 0.11 ? "copper" : "steel";
        const p = new THREE.Mesh(panGeo(r, r * 0.32), panMat(kind)); p.rotation.x = -Math.PI / 2; p.position.set(hx, 2.24 - r, -1.55 + 0.02); p.castShadow = p.receiveShadow = true; scene.add(p); } /* face-on, the inside toward the room */
      const ink = new THREE.Mesh(pan.geometry, inkMat); ink.scale.set(1.04, 1.2, 1.04); pan.add(ink);
    }
    const ladle = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(4.05, 2.45, -1.55), V(4.05, 2.15, -1.55), V(4.1, 2.06, -1.55)]), 10, 0.008, 6), steelM(0xc4cad8)); scene.add(ladle);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.05, lite ? 12 : 32, lite ? 8 : 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lite ? steelM(0xc4cad8) : panMat("steel")); bowl.position.set(4.12, 2.07, -1.55); scene.add(bowl); if (!lite) ladle.material = panMat("steel"); }
  // a fruit bowl on the bar
  { const fb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lite ? steelM(0x9aa2b4) : new THREE.MeshStandardMaterial({ color: 0xc4c9d4, metalness: 0.95, roughness: 0.12, side: THREE.DoubleSide })); fb.material.side = THREE.DoubleSide; fb.position.set(3.0, 1.15, -2.38); scene.add(fb); // the lower half of a sphere: a bowl, open at the top
    [[0xff7a1a, -0.05, 0], [0x2bd68f, 0.05, 0.02], [0xff2a6d, 0, -0.05], [0xf9f002, 0.02, 0.05]].forEach(([c, dx, dz], i) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), lite ? toon(c) : new THREE.MeshStandardMaterial({ color: [0xe8762a, 0x8bc34a, 0xc62828, 0xf2d14a][i], roughness: [0.55, 0.5, 0.25, 0.5][i] })); /* an orange, a lime, an apple, a lemon */ f.position.set(3.0 + dx, 1.07, -2.38 + dz); scene.add(f); }); } // no thick outline on something this small
  // a pink neon EAT on the wall over the shelves
  sign("EAT", 0.34, 5.88, 2.5, -1.68, { color: "#ff2a6d", font: "700 160px Rajdhani", rotY: -Math.PI / 2, k: 1.1, glow: 0.12, core: 0 }).userData.flicker = true;
};
const buildDecor = () => {
  // ---- hallway (on the front wall, where the doorstep camera can see it)
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
  }), -2.75, 1.75, 0.125, { transparent: true, k: 1.0 }); // on the wall between my door and 4A
  block(1.68, 1.08, 0.04, 0x0e0f16, -2.75, 1.75, 0.104, { r: 0.01 });
  animators.push((now) => { ad.material.opacity = Math.sin(now / 90) > 0.96 ? 0.35 : 0.92; }); // holo flicker
  // the rest of the building's ads, up and down the hall: food, fun and services downstairs
  const ICONS = {
    bowl: (x, c) => { x.fillStyle = c; x.beginPath(); x.arc(0, 0, 70, 0, Math.PI); x.fill(); x.fillRect(-80, -8, 160, 12);
      x.strokeStyle = "#f4f3ff"; x.lineWidth = 6; x.beginPath(); x.moveTo(20, -10); x.lineTo(70, -90); x.moveTo(40, -10); x.lineTo(90, -80); x.stroke();
      x.strokeStyle = "rgba(255,255,255,.6)"; x.lineWidth = 4; for (const dx of [-35, -5, 25]) { x.beginPath(); x.moveTo(dx, -25); x.bezierCurveTo(dx - 15, -45, dx + 15, -60, dx, -80); x.stroke(); } },
    joystick: (x, c) => { x.fillStyle = "#2a2450"; x.fillRect(-75, 20, 150, 50); x.fillStyle = c; x.fillRect(-10, -50, 20, 75); x.beginPath(); x.arc(0, -60, 28, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#f9f002"; x.beginPath(); x.arc(45, 45, 12, 0, Math.PI * 2); x.fill(); x.fillStyle = "#05d9e8"; x.beginPath(); x.arc(-45, 45, 12, 0, Math.PI * 2); x.fill(); },
    coin: (x, c) => { x.fillStyle = c; x.beginPath(); x.arc(0, 0, 75, 0, Math.PI * 2); x.fill(); x.fillStyle = "#fff"; x.font = "700 110px Rajdhani"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("₿", 0, 6); x.textAlign = "left"; x.textBaseline = "top"; },
    film: (x, c) => { x.strokeStyle = c; x.lineWidth = 10; x.beginPath(); x.arc(0, 0, 70, 0, Math.PI * 2); x.stroke(); x.fillStyle = c; for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2; x.beginPath(); x.arc(Math.cos(a2) * 38, Math.sin(a2) * 38, 13, 0, Math.PI * 2); x.fill(); } },
    burger: (x, c) => { x.fillStyle = "#e9a04a"; x.beginPath(); x.arc(0, -15, 72, Math.PI, 0); x.fill(); x.fillStyle = "#4cb54a"; x.fillRect(-78, -12, 156, 14); x.fillStyle = "#7a3a22"; x.fillRect(-74, 4, 148, 26); x.fillStyle = c; x.fillRect(-70, 30, 140, 10); x.fillStyle = "#e9a04a"; x.fillRect(-72, 40, 144, 24); },
    mic: (x, c) => { x.fillStyle = c; x.beginPath(); x.ellipse(0, -35, 32, 45, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = "#d6d6e7"; x.fillRect(-7, 10, 14, 70); x.strokeStyle = "#d6d6e7"; x.lineWidth = 6; x.beginPath(); x.arc(0, -20, 52, 0.2, Math.PI - 0.2); x.stroke(); },
    drone: (x, c) => { x.fillStyle = "#d6d6e7"; x.fillRect(-45, -12, 90, 24); x.strokeStyle = c; x.lineWidth = 6; for (const dx of [-70, 70]) { x.beginPath(); x.ellipse(dx, -22, 34, 8, 0, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(dx * 0.6, -10); x.lineTo(dx, -20); x.stroke(); }
      x.fillStyle = "#c48f55"; x.fillRect(-28, 18, 56, 44); x.strokeStyle = "#f4f3ff"; x.lineWidth = 3; x.strokeRect(-28, 18, 56, 44); },
  };
  const adCanvas = (a) => canvasTex(a.vert ? 300 : 640, a.vert ? 940 : 400, (x, w, h) => {
    x.fillStyle = "rgba(10,4,24,.62)"; x.fillRect(0, 0, w, h);
    x.strokeStyle = a.col; x.lineWidth = 6; x.shadowColor = a.col; x.shadowBlur = 14; x.strokeRect(8, 8, w - 16, h - 16); x.shadowBlur = 0;
    x.textBaseline = "top"; x.textAlign = "left";
    if (a.vert) { // a tall banner: one letter per line
      x.textAlign = "center"; const letters = [...a.title.replace(/ /g, "")], size = Math.min(120, 760 / letters.length);
      x.font = `700 ${size}px Rajdhani`; x.fillStyle = a.col; x.shadowColor = a.col; x.shadowBlur = 18;
      letters.forEach((ch, i) => x.fillText(ch, w / 2, 40 + i * size * 0.95)); x.shadowBlur = 0;
      x.font = "500 24px 'JetBrains Mono'"; x.fillStyle = "#d6d6e7"; x.fillText(a.tag, w / 2, h - 70);
    } else {
      x.save(); x.translate(130, h / 2 + 10); ICONS[a.icon]?.(x, a.col); x.restore();
      let size = 88; x.font = `700 ${size}px Rajdhani`; while (x.measureText(a.title).width > w - 280 && size > 40) x.font = `700 ${--size}px Rajdhani`;
      x.fillStyle = a.col; x.shadowColor = a.col; x.shadowBlur = 20; x.fillText(a.title, 250, 70); x.shadowBlur = 0;
      const fit = (t, weight, px, fam) => { let z = px; x.font = `${weight} ${z}px ${fam}`; while (x.measureText(t).width > w - 280 && z > 14) x.font = `${weight} ${--z}px ${fam}`; };
      fit(a.sub, 600, 30, "Inter"); x.fillStyle = "#f4f3ff"; x.fillText(a.sub, 252, 82 + size);
      fit(a.tag, 500, 26, "'JetBrains Mono'"); x.fillStyle = a.tagCol || "#05d9e8"; x.fillText(a.tag, 252, 300);
    }
    for (let y = 0; y < h; y += 6) { x.fillStyle = "rgba(255,255,255,.05)"; x.fillRect(0, y, w, 2); }
  });
  const ADS = [
    // the near wall (my side)
    { x: -7.75, title: "NEON NOODLE", sub: "Hand-pulled · broth on tap", tag: "B1 · FOOD HALL", col: "#ff2a6d", icon: "bowl" },
    { x: 7.8, title: "ORBITAL ARCADE", sub: "VR pods · retro cabinets", tag: "B2 · OPEN LATE", col: "#05d9e8", icon: "joystick", tagCol: "#f9f002" },
    { x: 13.4, vert: true, title: "KILOWATT COFFEE", tag: "LOBBY · 24/7", col: "#f9f002" },
    { x: -13.6, title: "SATS ATM", sub: "Buy · sell · stack", tag: "LOBBY · 24/7", col: "#f7931a", icon: "coin" },
    // across the hall (behind you)
    { x: -5.5, back: true, title: "DREAMLOOP CINEMA", sub: "Midnight double feature", tag: "B3 · TICKETS AT THE DOOR", col: "#b98cff", icon: "film" },
    { x: 5.7, back: true, title: "BYTE BURGER", sub: "Printed fresh in 90 seconds", tag: "B1 · FOOD HALL", col: "#ff7a1a", icon: "burger" },
    { x: 11.6, back: true, vert: true, title: "BOBA.EXE", tag: "B1 · BUBBLE TEA", col: "#ff6bd5" },
    { x: -11.6, back: true, title: "HOLO KARAOKE", sub: "Sing with your hologram", tag: "B2 · PRIVATE ROOMS", col: "#ff2a6d", icon: "mic" },
    { x: 0.1, back: true, title: "SKYDROP", sub: "Food at your door in 4 min", tag: "DRONE DELIVERY · ALL FLOORS", col: "#05d9e8", icon: "drone" },
    { x: -14.6, back: true, vert: true, title: "GRAV GYM", tag: "ROOF · LOW-G", col: "#2bff88" },
  ];
  ADS.forEach((a, i) => {
    const w = a.vert ? 0.5 : 1.5, h = a.vert ? 1.57 : 0.94, z = a.back ? 5.2 - 0.115 : 0.125;
    block(w + 0.08, h + 0.08, 0.04, 0x0e0f16, a.x, a.vert ? 1.6 : 1.75, a.back ? 5.106 : 0.104, { r: 0.01 }); // a flush screen bezel, just behind the screen
    const m = panel(w, h, adCanvas(a), a.x, a.vert ? 1.6 : 1.75, z, { transparent: true, k: 0.95, rotY: a.back ? Math.PI : 0 });
    const ph = i * 1.37; animators.push((now) => { m.material.opacity = Math.sin(now / 110 + ph * 7) > 0.97 ? 0.35 : 0.92; }); // each flickers on its own beat
  });
  // news tickers running along the top of both walls
  const tickerText = "TONIGHT ON B3: DREAMLOOP MIDNIGHT DOUBLE FEATURE  ✦  NEON NOODLE: 2-FOR-1 BOWLS AFTER MIDNIGHT  ✦  ORBITAL ARCADE HIGH-SCORE NIGHT  ✦  ROOFTOP NIGHT MARKET FRIDAY  ✦  LIFT 2 BACK IN SERVICE  ✦  ";
  // the canvas is exactly a whole number of copies wide, so the loop has no seam
  const tm = document.createElement("canvas").getContext("2d"); tm.font = "500 56px 'JetBrains Mono'";
  const tw = Math.ceil(tm.measureText(tickerText).width), copies = Math.max(1, Math.floor(4096 / tw));
  const tickTex = canvasTex(tw * copies, 96, (x, w, h) => {
    x.fillStyle = "rgba(10,4,24,.8)"; x.fillRect(0, 0, w, h);
    x.font = "500 56px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 10; x.textBaseline = "middle";
    for (let i = 0; i < copies; i++) x.fillText(tickerText, i * tw, h / 2 + 2);
  });
  tickTex.wrapS = THREE.RepeatWrapping; tickTex.repeat.set(1.6, 1);
  for (const [z, rotY] of [[5.2 - 0.11, Math.PI], [0.11, 0]]) { // the far wall, and mine (above the doors)
    panel(24, 0.22, tickTex, 0, 2.98, z, { k: 1.0, rotY });
    for (const y of [3.1, 2.86]) tube(24.2, 0.02, 0.02, 0x05d9e8, 0, y, z, { k: 1.3 });
  }
  animators.push((now, dt) => { tickTex.offset.x += dt * 0.00004; });
  // a sign hanging from the ceiling, pointing the way
  const hang = new THREE.Group(); hang.position.set(-3.6, 2.85, 2.6); hang.rotation.y = Math.PI / 2; scene.add(hang);
  for (const dz of [-0.45, 0.45]) block(0.02, 0.4, 0.02, 0x16102e, dz, 0.32, 0, { parent: hang, ink: false });
  block(1.2, 0.34, 0.06, 0x0c0818, 0, 0, 0, { parent: hang, r: 0.02 });
  for (const side of [1, -1]) sign(side > 0 ? "◄ LIFT · FOOD HALL B1" : "4C – 4H ►", 0.16, 0, 0, side * 0.035, { parent: hang, color: "#05d9e8", font: "700 90px Rajdhani", k: 1.2, glow: 0.1, core: 0, rotY: side > 0 ? 0 : Math.PI });

  // ---- living room
  // glowing baseboards
  tube(0.03, 0.03, 6.8, 0x05d9e8, -5.88, 0.03, -3.5, { k: 1.5 }); tube(0.03, 0.03, 2.6, 0xff2a6d, 5.88, 0.03, -5.6, { k: 1.5 }); // the right one runs from the gallery doorway to the back
  for (const [x0, x1] of [[-3.8, -2.6], [2.6, 3.8], [-6, -5.2], [5.2, 6]]) tube(x1 - x0, 0.03, 0.03, 0x05d9e8, (x0 + x1) / 2, 0.03, -6.88, { k: 1.5 });
  // my Bitcoin node: a little rack with blinking lights (beside the theater door)
  const node = new THREE.Group(); node.position.set(-5.62, 0, -3.7); node.rotation.y = Math.PI / 2; scene.add(node); // against the left wall
  block(0.62, 1.42, 0.5, 0x16102e, 0, 0.71, 0, { parent: node, r: 0.04 });
  for (let u = 0; u < 4; u++) {
    block(0.54, 0.24, 0.04, 0x241a4a, 0, 0.3 + u * 0.3, 0.25, { parent: node, r: 0.015, ink: false });
    for (let i = 0; i < 5; i++) blinkers.push({ m: tube(0.025, 0.025, 0.01, i % 3 ? 0x2bff88 : 0xf9f002, -0.2 + i * 0.05, 0.3 + u * 0.3, 0.275, { parent: node, k: 2.2 }), rate: 0.5 + Math.random() * 3, phase: Math.random() * 10 });
    const fan = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), glowMat(0x05d9e8, 1.2)); fan.position.set(0.17, 0.3 + u * 0.3, 0.275); node.add(fan);
  }
  if (!lite) { /* desktop: a real rack. Black powder-coat cabinet, brushed-aluminium faceplates (drive bays, a vent grille, pull handles),
      wire fan guards, mounting rails with their screws */
    const face = canvasTex(512, 224, (x, w, h) => { x.fillStyle = "#9ea4b0"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) { x.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"; x.fillRect(0, Math.random() * h, w, 1); } /* brushed */
      for (let b = 0; b < 4; b++) { const bx = 30 + b * 62; x.fillStyle = "#1a1c22"; x.fillRect(bx, 40, 52, 140); x.fillStyle = "#2e313a"; x.fillRect(bx + 4, 44, 44, 132); x.fillStyle = "#0c0d10"; for (let k = 0; k < 6; k++) x.fillRect(bx + 10, 56 + k * 18, 32, 3); } /* drive bays */
      x.fillStyle = "#15171c"; for (let gy = 50; gy < 170; gy += 10) for (let gx = 300; gx < 470; gx += 10) { x.beginPath(); x.arc(gx, gy, 3, 0, 6.3); x.fill(); } /* vent grille */
      x.strokeStyle = "rgba(0,0,0,.5)"; x.lineWidth = 3; x.strokeRect(2, 2, w - 4, h - 4); });
    const faceM = new THREE.MeshStandardMaterial({ map: face, bumpMap: face, bumpScale: 1.2, metalness: 0.7, roughness: 0.42 });
    const coat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.55, metalness: 0.2, roughnessMap: wearTex() });
    node.traverse((o) => { if (!o.isMesh) return; const c = o.material.color?.getHex(); if (c === 0x16102e) o.material = coat; if (c === 0x241a4a) { o.material = faceM; o.castShadow = o.receiveShadow = true; } if (o.geometry.type === "TorusGeometry") o.material = glowMat(0x05d9e8, 0.55); });
    const wire = new THREE.MeshStandardMaterial({ color: 0x2a2d34, metalness: 0.8, roughness: 0.4 });
    for (let u = 0; u < 4; u++) { const y = 0.3 + u * 0.3; for (const rr of [0.06, 0.04, 0.02]) { const g = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0018, 4, 32), wire); g.position.set(0.17, y, 0.282); node.add(g); }
      for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.0025, 0.0025), wire); sp.position.set(0.17, y, 0.283); sp.rotation.z = (k / 4) * Math.PI; node.add(sp); } /* the fan's wire guard */
      for (const hx of [-0.25, 0.25]) { const hd = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0xc4c9d4, metalness: 0.9, roughness: 0.25 })); hd.position.set(hx, y, 0.278); hd.rotation.z = hx < 0 ? Math.PI / 2 : -Math.PI / 2; node.add(hd); } } /* pull handles */
    for (const rx of [-0.29, 0.29]) { block(0.025, 1.3, 0.012, 0, rx, 0.72, 0.252, { parent: node, r: 0.002, mat: new THREE.MeshStandardMaterial({ color: 0x8a8f9c, metalness: 0.85, roughness: 0.35 }) }); /* the mounting rails */
      for (let k = 0; k < 16; k++) { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 10), new THREE.MeshStandardMaterial({ color: 0x3a3d46, metalness: 0.9, roughness: 0.3 })); sc.rotation.x = Math.PI / 2; sc.position.set(rx, 0.15 + k * 0.075, 0.259); node.add(sc); } } }
  sign("NODE", 0.12, 0, 1.52, 0.26, { parent: node, color: "#f9f002", font: "700 100px Rajdhani", k: 1.4 });
  addHot(node, "living", "My Bitcoin node", touch ? "Tap to see what it's tracking" : "Click to see what it's tracking", () => openNode());
  // a chess table against the right wall, a game in progress: plays me at chess.
  // Brushed steel, with an arched desk lamp whose head shines the board down flat onto the top as a hologram.
  const ct = new THREE.Group(); ct.position.set(5.45, 0, -5.05); ct.rotation.y = -Math.PI / 2; scene.add(ct); // local +z faces into the room
  block(0.66, 0.05, 0.66, 0, 0, 0.74, 0, { parent: ct, r: 0.02, mat: steelM(0x9aa2b4) });
  block(0.6, 0.012, 0.6, 0x14161f, 0, 0.768, 0, { parent: ct, r: 0.01, ink: false }); // a dark glass inlay
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 16), steelM(0xc4cad8)); stem.position.y = 0.37; ct.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.04, 28), steelM(0x6c7389)); foot.position.y = 0.02; ct.add(foot);
  for (const o of [stem, foot]) { const ink = new THREE.Mesh(o.geometry, inkMat); ink.scale.set(1.12, 1.01, 1.12); o.add(ink); }
  // the lamp: a weighted base at the back corner, a slim arm arching up and over, a head with the projector lens facing down
  const LY = 1.28; // the head's height above the floor
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 24), steelM(0x6c7389)); lampBase.position.set(0.24, 0.79, -0.24); ct.add(lampBase);
  const armPath = new THREE.CatmullRomCurve3([V(0.24, 0.8, -0.24), V(0.26, 1.12, -0.26), V(0.18, 1.34, -0.18), V(0.06, LY + 0.04, -0.06), V(0, LY + 0.02, 0)]);
  ct.add(new THREE.Mesh(new THREE.TubeGeometry(armPath, 32, 0.011, 8), steelM(0xc4cad8)));
  ct.add(new THREE.Mesh(new THREE.TubeGeometry(armPath, 32, 0.016, 8), inkMat)); // its outline: a fatter tube along the same path
  { const ink = new THREE.Mesh(lampBase.geometry, inkMat); ink.scale.setScalar(1.06); lampBase.add(ink); }
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.045, 24), steelM(0x9aa2b4)); head.position.y = LY; ct.add(head);
  { const ink = new THREE.Mesh(head.geometry, inkMat); ink.scale.set(1.08, 1.12, 1.08); head.add(ink); }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), glowMat(0x7ff6ff, 1.3)); lens.rotation.x = Math.PI / 2; lens.position.y = LY - 0.024; ct.add(lens);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 6, 28), glowMat(0x05d9e8, 1.1)); lensRing.rotation.x = Math.PI / 2; lensRing.position.y = LY - 0.024; ct.add(lensRing);
  // the beam: a faint pyramid of light from the lens down to the corners of the board, which lies flat on the table
  const holoMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const B = 0.52, sq = B / 8, HY = 0.777; // board size, square size, the board's height (just over the glass inlay)
  const chessBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, B * 0.707, LY - 0.025 - HY, 4, 1, true), holoMat(0x05d9e8, 0.06));
  chessBeam.rotation.y = Math.PI / 4; chessBeam.position.y = (LY - 0.025 + HY) / 2; chessBeam.raycast = () => {}; ct.add(chessBeam);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(B, B), holoMat(0xffffff, 0.9));
  board.material.map = canvasTex(512, 512, (x, w) => {
    const c = w / 8;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { x.fillStyle = (r + f) % 2 ? "rgba(5,217,232,.10)" : "rgba(5,217,232,.42)"; x.fillRect(f * c, r * c, c, c); }
    x.strokeStyle = "rgba(127,246,255,.7)"; x.lineWidth = 2; for (let k = 1; k < 8; k++) { x.beginPath(); x.moveTo(k * c, 0); x.lineTo(k * c, w); x.moveTo(0, k * c); x.lineTo(w, k * c); x.stroke(); }
    x.strokeStyle = "#7ff6ff"; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, w - 8);
    x.fillStyle = "rgba(255,255,255,.06)"; for (let y = 0; y < w; y += 6) x.fillRect(0, y, w, 2); // scan lines
  });
  board.rotation.x = -Math.PI / 2; board.position.y = HY; ct.add(board); // clicking the hologram counts as clicking the table
  // pieces as light: cyan for white, magenta for black. A middlegame: (file 0–7, rank 0–7, type, side)
  const pieceMats = { 1: holoMat(0x4fd8ec, 0.34), 0: holoMat(0xff4fa0, 0.5) }; // light adds up where pieces overlap, so keep them soft
  const pieces = new THREE.Group(); pieces.position.y = HY; ct.add(pieces);
  const piece = (f, r, type, white) => {
    const g = new THREE.Group(); g.position.set((f - 3.5) * sq, 0.002, (3.5 - r) * sq); pieces.add(g);
    const m = pieceMats[white ? 1 : 0], add = (geo, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.raycast = () => {}; g.add(o); return o; };
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
  // the hologram hums: a slow shimmer, the odd flicker, the pieces bobbing a hair
  animators.push((now) => {
    if (reduce) return;
    const flick = Math.sin(now / 97) > 0.985 ? 0.55 : 1, sh = 0.9 + Math.sin(now / 420) * 0.1;
    board.material.opacity = 0.9 * sh * flick; pieceMats[1].opacity = 0.34 * sh * flick; pieceMats[0].opacity = 0.5 * sh * flick;
    chessBeam.material.opacity = 0.06 * sh; pieces.position.y = HY + Math.sin(now / 900) * 0.004;
  });
  // two steel stools to match
  for (const sx of [-0.55, 0.55]) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.06, 24), toon(0x2b2f3d)); seat.position.set(sx, 0.48, 0.05); ct.add(seat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 12), steelM(0xc4cad8)); leg.position.set(sx, 0.225, 0.05); ct.add(leg);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.025, 24), steelM(0x6c7389)); base.position.set(sx, 0.012, 0.05); ct.add(base);
    for (const o of [seat, leg, base]) { const ink = new THREE.Mesh(o.geometry, inkMat); ink.scale.set(1.1, 1.04, 1.1); o.add(ink); }
  }
  sign("♚ PLAY ME", 0.14, 0, 2.55, -0.32, { parent: ct, color: "#05d9e8", font: "700 100px Rajdhani", k: 1.0, glow: 0.1, core: 0 });
  const chessUser = S.chess?.username;
  if (chessUser) addHot(ct, "living", "Play me at chess", touch ? "Tap to walk over" : "Click to walk over", () => (spot?.g === ct ? askChess() : openChess(ct)));
  // the plant moves to the other corner to make room
  // hologram projector on the coffee table: off until you tap it, then it throws up a bouquet of flowers in light
  // (see-through, glowing, slowly turning, scan lines climbing through it and the odd flicker, so it reads as a projection)
  {
    const proj = new THREE.Group(); proj.position.set(0, 0, -5.95); scene.add(proj);
    block(0.26, 0.05, 0.26, 0x16102e, 0, 0.445, 0, { parent: proj, r: 0.02 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 28), glowMat(0x05d9e8, 1)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.472; proj.add(ring);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.4), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.47; proj.add(hit); // an easier target than the little box
    const upHit = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.8, 12), new THREE.MeshBasicMaterial({ visible: false })); upHit.position.y = 0.9; proj.add(upHit); // the bouquet, once it's on
    const mats = [], holoM = (color, o) => { const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }); m.userData.o = o; mats.push(m); return m; };
    const none = () => {};
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.08, 0.66, 24, 1, true), holoM(0x05d9e8, 0.09)); beam.position.y = 0.8; beam.raycast = none; proj.add(beam);
    const bq = new THREE.Group(); bq.position.y = 0.5; proj.add(bq);
    const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.raycast = none; bq.add(o); return o; };
    // the vase, with its edges traced in light
    add(new THREE.CylinderGeometry(0.075, 0.05, 0.22, 14, 1, true), holoM(0x7ff6ff, 0.16), 0, 0.11, 0);
    const vEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.075, 0.05, 0.22, 14)), new THREE.LineBasicMaterial({ color: new THREE.Color(0x7ff6ff).multiplyScalar(1.4), transparent: true, opacity: 0.7, toneMapped: false }));
    vEdge.material.userData.o = 0.7; mats.push(vEdge.material); vEdge.position.y = 0.11; bq.add(vEdge);
    // stems, leaves and flowers
    const stemM = holoM(0x5dffb0, 0.5), leafM = holoM(0x5dffb0, 0.28), heart = holoM(0xfff2b0, 0.75);
    const petalCols = [0xff4fa0, 0xff7ad9, 0xb98cff, 0x7ff6ff, 0xffd27a, 0xff4fa0, 0xb98cff, 0xff7ad9];
    const petalGeo = new THREE.SphereGeometry(0.04, 12, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * 0.79 + 0.3, lean = 0.12 + (i % 3) * 0.06, hgt = 0.34 + ((i * 5) % 4) * 0.06;
      const tip = V(Math.cos(a) * lean, 0.2 + hgt, Math.sin(a) * lean), mid = V(Math.cos(a) * lean * 0.3, 0.2 + hgt * 0.55, Math.sin(a) * lean * 0.3);
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0.16, 0), mid, tip]), 12, 0.0045, 5), stemM);
      if (i % 2 === 0) { const lf = add(petalGeo, leafM, mid.x * 1.6, mid.y, mid.z * 1.6); lf.scale.set(1.2, 0.18, 0.5); lf.rotation.set(0.4, -a, 0.5); }
      const fl = new THREE.Group(); fl.position.copy(tip); bq.add(fl); fl.lookAt(tip.clone().multiplyScalar(2).setY(tip.y + 0.4)); // face out and up
      const pm = holoM(petalCols[i], 0.45), n = i % 2 ? 5 : 7;
      for (let k = 0; k < n; k++) { const pa = (k / n) * Math.PI * 2, p = new THREE.Mesh(petalGeo, pm); p.raycast = none; p.position.set(Math.cos(pa) * 0.035, Math.sin(pa) * 0.035, 0); p.scale.set(0.9, 0.5, 0.22); p.rotation.z = pa; fl.add(p); }
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), heart); c.raycast = none; fl.add(c);
    }
    // a scan line that climbs up through it
    const scan = add(new THREE.TorusGeometry(0.2, 0.003, 4, 40), holoM(0x7ff6ff, 0.55)); scan.rotation.x = Math.PI / 2;
    let on = false, k = 0;
    const hotIx = hot.length;
    const toggle = () => { on = !on; hot[hotIx].sub = on ? (touch ? "Tap to turn it off" : "Click to turn it off") : (touch ? "Tap to turn it on" : "Click to turn it on"); upHit.raycast = on ? THREE.Mesh.prototype.raycast : none; };
    upHit.raycast = none;
    proj.userData.fromCouch = true;
    addHot(proj, "living", "Hologram projector", touch ? "Tap to turn it on" : "Click to turn it on", toggle);
    animators.push((now, dt) => {
      k += ((on ? 1 : 0) - k) * Math.min(1, dt / (on ? 450 : 250));
      const live = k > 0.01; bq.visible = beam.visible = live;
      ring.material.color.set(on ? 0x05d9e8 : 0x0b3a44).multiplyScalar(on ? 1.2 : 1);
      if (!live) return;
      const flick = reduce ? 1 : Math.sin(now / 83) > 0.985 ? 0.35 : 0.92 + Math.sin(now / 37) * 0.08;
      for (const m of mats) m.opacity = m.userData.o * k * flick;
      bq.scale.setScalar(0.4 + 0.6 * k); bq.rotation.y = reduce ? 0 : now / 5000;
      scan.position.y = 0.05 + ((now / 2200) % 1) * 0.62;
    });
  }
  // my latest read from Goodreads, lying on the table beside the projector; tap it for my Goodreads
  {
    const bk = new THREE.Group(); bk.position.set(-0.32, 0.42, -5.8); bk.rotation.y = 0.35; scene.add(bk);
    block(0.155, 0.03, 0.235, 0xf2ead8, 0.002, 0.018, 0, { parent: bk, r: 0.003, ink: false }); // the pages
    block(0.165, 0.005, 0.245, 0x2a2e3a, 0, 0.0025, 0, { parent: bk, r: 0.002, ink: false }); // back board
    block(0.008, 0.038, 0.245, 0x2a2e3a, -0.0785, 0.019, 0, { parent: bk, r: 0.003, ink: false }); // spine
    // a thin outline round the whole book (the scene's usual one is thicker than the book itself)
    { const hull = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.038, 0.245), inkMat); hull.scale.set(1.035, 1.12, 1.025); hull.position.y = 0.019; bk.add(hull); }
    const coverMat = new THREE.MeshBasicMaterial({ color: 0x2a2e3a });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.165, 0.245), coverMat); cover.rotation.x = -Math.PI / 2; cover.position.y = 0.0365; bk.add(cover);
    const bkIx = hot.length;
    bk.userData.fromCouch = true;
    addHot(bk, "living", "What I'm reading", touch ? "Tap for my Goodreads" : "Click for my Goodreads", () => latestBook?.profile && window.open(latestBook.profile, "_blank", "noopener"));
    setBook = (b) => { // called once data/feeds.json has loaded
      latestBook = b;
      hot[bkIx].label = b.title.split(":")[0]; hot[bkIx].sub = [b.author && `by ${b.author}`, touch ? "Tap for my Goodreads" : "Click for my Goodreads"].filter(Boolean);
      loader.load(`data/latest-book.jpg?${encodeURIComponent(b.title)}`, (t) => { t.colorSpace = THREE.SRGBColorSpace; coverMat.map = t; coverMat.color.setScalar(0.9); coverMat.needsUpdate = true; },
        undefined, () => { coverMat.map = canvasTex(330, 490, (x, w, h) => { x.fillStyle = "#1b1e27"; x.fillRect(0, 0, w, h); x.fillStyle = "#f4f3ff"; x.font = "700 40px Inter"; wrap(x, b.title, w - 40, 6).forEach((l, n) => x.fillText(l, 20, 70 + n * 48)); x.font = "500 26px Inter"; x.fillStyle = "#9d9dc0"; x.fillText(b.author || "", 20, h - 40); }); coverMat.color.setScalar(1); coverMat.needsUpdate = true; });
    };
  }
  // posters on the side walls (drag to look around)
  const poster = (draw, x, z, rotY) => { block(0.95, 1.3, 0.04, 0x16102e, x, 1.75, z, { rot: [0, rotY, 0], r: 0.01 }); panel(0.85, 1.2, canvasTex(340, 480, draw), x + Math.sin(rotY) * 0.03, 1.75, z + Math.cos(rotY) * 0.03, { rotY, k: 1.05 }); };
  poster((x, w, h) => { // synthwave sun over a grid
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#14062e"); g.addColorStop(0.55, "#4a1172"); g.addColorStop(1, "#0a0418"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const sg = x.createLinearGradient(0, 120, 0, 300); sg.addColorStop(0, "#f9f002"); sg.addColorStop(1, "#ff2a6d"); x.fillStyle = sg; x.beginPath(); x.arc(w / 2, 250, 110, Math.PI, 0); x.fill();
    x.fillStyle = "#14062e"; for (let i = 0; i < 5; i++) x.fillRect(60, 200 + i * 12, 220, 3 + i);
    x.strokeStyle = "#05d9e8"; x.lineWidth = 2; for (let i = 0; i < 8; i++) { const y = 260 + i * i * 4; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
    for (let i = -6; i <= 6; i++) { x.beginPath(); x.moveTo(w / 2 + i * 12, 260); x.lineTo(w / 2 + i * 70, h); x.stroke(); }
    x.textAlign = "center"; x.font = "700 52px Rajdhani"; x.fillStyle = "#f4f3ff"; x.shadowColor = "#ff2a6d"; x.shadowBlur = 14; x.fillText("DC AFTER DARK", w / 2, 70);
  }, 5.9, -5.05, -Math.PI / 2); // above the chess table
  poster((x, w, h) => { // a retro coin
    x.fillStyle = "#120a2a"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#f7931a"; x.shadowColor = "#f7931a"; x.shadowBlur = 30; x.beginPath(); x.arc(w / 2, 200, 110, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = "700 160px Rajdhani"; x.fillStyle = "#fff"; x.fillText("₿", w / 2, 205);
    x.font = "700 86px Rajdhani"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 16; x.fillText("HODL", w / 2, 390);
    x.font = "500 22px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.shadowBlur = 0; x.fillText("21,000,000 · NO MORE", w / 2, 450);
  }, -5.9, -0.95, Math.PI / 2);
  // aquarium on a low cabinet (left wall, below the neon)
  block(1.3, 0.62, 0.5, 0x241a4a, -5.6, 0.31, -6.0, { rot: [0, Math.PI / 2, 0], r: 0.03 });
  const tankOld = block(1.2, 0.6, 0.42, 0x05d9e8, -5.6, 0.93, -6.0, { rot: [0, Math.PI / 2, 0], mat: new THREE.MeshBasicMaterial({ color: 0x0aa6c9, transparent: true, opacity: 0.35, toneMapped: false }), r: 0.02 });
  const tankG = new THREE.Group(); tankG.position.set(-5.6, 0.93, -6.0); scene.add(tankG); /* tank space: x across (0.42), y up (0.6), z along the wall (1.2) */
  if (!lite) { tankOld.visible = false;
    const TW = 0.42, TH = 0.6, TL = 1.2;
    const water = new THREE.Mesh(new THREE.BoxGeometry(TW - 0.012, TH - 0.07, TL - 0.012), new THREE.MeshStandardMaterial({ color: 0x1a8fa8, roughness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, emissive: 0x0a5a6e, emissiveIntensity: 0.35 })); water.position.y = -0.03; tankG.add(water);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(TW, TH, TL), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false })); tankG.add(glass);
    const trim = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5 });
    for (const [sx, sy, sz, w, h, d] of [[1, 1, 0, 0.012, 0.012, TL], [-1, 1, 0, 0.012, 0.012, TL], [1, -1, 0, 0.012, 0.012, TL], [-1, -1, 0, 0.012, 0.012, TL], [1, 0, 1, 0.012, TH, 0.012], [-1, 0, 1, 0.012, TH, 0.012], [1, 0, -1, 0.012, TH, 0.012], [-1, 0, -1, 0.012, TH, 0.012], [0, 1, 1, TW, 0.012, 0.012], [0, 1, -1, TW, 0.012, 0.012], [0, -1, 1, TW, 0.012, 0.012], [0, -1, -1, TW, 0.012, 0.012]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trim); e.position.set(sx * TW / 2, sy * TH / 2, sz * TL / 2); tankG.add(e); } /* black silicone along every edge */
    const lid = block(TW + 0.02, 0.03, TL + 0.02, 0, 0, TH / 2 + 0.015, 0, { parent: tankG, r: 0.006, mat: new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.4 }) });
    const strip = tube(TW - 0.08, 0.004, TL - 0.08, 0xbfefff, 0, TH / 2 - 0.004, 0, { parent: tankG, k: 1.1 }); /* the LED strip under the lid */
    const gp = new THREE.PlaneGeometry(TW - 0.014, TL - 0.014, 24, 64), pp = gp.attributes.position; let sd = 5; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < pp.count; i++) pp.setZ(i, 0.012 * rnd() + 0.03 * (0.5 + 0.5 * Math.sin(pp.getY(i) * 4))); gp.computeVertexNormals();
    const gt = canvasTex(256, 256, (x, w) => { x.fillStyle = "#3a3630"; x.fillRect(0, 0, w, w); for (let i = 0; i < 2600; i++) { const v = 60 + rnd() * 150; x.fillStyle = `rgb(${v},${v * 0.95},${v * 0.85})`; x.beginPath(); x.arc(rnd() * w, rnd() * w, 1 + rnd() * 2.5, 0, 6.3); x.fill(); } }); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(1, 3);
    const bed = new THREE.Mesh(gp, new THREE.MeshStandardMaterial({ map: gt, bumpMap: gt, bumpScale: 3, roughness: 0.9 })); bed.rotation.x = -Math.PI / 2; bed.position.y = -TH / 2 + 0.004; tankG.add(bed); /* gravel, banked toward the back */
    const weeds = []; for (const [pz, n, len] of [[-0.42, 9, 0.34], [-0.15, 6, 0.22], [0.3, 11, 0.42], [0.48, 7, 0.26]]) { const wg = new THREE.Group(); wg.position.set(0.08 - (pz % 0.1), -TH / 2 + 0.03, pz); tankG.add(wg); leafy(wg, 0, 0, 0, { n, len, wid: 0.03, bend: 0.25, tilt: 0.25, seed: pz * 40 + 7, colors: [0x2f8f4e, 0x3faa58, 0x1f7040] }); weeds.push(wg); } /* water plants */
    const bubbles = [...Array(14).keys()].map((i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.004 + (i % 3) * 0.002, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false })); b.raycast = () => {}; tankG.add(b); return { b, ph: i / 14 }; });
    animators.push((now) => { weeds.forEach((w, i) => { w.rotation.x = Math.sin(now / 1700 + i) * 0.08; w.rotation.z = Math.sin(now / 2300 + i * 2) * 0.06; });
      for (const { b, ph } of bubbles) { const t = (now / 3200 + ph) % 1; b.position.set(-0.1 + Math.sin(t * 9 + ph * 20) * 0.01, -TH / 2 + 0.05 + t * (TH - 0.12), -0.5 + (ph % 0.25) * 0.4); } }); }
  const tankLight = new THREE.PointLight(0x05d9e8, lite ? 2.5 : 1.4, 2.5); if (lite) tankLight.position.set(-5.3, 1.1, -6.0); else tankLight.position.set(-5.6, 1.17, -6.0); scene.add(tankLight); /* desktop: up under the lid, inside the tank, so it lights the water rather than glaring off the glass */
  const fishC = lite ? [0xff7a1a, 0xf9f002, 0xff2a6d] : [0xff7a1a, 0x2a7bd8, 0xf2c94c, 0xe84a5f, 0x2a7bd8];
  const fish = fishC.map((c, i) => {
    const f = new THREE.Group(); scene.add(f);
    if (lite) { const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), glowMat(c, 1.1)); body.scale.set(1.5, 1, 0.6); f.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 6), glowMat(c, 1.1)); tail.rotation.z = Math.PI / 2; tail.position.x = -0.09; f.add(tail); return { f, i }; }
    /* desktop: a small fish shape. A body tapering to the tail, a forked tail fin that wags, a dorsal fin, an eye; scales catch the light */
    const s = 0.55 + (i % 3) * 0.18; f.scale.setScalar(s);
    const bm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.25, emissive: new THREE.Color(c).multiplyScalar(0.15) });
    const body = new THREE.Mesh(sculpt(0.05, (u) => { const t = (u.x + 1) / 2; u.y *= 0.75 * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.9 + 0.2)); u.z *= 0.45 * (0.4 + 0.6 * Math.sin(t * Math.PI)); u.x *= 1.7; }, 32, 20), bm); f.add(body);
    const finM = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const tailS = new THREE.Shape(); tailS.moveTo(0, 0); tailS.lineTo(-0.06, 0.035); tailS.lineTo(-0.045, 0); tailS.lineTo(-0.06, -0.035); tailS.closePath();
    const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailS), finM); tail.position.x = -0.08; f.add(tail);
    const dorS = new THREE.Shape(); dorS.moveTo(0.02, 0); dorS.lineTo(-0.025, 0.03); dorS.lineTo(-0.035, 0); dorS.closePath();
    const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorS), finM); dorsal.position.y = 0.032; f.add(dorsal);
    for (const dz of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 })); eye.position.set(0.058, 0.008, dz * 0.017); f.add(eye); }
    f.userData.tail = tail; return { f, i };
  });
  animators.push((now) => fish.forEach(({ f, i }) => {
    const t = now / (2600 + i * 700) + i * 2, z = -6.0 + Math.sin(t) * 0.45;
    f.position.set(-5.6 + Math.sin(t * 1.7) * 0.08, 0.8 + (i % 3) * 0.12 + Math.sin(t * 3) * 0.03, z); /* kept below the waterline */
    f.rotation.y = Math.cos(t) > 0 ? -Math.PI / 2 : Math.PI / 2; // turn round at each end
    if (f.userData.tail) f.userData.tail.rotation.y = Math.sin(now / 140 + i * 2) * 0.45; /* the tail wags as it swims */
  }));
  // rain on the window, sliding down slowly (fades out while the clock app is on the glass)
  const rainTex = canvasTex(256, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.strokeStyle = "rgba(180,220,255,.4)"; x.lineWidth = 1;
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) { const px = rnd() * w, py = rnd() * h, len = 12 + rnd() * 30; x.beginPath(); x.moveTo(px, py); x.lineTo(px - 2, py + len); x.stroke(); }
    for (let i = 0; i < 40; i++) { x.fillStyle = "rgba(200,230,255,.4)"; x.beginPath(); x.arc(rnd() * w, rnd() * h, 1.5 + rnd() * 2, 0, Math.PI * 2); x.fill(); }
  });
  rainTex.wrapS = rainTex.wrapT = THREE.RepeatWrapping; rainTex.repeat.set(5, 1.2);
  rainMesh = panel(5.2, 2.0, rainTex, 0, 1.9, -7.0, { transparent: true, k: 1 }); rainMesh.material.opacity = 0.18; rainMesh.raycast = () => {}; // never blocks clicks on the glass
  animators.push((now, dt) => { rainTex.offset.y += dt * 0.00012; }); // slow drips: the one thing that moves out there

  // ---- theater
  for (const xx of [-7.75, -1.25]) {
    const box = block(0.6, 1.1, 0.45, 0x16102e, xx, 0.8, -15.95, { r: 0.05 });
    for (const [yy, rr] of [[1.05, 0.15], [0.62, 0.1]]) { const cone = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.03, 8, 24), toon(0x3a2a75)); cone.position.set(xx, yy, -15.72); scene.add(cone);
      if (!lite) { /* desktop: a real driver. A paper cone spun on a lathe, a rubber surround, a dust cap, a metal trim ring */
        cone.visible = false; const d = new THREE.Group(); d.position.set(xx, yy, -15.725); scene.add(d);
        const prof = [[0.2, -0.05], [0.35, -0.045], [0.55, -0.032], [0.75, -0.018], [0.88, -0.008]].map(([r0, z0]) => new THREE.Vector2(rr * r0, z0 * rr * 4));
        const cg = new THREE.LatheGeometry(prof, 48); cg.rotateX(Math.PI / 2); cg.computeVertexNormals();
        d.add(new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.85, side: THREE.DoubleSide }))); /* the cone */
        const sur = new THREE.Mesh(new THREE.TorusGeometry(rr * 0.93, rr * 0.07, 12, 64), new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.6 })); d.add(sur); /* the rubber surround */
        const cap = new THREE.Mesh(new THREE.SphereGeometry(rr * 0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.3, metalness: 0.4 })); cap.rotation.x = Math.PI / 2; cap.position.z = -rr * 0.12; d.add(cap); /* the dust cap */
        const trim = new THREE.Mesh(new THREE.TorusGeometry(rr * 1.04, rr * 0.035, 8, 64), new THREE.MeshStandardMaterial({ color: 0x8a8f9c, metalness: 0.9, roughness: 0.3 })); trim.position.z = 0.004; d.add(trim); } }
    if (!lite) box.material = new THREE.MeshStandardMaterial({ color: 0x0a0a0d, roughness: 0.14, metalness: 0.1, roughnessMap: wearTex() }); /* piano black */
  }
  tube(7.6, 0.03, 0.03, 0xff2a6d, -4.5, 0.26, -15.59, { k: 1.6 });
  for (const zz of [-9.6, -14.9]) tube(0.04, 0.6, 0.04, 0x05d9e8, -0.12, 1.9, zz, { k: 1.4 });
  for (const zz of [-9.0, -11.4]) tube(0.04, 0.6, 0.04, 0x05d9e8, -8.88, 1.9, zz, { k: 1.4 }); // clear of the shelf and the IMAX stand
  sign("EXIT", 0.2, -4.5, 2.78, -7.12, { color: "#2bff88", rotY: Math.PI, k: 1.5 });
};

// ---------- the cats: Finn and Phoebe, napping, with their tree, bed and toys ----------
// Drawn from my photos: Finn is a big fluffy brown tabby with a white chin; Phoebe is a lean orange
// tabby, about half his size, with a white chin. Local space: the cat faces +x, curled on the spot.
// A cat curled up asleep, cartoon-style, built from their photos. Group space: +x is where the head points.
// Finn: a big long-haired brown tabby (dark saddle, pale ruff and bib, lynx-tipped ears, a huge banded plume of a tail).
// Phoebe: a slim short-haired ginger (thin mackerel stripes, oversized pink-lined ears, cream chest, a long ringed tail).
// `sit: true` builds them sitting up instead (awake, watching the city from the couch with you).
// ---- desktop: real fur on the cats ----
// Fur is drawn with shells: each furry part is drawn again in up to 32 thin layers pushed out along its
// surface, and each layer keeps only the hairs tall enough to reach it (a noise texture of hair heights,
// sampled in 3D so there's no seam or pinch), so you get soft strands with dark roots and bright tips.
// The fur is combed: the layers slide along the body (down and back) instead of straight out, so it lies
// the way a coat does, and it's longer on the belly and ruff. Tips catch a rim of light at the edges.
// The coat pattern (tabby stripes, Finn's dark saddle, white chins and bellies) is painted in the shader
// from the part's own shape, so it carries on into the fur. One draw per layer stack (an InstancedMesh,
// one instance per layer). Phones keep the original cats.
let hairTex;
const hairNoise = () => hairTex ||= (() => {
  const s = 128, d = new Uint8Array(s * s * 4);
  for (let i = 0; i < s * s; i++) { d[i * 4] = Math.pow(Math.random(), 0.7) * 255; d[i * 4 + 1] = Math.random() * 255; d[i * 4 + 2] = Math.random() * 255; d[i * 4 + 3] = 255; } // r: hair height, g/b: per-hair shade
  const t = new THREE.DataTexture(d, s, s); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
})();
const lin = (c) => new THREE.Color(c ?? 0); // THREE.Color converts the sRGB hex to linear for the shader
// their real coats, cut from the photos (images/cats): a strip of each cat's flank, belly / back / belly, tail to head
const coatTexs = {};
const coatTex = (name) => coatTexs[name] ||= (() => { const t = loader.load(`images/cats/${name}-coat.jpg?v=1`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; })();
// coat: { mode: 0 stripes by position | 1 rings along the uv | 2 plain | 3 the photo wrapped round the body, fur, stripe, chin, saddle, axis, back, belly, freq, stripeK, saddleK, chinK, r }
const furMat = (base, coat, { len = 0, shells = 0, comb = V(0, -0.6, 0), lenBelly = 0, hair = 6, tick = 0.05 } = {}, shell = false) => {
  /* the shell layers are Lambert: no specular and, crucially, no area lights (those ran once per layer, 20-30 times over per pixel); the undercoat under them is full PBR */
  const m = shell ? new THREE.MeshLambertMaterial({ color: base }) : new THREE.MeshStandardMaterial({ color: base, roughness: 0.9, metalness: 0 });
  m.defines = { USE_UV: "" }; if (shell) m.defines.FUR_SHELL = "";
  const u = {
    uFur: { value: lin(coat.fur) }, uStripe: { value: lin(coat.stripe) }, uChin: { value: lin(coat.chin) }, uSaddle: { value: lin(coat.saddle ?? coat.fur) },
    uAxis: { value: (coat.axis || V(1, 0, 0)).clone().normalize() }, uBack: { value: (coat.back || V(0, 1, 0)).clone().normalize() }, uBelly: { value: (coat.belly || V(0, -1, 0)).clone().normalize() },
    uFreq: { value: coat.freq ?? 10 }, uStripeK: { value: coat.stripeK ?? 0 }, uSaddleK: { value: coat.saddleK ?? 0 }, uChinK: { value: coat.chinK ?? 0 },
    uCoat: { value: coat.coat || null }, uSide: { value: new THREE.Vector3().crossVectors((coat.back || V(0, 1, 0)), (coat.axis || V(1, 0, 0))).normalize() },
    uMode: { value: coat.mode ?? 2 }, uR: { value: coat.r ?? 0.2 }, uChinLo: { value: coat.chinLo ?? 0.15 }, uChinHi: { value: coat.chinHi ?? 0.7 }, uLen: { value: len }, uShells: { value: Math.max(1, shells) }, uComb: { value: comb.clone() }, uLenBelly: { value: lenBelly },
    uHair: { value: hair }, uTick: { value: tick }, uNoise: { value: hairNoise() },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = "uniform float uLen, uShells, uLenBelly, uR; uniform vec3 uComb, uBelly; varying float vLayer; varying vec3 vObj, vNObj;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vObj = position; vNObj = normal; vLayer = 0.0;
      #ifdef FUR_SHELL
        vLayer = (float(gl_InstanceID) + 1.0) / uShells;
        float L = uLen * (1.0 + uLenBelly * smoothstep(0.0, 0.8, dot(normalize(position / uR), uBelly))); // longer underneath
        vec3 dir = normalize(normal + uComb); // combed: along the body, not straight out
        transformed += dir * L * vLayer;
        transformed.y -= L * 0.35 * vLayer * vLayer; // the tips droop
      #endif`);
    sh.fragmentShader = `uniform vec3 uFur, uStripe, uChin, uSaddle, uAxis, uBack, uBelly; uniform float uFreq, uStripeK, uSaddleK, uChinK, uMode, uR, uHair, uTick, uChinLo, uChinHi; uniform vec3 uSide;
      uniform sampler2D uNoise, uCoat; varying float vLayer; varying vec3 vObj, vNObj;\n` + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec3 an = abs(vNObj); vec2 hc = an.x > an.y && an.x > an.z ? vObj.yz : an.y > an.z ? vObj.xz : vObj.xy; // hairs placed in 3D: no seams, no pinching at the poles
      vec3 hn = texture(uNoise, hc * uHair).rgb; float hair = hn.r;
      vec3 p = vObj / uR;
      if (uMode > 2.5) { // the photo of their coat, wrapped round the body: along the spine, and round from back to belly
        vec2 cu = vec2(dot(p, uAxis) * 0.5 + 0.5, atan(dot(p, uSide), dot(p, uBack)) / 6.2831853 + 0.5);
        diffuseColor.rgb = mix(texture(uCoat, cu).rgb, uChin, uChinK * smoothstep(uChinLo, uChinHi, dot(p, uBelly) + (hn.g - 0.5) * 0.25));
      }
      if (uMode < 1.5) {
        float along = uMode < 0.5 ? dot(p, uAxis) : vUv.x;
        float wob = uMode < 0.5 ? sin(p.x * 7.0 + p.z * 5.0) * 0.35 + sin(p.y * 11.0 - p.z * 6.0) * 0.2 : 0.0;
        float st = smoothstep(0.25, 0.8, sin(along * uFreq + wob) * 0.5 + 0.5 + (hn.g - 0.5) * 0.45); // stripes with ragged, hair-by-hair edges
        float back = uMode < 0.5 ? smoothstep(-0.2, 0.45, dot(p, uBack)) : 1.0;
        vec3 c = uFur;
        c = mix(c, uSaddle, uSaddleK * smoothstep(0.2, 0.8, dot(p, uBack) + (hn.g - 0.5) * 0.3));
        c = mix(c, uStripe, st * uStripeK * back);
        c = mix(c, uChin, uChinK * smoothstep(uChinLo, uChinHi, dot(p, uBelly) + (hn.g - 0.5) * 0.25));
        diffuseColor.rgb = c;
      }
      diffuseColor.rgb *= 0.84 + 0.32 * hn.g; // each hair a slightly different shade
      #ifdef FUR_SHELL
        if (hair < vLayer * 0.92 + 0.06) discard; // only the longer hairs reach the outer layers
        diffuseColor.rgb *= mix(0.45, 1.1, vLayer); // dark at the roots, bright at the tips
        diffuseColor.rgb *= 1.0 + uTick * sin(vLayer * 9.0 + hn.b * 6.0); // agouti banding along each hair
      #else
        diffuseColor.rgb *= 0.5; // the undercoat, in shadow
      #endif`).replace("#include <opaque_fragment>", `
      #ifdef FUR_SHELL
        float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0); // light through the tips at the edges
        outgoingLight += (diffuseColor.rgb * 1.2 + 0.05) * rimF * (0.2 + 0.8 * vLayer) * 0.7;
      #endif
      #include <opaque_fragment>`);
  };
  return m;
};
// give a mesh fur: its own surface becomes the undercoat, and a stack of shells goes on top
const furry = (mesh, coat, o) => {
  mesh.material = furMat(mesh.material.color?.getHex?.() ?? 0xffffff, coat, o);
  if (!o.shells) return mesh;
  const sh = new THREE.InstancedMesh(mesh.geometry, furMat(mesh.material.color.getHex(), coat, o, true), o.shells);
  const id = new THREE.Matrix4(); for (let i = 0; i < o.shells; i++) sh.setMatrixAt(i, id);
  sh.raycast = () => {}; sh.castShadow = false; sh.receiveShadow = false; sh.userData.noAO = true;
  sh.computeBoundingSphere(); sh.boundingSphere.radius += 0.08; /* culled off-screen like everything else, its bounds grown to take in the fur */
  mesh.add(sh); return mesh;
};
// push a sphere's vertices about to make a shape (fn gets the point in units of the radius)
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sculpt = (r, fn, w = 48, h = 32) => {
  const geo = new THREE.SphereGeometry(r, w, h), p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).divideScalar(r); fn(v); p.setXYZ(i, v.x * r, v.y * r, v.z * r); }
  geo.computeVertexNormals(); return geo;
};
// a smooth tapered tail through the old bead positions
const tailTube = (pts, radii) => {
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal"), segs = 64, rad = 12;
  const geo = new THREE.TubeGeometry(curve, segs, 1, rad, false), p = geo.attributes.position, c = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, f = t * (radii.length - 1), k = Math.floor(f), r = THREE.MathUtils.lerp(radii[k], radii[Math.min(k + 1, radii.length - 1)], f - k) * (t > 0.92 ? 1 - (t - 0.92) / 0.1 : 1);
    curve.getPointAt(t, c);
    for (let j = 0; j <= rad; j++) { const vi = i * (rad + 1) + j; q.fromBufferAttribute(p, vi).sub(c).multiplyScalar(Math.max(0.003, r)).add(c); p.setXYZ(vi, q.x, q.y, q.z); }
  }
  geo.computeVertexNormals(); return geo;
};
// a cat's ear: a thin cupped leaf, pointed, leaning back a little (local: base at the origin, tip up +y, open side +x)
const earGeo = (w, h, cup) => {
  const g = new THREE.PlaneGeometry(1, 1, 8, 14), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), t = p.getY(i) + 0.5; // t: 0 at the base, 1 at the tip
    const half = w * (Math.pow(1 - t, 0.85) * 0.95 + 0.05) * (0.8 + 0.2 * ss(0, 0.2, t));
    p.setXYZ(i, cup * (px * 2) ** 2 * (1 - t * 0.5) - t * h * 0.18, t * h, px * 2 * half);
  }
  g.computeVertexNormals(); return g;
};
// Upgrade one cat (desktop): a sculpted body and head, combed fur with the coat pattern, a smooth tail,
// leaf-shaped ears, real eyes with lids and liner, a nose with nostrils and a mouth, whiskers, toes.
// The cartoon bits (painted-on stripe bands, cone tufts, bead tail, floating z's) go.
const furUp = (g, c) => {
  const { fur, stripe, chin, saddle, ruff, inner, nose, fluffy, lean, sit, body, skull, head, hr, R, tailPts, eyes, ears, zs } = c;
  const long = fluffy ? 1 : 0.32, N = fluffy ? 20 : 12;
  zs.forEach((z) => (z.visible = false));
  // drop the cartoon decorations: stripe bands, painted head stripes, saddle and crown caps, cone tufts
  g.traverse((o) => {
    if (!o.isMesh || o.material?.isMeshBasicMaterial) return;
    const gp = o.geometry.parameters || {}, isCap = o.geometry.type === "SphereGeometry" && gp.thetaLength < Math.PI * 0.5;
    if (o.geometry.type === "TorusGeometry" || (o.geometry.type === "BoxGeometry" && o.parent === head) || isCap || (o.geometry.type === "ConeGeometry" && o.parent === g)) o.visible = false;
  });
  // The body, with a cat's proportions. Sitting: broad round haunches sitting flat, a torso that narrows up to
  // the shoulders and leans forward over the front legs, a straight back, the chest out, a neck up to the head.
  // Asleep: a curled bean, flat on the bed, the back a high outer arc rising to the rump, the belly side tucked in.
  body.geometry = sculpt(R, sit ? (u) => {
    const t = ss(-0.1, 1, u.y), nar = lean ? 0.2 : 0.3;
    u.x *= 1 - nar * t; u.z *= 1 - nar * t;
    u.z *= 1 + 0.28 * Math.exp(-(((u.y + 0.5) / 0.45) ** 2));
    if (u.y < -0.6) u.y = -0.6 + (u.y + 0.6) * 0.35;
    u.x += 0.22 * ss(0.1, 1, u.y);
    if (u.x > 0) u.x *= 1 + 0.12 * Math.exp(-(((u.y - 0.05) / 0.4) ** 2));
    if (u.x < 0) u.x *= 1 - 0.12 * ss(-0.3, 1, u.y);
  } : (u) => {
    if (u.y < 0) u.y *= 0.5;
    if (u.y > 0) u.y *= 1 + 0.18 * ss(-0.3, 1, u.z) + 0.2 * ss(-0.1, -0.9, u.x);
    u.y -= 0.12 * Math.exp(-(((u.x - 0.55) / 0.25) ** 2)) * Math.max(0, u.y);
    if (u.z < 0) u.z *= 1 - 0.3 * Math.exp(-((u.x / 0.5) ** 2));
    if (u.z > 0) u.z *= 1 + 0.1 * Math.exp(-(((u.x + 0.5) / 0.4) ** 2));
    u.z *= 1 - 0.1 * Math.max(0, u.y) * ss(0.3, 1, u.x);
  });
  // proportions: the head a touch smaller on Finn (it's the ruff that's big, not the skull), held up on a neck when
  // sitting; the big white bib ball goes (the coat paints the white front now), the sleeping bib tucks in; thicker legs on Finn
  if (fluffy) head.scale.setScalar(0.93);
  const chest = g.children.find((o) => o.isMesh && o.geometry.type === "SphereGeometry" && Math.abs(o.geometry.parameters.radius - R * (sit ? 0.5 : 0.55)) < 1e-6);
  if (chest) { if (sit) chest.visible = false; else { chest.scale.setScalar(0.75); chest.position.x -= 0.04; } }
  if (sit) {
    const piv = new THREE.Group(); piv.position.y = lean ? 0.025 : 0.04; g.add(piv); piv.add(head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(hr * 0.62, hr * 0.78, 0.11, 16), new THREE.MeshStandardMaterial({ color: fur })); neck.position.set(R * body.scale.x * 0.3, 0.37, 0); neck.rotation.z = -0.25; g.add(neck);
    furry(neck, { mode: 3, coat: coatTex(fluffy ? "finn" : "phoebe"), fur, stripe, chin: fluffy ? ruff : chin, saddle, r: hr, freq: 20, stripeK: 0.5, saddleK: saddle ? 0.7 : 0, chinK: 0.9, axis: V(0, 1, 0), back: V(-1, 0.3, 0), belly: V(1, -0.1, 0), chinLo: 0.5, chinHi: 0.9 }, { len: 0.028 * long + 0.003, shells: N, comb: V(-0.3, -0.9, 0), lenBelly: fluffy ? 0.9 : 0.2 });
    for (const o of g.children) if (o.isMesh && o.geometry.type === "CylinderGeometry" && o !== neck && fluffy) { o.scale.x = o.scale.z = 1.25; }
  }
  const coatBody = { mode: 3, coat: coatTex(fluffy ? "finn" : "phoebe"), fur, stripe, chin: fluffy ? ruff : chin, saddle, r: R, freq: lean ? 26 : 16, stripeK: lean ? 0.85 : 0.6, saddleK: saddle ? 0.85 : 0, chinK: 0.9,
    axis: sit ? V(0, 1, 0) : V(1, 0, 0), back: sit ? V(-1, 0.35, 0) : V(0, 1, 0.1), belly: sit ? V(1, -0.3, 0) : V(0.4, -1, 0), chinLo: sit ? 0.55 : 0.15, chinHi: sit ? 0.9 : 0.7 }; // sitting, only the chest is white
  furry(body, coatBody, { len: fluffy ? 0.033 : 0.03 * long, shells: N, comb: sit ? V(-0.25, -0.9, 0) : V(-0.7, -0.6, 0), lenBelly: fluffy ? 0.7 : 0.3, tick: 0.12 });
  // the head: a wedge of a muzzle, a flatter crown, cheeks (big ones on Finn), a brow
  skull.geometry = sculpt(hr, (u) => {
    u.x += 0.25 * Math.exp(-(((u.y + 0.3) / 0.35) ** 2)) * Math.exp(-((u.z / 0.5) ** 2)) * Math.max(0, u.x);
    if (u.y > 0.3) u.y *= 1 - 0.08 * ss(0.3, 1, u.y);
    u.z *= 1 + (fluffy ? 0.14 : 0.06) * Math.exp(-(((u.y + 0.15) / 0.4) ** 2)) * ss(0.4, -0.6, u.x);
    u.y += 0.06 * Math.exp(-(((u.x - 0.75) / 0.3) ** 2)) * Math.exp(-(((u.y - 0.3) / 0.3) ** 2));
  }, 40, 28);
  const headFur = 0.016 * long + 0.004;
  furry(skull, { mode: 3, coat: coatTex(fluffy ? "finn" : "phoebe"), fur, stripe, chin, saddle, r: hr, freq: lean ? 34 : 26, stripeK: 0.55, saddleK: saddle ? 0.6 : 0, chinK: 0.9, axis: V(0, 0, 1), back: V(-0.2, 1, 0), belly: V(0.4, -1, 0), chinLo: 0.3, chinHi: 0.75 },
    { len: headFur, shells: N, comb: V(-0.6, -0.5, 0), lenBelly: fluffy ? 1.0 : 0.2, tick: 0.1 }); // Finn's ruff fans out under the chin
  // the eyes and nose sit out at the surface of the fur, not under it
  // (and turned to face properly outward: the original lookAt was given head-space points, so they faced inward)
  g.updateMatrixWorld(true); const hc = skull.getWorldPosition(V(0, 0, 0)), wp = V(0, 0, 0);
  for (const e of eyes) { const eg = e.closed.parent; eg.position.multiplyScalar(1 + (headFur * 0.8) / hr); eg.updateMatrixWorld(true); eg.getWorldPosition(wp); eg.lookAt(wp.clone().add(wp.clone().sub(hc).normalize())); }
  // the other round parts (chest, bib, haunches, paws, whisker pads, chin): plain fur in their own colours
  const small = [];
  g.traverse((o) => { if (o.isMesh && o.visible && o !== body && o !== skull && !tailPts.includes(o) && o.geometry.type === "SphereGeometry" && !o.isInstancedMesh && !o.material.isMeshBasicMaterial && o.geometry.parameters.radius > 0.015 && !eyes.some((e) => e.lidTop === o || e.open.children.includes(o))) small.push(o); });
  const paws = small.filter((o) => o.scale.y < 0.8 && o.geometry.parameters.radius <= 0.041);
  for (const o of small) if (o.parent === head) { o.position.x -= hr * 0.1; o.scale.multiplyScalar(0.88); } // the muzzle pads and chin sit back into the new muzzle
  if (fluffy) for (const pad of small) if (pad.parent === head && Math.abs(pad.position.z) > 0.001) { // Finn's freckled whisker pads
    const pr = pad.geometry.parameters.radius * pad.scale.x, dz = Math.sign(pad.position.z);
    for (let k = 0; k < 5; k++) { const dot = new THREE.Mesh(new THREE.SphereGeometry(pr * 0.09, 6, 5), new THREE.MeshStandardMaterial({ color: 0x1c1512 })); dot.position.copy(pad.position).add(V(pr * 0.92, pr * (0.35 - (k % 3) * 0.3), dz * pr * (0.1 + Math.floor(k / 3) * 0.35 + (k % 2) * 0.12))); head.add(dot); } }
  for (const o of small) furry(o, o.parent === g && !paws.includes(o) ? { mode: 3, coat: coatTex(fluffy ? "finn" : "phoebe"), r: o.geometry.parameters.radius, axis: coatBody.axis, back: V(0, 1, 0) } : { mode: 2, r: o.geometry.parameters.radius }, { len: (fluffy && o.parent === g && !paws.includes(o) ? 0.016 : 0.007) * long + 0.003, shells: Math.round(N * 0.6), comb: V(0, -0.8, 0) });
  for (const o of g.children) if (o.isMesh && o.geometry.type === "CylinderGeometry") furry(o, { mode: 2, r: 0.03 }, { len: 0.012 * long + 0.003, shells: Math.round(N * 0.6), comb: V(0, -0.9, 0) }); // front legs
  // toes on the paws
  for (const pw of paws) { const r = pw.geometry.parameters.radius; for (const k of [-1, 0, 1]) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 12, 10), new THREE.MeshStandardMaterial({ color: pw.material.color })); toe.scale.set(1, 0.75, 1);
    toe.position.copy(pw.position).add(V(r * pw.scale.x * 0.85, -r * 0.1, k * r * 0.55)); pw.parent.add(toe); furry(toe, { mode: 2, r: r * 0.4 }, { len: 0.004 + 0.004 * long, shells: 8, comb: V(0.4, -0.6, 0) }); } }
  // the tail: one smooth tapered tube with rings, and a long plume on Finn
  if (tailPts.length) {
    const pts = tailPts.map((s) => { const q = s.position.clone(); if (!sit && q.z < 0) q.z += 0.28 * R * body.scale.z * Math.exp(-((q.x / (0.5 * R * body.scale.x)) ** 2)); return q; }), radii = tailPts.map((s) => s.geometry.parameters.radius * s.scale.x * (fluffy ? 0.7 : 1));
    tailPts.forEach((s) => (s.visible = false));
    const tail = new THREE.Mesh(tailTube(pts, radii), new THREE.MeshStandardMaterial({ color: fur })); tail.castShadow = true; g.add(tail);
    furry(tail, { mode: 1, fur: fluffy ? saddle : fur, stripe: fluffy ? 0x5a534c : stripe, chin: fur, freq: (fluffy ? 7 : 11) * Math.PI * 2, stripeK: fluffy ? 0.3 : 0.85, r: 0.05 }, { len: fluffy ? 0.045 : 0.006, shells: N, comb: V(0, -0.7, 0), tick: 0.12 });
  }
  // eyes: a deep iris with a glossy cornea over it and a dark rim of liner; the sleeping eye a thin dark line
  for (const e of eyes) {
    const [rim, iris, pupil, glint] = e.open.children, re = iris.geometry.parameters.radius;
    iris.material = new THREE.MeshStandardMaterial({ color: iris.material.color, roughness: 0.35, emissive: iris.material.color.clone().multiplyScalar(0.3) }); // cats' eyes catch the light
    pupil.material = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.2 });
    glint.scale.setScalar(0.45); rim.scale.z = 0.2; rim.position.z = -0.003; pupil.scale.set(0.62, 0.74, 0.34); // at night the pupils are big and round // the dark rim sits behind the iris, only showing round its edge
    const cornea = new THREE.Mesh(new THREE.SphereGeometry(re, 20, 14), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.06, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    cornea.scale.set(1.2, 0.98, 0.42); cornea.position.z = 0.006; e.open.add(cornea);
    const liner = new THREE.Mesh(new THREE.TorusGeometry(re * 1.08, re * 0.09, 6, 24), new THREE.MeshStandardMaterial({ color: 0x1a0f14, roughness: 0.6 })); liner.scale.set(1.25, 1.0, 0.5); liner.position.z = 0.003; e.open.add(liner);
    const pale = new THREE.Mesh(new THREE.TorusGeometry(re * 1.16, re * 0.06, 6, 24), new THREE.MeshStandardMaterial({ color: chin, roughness: 0.9 })); pale.scale.set(1.25, 1.0, 0.25); pale.position.z = 0.0; e.open.add(pale); // the pale ring of fur round a tabby's eye
    e.closed.geometry = new THREE.TorusGeometry(re * 1.05, re * 0.1, 6, 18, Math.PI);
    e.open.scale.x = e.open.scale.z = lean ? 0.8 : 0.9; e.closed.scale.x = lean ? 0.8 : 0.9; // smaller, almond-shaped eyes (the y scale is the lids opening)
    e.lidTop.material = furMat(fur, { mode: 2, r: re }, {});
  }
  // ears: leaf-shaped, cupped forward, pink inside, short fur on the back (and lynx tips on Finn)
  const er = lean ? 0.052 : 0.04, eh = lean ? 0.12 : 0.08;
  for (const eg of ears) {
    eg.children.forEach((o) => (o.visible = false));
    const geo = earGeo(er * (lean ? 0.62 : 0.75), eh * 1.05, er * 0.45);
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: saddle ?? fur, side: THREE.DoubleSide })); eg.add(back);
    furry(back, { mode: 2, r: er }, { len: fluffy ? 0.007 : 0.004, shells: 10, comb: V(-0.4, 0.5, 0) });
    const pink = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: inner, roughness: 0.7, side: THREE.DoubleSide })); pink.scale.set(0.9, 0.93, 0.86); pink.position.x = 0.0025; eg.add(pink);
    if (fluffy) { const tufts = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: chin })); tufts.scale.set(0.8, 0.85, 0.75); tufts.position.x = 0.004; eg.add(tufts);
      furry(tufts, { mode: 2, r: er }, { len: 0.016, shells: 10, comb: V(0.7, 0.3, 0) }); tufts.material.visible = false; } // pale furnishings inside his ears
    if (fluffy) { const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.035, 6), new THREE.MeshStandardMaterial({ color: saddle })); tip.position.set(-eh * 1.05 * 0.18, eh * 1.05 + 0.012, 0); tip.rotation.z = 0.15; eg.add(tip); }
  }
  // nose: a soft leather with nostrils, and a mouth line below it
  let cone; head.traverse((o) => { if (o.isMesh && o.geometry.type === "ConeGeometry" && o.parent === head) cone = o; });
  if (cone) {
    cone.visible = false;
    const nz = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.13, 14, 10), new THREE.MeshStandardMaterial({ color: nose, roughness: 0.25 })); nz.scale.set(0.9, 0.7, 1.15);
    nz.position.copy(cone.position).add(V(headFur * 0.9 + hr * 0.1, hr * 0.02, 0)); head.add(nz);
    for (const dz of [-1, 1]) { const n = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a0a10 })); n.position.set(hr * 0.11, -hr * 0.03, dz * hr * 0.06); nz.add(n); }
    const mm = new THREE.MeshStandardMaterial({ color: 0x24141a, roughness: 0.8 });
    for (const dz of [-1, 1]) { const m = new THREE.Mesh(new THREE.TorusGeometry(hr * 0.11, hr * 0.012, 4, 12, Math.PI), mm); m.position.set(nz.position.x - hr * 0.02, nz.position.y - hr * 0.14, dz * hr * 0.11); m.rotation.set(0, Math.PI / 2, Math.PI); head.add(m); }
  }
  // whiskers: three a side fanning from the pads, and a couple over each eye
  const wm = new THREE.MeshBasicMaterial({ color: 0xf4f0ff, transparent: true, opacity: 0.45, depthWrite: false });
  const whisker = (len, at, rot) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0003, 0.0007, len, 3), wm); w.geometry.translate(0, len / 2, 0); const piv = new THREE.Group(); piv.position.copy(at); piv.rotation.set(...rot); head.add(piv); piv.add(w); w.raycast = () => {}; };
  for (const dz of [-1, 1]) {
    for (let k = 0; k < 3; k++) whisker(hr * (1.05 + k * 0.1), V(hr * 0.85, -hr * (0.25 + k * 0.08), dz * hr * 0.3), [dz * (1.45 + k * 0.1), 0, -0.25 - k * 0.22]); // out to the sides, fanning slightly down
    for (let k = 0; k < 2; k++) whisker(hr * 0.7, V(hr * 0.55, hr * 0.5, dz * hr * 0.4), [dz * (0.9 + k * 0.3), 0, 0.5 - k * 0.25]); // eyebrows
  }
};
const cat = ({ fur, stripe, chin, saddle, ruff, inner, nose, eye = 0xd8a830, size = 1, fluffy = false, lean = false }, x, y, z, rotY = 0, { sit = false } = {}) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; g.scale.setScalar(size); g.userData.size = size; scene.add(g);
  const sx = sit ? (lean ? 0.62 : 0.78) : lean ? 1.5 : 1.35, sy = sit ? 0.9 : lean ? 0.52 : 0.7, sz = sit ? (lean ? 0.55 : 0.72) : lean ? 0.82 : 1.1, R = 0.2;
  const by = sit ? 0.18 : 0.1; // the body's centre height
  const mesh = (geo, color, parent = g) => { const m = new THREE.Mesh(geo, toon(color)); parent.add(m); return m; };
  const inked = (m, k = 1.06) => { const ink = new THREE.Mesh(m.geometry, inkMat); ink.scale.setScalar(k); m.add(ink); return m; };
  // round parts with a thin outline (the scene-wide cball() draws a 5 cm one, far too thick on a cat's small parts)
  const cball = (r, color, x, y, z, { parent = g } = {}) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), toon(color)); m.position.set(x, y, z); parent.add(m); return inked(m, 1 + 0.012 / r); };
  const body = cball(R, fur, 0, by, 0, { parent: g }); body.scale.set(sx, sy, sz);
  if (saddle) { // the darker coat down the back
    const cap = mesh(new THREE.SphereGeometry(R * 1.03, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.36), saddle, body); cap.rotation.z = sit ? 1.1 : 0.12;
  }
  if (sit) {
    mesh(new THREE.SphereGeometry(R * 0.5, 16, 12), chin).position.set(R * sx * 0.62, 0.21, 0); // chest / bib
    for (const dz of [-1, 1]) cball(lean ? 0.075 : 0.095, fluffy ? saddle : fur, -0.03, 0.08, dz * (lean ? 0.06 : 0.085), { parent: g }); // haunches
    for (const dz of [-1, 1]) { // front legs straight down, paws together
      const leg = mesh(new THREE.CylinderGeometry(lean ? 0.018 : 0.024, lean ? 0.02 : 0.027, 0.17, 10), fluffy ? ruff : fur); leg.position.set(R * sx * 0.62, 0.09, dz * 0.035); inked(leg, 1.15);
      const paw = cball(lean ? 0.026 : 0.033, fluffy ? ruff : chin, R * sx * 0.68, 0.015, dz * 0.036, { parent: g }); paw.scale.set(1.4, 0.6, 1);
    }
    // stripes: rings round the back half of the body at a few heights
    for (let i = 0; i < (lean ? 6 : 4); i++) {
      const yy = 0.07 + i * (lean ? 0.045 : 0.06), f = Math.sqrt(Math.max(0, 1 - ((yy - by) / (R * sy)) ** 2)) * 1.02;
      const sg = new THREE.Group(); sg.position.set(0, yy, 0); sg.rotation.x = Math.PI / 2; sg.scale.set(sx * f, sz * f, 1); g.add(sg);
      const arc = Math.PI * (lean ? 0.8 : 0.6), st = mesh(new THREE.TorusGeometry(R, lean ? 0.008 : 0.014, 4, 20, arc), stripe, sg); st.rotation.z = Math.PI - arc / 2;
    }
  }
  if (!sit) mesh(new THREE.SphereGeometry(R * 0.55, 16, 12), chin).position.set(R * sx * 0.72, 0.06, 0); // chest / bib under the chin
  // stripes over the back: lots of thin ones on Phoebe, fewer broad broken ones on Finn
  const n = sit ? 0 : lean ? 7 : 5;
  for (let i = 0; i < n; i++) {
    // a ring around the body, squashed to its cross-section there (thinner towards the ends); only the arc over the back is drawn
    const sxp = -0.17 + i * (0.3 / (n - 1)), f = Math.sqrt(1 - (sxp / (R * sx)) ** 2) * 1.02;
    const sg = new THREE.Group(); sg.position.set(sxp, 0.1, 0); sg.rotation.y = Math.PI / 2; sg.scale.set(sz * f, sy * f, 1); g.add(sg);
    const st = mesh(new THREE.TorusGeometry(R, lean ? 0.008 : 0.014, 4, 20, Math.PI * (lean ? 0.7 : 0.5)), stripe, sg);
    st.rotation.z = Math.PI * (lean ? 0.15 : 0.25) + (i % 2) * 0.08;
  }
  if (fluffy && sit) { // the ruff all round his neck, and a shaggy chest
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, tuft = inked(mesh(new THREE.ConeGeometry(0.04, 0.09, 5), i % 3 ? ruff : chin));
      tuft.position.set(Math.cos(a) * 0.1 + 0.03, 0.31, Math.sin(a) * 0.1); tuft.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3);
    }
  }
  if (fluffy && !sit) { // a shaggy ruff behind the head, and longer fur along the edge of the curl
    for (let i = 0; i < 9; i++) {
      const a = -1.2 + (i / 8) * 2.4, tuft = inked(mesh(new THREE.ConeGeometry(0.045, 0.1, 5), i % 3 ? ruff : chin));
      tuft.position.set(R * sx * 0.62 + Math.cos(a) * 0.02, 0.12 + Math.cos(a) * 0.05, Math.sin(a) * 0.13); tuft.rotation.set(Math.sin(a) * 1.2, 0, -0.9 - Math.cos(a) * 0.4);
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * 0.55 + (i / 9) * Math.PI * 0.9, tuft = inked(mesh(new THREE.ConeGeometry(0.035, 0.08, 5), i % 2 ? fur : saddle));
      tuft.position.set(Math.cos(a) * R * sx * 0.95, 0.07, Math.sin(a) * R * sz * 0.95); tuft.rotation.set(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4);
    }
  }
  // the tail: asleep it wraps round the side of the curl facing the room and ends under the nose;
  // sitting up, it curls round on the cushion in front of the paws
  const tailN = fluffy ? 13 : 17, tailPts = [];
  for (let i = 0; i < tailN; i++) {
    const t = i / (tailN - 1), a = sit ? Math.PI - t * 2.9 : -2.7 + t * 2.9; // from behind, round the side, to the front
    const rr = (fluffy ? 0.045 + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.05 : 0.024 - t * 0.004) * (sit ? 0.8 : 1);
    const tr = sit ? R * 0.95 : 1, ty = sit ? 0.03 + rr * 0.6 : (fluffy ? 0.12 : 0.14) + Math.sin(t * Math.PI) * 0.025;
    const seg = cball(rr, (fluffy ? i % 3 === 0 : i % 2 === 0) ? stripe : (fluffy ? saddle : fur), Math.cos(a) * (sit ? tr : R * sx * 0.95), ty, Math.sin(a) * (sit ? tr * 0.9 : R * sz * 1.0) - (sit ? 0 : 0.01), { parent: g });
    if (!fluffy && i >= tailN - 2) seg.material.color.set(stripe); // a darker tip
    tailPts.push(seg);
  }
  // front paws tucked under the chin
  if (!sit) for (const dz of [-0.045, 0.05]) { const paw = cball(lean ? 0.03 : 0.04, fluffy ? ruff : fur, R * sx * 0.95, 0.03, dz, { parent: g }); paw.scale.set(1.5, 0.7, 1); }
  const hy = sit ? 0.39 : 0.1; // head height
  const head = new THREE.Group(); g.add(head);
  if (sit) { head.position.set(R * sx * 0.35, hy, 0); head.rotation.set(0, 0, 0.12); } // up on top, looking out (and a touch up, at the skyline)
  else { head.position.set(R * sx * 0.95, hy, 0.04); head.rotation.set(-0.15, 0.25, 0.05); } // chin resting on the front of the curl
  const hr = lean ? 0.085 : 0.1;
  const skull = cball(hr, fur, 0, 0, 0, { parent: head }); skull.scale.set(lean ? 1.08 : 1, lean ? 0.92 : 0.95, lean ? 0.92 : 1.15);
  if (saddle) mesh(new THREE.SphereGeometry(hr * 1.03, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.3), saddle, skull).rotation.z = 0.5; // a dark crown
  for (const dz of [-1, 1]) cball(hr * 0.36, chin, hr * 0.78, -hr * 0.3, dz * hr * 0.26, { parent: head }); // whisker pads
  cball(hr * 0.4, chin, hr * 0.62, -hr * 0.58, 0, { parent: head }); // white chin
  const nz = mesh(new THREE.ConeGeometry(hr * 0.13, hr * 0.12, 3), nose, head); nz.position.set(hr * 1.02, -hr * 0.08, 0); nz.rotation.z = Math.PI; // nose, point down
  for (let k = -1; k <= 1; k++) { const m = mesh(new THREE.BoxGeometry(hr * 0.55, 0.006, 0.009), stripe, head); m.position.set(hr * 0.35, hr * 0.82, k * hr * 0.17); m.rotation.y = k * 0.25; } // forehead "M"
  // eyes: set right on the surface of the face, turned to match it. Asleep they're a dark curve;
  // when you tiptoe up close they slowly half-open (gold for Finn, amber for Phoebe) with a slit pupil and a glint.
  const eyes = [], re = hr * (lean ? 0.24 : 0.21), ss = skull.scale;
  for (const dz of [-1, 1]) {
    const d = new THREE.Vector3(0.8, 0.22, dz * 0.5).normalize();
    const eg = new THREE.Group(); eg.position.set(d.x * hr * ss.x, d.y * hr * ss.y, d.z * hr * ss.z).multiplyScalar(1.01); head.add(eg);
    eg.lookAt(eg.position.clone().add(new THREE.Vector3(d.x / ss.x, d.y / ss.y, d.z / ss.z).normalize())); // face out along the head's surface
    const closed = new THREE.Mesh(new THREE.TorusGeometry(re * 1.15, re * 0.34, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x120a14 }));
    closed.rotation.z = Math.PI; closed.position.set(0, re * 0.35, re * 0.12); closed.scale.y = 0.75; eg.add(closed); // a bold, sleepy curve
    const open = new THREE.Group(); open.visible = false; eg.add(open);
    const white = new THREE.Mesh(new THREE.SphereGeometry(re, 16, 12), new THREE.MeshBasicMaterial({ color: 0x120a14 })); white.scale.set(1.3, 1.05, 0.3); open.add(white); // dark rim
    const iris = new THREE.Mesh(new THREE.SphereGeometry(re, 16, 12), new THREE.MeshBasicMaterial({ color: eye })); iris.scale.set(1.12, 0.9, 0.32); iris.position.z = 0.002; open.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(re, 12, 10), new THREE.MeshBasicMaterial({ color: 0x050308 })); pupil.scale.set(0.28, 0.8, 0.34); pupil.position.z = 0.004; open.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(re * 0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); glint.position.set(re * 0.35, re * 0.3, re * 0.12); open.add(glint);
    const lidTop = new THREE.Mesh(new THREE.SphereGeometry(re * 1.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(fur)); lidTop.scale.set(1.05, 1, 0.42); eg.add(lidTop); // the upper lid that lifts
    eyes.push({ closed, open, lidTop });
  }
  for (const dz of [-1, 1]) { // cheek stripes
    for (const dy of [0, -0.25]) { const c = mesh(new THREE.BoxGeometry(hr * 0.35, 0.006, 0.006), stripe, head); c.position.set(hr * 0.45, hr * dy, dz * hr * 0.88); c.rotation.set(0, dz * 0.5, -0.3); }
  }
  // ears: a triangle with a flat face forward, the inside lined; Phoebe's are big, Finn's have lynx tips
  const ears = [], er = lean ? 0.052 : 0.04, eh = lean ? 0.12 : 0.08;
  for (const dz of [-1, 1]) {
    const eg = new THREE.Group(); eg.position.set(-hr * 0.05, hr * 0.78, dz * hr * 0.55); eg.rotation.set(dz * -0.35, 0, 0.12); head.add(eg);
    const geo = new THREE.ConeGeometry(er, eh, 3, 1, false, -Math.PI / 2);
    const ear = inked(mesh(geo, fur, eg), 1.12); ear.position.y = eh / 2;
    const lin = mesh(geo, inner, eg); lin.scale.setScalar(0.66); lin.position.set(er * 0.32, eh * 0.42, 0);
    if (fluffy) { const tip = mesh(new THREE.ConeGeometry(0.007, 0.045, 4), saddle, eg); tip.position.y = eh + 0.018; }
    ears.push(eg);
  }
  // z's drifting up out of a nap
  const zs = sit ? [] : [0, 1, 2].map((i) => { const z1 = sign("z", 0.07 + i * 0.015, 0.3, 0.3, 0.05, { parent: g, color: "#d6d6e7", font: "700 90px Rajdhani", k: 1.1 }); z1.material.opacity = 0; return z1; });
  const phase = Math.random() * 10;
  let awake = 0;
  animators.push((now) => {
    const b = Math.sin(now / (lean ? 900 : 1200) + phase); body.scale.y = sy + b * 0.025; head.position.y = hy + b * 0.006; // breathing
    // tiptoe up and they stir: eyes ease half open once you're there, and close again when you step back (sitting up, they're awake)
    const want = sit ? 0.8 : spot?.g === g && !flight ? 0.6 : 0;
    awake += (want - awake) * (want > awake ? 0.025 : 0.08);
    const blink = Math.sin(now / 1700 + phase) > 0.985 ? 0.15 : 1; // the odd slow blink
    for (const e of eyes) {
      const o = awake * blink; e.open.visible = o > 0.04; e.closed.visible = !e.open.visible;
      e.open.scale.y = Math.max(0.05, o * 1.4); e.lidTop.position.y = re * (0.05 + o * 0.95) - re * 0.6; e.lidTop.visible = e.open.visible;
    }
    zs.forEach((z1, i) => { const t = (now / 2600 + phase + i / 3) % 1; z1.position.set(0.3 + t * 0.12, 0.27 + t * 0.35, 0.05 - t * 0.05); z1.material.opacity = Math.sin(t * Math.PI) * 0.9 * (1 - Math.min(1, awake * 1.7)); z1.lookAt(camera.position); });
    if (g.userData.twitch) { const k = (now - g.userData.twitch) / 500; ears.forEach((e, i) => { e.rotation.y = k < 1 ? Math.sin(k * Math.PI * 4) * 0.5 * (i ? 1 : -1) : 0; }); if (k >= 1) g.userData.twitch = 0; }
  });
  if (!lite) furUp(g, { fur, stripe, chin, saddle, ruff, inner, nose, fluffy, lean, sit, body, skull, head, hr, R, tailPts, eyes, ears, zs });
  return g;
};
// A cat tree like theirs: dark gray carpet, cubbies with arched doorways, sisal posts, a perch on top.
// Group space: +z faces into the room, so it stands with its back flat to a wall.
/* ---------- the cats' things, desktop: real carpet, sisal, fleece, felt and wood ----------
   Each is a canvas texture used as both colour detail and bump, so the surface has a pile you can see. */
const softTex = (draw, rx = 1, ry = 1) => { const t = canvasTex(256, 256, draw); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; return t; };
const noise = (n, a, lo = 0, hi = 255, sz = 2) => (x, w, h) => { x.fillStyle = "#808080"; x.fillRect(0, 0, w, h); let sd = n; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h / 3; i++) { const v = lo + r() * (hi - lo); x.fillStyle = `rgba(${v},${v},${v},${a})`; x.fillRect(r() * w, r() * h, 1 + r() * sz, 1 + r() * sz); } };
const plushM = (color, rep, seed, bump = 3, sz = 2) => { const t = softTex(noise(seed, 0.55, 40, 230, sz), rep, rep); return new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: bump, roughness: 1, metalness: 0 }); };
const sisalM = (ry) => { const t = softTex((x, w, h) => { x.fillStyle = "#b8935a"; x.fillRect(0, 0, w, h); let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let row = 0; row < 8; row++) { const y0 = row * 32; x.fillStyle = "rgba(60,40,15,.55)"; x.fillRect(0, y0, w, 3); /* the gap between turns of the rope */
      for (let i = 0; i < 90; i++) { const px = r() * w, py = y0 + 4 + r() * 26; x.strokeStyle = r() < 0.5 ? "rgba(235,205,150,.7)" : "rgba(120,85,40,.6)"; x.lineWidth = 1 + r(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + 10, py - 6); x.stroke(); } } /* twisted fibres */ }, 1, ry);
  return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 4, roughness: 0.95 }); };
const woodM = () => { const t = softTex((x, w, h) => { x.fillStyle = "#c08a50"; x.fillRect(0, 0, w, h); let sd = 13; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 60; i++) { const y = r() * h; x.strokeStyle = `rgba(${r() < 0.5 ? "90,55,25" : "220,170,110"},${0.15 + r() * 0.3})`; x.lineWidth = 1 + r() * 2; x.beginPath(); x.moveTo(0, y); for (let px = 0; px <= w; px += 16) x.lineTo(px, y + Math.sin(px / 30 + i) * 3); x.stroke(); } }, 1, 1);
  return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.8, roughness: 0.55 }); };
/* swap a built piece's flat colours for the real stuff, by the colour it was made in */
const furnish = (g, byColor, hide = () => false) => { if (lite) return; g.traverse((o) => { if (!o.isMesh || !o.material?.color) return; if (hide(o)) { o.visible = false; return; }
  const m = byColor[o.material.color.getHex()]; if (m) { o.material = m; o.castShadow = o.receiveShadow = true; } }); };
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
  block(0.72, 0.06, 0.6, carpet, 0, top, 0, { parent: g, r: 0.03 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 8, 28), toon(carpet)); rim.rotation.x = Math.PI / 2; rim.position.set(0, top + 0.06, 0); g.add(rim);
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 28), toon(0x454857)); cushion.position.set(0, top + 0.055, 0); g.add(cushion); // fills the ring, so whoever naps here sits up in it
  // a sisal ball on a string, swinging a little (like theirs)
  const pom = new THREE.Group(); pom.position.set(0.3, 0.08 + tall * 0.5, 0.22); g.add(pom);
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), new THREE.MeshBasicMaterial({ color: 0xd6d6e7 })); str.position.y = -0.1; pom.add(str);
  ball(0.045, 0xe0a487, 0, -0.22, 0, { parent: pom });
  const ph = Math.random() * 10; animators.push((now) => { pom.rotation.z = Math.sin(now / 900 + ph) * 0.25; });
  furnish(g, { [toon(0x3a3d4a).color.getHex()]: plushM(0x666a78, 5, 21, 9, 2), [toon(0x454857).color.getHex()]: plushM(0x767a88, 3, 22, 10, 3), [toon(0xd2b07a).color.getHex()]: sisalM(tall * 4), [toon(0xe0a487).color.getHex()]: sisalM(3) },
    (o) => o.geometry.type === "TorusGeometry" && o.material.color.getHex() === toon(0xb08a55).color.getHex()); /* real carpet pile, a plusher cushion up top, wound sisal posts (the painted rings go) */
  return { g, perch: top + 0.08 };
};
// A round, cushy cat bed.
const catBed = (x, z, R = 0.36) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.02, 0.08, 32), toon(0x4a4d5e)); base.position.y = 0.04; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.1, 10, 36), toon(0x5c6072)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
  const ink = new THREE.Mesh(rim.geometry, inkMat); ink.scale.setScalar(1.04); rim.add(ink);
  if (!lite) { /* a donut bed in fleece: the rim puffed into soft sections, a stitched seam round its top, a cushion sunk in the middle */
    const rg = new THREE.TorusGeometry(R - 0.03, 0.1, 24, 96), p = rg.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.y, v.x); c.set(Math.cos(a) * (R - 0.03), Math.sin(a) * (R - 0.03), 0); const off = v.clone().sub(c); off.multiplyScalar(1 + 0.1 * Math.cos(a * 10)); v.copy(c).add(off); p.setXYZ(i, v.x, v.y, v.z); }
    rg.computeVertexNormals(); rim.geometry = rg; rim.material = plushM(0x6a6e80, 6, 31, 5, 3); rim.castShadow = rim.receiveShadow = true;
    base.material = plushM(0x4e5262, 4, 32, 3); base.receiveShadow = true;
    const cush = new THREE.Mesh(sculpt(R - 0.1, (u) => { u.y *= 0.18; }, 48, 16), plushM(0x5e6274, 4, 33, 5, 3)); cush.position.y = 0.085; cush.receiveShadow = true; g.add(cush);
    const seam = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.003, 4, 96), new THREE.MeshStandardMaterial({ color: 0x3a3d4c, roughness: 1 })); seam.rotation.x = Math.PI / 2; seam.position.y = 0.222; g.add(seam); }
  return g;
};
// Their toys: Finn's green cactus plush, the wooden ball track, a sparkly purple mouse.
const cactus = (x, y, z, rotY) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  const trunk = block(0.5, 0.11, 0.11, 0x4cb54a, 0, 0.055, 0, { parent: g, r: 0.05 });
  block(0.15, 0.09, 0.09, 0x4cb54a, -0.05, 0.05, 0.11, { parent: g, r: 0.04, rot: [0, 0.6, 0] });
  for (let i = 0; i < 5; i++) ball(0.018, 0xff4a2a, 0.26, 0.06 + (i % 2) * 0.02, -0.03 + i * 0.015, { parent: g }); // the red flower
  furnish(g, { [toon(0x4cb54a).color.getHex()]: plushM(0x3f9a48, 3, 41, 2.5, 1), [toon(0xff4a2a).color.getHex()]: plushM(0xd8402a, 2, 42, 2, 1) }); /* soft felt, a little fuzzy */
  if (!lite) for (const dz of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.003, 0.002), new THREE.MeshStandardMaterial({ color: 0x2a6a30, roughness: 1 })); st.position.set(0, 0.11, dz * 0.002); trunk.parent.add(st); } /* the seam along its top */
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
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, lite ? 12 : 32), toon(0xd2b07a)); post.position.y = 0.4; g.add(post);
  furnish(g, { [toon(0xd6a066).color.getHex()]: woodM(), [toon(0xc48f55).color.getHex()]: woodM(), [toon(0xd2b07a).color.getHex()]: sisalM(6) }); /* real wood and sisal */
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
const FIN = { fur: 0x8a7d68, stripe: 0x3a3530, chin: 0xeee8dc, saddle: 0x37332f, ruff: 0xcdb08c, inner: 0xd9c6b8, nose: 0xc9867e, eye: 0xdcb436, size: 1.15, fluffy: true }; // taupe-grey, a near-black back, a cream-tan ruff, yellow-gold eyes
let latestBook = null, setBook = () => {}; // my latest Goodreads read, for the copy on the coffee table
const listPosters = []; // the four framed posters in the theater: { art, capC, capT, hotIx, neonC, list }
const setListPosters = (lists) => lists.slice(0, listPosters.length).forEach((l, i) => {
  const p = listPosters[i]; p.list = l;
  const x = p.capC.getContext("2d"); x.clearRect(0, 0, 420, 70); x.fillStyle = "rgba(8,8,16,.85)"; x.fillRect(0, 0, 420, 70);
  const label = `#1 · ${l.title.toUpperCase()}`; let size = 26; x.font = `600 ${size}px 'JetBrains Mono'`;
  const w = x.measureText(label).width; if (w > 396) { size = Math.floor(size * 396 / w); x.font = `600 ${size}px 'JetBrains Mono'`; } // long names shrink to fit
  x.fillStyle = p.neonC; x.textAlign = "center"; x.fillText(label, 210, 35 + size / 3); p.capT.needsUpdate = true;
  hot[p.hotIx].label = `${l.title} · #1 ${l.top[0]?.title || ""}`; hot[p.hotIx].sub = touch ? "Tap for the top 5" : "Click for the top 5";
  loader.load(`${l.poster}?${encodeURIComponent(l.top[0]?.link || "")}`, (t) => { t.colorSpace = THREE.SRGBColorSpace; p.art.material.map = t; p.art.material.color.setScalar(0.74); p.art.material.needsUpdate = true; }); // dimmed a little, so bright posters don't bloom out
});
let couchCats = [], seatCats = [], kitchenCats = []; // [sleeping cat, sitting cat, name] for each: on the couch, and in the theater seats
const PHOEBE = { fur: 0xe8a058, stripe: 0xc9702e, chin: 0xf4e6d2, inner: 0xf4a6b4, nose: 0xec9ca4, eye: 0xb07c30, size: 0.62, lean: true }; // soft orange, strong darker bands, a cream chest, amber-brown eyes
const buildCats = () => {
  const napper = (g, name) => { g.userData.fromCat = "spot"; addHot(g, "living", name, ["Shh… napping", touch ? "Tap to tiptoe closer" : "Click to tiptoe closer"], () => { g.userData.twitch = performance.now(); spot?.g === g ? askCat() : openCat(g, name); }); };
  // living room: Phoebe on top of the cat tree (back wall, left of the window), Finn in his bed (back wall, right)
  const tree = catTree(-3.2, -6.58, 0, { tall: 1.5 });
  const phoebeNap = cat(PHOEBE, -3.22, tree.perch, -6.56, -1.2); napper(phoebeNap, "Phoebe");
  catBed(3.2, -6.3, 0.54); // roomy: Finn's a big cat
  const finNap = cat(FIN, 3.2, 0.12, -6.3, -1.9); napper(finNap, "Finn");
  // on the couch, sitting up beside you and watching the city (they hop over when you sit down)
  const phoebeSit = cat(PHOEBE, 0.02, 0.68, -4.8, Math.PI / 2, { sit: true }), finSit = cat(FIN, 0.7, 0.68, -4.8, Math.PI / 2, { sit: true }); // on the middle and right cushions
  couchCats = [[phoebeNap, phoebeSit, "Phoebe"], [finNap, finSit, "Finn"]];
  // in the theater, each in a front-row recliner facing the screen (they come along when you go to the shelf)
  const finSeat = cat(FIN, -4.3, 0.46, -12.66, Math.PI / 2, { sit: true }), phoebeSeat = cat(PHOEBE, -2.7, 0.46, -12.66, Math.PI / 2, { sit: true });
  seatCats = [[phoebeNap, phoebeSeat, "Phoebe"], [finNap, finSeat, "Finn"]];
  const finKitchen = cat(FIN, 4.74, 0, -1.02, 2.64, { sit: true }); // by the fridge, looking up at the cook
  kitchenCats = [[finNap, finKitchen, "Finn"]]; finKitchen.userData.fromKitchen = true;
  for (const [list, where] of [[couchCats, "living"], [seatCats, "shelf"], [kitchenCats, "living"]]) for (const [, sitter, name] of list) {
    sitter.visible = false; sitter.userData.home = sitter.position.clone(); sitter.userData.fromCouch = true;
    addHot(sitter, where, name, touch ? "Tap for pictures" : "Click for pictures", () => askSitCat(name));
  }
  for (const [napper] of couchCats) napper.userData.home = napper.position.clone();
  // the hop: up and off one spot, down onto the other
  animators.push((now) => {
    for (const [nap, sitter] of [...couchCats, ...seatCats, ...kitchenCats]) for (const c of [nap, sitter]) {
      const h = c.userData.hop; if (!h) continue;
      const t = (now - h.t0) / 380; if (t < 0) continue;
      if (t >= 1) { c.position.copy(c.userData.home); c.scale.setScalar(c.userData.size); c.visible = h.show; c.userData.hop = null; continue; }
      c.visible = true; c.position.copy(c.userData.home); c.position.y += h.show ? (1 - t) * 0.35 + Math.sin(t * Math.PI) * 0.12 : t * 0.35 + Math.sin(t * Math.PI) * 0.12;
      c.scale.setScalar(c.userData.size * (h.show ? 0.6 + t * 0.4 : 1 - t * 0.4));
    }
  });
  /* desktop: they don't stay put. Every minute or two a cat gets up and moves to another of its spots: a short
     jump if the spot is close (tree to armchair, couch to bed), or, for the far ones, while you're looking the other
     way, so you find them somewhere new. Never while you're sitting with them or up close. */
  if (!lite) {
    const down = new THREE.Raycaster(), solid = [], hit = (x, z, y0 = 2.2) => { down.set(V(x, y0, z), V(0, -1, 0)); const h = down.intersectObjects(solid, false)[0]; return h ? h.point.y : 0; };
    const SPOTS = {
      Phoebe: [{ x: -3.22, z: -6.56, y: tree.perch, r: -1.2 }, { x: -2.35, z: -5.45, r: 0.3 }, { x: 0.62, z: -6.79, r: Math.PI, y: 0.96 }, { x: -0.78, z: -4.72, r: 2.2 }, { x: -2.8, z: -1.5, r: 0.9, y: 0.02 }],
      Finn: [{ x: 3.2, z: -6.3, y: 0.12, r: -1.9 }, { x: 0.8, z: -4.72, r: 1.2 }, { x: -2.6, z: -1.6, r: -0.4, y: 0.02 }, { x: 1.55, z: -3.35, r: 2.6, y: 0.02 }],
    };
    const cats = couchCats.map(([g, , name]) => ({ g, name, at: 0, next: performance.now() + 25000 + Math.random() * 40000, spots: SPOTS[name] }));
    let ready = false; const fill = () => { /* surface heights under each spot, from the real furniture (once it's all built) */
      scene.traverse((o) => { if (o.isMesh && o.visible && o.material?.visible !== false && !o.material?.transparent) { let p = o, isCat = false; while (p) { if (cats.some((c) => c.g === p) || p.userData.fromCouch) isCat = true; p = p.parent; } if (!isCat) solid.push(o); } });
      for (const c of cats) for (const sp of c.spots) if (sp.y == null) sp.y = hit(sp.x, sp.z) + 0.005; solid.length = 0; ready = true; };
    const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), onScreen = (p) => { pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm); return fr.intersectsSphere(new THREE.Sphere(p, 0.45)); };
    animators.push((now) => {
      if (!ready) { if (now > 4000) fill(); return; }
      for (const c of cats) {
        const g = c.g, m = c.move;
        if (m) { /* mid-jump: crouch, a parabola there turning toward it, then settle into the new pose */
          if (g.userData.hop) { g.userData.home.copy(m.to); g.rotation.y = m.r1; g.scale.setScalar(c.size); c.move = null; continue; } /* you sat down mid-jump: land at once */
          const t = Math.min(1, (now - m.t0) / m.dur), e = t * t * (3 - 2 * t), crouch = t < 0.15 ? Math.sin((t / 0.15) * Math.PI) : 0;
          g.position.lerpVectors(m.from, m.to, e); g.position.y += Math.sin(t * Math.PI) * m.arc;
          g.rotation.y = m.r0 + (m.r1 - m.r0) * Math.min(1, t * 1.3);
          g.scale.set(c.size * (1 + crouch * 0.06), c.size * (1 - crouch * 0.12 + Math.sin(t * Math.PI) * 0.05), c.size);
          if (t >= 1) { g.scale.setScalar(c.size); g.userData.home.copy(m.to); c.move = null; }
          continue;
        }
        if (now < c.next) continue;
        const free = spot == null && !flight && g.visible && !g.userData.hop && !(spot?.g === g);
        if (!free) { c.next = now + 8000; continue; }
        const other = cats.find((o) => o !== c), taken = (sp) => other && Math.hypot(sp.x - other.g.position.x, sp.z - other.g.position.z) < 0.6;
        const here = g.position, opts = c.spots.map((sp, i) => ({ sp, i, d: Math.hypot(sp.x - here.x, sp.z - here.z) })).filter((o) => o.i !== c.at && !taken(o.sp));
        if (!opts.length) { c.next = now + 20000; continue; }
        const seen = onScreen(here), pickFrom = seen ? opts.filter((o) => o.d < 2.6) : opts;
        if (!pickFrom.length || (seen && reduce)) { c.next = now + 15000; continue; } /* nowhere close to jump to while watched: wait */
        const o = pickFrom[Math.floor(Math.random() * pickFrom.length)], to = V(o.sp.x, o.sp.y, o.sp.z);
        c.size ||= g.scale.x; c.at = o.i; c.next = now + 60000 + Math.random() * 90000;
        if (!seen) { g.position.copy(to); g.rotation.y = o.sp.r; g.userData.home.copy(to); shadowDirty = now + 200; continue; }
        let r1 = o.sp.r; while (r1 - g.rotation.y > Math.PI) r1 -= Math.PI * 2; while (g.rotation.y - r1 > Math.PI) r1 += Math.PI * 2;
        c.move = { t0: now, dur: 700 + o.d * 180, from: here.clone(), to, arc: 0.25 + Math.abs(to.y - here.y) * 0.5 + o.d * 0.08, r0: g.rotation.y, r1 };
        g.userData.twitch = now; shadowDirty = now + c.move.dur + 300;
      }
    });
    if (location.search.includes("debug")) window.__cats = { cats, nudge: () => cats.forEach((c) => (c.next = 0)) };
  }
  cactus(2.3, 0, -6.6, 0.4);
  ballTrack(-1.75, -6.45); // out from behind the armchair
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
let height = 0, skyline = null, cityPhoto = null, glassMat = null;
const drawSkyline = () => { // painted once; the HUD is layered on top every few seconds
  // DC at night, painted to read like a long-exposure photo rather than a cartoon: a smoggy sky lit from below
  // by the city, layers of towers fading into haze with real window grids (warm homes, cool offices, dark floors),
  // rooftop plant and red aviation lights, the floodlit Capitol and Monument across the Mall, streetlights and
  // long-exposure traffic trails below, near buildings framing it, and grain so it doesn't look digital.
  // It's static: no moving traffic or trains (the rain on the glass is the only thing that moves).
  const W = 2080, Hh = 800;
  const c = document.createElement("canvas"); c.width = W; c.height = Hh; const ctx0 = c.getContext("2d"); let x = ctx0;
  // paint some layers on their own sheet, then lay it down slightly softened (a lens, and the air, aren't pin sharp)
  const soft = (px, fn) => { const t = document.createElement("canvas"); t.width = W; t.height = Hh; x = t.getContext("2d"); fn(); x = ctx0; x.save(); x.filter = `blur(${px}px)`; x.drawImage(t, 0, 0); x.restore(); };
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  const glowDot = (px, py, rad, col, a) => { const gr = x.createRadialGradient(px, py, 0, px, py, rad); gr.addColorStop(0, rgba(...col, a)); gr.addColorStop(1, rgba(...col, 0)); x.fillStyle = gr; x.fillRect(px - rad, py - rad, rad * 2, rad * 2); };

  // the sky: near-black overhead, the city's sodium-and-neon glow banked up along the horizon
  const sky = x.createLinearGradient(0, 0, 0, Hh);
  sky.addColorStop(0, "#03040a"); sky.addColorStop(0.35, "#0a1020"); sky.addColorStop(0.62, "#23182e"); sky.addColorStop(0.78, "#4a2638"); sky.addColorStop(1, "#5c3030");
  x.fillStyle = sky; x.fillRect(0, 0, W, Hh);
  // low cloud, lit from underneath (soft blobs, brighter towards the horizon)
  x.save(); x.filter = "blur(18px)";
  for (let i = 0; i < 140; i++) {
    const cy = 40 + Math.pow(rnd(), 0.7) * 380, k = cy / 420;
    x.fillStyle = rgba(120 + k * 90, 70 + k * 40, 90 + k * 10, 0.05 + rnd() * 0.07 * k);
    x.beginPath(); x.ellipse(rnd() * W, cy, 120 + rnd() * 260, 14 + rnd() * 30, 0, 0, Math.PI * 2); x.fill();
  }
  x.restore();
  // the moon, half lost in the haze
  glowDot(1760, 120, 120, [255, 230, 240], 0.12); x.fillStyle = "rgba(255,240,236,.55)"; x.beginPath(); x.arc(1760, 120, 30, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(255,255,255,${0.08 + rnd() * 0.25})`; x.fillRect(rnd() * W, rnd() * 200, 1.5, 1.5); } // the odd star

  // the Capitol and the Monument need clear sky round them: [from x, to x, lowest roofline]
  const clear = [[520, 1020, 600], [1215, 1365, 660]];
  const cap = (px, w, top, base, extra = 0) => { for (const [a, b, roof] of clear) if (px + w > a && px < b) top = Math.max(top, roof + extra); return Math.min(top, base - 6); };

  // a lit crown on some of the tall ones: uplighting washing the top floors, fading down
  const crown = (px, w, top, depth) => {
    if (rnd() > 0.22 || w < 34) return;
    const cc = [[230, 235, 255], [5, 217, 232], [255, 120, 190], [255, 200, 130]][Math.floor(rnd() * 4)], ch = 30 + depth * 30;
    const gr = x.createLinearGradient(0, top, 0, top + ch); gr.addColorStop(0, rgba(...cc, 0.55)); gr.addColorStop(1, rgba(...cc, 0)); x.fillStyle = gr; x.fillRect(px, top, w, ch);
    x.fillStyle = rgba(...cc, 0.8); x.fillRect(px, top, w, 1.5);
  };
  // A building: facade shaded top to bottom, a rim of light down one edge, a grid of windows.
  // depth 0 = far (small, hazy) … 1 = near (big, crisp)
  const building = (px, w, top, base, depth, haze) => {
    const fh = 5 + depth * 9, ww = 2 + depth * 4, gap = 2 + depth * 4; // floor height, window size, spacing
    const tone = 10 + rnd() * 10, fac = x.createLinearGradient(0, top, 0, base);
    fac.addColorStop(0, rgba(tone + 6, tone + 8, tone + 18, 1)); fac.addColorStop(1, rgba(tone + 22, tone + 10, tone + 20, 1)); // street glow creeping up the walls
    x.fillStyle = fac; x.fillRect(px, top, w, base - top + 2);
    if (rnd() < 0.5) { x.fillStyle = rgba(160, 170, 210, 0.08 + depth * 0.08); x.fillRect(px, top, Math.max(1, depth * 3), base - top); } // rim light
    const style = rnd(); // most are punched-window blocks; some are glass curtain-wall towers; some have fins
    if (style < 0.25 && base - top > 120) { // glass tower: the sky in its glass, faint floor lines, a few floors still lit
      const gl = x.createLinearGradient(px, 0, px + w, 0); gl.addColorStop(0, rgba(30, 34, 60, 1)); gl.addColorStop(0.5 + rnd() * 0.3, rgba(70 + depth * 30, 60, 95, 1)); gl.addColorStop(1, rgba(20, 22, 40, 1));
      x.fillStyle = gl; x.fillRect(px, top, w, base - top + 2);
      x.fillStyle = rgba(0, 0, 0, 0.25); for (let wy = top; wy < base; wy += fh) x.fillRect(px, wy, w, 1);
      x.fillStyle = rgba(0, 0, 0, 0.18); for (let wx = px; wx < px + w; wx += ww * 2 + gap) x.fillRect(wx, top, 1, base - top);
      const lc = rnd() < 0.6 ? [220, 232, 255] : [255, 205, 140];
      for (let wy = top + fh; wy < base - fh; wy += fh) if (rnd() < 0.18) { x.fillStyle = rgba(...lc, 0.35 + rnd() * 0.4); x.fillRect(px + 1, wy + 1, w - 2, fh * 0.6); }
      crown(px, w, top, depth); if (haze) { x.fillStyle = haze; x.fillRect(px, top - 80, w, base - top + 80); } return;
    }
    const fins = style > 0.82;
    // windows: each building has its own light (warm flats, cool offices, a few teal), whole floors on or off
    const kind = rnd(), warm = kind < 0.55, cool = kind > 0.85, litK = 0.15 + rnd() * 0.5;
    const col = warm ? [255, 196, 120] : cool ? [150, 235, 255] : [215, 228, 255];
    const office = !warm && rnd() < 0.6;
    for (let wy = top + fh * 0.8; wy < base - fh * 0.6; wy += fh) {
      const floorOn = office ? rnd() < litK + 0.15 : true;
      for (let wx = px + gap; wx < px + w - ww - 1; wx += ww + gap) {
        const on = floorOn && rnd() < (office ? 0.85 : litK);
        if (on) { const b = 0.55 + rnd() * 0.45; x.fillStyle = rgba(col[0] * b, col[1] * b, col[2] * b, 0.55 + depth * 0.4); }
        else x.fillStyle = rgba(40, 46, 70, 0.35); // dark glass, catching a bit of sky
        x.fillRect(wx, wy, ww, fh * 0.55);
      }
    }
    if (fins) { x.fillStyle = rgba(tone - 4, tone - 2, tone + 6, 0.9); for (let wx = px + gap / 2; wx < px + w; wx += (ww + gap) * 2) x.fillRect(wx - 1, top, Math.max(1.5, gap * 0.7), base - top); }
    crown(px, w, top, depth);
    // roof: plant rooms, water tanks, a mast with a red aviation light
    if (rnd() < 0.55) { x.fillStyle = rgba(tone, tone + 2, tone + 10, 1); const rw = w * (0.3 + rnd() * 0.3); x.fillRect(px + (w - rw) * rnd(), top - fh * 1.2, rw, fh * 1.2); }
    if (w > 40 && rnd() < 0.35) { const mx = px + w * (0.3 + rnd() * 0.4), mh = 20 + rnd() * 50 * (1 - depth * 0.4); x.fillStyle = "#0a0c14"; x.fillRect(mx, top - mh, 2, mh); glowDot(mx + 1, top - mh, 8 + depth * 6, [255, 40, 50], 0.8); }
    if (haze) { x.fillStyle = haze; x.fillRect(px, top - 80, w, base - top + 80); }
  };
  const layer = (base, min, max, wMin, wMax, depth, haze, extra) => {
    for (let px = -40; px < W + 40;) {
      const w = wMin + rnd() * (wMax - wMin), top = cap(px, w, base - (min + rnd() * (max - min)), base, extra);
      building(px, w, top, base, depth, haze);
      px += w + rnd() * 6;
    }
  };
  // haze between layers: the further back, the more the sky colour swallows it
  soft(1.6, () => layer(640, 120, 470, 30, 70, 0.05, "rgba(60,36,60,.45)", -40));  // the far city, on the horizon
  soft(1.0, () => layer(660, 80, 330, 40, 90, 0.2, "rgba(50,30,50,.3)", 0));      // further in
  soft(0.7, () => layer(690, 40, 220, 50, 120, 0.35, "rgba(40,24,40,.18)", 40));  // the middle distance, low round the Mall
  { const hz = x.createLinearGradient(0, 420, 0, 720); hz.addColorStop(0, "rgba(90,50,70,0)"); hz.addColorStop(1, "rgba(90,50,70,.3)"); x.fillStyle = hz; x.fillRect(0, 420, W, 300); } // low haze over it all

  // the Mall: lines of dark trees, lamps along the paths, the reflecting pool
  x.fillStyle = "#070810"; x.fillRect(0, 690, W, 110);
  for (let px = 0; px < W; px += 9) { const th = 8 + rnd() * 14; x.fillStyle = rgba(8 + rnd() * 6, 12 + rnd() * 6, 14, 1); x.beginPath(); x.ellipse(px, 694, 9, th, 0, 0, Math.PI * 2); x.fill(); }
  for (let px = 20; px < W; px += 38 + rnd() * 10) glowDot(px, 697 + rnd() * 3, 12, [255, 190, 110], 0.45);

  // DC, floodlit from below so it glows against the city: the Capitol, dome on its drum, wings either side
  // (painted on its own sheet and softened a touch, then given a stone grain)
  const stone = (top, bottom, k = 1) => { const gr = x.createLinearGradient(0, top, 0, bottom); gr.addColorStop(0, rgba(120 * k, 122 * k, 150 * k, 1)); gr.addColorStop(0.55, rgba(178 * k, 176 * k, 190 * k, 1)); gr.addColorStop(1, rgba(218 * k, 202 * k, 176 * k, 1)); return gr; };
  glowDot(770, 560, 330, [230, 225, 255], 0.16); glowDot(1290, 430, 220, [255, 235, 205], 0.12); // the floodlight's glow in the air
  soft(0.8, () => {
  x.fillStyle = stone(600, 700, 0.85); x.fillRect(540, 604, 460, 96); // the wings
  x.fillStyle = stone(560, 700, 0.95); x.fillRect(690, 548, 160, 152); // centre block
  x.beginPath(); x.moveTo(680, 552); x.lineTo(770, 522); x.lineTo(860, 552); x.closePath(); x.fill(); // pediment
  x.fillStyle = stone(450, 560); x.fillRect(705, 470, 130, 82); // the drum
  { const dg = x.createLinearGradient(700, 360, 840, 470); dg.addColorStop(0, "#6f7392"); dg.addColorStop(0.45, "#b9b8c8"); dg.addColorStop(1, "#d8ccb6"); x.fillStyle = dg; x.beginPath(); x.ellipse(770, 472, 78, 118, 0, Math.PI, 0); x.fill(); } // the dome
  x.fillStyle = stone(330, 360); x.fillRect(759, 328, 22, 30); x.beginPath(); x.moveTo(764, 328); x.lineTo(770, 300); x.lineTo(776, 328); x.fill(); // lantern and statue
  x.fillStyle = "rgba(50,50,78,.6)";
  for (let cx = 550; cx < 995; cx += 11) if (cx < 688 || cx > 852) x.fillRect(cx, 616, 4, 76); // columns along the wings
  for (let cx = 712; cx < 832; cx += 9) x.fillRect(cx, 480, 3, 66); // round the drum
  for (let cx = 698; cx < 846; cx += 12) x.fillRect(cx, 556, 4, 60); // the portico
  x.fillStyle = "rgba(70,72,100,.5)"; x.fillRect(540, 604, 460, 3); x.fillRect(690, 548, 160, 3); x.fillRect(705, 470, 130, 3); // cornices in shadow
  for (const a of [-0.55, -0.28, 0, 0.28, 0.55]) { x.strokeStyle = "rgba(90,95,130,.45)"; x.lineWidth = 1.5; x.beginPath(); x.ellipse(770, 472, 78 * Math.abs(Math.cos(a * 2)) + 1, 118, 0, Math.PI, 0); x.stroke(); } // dome ribs
  for (let cx = 556; cx < 990; cx += 22) if (cx < 688 || cx > 852) { x.fillStyle = "rgba(255,214,150,.75)"; x.fillRect(cx, 660, 5, 8); } // lit windows
  x.fillStyle = "rgba(255,214,150,.6)"; for (let k = 0; k < 4; k++) x.fillRect(726 + k * 26, 500, 6, 22); // the drum's windows
  // the Monument: a pale needle, lit on one face, with its two red beacons
  x.fillStyle = stone(232, 700, 1); x.beginPath(); x.moveTo(1290, 232); x.lineTo(1312, 262); x.lineTo(1328, 700); x.lineTo(1252, 700); x.lineTo(1268, 262); x.closePath(); x.fill();
  { const sg = x.createLinearGradient(1290, 0, 1328, 0); sg.addColorStop(0, "rgba(80,70,70,.35)"); sg.addColorStop(1, "rgba(40,36,40,.55)"); x.fillStyle = sg; x.beginPath(); x.moveTo(1290, 232); x.lineTo(1312, 262); x.lineTo(1328, 700); x.lineTo(1290, 700); x.closePath(); x.fill(); } // its shaded face
  for (const bx of [1282, 1298]) glowDot(bx, 268, 9, [255, 40, 60], 0.95);
  // the reflecting pool, catching both
  const rp = x.createLinearGradient(0, 702, 0, 724); rp.addColorStop(0, "rgba(235,230,250,.45)"); rp.addColorStop(1, "rgba(235,230,250,0)");
  x.fillStyle = rp; x.fillRect(560, 702, 800, 22);
  x.fillStyle = "rgba(240,235,255,.22)"; x.fillRect(1262, 704, 56, 40); x.fillRect(720, 704, 100, 26); // their reflections
  // on the stone only: floodlight pools from the lamps at their feet, then a fine grain of weathered marble
  x.save(); x.globalCompositeOperation = "source-atop";
  for (const [fx, fy, fr] of [[600, 700, 120], [770, 700, 200], [940, 700, 120], [1290, 700, 160]]) { const fg = x.createRadialGradient(fx, fy, 0, fx, fy, fr); fg.addColorStop(0, "rgba(255,226,180,.3)"); fg.addColorStop(1, "rgba(255,236,200,0)"); x.fillStyle = fg; x.fillRect(fx - fr, fy - fr, fr * 2, fr * 2); }
  const top = x.createLinearGradient(0, 230, 0, 520); top.addColorStop(0, "rgba(40,40,80,.35)"); top.addColorStop(1, "rgba(40,40,80,0)"); x.fillStyle = top; x.fillRect(500, 230, 900, 290); // tops falling off into the night
  for (let i = 0; i < 9000; i++) { x.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.06)"; x.fillRect(520 + rnd() * 820, 290 + rnd() * 420, 1 + rnd() * 2, 1); }
  x.restore();
  });

  // big LED screens on the towers, spilling their colour onto the walls round them
  const board = (bx, by, bw, bh, c1, c2, title, sub) => {
    const cc = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    glowDot(bx + bw / 2, by + bh / 2, Math.max(bw, bh) * 1.1, cc(c1), 0.22);
    x.fillStyle = "#06070c"; x.fillRect(bx - 4, by - 4, bw + 8, bh + 8); // its frame
    const gr = x.createLinearGradient(bx, by, bx + bw, by + bh); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    x.globalAlpha = 0.8; x.fillStyle = gr; x.fillRect(bx, by, bw, bh); x.globalAlpha = 1;
    x.fillStyle = "rgba(0,0,0,.18)"; for (let y = by; y < by + bh; y += 3) x.fillRect(bx, y, bw, 1); // LED rows
    const fit = (font, size, text, max) => { x.font = font.replace("{}", size); const w = x.measureText(text).width; if (w > max) x.font = font.replace("{}", Math.floor(size * max / w)); };
    x.fillStyle = "rgba(255,255,255,.95)"; fit("700 {}px Rajdhani", Math.round(bh * 0.32), title, bw - 24); x.fillText(title, bx + 12, by + bh * 0.5);
    x.fillStyle = "rgba(255,255,255,.8)"; fit("500 {}px 'JetBrains Mono'", Math.round(bh * 0.12), sub, bw - 28); x.fillText(sub, bx + 14, by + bh * 0.78);
  };

  // near buildings framing the view at both sides (kept low in the middle, below the landmarks' feet)
  soft(0.5, () => { for (const [a, b, lo, hi] of [[-20, 470, 280, 560], [470, 560, 90, 130], [1400, 1470, 100, 160], [1470, 2100, 260, 520]]) {
    for (let px = a; px < b;) { const w = Math.min(b - px, 70 + rnd() * 110); building(px, w, 800 - (lo + rnd() * (hi - lo)), 820, 0.85, null); px += w + 3; }
  } });
  // the screens go up after the near buildings, so they're mounted on them rather than hidden behind
  board(140, 330, 210, 110, "#ff2a6d", "#7b2cbf", "NEON NOODLE", "2-FOR-1 AFTER MIDNIGHT");
  board(1030, 290, 160, 200, "#05d9e8", "#1f3cff", "DREAMLOOP", "MIDNIGHT FEATURE");
  board(1560, 360, 230, 100, "#f9f002", "#ff7a1a", "SKYDROP", "FOOD IN 4 MIN");
  // a few neon signs down the near buildings (small and real, not cartoon strips)
  const vsign = (sx, sy, word, colH) => {
    const cc = [parseInt(colH.slice(1, 3), 16), parseInt(colH.slice(3, 5), 16), parseInt(colH.slice(5, 7), 16)];
    glowDot(sx + 11, sy + word.length * 11, 60, cc, 0.25);
    x.fillStyle = "rgba(5,5,10,.85)"; x.fillRect(sx, sy, 22, word.length * 22 + 8);
    x.save(); x.shadowColor = colH; x.shadowBlur = 12; x.fillStyle = colH; x.font = "700 17px 'JetBrains Mono'"; x.textAlign = "center";
    [...word].forEach((ch, k) => x.fillText(ch, sx + 11, sy + 22 + k * 22)); x.restore();
  };
  vsign(60, 330, "HOTEL", "#ff2a6d"); vsign(400, 380, "RAMEN", "#05d9e8"); vsign(1640, 520, "BAR", "#f9f002"); vsign(1960, 320, "OPEN24", "#ff6bd5");

  // the street: sodium lamps and long-exposure traffic (white coming, red going), on wet tarmac
  x.fillStyle = "#0a0a10"; x.fillRect(0, 760, W, 40);
  const trail = (y0, y1, col, n, wid) => { for (let i = 0; i < n; i++) { const yy = y0 + (y1 - y0) * rnd(); const gr = x.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, rgba(...col, 0)); gr.addColorStop(0.15 + rnd() * 0.2, rgba(...col, 0.5 + rnd() * 0.4)); gr.addColorStop(0.7 + rnd() * 0.3, rgba(...col, 0.4)); gr.addColorStop(1, rgba(...col, 0)); x.fillStyle = gr; x.fillRect(0, yy, W, wid); } };
  x.save(); x.filter = "blur(1px)"; trail(768, 776, [255, 240, 215], 10, 2); trail(780, 790, [255, 50, 60], 12, 2); x.restore();
  for (let px = 30; px < W; px += 120) { glowDot(px, 752, 30, [255, 170, 80], 0.5); glowDot(px, 788, 26, [255, 160, 70], 0.18); } // lamps, and their smear on the wet road
  // fog at street level, warm from the lamps and pink from the signs
  const fog = x.createLinearGradient(0, 600, 0, Hh); fog.addColorStop(0, "rgba(255,120,140,0)"); fog.addColorStop(1, "rgba(255,110,120,.16)");
  x.fillStyle = fog; x.fillRect(0, 600, W, 200);
  // halation: bright lights bleed softly into the air round them, like they do through a real lens
  { const hs = document.createElement("canvas"); hs.width = W / 4; hs.height = Hh / 4; const hx = hs.getContext("2d");
    hx.filter = "contrast(3) brightness(0.6)"; hx.drawImage(c, 0, 0, W / 4, Hh / 4);
    x.save(); x.globalCompositeOperation = "lighter"; x.globalAlpha = 0.28; x.filter = "blur(5px)"; x.drawImage(hs, 0, 0, W, Hh); x.restore(); }
  // grain, so it reads as a photo rather than flat paint
  { const img = x.getImageData(0, 0, W, Hh), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(img, 0, 0); }
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
  const x = windowCanvas.getContext("2d");
  x.setTransform(1.25, 0, 0, 1.25, 0, 0);
  // the view itself: on desktop the glass shader draws the photo layers, so this canvas only carries the HUD;
  // phones get the flattened photo; the painted skyline is the fallback if the photos haven't loaded
  if (glassMat) x.clearRect(0, 0, 2080, 800);
  else { if (!cityPhoto && !skyline) drawSkyline(); x.drawImage(cityPhoto || skyline, 0, 0, 2080, 800); }
  if (glassMat) glassMat.uniforms.rainK.value = (1 - winApp) * SKY.drops;
  if (winApp < 0.35) drawHUD(x, 1 - winApp / 0.35);
  if (winApp > 0) drawApp(x, winApp);
  if (rainMesh) rainMesh.material.opacity = 0.18 * (1 - winApp); // rain clears off the glass while the app is up
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
    NEWS = f.news?.items?.length ? f.news : { source: "", items: [] }; drawWindow();
    const book = f.goodreads?.books?.[0]; if (book) setBook({ ...book, profile: f.goodreads.profile });
    if (f.letterboxd?.featured?.length) setListPosters(f.letterboxd.featured);
    latest = f.letterboxd?.diary?.[0] || null;
    if (!latest) return drawScreen(null);
    const img = new Image();
    img.onload = () => drawScreen(img); img.onerror = () => drawScreen(null);
    img.src = `data/now-showing.jpg?${encodeURIComponent(latest.published || latest.title)}`;
  }).catch(() => drawScreen(null));
  const tip = () => fetch("https://mempool.space/api/blocks/tip/height").then((r) => r.text()).then((t) => { height = +t || height; drawWindow(); }).catch(() => {});
  tip(); setInterval(tip, 120000);
  drawWindow(); setInterval(drawWindow, 15000);
  loadWeather(); setInterval(loadWeather, 15 * 60000);
};

// ---------- camera: fixed spots, glided between along curves ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Every view lets you turn all the way round unless it sets a `yaw` limit (only the long shelf rows do: dragging slides along them).
const VIEWS = {
  // a little off to one side of my door, so the hall visibly runs away past it
  outside: { pos: V(1.75, 1.65, 4.0), look: V(-0.6, 1.45, 0), name: "Front door",
    hint: touch ? "Tap the door to come in" : "Click the door to come in" },
  living: { pos: V(0, 1.72, -1.1), look: V(0, 1.45, -7), name: "Living room",
    hint: touch ? "Tap a doorway · swipe to look around" : "Click a doorway · drag to look around" },
  theater: { pos: V(-4.5, 2.15, -8.2), look: V(-4.5, 1.85, -17), name: "Theater",
    hint: touch ? "Tap the screen for my review · tap the shelf to browse it" : "Click the screen for my review · click the shelf to browse it" },
  gallery: { pos: V(7.3, 1.65, -3.6), look: V(13.1, 1.55, -3.6), name: "Gallery",
    hint: touch ? "Tap a photo to see it large · tap the desk to sit at it" : "Click a photo to see it large · click the desk to sit at it" },
  shelf: { pos: V(-4.6, 1.72, -13.7), look: V(-8.75, 1.65, -13.7), name: "Movie shelf",
    hint: touch ? "Tap a shelf to look closer" : "Click a shelf to look closer" },
};
// the rooms as a tree (each room's way back), so a walk can go up from one room and down to another
const PARENT = { living: "outside", theater: "living", shelf: "theater", gallery: "living", music: "living", closet: "living" };
if (!lite) Object.assign(VIEWS, {
  music: { pos: V(4.5, 1.64, -8.25), look: V(5.5, 1.5, -13.7), name: "Music room", hint: "Click a record, the screen or the turntable · drag to look around" },
  closet: { pos: V(-7.0, 1.62, -2.0), look: V(-10.4, 1.45, -3.1), name: "Closet", hint: "Click a piece to look closer · drag to look around" },
});
const lineage = (r) => { const c = [r]; while (PARENT[c[0]]) c.unshift(PARENT[c[0]]); return c; };
const routeTo = (from, to) => {
  const a = lineage(from), b = lineage(to); let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return [...a.slice(k - 1, -1).reverse(), ...b.slice(k)];
};
const PATHS = { // waypoints for position and where the camera looks, from → to
  "living>gallery": { pos: [V(0, 1.72, -1.1), V(2.4, 1.72, -3.9), V(5.2, 1.66, -3.6), V(6.4, 1.65, -3.6), V(7.3, 1.65, -3.6)], look: [V(0, 1.45, -7), V(5.9, 1.5, -3.6), V(9, 1.5, -3.6), V(13.1, 1.55, -3.6), V(13.1, 1.55, -3.6)] },
  "living>music": { pos: [V(0, 1.72, -1.1), V(3.0, 1.72, -4.0), V(4.5, 1.68, -6.0), V(4.5, 1.66, -7.3), V(4.5, 1.64, -8.25)], look: [V(0, 1.45, -7), V(4.5, 1.6, -7), V(4.6, 1.55, -9.4), V(5.2, 1.5, -12.5), V(5.5, 1.5, -13.7)] },
  "living>closet": { pos: [V(0, 1.72, -1.1), V(-3.2, 1.7, -1.6), V(-5.1, 1.66, -1.9), V(-6.4, 1.63, -1.9), V(-7.0, 1.62, -2.0)], look: [V(0, 1.45, -7), V(-6, 1.5, -1.9), V(-8, 1.5, -1.9), V(-10.4, 1.45, -2.6), V(-10.4, 1.45, -3.1)] },
  "outside>living": { pos: [V(1.9, 1.65, 4.75), V(0.5, 1.62, 2.1), V(0, 1.66, 0.35), V(0, 1.72, -0.6)], look: [V(-0.6, 1.45, 0), V(0, 1.5, -3), V(0, 1.45, -6), V(0, 1.45, -7)] },
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
const view = () => peekView || focusRow?.view || nodeFocus?.view || winFocus?.view || spot?.view || VIEWS[room];
const setRoomUI = () => {
  const v = VIEWS[room];
  ui.room.textContent = focusRow ? `${v.name} · ${NAMES[focusRow.f.row.id] || ""}` : nodeFocus ? `${v.name} · Node` : winFocus ? `${v.name} · Clock` : spot ? `${v.name} · ${spot.name}` : v.name;
  ui.hint.textContent = focusRow ? (focusRow.pan ? "Swipe along the shelf · tap a movie to pull it out" : touch ? "Tap a movie to pull it out" : "Click a movie to pull it out")
    : nodeFocus ? (touch ? "Tap a block to open it · tap away to step back" : "Click a block to open it on mempool.space · click away to step back")
    : winFocus ? (touch ? "Tap off the window to close" : "Esc or click off the window to close")
    : spot ? spot.hint
    : v.hint;
  ui.back.hidden = room === "outside";
  document.title = room === "outside" ? "Pierpont's apartment" : `${v.name} · Pierpont's apartment`;
};
const go = (to) => {
  if (flight || cv.active) return;
  if (!unlocked && room === "outside" && to !== "outside") return openPad(() => go(to)); // the door's locked: keypad first
  if (to === "screen") { if (room !== "theater") go("theater"); return latest?.link && window.open(latest.link, "_blank", "noopener"); }
  if (focusRow) return unfocus(() => go(to));
  if (winFocus) return closeWindowApp(() => go(to));
  if (nodeFocus) return closeNode(() => go(to));
  if (spot) return closeSpot(() => go(to));
  if (to === room) return;
  hideTip();
  const from = room, route = routeTo(from, to);
  const step = (i, cur) => {
    if (i >= route.length) return;
    const nxt = route[i];
    // the door slides up to let you through and shuts behind you (and locks, once you're back outside)
    const through = (cur === "outside" && nxt === "living") || (cur === "living" && nxt === "outside");
    const sd = !lite && (SIDE[nxt] || SIDE[cur]), sdKey = sd && (SIDE[nxt] ? nxt : cur);
    if (sd) { clearTimeout(sideT); sideShow(sdKey); sd.to = 1; if (SIDE[nxt]) loadMusicOnce(nxt); }
    const launch = () => fly(cur, nxt, () => { room = nxt; setRoomUI(); if (through) doorTo = 0; if (sd) { sd.to = 0; if (!SIDE[nxt]) sideT = setTimeout(() => { if (!SIDE[room]) sideShow(null); }, 700); } if (nxt === "outside") lockDoor(); if (nxt === "shelf" || cur === "shelf") hopCats(seatCats, nxt === "shelf"); step(i + 1, nxt); });
    if (through && doorOpen < 0.99) { doorTo = 1; setTimeout(launch, reduce ? 0 : 650); } else if (sd) setTimeout(launch, reduce ? 0 : 480); else launch();
  };
  ui.hint.textContent = "";
  step(0, from);
};
const loadMusicOnce = (k) => { if (k === "music") loadMusic(); };
const back = () => {
  if (cv.active) return cv.close();
  if (focusRow) return unfocus();
  if (winFocus) return closeWindowApp();
  if (nodeFocus) return closeNode();
  if (spot) return closeSpot();
  if (room !== "outside") go(PARENT[room]);
};
ui.back.addEventListener("click", back);
document.querySelectorAll(".h-nav [data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
addEventListener("keydown", (e) => {
  if (!pad.hidden) { // typing on the keypad
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") { entry = entry.slice(0, -1); showDots(); }
    else if (e.key === "Enter") { e.preventDefault(); press("enter"); }
    else if (e.key === "Escape") closePad();
    return;
  }
  if (!recipeDlg.hidden) { if (e.key === "Escape") closeRecipe(); return; }
  if (!listDlg.hidden) { if (e.key === "Escape") closeList(); return; }
  if (!photos.hidden) { if (e.key === "Escape") closePhotos(); else if (e.key === "ArrowLeft") showPhoto(albumAt - 1); else if (e.key === "ArrowRight") showPhoto(albumAt + 1); return; }
  if (!libDlg.hidden) { if (e.key === "Escape") closeLibrary(); return; }
  if (!ask.hidden) { if (e.key === "Escape") closeAsk(); return; }
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
const bar = (x, bx, by, bw, frac, col) => { x.fillStyle = "rgba(157,157,192,.25)"; x.fillRect(bx, by, bw, 8); x.fillStyle = col; x.shadowColor = col; x.shadowBlur = 12; x.fillRect(bx, by, bw * Math.max(0, Math.min(1, frac)), 8); x.shadowBlur = 0; };
// Live weather (Open-Meteo: free, no key, and it allows the browser to ask directly) and headlines
// (an RSS feed, fetched hourly by the GitHub Action into data/feeds.json, since news sites block browsers).
let WEATHER = null, weatherErr = false, NEWS = null;
const WMO = (c, day) => // Open-Meteo's weather codes, to words and one of our icons
  c === 0 ? ["Clear", day ? "sun" : "moon"] : c === 1 ? ["Mostly clear", day ? "partly" : "moon"] : c === 2 ? ["Partly cloudy", day ? "partly" : "cloud"] : c === 3 ? ["Overcast", "cloud"]
  : c === 45 || c === 48 ? ["Fog", "fog"] : c >= 51 && c <= 57 ? ["Drizzle", "rain"] : c >= 61 && c <= 67 ? [c === 61 ? "Light rain" : c === 65 ? "Heavy rain" : "Rain", "rain"]
  : (c >= 71 && c <= 77) || c === 85 || c === 86 ? ["Snow", "snow"] : c >= 80 && c <= 82 ? ["Showers", "rain"] : c >= 95 ? ["Thunderstorms", "storm"] : ["—", "cloud"];
const hourLabel = (t) => { const h = +t.slice(11, 13); return h === 0 ? "12 AM" : h === 12 ? "NOON" : `${h % 12} ${h < 12 ? "AM" : "PM"}`; };
const clockLabel = (t) => { const h = +t.slice(11, 13), m = t.slice(14, 16); return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`; };
const loadWeather = () => {
  const { lat = 38.9072, lon = -77.0369 } = S.coords || {};
  const q = new URLSearchParams({ latitude: lat, longitude: lon, current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    hourly: "temperature_2m,weather_code,is_day", daily: "temperature_2m_max,temperature_2m_min,sunset", temperature_unit: "fahrenheit", wind_speed_unit: "mph", timezone: tz, forecast_days: 2 });
  return fetch(`https://api.open-meteo.com/v1/forecast?${q}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => {
    const c = d.current, h = d.hourly, at = Math.max(0, h.time.findIndex((t) => t >= `${c.time.slice(0, 13)}:00`));
    const [cond, icon] = WMO(c.weather_code, c.is_day);
    const hours = [["NOW", icon, Math.round(c.temperature_2m)]];
    for (let k = 3; hours.length < 6 && at + k < h.time.length; k += 3) hours.push([hourLabel(h.time[at + k]), WMO(h.weather_code[at + k], h.is_day[at + k])[1], Math.round(h.temperature_2m[at + k])]);
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    WEATHER = { now: Math.round(c.temperature_2m), cond, icon, hi: Math.round(d.daily.temperature_2m_max[0]), lo: Math.round(d.daily.temperature_2m_min[0]),
      wind: `${Math.round(c.wind_speed_10m)} MPH ${dirs[Math.round(c.wind_direction_10m / 45) % 8]}`, humidity: `${c.relative_humidity_2m}%`, sunset: clockLabel(d.daily.sunset[0]), hours };
    weatherErr = false; drawWindow();
  }).catch((e) => { weatherErr = !WEATHER; console.warn("weather:", e.message); drawWindow(); });
};
const agoText = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return !iso ? "" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };
const weatherIcon = (x, type, cx, cy, sc) => {
  const sun = (ox, oy, r) => { x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 20 * sc; x.beginPath(); x.arc(ox, oy, r, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
    x.strokeStyle = "#f9f002"; x.lineWidth = 6 * sc; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; x.beginPath(); x.moveTo(ox + Math.cos(a) * r * 1.35, oy + Math.sin(a) * r * 1.35); x.lineTo(ox + Math.cos(a) * r * 1.7, oy + Math.sin(a) * r * 1.7); x.stroke(); } };
  const cloud = (ox, oy, k) => { x.fillStyle = "#c9c4ea"; for (const [dx, dy, r] of [[-30, 8, 28], [0, -10, 36], [32, 6, 28], [0, 16, 30]]) { x.beginPath(); x.arc(ox + dx * k, oy + dy * k, r * k, 0, Math.PI * 2); x.fill(); } };
  if (type === "sun") sun(cx, cy, 34 * sc);
  if (type === "partly") { sun(cx + 22 * sc, cy - 18 * sc, 24 * sc); cloud(cx - 6 * sc, cy + 10 * sc, sc); }
  if (type === "cloud") cloud(cx, cy, sc);
  if (type === "moon") { // a crescent: the full disc minus an offset one, as a single shape
    const R = 30 * sc, r2 = 26 * sc, ox = 14 * sc, oy = -10 * sc;
    x.fillStyle = "#e8e4ff"; x.shadowColor = "#b98cff"; x.shadowBlur = 18 * sc;
    x.save(); x.beginPath(); x.rect(cx - R * 2, cy - R * 2, R * 4, R * 4); x.arc(cx + ox, cy + oy, r2, 0, Math.PI * 2); x.clip("evenodd"); // everywhere but the bite
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill(); x.restore(); x.shadowBlur = 0; }
  if (type === "snow") { cloud(cx, cy - 12 * sc, sc); x.fillStyle = "#f4f3ff"; for (const [dx, dy] of [[-24, 36], [0, 48], [24, 36]]) { x.beginPath(); x.arc(cx + dx * sc, cy + dy * sc, 5 * sc, 0, Math.PI * 2); x.fill(); } }
  if (type === "storm") { cloud(cx, cy - 12 * sc, sc); x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 14 * sc; x.beginPath(); x.moveTo(cx + 6 * sc, cy + 18 * sc); x.lineTo(cx - 12 * sc, cy + 44 * sc); x.lineTo(cx, cy + 44 * sc); x.lineTo(cx - 8 * sc, cy + 64 * sc); x.lineTo(cx + 16 * sc, cy + 36 * sc); x.lineTo(cx + 4 * sc, cy + 36 * sc); x.closePath(); x.fill(); x.shadowBlur = 0; }
  if (type === "fog") { x.strokeStyle = "#c9c4ea"; x.lineWidth = 7 * sc; x.lineCap = "round"; for (const [dy, w] of [[-18, 40], [0, 52], [18, 36]]) { x.beginPath(); x.moveTo(cx - w * sc, cy + dy * sc); x.lineTo(cx + w * sc, cy + dy * sc); x.stroke(); } x.lineCap = "butt"; }
  if (type === "rain") { cloud(cx, cy - 12 * sc, sc); x.strokeStyle = "#05d9e8"; x.lineWidth = 5 * sc; x.lineCap = "round"; for (const dx of [-28, -4, 20]) { x.beginPath(); x.moveTo(cx + dx * sc, cy + 30 * sc); x.lineTo(cx + (dx - 8) * sc, cy + 56 * sc); x.stroke(); } x.lineCap = "butt"; }
};
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
    // 1 · local time, with the current block under it
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
    label("BITCOIN BLOCK", a1, T + 452);
    x.font = "500 78px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 20; x.fillText(height ? height.toLocaleString() : "…", a1 - 2, T + 484); x.shadowBlur = 0;
    const dayFrac = (hh * 3600 + mm * 60 + ss) / 86400;
    label(`TODAY · ${Math.round(dayFrac * 100)}% DONE`, a1, T + 600); bar(x, a1, T + 638, 580, dayFrac, "#ff2a6d");
    label(`TIME ZONE · ${tz.replace(/_/g, " ").toUpperCase()}`, a1, T + 672);
    // 2 · today's weather, live
    const a2 = L + 705;
    label(`>> WEATHER · ${(S.location || "DC").toUpperCase()}`, a2, T + 104);
    if (!WEATHER) { x.font = "600 40px Inter"; x.fillStyle = "#d6d6e7"; x.fillText(weatherErr ? "Weather's offline right now" : "Checking the sky…", a2, T + 200); }
    else {
    weatherIcon(x, WEATHER.icon, a2 + 95, T + 235, 1.5);
    x.font = "700 170px Rajdhani"; x.fillStyle = "#f4f3ff"; x.fillText(`${WEATHER.now}°`, a2 + 215, T + 140);
    x.font = "600 40px Inter"; x.fillStyle = "#d6d6e7"; x.fillText(WEATHER.cond, a2, T + 330);
    x.font = "500 30px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.fillText(`H ${WEATHER.hi}°  ·  L ${WEATHER.lo}°`, a2 + 360, T + 336);
    WEATHER.hours.forEach(([t, ic, deg], i) => {
      const hx = a2 + i * 100;
      x.fillStyle = "rgba(157,157,192,.12)"; x.fillRect(hx, T + 400, 90, 170);
      x.font = "500 22px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.textAlign = "center"; x.fillText(t, hx + 45, T + 412);
      weatherIcon(x, ic, hx + 45, T + 480, 0.55);
      x.font = "600 32px Inter"; x.fillStyle = "#f4f3ff"; x.fillText(`${deg}°`, hx + 45, T + 525); x.textAlign = "left";
    });
    label(`WIND ${WEATHER.wind}  ·  HUMIDITY ${WEATHER.humidity}`, a2, T + 590);
    label(`SUNSET ${WEATHER.sunset}  ·  OPEN-METEO`, a2, T + 628);
    }
    // 3 · headlines, live from the hourly feed job; each one opens its story
    const a3 = L + 1355, w3 = APP.w - 1355 - 40;
    label(`>> HEADLINES${NEWS?.source ? ` · ${NEWS.source.toUpperCase()}` : ""}`, a3, T + 104);
    let ny = T + 150;
    if (!NEWS?.items?.length) { x.font = "600 29px Inter"; x.fillStyle = "#d6d6e7"; x.fillText(NEWS ? "No headlines right now" : "Loading headlines…", a3, ny); }
    for (const it of NEWS?.items || []) {
      x.font = "600 29px Inter";
      const lines = wrap(x, it.title, w3, 2), h = lines.length * 34 + 4 + 38;
      if (ny + h > T + APP.h - 10) break; // only as many as fit
      x.fillStyle = "#f4f3ff"; lines.forEach((l, n) => x.fillText(l, a3, ny + n * 34));
      x.font = "500 20px 'JetBrains Mono'"; x.fillStyle = "#05d9e8"; x.fillText([NEWS.source.toUpperCase(), agoText(it.published)].filter(Boolean).join(" · ") + (it.link ? "  ↗" : ""), a3, ny + lines.length * 34 + 4);
      if (it.link) tileRects.push({ x: a3, y: ny - 6, w: w3, h: h - 8, url: it.link });
      ny += h;
      x.fillStyle = "rgba(157,157,192,.2)"; x.fillRect(a3, ny - 16, w3, 2);
    }
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

// ---------- the door keypad: the apartment is private for now ----------
// Only a hash of the code is in the page. (A code checked in the browser keeps casual visitors out;
// it isn't real security.) Once in, it stays unlocked for the rest of the browser session.
const PASS_HASH = "09b51bb1c30fc4f572cf45ead15e8da7a27ca2212225899c46237fd1d0af0671";
let unlocked = false, keypadLed = null; // locked on every visit
const lockDoor = () => { unlocked = false; keypadLed?.material.color.copy(new THREE.Color(0xff3b5c).multiplyScalar(2.2)); };
const pad = $("#h-pad"), padBox = pad.querySelector(".h-pad-box"), padDots = [...pad.querySelectorAll(".pad-dots i")], padMsg = $("#pad-msg");
let entry = "", padAfter = null, checking = false;
// SHA-256. Browsers only offer crypto.subtle on HTTPS or localhost, so on a plain-http address (testing
// from a phone over Wi-Fi) a small hand-written version does the same job.
const sha256js = (t) => {
  const K = [], H = [], isP = (n) => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
  for (let n = 2, i = 0; i < 64; n++) if (isP(n)) { if (i < 8) H[i] = (Math.pow(n, 1 / 2) * 2 ** 32) | 0; K[i++] = (Math.pow(n, 1 / 3) * 2 ** 32) | 0; }
  const m = [...new TextEncoder().encode(t)], l = m.length * 8; m.push(0x80); while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i > 3 ? 0 : (l >>> (i * 8)) & 255);
  const r = (x, n) => (x >>> n) | (x << (32 - n)), w = new Array(64);
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7] + (r(b, 17) ^ r(b, 19) ^ (b >>> 10))) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
};
const sha256 = async (t) => crypto.subtle
  ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("")
  : sha256js(t);
const showDots = () => padDots.forEach((d, i) => d.classList.toggle("on", i < entry.length));
const openPad = (after) => {
  padAfter = after; entry = ""; showDots(); padMsg.textContent = "Residents and guests only";
  pad.className = "h-pad"; pad.hidden = false; hideTip();
  if (!reduce) { // pop out of the pin pad on the door
    const q = V(0.52, 1.15, 0.07).project(camera), r = canvas.getBoundingClientRect(), b = padBox.getBoundingClientRect();
    const px = r.left + ((q.x + 1) / 2) * r.width, py = r.top + ((1 - q.y) / 2) * r.height;
    padBox.classList.remove("pop"); padBox.style.transform = `translate(${px - (b.left + b.width / 2)}px, ${py - (b.top + b.height / 2)}px) scale(0.06)`;
    padBox.getBoundingClientRect(); padBox.classList.add("pop"); padBox.style.transform = "";
  }
  pad.querySelector('[data-k="1"]').focus({ preventScroll: true });
};
const closePad = () => { pad.hidden = true; padAfter = null; };
const checkCode = async () => {
  if (checking) return; checking = true;
  const ok = (await sha256(`pierpont-4b:${entry}`)) === PASS_HASH;
  if (ok) {
    unlocked = true;
    pad.classList.add("granted"); padMsg.textContent = "ACCESS GRANTED";
    keypadLed?.material.color.copy(new THREE.Color(0x2bff88).multiplyScalar(2.2));
    setTimeout(() => { const a = padAfter; closePad(); checking = false; a?.(); }, 650);
  } else {
    pad.classList.remove("denied"); void pad.offsetWidth; pad.classList.add("denied"); padMsg.textContent = "ACCESS DENIED";
    setTimeout(() => { entry = ""; showDots(); checking = false; }, 400);
  }
};
const press = (k) => {
  if (checking) return;
  if (k === "cancel") return closePad();
  if (k === "clear") { entry = ""; showDots(); return; }
  if (k === "enter") return checkCode();
  if (entry.length < 4) { entry += k; showDots(); pad.classList.remove("denied"); if (entry.length === 4) checkCode(); }
};
pad.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => press(b.dataset.k)));
pad.addEventListener("click", (e) => { if (e.target === pad) closePad(); });

// ---------- the node station: my Bitcoin node projects mempool.space onto the wall ----------
// Click the rack and the camera walks over; a hologram beams out of the rack onto the wall under the
// STACK SATS sign (between the rack and the aquarium), floor to sign: block height, the latest blocks,
// price, fees, the halving and the next difficulty adjustment, and my miners. The canvas is 1500 × 2000.
const HOLO_C = V(-5.66, 0.88, -4.7), HOLO_H = 2000;
// my miners (entered by hand for now): six of them, 50 TH/s between them
const MINERS = [["MINER 01", 9.2, 61, "21d 4h"], ["MINER 02", 8.4, 58, "21d 4h"], ["MINER 03", 8.9, 63, "14d 9h"], ["MINER 04", 7.6, 57, "9d 2h"], ["MINER 05", 8.1, 60, "9d 2h"], ["MINER 06", 7.8, 59, "3d 17h"]]
  .map(([name, th, temp, up]) => ({ name, th, temp, up, hist: Array.from({ length: 24 }, () => th) }));
let holo = null, holoCanvas, holoTex, holoK = 0, holoAnim = null, nodeFocus = null, nodeTimers = [];
const holoTiles = [];
const buildHolo = () => {
  holoCanvas = document.createElement("canvas"); holoCanvas.width = 1500; holoCanvas.height = HOLO_H;
  holoTex = new THREE.CanvasTexture(holoCanvas); holoTex.colorSpace = THREE.SRGBColorSpace; holoTex.anisotropy = 8;
  const g = new THREE.Group(); g.position.copy(HOLO_C); g.rotation.y = Math.PI / 2; scene.add(g);
  const W = 1.26, Hh = 1.68; // from the floor up to just under the sign
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), new THREE.MeshBasicMaterial({ map: holoTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, color: new THREE.Color(0.86, 0.86, 0.86), side: THREE.DoubleSide }));
  g.add(plane);
  // the beam: a faint pyramid of light from the node's lens to the panel's corners
  g.updateMatrixWorld(true);
  const lensW = V(-5.4, 1.47, -3.72), lens = g.worldToLocal(lensW.clone());
  const cs = [V(-W / 2, -Hh / 2, 0), V(W / 2, -Hh / 2, 0), V(W / 2, Hh / 2, 0), V(-W / 2, Hh / 2, 0)], pos = [];
  for (let i = 0; i < 4; i++) { const a = cs[i], b = cs[(i + 1) % 4]; pos.push(lens.x, lens.y, lens.z, a.x, a.y, a.z, b.x, b.y, b.z); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0x05d9e8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  g.add(beam);
  const lensDot = ball(0.03, 0x05d9e8, lensW.x, lensW.y, lensW.z); lensDot.material = glowMat(0x05d9e8, 1.6);
  beam.raycast = () => {};
  holo = { g, plane, beam };
  g.visible = false;
};
const applyHolo = (now) => {
  if (!holo) return;
  holo.g.visible = holoK > 0.002;
  holo.g.scale.set(Math.min(1, holoK * 1.6), Math.max(0.02, holoK), 1); // it widens, then unfolds upward
  const flick = holoK >= 1 && Math.sin(now / 70) > 0.985 ? 0.65 : 1;
  holo.plane.material.opacity = 0.95 * holoK * flick; holo.beam.material.opacity = 0.1 * holoK;
};
const drawHolo = () => {
  if (!holoCanvas) return;
  const x = holoCanvas.getContext("2d"), W = 1500, Hh = HOLO_H;
  x.clearRect(0, 0, W, Hh);
  const g = x.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, "rgba(5,40,60,.55)"); g.addColorStop(1, "rgba(10,10,40,.65)"); x.fillStyle = g; x.fillRect(0, 0, W, Hh);
  x.strokeStyle = "#05d9e8"; x.lineWidth = 5; x.shadowColor = "#05d9e8"; x.shadowBlur = 18; x.strokeRect(10, 10, W - 20, Hh - 20); x.shadowBlur = 0;
  x.textBaseline = "top"; x.textAlign = "left";
  const label = (t, px, py) => { x.font = "500 28px 'JetBrains Mono'"; x.fillStyle = "#9fdfe8"; x.fillText(t, px, py); };
  const stat = (k, v, px, py) => { label(k, px, py); x.font = "600 40px Inter"; x.fillStyle = "#f4f3ff"; x.fillText(v, px, py + 36); };
  label(">> MY NODE · MEMPOOL.SPACE", 50, 40);
  x.fillStyle = "#2bff88"; x.beginPath(); x.arc(560, 55, 8, 0, Math.PI * 2); x.fill(); label("SYNCED", 578, 40);
  x.fillStyle = "rgba(5,217,232,.35)"; x.fillRect(40, 90, W - 80, 2); x.fillRect(760, 120, 2, 800);
  // left: the chain
  label("BLOCK HEIGHT", 50, 120);
  x.font = "500 120px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 22; x.fillText(height ? height.toLocaleString() : "…", 46, 158); x.shadowBlur = 0;
  x.font = "500 36px Inter"; x.fillStyle = "#d6d6e7"; x.fillText(btc.tip ? `Last block found ${since(btc.tip)}` : "Checking the chain…", 50, 300);
  holoTiles.length = 0;
  btc.blocks.forEach((b, i) => {
    const tx = 50 + (i % 3) * 228, ty = 370 + Math.floor(i / 3) * 200, w = 210, h = 180;
    const tg = x.createLinearGradient(tx, ty, tx + w, ty + h);
    if (i) { tg.addColorStop(0, "rgba(91,47,176,.9)"); tg.addColorStop(1, "rgba(42,21,99,.9)"); } else { tg.addColorStop(0, "rgba(184,166,10,.9)"); tg.addColorStop(1, "rgba(107,94,0,.9)"); }
    x.fillStyle = tg; x.fillRect(tx, ty, w, h);
    x.strokeStyle = i ? "rgba(185,140,255,.7)" : "#f9f002"; x.lineWidth = 3; x.strokeRect(tx, ty, w, h);
    x.font = "600 34px 'JetBrains Mono'"; x.fillStyle = "#f4f3ff"; x.fillText(b.height.toLocaleString(), tx + 16, ty + 16);
    x.font = "400 27px Inter"; x.fillStyle = "rgba(244,243,255,.88)";
    x.fillText(`${b.tx_count.toLocaleString()} txs`, tx + 16, ty + 70); x.fillText(`${(b.size / 1e6).toFixed(2)} MB`, tx + 16, ty + 104); x.fillText(since(b.timestamp), tx + 16, ty + 138);
    holoTiles.push({ x: tx, y: ty, w, h, height: b.height });
  });
  label(touch ? "TAP A BLOCK TO OPEN IT ↗" : "CLICK A BLOCK TO OPEN IT ON MEMPOOL.SPACE ↗", 50, 920);
  // right: money and the slow clocks
  const a = 800, w3 = 650;
  label("PRICE", a, 120);
  x.font = "700 112px Rajdhani"; x.fillStyle = "#f4f3ff"; x.fillText(btc.price ? money(btc.price) : "…", a, 150);
  if (btc.price && btc.dayAgo) { const pct = ((btc.price - btc.dayAgo) / btc.dayAgo) * 100; x.font = "500 32px 'JetBrains Mono'"; x.fillStyle = pct >= 0 ? "#05d9e8" : "#ff6b95"; x.fillText(`${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% TODAY`, a, 272); }
  if (btc.spark.length > 1) {
    const lo = Math.min(...btc.spark), hi = Math.max(...btc.spark), sy = 330, sh = 110;
    x.beginPath(); btc.spark.forEach((v, i) => { const px = a + (i / (btc.spark.length - 1)) * w3, py = sy + sh - ((v - lo) / (hi - lo || 1)) * sh; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.strokeStyle = "#f9f002"; x.lineWidth = 5; x.shadowColor = "#f9f002"; x.shadowBlur = 12; x.stroke(); x.shadowBlur = 0;
    label("LAST 7 DAYS", a, sy + sh + 14);
  }
  stat("SATS PER DOLLAR", btc.sats ? btc.sats.toLocaleString() : "…", a, 500);
  stat("FEES, NEXT BLOCK", btc.fee ? `${btc.fee} sat/vB` : "…", a + 340, 500);
  if (btc.halv) { stat("NEXT HALVING", `~${btc.halv.eta} · ${btc.halv.left.toLocaleString()} blocks`, a, 610); bar(x, a, 700, w3, btc.halv.pct, "#f9f002"); }
  if (btc.diff) { const d = btc.diff; stat("DIFFICULTY ADJUSTMENT", `${d.difficultyChange >= 0 ? "+" : ""}${d.difficultyChange.toFixed(1)}% · ${d.remainingBlocks.toLocaleString()} blocks`, a, 740); bar(x, a, 830, w3, d.progressPercent / 100, "#05d9e8"); }
  // bottom: my miners, each wobbling a little around its rate like live readings
  x.fillStyle = "rgba(5,217,232,.35)"; x.fillRect(40, 990, W - 80, 2);
  const t = performance.now() / 1000;
  // each one wobbles, but the wobbles cancel out, so the total holds at 50 TH/s
  const wob = MINERS.map((m, i) => Math.sin(t * 0.9 + i * 1.7) * 0.18 + Math.sin(t * 2.3 + i) * 0.07), avg = wob.reduce((a2, b) => a2 + b, 0) / wob.length;
  MINERS.forEach((m, i) => { m.now = m.th + wob[i] - avg; m.hist.push(m.now); m.hist.shift(); });
  const total = MINERS.reduce((n, m) => n + m.now, 0);
  label(">> MINERS", 50, 1025);
  x.fillStyle = "#2bff88"; x.beginPath(); x.arc(280, 1040, 8, 0, Math.PI * 2); x.fill(); label(`${MINERS.length} ONLINE`, 298, 1025);
  label("TOTAL HASHRATE", 50, 1085);
  x.font = "500 120px 'JetBrains Mono'"; x.fillStyle = "#f9f002"; x.shadowColor = "#f9f002"; x.shadowBlur = 22; x.fillText(total.toFixed(1), 46, 1122); x.shadowBlur = 0;
  const tw = x.measureText(total.toFixed(1)).width; x.font = "700 56px Rajdhani"; x.fillStyle = "#f4f3ff"; x.fillText("TH/s", 66 + tw, 1172);
  MINERS.forEach((m, i) => {
    const cx = 50 + (i % 2) * 715, cy = 1290 + Math.floor(i / 2) * 230, cw = 685, ch = 210;
    x.fillStyle = "rgba(10,20,50,.6)"; x.fillRect(cx, cy, cw, ch); x.strokeStyle = "rgba(5,217,232,.55)"; x.lineWidth = 2; x.strokeRect(cx, cy, cw, ch);
    x.fillStyle = "#2bff88"; x.beginPath(); x.arc(cx + 26, cy + 32, 8, 0, Math.PI * 2); x.fill();
    x.font = "600 32px 'JetBrains Mono'"; x.fillStyle = "#d6d6e7"; x.fillText(m.name, cx + 46, cy + 16);
    x.font = "700 78px Rajdhani"; x.fillStyle = "#f4f3ff"; x.fillText(m.now.toFixed(1), cx + 22, cy + 66);
    const vw = x.measureText(m.now.toFixed(1)).width; x.font = "600 34px Rajdhani"; x.fillStyle = "#9fdfe8"; x.fillText("TH/s", cx + 30 + vw, cy + 104);
    x.font = "500 26px 'JetBrains Mono'"; x.fillStyle = "#9d9dc0"; x.fillText(`${m.temp}°C · UP ${m.up}`, cx + 24, cy + 160);
    // a little bar graph of its last readings
    const gx = cx + 370, gy = cy + 40, gw = 290, gh = 130, lo = m.th - 0.5, hi = m.th + 0.5;
    m.hist.forEach((v, k) => { const bh = Math.max(4, ((v - lo) / (hi - lo)) * gh); x.fillStyle = k === m.hist.length - 1 ? "#f9f002" : "rgba(5,217,232,.7)"; x.fillRect(gx + k * (gw / m.hist.length), gy + gh - bh, gw / m.hist.length - 3, bh); });
  });
  for (let y = 0; y < Hh; y += 5) { x.fillStyle = "rgba(255,255,255,.035)"; x.fillRect(0, y, W, 2); } // scanlines
  holoTex.needsUpdate = true;
};
const openNode = () => {
  if (nodeFocus || flight) return;
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
  // frame the whole station: the rack, the beam, the projection and the sign above it
  const look = V(-5.66, 1.08, -4.65), d = Math.min(4.4, Math.max(1.22 / Math.tan(vf), 0.85 / Math.tan(hf)));
  nodeFocus = { view: { pos: look.clone().add(V(d, 0.1, 0)), look } };
  hideTip(); setRoomUI();
  flyTo(nodeFocus.view.pos, nodeFocus.view.look, 1100);
  holoAnim = { t0: performance.now() + (reduce ? 0 : 450), from: holoK, to: 1 };
  drawHolo();
  liveBlocks().then(drawHolo).then(trend).then(drawHolo).catch((e) => console.warn("mempool:", e.message));
  nodeTimers = [setInterval(drawHolo, 1000), setInterval(() => liveBlocks().then(drawHolo).catch(() => {}), 20000)];
};
const closeNode = (after) => {
  if (!nodeFocus) return after?.();
  nodeFocus = null; nodeTimers.forEach(clearInterval); hideTip(); setRoomUI();
  holoAnim = { t0: performance.now(), from: holoK, to: 0 };
  flyTo(VIEWS.living.pos, VIEWS.living.look, 1000, after);
};
// ---------- close-ups: walk up to something, then click it again to do something with it (the cats, the chess table) ----------
let spot = null; // { name, g, view, hint, tip }
const openSpot = (g, name, view, { hint, tip, hover, click, onClose, self, only }) => {
  if (spot || nodeFocus || flight) return;
  spot = { name, g, view, hint, tip, hover, click, onClose, self, only }; hideTip(); setRoomUI(); // only: which things can be clicked from here (the rest are looked through)
  flyTo(view.pos, view.look, 1100);
};
const closeSpot = (after) => {
  if (!spot) return after?.();
  spot.onClose?.(); spot = null; hideTip(); setRoomUI();
  flyTo(VIEWS[room].pos, VIEWS[room].look, 1000, after);
};
const tapWord = touch ? "Tap" : "Click";
// the cats: tiptoe up to one, and you're offered pictures instead of a pet
const openCat = (g, name) => {
  const c = new THREE.Vector3(); g.getWorldPosition(c);
  // a little in front and above, so you look down at them curled up (closer for a smaller cat)
  const k = g.scale.x;
  openSpot(g, name, { pos: c.clone().add(V(0.35, 0.45, 1.13).multiplyScalar(k)), look: c.clone().add(V(0, 0.12 * k, 0)) },
    { hint: `${tapWord} ${name} again · ${tapWord.toLowerCase()} away to step back`, self: true, only: (o) => o === g || !!o.userData.fromCat,
      // from beside a cat you can also head for the other cat, the kitchen, or the gallery and theater doorways
      hover: (h) => (h?.obj === g ? { label: name, sub: `${tapWord} to say hi` } : h?.obj.userData.fromCat ? h : null),
      click: (h) => {
        if (h?.obj === g) return h.act();
        if (!h?.obj.userData.fromCat) return closeSpot();
        if (h.obj.userData.fromCat === "spot") { spot.onClose?.(); spot = null; return h.act(); } // the kitchen or the other cat: straight over, no stepping back first
        h.act(); // a doorway: go() steps back from the cat, then walks
      } });
};
// the couch: sit down facing the window. The cats hop over and sit on your right; the window opens the clock app.
const hopCats = (list, on) => list.forEach(([nap, sitter], i) => {
  const t0 = performance.now() + (on ? 650 + i * 260 : i * 120);
  if (reduce) { nap.visible = !on; sitter.visible = on; return; }
  nap.userData.hop = { t0, show: !on }; sitter.userData.hop = { t0: t0 + 200, show: on }; shadowDirty = t0 + 1600;
  if (on) sitter.visible = false; else nap.visible = false;
});
const sitDown = (g) => {
  openSpot(g, "Couch", { pos: V(-0.75, 1.2, -4.62), look: V(-0.95, 1.65, -7) }, { // left of centre, so the coffee table hologram isn't in the middle of the view
    hint: `${tapWord} the window, the projector or the book · ${tapWord.toLowerCase()} anywhere else to get up`,
    // from the couch you can reach the window (clock app), the cats beside you, and what's on the coffee table
    hover: (h) => (h?.obj === windowGlass ? { label: "DC at night", sub: `${tapWord} for the clock app` } : h?.obj.userData.fromCouch ? h : null),
    click: (h) => (h?.obj === windowGlass ? openWindowApp() : h?.obj.userData.fromCouch ? h.act() : closeSpot()),
    onClose: () => hopCats(couchCats, false),
  });
  if (spot?.g === g) hopCats(couchCats, true);
};
const askSitCat = (name) => {
  const list = [...APT_CAT_PHOTOS, ...(S.photos || [])].filter((p) => p.src && (p.cats || []).includes(name.toLowerCase()));
  if (list.length) openAsk(`${name}'s keeping you company. Want to see some pictures?`, () => openPhotos(name, list));
};
// the kitchen: step in between the bar and the counter, facing the recipe. Finn wanders over and sits by the fridge.
const openKitchen = (g) => {
  openSpot(g, "Kitchen", { pos: V(3.15, 1.62, -1.85), look: V(3.95, 1.3, -0.2) }, {
    hint: `${tapWord} the recipe or Finn · ${tapWord.toLowerCase()} anywhere else to step out`,
    hover: (h) => (h?.obj.userData.fromKitchen ? h : null),
    click: (h) => (h?.obj.userData.fromKitchen ? h.act() : closeSpot()),
    onClose: () => hopCats(kitchenCats, false),
  });
  if (spot?.g === g) hopCats(kitchenCats, true);
};
// a list's top 5, from its poster in the theater
const listDlg = $("#h-list");
const openList = (l) => {
  $("#ls-title").textContent = `>> ${l.title.toUpperCase()} // TOP 5`;
  $("#ls-meta").textContent = `${l.count} films · my Letterboxd list`;
  const ol = $("#ls-top"); ol.replaceChildren(...l.top.map((f) => { const li = document.createElement("li"), a = document.createElement("a");
    a.href = f.link; a.target = "_blank"; a.rel = "noopener"; a.textContent = f.title; li.append(a);
    if (f.year) { const y = document.createElement("span"); y.textContent = ` ${f.year}`; li.append(y); } return li; }));
  const all = $("#ls-all"); all.href = l.link; all.textContent = `See all ${l.count} on Letterboxd ↗`;
  listDlg.hidden = false; hideTip(); all.focus({ preventScroll: true });
};
const closeList = () => { listDlg.hidden = true; };
listDlg.addEventListener("click", (e) => { if (e.target === listDlg || e.target.closest("[data-l=close]")) closeList(); });
// the full recipe, from the screen on the backsplash
const recipeDlg = $("#h-recipe");
const openRecipe = () => { recipeDlg.hidden = false; hideTip(); recipeDlg.querySelector("[data-r=close]").focus({ preventScroll: true }); };
const closeRecipe = () => { recipeDlg.hidden = true; };
recipeDlg.addEventListener("click", (e) => { if (e.target === recipeDlg || e.target.closest("[data-r=close]")) closeRecipe(); });
// the chess table: walk over, then it asks if you want a game
const openChess = (g) => {
  const c = new THREE.Vector3(); g.getWorldPosition(c);
  openSpot(g, "Chess", { pos: c.clone().add(V(-1.15, 1.5, 0.42)), look: c.clone().add(V(0, 0.84, 0)) },
    { hint: `${tapWord} the board to play · ${tapWord.toLowerCase()} away to step back`, tip: { label: "Chess", sub: `${tapWord} to play me` } });
};
// Extra photos just for the apartment (not on the main site), plus any site photos tagged with `cats` in content.js.
const APT_CAT_PHOTOS = [
  { src: "images/apt-cats/phoebe-bed.jpg", caption: "Sharing the bed", cats: ["phoebe"] },
  { src: "images/apt-cats/fin-top-perch.jpg", caption: "Upside down on the top perch", cats: ["finn"] },
  { src: "images/apt-cats/phoebe-blanket.jpg", caption: "Blanket nest", cats: ["phoebe"] },
  { src: "images/apt-cats/one-asleep-one-on-guard.jpg", caption: "One asleep, one on guard", cats: ["finn", "phoebe"] },
  { src: "images/apt-cats/fin-fangs.jpg", caption: "Fangs out, fast asleep", cats: ["finn"] },
  { src: "images/apt-cats/tree-house.jpg", caption: "Tree house", cats: ["finn", "phoebe"] },
  { src: "images/apt-cats/phoebe-couch.jpg", caption: "Couch, claimed", cats: ["phoebe"] },
  { src: "images/apt-cats/dinner-is-late.jpg", caption: "Dinner is late", cats: ["finn", "phoebe"] },
  { src: "images/apt-cats/phoebe-lap.jpg", caption: "Lap check", cats: ["phoebe"] },
  { src: "images/apt-cats/fin-stretch.jpg", caption: "Full stretch", cats: ["finn"] },
  { src: "images/apt-cats/fin-night-eyes.jpg", caption: "Night eyes", cats: ["finn"] },
  { src: "images/apt-cats/fin-looking-up.jpg", caption: "Something's up there", cats: ["finn"] },
  { src: "images/apt-cats/nap-pile.jpg", caption: "Nap pile", cats: ["finn", "phoebe"] },
];
const ask = $("#h-ask"), photos = $("#h-photos");
let album = [], albumAt = 0, askYes = null;
// a little yes/no prompt
const openAsk = (text, onYes) => {
  $("#ask-text").textContent = text; askYes = onYes; ask.hidden = false; hideTip();
  ask.querySelector('[data-a="yes"]').focus({ preventScroll: true });
};
const askCat = () => {
  const name = spot.name;
  const list = [...APT_CAT_PHOTOS, ...(S.photos || [])].filter((p) => p.src && (p.cats || []).includes(name.toLowerCase()));
  if (!list.length) return toast(`Shh… ${name}'s napping.`);
  openAsk(`Let ${name} sleep. I can show you some pictures though.`, () => openPhotos(name, list));
};
// Yes opens a challenge to me on Chess.com (the visitor sends it from their own account)
const askChess = () => openAsk("Wanna play a game?", () => window.open(`https://www.chess.com/play/online/new?opponent=${encodeURIComponent(S.chess.username)}`, "_blank", "noopener"));
const closeAsk = () => { ask.hidden = true; };
const showPhoto = (i) => {
  albumAt = (i + album.length) % album.length; const p = album[albumAt];
  const img = $("#ph-img"); img.src = p.src; img.alt = p.caption || "";
  $("#ph-cap").textContent = [p.caption, p.date && new Date(`${p.date}T12:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ");
  $("#ph-count").textContent = `${albumAt + 1} / ${album.length}`;
  photos.querySelector(".ph-nav").hidden = album.length < 2;
};
const openPhotos = (name, list) => {
  album = list; $("#ph-title").textContent = `>> ${name.toUpperCase()} // PHOTOS`;
  showPhoto(0); photos.hidden = false; photos.querySelector('[data-p="close"]').focus({ preventScroll: true });
};
const closePhotos = () => { photos.hidden = true; };
// Every photo on the site: the ones in content.js plus every image posted on Nostr, newest first (the same wall as the main page).
// Nostr posts come from the relays and Primal's archive, and each is checked against my signature before it's used.
const fileKey = (src) => (src.match(/[0-9a-f]{64}/i)?.[0] || src).toLowerCase(); // media hosts name files by their SHA-256
let sitePhotos = (S.photos || []).filter((p) => p.src).map((p) => ({ ...p, ts: Date.parse((p.date || "1970-01-01") + "T12:00:00") }));
const primalPage = (pk, until) => new Promise((resolve) => {
  const ws = new WebSocket("wss://cache2.primal.net/v1"), sub = "apt" + Math.random().toString(36).slice(2, 8), out = [];
  const done = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(out); }, timer = setTimeout(done, 6000);
  ws.onopen = () => ws.send(JSON.stringify(["REQ", sub, { cache: ["feed", { pubkey: pk, notes: "authored", limit: 100, ...(until ? { until } : {}) }] }]));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d[1] !== sub) return; if (d[0] === "EVENT" && d[2]?.pubkey === pk) out.push(d[2]); if (d[0] === "EOSE") done(); };
  ws.onerror = () => done();
});
const loadNostrPhotos = async () => {
  const NT = window.NostrTools, N = S.nostr || {}; if (!NT || !N.npub) return;
  const pk = NT.nip19.decode(N.npub.trim()).data, relays = N.relays?.length ? N.relays : ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
  const fromPrimal = []; let until;
  for (let i = 0; i < 5; i++) { const page = await primalPage(pk, until); fromPrimal.push(...page); if (page.length < 100) break; until = Math.min(...page.map((e) => e.created_at)) - 1; }
  const fromRelays = await new NT.SimplePool().querySync(relays, { kinds: [1, 20], authors: [pk], limit: 100 }, { maxWait: 4000 }).catch(() => []);
  const since = N.photosSince ? Date.parse(N.photosSince + "T00:00:00") / 1000 : 0, seen = new Set(), IMG = /\.(jpe?g|png|gif|webp|avif)(\?|$)/i;
  const posts = fromRelays.concat(fromPrimal).filter((e) => (e.kind === 1 || e.kind === 20) && e.pubkey === pk && e.created_at >= since && !e.tags.some((t) => t[0] === "e") && !seen.has(e.id) && seen.add(e.id) && NT.verifyEvent(e));
  const found = posts.flatMap((ev) => {
    const imeta = ev.tags.filter((t) => t[0] === "imeta").map((t) => Object.fromEntries(t.slice(1).map((x) => [x.slice(0, x.indexOf(" ")), x.slice(x.indexOf(" ") + 1)])));
    const urls = new Set(imeta.filter((m) => m.url && (!m.m || m.m.startsWith("image/"))).map((m) => m.url));
    (ev.content.match(/https?:\/\/[^\s]+/g) || []).filter((u) => IMG.test(u)).forEach((u) => urls.add(u));
    const caption = ev.content.replace(/https?:\/\/\S+/g, "").replace(/nostr:\S+/g, "").trim().split("\n")[0].slice(0, 80);
    return [...urls].map((src) => ({ src, caption, date: new Date(ev.created_at * 1000).toISOString().slice(0, 10), ts: ev.created_at * 1000 }));
  });
  const known = new Set([...(N.hidePhotos || []), ...sitePhotos.map((p) => p.src)].map(fileKey));
  sitePhotos = sitePhotos.concat(found.filter((p) => { const k = fileKey(p.src); if (known.has(k)) return false; known.add(k); return true; })).sort((a, b) => b.ts - a.ts);
};
addEventListener("DOMContentLoaded", () => loadNostrPhotos().catch((e) => console.warn("nostr photos:", e)));
// the desk computer: a photo library of everything, by album; a thumbnail opens the viewer on top of it
const libDlg = $("#h-lib"); let libAt = 0; // when it opened: the click that opened it must not land on a thumbnail under the cursor
const openLibrary = () => {
  const albums = [["All photos", sitePhotos], ["Finn & Phoebe", APT_CAT_PHOTOS]].filter(([, l]) => l.length);
  const body = $("#lib-body"); body.replaceChildren();
  for (const [name, list] of albums) {
    const sec = document.createElement("section"), h = document.createElement("h3"), grid = document.createElement("div");
    h.textContent = `${name} · ${list.length}`; grid.className = "lib-grid";
    // (a thumbnail whose image fails to load is dropped: old Nostr images sometimes vanish from their hosts)
    list.forEach((p, i) => { const b = document.createElement("button"), im = document.createElement("img"); b.type = "button"; b.setAttribute("aria-label", p.caption || "Photo");
      im.src = p.src; im.alt = ""; im.loading = "lazy"; im.onerror = () => b.remove(); b.append(im); b.addEventListener("click", () => { if (performance.now() - libAt > 400) { openPhotos(name, list); showPhoto(i); } }); grid.append(b); });
    sec.append(h, grid); body.append(sec);
  }
  libDlg.hidden = false; libAt = performance.now(); hideTip(); libDlg.querySelector('[data-b="close"]').focus({ preventScroll: true });
};
const closeLibrary = () => { libDlg.hidden = true; };
libDlg.addEventListener("click", (e) => { if (performance.now() - libAt < 400) return; if (e.target === libDlg || e.target.closest("[data-b=close]")) closeLibrary(); });
ask.addEventListener("click", (e) => {
  const a = e.target.closest("[data-a]")?.dataset.a; if (!a && e.target !== ask) return;
  closeAsk(); if (a === "yes") askYes?.();
});
photos.addEventListener("click", (e) => {
  const p = e.target.closest("[data-p]")?.dataset.p;
  if (p === "prev") showPhoto(albumAt - 1); else if (p === "next") showPhoto(albumAt + 1); else if (p === "close" || e.target === photos) closePhotos();
});
// Which block tile on the projection is under the pointer?
const holoAt = (e) => {
  const hit = setRay(e).intersectObject(holo.plane, false)[0];
  if (!hit) return { off: true };
  const cx = hit.uv.x * 1500, cy = (1 - hit.uv.y) * HOLO_H;
  return { t: holoTiles.find((t) => cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) };
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
  focusRow = { f, view: { pos: start.clone().add(V(d, 0, 0)), look: start, ...(pan && { yaw: 0 }) }, c, pan, d };
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
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  // while you're sitting on the couch, the couch itself is out of the way (so the cats beside you can be clicked)
  const objs = hot.filter((h) => h.room === room && shown(h.obj) && !(spot?.click && !spot.self && h.obj === spot.g) && (!spot?.only || spot.only(h.obj))).map((h) => h.obj);
  for (const hit of ray.intersectObjects(objs, true)) {
    let o = hit.object; while (o && o.userData.hot === undefined) o = o.parent;
    if (o) return hot[o.userData.hot];
  }
  return null;
};
const setGlow = (h, on) => {
  const list = h.obj.userData.glow || [];
  h.obj.traverse((o) => { if (o.material?.emissive && o.material.visible !== false) o.material.emissive.setHex(on ? 0x2a0c22 : 0); });
  for (const s of list) s.material.color.setScalar(on ? s.userData.k * 1.5 : s.userData.k);
};
const hideTip = () => { ui.tip.hidden = true; if (hovered) setGlow(hovered, false); hovered = null; canvas.style.cursor = ""; showZone(null); };
const showTip = (e, h) => {
  ui.tip.innerHTML = `<strong>${esc(h.label)}</strong>${[].concat(h.sub).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}`; ui.tip.hidden = false;
  const tw = ui.tip.offsetWidth, th = ui.tip.offsetHeight;
  ui.tip.style.transform = `translate(${Math.min(e.clientX + 16, innerWidth - tw - 8)}px, ${Math.min(e.clientY + 16, innerHeight - th - 8)}px)`;
};
// turned round to face the way you came in: clicking anywhere that isn't something to click takes you back
const facingBack = () => !!PARENT[room] && Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw))) > 2.1;
const backTip = () => ({ label: `← Back to the ${VIEWS[PARENT[room]].name.toLowerCase()}`, sub: touch ? "Tap to go back" : "Click to go back" });
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
      const lim = view().yaw ?? Infinity;
      yaw += (e.clientX - down.lx) * 0.004;
      // a full turn wraps round, so walking on straightens up the short way
      yaw = lim === Infinity ? Math.atan2(Math.sin(yaw), Math.cos(yaw)) : THREE.MathUtils.clamp(yaw, -lim, lim);
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - down.ly) * 0.003, -0.3, 0.3);
      down.lx = e.clientX; down.ly = e.clientY;
      canvas.style.cursor = "grabbing";
    }
    return;
  }
  if (e.pointerType !== "mouse" || flight) return;
  if (nodeFocus) {
    const w = holoAt(e);
    if (w.t) { showTip(e, { label: `Block ${w.t.height.toLocaleString()}`, sub: "Open it on mempool.space ↗" }); canvas.style.cursor = "pointer"; }
    else { hideTip(); canvas.style.cursor = w.off ? "zoom-out" : "default"; }
    return;
  }
  if (winFocus) { const w = tileAt(e); if (w.t?.url) { showTip(e, { label: "Read on " + (NEWS?.source || "the web"), sub: "Opens in a new tab ↗" }); canvas.style.cursor = "pointer"; } else { hideTip(); canvas.style.cursor = w.off ? "zoom-out" : "default"; } return; }
  if (spot) {
    const h = pickAt(e), tip = spot.hover ? spot.hover(h) : h?.obj === spot.g ? spot.tip : null;
    if (tip) { showTip(e, tip); canvas.style.cursor = "pointer"; } else { hideTip(); canvas.style.cursor = "zoom-out"; }
    return;
  }
  if (room === "shelf") {
    const ch = !focusRow && pickAt(e); if (ch) { showTip(e, ch); canvas.style.cursor = "pointer"; return; } // a cat in a seat
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
  if (h) { showTip(e, h); canvas.style.cursor = "pointer"; } else if (facingBack()) { showTip(e, backTip()); canvas.style.cursor = "pointer"; } else { ui.tip.hidden = true; canvas.style.cursor = "grab"; }
});
canvas.addEventListener("pointerup", (e) => {
  const wasDrag = down?.drag; down = null; canvas.style.cursor = "";
  if (cv.active) { // the review on the back opens it; anywhere off the case puts it back
    cv.endDrag();
    if (!wasDrag) { if (!cv.hit(setRay(e))) cv.close(); else if (cv.reviewHit(ray)) cv.openReview(); }
    return;
  }
  if (wasDrag || flight) return;
  if (nodeFocus) {
    const w = holoAt(e);
    if (w.t) window.open(`https://mempool.space/block/${w.t.height}`, "_blank", "noopener");
    else if (w.off) closeNode(); // off the projection: step back
    return;
  }
  if (winFocus) { const w = tileAt(e); if (w.t?.url) window.open(w.t.url, "_blank", "noopener"); else if (w.off) closeWindowApp(); return; } // a headline opens its story; off the glass closes the app
  if (spot) { const h = pickAt(e); if (spot.click) spot.click(h); else h?.obj === spot.g ? h.act() : closeSpot(); return; } // off it: step back
  if (room === "shelf") {
    const ch = !focusRow && pickAt(e); if (ch) return ch.act(); // a cat in a seat
    const s = shelfPick(e);
    if (!s) return focusRow && unfocus(); // clicking off the shelf steps back from the row
    if (s.row) return focus(s.h.f);
    if (s.p.it.u) cv.open({ row: s.h.f.row, it: s.p.it, zone: s.p.zone, point: s.h.point });
    return;
  }
  const h = pickAt(e);
  if (h) { hideTip(); h.act(); } else if (facingBack()) { hideTip(); back(); }
});
canvas.addEventListener("pointerleave", hideTip);

// ---------- size, loop ----------
// Reflections: a small made-up room of neon strips and a city-blue window, blurred into an environment
// map, so glossy and metal surfaces pick up colour that belongs here (not a photo studio's white).
if (!lite) { const env = new THREE.Scene(), pm = new THREE.PMREMGenerator(renderer);
  env.add(new THREE.Mesh(new THREE.BoxGeometry(20, 8, 20), new THREE.MeshBasicMaterial({ color: 0x0b0918, side: THREE.BackSide })));
  const strip = (c, k, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) })); m.position.set(x, y, z); env.add(m); };
  strip(0x3a66ff, 1.6, 10, 3.5, 0.1, 0, 0.6, -9.9);   // the big window
  strip(0xff2a6d, 3, 0.2, 0.2, 18, -9.8, 3.6, 0);     // pink neon along one wall
  strip(0x05d9e8, 3, 0.2, 0.2, 18, 9.8, 3.6, 0);      // cyan along the other
  strip(0xffb070, 2.2, 3, 0.1, 3, 0, 3.95, 3);        // a warm ceiling light
  strip(0xc8d0ff, 1.2, 5, 0.1, 2, 0, 3.95, -3);       // a cool one
  scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose(); }
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: lite ? 0 : 4 })); // 4x MSAA on desktop: smooth edges through the post passes
composer.addPass(new RenderPass(scene, camera));
// ambient occlusion: the soft darkening where things meet (desktop only; phones keep their frame rate)
let gtao = null;
if (!lite) {
  gtao = new GTAOPass(scene, camera, 512, 512);
  gtao.updateGtaoMaterial({ radius: 1.0, distanceExponent: 1, thickness: 3, scale: 1.6, distanceFallOff: 1, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 1;
  // glowing and see-through things (neon, signs, screens) don't cast occlusion
  const ov = gtao.overrideVisibility.bind(gtao);
  gtao.overrideVisibility = () => { ov(); scene.traverse((o) => { const m = o.material; if (o.isMesh && o.visible && m && (m.transparent || m.toneMapped === false || m.isMeshBasicMaterial || o.userData.noAO)) { gtao._visibilityCache.set(o, o.visible); o.visible = false; } }); };
  composer.addPass(gtao);
}
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Desktop finish: what a camera adds. A soft vignette, a hint of colour fringing towards the corners,
// and fine film grain (still, under reduced motion).
const lens = lite ? null : new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * r2 * 0.012;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, smoothstep(0.85, 0.15, r2 * 1.6), 0.55);
      c += (hash(vUv * vec2(1920.0, 1080.0) + time) - 0.5) * 0.035;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
if (lens) composer.addPass(lens);
const resize = () => {
  const w = innerWidth, h = innerHeight;
  const pr = lite ? basePR() : Math.max(0.6, basePR() * quality); renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
  renderer.setSize(w, h, false); composer.setSize(w, h); gtao?.setSize(Math.round(w * pr / 2), Math.round(h * pr / 2)); /* AO at half the drawing resolution: it's soft anyway */
  bloom.resolution.set(w / (lite ? 4 : 2), h / (lite ? 4 : 2));
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
let doorT = 0;
const frame = (now) => {
  // the door eases open or shut, at the same speed whatever the frame rate
  const ddt = Math.min(100, now - (doorT || now)); doorT = now;
  doorOpen += (doorTo - doorOpen) * (reduce ? 1 : 1 - Math.exp(-ddt / 170));
  doorPivot.position.y = doorOpen * 2.44; // slides up out of sight, behind the header and above the ceiling
  if (flight) {
    const k = Math.max(0, Math.min(1, (now - flight.t0) / flight.dur)), s = ease(k); // a frame's timestamp can predate the click that started this
    yaw = flight.yaw0 * (1 - s); pitch = flight.pitch0 * (1 - s);
    aim(flight.pos.getPoint(s), flight.look.getPoint(s), yaw, pitch);
    if (k === 1) { const a = flight.after; flight = null; shadowDirty = now + 100; if (frame.q) { frame.q.settle = now + 2000; frame.q.t0 = now; frame.q.n = 0; } a?.(); }
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
  if (envCube && !flight && room !== envRoom && now > (frame.envT || 0)) { useRoomEnv(room); frame.envT = now + 500; } // reflections of this room
  if (holoAnim) { // the node's projection unfolding (or folding away)
    const t = reduce ? 1 : Math.max(0, Math.min(1, (now - holoAnim.t0) / 600));
    holoK = holoAnim.from + (holoAnim.to - holoAnim.from) * ease(t); if (t === 1) holoAnim = null;
  }
  applyHolo(now);
  if (winAnim) { // the clock app growing out of (or shrinking back into) the corner readout
    const t = reduce ? 1 : Math.max(0, Math.min(1, (now - winAnim.t0) / 650));
    winApp = winAnim.from + (winAnim.to - winAnim.from) * t; drawWindow();
    if (t === 1) { if (!winAnim.to) mullion.visible = true; winAnim = null; }
  }
  /* Shadows don't depend on where you stand, only on things moving: redraw them while the door slides or the cats hop,
     a few times a second, and otherwise leave them be (each redraw renders the room ~31 times: 5 point lights x 6 faces + the desk lamp) */
  if (!lite && (Math.abs(doorTo - doorOpen) > 0.002 || now < shadowDirty) && now - (frame.shadowT || 0) > 150) { renderer.shadowMap.needsUpdate = true; frame.shadowT = now; }
  /* adaptive resolution: every 1.5 s, step the quality down if we're under ~42 fps, back up if we're comfortably over 57 */
  if (!lite && !document.hidden) { const q = frame.q ||= { t0: now, n: 0, up: 0 }; q.n++;
    if (now - q.t0 > 1500) { const fps = (q.n * 1000) / (now - q.t0); q.t0 = now; q.n = 0;
      if (flight || now < (q.settle ||= now + 3000)) {} /* judge only standing still: not mid-walk, nor the first seconds after arriving */
      else if (fps < 38 && quality > 0.55) { quality = Math.max(0.55, quality - 0.12); q.up = now + 6000; resize(); }
      else if (fps > 58 && quality < 1 && now > q.up) { quality = Math.min(1, quality + 0.06); q.up = now + 4000; resize(); } } }
  if (lens && !reduce) lens.uniforms.time.value = (now % 10000) / 1000;
  if (glassMat && !reduce) glassMat.uniforms.time.value = now / 1000;
  if (glassMat) skyStep(now);
  cv.step(now);
  composer.render();
  cv.render(); // a pulled-out case, on top
};

if (location.search.includes("debug")) window.__house = { sky: (s, w) => { skyForce.sky = s; skyForce.wx = w; loadDCSky(); skyApply(SKY.goal = skyGoal(), 1); SKY.t = Infinity; }, camera, scene, go, cv, renderer, get gtao() { return gtao; }, get envOf() { return envOf; }, models: loadedModels, shelfFaces, focus, openWindowApp, closeWindowApp,
  openNode, closeNode,
  peek(p, l) { peekView = p ? { pos: V(...p), look: V(...l), yaw: 0 } : null; }, get room() { return room; }, set yaw(v) { yaw = v; } };

// ---------- the city through the window ----------
// A photo composite of a cyberpunk-future DC (the Capitol and the Monument among megatowers, built from
// public-domain / CC0 night photos: images/city). Desktop draws it through a glass shader:
//  · depth: four layers (sky, far towers, megatowers, DC and the Mall) sit at different distances, so the
//    view shifts properly as you move, like a real window
//  · rain: drops on the glass act as tiny lenses (each one a small flipped view of the city), a few sliding down
//  · focus: the city is a touch soft behind the sharp drops
//  · reflection: a faint ghost of the room on the glass (captured once from the window)
// Phones get the same photo flattened into one image on the plain glass.
// Sources (Wikimedia Commons, public domain or CC0): "US Capitol Building at night Jan 2006", "US Navy 040709-N-0295M-004
// The Washington Monument and Thomas Jefferson Memorial…", "Roppongi at night seen from Shibuya Stream" (CC0),
// "Hong Kong Island Building" (CC0). Cut out, graded and layered by hand; the screens are drawn on.
/* ---- DC's real sky, desktop only ----
   The window's photos are a night shot; the glass shader swaps the photo's sky for a live one and grades the
   buildings to match DC right now: the sun's height (worked out here, no request needed) sets night / dusk / day,
   and Open-Meteo's current weather for DC sets cloud, fog, rain (drops on the glass + streaks), snow and lightning.
   ?sky=night|dusk|day and ?wx=clear|cloud|fog|rain|snow|storm force a look (for testing). */
const DC = { lat: 38.8895, lon: -77.0353 }; let winLight = null;
const sunAlt = (d = new Date()) => { const rad = Math.PI / 180, n = (d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = -23.44 * rad * Math.cos((2 * Math.PI * (n + 10)) / 365), B = (2 * Math.PI * (n - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const H = (((d.getUTCHours() * 60 + d.getUTCMinutes() + eot + 4 * DC.lon) / 60 - 12) * 15) * rad, la = DC.lat * rad;
  return Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(H)) / rad; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SKY = { u: Object.fromEntries([..."dayK duskK cloudK fogK wetK snowK flash".split(" ").map((k) => [k, { value: 0 }]),
    ["skyTop", { value: new THREE.Color() }], ["skyBot", { value: new THREE.Color() }], ["haze", { value: new THREE.Color() }]]),
  wx: { cloud: 0.2, fog: 0, wet: 0, snow: 0, storm: 0 }, goal: null, drops: 1, nextFlash: 0, t: 0 };
const skyForce = { sky: new URLSearchParams(location.search).get("sky"), wx: new URLSearchParams(location.search).get("wx") };
const skyGoal = () => {
  const alt = skyForce.sky === "day" ? 40 : skyForce.sky === "dusk" ? -3 : skyForce.sky === "night" ? -30 : sunAlt();
  const w = SKY.wx, day = sstep(-4, 10, alt), dusk = sstep(-10, -3, alt) * (1 - sstep(1, 9, alt)) * (1 - w.cloud * 0.6);
  const C = (r, g, b) => new THREE.Color(r, g, b), grey = C(0.42, 0.43, 0.47);
  const top = C(0.06, 0.05, 0.16).lerp(C(0.13, 0.3, 0.66), day).lerp(grey, w.cloud * 0.85), bot = C(0.85, 0.36, 0.22).lerp(C(0.55, 0.66, 0.82), day).lerp(grey.clone().multiplyScalar(1.25), w.cloud * 0.8);
  const haze = C(0.09, 0.07, 0.12).lerp(C(0.6, 0.64, 0.7), day).lerp(C(0.5, 0.36, 0.36), dusk * 0.5);
  return { dayK: day, duskK: dusk, cloudK: w.cloud, fogK: w.fog, wetK: w.wet, snowK: w.snow, top, bot, haze, drops: w.wet > 0 ? 1 : 0 };
};
const skyApply = (g, k) => { const u = SKY.u; for (const n of ["dayK", "duskK", "cloudK", "fogK", "wetK", "snowK"]) u[n].value += (g[n] - u[n].value) * k;
  u.skyTop.value.lerp(g.top, k); u.skyBot.value.lerp(g.bot, k); u.haze.value.lerp(g.haze, k); SKY.drops += (g.drops - SKY.drops) * k;
  if (winLight) { const d = u.dayK.value; winLight.intensity = 2.0 + d * 1.6; winLight.color.setRGB(0.35 + 0.45 * d, 0.56 + 0.3 * d, 1); } };
const skyStep = (now) => {
  if (!SKY.goal || now > SKY.t) { SKY.goal = skyGoal(); SKY.t = now + 60000; } /* the sun moves: re-aim each minute */
  skyApply(SKY.goal, 0.02); if (glassMat) glassMat.uniforms.rainK.value = (1 - winApp) * SKY.drops;
  const f = SKY.u.flash; f.value *= 0.86; /* lightning: a double flicker every 6-20 s in a storm */
  if (SKY.wx.storm && !reduce && now > SKY.nextFlash) { f.value = 0.9; setTimeout(() => (f.value = 0.6), 110); SKY.nextFlash = now + 6000 + Math.random() * 14000; }
};
const loadDCSky = () => {
  if (skyForce.wx) { const w = skyForce.wx; SKY.wx = { cloud: { clear: 0, cloud: 1, fog: 0.7, rain: 0.9, snow: 0.95, storm: 1 }[w] ?? 0.2, fog: w === "fog" ? 0.8 : 0, wet: w === "rain" || w === "storm" ? 1 : 0, snow: w === "snow" ? 1 : 0, storm: w === "storm" ? 1 : 0 }; SKY.goal = null; return; }
  const q = new URLSearchParams({ latitude: DC.lat, longitude: DC.lon, current: "weather_code,cloud_cover,precipitation,visibility", timezone: "America/New_York" });
  fetch(`https://api.open-meteo.com/v1/forecast?${q}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(({ current: c }) => {
    const code = c.weather_code, rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95, snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
    SKY.wx = { cloud: Math.min(1, (c.cloud_cover ?? 30) / 100), fog: code === 45 || code === 48 ? 0.8 : sstep(10000, 1500, c.visibility ?? 20000) * 0.7,
      wet: rain ? Math.min(1, 0.55 + (c.precipitation || 0) * 0.3) : 0, snow: snow ? 1 : 0, storm: code >= 95 ? 1 : 0 };
    SKY.goal = null;
  }).catch((e) => console.warn("dc sky:", e));
};
const buildCity = () => {
  const P = "images/city/", CITY_V = "?v=1793944054"; // bump when the pictures change
  if (lite) { const im = new Image(); im.onload = () => { cityPhoto = im; drawWindow(); }; im.src = P + "flat.jpg" + CITY_V; return; }
  loadDCSky(); setInterval(loadDCSky, 15 * 60000); SKY.goal = skyGoal(); skyApply(SKY.goal, 1);
  const tex = (n) => new Promise((ok, no) => loader.load(P + n + CITY_V, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.MirroredRepeatWrapping; ok(t); }, undefined, no));
  // drops: a normal map painted on a canvas (red/green = how the drop bends light, blue = drop or not)
  const drops = (() => { const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d");
    x.fillStyle = "rgb(128,128,0)"; x.fillRect(0, 0, 512, 512); const im = x.getImageData(0, 0, 512, 512), d = im.data;
    let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 110; i++) { const cx = r() * 512, cy = r() * 512, rad = 3 + Math.pow(r(), 2.2) * 13, ry = rad * (1 + r() * 0.5);
      for (let yy = Math.floor(cy - ry); yy <= cy + ry; yy++) for (let xx = Math.floor(cx - rad); xx <= cx + rad; xx++) {
        const nx = (xx - cx) / rad, ny = (yy - cy) / ry, l = nx * nx + ny * ny; if (l > 1) continue;
        const k = (((yy + 512) % 512) * 512 + ((xx + 512) % 512)) * 4; d[k] = 128 + nx * 120; d[k + 1] = 128 - ny * 120; d[k + 2] = 255; } }
    x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t; })();
  // the room, as seen from the window: rendered once into a small cube map for the reflection
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.1, 30, cubeRT); cubeCam.position.set(0, 1.9, -6.8); scene.add(cubeCam);
  const capture = () => { const hide = [windowGlass, rainMesh].filter(Boolean); hide.forEach((m) => (m.visible = false)); cubeCam.update(renderer, scene); hide.forEach((m) => (m.visible = true)); if (rainMesh) rainMesh.visible = false; };
  Promise.all(["L0_sky.webp", "L1_far.webp", "L2_mid.webp", "L3_dc.webp"].map(tex)).then(([sky, far, mid, dc]) => {
    glassMat = new THREE.ShaderMaterial({
      uniforms: { tSky: { value: sky }, tFar: { value: far }, tMid: { value: mid }, tDC: { value: dc }, tHUD: { value: windowTex }, tDrops: { value: drops }, tRoom: { value: cubeRT.texture },
        eye0: { value: V(0, 1.9, -1.1) }, time: { value: 0 }, rainK: { value: 1 }, reflK: { value: 0.07 }, gain: { value: 0.9 },
        ...SKY.u },
      vertexShader: `varying vec3 vWorld; varying vec2 vUv;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D tSky, tFar, tMid, tDC, tHUD, tDrops; uniform samplerCube tRoom;
        uniform vec3 eye0; uniform float time, rainK, reflK, gain; varying vec3 vWorld; varying vec2 vUv;
        // DC's real sky (see SKY): dayK 0 night .. 1 day, duskK the sunset glow, cloudK overcast, fogK haze,
        // wetK rain (streaks outside), snowK snow, flash a lightning flash; skyTop/skyBot the sky's own colour
        uniform float dayK, duskK, cloudK, fogK, wetK, snowK, flash; uniform vec3 skyTop, skyBot, haze;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        vec3 skyOf(vec2 u, vec3 night) {
          float mixK = max(dayK, duskK * 0.9); if (mixK < 0.003 && cloudK < 0.003) return night;
          vec3 s = mix(skyBot, skyTop, smoothstep(0.35, 1.0, u.y));
          // clouds: two octaves of soft noise drifting east, thicker when it's overcast
          vec2 q = u * vec2(4.0, 9.0) + vec2(time * 0.004, 0.0);
          float cl = vnoise(q) * 0.65 + vnoise(q * 2.3 + 7.1) * 0.35;
          float cov = smoothstep(0.75 - cloudK * 0.7, 1.05 - cloudK * 0.5, cl);
          vec3 cloudCol = mix(skyBot * 0.92, vec3(0.62, 0.62, 0.66) * (0.35 + 0.65 * dayK), 0.6);
          s = mix(s, cloudCol, cov * (0.35 + 0.6 * cloudK));
          // at night an overcast sky glows dull pink-orange with the city's own light
          vec3 n = mix(night, vec3(0.13, 0.075, 0.1), cloudK * 0.75);
          return mix(n, s, mixK);
        }
        // the buildings by day: the neon dims against daylight and the dark faces lift toward the sky's light;
        // the further a layer, the more haze sits in front of it
        vec4 graded(vec4 l, float far) {
          vec3 amb = mix(skyBot, vec3(0.5), 0.4) * 0.55;
          l.rgb = l.rgb * mix(1.0, 0.85, dayK) + amb * dayK * (0.1 + 0.22 * far) + skyBot * duskK * 0.06;
          float hz = clamp(far * (0.1 * dayK + 0.9 * fogK) + far * cloudK * 0.2, 0.0, 0.92);
          l.rgb = mix(l.rgb, haze, hz); return l;
        }
        const float GZ = -7.02; // the glass, 5.2 x 2 m, centred at (0, 1.9)
        // where a layer D metres behind the glass is hit, in the layer's own picture coordinates
        vec2 lay(vec3 v, float D, vec2 off) {
          vec3 q = vWorld + v * (D / max(0.04, -v.z));
          float d0 = eye0.z - GZ, t = d0 / (d0 + D);
          vec2 g = eye0.xy + (q.xy - eye0.xy) * t;
          vec2 w = vec2((g.x + 2.6) / 5.2, (g.y - 0.9) / 2.0) + off;
          w = (w - vec2(0.5, 0.12)) / 1.22 + vec2(0.5, 0.12); // the city a little closer than composed
          vec2 u = (w + 0.125) / 1.25; return vec2(u.x, clamp(u.y, 0.002, 0.998)); // sideways, the city carries on (mirrored) past the edges
        }
        vec3 over(vec3 c, vec4 l) { return mix(c, l.rgb, l.a); }
        vec3 city(vec3 v, vec2 off, float b) {
          vec2 su = lay(v, 400.0, off * 0.3);
          vec3 c = skyOf(su, texture(tSky, su, b + 0.6).rgb);
          c = over(c, graded(texture(tFar, lay(v, 120.0, off * 0.5), b), 1.0));
          c = over(c, graded(texture(tMid, lay(v, 45.0, off * 0.8), b), 0.6));
          c = over(c, graded(texture(tDC, lay(v, 18.0, off), b), 0.3));
          return c;
        }
        void main() {
          vec3 v = normalize(vWorld - cameraPosition);
          // drops: a still scatter, and a sparser set sliding slowly down
          vec2 ru = vUv * vec2(5.2, 2.0);
          vec4 d1 = texture(tDrops, ru * 0.9);
          vec4 d2 = texture(tDrops, ru * 1.3 + vec2(0.37, time * 0.02));
          vec4 dr = d2.b > 0.5 ? d2 : d1; float isDrop = dr.b * rainK;
          vec2 n = (dr.rg - 0.5) * 2.0;
          // each drop is a little lens: a sharp, flipped, shrunk view; between drops the city is soft
          vec3 sharp = city(v, -n * 0.03, -0.5), soft = city(v, vec2(0.0), mix(-0.2, 0.8, rainK)); /* dry glass is clear, wet glass softens the view */
          float rim = smoothstep(0.45, 1.0, dot(n, n)); // the edge of a drop bends light away: a dark ring
          vec3 drop = sharp * (1.15 - 0.75 * rim) + pow(max(0.0, dot(n, normalize(vec2(-0.5, 0.8)))), 10.0) * 0.5; // and a glint where the room's light catches it
          vec3 col = mix(soft, drop, isDrop);
          // weather outside the glass: fine rain streaks, or snow drifting down in two depths
          vec2 wu = vUv * vec2(5.2, 2.0);
          if (wetK > 0.01) { vec2 p = wu * vec2(70.0, 3.0) + vec2(wu.y * 6.0, time * 5.0); vec2 c0 = floor(p), f = fract(p);
            float on = step(0.86, h21(c0)), st = smoothstep(0.5, 0.0, abs(f.x - 0.5) * 6.0) * smoothstep(0.0, 0.4, f.y) * smoothstep(1.0, 0.6, f.y);
            col += vec3(0.55, 0.6, 0.7) * on * st * wetK * 0.12; }
          if (snowK > 0.01) for (int k = 0; k < 2; k++) { float z = 1.0 + float(k) * 1.7;
            vec2 p = wu * 9.0 * z + vec2(sin(time * 0.3 + wu.y * 2.0) * 0.6, time * 0.5 / z); vec2 c0 = floor(p), f = fract(p) - 0.5;
            vec2 o = vec2(h21(c0), h21(c0 + 3.1)) - 0.5; float d = length(f - o * 0.6);
            col += vec3(0.85, 0.87, 0.95) * smoothstep(0.09 / z, 0.0, d) * step(0.45, h21(c0 + 9.7)) * snowK * (0.55 / z); }
          col = col * (1.0 + flash * 1.6) + vec3(0.45, 0.5, 0.65) * flash * 0.25;
          col *= gain;
          // the room's faint reflection: stronger at a glancing angle
          vec3 r = reflect(v, vec3(0.0, 0.0, 1.0));
          float fres = reflK * (0.6 + 2.4 * pow(1.0 - abs(v.z), 3.0));
          col += texture(tRoom, r).rgb * fres;
          vec4 hud = texture(tHUD, vUv); col = mix(col, hud.rgb * 0.85, hud.a);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    windowGlass.material = glassMat; if (rainMesh) rainMesh.visible = false;
    drawWindow(); capture(); setTimeout(capture, 4000); // again once the shelf photos and posters have streamed in
  }).catch(() => {}); // the painted city stays if the photos don't load
};

// ---------- desktop: the big light sources really light the room ----------
// The city window, the neon cove round the ceiling and the theater screen become area lights: soft light
// across their whole face, so the couch is lit by the city and the walls carry the colour of the neon along
// them, rather than a point light stood in for each. (Phones keep the point lights only.)
const buildAreaLights = () => {
  RectAreaLightUniformsLib.init();
  const area = (color, intensity, w, h, pos, look) => { const l = new THREE.RectAreaLight(color, intensity, w, h); l.position.copy(pos); l.lookAt(look); scene.add(l); return l; };
  area(0x6f8fff, 3.0, 5.2, 2.0, V(0, 1.9, -6.98), V(0, 1.6, 0)); // the city through the window
  /* the cove light washing down the walls: painted on as soft additive light (as real area lights these four cost ~10 fps) */
  const washT = canvasTex(64, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.25, "rgba(255,255,255,.4)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const wash = (c, k, w, h, pos, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: washT, color: new THREE.Color(c).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.copy(pos); m.rotation.y = rotY; m.raycast = () => {}; scene.add(m); };
  for (const s of [-1, 1]) wash(0xff2a6d, 0.32, 6.8, 1.3, V(s * 5.885, H - 0.75, -3.5), -s * Math.PI / 2); // magenta down the sides
  wash(0xffa040, 0.26, 11.6, 1.3, V(0, H - 0.75, -0.115), Math.PI); wash(0xffa040, 0.26, 11.6, 0.5, V(0, H - 0.35, -6.885), 0); // amber across the ends (kept above the window at the far end)
  area(0xbfd4ff, 2.0, 6.1, 3.43, V(-4.5, 2.0, -16.75), V(-4.5, 1.6, -8)); // the theater screen onto the seats
  area(0xfff1dc, 1.2, 6.5, 0.4, V(9.6, H - 0.05, -3.6), V(9.6, 0, -3.6)); // the gallery's track lighting
};
// Reflections of the real room: once a room is reached, its view is captured into a cube map (lights,
// neon, window and all) and used as the environment, so the glossy floor and the steel reflect what's
// actually there. One capture per room, kept.
const envCube = lite ? null : new THREE.CubeCamera(0.1, 40, new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }));
const pmrem = lite ? null : new THREE.PMREMGenerator(renderer); // one, kept: a fresh one per capture meant recompiling its shaders each time, a stall of seconds
const envOf = {}; let envRoom = null;
const useRoomEnv = (r) => {
  if (!envCube || !VIEWS[r]) return;
  if (!envOf[r]) { const v = VIEWS[r], was = sideActive(); sideShow(SIDE[r] ? r : null); envCube.position.copy(v.pos); envCube.update(renderer, scene); envOf[r] = pmrem.fromCubemap(envCube.renderTarget.texture).texture; sideShow(was); }
  scene.environment = envOf[r]; envRoom = r;
};

// ---------- start ----------
/* ---------- baked light on the floors (desktop) ----------
   Ambient occlusion baked into each room's floor, on the GPU, once, in idle frames after you're in: the room is
   rendered as a depth map from 64 directions round the sky, and each floor texel counts how many of those
   directions are blocked within a metre (the couch over it, a wall beside it, a cabinet's foot). The result is a
   soft dark pool under and around everything, the kind of grounding a lightmap bake gives, at no per-frame cost:
   it's applied as the floor's aoMap, and also takes some of the direct light, so it shows under the lamps too. */
const bakeFloors = () => {
  const floors = []; scene.updateMatrixWorld(true);
  /* the floors (thin boxes at y = 0) and anything lying flat on them, like the rug, which is where the couch's shadow falls */
  scene.traverse((o) => { const gp = o.geometry?.parameters, t = o.geometry?.type; if (!o.isMesh || !o.visible || !o.material?.isMeshStandardMaterial || o.material.transparent) return;
    const box = t === "BoxGeometry" && gp.height <= 0.13 && gp.width * gp.depth >= 3, flat = t === "PlaneGeometry" && gp.width * gp.height >= 2 && V(0, 0, 1).transformDirection(o.matrixWorld).y > 0.99;
    if (!box && !flat) return; const bb = new THREE.Box3().setFromObject(o); if (bb.max.y > 0.05 || bb.max.y < -0.03) return; floors.push({ o, bb }); });
  if (!floors.length) return;
  const R = 1.0, N = 64, depthRT = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType, format: THREE.RGBAFormat });
  /* looking UP from under the floor (everything below it clipped away), so the first surface each floor point sees is what covers it */
  const depthM = new THREE.ShaderMaterial({ side: THREE.DoubleSide, clipping: true,
    vertexShader: "#include <common>\n#include <clipping_planes_pars_vertex>\nvarying float vD;\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n#include <clipping_planes_vertex>\nvD = -mvPosition.z; }",
    fragmentShader: "#include <clipping_planes_pars_fragment>\nvarying float vD; void main() {\n#include <clipping_planes_fragment>\ngl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }" });
  const clipUp = [new THREE.Plane(V(0, 1, 0), -0.012)];
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  const quadM = new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    uniforms: { tDepth: { value: depthRT.texture }, vp: { value: new THREE.Matrix4() }, vm: { value: new THREE.Matrix4() }, uvw: { value: new THREE.Matrix3() }, y0: { value: 0 }, w: { value: 1 / N }, R: { value: R } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform sampler2D tDepth; uniform mat4 vp, vm; uniform mat3 uvw; uniform float y0, w, R; varying vec2 vUv;
      void main() { vec3 xz = uvw * vec3(vUv, 1.0); vec4 p = vec4(xz.x, y0, xz.y, 1.0);
        vec4 c = vp * p; vec2 s = c.xy / c.w * 0.5 + 0.5; float dP = -(vm * p).z, dO = texture2D(tDepth, s).r;
        float dist = dO - dP, occ = (dist > 0.03 && dist < R) ? 1.0 - smoothstep(R * 0.35, R, dist) : 0.0;
        if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) occ = 0.0;
        gl_FragColor = vec4(vec3(w * (1.0 - occ)), 1.0); }` });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadM), qScene = new THREE.Scene(), qCam = new THREE.Camera(); quad.frustumCulled = false; qScene.add(quad);
  // directions: cosine-weighted over the hemisphere, a fixed spiral so every bake is the same
  const dirs = Array.from({ length: N }, (_, i) => { const u = (i + 0.5) / N, phi = i * 2.39996, r = Math.sqrt(u), y = Math.sqrt(1 - u); return V(Math.cos(phi) * r, y, Math.sin(phi) * r); });
  const jobs = floors.map(({ o, bb }) => {
    // the top face's uv, as an affine map of world x,z: found from three of its corners
    const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal, top = [];
    for (let i = 0; i < pos.count && top.length < 3; i++) if (V(nor.getX(i), nor.getY(i), nor.getZ(i)).transformDirection(o.matrixWorld).y > 0.9) { const wp = V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld); top.push([wp.x, wp.z, uv.getX(i), uv.getY(i)]); }
    const A = new THREE.Matrix3().set(top[0][2], top[1][2], top[2][2], top[0][3], top[1][3], top[2][3], 1, 1, 1), W = new THREE.Matrix3().set(top[0][0], top[1][0], top[2][0], top[0][1], top[1][1], top[2][1], 1, 1, 1);
    const uvw = W.multiply(A.clone().invert()); /* world (x, z, 1) = uvw * (u, v, 1) */
    const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z, k = 56, tw = Math.min(1024, Math.ceil(sx * k)), th = Math.min(1024, Math.ceil(sz * k));
    const swap = Math.abs(uvw.elements[0]) < Math.abs(uvw.elements[3]); /* u runs along z instead of x */
    const rt = new THREE.WebGLRenderTarget(swap ? th : tw, swap ? tw : th, { type: THREE.HalfFloatType }); return { o, bb, uvw, rt, i: 0 };
  });
  const hideAll = () => { const hidden = []; scene.traverse((o) => { if (!o.visible) return; const m = o.material, cat = o.userData.fromCat || o.userData.fromCouch;
    if (cat || o.isSprite || o.isPoints || o.isLine || (o.isMesh && (m?.transparent || m?.visible === false || m?.blending === THREE.AdditiveBlending))) { o.visible = false; hidden.push(o); } }); return hidden; };
  let applied = 0;
  const apply = (j) => { const m = j.bakedM = j.o.material.clone(); m.aoMap = j.rt.texture; m.aoMapIntensity = 0; m.userData.bakeAO = true;
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <aomap_fragment>", "#include <aomap_fragment>\n#ifdef USE_AOMAP\n reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.72);\n#endif"); };
    m.needsUpdate = true; applied++; };
  const step = () => {
    const job = jobs.find((j) => j.i < N); if (!job) { depthRT.dispose();
      /* all done: build the floors' new shaders in the background (no hitch), then swap them in and fade the bake up */
      const grp = new THREE.Group(); for (const j of jobs) { const m = new THREE.Mesh(j.o.geometry, j.bakedM); m.receiveShadow = j.o.receiveShadow; m.castShadow = j.o.castShadow; grp.add(m); }
      const swap = () => { for (const j of jobs) j.o.material = j.bakedM; const t0 = performance.now(); animators.push((now) => { const k = Math.min(1, (now - t0) / 1500); for (const j of jobs) j.bakedM.aoMapIntensity = k; }); };
      renderer.compileAsync(grp, camera, scene).then(swap, swap); return; }
    const sideWas = sideActive(); for (const k in SIDE) if (SIDE[k].group) SIDE[k].group.visible = true; /* the side rooms' furniture counts, even while they're shut */
    const hidden = hideAll(), prevT = renderer.getRenderTarget(), prevO = scene.overrideMaterial, prevBg = scene.background, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), ac = renderer.autoClear;
    const sNeed = renderer.shadowMap.needsUpdate; renderer.shadowMap.needsUpdate = false; /* don't let the bake's renders eat a pending shadow redraw */
    const t0 = performance.now();
    while (job.i < N && performance.now() - t0 < 8) { /* a few directions a frame, about 8 ms' worth */
      const d = dirs[job.i], c = job.bb.getCenter(V(0, 0, 0)); c.y = 0;
      oc.position.copy(c).addScaledVector(d, -25); oc.up.set(Math.abs(d.y) > 0.99 ? 1 : 0, Math.abs(d.y) > 0.99 ? 0 : 1, 0); oc.lookAt(c); oc.updateMatrixWorld();
      /* fit the view to the floor and a metre above it */
      const inv = oc.matrixWorldInverse, b = job.bb; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const px of [b.min.x - R, b.max.x + R]) for (const py of [0, R + 0.5]) for (const pz of [b.min.z - R, b.max.z + R]) { const q = V(px, py, pz).applyMatrix4(inv); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      Object.assign(oc, { left: x0, right: x1, bottom: y0, top: y1 }); oc.updateProjectionMatrix();
      scene.overrideMaterial = depthM; scene.background = null;
      renderer.setRenderTarget(depthRT); renderer.setClearColor(new THREE.Color(1e4, 1e4, 1e4), 1); renderer.clear(); const cp = renderer.clippingPlanes; clipUp[0].constant = -(job.bb.max.y + 0.012); renderer.clippingPlanes = clipUp; floors.forEach((f) => (f.o.visible = false)); renderer.render(scene, oc); floors.forEach((f) => (f.o.visible = true)); renderer.clippingPlanes = cp;
      scene.overrideMaterial = prevO; scene.background = prevBg;
      const u = quadM.uniforms; u.vp.value.multiplyMatrices(oc.projectionMatrix, oc.matrixWorldInverse); u.vm.value.copy(oc.matrixWorldInverse); u.uvw.value.copy(job.uvw); u.y0.value = job.bb.max.y;
      renderer.setRenderTarget(job.rt); if (job.i === 0) { renderer.setClearColor(0x000000, 1); renderer.clear(); } renderer.autoClear = false; renderer.render(qScene, qCam); renderer.autoClear = ac;
      job.i++;
    }
    if (job.i >= N) apply(job);
    renderer.setRenderTarget(prevT); renderer.setClearColor(cc, ca); hidden.forEach((o) => (o.visible = true)); for (const k in SIDE) if (SIDE[k].group) SIDE[k].group.visible = k === sideWas; renderer.shadowMap.needsUpdate = sNeed;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  if (location.search.includes("debug")) window.__bake = { jobs, get applied() { return applied; } };
};
(async () => {
  await Promise.race([
    Promise.all(["700 140px Rajdhani", "500 34px 'JetBrains Mono'", "500 38px Inter", "600 40px Inter", "italic 400 38px Inter"].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  buildOutside(); buildLiving(); buildTheater(); buildKitchen(); buildKitchenMore(); buildGallery(); buildDecor(); buildHallMore(); buildCats(); buildHolo(); buildCity(); if (!lite) { sideGroup("closet", buildCloset); sideGroup("music", buildMusic); animators.push((now, dt) => { for (const k in SIDE) { const d = SIDE[k]; if (!d.door) continue; d.open += (d.to - d.open) * (reduce ? 1 : 1 - Math.exp(-(dt || 16) / 110)); d.door.position.copy(d.base).addScaledVector(d.slide, d.open); } }); for (const [k, t] of [["music", "Go to the music room"], ["closet", "Go to the closet"]]) { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", () => go(k)); document.querySelector(".h-nav")?.append(b); } }
  if (!lite) buildAreaLights();
  scene.add(new THREE.AmbientLight(0x5b4a9a, 0.3)); // low: the room's light comes from its lamps, neon and the city
  scene.add(new THREE.HemisphereLight(0x9d8cff, 0x1a0f30, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(3, 6, 4); scene.add(key);
  scene.traverse((o) => { if (o.userData.flicker) { o.userData.seed = Math.random() * 10; flickers.push(o); } });
  // Shadows: a handful of key lights cast them (the city through the window, the theater screen, the lamp,
  // the hall light over my door, the gallery). Everything solid casts and catches them. Phones skip
  // them. The shadow maps are only redrawn while something moves, not every frame.
  renderer.shadowMap.enabled = !lite; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  scene.traverse((o) => {
    if (!lite && o.isPointLight && o.userData.shadow) {
      o.castShadow = true; o.shadow.mapSize.setScalar(512); o.shadow.bias = -0.004; o.shadow.normalBias = 0.03; o.shadow.radius = 4;
      o.shadow.camera.near = 0.1; o.shadow.camera.far = o.distance || 12;
    }
    if (o.isMesh && o.material?.isMeshStandardMaterial && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true;
      // big painted surfaces (walls, floors, doors) get relief from their own texture: seams sink, ribs stand up
      const m = o.material; if (m.map && !m.bumpMap) { o.geometry.computeBoundingBox(); const sz = o.geometry.boundingBox.getSize(V(0, 0, 0)); if (Math.max(sz.x, sz.y, sz.z) > 1.3) { m.bumpMap = m.map; m.bumpScale = 1.4; m.roughnessMap = wearTex(); m.needsUpdate = true; } } }
  });
  drawScreen(null); loadLive();
  resize(); setRoomUI(); aim(VIEWS.outside.pos, VIEWS.outside.look, 0, 0);
  // Build every shader up front, behind the loading screen (in parallel where the GPU allows), so the first look
  // round each room doesn't stall on it: with the area lights the standard shaders are big and slow to compile.
  if (!lite) { try { await renderer.compileAsync(scene, camera); } catch (e) { console.warn("precompile", e); } }
  // and capture every room's reflections now, behind the loading screen, rather than on arrival (each capture
  // renders the whole room six times; the first ones build GPU pipelines too, which would stall the walk in)
  if (envCube) { pmrem.compileCubemapShader(); for (const r of Object.keys(VIEWS)) useRoomEnv(r); useRoomEnv("outside"); }
  renderer.setAnimationLoop(frame);
  if (!lite && !location.search.includes("nobake")) afterLoad(bakeFloors);
  setTimeout(() => ui.load.classList.add("done"), 250); // the shelf photos stream in after; nothing waits on them
})();
