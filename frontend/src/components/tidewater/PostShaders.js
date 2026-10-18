// Shared by mobile and desktop. Preserve the existing AO samples and half-float
// colour rounding, while carrying full-precision view depth between the blurs.
export const aoCode = cacheDepth => /* wgsl */`
fn aoView(ip: vec2i, size: vec2f) -> vec3f {
  let q = clamp(ip, vec2i(0), vec2i(size) - 1);
  return viewFromDepth((vec2f(q) + 0.5) / size, max(textureLoad(sceneDepth, q, 0).x, 1e-6));
}
${cacheDepth ? `fn aoStore(in: FSIn, value: f32, distance: f32) -> vec4f {
  let full = vec2f(textureDimensions(sceneDepth));
  let halfSize = vec2f((vec2i(full) + 1) / 2);
  // Match the original blur's explicit neighbour-coordinate arithmetic, which
  // need not round to the same depth texel as a rasterised UV at odd sizes.
  let q = vec2i((floor(in.pos.xy) + 0.5) / halfSize * full);
  let z = viewDepth(max(textureLoad(sceneDepth, q, 0).x, 1e-6));
  return vec4f(bitcast<f32>(pack2x16float(vec2f(value, distance))), z, 0.0, 1.0);
}` : ''}
fn fragment(in: FSIn) -> vec4f {
  let size = vec2f(textureDimensions(sceneDepth));
  let ip = vec2i(in.uv * size);
  let d = textureLoad(sceneDepth, ip, 0).x;
  if (d <= 0.0) { return ${cacheDepth ? 'aoStore(in, 1.0, 60000.0)' : 'vec4f(1.0, 60000.0, 0.0, 1.0)'}; }
  let P = aoView(ip, size);
  let l = aoView(ip - vec2i(1, 0), size); let r = aoView(ip + vec2i(1, 0), size);
  let u = aoView(ip - vec2i(0, 1), size); let b = aoView(ip + vec2i(0, 1), size);
  let dx = select(P - l, r - P, abs(r.z - P.z) < abs(P.z - l.z));
  let dy = select(P - u, b - P, abs(b.z - P.z) < abs(P.z - u.z));
  var N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) { N = -N; }
  let dist = -P.z;
  let R = clamp(dist * 0.035, 0.7, 9.0);
  let rPx = R * frame.proj[1][1] * 0.5 * size.y / dist;
  if (rPx < 1.5) { return ${cacheDepth ? 'aoStore(in, 1.0, dist)' : 'vec4f(1.0, dist, 0.0, 1.0)'}; }
  let ign = fract(52.9829189 * fract(dot(in.pos.xy, vec2f(0.06711056, 0.00583715))));
  var occ = 0.0;
  let COUNT = 12;
  for (var i = 0; i < COUNT; i++) {
    let t = (f32(i) + ign) / f32(COUNT);
    let a = t * 18.8495559 + ign * 6.2831853;
    let o = vec2f(cos(a), sin(a)) * rPx * (0.12 + 0.88 * t * t);
    let S = aoView(ip + vec2i(o), size);
    let v = S - P;
    let vv = dot(v, v);
    let fall = sat(1.0 - vv / (R * R));
    occ += sat(dot(v, N) * inverseSqrt(vv + 1e-4) - 0.08) * fall;
  }
  let ao = sat(1.0 - occ / f32(COUNT) * 2.2);
  return ${cacheDepth ? 'aoStore(in, ao * ao, dist)' : 'vec4f(ao * ao, dist, 0.0, 1.0)'};
}`;

export const aoBlurCode = (axis, cacheDepth) => /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let size = vec2f(textureDimensions(aoSrc));
  let ip = vec2i(in.uv * size);
  let full = vec2f(textureDimensions(sceneDepth));
  let z0 = viewDepth(max(textureLoad(sceneDepth, vec2i(in.uv * full), 0).x, 1e-6));
  ${cacheDepth ? 'let center = textureLoad(aoSrc, ip, 0); let centerAO = unpack2x16float(bitcast<u32>(center.r));' : ''}
  var sum = 0.0; var wsum = 0.0;
  for (var i = -3; i <= 3; i++) {
    let q = clamp(ip + ${axis === 0 ? 'vec2i(i, 0)' : 'vec2i(0, i)'}, vec2i(0), vec2i(size) - 1);
    ${cacheDepth ? 'let texel = textureLoad(aoSrc, q, 0); let z = texel.g;' : 'let z = viewDepth(max(textureLoad(sceneDepth, vec2i((vec2f(q) + 0.5) / size * full), 0).x, 1e-6));'}
    let dz = (z - z0) / (z0 * 0.03 + 0.05);
    let w = exp(-f32(i * i) / 8.0) * exp(-dz * dz);
    sum += ${cacheDepth ? 'unpack2x16float(bitcast<u32>(texel.r)).x' : 'textureLoad(aoSrc, q, 0).r'} * w; wsum += w;
  }
  ${cacheDepth && axis === 0
    ? 'return vec4f(bitcast<f32>(pack2x16float(vec2f(sum / max(wsum, 1e-4), centerAO.y))), center.g, 0.0, 1.0);'
    : `return vec4f(sum / max(wsum, 1e-4), ${cacheDepth ? 'centerAO.y' : 'textureLoad(aoSrc, ip, 0).g'}, 0.0, 1.0);`}
}`;

// Maintain the original row-major accumulation order and reuse the already
// fetched centre. Constants let drivers avoid dynamic loops and centre refetches.
export const taaNeighbourhoodCode = () => [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => `{
  let q = ${dx === 0 && dy === 0 ? 'centerY' : `taaY(taaTm(textureLoad(src, clamp(p + vec2i(${dx}, ${dy}), vec2i(0), size - 1), 0).rgb))`};
  m1 += q; m2 += q * q;
}`)).join('\n');
