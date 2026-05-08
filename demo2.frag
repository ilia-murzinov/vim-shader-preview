void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  vec3 col = 0.1 + 0.5 * cos(t + p.xyx + vec3(0.0, 2.0, 4.0));
  fragColor = vec4(col, 1.0);
}
