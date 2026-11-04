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
import { createCaseViewer, pick } from "./case-viewer.js?v=1793776127";

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
renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.15 : 2));
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
const block = (w, h, d, color, x, y, z, { parent = scene, r = 0.07, mat, ink = false, rot } = {}) => {
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
  for (const s of [-1, 1]) tube(0.04, 2.44, 0.04, 0x05d9e8, s * 0.74, 1.22, 0.12, { k: 1.3 });
  tube(1.52, 0.04, 0.04, 0x05d9e8, 0, 2.44, 0.12, { k: 1.3 });
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
    block(w - 0.06, 0.2, 0.015, 0x2a2e3a, cx, 0.12, front, { parent: g, r: 0.006, ink: false });
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
  for (const s of [-1, 1]) { block(0.12, 0.34, 0.08, 0x14161f, s * 1.25, 2.1, 0.12, { r: 0.02 }); tube(0.05, 0.28, 0.02, 0x05d9e8, s * 1.25, 2.1, 0.165, { k: 1.1 }); } // sconces
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
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * L, 12), steelM(c)); pipe.rotation.z = Math.PI / 2; pipe.position.set(0, H - dy, zz + (zz < 1 ? 0.02 : -0.02)); scene.add(pipe); }
  for (let xx = -L + 1; xx < L; xx += 2.2) for (const zz of [0.17, Dp - 0.17]) block(0.04, 0.14, 0.07, 0x1a1d28, xx, H - 0.15, zz, { r: 0.01, ink: false });
  for (const xx of [-8, 0, 8]) { const hl = new THREE.PointLight(0xc8d0ff, 2.4, 9); hl.position.set(xx, 3.0, Dp / 2); hl.userData.shadow = xx === 0 ? 2 : 0; scene.add(hl); }
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
    const l = new THREE.PointLight(s > 0 ? 0xff4f8b : 0x3fd8ff, 1.6, 6); l.position.set(s * (L - 0.8), 1.8, Dp / 2); scene.add(l);
    // a big planter under each window
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 18), steelM(0x2a2e3a)); pot.position.set(s * (L - 0.5), 0.25, Dp / 2 + 1.5); scene.add(pot);
    if (!lite) leafy(scene, s * (L - 0.5), 0.48, Dp / 2 + 1.5, { n: 22, len: 1.15, wid: 0.15, bend: 0.6, tilt: 0.62, seed: s + 3 });
    else for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.9 + (k % 3) * 0.2, 5), toon(k % 2 ? 0x2f8f4e : 0x3fae5e)); leaf.position.set(s * (L - 0.5) + Math.cos(a) * 0.1, 0.9, Dp / 2 + 1.5 + Math.sin(a) * 0.1); leaf.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); scene.add(leaf); }
  }
  // warm amber sconces between the doors, each washing its bit of wall
  for (const [x, back] of [[-4.0, false], [3.9, false], [-4.05, true], [1.55, true], [4.25, true]]) {
    const z = back ? Dp - 0.11 : 0.11, f = back ? -1 : 1;
    block(0.1, 0.42, 0.04, 0, x, 2.05, z + f * 0.01, { mat: steelM(0x9aa2b4), r: 0.01, ink: false });
    tube(0.045, 0.32, 0.03, 0xffa040, x, 2.05, z + f * 0.035, { k: 1.25 });
    pool(1.2, 1.6, 0xffa040, 0.22, x, 2.0, z + f * 0.002, 0, back ? Math.PI : 0);
    pool(0.9, 0.7, 0xffa040, 0.06, x, 0.004, z + f * 0.5, -Math.PI / 2);
  }
  for (const [x, z] of [[-4, 1.0], [4.1, Dp - 1.0]]) { const l = new THREE.PointLight(0xffa040, 1.4, 4.5); l.position.set(x, 2.1, z); scene.add(l); }
  // neon traced round each neighbour's door frame (a thin line, not a glow)
  for (const [x, back] of [[-5.2, false], [5.2, false], [10.4, false], [8.6, true], [2.8, true], [-2.6, true], [-8.4, true]]) {
    const z = back ? Dp - 0.075 : 0.075 + 0.1, c = back ? 0xff2a6d : 0x7ff6ff;
    for (const sx of [-1, 1]) tube(0.016, 2.5, 0.016, c, x + sx * 0.73, 1.25, z, { k: 0.75 });
    tube(1.48, 0.016, 0.016, c, x, 2.51, z, { k: 0.75 });
  }
  // a reflection of my door's neon on the floor in front of it
  pool(1.9, 1.2, 0x05d9e8, 0.1, 0, 0.034, 1.3, -Math.PI / 2); pool(0.9, 0.6, 0xff2a6d, 0.12, 0, 0.036, 0.6, -Math.PI / 2);
  // a planter by my door
  { const box = block(0.7, 0.42, 0.3, 0, 2.6, 0.21, 0.3, { r: 0.02, mat: steelM(0x6c7389) });
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
  wall(0.2, H, 7, -6, H / 2, -3.5, 7);
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
    const rugM = fabricM(0xffffff); rugM.map = rugTex; rugM.bumpScale = 1.2; const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.0), rugM); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, -5.2); scene.add(rug); }
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
    block(W, 0.35, D, shell, 0, 0.245, 0, { parent: g, r: 0.03 }); // the plinth
    tube(W, 0.014, 0.01, 0x05d9e8, 0, 0.2, -D / 2 - 0.006, { parent: g, k: 1.0 }); // a light line along its front
    for (let i = 0; i < seats; i++) block(sw - 0.04, 0.26, D - 0.18, cush, (i - (seats - 1) / 2) * sw, 0.55, -0.07, { parent: g, r: 0.05, mat: fabricM(cush) }); // seat cushions
    block(W, 0.62, 0.16, shell, 0, 0.73, D / 2 - 0.08, { parent: g, r: 0.03 }); // the back
    for (let i = 0; i < seats; i++) block(sw - 0.06, 0.42, 0.18, cush, (i - (seats - 1) / 2) * sw, 0.9, D / 2 - 0.24, { parent: g, r: 0.06, rot: [0.12, 0, 0], mat: fabricM(cush) }); // back cushions
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, toon(shell)); arm.position.set(s * W / 2, 0.07, 0); arm.scale.x = s; g.add(arm);
      arm.add(new THREE.LineSegments(new THREE.EdgesGeometry(armGeo, 25), lineMat));
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
  block(1.6, 0.32, 0.8, shell, 0, 0.21, -5.95, { r: 0.03 });
  block(1.66, 0.05, 0.86, 0xf0f2f7, 0, 0.395, -5.95, { r: 0.02 }); // the top, at 0.42
  for (const dz of [-0.403, 0.403]) tube(1.6, 0.012, 0.01, 0x05d9e8, 0, 0.29, -5.95 + dz, { k: 1.0 });
  for (const dx of [-0.803, 0.803]) tube(0.01, 0.012, 0.8, 0x05d9e8, dx, 0.29, -5.95, { k: 1.0 });
  for (let i = 0; i < 4; i++) block(0.2, 0.014, 0.01, 0x14161f, -0.45 + i * 0.3, 0.15, -5.95 + 0.403, { r: 0.004, ink: false }); // vents
  { const t = panel(0.42, 0.2, tableUI, 0.5, 0.4215, -6.08, { k: 0.9 }); t.rotation.x = -Math.PI / 2; }
  // a mug
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.11, 16), toon(0xf4f3ff)); mug.position.set(-0.62, 0.475, -6.12); scene.add(mug);
  const mh = new THREE.Mesh(mug.geometry, inkMat); mh.scale.setScalar(1.18); mug.add(mh);
  // a halo lamp: two neon rings turning slowly around a floating orb, on a slim black stem
  const lamp = new THREE.Group(); lamp.position.set(2.6, 0, -4.75); scene.add(lamp);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.05, 24), toon(0x16102e)); base.position.y = 0.025; lamp.add(base);
  const baseInk = new THREE.Mesh(base.geometry, inkMat); baseInk.scale.set(1.06, 1.2, 1.06); base.add(baseInk);
  const rimLight = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.008, 6, 32), glowMat(0x05d9e8, 1.3)); rimLight.rotation.x = Math.PI / 2; rimLight.position.y = 0.05; lamp.add(rimLight);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 1.15, 10), toon(0x16102e)); stem.position.y = 0.62; lamp.add(stem);
  const stemInk = new THREE.Mesh(stem.geometry, inkMat); stemInk.scale.set(1.5, 1.01, 1.5); stem.add(stemInk);
  tube(0.012, 0.9, 0.012, 0xff2a6d, 0.022, 0.62, 0, { parent: lamp, k: 1.1 }); // a thin light line up the stem
  const halo = new THREE.Group(); halo.position.y = 1.58; lamp.add(halo);
  const outer = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.022, 10, 48), glowMat(0xff2a6d, 1.25)); halo.add(outer);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.014, 8, 40), glowMat(0x05d9e8, 1.2)); halo.add(inner);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), toon(0x16102e)); clamp.position.y = -0.36; halo.add(clamp);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), glowMat(0xffd6ea, 1.15)); halo.add(orb);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, "rgba(255,42,109,.45)"); g.addColorStop(1, "rgba(255,42,109,0)"); x.fillStyle = g; x.fillRect(0, 0, w, w);
  }), transparent: true, depthWrite: false, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.032; lamp.add(pool); // soft light on the rug
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
  const winLight = new THREE.PointLight(0x5a8fff, 4.5, 9); winLight.position.set(0, 2.2, -6.2); winLight.userData.shadow = 1; scene.add(winLight); // cool city light
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
    const fireLight = new THREE.PointLight(0xff9a3c, 2.4, 5); fireLight.position.set(-3.2, 0.7, -0.7); scene.add(fireLight);
    floorGlow(2.6, 1.2, -3.2, -0.7, "rgba(255,150,60,1)", 0.25);
    animators.push((now, dt) => { if (reduce) return; flameT.offset.x += dt * 0.00012; flames.scale.y = 0.9 + Math.sin(now / 130) * 0.06 + Math.sin(now / 47) * 0.04; fireLight.intensity = 2.2 + Math.sin(now / 90) * 0.3 + Math.sin(now / 37) * 0.2; }); }
  // plants along the window sill, and a tall one by the door
  { const leafC = [0x1fb87a, 0x2bd68f, 0x169a66];
    const plant = (x, y, z, size, tall) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(size); scene.add(g);
      block(0.16, 0.14, 0.16, 0, 0, 0.07, 0, { parent: g, r: 0.03, mat: steelM(0x4a5064) });
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
    block(0.56, 3.0, 0.02, 0x0b0c12, x, 1.65, -16.39, { r: 0.01, ink: false }); // the grille
    [0.7, 1.5, 2.3].forEach((y, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(i === 0 ? 0.2 : 0.14, 0.012, 6, 32), glowMat(i === 1 ? 0xff2a6d : 0x05d9e8, 1.0)); ring.position.set(x, y, -16.37); scene.add(ring); });
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
  const glow = new THREE.PointLight(0x9ad7ff, 5, 11); glow.position.set(-4.5, 2.0, -15.3); glow.userData.shadow = 1; scene.add(glow);
  // seats: two rows of steel-framed recliners, the back one on a riser with a step light
  block(9, 0.3, 2.6, 0x15161f, -4.5, 0.15, -10.3, { ink: false, r: 0.01 });
  tube(8.8, 0.012, 0.012, 0x05d9e8, -4.5, 0.29, -11.6, { k: 0.8 });
  const seat = (x, y, z) => {
    block(0.62, 0.08, 0.7, 0, x, y + 0.06, z, { r: 0.02, mat: steelM(0x4a5064) }); // base
    block(0.82, 0.2, 0.78, 0x2b2f3d, x, y + 0.36, z, { r: 0.08 }); // seat cushion
    block(0.82, 0.8, 0.2, 0x2b2f3d, x, y + 0.78, z + 0.36, { r: 0.08, rot: [-0.12, 0, 0] }); // reclined back
    block(0.5, 0.18, 0.14, 0x353a4c, x, y + 1.12, z + 0.4, { r: 0.06 }); // headrest
    for (const s of [-1, 1]) {
      block(0.1, 0.42, 0.84, 0, x + s * 0.46, y + 0.34, z, { r: 0.03, mat: steelM(0x9aa2b4) }); // steel armrests
      tube(0.012, 0.012, 0.7, 0x05d9e8, x + s * 0.46, y + 0.56, z, { k: 0.9 }); // with a light strip along the top
    }
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
    const kernel = (r) => new THREE.IcosahedronGeometry(r, 0), cream = toon(0xe9d9ad), butter = toon(0xdcb85a);
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
    block(0.3, 0.36, 0.3, 0, 0, 0.18, 0, { parent: g, r: 0.04, mat: steelM(0x4a5064) });
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
const buildKitchen = () => {
  // the counter outline in plan (shape x = world x, shape y = -world z)
  const J = new THREE.Shape();
  J.moveTo(4.6, 2.8); J.lineTo(2.1, 2.8); J.absarc(2.1, 2.2, 0.6, Math.PI / 2, Math.PI, false);
  J.lineTo(1.5, 0.1); J.lineTo(2.1, 0.1); J.lineTo(2.1, 2.2); J.lineTo(4.6, 2.2); J.absarc(4.6, 2.5, 0.3, -Math.PI / 2, Math.PI / 2, false);
  const slabOf = (depth, color, y) => {
    const geo = new THREE.ExtrudeGeometry(J, { depth, bevelEnabled: false, curveSegments: 20 });
    const m = new THREE.Mesh(geo, toon(color)); m.rotation.x = -Math.PI / 2; m.position.y = y; scene.add(m);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lineMat)); return m;
  };
  slabOf(0.95, 0x3a3f4e, 0); // a dark steel body
  slabOf(0.05, 0xd9dde6, 0.95); // a pale composite top
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
  // a steel pan on the front ring with a steak searing in it
  const pan = new THREE.Group(); pan.position.set(1.9, 1.005, -0.76); scene.add(pan);
  const panBody = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.035, 28), steelM(0x8a92a6)); panBody.position.y = 0.018; pan.add(panBody);
  const panInk = new THREE.Mesh(panBody.geometry, inkMat); panInk.scale.set(1.06, 1.15, 1.06); panBody.add(panInk);
  const panIn = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.004, 28), toon(0x23262f)); panIn.position.y = 0.034; pan.add(panIn);
  block(0.028, 0.02, 0.2, 0x1b1e27, 0, 0.03, 0.22, { parent: pan, r: 0.008 }); // the handle, toward the wall
  const steak = new THREE.Group(); steak.position.y = 0.046; steak.rotation.y = 0.5; pan.add(steak);
  block(0.17, 0.028, 0.11, 0x8a4326, 0, 0, 0, { parent: steak, r: 0.012 });
  for (const dx of [-0.05, 0, 0.05]) block(0.012, 0.004, 0.1, 0x3a1a0e, dx, 0.015, 0, { parent: steak, rot: [0, 0.5, 0], r: 0.002, ink: false }); // sear marks
  block(0.06, 0.006, 0.03, 0xf2ece0, 0.07, 0.016, 0.03, { parent: steak, r: 0.003, ink: false }); // a pat of butter
  // a little steam curling up off it
  const puffs = [0, 1, 2, 3].map((i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe8ecf4, transparent: true, opacity: 0, depthWrite: false }));
    m.raycast = () => {}; pan.add(m); return { m, ph: i / 4 };
  });
  animators.push((now) => { if (reduce) return; for (const p of puffs) {
    const t = (now / 2400 + p.ph) % 1; p.m.position.set(Math.sin(t * 6 + p.ph * 9) * 0.04, 0.07 + t * 0.42, Math.cos(t * 5 + p.ph * 7) * 0.03);
    p.m.scale.setScalar(0.5 + t * 1.8); p.m.material.opacity = Math.sin(t * Math.PI) * 0.09;
  } });
  // a slim hood hanging over it, lit underneath
  block(0.7, 0.1, 0.95, 0, 1.8, 2.35, -0.85, { r: 0.02, mat: steelM(0x9aa2b4) });
  tube(0.6, 0.01, 0.85, 0xffe2b8, 1.8, 2.295, -0.85, { k: 0.75 });
  for (const dz of [-0.3, 0.3]) block(0.02, 1.0, 0.02, 0x2a2e3a, 1.8, 2.9, -0.85 + dz, { ink: false });
  const hobLight = new THREE.PointLight(0xffc78a, 1.4, 3); hobLight.position.set(1.8, 2.1, -0.85); scene.add(hobLight);

  // dinner on the long side: three places
  for (const x of [2.6, 3.4, 4.2]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.014, 24), toon(0xf4f3ff)); plate.position.set(x, 1.007, -2.6); scene.add(plate);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 14), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35 }));
    glass.position.set(x + 0.2, 1.06, -2.45); scene.add(glass);
    // a stool outside: steel post, round seat, a glowing foot ring
    const st = new THREE.Group(); st.position.set(x, 0, -3.22); scene.add(st);
    const parts = [
      [new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24), toon(0x2a2e3a), 0.015],
      [new THREE.CylinderGeometry(0.028, 0.028, 0.72, 12), steelM(0xc4cad8), 0.38],
      [new THREE.CylinderGeometry(0.2, 0.18, 0.06, 24), toon(0x2b2f3d), 0.75],
    ];
    for (const [g, m, y] of parts) { const o = new THREE.Mesh(g, m); o.position.y = y; st.add(o); const ink = new THREE.Mesh(g, inkMat); ink.scale.set(1.1, 1.08, 1.1); o.add(ink); }
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 8, 32), glowMat(0x05d9e8, 1.1)); ringM.rotation.x = Math.PI / 2; ringM.position.y = 0.3; st.add(ringM);
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
  let f = 0;
  for (const y of [0.3, 0.8, 1.3, 1.8]) {
    block(0.92, 0.025, 0.36, 0, 0, y, 0, { parent: sh, r: 0.006, mat: steelM(0xc4cad8) });
    for (let x = -0.38; x < 0.4; ) {
      const kind = (f * 7 + Math.round(y * 10)) % 4, c = food[f++ % food.length];
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
  { const l = new THREE.PointLight(0xfff1dc, 1.2, 5); l.position.set(11.6, 2.2, -1.2); scene.add(l); }
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
    loader.load(ph.src, (t) => { t.colorSpace = THREE.SRGBColorSpace; pic.material.map = t; pic.material.color.setScalar(0.88); pic.material.needsUpdate = true; placeLabel(fit(t.image.width / t.image.height)); });
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
  block(0.44, 0.08, 1.9, 0xc2410c, CX + 0.6, 0.5, CZ, { r: 0.03 }); // a burnt-orange cushion
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
  block(0.72, 0.44, 0.025, 0x0b0c12, 0, 1.22, 0.15, { parent: D, r: 0.01 });
  const edC = document.createElement("canvas"); edC.width = 720; edC.height = 420; const edT = new THREE.CanvasTexture(edC); edT.colorSpace = THREE.SRGBColorSpace;
  const drawEditor = (img) => { const x = edC.getContext("2d"); x.fillStyle = "#15161d"; x.fillRect(0, 0, 720, 420);
    x.fillStyle = "#22242e"; x.fillRect(0, 0, 720, 28); x.fillStyle = "#9d9dc0"; x.font = "500 14px 'JetBrains Mono'"; x.fillText("DEVELOP · " + (photos[0]?.caption || "").toUpperCase().slice(0, 40), 12, 19);
    if (img) { const a = img.width / img.height, bw = 500, bh = 360, w = a > bw / bh ? bw : bh * a, hh = a > bw / bh ? bw / a : bh; x.drawImage(img, 20 + (bw - w) / 2, 44 + (bh - hh) / 2, w, hh); }
    x.fillStyle = "#1c1e27"; x.fillRect(540, 28, 180, 392);
    ["EXPOSURE", "CONTRAST", "HIGHLIGHTS", "SHADOWS", "WHITES", "GRAIN"].forEach((k, n) => { x.fillStyle = "#9d9dc0"; x.font = "500 12px 'JetBrains Mono'"; x.fillText(k, 552, 62 + n * 52); x.fillStyle = "#3a3d4a"; x.fillRect(552, 72 + n * 52, 150, 3); x.fillStyle = "#05d9e8"; x.fillRect(552 + 40 + ((n * 37) % 90), 67 + n * 52, 4, 13); });
    edT.needsUpdate = true; };
  drawEditor(null); if (photos[0]) { const im = new Image(); im.onload = () => drawEditor(im); im.src = photos[0].src; }
  const screen = panel(0.68, 0.4, edT, 0, 1.22, 0.135, { parent: D, k: 0.85 }); screen.rotation.y = Math.PI;
  // the film camera: a black body with a silver top plate, the prism hump, a lens, the advance lever and a dial
  const cam = new THREE.Group(); cam.position.set(-0.2, 0.77, -0.1); cam.scale.setScalar(1.25); cam.rotation.y = Math.PI + 0.45; D.add(cam); // lens toward the room
  block(0.15, 0.085, 0.055, 0x1c1f27, 0, 0.0425, 0, { parent: cam, r: 0.01, ink: false });
  block(0.152, 0.022, 0.057, 0, 0, 0.074, 0, { parent: cam, r: 0.006, mat: steelM(0xd4d8e2), ink: false });
  { const prism = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.034, 0.03, 4), steelM(0xd4d8e2)); prism.rotation.y = Math.PI / 4; prism.position.set(0, 0.098, 0); prism.scale.set(1.1, 1, 0.9); cam.add(prism); }
  { const lensC = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.06, 24), toon(0x14161c)); lensC.rotation.x = Math.PI / 2; lensC.position.set(0, 0.042, 0.055); cam.add(lensC);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.003, 6, 24), steelM(0xc4cad8)); ring.position.set(0, 0.042, 0.07); cam.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), new THREE.MeshBasicMaterial({ color: 0x2a3a6a })); glass.position.set(0, 0.042, 0.0851); cam.add(glass);
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.006, 10), new THREE.MeshBasicMaterial({ color: 0xffffff })); glint.position.set(0.008, 0.05, 0.0855); cam.add(glint); }
  block(0.03, 0.004, 0.012, 0, 0.05, 0.088, -0.01, { parent: cam, r: 0.002, mat: steelM(0xd4d8e2), ink: false }); // advance lever
  { const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 16), steelM(0x9aa2b4)); dial.position.set(-0.045, 0.09, 0); cam.add(dial); }
  // the iPhone 17 Pro Max in orange, lying face down so its camera plateau shows (no logos)
  const ph = new THREE.Group(); ph.position.set(0.16, 0.7705, -0.12); ph.rotation.y = Math.PI - 0.3; ph.scale.setScalar(1.25); D.add(ph);
  block(0.078, 0.0083, 0.163, 0xf26a1b, 0, 0.00415, 0, { parent: ph, r: 0.004, ink: false }); block(0.08, 0.004, 0.165, 0x2a1408, 0, 0.002, 0, { parent: ph, r: 0.004, ink: false }); // the body, on its glass front
  block(0.074, 0.003, 0.042, 0xe35f14, 0, 0.0093, 0.056, { parent: ph, r: 0.003, ink: false }); // the full-width camera plateau
  for (const [lx, lz] of [[-0.018, 0.066], [-0.018, 0.046], [0.002, 0.056]]) { const lr = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 20), toon(0x1a1a1e)); lr.position.set(lx, 0.0115, lz); ph.add(lr);
    const lg = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), new THREE.MeshBasicMaterial({ color: 0x23304a })); lg.rotation.x = -Math.PI / 2; lg.position.set(lx, 0.0136, lz); ph.add(lg); }
  { const fl = new THREE.Mesh(new THREE.CircleGeometry(0.003, 10), new THREE.MeshBasicMaterial({ color: 0xfff6dc })); fl.rotation.x = -Math.PI / 2; fl.position.set(0.024, 0.0107, 0.066); ph.add(fl); }
  // a few prints, film canisters and a loupe
  photos.slice(1, 4).forEach((p, k) => { const pr = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff })); pr.rotation.set(-Math.PI / 2, 0, -0.3 + k * 0.35); pr.position.set(0.48 + k * 0.05, 0.772 + k * 0.0006, -0.05 - k * 0.04); D.add(pr);
    loader.load(p.src, (t) => { t.colorSpace = THREE.SRGBColorSpace; pr.material.map = t; pr.material.color.setScalar(0.9); pr.material.needsUpdate = true; }); });
  for (const [cx2, cz2, c] of [[-0.45, -0.15, 0xf9d02a], [-0.5, -0.2, 0x14161c]]) { const fc = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 14), toon(c)); fc.position.set(cx2, 0.795, cz2); D.add(fc); }
  { const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.04, 16), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.6 })); lp.position.set(0.6, 0.792, -0.13); D.add(lp); }
  // a desk lamp, a chair, and a red darkroom safelight on the wall
  { const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 20), steelM(0x6c7389)); base.position.set(-0.62, 0.78, 0.18); D.add(base);
    D.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.62, 0.79, 0.18), V(-0.64, 1.15, 0.14), V(-0.55, 1.28, 0.02), V(-0.46, 1.22, -0.06)]), 20, 0.008, 6), steelM(0xc4cad8)));
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 18, 1, true), steelM(0x2a2e3a)); sh.material.side = THREE.DoubleSide; sh.position.set(-0.45, 1.19, -0.07); D.add(sh);
    const lt = new THREE.PointLight(0xffd9a0, 0.3, 1.2); lt.position.set(-0.45, 1.12, -0.08); D.add(lt); }
  { const ch = new THREE.Group(); ch.position.set(0.05, 0, -0.72); D.add(ch);
    block(0.48, 0.07, 0.46, 0x2b2f3d, 0, 0.5, 0, { parent: ch, r: 0.04 }); block(0.46, 0.5, 0.06, 0x2b2f3d, 0, 0.82, -0.22, { parent: ch, r: 0.04, rot: [0.08, 0, 0] });
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
  { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 14), toon(0xf4f3ff)); cup.position.set(4.55, 0.985, -0.22); scene.add(cup); }
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
      block(0.025, 0.16, 0.02, 0x14161f, hx, 2.32, -1.55, { r: 0.006 }); // handle
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.035, 24), steelM(0x6c7389)); pan.rotation.x = Math.PI / 2; pan.position.set(hx, 2.24 - r, -1.55); scene.add(pan);
      const ink = new THREE.Mesh(pan.geometry, inkMat); ink.scale.set(1.04, 1.2, 1.04); pan.add(ink);
    }
    const ladle = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(4.05, 2.45, -1.55), V(4.05, 2.15, -1.55), V(4.1, 2.06, -1.55)]), 10, 0.008, 6), steelM(0xc4cad8)); scene.add(ladle);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steelM(0xc4cad8)); bowl.position.set(4.12, 2.07, -1.55); scene.add(bowl); }
  // a fruit bowl on the bar
  { const fb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steelM(0x9aa2b4)); fb.material.side = THREE.DoubleSide; fb.position.set(3.0, 1.15, -2.38); scene.add(fb); // the lower half of a sphere: a bowl, open at the top
    [[0xff7a1a, -0.05, 0], [0x2bd68f, 0.05, 0.02], [0xff2a6d, 0, -0.05], [0xf9f002, 0.02, 0.05]].forEach(([c, dx, dz]) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), toon(c)); f.position.set(3.0 + dx, 1.07, -2.38 + dz); scene.add(f); }); } // no thick outline on something this small
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
    block(0.6, 1.1, 0.45, 0x16102e, xx, 0.8, -15.95, { r: 0.05 });
    for (const [yy, rr] of [[1.05, 0.15], [0.62, 0.1]]) { const cone = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.03, 8, 24), toon(0x3a2a75)); cone.position.set(xx, yy, -15.72); scene.add(cone); }
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
  block(0.72, 0.06, 0.6, carpet, 0, top, 0, { parent: g, r: 0.03 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 8, 28), toon(carpet)); rim.rotation.x = Math.PI / 2; rim.position.set(0, top + 0.06, 0); g.add(rim);
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 28), toon(0x454857)); cushion.position.set(0, top + 0.055, 0); g.add(cushion); // fills the ring, so whoever naps here sits up in it
  // a sisal ball on a string, swinging a little (like theirs)
  const pom = new THREE.Group(); pom.position.set(0.3, 0.08 + tall * 0.5, 0.22); g.add(pom);
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), new THREE.MeshBasicMaterial({ color: 0xd6d6e7 })); str.position.y = -0.1; pom.add(str);
  ball(0.045, 0xe0a487, 0, -0.22, 0, { parent: pom });
  const ph = Math.random() * 10; animators.push((now) => { pom.rotation.z = Math.sin(now / 900 + ph) * 0.25; });
  return { g, perch: top + 0.08 };
};
// A round, cushy cat bed.
const catBed = (x, z, R = 0.36) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.02, 0.08, 32), toon(0x4a4d5e)); base.position.y = 0.04; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.1, 10, 36), toon(0x5c6072)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
  const ink = new THREE.Mesh(rim.geometry, inkMat); ink.scale.setScalar(1.04); rim.add(ink);
  return g;
};
// Their toys: Finn's green cactus plush, the wooden ball track, a sparkly purple mouse.
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
const FIN = { fur: 0x9a7b58, stripe: 0x2e241c, chin: 0xf2ece0, saddle: 0x4e3e2e, ruff: 0xc9ab82, inner: 0xe8cdb8, nose: 0xd99a86, eye: 0xe8b52a, size: 1.15, fluffy: true };
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
const PHOEBE = { fur: 0xec9a4c, stripe: 0xbb6128, chin: 0xf8ead4, inner: 0xf4a6b4, nose: 0xf29aa6, eye: 0xc98d32, size: 0.62, lean: true };
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
  if (glassMat) glassMat.uniforms.rainK.value = 1 - winApp;
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
const PARENT = { living: "outside", theater: "living", shelf: "theater", gallery: "living" };
const lineage = (r) => { const c = [r]; while (PARENT[c[0]]) c.unshift(PARENT[c[0]]); return c; };
const routeTo = (from, to) => {
  const a = lineage(from), b = lineage(to); let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return [...a.slice(k - 1, -1).reverse(), ...b.slice(k)];
};
const PATHS = { // waypoints for position and where the camera looks, from → to
  "living>gallery": { pos: [V(0, 1.72, -1.1), V(2.4, 1.72, -3.9), V(5.2, 1.66, -3.6), V(6.4, 1.65, -3.6), V(7.3, 1.65, -3.6)], look: [V(0, 1.45, -7), V(5.9, 1.5, -3.6), V(9, 1.5, -3.6), V(13.1, 1.55, -3.6), V(13.1, 1.55, -3.6)] },
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
    const launch = () => fly(cur, nxt, () => { room = nxt; setRoomUI(); if (through) doorTo = 0; if (nxt === "outside") lockDoor(); if (nxt === "shelf" || cur === "shelf") hopCats(seatCats, nxt === "shelf"); step(i + 1, nxt); });
    if (through && doorOpen < 0.99) { doorTo = 1; setTimeout(launch, reduce ? 0 : 650); } else launch();
  };
  ui.hint.textContent = "";
  step(0, from);
};
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
  nap.userData.hop = { t0, show: !on }; sitter.userData.hop = { t0: t0 + 200, show: on };
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
const composer = new EffectComposer(renderer);
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
  gtao.overrideVisibility = () => { ov(); scene.traverse((o) => { const m = o.material; if (o.isMesh && o.visible && m && (m.transparent || m.toneMapped === false || m.isMeshBasicMaterial)) { gtao._visibilityCache.set(o, o.visible); o.visible = false; } }); };
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
  renderer.setSize(w, h, false); composer.setSize(w, h); gtao?.setSize(w, h);
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
  if (!lite && (flight || Math.abs(doorTo - doorOpen) > 0.002 || now - (frame.shadowT || 0) > 400)) { renderer.shadowMap.needsUpdate = true; frame.shadowT = now; }
  if (lens && !reduce) lens.uniforms.time.value = (now % 10000) / 1000;
  if (glassMat && !reduce) glassMat.uniforms.time.value = now / 1000;
  cv.step(now);
  composer.render();
  cv.render(); // a pulled-out case, on top
};

if (location.search.includes("debug")) window.__house = { camera, scene, go, cv, renderer, get gtao() { return gtao; }, shelfFaces, focus, openWindowApp, closeWindowApp,
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
const buildCity = () => {
  const P = "images/city/", CITY_V = "?v=1793776127"; // bump when the pictures change
  if (lite) { const im = new Image(); im.onload = () => { cityPhoto = im; drawWindow(); }; im.src = P + "flat.jpg" + CITY_V; return; }
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
        eye0: { value: V(0, 1.9, -1.1) }, time: { value: 0 }, rainK: { value: 1 }, reflK: { value: 0.07 }, gain: { value: 0.9 } },
      vertexShader: `varying vec3 vWorld; varying vec2 vUv;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D tSky, tFar, tMid, tDC, tHUD, tDrops; uniform samplerCube tRoom;
        uniform vec3 eye0; uniform float time, rainK, reflK, gain; varying vec3 vWorld; varying vec2 vUv;
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
          vec3 c = texture(tSky, lay(v, 400.0, off * 0.3), b + 0.6).rgb;
          c = over(c, texture(tFar, lay(v, 120.0, off * 0.5), b));
          c = over(c, texture(tMid, lay(v, 45.0, off * 0.8), b));
          c = over(c, texture(tDC, lay(v, 18.0, off), b));
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
          vec3 sharp = city(v, -n * 0.03, -0.5), soft = city(v, vec2(0.0), 0.8);
          float rim = smoothstep(0.45, 1.0, dot(n, n)); // the edge of a drop bends light away: a dark ring
          vec3 drop = sharp * (1.15 - 0.75 * rim) + pow(max(0.0, dot(n, normalize(vec2(-0.5, 0.8)))), 10.0) * 0.5; // and a glint where the room's light catches it
          vec3 col = mix(soft, drop, isDrop);
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

// ---------- start ----------
(async () => {
  await Promise.race([
    Promise.all(["700 140px Rajdhani", "500 34px 'JetBrains Mono'", "500 38px Inter", "600 40px Inter", "italic 400 38px Inter"].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  buildOutside(); buildLiving(); buildTheater(); buildKitchen(); buildKitchenMore(); buildGallery(); buildDecor(); buildHallMore(); buildCats(); buildHolo(); buildCity();
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
      const m = o.material; if (m.map && !m.bumpMap) { o.geometry.computeBoundingBox(); const sz = o.geometry.boundingBox.getSize(V(0, 0, 0)); if (Math.max(sz.x, sz.y, sz.z) > 1.3) { m.bumpMap = m.map; m.bumpScale = 1.4; m.needsUpdate = true; } } }
  });
  drawScreen(null); loadLive();
  resize(); setRoomUI(); aim(VIEWS.outside.pos, VIEWS.outside.look, 0, 0);
  renderer.setAnimationLoop(frame);
  setTimeout(() => ui.load.classList.add("done"), 250); // the shelf photos stream in after; nothing waits on them
})();
