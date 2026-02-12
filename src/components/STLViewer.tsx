'use client';

/**
 * STLViewer – 3D náhľad vygenerovaných výrobných STL dielov
 *
 * Zobrazuje:
 *  - Všetky diely jedného písmena v 3D scéne
 *  - Farebné rozlíšenie: korpus (sivý), čelo (žltý), zadok (modrý), montáž (zelený)
 *  - Exploded view (roztiahnuté diely pre lepšiu viditeľnosť)
 *  - Toggle pre jednotlivé diely
 *  - Orbit controls pre otáčanie
 */

import React, { useRef, useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';

// ─── Types ──────────────────────────────────────

interface PartInfo {
  name: string;
  filename: string;
  part_type: string;
  description: string;
}

interface LetterInfo {
  char: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number;
  parts_count: number;
  is_segmented: boolean;
  segment_count: number;
  led_count: number;
  weight_g: number;
  parts: PartInfo[];
}

interface STLViewerProps {
  jobId: string;
  letters: LetterInfo[];
  lightingType: string;
  fullView?: boolean;
}

// ─── Part Colors ────────────────────────────────

const PART_COLORS: Record<string, string> = {
  shell: '#B0B0B0',    // Svetlo sivý – korpus (hlavné telo)
  face: '#FFB800',     // Žltý/opálový – čelo
  back: '#7B68EE',     // Fialovo-modrý – zadný panel
  mounting: '#FF6B35',  // Oranžový – montáž (jasne odlíšené)
  rib: '#C084FC',      // Fialový – výstuhy
  solid: '#D4D4D8',    // Svetlo sivý – plný blok
};

const PART_LABELS: Record<string, string> = {
  shell: 'Korpus',
  face: 'Čelo',
  back: 'Zadný panel',
  mounting: 'Montáž',
  rib: 'Výstuhy',
  solid: 'Plný blok',
};

const PART_MATERIALS: Record<string, { metalness: number; roughness: number; opacity: number }> = {
  shell: { metalness: 0.1, roughness: 0.4, opacity: 0.85 },
  face: { metalness: 0.0, roughness: 0.2, opacity: 0.7 },   // priepustné čelo
  back: { metalness: 0.1, roughness: 0.5, opacity: 1.0 },
  mounting: { metalness: 0.4, roughness: 0.3, opacity: 1.0 },
  rib: { metalness: 0.1, roughness: 0.5, opacity: 1.0 },
  solid: { metalness: 0.1, roughness: 0.4, opacity: 1.0 },
};

// ─── STL Binary Parser ──────────────────────────

function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  // Check if ASCII or Binary
  const text = new TextDecoder().decode(buffer.slice(0, 80));
  if (text.startsWith('solid') && !text.includes('\0')) {
    return parseASCIISTL(buffer, geometry);
  }
  return parseBinarySTL(buffer, geometry);
}

function parseBinarySTL(buffer: ArrayBuffer, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const view = new DataView(buffer);
  const numTriangles = view.getUint32(80, true);

  const vertices = new Float32Array(numTriangles * 9);
  const normals = new Float32Array(numTriangles * 9);

  let offset = 84;

  for (let i = 0; i < numTriangles; i++) {
    // Normal
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    // Vertices
    for (let j = 0; j < 3; j++) {
      const idx = i * 9 + j * 3;
      vertices[idx] = view.getFloat32(offset, true);
      vertices[idx + 1] = view.getFloat32(offset + 4, true);
      vertices[idx + 2] = view.getFloat32(offset + 8, true);
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
      offset += 12;
    }

    offset += 2; // attribute byte count
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  return geometry;
}

function parseASCIISTL(buffer: ArrayBuffer, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const text = new TextDecoder().decode(buffer);
  const vertices: number[] = [];
  const normals: number[] = [];

  let currentNormal = [0, 0, 0];

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('facet normal')) {
      const parts = trimmed.split(/\s+/);
      currentNormal = [parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])];
    } else if (trimmed.startsWith('vertex')) {
      const parts = trimmed.split(/\s+/);
      vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      normals.push(...currentNormal);
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geometry.computeBoundingBox();
  return geometry;
}


// ─── STL Part Mesh Component ────────────────────

function STLPart({
  url,
  partType,
  visible,
  explodeOffset,
  hovered,
  onHover,
  showLabel,
}: {
  url: string;
  partType: string;
  visible: boolean;
  explodeOffset: [number, number, number];
  hovered: boolean;
  onHover: (hovered: boolean) => void;
  showLabel?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Load STL
  useEffect(() => {
    let cancelled = false;

    async function loadSTL() {
      try {
        setLoading(true);
        setError(false);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const geo = parseSTL(buffer);
        // ── Centrovanie geometrie ──
        // STL z CadQuery má súradnice podľa pôvodných SVG kontúr (nie od nuly).
        // center() presunie bounding box stred na [0,0,0].
        geo.center();
        geo.computeBoundingBox();
        setGeometry(geo);
      } catch (e) {
        console.error('Failed to load STL:', url, e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSTL();
    return () => { cancelled = true; };
  }, [url]);

  // Material
  const materialProps = PART_MATERIALS[partType] || PART_MATERIALS.solid;
  const color = PART_COLORS[partType] || '#888888';
  const label = PART_LABELS[partType] || partType;

  // Compute center for label position (MUST be before any early return)
  // Geometria je už vycentrovaná, takže label je nad horným okrajom
  const center = useMemo(() => {
    if (!geometry) return new THREE.Vector3(0, 10, 0);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    return new THREE.Vector3(
      0,
      bb.max.y + 5,
      0,
    );
  }, [geometry]);

  // Animate to exploded position
  useFrame(() => {
    if (!groupRef.current) return;
    const target = new THREE.Vector3(...explodeOffset);
    groupRef.current.position.lerp(target, 0.08);
    const s = hovered ? 1.03 : 1.0;
    groupRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.1);
  });

  if (!visible || loading || error || !geometry) {
    if (loading && visible) {
      return (
        <Html center>
          <div className="text-xs text-slate-400 animate-pulse">Loading...</div>
        </Html>
      );
    }
    return null;
  }

  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometry}
        onPointerEnter={(e) => { e.stopPropagation(); onHover(true); }}
        onPointerLeave={() => onHover(false)}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={hovered ? '#FFFFFF' : color}
          metalness={materialProps.metalness}
          roughness={materialProps.roughness}
          transparent={materialProps.opacity < 1}
          opacity={materialProps.opacity}
          side={THREE.DoubleSide}
          envMapIntensity={0.5}
        />
      </mesh>

      {/* Label above part (when hovered or showLabel) */}
      {(hovered || showLabel) && (
        <Html position={center} center distanceFactor={200} zIndexRange={[10, 0]}>
          <div
            className="px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap shadow-lg"
            style={{
              backgroundColor: color,
              color: '#000',
              border: '1px solid rgba(255,255,255,0.3)',
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}


// ─── GL Cleanup on unmount ──────────────────────

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

// ─── Auto-fit camera ────────────────────────────

function AutoFitCamera({ letterWidth, letterHeight, letterDepth }: {
  letterWidth: number;
  letterHeight: number;
  letterDepth: number;
}) {
  const { camera } = useThree();

  useEffect(() => {
    // Geometria je vycentrovaná na [0,0,0]
    // Kamera sa musí nastaviť podľa najväčšieho rozmeru
    const maxDim = Math.max(letterWidth, letterHeight, letterDepth);
    const dist = Math.max(maxDim * 1.8, 150);
    camera.position.set(dist * 0.6, dist * 0.45, dist * 0.8);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, letterWidth, letterHeight, letterDepth]);

  return null;
}


// ─── Main STLViewer Component ───────────────────

export default function STLViewer({ jobId, letters, lightingType, fullView = false }: STLViewerProps) {
  const [selectedLetterIdx, setSelectedLetterIdx] = useState(0);
  const [exploded, setExploded] = useState(true);
  const [visibleParts, setVisibleParts] = useState<Record<string, boolean>>({
    shell: true,
    face: true,
    back: true,
    mounting: true,
    rib: true,
    solid: true,
  });
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [stlContextLost, setStlContextLost] = useState(false);
  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      setStlContextLost(true);
    });
  }, []);

  const selectedLetter = letters[selectedLetterIdx];
  if (!selectedLetter) return null;

  // Calculate explode offsets for each part type
  // Proporcionálne k rozmerom písmena pre jasné oddelenie
  const getExplodeOffset = useCallback((partType: string, depth: number): [number, number, number] => {
    if (!exploded) return [0, 0, 0];
    const h = selectedLetter.height_mm;
    const w = selectedLetter.width_mm;
    // Gap proporcionálny k veľkosti, ale rozumný
    const gap = Math.max(h, w, depth) * 0.4;
    switch (partType) {
      case 'face':    return [0, 0, gap];                        // čelo dopredu
      case 'back':    return [0, 0, -gap];                       // zadok dozadu
      case 'mounting': return [gap * 0.8, -gap * 0.5, -gap * 0.8]; // montáž dole+vzadu+do strany
      case 'rib':     return [gap * 1.2, 0, 0];                 // výstuhy do strany
      default:        return [0, 0, 0];                          // korpus na mieste
    }
  }, [exploded, selectedLetter]);

  const togglePart = (type: string) => {
    setVisibleParts(prev => ({ ...prev, [type]: !prev[type] }));
  };

  // Unique part types in the selected letter
  const partTypes = useMemo(() => {
    const types = new Set(selectedLetter.parts.map(p => p.part_type));
    return Array.from(types);
  }, [selectedLetter]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">
          👁️ 3D Náhľad výrobných dielov
        </h3>
        <span className="text-[10px] text-slate-500">
          {selectedLetter.parts_count} dielov
        </span>
      </div>

      {/* Letter selector (if multiple) */}
      {letters.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {letters.map((letter, i) => (
            <button
              key={i}
              onClick={() => setSelectedLetterIdx(i)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                i === selectedLetterIdx
                  ? 'bg-[#f59e0b] text-black'
                  : 'bg-[#1a1a1a] text-slate-400 hover:text-white hover:bg-[#2a2a2a]'
              }`}
            >
              {letter.char}
            </button>
          ))}
        </div>
      )}

      {/* 3D Canvas */}
      <div
        className="relative rounded-xl overflow-hidden border border-[#2a2a2a] bg-[#0d0d0d]"
        style={{ height: fullView ? '550px' : '400px' }}
      >
        {stlContextLost ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-3">🖥️</div>
              <p className="text-slate-400 text-sm mb-3">WebGL kontext stratený</p>
              <button
                onClick={() => setStlContextLost(false)}
                className="px-4 py-2 rounded-lg bg-[#f59e0b] text-[#0a0a0a] text-sm font-medium hover:bg-[#d97706] transition-colors"
              >
                ↻ Obnoviť
              </button>
            </div>
          </div>
        ) : (
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={handleCreated}
        >
          <GLCleanupOnUnmount />
          <color attach="background" args={['#0d0d0d']} />

          <PerspectiveCamera makeDefault fov={40} near={0.1} far={10000} />
          <AutoFitCamera
            letterWidth={selectedLetter.width_mm}
            letterHeight={selectedLetter.height_mm}
            letterDepth={selectedLetter.depth_mm}
          />

          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[200, 300, 200]}
            intensity={1.2}
            castShadow
            shadow-mapSize-width={512}
            shadow-mapSize-height={512}
          />
          <directionalLight position={[-100, 200, -100]} intensity={0.4} />
          <pointLight position={[0, 100, 200]} intensity={0.5} color="#ffd700" />

          {/* Grid – pod modelom, proporcionálna k veľkosti */}
          <Grid
            args={[2000, 2000]}
            cellSize={10}
            cellThickness={0.5}
            cellColor="#1a1a1a"
            sectionSize={50}
            sectionThickness={1}
            sectionColor="#2a2a2a"
            fadeDistance={800}
            fadeStrength={1}
            position={[0, -(selectedLetter.height_mm / 2 + 5), 0]}
          />

          {/* STL Parts */}
          <Suspense fallback={null}>
            {selectedLetter.parts.map((part, pi) => (
              <STLPart
                key={`${selectedLetter.char}-${part.filename}-${pi}`}
                url={`/api/stl-preview/${jobId}/${part.filename}`}
                partType={part.part_type}
                visible={visibleParts[part.part_type] ?? true}
                explodeOffset={getExplodeOffset(part.part_type, selectedLetter.depth_mm)}
                hovered={hoveredPart === part.name}
                onHover={(h) => setHoveredPart(h ? part.name : null)}
                showLabel={exploded}
              />
            ))}
          </Suspense>

          {/* Controls */}
          <OrbitControls
            target={[0, 0, 0]}
            autoRotate={autoRotate}
            autoRotateSpeed={1.5}
            enableDamping
            dampingFactor={0.05}
            minDistance={Math.max(selectedLetter.height_mm * 0.5, 30)}
            maxDistance={Math.max(selectedLetter.height_mm * 8, 2000)}
          />
        </Canvas>
        )}

        {/* Hovered part label overlay */}
        {hoveredPart && (
          <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10">
            <span className="text-xs text-white font-medium">{hoveredPart}</span>
          </div>
        )}

        {/* Dimensions overlay */}
        <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] text-slate-400 space-y-0.5">
          <div>Šírka: <span className="text-white">{selectedLetter.width_mm}mm</span></div>
          <div>Výška: <span className="text-white">{selectedLetter.height_mm}mm</span></div>
          <div>Hĺbka: <span className="text-white">{selectedLetter.depth_mm}mm</span></div>
          <div>Hmotnosť: <span className="text-white">~{selectedLetter.weight_g}g</span></div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Exploded view toggle */}
        <button
          onClick={() => setExploded(!exploded)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            exploded
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'bg-[#1a1a1a] text-slate-400 border border-[#2a2a2a] hover:text-white'
          }`}
        >
          {exploded ? '💥 Rozložené' : '🔲 Zložené'}
        </button>

        {/* Auto-rotate toggle */}
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            autoRotate
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-[#1a1a1a] text-slate-400 border border-[#2a2a2a] hover:text-white'
          }`}
        >
          {autoRotate ? '🔄 Rotácia' : '⏸️ Zastavené'}
        </button>
      </div>

      {/* Part type toggles with color legend */}
      <div className="grid grid-cols-2 gap-1.5">
        {partTypes.map((type) => {
          const count = selectedLetter.parts.filter(p => p.part_type === type).length;
          const isVisible = visibleParts[type] ?? true;
          const isHovered = selectedLetter.parts.some(
            p => p.part_type === type && hoveredPart === p.name
          );

          return (
            <button
              key={type}
              onClick={() => togglePart(type)}
              onPointerEnter={() => {
                const part = selectedLetter.parts.find(p => p.part_type === type);
                if (part) setHoveredPart(part.name);
              }}
              onPointerLeave={() => setHoveredPart(null)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all border ${
                isVisible
                  ? isHovered
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-[#1a1a1a] border-[#2a2a2a] text-slate-300'
                  : 'bg-[#0d0d0d] border-[#1a1a1a] text-slate-600 line-through'
              }`}
            >
              {/* Color dot */}
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: isVisible ? PART_COLORS[type] : '#333',
                  opacity: isVisible ? 1 : 0.3,
                }}
              />
              <span className="flex-1 text-left">
                {PART_LABELS[type] || type}
              </span>
              <span className="text-[10px] text-slate-500">
                ×{count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lighting type info */}
      <div className="bg-[#1a1a1a] rounded-lg p-3 text-xs text-slate-400">
        <span className="text-slate-300 font-medium">
          Konštrukcia: {lightingType}
        </span>
        <p className="mt-1 text-[10px] text-slate-500">
          {lightingType === 'channel' && 'Klasické duté písmeno s 2mm stenou, spojené so zadnou stenou. Bez LED.'}
          {lightingType === 'channel_front' && 'Klasické duté písmeno s LED. Oddelené opálové čelo + zadná stena.'}
          {lightingType === 'front' && 'Front-lit – opálové čelo so LED modulmi zvnútra, zatvorený zadok.'}
          {lightingType === 'halo' && 'Halo efekt – LED svietia zozadu cez otvorený zadný panel.'}
          {lightingType === 'front_halo' && 'Kombinácia predného aj zadného svietenia.'}
          {lightingType === 'none' && 'Plné dekoratívne 3D písmeno bez podsvietenia.'}
        </p>
      </div>
    </div>
  );
}
