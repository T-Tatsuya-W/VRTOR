import * as THREE from 'three';
import { LogPanel } from './LogPanel.js';
import { DoubleGrabController } from '../interactions/DoubleGrabController.js';

export class LogCluster {
  constructor({ position = new THREE.Vector3(0, 1.6, -1.2), onReadyChange = null } = {}) {
    this.group = new THREE.Group();
    if (position instanceof THREE.Vector3) {
      this.group.position.copy(position);
    } else if (Array.isArray(position)) {
      this.group.position.fromArray(position);
    } else if (position && typeof position === 'object') {
      this.group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }

    this.panels = {
      left: new LogPanel('Left Hand Log'),
      right: new LogPanel('Right Hand Log'),
      system: new LogPanel('System Log')
    };

    this.panels.left.mesh.position.set(-1.25, 0, 0);
    this.panels.right.mesh.position.set(1.25, 0, 0);
    this.panels.system.mesh.position.set(0, 0, 0);

    this.group.add(this.panels.left.mesh);
    this.group.add(this.panels.right.mesh);
    this.group.add(this.panels.system.mesh);

    this.controller = new DoubleGrabController(this.group, {
      proximity: 0.065,
      intersectionPadding: 0.04,
      onReadyChange: (ready) => {
        Object.values(this.panels).forEach((panel) => panel.setHighlighted(ready));
        if (typeof onReadyChange === 'function') {
          onReadyChange(ready);
        }
      }
    });
  }

  setLeftLines(lines) {
    this.panels.left.setLines(lines);
  }

  setRightLines(lines) {
    this.panels.right.setLines(lines);
  }

  setSystemLines(lines) {
    this.panels.system.setLines(lines);
  }

  update(leftState, rightState) {
    return this.controller.update(leftState, rightState);
  }
}
