uniform float uTime;
uniform float uStrikeDur;
uniform float uFadeDur;
uniform float uStrikeOffset;

uniform vec3 uColor;
uniform float uAlpha;

varying float vRatio;

void main() {
  float strikeT = clamp(uTime / uStrikeDur, 0.0, 1.0);
  float fadeT = clamp((uTime - uStrikeDur) / uFadeDur, 0.0, 1.0);

  float window = max(1.0 - uStrikeOffset, 0.001);
  float localT = clamp((strikeT - uStrikeOffset) / window, 0.0, 1.0);

  float reveal = step(vRatio, localT);
  float alpha = reveal * (1.0 - fadeT * fadeT) * uAlpha;

  gl_FragColor = vec4(uColor, alpha);
}

