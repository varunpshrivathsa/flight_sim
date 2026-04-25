import * as THREE from 'https://esm.sh/three@0.158.0';
import { OrbitControls } from 'https://esm.sh/three@0.158.0/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'https://esm.sh/three@0.158.0/examples/jsm/objects/Sky.js';
import { GLTFLoader } from 'https://esm.sh/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
import { TilesRenderer } from 'https://esm.sh/3d-tiles-renderer@0.4.24/three';
import { DRACOLoader } from 'https://esm.sh/three@0.158.0/examples/jsm/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
document.body.appendChild(renderer.domElement);

// ── Scene & Camera ────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbbd8f0, 0.000035);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200000);
camera.position.set(0, 300, 900);

// ── Altitude barrier settings ────────────────────────────────────────────────
const ALT_MIN = 1000;
const ALT_MAX = 3000;
const BARRIER_TRIGGER_DIST = 100;
const BARRIER_SIZE = 12000;

// ── Sky shader ────────────────────────────────────────────────────────────────
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 2.5;
skyUniforms['rayleigh'].value = 1.0;
skyUniforms['mieCoefficient'].value = 0.003;
skyUniforms['mieDirectionalG'].value = 0.97;

const sunPosition = new THREE.Vector3();
sunPosition.setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - 32),
  THREE.MathUtils.degToRad(160)
);
skyUniforms['sunPosition'].value.copy(sunPosition);

// ── Lights ────────────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0x9ec8f0, 0x4a4a50, 0.9));

const sun = new THREE.DirectionalLight(0xfff4d0, 2.2);
sun.position.copy(sunPosition).multiplyScalar(6000);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 100;
sun.shadow.camera.far = 14000;
sun.shadow.camera.left = -6000;
sun.shadow.camera.right = 6000;
sun.shadow.camera.top = 6000;
sun.shadow.camera.bottom = -6000;
sun.shadow.bias = -0.0002;
scene.add(sun);

// ── Ground / Terrain ──────────────────────────────────────────────────────────
function buildTerrainGround() {
  const SEGS = 256;
  const SIZE = 60000;
  const geom = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);

  // Hash-based value noise (integer coords → [0,1])
  function hash2(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    return (
      hash2(ix,     iy    ) * (1 - ux) * (1 - uy) +
      hash2(ix + 1, iy    ) * ux       * (1 - uy) +
      hash2(ix,     iy + 1) * (1 - ux) * uy       +
      hash2(ix + 1, iy + 1) * ux       * uy
    );
  }

  // Fractal Brownian Motion — 7 octaves for fine detail
  function fbm(x, y) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < 7; i++) { v += valueNoise(x * f, y * f) * a; a *= 0.5; f *= 2.1; }
    return v;
  }

  function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  const pos    = geom.attributes.position;
  const count  = pos.count;
  const colors = new Float32Array(count * 3);

  const FLAT_R = 5000;    // flat within 5 km of centre (city sits here)
  const FADE_R = 14000;   // full terrain from 14 km out
  const MAX_H  = 2400;    // peak height in metres
  const NS     = 1 / 9000; // noise frequency scale

  // Height → colour stops  [metres, r, g, b]
  const stops = [
    [    0, 0.13, 0.36, 0.10],  // deep lowland green
    [  160, 0.21, 0.50, 0.14],  // meadow
    [  420, 0.28, 0.52, 0.19],  // forested slope
    [  720, 0.33, 0.49, 0.21],  // upper forest
    [ 1000, 0.43, 0.40, 0.23],  // treeline / brown earth
    [ 1280, 0.50, 0.46, 0.38],  // scree / rocky soil
    [ 1580, 0.60, 0.57, 0.54],  // bare rock
    [ 1900, 0.82, 0.81, 0.84],  // snow-dusted rock
    [ 2200, 0.96, 0.96, 0.98],  // snow cap
  ];

  function lerpColor(h) {
    if (h <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
    for (let i = 0; i < stops.length - 1; i++) {
      if (h <= stops[i + 1][0]) {
        const t = (h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        return [
          stops[i][1] + (stops[i + 1][1] - stops[i][1]) * t,
          stops[i][2] + (stops[i + 1][2] - stops[i][2]) * t,
          stops[i][3] + (stops[i + 1][3] - stops[i][3]) * t,
        ];
      }
    }
    const last = stops[stops.length - 1];
    return [last[1], last[2], last[3]];
  }

  for (let i = 0; i < count; i++) {
    const lx   = pos.getX(i);
    const ly   = pos.getY(i);
    const dist = Math.sqrt(lx * lx + ly * ly);
    const mask = smoothstep(FLAT_R, FADE_R, dist);

    // Base terrain shape
    const base   = fbm(lx * NS + 10.3, ly * NS + 7.1);
    // Ridge noise: tent function of a second FBM layer gives sharp ridgelines
    const ridgeN = fbm(lx * NS * 1.7 + 3.7, ly * NS * 1.7 + 5.2);
    const ridge  = Math.pow(1.0 - Math.abs(2 * ridgeN - 1), 2);
    // High-frequency detail
    const detail = fbm(lx * NS * 4.5 + 1.1, ly * NS * 4.5 + 2.9) * 0.12;

    const raw = base * 0.52 + ridge * 0.32 + detail;
    // Power curve lifts peaks, flattens valleys; subtract floor to carve valleys to 0
    const h = mask * Math.pow(Math.max(0, raw - 0.18) / 0.82, 1.6) * MAX_H;

    // Local Z becomes world Y after rotation.x = -π/2
    pos.setZ(i, h);

    // Subtle per-vertex colour variation for micro texture
    const cv  = valueNoise(lx * NS * 10 + 20, ly * NS * 10 + 30) * 0.05 - 0.025;
    const col = lerpColor(h);
    colors[i * 3    ] = Math.max(0, Math.min(1, col[0] + cv));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, col[1] + cv));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, col[2] + cv));
  }

  pos.needsUpdate = true;
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  return mesh;
}

const ground = buildTerrainGround();
ground.position.y = 0;
scene.add(ground);

const runway = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 1400),
  new THREE.MeshLambertMaterial({ color: 0x252525 })
);
runway.rotation.x = -Math.PI / 2;
runway.position.set(0, 1, 0);
scene.add(runway);

const runwayDashes = [];
for (let i = -580; i <= 580; i += 90) {
  const dash = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  dash.rotation.x = -Math.PI / 2;
  dash.position.set(0, 2, i);
  runwayDashes.push(dash);
  scene.add(dash);
}

// ── Barrier helper ────────────────────────────────────────────────────────────
function createEnergyBarrier(size = 12000) {
  const group = new THREE.Group();

  const planeGeom = new THREE.PlaneGeometry(size, size, 1, 1);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0x3ecbff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const plane = new THREE.Mesh(planeGeom, planeMat);
  plane.rotation.x = -Math.PI / 2;
  group.add(plane);

  const grid = new THREE.GridHelper(size, 60, 0x7fe7ff, 0x2aa8ff);
  grid.material.transparent = true;
  grid.material.opacity = 0.0;
  grid.material.depthWrite = false;
  grid.position.y = 0.5;
  group.add(grid);

  const ringGeom = new THREE.RingGeometry(size * 0.18, size * 0.22, 96);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x66e6ff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.0;
  group.add(ring);

  const columns = [];
  for (let i = 0; i < 18; i++) {
    const cGeom = new THREE.CylinderGeometry(6, 6, 140, 12, 1, true);
    const cMat = new THREE.MeshBasicMaterial({
      color: 0x7fe7ff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const col = new THREE.Mesh(cGeom, cMat);

    const a = (i / 18) * Math.PI * 2;
    const r = size * 0.28;
    col.position.set(Math.cos(a) * r, 70, Math.sin(a) * r);
    group.add(col);
    columns.push(col);
  }

  group.userData = { plane, grid, ring, columns };
  group.visible = false;
  return group;
}

function updateBarrierEffect(barrier, distanceToLimit, t) {
  const d = Math.max(0, Math.min(BARRIER_TRIGGER_DIST, distanceToLimit));
  const proximity = 1.0 - d / BARRIER_TRIGGER_DIST;

  const visible = proximity > 0.0;
  barrier.visible = visible;
  if (!visible) return;

  const { plane, grid, ring, columns } = barrier.userData;

  const pulse = 0.65 + 0.35 * Math.sin(t * 4.0);
  const shimmer = 0.55 + 0.45 * Math.sin(t * 7.0 + barrier.position.y * 0.01);

  plane.material.opacity = 0.10 + 0.18 * proximity * pulse;
  grid.material.opacity = 0.16 + 0.35 * proximity * shimmer;
  ring.material.opacity = 0.10 + 0.25 * proximity * pulse;

  ring.rotation.z += 0.002 + 0.004 * proximity;
  ring.scale.setScalar(1.0 + 0.02 * Math.sin(t * 3.0));

  columns.forEach((col, i) => {
    const phase = t * 5.0 + i * 0.45;
    col.material.opacity = 0.05 + 0.22 * proximity * (0.5 + 0.5 * Math.sin(phase));
    col.scale.y = 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(phase + 1.2));
  });
}

// ── HUD ───────────────────────────────────────────────────────────────────────
const hudStyle = document.createElement('style');
hudStyle.textContent = `
  @keyframes hud-live { 0%,100%{opacity:1;box-shadow:0 0 5px #3a7a50} 50%{opacity:0.25;box-shadow:none} }
  @keyframes hud-warn { 0%,100%{opacity:1} 50%{opacity:0.4} }
  #start-btn:hover { background:#232e3a !important; border-color:#7a9aaa !important; color:#dce8f0 !important; }
  #start-btn:active { background:#2a3848 !important; }
`;
document.head.appendChild(hudStyle);

let hud = document.getElementById('hud');

if (!hud) {
  hud = document.createElement('div');
  hud.id = 'hud';

  Object.assign(hud.style, {
    position: 'fixed',
    left: '50%',
    bottom: '16px',
    transform: 'translateX(-50%)',
    width: 'min(1060px, calc(100vw - 24px))',
    padding: '0',
    color: '#1a2530',
    background: 'rgba(215,225,235,0.96)',
    border: '1px solid rgba(150,170,190,0.5)',
    borderTop: '2px solid rgba(100,135,165,0.85)',
    boxShadow: '0 4px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.65)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    zIndex: '10',
    borderRadius: '14px',
    pointerEvents: 'none',
    backdropFilter: 'blur(12px)',
    overflow: 'hidden'
  });

  document.body.appendChild(hud);
}

function statusPill(label, active, danger = false) {
  const color = active ? (danger ? '#8a2828' : '#2a5870') : '#7a8c9a';
  const bg = active ? (danger ? 'rgba(160,50,50,0.12)' : 'rgba(60,120,150,0.12)') : 'rgba(0,0,0,0.06)';
  const border = active ? (danger ? 'rgba(160,80,80,0.5)' : 'rgba(80,140,170,0.45)') : 'rgba(0,0,0,0.12)';
  const anim = active && danger ? 'animation:hud-warn 0.7s ease-in-out infinite;' : '';

  return `
    <div style="
      display:flex;align-items:center;gap:5px;
      padding:4px 10px;border-radius:999px;
      border:1px solid ${border};background:${bg};
      color:${color};font-size:10px;font-weight:700;
      letter-spacing:0.07em;white-space:nowrap;${anim}
    ">
      <span style="width:5px;height:5px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
      ${label}
    </div>
  `;
}

function metricCard(label, value, unit = '') {
  return `
    <div style="
      padding:8px 10px 8px 12px;border-radius:8px;
      background:rgba(255,255,255,0.35);
      border:1px solid rgba(140,162,182,0.3);
      border-left:2px solid rgba(90,130,160,0.5);
    ">
      <div style="font-size:9px;color:#5a7080;letter-spacing:0.13em;text-transform:uppercase;margin-bottom:4px;">${label}</div>
      <div style="font-size:18px;font-weight:800;line-height:1;color:#1a2530;letter-spacing:0.01em;">
        ${value}<span style="font-size:10px;color:#7a9098;margin-left:3px;font-weight:400;">${unit}</span>
      </div>
    </div>
  `;
}

// ── Controls ──────────────────────────────────────────────────────────────────
let followCamera = true;
let lastUserInteractionTime = 0;
const userOverrideDurationMs = 3000;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.enableZoom = true;
controls.enableRotate = true;
controls.minDistance = 20;
controls.maxDistance = 12000;

controls.addEventListener('start', () => {
  lastUserInteractionTime = Date.now();
});

renderer.domElement.addEventListener('wheel', () => {
  lastUserInteractionTime = Date.now();
});

// ── Aircraft ──────────────────────────────────────────────────────────────────
const aircraftRoot = new THREE.Group();
aircraftRoot.rotation.order = 'YXZ';
scene.add(aircraftRoot);

const aircraftTarget = { position: new THREE.Vector3(), yaw: 0, roll: 0, pitch: 0, ready: false };

const fallbackAircraft = new THREE.Mesh(
  new THREE.BoxGeometry(60, 18, 120),
  new THREE.MeshStandardMaterial({ color: 0x3344cc })
);
fallbackAircraft.castShadow = true;
aircraftRoot.add(fallbackAircraft);

let aircraftModel = null;
const gltfLoader = new GLTFLoader();

gltfLoader.load(
  './plane.glb',
  (gltf) => {
    aircraftModel = gltf.scene;
    aircraftRoot.remove(fallbackAircraft);
    aircraftRoot.add(aircraftModel);
    aircraftModel.scale.set(8, 8, 8);
    aircraftModel.rotation.set(0, Math.PI / 2 + 0.95, 0);
    aircraftModel.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  },
  undefined,
  (err) => console.error('Failed to load plane.glb:', err)
);

// ── Trail ─────────────────────────────────────────────────────────────────────
const trailPoints = [];
const TRAIL_MAX = 600;
let trailLine = null;

function addTrailPoint(x, y, z) {
  trailPoints.push(new THREE.Vector3(x, y, z));
  if (trailPoints.length > TRAIL_MAX) trailPoints.shift();

  const geom = new THREE.BufferGeometry().setFromPoints(trailPoints);

  if (!trailLine) {
    trailLine = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({
        color: 0xc8e8ff,
        transparent: true,
        opacity: 0.75
      })
    );
    scene.add(trailLine);
  } else {
    trailLine.geometry.dispose();
    trailLine.geometry = geom;
  }
}

// ── Altitude barriers ────────────────────────────────────────────────────────
const lowerBarrier = createEnergyBarrier(BARRIER_SIZE);
lowerBarrier.position.y = ALT_MIN;
scene.add(lowerBarrier);

const upperBarrier = createEnergyBarrier(BARRIER_SIZE);
upperBarrier.position.y = ALT_MAX;
scene.add(upperBarrier);

// ── 3D Tiles / Manhattan ──────────────────────────────────────────────────────
const TILESET_PATHS = [
  './tiles/Manhattan/tileset.json',
  './tiles/Manhattan2/tileset.json',
  './tiles/Manhattan3/tileset.json',
  './tiles/Manhattan4/tileset.json',
  './tiles/manhattan5/tileset.json',
  './tiles/manhattan6/tileset.json',
  './tiles/manhattan7/tileset.json',
];

let cityTilesets = [];
let cityTilesLoaded = false;
let cityTilesVisible = true;
let cityAutoFollow = false;
let cityBounds = null;
let cityCenter = new THREE.Vector3(0, 100, 0);

// ── No-fly zone definitions (offsets from cityCenter, x=east z=north, metres) ─
const NO_FLY_ZONE_DEFS = [
  { name: 'ZONE ALPHA',   x: 1000,  z: 3000,  radius: 680, color: 0xff1100 },
  { name: 'ZONE BRAVO',   x: 1000, z: -6000,  radius: 820, color: 0xff4400 },
  { name: 'ZONE CHARLIE', x: -1000, z: -1300, radius: 600, color: 0xff8800 },
];
const noFlyZones = []; // { group, cx, cz, radius, name }

function lonLatHeightToECEF(lonRad, latRad, heightMeters) {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;

  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat);

  const x = (N + heightMeters) * cosLat * cosLon;
  const y = (N + heightMeters) * cosLat * sinLon;
  const z = (N * (1.0 - e2) + heightMeters) * sinLat;

  return new THREE.Vector3(x, y, z);
}

function buildECEFToLocalMatrix(lonRad, latRad, heightMeters) {
  const center = lonLatHeightToECEF(lonRad, latRad, heightMeters);

  const east = new THREE.Vector3(
    -Math.sin(lonRad),
    Math.cos(lonRad),
    0
  ).normalize();

  const up = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad)
  ).normalize();

  const north = new THREE.Vector3().crossVectors(up, east).normalize();

  const localToECEF = new THREE.Matrix4().makeBasis(east, up, north);
  const ecefToLocal = localToECEF.clone().invert();
  const translate = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);

  return ecefToLocal.multiply(translate);
}

function fitGroundToCity() {
  if (!cityTilesets.length) return;

  const box = new THREE.Box3();

  for (const tiles of cityTilesets) {
    tiles.group.updateMatrixWorld(true);

    const b = new THREE.Box3().setFromObject(tiles.group);
    if (!b.isEmpty()) box.union(b);
  }

  if (box.isEmpty()) return;

  cityBounds = box;
  cityCenter = box.getCenter(new THREE.Vector3());

  const size = box.getSize(new THREE.Vector3());

  // Manual offsets — tune only if needed
  const GROUND_X_OFFSET = 0;
  const GROUND_Z_OFFSET = 0;
  const GROUND_Y_OFFSET = 1300;

  ground.position.x = cityCenter.x + GROUND_X_OFFSET;
  ground.position.z = cityCenter.z + GROUND_Z_OFFSET;
  const prevGroundY = ground.position.y;
  ground.position.y = box.min.y + GROUND_Y_OFFSET;

  // Make ground large enough to cover city + surroundings
  const baseGroundSize = 60000;
  const desiredGroundSize = Math.max(size.x, size.z) * 3.0;
  const scale = Math.max(1, desiredGroundSize / baseGroundSize);

  ground.scale.set(scale, scale, 1);

  runway.position.y = ground.position.y + 1;

  runwayDashes.forEach((dash, i) => {
    const z = -580 + i * 90;
    dash.position.set(0, ground.position.y + 2, z);
  });

  if (noFlyZones.length && Math.abs(ground.position.y - prevGroundY) > 0.01) {
    for (const z of noFlyZones) scene.remove(z.group);
    noFlyZones.length = 0;
    spawnNoFlyZones();
  }
}


// ── No-fly zone visuals ───────────────────────────────────────────────────────
function createNoFlyZoneVisual(cx, groundY, cz, radius, color) {
  const group = new THREE.Group();
  const zoneTopY = ALT_MAX + 200;
  const zoneHeight = zoneTopY - groundY;
  const midY = groundY + zoneHeight / 2;

  // Transparent tube (open-ended cylinder)
  const tubeMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.10,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, zoneHeight, 64, 1, true),
    tubeMat
  );
  tube.position.set(cx, midY, cz);
  group.add(tube);

  // 8 vertical stripe panels for structure and far-visibility
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(14, zoneHeight * 0.88),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    stripe.position.set(cx + Math.cos(angle) * radius, midY, cz + Math.sin(angle) * radius);
    stripe.rotation.y = -angle;
    group.add(stripe);
  }

  // Ground floor fill
  const floorFill = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  floorFill.rotation.x = -Math.PI / 2;
  floorFill.position.set(cx, groundY + 2, cz);
  group.add(floorFill);

  // Ground edge ring (bright, readable from above)
  const groundRing = new THREE.Mesh(
    new THREE.RingGeometry(radius - 8, radius + 22, 80),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.80, side: THREE.DoubleSide, depthWrite: false })
  );
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.set(cx, groundY + 3, cz);
  group.add(groundRing);

  // Top ring — slowly rotates in animate loop for visibility from above
  const topRing = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.25, radius + 22, 80),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
  );
  topRing.rotation.x = -Math.PI / 2;
  topRing.position.set(cx, zoneTopY, cz);
  group.add(topRing);

  group.userData = { tubeMat, topRing };
  return group;
}

function spawnNoFlyZones() {
  if (!cityBounds) return;

  const groundY = ground.position.y;

  for (const def of NO_FLY_ZONE_DEFS) {
    const cx = def.x;
    const cz = def.z;

    const zoneGroup = createNoFlyZoneVisual(
      cx,
      groundY,
      cz,
      def.radius,
      def.color
    );

    scene.add(zoneGroup);
    noFlyZones.push({
      group: zoneGroup,
      cx,
      cz,
      radius: def.radius,
      name: def.name
    });
  }
}
async function initCityTiles() {
  try {
    // Derive shared geo-reference from the first tileset
    const refRes = await fetch(TILESET_PATHS[0]);
    const refJson = await refRes.json();

    const region = refJson?.root?.boundingVolume?.region;
    if (!region || region.length < 6) {
      throw new Error('tileset.json root.boundingVolume.region not found');
    }

    const centerLon = 0.5 * (region[0] + region[2]);
    const centerLat = 0.5 * (region[1] + region[3]);
    const centerH = region[4];

    const ecefToLocal = buildECEFToLocalMatrix(centerLon, centerLat, centerH);

    // All tilesets share one loading manager + DRACO-enabled GLTF loader
    const manager = new THREE.LoadingManager();
    const tileGLTFLoader = new GLTFLoader(manager);
    tileGLTFLoader.setDRACOLoader(dracoLoader);
    manager.addHandler(/\.gltf$/i, tileGLTFLoader);
    manager.addHandler(/\.glb$/i, tileGLTFLoader);

    for (const path of TILESET_PATHS) {
      const tiles = new TilesRenderer(path);
      tiles.manager = manager;
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.errorTarget = 10;
      tiles.displayActiveTiles = true;
      tiles.group.matrixAutoUpdate = false;
      tiles.group.matrix.copy(ecefToLocal);
      tiles.group.matrixWorldNeedsUpdate = true;
      scene.add(tiles.group);
      cityTilesets.push(tiles);
    }

    runway.visible = false;
    runwayDashes.forEach((d) => { d.visible = false; });

    for (let i = 0; i < 20; i++) {
      for (const tiles of cityTilesets) {
        tiles.setCamera(camera);
        tiles.update();
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    fitGroundToCity();
    spawnNoFlyZones();

    const size = cityBounds
      ? cityBounds.getSize(new THREE.Vector3())
      : new THREE.Vector3(2400, 800, 2400);

    const camHeight = Math.max(1200, size.y * 1.2);
    const camBack = Math.max(1800, Math.max(size.x, size.z) * 0.7);

    camera.position.set(cityCenter.x, cityCenter.y + camHeight, cityCenter.z + camBack);
    controls.target.copy(cityCenter);
    controls.update();

    cityTilesLoaded = true;
    console.log(`All ${cityTilesets.length} Manhattan tile sets loaded`);
  } catch (err) {
    console.error('Failed to initialize city tiles:', err);
  }
}

// ── State update ──────────────────────────────────────────────────────────────
async function loadStateData() {
  const res = await fetch(`./state.json?t=${Date.now()}`);
  const data = await res.json();
  const a = data.aircraft;

  aircraftTarget.position.set(a.x, a.y, a.z);
  aircraftTarget.yaw   = -a.yaw;
  aircraftTarget.roll  = a.roll;
  aircraftTarget.pitch = a.pitch;
  aircraftTarget.ready = true;

  const distToLower = Math.abs(a.y - ALT_MIN);
  const distToUpper = Math.abs(a.y - ALT_MAX);
  const t = performance.now() * 0.001;

  updateBarrierEffect(lowerBarrier, distToLower, t);
  updateBarrierEffect(upperBarrier, distToUpper, t);

  addTrailPoint(a.x, a.y, a.z);

  // No-fly zone proximity (2-D distance, ignores altitude)
  let nfzStatus = 'CLEAR';
  for (const z of noFlyZones) {
    const dx = a.x - z.cx;
    const dz = a.z - z.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < z.radius) {
      nfzStatus = `!! IN ${z.name} !!`;
      break;
    } else if (dist < z.radius + 500 && nfzStatus === 'CLEAR') {
      nfzStatus = `NEAR ${z.name}`;
    }
  }

  const floorActive = Math.abs(a.y - ALT_MIN) <= BARRIER_TRIGGER_DIST;
  const ceilingActive = Math.abs(a.y - ALT_MAX) <= BARRIER_TRIGGER_DIST;
  const nfzDanger = nfzStatus.startsWith('!!');
  const nfzNear = nfzStatus.startsWith('NEAR');

  hud.innerHTML = `
    <div style="padding:9px 14px 8px;border-bottom:1px solid rgba(140,165,190,0.35);display:flex;align-items:center;justify-content:space-between;gap:12px;background:rgba(195,210,224,0.6);">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#3a7a50;box-shadow:0 0 5px #3a7a50;animation:hud-live 1.8s ease-in-out infinite;"></span>
        <span style="font-size:11px;font-weight:800;letter-spacing:0.20em;color:#2a4a60;text-transform:uppercase;">Flight Control</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${statusPill(`Floor ${floorActive ? 'ACTIVE' : 'OFF'}`, floorActive)}
        ${statusPill(`Ceiling ${ceilingActive ? 'ACTIVE' : 'OFF'}`, ceilingActive)}
        ${statusPill(`NFZ ${nfzDanger ? 'BREACH' : nfzNear ? 'NEAR' : 'CLEAR'}`, nfzDanger || nfzNear, nfzDanger)}
      </div>
    </div>

    <div style="padding:10px 14px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;">
      ${metricCard('Speed', a.speed.toFixed(1), 'm/s')}
      ${metricCard('Altitude', a.y.toFixed(0), 'm')}
      ${metricCard('Yaw', (a.yaw * 180 / Math.PI).toFixed(1), '°')}
      ${metricCard('Roll', (a.roll * 180 / Math.PI).toFixed(1), '°')}
      ${metricCard('Pitch', (a.pitch * 180 / Math.PI).toFixed(1), '°')}
      ${metricCard('Throttle', (data.control.throttle_cmd * 100).toFixed(0), '%')}
      ${metricCard('Camera', followCamera ? 'FOLLOW' : 'FREE', '')}
    </div>
  `;
}

// ── Main polling ──────────────────────────────────────────────────────────────
async function poll() {
  try {
    await loadStateData();
  } catch {
    hud.textContent = 'Waiting for simulator...';
  }

  setTimeout(poll, 16);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    followCamera = !followCamera;
  }

  if (e.key === 't' || e.key === 'T') {
    cityTilesVisible = !cityTilesVisible;
    for (const tiles of cityTilesets) {
      tiles.group.visible = cityTilesVisible;
    }
  }

  if (e.key === 'c' || e.key === 'C') {
    cityAutoFollow = !cityAutoFollow;

    if (cityAutoFollow) {
      followCamera = false;
      const target = cityCenter.clone();
      const desiredPos = target.clone().add(new THREE.Vector3(0, 1200, 1800));
      camera.position.copy(desiredPos);
      controls.target.copy(target);
      controls.update();
    }
  }

  if (e.key === 'g' || e.key === 'G') {
    ground.visible = !ground.visible;
  }
});

// ── Animation ─────────────────────────────────────────────────────────────────
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);

  if (cityTilesLoaded && cityTilesets.length) {
    for (const tiles of cityTilesets) {
      tiles.setCamera(camera);
      tiles.update();
    }

    if (frameCount < 600 && frameCount % 30 === 0) {
      fitGroundToCity();
    }
  }

  // Animate no-fly zones — pulse tube + spin top ring
  if (noFlyZones.length) {
    const t = performance.now() * 0.001;
    for (const z of noFlyZones) {
      const { tubeMat, topRing } = z.group.userData;
      tubeMat.opacity = 0.07 + 0.06 * (0.5 + 0.5 * Math.sin(t * 1.3 + z.cx * 0.005));
      topRing.rotation.z += 0.004;
    }
  }

  if (aircraftTarget.ready) {
    const s = 0.3;
    aircraftRoot.position.lerp(aircraftTarget.position, s);
    aircraftRoot.rotation.y += (aircraftTarget.yaw   - aircraftRoot.rotation.y) * s;
    aircraftRoot.rotation.x += (aircraftTarget.roll  - aircraftRoot.rotation.x) * s;
    aircraftRoot.rotation.z += (aircraftTarget.pitch - aircraftRoot.rotation.z) * s;

    if (followCamera && !cityAutoFollow) {
      const userRecentlyInteracted = (Date.now() - lastUserInteractionTime) < userOverrideDurationMs;
      if (!userRecentlyInteracted) {
        const worldOffset = new THREE.Vector3(-400, 140, 0).applyQuaternion(aircraftRoot.quaternion);
        const lookAhead   = new THREE.Vector3( 220,  20, 0).applyQuaternion(aircraftRoot.quaternion);
        camera.position.lerp(aircraftRoot.position.clone().add(worldOffset), 0.08);
        controls.target.lerp(aircraftRoot.position.clone().add(lookAhead),   0.08);
      }
    }
  }

  if (cityAutoFollow) {
    const target = cityCenter.clone();
    const desiredPos = target.clone().add(new THREE.Vector3(0, 1200, 1800));
    camera.position.lerp(desiredPos, 0.05);
    controls.target.lerp(target, 0.08);
  }

  controls.update();
  renderer.render(scene, camera);
  frameCount++;
}

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  for (const tiles of cityTilesets) {
    tiles.setResolutionFromRenderer(camera, renderer);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const startOverlay = document.createElement('div');
Object.assign(startOverlay.style, {
  position: 'fixed',
  inset: '0',
  background: 'rgba(14,18,24,0.92)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: '100',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
});

startOverlay.innerHTML = `
  <div style="text-align:center;">
    <div style="font-size:11px;letter-spacing:0.25em;color:#4a6070;text-transform:uppercase;margin-bottom:14px;">System Ready</div>
    <div style="font-size:30px;font-weight:800;letter-spacing:0.15em;color:#b8ccd8;text-transform:uppercase;">Flight Simulator</div>
    <div style="width:48px;height:2px;background:#3a5060;margin:18px auto 28px;"></div>
    <button id="start-btn" style="
      padding:12px 40px;
      background:#1c2028;
      border:1px solid #4a5c6a;
      border-top:2px solid #6a8090;
      color:#b8ccd8;
      font-family:inherit;
      font-size:11px;
      font-weight:700;
      letter-spacing:0.18em;
      text-transform:uppercase;
      cursor:pointer;
      border-radius:2px;
    ">Start Simulator</button>
  </div>
`;

document.body.appendChild(startOverlay);

initCityTiles();
animate();

document.getElementById('start-btn').addEventListener('click', () => {
  startOverlay.remove();
  poll();
});