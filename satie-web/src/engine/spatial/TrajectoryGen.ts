/**
 * Trajectory generation via Claude API.
 * Produces JavaScript code that generates a Float32Array LUT for spatial trajectories.
 */

const TRAJECTORY_GEN_SYSTEM_PROMPT = `You are a spatial trajectory designer for a 3D audio spatialization engine.

Given a behavioral description, output ONLY a JSON object with:
- "name": a short lowercase slug (1-3 words, underscores, no spaces). Examples: "bird_flight", "rossler_attractor", "falling_leaf"
- "code": a JavaScript function body that returns a Float32Array of interleaved [x,y,z,x,y,z,...] positions, normalized to [0,1] range.

The function receives these parameters:
- SIZE: number of points to generate (provided, typically 8192)
- SEED: integer random seed for reproducibility (0 = use any seed)
- Math: standard Math object

The code MUST:
1. Create a Float32Array of length SIZE * 3
2. Fill it with normalized [0,1] xyz positions
3. Return the array
4. Be self-contained (no imports, no external dependencies)
5. Produce smooth, interesting motion that matches the description
6. Use the provided SEED for any randomness (deterministic when SEED > 0)

BEHAVIORAL TRAJECTORIES (not just math):
- You can simulate state machines (fly, pause, fly again)
- Use noise/randomness with a seed for reproducibility
- Encode acceleration, deceleration, pauses
- Mix multiple behaviors across the timeline
- For attractors, use proper numerical integration (RK4)
- Always normalize output to [0,1] per axis at the end

The user may also provide these parameters:
- duration: cycle length in seconds (affects how many simulation steps per point)
- smoothing: 0-1, how much to smooth the path (apply moving average if > 0)
- ground: if true, constrain Y to 0 (ground plane movement only)
- variation: 0-1, how much speed varies (0=constant velocity, 1=lots of pauses and bursts)

Incorporate these parameters naturally into the generated code.

STRICT RULES:
- Output ONLY the JSON object, nothing else
- No markdown, no explanation
- The code must be valid JS that can be passed to new Function('SIZE', 'SEED', 'Math', code)
- Always normalize to [0,1] at the end

Example for a simple orbit:
{"name":"orbit","code":"const out = new Float32Array(SIZE * 3);\\nfor (let i = 0; i < SIZE; i++) {\\n  const t = i / SIZE * Math.PI * 2;\\n  out[i*3] = (Math.cos(t) + 1) * 0.5;\\n  out[i*3+1] = 0.5;\\n  out[i*3+2] = (Math.sin(t) + 1) * 0.5;\\n}\\nreturn out;"}

Example for a bird that perches:
{"name":"bird_flight","code":"const out = new Float32Array(SIZE * 3);\\nlet x=0.5,y=0.7,z=0.5,vx=0,vy=0,vz=0;\\nlet state='fly',timer=0;\\nlet s=SEED||42;\\nfunction rand(){s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;}\\nfor(let i=0;i<SIZE;i++){\\ntimer--;\\nif(timer<=0){state=rand()>0.7?'perch':'fly';timer=Math.floor(rand()*800+200);}\\nif(state==='fly'){vx+=(rand()-0.5)*0.002;vy+=(rand()-0.5)*0.001;vz+=(rand()-0.5)*0.002;vx*=0.99;vy*=0.99;vz*=0.99;x+=vx;y+=vy;z+=vz;}else{vx*=0.95;vy*=0.95;vz*=0.95;x+=vx;y+=vy;z+=vz;}\\nx=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));z=Math.max(0,Math.min(1,z));\\nout[i*3]=x;out[i*3+1]=y;out[i*3+2]=z;}\\nreturn out;"}`;

const ORCHESTRATOR_MODEL = 'claude-sonnet-4-20250514';

export interface TrajectorySpec {
  name: string;
  code: string;
}

export interface TrajectoryGenParams {
  duration?: number;
  resolution?: number;
  smoothing?: number;
  seed?: number;
  ground?: boolean;
  variation?: number;
}

export async function generateTrajectoryFromPrompt(
  apiKey: string,
  userPrompt: string,
  params?: TrajectoryGenParams,
): Promise<TrajectorySpec> {
  // Build enriched prompt with parameters
  let enriched = userPrompt;
  if (params) {
    const parts: string[] = [];
    if (params.duration !== undefined && params.duration !== 30) parts.push(`duration: ${params.duration}s`);
    if (params.resolution !== undefined && params.resolution !== 8192) parts.push(`resolution: ${params.resolution} points`);
    if (params.smoothing !== undefined && params.smoothing > 0) parts.push(`smoothing: ${params.smoothing}`);
    if (params.seed !== undefined && params.seed > 0) parts.push(`seed: ${params.seed}`);
    if (params.ground) parts.push('ground: constrain to Y=0 ground plane');
    if (params.variation !== undefined && params.variation !== 0.5) parts.push(`variation: ${params.variation} (0=constant, 1=very dynamic)`);
    if (parts.length > 0) {
      enriched += `\n\nParameters: ${parts.join(', ')}`;
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: ORCHESTRATOR_MODEL,
      max_tokens: 2048,
      system: TRAJECTORY_GEN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: enriched }],
    }),
  });

  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await response.json();
  const raw = data.content?.[0]?.text ?? '';
  const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    name: String(parsed.name ?? 'trajectory').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    code: String(parsed.code),
  };
}

/**
 * Execute trajectory code and return the Float32Array LUT.
 * Runs in a sandboxed Function constructor.
 */
export function executeTrajectoryCode(code: string, size: number = 8192, seed: number = 0): Float32Array {
  const fn = new Function('SIZE', 'SEED', 'Math', code) as (size: number, seed: number, math: Math) => Float32Array;
  const points = fn(size, seed, Math);

  if (!(points instanceof Float32Array) || points.length !== size * 3) {
    throw new Error(`Trajectory code must return Float32Array of ${size * 3} elements, got ${points?.length}`);
  }

  return points;
}

/**
 * Post-process a trajectory LUT: apply smoothing and ground constraint.
 */
export function postProcessTrajectory(
  points: Float32Array,
  pointCount: number,
  smoothing: number,
  ground: boolean,
): Float32Array {
  let result = points;

  // Apply moving average smoothing
  if (smoothing > 0) {
    const windowSize = Math.max(1, Math.floor(smoothing * 64));
    const smoothed = new Float32Array(result.length);
    for (let i = 0; i < pointCount; i++) {
      let sx = 0, sy = 0, sz = 0, count = 0;
      for (let j = -windowSize; j <= windowSize; j++) {
        const idx = ((i + j) % pointCount + pointCount) % pointCount;
        sx += result[idx * 3];
        sy += result[idx * 3 + 1];
        sz += result[idx * 3 + 2];
        count++;
      }
      smoothed[i * 3] = sx / count;
      smoothed[i * 3 + 1] = sy / count;
      smoothed[i * 3 + 2] = sz / count;
    }
    result = smoothed;
  }

  // Constrain to ground plane
  if (ground) {
    for (let i = 0; i < pointCount; i++) {
      result[i * 3 + 1] = 0;
    }
  }

  return result;
}
