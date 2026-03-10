import { useRef, useEffect, useCallback, useState, useMemo, memo, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Trail } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { TrackState } from '../../engine';

const ViewportFocusContext = createContext<{ focused: boolean }>({ focused: false });

interface SpatialViewportProps {
  tracksRef: React.RefObject<TrackState[]>;
  bgColor?: string;
  onBgColorChange?: (color: string) => void;
}

function BgColorUpdater({ color }: { color: string }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.setClearColor(color, 1);
  }, [gl, color]);
  return null;
}

/**
 * Individual audio source with Trail.
 * Reads track state from ref — no React re-render needed for position/color updates.
 */
/** Shared mesh + useFrame logic for a single voice */
function useAudioSourceFrame(
  trackRef: React.RefObject<TrackState | null>,
  meshRef: React.RefObject<THREE.Mesh | null>,
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>,
  labelRef: React.RefObject<THREE.Sprite | null>,
  trailMatRef?: React.RefObject<THREE.MeshStandardMaterial | null>,
) {
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const prevLabel = useRef<string>('');

  useFrame(() => {
    const track = trackRef.current;
    if (!track || !meshRef.current) return;

    meshRef.current.position.set(track.position.x, track.position.y, track.position.z);
    const scale = 0.12 + track.volume * 0.2;
    meshRef.current.scale.setScalar(scale);

    if (matRef.current) {
      matRef.current.color.set(track.color);
      matRef.current.emissive.set(track.color);
      matRef.current.opacity = track.alpha * 0.8;
    }

    // Keep trail material color in sync with the track color
    if (trailMatRef?.current) {
      trailMatRef.current.color.set(track.color);
      trailMatRef.current.emissive.set(track.color);
    }

    if (labelRef.current) {
      labelRef.current.position.set(track.position.x, track.position.y + 0.4, track.position.z);

      const label = track.statement.clip.split('/').pop() ?? '';
      if (label !== prevLabel.current) {
        prevLabel.current = label;
        if (labelTexRef.current) labelTexRef.current.dispose();
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 32;
        const ctx = canvas.getContext('2d')!;
        ctx.font = '18px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(26, 58, 42, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText(label, 128, 22);
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        labelTexRef.current = tex;
        (labelRef.current.material as THREE.SpriteMaterial).map = tex;
        (labelRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }
  });
}

/** Voice WITH trail — only used when statement has `visual trail` */
function AudioSourceWithTrail({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);
  const trailRef = useRef<any>(null);

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  // Update trail ribbon material color each frame
  useFrame(() => {
    const track = trackRef.current;
    if (!track || !trailRef.current) return;
    const mat = trailRef.current.material as any;
    if (mat?.uniforms?.color) {
      // MeshLineMaterial uses uniforms.color
      mat.uniforms.color.value.set(track.color);
    } else if (mat?.color) {
      mat.color.set(track.color);
    }
  });

  return (
    <>
      <Trail
        ref={trailRef}
        width={2.5}
        length={80}
        decay={1}
        attenuation={(w) => w * w}
      >
        <mesh ref={meshRef}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial
            ref={matRef}
            emissiveIntensity={0.3}
            transparent
            opacity={0.8}
            roughness={0.6}
            wireframe
          />
        </mesh>
      </Trail>
      <sprite ref={labelRef} scale={[1.2, 0.15, 1]}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </>
  );
}

/** Voice WITHOUT trail — default rendering */
function AudioSourceNoTrail({ trackRef }: { trackRef: React.RefObject<TrackState | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<THREE.Sprite>(null);

  useAudioSourceFrame(trackRef, meshRef, matRef, labelRef);

  return (
    <>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          ref={matRef}
          emissiveIntensity={0.3}
          transparent
          opacity={0.8}
          roughness={0.6}
          wireframe
        />
      </mesh>
      <sprite ref={labelRef} scale={[1.2, 0.15, 1]}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </>
  );
}

/**
 * Manages a pool of AudioSource components that read from tracksRef.
 * Uses a fixed pool to avoid mount/unmount churn.
 */
const MAX_VOICES = 128;

function AudioSourcePool({ tracksRef }: { tracksRef: React.RefObject<TrackState[]> }) {
  // Pool of refs — each AudioSource reads from its assigned ref
  const trackRefs = useMemo(() => {
    const refs: React.RefObject<TrackState | null>[] = [];
    for (let i = 0; i < MAX_VOICES; i++) {
      refs.push({ current: null });
    }
    return refs;
  }, []);

  // Track which slots have trail — encoded as a string to minimize re-renders
  const [slotInfo, setSlotInfo] = useState<{ count: number; trailFlags: boolean[] }>({ count: 0, trailFlags: [] });

  useFrame(() => {
    const tracks = tracksRef.current ?? [];
    const count = Math.min(tracks.length, MAX_VOICES);

    // Update refs in-place — no React state change needed for position/color
    for (let i = 0; i < count; i++) {
      (trackRefs[i] as { current: TrackState | null }).current = tracks[i];
    }
    for (let i = count; i < MAX_VOICES; i++) {
      (trackRefs[i] as { current: TrackState | null }).current = null;
    }

    // Only trigger React re-render when voice count or trail configuration changes
    let needsUpdate = count !== slotInfo.count;
    if (!needsUpdate) {
      for (let i = 0; i < count; i++) {
        const hasTrail = tracks[i].statement.visual.includes('trail');
        if (hasTrail !== slotInfo.trailFlags[i]) {
          needsUpdate = true;
          break;
        }
      }
    }

    if (needsUpdate) {
      const trailFlags: boolean[] = [];
      for (let i = 0; i < count; i++) {
        trailFlags.push(tracks[i].statement.visual.includes('trail'));
      }
      setSlotInfo({ count, trailFlags });
    }
  });

  return (
    <>
      {trackRefs.slice(0, slotInfo.count).map((ref, i) =>
        slotInfo.trailFlags[i]
          ? <AudioSourceWithTrail key={i} trackRef={ref} />
          : <AudioSourceNoTrail key={i} trackRef={ref} />
      )}
    </>
  );
}

function Listener() {
  return (
    <mesh position={[0, 0, 0]}>
      <octahedronGeometry args={[0.1]} />
      <meshStandardMaterial color="#8b0000" emissive="#8b0000" emissiveIntensity={0.5} roughness={0.5} />
    </mesh>
  );
}

// Unity-style fly camera: WASD when viewport focused
function FlyControls() {
  const { camera, gl } = useThree();
  const { focused } = useContext(ViewportFocusContext);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const keysDown = useRef(new Set<string>());
  const rightMouseDown = useRef(false);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const flySpeed = 5;

  // Pre-allocated vectors to avoid GC pressure in useFrame
  const _forward = useMemo(() => new THREE.Vector3(), []);
  const _right = useMemo(() => new THREE.Vector3(), []);
  const _move = useMemo(() => new THREE.Vector3(), []);
  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const MOVE_KEYS = useMemo(() => new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']), []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysDown.current.add(key);
    if (focusedRef.current && MOVE_KEYS.has(key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [MOVE_KEYS]);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keysDown.current.delete(e.key.toLowerCase());
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 2) rightMouseDown.current = true;
  }, []);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 2) rightMouseDown.current = false;
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl, onKeyDown, onKeyUp, onMouseDown, onMouseUp]);

  useEffect(() => {
    if (!focused) keysDown.current.clear();
  }, [focused]);

  useFrame((_, delta) => {
    const active = focused || rightMouseDown.current;
    if (!active) return;

    const keys = keysDown.current;
    if (keys.size === 0) return;
    const speed = delta * flySpeed;

    camera.getWorldDirection(_forward);
    _right.crossVectors(_forward, _up).normalize();
    _move.set(0, 0, 0);

    if (keys.has('w') || keys.has('arrowup')) _move.addScaledVector(_forward, speed);
    if (keys.has('s') || keys.has('arrowdown')) _move.addScaledVector(_forward, -speed);
    if (keys.has('a') || keys.has('arrowleft')) _move.addScaledVector(_right, -speed);
    if (keys.has('d') || keys.has('arrowright')) _move.addScaledVector(_right, speed);
    if (keys.has('e') || keys.has(' ')) _move.y += speed;
    if (keys.has('q')) _move.y -= speed;

    if (_move.lengthSq() > 0) {
      camera.position.add(_move);
      if (controlsRef.current) {
        controlsRef.current.target.add(_move);
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.05}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
    />
  );
}

const SceneInner = memo(function SceneInner({ tracksRef }: { tracksRef: React.RefObject<TrackState[]> }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 15, 10]} intensity={0.3} />
      <Grid
        args={[20, 20]}
        cellColor="#e0ddd4"
        sectionColor="#d0cdc4"
        fadeDistance={25}
        infiniteGrid
      />
      <Listener />
      <AudioSourcePool tracksRef={tracksRef} />
      <FlyControls />
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.4}
          luminanceSmoothing={0.9}
          intensity={0.6}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
});

export const SpatialViewport = memo(function SpatialViewport({ tracksRef, bgColor = '#f4f3ee', onBgColorChange }: SpatialViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        setFocused(true);
      } else {
        setFocused(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocused(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const focusValue = useMemo(() => ({ focused }), [focused]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        overflow: 'hidden',
        outline: focused ? '2px solid #1a3a2a' : 'none',
        outlineOffset: '-2px',
        position: 'relative',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        camera={{ position: [4, 6, 8], fov: 55 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(bgColor, 1);
        }}
      >
        <BgColorUpdater color={bgColor} />
        <ViewportFocusContext.Provider value={focusValue}>
          <SceneInner tracksRef={tracksRef} />
        </ViewportFocusContext.Provider>
      </Canvas>
      {onBgColorChange && (
        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10 }}>
          <div
            onClick={() => setShowPicker(!showPicker)}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: bgColor,
              border: '1.5px solid rgba(0,0,0,0.15)',
              cursor: 'pointer',
            }}
          />
          {showPicker && (
            <div style={{
              position: 'absolute',
              bottom: 28,
              right: 0,
              background: '#fff',
              borderRadius: 6,
              padding: 8,
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            }}>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => onBgColorChange(e.target.value)}
                style={{ width: 48, height: 32, border: 'none', cursor: 'pointer', padding: 0 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
