void main() {
  vec2 st = gl_FragCoord.xy / u_resolution.xy;
  float cx = clamp(u_mouse.x / u_resolution.x, 0.0, 1.0);
  float cy = clamp(u_mouse.y / u_resolution.y, 0.0, 1.0);
  vec2 hp = vec2(cx, cy);
  float sz = sin(u_time * 0.5) * 12.0 + 28.0;
  vec2 g = fract(st * sz) - 0.5;
  vec2 gv = fract((st + hp * 0.05) * sz) - 0.5;
  float d = min(abs(g.x), abs(g.y));
  float dv = min(abs(gv.x), abs(gv.y));
  float line = smoothstep(0.05, 0.02, d) - smoothstep(0.05, 0.02, dv);
  vec3 bg = vec3(0.08, 0.09, 0.11);
  vec3 fg = vec3(0.35, 0.85, 0.72);
  vec3 col = mix(bg, fg * (0.4 + line * 0.6), 0.25 + line * 0.75);
  fragColor = vec4(col, 1.0);
}
