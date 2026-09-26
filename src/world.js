import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';

/* =====================================================================
   ARKA ENERGY — one continuous 3D Kerala world.
   Units are metres. -x = west (sunset, paddy fields, backwaters),
   +x = east (Western Ghats), +z = south (the house faces south).
   ===================================================================== */

const V = THREE.Vector3;
const LOAD = (p, l) => { try { window.ARKA_LOAD && window.ARKA_LOAD.set(p, l); } catch (e) { } };
const breathe = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // hand the main thread back for a frame
LOAD(.14, 'Laying the tiles');
// toNonIndexed() on an already non-indexed geometry just returns it (avoids noisy warnings)
{ const tni = THREE.BufferGeometry.prototype.toNonIndexed; THREE.BufferGeometry.prototype.toNonIndexed = function () { return this.index ? tni.call(this) : this; }; }
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { if (a === b) return x < a ? 0 : 1; const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(20260926);
const R = (a, b) => a + (b - a) * rand();
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, y, o = 4) { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s; }

/* ------------------------------------------------------------------ renderer */
const canvas = document.getElementById('world');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = Math.min(innerWidth, innerHeight) < 700;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
} catch (e) {
  document.documentElement.classList.add('no-webgl');
  window.dispatchEvent(new Event('arka:ready'));
  throw e;
}
const DPR = Math.min(window.devicePixelRatio || 1, isSmall ? 1.5 : 1.75);
const perf = { acc: 0, n: 0, ratio: Math.min(DPR, 1.25), good: 0, hold: 0 };
renderer.setPixelRatio(perf.ratio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.14, 2600);
scene.fog = new THREE.FogExp2(0xe8dcc6, 0.0058);

/* ------------------------------------------------------------------ canvas textures */
function canvasTex(w, h, draw, opt = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opt.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opt.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  return t;
}

// Mangalore clay tiles: 8 x 8 tiles = 3.2 m x 2.8 m of roof. Canvas top = up-slope.
const tileDraw = bump => (g, w, h) => {
  const cols = 8, rows = 8, tw = w / cols, th = h / rows, r = mulberry32(21);
  g.fillStyle = bump ? '#111' : '#4d1f10'; g.fillRect(0, 0, w, h);
  const pal = ['#a4472a', '#b0532f', '#983f25', '#bb6237', '#a24d2c', '#8c3b21', '#b3683e', '#a95a36', '#9d4a2b'];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = col * tw, y = row * th, k = r();
    if (bump) {
      const gr = g.createLinearGradient(0, y, 0, y + th);
      gr.addColorStop(0, '#303030'); gr.addColorStop(.15, '#707070'); gr.addColorStop(.84, '#e0e0e0'); gr.addColorStop(.92, '#ffffff'); gr.addColorStop(1, '#0a0a0a');
      g.fillStyle = gr; g.fillRect(x + 2, y, tw - 4, th);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + tw * .27, y + th * .1, tw * .09, th * .78); g.fillRect(x + tw * .63, y + th * .1, tw * .09, th * .78);
      continue;
    }
    g.fillStyle = pal[Math.floor(k * pal.length)]; g.fillRect(x + 2, y, tw - 4, th);
    const gr = g.createLinearGradient(0, y, 0, y + th);
    gr.addColorStop(0, 'rgba(40,12,4,.62)'); gr.addColorStop(.2, 'rgba(40,12,4,.12)'); gr.addColorStop(.78, 'rgba(255,220,180,.08)');
    gr.addColorStop(.9, 'rgba(255,226,190,.24)'); gr.addColorStop(1, 'rgba(24,6,2,.7)');
    g.fillStyle = gr; g.fillRect(x + 2, y, tw - 4, th);
    g.fillStyle = 'rgba(255,214,176,.12)'; g.fillRect(x + tw * .27, y + th * .12, tw * .08, th * .76); g.fillRect(x + tw * .63, y + th * .12, tw * .08, th * .76);
    g.fillStyle = 'rgba(40,10,0,.2)'; g.fillRect(x + tw * .35, y + th * .12, tw * .03, th * .76); g.fillRect(x + tw * .71, y + th * .12, tw * .03, th * .76);
    for (let i = 0; i < 16; i++) { const px = x + r() * tw, py = y + r() * th, s = r() * 5 + 1; g.fillStyle = r() < .55 ? 'rgba(46,28,18,.2)' : 'rgba(86,96,58,.14)'; g.beginPath(); g.arc(px, py, s, 0, 6.283); g.fill(); }
    if (k > .9) { g.fillStyle = 'rgba(30,20,10,.28)'; g.fillRect(x + 2, y, tw - 4, th); }
  }
  g.fillStyle = bump ? '#000' : 'rgba(24,8,3,.75)';
  for (let col = 0; col <= cols; col++) g.fillRect(col * tw - 2, 0, 4, h);
};

// Laterite blocks: 2 m x 2 m; blocks 0.5 x 0.25 m, porous.
const latDraw = bump => (g, w, h) => {
  const r = mulberry32(5), rows = 8, cols = 4, bh = h / rows, bw = w / cols;
  g.fillStyle = bump ? '#444' : '#5f2a16'; g.fillRect(0, 0, w, h);
  const pal = ['#9c4c2a', '#a8582f', '#8f4224', '#b0643a', '#9a5231', '#a14a27', '#955030'];
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < cols + 1; col++) {
      const x = col * bw + off, y = row * bh;
      g.fillStyle = bump ? `rgb(${180 + r() * 40 | 0},${180 + r() * 40 | 0},${180 + r() * 40 | 0})` : pal[(r() * pal.length) | 0];
      g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      for (let i = 0; i < 150; i++) {
        const px = x + 2 + r() * (bw - 4), py = y + 2 + r() * (bh - 4), rx = r() * 2.1 + .5, ry = rx * (.45 + r() * .7);
        g.fillStyle = bump ? 'rgba(0,0,0,.55)' : (r() < .7 ? 'rgba(62,22,10,.38)' : 'rgba(216,152,92,.26)');
        g.beginPath(); g.ellipse(px, py, rx, ry, r() * 3, 0, 6.283); g.fill();
      }
      if (!bump) { const gr = g.createLinearGradient(0, y, 0, y + bh); gr.addColorStop(0, 'rgba(255,205,160,.10)'); gr.addColorStop(1, 'rgba(40,10,0,.2)'); g.fillStyle = gr; g.fillRect(x + 2, y + 2, bw - 4, bh - 4); }
    }
  }
};

const woodDraw = (base, dark, seed = 9) => (g, w, h) => {
  const r = mulberry32(seed); g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 240; i++) {
    const x = r() * w; g.strokeStyle = `rgba(${dark},${.06 + r() * .2})`; g.lineWidth = r() * 2 + .5; g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * .02 + i) * 3 + (vnoise(i, y * .01) - .5) * 6, y);
    g.stroke();
  }
};

// Mukhappu: carved lattice gable screen. Triangle with apex at top centre.
function latticeDraw(g, w, h) {
  g.fillStyle = '#140b06'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#6e4424'; g.lineWidth = 5;
  for (let x = -h; x < w + h; x += 20) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); }
  g.fillStyle = '#8a5a2e';
  for (let x = 10; x < w; x += 20) for (let y = 10; y < h; y += 20) { g.beginPath(); g.arc(x, y, 2.4, 0, 6.283); g.fill(); }
  g.lineJoin = 'round';
  g.strokeStyle = '#7d4c27'; g.lineWidth = 26; g.beginPath(); g.moveTo(6, h - 6); g.lineTo(w / 2, 8); g.lineTo(w - 6, h - 6); g.closePath(); g.stroke();
  g.strokeStyle = '#3f2512'; g.lineWidth = 5; g.beginPath(); g.moveTo(40, h - 28); g.lineTo(w / 2, 44); g.lineTo(w - 40, h - 28); g.closePath(); g.stroke();
  g.fillStyle = '#8f5d30'; g.beginPath(); g.arc(w / 2, h * .64, h * .1, 0, 6.283); g.fill();
  g.fillStyle = '#c9974f'; g.beginPath(); g.arc(w / 2, h * .64, h * .045, 0, 6.283); g.fill();
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; g.fillStyle = '#6e4424'; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * h * .15, h * .64 + Math.sin(a) * h * .15, h * .04, h * .02, a, 0, 6.283); g.fill(); }
  g.fillStyle = '#56371c'; g.fillRect(0, h - 18, w, 18);
}

// Solar module (landscape): 12 x 6 cells.
const panelDraw = emissive => (g, w, h) => {
  g.fillStyle = emissive ? '#000' : '#aeb7c1'; g.fillRect(0, 0, w, h);
  const m = 7, cols = 12, rows = 6, cw = (w - 2 * m) / cols, ch = (h - 2 * m) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = m + c * cw, y = m + r * ch;
    if (emissive) { g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.strokeRect(x + .7, y + .7, cw - 1.4, ch - 1.4); continue; }
    const gr = g.createLinearGradient(x, y, x + cw, y + ch); gr.addColorStop(0, '#1a2a42'); gr.addColorStop(1, '#0a1321');
    g.fillStyle = gr; g.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    g.fillStyle = 'rgba(160,180,205,.16)'; for (let b = 1; b <= 3; b++) g.fillRect(x + 1, y + ch * b / 4 - .5, cw - 2, 1);
  }
  if (emissive) { g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5); }
};

// Azhi — vertical wooden slats (alpha)
function slatDraw(g, w, h) {
  g.clearRect(0, 0, w, h);
  const wood = g.createLinearGradient(0, 0, 14, 0); wood.addColorStop(0, '#3f2413'); wood.addColorStop(.5, '#6a3f22'); wood.addColorStop(1, '#3a200f');
  for (let x = 0; x < w; x += 32) { g.save(); g.translate(x + 9, 0); g.fillStyle = wood; g.fillRect(0, 0, 14, h); g.restore(); }
  g.fillStyle = '#4a2b16'; g.fillRect(0, 0, w, 16); g.fillRect(0, h - 16, w, 16); g.fillRect(0, h * .5 - 6, w, 12);
}
function barsDraw(g, w, h) {
  g.clearRect(0, 0, w, h);
  for (let x = 12; x < w; x += 26) { const gr = g.createLinearGradient(x, 0, x + 10, 0); gr.addColorStop(0, '#2c180b'); gr.addColorStop(.5, '#7a4a28'); gr.addColorStop(1, '#2c180b'); g.fillStyle = gr; g.fillRect(x, 0, 10, h); for (let y = 30; y < h; y += 56) { g.fillStyle = '#6a3e20'; g.beginPath(); g.ellipse(x + 5, y, 8, 5, 0, 0, 6.283); g.fill(); } }
}
function doorDraw(g, w, h) {
  const r = mulberry32(3);
  g.fillStyle = '#3a1f0f'; g.fillRect(0, 0, w, h);
  woodDraw('#4a2814', '25,10,4', 4)(g, w, h);
  g.strokeStyle = '#2a1509'; g.lineWidth = 6;
  const pw = (w - 30) / 2, ph = (h - 40) / 3;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) { g.strokeRect(15 + i * pw + 6, 20 + j * ph + 6, pw - 12, ph - 12); g.strokeStyle = 'rgba(120,70,30,.5)'; g.lineWidth = 2; g.strokeRect(15 + i * pw + 12, 20 + j * ph + 12, pw - 24, ph - 24); g.strokeStyle = '#2a1509'; g.lineWidth = 6; }
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const x = 15 + i * pw + pw * (a + 1) / 4, y = 20 + j * ph + ph * (b + 1) / 4;
    const gr = g.createRadialGradient(x - 1, y - 1, 0, x, y, 5); gr.addColorStop(0, '#fff2b0'); gr.addColorStop(.4, '#d4a94a'); gr.addColorStop(1, '#6b4a14');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 4.2, 0, 6.283); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(w / 2 - 2, 0, 4, h);
  void r;
}
function floorDraw(g, w, h) {
  const r = mulberry32(12);
  g.fillStyle = '#7e2517'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < .5 ? '40,6,2' : '170,70,50'},${r() * .08})`; g.beginPath(); g.arc(r() * w, r() * h, r() * 14, 0, 6.283); g.fill(); }
  g.strokeStyle = 'rgba(30,5,2,.35)'; g.lineWidth = 1.5; for (let x = 0; x <= w; x += w / 2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(w, x); g.stroke(); }
}
function sandDraw(g, w, h) {
  const r = mulberry32(8);
  g.fillStyle = '#d3bb8f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${r() < .5 ? '120,90,50' : '250,236,205'},${r() * .22})`; g.fillRect(r() * w, r() * h, r() * 2 + .5, r() * 2 + .5); }
  g.strokeStyle = 'rgba(140,110,70,.12)'; g.lineWidth = 1.2; // swept broom arcs of a Kerala muttam
  for (let i = 0; i < 40; i++) { const cx = r() * w, cy = r() * h, rr = 30 + r() * 60, a = r() * 6.28; g.beginPath(); g.arc(cx, cy, rr, a, a + 1.1); g.stroke(); }
}
function leafDraw(g, w, h) {
  // pinnate coconut frond: dense, tapering leaflets either side of a midrib
  g.clearRect(0, 0, w, h);
  const mid = h / 2, r = mulberry32(31);
  for (let x = 10; x < w - 4; x += 3.6) {
    const s = x / w, L = h * .5 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.06)), .6) * (s < .05 ? s / .05 : 1);
    const lw = 3.4 * (1 - s * .45);
    for (const side of [-1, 1]) {
      if (r() < .05) continue; // the odd torn leaflet
      const tx = x + L * .7, ty = mid + side * L * (.92 + r() * .08);
      const sh = 180 + (r() * 60 | 0);
      g.fillStyle = `rgb(${sh},${sh},${sh})`;
      g.beginPath(); g.moveTo(x - lw * .5, mid); g.quadraticCurveTo(x + L * .25, mid + side * L * .55, tx, ty);
      g.quadraticCurveTo(x + L * .32, mid + side * L * .5, x + lw * .5, mid); g.closePath(); g.fill();
    }
  }
  g.fillStyle = '#e8e2c8'; g.fillRect(0, mid - 2.5, w, 5);
}
// shrub cards: leafy clusters with flowers baked in (hibiscus / ixora / jasmine)
const shrubDraw = kind => (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = mulberry32(kind === 'hibiscus' ? 41 : kind === 'ixora' ? 43 : 47);
  const greens = ['#223a14', '#2d4a18', '#3a5c1e', '#1b2f10', '#466b24'];
  for (let i = 0; i < 260; i++) {
    const a = r() * 6.283, rr = Math.sqrt(r()) * w * .44, x = w / 2 + Math.cos(a) * rr, y = h * .55 + Math.sin(a) * rr * .85;
    if (y > h - 4) continue;
    g.fillStyle = greens[(r() * greens.length) | 0]; g.save(); g.translate(x, y); g.rotate(r() * 6.283);
    g.beginPath(); g.ellipse(0, 0, 9 + r() * 7, 3.5 + r() * 2.5, 0, 0, 6.283); g.fill(); g.restore();
  }
  const n = kind === 'plain' ? 0 : 14;
  for (let i = 0; i < n; i++) {
    const a = r() * 6.283, rr = Math.sqrt(r()) * w * .38, x = w / 2 + Math.cos(a) * rr, y = h * .5 + Math.sin(a) * rr * .8;
    if (kind === 'hibiscus') { g.fillStyle = '#c4161c'; for (let k = 0; k < 5; k++) { const b = k / 5 * 6.283; g.beginPath(); g.ellipse(x + Math.cos(b) * 5, y + Math.sin(b) * 5, 6, 4, b, 0, 6.283); g.fill(); } g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(x, y, 2, 0, 6.283); g.fill(); }
    else if (kind === 'ixora') { for (let k = 0; k < 9; k++) { g.fillStyle = k % 2 ? '#ef4b1f' : '#ff6a2a'; g.beginPath(); g.arc(x + (r() - .5) * 12, y + (r() - .5) * 10, 3, 0, 6.283); g.fill(); } }
    else { for (let k = 0; k < 6; k++) { g.fillStyle = '#f7f3e6'; g.beginPath(); g.arc(x + (r() - .5) * 14, y + (r() - .5) * 12, 2.4, 0, 6.283); g.fill(); } }
  }
};
function bananaDraw(g, w, h) {
  const r = mulberry32(17);
  g.clearRect(0, 0, w, h);
  const mid = h / 2;
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, mid);
  for (let x = 0; x <= w; x += 8) { const s = x / w; g.lineTo(x, mid - h * .47 * Math.pow(Math.sin(Math.PI * s), .55)); }
  for (let x = w; x >= 0; x -= 8) { const s = x / w; g.lineTo(x, mid + h * .47 * Math.pow(Math.sin(Math.PI * s), .55)); }
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 34; i++) { const x = 40 + r() * (w - 70), side = r() < .5 ? -1 : 1, len = h * (.18 + r() * .28); g.lineWidth = 1.2 + r() * 1.6; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(x, mid + side * h * .5); g.lineTo(x - 4, mid + side * (h * .5 - len)); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(120,130,60,.55)'; g.lineWidth = 1;
  for (let x = 20; x < w; x += 7) { g.beginPath(); g.moveTo(x, mid); g.lineTo(x - 6, mid - h * .45); g.moveTo(x, mid); g.lineTo(x - 6, mid + h * .45); g.stroke(); }
  g.fillStyle = 'rgba(210,220,150,.9)'; g.fillRect(0, mid - 3, w, 6);
  // dry brown edges
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(150,110,50,.55)'; g.fillRect(0, 0, w, h * .06); g.fillRect(0, h * .94, w, h * .06);
  g.globalCompositeOperation = 'source-over';
}
function grassDraw(g, w, h) {
  const r = mulberry32(77); g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5200; i++) { const x = r() * w, y = r() * h, l = 3 + r() * 7, a = -1.9 + r() * .8, v = 150 + r() * 105 | 0; g.strokeStyle = `rgba(${v},${v + (r() * 20 | 0)},${v - 30},.55)`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${r() < .5 ? '120,95,60' : '235,235,210'},${.08 + r() * .1})`; g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 16, 4 + r() * 10, r() * 3, 0, 6.283); g.fill(); }
}
function plasterDraw(g, w, h) {
  const r = mulberry32(90); g.fillStyle = '#f0eee7'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${r() < .5 ? '120,110,95' : '255,255,250'},${r() * .06})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
  for (let i = 0; i < 26; i++) { const x = r() * w; g.fillStyle = `rgba(110,100,85,${.02 + r() * .04})`; g.fillRect(x, r() * h * .4, 2 + r() * 5, h * (.3 + r() * .7)); }
}
function stoneDraw(g, w, h) {
  const r = mulberry32(33); g.fillStyle = '#39342d'; g.fillRect(0, 0, w, h);
  const pal = ['#6f685d', '#7c7467', '#5e574d', '#8a8174', '#686055', '#746b5c', '#817a70'];
  for (let i = 0; i < 95; i++) {
    const cx = r() * w, cy = r() * h, rad = 16 + r() * 22, n = 7, pts = [];
    for (let k = 0; k < n; k++) { const a = k / n * 6.283 + r() * .5, rr = rad * (.7 + r() * .4); pts.push([cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr * .85]); }
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)); g.closePath();
      g.fillStyle = pal[(i * 7) % pal.length]; g.fill();
      const gr = g.createLinearGradient(cx + ox - rad, cy + oy - rad, cx + ox + rad, cy + oy + rad); gr.addColorStop(0, 'rgba(255,250,235,.16)'); gr.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = gr; g.fill();
    }
  }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${r() < .5 ? '20,18,14' : '200,195,180'},${r() * .12})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
}
function gravelDraw(g, w, h) {
  const r = mulberry32(44); g.fillStyle = '#a8683e'; g.fillRect(0, 0, w, h);
  const pal = ['#c98a58', '#b0703f', '#d9a070', '#8f5532', '#c07d4c', '#9c8c7c', '#e0b080'];
  for (let i = 0; i < 2600; i++) { const x = r() * w, y = r() * h, a = 1.2 + r() * 2.6, b = a * (.6 + r() * .4); g.fillStyle = 'rgba(40,20,8,.35)'; g.beginPath(); g.ellipse(x + .8, y + .9, a, b, r() * 3, 0, 6.283); g.fill(); g.fillStyle = pal[(r() * pal.length) | 0]; g.beginPath(); g.ellipse(x, y, a, b, r() * 3, 0, 6.283); g.fill(); }
}
function broadLeafDraw(g, w, h) {
  const r = mulberry32(12); g.clearRect(0, 0, w, h);
  const greens = ['#3f7424', '#4f8a2c', '#62a034', '#78b440', '#386a20', '#8cc24c', '#9ccc56'];
  for (let i = 0; i < 230; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * w * .45, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d * .9;
    g.save(); g.translate(x, y); g.rotate(r() * 6.283); const L = 12 + r() * 14;
    g.fillStyle = greens[(r() * greens.length) | 0]; g.beginPath(); g.moveTo(0, -L); g.quadraticCurveTo(L * .5, 0, 0, L); g.quadraticCurveTo(-L * .5, 0, 0, -L); g.fill();
    g.strokeStyle = 'rgba(20,40,10,.35)'; g.lineWidth = .8; g.beginPath(); g.moveTo(0, -L); g.lineTo(0, L); g.stroke(); g.restore();
  }
}
function mistDraw(g, w, h) {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / 38, y / 38, 5); const v = Math.pow(clamp((n - .32) / .5), 1.6) * 255;
    const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const T = {
  tile: canvasTex(512, 512, tileDraw(false)), tileB: canvasTex(512, 512, tileDraw(true), { srgb: false }),
  lat: canvasTex(512, 512, latDraw(false)), latB: canvasTex(512, 512, latDraw(true), { srgb: false }),
  wood: canvasTex(256, 256, woodDraw('#51301b', '30,12,4')), woodL: canvasTex(256, 256, woodDraw('#6e4326', '40,18,6', 12)),
  lattice: canvasTex(512, 256, latticeDraw, { repeat: false }),
  panel: canvasTex(512, 256, panelDraw(false), { repeat: false }), panelE: canvasTex(512, 256, panelDraw(true), { srgb: false, repeat: false }),
  slats: canvasTex(256, 256, slatDraw), bars: canvasTex(256, 256, barsDraw),
  door: canvasTex(256, 512, doorDraw, { repeat: false }),
  floor: canvasTex(256, 256, floorDraw), sand: canvasTex(256, 256, sandDraw),
  leaf: canvasTex(512, 128, leafDraw, { repeat: false }), banana: canvasTex(512, 128, bananaDraw, { repeat: false }),
  mist: canvasTex(256, 256, mistDraw, { srgb: false }),
  edge: canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5); }, { srgb: false, repeat: false }),
  grass: canvasTex(256, 256, grassDraw, { srgb: true }),
  plaster: canvasTex(256, 256, plasterDraw), stone: canvasTex(512, 256, stoneDraw), gravel: canvasTex(256, 256, gravelDraw), broad: canvasTex(256, 256, broadLeafDraw, { repeat: false }),
  hibiscus: canvasTex(256, 256, shrubDraw('hibiscus'), { repeat: false }), ixora: canvasTex(256, 256, shrubDraw('ixora'), { repeat: false }),
  jasmine: canvasTex(256, 256, shrubDraw('jasmine'), { repeat: false }), plain: canvasTex(256, 256, shrubDraw('plain'), { repeat: false }),
};

/* ------------------------------------------------------------------ photographic textures */
const IMG = window.ARKA_DATA ? window.ARKA_DATA() : (() => { try { return JSON.parse(document.getElementById('img-data').textContent); } catch (e) { return {}; } })();
const texLoads = []; let texDone = 0;
function normalFromImage(img, strength) {
  const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0); const src = g.getImageData(0, 0, w, h).data, out = g.createImageData(w, h), o = out.data;
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = (src[i * 4] * .3 + src[i * 4 + 1] * .59 + src[i * 4 + 2] * .11) / 255;
  const at = (x, y) => L[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    o[i] = (-dx / len * .5 + .5) * 255; o[i + 1] = (dy / len * .5 + .5) * 255; o[i + 2] = (1 / len * .5 + .5) * 255; o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0); return c;
}
function photoTex(key, normalStrength = 0) {
  if (!IMG[key]) return null;
  const map = new THREE.Texture(), normal = normalStrength ? new THREE.Texture() : null;
  for (const t of [map, normal]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; }
  map.colorSpace = THREE.SRGBColorSpace;
  texLoads.push(new Promise(res => { const im = new Image(); im.onload = () => { texDone++; LOAD(.14 + .3 * texDone / 3, ['Laying the tiles', 'Plastering the walls', 'Growing the lawn'][Math.min(2, texDone - 1)]); map.image = im; map.needsUpdate = true; if (normal) { normal.image = normalFromImage(im, normalStrength); normal.needsUpdate = true; } res(); }; im.onerror = res; im.src = IMG[key]; }));
  return { map, normal };
}
const PT = { tile: photoTex('tex-tile', 2.4), lat: photoTex('tex-lat', 2.0), grass: photoTex('tex-grass', 0) };

/* ------------------------------------------------------------------ materials */
const std = o => new THREE.MeshStandardMaterial(o);
const M = {
  tile: PT.tile ? std({ map: PT.tile.map, color: 0xa8877a, normalMap: PT.tile.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughness: .8, side: THREE.DoubleSide }) : std({ map: T.tile, bumpMap: T.tileB, bumpScale: 1.6, roughness: .84, side: THREE.DoubleSide }),
  under: std({ map: T.wood, color: 0x9a7760, roughness: .9, side: THREE.DoubleSide }),
  lat: PT.lat ? std({ map: PT.lat.map, normalMap: PT.lat.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: .95 }) : std({ map: T.lat, bumpMap: T.latB, bumpScale: 1.8, roughness: .96 }),
  plinth: PT.lat ? std({ map: PT.lat.map, normalMap: PT.lat.normal, color: 0xc9b3a4, roughness: .95 }) : std({ map: T.lat, bumpMap: T.latB, bumpScale: 1.8, color: 0xc7aa98, roughness: .96 }),
  wood: std({ map: T.wood, roughness: .6 }),
  woodL: std({ map: T.woodL, roughness: .64 }),
  lattice: std({ map: T.lattice, emissiveMap: T.lattice, emissive: new THREE.Color(1, .55, .25), emissiveIntensity: 0, roughness: .8, side: THREE.DoubleSide }),
  ridge: std({ color: 0x74341b, roughness: .78 }),
  plaster: std({ color: 0xeee2cc, roughness: .95 }),
  granite: std({ color: 0x8c877d, roughness: .86 }),
  floor: std({ map: T.floor, roughness: .28 }),
  slats: std({ map: T.slats, alphaTest: .35, alphaToCoverage: true, roughness: .7, side: THREE.DoubleSide }),
  bars: std({ map: T.bars, alphaTest: .35, alphaToCoverage: true, roughness: .7, side: THREE.DoubleSide }),
  door: std({ map: T.door, roughness: .55, metalness: .05, side: THREE.DoubleSide }),
  brass: std({ color: 0xc89b4a, roughness: .32, metalness: .9 }),
  terracotta: std({ color: 0xa9532e, roughness: .9 }),
  sand: std({ map: T.sand, roughness: 1 }),
  glow: new THREE.MeshBasicMaterial({ color: 0x1a0f08, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  village: new THREE.MeshBasicMaterial({ color: 0x1a0f08, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  sodium: new THREE.MeshBasicMaterial({ color: 0x20180c }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffb24a, transparent: true, opacity: 0, depthWrite: false }),
  frame: std({ color: 0xb9c0c8, roughness: .35, metalness: .85 }),
  wall: std({ map: T.plaster, color: 0xf6f4ee, roughness: .92 }),
  redox: std({ color: 0x6a2320, roughness: .32, metalness: .02 }),
  stone: std({ map: T.stone, roughness: .95 }),
  coping: std({ color: 0x96938b, roughness: .95 }),
  mortar: std({ color: 0x2e2a24, roughness: 1 }),
  gravel: std({ map: T.gravel, roughness: 1 }),
  steel: std({ color: 0xd0d5d9, roughness: .24, metalness: .9 }),
  eqWhite: std({ color: 0xeceeec, roughness: .32 }),
  eqGrey: std({ color: 0xa9b0b4, roughness: .38, metalness: .4 }),
  conduit: std({ color: 0xdadcd8, roughness: .5 }),
  cable: std({ color: 0x131415, roughness: .55 }),
  pole: std({ color: 0x9a9892, roughness: .9 }),
  clay: std({ color: 0x9c4a26, roughness: .85 }),
};
T.slats.repeat.set(1, 1);

M.wall.onBeforeCompile = sh => {
  sh.vertexShader = 'varying vec3 vWW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  sh.fragmentShader = 'varying vec3 vWW;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    float damp = 1. - smoothstep(.9, 1.9, vWW.y) * .9; float n = fract(sin(dot(floor(vWW.xz*3.), vec2(12.9,78.2)))*43758.5);
    diffuseColor.rgb *= mix(1., mix(.7, .82, n), damp * .55);`);
};
// Terracotta ages unevenly: soot, moss and sun-bleached patches across the roof.
M.tile.onBeforeCompile = sh => {
  sh.vertexShader = 'varying vec3 vTW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  sh.fragmentShader = `varying vec3 vTW;
    float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }
  ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    float lum = dot(diffuseColor.rgb, vec3(.3,.59,.11)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.32, 1.02, .82), .42);
    float wn = tn(vTW.xz * .35) * .6 + tn(vTW.xz * 1.3 + 7.) * .4;
    diffuseColor.rgb *= mix(.66, 1.05, wn);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.28,.3,.2) * diffuseColor.rgb * 2.2, smoothstep(.72, .92, tn(vTW.xz * .6 + 3.)) * .22);`);
};
// Solar glass with a light sweep that travels across the arrays.
const panelU = { uTime: { value: 0 }, uSweep: { value: .6 }, uSweepCol: { value: new THREE.Color(1.0, .62, .28) }, uGridGlow: { value: 0 } };
M.panel = std({ map: T.panel, emissiveMap: T.panelE, emissive: new THREE.Color(0xff9a3c), emissiveIntensity: 0, roughness: .16, metalness: .55 });
M.panel.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, panelU);
  sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vec4 wq = vec4(transformed,1.0);
    #ifdef USE_INSTANCING
      wq = instanceMatrix * wq;
    #endif
    vW = (modelMatrix * wq).xyz;`);
  sh.fragmentShader = 'uniform float uTime; uniform float uSweep; uniform vec3 uSweepCol; uniform float uGridGlow; varying vec3 vW;\n' +
    sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    float lines = texture2D(emissiveMap, vEmissiveMapUv).r;
    float s = dot(vW, normalize(vec3(.25,.0,1.0)));
    float band = exp(-pow(mod(s - uTime*5.5, 46.0) - 23.0, 2.0) * .06);
    totalEmissiveRadiance += uSweepCol * band * uSweep * (.28 + .9*lines);
    totalEmissiveRadiance += vec3(1.0,.55,.2) * lines * uGridGlow;`);
};

/* ------------------------------------------------------------------ geometry helpers */
function polyGeom(polys) {
  const pos = [], uv = [], a = new V(), b = new V(), c = new V(), n = new V();
  for (const P of polys) {
    let p = P.pts.map(q => q.clone()), uvs = P.uvs ? P.uvs.slice() : null;
    a.copy(p[0]); b.copy(p[1]); c.copy(p[2]); n.subVectors(b, a).cross(c.clone().sub(a));
    if (P.n && n.dot(P.n) < 0) { p.reverse(); if (uvs) uvs.reverse(); }
    for (let i = 1; i < p.length - 1; i++) for (const k of [0, i, i + 1]) {
      const q = p[k]; pos.push(q.x, q.y, q.z);
      if (uvs) uv.push(uvs[k][0], uvs[k][1]);
      else if (P.u) { const d = q.clone().sub(P.o); uv.push(d.dot(P.u) / (P.su || 1), d.dot(P.v) / (P.sv || 1)); }
      else uv.push(0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function boxW(w, h, d, su = 1.8, sv = 1.35) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / su, uv.getY(k) * dims[f][1] / sv); }
  return g;
}
function rodGeo(p0, p1, r, seg = 6) {
  const d = new V().subVectors(p1, p0), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1); g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()));
  g.translate(p0.x, p0.y, p0.z);
  return g;
}
function mesh(geo, mat, parent, x = 0, y = 0, z = 0, ry = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = cast; m.receiveShadow = true; if (parent) parent.add(m); return m;
}
// Bake a static group into one mesh per material (keeps draw calls low).
function bake(group, keepPred = () => false) {
  group.updateMatrixWorld(true);
  const buckets = new Map(), keep = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh || o.userData.keep || keepPred(o) || Array.isArray(o.material)) { keep.push(o); return; }
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    const key = o.material.uuid + (o.castShadow ? 'c' : 'n');
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: o.castShadow });
    buckets.get(key).geos.push(g);
  });
  const out = new THREE.Group();
  for (const { mat, geos, cast } of buckets.values()) { const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.castShadow = cast; m.receiveShadow = true; out.add(m); }
  for (const k of keep) out.attach(k);
  return out;
}

/* ------------------------------------------------------------------ Kerala roofs */
const TILE_SU = PT.tile ? 1.64 : 3.2, TILE_SV = PT.tile ? 2.3 : 2.8;   // photo: 4 tiles across, 6 courses up
// Hip-and-gable roof, ridge along local x, gables (mukhappu) at ±x. Eave edge at y=0.
function hipGableRoof({ W, D, pitch, gable = .5, kodi = true, rafters = true }) {
  const G = new THREE.Group(), t = Math.tan(pitch), h = D / 2 * t, yg = h * (1 - gable), xg = W / 2 - yg / t, Dg = D - 2 * yg / t;
  const A = new V(-W / 2, 0, D / 2), B = new V(W / 2, 0, D / 2), Cc = new V(W / 2, 0, -D / 2), Dd = new V(-W / 2, 0, -D / 2);
  const E = new V(xg, yg, Dg / 2), F = new V(xg, yg, -Dg / 2), Gp = new V(-xg, yg, -Dg / 2), Hp = new V(-xg, yg, Dg / 2);
  const R1 = new V(xg, h, 0), R0 = new V(-xg, h, 0);
  const upF = new V(0, h, -D / 2).normalize(), upB = new V(0, h, D / 2).normalize();
  const upR = new V(-(W / 2 - xg), yg, 0).normalize(), upL = new V(W / 2 - xg, yg, 0).normalize();
  const faces = [
    { pts: [A, B, E, R1, R0, Hp], n: new V(0, 1, 1), u: new V(1, 0, 0), v: upF, o: A },
    { pts: [Cc, Dd, Gp, R0, R1, F], n: new V(0, 1, -1), u: new V(-1, 0, 0), v: upB, o: Cc },
    { pts: [B, Cc, F, E], n: new V(1, 1, 0), u: new V(0, 0, -1), v: upR, o: B },
    { pts: [Dd, A, Hp, Gp], n: new V(-1, 1, 0), u: new V(0, 0, 1), v: upL, o: Dd },
  ].map(f => ({ ...f, su: TILE_SU, sv: TILE_SV }));
  mesh(polyGeom(faces), M.tile, G);
  // underside (wooden soffit)
  const under = faces.map(f => { const nn = f.n.clone().normalize(); const off = nn.clone().multiplyScalar(-.16); return { pts: f.pts.map(p => p.clone().add(off)), n: nn.clone().negate(), u: f.u, v: f.v, o: f.o, su: 1.2, sv: 1.2 }; });
  mesh(polyGeom(under), M.under, G, 0, 0, 0, 0, false);
  // fascia boards
  const fas = [[A, B], [B, Cc], [Cc, Dd], [Dd, A]].map(([p, q]) => {
    const dn = new V(0, -.3, 0), out = new V().subVectors(q, p).cross(new V(0, 1, 0)).normalize().negate();
    return { pts: [p.clone(), q.clone(), q.clone().add(dn), p.clone().add(dn)], n: out, u: new V().subVectors(q, p).normalize(), v: new V(0, 1, 0), o: p, su: 1, sv: 1 };
  });
  mesh(polyGeom(fas), M.wood, G);
  // gable screens (recessed)
  const gi = .12;
  mesh(polyGeom([
    { pts: [new V(xg - gi, yg, Dg / 2 - .05), new V(xg - gi, yg, -Dg / 2 + .05), new V(xg - gi, h - .05, 0)], uvs: [[0, 0], [1, 0], [.5, 1]], n: new V(1, 0, 0) },
    { pts: [new V(-xg + gi, yg, -Dg / 2 + .05), new V(-xg + gi, yg, Dg / 2 - .05), new V(-xg + gi, h - .05, 0)], uvs: [[0, 0], [1, 0], [.5, 1]], n: new V(-1, 0, 0) },
  ]), M.lattice, G);
  // ridge, hips, barge boards, gable beam
  const rods = [rodGeo(R0.clone().add(new V(-.25, .06, 0)), R1.clone().add(new V(.25, .06, 0)), .11, 6)];
  for (const [p, q] of [[B, E], [Cc, F], [Dd, Gp], [A, Hp]]) rods.push(rodGeo(p.clone().add(new V(0, .06, 0)), q.clone().add(new V(0, .06, 0)), .085, 6));
  mesh(mergeGeometries(rods.map(g => g.toNonIndexed())), M.ridge, G);
  const barge = [];
  for (const s of [1, -1]) {
    const e1 = new V(s * xg, yg, Dg / 2 + .08), e2 = new V(s * xg, yg, -Dg / 2 - .08), top = new V(s * xg, h + .05, 0);
    barge.push(rodGeo(e1, top, .07, 5), rodGeo(e2, top, .07, 5), rodGeo(new V(s * xg, yg - .02, Dg / 2), new V(s * xg, yg - .02, -Dg / 2), .09, 5));
    if (kodi) { const c = new THREE.QuadraticBezierCurve3(top.clone(), top.clone().add(new V(s * .45, .04, 0)), top.clone().add(new V(s * .6, .75, 0))); barge.push(new THREE.TubeGeometry(c, 10, .05, 5, false)); }
  }
  mesh(mergeGeometries(barge.map(g => g.index ? g.toNonIndexed() : g).map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })), M.wood, G);
  // rafter tails under the long eaves
  if (rafters) {
    const rg = [];
    for (const side of [1, -1]) for (let x = -W / 2 + .5; x <= W / 2 - .5; x += .55) {
      const b = new THREE.BoxGeometry(.07, .11, .8); b.rotateX(side * pitch); b.translate(x, -.2, side * (D / 2 - .45)); rg.push(b.toNonIndexed());
    }
    mesh(mergeGeometries(rg), M.woodL, G, 0, 0, 0, 0, false);
  }
  return G;
}

// Nalukettu: four wings around an open courtyard — one continuous "donut" roof.
function nalukettuRoof({ x0, x1, z0, z1, d, pitch, eaveY, oOut = 1.3, oIn = .55 }) {
  const G = new THREE.Group(), t = Math.tan(pitch), rY = eaveY + d / 2 * t, oY = eaveY - oOut * t, iY = eaveY - oIn * t;
  const o = oOut + d, r = d / 2;
  const O = [new V(x0 - o, oY, z1 + o), new V(x1 + o, oY, z1 + o), new V(x1 + o, oY, z0 - o), new V(x0 - o, oY, z0 - o)];
  const Rr = [new V(x0 - r, rY, z1 + r), new V(x1 + r, rY, z1 + r), new V(x1 + r, rY, z0 - r), new V(x0 - r, rY, z0 - r)];
  const I = [new V(x0 + oIn, iY, z1 - oIn), new V(x1 - oIn, iY, z1 - oIn), new V(x1 - oIn, iY, z0 + oIn), new V(x0 + oIn, iY, z0 + oIn)];
  const outN = [new V(0, 1, 1), new V(1, 1, 0), new V(0, 1, -1), new V(-1, 1, 0)];
  const faces = [], frames = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, u = new V().subVectors(O[j], O[i]).normalize();
    const em = O[i].clone().add(O[j]).multiplyScalar(.5), rm = Rr[i].clone().add(Rr[j]).multiplyScalar(.5), v = new V().subVectors(rm, em).normalize();
    faces.push({ pts: [O[i], O[j], Rr[j], Rr[i]], n: outN[i], u, v, o: O[i], su: TILE_SU, sv: TILE_SV });
    let n = new V().crossVectors(u, v); if (n.y < 0) n.negate();
    frames.push({ o: em, u, v, n, len: em.distanceTo(rm), width: O[i].distanceTo(O[j]), inner: false });
    const vi = new V().subVectors(rm, I[i].clone().add(I[j]).multiplyScalar(.5)).normalize();
    const inN = outN[(i + 2) % 4];
    faces.push({ pts: [Rr[i], Rr[j], I[j], I[i]], n: inN, u, v: vi, o: I[i], su: TILE_SU, sv: TILE_SV });
    const im = I[i].clone().add(I[j]).multiplyScalar(.5); let ni = new V().crossVectors(u, vi); if (ni.y < 0) ni.negate();
    frames.push({ o: im, u, v: vi, n: ni, len: im.distanceTo(rm), width: I[i].distanceTo(I[j]), inner: true });
  }
  mesh(polyGeom(faces), M.tile, G);
  const under = faces.map(f => { const nn = f.n.clone().normalize(); const off = nn.clone().multiplyScalar(-.16); return { pts: f.pts.map(p => p.clone().add(off)), n: nn.clone().negate(), u: f.u, v: f.v, o: f.o, su: 1.2, sv: 1.2 }; });
  mesh(polyGeom(under), M.under, G, 0, 0, 0, 0, false);
  const fas = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (const [p, q, s] of [[O[i], O[j], 1], [I[i], I[j], -1]]) {
      const out = new V().subVectors(q, p).cross(new V(0, 1, 0)).normalize().multiplyScalar(-s), dn = new V(0, -.28, 0);
      fas.push({ pts: [p.clone(), q.clone(), q.clone().add(dn), p.clone().add(dn)], n: out, u: new V().subVectors(q, p).normalize(), v: new V(0, 1, 0), o: p, su: 1, sv: 1 });
    }
  }
  mesh(polyGeom(fas), M.wood, G);
  const rods = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; const up = new V(0, .06, 0); rods.push(rodGeo(Rr[i].clone().add(up), Rr[j].clone().add(up), .11, 6), rodGeo(O[i].clone().add(up), Rr[i].clone().add(up), .085, 6), rodGeo(I[i].clone().add(up), Rr[i].clone().add(up), .07, 6)); }
  mesh(mergeGeometries(rods.map(g => g.toNonIndexed())), M.ridge, G);
  return { group: G, frames };
}

/* ------------------------------------------------------------------ the tharavadu */
const lights = { window: [] };
const FLAMES = [], DIYAS = [];
const panelMatrices = [], railGeos = [], hookGeos = [], ARRAYS = [];
function solarArray(frame, cols, rows, vStart, uOff = 0, pw = 1.95, ph = 1.0, gap = .06) {
  const { o, u, v, n } = frame, w = new V().crossVectors(u, n), basis = new THREE.Matrix4().makeBasis(u, n, w);
  const totalW = cols * pw + (cols - 1) * gap;
  const at = (uc, vc, nc) => o.clone().addScaledVector(u, uc).addScaledVector(v, vc).addScaledVector(n, nc);
  const place = (g, p) => { g.applyMatrix4(basis); g.translate(p.x, p.y, p.z); return g.toNonIndexed(); };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const uc = uOff - totalW / 2 + pw / 2 + c * (pw + gap), vc = vStart + ph / 2 + r * (ph + gap);
    const m = new THREE.Matrix4().copy(basis); m.setPosition(at(uc, vc, .1));
    panelMatrices.push(m);
  }
  // two aluminium rails under each row, carried on stainless hooks that slip between the tile courses
  for (let r = 0; r < rows; r++) {
    const vc = vStart + ph / 2 + r * (ph + gap);
    for (const dv of [-ph * .27, ph * .27]) {
      railGeos.push(place(new THREE.BoxGeometry(totalW + .14, .045, .042), at(uOff, vc + dv, .0545)));
      const nh = Math.max(2, Math.round(totalW / 1.15) + 1);
      for (let k = 0; k < nh; k++) {
        const uc = uOff - totalW / 2 + .2 + k * (totalW - .4) / (nh - 1);
        hookGeos.push(place(new THREE.BoxGeometry(.045, .006, .2), at(uc, vc + dv + .1, .004)));     // strap on the tile, up-slope
        hookGeos.push(place(new THREE.BoxGeometry(.045, .05, .008), at(uc, vc + dv + .004, .026)));  // riser to the rail
        hookGeos.push(place(new THREE.BoxGeometry(.045, .008, .05), at(uc, vc + dv - .012, .05)));   // lip under the rail
      }
    }
  }
  ARRAYS.push(at(uOff, vStart + (rows * ph + (rows - 1) * gap) / 2, .1));
}

function lathePillar(h) {
  const pts = [[.17, 0], [.17, .1], [.13, .15], [.12, .28], [.145, .33], [.11, .4], [.1, h - .5], [.13, h - .44], [.1, h - .38], [.12, h - .3], [.16, h - .22], [.16, h]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 12);
}

function buildHouse() {
  const H = new THREE.Group();
  const P = .8;
  // ---- plinth (thara) of laterite
  mesh(boxW(16, P, 5), M.plinth, H, 0, P / 2, 2.5);
  mesh(boxW(16, P, 5), M.plinth, H, 0, P / 2, -7.5);
  mesh(boxW(5, P, 5), M.plinth, H, -5.5, P / 2, -2.5);
  mesh(boxW(5, P, 5), M.plinth, H, 5.5, P / 2, -2.5);
  mesh(boxW(18.8, P, 7.2), M.plinth, H, 0, P / 2, 8.6);
  mesh(boxW(5.2, P, 2.8), M.plinth, H, 0, P / 2, 13.6);
  mesh(new THREE.BoxGeometry(19.1, .12, .3), M.redox, H, 0, P - .05, 12.15);
  mesh(new THREE.BoxGeometry(5.5, .12, .3), M.redox, H, 0, P - .05, 15.0);
  mesh(new THREE.BoxGeometry(3.4, .534, .42), M.redox, H, 0, .267, 15.21);
  mesh(new THREE.BoxGeometry(3.4, .267, .42), M.redox, H, 0, .133, 15.63);
  // a white band along the plinth face, as in old tharavadus
  mesh(new THREE.BoxGeometry(18.84, .34, .02), M.wall, H, 0, .38, 12.21); for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(.02, .34, 2.8), M.wall, H, sx * 2.61, .38, 13.6);
  // courtyard (nadumuttam), sunken with granite floor and a tulsi thara
  mesh(new THREE.BoxGeometry(6, .45, 5), M.granite, H, 0, .225, -2.5);
  mesh(boxW(.8, .75, .8, 1, 1), M.lat, H, 0, .45 + .375, -2.5);
  mesh(new THREE.BoxGeometry(.95, .08, .95), M.granite, H, 0, 1.24, -2.5);
  // floors: polished red-oxide
  mesh(new THREE.BoxGeometry(18.8, .02, 2.2), M.floor, H, 0, P + .01, 11.1);
  mesh(new THREE.BoxGeometry(5.2, .02, 2.8), M.floor, H, 0, P + .01, 13.6);
  for (const [w, d, x, z] of [[8.4, 1.2, 0, .6], [8.4, 1.2, 0, -5.6], [1.2, 5, -3.6, -2.5], [1.2, 5, 3.6, -2.5]]) mesh(new THREE.BoxGeometry(w, .02, d), M.floor, H, x, P + .01, z);

  // ---- nalukettu ring walls
  const WY = 3.4, wh = WY - P;
  mesh(boxW(.3, wh, 15), M.lat, H, -7.85, P + wh / 2, -2.5);
  mesh(boxW(.3, wh, 15), M.lat, H, 7.85, P + wh / 2, -2.5);
  mesh(boxW(16, wh, .3), M.lat, H, 0, P + wh / 2, -9.85);
  mesh(new THREE.BoxGeometry(8.4, wh, .2), M.plaster, H, 0, P + wh / 2, 1.2);
  mesh(new THREE.BoxGeometry(8.4, wh, .2), M.plaster, H, 0, P + wh / 2, -6.2);
  mesh(new THREE.BoxGeometry(.2, wh, 7.4), M.plaster, H, -4.2, P + wh / 2, -2.5);
  mesh(new THREE.BoxGeometry(.2, wh, 7.4), M.plaster, H, 4.2, P + wh / 2, -2.5);
  for (const [x, z, ry] of [[0, 1.09, 0], [0, -6.09, Math.PI], [-4.09, -2.5, -Math.PI / 2], [4.09, -2.5, Math.PI / 2]]) {
    const d = mesh(new THREE.PlaneGeometry(1.3, 2.2), M.door, H, x, P + 1.1, z, ry, false); d.userData.keep = false;
  }
  const pil = [];
  for (const [x, z] of [[-3, 0], [-1, 0], [1, 0], [3, 0], [3, -2.5], [3, -5], [1, -5], [-1, -5], [-3, -5], [-3, -2.5]]) pil.push([x, z, WY - P]);

  // side windows on the ring (laterite walls, wooden grilles, warm light behind)
  const winGeo = [];
  function windowAt(x, z, ry, w = 1.2, h = 1.35, y = 1.35) {
    const g = new THREE.Group(); g.position.set(x, y + h / 2, z); g.rotation.y = ry; H.add(g);
    mesh(new THREE.PlaneGeometry(w, h), M.glow, g, 0, 0, .014, 0, false);
    const bars = new THREE.PlaneGeometry(w, h); const uv = bars.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 1.8, uv.getY(i) * h);
    mesh(bars, M.bars, g, 0, 0, .034, 0, false);
    const fr = []; for (const [fw, fh, fx, fy] of [[w + .3, .16, 0, h / 2 + .08], [w + .3, .18, 0, -h / 2 - .09], [.15, h, -w / 2 - .075, 0], [.15, h, w / 2 + .075, 0]]) { const b = new THREE.BoxGeometry(fw, fh, .22); b.translate(fx, fy, 0); fr.push(b.toNonIndexed()); }
    mesh(mergeGeometries(fr), M.wood, g);
    for (const s of [-1, 1]) { const sh = mesh(new THREE.BoxGeometry(w / 2, h, .05), M.woodL, g, 0, 0, 0); sh.position.set(s * (w / 2 + w / 4 * Math.cos(1.1)), 0, .05 + w / 4 * Math.sin(1.1)); sh.rotation.y = -s * 1.1; }
    winGeo.push(g);
  }
  for (const z of [-7.5, -4, -.5, 3]) { windowAt(-8.02, z, -Math.PI / 2); windowAt(8.02, z, Math.PI / 2); }
  for (const x of [-5, 0, 5]) windowAt(x, -10.02, Math.PI);

  // ---- malika: two-storey front block
  const MX = 9.4;
  mesh(boxW(MX * 2, 2.8, .3), M.lat, H, 0, P + 1.4, 9.85);
  mesh(boxW(.3, 2.8, 5), M.lat, H, -MX + .15, P + 1.4, 7.5);
  mesh(boxW(.3, 2.8, 5), M.lat, H, MX - .15, P + 1.4, 7.5);
  mesh(boxW(MX * 2, 2.8, .3), M.lat, H, 0, P + 1.4, 5.15);
  // floor band
  mesh(new THREE.BoxGeometry(MX * 2 + .3, .26, 5.3), M.wood, H, 0, 3.73, 7.5);
  // upper floor: glowing core + azhi slats + posts
  const core = mesh(new THREE.BoxGeometry(MX * 2 - .5, 2.55, 4.5), M.glow, H, 0, 5.12, 7.5, 0, true);
  const slatF = new THREE.PlaneGeometry(MX * 2 - .4, 2.55); { const uv = slatF.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (MX * 2 - .4) * 1.1, uv.getY(i)); }
  mesh(slatF, M.slats, H, 0, 5.12, 9.78, 0, false);
  const slatS = new THREE.PlaneGeometry(4.6, 2.55); { const uv = slatS.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4.6 * 1.1, uv.getY(i)); }
  mesh(slatS, M.slats, H, -MX + .18, 5.12, 7.5, Math.PI / 2, false);
  mesh(slatS.clone(), M.slats, H, MX - .18, 5.12, 7.5, Math.PI / 2, false);
  for (let x = -MX + .2; x <= MX - .1; x += (MX * 2 - .4) / 8) mesh(new THREE.BoxGeometry(.18, 2.6, .18), M.wood, H, x, 5.12, 9.82);
  mesh(new THREE.BoxGeometry(MX * 2, .18, .22), M.wood, H, 0, 6.35, 9.82);
  // front door (one leaf ajar) with warm light behind
  mesh(new THREE.PlaneGeometry(1.8, 2.4), M.glow, H, 0, P + 1.2, 9.68, 0, false);
  const dfr = []; for (const [fw, fh, fx, fy] of [[2.5, .3, 0, 2.55], [.32, 2.5, -1.06, 1.25], [.32, 2.5, 1.06, 1.25], [2.3, .1, 0, 0]]) { const b = new THREE.BoxGeometry(fw, fh, .42); b.translate(fx, fy, 0); dfr.push(b.toNonIndexed()); }
  mesh(mergeGeometries(dfr), M.wood, H, 0, P, 10.02);
  const leafL = mesh(new THREE.BoxGeometry(.9, 2.4, .08), M.door, H, 0, P + 1.2, 9.98); leafL.geometry.translate(.45, 0, 0); leafL.position.x = -.9; leafL.rotation.y = -.25;
  const leafR = mesh(new THREE.BoxGeometry(.9, 2.4, .08), M.door, H, 0, P + 1.2, 9.98); leafR.geometry.translate(-.45, 0, 0); leafR.position.x = .9; leafR.rotation.y = .95;
  for (const x of [-7.9, -5.6, 5.6, 7.9]) windowAt(x, 10.02, 0, 1.25, 1.35, 1.35);

  // malika roof — the dominant tharavadu silhouette
  const mroof = hipGableRoof({ W: MX * 2 + 3, D: 8, pitch: THREE.MathUtils.degToRad(40), gable: .5 });
  const mEave = 6.4 - 1.5 * Math.tan(THREE.MathUtils.degToRad(40));
  mroof.position.set(0, mEave, 7.5); H.add(mroof);
  // south-facing arrays on the malika roof, framed by tile courses either side of the mukhappu
  { const hR = 4 * Math.tan(THREE.MathUtils.degToRad(40)); const v = new V(0, hR, -4).normalize(); const u = new V(1, 0, 0); const n = new V().crossVectors(u, v);
    const fr = { o: new V(0, mEave, 11.5), u, v, n };
    solarArray(fr, 3, 2, 1.25, -5.35); solarArray(fr, 3, 2, 1.25, 5.35); }

  // ---- front veranda: pillars, charupadi benches, lean-to (chaypu) roof
  const verZ = 11.9;
  const vx = [-9.1, -6.9, -4.7, -2.9, 2.9, 4.7, 6.9, 9.1];
  const vTop = 3.82 - (verZ - 10) * Math.tan(THREE.MathUtils.degToRad(20)) - .12;
  for (const x of vx) pil.push([x, verZ, vTop - P - .2]);
  mesh(new THREE.BoxGeometry(6.6, .2, .26), M.wood, H, -6.1, vTop - .1, verZ);
  mesh(new THREE.BoxGeometry(6.6, .2, .26), M.wood, H, 6.1, vTop - .1, verZ);
  function charupadi(xa, xb) {
    const L = xb - xa, cx = (xa + xb) / 2, g = new THREE.Group(); g.position.set(cx, P, verZ - .05); H.add(g);
    mesh(new THREE.BoxGeometry(L, .07, .46), M.woodL, g, 0, .45, 0);
    mesh(new THREE.BoxGeometry(L, .45, .06), M.wood, g, 0, .225, .2);
    const rail = []; const lean = .32;
    for (let x = -L / 2 + .06; x <= L / 2 - .05; x += .11) rail.push(rodGeo(new V(x, .48, .2), new V(x + 0, 1.02, .2 + lean), .018, 5).toNonIndexed());
    rail.push(rodGeo(new V(-L / 2, 1.02, .2 + lean), new V(L / 2, 1.02, .2 + lean), .045, 6).toNonIndexed());
    rail.push(rodGeo(new V(-L / 2, .5, .2), new V(L / 2, .5, .2), .035, 6).toNonIndexed());
    mesh(mergeGeometries(rail), M.wood, g);
  }
  charupadi(-8.95, -7.05); charupadi(-6.75, -4.85); charupadi(-4.55, -3.05);
  charupadi(3.05, 4.55); charupadi(4.85, 6.75); charupadi(7.05, 8.95);
  // lean-to roof split around the porch
  const lt = THREE.MathUtils.degToRad(20), ltY0 = 3.82, ltZ0 = 10, ltZ1 = 13.2, ltY1 = ltY0 - (ltZ1 - ltZ0) * Math.tan(lt);
  for (const [xa, xb] of [[-10.2, -3.2], [3.2, 10.2]]) {
    const A = new V(xa, ltY1, ltZ1), B = new V(xb, ltY1, ltZ1), C2 = new V(xb, ltY0, ltZ0), D2 = new V(xa, ltY0, ltZ0);
    const up = new V().subVectors(D2, A).normalize();
    mesh(polyGeom([{ pts: [A, B, C2, D2], n: new V(0, 1, 1), u: new V(1, 0, 0), v: up, o: A, su: TILE_SU, sv: TILE_SV }]), M.tile, H);
    const off = new V(0, -.15, 0);
    mesh(polyGeom([{ pts: [A, B, C2, D2].map(p => p.clone().add(off)), n: new V(0, -1, 0), u: new V(1, 0, 0), v: up, o: A, su: 1.2, sv: 1.2 }]), M.under, H, 0, 0, 0, 0, false);
    mesh(polyGeom([{ pts: [A.clone(), B.clone(), B.clone().add(new V(0, -.28, 0)), A.clone().add(new V(0, -.28, 0))], n: new V(0, 0, 1), u: new V(1, 0, 0), v: new V(0, 1, 0), o: A, su: 1, sv: 1 }]), M.wood, H);
    const raf = []; for (let x = xa + .3; x < xb; x += .6) { const b = new THREE.BoxGeometry(.08, .12, ltZ1 - ltZ0 + .2); b.rotateX(lt); b.translate(x, (ltY0 + ltY1) / 2 - .23, (ltZ0 + ltZ1) / 2); raf.push(b.toNonIndexed()); }
    mesh(mergeGeometries(raf), M.woodL, H, 0, 0, 0, 0, false);
    mesh(rodGeo(new V(xa, ltY0 + .05, ltZ0 + .02), new V(xb, ltY0 + .05, ltZ0 + .02), .09, 6), M.ridge, H);
  }

  // ---- poomukham: the columned entrance porch with its own gable
  const pr = THREE.MathUtils.degToRad(44), pEave = 2.75;
  for (const [x, z] of [[-2.35, 12.5], [2.35, 12.5], [-2.35, 14.75], [2.35, 14.75]]) pil.push([x, z, pEave + (3.6 - 2.35) * Math.tan(pr) - .14 - P - .22]);
  const porchTop = pEave + (3.6 - 2.35) * Math.tan(pr) - .14;
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(.24, .22, 2.9), M.wood, H, s * 2.35, porchTop - .11, 13.6);
  mesh(new THREE.BoxGeometry(5, .22, .24), M.wood, H, 0, porchTop - .11, 14.75);
  const proof = hipGableRoof({ W: 4.8, D: 7.2, pitch: pr, gable: .55 });
  proof.rotation.y = Math.PI / 2; proof.position.set(0, pEave, 13.6); H.add(proof);
  // hanging lamp (thookku vilakku)
  const chainTop = new V(0, porchTop + .6, 13.9);
  mesh(rodGeo(chainTop, new V(0, 2.6, 13.9), .012, 4), M.brass, H);
  const lampG = new THREE.LatheGeometry([[0, 0], [.18, .02], [.2, .08], [.08, .14], [.03, .3], [.06, .36], [0, .38]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  mesh(lampG, M.brass, H, 0, 2.3, 13.9);
  for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283 + .3; FLAMES.push({ p: new V(Math.cos(a) * .16, 2.386, 13.9 + Math.sin(a) * .16), s: .036 }); }

  // ---- pillars (turned teak on granite bases)
  const pg = [], bg = [];
  for (const [x, z, h] of pil) {
    const l = lathePillar(h); l.translate(x, P + .22, z); pg.push(l.toNonIndexed());
    const b = new THREE.BoxGeometry(.4, .22, .4); b.translate(x, P + .11, z); bg.push(b.toNonIndexed());
    const cap = new THREE.BoxGeometry(.42, .14, .42); cap.translate(x, P + .22 + h - .07, z); pg.push(cap.toNonIndexed());
  }
  mesh(mergeGeometries(pg), M.wood, H);
  mesh(mergeGeometries(bg), M.granite, H);

  // ---- nalukettu roof with solar arrays that follow the tile courses
  const ring = nalukettuRoof({ x0: -3, x1: 3, z0: -5, z1: 0, d: 5, pitch: THREE.MathUtils.degToRad(38), eaveY: WY, oOut: 1.3, oIn: .55 });
  H.add(ring.group);
  const [front, frontIn, right, rightIn, back, backIn, left, leftIn] = ring.frames;
  solarArray(left, 5, 2, .95);        // west slope: catches the afternoon & sunset sun
  solarArray(right, 5, 2, .95);       // east slope
  solarArray(backIn, 3, 1, .35);      // courtyard-facing south slope
  void front; void frontIn; void rightIn; void back; void leftIn;

  // ---- a peedam (low teak stool) on the porch — where the phone rests
  { const pd = new THREE.Group(); pd.position.set(.95, P, 14.42); H.add(pd); mesh(new THREE.BoxGeometry(.66, .06, .4), M.woodL, pd, 0, .19, 0); for (const [lx, lz] of [[-.27, -.15], [.27, -.15], [-.27, .15], [.27, .15]]) mesh(new THREE.BoxGeometry(.07, .16, .07), M.wood, pd, lx, .08, lz); mesh(new THREE.BoxGeometry(.7, .02, .44), M.wood, pd, 0, .23, 0); }
  if (railGeos.length) { mesh(mergeGeometries(railGeos), M.frame, H); mesh(mergeGeometries(hookGeos), M.steel, H, 0, 0, 0, 0, false); }
  // ---- nilavilakku (brass lamps) flanking the steps
  const nilG = new THREE.LatheGeometry([[0, 0], [.2, .0], [.2, .04], [.07, .1], [.05, .5], [.09, .56], [.04, .62], [.035, .95], [.16, 1.0], [.17, 1.04], [.04, 1.06], [.02, 1.18], [0, 1.2]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  for (const x of [-1.95, 1.95]) {
    mesh(nilG, M.brass, H, x, 0, 15.25);
    for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; FLAMES.push({ p: new V(x + Math.cos(a) * .14, 1.052, 15.25 + Math.sin(a) * .14), s: .046 }); }
  }
  // chirath: a row of clay diyas along the plinth edge, lit at dusk
  for (let x = -9.15; x <= 9.2; x += .72) if (Math.abs(x) > 2.8) DIYAS.push(new V(x, P, 12.1));
  for (const x of [-2.2, 2.2]) DIYAS.push(new V(x, P, 14.9));
  // terracotta pots along the plinth
  const potG = new THREE.LatheGeometry([[0, 0], [.16, 0], [.24, .12], [.26, .26], [.2, .38], [.21, .42], [0, .42]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  for (const [x, z] of [[-8.9, 12.6], [8.9, 12.6], [-3.1, 15.2], [3.1, 15.2]]) mesh(potG, M.terracotta, H, x, 0, z);

  // ---- carved teak brackets (kodungu) from pillar to eave
  { const br = [];
    const bracket = (p0, dir) => { const p2 = p0.clone().add(dir.clone().multiplyScalar(.55)).add(new V(0, .62, 0)); const p1 = p0.clone().add(dir.clone().multiplyScalar(.08)).add(new V(0, .5, 0));
      br.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 10, .045, 5, false).toNonIndexed());
      const knob = new THREE.SphereGeometry(.07, 8, 6); knob.translate(p0.x, p0.y - .03, p0.z); br.push(knob.toNonIndexed());
      const fin = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0.clone().add(new V(0, .12, 0)), p0.clone().add(dir.clone().multiplyScalar(.28)).add(new V(0, .2, 0)), p2.clone().add(new V(0, -.18, 0))), 8, .022, 4, false); br.push(fin.toNonIndexed()); };
    for (const x of vx) bracket(new V(x, vTop - .82, verZ + .1), new V(0, 0, 1));
    for (const [x, z] of [[-2.35, 14.75], [2.35, 14.75]]) { bracket(new V(x, porchTop - .8, z + .1), new V(0, 0, 1)); bracket(new V(x + Math.sign(x) * .1, porchTop - .8, z), new V(Math.sign(x), 0, 0)); }
    for (const [x, z] of [[-2.35, 12.5], [2.35, 12.5]]) bracket(new V(x + Math.sign(x) * .1, porchTop - .8, z), new V(Math.sign(x), 0, 0));
    for (const g of br) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    mesh(mergeGeometries(br), M.wood, H); }
  // ---- chaaru kasera: Kerala easy chairs with their long arms on the veranda
  { const cloth = std({ map: canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#e8dcc4'; g.fillRect(0, 0, w, h); for (const [x, c] of [[14, '#8a2a1e'], [22, '#1f4a3a'], [w - 30, '#1f4a3a'], [w - 22, '#8a2a1e']]) { g.fillStyle = c; g.fillRect(x, 0, 6, h); } }, { repeat: false }), roughness: .95, side: THREE.DoubleSide });
    const chair = (x, z, ry) => {
      const c = new THREE.Group(); c.position.set(x, P, z); c.rotation.y = ry; H.add(c);
      const f = [];
      for (const sx of [-.3, .3]) {
        f.push(rodGeo(new V(sx, .02, .55), new V(sx, .38, .55), .025, 5), rodGeo(new V(sx, .02, -.3), new V(sx, .98, -.52), .025, 5));
        f.push(rodGeo(new V(sx, .38, .62), new V(sx, .92, -.55), .028, 5));
        f.push(rodGeo(new V(sx * 1.12, .58, -.3), new V(sx * 1.12, .55, 1.02), .032, 5), rodGeo(new V(sx * 1.12, .55, .5), new V(sx, .3, .55), .02, 4));
      }
      f.push(rodGeo(new V(-.3, .38, .6), new V(.3, .38, .6), .022, 4), rodGeo(new V(-.3, .95, -.54), new V(.3, .95, -.54), .022, 4));
      mesh(mergeGeometries(f.map(g => g.toNonIndexed())), M.wood, c);
      const sl = new THREE.PlaneGeometry(.58, 1.3, 1, 14), sp = sl.attributes.position;
      for (let i = 0; i < sp.count; i++) { const t = (sp.getY(i) + .65) / 1.3; const y = lerp(.38, .94, t) - Math.sin(Math.PI * t) * .2, zz = lerp(.6, -.54, t); sp.setXYZ(i, sp.getX(i), y, zz); }
      sl.computeVertexNormals(); mesh(sl, cloth, c);
    };
    chair(-7.9, 10.95, 1.3); chair(7.7, 10.95, -1.3); }
  // ---- kindi: the brass spouted vessel waiting at the steps
  { const kg = new THREE.LatheGeometry([[0, 0], [.07, 0], [.095, .03], [.105, .08], [.085, .13], [.036, .16], [.03, .22], [.046, .24], [0, .245]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
    mesh(kg, M.brass, H, -1.3, P + .01, 14.82);
    mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new V(-1.21, P + .09, 14.82), new V(-1.12, P + .12, 14.82), new V(-1.06, P + .2, 14.82)), 8, .014, 5, false), M.brass, H); }
  // ---- east side veranda under the malika eave: where the system lives
  mesh(boxW(1.3, P, 4.6), M.plinth, H, 10.05, P / 2, 7.5);
  mesh(new THREE.BoxGeometry(1.3, .02, 4.6), M.floor, H, 10.05, P + .01, 7.5);
  { const EX = 9.4;   // face of the east wall
    const onWall = (o, d) => { o.position.x = EX + d; return o; };
    // home battery, floor-standing
    onWall(mesh(new RoundedBoxGeometry(.26, 1.0, .62, 4, .035), M.eqWhite, H, 0, P + .53, 7.35), .135);
    onWall(mesh(new THREE.BoxGeometry(.22, .04, .56), M.eqGrey, H, 0, P + .02, 7.35), .125);
    const led = mesh(new THREE.BoxGeometry(.006, .46, .016), new THREE.MeshBasicMaterial({ color: new THREE.Color(.3, 1.6, 1.2) }), H, 0, P + .66, 7.35, 0, false); onWall(led, .268);
    const logo = canvasTex(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#39424a'; g.font = '600 30px Geist, sans-serif'; g.letterSpacing = '9px'; g.fillText('ARKA', 36, 44); }, { repeat: false });
    const lg = mesh(new THREE.PlaneGeometry(.15, .038), new THREE.MeshBasicMaterial({ map: logo, transparent: true }), H, 0, P + .2, 7.35, Math.PI / 2, false); onWall(lg, .2665);
    // hybrid inverter with its display
    onWall(mesh(new RoundedBoxGeometry(.2, .66, .52, 4, .03), M.eqGrey, H, 0, 2.12, 8.75), .105);
    const disp = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#0b1012'; g.fillRect(0, 0, w, h); g.fillStyle = '#9fe3cf'; g.font = '600 46px "Geist Mono", monospace'; g.fillText('4.82', 20, 68); g.font = '500 19px "Geist Mono", monospace'; g.fillStyle = '#8aa0ad'; g.fillText('kW  SOLAR > HOME', 22, 104); for (let i = 0; i < 6; i++) { g.fillStyle = i < 4 ? '#3fd08a' : '#26332e'; g.fillRect(182 + i * 11, 28, 7, 34); } }, { repeat: false });
    onWall(mesh(new THREE.PlaneGeometry(.26, .13), new THREE.MeshBasicMaterial({ map: disp }), H, 0, 2.25, 8.75, Math.PI / 2, false), .2065);
    for (const dz of [-.285, .285]) for (let i = 0; i < 8; i++) onWall(mesh(new THREE.BoxGeometry(.15, .012, .05), M.eqGrey, H, 0, 1.88 + i * .065, 8.75 + dz, 0, false), .09);
    for (let i = 0; i < 4; i++) onWall(mesh(new THREE.CylinderGeometry(.018, .018, .06, 10), M.cable, H, 0, 1.77, 8.6 + i * .1, 0, false), .1);
    // DC isolator
    onWall(mesh(new RoundedBoxGeometry(.1, .22, .16, 3, .02), M.eqGrey, H, 0, 2.72, 9.55), .055);
    onWall(mesh(new THREE.CylinderGeometry(.03, .03, .03, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8231c, roughness: .4 }), H, 0, 2.74, 9.55, 0, false), .115);
    // KSEB net meter on a teak board
    onWall(mesh(new THREE.BoxGeometry(.03, .82, .56), M.wood, H, 0, 2.05, 6.15), .015);
    onWall(mesh(new RoundedBoxGeometry(.13, .46, .3, 3, .02), M.eqWhite, H, 0, 2.08, 6.15), .095);
    const lcd = canvasTex(256, 160, (g, w, h) => { g.fillStyle = '#c3d3bc'; g.fillRect(0, 0, w, h); g.fillStyle = '#18221a'; g.font = '600 50px "Geist Mono", monospace'; g.fillText('0412.6', 18, 74); g.font = '500 19px "Geist Mono", monospace'; g.fillText('kWh  EXPORT >', 20, 114); g.fillText('KSEB  NET', 20, 144); }, { repeat: false });
    onWall(mesh(new THREE.PlaneGeometry(.2, .125), new THREE.MeshBasicMaterial({ map: lcd }), H, 0, 2.18, 6.15, Math.PI / 2, false), .1615);
    onWall(mesh(new THREE.SphereGeometry(.011, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, .25, .15) }), H, 0, 1.96, 6.07, 0, false), .161);
    // conduits: roof → isolator → inverter → battery, inverter → meter, meter → service head
    const pipe = (pts, r, mat) => { const g = []; for (let i = 0; i < pts.length - 1; i++) g.push(rodGeo(pts[i], pts[i + 1], r, 8).toNonIndexed()); for (let i = 1; i < pts.length - 1; i++) { const j = new THREE.SphereGeometry(r * 1.25, 8, 6); j.translate(pts[i].x, pts[i].y, pts[i].z); g.push(j.toNonIndexed()); } for (const q of g) { for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); } mesh(mergeGeometries(g), mat, H, 0, 0, 0, 0, false); };
    const cx = EX + .035;
    pipe([new V(8.62, 4.98, 11.57), new V(10.86, 4.98, 11.57), new V(10.95, 4.98, 11.48), new V(10.95, 4.98, 9.66), new V(9.64, 4.98, 9.66), new V(9.64, 2.96, 9.66), new V(9.52, 2.86, 9.6)], .022, M.conduit);
    pipe([new V(cx, 2.61, 9.55), new V(cx, 2.52, 9.55), new V(cx, 2.52, 8.92), new V(cx, 2.45, 8.92)], .018, M.conduit);
    pipe([new V(cx, 1.79, 8.55), new V(cx, 1.62, 8.55), new V(cx, 1.62, 7.66)], .018, M.conduit);
    pipe([new V(cx, 2.45, 8.58), new V(cx, 2.66, 8.58), new V(cx, 2.66, 6.2), new V(cx, 2.31, 6.2)], .018, M.conduit);
    pipe([new V(cx, 1.85, 6.02), new V(cx, 1.55, 6.02), new V(cx, .9, 6.02)], .016, M.conduit);
    pipe([new V(cx, 2.31, 6.06), new V(cx, 3.42, 6.06), new V(EX + .2, 3.55, 6.06)], .02, M.steel);
    // DC pair: out from under the last module, down the tiles, into a junction box on the fascia
    const slope = (x, vv, nn) => new V(x, 5.14 + vv * .643 + nn * .766, 11.5 - vv * .766 + nn * .643);
    for (const dx of [0, .035]) mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([slope(8.22 + dx, 1.3, .06), slope(8.3 + dx, .8, .03), slope(8.4 + dx, .25, .025), slope(8.5 + dx, -.02, .03), new V(8.56 + dx, 5.04, 11.62), new V(8.6 + dx, 4.99, 11.6)]), 24, .011, 6, false), M.cable, H, 0, 0, 0, 0, false);
    mesh(new RoundedBoxGeometry(.16, .14, .08, 3, .015), M.eqGrey, H, 8.6, 4.98, 11.58);
    // service drop from the KSEB pole
    mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new V(EX + .21, 3.55, 6.06), new V(12.6, 4.2, 5.6), new V(15.72, 7.05, 5.2)), 30, .009, 5, false), M.cable, H, 0, 0, 0, 0, false);
  }
  // ---- warm interior lights for dusk/night
  for (const [x, y, z, i, d] of [[0, 3.1, 13.7, 10, 11], [-5.6, 2.6, 11.1, 5.5, 8], [5.6, 2.6, 11.1, 5.5, 8], [0, 2.6, -2.5, 8, 10]]) {
    const L = new THREE.PointLight(0xffa24e, 0, d, 1.6); L.position.set(x, y, z); L.userData.max = i; H.add(L); lights.window.push(L);
  }
  H.traverse(o => { if (!o.isMesh) return; if (o.material === M.lat) o.material = M.wall; else if (o.material === M.plinth) o.material = M.redox; });
  const baked = bake(H);
  lights.window.forEach(l => baked.add(l));
  void core; void winGeo;
  return baked;
}

/* ------------------------------------------------------------------ compound, gatehouse, pond */
function buildCompound() {
  const G = new THREE.Group();
  const WH = 1.5, WT = .35;
  const segs = [[-24, 26, -24, -18], [24, 26, 24, -18], [-24, -18, 24, -18]];
  for (const [xa, za, xb, zb] of segs) {
    const L = Math.hypot(xb - xa, zb - za), cx = (xa + xb) / 2, cz = (za + zb) / 2, ry = Math.atan2(-(zb - za), xb - xa);
    mesh(boxW(L, WH, WT), M.lat, G, cx, WH / 2, cz, ry);
    const cop = new THREE.CylinderGeometry(.34, .34, L, 3, 1); cop.rotateZ(Math.PI / 2); cop.rotateX(Math.PI / 6 + Math.PI);
    mesh(cop, M.terracotta, G, cx, WH + .08, cz, ry);
  }
  // laterite path from padippura to the poomukham + a sand muttam
  const muttam = new THREE.Shape(); { const x0 = -12.5, x1 = 12.5, z0 = 15.6, z1 = 29.2, r = 2; muttam.moveTo(x0 + r, z0); muttam.lineTo(x1 - r, z0); muttam.quadraticCurveTo(x1, z0, x1, z0 + r); muttam.lineTo(x1, z1 - r); muttam.quadraticCurveTo(x1, z1, x1 - r, z1); muttam.lineTo(x0 + r, z1); muttam.quadraticCurveTo(x0, z1, x0, z1 - r); muttam.lineTo(x0, z0 + r); muttam.quadraticCurveTo(x0, z0, x0 + r, z0); }
  const mg = new THREE.ShapeGeometry(muttam, 8); mg.rotateX(Math.PI / 2); { const p = mg.attributes.position, uv = mg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.6, p.getZ(i) / 1.6); }
  const mm = mesh(mg, M.gravel, G, 0, .035, 0, 0, false); mm.material.side = THREE.DoubleSide;
  const stones = [];
  for (let z = 19.5; z < 28.9; z += .62) for (const x of [-.52, .52]) { const b = boxW(1.0 + R(-.04, .04), .08, .56 + R(-.03, .03), 2, 2); b.rotateY(R(-.04, .04)); b.translate(x + R(-.03, .03), .06, z); stones.push(b.toNonIndexed()); }
  mesh(mergeGeometries(stones), M.plinth, G, 0, 0, 0, 0, false);
  // kinar — the open well with its laterite parapet and pulley frame
  { const wx = -8.2, wz = 21.2;
    const ring = new THREE.CylinderGeometry(1.05, 1.1, .95, 20, 1, true); { const uv = ring.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.3, uv.getY(i) * .48); }
    mesh(ring, M.lat, G, wx, .475, wz); mesh(new THREE.CylinderGeometry(.82, .82, .9, 20, 1, true), M.lat, G, wx, .45, wz);
    mesh(new THREE.RingGeometry(.82, 1.08, 24).rotateX(-Math.PI / 2), M.granite, G, wx, .955, wz);
    mesh(new THREE.CircleGeometry(.82, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: .1 }), G, wx, .15, wz, 0, false);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(.14, 1.6, .14), M.wood, G, wx + s * .95, 1.75, wz);
    mesh(new THREE.BoxGeometry(2.1, .12, .12), M.wood, G, wx, 2.52, wz);
    mesh(new THREE.CylinderGeometry(.16, .16, .06, 16).rotateX(Math.PI / 2), M.woodL, G, wx, 2.34, wz);
    mesh(rodGeo(new V(wx + .16, 2.34, wz), new V(wx + .16, .9, wz), .01, 4), M.woodL, G);
    mesh(new THREE.CylinderGeometry(.16, .12, .3, 12), M.brass, G, wx + .16, .9, wz); }
  // pookalam — an Onam flower carpet laid in front of the steps
  { const pk = canvasTex(512, 512, (g, w, h) => {
      const r = mulberry32(19), cx = w / 2, cy = h / 2; g.clearRect(0, 0, w, h);
      const ring = (r0, r1, col, n = 0, col2) => { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r1, 0, 6.283); g.arc(cx, cy, r0, 0, 6.283, true); g.fill();
        if (n) { g.fillStyle = col2; for (let k = 0; k < n; k++) { const a = k / n * 6.283; g.beginPath(); g.ellipse(cx + Math.cos(a) * (r0 + r1) / 2, cy + Math.sin(a) * (r0 + r1) / 2, (r1 - r0) * .45, (r1 - r0) * .2, a, 0, 6.283); g.fill(); } }
        for (let k = 0; k < (r1 * r1 - r0 * r0) * .02; k++) { const a = r() * 6.283, d = r0 + r() * (r1 - r0); g.fillStyle = `rgba(255,255,255,${r() * .18})`; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2); } };
      ring(236, 252, '#2f6b2a'); ring(212, 236, '#f07a12', 24, '#ffd23a'); ring(188, 212, '#fff4dc'); ring(160, 188, '#c81d25', 16, '#f07a12');
      ring(134, 160, '#ffd23a'); ring(110, 134, '#7b2d8b', 12, '#fff4dc'); ring(84, 110, '#f07a12'); ring(56, 84, '#fff4dc', 8, '#c81d25'); ring(30, 56, '#ffd23a'); ring(0, 30, '#c81d25');
      for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; g.fillStyle = '#2f6b2a'; g.beginPath(); g.ellipse(cx + Math.cos(a) * 250, cy + Math.sin(a) * 250, 16, 7, a, 0, 6.283); g.fill(); }
    }, { repeat: false });
    const pm = mesh(new THREE.CircleGeometry(1.3, 48).rotateX(-Math.PI / 2), std({ map: pk, transparent: true, roughness: .95 }), G, 0, .045, 17.9, 0, false); pm.userData.keep = true; }
  // KSEB pole: the grid comes in here
  { const px2 = 15.8, pz2 = 5.2, pg = new THREE.CylinderGeometry(.08, .14, 8.2, 4); pg.rotateY(Math.PI / 4); mesh(pg, M.pole, G, px2, 4.1, pz2);
    mesh(new THREE.BoxGeometry(.1, .1, 1.5), M.pole, G, px2, 7.4, pz2);
    for (const dz of [-.62, 0, .62]) mesh(new THREE.CylinderGeometry(.035, .045, .14, 8), M.eqWhite, G, px2, 7.52, pz2 + dz);
    for (const dz of [-.62, 0, .62]) mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new V(px2, 7.6, pz2 + dz), new V(40, 6.3, pz2 + dz * 1.4 - 6), new V(64, 7.6, pz2 + dz - 12)), 24, .009, 4, false), M.cable, G, 0, 0, 0, 0, false); }
  // tulsi thara facing the entrance
  mesh(boxW(.75, .8, .75, 1, 1), M.lat, G, 0, .4, 20.2); mesh(new THREE.BoxGeometry(.9, .08, .9), M.granite, G, 0, .84, 20.2);
  // kulam — the family pond with laterite steps
  const px = 14.5, pz = 17.5;
  for (let s = 0; s < 3; s++) {
    const w = 8 - s * .9, d = 6.6 - s * .9, y = .5 - s * .16;
    for (const [bw, bd, bx, bz] of [[w, .45, 0, d / 2], [w, .45, 0, -d / 2], [.45, d, w / 2, 0], [.45, d, -w / 2, 0]]) mesh(boxW(bw, .16, bd, 1, 1), M.plinth, G, px + bx, y, pz + bz);
  }
  mesh(boxW(8.4, .5, .4, 1, 1), M.lat, G, px, .25, pz + 3.5); mesh(boxW(8.4, .5, .4, 1, 1), M.lat, G, px, .25, pz - 3.5);
  mesh(boxW(.4, .5, 7.4, 1, 1), M.lat, G, px + 4.2, .25, pz); mesh(boxW(.4, .5, 7.4, 1, 1), M.lat, G, px - 4.2, .25, pz);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 4.4), new THREE.MeshStandardMaterial({ color: 0x2f463c, roughness: .04, metalness: .1 }));
  water.rotation.x = -Math.PI / 2; water.position.set(px, .14, pz); water.receiveShadow = true; water.userData.keep = true; G.add(water);
  return bake(G);
}

/* ------------------------------------------------------------------ the backwater */
const LAKE_Y = -.35;
// slow swell + wind chop — the same numbers drive the water surface and everything floating on it
const WAVE_GLSL = `float lakeWave(vec2 p, float t){ float fade = smoothstep(30.5, 36., p.y);
  return fade * ( sin(p.x * .31 + t * 1.25) * .05 + sin(p.y * .23 - t * 1.0 + p.x * .11) * .06 + sin((p.x * .7 - p.y * .5) + t * 1.9) * .018 ); }`;
function lakeWave(x, z, t) { const fade = smooth(30.5, 36, z); return fade * (Math.sin(x * .31 + t * 1.25) * .05 + Math.sin(z * .23 - t * 1.0 + x * .11) * .06 + Math.sin((x * .7 - z * .5) + t * 1.9) * .018); }
// ripple normals, generated here: periodic noise (so it tiles) → height → normal map
const waterNormals = (() => {
  const S = 256, P = 16, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), img = g.createImageData(S, S);
  const ph = (x, y, p) => hash2(((x % p) + p) % p, ((y % p) + p) % p);
  const pn = (x, y, p) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = ph(xi, yi, p), b = ph(xi + 1, yi, p), c2 = ph(xi, yi + 1, p), d = ph(xi + 1, yi + 1, p); return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = 0, amp = .5, f = P / S, per = P; for (let o = 0; o < 5; o++) { h += amp * pn(x * f, y * f * .8, per); f *= 2; per *= 2; amp *= .5; }
    const v = h * 255, i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(normalFromImage(c, 5)); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();
function hullGeo(L, H, B) { const g = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); g.scale(L, H, B); return g; }
function thatchDraw(g, w, h) {
  const r = mulberry32(61); g.fillStyle = '#9c7a44'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6) { g.fillStyle = `rgba(${r() < .5 ? '70,48,22' : '196,160,96'},${.25 + r() * .3})`; g.fillRect(0, y, w, 3); }
  for (let x = 0; x < w; x += 22) { g.fillStyle = 'rgba(60,40,18,.35)'; g.fillRect(x, 0, 2, h); }
  for (let i = 0; i < 900; i++) { g.strokeStyle = `rgba(${r() < .5 ? '60,40,16' : '215,180,120'},${r() * .25})`; g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + (r() - .5) * 18, y + r() * 4); g.stroke(); }
}
// uneven rubble: a few lumpy boulder shapes, instanced in rough courses down the bank into the water
function rockGeo(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed(), p = g.attributes.position, r = mulberry32(seed), o = [r() * 9, r() * 9, r() * 9];
  // a few random cleaving planes give flat, angular faces like broken granite
  const planes = Array.from({ length: 7 }, () => { const n = new V(r() - .5, r() - .5, r() * .6 - .1).normalize(); return { n, d: .62 + r() * .22 }; });
  for (let i = 0; i < p.count; i++) {
    const v = new V().fromBufferAttribute(p, i), n = fbm(v.x * 1.6 + o[0], v.y * 1.6 + v.z * 1.2 + o[1], 3);
    v.multiplyScalar(.82 + n * .36);
    for (const pl of planes) { const d = v.dot(pl.n); if (d > pl.d) v.addScaledVector(pl.n, pl.d - d); }
    v.y *= .66; if (v.z < 0) v.z *= .5;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}
function buildRubble() {
  const G = new THREE.Group(), geos = [0, 1, 2, 3].map(k => rockGeo(31 + k * 7)).concat([0, 1, 2, 3].map(k => rockGeo(31 + k * 7, 1))), lists = geos.map(() => []);
  const r = mulberry32(77);
  const courses = [[.19, .26], [-.07, .3], [-.38, .32], [-.72, .36]];
  for (const [xa, xb] of [[-110, -2.1], [2.1, 110]]) for (const [y0, h] of courses) {
    let x = xa + r() * .3;
    while (x < xb) {
      const far = Math.abs(x) > 45, w = (far ? .6 : .3) + r() * (far ? .45 : .34), hh = h * (.8 + r() * .5);
      lists[((r() * 4) | 0) + (far ? 4 : 0)].push({ x: x + w / 2, y: y0 + (r() - .5) * .1, z: 30.26 + (r() - .5) * .07, sx: w * .6, sy: hh * .75, sz: .17 + r() * .09, ry: (r() - .5) * .5, rz: (r() - .5) * .5, c: .72 + r() * .38, warm: r() });
      x += w * (.82 + r() * .12);
    }
  }
  const mat = std({ color: 0xffffff, roughness: .95, flatShading: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vRW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 rw = vec4(transformed, 1.); rw = instanceMatrix * rw; vRW = (modelMatrix * rw).xyz;`);
    sh.fragmentShader = `varying vec3 vRW;
      float rh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float rn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(mix(rh(i), rh(i+vec3(1,0,0)), f.x), mix(rh(i+vec3(0,1,0)), rh(i+vec3(1,1,0)), f.x), f.y), mix(mix(rh(i+vec3(0,0,1)), rh(i+vec3(1,0,1)), f.x), mix(rh(i+vec3(0,1,1)), rh(i+vec3(1,1,1)), f.x), f.y), f.z); }
    ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float gr = rn(vRW * 18.) * .45 + rn(vRW * 60.) * .35 + rn(vRW * 3.5) * .45;
      diffuseColor.rgb *= mix(.5, 1.12, gr);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9), step(.965, rn(vRW * 140.)) * .35);   // quartz flecks
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.55, .62, .45), smoothstep(-.05, -.5, vRW.y) * .7);   // wet, algae-dark at the waterline
      diffuseColor.rgb *= 1. - smoothstep(.1, -.9, vRW.y) * .35;`);
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  geos.forEach((g, k) => {
    const L = lists[k]; if (!L.length) return; const im = new THREE.InstancedMesh(g, mat, L.length);
    L.forEach((it, i) => { e.set((r() - .5) * .3, it.ry, it.rz); q.setFromEuler(e); m4.compose(new V(it.x, it.y, it.z), q, new V(it.sx, it.sy, it.sz)); im.setMatrixAt(i, m4);
      col.copy(srgb(.47, .45, .42)).lerp(srgb(.45, .38, .31), it.warm * .8).multiplyScalar(it.c * .92); im.setColorAt(i, col); });
    im.receiveShadow = true; im.frustumCulled = false; G.add(im);
  });
  return G;
}
function buildBackwater() {
  const G = new THREE.Group(), anim = { boats: [] };
  const lake = new Water(new THREE.PlaneGeometry(2400, 560, isSmall ? 240 : 480, isSmall ? 56 : 112), {
    textureWidth: isSmall ? 256 : 512, textureHeight: isSmall ? 256 : 512, waterNormals,
    sunDirection: new V(-.6, .6, .4).normalize(), sunColor: 0xffffff, waterColor: 0x2a3320, distortionScale: 1.1, fog: true,
  });
  // backwater, not a mirror: darker, greener, softer reflections
  lake.material.fragmentShader = lake.material.fragmentShader
    .replace('float rf0 = 0.3;', 'float rf0 = 0.1;')
    .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', 'vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor * 1.7;')
    .replace('( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight )', '( waterColor * .5 + reflectionSample * mix(vec3(.52), waterColor * 3.2, .3) + reflectionSample * specularLight * .5 )');
  lake.material.vertexShader = lake.material.vertexShader
    .replace('void main() {', WAVE_GLSL + '\nvoid main() {')
    .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );', 'vec3 pw = position; vec4 wp0 = modelMatrix * vec4( position, 1.0 ); pw.z += lakeWave( wp0.xz, time );\n\tmirrorCoord = modelMatrix * vec4( pw, 1.0 );')
    .replace('vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', 'vec4 mvPosition =  modelViewMatrix * vec4( pw, 1.0 );');
  lake.rotation.x = -Math.PI / 2; lake.position.set(0, LAKE_Y, 30 + 280); lake.material.uniforms.size.value = 2.1; lake.material.uniforms.distortionScale.value = 4.6;
  { const obr = lake.onBeforeRender; let n = 0; lake.onBeforeRender = (...a) => { if ((n++ & 1) === 0) obr.apply(lake, a); }; }
  G.add(lake); anim.lake = lake;
  // the bank: a rubble-stone embankment with a concrete coping, broken only by the kadavu
  const K = new THREE.Group();
  for (const [xa, xb] of [[-110, -2.35], [2.35, 110]]) {
    const L = xb - xa, cx = (xa + xb) / 2;
    // dark earth-and-mortar core; the face is built from loose rubble below
    mesh(new THREE.BoxGeometry(L, 1.75, .7), M.mortar, K, cx, -.6, 29.75); mesh(new THREE.BoxGeometry(L, .14, 1.02), M.coping, K, cx, .33, 29.84);
  }
  // kadavu — stone bathing steps down into the water
  for (let s2 = 0; s2 < 7; s2++) { const y = .1 - s2 * .24, z = 27.9 + s2 * .46; mesh(boxW(4.2, .24, .48, 2.2, 1.1), M.stone, K, 0, y - .12, z + .24); }
  for (const sx of [-2.3, 2.3]) { mesh(boxW(.45, 1.4, 3.6, 2.2, 1.1), M.stone, K, sx, -.3, 29.6); mesh(new THREE.BoxGeometry(.55, .12, 3.7), M.coping, K, sx, .34, 29.6); for (let z = 28.1; z < 31.3; z += .78) DIYAS.push(new V(sx, .4, z)); }
  for (let x = 3.2; x < 11; x += 1.3) for (const sx of [-1, 1]) DIYAS.push(new V(sx * x, .4, 29.7));
  G.add(bake(K));
  G.add(buildRubble());
  // vallam — a country boat tied at the kadavu
  const vallam = new THREE.Group();
  const vh = new THREE.Mesh(hullGeo(3.4, .42, .5), std({ map: T.wood, color: 0x6a4a32, roughness: .7, side: THREE.DoubleSide })); vh.castShadow = true; vallam.add(vh);
  for (const x of [-1.6, 0, 1.4]) { const th = new THREE.Mesh(new THREE.BoxGeometry(.08, .04, .88), M.woodL); th.position.set(x, -.1, 0); vallam.add(th); }
  const pole = new THREE.Mesh(rodGeo(new V(-2.6, .1, .15), new V(3.4, .6, -.2), .025, 5), M.woodL); vallam.add(pole);
  vallam.position.set(4.3, LAKE_Y + .12, 32.2); vallam.rotation.y = .06; G.add(vallam);
  anim.boats.push({ o: vallam, y: LAKE_Y + .12, bob: .03, roll: .025, ph: 0 });
  // kettuvallam — a houseboat drifting across the lake
  const hb = new THREE.Group();
  const hull = new THREE.Mesh(hullGeo(10.5, 1.15, 2.2), std({ map: T.wood, color: 0x5a3a22, roughness: .6, side: THREE.DoubleSide })); hull.castShadow = true; hb.add(hull);
  const deck = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), M.woodL); deck.scale.set(10.3, 1, 2.12); deck.position.y = .02; hb.add(deck);
  const thatchMat = std({ map: canvasTex(256, 256, thatchDraw), roughness: .95, side: THREE.DoubleSide });
  function canopy(x0, x1, r, y) {
    const pos = [], uv = [], idx = [], seg = 18, n = 2;
    for (let i = 0; i <= seg; i++) { const a = Math.PI * i / seg; for (let j = 0; j < n; j++) { const x = j ? x1 : x0; pos.push(x, y + Math.sin(a) * r * .72, Math.cos(a) * r); uv.push(j * (x1 - x0) / 2, i / seg * 3); } }
    for (let i = 0; i < seg; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeVertexNormals();
    const mm2 = new THREE.Mesh(gg, thatchMat); mm2.castShadow = true; return mm2;
  }
  hb.add(canopy(-6.2, 4.2, 2.05, 1.35), canopy(4.6, 7.6, 1.55, 1.05));
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(10, 1.25, 3.3), std({ map: T.woodL, color: 0xb08a5c, roughness: .8 })); cabin.position.set(-1, .66, 0); hb.add(cabin);
  for (const sz of [-1, 1]) for (let x = -5.2; x < 3.6; x += 1.6) { const w2 = new THREE.Mesh(new THREE.PlaneGeometry(.9, .5), M.glow); w2.position.set(x, .78, sz * 1.66); w2.rotation.y = sz > 0 ? 0 : Math.PI; hb.add(w2); }
  for (const x of [-6, -3, 0, 3, 4.4, 7.4]) for (const sz of [-1, 1]) { const po = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.4, 6), M.wood); po.position.set(x, .7, sz * (x > 4 ? 1.3 : 1.85)); hb.add(po); }
  hb.position.set(-30, LAKE_Y + .38, 64); G.add(hb); anim.houseboat = hb;   // close to the hero lens: its canopy glides along the bottom edge
  anim.boats.push({ o: hb, y: LAKE_Y + .38, bob: .05, roll: .012, ph: 1.7, drift: { z: 64, speed: 1.2, span: 170, x0: -85, off: 50 } });
  // cheena vala — a Chinese fishing net cantilevered over the water
  const CN = new THREE.Group(), base = new V(7.8, 0, 29.4);
  mesh(boxW(3.2, .5, 2.6), M.plinth, CN, base.x, .05, base.z);
  const piv = base.clone().add(new V(0, .9, .6)), tip = base.clone().add(new V(0, 8.6, 10.5)), back = base.clone().add(new V(0, 3.2, -4.2));
  const spars = [rodGeo(piv, tip, .13, 7), rodGeo(piv.clone().add(new V(-.6, 0, 0)), back, .1, 6), rodGeo(piv.clone().add(new V(.6, 0, 0)), back, .1, 6)];
  const cx0 = tip.x, cz0 = tip.z + 1, S2 = 4.6, cy = LAKE_Y + .9;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new V(cx0 + a * S2, cy, cz0 + b * S2));
  corners.forEach(c => spars.push(rodGeo(tip, c, .055, 5)));
  for (let k = 0; k < 4; k++) spars.push(rodGeo(corners[k], corners[(k + 1) % 4], .035, 4));
  const woodDark = std({ color: 0x3a2a1c, roughness: .8 });
  const sparMesh = new THREE.Mesh(mergeGeometries(spars.map(g => g.toNonIndexed())), woodDark); sparMesh.castShadow = true; CN.add(sparMesh);
  const stones = []; for (let k = 0; k < 5; k++) { const st = new THREE.SphereGeometry(.28, 8, 6); st.translate(back.x + (k - 2) * .35, back.y - 1.6 - (k % 2) * .3, back.z); stones.push(st.toNonIndexed()); stones.push(rodGeo(back, new V(back.x + (k - 2) * .35, back.y - 1.4 - (k % 2) * .3, back.z), .012, 3).toNonIndexed()); }
  CN.add(new THREE.Mesh(mergeGeometries(stones), std({ color: 0x4d4a44, roughness: .95 })));
  const net = []; const NN = 12;
  for (let i = 0; i <= NN; i++) for (let j = 0; j < NN; j++) {
    const f = (u, v) => new V(cx0 + (u * 2 - 1) * S2, cy - 1.1 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), cz0 + (v * 2 - 1) * S2);
    const a1 = f(i / NN, j / NN), a2 = f(i / NN, (j + 1) / NN), b1 = f(j / NN, i / NN), b2 = f((j + 1) / NN, i / NN);
    net.push(a1.x, a1.y, a1.z, a2.x, a2.y, a2.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z);
  }
  const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(net, 3));
  CN.add(new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0x2a241c, transparent: true, opacity: .75 })));
  G.add(CN);
  // ---- water hyacinth: glossy floating rosettes with lilac spikes, drifting in rafts
  const leafM = std({ color: 0x3f6d2a, roughness: .35, side: THREE.DoubleSide });
  const ros = [];
  for (let k = 0; k < 7; k++) { const lf = new THREE.CircleGeometry(.16, 10); lf.scale(1, 1.35, 1); lf.translate(0, .2, 0); lf.rotateX(-.55 - R(0, .45)); lf.rotateY(k / 7 * 6.283 + R(-.2, .2)); ros.push(lf.toNonIndexed()); }
  const rosG = mergeGeometries(ros); colorize(rosG, srgb(1, 1, 1));
  const flw = []; for (let k = 0; k < 9; k++) { const f = new THREE.SphereGeometry(.045, 6, 4); f.translate(R(-.04, .04), .22 + k * .035, R(-.04, .04)); flw.push(f.toNonIndexed()); }
  const flG = mergeGeometries(flw);
  const rafts = [[-12, 36, 26], [9, 40, 20], [-40, 45, 30], [30, 38, 24], [-2, 58, 34], [48, 55, 22], [-66, 40, 26], [70, 44, 20]];
  const hy = []; rafts.forEach(([cx, cz, n], ri) => { const sp = .34 + (cz - 34) * .008 + R(-.05, .05); for (let k = 0; k < n; k++) { const a = R(0, 6.28), d = Math.sqrt(rand()) * 2.8; hy.push({ x: cx + Math.cos(a) * d * 1.6, z: cz + Math.sin(a) * d, s: R(.7, 1.3), ry: R(0, 6.28), spin: R(-.05, .05), sp: sp * R(.96, 1.04), raft: ri, flower: rand() < .3 }); } });
  for (let k = 0; k < 26; k++) { const cz = R(33, 46), sp = .3 + (cz - 34) * .008; hy.push({ x: R(-110, 110), z: cz, s: R(.6, 1.1), ry: R(0, 6.28), spin: R(-.12, .12), sp, raft: 20 + k, flower: rand() < .45 }); }   // loose rosettes
  const hyM = new THREE.InstancedMesh(rosG, leafM, hy.length), hyF = new THREE.InstancedMesh(flG, std({ color: 0xa98fd6, roughness: .5 }), hy.filter(h => h.flower).length);
  hyM.castShadow = true; hyM.frustumCulled = hyF.frustumCulled = false; G.add(hyM, hyF);
  // ---- lily pads and water lilies in the shallows
  const padG = new THREE.CircleGeometry(.34, 18, .35, Math.PI * 2 - .35); padG.rotateX(-Math.PI / 2);
  const pads = []; for (let i = 0; i < (isSmall ? 80 : 170); i++) { const z = R(31.3, 35); pads.push({ x: R(-110, 110), z, s: R(.6, 1.4), ry: R(0, 6.28), spin: R(-.06, .06), sp: .1 + (z - 31.3) * .03 + R(-.02, .02), lily: rand() < .18 }); }
  const padM = new THREE.InstancedMesh(padG, std({ color: 0x2f5a26, roughness: .3 }), pads.length); padM.frustumCulled = false; G.add(padM);
  const lilyG = mergeGeometries(Array.from({ length: 8 }, (_, k) => { const pt = new THREE.ConeGeometry(.05, .16, 4); pt.rotateZ(Math.PI / 2 - .5); pt.translate(.07, .05, 0); pt.rotateY(k / 8 * 6.283); return pt.toNonIndexed(); }));
  const lilyM = new THREE.InstancedMesh(lilyG, std({ color: 0xf6eef0, roughness: .6, emissive: 0x201818 }), pads.filter(p2 => p2.lily).length); lilyM.frustumCulled = false; G.add(lilyM);
  // ---- reeds along the waterline
  const reedTex = canvasTex(128, 256, (g, w, h) => { g.clearRect(0, 0, w, h); const r = mulberry32(5); for (let i = 0; i < 46; i++) { const x = w * (.1 + r() * .8), hh = h * (.55 + r() * .45); g.strokeStyle = r() < .3 ? '#8b8a4a' : '#4c6a2c'; g.lineWidth = 1.2 + r() * 1.6; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (r() - .5) * 10, h - hh * .6, x + (r() - .5) * 26, h - hh); g.stroke(); } }, { repeat: false });
  const reedG = mergeGeometries([0, 1].map(k => { const pg = new THREE.PlaneGeometry(.8, 1.1); pg.translate(0, .55, 0); pg.rotateY(k * Math.PI / 2 + .4); return pg.toNonIndexed(); }));
  const reeds = []; for (let x = -95; x <= 95; x += R(.7, 2.6)) { if (Math.abs(x) < 4.6) continue; if (rand() < .35) continue; reeds.push([x, R(30.35, 31.2)]); }
  const reedM = new THREE.InstancedMesh(reedG, windify(std({ map: reedTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .85 }), { amp: .14, flutter: 0, hs: 1.1 }), reeds.length);
  { const m4 = new THREE.Matrix4(); reeds.forEach(([x, z], i) => { const sc = R(.7, 1.3); m4.compose(new V(x, LAKE_Y - .15, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R(0, 6.28), 0)), new V(sc, sc * R(.8, 1.3), sc)); reedM.setMatrixAt(i, m4); }); }
  reedM.frustumCulled = false; G.add(reedM);
  // ---- egrets standing in the shallows
  const white = std({ color: 0xf4f5f2, roughness: .65 }), dark = std({ color: 0x1c1c1a, roughness: .6 }), beakM = std({ color: 0xd8a62a, roughness: .5 });
  const egrets = [];
  function egret(x, z, ry) {
    const e = new THREE.Group(); e.position.set(x, LAKE_Y, z); e.rotation.y = ry;
    const body = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 8), white); body.scale.set(1, .9, 2.1); body.position.set(0, .62, 0); body.rotation.x = -.35; e.add(body);
    const neckC = new THREE.CatmullRomCurve3([new V(0, .66, .2), new V(0, .82, .22), new V(0, .9, .14), new V(0, 1.02, .2)]);
    e.add(new THREE.Mesh(new THREE.TubeGeometry(neckC, 12, .034, 6, false), white));
    const head = new THREE.Group(); head.position.set(0, 1.04, .22); e.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), white));
    const bk = new THREE.Mesh(new THREE.ConeGeometry(.016, .16, 6), beakM); bk.rotation.x = Math.PI / 2; bk.position.set(0, -.01, .1); head.add(bk);
    for (const sx of [-.04, .04]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .56, 4), dark); lg.position.set(sx, .3, .02); e.add(lg); }
    e.traverse(o => { if (o.isMesh) o.castShadow = true; });
    G.add(e); egrets.push({ e, head, ph: R(0, 6) });
  }
  egret(1.1, 31.6, .6); egret(-27, 31.3, -.9); egret(15.5, 31.8, 2.4);
  // ---- a loose flock of birds crossing the sky
  const wingG = new THREE.BufferGeometry(); wingG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .12, 0, 0, -.12, .9, 0, 0], 3)); wingG.computeVertexNormals();
  const birdM = new THREE.MeshBasicMaterial({ color: 0x1d2226, side: THREE.DoubleSide, fog: true });
  const birds = []; for (let k = 0; k < 9; k++) { const b = new THREE.Group(); const l = new THREE.Mesh(wingG, birdM), r2 = new THREE.Mesh(wingG, birdM); r2.scale.x = -1; b.add(l, r2); b.userData = { l, r: r2, off: new V(-k * 1.6 + R(-.5, .5), R(-.8, .8), (k % 2 ? 1 : -1) * k * 1.1), ph: R(0, 6) }; G.add(b); birds.push(b); }
  anim.float = { hy, hyM, hyF, pads, padM, lilyM, egrets, birds, dummy: new THREE.Object3D() };
  G.userData = anim;
  return G;
}
// the current runs west, toward the sea: everything loose drifts with it, wraps round far out of view,
// and steers around the moored vallam
const wrapX = x => ((x + 110) % 220 + 220) % 220 - 110;
function drift(x0, z0, sp, t, ph) {
  const x = wrapX(x0 - sp * t), fade = smooth(110, 94, Math.abs(x));
  let z = z0 + Math.sin(x * .045 + ph) * .7 + Math.sin(t * .07 + ph) * .25;
  const bx = x - 4.3; if (Math.abs(bx) < 4.2) { const k = 1 - (bx / 4.2) ** 2, dz = z - 32.2, need = 1.25 * k; if (Math.abs(dz) < need) z = 32.2 + Math.sign(dz || 1) * need; }
  return { x, z, fade };
}
function animateBackwater(t) {
  const F = backwater.userData.float, d = F.dummy; let fi = 0, li = 0;
  F.hy.forEach((h, i) => {
    const q = drift(h.x, h.z, h.sp, t, h.raft * 1.7);
    d.position.set(q.x, LAKE_Y + lakeWave(q.x, q.z, t) + .01, q.z); d.rotation.set(Math.sin(t * .9 + i) * .05, h.ry + t * h.spin, Math.cos(t * .8 + i) * .05); d.scale.setScalar(h.s * Math.max(.001, q.fade)); d.updateMatrix();
    F.hyM.setMatrixAt(i, d.matrix); if (h.flower) F.hyF.setMatrixAt(fi++, d.matrix);
  });
  F.hyM.instanceMatrix.needsUpdate = true; F.hyF.instanceMatrix.needsUpdate = true;
  F.pads.forEach((p2, i) => { const q = drift(p2.x, p2.z, p2.sp, t, i * .37); d.position.set(q.x, LAKE_Y + lakeWave(q.x, q.z, t) + .015, q.z); d.rotation.set(0, p2.ry + t * p2.spin, 0); d.scale.setScalar(p2.s * Math.max(.001, q.fade)); d.updateMatrix(); F.padM.setMatrixAt(i, d.matrix); if (p2.lily) { d.translateX(.08); d.updateMatrix(); F.lilyM.setMatrixAt(li++, d.matrix); } });
  F.padM.instanceMatrix.needsUpdate = true; F.lilyM.instanceMatrix.needsUpdate = true;
  for (const eg of F.egrets) { eg.head.position.y = 1.04 + Math.max(0, Math.sin(t * .7 + eg.ph)) * .05; eg.head.rotation.y = Math.sin(t * .4 + eg.ph) * .6; }
  const lead = new V(-140 + ((t * 3.2) % 300), 26 + Math.sin(t * .2) * 2, -10 + Math.sin(t * .05) * 12);
  for (const b of F.birds) { b.position.copy(lead).add(b.userData.off); b.rotation.y = Math.PI / 2; const fl = Math.sin(t * 7 + b.userData.ph) * .5; b.userData.l.rotation.z = fl; b.userData.r.rotation.z = -fl; }
  for (const b of backwater.userData.boats) b.o.position.y = b.y + lakeWave(b.o.position.x, b.o.position.z, t) + Math.sin(t * 1.1 + b.ph) * b.bob * .4;
}

/* ------------------------------------------------------------------ the village on the grid */
const STREET = [-62, -46, -32, -19, 17, 29, 42, 56, 71];
const villageU = { uOn: { value: 1 } };
function buildVillage() {
  const G = new THREE.Group();
  // poles are baked; lamp heads and their light pools are two merged meshes whose vertex colours we drive per lamp
  const lamps = [], far = [...STREET].sort((a, b) => Math.abs(b) - Math.abs(a)), poles = new THREE.Group(), heads = [], pools = [];
  const pool = canvasTex(128, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.42)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, { repeat: false });
  let hv = 0, pv = 0;
  STREET.forEach((x, i) => {
    const z = 29.1; mesh(new THREE.CylinderGeometry(.055, .09, 6.2, 5), M.pole, poles, x, 3.1, z);
    mesh(rodGeo(new V(x, 6.0, z), new V(x, 6.25, z + 1.1), .032, 5), M.pole, poles);
    mesh(new THREE.BoxGeometry(.2, .08, .42), M.eqGrey, poles, x, 6.22, z + 1.2);
    const hg = new THREE.BoxGeometry(.18, .05, .38).toNonIndexed(); hg.translate(x, 6.17, z + 1.2); heads.push(hg);
    const l = { i, x, cut: .38 + far.indexOf(x) * .011, h: [hv, hg.attributes.position.count], p: [pv, 0] }; hv += hg.attributes.position.count;
    for (const [w, d, y, zz] of [[8, 3.6, groundH(x, 27.8) + .06, 27.8], [6, 13, LAKE_Y + .16, 36.8]]) { const pg = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).toNonIndexed(); pg.translate(x, y, zz); pools.push(pg); l.p[1] += pg.attributes.position.count; }
    pv += l.p[1]; lamps.push(l);
  });
  G.add(bake(poles));
  const withColor = g => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3)); return g; };
  const headM = new THREE.Mesh(withColor(mergeGeometries(heads)), new THREE.MeshBasicMaterial({ vertexColors: true })); headM.frustumCulled = false; G.add(headM);
  const poolM = new THREE.Mesh(withColor(mergeGeometries(pools)), new THREE.MeshBasicMaterial({ map: pool, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  poolM.renderOrder = 3; poolM.frustumCulled = false; G.add(poolM);
  G.userData.lampMeshes = { headM, poolM };
  // neighbours: smaller tiled houses east along the bank
  const nb = new THREE.Group();
  for (const [x, z, ry] of NEIGH) {
    const hG = new THREE.Group(); hG.position.set(x, groundH(x, z), z); hG.rotation.y = ry; nb.add(hG);
    mesh(boxW(9, .6, 6.4), M.redox, hG, 0, .3, 0);
    mesh(boxW(8.2, 2.7, 5.6), M.wall, hG, 0, .6 + 1.35, 0);
    const r = hipGableRoof({ W: 10, D: 7.4, pitch: THREE.MathUtils.degToRad(34), gable: .45, kodi: false, rafters: false }); r.position.set(0, 3.25, 0); hG.add(r);
    for (const wx of [-2.6, 0, 2.6]) { mesh(new THREE.PlaneGeometry(.9, 1.1), M.village, hG, wx, 1.95, 2.815, 0, false); mesh(new THREE.BoxGeometry(1.1, .12, .16), M.wood, hG, wx, 2.56, 2.84); }
    mesh(new THREE.PlaneGeometry(1.2, 2), M.village, hG, 4.115, 1.6, 0, Math.PI / 2, false);
  }
  G.add(bake(nb));
  G.userData.lamps = lamps;
  return G;
}

/* ------------------------------------------------------------------ terrain */
function groundH(x, z) {
  const d = Math.hypot(x + 10, z);
  const far = smooth(140, 420, d);
  let h = (fbm(x * .012 + 3, z * .012 - 2, 4) * 16 - 4) * far;
  h += (fbm(x * .07, z * .07, 2) - .5) * .25 * (1 - far);
  const paddy = (1 - smooth(-27, -24.5, x)) * (1 - smooth(24, 27, z)) * (1 - smooth(150, 190, -z)) * (1 - far);
  h = lerp(h, -.4, paddy);
  // the backwater: a low bund along the bank, then the lake bed
  h += .18 * smooth(26.5, 28, z) * (1 - smooth(29.4, 30.4, z));
  const lake = smooth(29.6, 32.5, z) * (1 - smooth(150, 168, z));
  h = lerp(h, -2.6, lake);
  return h;
}
function buildGround() {
  const g = new THREE.PlaneGeometry(1400, 1400, 280, 280); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = [], c = new THREE.Color();
  // squeeze vertices toward the house so the bank and lawn stay crisp nearby
  for (let i = 0; i < p.count; i++) { const wx = p.getX(i) / 700, wz = p.getZ(i) / 700; p.setX(i, Math.sign(wx) * wx * wx * 700); p.setZ(i, Math.sign(wz) * wz * wz * 700); }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = groundH(x, z); p.setY(i, y);
    const n = fbm(x * .05, z * .05, 3), n2 = fbm(x * .006 + 7, z * .006, 3);
    // tints multiply the photographic grass
    c.setRGB(.66 + .12 * n, .74 + .1 * n + .06 * n2, .6 + .08 * n, THREE.SRGBColorSpace);
    if (x < -24 && x > -200 && z < 26) c.setRGB(.95, 1, .72, THREE.SRGBColorSpace);
    if (Math.abs(x) < 24 && z < 27 && z > -18) c.setRGB(.9 + .08 * n, .95 + .05 * n, .86, THREE.SRGBColorSpace);
    if (z > 29.8) c.setRGB(.42, .38, .3, THREE.SRGBColorSpace);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 3.6, p.getZ(i) / 3.6); }
  const m = new THREE.Mesh(g, std({ vertexColors: true, map: PT.grass ? PT.grass.map : T.grass, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ vegetation */
const windU = { uTime: { value: 0 }, uWind: { value: 1 } };
// One breeze for every plant — used by both the colour and the shadow (depth) shaders,
// so the dappled shadows on the house move exactly with the fronds.
const WIND_GLSL = `
uniform float uTime; uniform float uWind;
vec3 arkaWind(vec3 p, vec2 uvv, float amp, float flutter, float hs){
  vec3 ip = vec3(0.); mat3 im = mat3(1.);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz; im = mat3(instanceMatrix);
  #endif
  float ph = ip.x * .37 + ip.z * .23;
  float gust = .55 + .45 * sin(uTime * .31 + ip.x * .015) * sin(uTime * .19 + ip.z * .02 + 1.3);
  float bend = clamp(p.y / hs, 0., 1.5); bend *= bend;
  vec3 w = vec3(sin(uTime * .8 + ph) * .55 + .45, 0., cos(uTime * .63 + ph * 1.3) * .4) * bend;
  float f = uvv.x * uvv.x * flutter;
  w += vec3(sin(uTime * 2.4 + ph + p.y * .35) * .5, sin(uTime * 3.3 + ph * 2.) * .28, cos(uTime * 2.1 + ph + p.x * .5) * .45) * f;
  w *= amp * uWind * gust;
  float s2 = max(dot(im[0], im[0]), 1e-4);
  return transpose(im) * w / s2;   // world-space breeze → instance space
}`;
function windify(mat, { amp = .3, flutter = 1, hs = 12 } = {}) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = windU.uTime; sh.uniforms.uWind = windU.uWind;
    sh.vertexShader = WIND_GLSL + '\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed += arkaWind(position, uv, ${amp.toFixed(3)}, ${flutter.toFixed(3)}, ${hs.toFixed(2)});`);
  };
  mat.customProgramCacheKey = () => `wind${amp}${flutter}${hs}`;
  return mat;
}
function windDepth(map, alphaTest, opts) {
  return windify(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map || null, alphaTest: alphaTest || 0 }), opts);
}
function ribbon(len, width, droop, rise, segs = 14, fold = .2, taperIn = .06) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs, x = len * s, y = len * rise * s - droop * len * s * s;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.04)), .7) * (s < taperIn ? s / taperIn : 1) + .004;
    pos.push(x, y - fold * w, -w, x, y, 0, x, y - fold * w, w); uv.push(s, 0, s, .5, s, 1);
  }
  for (let i = 0; i < segs; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function colorize(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }

function coconutParts(seed, h, lean) {
  const r = mulberry32(seed);
  const curve = new THREE.CatmullRomCurve3([new V(0, 0, 0), new V(lean * .12, h * .3, 0), new V(lean * .5, h * .66, 0), new V(lean, h, 0)]);
  const tub = new THREE.TubeGeometry(curve, 30, .19, 7, false);
  const p = tub.attributes.position, cols = [], ring = 8;
  for (let i = 0; i < p.count; i++) {
    const t = Math.floor(i / ring) / 30, c = curve.getPointAt(t), v = new V().fromBufferAttribute(p, i).sub(c);
    v.multiplyScalar((1 - .38 * t) * (1 + .75 * Math.pow(1 - t, 9))); v.add(c); p.setXYZ(i, v.x, v.y, v.z);
    const band = .8 + .2 * Math.pow(Math.abs(Math.sin(t * h * 8)), 5);
    { const cc = srgb(.36 * band + .06 * t, .31 * band + .05 * t, .25 * band); cols.push(cc.r, cc.g, cc.b); }
  }
  tub.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  tub.deleteAttribute('uv'); tub.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  const top = curve.getPointAt(1), fronds = [], farFronds = [], n = 19;
  for (let k = 0; k < n; k++) {
    const young = k < 3, dead = !young && r() < .1;
    const len = young ? R(2.6, 3.2) : R(3.9, 5.1), el = young ? R(.95, 1.25) : R(.25, .75);
    const args = [len, young ? .42 : .8, young ? .25 : R(1.05, 1.45), young ? .3 : .62];
    const g = ribbon(...args, 16, young ? .35 : .62), gf = ribbon(args[0], args[1] * 1.15, args[2], args[3], 6, young ? .35 : .62);
    const rx = R(-.3, .3), ry = k / n * Math.PI * 2 + R(-.2, .2);
    for (const q of [g, gf]) { q.rotateX(rx); q.rotateZ(el); q.rotateY(ry); q.translate(top.x, top.y, top.z); }
    const c = dead ? srgb(.56, .44, .22) : srgb(.3 + r() * .12, .46 + r() * .1, .12 + r() * .05);
    fronds.push(colorize(g.toNonIndexed(), c));
    if (young || k % 3 !== 1) farFronds.push(colorize(gf.toNonIndexed(), c));   // distant palms: fewer, coarser fronds
  }
  const nuts = []; for (let k = 0; k < 7; k++) { const s = new THREE.SphereGeometry(.11, 6, 5); const a = k / 7 * 6.28; s.translate(top.x + Math.cos(a) * .22, top.y - .25 - (k % 2) * .12, top.z + Math.sin(a) * .22); nuts.push(colorize(s.toNonIndexed(), srgb(.4, .42, .14))); }
  const crown = mergeGeometries(fronds);
  const nutG = mergeGeometries(nuts);
  nutG.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(nutG.attributes.position.count * 2), 2));
  const trunk = mergeGeometries([tub.toNonIndexed(), nutG]);
  return { trunk, crown, far: { trunk, crown: mergeGeometries(farFronds) } };
}
function arecaParts(seed, h) {
  const trunk = new THREE.CylinderGeometry(.075, .1, h, 6, 12); trunk.translate(0, h / 2, 0);
  const p = trunk.attributes.position, cols = [];
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; const band = .85 + .15 * Math.pow(Math.abs(Math.sin(t * h * 6)), 8); const g = t > .9; { const cc = g ? srgb(.26, .38, .12) : srgb(.42 * band, .41 * band, .35 * band); cols.push(cc.r, cc.g, cc.b); } }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const fronds = [];
  for (let k = 0; k < 8; k++) { const g = ribbon(R(2, 2.6), .5, R(.25, .45), .35, 12, .25); g.rotateZ(R(.3, 1.0)); g.rotateY(k / 8 * 6.28 + R(-.2, .2)); g.translate(0, h, 0); fronds.push(colorize(g.toNonIndexed(), srgb(.22, .36, .1))); }
  void seed;
  return { trunk: trunk.toNonIndexed(), crown: mergeGeometries(fronds) };
}
function bananaParts() {
  const stem = new THREE.CylinderGeometry(.09, .15, 2.1, 7); stem.translate(0, 1.05, 0); colorize(stem, srgb(.36, .45, .2));
  const leaves = [];
  for (let k = 0; k < 8; k++) { const g = ribbon(R(1.8, 2.4), .34, R(.85, 1.2), .78, 14, .12, .02); g.rotateX(R(-.25, .25)); g.rotateZ(R(.55, 1.0)); g.rotateY(k / 8 * 6.28 + R(-.3, .3)); g.translate(0, 2.0, 0); leaves.push(colorize(g.toNonIndexed(), k === 5 ? srgb(.55, .47, .22) : srgb(.34 + R(0, .08), .52 + R(0, .08), .16))); }
  return { trunk: stem.toNonIndexed(), crown: mergeGeometries(leaves) };
}
// broad-leaf trees (mango, jackfruit, wild almond): branching trunk + layered leaf clusters with rounded normals
function broadleafParts(seed, h, cr, tint) {
  const r = mulberry32(seed), parts = [];
  const bark = g => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = .85 + .15 * Math.sin(i * .7); const cc = srgb(.34 * k, .3 * k, .25 * k); c.set([cc.r, cc.g, cc.b], i * 3); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2)); return g.toNonIndexed(); };
  const main = new THREE.CatmullRomCurve3([new V(0, 0, 0), new V(.3, h * .25, .1), new V(-.1, h * .5, 0), new V(.2, h * .62, -.1)]);
  parts.push(bark(new THREE.TubeGeometry(main, 16, .32, 7, false)));
  const tips = [];
  for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283 + r() * .6, st = main.getPointAt(.55 + r() * .3), tip = new V(Math.cos(a) * cr * .62, h * (.7 + r() * .15), Math.sin(a) * cr * .62);
    parts.push(bark(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(st, st.clone().lerp(tip, .5).add(new V(0, h * .08, 0)), tip), 8, .13, 5, false))); tips.push(tip); }
  const trunk = mergeGeometries(parts);
  const center = new V(0, h * .76, 0), cl = [], clFar = [];
  for (let k = 0; k < 34; k++) {
    const a = r() * 6.283, e = (r() - .35) * 1.3, rr = Math.cbrt(r()) * .85 + .15;
    const p = new V(Math.cos(a) * Math.cos(e) * cr * rr, Math.sin(e) * cr * .72 * rr, Math.sin(a) * Math.cos(e) * cr * rr).add(center);
    const sz = 2.2 + r() * 1.6, g = mergeGeometries([0, 1, 2].map(q => { const pl = new THREE.PlaneGeometry(sz, sz); pl.rotateY(q / 3 * Math.PI); pl.rotateX(r() * .6 - .3); return pl.toNonIndexed(); }));
    g.translate(p.x, p.y, p.z);
    const pos = g.attributes.position, nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) { const n = new V(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center).normalize(); nor.setXYZ(i, n.x, n.y, n.z); }
    const shade = .8 + r() * .35, top = (p.y - center.y) / cr;
    colorize(g, srgb(tint[0] * shade * (1 + top * .25), tint[1] * shade * (1 + top * .2), tint[2] * shade));
    cl.push(g);
    if (k % 2 === 0) { const f = g.clone(); f.translate(-p.x, -p.y, -p.z); f.scale(1.3, 1.3, 1.3); f.translate(p.x, p.y, p.z); clFar.push(f); }
  }
  return { trunk, crown: mergeGeometries(cl), far: { trunk, crown: mergeGeometries(clFar) } };
}
const NEAR_R = 36;
const NEIGH = [[31.5, 19, -.1], [45, 21.5, .18], [60, 14, -.25], [-34, 20.5, .12]];
const clearOfNeigh = (x, z) => NEIGH.every(([nx, nz]) => Math.hypot(x - nx, z - nz) > 7.5);
function plantInstances(parts, list, mats) {
  const G = new THREE.Group();
  const near = list.filter(it => Math.hypot(it.x, it.z - 8) < NEAR_R), far = list.filter(it => Math.hypot(it.x, it.z - 8) >= NEAR_R);
  if (near.length) G.add(plantSet(parts, near, mats, true));
  if (far.length) G.add(plantSet(parts.far || parts, far, mats, false));
  return G;
}
function plantSet(parts, list, mats, isNear) {
  const G = new THREE.Group(), trunk = new THREE.InstancedMesh(parts.trunk, mats.trunk, list.length), crown = new THREE.InstancedMesh(parts.crown, mats.crown, list.length);
  trunk.customDepthMaterial = mats.trunkDepth; crown.customDepthMaterial = mats.crownDepth;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach((it, i) => { q.setFromEuler(new THREE.Euler(0, it.ry, 0)); m.compose(new V(it.x, groundH(it.x, it.z) - .05, it.z), q, new V(it.s, it.s * (it.sy || 1), it.s)); trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m); });
  for (const im of [trunk, crown]) { im.castShadow = isNear; im.receiveShadow = true; im.frustumCulled = false; if (!isNear) im.layers.set(1); G.add(im); }
  return G;
}
function grassDrawTuft(g, w, h) {
  g.clearRect(0, 0, w, h); const r = mulberry32(88);
  for (let i = 0; i < 150; i++) {
    const x = w * (.08 + r() * .84), hh = h * (.35 + r() * .62), lean = (r() - .5) * w * .18, lw = 1.2 + r() * 2.2;
    const gc = [[52, 78, 30], [66, 94, 36], [84, 108, 46], [120, 124, 70], [40, 62, 26]][(r() * 5) | 0];
    g.strokeStyle = `rgb(${gc[0]},${gc[1]},${gc[2]})`; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * .3, h - hh * .5, x + lean, h - hh); g.stroke();
  }
}
function buildVegetation() {
  const G = new THREE.Group(), D = isSmall ? .55 : 1;
  const trunkMat = windify(std({ vertexColors: true, roughness: .95 }), { amp: .42, flutter: 0, hs: 12 });
  const frondMat = windify(std({ map: T.leaf, alphaTest: .42, side: THREE.DoubleSide, vertexColors: true, roughness: .72 }), { amp: .42, flutter: .9, hs: 12 });
  const coconutMats = { trunk: trunkMat, crown: frondMat, trunkDepth: windDepth(null, 0, { amp: .42, flutter: 0, hs: 12 }), crownDepth: windDepth(T.leaf, .42, { amp: .42, flutter: .9, hs: 12 }) };
  const banMats = {
    trunk: windify(std({ vertexColors: true, roughness: .9 }), { amp: .12, flutter: 0, hs: 2.4 }),
    crown: windify(std({ map: T.banana, alphaTest: .4, side: THREE.DoubleSide, vertexColors: true, roughness: .62 }), { amp: .12, flutter: 1.6, hs: 2.4 }),
    trunkDepth: windDepth(null, 0, { amp: .12, flutter: 0, hs: 2.4 }), crownDepth: windDepth(T.banana, .4, { amp: .12, flutter: 1.6, hs: 2.4 }),
  };
  const inRect = (x, z, x0, x1, z0, z1) => x > x0 && x < x1 && z > z0 && z < z1;
  const free = (x, z) => !(inRect(x, z, -12.2, 12.2, -12.8, 17.2) || inRect(x, z, -12.8, 12.8, 15, 29.6) || inRect(x, z, 9.2, 19.8, 13.2, 21.8) || Math.hypot(x + 8.2, z - 21.2) < 2.4 || inRect(x, z, -4.2, 4.2, 26, 34) || inRect(x, z, 9.4, 23.5, .5, 13.5));   // last: the east yard, open around the KSEB pole
  const pal = [], lean = [];
  // inside the compound — thick enough that fronds shade the house
  for (let x = -22; x <= 22; x += 4.4) for (let z = -16; z <= 25; z += 4.4) { const px = x + R(-1.5, 1.5), pz = z + R(-1.5, 1.5); if (free(px, pz) && Math.abs(px) < 23.2 && rand() < .82 * D) pal.push([px, pz]); }
  for (const [x, z] of [[-13.2, 5], [-13.6, -4.5], [-14.2, 11.5], [-12.8, -10], [13.4, -6]]) pal.push([x, z]);
  // the bank: palms leaning out over the backwater
  for (let x = -96; x <= 96; x += R(4.2, 6.2)) { if (Math.abs(x) < 4.5 || (x > -64 && x < -28) || (x > -19 && x < 13) || STREET.some(sx => Math.abs(sx - x) < 1.6)) continue; lean.push([x + R(-.6, .6), R(27.9, 29.6)]); }
  // groves behind and beside the house
  for (let x = -46; x <= 46; x += 5.2) for (let z = -74; z <= -20; z += 5.2) if (rand() < .78 * D) pal.push([x + R(-2, 2), z + R(-2, 2)]);
  for (let x = 27; x <= 88; x += 5.6) for (let z = -48; z <= 25; z += 5.6) if (rand() < .72 * D) { const px = x + R(-2, 2), pz = z + R(-2, 2); if (clearOfNeigh(px, pz)) pal.push([px, pz]); }
  for (let x = -60; x <= -27; x += 6) for (let z = -80; z <= -30; z += 6) if (rand() < .5 * D) pal.push([x + R(-2, 2), z + R(-2, 2)]);
  for (let z = -60; z <= 24; z += R(5, 7.5)) pal.push([-25.4 + R(-1, 1), z]);
  for (let i = 0; i < 90 * D; i++) pal.push([R(-205, -182), R(-240, 26)]);
  for (let i = 0; i < 24 * D; i++) { const a = R(-1.5, 1.1), d = R(90, 180); pal.push([Math.cos(a) * d + 10, Math.sin(a) * d - 10]); }
  for (let x = -160; x <= 160; x += R(5, 9)) pal.push([x, R(168, 178)]);    // far bank of the lake
  const variants = [coconutParts(1, 12.5, 1.6), coconutParts(2, 10.5, 2.4), coconutParts(3, 14, .9)];
  const buckets = [[], [], []];
  for (const [x, z] of pal) buckets[(rand() * 3) | 0].push({ x, z, ry: R(0, 6.28), s: R(.78, 1.2) });
  variants.forEach((v, i) => G.add(plantInstances(v, buckets[i], coconutMats)));
  // leaning bank palms: the lean always points at the water (+z)
  const leanList = lean.map(([x, z]) => ({ x, z, ry: -Math.PI / 2 + R(-.45, .45), s: R(.85, 1.15) }));
  G.add(plantInstances(coconutParts(5, 11.5, 3.8), leanList, coconutMats));
  // broad-leaf trees among the palms, as along the backwaters
  const broadMat = windify(std({ map: T.broad, alphaTest: .5, side: THREE.DoubleSide, vertexColors: true, roughness: .78 }), { amp: .16, flutter: .35, hs: 9 });
  const broadMats = { trunk: windify(std({ vertexColors: true, roughness: .95 }), { amp: .16, flutter: 0, hs: 9 }), crown: broadMat, trunkDepth: windDepth(null, 0, { amp: .16, flutter: 0, hs: 9 }), crownDepth: windDepth(T.broad, .5, { amp: .16, flutter: .35, hs: 9 }) };
  const trees = [[], []];
  const bspots = [[-16.5, 27.6], [19.5, 27.2], [-20, 19], [20.5, -9], [-19.5, -14.5], [16, -15.5], [21, 5.5], [-21, 8.5], [-34, 27.8], [33, 27.6], [52, 28.2], [-47, 27.9], [-70, 27.6], [72, 27.4], [0, -24], [-12, -31], [13, -29], [-26, -40], [28, -38], [4, -46], [-38, -22], [40, -14], [46, 8], [-8, -56], [22, -60]];
  for (let i = 0; i < 26 * D; i++) bspots.push([R(-90, 90), R(40, 70) * -1]);
  for (let i = 0; i < 14; i++) bspots.push([R(-150, 150), R(160, 176)]);
  bspots.forEach(([x, z], i) => { if (clearOfNeigh(x, z)) trees[i % 2].push({ x, z, ry: R(0, 6.28), s: R(.85, 1.25) }); });
  G.add(plantInstances(broadleafParts(71, 10, 4.4, [.62, .82, .42]), trees[0], broadMats));
  G.add(plantInstances(broadleafParts(72, 12, 5.2, [.52, .74, .36]), trees[1], broadMats));
  // bananas: clumps around the house and a plantation behind it
  const ban = [];
  for (const [cx, cz] of [[-13, -13.5], [12.5, -14.5], [-20.5, 1.5], [-21, 25], [20.5, -15.5], [-16.5, -16], [17.5, -2.5], [-22, -7.5], [22, 22.5], [-15, 24.5], [14.5, 24.5], [-21.5, 17.5]]) {
    const n = 5 + ((rand() * 3) | 0); for (let k = 0; k < n; k++) ban.push({ x: cx + R(-1.6, 1.6), z: cz + R(-1.6, 1.6), ry: R(0, 6.28), s: R(.8, 1.2) });
  }
  for (let x = -20; x <= 20; x += 2.3) for (let z = -21; z >= -30; z -= 2.6) if (rand() < .85) ban.push({ x: x + R(-.5, .5), z: z + R(-.5, .5), ry: R(0, 6.28), s: R(.85, 1.15) });
  for (let i = 0; i < 40 * D; i++) { const x = R(28, 70), z = R(-40, 20); if (clearOfNeigh(x, z)) ban.push({ x, z, ry: R(0, 6.28), s: R(.85, 1.2) }); }
  G.add(plantInstances(bananaParts(), ban, banMats));
  // grass tufts over the lawn and the bank (kept out of the water reflection)
  const tuftTex = canvasTex(256, 128, grassDrawTuft, { repeat: false });
  const tuftG = mergeGeometries([0, 1, 2].map(k => { const pg = new THREE.PlaneGeometry(.46, .24); pg.translate(0, .12, 0); pg.rotateY(k / 3 * Math.PI); return pg.toNonIndexed(); }));
  const tuftMat = windify(std({ map: tuftTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .9 }), { amp: .1, flutter: 0, hs: .34 });
  const tufts = [], N = isSmall ? 2200 : 6500;
  for (let i = 0; i < N * 3 && tufts.length < N; i++) {
    const onBank = rand() < .1, x = onBank ? R(-90, 90) : R(-23.6, 23.6), z = onBank ? R(27.5, 30.2) : R(-17.6, 26.6);
    if (!free(x, z) && !onBank) continue; if (onBank && Math.abs(x) < 4.2) continue;
    tufts.push([x, z]);
  }
  const tim = new THREE.InstancedMesh(tuftG, tuftMat, tufts.length), mm = new THREE.Matrix4();
  tufts.forEach(([x, z], i) => { const sc = R(.7, 1.35); mm.compose(new V(x, groundH(x, z) + .01, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R(0, 6.28), 0)), new V(sc, sc * R(.7, 1.3), sc)); tim.setMatrixAt(i, mm); });
  tim.receiveShadow = true; tim.frustumCulled = false; tim.layers.set(1); G.add(tim);
  // flowering shrubs: hibiscus, ixora, jasmine — leafy crossed cards
  const cardG = mergeGeometries([0, 1, 2].map(k => { const p = new THREE.PlaneGeometry(1.5, 1.25); p.translate(0, .6, 0); p.rotateY(k / 3 * Math.PI); return p.toNonIndexed(); }).concat([(() => { const p = new THREE.PlaneGeometry(1.3, 1.3); p.rotateX(-Math.PI / 2 + .25); p.translate(0, 1.0, 0); return p.toNonIndexed(); })()]));
  const shrubSpots = [];
  for (let z = 19.6; z < 26; z += 1.25) for (const x of [-2.2, 2.2]) shrubSpots.push([x + R(-.2, .2), z]);
  for (let x = -22; x <= 22; x += 1.9) if (Math.abs(x) > 13.4) shrubSpots.push([x + R(-.3, .3), 26.4]);
  for (let z = -16; z <= 25; z += 2.1) { shrubSpots.push([-22.9, z]); shrubSpots.push([22.9, z]); }
  for (const [x, z] of [[-9.9, 13], [9.9, 13], [-4, 16.4], [4, 16.4], [-10.5, 6], [10.5, 6], [-10, -4], [10, -4], [-10.4, 9.5], [10.4, 9.5], [-9.6, 2]]) shrubSpots.push([x, z]);
  const kinds = [T.hibiscus, T.ixora, T.jasmine, T.plain];
  const lists = kinds.map(() => []);
  shrubSpots.forEach((sp, i) => lists[(hash2(i, 7) * 4) | 0].push(sp));
  const m = new THREE.Matrix4();
  kinds.forEach((tex, k) => {
    const L = lists[k]; if (!L.length) return;
    const im = new THREE.InstancedMesh(cardG, windify(std({ map: tex, alphaTest: .5, side: THREE.DoubleSide, roughness: .75 }), { amp: .05, flutter: 0, hs: 1.2 }), L.length);
    L.forEach(([x, z], i) => { const s = R(.75, 1.25); m.compose(new V(x, groundH(x, z) - .05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R(0, 6.28), 0)), new V(s, s * R(.85, 1.2), s)); im.setMatrixAt(i, m); });
    im.castShadow = true; im.receiveShadow = true; G.add(im);
  });
  return G;
}

/* ------------------------------------------------------------------ paddy fields: the landscape grid */
function buildPaddy() {
  const G = new THREE.Group();
  const xs = [-26, -35, -44, -53, -63, -73, -84, -95, -106, -118, -130, -142, -155, -168, -180];
  const zs = []; for (let z = -176; z <= 24; z += 8) zs.push(z);
  const water = [], lush = [], bunds = [];
  const lushMat = std({ color: 0x6f9a2c, roughness: .92 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x6a6647, roughness: .1, metalness: .35 });
  const bundMat = std({ color: 0x6e5b3c, roughness: 1 });
  const WY = -.36;
  const plots = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const xa = xs[i + 1], xb = xs[i], za = zs[j], zb = zs[j + 1];
    plots.push([xa, xb, za, zb, hash2(i * 7 + 3, j * 13 + 1) < .2]);
  }
  for (const [xa, xb, za, zb, isWater] of plots) {
    const g = new THREE.PlaneGeometry(xb - xa, zb - za); g.rotateX(-Math.PI / 2); g.translate((xa + xb) / 2, WY, (za + zb) / 2);
    (isWater ? water : lush).push(g);
    for (const [ba, bb, horiz] of [[za, zb, false], [xa, xb, true]]) {
      const len = horiz ? (xb - xa) : (zb - za), b = new THREE.BoxGeometry(horiz ? len : .5, .34, horiz ? .5 : len);
      if (horiz) b.translate((xa + xb) / 2, WY + .08, za); else b.translate(xa, WY + .08, (za + zb) / 2);
      bunds.push(b.toNonIndexed()); void ba; void bb;
    }
  }
  const lm = new THREE.Mesh(mergeGeometries(lush), lushMat); lm.receiveShadow = true;
  const wm = new THREE.Mesh(mergeGeometries(water), waterMat);
  const bm = new THREE.Mesh(mergeGeometries(bunds), bundMat); bm.receiveShadow = true; bm.castShadow = true;
  G.add(lm, wm, bm);
  // paddy clumps in rows that lead the eye to the chart
  const clump = mergeGeometries(Array.from({ length: 7 }, (_, k) => {
    const h = R(.55, .8), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.018, 0, 0, .018, 0, 0, -.011, h * .5, h * .05, .011, h * .5, h * .05, 0, h, h * .2], 3));
    { const a = srgb(.3, .46, .12), b = srgb(.5, .66, .18), c = srgb(.8, .84, .38); g.setAttribute('color', new THREE.Float32BufferAttribute([a.r, a.g, a.b, a.r, a.g, a.b, b.r, b.g, b.b, b.r, b.g, b.b, c.r, c.g, c.b], 3)); }
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, .5, .5, .5, .5, 1, 1], 2));
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    g.rotateY(k / 7 * 6.28 + R(-.3, .3)); g.rotateZ(R(-.15, .15));
    return g.toNonIndexed();
  }));
  clump.computeVertexNormals();
  const spots = [];
  const step = isSmall ? .62 : .45;
  for (const [xa, xb, za, zb, isW, isChart] of plots) {
    if (isW || isChart) continue;
    if (xa < -65 || Math.abs((za + zb) / 2) > 34) continue;
    for (let x = xa + .5; x < xb - .4; x += step) for (let z = za + .5; z < zb - .4; z += step * .8) spots.push([x + R(-.08, .08), z + R(-.08, .08)]);
  }
  const bladeMat = windify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { amp: .1, flutter: 1, hs: .8 });
  const im = new THREE.InstancedMesh(clump, bladeMat, spots.length), m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => { const s = R(.8, 1.2); m.compose(new V(x, WY, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R(0, 6.28), 0)), new V(s, s, s)); im.setMatrixAt(i, m); });
  im.frustumCulled = false; im.layers.set(1); G.add(im);
  // backwaters on the western horizon
  const bw = new THREE.Mesh(new THREE.PlaneGeometry(60, 900), new THREE.MeshStandardMaterial({ color: 0x3c5566, roughness: .05, metalness: .2 }));
  bw.rotation.x = -Math.PI / 2; bw.position.set(-222, -.2, 0); G.add(bw);
  return G;
}

/* ------------------------------------------------------------------ sky, hills, atmosphere */
const skyU = {
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
  uSunCol: { value: new THREE.Color() }, uSunDir: { value: new V(0, 1, 0) }, uGlow: { value: 1 }, uStars: { value: 0 }, uTime: { value: 0 }, uDisk: { value: 1 }, uClouds: { value: 0 }, uMoon: { value: 0 }, uRain: { value: 0 }, uMoonDir: { value: new V(.36, .27, -.89).normalize() },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
  fragmentShader: `uniform vec3 uZenith, uHorizon, uGround, uSunCol; uniform vec3 uSunDir, uMoonDir; uniform float uGlow, uStars, uTime, uDisk, uClouds, uMoon, uRain; varying vec3 vDir;
    float h3(vec3 p){ p = fract(p*.3183099+.1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
    float fb(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*n2(p); p = p*2.03 + vec2(1.7,9.2); a *= .5; } return s; }
    void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 s = normalize(uSunDir);
      vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-.02,.55,h), .6));
      col = mix(col, uGround, smoothstep(0.,-.18,h));
      float sd = max(dot(d,s),0.);
      vec2 dh = normalize(d.xz+1e-4), sh = normalize(s.xz+1e-4);
      float az = max(dot(dh,sh),0.);
      col += uSunCol * (pow(sd,5.)*.42 + pow(sd,48.)*.55) * uGlow;
      col += uSunCol * pow(az,2.4) * exp(-abs(h-.02)*9.) * .4 * uGlow;
      if(uClouds > .01 && h > 0.){ vec2 cp = d.xz/(d.y+.09)*.85 + vec2(uTime*.006, uTime*.0025);
        float cl = fb(cp*1.25); float cover = smoothstep(.5 - uRain*.42,.78 - uRain*.2,cl)*smoothstep(0.,.16,h)*uClouds;
        float lit = .78 + .22*max(dot(normalize(d.xz+1e-4), normalize(s.xz+1e-4)),0.);
        vec3 cc = mix(vec3(.93,.95,.98), uSunCol*1.05, .3)*lit*mix(.22,1.,smoothstep(-.12,.2,s.y));
        cc = mix(cc, vec3(.44,.49,.52)*(.8+.3*cl), uRain);
        col = mix(col, cc, cover*.88); }
      col = mix(col, vec3(.6,.65,.68)*(.82+.25*smoothstep(-.1,.5,h)), uRain*.94);
      float disk = smoothstep(.99935,.99965,sd) * uDisk;
      col = mix(col, uSunCol*4. + vec3(.6), disk);
      if(uStars > .01){ vec3 q = d*190.; vec3 cell = floor(q); float r = h3(cell); vec3 f = fract(q)-.5;
        float star = step(.9945,r) * smoothstep(.16,.0,length(f)) * smoothstep(.02,.25,h);
        col += vec3(1.,.93,.8) * star * uStars * (.6+.4*sin(uTime*2.+r*90.)) * 2.2; }
      if(uMoon > .01){ float md = max(dot(d, normalize(uMoonDir)), 0.);
        float disk = smoothstep(.99962, .9998, md); float mare = .82 + .18*n2(d.xy*900. + d.z*300.);
        col += vec3(.72,.8,1.) * (pow(md, 900.)*.5 + pow(md, 60.)*.07 + pow(md, 8.)*.035) * uMoon;
        col = mix(col, vec3(1.9,1.95,2.1)*mare, disk*uMoon); }
      gl_FragColor = vec4(col,1.); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), skyMat); sky.renderOrder = -10; sky.frustumCulled = false;

const hillU = { uHorizon: { value: new THREE.Color() }, uRidge: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uSunDir: { value: new V() }, uGlow: { value: 1 } };
function buildHills() {
  const G = new THREE.Group();
  const layers = [{ R: 330, mix: .48, amp: 1 }, { R: 460, mix: .34, amp: 1.25 }, { R: 620, mix: .22, amp: 1.5 }, { R: 820, mix: .13, amp: 1.8 }];
  layers.forEach((L, li) => {
    const segs = 360, pos = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2, x = Math.cos(a) * L.R, z = Math.sin(a) * L.R;
      const ghats = .18 + .82 * Math.pow(Math.max(0, Math.cos(a + .75)), 1.4);
      const hgt = (fbm(a * 3.2 + li * 11, li * 3.1, 5) * 1.35 - .25) * 70 * ghats * L.amp + 6;
      pos.push(x, -30, z, x, Math.max(4, hgt), z);
      if (i < segs) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...hillU, uMix: { value: L.mix } }, side: THREE.DoubleSide, fog: false, depthWrite: true,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 uHorizon, uRidge, uSunCol, uSunDir; uniform float uMix, uGlow; varying vec3 vP;
        void main(){ vec3 d = normalize(vP); float az = max(dot(normalize(d.xz), normalize(uSunDir.xz)), 0.);
          vec3 c = mix(uHorizon, uRidge, uMix);
          c += uSunCol * pow(az,6.) * .12 * uGlow;
          float haze = smoothstep(60.,-20.,vP.y); c = mix(c, uHorizon, haze*.55);
          gl_FragColor = vec4(c,1.); }`,
    });
    const m = new THREE.Mesh(g, mat); m.renderOrder = -5 + li * -.1; m.frustumCulled = false; G.add(m);
  });
  return G;
}

function buildMist() {
  const G = new THREE.Group(), mats = [];
  for (const [x, y, z, s, rot] of [[-150, 1.2, 0, 150, 0], [0, 2.5, -170, 300, .7], [-60, 1.6, 130, 200, 1.9], [170, 6, 0, 360, 2.8]]) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: T.mist.clone(), transparent: true, opacity: .2, depthWrite: false, fog: true });
    mat.alphaMap.wrapS = mat.alphaMap.wrapT = THREE.RepeatWrapping; mat.alphaMap.repeat.set(s / 120, s / 120); mat.alphaMap.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, y, z); m.renderOrder = 2;
    G.add(m); mats.push(mat);
  }
  G.userData.mats = mats;
  return G;
}

// god rays: soft volumetric shafts falling through the coconut canopy
const shaftU = { uCol: { value: new THREE.Color(1, .8, .5) }, uI: { value: 0 }, uTime: { value: 0 } };
function buildShafts() {
  const G = new THREE.Group(), list = [];
  const mat = new THREE.ShaderMaterial({
    uniforms: shaftU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying float vS; attribute float aSeed;
      void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); vY = uv.y; vS = position.x+position.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uI, uTime; varying vec3 vN; varying vec3 vV; varying float vY; varying float vS;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.4);
        float len = smoothstep(0.,.35,vY) * smoothstep(1.,.5,vY);
        float st = (.62 + .38*sin(vY*24. + uTime*.35 + vS*3.)) * (.7 + .3*sin(uTime*1.7 + vS*5.));
        gl_FragColor = vec4(uCol, f*len*st*uI); }`,
  });
  for (const [x, z, r] of [[-13.5, 6, 1.0], [-16.5, -3, .8], [-11.5, 13.5, .9], [-18.5, 15, 1.2], [-15.5, 22, .8], [-20.5, 4, .9], [-9.5, 20, .7], [-6, -13, 1.0]]) {
    const g = new THREE.CylinderGeometry(r, r * 1.5, 36, 18, 1, true);
    const m = new THREE.Mesh(g, mat); m.userData.ground = new V(x, 0, z); m.frustumCulled = false; m.renderOrder = 5; G.add(m); list.push(m);
  }
  G.userData.list = list;
  return G;
}

/* ------------------------------------------------------------------ particles: petals by day, fireflies by night */
function buildParticles() {
  const N = isSmall ? 120 : 220, pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { pos.set([rand(), rand(), rand()], i * 3); seed.set([rand(), rand(), rand(), rand()], i * 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const U = { uTime: { value: 0 }, uCenter: { value: new V() }, uBox: { value: new V(46, 16, 46) }, uI: { value: 1 }, uPx: { value: renderer.getPixelRatio() } };
  const petals = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aSeed; uniform float uTime, uPx; uniform vec3 uCenter, uBox; varying vec4 vS; varying float vA;
      void main(){ vS = aSeed; float t = uTime;
        vec3 dr = vec3(t*.55 + sin(t*.6 + aSeed.x*6.28)*1.2, -t*(.32 + aSeed.y*.3), t*.18 + cos(t*.45 + aSeed.z*6.28)*.9);
        vec3 q = fract(position + dr/uBox); vec3 p = (q - .5)*uBox + uCenter; p.y = uCenter.y + (q.y)*uBox.y*.8;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        vA = smoothstep(0.,.08,q.y)*smoothstep(1.,.85,q.y);
        gl_PointSize = (18. + aSeed.w*22.) * uPx / -mv.z; }`,
    fragmentShader: `uniform float uTime, uI; varying vec4 vS; varying float vA;
      void main(){ vec2 c = gl_PointCoord - .5; float a = uTime*(.8+vS.x) + vS.y*6.28; mat2 r = mat2(cos(a),-sin(a),sin(a),cos(a)); c = r*c;
        float d = length(c*vec2(1.,2.6)); float m = smoothstep(.5,.34,d);
        vec3 col = vS.w < .45 ? vec3(.98,.55,.2) : (vS.w < .75 ? vec3(.99,.8,.3) : vec3(.55,.62,.25));
        gl_FragColor = vec4(col, m*vA*uI*.9); if(gl_FragColor.a < .01) discard; }`,
  }));
  petals.frustumCulled = false; petals.renderOrder = 6;
  const FU = { uTime: U.uTime, uI: { value: 0 }, uPx: U.uPx };
  const ff = new Float32Array(160 * 3), fs = new Float32Array(160 * 4);
  for (let i = 0; i < 160; i++) { const a = R(0, 6.28), d = R(8, 30); ff.set([Math.cos(a) * d + 2, R(.4, 2.6), 8 + Math.sin(a) * d * .9], i * 3); fs.set([rand(), rand(), rand(), rand()], i * 4); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(ff, 3)); fg.setAttribute('aSeed', new THREE.BufferAttribute(fs, 4));
  const flies = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms: FU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec4 aSeed; uniform float uTime, uPx; varying float vB;
      void main(){ vec3 p = position + vec3(sin(uTime*.3+aSeed.x*20.)*1.4, sin(uTime*.5+aSeed.y*20.)*.5, cos(uTime*.27+aSeed.z*20.)*1.4);
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        vB = pow(.5+.5*sin(uTime*(1.2+aSeed.w*2.)+aSeed.x*40.), 3.);
        gl_PointSize = 44. * uPx / -mv.z; }`,
    fragmentShader: `uniform float uI; varying float vB; void main(){ float d = length(gl_PointCoord-.5); float m = smoothstep(.5,.0,d); gl_FragColor = vec4(vec3(.85,1.,.45)*2.2, m*m*vB*uI); }`,
  }));
  flies.frustumCulled = false; flies.renderOrder = 7;
  return { petals, flies, U, FU };
}

/* ------------------------------------------------------------------ the grid: roof → land → data */
const gridU = { uRadius: { value: 0 }, uAlpha: { value: 0 }, uOrigin: { value: new V(-10.5, 0, -2.5) }, uCol: { value: new THREE.Color(1, .66, .3) } };
function buildGrid() {
  const pts = [], y = x => (x < -25 ? -.18 : .06);
  const MW = 4.4, MH = 2.2;
  for (let z = -30; z <= 26; z += MH) for (let x = -64; x < 0; x += 2) pts.push(x, y(x), z, x + 2, y(x + 2), z);
  for (let x = -63.8; x <= 0; x += MW) for (let z = -30; z < 26; z += 2) pts.push(x, y(x), z, x, y(x), z + 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: gridU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.); }`,
    fragmentShader: `uniform float uRadius, uAlpha; uniform vec3 uOrigin, uCol; varying vec3 vW;
      void main(){ float d = distance(vW.xz, uOrigin.xz); float inside = smoothstep(uRadius, uRadius-6., d); float edge = exp(-pow((d-uRadius)*.35,2.))*1.6;
        float fade = smoothstep(80.,20.,d);
        gl_FragColor = vec4(uCol, (inside*.5 + edge) * uAlpha * fade); }`,
  });
  const L = new THREE.LineSegments(g, mat); L.frustumCulled = false; L.renderOrder = 4;
  return L;
}

/* ------------------------------------------------------------------ monsoon: rain the way a camera sees it */
// drops are thin motion-blurred quads (never thinner than a pixel, so they don't sparkle), falling at
// different speeds with a gusting slant; curtains of rain drift in the distance; the eaves pour; the water rings.
const rainU = { uTime: { value: 0 }, uI: { value: 0 }, uCenter: { value: new V() }, uPix: { value: .001 }, uWind: { value: new V(.14, 0, .05) }, uTint: { value: new THREE.Color(.8, .84, .88) } };
const RAIN_VS = `attribute vec4 aSeed; uniform float uTime, uPix; uniform vec3 uCenter, uWind; varying vec2 vQ; varying float vA;
  vec3 dropPos(vec4 sd, out float speed);
  void main(){
    float speed; vec3 p = dropPos(aSeed, speed);
    vec3 v = normalize(vec3(uWind.x, -1., uWind.z));
    vec3 toCam = cameraPosition - p; float d = length(toCam);
    vec3 side = normalize(cross(v, toCam));
    float w = .006 + aSeed.w * .005, wPix = uPix * d * 1.1, wr = max(w, wPix);
    float L = speed * (1. / 30.) * (1.3 + aSeed.y);                 // one frame of motion blur
    p += side * position.x * wr + v * (position.y - .5) * L;
    vQ = position.xy + vec2(0., .5);
    vA = (w / wr) * smoothstep(1.2, 3.5, d) * (1. - smoothstep(26., 44., d));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
  }`;
const RAIN_FS = `uniform float uI; uniform vec3 uTint; varying vec2 vQ; varying float vA;
  void main(){ float across = exp(-pow(vQ.x * 2., 2.) * 3.); float along = sin(3.14159 * clamp(vQ.y, 0., 1.));
    float a = across * along * vA * uI; if (a < .004) discard; gl_FragColor = vec4(uTint, a); }`;
function rainMesh(count, posGLSL, extra = {}) {
  const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1); q.translate(0, .5, 0);
  g.index = q.index; g.setAttribute('position', q.attributes.position);
  const sd = new Float32Array(count * 4); for (let i = 0; i < sd.length; i++) sd[i] = rand();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4)); g.instanceCount = count;
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, v);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: rainU, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: RAIN_VS.replace('vec3 dropPos(vec4 sd, out float speed);', posGLSL), fragmentShader: RAIN_FS }));
  m.frustumCulled = false; m.renderOrder = 8; return m;
}
function buildRain() {
  // the downpour around the camera
  const drops = rainMesh(isSmall ? 5000 : 12000, `vec3 dropPos(vec4 sd, out float speed){
      speed = 7. + sd.x * 3.5; vec3 B = vec3(48., 22., 48.);
      float fy = fract(sd.y - uTime * speed / B.y);
      vec3 p = vec3((sd.z - .5) * B.x, (fy - .25) * B.y, (fract(sd.w * 7.31 + sd.x * 3.1) - .5) * B.z);
      p.xz += uWind.xz * fy * B.y;                                  // the slant, carried with the fall
      vec3 c = uCenter; p.xz = mod(p.xz - c.xz + B.xz * .5, B.xz) - B.xz * .5 + c.xz; p.y += c.y;
      return p; }`);
  // water pouring off the tiled eaves in threads
  const eaves = []; const addLine = (x0, x1, y, z, step) => { for (let x = x0; x <= x1; x += step) eaves.push(x + (rand() - .5) * step * .6, y, z); };
  const ltY1 = 3.82 - 3.2 * Math.tan(THREE.MathUtils.degToRad(20));
  addLine(-10.1, -3.3, ltY1 - .28, 13.28, .32); addLine(3.3, 10.1, ltY1 - .28, 13.28, .32);
  addLine(-11.9, 11.9, 6.4 - 1.5 * Math.tan(THREE.MathUtils.degToRad(40)) - .3, 11.58, .42);
  const eaveA = new THREE.InstancedBufferAttribute(new Float32Array(eaves), 3);
  const drips = rainMesh(eaves.length / 3, `attribute vec3 aEave; vec3 dropPos(vec4 sd, out float speed){
      speed = 5.5 + sd.x * 2.; float H = aEave.y - .82;
      float fy = fract(sd.y - uTime * speed / H * .9);
      return vec3(aEave.x + (sd.z - .5) * .05, .82 + fy * H, aEave.z + .04); }`, { aEave: eaveA });
  drips.material.vertexShader = drips.material.vertexShader.replace('vA = (w / wr)', 'vA = 1.6 * (w / wr)');
  // distant curtains of rain, sweeping across the water
  const sheetTex = canvasTex(256, 512, (g, w, h) => { g.clearRect(0, 0, w, h); const r = mulberry32(8);
    for (let i = 0; i < 1400; i++) { const x = r() * w, y = r() * h, l = 30 + r() * 90; g.strokeStyle = `rgba(255,255,255,${.04 + r() * .14})`; g.lineWidth = .5 + r() * .5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l * .12, y + l); g.stroke(); } }, { srgb: false });
  const sheetU = { tMap: { value: sheetTex }, uTime: rainU.uTime, uI: rainU.uI, uTint: rainU.uTint };
  const sheets = new THREE.Group();
  [[22, 80, .55], [4, 110, .5], [-20, 160, .45]].forEach(([z, w, k], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 34), new THREE.ShaderMaterial({ uniforms: { ...sheetU, uK: { value: k }, uOff: { value: i * .37 } }, transparent: true, depthWrite: false, fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform sampler2D tMap; uniform float uTime, uI, uK, uOff; uniform vec3 uTint; varying vec2 vUv;
        float n(float x){ return .5 + .5 * sin(x) * sin(x * .37 + 1.3); }
        void main(){ vec2 uv = vec2(vUv.x * 7. + uTime * .05 + uOff, vUv.y * 2. + uTime * (1.6 + uK));
          float streak = texture2D(tMap, uv).r * .8 + texture2D(tMap, uv * vec2(1.7, .8) + vec2(.3, uTime * .7)).r * .6;
          float veil = n(vUv.x * 9. - uTime * .35 + uOff * 10.);            // the curtain thickens and thins as it sweeps
          float edge = smoothstep(0., .18, vUv.y) * smoothstep(1., .55, vUv.y) * smoothstep(0., .12, vUv.x) * smoothstep(1., .88, vUv.x);
          gl_FragColor = vec4(uTint, (.018 + streak * .07) * (.3 + veil * .9) * edge * uI * uK); }` }));
    m.position.set(0, 13, z); m.renderOrder = 7; m.frustumCulled = false; sheets.add(m);
  });
  // splashes: thin rings opening on the water
  const M2 = isSmall ? 320 : 700, rs = new Float32Array(M2 * 2);
  for (let i = 0; i < M2 * 2; i++) rs[i] = rand();
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M2 * 3), 3)); rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 2));
  const rings = new THREE.Points(rg, new THREE.ShaderMaterial({
    uniforms: { ...rainU, uPx: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec2 aSeed; uniform float uTime, uPx; uniform vec3 uCenter; varying float vPh; varying float vS;
      float h(float n){ return fract(sin(n) * 43758.5453); }
      void main(){ float c = uTime * (1.3 + aSeed.y * .8) + aSeed.x * 11.; float cyc = floor(c); vPh = fract(c); vS = .6 + aSeed.y * .8;
        vec3 p = vec3(uCenter.x + (h(cyc * 13.1 + aSeed.x * 91.) - .5) * 44., ${(LAKE_Y + .08).toFixed(3)}, max(30.9, uCenter.z - 4. + (h(cyc * 7.7 + aSeed.x * 37.) - .5) * 36.));
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = (160. * vS) * uPx / -mv.z; }`,
    fragmentShader: `uniform float uI; varying float vPh; varying float vS; void main(){ vec2 q = (gl_PointCoord - .5) * vec2(1., 3.); float d = length(q) * 2.;
      if (d > 1.) discard; float r = vPh * .85; float ring = smoothstep(.07, 0., abs(d - r)) * (1. - vPh) * (1. - vPh);
      float splash = smoothstep(.16, 0., d) * smoothstep(.12, 0., vPh);
      gl_FragColor = vec4(.86, .9, .93, (ring * .42 + splash * .5) * uI); }`,
  }));
  rings.frustumCulled = false; rings.renderOrder = 8;
  return { streaks: drops, drips, sheets, rings };
}

/* ------------------------------------------------------------------ lamp flames: every wick flickers on its own */
const flameU = { uTime: { value: 0 }, uI: { value: 0 } };
const FLAME_NOISE = `float hn(float x){ return fract(sin(x) * 43758.5453); }
  float n1(float x){ float i = floor(x), f = fract(x); return mix(hn(i), hn(i + 1.), f * f * (3. - 2. * f)); }`;
function buildFlames(list) {
  const pos = [], corner = [], seed = [], size = [], idx = [];
  list.forEach((f, i) => { const sd = rand(); for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(f.p.x, f.p.y, f.p.z); corner.push(cx, cy); seed.push(sd); size.push(f.s); } const k = i * 4; idx.push(k, k + 1, k + 2, k, k + 2, k + 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1)); g.setIndex(idx);
  const vs = halo => `attribute vec2 aCorner; attribute float aSeed; attribute float aSize; uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vFl;
    ${FLAME_NOISE}
    void main(){
      float t = uTime, gust = n1(t * .55 + aSeed * 13.);
      // the flame breathes, stretches and now and then ducks in a draught
      float fl = .84 + .24 * n1(t * 6.1 + aSeed * 31.) + .07 * sin(t * 19. + aSeed * 60.) - .2 * smoothstep(.72, 1., gust) * n1(t * 13. + aSeed * 9.);
      vFl = fl; vSeed = aSeed; vUv = vec2(aCorner.x * .5 + .5, aCorner.y);
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      ${halo ? `float w = aSize * 6., h = aSize * 6.; vec3 p = position + vec3(0., aSize * .9 - h * .5, 0.) + right * aCorner.x * w * .5 + vec3(0., aCorner.y * h, 0.);`
             : `float w = aSize * .5, h = aSize * 2.1 * fl; vec3 p = position + right * aCorner.x * w + vec3(0., aCorner.y * h, 0.);
                p += right * aCorner.y * aCorner.y * ((n1(t * 2.3 + aSeed * 7.) - .5) * .55 + (gust - .5) * .35) * aSize;`}
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
    }`;
  const flame = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: flameU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: vs(false),
    fragmentShader: `uniform float uTime, uI; varying vec2 vUv; varying float vSeed; varying float vFl; ${FLAME_NOISE}
      void main(){
        vec2 p = vec2(vUv.x - .5, vUv.y); float t = uTime;
        p.x += (n1(p.y * 5. - t * 7. + vSeed * 40.) - .5) * .2 * p.y;
        float y = p.y, wp = y < .3 ? .5 * sqrt(y / .3) : .5 * pow(max(1. - y, 0.) / .7, 1.35);
        float d = abs(p.x) / max(wp, .002);
        float body = smoothstep(1., .45, d) * smoothstep(1., .9, y);
        float core = smoothstep(.62, 0., d) * smoothstep(.64, .1, y) * smoothstep(0., .1, y);
        vec3 col = mix(vec3(1., .28, .04), vec3(1., .64, .2), smoothstep(.95, .32, y));
        col = mix(col, vec3(1., .94, .76), core);
        col = mix(col, vec3(.3, .45, 1.), smoothstep(.13, 0., y) * .65);
        gl_FragColor = vec4(col * (.95 + core * 1.3) * vFl, body * uI);
      }`,
  }));
  const halo = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: flameU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: vs(true),
    fragmentShader: `uniform float uI; varying vec2 vUv; varying float vFl;
      void main(){ vec2 q = (vUv - .5) * 2.; float r = dot(q, q); gl_FragColor = vec4(vec3(1., .52, .18), exp(-r * 6.) * .12 * uI * vFl * vFl); }`,
  }));
  for (const m of [flame, halo]) { m.frustumCulled = false; m.renderOrder = 9; }
  return { flame, halo };
}

/* ------------------------------------------------------------------ the phone on the veranda: a titanium flagship */
const PHONE = { pos: new V(.95, 1.245, 14.42) };
function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0); s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI); s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5); return s;
}
const SCREEN = { w: 720, h: 1548 };
function buildPhone() {
  const G = new THREE.Group(), dev = new THREE.Group(); G.add(dev);
  const W = .15, Hh = .31, D = .017, R = .025, b = .0042;
  const titanium = new THREE.MeshPhysicalMaterial({ color: 0xbdb6ac, metalness: 1, roughness: .26, clearcoat: .35, clearcoatRoughness: .3 });
  const body = new THREE.ExtrudeGeometry(rrShape(W - 2 * b, Hh - 2 * b, R - b), { depth: D - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 6, curveSegments: 28 });
  body.translate(0, 0, -(D - 2 * b) / 2);
  const bm = new THREE.Mesh(body, titanium); bm.castShadow = true; dev.add(bm);
  // black glass over the whole face, then the display, then the island
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(rrShape(W - .0034, Hh - .0034, R - .0017), 28), new THREE.MeshPhysicalMaterial({ color: 0x030405, roughness: .05, clearcoat: 1, clearcoatRoughness: .02 }));
  glass.position.z = D / 2 + .0003; dev.add(glass);
  const sw = W - .0135, sh = Hh - .0135;
  const sg = new THREE.ShapeGeometry(rrShape(sw, sh, R - .0062), 28); { const p = sg.attributes.position, uv = sg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / sw + .5, p.getY(i) / sh + .5); }
  const cv = document.createElement('canvas'); cv.width = SCREEN.w; cv.height = SCREEN.h;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = ANISO;
  const screen = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .78, roughness: .12, metalness: 0 }));
  screen.position.z = D / 2 + .0007; dev.add(screen);
  const island = new THREE.Mesh(new THREE.ShapeGeometry(rrShape(.037, .0108, .0054), 16), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: .2, clearcoat: 1 }));
  island.position.set(0, sh / 2 - .0072 - .0054, D / 2 + .001); dev.add(island);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.0024, 16), new THREE.MeshPhysicalMaterial({ color: 0x0a1020, roughness: .1, metalness: .5, clearcoat: 1 })); lens.position.set(.011, island.position.y, D / 2 + .0012); dev.add(lens);
  // side keys: action + volume on the left, the long side button on the right
  for (const [x, y, len] of [[-1, .088, .014], [-1, .056, .026], [-1, .022, .026], [1, .048, .042]]) { const k = new THREE.Mesh(new RoundedBoxGeometry(.0034, len, .0062, 2, .0016), titanium); k.position.set(x * (W / 2 + .0006), y, 0); dev.add(k); }
  // a teak stand on the peedam
  const stand = new THREE.Mesh(boxW(.2, .05, .13, .5, .5), M.woodL); stand.position.set(0, -Hh / 2 - .006, -.035); stand.castShadow = true; G.add(stand);
  G.userData = { cv, tex, W: sw, Hh: sh, screen };
  return G;
}
const APP = { full: null, scroll: 0, target: 0, max: 0, last: -99, dirty: true, rect: null, drag: null };
function drawAppFull(t) {
  const w = SCREEN.w, h = 3420;
  if (!APP.full) { APP.full = document.createElement('canvas'); APP.full.width = w; APP.full.height = h; }
  const g = APP.full.getContext('2d');
  g.fillStyle = '#F4F4F1'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(60,80,100,.07)'; g.lineWidth = 1;
  for (let x = 0; x <= w; x += 60) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, h); g.stroke(); }
  for (let y = 0; y <= h; y += 60) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke(); }
  const F = (wgt, px, fam) => `${wgt} ${px}px ${fam}`;
  const serif = '"Tenor Sans", "Geist", sans-serif', sans = '"Geist", system-ui, sans-serif', mono = '"Geist Mono", ui-monospace, monospace';
  const INK = '#15181C', MUT = '#5B636B', ACC = '#1C5B53', GOLD = '#C08A2B', SL = '#3D5467', CARD = '#FFFFFF';
  const card = (x, y, cw, ch, dark) => { g.fillStyle = dark ? '#123D39' : CARD; roundRect(g, x, y, cw, ch, 28); g.fill(); if (!dark) { g.strokeStyle = 'rgba(20,23,27,.07)'; g.lineWidth = 2; roundRect(g, x, y, cw, ch, 28); g.stroke(); } };
  const label = (txt, x, y, col = SL) => { g.fillStyle = col; g.font = F(500, 21, mono); g.fillText(txt, x, y); };
  // brand
  g.strokeStyle = GOLD; g.lineWidth = 5; g.beginPath(); g.arc(78, 170, 24, Math.PI, 0); g.stroke();
  g.fillStyle = INK; for (let i = 0; i < 3; i++) g.fillRect(54 + i * 17, 180, 14, 8);
  g.font = F(500, 44, serif); g.fillText('Arka', 118, 184);
  g.fillStyle = '#E3E6E6'; g.beginPath(); g.arc(w - 78, 168, 32, 0, 6.283); g.fill(); g.fillStyle = MUT; g.font = F(600, 24, sans); g.textAlign = 'center'; g.fillText('LM', w - 78, 177); g.textAlign = 'left';
  // today
  label('TODAY · YOUR ROOF MADE', 48, 282, ACC);
  const val = (19.2 + ((t * .02) % 2.4)).toFixed(1);
  g.fillStyle = INK; g.font = F(300, 150, serif); g.fillText(val, 42, 420);
  const vw = g.measureText(val).width; g.font = F(400, 40, sans); g.fillText('kWh', 56 + vw, 420);
  g.fillStyle = MUT; g.font = F(400, 27, sans); g.fillText('Battery full by 3:10 pm. Ready for tonight.', 48, 472);
  // hour by hour
  const cx = 48, cy = 540, cw = w - 96, ch = 300; card(cx, cy, cw, ch + 90);
  g.fillStyle = INK; g.font = F(500, 26, sans); g.fillText('Solar output, hour by hour', cx + 34, cy + 52);
  const hours = 13, bw = (cw - 80) / hours, now = 18;
  for (let i = 0; i < hours; i++) { const v = Math.max(.06, Math.sin(Math.PI * (i + .5) / hours)); const bh = v * (ch - 90), x = cx + 40 + i * bw, y = cy + ch - bh + 10; g.fillStyle = i + 6 === now ? INK : (i + 6 < now ? ACC : 'rgba(28,91,83,.2)'); roundRect(g, x + 5, y, bw - 10, bh, 8); g.fill(); }
  g.fillStyle = MUT; g.font = F(500, 21, mono); ['6a', '9a', '12p', '3p', '6p'].forEach((l, i) => g.fillText(l, cx + 40 + i * 3 * bw + 2, cy + ch + 56));
  // savings + battery
  card(48, 960, (w - 120) / 2, 210, true);
  label('SAVED · SEPT', 78, 1012, '#E9C27A'); g.fillStyle = '#F2F2EE'; g.font = F(400, 66, serif); g.fillText('₹2,860', 76, 1096); g.fillStyle = 'rgba(242,242,238,.7)'; g.font = F(400, 23, sans); g.fillText('vs. your old bill', 78, 1140);
  const bx = 72 + (w - 120) / 2; card(bx, 960, (w - 120) / 2, 210);
  label('BATTERY · TONIGHT', bx + 30, 1012); g.fillStyle = INK; g.font = F(400, 66, serif); g.fillText(`${86 + Math.round(Math.sin(t * .3) * 2)}%`, bx + 28, 1096);
  g.fillStyle = '#E3E6E6'; roundRect(g, bx + 30, 1120, (w - 120) / 2 - 60, 14, 7); g.fill(); g.fillStyle = '#2f9a6a'; roundRect(g, bx + 30, 1120, ((w - 120) / 2 - 60) * .86, 14, 7); g.fill();
  // KSEB export
  card(48, 1196, w - 96, 130); label('SENT TO KSEB TODAY', 80, 1248, ACC); g.fillStyle = INK; g.font = F(500, 40, sans); g.fillText('6.2 kWh  →  credit', 80, 1300);
  // this month
  card(48, 1356, w - 96, 420); g.fillStyle = INK; g.font = F(500, 26, sans); g.fillText('September, day by day', 82, 1410); label('568 kWh · ↑ 9% vs Aug', 82, 1446);
  for (let d = 0; d < 30; d++) { const v = .45 + .45 * Math.abs(Math.sin(d * 1.7)) * (d % 7 === 3 ? .4 : 1); const bh = v * 240, x = 82 + d * 18.6; g.fillStyle = d === 25 ? INK : (d < 25 ? SL : 'rgba(61,84,103,.22)'); roundRect(g, x, 1720 - bh, 12, bh, 5); g.fill(); }
  // your roof, panel by panel
  card(48, 1806, w - 96, 470); g.fillStyle = INK; g.font = F(500, 26, sans); g.fillText('Your roof, panel by panel', 82, 1860); label('16 MODULES · ALL HEALTHY', 82, 1896, '#2f8f5b');
  for (let r = 0; r < 2; r++) for (let c = 0; c < 8; c++) { const x = 82 + c * 70, y = 1930 + r * 150, k = .7 + .3 * Math.abs(Math.sin(r * 3 + c * 1.3)); g.fillStyle = `rgb(${Math.round(20 + 20 * k)},${Math.round(40 + 40 * k)},${Math.round(70 + 60 * k)})`; roundRect(g, x, y, 60, 130, 6); g.fill(); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (let q = 1; q < 6; q++) { g.beginPath(); g.moveTo(x, y + q * 21.6); g.lineTo(x + 60, y + q * 21.6); g.stroke(); } g.fillStyle = '#E9C27A'; g.font = F(500, 18, mono); g.fillText((300 + Math.round(k * 240)) + 'W', x + 4, y + 124); }
  g.fillStyle = MUT; g.font = F(400, 23, sans); g.fillText('West slope peaks at 3:10 pm, on the sunset side of the tharavadu.', 82, 2246);
  // impact
  card(48, 2306, (w - 120) / 2, 250); label('THIS YEAR', 78, 2356); g.fillStyle = INK; g.font = F(400, 70, serif); g.fillText('3.1 t', 76, 2446); g.fillStyle = MUT; g.font = F(400, 23, sans); g.fillText('CO₂ kept out of the air', 78, 2490); g.fillText('≈ 142 trees planted', 78, 2524);
  card(bx, 2306, (w - 120) / 2, 250, true); label('NEXT SERVICE', bx + 30, 2356, '#E9C27A'); g.fillStyle = '#F2F2EE'; g.font = F(400, 60, serif); g.fillText('14 Oct', bx + 28, 2442); g.fillStyle = 'rgba(242,242,238,.7)'; g.font = F(400, 23, sans); g.fillText('Panel rinse · free', bx + 30, 2486); g.fillText('Tap to reschedule', bx + 30, 2520);
  // bill comparison
  card(48, 2586, w - 96, 360); g.fillStyle = INK; g.font = F(500, 26, sans); g.fillText('Your KSEB bill', 82, 2640);
  [['Before Arka', 1, '#C4C9CD', '₹3,500'], ['Last month', .16, ACC, '₹560'], ['This month', .12, INK, '₹420']].forEach(([l, k, c, v], i) => { const y = 2692 + i * 78; g.fillStyle = MUT; g.font = F(400, 22, sans); g.fillText(l, 82, y + 22); g.fillStyle = c; roundRect(g, 260, y, 300 * k + 8, 28, 6); g.fill(); g.fillStyle = INK; g.font = F(500, 24, mono); g.fillText(v, 580, y + 23); });
  // tip + footer
  card(48, 2976, w - 96, 220); label('TONIGHT', 82, 3026, ACC); g.fillStyle = INK; g.font = F(400, 34, serif); g.fillText('Outage forecast after 9 pm. Your', 82, 3080); g.fillText('battery will carry the house.', 82, 3122);
  g.fillStyle = MUT; g.font = F(500, 20, mono); g.fillText('ARKA ENERGY · KOCHI', 82, 3270); g.fillText('v4.2 · Synced 2 min ago', 82, 3302);
  APP.max = h - SCREEN.h + 150; APP.dirty = true;
}
function drawPhone(cv) {
  if (!APP.full) return;
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.drawImage(APP.full, 0, Math.round(APP.scroll), w, h, 0, 0, w, h);
  const F = (wgt, px, fam) => `${wgt} ${px}px ${fam}`, sans = '"Geist", system-ui, sans-serif';
  g.fillStyle = 'rgba(244,244,241,.94)'; g.fillRect(0, 0, w, 112);
  g.fillStyle = '#15181C'; g.font = F(600, 30, sans); g.fillText('6:25', 62, 72);
  // signal, wifi, battery
  for (let i = 0; i < 4; i++) g.fillRect(w - 196 + i * 11, 70 - 7 - i * 5, 7, 7 + i * 5);
  g.lineWidth = 4; g.strokeStyle = '#15181C'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w - 128, 74, 6 + i * 7, -Math.PI * .75, -Math.PI * .25); g.stroke(); }
  g.lineWidth = 2.5; roundRect(g, w - 100, 50, 46, 24, 7); g.stroke(); g.fillRect(w - 97, 53, 34, 18); g.fillRect(w - 51, 58, 4, 9);
  // scroll indicator
  const trackH = h - 280, thumb = trackH * h / (APP.max + h), ty = 124 + (trackH - thumb) * (APP.scroll / Math.max(1, APP.max));
  g.fillStyle = 'rgba(20,23,27,.18)'; roundRect(g, w - 12, ty, 5, thumb, 3); g.fill();
  g.fillStyle = '#E9EAE6'; g.fillRect(0, h - 150, w, 150);
  ['Home', 'Energy', 'Savings', 'Service'].forEach((l, i) => { const x = 90 + i * (w - 180) / 3; g.fillStyle = i === 0 ? '#1C5B53' : '#5B636B'; g.beginPath(); g.arc(x, h - 106, 9, 0, 6.283); g.fill(); g.font = F(500, 22, sans); g.textAlign = 'center'; g.fillStyle = i === 0 ? '#15181C' : '#5B636B'; g.fillText(l, x, h - 62); g.textAlign = 'left'; });
  g.fillStyle = '#15181C'; roundRect(g, w / 2 - 110, h - 22, 220, 8, 4); g.fill();
}
// scrolling inside the phone: wheel, drag or touch over its screen; it also browses itself when idle
function overPhone(x, y) { const r = APP.rect; return !!r && x > r.l && x < r.r && y > r.t && y < r.b; }
addEventListener('wheel', e => {
  if (!overPhone(e.clientX, e.clientY)) return;
  const before = APP.target; APP.target = clamp(APP.target + e.deltaY * 1.5, 0, APP.max); APP.last = clock.elapsedTime;
  if (APP.target !== before) e.preventDefault();
}, { passive: false });
addEventListener('pointerdown', e => { if (overPhone(e.clientX, e.clientY)) { APP.drag = { y: e.clientY, s: APP.target }; APP.last = clock.elapsedTime; } });
addEventListener('pointermove', e => { if (!APP.drag || !APP.rect) return; const k = SCREEN.h / Math.max(1, APP.rect.b - APP.rect.t); APP.target = clamp(APP.drag.s - (e.clientY - APP.drag.y) * k, 0, APP.max); APP.last = clock.elapsedTime; });
addEventListener('pointerup', () => { APP.drag = null; });
addEventListener('touchmove', e => { if (APP.drag) e.preventDefault(); }, { passive: false });
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

/* ------------------------------------------------------------------ time of day: one day in an Arka home */
const TOD = [
  // 3:40 pm — crisp Kerala afternoon: high sun from the west, blue sky, clean cool shade
  { t: 0.00, sun: [-.64, .6, .48], sunCol: '#fff5e6', sunI: 4.6, sky: '#b6d2ee', gnd: '#5a5236', hemi: .55, zen: '#2d74c0', hor: '#bcd5e7', skyG: '#8a8f82', glow: .5, fog: '#c4d6e2', fogD: .0017, exp: 1.0, bloom: .12, win: 0, grid: 0, env: .55, mist: .05, shaft: .5, rays: .45, clouds: .85, grade: '#f5f9ff', petals: .8, flies: 0, stars: 0, moon: 0 },
  // 5:10 pm — golden hour over the paddy
  { t: 0.30, sun: [-.84, .25, .46], sunCol: '#ffcf8a', sunI: 4.2, sky: '#b9c6d6', gnd: '#4a3a26', hemi: .44, zen: '#4f7ab0', hor: '#f0c996', skyG: '#6e6048', glow: .95, fog: '#e6caa2', fogD: .0022, exp: 1.02, bloom: .2, win: .04, grid: .1, env: .42, mist: .07, shaft: .45, rays: .95, clouds: .6, grade: '#fff7ec', petals: .8, flies: 0, stars: 0, moon: 0 },
  // 6:25 pm — sunset on the veranda
  { t: 0.60, sun: [-.975, .06, .18], sunCol: '#ff8238', sunI: 2.8, sky: '#b98c80', gnd: '#34200f', hemi: .42, zen: '#3e4f7e', hor: '#f08450', skyG: '#4e3222', glow: 1.35, fog: '#c8805e', fogD: .0052, exp: 1.04, bloom: .42, win: .45, grid: .3, env: .36, mist: .14, shaft: .42, rays: 1.1, clouds: .55, grade: '#fff5ea', petals: .6, flies: 0, stars: 0, moon: 0 },
  // dusk
  { t: 0.82, sun: [-.97, -.06, .1], sunCol: '#b9482a', sunI: .3, sky: '#3f4a78', gnd: '#150e0a', hemi: .5, zen: '#141c42', hor: '#6e3d3a', skyG: '#1b1210', glow: .7, fog: '#35263a', fogD: .0048, exp: 1.14, bloom: .62, win: .9, grid: .7, env: .22, mist: .12, shaft: 0, rays: 0, clouds: .35, grade: '#fff1e2', petals: .1, flies: .7, stars: .5, moon: .6 },
  // 9:40 pm — moonlit backwater, amber home
  { t: 1.00, sun: [-.9, -.26, 0], sunCol: '#4a3040', sunI: 0, sky: '#4a5d96', gnd: '#12100e', hemi: .78, zen: '#0b1640', hor: '#2f3560', skyG: '#08070a', glow: .2, fog: '#1b2032', fogD: .003, exp: 1.3, bloom: .82, win: 1, grid: .5, env: .26, mist: .12, shaft: 0, rays: 0, clouds: .12, grade: '#ffefe0', petals: 0, flies: 1, stars: 1, moon: 1 },
  // 6:05 am — the sun is back on the roof
  { t: 1.40, sun: [.84, .13, .52], sunCol: '#ffc58c', sunI: 3.0, sky: '#c7c9dc', gnd: '#3e3428', hemi: .52, zen: '#5a80bd', hor: '#f4c9a4', skyG: '#6a5a4c', glow: 1.15, fog: '#e2cfc4', fogD: .003, exp: 1.04, bloom: .26, win: .15, grid: 0, env: .42, mist: .1, shaft: 0, rays: .7, clouds: .45, grade: '#fff8f3', petals: .3, flies: 0, stars: 0, moon: 0 },
];
function todAt(t) {
  let i = 0; while (i < TOD.length - 2 && t > TOD[i + 1].t) i++;
  const A = TOD[i], B = TOD[i + 1], k = smooth(A.t, B.t, t), o = {};
  for (const key of Object.keys(A)) {
    const a = A[key], b = B[key];
    if (typeof a === 'number') o[key] = lerp(a, b, k);
    else if (Array.isArray(a)) o[key] = new V(...a).lerp(new V(...b), k).normalize();
    else o[key] = new THREE.Color(a).lerp(new THREE.Color(b), k);
  }
  return o;
}
const nightK = t => smooth(.6, 1, t) * (1 - smooth(1.06, 1.34, t));
// the clock the page keeps (minutes after midnight), shown in the nav
const CLOCK = [[.04, 940], [.12, 952], [.32, 1030], [.6, 1105], [.82, 1150], [1, 1300], [1.4, 1805]];
function clockAt(t) { let i = 0; while (i < CLOCK.length - 2 && t > CLOCK[i + 1][0]) i++; const [a, ma] = CLOCK[i], [b, mb] = CLOCK[i + 1]; return lerp(ma, mb, clamp((t - a) / (b - a))); }

LOAD(.46, 'Planting the palms');
/* ------------------------------------------------------------------ assemble the world */
await breathe();
scene.add(sky);
const hills = buildHills(); scene.add(hills);
scene.add(buildGround());
await breathe();
const paddy = buildPaddy(); scene.add(paddy);
await breathe();
const house = buildHouse(); scene.add(house);
await breathe();
const backwater = buildBackwater(); scene.add(backwater);
await breathe();
camera.layers.enable(1);
scene.add(buildCompound());
const village = buildVillage(); scene.add(village);
const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.95, .045, 1.0), [M.frame, M.frame, M.panel, M.frame, M.frame, M.frame], panelMatrices.length);
panelMatrices.forEach((m, i) => panels.setMatrixAt(i, m)); panels.castShadow = true; panels.receiveShadow = true; scene.add(panels);
await breathe();
const vegetation = buildVegetation(); scene.add(vegetation);
await breathe();
LOAD(.56, 'Filling the backwater');
const mist = buildMist(); scene.add(mist);
const shafts = buildShafts(); scene.add(shafts);
const parts = buildParticles(); scene.add(parts.petals, parts.flies);
const grid = buildGrid(); scene.add(grid);
// clay diyas + every flame in the compound
const diyaG = new THREE.LatheGeometry([[0, 0], [.03, 0], [.058, .014], [.068, .03], [.052, .034], [0, .02]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
const diyas = new THREE.InstancedMesh(diyaG, M.clay, DIYAS.length);
{ const m4 = new THREE.Matrix4(); DIYAS.forEach((p, i) => { m4.makeRotationY(i * 2.1); m4.setPosition(p); diyas.setMatrixAt(i, m4); }); diyas.receiveShadow = true; scene.add(diyas); }
const rain = buildRain(); scene.add(rain.streaks, rain.drips, rain.sheets, rain.rings);
const flames = buildFlames(FLAMES.concat(DIYAS.map(p => ({ p: p.clone().add(new V(.03, .028, 0)), s: .032 }))));
scene.add(flames.flame, flames.halo);
const phone = buildPhone(); phone.position.copy(PHONE.pos); scene.add(phone);
// the people of the house: an old man in his easy chair on the lawn, and an old lady fishing off the bank
const PEOPLE = [
  { key: 'glb-man', at: new V(5.7, 0, 25.3), ry: -.32, h: 1.25 },
  { key: 'glb-lady', at: new V(-7.3, .4, 29.92), ry: -.45, h: 1.27, line: true },
  // the helmsman on the houseboat's bow
  { key: 'glb-boatman', parent: () => backwater.userData.houseboat, at: new V(8.9, 0, .1), ry: Math.PI / 2 + .25, h: 1.76, crew: true },
];
const fishing = { line: null, tip: new V() }, peopleObjs = [];
function loadPeople() {
  const loader = new GLTFLoader();
  const bufs = {}; const get = k => bufs[k] || (bufs[k] = fetch(IMG[k]).then(r => r.arrayBuffer()));
  return Promise.all(PEOPLE.map(P => !IMG[P.key] ? null : get(P.key).then(buf => new Promise(res => loader.parse(buf.slice(0), '', g => {
    const o = g.scene, box = new THREE.Box3().setFromObject(o), size = box.getSize(new V());
    o.scale.setScalar(P.h / size.y); box.setFromObject(o);
    const c = box.getCenter(new V()); o.position.set(-c.x, -box.min.y, -c.z);
    const holder = new THREE.Group(); holder.add(o); holder.position.copy(P.at); if (!P.parent) holder.position.y += P.at.y ? 0 : groundH(P.at.x, P.at.z); holder.rotation.y = P.ry; holder.userData.crew = !!P.crew;
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (m.material) { m.material.roughness = .86; m.material.metalness = 0; m.material.envMapIntensity = .7; if (m.material.map) { m.material.map.anisotropy = ANISO; m.material.map.needsUpdate = true; } } } });
    peopleObjs.push(holder); LOAD(.6 + .08 * peopleObjs.length, 'Seating the family');
    (P.parent ? P.parent() : scene).add(holder); holder.updateMatrixWorld(true);
    if (P.line) {   // the line runs from the tip of her rod (the model's highest point) down into the water
      let best = -1e9; o.traverse(m => { if (!m.isMesh) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { tmpV.fromBufferAttribute(p, i); m.localToWorld(tmpV); if (tmpV.y > best) { best = tmpV.y; fishing.tip.copy(tmpV); } } });
      const g2 = new THREE.BufferGeometry().setFromPoints([fishing.tip.clone(), new V(fishing.tip.x, LAKE_Y, Math.max(fishing.tip.z + .3, 31.1))]);
      fishing.bottomZ = Math.max(fishing.tip.z + .3, 31.1); fishing.line = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0xd8d6cc, transparent: true, opacity: .55 })); scene.add(fishing.line);
    }
    res();
  }, () => res()))).catch(() => null)));
}

const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
sun.shadow.mapSize.set(isSmall ? 1024 : 2048, isSmall ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 320 });
sun.shadow.bias = -.0004; sun.shadow.normalBias = .045;
scene.add(sun, sun.target);
const moon = new THREE.DirectionalLight(0xa9bdf0, 0); scene.add(moon, moon.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
const bounce = new THREE.PointLight(0xffa860, 0, 7, 1.4); bounce.position.set(2.6, 2.0, 15.4); scene.add(bounce);
// flickering lamplight on the steps and at the kadavu
const lampLight = new THREE.PointLight(0xff9440, 0, 7, 1.7); lampLight.position.set(0, 1.35, 15.4); scene.add(lampLight);
const ghatLight = new THREE.PointLight(0xff9440, 0, 9, 1.6); ghatLight.position.set(0, .9, 29.4); scene.add(ghatLight);

// two light rigs: by day only the sun and sky light the world (cheap); from dusk the moon, window
// lights and lamps join. Both are compiled up front so switching never stalls.
const eveningLights = [...lights.window, bounce, lampLight, ghatLight, moon];
let rigEvening = null;
function setRig(evening) { if (rigEvening === evening) return; rigEvening = evening; eveningLights.forEach(l => { l.visible = evening; }); }

// environment map from the sky, refreshed as the sun moves
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(); const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat); envScene.add(envSky);
let envRT = null, envT = -1;
function refreshEnv(t) {
  if (Math.abs(t - envT) < .025 && envRT) return;
  envT = t; const d = skyU.uDisk.value; skyU.uDisk.value = 0;
  const rt = pmrem.fromScene(envScene, 0, .1, 1000); skyU.uDisk.value = d;
  if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture;
}

/* ------------------------------------------------------------------ lighting for a moment of the day */
const tmpC = new THREE.Color(), shX = new V(), shY = new V();
function applyLight(E, sunDir, focus, tod, t) {
  const nk = nightK(tod);
  skyU.uZenith.value.copy(E.zen); skyU.uHorizon.value.copy(E.hor); skyU.uGround.value.copy(E.skyG); skyU.uSunCol.value.copy(E.sunCol);
  skyU.uSunDir.value.copy(sunDir); skyU.uGlow.value = E.glow; skyU.uStars.value = E.stars; skyU.uTime.value = t; skyU.uDisk.value = smooth(-.04, .02, sunDir.y); skyU.uClouds.value = E.clouds; skyU.uMoon.value = E.moon;
  hillU.uHorizon.value.copy(E.hor); hillU.uRidge.value.copy(E.gnd).lerp(tmpC.set(0x2c4336), .55).multiplyScalar(lerp(1, .42, nk)); hillU.uSunCol.value.copy(E.sunCol); hillU.uSunDir.value.copy(sunDir); hillU.uGlow.value = E.glow;
  scene.fog.color.copy(E.fog); scene.fog.density = E.fogD;
  sun.color.copy(E.sunCol); sun.intensity = E.sunI * smooth(-.05, .06, sunDir.y);
  { const ld = tmpV3.copy(sunDir).setY(Math.max(.08, sunDir.y)).normalize(), lx = shX.crossVectors(Y_AXIS, ld).normalize(), ly = shY.crossVectors(ld, lx);
    const tx = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x, a = Math.round(focus.dot(lx) / tx) * tx, b = Math.round(focus.dot(ly) / tx) * tx, c = focus.dot(ld);
    sun.target.position.set(0, 0, 0).addScaledVector(lx, a).addScaledVector(ly, b).addScaledVector(ld, c); sun.position.copy(sun.target.position).addScaledVector(ld, 140); }
  setRig(E.win > .02 || E.moon > .02);
  moon.intensity = E.moon * 1.05; moon.target.position.copy(focus); moon.position.copy(focus).addScaledVector(skyU.uMoonDir.value, 100);
  hemi.color.copy(E.sky); hemi.groundColor.copy(E.gnd); hemi.intensity = E.hemi;
  renderer.toneMappingExposure = E.exp;
  scene.environmentIntensity = E.env;
  M.sand.color.setScalar(lerp(1, .42, nk)); M.gravel.color.setScalar(lerp(1, .45, nk));
  // warm windows and lamps — steady light, no flicker, only the flames move
  const win = E.win;
  M.glow.color.setRGB(lerp(.1, 1.2, win), lerp(.06, .74, win), lerp(.03, .36, win));
  M.lattice.emissiveIntensity = win * .4;
  lights.window.forEach(l => l.intensity = l.userData.max * win * win);
  flameU.uI.value = smooth(.35, .85, win);
  panelU.uSweep.value = lerp(.25, 1.2, smooth(.1, .6, tod)) * (1 - smooth(.7, 1, tod) * .85) * (1 - smooth(1.05, 1.3, tod) * .6);
  M.panel.emissiveIntensity = 0; panelU.uGridGlow.value = E.grid * .32;
  shaftU.uCol.value.copy(E.sunCol).lerp(tmpC.setRGB(1, 1, 1), .25);
  const sd = tmpV3.copy(sunDir); if (sd.y < .12) sd.y = .12; sd.normalize();
  for (const m of shafts.userData.list) { m.position.copy(m.userData.ground).addScaledVector(sd, 22); m.quaternion.setFromUnitVectors(Y_AXIS, sd); }
  shafts.visible = E.shaft > .01;
  { const lu = backwater.userData.lake.material.uniforms; lu.distortionScale.value = lerp(4.6, 2.2, nk); lu.size.value = lerp(2.1, 3.4, nk); lu.sunDirection.value.copy(sunDir); lu.sunColor.value.copy(E.sunCol).multiplyScalar(smooth(-.04, .1, sunDir.y)); lu.waterColor.value.set(0x2a3320).lerp(tmpC.set(0x0a0d10), nk); }
  return nk;
}
function applyRain(k, t) {
  skyU.uRain.value = k; hillU.uHorizon.value.lerp(tmpC.set(0x9aa4a8), k); hillU.uGlow.value *= 1 - k; skyU.uClouds.value = lerp(skyU.uClouds.value, 1, k); skyU.uDisk.value *= 1 - k; skyU.uGlow.value *= 1 - k * .8;
  scene.fog.color.lerp(tmpC.set(0x97a3a6), k); scene.fog.density = lerp(scene.fog.density, .011, k);
  sun.intensity *= 1 - k * .82; hemi.intensity = lerp(hemi.intensity, 1.05, k); hemi.color.lerp(tmpC.set(0xc9d3d6), k); hemi.groundColor.lerp(tmpC.set(0x3a3e36), k);
  scene.environmentIntensity = lerp(scene.environmentIntensity, .5, k); renderer.toneMappingExposure = lerp(renderer.toneMappingExposure, 1.08, k);
  M.tile.roughness = lerp(.8, .36, k); M.tile.color.setHex(0xa8877a).multiplyScalar(1 - k * .22); M.wall.color.setHex(0xf6f4ee).multiplyScalar(1 - k * .12);
  M.gravel.color.multiplyScalar(1 - k * .35); M.stone.color.setScalar(1 - k * .3);
  const lu = backwater.userData.lake.material.uniforms; lu.distortionScale.value = lerp(lu.distortionScale.value, 5.5, k); lu.size.value = lerp(lu.size.value, 3.2, k); lu.waterColor.value.lerp(tmpC.set(0x2f3632), k);
  rainU.uI.value = k; rainU.uTime.value = t; rain.streaks.visible = rain.rings.visible = rain.drips.visible = rain.sheets.visible = k > .01;
  if (k > .01) { const gust = .5 + .5 * Math.sin(t * .23) * Math.sin(t * .61 + 1.7);   // the slant swings with the gusts
    rainU.uWind.value.set(.06 + .2 * gust, 0, .03 + .05 * Math.sin(t * .17));
    rainU.uPix.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, Hh);
    rainU.uTint.value.copy(scene.fog.color).lerp(tmpC.setRGB(1, 1, 1), .45);
    for (const m of rain.sheets.children) m.lookAt(camera.position.x, m.position.y, camera.position.z); }
  shafts.visible = shafts.visible && k < .3; flameU.uI.value *= 1 - k;
  for (const o of peopleObjs) if (!o.userData.crew) o.visible = k < .5;   // everyone on land goes indoors when it pours; the boatmen carry on
  if (fishing.line) fishing.line.visible = k < .5;
}
function setVillage(on, win, t) {
  const L = village.userData.lamps, { headM, poolM } = village.userData.lampMeshes, hc = headM.geometry.attributes.color, pc = poolM.geometry.attributes.color;
  for (const l of L) { const k = (on[l.i] ?? 0) * win;
    for (let v = l.h[0]; v < l.h[0] + l.h[1]; v++) hc.setXYZ(v, .13 + 4.4 * k, .1 + 2.5 * k, .06 + .9 * k);
    for (let v = l.p[0]; v < l.p[0] + l.p[1]; v++) pc.setXYZ(v, .8 * k, .5 * k, .24 * k); }
  hc.needsUpdate = true; pc.needsUpdate = true;
  const kv = (on.house ?? 0) * win; M.village.color.setRGB(lerp(.1, 2.6, kv), lerp(.06, 1.35, kv), lerp(.03, .45, kv));
}

/* ------------------------------------------------------------------ live crops of this same house: the parts grid (with a spotlight) and the how-it-works renders */
// each square is a camera on the real tharavadu; `tod` sets its moment of the day (parts use a clear studio-like morning)
const CELLS = {
  panel: { pos: new V(10.2, 8.4, 13.6), tgt: new V(6.6, 6.35, 10.3), fov: 30 },
  hook: { pos: new V(9.0, 6.33, 10.5), tgt: new V(7.55, 6.2, 10.28), fov: 46 },
  inverter: { pos: new V(12.1, 2.2, 10.1), tgt: new V(9.55, 2.1, 8.72), fov: 30 },
  battery: { pos: new V(11.9, 1.55, 6.1), tgt: new V(9.55, 1.3, 7.35), fov: 34 },
  meter: { pos: new V(11.6, 2.75, 4.7), tgt: new V(9.5, 2.35, 6.15), fov: 34 },
  cable: { pos: new V(10.0, 4.15, 13.0), tgt: new V(9.6, 5.02, 11.45), fov: 40 },
  'how-roof': { pos: new V(-9.6, 9.4, 17.4), tgt: new V(-4.9, 6.5, 9.9), fov: 42, tod: .06 },
  'how-home': { pos: new V(8.6, 1.6, 30.1), tgt: new V(3.4, 2.4, 14.5), fov: 34, tod: .74 },
  'how-grid': { pos: new V(21.5, 2.6, 15.8), tgt: new V(12.6, 4.8, 5.4), fov: 40, tod: .14 },
  'how-night': { pos: new V(-3.4, 1.15, 19.4), tgt: new V(0, 1.9, 13.2), fov: 50, tod: 1 },
};
const cellEls = [...document.querySelectorAll('[data-obj]')], paperEls = [...document.querySelectorAll('[data-paper]')];
// each crop is drawn into a canvas that sits inside its own square in the page, so it scrolls exactly with the page
const cells = cellEls.map(el => { const cv = document.createElement('canvas'); cv.className = 'cellcv'; cv.setAttribute('aria-hidden', 'true'); el.prepend(cv);
  return { el, cv, ctx: cv.getContext('2d'), key: el.dataset.obj, spot: el.dataset.spot !== '0', rt: null, rt8: null, buf: null, busy: false, hover: 0, tap: -99, sx: .5, sy: .5, exp: 1 }; });
cellEls.forEach((el, i) => el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') cells[i].tap = clock.elapsedTime; }));
const cellCam = new THREE.PerspectiveCamera(30, 1, .05, 600); cellCam.layers.enable(1);
const cellSpot = new THREE.SpotLight(0xfff0da, 0, 0, .3, .55, 2); cellSpot.castShadow = true;
cellSpot.shadow.mapSize.set(1024, 1024); cellSpot.shadow.bias = -.0003; cellSpot.shadow.camera.near = .2; cellSpot.shadow.camera.far = 30;
const blitScene = new THREE.Scene(), blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitMat = new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uTime: { value: 0 }, uExp: { value: 1 } },
  depthTest: false, depthWrite: false,
  // renders top-down (so the read-back rows are already in image order), with the same ACES + sRGB as the main view
  vertexShader: `varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1. - uv.y); gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tMap; uniform float uTime, uExp; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 rrt(vec3 v){ vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }
    vec3 aces(vec3 c){ const mat3 I = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));
      const mat3 O = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));
      c *= uExp / .6; return clamp(O * rrt(I * c), 0., 1.); }
    vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
    void main(){ vec4 c = texture2D(tMap, vUv); vec2 q = vUv - .5; c.rgb *= 1. - dot(q, q) * .55;
      vec3 o = srgb(aces(c.rgb)) + (h(vUv * 800. + fract(uTime) * 40.) - .5) * .02;
      gl_FragColor = vec4(o, 1.); }`,
});
{ const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat); q.frustumCulled = false; blitScene.add(q); }
const CELL_E = (() => { const E = todAt(.1); E.fog = new THREE.Color('#dfe6ea'); E.fogD = .004; E.hemi = .62; E.exp = 1.0; E.env = .6; E.win = 0; return E; })();
const CELL_SUN = new V(.5, .68, .54).normalize(), CELL_FOCUS = new V(5, 3, 8);
const cellLight = {};
function lightFor(key) {
  if (cellLight[key]) return cellLight[key];
  const S = CELLS[key];
  if (S.tod === undefined) return (cellLight[key] = { E: CELL_E, sun: CELL_SUN, tod: .1 });
  const E = todAt(S.tod); E.fogD *= .6;
  return (cellLight[key] = { E, sun: E.sun.clone(), tod: S.tod });
}
let cellRR = 0;
const hidden = [];
function renderCells(t, dt) {
  const DPRc = Math.min(window.devicePixelRatio || 1, 1.5);
  const vis = cells.map(c => { const r = c.el.getBoundingClientRect(); return r.bottom > -40 && r.top < Hh + 40 && r.width > 4 ? r : null; });
  // hover (mouse) or a recent tap (touch) lights the part
  cells.forEach((c, i) => { const r = vis[i]; const on = c.spot && r && ((mouse.px > r.left && mouse.px < r.right && mouse.py > r.top && mouse.py < r.bottom) || t - c.tap < 4) ? 1 : 0;
    if (r && on && mouse.px > -1e3) { c.sx = lerp(c.sx, clamp((mouse.px - r.left) / r.width), 1 - Math.exp(-dt * 8)); c.sy = lerp(c.sy, clamp((mouse.py - r.top) / r.height), 1 - Math.exp(-dt * 8)); }
    c.hover = lerp(c.hover, on, 1 - Math.exp(-dt * (on ? 4 : 2.5))); });
  const todo = new Set(), sizeOf = r => [Math.max(2, Math.round(r.width * DPRc)), Math.max(2, Math.round(r.height * DPRc))];
  cells.forEach((c, i) => { if (vis[i] && !c.busy && (!c.rt || c.hover > .004 || c.rt.width !== sizeOf(vis[i])[0])) todo.add(i); });
  for (let k = 0, n = 0; k < cells.length && n < 2; k++) { cellRR = (cellRR + 1) % cells.length; if (vis[cellRR] && !cells[cellRR].busy && !todo.has(cellRR)) { todo.add(cellRR); n++; } }
  if (!todo.size) return;
  applyRain(0, t);
  hidden.length = 0; for (const o of [backwater, paddy, mist, shafts, parts.petals, parts.flies, grid, village, rain.streaks, rain.rings, rain.drips, rain.sheets]) if (o.visible) { o.visible = false; hidden.push(o); }
  scene.add(cellSpot, cellSpot.target);
  sun.shadow.autoUpdate = false; cellSpot.shadow.autoUpdate = false;
  renderer.setScissorTest(false);
  let lastL = null;
  for (const i of todo) {
    const c = cells[i], r = vis[i], S = CELLS[c.key] || CELLS.panel, L = lightFor(c.key), [w, h] = sizeOf(r);
    if (!c.rt || c.rt.width !== w || c.rt.height !== h) {
      c.rt?.dispose(); c.rt8?.dispose();
      c.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      c.rt8 = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
      c.buf = new Uint8Array(w * h * 4); c.img = new ImageData(new Uint8ClampedArray(c.buf.buffer), w, h); c.cv.width = w; c.cv.height = h;
    }
    applyLight(L.E, L.sun, CELL_FOCUS, L.tod, t);
    flames.flame.visible = flames.halo.visible = flameU.uI.value > .005;
    if (L !== lastL) { sun.shadow.needsUpdate = true; lastL = L; }
    const hv = easeIO(clamp(c.hover));
    cellCam.aspect = r.width / r.height; cellCam.fov = S.fov * (1 - .1 * hv); cellCam.position.copy(S.pos); cellCam.lookAt(S.tgt); cellCam.updateProjectionMatrix(); cellCam.updateMatrixWorld();
    // spotlight: from just above the lens, aimed at whatever the cursor is over
    const dist = S.pos.distanceTo(S.tgt);
    tmpV.set(c.sx * 2 - 1, -(c.sy * 2 - 1), .5).unproject(cellCam).sub(cellCam.position).normalize();
    cellCam.getWorldDirection(tmpV2); const hit = tmpV3.copy(cellCam.position).addScaledVector(tmpV, dist / Math.max(.2, tmpV.dot(tmpV2)));
    tmpV2.set(0, 1, 0).applyQuaternion(cellCam.quaternion);
    cellSpot.position.copy(cellCam.position).addScaledVector(tmpV2, dist * .3).lerp(hit, .18);
    cellSpot.target.position.copy(hit); cellSpot.target.updateMatrixWorld();
    cellSpot.angle = THREE.MathUtils.degToRad(S.fov * .36); cellSpot.intensity = 26 * dist * dist / 9 * hv; cellSpot.shadow.needsUpdate = hv > .01;
    sun.intensity *= lerp(1, .38, hv); hemi.intensity *= lerp(1, .5, hv); scene.environmentIntensity *= lerp(1, .5, hv);
    blitMat.uniforms.uExp.value = renderer.toneMappingExposure; blitMat.uniforms.uTime.value = t;
    renderer.setRenderTarget(c.rt); renderer.clear(); renderer.render(scene, cellCam);
    blitMat.uniforms.tMap.value = c.rt.texture; renderer.setRenderTarget(c.rt8); renderer.render(blitScene, blitCam);
    // read the picture back without stalling the GPU, then paint it into the square's own canvas
    c.busy = true;
    const done = () => { c.busy = false; c.ctx.putImageData(c.img, 0, 0); };
    if (renderer.readRenderTargetPixelsAsync) renderer.readRenderTargetPixelsAsync(c.rt8, 0, 0, w, h, c.buf).then(done, () => { c.busy = false; });
    else { renderer.readRenderTargetPixels(c.rt8, 0, 0, w, h, c.buf); done(); }
  }
  renderer.setRenderTarget(null);
  scene.remove(cellSpot, cellSpot.target);
  for (const o of hidden) o.visible = true;
  sun.shadow.autoUpdate = true;
}

/* ------------------------------------------------------------------ post */
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: isSmall ? 2 : 4, depthTexture: new THREE.DepthTexture(1, 1) });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// god rays: march toward the sun through the depth buffer — sky seen between fronds pours light
const rays = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(.5, .5) }, uI: { value: 0 }, uAspect: { value: 1 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(1, .9, .7) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform vec2 uSun; uniform float uI, uAspect, uTime; uniform vec3 uCol; varying vec2 vUv;
    float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){ vec4 base = texture2D(tDiffuse, vUv);
      if(uI < .002){ gl_FragColor = base; return; }
      const int N = 22; vec2 stp = (uSun - vUv) / float(N) * .96; vec2 p = vUv + stp * hh(vUv*913.7);
      float acc = 0., ws = 0., dec = 1.;
      for(int i = 0; i < N; i++){ float z = texture2D(tDepth, clamp(p, .001, .999)).r; float sky = step(.99998, z);
        float near = exp(-length((p - uSun)*vec2(uAspect,1.))*2.4); acc += sky*near*dec; ws += dec; dec *= .965; p += stp; }
      base.rgb += uCol * (acc/ws) * uI; gl_FragColor = base; }`,
});
{ const r0 = rays.render.bind(rays); rays.render = (r, w, rb, dt, m) => { rays.uniforms.tDepth.value = rb.depthTexture; r0(r, w, rb, dt, m); }; }
composer.addPass(rays);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .3, .55, .82); composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: .35 }, uWarm: { value: new THREE.Color(1.02, 1, .96) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig; uniform vec3 uWarm; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 q = vUv-.5; float v = 1. - dot(q,q)*uVig*1.6;
      c.rgb *= v * uWarm; c.rgb += (h(vUv*1000.+fract(uTime)*50.)-.5)*.014; gl_FragColor = c; }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ shots & scroll choreography */
// the hero is pinned: scrolling flies you off the water, onto the roof, along the arrays and up over the courtyard
const HERO_KEYS = [
  { p: 0, pos: new V(-23, 5.4, 78), tgt: new V(-2.5, 3.0, 6), fov: 27 },
  { p: .26, pos: new V(-13.5, 6.4, 40), tgt: new V(-4.6, 5.4, 9), fov: 28 },
  { p: .54, pos: new V(-9.4, 8.3, 16.4), tgt: new V(-5.5, 6.45, 9.9), fov: 36 },
  { p: .78, pos: new V(-.8, 9.3, 15.3), tgt: new V(5.2, 6.55, 9.8), fov: 36 },
  { p: 1, pos: new V(-2.5, 19, 19.5), tgt: new V(-.6, 3.2, -2.8), fov: 40 },
];
const SHOTS = {
  heroEnd: { pos: HERO_KEYS[4].pos, tgt: HERO_KEYS[4].tgt, fov: 40, tod: .12, mob: 1 },
  energy: { pos: new V(-13, 4.4, 47.5), tgt: new V(-2.2, 3.6, 6), fov: 36, tod: .32, mob: -1 },
  app: { pos: new V(1.73, 1.315, 14.33), tgt: new V(.93, 1.262, 14.58), fov: 30, tod: .6, mob: .08, mt: new V(.95, 1.215, 14.42) },
  night: { pos: new V(-3, 3.5, 61), tgt: new V(1.2, 4.3, 10), fov: 38, tod: 1, mob: 1.4 },
  dawn: { pos: new V(-17, 5.8, 47), tgt: new V(3, 4.1, 6), fov: 34, tod: 1.4, mob: 1.6 },
  rain: { pos: new V(-9.5, 3.4, 52), tgt: new V(.5, 3.8, 10), fov: 38, tod: 1.4, mob: 1.4 },
  lamp: { pos: new V(-1.05, 1.32, 16.35), tgt: new V(-1.95, 1.12, 15.25), fov: 30, tod: 1, mob: 0 },   // QA only (?view=lamp)
  man: { pos: new V(4.2, 1.5, 29.2), tgt: new V(5.7, .7, 25.3), fov: 30, tod: .08, mob: 0 },   // QA only
  boat: { pos: new V(-6, 2.2, 36), tgt: new V(-12, 1.2, 46), fov: 34, tod: .08, mob: 0 },   // QA only
  lady: { pos: new V(-5.4, 1.2, 33.4), tgt: new V(-7.3, .9, 29.7), fov: 32, tod: .08, mob: 0 },   // QA only
};
const NIGHT_END = new V(-2.4, 3.2, 55);
function crPt(p0, p1, p2, p3, s, out) { const s2 = s * s, s3 = s2 * s; return out.set(0, 0, 0).addScaledVector(p0, -.5 * s3 + s2 - .5 * s).addScaledVector(p1, 1.5 * s3 - 2.5 * s2 + 1).addScaledVector(p2, -1.5 * s3 + 2 * s2 + .5 * s).addScaledVector(p3, .5 * s3 - .5 * s2); }
function heroAt(p, pos, tgt) {
  const K = HERO_KEYS; let i = 0; while (i < K.length - 2 && p > K[i + 1].p) i++;
  const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)], s = clamp((p - b.p) / (c.p - b.p));
  crPt(a.pos, b.pos, c.pos, d.pos, s, pos); crPt(a.tgt, b.tgt, c.tgt, d.tgt, s, tgt);
  return lerp(b.fov, c.fov, s * s * (3 - 2 * s));
}
const winEls = [...document.querySelectorAll('[data-shot]')];
let anchors = [];
function measure() { anchors = winEls.map(el => ({ el, key: el.dataset.shot, top: el.getBoundingClientRect().top + scrollY, h: el.offsetHeight })); }
function pathPoint(A, B, p, out) {
  // into / out of the veranda close-up: glide along the camera's own line of sight, clear of pillars
  if (A === SHOTS.app || B === SHOTS.app) {
    const S2 = B === SHOTS.app ? B : A, back = S2.pos.clone().sub(S2.tgt).setY(0).normalize();
    const ctrl = S2.pos.clone().addScaledVector(back, 7).add(new V(0, 1.4, 0)), u = p;
    return out.set(0, 0, 0).addScaledVector(A.pos, (1 - u) * (1 - u)).addScaledVector(ctrl, 2 * (1 - u) * u).addScaledVector(B.pos, u * u);
  }
  out.lerpVectors(A.pos, B.pos, p);
  out.y += Math.pow(Math.sin(Math.PI * p), 2) * Math.min(14, A.pos.distanceTo(B.pos) * .25);
  return out;
}
const cam = { pos: HERO_KEYS[0].pos.clone(), tgt: HERO_KEYS[0].tgt.clone(), fov: 27, tod: .04 };
const want = { pos: new V(), tgt: new V() };
const VIEW = new URLSearchParams(location.search).get('view');
// ?view=cam&p=x,y,z&t=x,y,z&f=fov&tod=0.1 frames any shot (used to render the link-preview image)
if (VIEW === 'cam') { const q = new URLSearchParams(location.search), v = k => new V(...(q.get(k) || '0,0,0').split(',').map(Number));
  SHOTS.cam = { pos: v('p'), tgt: v('t'), fov: +(q.get('f') || 34), tod: +(q.get('tod') || .08), mob: 0, sun: q.get('sun') ? v('sun').normalize() : null }; }
if (VIEW && SHOTS[VIEW]) document.documentElement.classList.add('view-only');
const W0 = () => ({ hero: 0, energy: 0, app: 0, night: 0, dawn: 0, rain: 0, lamp: 0, man: 0, lady: 0, boat: 0, cam: 0 });
function choreograph() {
  const portrait = camera.aspect < .85;
  if (VIEW && (SHOTS[VIEW] || VIEW === 'hero')) {
    const S = VIEW === 'hero' ? { pos: HERO_KEYS[0].pos, tgt: HERO_KEYS[0].tgt, fov: 27, tod: .04 } : SHOTS[VIEW], w = W0(); w[VIEW === 'heroEnd' ? 'hero' : VIEW] = 1;
    want.pos.copy(S.pos); want.tgt.copy(portrait && S.mt ? S.mt : S.tgt); if (portrait) want.tgt.y -= S.mob ?? 2.4;
    return { fov: S.fov + (portrait ? 18 : 0), tod: S.tod, w, heroP: 0, nightP: +(new URLSearchParams(location.search).get('np') || .8) };
  }
  const y = scrollY, vh = innerHeight;
  const H0 = anchors[0], pinEnd = H0 ? H0.top + H0.h - vh : 0;
  let nightP = 0;
  const nA = anchors.find(a => a.key === 'night'); if (nA) nightP = clamp((y - nA.top) / Math.max(1, nA.h - vh));
  if (H0 && H0.key === 'hero' && y < pinEnd) {
    const heroP = clamp((y - H0.top) / Math.max(1, pinEnd - H0.top)), fov = heroAt(heroP, want.pos, want.tgt), w = W0(); w.hero = 1;
    if (portrait) want.tgt.y -= lerp(2.4, 1, heroP);
    return { fov: fov + (portrait ? 18 : 0), tod: .04 + .08 * heroP, w, heroP, nightP };
  }
  let i = 0; while (i < anchors.length - 1 && y >= anchors[i + 1].top) i++;
  const A = anchors[i], B = anchors[Math.min(i + 1, anchors.length - 1)];
  const SA = A.key === 'hero' ? SHOTS.heroEnd : SHOTS[A.key], SB = B.key === 'hero' ? SHOTS.heroEnd : SHOTS[B.key];
  // adjacent scenes: fly during the last screen of the first. Scenes separated by content: fly while hidden.
  const adjacent = B.top - (A.top + A.h) < 8;
  const start = adjacent ? Math.max(A.top, A.top + A.h - vh) : A.top + A.h * .92, end = adjacent ? B.top : Math.max(start + 1, B.top - vh * .08);
  let p = A === B ? 0 : easeIO(clamp((y - start) / (end - start)));
  pathPoint(SA, SB, p, want.pos);
  want.tgt.lerpVectors(portrait && SA.mt ? SA.mt : SA.tgt, portrait && SB.mt ? SB.mt : SB.tgt, p);
  if (A.key === 'night' && B.key === 'night') want.pos.lerp(NIGHT_END, easeIO(nightP));
  else if (A.key === 'night') want.pos.lerp(NIGHT_END, 1 - p);
  const w = W0(); w[A.key === 'hero' ? 'hero' : A.key] += 1 - p; w[B.key === 'hero' ? 'hero' : B.key] += p;
  if (portrait) want.tgt.y -= lerp(SA.mob ?? 2.4, SB.mob ?? 2.4, p);
  return { fov: lerp(SA.fov, SB.fov, p) + (portrait ? 18 : 0), tod: lerp(SA.tod, SB.tod, p), w, heroP: 1, nightP };
}

/* ------------------------------------------------------------------ loop */
let W = 0, Hh = 0;
function resize() {
  W = canvas.clientWidth || innerWidth; Hh = canvas.clientHeight || innerHeight;
  renderer.setSize(W, Hh, false); composer.setPixelRatio(perf.ratio); composer.setSize(W, Hh); bloom.resolution.set(W, Hh);
  camera.aspect = W / Hh; camera.updateProjectionMatrix(); measure();
}
addEventListener('resize', resize); resize();
const mouse = { x: 0, y: 0, sx: 0, sy: 0, px: -1e4, py: -1e4, fine: matchMedia('(hover: hover) and (pointer: fine)').matches };
addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth - .5; mouse.y = e.clientY / innerHeight - .5; mouse.px = e.clientX; mouse.py = e.clientY; }, { passive: true });
document.documentElement.addEventListener('pointerleave', () => { mouse.px = mouse.py = -1e4; });
window.ARKA = window.ARKA || {};

const clock = new THREE.Clock();
function adaptResolution(dt) {
  if (perf.hold > 0) { perf.hold -= dt; return; }          // settle for a moment after the page opens
  perf.acc += dt; perf.n++;
  if (perf.acc < 1.2) return;
  const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
  let r = perf.ratio;
  if (avg > 1 / 48 && r > .85) r = Math.max(.85, r - .2);
  else if (avg < 1 / 57) { if (++perf.good > 4 && r < DPR) { r = Math.min(DPR, r + .25); perf.good = 0; } }
  else perf.good = 0;
  if (r !== perf.ratio) { perf.ratio = r; renderer.setPixelRatio(r); composer.setPixelRatio(r); resize(); }
}
let first = true, lastPhone = 0, visible = true, lastClock = '', revealed = false, warmFrames = 0;
const tmpV = new V(), tmpV2 = new V(), tmpV3 = new V(), Y_AXIS = new V(0, 1, 0), lookT = new V(), rightV = new V();
function isOnScreen(el) { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }
const root = document.documentElement, clockEl = document.getElementById('clock');
const noteEls = [...document.querySelectorAll('[data-note]')];
const NOTE_AT = [new V(-5.35, 6.75, 9.75), new V(5.35, 6.75, 9.75), new V(-7.7, 3.9, -2.5)];
const lampOn = { house: 1 }; village.userData.lamps.forEach(l => { lampOn[l.i] = 1; });

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  visible = winEls.some(isOnScreen) || first || !!VIEW;
  const cellsNear = !VIEW && paperEls.some(el => { const r = el.getBoundingClientRect(); return r.bottom > -200 && r.top < innerHeight + 200; });
  if (!visible) {   // only page sections on screen: no 3D frame, but the story's time still follows the scroll
    if (!VIEW) { const S0 = choreograph(); cam.tod = lerp(cam.tod, S0.tod, 1 - Math.exp(-dt * 2.5)); updateClock(S0); }
    if (cellsNear) renderCells(t, dt); return; }
  const S = choreograph(); adaptResolution(dt);
  const k = first ? 1 : 1 - Math.exp(-dt * 3.4);
  cam.pos.lerp(want.pos, k); cam.tgt.lerp(want.tgt, k);
  cam.fov = lerp(cam.fov, S.fov, k); cam.tod = lerp(cam.tod, S.tod, first ? 1 : 1 - Math.exp(-dt * 2.5));
  // the cursor only looks around a little (and steers the sun by day); nothing moves on its own
  mouse.sx = lerp(mouse.sx, mouse.x, 1 - Math.exp(-dt * 1.6)); mouse.sy = lerp(mouse.sy, mouse.y, 1 - Math.exp(-dt * 1.6));
  camera.position.copy(cam.pos);
  const look = mouse.fine && !reduceMotion && !VIEW ? (1 - S.w.app) : 0, dist = cam.pos.distanceTo(cam.tgt);
  rightV.subVectors(cam.tgt, cam.pos).cross(Y_AXIS).normalize();
  lookT.copy(cam.tgt).addScaledVector(rightV, mouse.sx * dist * .045 * look); lookT.y += -mouse.sy * dist * .03 * look;
  camera.lookAt(lookT);
  if (Math.abs(camera.fov - cam.fov) > .01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();

  // time of day
  const E = todAt(cam.tod);
  const dayW = clamp(S.w.hero + S.w.energy * .6) * (1 - smooth(.45, .75, cam.tod)) * (reduceMotion ? 0 : 1);
  const sunDir = E.sun.clone().applyAxisAngle(Y_AXIS, -mouse.sx * .75 * dayW); sunDir.y += -mouse.sy * .26 * dayW; sunDir.normalize();
  if (VIEW === 'cam' && SHOTS.cam.sun) sunDir.copy(SHOTS.cam.sun);
  const nk = applyLight(E, sunDir, cam.tgt, cam.tod, t);
  const wet = S.w.rain; applyRain(wet, t);
  grade.uniforms.uWarm.value.copy(E.grade);
  bloom.strength = E.bloom * lerp(1, .55, nk); bloom.threshold = lerp(1.05, 1.0, nk);
  refreshEnv(cam.tod);
  // god rays toward the sun, when it's in front of us
  camera.getWorldDirection(tmpV2); const facing = tmpV2.dot(sunDir);
  tmpV.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
  rays.uniforms.uSun.value.set(tmpV.x * .5 + .5, tmpV.y * .5 + .5); rays.uniforms.uAspect.value = W / Hh; rays.uniforms.uTime.value = t;
  rays.uniforms.uI.value = E.rays * 1.5 * smooth(.02, .5, facing) * (tmpV.z < 1 ? 1 : 0); rays.uniforms.uCol.value.copy(E.sunCol).multiplyScalar(.85);
  // the backwater: waves, and everything the current carries
  { const lu = backwater.userData.lake.material.uniforms; lu.time.value += dt * .75;
    for (const b of backwater.userData.boats) { b.o.rotation.z = Math.sin(t * .9 + b.ph) * b.roll; if (b.drift) { const v = t * b.drift.speed + (b.drift.off ?? 110); b.o.position.x = b.drift.x0 + ((v % b.drift.span) + b.drift.span) % b.drift.span; } }
    animateBackwater(lu.time.value); }
  bounce.intensity = 7 * S.w.app;
  if (fishing.line) { const p = fishing.line.geometry.attributes.position; p.setXYZ(1, fishing.tip.x + Math.sin(t * .7) * .06, LAKE_Y + lakeWave(fishing.tip.x, fishing.tip.z, backwater.userData.lake.material.uniforms.time.value), fishing.bottomZ + Math.sin(t * .5) * .05); p.needsUpdate = true; }
  backwater.userData.houseboat.visible = S.w.night < .35;   // it would park in front of the night view
  // lamps: flames flicker, and so does the light they throw
  flameU.uTime.value = t;
  const fl = (a, b) => .93 + .05 * Math.sin(t * 5.1 + a) * Math.sin(t * 2.3 + b) + .015 * Math.sin(t * 11 + a * 3);   // lamplight breathes; it doesn't strobe
  lampLight.intensity = 3.2 * flameU.uI.value * fl(1, 2); ghatLight.intensity = 4.5 * flameU.uI.value * fl(4, 7);
  // the outage: street lamps die from the far end inwards, then the neighbours; the tharavadu stays lit on its battery
  const cut = S.w.night > .5 ? S.nightP : (S.w.dawn > .5 ? 0 : 0);
  village.userData.lamps.forEach(l => { lampOn[l.i] = 1 - smooth(l.cut, l.cut + .03, cut); });
  lampOn.house = 1 - smooth(.47, .52, cut);
  setVillage(lampOn, E.win, t);
  root.classList.toggle('grid-down', cut > .45 && S.w.night > .5);
  // panels + wind + petals + mist
  panelU.uTime.value = t; windU.uTime.value = t; shaftU.uTime.value = t;
  shaftU.uI.value = E.shaft * .38 * clamp(S.w.hero + S.w.app * .6 + S.w.dawn);
  mist.userData.mats.forEach((m, i) => { m.opacity = E.mist * (i === 0 ? 1.2 : .9); m.color.copy(E.fog).lerp(tmpC.setRGB(1, 1, 1), .25); m.alphaMap.offset.set(t * .004 * (i + 1), t * .002); });
  parts.U.uTime.value = t; parts.U.uCenter.value.copy(cam.tgt).lerp(camera.position, .45); rainU.uCenter.value.copy(camera.position).lerp(cam.tgt, .3); parts.U.uI.value = E.petals * (reduceMotion ? .4 : 1) * (1 - S.w.rain);
  parts.FU.uI.value = E.flies;
  // the grid wave travels out from the roof across the paddy at golden hour
  gridU.uRadius.value = lerp(0, 95, smooth(0, .95, S.w.energy));
  gridU.uAlpha.value = clamp(S.w.energy * 1.4) * .55 * (1 - nk * .6);
  // phone screen (only while it can be seen)
  if (S.w.app > .02) {
    if (t - lastPhone > 1) { drawAppFull(t); lastPhone = t; }
    if (t - APP.last > 5 && !APP.drag) APP.target = (.5 - .5 * Math.cos(t * .11)) * APP.max;   // idle: browse the app on its own
    const ns = lerp(APP.scroll, APP.target, 1 - Math.exp(-dt * 7)); if (Math.abs(ns - APP.scroll) > .4) { APP.scroll = ns; APP.dirty = true; }
    if (APP.dirty) { drawPhone(phone.userData.cv); phone.userData.tex.needsUpdate = true; APP.dirty = false; }
    const { W: pw, Hh: ph } = phone.userData; let l = 1e9, r2 = -1e9, tt = 1e9, bb = -1e9;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { tmpV.set(sx * pw / 2, sy * ph / 2, .009); phone.localToWorld(tmpV); tmpV.project(camera); const X = (tmpV.x * .5 + .5) * W, Y = (-tmpV.y * .5 + .5) * Hh; l = Math.min(l, X); r2 = Math.max(r2, X); tt = Math.min(tt, Y); bb = Math.max(bb, Y); }
    const appR = document.getElementById('app').getBoundingClientRect();
    APP.rect = S.w.app > .6 && appR.top < Hh * .5 && appR.bottom > Hh * .5 ? { l, r: r2, t: tt, b: bb } : null;
  } else APP.rect = null;
  phone.lookAt(tmpV.copy(camera.position).setY(PHONE.pos.y + .04)); phone.rotateX(-.06);
  phone.visible = S.w.app > .001 || S.w.hero > 0 || S.w.night > 0 || S.w.dawn > 0;
  grade.uniforms.uTime.value = t; grade.uniforms.uVig.value = lerp(.3, .55, nk);
  // page state: hero progress, notes pinned to the roof, the clock
  root.style.setProperty('--hp', S.heroP.toFixed(3));
  root.classList.toggle('hero-scrolled', S.heroP > .012);
  noteEls.forEach((el, i) => { const on = S.w.hero > .5 && S.heroP > +el.dataset.a - .01 && S.heroP < +el.dataset.b + .01; el.style.visibility = on ? '' : 'hidden';
    if (on) { tmpV.copy(NOTE_AT[i] || NOTE_AT[0]).project(camera); el.style.transform = `translate(${((tmpV.x * .5 + .5) * W).toFixed(1)}px,${((-tmpV.y * .5 + .5) * Hh).toFixed(1)}px)`; } });
  flames.flame.visible = flames.halo.visible = flameU.uI.value > .005;
  updateClock(S);
  composer.render(dt);
  if (cellsNear) renderCells(t, dt);
  if (first) first = false;
  if (!revealed && ++warmFrames >= 4) { revealed = true; perf.hold = 2.5; LOAD(1, 'Welcome home'); setTimeout(() => { root.classList.add('world-ready'); window.dispatchEvent(new Event('arka:ready')); }, 700); }
}
function updateClock(S) {
  if (clockEl) {
    let m = clockAt(cam.tod) + (S.w.night > .5 ? S.nightP * 14 : 0);
    m = Math.round(m) % 1440; const hh = Math.floor(m / 60), mm = m % 60, txt = `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    const label = S.w.rain > .5 ? 'Monsoon' : txt;
    if (label !== lastClock) { lastClock = label; clockEl.querySelector('b').textContent = label; clockEl.classList.toggle('moon', S.w.rain <= .5 && (hh >= 19 || hh < 6)); clockEl.classList.toggle('rain', S.w.rain > .5); }
  }
}
document.fonts?.ready.then(() => { drawAppFull(0); drawPhone(phone.userData.cv); phone.userData.tex.needsUpdate = true; });
addEventListener('load', measure);
new ResizeObserver(measure).observe(document.body);
// start once the photographic textures are decoded (so no roof ever flashes black)
Promise.race([Promise.all(texLoads.concat([loadPeople()])), new Promise(r => setTimeout(r, 3500))]).then(async () => {
  LOAD(.78, 'Lighting the lamps');
  try {
    choreograph(); cam.pos.copy(want.pos); cam.tgt.copy(want.tgt);
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt); camera.updateMatrixWorld();
    setRig(true); await renderer.compileAsync(scene, camera); await breathe();
    setRig(false); await renderer.compileAsync(scene, camera); await breathe();
    LOAD(.85, 'Tuning the sky');
    const E0 = todAt(cam.tod); applyLight(E0, E0.sun, cam.tgt, cam.tod, 0); refreshEnv(cam.tod); await breathe();
    // upload every texture to the GPU a few at a time, instead of all inside the first frame
    const texs = new Set(); scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'roughnessMap']) if (m[k] && m[k].isTexture) texs.add(m[k]); });
    let n = 0; for (const tx of texs) { renderer.initTexture(tx); if (++n % 4 === 0) { LOAD(.85 + .08 * n / texs.size, 'Tuning the sky'); await breathe(); } }
    LOAD(.94, 'Almost there'); await breathe();
  } catch (e) { }
  requestAnimationFrame(frame);
});
