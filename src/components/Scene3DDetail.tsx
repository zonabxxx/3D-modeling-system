'use client';

/**
 * Scene3DDetail – izolované 3D písmená/logo bez fasády
 * Voľný orbit (360°) pre detailný pohľad na tvar, profil, bočnice, LED
 */

import React, { Suspense, useRef, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Text3D,
  Center,
  Text,
} from '@react-three/drei';
import * as THREE from 'three';
import { useConfiguratorStore } from '@/stores/configurator-store';

const FONT_PATH = '/fonts/helvetiker_bold.typeface.json';

/**
 * Safe wrapper for Text3D – handles Turbopack HMR edge case where
 * Text3D import binding becomes undefined during hot module replacement.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SafeText3D(props: any) {
  try {
    if (typeof Text3D === 'undefined' || !Text3D) return null;
    return <Text3D {...props} />;
  } catch {
    console.warn('[Scene3DDetail] Text3D is not available (HMR reload). Refresh the page.');
    return null;
  }
}

// ──────────────────────────────────────────────
// Loader
// ──────────────────────────────────────────────

function DetailLoader() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 1.5;
  });
  return (
    <group>
      <mesh ref={ref}>
        <torusGeometry args={[0.4, 0.1, 8, 32]} />
        <meshStandardMaterial color="#f59e0b" wireframe />
      </mesh>
      <Text position={[0, -1, 0]} fontSize={0.12} color="#666" anchorX="center" anchorY="middle">
        Načítavam detail...
      </Text>
    </group>
  );
}

// ──────────────────────────────────────────────
// Error Boundary
// ──────────────────────────────────────────────

class DetailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-[#0f0f0f] rounded-2xl min-h-[400px]">
          <div className="text-center p-8">
            <div className="text-5xl mb-4">⚠️</div>
            <p className="text-white font-medium mb-2">3D detail sa nepodarilo načítať</p>
            <p className="text-slate-500 text-sm mb-4">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700"
            >
              ↻ Skúsiť znova
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ──────────────────────────────────────────────
// Detail Letters (3D extrudované) + osvetlenie
// ──────────────────────────────────────────────

function DetailLetters() {
  const text = useConfiguratorStore((s) => s.text) || 'ADSUN';
  const faceColor = useConfiguratorStore((s) => s.faceColor);
  const sideColor = useConfiguratorStore((s) => s.sideColor);
  const rawDepthMm = useConfiguratorStore((s) => s.depthMm);
  const profileType = useConfiguratorStore((s) => s.profileType);
  const computed = useConfiguratorStore((s) => s.computed);
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const ledColor = useConfiguratorStore((s) => s.ledColor);

  const safeDepthMm = (!rawDepthMm || isNaN(rawDepthMm) || rawDepthMm < 20) ? 50 : rawDepthMm;
  const safeLetterHeightMm = (!computed.letterHeightMm || isNaN(computed.letterHeightMm) || computed.letterHeightMm < 10) ? 200 : computed.letterHeightMm;

  const letterHeight = Math.max(safeLetterHeightMm, 50) / 250;
  const extrudeDepth = Math.max(safeDepthMm, 20) / 250;

  const bevelEnabled = profileType !== 'flat';
  const bevelSize = profileType === 'rounded' ? 0.02 : profileType === 'chamfer' ? 0.015 : 0;
  const bevelThickness = bevelSize * 0.8;

  const isFrontLit = lightingType === 'front' || lightingType === 'front_halo';
  const isHalo = lightingType === 'halo' || lightingType === 'front_halo';

  const ledHex = ledColor === 'cool_white' ? '#e0eaff' : ledColor === 'rgb' ? '#ff6b9d' : '#fff3cd';
  const ledHexBright = ledColor === 'cool_white' ? '#c8daff' : ledColor === 'rgb' ? '#ff4080' : '#ffeaa7';
  const ledHexSoft = ledColor === 'cool_white' ? '#a0b8ff' : ledColor === 'rgb' ? '#ff2060' : '#ffd700';
  const textWidth = text.length * letterHeight * 0.65;

  return (
    <group>
      <Center>
        <SafeText3D
          font={FONT_PATH}
          size={letterHeight}
          height={extrudeDepth}
          bevelEnabled={bevelEnabled}
          bevelThickness={Math.min(bevelThickness, 0.04)}
          bevelSize={Math.min(bevelSize, 0.04)}
          bevelSegments={bevelEnabled ? 4 : 1}
          letterSpacing={0.02}
          curveSegments={24}
          castShadow
        >
          {text}
          {/* Čelo – s emissive pre front-lit */}
          {isFrontLit ? (
            <meshPhysicalMaterial
              attach="material-0"
              color={faceColor}
              metalness={0.05}
              roughness={0.25}
              clearcoat={0.3}
              clearcoatRoughness={0.2}
              emissive={ledHex}
              emissiveIntensity={0.6}
              transmission={0.15}
              thickness={0.5}
              ior={1.4}
            />
          ) : (
            <meshPhysicalMaterial
              attach="material-0"
              color={faceColor}
              metalness={0.35}
              roughness={0.15}
              clearcoat={0.8}
              clearcoatRoughness={0.1}
            />
          )}
          <meshPhysicalMaterial
            attach="material-1"
            color={sideColor}
            metalness={0.2}
            roughness={0.4}
          />
        </SafeText3D>
      </Center>

      {/* ── Svetelné efekty ── */}
      <DetailLighting
        lightingType={lightingType}
        ledHex={ledHex}
        ledHexBright={ledHexBright}
        ledHexSoft={ledHexSoft}
        textWidth={textWidth}
        height={letterHeight}
        depth={extrudeDepth}
      />
    </group>
  );
}

// ──────────────────────────────────────────────
// LED osvetlenie pre detail view
// ──────────────────────────────────────────────

function DetailLighting({
  lightingType,
  ledHex,
  ledHexBright,
  ledHexSoft,
  textWidth,
  height,
  depth,
}: {
  lightingType: string;
  ledHex: string;
  ledHexBright: string;
  ledHexSoft: string;
  textWidth: number;
  height: number;
  depth: number;
}) {
  if (lightingType === 'none') return null;

  const w = textWidth;
  const h = height;
  const isFront = lightingType === 'front' || lightingType === 'front_halo';
  const isHalo = lightingType === 'halo' || lightingType === 'front_halo';

  return (
    <group>
      {/* FRONT-LIT – bodové svetlá (bez drahého spotLight) */}
      {isFront && (
        <>
          <pointLight position={[0, 0, depth + 0.5]} intensity={2.5} color={ledHex} distance={4} decay={2} />
          <pointLight position={[-w * 0.35, 0, depth + 0.3]} intensity={1} color={ledHex} distance={2.5} decay={2} />
          <pointLight position={[w * 0.35, 0, depth + 0.3]} intensity={1} color={ledHex} distance={2.5} decay={2} />

          {/* Jemný glow plane pred čelom */}
          <mesh position={[0, 0, depth + 0.02]}>
            <planeGeometry args={[w + 0.2, h + 0.15]} />
            <meshBasicMaterial color={ledHexBright} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </>
      )}

      {/* HALO – bodové svetlá za písmenami */}
      {isHalo && (
        <>
          <pointLight position={[0, 0, -0.12]} intensity={4} color={ledHex} distance={3} decay={1.8} />
          <pointLight position={[-w * 0.3, 0, -0.08]} intensity={1.5} color={ledHex} distance={2} decay={2} />
          <pointLight position={[w * 0.3, 0, -0.08]} intensity={1.5} color={ledHex} distance={2} decay={2} />

          {/* 3 halo glow rings (namiesto 6+) */}
          {[1, 2, 3].map((i) => {
            const spread = h * 0.15 * i;
            const op = 0.25 / i;
            return (
              <mesh key={`detail-halo-${i}`} position={[0, 0, -0.005 * i]}>
                <planeGeometry args={[w + spread, h + spread]} />
                <meshBasicMaterial color={i === 1 ? ledHexBright : ledHexSoft} transparent opacity={op} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
              </mesh>
            );
          })}

          {/* Backwall – stena pre halo efekt */}
          <mesh position={[0, 0, -0.3]} receiveShadow>
            <planeGeometry args={[w + 2, h + 2]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} metalness={0} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ──────────────────────────────────────────────
// Turntable (auto-rotate)
// ──────────────────────────────────────────────

function Turntable({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.15; // pomalá rotácia
    }
  });
  return <group ref={ref}>{children}</group>;
}

// ──────────────────────────────────────────────
// Ground grid
// ──────────────────────────────────────────────

function GroundGrid() {
  return (
    <group>
      <gridHelper
        args={[10, 20, '#333', '#222']}
        position={[0, -1.2, 0]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.21, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </group>
  );
}

// ──────────────────────────────────────────────
// Main Export
// ──────────────────────────────────────────────

function DetailSceneLights() {
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const isLit = lightingType !== 'none';

  return (
    <>
      {/* Redukovaný ambient pre lit scény – aby glow vynikol */}
      <ambientLight intensity={isLit ? 0.15 : 0.4} />
      <directionalLight
        position={[5, 5, 5]}
        intensity={isLit ? 1.2 : 2}
        castShadow
        shadow-mapSize={[512, 512]}
      />
      <directionalLight position={[-3, 3, -2]} intensity={isLit ? 0.2 : 0.5} color="#87ceeb" />
      <pointLight position={[0, 0, 3]} intensity={isLit ? 0.4 : 1} color="#fffbe6" />
    </>
  );
}

// GL dispose on unmount (gentle – no forceContextLoss to avoid corrupting other canvases)
function GLCleanupOnUnmount() {
  const { gl } = useThree();
  useEffect(() => {
    return () => {
      try {
        gl.dispose();
      } catch {
        // ignore
      }
    };
  }, [gl]);
  return null;
}

export default function Scene3DDetail() {
  const [contextLost, setContextLost] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [canvasKey, setCanvasKey] = useState(0);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    setContextLost(false);
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      setContextLost(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      setContextLost(false);
    });
  }, []);

  const handleRetry = useCallback(() => {
    setContextLost(false);
    setRetryCount((c) => c + 1);
    setCanvasKey((k) => k + 1);
  }, []);

  // Auto-retry po 1.5s pri prvom context loss
  useEffect(() => {
    if (contextLost && retryCount < 2) {
      const timer = setTimeout(handleRetry, 1500);
      return () => clearTimeout(timer);
    }
  }, [contextLost, retryCount, handleRetry]);

  if (contextLost) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0f0f0f] rounded-2xl min-h-[400px]">
        <div className="text-center p-8">
          {retryCount >= 2 ? (
            <>
              <div className="text-5xl mb-4">🖥️</div>
              <p className="text-white font-medium mb-2">3D detail nie je dostupný</p>
              <p className="text-slate-500 text-sm mb-4">
                WebGL kontext bol stratený. Skúste zavrieť iné taby.
              </p>
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-[#f59e0b] text-[#0a0a0a] text-sm font-medium hover:bg-[#d97706] transition-colors"
              >
                ↻ Skúsiť znova
              </button>
            </>
          ) : (
            <>
              <div className="animate-spin h-8 w-8 border-2 border-[#f59e0b] border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Obnovujem 3D scénu...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <DetailErrorBoundary>
      <Canvas
        key={canvasKey}
        camera={{ position: [0, 0.5, 4], fov: 45 }}
        shadows
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
        }}
        style={{ width: '100%', height: '100%' }}
        onCreated={handleCreated}
      >
        <GLCleanupOnUnmount />
        <color attach="background" args={['#0a0a0a']} />

        {/* Dynamické svetlá – stlmené keď sú LED zapnuté */}
        <DetailSceneLights />

        <Suspense fallback={<DetailLoader />}>
          <Turntable>
            <DetailLetters />
          </Turntable>
          <GroundGrid />
        </Suspense>

        {/* Voľný orbit – žiadne limity (360°) */}
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          target={[0, 0, 0]}
          minDistance={1.5}
          maxDistance={10}
          autoRotate={false}
        />
      </Canvas>
    </DetailErrorBoundary>
  );
}
