varying float vAge;
varying float vSeed;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv);
  if (r > 0.5) discard;

  float core = max(0.0, 1.0 - r * 5.0);
  float glow = max(0.0, 1.0 - r * 2.2);

  vec3 hot = vec3(1.00, 0.92, 0.55);
  vec3 mid = vec3(1.00, 0.42, 0.05);
  vec3 cool = vec3(0.70, 0.10, 0.00);

  vec3 col = mix(cool, mix(mid, hot, core), glow);
  float fade = max(0.0, 1.0 - vAge * vAge);
  gl_FragColor = vec4(col, (core * 1.0 + glow * 0.45) * fade);
}

