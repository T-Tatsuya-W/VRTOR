import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { XRButton } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/XRButton.js';
import { XRHandModelFactory } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/XRHandModelFactory.js';
import { createLabelSprite, formatVec3 } from '../utils/threeUtils.js';
import { AudioVolumeMonitor } from '../audio/AudioVolumeMonitor.js';
import { HandTracker } from '../hands/HandTracker.js';
import { LogCluster } from '../ui/LogCluster.js';
import { ControlPanel } from '../ui/ControlPanel.js';
import { SoundPanel } from '../ui/SoundPanel.js';
import { DoubleGrabController } from '../interactions/DoubleGrabController.js';

export class VRTorApp {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101218);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
    this.camera.position.set(0, 1.6, 3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    document.body.appendChild(this.renderer.domElement);

    const xrButton = XRButton.createButton(this.renderer, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking']
    });
    document.getElementById('enter').appendChild(xrButton);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.5, 0);
    this.controls.enableDamping = true;

    this.clock = new THREE.Clock();
    this.pinchTelemetry = { L: null, R: null };
    this.systemMessages = [];
    this.singlePressResetTimeout = null;
    this.torusMovable = false;
    this.torusMaterial = null;
    this.torusGroup = null;
    this.torusController = null;
    this.torusMesh = null;
    this.torusPanel = null;
    this.soundPanel = null;
    this.audioMonitor = null;
    this.audioLevels = {
      level: 0,
      rms: 0,
      pcd: new Float32Array(12),
      dft: {
        amplitudes: new Float32Array(7),
        phases: new Float32Array(7)
      }
    };
    this.lastAudioMonitorStatus = null;
    this.lastAudioErrorMessage = null;

    this.setupEnvironment();
    this.setupHands();
    this.setupUI();

    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('error', (event) => {
      this.recordSystemMessage(`Error: ${event.message}`);
    });
  }

  setupEnvironment() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(10, 20, 0x333333, 0x222222);
    grid.position.y = 0;
    this.scene.add(grid);

    this.torusMaterial = new THREE.MeshStandardMaterial({
      color: 0x55ffee,
      emissive: 0x08263a,
      emissiveIntensity: 0.35,
      metalness: 0.35,
      roughness: 0.15,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.torusGroup = new THREE.Group();
    this.torusGroup.position.set(0, 1.5, 0);
    this.scene.add(this.torusGroup);

    this.torusMesh = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 64, 128), this.torusMaterial);
    this.torusMesh.rotation.x = Math.PI / 2;
    this.torusGroup.add(this.torusMesh);

    const torusLabel = createLabelSprite('VRTOR', {
      width: 0.38,
      fontSize: 160,
      color: '#f1f6ff',
      strokeStyle: 'rgba(0, 0, 0, 0.5)',
      renderOrder: 15,
      depthTest: false
    });
    const torusParams = this.torusMesh.geometry.parameters;
    const torusLabelOffset = torusParams.radius - torusParams.tube * 0.5;
    torusLabel.position.set(0, 0, torusLabelOffset);
    torusLabel.material.depthTest = false;
    torusLabel.material.depthWrite = false;
    this.torusMesh.add(torusLabel);

    this.torusController = new DoubleGrabController(this.torusGroup, {
      proximity: 0.075,
      intersectionPadding: 0.04,
      minScale: 0.45,
      maxScale: 2.5,
      onReadyChange: (ready) => this.updateTorusHighlight(ready)
    });
    this.updateTorusHighlight(false);
  }

  setupHands() {
    const handFactory = new XRHandModelFactory();

    this.leftHand = this.renderer.xr.getHand(0);
    this.leftHand.add(handFactory.createHandModel(this.leftHand, 'spheres'));
    this.leftHand.userData.which = 'L';
    this.scene.add(this.leftHand);

    this.rightHand = this.renderer.xr.getHand(1);
    this.rightHand.add(handFactory.createHandModel(this.rightHand, 'spheres'));
    this.rightHand.userData.which = 'R';
    this.scene.add(this.rightHand);

    this.trackers = [
      new HandTracker(this.leftHand, 'L'),
      new HandTracker(this.rightHand, 'R')
    ];

    this.trackers.forEach((tracker) => {
      tracker.on('pinch', ({ label, pinch }) => {
        this.pinchTelemetry[label] = {
          position: pinch.position ? pinch.position.clone() : null,
          speed: pinch.speed
        };
      });

      tracker.on('pinchend', ({ label }) => {
        this.pinchTelemetry[label] = null;
      });
    });
  }

  setupUI() {
    this.logCluster = new LogCluster();
    this.scene.add(this.logCluster.group);

    this.controlPanel = new ControlPanel({ header: 'Example Controls' });
    this.scene.add(this.controlPanel.group);

    this.torusPanel = new ControlPanel({
      position: new THREE.Vector3(0.58, 1.25, -1.05),
      rotation: new THREE.Euler(0, -Math.PI / 8, 0),
      header: 'Torus Controls'
    });
    this.scene.add(this.torusPanel.group);

    this.configureControlPanel();
    this.configureTorusPanel();
    this.setupSoundPanel();
  }

  configureControlPanel() {
    this.controlPanel.addMomentaryButton({
      id: 'singlePress',
      position: new THREE.Vector3(-0.45, -0.03, 0.06),
      overlay: {
        title: 'Single Press',
        valueLabel: 'Status',
        value: 'Ready',
        hint: 'Tap to log an event',
        accent: '#00d4ff'
      },
      onPress: () => {
        this.recordSystemMessage('Single press activated');
        this.controlPanel.updateOverlayEntry('singlePress', { value: 'Activated!' });
        clearTimeout(this.singlePressResetTimeout);
        this.singlePressResetTimeout = setTimeout(() => {
          this.controlPanel.updateOverlayEntry('singlePress', { value: 'Ready' });
        }, 1200);
      }
    });

    this.controlPanel.addToggleButton({
      id: 'toggle',
      position: new THREE.Vector3(-0.15, -0.03, 0.06),
      toggleOptions: {
        offColor: 0xff5fa2,
        offActiveColor: 0xff8cc4,
        onColor: 0x4dffc3,
        onActiveColor: 0x8dffe0,
        emissiveColor: 0x3a001f,
        activationThreshold: 0.95,
        releaseThreshold: 0.35
      },
      overlay: {
        title: 'Toggle Button',
        valueLabel: 'State',
        hint: 'Alternate colour each tap',
        onAccent: '#00ffcc',
        offAccent: '#ff9ebd'
      },
      onToggle: (toggled) => {
        const label = toggled ? 'ON' : 'OFF';
        this.recordSystemMessage(`Toggle button: ${label}`);
      }
    });

  }

  configureTorusPanel() {
    this.torusPanel.addToggleButton({
      id: 'torusMovement',
      position: new THREE.Vector3(0, -0.03, 0.06),
      toggleOptions: {
        offColor: 0x4b6070,
        offActiveColor: 0x6f8294,
        onColor: 0x4dffc3,
        onActiveColor: 0x8dffe0,
        emissiveColor: 0x062b3f,
        activationThreshold: 0.95,
        releaseThreshold: 0.35
      },
      overlay: {
        title: 'Torus Movement',
        valueLabel: 'Mode',
        hint: 'Enable double-hand grip for the torus',
        onValue: 'movable torus',
        offValue: 'locked torus',
        onAccent: '#00ffcc',
        offAccent: '#ff9ebd'
      },
      onToggle: (toggled) => {
        this.setTorusMovable(toggled);
        this.recordSystemMessage(`Torus mode: ${toggled ? 'movable torus' : 'locked torus'}`);
      }
    });
  }

  setupSoundPanel() {
    this.soundPanel = new SoundPanel({
      position: new THREE.Vector3(0, 0.82, -1.32)
    });
    this.scene.add(this.soundPanel.group);
    this.soundPanel.setStatus('Awaiting microphone permission…');

    this.audioMonitor = new AudioVolumeMonitor();
    this.lastAudioMonitorStatus = this.audioMonitor.getStatus();
    this.lastAudioErrorMessage = this.audioMonitor.getErrorMessage();

    const handleSuccess = () => {
      this.lastAudioMonitorStatus = this.audioMonitor.getStatus();
      this.lastAudioErrorMessage = null;
      this.soundPanel.setStatus('Microphone active');
      this.recordSystemMessage('Microphone access granted');
    };

    const handleError = (error) => {
      const message = error?.message ?? 'Unable to access microphone';
      this.lastAudioMonitorStatus = 'error';
      this.lastAudioErrorMessage = message;
      this.soundPanel.setStatus(`Microphone error: ${message}`, { type: 'error' });
      this.recordSystemMessage(`Microphone error: ${message}`);
    };

    try {
      const startResult = this.audioMonitor.start();
      if (startResult && typeof startResult.then === 'function') {
        startResult.then(handleSuccess).catch(handleError);
      } else {
        handleSuccess();
      }
    } catch (error) {
      handleError(error);
    }
  }

  setTorusMovable(enabled) {
    const next = Boolean(enabled);
    if (this.torusMovable === next) {
      this.updateTorusHighlight(this.torusController?.highlighted ?? false);
      return;
    }
    this.torusMovable = next;
    if (!this.torusMovable && this.torusController) {
      this.torusController.release();
    }
    this.updateTorusHighlight(this.torusController?.highlighted ?? false);
  }

  updateTorusHighlight(ready) {
    if (!this.torusMaterial) return;
    if (!this.torusMovable) {
      this.torusMaterial.emissiveIntensity = 0.35;
      return;
    }
    this.torusMaterial.emissiveIntensity = ready ? 1.05 : 0.6;
  }

  recordSystemMessage(message) {
    this.systemMessages.unshift(message);
    this.systemMessages.splice(12);
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    this.renderer.setAnimationLoop(() => this.update());
  }

  update() {
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.controls.update();

    this.trackers.forEach((tracker) => tracker.update(elapsed, delta));
    const [leftTracker, rightTracker] = this.trackers;
    const leftState = leftTracker.state;
    const rightState = rightTracker.state;

    const logStatus = this.logCluster.update(leftState, rightState);
    const panelStatus = this.controlPanel.update(leftState, rightState, delta);
    const controlResults = panelStatus.controls ?? {};
    const toggleResult = controlResults.toggle ?? null;

    const torusPanelStatus = this.torusPanel.update(leftState, rightState, delta);
    const soundPanelStatus = this.soundPanel ? this.soundPanel.update(leftState, rightState) : null;

    let torusInteraction = null;
    if (this.torusController) {
      if (this.torusMovable) {
        torusInteraction = this.torusController.update(leftState, rightState);
      } else {
        this.torusController.release();
      }
    }

    let audioLevels = {
      level: 0,
      rms: 0,
      pcd: new Float32Array(12),
      dft: {
        amplitudes: new Float32Array(7),
        phases: new Float32Array(7)
      }
    };
    if (this.audioMonitor) {
      const monitorStatus = this.audioMonitor.getStatus();
      const errorMessage = this.audioMonitor.getErrorMessage();
      if (
        monitorStatus !== this.lastAudioMonitorStatus ||
        errorMessage !== this.lastAudioErrorMessage
      ) {
        this.lastAudioMonitorStatus = monitorStatus;
        this.lastAudioErrorMessage = errorMessage;
        if (monitorStatus === 'active') {
          this.soundPanel?.setStatus('Microphone active');
        } else if (monitorStatus === 'pending') {
          this.soundPanel?.setStatus('Awaiting microphone permission…');
        } else if (monitorStatus === 'error') {
          const message = errorMessage ?? 'Unable to access microphone';
          this.soundPanel?.setStatus(`Microphone error: ${message}`, { type: 'error' });
        } else {
          this.soundPanel?.setStatus('Microphone idle');
        }
      }
      audioLevels = this.audioMonitor.update();
      this.audioLevels = audioLevels;
      this.soundPanel?.updateMeter(audioLevels);
    } else if (this.soundPanel) {
      audioLevels = {
        level: 0,
        rms: 0,
        pcd: new Float32Array(12),
        dft: {
          amplitudes: new Float32Array(7),
          phases: new Float32Array(7)
        }
      };
      this.audioLevels = audioLevels;
      this.soundPanel.updateMeter(audioLevels);
    }

    const generalLines = [];
    const activePinches = Object.entries(this.pinchTelemetry).filter(([, data]) => data && data.position);
    if (activePinches.length > 0) {
      generalLines.push('Active pinches');
      activePinches.forEach(([label, data]) => {
        generalLines.push(
          `${label}: pos (${formatVec3(data.position)})`,
          `${label}: speed ${data.speed.toFixed(3)} m/s`
        );
      });
    }

    generalLines.push(
      `Single press ready: ${this.controlPanel.ready ? 'YES' : 'no'}`,
      `Toggle button: ${toggleResult?.toggled ? 'ON' : 'OFF'}`,
      `Torus mode: ${this.torusMovable ? 'movable torus' : 'locked torus'}`
    );

    if (this.audioMonitor) {
      const micPercent = Math.round(this.audioLevels.level * 100);
      generalLines.push(
        `Microphone status: ${this.audioMonitor.getStatusDescription()}`,
        `Microphone level: ${micPercent}% (RMS ${this.audioLevels.rms.toFixed(3)})`
      );
    }

    const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pcdValues = this.audioLevels?.pcd;
    if (pcdValues?.length === pitchClasses.length) {
      let peakIndex = -1;
      let peakValue = 0;
      for (let i = 0; i < pcdValues.length; i += 1) {
        if (pcdValues[i] > peakValue) {
          peakValue = pcdValues[i];
          peakIndex = i;
        }
      }
      if (peakIndex >= 0 && peakValue > 0) {
        generalLines.push(
          `Dominant pitch class: ${pitchClasses[peakIndex]} ${(peakValue * 100).toFixed(1)}%`
        );
      }
    }

    const statusLines = [];
    if (logStatus?.grabbing) {
      statusLines.push('Adjusting log cluster…', `Scale ×${this.logCluster.group.scale.x.toFixed(2)}`);
    }
    if (panelStatus?.grabbing) {
      statusLines.push('Moving control panel…');
    }
    if (torusPanelStatus?.grabbing) {
      statusLines.push('Moving torus control panel…');
    }
    if (soundPanelStatus?.grabbing) {
      statusLines.push('Moving sound panel…');
    }
    if (this.torusMovable && torusInteraction?.grabbing) {
      statusLines.push('Manipulating torus…', `Scale ×${this.torusGroup.scale.x.toFixed(2)}`);
    }
    if (statusLines.length > 0) {
      generalLines.push('—', ...statusLines);
    }

    if (this.systemMessages.length) {
      generalLines.push('—', ...this.systemMessages);
    }

    this.logCluster.setLeftLines(leftTracker.getLogLines());
    this.logCluster.setRightLines(rightTracker.getLogLines());
    this.logCluster.setSystemLines(generalLines);

    this.renderer.render(this.scene, this.camera);
  }
}
