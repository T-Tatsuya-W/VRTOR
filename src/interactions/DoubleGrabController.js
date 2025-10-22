import * as THREE from 'three';

export class DoubleGrabController {
  constructor(group, options = {}) {
    this.group = group;
    this.options = {
      minScale: options.minScale ?? 0.5,
      maxScale: options.maxScale ?? 2.5,
      proximity: options.proximity ?? 0.06,
      intersectionPadding: options.intersectionPadding ?? 0.02,
      onReadyChange: options.onReadyChange ?? null
    };

    this.highlighted = false;
    this.engaged = false;

    this.temp = {
      leftLocal: new THREE.Vector3(),
      rightLocal: new THREE.Vector3(),
      midpoint: new THREE.Vector3(),
      span: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      rotationDelta: new THREE.Quaternion(),
      workingQuaternion: new THREE.Quaternion(),
      nextPosition: new THREE.Vector3()
    };

    this.initial = {
      midpoint: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      direction: new THREE.Vector3(1, 0, 0),
      distance: 0.3,
      quaternion: new THREE.Quaternion(),
      scale: 1
    };

    this.boundsBox = new THREE.Box3();
    this.boundsMatrix = new THREE.Matrix4();
    this.localBounds = new THREE.Box3();
    this.intersectionBounds = new THREE.Box3();
    this.inverseMatrix = new THREE.Matrix4();
  }

  setHighlight(active) {
    if (this.highlighted === active) return;
    this.highlighted = active;
    if (typeof this.options.onReadyChange === 'function') {
      this.options.onReadyChange(active);
    }
  }

  release() {
    if (!this.engaged) return;
    this.engaged = false;
    if (DoubleGrabController.activeController === this) {
      DoubleGrabController.activeController = null;
    }
  }

  computeLocalBounds() {
    this.inverseMatrix.copy(this.group.matrixWorld).invert();
    this.localBounds.makeEmpty();

    this.group.traverse((object) => {
      if (!object.geometry || !object.visible) return;
      const geometry = object.geometry;
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }
      this.boundsBox.copy(geometry.boundingBox);
      this.boundsMatrix.copy(object.matrixWorld).premultiply(this.inverseMatrix);
      this.boundsBox.applyMatrix4(this.boundsMatrix);
      this.localBounds.union(this.boundsBox);
    });

    if (this.localBounds.isEmpty()) {
      this.localBounds.setFromCenterAndSize(
        new THREE.Vector3(),
        new THREE.Vector3(0.01, 0.01, 0.01)
      );
    }
  }

  update(leftState, rightState) {
    const leftPoint = leftState?.palm ?? leftState?.wrist ?? null;
    const rightPoint = rightState?.palm ?? rightState?.wrist ?? null;

    this.group.updateWorldMatrix(true, true);
    this.computeLocalBounds();
    const averageScale =
      (Math.abs(this.group.scale.x) + Math.abs(this.group.scale.y) + Math.abs(this.group.scale.z)) / 3 || 1;
    const paddingWorld = Math.max(0, this.options.intersectionPadding ?? 0);
    const paddingLocal = paddingWorld / averageScale;
    this.intersectionBounds.copy(this.localBounds);
    if (paddingLocal > 0) {
      this.intersectionBounds.expandByScalar(paddingLocal);
    }

    const blockedByOther =
      DoubleGrabController.activeController && DoubleGrabController.activeController !== this;
    const proximity = Math.max(0, this.options.proximity ?? 0);
    const proximityLocal = proximity / averageScale;
    const hasBounds = !this.intersectionBounds.isEmpty();

    const leftLocalPoint = leftPoint
      ? this.temp.leftLocal.copy(leftPoint).applyMatrix4(this.inverseMatrix)
      : null;
    const rightLocalPoint = rightPoint
      ? this.temp.rightLocal.copy(rightPoint).applyMatrix4(this.inverseMatrix)
      : null;

    const leftDistance = hasBounds && leftLocalPoint
      ? this.intersectionBounds.distanceToPoint(leftLocalPoint)
      : Infinity;
    const rightDistance = hasBounds && rightLocalPoint
      ? this.intersectionBounds.distanceToPoint(rightLocalPoint)
      : Infinity;

    const leftTouching = Boolean(
      !blockedByOther &&
        leftState?.visible &&
        leftLocalPoint &&
        hasBounds &&
        (this.intersectionBounds.containsPoint(leftLocalPoint) || leftDistance <= proximityLocal)
    );
    const rightTouching = Boolean(
      !blockedByOther &&
        rightState?.visible &&
        rightLocalPoint &&
        hasBounds &&
        (this.intersectionBounds.containsPoint(rightLocalPoint) || rightDistance <= proximityLocal)
    );

    const bothTouching = leftTouching && rightTouching;
    const bothGrabbing = Boolean(leftState?.grab && rightState?.grab);
    const shouldEngage = bothTouching && bothGrabbing;

    if (!this.engaged && shouldEngage) {
      this.engaged = true;
      DoubleGrabController.activeController = this;
      const midpoint = this.temp.midpoint.copy(leftPoint).add(rightPoint).multiplyScalar(0.5);
      this.initial.midpoint.copy(midpoint);
      this.initial.offset.copy(this.group.position).sub(midpoint);
      const spanVector = this.temp.span.copy(rightPoint).sub(leftPoint);
      const spanLength = spanVector.length();
      if (spanLength > 1e-4) {
        this.initial.direction.copy(this.temp.direction.copy(spanVector).normalize());
        this.initial.distance = spanLength;
      } else {
        this.initial.direction.set(1, 0, 0);
        this.initial.distance = 0.3;
      }
      this.initial.quaternion.copy(this.group.quaternion);
      this.initial.scale = this.group.scale.x;
    }

    this.setHighlight(this.engaged || bothTouching);

    if (!this.engaged) {
      return { ready: this.highlighted, grabbing: false };
    }

    if (
      !bothGrabbing ||
      !leftPoint ||
      !rightPoint ||
      !leftState?.visible ||
      !rightState?.visible ||
      blockedByOther ||
      !bothTouching
    ) {
      this.release();
      return { ready: false, grabbing: false };
    }

    const midpoint = this.temp.midpoint.copy(leftPoint).add(rightPoint).multiplyScalar(0.5);
    const spanVector = this.temp.span.copy(rightPoint).sub(leftPoint);
    const spanLength = spanVector.length();
    if (spanLength > 1e-4) {
      const direction = this.temp.direction.copy(spanVector).normalize();
      const rotationDelta = this.temp.rotationDelta.setFromUnitVectors(
        this.initial.direction,
        direction
      );
      const rotated = this.temp.workingQuaternion.copy(this.initial.quaternion);
      rotated.premultiply(rotationDelta);
      this.group.quaternion.copy(rotated);

      const relativeScale = spanLength / Math.max(this.initial.distance, 0.1);
      const clampedScale = THREE.MathUtils.clamp(
        this.initial.scale * relativeScale,
        this.options.minScale,
        this.options.maxScale
      );
      this.group.scale.setScalar(clampedScale);
    }

    const newPosition = this.temp.nextPosition.copy(midpoint).add(this.initial.offset);
    this.group.position.copy(newPosition);

    return { ready: this.highlighted, grabbing: true };
  }
}

DoubleGrabController.activeController = null;
