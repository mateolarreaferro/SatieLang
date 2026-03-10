import { useRef, useEffect, useCallback, useState, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Html, Trail } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { TrackState } from '../../engine';

const ViewportFocusContext = createContext<{ focused: boolean }>({ focused: false });

interface SpatialViewportProps {
  tracks: TrackState[];
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

function AudioSource({ track }: { track: TrackState }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.set(track.position.x, track.position.y, track.position.z);
      const scale = 0.12 + track.volume * 0.2;
      meshRef.current.scale.setScalar(scale);
    }
    if (matRef.current) {
      matRef.current.color.set(track.color);
      matRef.current.emissive.set(track.color);
      matRef.current.opacity = track.alpha * 0.8;
    }
  });

  return (
    <>
      <Trail
        width={2.5}
        length={80}
        decay={1}
        attenuation={(w) => w * w}
        color={track.color}
      >
        <mesh ref={meshRef}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial
            ref={matRef}
            color={track.color}
            emissive={track.color}
            emissiveIntensity={0.3}
            transparent
            opacity={track.alpha * 0.8}
            roughness={0.6}
          />
        </mesh>
      </Trail>
      <Html
        position={[track.position.x, track.position.y + 0.4, track.position.z]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div style={{
          color: '#1a3a2a',
          fontSize: '9px',
          fontFamily: "'Inter', system-ui, sans-serif",
          whiteSpace: 'nowrap',
          opacity: 0.5,
        }}>
          {track.statement.clip.split('/').pop()}
        </div>
      </Html>
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

// Unity-style fly camera: WASD when viewport focused, right-click also works
function FlyControls() {
  const { camera, gl } = useThree();
  const { focused } = useContext(ViewportFocusContext);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const keysDown = useRef(new Set<string>());
  const rightMouseDown = useRef(false);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const flySpeed = 5;

  const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysDown.current.add(key);
    if (focusedRef.current && MOVE_KEYS.has(key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

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

  // Clear keys when losing focus to prevent stuck keys
  useEffect(() => {
    if (!focused) keysDown.current.clear();
  }, [focused]);

  useFrame((_, delta) => {
    const active = focused || rightMouseDown.current;
    if (!active) return;

    const keys = keysDown.current;
    const speed = delta * flySpeed;
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(forward);
    right.crossVectors(forward, up).normalize();

    const move = new THREE.Vector3();

    if (keys.has('w') || keys.has('arrowup')) move.add(forward.clone().multiplyScalar(speed));
    if (keys.has('s') || keys.has('arrowdown')) move.add(forward.clone().multiplyScalar(-speed));
    if (keys.has('a') || keys.has('arrowleft')) move.add(right.clone().multiplyScalar(-speed));
    if (keys.has('d') || keys.has('arrowright')) move.add(right.clone().multiplyScalar(speed));
    if (keys.has('e') || keys.has(' ')) move.y += speed;
    if (keys.has('q')) move.y -= speed;

    if (move.lengthSq() > 0) {
      camera.position.add(move);
      if (controlsRef.current) {
        controlsRef.current.target.add(move);
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

function Scene({ tracks }: { tracks: TrackState[] }) {
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
      {tracks.map((track) => (
        <AudioSource key={track.key} track={track} />
      ))}
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
}

export function SpatialViewport({ tracks, bgColor = '#f4f3ee', onBgColorChange }: SpatialViewportProps) {
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
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ gl }) => {
          gl.setClearColor(bgColor, 1);
        }}
      >
        <BgColorUpdater color={bgColor} />
        <ViewportFocusContext.Provider value={{ focused }}>
          <Scene tracks={tracks} />
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
}
