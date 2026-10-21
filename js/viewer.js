// Immo3D – interaktiver 3D-Objekt-Viewer (statisch, ohne Backend)
// Objekt wählen: index.html?o=beispiel1  (lädt objects/beispiel1.json)
// Weitere Parameter (für Deep-Links/Tests): mode=doll|plan|full, light=day|eve, variant=<id>, compare=1, floor=<id>, cut=<m>, rooms=0, intro=0, debug=1
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const T0 = performance.now();
const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const fmtM2 = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
const fmtM = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m';
const isMobile = matchMedia('(pointer:coarse)').matches || innerWidth < 760;
const SHOT = Q.has('shot');
const stats = (window.__viewer = { ready: false, errors: [], t: {} });

// ---------- Zustand ----------
const S = {
  cfg: null, mode: 'doll', light: 'day', variant: null, compare: false, floor: null,
  cut: 2.3, rooms: true, split: 0.5, models: {}, bbox: new THREE.Box3(), center: new THREE.Vector3(), radius: 10,
};

// ---------- Renderer / Szene ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 2 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
controls.screenSpacePanning = true;
controls.rotateSpeed = isMobile ? 0.7 : 0.9;
controls.autoRotateSpeed = 0.6;

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);

// Licht
const hemi = new THREE.HemisphereLight(0xf3f6ff, 0xb9a88f, 1.0);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);
const lampLights = [];
const lampMats = new Set();

// Boden (Schattenfänger)
const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Konfiguration laden ----------
async function loadConfig() {
  const id = (Q.get('o') || 'beispiel1').replace(/[^a-z0-9_-]/gi, '');
  const r = await fetch(`objects/${id}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Objekt "${id}" nicht gefunden`);
  return r.json();
}

function applyTexts(c) {
  document.title = `${c.title} – 3D-Ansicht`;
  $('#title').textContent = c.title;
  $('#subtitle').textContent = c.subtitle || '';
  $('#agency').textContent = c.agency || '[Agenturname]';
  $('#footAgency').textContent = c.agency || '[Agenturname]';
  $('#loaderTitle').textContent = c.title;
  if (c.logo) $('#logo').innerHTML = `<img src="${c.logo}" alt="Logo">`;
  // Objektdaten
  $('#facts').innerHTML = (c.facts || []).map((f) => `<div><dt>${f.label}</dt><dd>${f.value}</dd></div>`).join('');
  const rooms = (c.hotspots || []);
  $('#roomlist').innerHTML = rooms.map((h, i) => `<li data-i="${i}"><span>${h.name}${c.floors?.length > 1 ? ' <small>(' + (c.floors.find((f) => f.id === h.floor)?.label || '') + ')</small>' : ''}</span><span>${h.area ? fmtM2(h.area) : ''}</span></li>`).join('') || '<li><span>Folgt</span><span></span></li>';
  $('#roomlist').onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) { closeSheet(); focusHotspot(+li.dataset.i); } };
  if (c.energy) $('#energy').innerHTML = energyHTML(c.energy);
  if (c.videos?.length) {
    $('#btnVideos').hidden = false;
    $('#videoList').innerHTML = c.videos.map((v) => `<figure class="vcard">
      <video controls playsinline preload="metadata" poster="${v.poster}" src="${v.src}"></video>
      <div class="vt"><b>${v.title}</b><span>${v.duration || ''}</span></div>${v.text ? `<p>${v.text}</p>` : ''}</figure>`).join('');
  }
  if (c.contact) $('#contact').innerHTML = `<b>Besichtigung anfragen</b><br>${c.contact.name}<br>${c.contact.phone}<br>${c.contact.email}`;
}

function energyHTML(e) {
  const cls = ['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const col = ['#1a9850', '#4cb050', '#8cc63f', '#c8d92b', '#ffe31a', '#fdb515', '#f7871e', '#ef4a24', '#d7191c'];
  const pos = (v) => Math.min(98, Math.max(2, (v / 260) * 100));
  return `<div class="energy"><div class="etitle"><b>Energieausweis</b><span>${e.type || ''}</span></div>
  <div class="escale">${cls.map((k, i) => `<i style="background:${col[i]}">${k}</i>`).join('')}
    <span class="emark" style="left:${pos(e.value)}%">▼ ${e.value} kWh/(m²·a) · ${e.class}${e.valueAfter ? ' (Vorher)' : ''}</span>
    ${e.valueAfter ? `<span class="emark after" style="left:${pos(e.valueAfter)}%">▲ ${e.valueAfter} · ${e.classAfter} (Nachher)</span>` : ''}
  </div>
  <div style="font-size:13px">Energieträger: ${e.carrier || '–'}</div>
  <span class="badge">${e.note || 'Beispielwerte'}</span></div>`;
}

// ---------- Modelle ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let bytesTotal = 0;

function loadGLB(url, onProg) {
  return new Promise((res, rej) => loader.load(url, (g) => res(g), (e) => onProg && onProg(e), rej));
}

function prepareModel(root, cfg) {
  const secRe = new RegExp(cfg.section?.match || '^$', 'i');
  const secCol = new THREE.Color(cfg.section?.color || '#2a2f38');
  const lampRe = cfg.evening?.lampMatch ? new RegExp(cfg.evening.lampMatch, 'i') : null;
  const lamps = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Name des Objekts oder eines Elternteils (glTF-Export legt Namen teils auf den Knoten)
    let name = o.name, p = o.parent;
    while (p && p !== root) { name += ' ' + p.name; p = p.parent; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const section = secRe.test(name);
    const out = mats.map((m) => {
      let mm = m;
      if (section) {
        mm = m.clone();
        mm.side = THREE.DoubleSide;
        mm.onBeforeCompile = (sh) => {
          sh.uniforms.uSec = { value: secCol };
          sh.fragmentShader = 'uniform vec3 uSec;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
            '#include <dithering_fragment>\n if(!gl_FrontFacing){ gl_FragColor = vec4(uSec, 1.0); }');
        };
        mm.customProgramCacheKey = () => 'sec';
      }
      if (lampRe && lampRe.test(name)) {
        mm = mm === m ? m.clone() : mm;
        mm.userData.baseEmissive = mm.emissive ? mm.emissive.clone() : null;
        mm.userData.baseEmissiveIntensity = mm.emissiveIntensity ?? 1;
        lampMats.add(mm);
      }
      // erst NACH dem Klonen setzen – clone() kopiert die Ebene sonst als unabhängige Kopie
      mm.clippingPlanes = [clipPlane];
      mm.clipShadows = true;
      return mm;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    if (lampRe && lampRe.test(name)) lamps.push(o);
  });
  return lamps;
}

function setupLamps(lampMeshes, cfg) {
  // Pro Leuchte (nach Position zusammengefasst) ein warmes Punktlicht – nur am Abend aktiv
  const pts = [];
  for (const m of lampMeshes) {
    const b = new THREE.Box3().setFromObject(m);
    const c = b.getCenter(new THREE.Vector3());
    c.y = b.min.y - 0.15;
    if (!pts.some((p) => p.distanceTo(c) < 0.6)) pts.push(c);
  }
  pts.slice(0, cfg.evening?.maxLights ?? 6).forEach((p) => {
    const L = new THREE.PointLight(0xffc98a, 0, 7, 1.6);
    L.position.copy(p);
    scene.add(L);
    lampLights.push(L);
  });
}

function frameModel() {
  const b = S.bbox;
  b.getCenter(S.center);
  const size = b.getSize(new THREE.Vector3());
  S.radius = size.length() / 2;
  ground.scale.setScalar(S.radius * 2.2);
  ground.position.set(S.center.x, b.min.y - 0.005, S.center.z);
  // Sonne + Schattenkamera
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -S.radius * 1.3; sc.right = sc.top = S.radius * 1.3;
  sc.near = 0.5; sc.far = S.radius * 6;
  sc.updateProjectionMatrix();
  sun.target.position.copy(S.center);
  controls.minDistance = S.radius * 0.35;
  controls.maxDistance = S.radius * 9;
}

// ---------- Kamera-Animation ----------
let tween = null;
function fovs() {
  const v = THREE.MathUtils.degToRad(camera.fov);
  const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  return { v, h, min: Math.min(v, h) };
}
function camAt(az, pol, distF, target) {
  const t = target ? target.clone() : S.center.clone();
  const d = (S.radius * distF * 0.58) / Math.sin(fovs().min / 2);
  const sph = new THREE.Spherical(d, THREE.MathUtils.degToRad(pol), THREE.MathUtils.degToRad(az));
  return { pos: new THREE.Vector3().setFromSpherical(sph).add(t), target: t };
}
function planView(target) {
  // Draufsicht, Norden oben, Grundriss füllt den Bildschirm (Hoch- und Querformat)
  const size = S.bbox.getSize(new THREE.Vector3());
  const f = fovs();
  const d = Math.max((size.z / 2) / Math.tan(f.v / 2), (size.x / 2) / Math.tan(f.h / 2)) * 1.3 + size.y;
  const t = target.clone();
  return { pos: new THREE.Vector3(t.x, t.y + d, t.z + 0.001), target: t };
}
function flyTo(pos, target, ms = 1100) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, s: performance.now(), ms };
}
function stepTween(now) {
  if (!tween) return;
  let k = Math.min(1, (now - tween.s) / tween.ms);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(tween.p0, tween.p1, e);
  controls.target.lerpVectors(tween.t0, tween.t1, e);
  if (k >= 1) tween = null;
}
function aspectFix() { return camera.aspect < 0.8 ? 1.0 : 1; } // Hochformat: etwas mehr Rand

function viewFor(mode) {
  const c = S.cfg.camera || {};
  const f = currentFloor();
  const tgt = S.center.clone();
  if (f) tgt.y = f.base + 0.8;
  if (mode === 'plan') { tgt.z += S.radius * 0.06; return planView(tgt); }
  tgt.y -= S.radius * 0.12; // Modell etwas höher im Bild (Platz für Bedienleiste)
  if (mode === 'full') return camAt((c.azimuth ?? -30) - 15, 70, (c.distance ?? 1.45) * 1.1 * aspectFix(), tgt);
  return camAt(c.azimuth ?? -30, c.polar ?? 52, (c.distance ?? 1.45) * aspectFix(), tgt);
}

// ---------- Ansichtsmodi ----------
function currentFloor() { return S.cfg.floors?.find((f) => f.id === S.floor) || S.cfg.floors?.[0]; }
function updateClip() {
  const f = currentFloor();
  const base = f ? f.base : S.bbox.min.y;
  let h;
  if (S.mode === 'full') h = 1e4;
  else if (S.mode === 'plan') h = base + (S.cfg.dollhouse?.plan ?? 1.3);
  else h = base + S.cut;
  // Bei "Außen" werden nur Etagen oberhalb ausgeblendet, wenn nicht oberste Etage gewählt
  if (S.mode === 'full' && f && S.cfg.floors.length > 1 && f !== S.cfg.floors[S.cfg.floors.length - 1]) h = f.ceiling + 0.35;
  clipPlane.constant = h;
  $('#cutVal').textContent = fmtM(S.cut);
}
function setMode(m, fly = true) {
  S.mode = m;
  document.querySelectorAll('#segMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#rowSlider').hidden = m !== 'doll';
  controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
  updateClip();
  if (fly) { const v = viewFor(m); flyTo(v.pos, v.target); }
}
function setFloor(id, fly = true) {
  S.floor = id;
  document.querySelectorAll('#segFloor button').forEach((b) => b.classList.toggle('on', b.dataset.floor === id));
  const f = currentFloor();
  const maxCut = (f.ceiling - f.base) + 0.4;
  const sl = $('#cut');
  sl.max = maxCut.toFixed(2);
  updateClip();
  if (fly) { const v = viewFor(S.mode); flyTo(v.pos, v.target, 900); }
}
function setLight(l) {
  S.light = l;
  document.body.classList.toggle('light-day', l === 'day');
  document.body.classList.toggle('light-eve', l === 'eve');
  $('#btnLight .ico').textContent = l === 'day' ? '☀︎' : '☾';
  $('#btnLight .txt').textContent = l === 'day' ? 'Tag' : 'Abend';
  const r = S.radius;
  if (l === 'day') {
    hemi.color.set(0xf3f6ff); hemi.groundColor.set(0xb9a88f); hemi.intensity = 1.1;
    sun.color.set(0xfff6e8); sun.intensity = 2.6;
    sun.position.copy(S.center).add(new THREE.Vector3(r * 0.9, r * 1.9, r * 1.1));
    scene.environmentIntensity = 0.75;
    renderer.toneMappingExposure = 1.0;
    lampLights.forEach((L) => (L.intensity = 0));
    lampMats.forEach((m) => { if (m.emissive) { m.emissive.copy(m.userData.baseEmissive || new THREE.Color(0)); m.emissiveIntensity = m.userData.baseEmissiveIntensity; } });
    ground.material.opacity = 0.22;
  } else {
    hemi.color.set(0x8c9cc8); hemi.groundColor.set(0x3a2a2a); hemi.intensity = 0.32;
    sun.color.set(0xff9a5a); sun.intensity = 1.25;
    sun.position.copy(S.center).add(new THREE.Vector3(-r * 1.8, r * 0.55, r * 0.9));
    scene.environmentIntensity = 0.22;
    renderer.toneMappingExposure = 1.15;
    lampLights.forEach((L) => (L.intensity = 6));
    lampMats.forEach((m) => { if (m.emissive) { m.emissive.set(0xffd9a0); m.emissiveIntensity = 4; } });
    ground.material.opacity = 0.32;
  }
}
function showVariant(id) {
  for (const [k, m] of Object.entries(S.models)) m.visible = k === id;
}
async function setVariant(id) {
  S.compare = false; S.variant = id;
  $('#split').hidden = true;
  document.querySelectorAll('#segVariant button').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
  await ensureVariant(id);
  showVariant(id);
}
async function setCompare() {
  const vs = S.cfg.variants;
  await Promise.all(vs.map((v) => ensureVariant(v.id)));
  S.compare = true;
  $('#split').hidden = false;
  $('#splitL').textContent = vs[0].label; $('#splitR').textContent = vs[1].label;
  document.querySelectorAll('#segVariant button').forEach((b) => b.classList.toggle('on', b.dataset.v === '__cmp'));
}
const pending = {};
function ensureVariant(id, onProg) {
  if (S.models[id]) return Promise.resolve(S.models[id]);
  if (pending[id]) return pending[id];
  const v = S.cfg.variants.find((x) => x.id === id);
  pending[id] = loadGLB(v.src, onProg).then((g) => {
    const root = g.scene;
    root.name = 'variant_' + id;
    const lamps = prepareModel(root, S.cfg);
    if (!lampLights.length && lamps.length) S._lamps = lamps;
    root.visible = false;
    scene.add(root);
    S.models[id] = root;
    return root;
  });
  return pending[id];
}

// ---------- Hotspots ----------
const hsEls = [];
function buildHotspots() {
  const host = $('#hotspots');
  host.innerHTML = '';
  (S.cfg.hotspots || []).forEach((h, i) => {
    const el = document.createElement('div');
    el.className = 'hs';
    el.innerHTML = `<div class="lab"><b>${h.name}</b>${h.area ? `<small>${fmtM2(h.area)}</small>` : ''}</div><div class="pin"></div><div class="pt"></div>`;
    el.onclick = (e) => { e.stopPropagation(); focusHotspot(i); };
    host.appendChild(el);
    hsEls.push({ el, h, v: new THREE.Vector3(...h.pos) });
  });
}
const tmpV = new THREE.Vector3();
function updateHotspots() {
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  for (const o of hsEls) {
    const f = S.cfg.floors?.find((x) => x.id === o.h.floor);
    let vis = S.rooms && !(S.mode === 'full' && !(S.cfg.floors?.length > 1));
    if (f && S.cfg.floors.length > 1 && f.id !== S.floor) vis = false;
    if (o.v.y > clipPlane.constant + 0.05) vis = false;
    tmpV.copy(o.v).project(camera);
    if (tmpV.z > 1) vis = false;
    o.el.classList.toggle('hide', !vis);
    if (!vis) continue;
    const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * hgt;
    o.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
  }
}
function focusHotspot(i) {
  const h = S.cfg.hotspots[i];
  if (h.floor && S.cfg.floors?.length > 1 && h.floor !== S.floor) setFloor(h.floor, false);
  if (S.mode === 'full') setMode('doll', false);
  const t = new THREE.Vector3(...h.pos);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.55) { dir.y = 0.75; dir.normalize(); }
  flyTo(t.clone().add(dir.multiplyScalar(3.2 / Math.sin(fovs().min / 2))), t);
  $('#cardName').textContent = h.name;
  $('#cardArea').textContent = h.area ? fmtM2(h.area) : '';
  $('#cardNote').textContent = h.areaNote || h.note || '';
  $('#card').hidden = false;
  stopAuto();
}

// ---------- Vergleichs-Regler ----------
(function splitDrag() {
  const hdl = $('.split-handle');
  let drag = false;
  hdl.addEventListener('pointerdown', (e) => { drag = true; hdl.setPointerCapture(e.pointerId); controls.enabled = false; e.preventDefault(); });
  hdl.addEventListener('pointermove', (e) => { if (!drag) return; S.split = Math.min(0.95, Math.max(0.05, e.clientX / innerWidth)); $('#split').style.setProperty('--x', S.split * 100 + '%'); });
  const up = () => { drag = false; controls.enabled = true; };
  hdl.addEventListener('pointerup', up); hdl.addEventListener('pointercancel', up);
})();

// ---------- AR (Google model-viewer, wird erst bei Bedarf geladen) ----------
let mvLoaded = null;
async function openAR() {
  const layer = $('#arLayer');
  layer.hidden = false;
  $('#arMsg').textContent = 'AR wird vorbereitet …';
  if (!mvLoaded) {
    window.ModelViewerElement = window.ModelViewerElement || {};
    window.ModelViewerElement.meshoptDecoderLocation = new URL('vendor/model-viewer/meshopt_decoder.js', location.href).href;
    mvLoaded = import('../vendor/model-viewer/model-viewer.min.js');
  }
  await mvLoaded;
  const src = S.cfg.ar?.src || S.cfg.variants.find((v) => v.id === S.variant)?.src;
  const host = $('#arHost');
  host.innerHTML = `<model-viewer src="${src}" ar ar-modes="webxr scene-viewer quick-look" ar-scale="auto" ar-placement="floor"
     camera-controls touch-action="pan-y" shadow-intensity="1" environment-image="neutral" camera-orbit="-30deg 55deg auto" alt="${S.cfg.title}">
     <button slot="ar-button" class="ar-go">◈ Jetzt in AR platzieren</button></model-viewer>`;
  const mv = host.querySelector('model-viewer');
  mv.addEventListener('load', () => {
    $('#arMsg').textContent = mv.canActivateAR
      ? 'Tippen Sie auf „In AR platzieren“ und richten Sie die Kamera auf den Boden. Mit zwei Fingern können Sie das Modell skalieren.'
      : 'Augmented Reality funktioniert am Smartphone (Android mit ARCore bzw. iPhone/iPad). Scannen Sie dazu den QR-Code im Exposé. Hier sehen Sie eine 3D-Vorschau.';
  });
  mv.addEventListener('error', () => { $('#arMsg').textContent = 'Das AR-Modell konnte nicht geladen werden.'; });
}

// ---------- UI ----------
function buildUI() {
  const c = S.cfg;
  $('#segMode').onclick = (e) => { const b = e.target.closest('button'); if (b) { setMode(b.dataset.mode); stopAuto(); } };
  if (c.floors?.length > 1) {
    const sf = $('#segFloor');
    sf.hidden = false;
    sf.innerHTML = c.floors.map((f) => `<button data-floor="${f.id}">${f.label}</button>`).join('');
    sf.onclick = (e) => { const b = e.target.closest('button'); if (b) setFloor(b.dataset.floor); };
  }
  if (c.variants.length > 1) {
    const sv = $('#segVariant');
    sv.hidden = false;
    sv.innerHTML = c.variants.map((v) => `<button data-v="${v.id}">${v.label}</button>`).join('') + (c.variants.length === 2 ? '<button data-v="__cmp">⟷ Vergleich</button>' : '');
    sv.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; b.dataset.v === '__cmp' ? setCompare() : setVariant(b.dataset.v); };
  }
  $('#cut').oninput = (e) => { S.cut = +e.target.value; updateClip(); stopAuto(); };
  $('#btnLight').onclick = () => setLight(S.light === 'day' ? 'eve' : 'day');
  $('#btnRooms').onclick = () => { S.rooms = !S.rooms; $('#btnRooms').setAttribute('aria-pressed', S.rooms); };
  $('#btnAR').onclick = openAR;
  $('#btnInfo').onclick = () => ($('#sheet').hidden = false);
  $('#btnVideos').onclick = () => { $('#videoSheet').hidden = false; stopAuto(); };
  $('#videoSheet').onclick = (e) => {
    if (e.target.id === 'videoSheet' || e.target.classList.contains('close')) {
      $('#videoSheet').hidden = true;
      document.querySelectorAll('#videoList video').forEach((v) => v.pause());
    }
  };
  if (Q.get('videos') === '1' && S.cfg.videos?.length) $('#videoSheet').hidden = false;
  $('#sheet').onclick = (e) => { if (e.target.id === 'sheet' || e.target.classList.contains('close')) closeSheet(); };
  $('#card .close').onclick = () => ($('#card').hidden = true);
  $('#arLayer').onclick = (e) => { if (e.target.id === 'arLayer' || e.target.classList.contains('close')) { $('#arLayer').hidden = true; $('#arHost').innerHTML = ''; } };
  if (Q.has('debug')) canvas.addEventListener('dblclick', (e) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObjects(Object.values(S.models), true).find((h) => h.point.y < clipPlane.constant);
    if (hit) console.log('Koordinate für Hotspot "pos":', JSON.stringify(hit.point.toArray().map((v) => +v.toFixed(2))), hit.object.name);
  });
}
function closeSheet() { $('#sheet').hidden = true; }

// Auto-Drehung nach Inaktivität
let idleTimer = null;
function stopAuto() { controls.autoRotate = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!S.compare && Q.get('auto') !== '0') controls.autoRotate = true; }, 12000); }
controls.addEventListener('start', () => { stopAuto(); tween = null; $('#hint').classList.remove('show'); });

// ---------- Render-Schleife ----------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
let frames = 0;
const PX = new Uint8Array(4);
function loop(now) {
  requestAnimationFrame(loop);
  if (stats.pause) return; // nur für automatisierte Tests
  const tf = performance.now();
  resize();
  stepTween(now);
  controls.update();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (S.compare) {
    const [a, b] = S.cfg.variants;
    const sx = Math.round(w * S.split);
    renderer.setScissorTest(true);
    showVariant(a.id); renderer.setScissor(0, 0, sx, h); renderer.setViewport(0, 0, w, h); renderer.render(scene, camera);
    showVariant(b.id); renderer.setScissor(sx, 0, w - sx, h); renderer.render(scene, camera);
    renderer.setScissorTest(false);
  } else {
    renderer.render(scene, camera);
  }
  if (SHOT) { const g = renderer.getContext(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, PX); } // Testmodus: synchron rendern (Software-GPU stauen sonst)
  updateHotspots();
  stats.frameMs = Math.round(performance.now() - tf);
  stats.frames = frames + 1;
  if (++frames === 2 && !stats.t.firstFrame) {
    stats.t.firstFrame = Math.round(performance.now() - T0);
  }
}

// ---------- Start ----------
async function main() {
  const cfg = await loadConfig();
  S.cfg = cfg;
  applyTexts(cfg);
  S.floor = Q.get('floor') || cfg.floors?.[0]?.id;
  S.cut = Q.has('cut') ? +Q.get('cut') : (cfg.dollhouse?.default ?? 2.3);
  $('#cut').min = cfg.dollhouse?.min ?? 0.3;
  $('#cut').value = S.cut;
  const def = Q.get('variant') || (cfg.variants.find((v) => v.default) || cfg.variants[0]).id;
  S.variant = def;
  const bar = $('#bar'), pct = $('#pct');
  const first = await ensureVariant(def, (e) => {
    if (e.total) { const p = Math.round((e.loaded / e.total) * 100); bar.style.width = p + '%'; pct.textContent = p + ' %'; bytesTotal = e.total; }
    else pct.textContent = (e.loaded / 1048576).toFixed(1) + ' MB';
  });
  stats.t.modelLoaded = Math.round(performance.now() - T0);
  stats.bytesFirstModel = bytesTotal;
  first.visible = true;
  resize(); // Seitenverhältnis vor der Kameraberechnung setzen
  S.bbox.setFromObject(first);
  frameModel();
  if (S._lamps) setupLamps(S._lamps, cfg);
  buildUI();
  buildHotspots();
  setFloor(S.floor, false);
  setLight(Q.get('light') === 'eve' ? 'eve' : 'day');
  setMode(Q.get('mode') || 'doll', false);
  if (Q.get('rooms') === '0') { S.rooms = false; $('#btnRooms').setAttribute('aria-pressed', 'false'); }
  document.querySelectorAll('#segVariant button').forEach((b) => b.classList.toggle('on', b.dataset.v === def));
  // Einflug-Animation
  const v = viewFor(S.mode);
  if (Q.get('intro') === '0') { camera.position.copy(v.pos); controls.target.copy(v.target); }
  else {
    const start = camAt((cfg.camera?.azimuth ?? -30) - 70, 75, 3.2);
    camera.position.copy(start.pos); controls.target.copy(v.target);
    flyTo(v.pos, v.target, 2200);
  }
  requestAnimationFrame(loop);
  // Shader vorkompilieren, dann Lader ausblenden
  await renderer.compileAsync(scene, camera).catch(() => {});
  $('#loader').classList.add('done');
  setTimeout(() => $('#hint').classList.add('show'), 2300);
  setTimeout(() => $('#hint').classList.remove('show'), 6500);
  stopAuto();
  stats.t.interactive = Math.round(performance.now() - T0);
  // Andere Varianten im Hintergrund nachladen
  for (const vv of cfg.variants) if (vv.id !== def) ensureVariant(vv.id).catch((e) => stats.errors.push(String(e)));
  if (Q.get('compare') === '1' && cfg.variants.length === 2) await setCompare();
  await Promise.all(Object.values(pending)).catch(() => {});
  stats.t.allLoaded = Math.round(performance.now() - T0);
  stats.ready = true;
}

main().catch((e) => {
  console.error(e);
  stats.errors.push(String(e));
  $('#loaderTitle').textContent = /404|nicht gefunden/.test(String(e)) ? 'Dieses Objekt wird gerade vorbereitet.' : 'Die 3D-Ansicht konnte nicht geladen werden.';
  $('#pct').textContent = String(e.message || e);
});
