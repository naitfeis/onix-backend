import { useEffect, useRef } from 'react';

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
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  uv += (u_pointer - 0.5) * 0.08;
  float t = u_time * 0.12;
  vec3 ray = normalize(vec3(uv, 1.55));
  float glow = 0.0;
  for (int i = 0; i < 5; i++) {
    float z = float(i) * 0.38 + 0.6;
    vec3 p = ray * z;
    p.xy *= mat2(cos(t + z), -sin(t + z), sin(t + z), cos(t + z));
    float shape = abs(length(p.xy) - (0.34 + sin(atan(p.y, p.x) * 5.0 + t) * 0.055));
    glow += 0.0035 / max(shape, 0.002);
  }
  float grid = smoothstep(0.035, 0.0, abs(fract((uv.x + uv.y + t * 0.08) * 7.0) - 0.5));
  vec3 color = vec3(0.15, 0.78, 0.92) * glow + vec3(0.32, 0.22, 0.8) * grid * 0.035;
  gl_FragColor = vec4(color * u_intensity, clamp((glow + grid * 0.08) * u_intensity, 0.0, 0.32));
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
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) {
      canvas.dataset.fallback = 'true';
      return;
    }
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
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
    const started = performance.now();
    const quality = Math.min(devicePixelRatio, innerWidth < 640 ? 1 : 1.4);
    const render = (now: number) => {
      const width = Math.floor(canvas.clientWidth * quality);
      const height = Math.floor(canvas.clientHeight * quality);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(resolution, width, height);
      gl.uniform2f(pointerUniform, pointer.x, pointer.y);
      gl.uniform1f(time, reduced ? 0 : (now - started) / 1000);
      gl.uniform1f(intensity, mode === 'chat' ? 0.22 : mode === 'focus' ? 0.08 : 0.72);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduced) frame = requestAnimationFrame(render);
    };
    render(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('pointermove', move);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [mode]);
  return <canvas ref={ref} className="onix-background" aria-hidden="true" />;
}
