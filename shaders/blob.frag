void main() {
  vec2 st = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  vec2 m = vec2(u_mouse.x / u_resolution.y, u_mouse.y / u_resolution.y) - p;
  vec2 c = vec2(-0.5 + 0.2 * cos(u_time * 1.7), sin(u_time * 0.53) * 0.08);
  float r = distance(p + m * 0.02, c) - 0.22;
  float glow = exp(-120.0 * r * r) * 1.35;
  vec3 tint = vec3(0.7, 0.35, 0.95);
  vec3 rim = tint * glow;
  float bg = sin(p.y * 5.5 + u_time) * 0.05 + (st.x * 0.5 + st.y * 0.5) * 0.08;
  vec3 sky = vec3(0.04, 0.06 + bg, 0.12 + bg * 2.5);
  vec3 col = sky + rim;
  fragColor = vec4(col, 1.0);
}
