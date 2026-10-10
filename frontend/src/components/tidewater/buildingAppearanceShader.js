// Constructed materials only. No building photograph is sampled by this shader.
// Windows and joints are antialiased with pixel derivatives; distant features
// converge to their area coverage instead of shimmering or reducing resolution.
export const BUILDING_APPEARANCE_WGSL = /* wgsl */`{
  let f = in.vs.facade;
  let kind = floor((f.x % 32.0) / 8.0);
  let finish = f.x % 8.0;
  let variant = f.y % 8.0;
  let windowLayout = floor(f.y / 8.0);
  let q = fract(in.uv);
  let footprint = max(fwidth(in.uv), vec2f(0.0001));
  let distant = smoothstep(0.15, 0.7, max(footprint.x, footprint.y));
  let up = smoothstep(0.5, 0.8, abs(in.N.y));
  let plain = select(1.0, 0.0, f.x < 32.0) + up;
  var paint = in.color.rgb;
  var rough = select(0.82, 0.9, up > 0.5);
  var metal = 0.0;
  if (up < 0.5 && finish > 0.5 && finish < 1.5) {
    let brickUV = in.uv * vec2f(f.z / 0.24, f.w / 0.075);
    let row = floor(brickUV.y);
    let brick = fract(brickUV + vec2f((row % 2.0) * 0.5, 0.0));
    let aa = max(fwidth(brickUV), vec2f(0.001));
    let edge = min(brick, 1.0 - brick);
    let joint = 1.0 - smoothstep(0.025 - aa.x, 0.025 + aa.x, edge.x) * smoothstep(0.055 - aa.y, 0.055 + aa.y, edge.y);
    let visibility = 1.0 - smoothstep(0.2, 0.7, max(aa.x, aa.y));
    paint = mix(paint, vec3f(0.38, 0.36, 0.32), joint * visibility * 0.5);
    rough = 0.92;
  } else if (up < 0.5 && finish > 1.5 && finish < 3.5) {
    let panelUV = in.uv * vec2f(f.z / select(1.2, 0.65, finish > 2.5), f.w / 1.0);
    let panel = fract(panelUV);
    let aa = max(fwidth(panelUV), vec2f(0.001));
    let edge = min(panel, 1.0 - panel);
    let joint = 1.0 - smoothstep(0.007 - aa.x, 0.007 + aa.x, edge.x) * smoothstep(0.007 - aa.y, 0.007 + aa.y, edge.y);
    paint *= 1.0 - joint * 0.22 * (1.0 - smoothstep(0.25, 0.8, max(aa.x, aa.y)));
    rough = select(0.6, 0.32, finish > 2.5);
    metal = select(0.0, 0.62, finish > 2.5);
  }
  var width = select(0.31, 0.36, kind < 0.5);
  var height = select(0.27, 0.31, kind < 0.5);
  width += (variant % 3.0 - 1.0) * 0.035;
  height += (floor(variant / 3.0) - 1.0) * 0.025;
  if (finish > 3.5) { width = 0.475; height = select(0.405, 0.44, variant % 2.0 > 0.5); }
  if (kind > 1.5 && kind < 2.5 && in.uv.y < 1.0) { width = 0.44; height = 0.4; }
  var centre = vec2f(0.5, 0.49);
  var openings = 1.0;
  var coverage = 1.0;
  if (windowLayout > 0.5 && windowLayout < 1.5) {
    // Punched windows: solid masonry/panel wall around a smaller opening.
    width = 0.19 + (variant % 3.0 - 1.0) * 0.025; height = 0.26; centre.y = 0.54;
  } else if (windowLayout > 1.5 && windowLayout < 2.5) {
    // Two narrow windows per bay, separated by an opaque wall pier.
    width = 0.105; height = 0.245 + (variant % 2.0) * 0.025;
    centre = vec2f(select(0.27, 0.73, q.x > 0.5), 0.54); coverage = 2.0;
  } else if (windowLayout > 2.5 && windowLayout < 3.5) {
    // A horizontal ribbon with substantial opaque sill and spandrel bands.
    width = 0.46; height = 0.13 + (variant % 3.0) * 0.015; centre.y = 0.61;
  } else if (windowLayout > 3.5) {
    // Aligned window columns with a blank bay between them.
    width = 0.23; height = 0.29; centre.y = 0.54; coverage = 0.5;
    openings = select(1.0, 0.0, fract((floor(in.uv.x) + variant) * 0.5) > 0.25);
  }
  let edge = abs(q - centre);
  let box = (1.0 - smoothstep(width - footprint.x, width + footprint.x, edge.x)) * (1.0 - smoothstep(height - footprint.y, height + footprint.y, edge.y)) * openings;
  let frameWidth = select(0.012, 0.022, finish < 3.5);
  let inner = (1.0 - smoothstep(width - frameWidth - footprint.x, width - frameWidth + footprint.x, edge.x)) * (1.0 - smoothstep(height - frameWidth - footprint.y, height - frameWidth + footprint.y, edge.y)) * openings;
  let split = select(0.5, 0.333, variant % 3.0 > 1.5);
  let splitAt = select(split, centre.x + (split - 0.5) * width * 2.0, windowLayout > 0.5);
  let mullion = smoothstep(0.008 - footprint.x, 0.008 + footprint.x, abs(q.x - splitAt));
  let pane = inner * mullion;
  let area = width * height * 4.0 * 0.91 * coverage;
  let glazing = mix(pane, area, distant) * clamp(1.0 - plain, 0.0, 1.0);
  let frame = (box - pane) * (1.0 - distant) * clamp(1.0 - plain, 0.0, 1.0);
  let framePaint = select(vec3f(0.54, 0.55, 0.54), vec3f(0.16, 0.18, 0.19), variant % 2.0 > 0.5);
  paint = mix(paint, framePaint, clamp(frame, 0.0, 1.0));
  let glass = mix(vec3f(0.035, 0.065, 0.085), vec3f(0.09, 0.14, 0.18), variant / 7.0);
  s.albedo = mix(paint, glass, glazing);
  s.roughness = mix(rough, 0.16, glazing);
  s.metalness = mix(metal, 0.0, glazing);
  s.specularIntensity = mix(0.6, 1.35, glazing);
  s.alpha = 1.0;
  // A restrained interior tint sits behind dynamic physical reflections.
  let room = fract(sin(dot(floor(in.uv), vec2f(12.9898, 78.233)) + variant * 9.1) * 43758.5453);
  s.emissive = mat.emissive * vec3f(1.0, 0.8, 0.58) * glazing * select(0.0, 0.32, room > 0.69);
}`;
