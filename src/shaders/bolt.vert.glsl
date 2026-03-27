attribute float aRatio;
attribute vec3 aDirection;
attribute float aSide;
attribute float aStrikeOffset;
attribute float aThickness;
attribute float aAlpha;
attribute vec3 aColor;

uniform float uTime;
uniform float uStrikeDur;
uniform float uFadeDur;
uniform float uSpread;

varying float vRatio;
varying float vStrikeOffset;
varying float vAlpha;
varying vec3 vColor;

void main() {
  float fadeT = clamp((uTime - uStrikeDur) / uFadeDur, 0.0, 1.0);
  vec3 pos = position;
  pos.xz += pos.xz * pow(fadeT, 2.0) * uSpread;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vec3 toCamera = normalize(cameraPosition - worldPos.xyz);
  vec4 nextWorld = modelMatrix * vec4(position + aDirection, 1.0);
  vec3 tangent = normalize(cross(normalize(nextWorld.xyz - worldPos.xyz), toCamera));
  worldPos.xyz += tangent * aSide * aThickness;

  vRatio = aRatio;
  vStrikeOffset = aStrikeOffset;
  vAlpha = aAlpha;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}


