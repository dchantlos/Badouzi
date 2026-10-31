export const MAX_WAKE_PACKETS = 18;

export function createWakeUniformData() {
  return {
    source: new Float32Array([0, 0, 1, 1]),
    power: 0,
    hasSource: false,
    count: 0,
    a: new Float32Array(MAX_WAKE_PACKETS * 4),
    b: new Float32Array(MAX_WAKE_PACKETS * 4),
    c: new Float32Array(MAX_WAKE_PACKETS * 4),
    d: new Float32Array(MAX_WAKE_PACKETS * 4)
  };
}

export function writeWakeUniformData(data, snapshot) {
  if (snapshot.packets.length > MAX_WAKE_PACKETS) throw new RangeError("Too many shader wake packets");
  data.count = snapshot.packets.length;
  data.hasSource = !!snapshot.source;
  data.power = snapshot.source?.power ?? 0;
  data.source.set(snapshot.source
    ? [snapshot.source.x, snapshot.source.y, snapshot.source.radiusX, snapshot.source.radiusY] : [0, 0, 1, 1]);
  snapshot.packets.forEach((packet, index) => {
    const offset = index * 4;
    data.a.set([packet.x, packet.y, packet.radiusX, packet.radiusY], offset);
    data.b.set([packet.born, packet.power, packet.radial, packet.phase], offset);
    data.c.set([packet.k, packet.omega, packet.lateralSpeed, packet.aftSpeed], offset);
    data.d.set([packet.branchSin, packet.branchCos, packet.groupSpeed, 0], offset);
  });
}

export const wakeFieldGLSL = `
#define MAX_WAKE_PACKETS ${MAX_WAKE_PACKETS}
uniform float uTime;
uniform vec4 uSource;
uniform float uSourcePower;
uniform bool uHasSource;
uniform int uPacketCount;
uniform vec4 uPacketA[MAX_WAKE_PACKETS];
uniform vec4 uPacketB[MAX_WAKE_PACKETS];
uniform vec4 uPacketC[MAX_WAKE_PACKETS];
uniform vec4 uPacketD[MAX_WAKE_PACKETS];

float soft(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
vec2 wakeField(vec2 p) {
  float height = 0.0;
  float foam = 0.0;
  if (uHasSource) {
    vec2 local = (p - uSource.xy) / uSource.zw;
    if (dot(local, local) <= 0.96 * 0.96) return vec2(0.0);
  }
  for (int i = 0; i < MAX_WAKE_PACKETS; i++) {
    if (i >= uPacketCount) break;
    vec4 a = uPacketA[i], b = uPacketB[i], c = uPacketC[i], d = uPacketD[i];
    float age = uTime - b.x;
    if (age < 0.0 || age >= 18.0) continue;
    float travel = d.z * age;
    float fade = soft(age / 0.6) * pow(1.0 - age / 18.0, 2.0) / sqrt(1.0 + age * 0.25);
    float width = 2.5 + age * 0.18;
    float reach = 6.0 + age * 0.75;
    for (int wing = 0; wing < 2; wing++) {
      float side = wing == 0 ? -1.0 : 1.0;
      vec2 centre = a.xy + vec2(side * (a.z * 0.98 + c.z * age), a.w * 0.65 + c.w * age);
      vec2 delta = p - centre;
      float across = side * delta.x * d.y - delta.y * d.x;
      float along = side * delta.x * d.x + delta.y * d.y;
      if (abs(across) > width * 3.0 || abs(along) > reach * 2.5) continue;
      float envelope = exp(-0.5 * (pow(across / width, 2.0) + pow(along / reach, 2.0)));
      float energy = b.y * fade * envelope;
      float wave = cos(c.x * across);
      height += wave * energy * 0.38;
      foam += pow(max(0.0, (wave - 0.2) / 0.8), 2.0) * energy * 0.8;
    }
    vec2 delta = p - a.xy;
    if (abs(delta.x) > a.z + travel + 16.0 || abs(delta.y) > a.w + travel + 16.0) continue;
    float distance = length(delta);
    if (distance < 0.001) continue;
    vec2 churn = vec2(delta.x / (a.z * 0.55 + age * 0.35), (delta.y - a.w * 0.85) / (5.0 + age * 0.65));
    foam += exp(-2.0 * dot(churn, churn)) * b.y * exp(-age / 5.0) * 0.15;
    if (b.z < 0.05) continue;
    float ellipseRadius = distance / length(delta / a.zw);
    float edge = distance - ellipseRadius;
    float band = (edge - travel) / 6.0;
    if (edge < 0.0 || abs(band) > 2.5) continue;
    float envelope = exp(-0.5 * band * band);
    float aft = 0.18 + 0.82 * soft((delta.y / distance + 0.15) / 0.9);
    float direction = aft + (1.0 - aft) * b.z * 0.7;
    float energy = b.y * fade * envelope * direction * b.z * 0.2;
    float wave = sin(c.x * edge - c.y * age + b.w);
    height += wave * energy * 0.38;
    foam += pow(max(0.0, (wave - 0.25) / 0.75), 2.0) * energy * 0.8;
  }
  float outside = 1.0;
  if (uHasSource) {
    vec2 delta = p - uSource.xy;
    float normalized = length(delta / uSource.zw);
    outside = soft((normalized - 0.96) / 0.14);
    float distance = length(delta);
    if (distance > 0.001 && normalized > 0.95 && uSourcePower > 0.0) {
      float edge = distance - distance / normalized;
      if (edge > 0.0 && edge < 22.0) {
        float front = soft((-delta.y / distance - 0.05) / 0.75);
        float crest = exp(-0.5 * pow((edge - 3.5) / 2.1, 2.0)) + 0.32 * exp(-0.5 * pow((edge - 12.0) / 2.7, 2.0));
        float broken = 0.8 + 0.2 * sin(delta.x * 0.21 + uTime * 0.9);
        height += crest * front * uSourcePower * 0.44 * broken;
        foam += crest * front * uSourcePower * 0.65 * broken;
      }
    }
  }
  float edgeFade = soft(min(min(p.x + 100.0, 100.0 - p.x), min(p.y + 90.0, 220.0 - p.y)) / 12.0);
  float breakup = 0.65 + 0.35 * sin(p.x * 0.37 + sin(p.y * 0.19)) * sin(p.y * 0.43 - uTime * 0.3);
  return vec2(clamp(height, -0.25, 0.7), clamp(foam * breakup, 0.0, 1.0)) * outside * edgeFade;
}
`;

export const wakeVertexShader = `
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec3 vViewPosition;
out vec3 vNormalView;
out vec2 vWaterPosition;
out vec2 vDisturbance;
${wakeFieldGLSL}
void main() {
  vec2 field = wakeField(position.xy);
  float stepSize = 0.45;
  float dx = (wakeField(position.xy + vec2(stepSize, 0.0)).x - field.x) / stepSize;
  float dy = (wakeField(position.xy + vec2(0.0, stepSize)).x - field.x) / stepSize;
  vec3 surface = vec3(position.xy, 0.07 + max(field.x, 0.0));
  vec4 viewPosition = modelViewMatrix * vec4(surface, 1.0);
  vViewPosition = viewPosition.xyz;
  vNormalView = normalize(normalMatrix * normalize(vec3(-dx, -dy, 1.0)));
  vWaterPosition = position.xy;
  vDisturbance = field;
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const wakeFragmentShader = `
precision highp float;
precision highp sampler2D;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform vec2 uProjectionScale;
uniform mat4 uInverseProjection;
uniform mat4 uViewToLocal;
uniform mat3 uLocalNormalToView;
uniform vec3 uFlatNormalView;
uniform vec3 uSunDirectionView;
uniform vec3 uSunDiffuse;
uniform vec3 uSunAmbient;
uniform float uTime;
in vec3 vViewPosition;
in vec3 vNormalView;
in vec2 vWaterPosition;
in vec2 vDisturbance;
out vec4 outColor;

vec3 scenePosition(vec2 uv) {
  float depth = texture(uSceneDepth, uv).r;
  vec4 point = uInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return point.xyz / point.w;
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), f.x),
    mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), f.x), f.y);
}
void main() {
  float energy = abs(vDisturbance.x) + vDisturbance.y * 0.4;
  float strength = smoothstep(0.002, 0.12, energy);
  if (strength < 0.001) discard;
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 backgroundPosition = scenePosition(uv);
  float surfaceDepth = -vViewPosition.z;
  if (-backgroundPosition.z + 0.03 + surfaceDepth * 0.00001 < surfaceDepth) discard;

  vec2 chop = vec2(
    sin(dot(vWaterPosition, vec2(0.63, 0.28)) - uTime * 1.7),
    cos(dot(vWaterPosition, vec2(-0.37, 0.81)) - uTime * 1.3)
  ) * 0.035 * strength;
  vec3 normalView = normalize(vNormalView + uLocalNormalToView * vec3(chop, 0.0));
  vec2 offset = (normalView.xy - uFlatNormalView.xy) * uProjectionScale *
    (3.0 / max(surfaceDepth, 10.0)) * strength;
  offset = clamp(offset, vec2(-0.015), vec2(0.015));
  vec2 displacedUV = clamp(uv + offset, vec2(0.001), vec2(0.999));
  vec3 displacedPosition = scenePosition(displacedUV);
  vec4 displacedLocal = uViewToLocal * vec4(displacedPosition, 1.0);
  bool waterSample = abs(displacedLocal.z / displacedLocal.w) < 0.35;
  vec4 base = texture(uSceneColor, uv);
  vec3 disturbed = waterSample ? texture(uSceneColor, displacedUV).rgb : base.rgb;
  vec3 color = mix(base.rgb, disturbed, strength * 0.9);

  vec3 viewDirection = normalize(-vViewPosition);
  vec3 light = normalize(uSunDirectionView);
  float sparkle = pow(max(0.0, dot(reflect(-light, normalView), viewDirection)), 80.0);
  color += uSunDiffuse * sparkle * strength * 0.1;
  float detail = noise(vWaterPosition * 0.8 + vec2(uTime * 0.07, -uTime * 0.035));
  detail = detail * 0.65 + noise(vWaterPosition * 2.3 - uTime * 0.04) * 0.35;
  float foam = clamp(sqrt(max(0.0, vDisturbance.y)) * smoothstep(0.18, 0.75, detail) * 1.3, 0.0, 0.85);
  float sceneShade = clamp(dot(base.rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.5 + 0.8, 0.8, 1.0);
  vec3 illumination = uSunAmbient + uSunDiffuse * max(0.0, dot(normalView, light));
  // This pass composites into the already display-referred scene color.
  vec3 foamColor = pow(vec3(0.86, 0.91, 0.93) * clamp(illumination, vec3(0.04), vec3(1.0)), vec3(1.0 / 2.2));
  color = mix(color, foamColor * sceneShade, foam);
  outColor = vec4(color, base.a);
}
`;
