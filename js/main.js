import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { XRHandModelFactory } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/XRHandModelFactory.js';

const container = document.getElementById('app') || document.body;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.cameraAutoUpdate = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);
if (container.classList) {
  container.classList.add('is-ready');
}

const introScreen = document.createElement('div');
introScreen.className = 'intro-screen';

const introCard = document.createElement('div');
introCard.className = 'intro-card';

const introTitle = document.createElement('h1');
introTitle.textContent = 'VRTOR Lightspace';

const introSubtitle = document.createElement('p');
introSubtitle.className = 'intro-subtitle';
introSubtitle.textContent = 'Step inside to explore the holographic room.';

const enterButton = document.createElement('button');
enterButton.type = 'button';
enterButton.className = 'enter-vr-button';
enterButton.textContent = 'Enter VR';
enterButton.disabled = true;

const introStatus = document.createElement('p');
introStatus.className = 'intro-status';
introStatus.textContent = 'Checking headset availability…';

introCard.append(introTitle, introSubtitle, enterButton, introStatus);
introScreen.appendChild(introCard);
container.appendChild(introScreen);

let activeSession = null;

function resetIntro(message, buttonLabel = 'Enter VR') {
  introScreen.classList.remove('is-hidden');
  introStatus.textContent = message;
  enterButton.textContent = buttonLabel;
  enterButton.disabled = false;
}

function showError(message) {
  introStatus.textContent = message;
  enterButton.disabled = false;
}

async function beginSession() {
  if (activeSession) {
    introStatus.textContent = 'You are already in an active VR session.';
    return;
  }

  if (!navigator.xr) {
    showError('WebXR is not available in this browser.');
    return;
  }

  enterButton.disabled = true;
  introStatus.textContent = 'Requesting immersive session…';

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking']
    });

    activeSession = session;

    session.addEventListener('end', () => {
      activeSession = null;
      resetIntro('Take a breather, then jump back in.');
    });

    await renderer.xr.setSession(session);
    introScreen.classList.add('is-hidden');
  } catch (error) {
    console.error('Failed to start XR session', error);
    showError('Unable to start VR session. Please try again.');
  }
}

enterButton.addEventListener('click', beginSession);

if (!navigator.xr) {
  introStatus.textContent = 'WebXR is not supported on this device.';
  enterButton.textContent = 'Unsupported';
  enterButton.disabled = true;
} else {
  navigator.xr.isSessionSupported('immersive-vr')
    .then((supported) => {
      if (supported) {
        introStatus.textContent = 'Ready when you are.';
        enterButton.disabled = false;
      } else {
        introStatus.textContent = 'Immersive VR is not supported.';
        enterButton.textContent = 'Unavailable';
        enterButton.disabled = true;
      }
    })
    .catch((error) => {
      console.error('Failed to determine XR support', error);
      showError('Could not verify VR support.');
    });
}

const ambient = new THREE.HemisphereLight(0xffffff, 0x0a0d12, 0.6);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0x99c1ff, 1.1);
keyLight.position.set(3, 5, 2);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xff9b9b, 0.5);
rimLight.position.set(-3, 4, -2);
scene.add(rimLight);

const floorGeometry = new THREE.CircleGeometry(5.5, 64);
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a1f2c,
  roughness: 0.9,
  metalness: 0.0
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const cubeGroup = new THREE.Group();
scene.add(cubeGroup);
cubeGroup.position.set(0, 1.6, -1.6);

const cubeGeometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
const cubeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x5ab9ff,
  transparent: true,
  opacity: 0.25,
  roughness: 0.2,
  transmission: 0.95,
  thickness: 0.45
});
const holographicCube = new THREE.Mesh(cubeGeometry, cubeMaterial);
holographicCube.name = 'CenterCube';

const cubeEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(cubeGeometry),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
);

cubeGroup.add(holographicCube);
cubeGroup.add(cubeEdges);

const smallObjects = new THREE.Group();
const objectMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0x332200, roughness: 0.4 });

const icosahedron = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), objectMaterial.clone());
icosahedron.position.set(0.3, 0.3, 0.1);
smallObjects.add(icosahedron);

const torusMaterial = new THREE.MeshStandardMaterial({ color: 0x66ffe6, emissive: 0x003333, roughness: 0.2 });
const torus = new THREE.Mesh(new THREE.TorusKnotGeometry(0.12, 0.035, 80, 8), torusMaterial);
torus.position.set(-0.35, -0.25, -0.2);
smallObjects.add(torus);

const octahedron = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), new THREE.MeshStandardMaterial({ color: 0xff6ad5, emissive: 0x33001f, roughness: 0.3 }));
octahedron.position.set(0.0, -0.05, 0.35);
smallObjects.add(octahedron);

smallObjects.position.set(0, 0, 0);
cubeGroup.add(smallObjects);

function createTextLabel(initialText, options = {}) {
  const width = options.width || 512;
  const height = options.height || 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(options.scaleX || 1.4, options.scaleY || 0.7, 1);

  const state = { canvas, context, texture, sprite };
  updateTextLabel(state, initialText, options);
  return state;
}

function updateTextLabel(state, text, options = {}) {
  const ctx = state.context;
  const { canvas } = state;
  const padding = options.padding || 24;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#f8fafc';
  ctx.font = `${options.fontSize || 42}px "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';

  const lines = text.split('\n');
  lines.forEach((line, index) => {
    ctx.fillText(line, padding, padding + index * (options.lineHeight || 48));
  });

  state.texture.needsUpdate = true;
}

const infoLabel = createTextLabel('Initializing XR inputs...', {
  width: 768,
  height: 384,
  scaleX: 1.6,
  scaleY: 0.8,
  fontSize: 44,
  lineHeight: 52
});
infoLabel.sprite.position.set(0, 0.45, 0);
smallObjects.add(infoLabel.sprite);

const descriptionLabel = createTextLabel('VRTOR Lightspace\nWalk around & explore', {
  width: 512,
  height: 256,
  scaleX: 1.2,
  scaleY: 0.6,
  fontSize: 48,
  lineHeight: 56
});
descriptionLabel.sprite.position.set(0, -0.45, -0.25);
cubeGroup.add(descriptionLabel.sprite);

const controllerStatus = [null, null];
const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
controllers.forEach((controller, index) => {
  controller.addEventListener('connected', function (event) {
    controllerStatus[index] = event.data;
  });
  controller.addEventListener('disconnected', function () {
    controllerStatus[index] = null;
  });
  cubeGroup.add(controller);
});

const handFactory = new XRHandModelFactory();
const hands = [renderer.xr.getHand(0), renderer.xr.getHand(1)];
hands.forEach((hand) => {
  handFactory.createHandModel(hand, 'sphere');
  cubeGroup.add(hand);
});

const clock = new THREE.Clock();

function animate(time) {
  const delta = clock.getDelta();

  cubeGroup.rotation.y += delta * 0.1;
  smallObjects.rotation.x += delta * 0.3;
  smallObjects.rotation.y -= delta * 0.25;

  const lines = ['Input tracking'];
  controllers.forEach((controller, index) => {
    if (controllerStatus[index]) {
      const p = controller.position;
      lines.push(`Controller ${index + 1}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`);
    } else {
      lines.push(`Controller ${index + 1}: not detected`);
    }
  });

  hands.forEach((hand, index) => {
    const wrist = hand.joints && hand.joints['wrist'];
    if (wrist && wrist.visible) {
      const p = wrist.position;
      lines.push(`Hand ${index + 1}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`);
    } else {
      lines.push(`Hand ${index + 1}: not detected`);
    }
  });

  updateTextLabel(infoLabel, lines.join('\n'), {
    fontSize: 44,
    lineHeight: 52
  });

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
