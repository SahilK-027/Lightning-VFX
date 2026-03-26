uniform float uTime;
uniform float uDelay;
uniform float uRevealDur;
uniform float uFadeDur;
uniform float uAlpha;
uniform vec3 uCoreColor;
uniform vec3 uMidColor;
uniform vec3 uEdgeColor;

varying float vRatio;
varying float vSide;

void main() {
  float t = max(0.0, uTime - uDelay);
  float revealT = clamp(t / uRevealDur, 0.0, 1.0);
  float fadeT = clamp((t - uRevealDur) / uFadeDur, 0.0, 1.0);

  float reveal = step(vRatio, revealT);
  float edge = 1.0 - abs(vSide);
  float core = smoothstep(0.0, 0.25, edge);
  float glow = smoothstep(0.0, 0.85, edge);

  vec3 col = mix(uEdgeColor, mix(uMidColor, uCoreColor, core), glow);
  float fade = 1.0 - fadeT * fadeT;

  float alpha = reveal * glow * fade * uAlpha;
  gl_FragColor = vec4(col, alpha);
}

