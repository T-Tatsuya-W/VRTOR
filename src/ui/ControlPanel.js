import * as THREE from 'three';
import { PanelButton } from '../controls/PanelButton.js';
import { PanelToggleButton } from '../controls/PanelToggleButton.js';
import { DoubleGrabController } from '../interactions/DoubleGrabController.js';
import { ControlPanelOverlay } from './ControlPanelOverlay.js';

export class ControlPanel {
  constructor({
    position = new THREE.Vector3(-0.78, 1.25, -1.05),
    rotation = new THREE.Euler(0, Math.PI / 8, 0),
    header = 'Controls'
  } = {}) {
    this.group = new THREE.Group();
    if (position instanceof THREE.Vector3) {
      this.group.position.copy(position);
    } else if (Array.isArray(position)) {
      this.group.position.fromArray(position);
    } else if (position && typeof position === 'object') {
      this.group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }
    if (rotation instanceof THREE.Euler) {
      this.group.rotation.copy(rotation);
    } else if (Array.isArray(rotation)) {
      this.group.rotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0);
    } else if (rotation && typeof rotation === 'object') {
      this.group.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    }

    this.overlayHeader = header;
    this.ready = false;
    this.controls = [];
    this.controlMap = new Map();
    this.overlayEntries = [];
    this.overlayDirty = true;

    this.panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x132f41,
      emissive: 0x0b3c57,
      emissiveIntensity: 0.4,
      metalness: 0.2,
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.44), this.panelMaterial);
    this.group.add(this.panelMesh);

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x050f16,
      emissive: 0x050f16,
      emissiveIntensity: 0.3,
      metalness: 0.25,
      roughness: 0.7,
      side: THREE.DoubleSide
    });
    this.frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.48), frameMaterial);
    this.frameMesh.position.set(0, 0, -0.01);
    this.group.add(this.frameMesh);

    this.overlay = new ControlPanelOverlay();
    this.group.add(this.overlay.mesh);

    this.controller = new DoubleGrabController(this.group, {
      proximity: 0.055,
      intersectionPadding: 0.03,
      minScale: 0.45,
      maxScale: 2.5,
      onReadyChange: (ready) => {
        this.setReady(ready);
      }
    });

    this.refreshOverlay(true);
  }

  addControl(control) {
    this.controls.push(control);
    this.controlMap.set(control.id, control);
  }

  addOverlayEntry(entry) {
    const normalized = {
      id: entry.id,
      title: entry.title ?? 'Control',
      valueLabel: entry.valueLabel ?? 'Value',
      value: entry.value ?? '—',
      hint: entry.hint ?? '',
      accent: entry.accent ?? '#00ffcc'
    };
    this.overlayEntries.push(normalized);
    this.overlayDirty = true;
    return normalized;
  }

  updateOverlayEntry(id, next = {}) {
    const entry = this.overlayEntries.find((item) => item.id === id);
    if (!entry) return;
    let changed = false;
    ['title', 'valueLabel', 'value', 'hint', 'accent'].forEach((key) => {
      if (next[key] !== undefined && entry[key] !== next[key]) {
        entry[key] = next[key];
        changed = true;
      }
    });
    if (changed) {
      this.overlayDirty = true;
    }
  }

  refreshOverlay(force = false) {
    if (!this.overlayDirty && !force) return;
    const columns = this.overlayEntries.map((entry) => ({ ...entry }));
    this.overlay.update({
      header: this.overlayHeader,
      highlighted: this.ready,
      columns
    });
    this.overlayDirty = false;
  }

  setReady(ready) {
    if (this.ready === ready) return;
    this.ready = ready;
    this.panelMaterial.emissiveIntensity = ready ? 0.9 : 0.35;
    this.controls.forEach((control) => {
      if (typeof control.setReady === 'function') {
        control.setReady(ready);
      }
    });
    this.overlayDirty = true;
  }

  addMomentaryButton({
    id,
    position,
    buttonOptions = {},
    overlay = {},
    onPress = null
  } = {}) {
    const options = { ...buttonOptions };
    delete options.onPress;
    const button = new PanelButton({
      position,
      ...options
    });
    this.group.add(button.mesh);
    button.setReady(this.ready);

    this.addOverlayEntry({
      id,
      title: overlay.title ?? 'Momentary Button',
      valueLabel: overlay.valueLabel ?? 'Status',
      value: overlay.value ?? 'Ready',
      hint: overlay.hint ?? 'Press to trigger action',
      accent: overlay.accent ?? '#00ffcc'
    });

    const control = {
      id,
      type: 'momentary',
      setReady: (ready) => button.setReady(ready),
      update: (leftState, rightState, delta) => {
        const result = button.update(leftState, rightState, delta);
        if (result.justActivated && typeof onPress === 'function') {
          onPress(result);
        }
        return result;
      }
    };
    this.addControl(control);
    return control;
  }

  addToggleButton({
    id,
    position,
    toggleOptions = {},
    overlay = {},
    onToggle = null
  } = {}) {
    const options = { ...toggleOptions };
    delete options.onToggle;
    const toggleButton = new PanelToggleButton({ position, ...options, onToggle: null });
    this.group.add(toggleButton.mesh);
    toggleButton.setReady(this.ready);

    const overlayConfig = {
      onValue: overlay.onValue ?? 'ON',
      offValue: overlay.offValue ?? 'OFF',
      onAccent: overlay.onAccent ?? '#00ffcc',
      offAccent: overlay.offAccent ?? '#ff9ebd'
    };

    this.addOverlayEntry({
      id,
      title: overlay.title ?? 'Toggle Button',
      valueLabel: overlay.valueLabel ?? 'State',
      value: toggleButton.toggled ? overlayConfig.onValue : overlayConfig.offValue,
      hint: overlay.hint ?? 'Tap to toggle',
      accent: toggleButton.toggled ? overlayConfig.onAccent : overlayConfig.offAccent
    });

    const control = {
      id,
      type: 'toggle',
      setReady: (ready) => toggleButton.setReady(ready),
      update: (leftState, rightState, delta) => {
        const result = toggleButton.update(leftState, rightState, delta);
        const value = result.toggled ? overlayConfig.onValue : overlayConfig.offValue;
        const accent = result.toggled ? overlayConfig.onAccent : overlayConfig.offAccent;
        this.updateOverlayEntry(id, { value, accent });
        if (result.justActivated && typeof onToggle === 'function') {
          onToggle(result.toggled, result);
        }
        return result;
      }
    };
    this.addControl(control);
    return control;
  }

  update(leftState, rightState, delta) {
    const rigStatus = this.controller.update(leftState, rightState);
    const results = {};
    this.controls.forEach((control) => {
      const result = control.update(leftState, rightState, delta);
      control.lastResult = result;
      results[control.id] = result;
    });
    this.refreshOverlay();
    return { ...rigStatus, controls: results };
  }
}
