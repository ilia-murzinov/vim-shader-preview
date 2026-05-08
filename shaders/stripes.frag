void main() {
  vec2 st = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.35;
  float g = fract(sin(st.x * 31.12 + st.y * 17.403 + t) * 83421.342);
  float v = st.x + (g - 0.5) * 0.12;
  float band = sin((v + t * 0.3) * 6.28318 * 12.0) * 0.5 + 0.5;
  vec3 a = vec3(0.10, 0.18, 0.35);
  vec3 b = vec3(1.00, 0.45, 0.72);
  vec3 col = mix(a, b, band);
  fragColor = vec4(col, 1.0);
}
