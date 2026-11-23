import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = 'models/march-k12.glb';
const DRACO_URL = 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/';

// The hinges were built in Blender to swing about its Y axis; after the
// export's axis conversion that is the node's local -Z here.
const HINGE_AXIS = 'z';
const HINGE_SIGN = -1;
const DOOR_NAMES = ['Door_FL', 'Door_FR', 'Door_RL', 'Door_RR'];

const canvas = document.getElementById('viewer');
const stage = document.getElementById('stage');
const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const controlsEl = document.getElementById('controls');
const hint = document.getElementById('hint');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.enablePan = false;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.autoRotate = !reduceMotion;
orbit.autoRotateSpeed = 0.7;

const doors = new Map(); // name -> { node, closed, open, target, value }
let carSize = new THREE.Vector3(1.9, 1.6, 3.8);
let carCenter = new THREE.Vector3();
let viewTween = null;

let currentView = 'front';

// Shift the rendered image so the car sits clear of the title: to the right
// on wide screens, a little lower on narrow ones. The cabin view stays centred.
function frame() {
  const { clientWidth: w, clientHeight: h } = stage;
  if (currentView === 'cabin') camera.clearViewOffset();
  else if (camera.aspect > 1.25) camera.setViewOffset(w, h, 0, h * 0.035, w, h); // centred between the title and the dock
  else camera.setViewOffset(w, h, 0, -h * 0.03, w, h);
  camera.updateProjectionMatrix();
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  frame();
}
new ResizeObserver(resize).observe(stage);
resize();

function addGroundShadow(minY) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.7)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(carSize.x * 1.9, carSize.z * 1.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(carCenter.x, minY + 0.002, carCenter.z);
  mesh.renderOrder = -1;
  scene.add(mesh);
}

const VIEWS = {
  // direction from the car centre to the camera, and distance in car lengths
  front: { dir: [0.55, 0.28, 1], dist: 1.95 },
  side: { dir: [-1, 0.16, 0.02], dist: 1.95 },
  rear: { dir: [-0.6, 0.3, -1], dist: 1.95 },
};

function viewPose(name) {
  if (name === 'cabin') {
    // Sit between the front seats, looking forward over the dashboard.
    const eye = new THREE.Vector3(carCenter.x, carCenter.y + carSize.y * 0.22, carCenter.z - carSize.z * 0.13);
    const target = eye.clone().add(new THREE.Vector3(0, -0.05, 0.25));
    return { eye, target, min: 0.05, max: 0.6, fov: 62 };
  }
  const v = VIEWS[name];
  const target = carCenter.clone().add(new THREE.Vector3(0, -carSize.y * 0.08, 0));
  // Portrait screens: the stage is its own box below the title, so come in closer.
  const fit = camera.aspect < 1 ? 0.85 / camera.aspect : Math.max(1, 1.1 / camera.aspect);
  const eye = target.clone().add(new THREE.Vector3(...v.dir).normalize().multiplyScalar(carSize.z * v.dist * fit));
  return { eye, target, min: carSize.z * 0.6, max: carSize.z * 4 };
}

function goToView(name, instant = false) {
  const pose = viewPose(name);
  currentView = name;
  turnTween = null;
  // Keep every view control (side rail and the dock's switcher) in step.
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === name));
  const seg = document.querySelector('.segmented');
  if (seg) seg.style.setProperty('--i', Math.max(0, ['front', 'side', 'rear', 'cabin'].indexOf(name)));
  camera.fov = pose.fov ?? 32; // wider lens inside the cabin
  frame();
  orbit.minDistance = 0.01;
  orbit.maxDistance = 100;
  const done = () => {
    orbit.minDistance = pose.min;
    orbit.maxDistance = pose.max;
  };
  if (instant || reduceMotion) {
    camera.position.copy(pose.eye);
    orbit.target.copy(pose.target);
    orbit.update();
    done();
    return;
  }
  viewTween = {
    t: 0,
    fromEye: camera.position.clone(),
    fromTarget: orbit.target.clone(),
    ...pose,
    done,
  };
}

function setDoor(name, open) {
  const d = doors.get(name);
  if (!d) return;
  d.target = open ? 1 : 0;
  const btn = document.querySelector(`[data-door="${name}"]`);
  if (btn) btn.setAttribute('aria-pressed', String(open));
  const allBtn = document.querySelector('[data-door="all"]');
  const allOpen = [...doors.values()].every((x) => x.target === 1);
  allBtn.textContent = allOpen ? 'Close all' : 'Open all';
  allBtn.setAttribute('aria-pressed', String(allOpen));
  const n = [...doors.values()].filter((x) => x.target === 1).length;
  document.getElementById('door-status').textContent =
    n === 0 ? 'All doors closed' : n === doors.size ? 'All doors open' : `${n} door${n > 1 ? 's' : ''} open`;
}

function toggleDoor(name) {
  const d = doors.get(name);
  if (d) setDoor(name, d.target !== 1);
}

function doorNameOf(object) {
  for (let o = object; o; o = o.parent) if (doors.has(o.name)) return o.name;
  return null;
}

// ---------- load ----------

const draco = new DRACOLoader().setDecoderPath(DRACO_URL);
const loader = new GLTFLoader().setDRACOLoader(draco);

loader.load(
  MODEL_URL,
  (gltf) => {
    const car = gltf.scene;
    scene.add(car);

    car.traverse((o) => {
      if (o.isMesh && o.material?.transparent) o.material.depthWrite = false;
    });

    const box = new THREE.Box3().setFromObject(car);
    box.getSize(carSize);
    box.getCenter(carCenter);
    addGroundShadow(box.min.y);

    for (const name of DOOR_NAMES) {
      const node = car.getObjectByName(name);
      if (!node) continue;
      const deg = Number(node.userData.open_angle_deg ?? (name.endsWith('L') ? 65 : -65));
      doors.set(name, {
        node,
        closed: node.rotation[HINGE_AXIS],
        open: node.rotation[HINGE_AXIS] + HINGE_SIGN * THREE.MathUtils.degToRad(deg),
        target: 0,
        value: 0,
      });
    }

    setupCustomise(car);

    goToView('front', true);
    loadingEl.hidden = true;
    controlsEl.hidden = false;
    document.querySelector('.hero').classList.add('is-ready');
    Object.assign(window.__march ?? (window.__march = {}), { scene, camera, orbit, doors, setDoor, goToView }); // handy in the console
  },
  (e) => {
    if (e.total) {
      const pct = Math.round((e.loaded / e.total) * 100);
      loadingBar.style.width = pct + '%';
      loadingText.textContent = `Loading model… ${pct}%`;
    }
  },
  (err) => {
    console.error(err);
    loadingEl.classList.add('error');
    loadingText.textContent = 'The 3D model could not be loaded.';
  }
);

// ---------- customise: paint colour and number plate ----------

const DEFAULT_PAINT = '#eae0c2';
const PAINTS = [
  ['Cream', '#eae0c2'],
  ['White', '#f1f0ea'],
  ['Silver', '#b9bdc0'],
  ['Sky blue', '#a7c6d6'],
  ['Sage', '#b4c29a'],
  ['Pink', '#e6bfc4'],
  ['Orange', '#d5562a'],
  ['Red', '#a8242b'],
  ['Blue', '#2c4a94'],
  ['Black', '#1b1b1d'],
];
// Where the two plates sit in the plate texture (fractions of its width/height).
const PLATE_RECTS = {
  rear: { x: 0.031, y: 0.063, w: 0.496, h: 0.396, fill: '#f2c200' },
  front: { x: 0.03, y: 0.555, w: 0.495, h: 0.395, fill: '#f7f7f4' },
};

const custom = { paint: DEFAULT_PAINT, plate: '', finish: 'gloss' };
let applyFinish = () => {};
// Paint finishes, applied to the body paint material. Gloss = as exported.
const FINISHES = {
  metallic: { metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 },
  matte: { metalness: 0, roughness: 0.85, clearcoat: 0, clearcoatRoughness: 0.5 },
};
const isLight = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.35;
};
let applyPaint = () => {};
let applyPlate = () => {};

const cleanPlate = (s) => s.toUpperCase().replace(/[^A-Z0-9 -]/g, '').replace(/\s+/g, ' ').slice(0, 12);
const cleanPaint = (s) => (/^#?[0-9a-f]{6}$/i.test(s) ? '#' + s.replace('#', '').toLowerCase() : null);

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  custom.paint = cleanPaint(p.get('paint') ?? '') ?? DEFAULT_PAINT;
  custom.plate = cleanPlate(p.get('plate') ?? '');
  custom.finish = FINISHES[p.get('finish')] ? p.get('finish') : 'gloss';
}

function writeHash() {
  const p = new URLSearchParams();
  if (custom.paint !== DEFAULT_PAINT) p.set('paint', custom.paint.slice(1));
  if (custom.plate) p.set('plate', custom.plate);
  if (custom.finish !== 'gloss') p.set('finish', custom.finish);
  const hash = p.toString();
  history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
}

function drawPlate(ctx, rect, text, W, H) {
  const x = rect.x * W, y = rect.y * H, w = rect.w * W, h = rect.h * H;
  const r = h * 0.07;
  ctx.fillStyle = '#16161a';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  const b = h * 0.035;
  ctx.fillStyle = rect.fill;
  ctx.beginPath();
  ctx.roundRect(x + b, y + b, w - 2 * b, h - 2 * b, r * 0.7);
  ctx.fill();

  // "WP KO-1436" becomes two lines, split at the last dash; otherwise one line.
  const cut = text.lastIndexOf('-');
  const lines = cut > 0 && cut < text.length - 1 ? [text.slice(0, cut).trim(), text.slice(cut + 1).trim()] : [text];
  ctx.fillStyle = '#111114';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = w * 0.84;
  const slotH = (h * 0.8) / lines.length;
  lines.forEach((line, i) => {
    let size = slotH * (lines.length > 1 ? 1.05 : 0.8);
    ctx.font = `700 ${size}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
    const tw = ctx.measureText(line).width;
    if (tw > maxW) size *= maxW / tw;
    ctx.font = `700 ${size}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
    ctx.fillText(line, x + w / 2, y + h * 0.1 + slotH * (i + 0.5) + size * 0.04);
  });
}

function setupCustomise(car) {
  const paintMats = new Set();
  const edgeMats = new Set();
  const plateMats = new Set();
  car.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (m.name === 'Carpaint') paintMats.add(m);
      else if (m.name === 'Carpaint_edge') edgeMats.add(m);
      else if (m.name === 'plates') plateMats.add(m);
    }
  });

  applyPaint = () => {
    const c = new THREE.Color(custom.paint);
    for (const m of paintMats) m.color.copy(c);
    for (const m of edgeMats) m.color.copy(c).multiplyScalar(0.7);
    for (const chip of document.querySelectorAll('.chip')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.paint === custom.paint));
    }
    document.getElementById('paint-picker').value = custom.paint;
    const named = PAINTS.find(([, hex]) => hex === custom.paint);
    const customChip = document.getElementById('paint-custom');
    customChip.classList.toggle('is-active', !named);
    customChip.title = named ? 'Pick any colour' : `Custom ${custom.paint.toUpperCase()}`;
  };

  const finishMats = [...paintMats, ...edgeMats];
  for (const m of finishMats) {
    m.userData.gloss = {
      metalness: m.metalness,
      roughness: m.roughness,
      clearcoat: m.clearcoat ?? 0,
      clearcoatRoughness: m.clearcoatRoughness ?? 0,
    };
  }
  applyFinish = () => {
    for (const m of finishMats) {
      const f = FINISHES[custom.finish] ?? m.userData.gloss;
      m.metalness = f.metalness;
      m.roughness = f.roughness;
      if ('clearcoat' in m) {
        m.clearcoat = f.clearcoat;
        m.clearcoatRoughness = f.clearcoatRoughness;
      }
      m.needsUpdate = true;
    }
    for (const b of document.querySelectorAll('[data-finish]')) {
      b.setAttribute('aria-pressed', String(b.dataset.finish === custom.finish));
    }
  };

  const first = [...plateMats][0];
  if (first?.map?.image) {
    const original = first.map;
    const originalNormal = first.normalMap;
    const W = original.image.width, H = original.image.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = original.flipY;
    tex.colorSpace = original.colorSpace;
    tex.wrapS = original.wrapS;
    tex.wrapT = original.wrapT;
    tex.channel = original.channel;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    applyPlate = () => {
      for (const m of plateMats) {
        if (!custom.plate) {
          m.map = original;
          m.normalMap = originalNormal;
        } else {
          ctx.clearRect(0, 0, W, H);
          ctx.drawImage(original.image, 0, 0, W, H);
          drawPlate(ctx, PLATE_RECTS.rear, custom.plate, W, H);
          drawPlate(ctx, PLATE_RECTS.front, custom.plate, W, H);
          tex.needsUpdate = true;
          m.map = tex;
          m.normalMap = null; // the original has the old number embossed
        }
        m.needsUpdate = true;
      }
    };
  }

  // UI
  const chips = document.getElementById('paint-chips');
  chips.innerHTML = PAINTS.map(
    ([name, hex]) =>
      `<button type="button" class="chip${isLight(hex) ? ' light' : ''}" data-paint="${hex}" title="${name}" aria-label="${name}" aria-pressed="false" style="--c:${hex}"><span>${name}</span></button>`
  ).join('');
  const picker = document.getElementById('paint-picker');
  const plateInput = document.getElementById('plate-input');

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    custom.paint = chip.dataset.paint;
    applyPaint();
    writeHash();
  });
  document.querySelector('.finish').addEventListener('click', (e) => {
    const b = e.target.closest('[data-finish]');
    if (!b) return;
    custom.finish = b.dataset.finish;
    applyFinish();
    writeHash();
  });
  picker.addEventListener('input', () => {
    custom.paint = picker.value.toLowerCase();
    applyPaint();
    writeHash();
  });
  plateInput.addEventListener('input', () => {
    custom.plate = cleanPlate(plateInput.value);
    if (plateInput.value !== custom.plate) plateInput.value = custom.plate;
    applyPlate();
    writeHash();
  });
  document.getElementById('customise-reset').addEventListener('click', () => {
    custom.paint = DEFAULT_PAINT;
    custom.plate = '';
    custom.finish = 'gloss';
    plateInput.value = '';
    applyPaint();
    applyFinish();
    applyPlate();
    writeHash();
  });

  readHash();
  plateInput.value = custom.plate;
  applyPaint();
  applyFinish();
  applyPlate();
  document.getElementById('customise').hidden = false;
}

// ---------- interaction ----------

controlsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.door === 'all') {
    const open = ![...doors.values()].every((d) => d.target === 1);
    for (const name of doors.keys()) setDoor(name, open);
  } else if (btn.dataset.door) {
    toggleDoor(btn.dataset.door);
  } else if (btn.dataset.view) {
    stopSpin();
    goToView(btn.dataset.view);
  } else if ('spin' in btn.dataset) {
    orbit.autoRotate = !orbit.autoRotate;
    btn.setAttribute('aria-pressed', String(orbit.autoRotate));
  }
});

// Side rail, zoom stack and the 360° turn buttons live in the hero, outside the dock.
let turnTween = null;

function zoom(kind) {
  stopSpin();
  if (kind === 'fit') return goToView(currentView);
  turnTween = null;
  const offset = camera.position.clone().sub(orbit.target);
  const dist = THREE.MathUtils.clamp(offset.length() * (kind === 'in' ? 0.8 : 1.25), orbit.minDistance, orbit.maxDistance);
  viewTween = {
    t: 0,
    fromEye: camera.position.clone(),
    fromTarget: orbit.target.clone(),
    eye: orbit.target.clone().add(offset.setLength(dist)),
    target: orbit.target.clone(),
    done() {},
  };
}

function turn(dir) {
  stopSpin();
  // Finish any zoom or view move first, or it would keep pulling the camera back.
  if (viewTween) {
    camera.position.copy(viewTween.eye);
    orbit.target.copy(viewTween.target);
    viewTween.done();
    viewTween = null;
  }
  turnTween = { t: 0, by: (dir * Math.PI) / 4, last: 0 };
}

document.querySelector('.hero').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.closest('#controls')) return;
  if (b.dataset.view) {
    stopSpin();
    goToView(b.dataset.view);
  } else if (b.dataset.zoom) zoom(b.dataset.zoom);
  else if (b.dataset.turn) turn(Number(b.dataset.turn));
});
Object.assign(window.__march ?? (window.__march = {}), { zoom, turn });

function stopSpin() {
  orbit.autoRotate = false;
  document.querySelector('[data-spin]').setAttribute('aria-pressed', 'false');
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

function pick(e) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...doors.values()].map((d) => d.node), true)[0];
  return hit ? doorNameOf(hit.object) : null;
}

canvas.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  hint.classList.add('gone');
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 5) return; // it was a drag, not a click
  const name = pick(e);
  if (name) {
    stopSpin();
    toggleDoor(name);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons || e.pointerType !== 'mouse') return;
  canvas.classList.toggle('over-door', Boolean(pick(e)));
});
orbit.addEventListener('start', () => {
  viewTween = null;
  turnTween = null;
});

// ---------- loop ----------

const clock = new THREE.Clock();
const ease = (t) => t * t * (3 - 2 * t);
const UP = new THREE.Vector3(0, 1, 0);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  for (const d of doors.values()) {
    if (d.value === d.target) continue;
    const step = reduceMotion ? 1 : dt / 0.9;
    d.value = d.target > d.value ? Math.min(d.target, d.value + step) : Math.max(d.target, d.value - step);
    d.node.rotation[HINGE_AXIS] = THREE.MathUtils.lerp(d.closed, d.open, ease(d.value));
  }

  if (turnTween) {
    // Swing the camera round the car on an arc, not a straight line.
    turnTween.t = reduceMotion ? 1 : Math.min(1, turnTween.t + dt / 0.7);
    const a = turnTween.by * ease(turnTween.t);
    const off = camera.position.clone().sub(orbit.target).applyAxisAngle(UP, a - turnTween.last);
    camera.position.copy(orbit.target).add(off);
    turnTween.last = a;
    if (turnTween.t === 1) turnTween = null;
  }

  if (viewTween) {
    viewTween.t = Math.min(1, viewTween.t + dt / 1.1);
    const k = ease(viewTween.t);
    camera.position.lerpVectors(viewTween.fromEye, viewTween.eye, k);
    orbit.target.lerpVectors(viewTween.fromTarget, viewTween.target, k);
    if (viewTween.t === 1) {
      viewTween.done();
      viewTween = null;
    }
  }

  orbit.update();
  renderer.render(scene, camera);
});
