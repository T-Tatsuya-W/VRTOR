import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRHandModelFactory.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

document.getElementById('loading')?.remove();

const clock = new THREE.Clock();

const rig = new THREE.Group();
scene.add(rig);
rig.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, -1);
controls.update();

const hemiLight = new THREE.HemisphereLight(0xbad4ff, 0x080820, 0.7);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(5, 10, 2);
scene.add(dirLight);

const floorGeometry = new THREE.CylinderGeometry(30, 30, 0.1, 36);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1, metalness: 0 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.receiveShadow = true;
floor.position.y = -0.05;
scene.add(floor);

const cubeGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.3, roughness: 0.4 });
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
cube.position.set(0, 1.5, -1.5);
scene.add(cube);

const logCanvas = document.createElement('canvas');
logCanvas.width = 1024;
logCanvas.height = 1024;
const logContext = logCanvas.getContext('2d');
const logTexture = new THREE.CanvasTexture(logCanvas);
logTexture.colorSpace = THREE.SRGBColorSpace;

const logMaterial = new THREE.MeshBasicMaterial({ map: logTexture, transparent: true });
const logPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), logMaterial);
logPlane.position.set(0, 1.8, -1.2);
scene.add(logPlane);

const controllerModelFactory = new XRControllerModelFactory();
const handModelFactory = new XRHandModelFactory();

const controllers = [];

function setupController(index) {
  const controller = renderer.xr.getController(index);
  controller.userData.index = index;
  controller.addEventListener('connected', (event) => {
    controller.userData.gamepad = event.data.gamepad;
  });
  controller.addEventListener('disconnected', () => {
    controller.userData.gamepad = undefined;
  });
  rig.add(controller);

  const controllerGrip = renderer.xr.getControllerGrip(index);
  controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
  rig.add(controllerGrip);

  const hand = renderer.xr.getHand(index);
  hand.add(handModelFactory.createHandModel(hand, 'mesh'));
  rig.add(hand);

  controllers.push({ controller, controllerGrip, hand });
}

setupController(0);
setupController(1);

const speed = 1.5;
const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

const logLines = [];

function updateLogText(lines) {
  if (!logContext) return;

  logContext.clearRect(0, 0, logCanvas.width, logCanvas.height);
  logContext.fillStyle = 'rgba(15, 23, 42, 0.85)';
  logContext.fillRect(0, 0, logCanvas.width, logCanvas.height);
  logContext.fillStyle = '#f8fafc';
  logContext.font = '48px "Fira Code", monospace';
  logContext.textBaseline = 'top';

  const padding = 32;
  lines.slice(0, 14).forEach((line, i) => {
    logContext.fillText(line, padding, padding + i * 68);
  });

  logTexture.needsUpdate = true;
}

function formatVector(label, vector) {
  return `${label}: ${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)}`;
}

function handleLocomotion(delta) {
  const session = renderer.xr.getSession();
  if (!session) return;

  const leftController = controllers[0]?.controller;
  const gamepad = leftController?.userData.gamepad;
  if (!gamepad || !gamepad.axes?.length) return;

  const axes = gamepad.axes;
  const moveX = axes[2] ?? axes[0] ?? 0;
  const moveZ = axes[3] ?? axes[1] ?? 0;

  if (Math.abs(moveX) < 0.08 && Math.abs(moveZ) < 0.08) return;

  camera.getWorldQuaternion(tmpQuat);

  forward.set(0, 0, -1).applyQuaternion(tmpQuat);
  right.set(1, 0, 0).applyQuaternion(tmpQuat);
  forward.y = 0;
  right.y = 0;
  forward.normalize();
  right.normalize();

  tmpVec.copy(forward).multiplyScalar(-moveZ).addScaledVector(right, moveX).multiplyScalar(speed * delta);
  rig.position.add(tmpVec);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  const delta = clock.getDelta();
  cube.rotation.y += delta * 0.3;
  cube.rotation.x += delta * 0.15;

  handleLocomotion(delta);

  logLines.length = 0;

  camera.getWorldPosition(tmpVec);
  logLines.push(formatVector('Head', tmpVec));

  controllers.forEach(({ controller, controllerGrip, hand }, index) => {
    controller.getWorldPosition(tmpVec);
    logLines.push(formatVector(`Controller ${index}`, tmpVec));

    controllerGrip.getWorldPosition(tmpVec);
    logLines.push(formatVector(`Grip ${index}`, tmpVec));

    hand.getWorldPosition(tmpVec);
    logLines.push(formatVector(`Hand ${index}`, tmpVec));
  });

  updateLogText(logLines);

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (navigator.xr) {
  const button = document.createElement('button');
  button.id = 'enter-vr';
  button.textContent = 'Enter VR';
  button.style.position = 'absolute';
  button.style.bottom = '2rem';
  button.style.left = '50%';
  button.style.transform = 'translateX(-50%)';
  button.style.padding = '0.75rem 1.5rem';
  button.style.border = 'none';
  button.style.borderRadius = '999px';
  button.style.background = '#2563eb';
  button.style.color = '#f8fafc';
  button.style.fontSize = '1.1rem';
  button.style.cursor = 'pointer';
  button.style.boxShadow = '0 10px 30px rgba(37, 99, 235, 0.4)';
  button.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
  button.onmouseenter = () => {
    button.style.transform = 'translateX(-50%) translateY(-2px)';
    button.style.boxShadow = '0 16px 40px rgba(37, 99, 235, 0.55)';
  };
  button.onmouseleave = () => {
    button.style.transform = 'translateX(-50%)';
    button.style.boxShadow = '0 10px 30px rgba(37, 99, 235, 0.4)';
  };

  button.addEventListener('click', async () => {
    try {
      await renderer.xr.setSession(await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      }));
      button.remove();
    } catch (error) {
      console.error('Failed to start immersive session', error);
      button.textContent = 'VR Not Available';
      button.disabled = true;
    }
  });

  document.body.appendChild(button);
} else {
  const message = document.createElement('p');
  message.textContent = 'WebXR not supported in this browser.';
  message.style.position = 'absolute';
  message.style.bottom = '2rem';
  message.style.left = '50%';
  message.style.transform = 'translateX(-50%)';
  message.style.padding = '0.75rem 1.5rem';
  message.style.borderRadius = '999px';
  message.style.background = 'rgba(15, 23, 42, 0.8)';
  message.style.color = '#f8fafc';
  document.body.appendChild(message);
}
