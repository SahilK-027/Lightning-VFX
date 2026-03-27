uniform float uTime;
uniform float uStrikeDur;
uniform float uFadeDur;

varying float vRatio;
varying float vStrikeOffset;
varying float vAlpha;
varying vec3 vColor;

void main() {
  float strikeT = clamp(uTime / uStrikeDur, 0.0, 1.0);
  float fadeT = clamp((uTime - uStrikeDur) / uFadeDur, 0.0, 1.0);

  float window = max(1.0 - vStrikeOffset, 0.001);
  float localT = clamp((strikeT - vStrikeOffset) / window, 0.0, 1.0);

  float reveal = step(vRatio, localT);
  float alpha = reveal * (1.0 - fadeT * fadeT) * vAlpha;

  gl_FragColor = vec4(vColor, alpha);
}


