import * as THREE from 'three';
import { PanelButton } from './PanelButton.js';

export class PanelToggleButton {
  constructor({
    position = new THREE.Vector3(),
    offColor = 0xff5fa2,
    offActiveColor = 0xff8cc4,
    onColor = 0x4dffc3,
    onActiveColor = 0x8dffe0,
    emissiveColor = 0x3a001f,
    emissiveConfig = {
      off: { idle: 0.4, ready: 0.6, activeScale: 0.9 },
      on: { idle: 0.6, ready: 1, activeScale: 0.9 }
    },
    activationThreshold = 0.95,
    releaseThreshold = 0.35,
    onToggle = null
  } = {}) {
    const mergedEmissive = {
      off: {
        idle: 0.4,
        ready: 0.6,
        activeScale: 0.9,
        ...(emissiveConfig?.off ?? {})
      },
      on: {
        idle: 0.6,
        ready: 1,
        activeScale: 0.9,
        ...(emissiveConfig?.on ?? {})
      }
    };

    this.button = new PanelButton({
      position,
      baseColor: offColor,
      activeColor: offActiveColor,
      emissiveColor,
      emissiveConfig: mergedEmissive.off,
      maxPressDepth: 0.045,
      damping: 18,
      activationThreshold,
      releaseThreshold,
      contactPadding: 0.012,
      depthBias: 0.003,
      metalness: 0.45,
      roughness: 0.38
    });

    this.colors = {
      off: new THREE.Color(offColor),
      offActive: new THREE.Color(offActiveColor),
      on: new THREE.Color(onColor),
      onActive: new THREE.Color(onActiveColor)
    };
    this.emissive = mergedEmissive;
    this.toggled = false;
    this.onToggle = onToggle;
    this.updateAppearance();
  }

  get mesh() {
    return this.button.mesh;
  }

  setReady(ready) {
    this.button.setReady(ready);
    this.updateAppearance();
  }

  setToggled(value) {
    const next = Boolean(value);
    if (this.toggled === next) return;
    this.toggled = next;
    this.updateAppearance();
  }

  updateAppearance() {
    const base = this.toggled ? this.colors.on : this.colors.off;
    const active = this.toggled ? this.colors.onActive : this.colors.offActive;
    const emissiveConfig = this.toggled ? this.emissive.on : this.emissive.off;
    this.button.setColors(base, active);
    this.button.setEmissiveConfig(emissiveConfig);
  }

  update(leftState, rightState, delta) {
    this.updateAppearance();
    const result = this.button.update(leftState, rightState, delta);
    if (result.justActivated) {
      this.toggled = !this.toggled;
      this.updateAppearance();
      if (typeof this.onToggle === 'function') {
        this.onToggle(this.toggled);
      }
    }
    return { ...result, toggled: this.toggled };
  }
}
