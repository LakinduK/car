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

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

function addGroundShadow(minY) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(40,34,20,0.55)');
  grad.addColorStop(0.55, 'rgba(40,34,20,0.22)');
  grad.addColorStop(1, 'rgba(40,34,20,0)');
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
  front: { dir: [0.55, 0.28, 1], dist: 1.75 },
  side: { dir: [-1, 0.16, 0.02], dist: 1.75 },
  rear: { dir: [-0.6, 0.3, -1], dist: 1.75 },
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
  const fit = Math.max(1, 1.05 / camera.aspect); // pull back on narrow screens
  const eye = target.clone().add(new THREE.Vector3(...v.dir).normalize().multiplyScalar(carSize.z * v.dist * fit));
  return { eye, target, min: carSize.z * 0.75, max: carSize.z * 4 };
}

function goToView(name, instant = false) {
  const pose = viewPose(name);
  camera.fov = pose.fov ?? 32; // wider lens inside the cabin
  camera.updateProjectionMatrix();
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

    goToView('front', true);
    loadingEl.hidden = true;
    controlsEl.hidden = false;
    window.__march = { scene, camera, orbit, doors, setDoor, goToView }; // handy in the console
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
});

// ---------- loop ----------

const clock = new THREE.Clock();
const ease = (t) => t * t * (3 - 2 * t);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  for (const d of doors.values()) {
    if (d.value === d.target) continue;
    const step = reduceMotion ? 1 : dt / 0.9;
    d.value = d.target > d.value ? Math.min(d.target, d.value + step) : Math.max(d.target, d.value - step);
    d.node.rotation[HINGE_AXIS] = THREE.MathUtils.lerp(d.closed, d.open, ease(d.value));
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
