attribute float aRatio;
attribute float aSide;

varying float vRatio;
varying float vSide;

void main() {
  vRatio = aRatio;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

