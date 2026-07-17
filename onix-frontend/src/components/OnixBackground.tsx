import { useEffect, useRef } from 'react';

/**
 * Screenshot background only:
 * organic ring + spheres, dense pale-cyan point-cloud mesh on black.
 */
const vertexShader = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragmentShader = `
precision mediump float;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_intensity;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float mapFigure(vec3 p, float t) {
  p.yz *= rot(0.88);

  float ringSpin = t * 0.08;
  float stretchX = 0.68;

  // Shared spin frame (no stretch yet)
  vec3 frame = p;
  frame.xz *= rot(ringSpin + 0.2);
  frame.xy *= rot(t * 0.05);

  // Ring only gets horizontal stretch → long thin ellipse
  vec3 pr = frame;
  pr.x *= stretchX;
  float d = sdTorus(pr, vec2(0.98, 0.042));

  // Round balls scattered ON the ellipse (not in the center), own drift
  float tb = t * 0.65;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 0.5235988 + tb * 0.2 + fi * 0.04;
    float R = 0.98;
    // Ellipse matching stretched torus; spheres stay round (no stretch on sdSphere)
    vec3 c = vec3(cos(a) * (R / stretchX), 0.06 * sin(tb * 1.2 + fi * 1.4), sin(a) * R);
    // Drift along the ring independently of ring spin
    c += vec3(-sin(a), 0.0, cos(a)) * (0.14 * sin(tb * 0.9 + fi * 2.2));
    c.y += 0.05 * cos(tb * 0.7 + fi);
    float rad = 0.038 + 0.028 * fract(sin(fi * 12.9898) * 43758.5453);
    if (i == 3 || i == 8) rad *= 1.55;
    d = min(d, sdSphere(frame - c, rad));
  }

  return d;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  // Smaller on screen — not oversized
  uv *= 0.92;
  uv += (u_pointer - 0.5) * 0.02;

  float t = u_time * 0.38;
  float camA = t * 0.13;
  // Pull camera back — figure reads smaller / lighter like the ideal shot
  vec3 ro = vec3(sin(camA) * 2.7, 0.85 + 0.05 * sin(t * 0.28), cos(camA) * 2.7);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.52 * ww);

  float travel = 0.0;
  float hit = -1.0;
  vec3 p = ro;
  for (int i = 0; i < 96; i++) {
    p = ro + rd * travel;
    float d = mapFigure(p, t);
    if (d < 0.001) { hit = travel; break; }
    if (travel > 10.0) break;
    travel += max(d * 0.62, 0.005);
  }

  // Icy cyan like the ideal shot (~#A0D0D8)
  vec3 glow = vec3(0.627, 0.816, 0.847);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (hit > 0.0) {
    vec2 e = vec2(0.0028, 0.0);
    vec3 n = normalize(vec3(
      mapFigure(p + e.xyy, t) - mapFigure(p - e.xyy, t),
      mapFigure(p + e.yxy, t) - mapFigure(p - e.yxy, t),
      mapFigure(p + e.yyx, t) - mapFigure(p - e.yyx, t)
    ));

    float lat = acos(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);

    // Sharper contours
    float c1 = abs(fract(lat * 16.0) - 0.5);
    float c2 = abs(fract(lon * 12.0 / 3.14159265) - 0.5);
    float lines = 1.0 - smoothstep(0.0, 0.022, min(c1, c2));

    // Crisper point cloud
    vec2 cellA = floor(vec2(lon, lat) * vec2(80.0, 54.0));
    float dots = step(0.48, hash(cellA));
    float dots2 = step(0.62, hash3(floor(p * 44.0)));
    float pattern = max(lines, max(dots * 0.8, dots2 * 0.5));

    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.6);
    col = glow * pattern * (0.9 + fres * 0.3);
    col += glow * fres * 0.08;

    alpha = clamp(pattern * 0.9 + fres * 0.1, 0.0, 0.92);
  }

  float aura = 0.0;
  travel = 0.0;
  for (int j = 0; j < 14; j++) {
    p = ro + rd * travel;
    float d = abs(mapFigure(p, t));
    aura += exp(-d * 12.0) * 0.015;
    travel += 0.14;
  }
  col += glow * aura * 0.55;
  alpha = max(alpha, clamp(aura * 1.05, 0.0, 0.18));

  float vig = smoothstep(1.88, 0.26, length(uv * vec2(1.0, 1.05)));
  col *= vig;
  alpha *= vig * u_intensity;

  gl_FragColor = vec4(col * u_intensity, clamp(alpha, 0.0, 0.92));
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function OnixBackground({ mode }: { mode: 'normal' | 'focus' | 'chat' }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    if (!gl) {
      canvas.dataset.fallback = 'true';
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      canvas.dataset.fallback = 'true';
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.dataset.fallback = 'true';
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, 'u_resolution');
    const pointerUniform = gl.getUniformLocation(program, 'u_pointer');
    const time = gl.getUniformLocation(program, 'u_time');
    const intensity = gl.getUniformLocation(program, 'u_intensity');

    const pointer = { x: 0.5, y: 0.5 };
    const move = (event: PointerEvent) => {
      pointer.x = event.clientX / innerWidth;
      pointer.y = 1 - event.clientY / innerHeight;
    };
    addEventListener('pointermove', move, { passive: true });

    let frame = 0;
    let running = !document.hidden;
    const started = performance.now();
    const quality = Math.min(devicePixelRatio, innerWidth < 640 ? 1.2 : 1.6);
    const targetIntensity = mode === 'chat' ? 0.7 : mode === 'focus' ? 0.88 : 1.0;
    let currentIntensity = targetIntensity;

    const render = (now: number) => {
      if (!running) return;
      const width = Math.floor(canvas.clientWidth * quality);
      const height = Math.floor(canvas.clientHeight * quality);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      currentIntensity += (targetIntensity - currentIntensity) * 0.06;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(resolution, width, height);
      gl.uniform2f(pointerUniform, pointer.x, pointer.y);
      const elapsed = (now - started) / 1000;
      gl.uniform1f(time, reduced ? elapsed * 0.18 : elapsed);
      gl.uniform1f(intensity, currentIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frame = requestAnimationFrame(render);
    };

    const onVisibility = () => {
      running = !document.hidden;
      if (running) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(frame);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('pointermove', move);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [mode]);

  return <canvas ref={ref} className="onix-background" aria-hidden="true" />;
}
