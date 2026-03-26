attribute vec3 aVelocity;
attribute float aLifetime;
attribute float aSeed;

uniform float uTime;
uniform float uDelay;
uniform float uSize;
uniform float uGravity;
uniform float uDepthScale;

varying float vAge;
varying float vSeed;

void main() {
  float t = max(0.0, uTime - uDelay);
  vAge = clamp(t / aLifetime, 0.0, 1.5);
  vSeed = aSeed;

  vec3 p = position + aVelocity * t + vec3(0.0, -uGravity * t * t, 0.0);
  p.y = max(p.y, 0.0);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * max(0.0, 1.0 - vAge * 0.8) * (uDepthScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}

