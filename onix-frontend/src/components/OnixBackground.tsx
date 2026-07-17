import { useEffect, useRef } from 'react';

/**
 * Long thin ring + free-floating spheres (independent motion).
 * Solid gray/white shading — no point-cloud flicker.
 */
const vertexShader = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragmentShader = `
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_intensity;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float mapFigure(vec3 p, float t) {
  // Mild scene tilt — same composition, smoother sampling only
  vec3 q = p;
  q.yz *= rot(0.88);

  // —— RING only: own spin + stretch (balls do NOT use this frame) ——
  vec3 pr = q;
  pr.xz *= rot(t * 0.1 + 0.2);
  pr.xy *= rot(t * 0.04);
  pr.x *= 0.68;
  float d = sdTorus(pr, vec2(0.98, 0.04));

  // —— BALLS: free 3D paths, different heights / directions / speeds ——
  float tb = t;
  d = min(d, sdSphere(q - vec3( 0.95 * cos(tb*0.55+0.2),  0.55*sin(tb*0.7),      0.35*sin(tb*0.55+0.2)), 0.09));
  d = min(d, sdSphere(q - vec3(-0.85 * cos(tb*0.4+1.5),  -0.45*cos(tb*0.6),     0.55*sin(tb*0.4+1.5)), 0.08));
  d = min(d, sdSphere(q - vec3( 0.25 * cos(tb*0.9),        0.72*sin(tb*0.5+0.8),  0.9*cos(tb*0.35)),     0.075));
  d = min(d, sdSphere(q - vec3(-0.4  * sin(tb*0.65),      -0.7*sin(tb*0.45),    -0.75*cos(tb*0.5)),     0.07));
  d = min(d, sdSphere(q - vec3( 1.15 * cos(tb*-0.32+2.0),  0.15*sin(tb*1.1),     0.2*sin(tb*-0.32+2.0)), 0.085));
  d = min(d, sdSphere(q - vec3(-1.1  * cos(tb*0.28+3.2),   0.35*cos(tb*0.8),    -0.15*sin(tb*0.28+3.2)), 0.08));
  d = min(d, sdSphere(q - vec3( 0.55 * cos(tb*0.75+0.5),  -0.2+0.5*sin(tb*0.95), 0.65*sin(tb*0.75+0.5)), 0.065));
  d = min(d, sdSphere(q - vec3(-0.6  * cos(tb*-0.5+2.8),   0.4*sin(tb*0.55),    -0.5*cos(tb*-0.5+2.8)),  0.07));
  d = min(d, sdSphere(q - vec3( 0.1  * cos(tb*0.2),        0.85*cos(tb*0.4),     0.15*sin(tb*1.2)),      0.06));
  d = min(d, sdSphere(q - vec3( 0.7  * sin(tb*0.48+1.0),  -0.55*cos(tb*0.7),    -0.35*sin(tb*0.48+1.0)), 0.055));

  return d;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  uv *= 0.92;
  uv += (u_pointer - 0.5) * 0.02;

  float t = u_time * 0.38;
  float camA = t * 0.12;
  vec3 ro = vec3(sin(camA) * 2.7, 0.85 + 0.05 * sin(t * 0.28), cos(camA) * 2.7);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.52 * ww);

  float travel = 0.0;
  float hit = -1.0;
  vec3 p = ro;
  // More steps + tighter epsilon → smoother surfaces (less faceted look)
  for (int i = 0; i < 160; i++) {
    p = ro + rd * travel;
    float d = mapFigure(p, t);
    if (d < 0.00035) { hit = travel; break; }
    if (travel > 10.0) break;
    travel += clamp(d * 0.78, 0.002, 0.22);
  }

  // Solid soft gray / white — no mesh, no flicker
  vec3 gray = vec3(0.72, 0.74, 0.76);
  vec3 white = vec3(0.9, 0.91, 0.92);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (hit > 0.0) {
    vec2 e = vec2(0.0012, 0.0);
    vec3 n = normalize(vec3(
      mapFigure(p + e.xyy, t) - mapFigure(p - e.xyy, t),
      mapFigure(p + e.yxy, t) - mapFigure(p - e.yxy, t),
      mapFigure(p + e.yyx, t) - mapFigure(p - e.yyx, t)
    ));

    vec3 l1 = normalize(vec3(0.4, 0.9, 0.3));
    vec3 l2 = normalize(vec3(-0.55, 0.35, 0.7));
    float diff = 0.28 + 0.52 * max(dot(n, l1), 0.0) + 0.22 * max(dot(n, l2), 0.0);
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.6);
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 4.0);

    // Cheap AO from a few normal offsets — softens hard edges
    float ao = 0.0;
    ao += max(mapFigure(p + n * 0.02, t), 0.0);
    ao += max(mapFigure(p + n * 0.05, t), 0.0);
    ao = clamp(ao * 8.0, 0.0, 1.0);
    float shade = mix(0.72, 1.0, ao);

    col = mix(gray, white, diff * 0.55 + fres * 0.32 + rim * 0.12) * shade;
    alpha = clamp(0.58 + fres * 0.28, 0.0, 0.9);
  }

  // Soft halo (denser samples for smoother glow)
  float aura = 0.0;
  travel = 0.0;
  for (int j = 0; j < 20; j++) {
    p = ro + rd * travel;
    float d = abs(mapFigure(p, t));
    aura += exp(-d * 12.0) * 0.011;
    travel += 0.11;
  }
  col += gray * aura * 0.55;
  alpha = max(alpha, clamp(aura * 0.95, 0.0, 0.18));

  float vig = smoothstep(1.88, 0.26, length(uv * vec2(1.0, 1.05)));
  col *= vig;
  alpha *= vig * u_intensity;

  gl_FragColor = vec4(col * u_intensity, clamp(alpha, 0.0, 0.9));
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
  const modeRef = useRef(mode);
  modeRef.current = mode;

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
    // Higher pixel density → less jagged silhouettes; still capped for mobile cost.
    const quality = Math.min(devicePixelRatio, innerWidth < 640 ? 1.15 : 1.75);
    let currentIntensity = 1;
    let lastPaint = 0;
    const minFrameMs = innerWidth < 640 ? 1000 / 28 : 1000 / 40;

    const targetForMode = () => {
      if (document.body.classList.contains('modal-open')) return 0.35;
      const m = modeRef.current;
      return m === 'chat' ? 0.55 : m === 'focus' ? 0.75 : 0.9;
    };

    const shouldRun = () => running && !document.hidden;

    const render = (now: number) => {
      if (!shouldRun()) return;
      if (now - lastPaint < minFrameMs) {
        frame = requestAnimationFrame(render);
        return;
      }
      lastPaint = now;

      const width = Math.floor(canvas.clientWidth * quality);
      const height = Math.floor(canvas.clientHeight * quality);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      const targetIntensity = targetForMode();
      currentIntensity += (targetIntensity - currentIntensity) * 0.08;

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

    const kick = () => {
      cancelAnimationFrame(frame);
      if (shouldRun()) frame = requestAnimationFrame(render);
    };

    const onVisibility = () => {
      running = !document.hidden;
      kick();
    };

    const modalObserver = new MutationObserver(kick);
    modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      modalObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('pointermove', move);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return <canvas ref={ref} className="onix-background" aria-hidden="true" />;
}
