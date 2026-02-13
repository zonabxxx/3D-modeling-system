/**
 * STLViewer — 3D vizualizácia vygenerovaných STL súborov
 *
 * Funkcie:
 *  - Zoskupenie podľa objektov (písmen) a typov dielov
 *  - Výber jednotlivých objektov aj typov
 *  - Explode view
 *  - Auto-fit kamera
 */

import { useRef, useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

/* ─── Types ─── */
interface STLFileInfo {
  filename: string;
  url: string;
  partType: string;
  objectId: string;
  objectLabel: string;
}

interface STLViewerProps {
  files: STLFileInfo[];
  className?: string;
}

/* ─── Part type config ─── */
const PART_CFG: Record<string, { label: string; color: string; opacity: number }> = {
  shell:    { label: 'Korpus',  color: '#b8c0cc', opacity: 0.85 },
  face:     { label: 'Čelo',    color: '#7eb8f0', opacity: 0.35 },
  back:     { label: 'Zadok',   color: '#8a8a96', opacity: 0.9 },
  mounting: { label: 'Montáž',  color: '#f0a040', opacity: 1.0 },
  solid:    { label: 'Plný',    color: '#c0c0c0', opacity: 0.85 },
  rib:      { label: 'Výstuhy', color: '#a0a0a8', opacity: 0.9 },
};

/* ─── Object colors for distinguishing letters ─── */
const OBJ_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

/* ─── Single STL Mesh ─── */
function STLMesh({ url, partType, visible, highlight, offset }: {
  url: string; partType: string; visible: boolean; highlight: boolean; offset: [number, number, number];
}) {
  const geometry = useLoader(STLLoader, url);
  const meshRef = useRef<THREE.Mesh>(null);

  const cfg = PART_CFG[partType] || { color: '#cccccc', opacity: 1 };
  const isTranslucent = partType === 'face';

  useEffect(() => {
    if (geometry) geometry.computeVertexNormals();
  }, [geometry]);

  if (!visible) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow position={offset}>
      <meshPhysicalMaterial
        color={cfg.color}
        transparent={isTranslucent || cfg.opacity < 1 || !highlight}
        opacity={highlight ? cfg.opacity : cfg.opacity * 0.15}
        roughness={isTranslucent ? 0.05 : 0.35}
        metalness={isTranslucent ? 0.0 : 0.08}
        clearcoat={isTranslucent ? 1.0 : 0.15}
        clearcoatRoughness={0.15}
        side={THREE.DoubleSide}
        depthWrite={highlight}
        emissive={highlight && !isTranslucent ? cfg.color : '#000000'}
        emissiveIntensity={highlight ? 0.03 : 0}
      />
    </mesh>
  );
}

/* ─── Auto-fit camera ─── */
function AutoFit({ children }: { children: React.ReactNode }) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!groupRef.current) return;
    const timer = setTimeout(() => {
      if (!groupRef.current) return;
      const box = new THREE.Box3().setFromObject(groupRef.current);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim === 0) return;
      groupRef.current.position.sub(center);
      const fov = (camera as THREE.PerspectiveCamera).fov;
      const dist = maxDim / (2 * Math.tan((fov * Math.PI) / 360)) * 1.3;
      camera.position.set(dist * 0.7, dist * 0.5, dist * 1.0);
      camera.lookAt(0, 0, 0);
      (camera as THREE.PerspectiveCamera).near = maxDim * 0.001;
      (camera as THREE.PerspectiveCamera).far = maxDim * 10;
      camera.updateProjectionMatrix();
    }, 600);
    return () => clearTimeout(timer);
  }, [camera]);

  return <group ref={groupRef}>{children}</group>;
}

/* ─── Loading ─── */
function LoadingFallback() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => { if (meshRef.current) meshRef.current.rotation.y += delta * 2; });
  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[15, 0]} />
      <meshStandardMaterial color="#f59e0b" wireframe />
    </mesh>
  );
}

/* ─── Main Viewer ─── */
export default function STLViewer({ files, className = '' }: STLViewerProps) {
  const [selectedObj, setSelectedObj] = useState<string | null>(null); // null = all selected
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [exploded, setExploded] = useState(false);

  // Group files by object
  const objects = useMemo(() => {
    const map = new Map<string, { label: string; files: STLFileInfo[]; colorIdx: number }>();
    let idx = 0;
    files.forEach(f => {
      if (!map.has(f.objectId)) {
        map.set(f.objectId, { label: f.objectLabel, files: [], colorIdx: idx++ });
      }
      map.get(f.objectId)!.files.push(f);
    });
    return map;
  }, [files]);

  // Unique part types
  const partTypes = useMemo(() => {
    const types = new Map<string, number>();
    files.forEach(f => types.set(f.partType, (types.get(f.partType) || 0) + 1));
    return Array.from(types.entries());
  }, [files]);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const explodeOffset = useCallback((partType: string): [number, number, number] => {
    if (!exploded) return [0, 0, 0];
    switch (partType) {
      case 'face': return [0, 0, 30];
      case 'back': return [0, 0, -30];
      case 'mounting': return [0, -25, -15];
      case 'rib': return [0, 20, 0];
      default: return [0, 0, 0];
    }
  }, [exploded]);

  const objectEntries = useMemo(() => Array.from(objects.entries()), [objects]);

  if (files.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-black/20 rounded-xl ${className}`}>
        <p className="text-gray-500 text-sm">Žiadne STL súbory</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* 3D Canvas */}
      <div className="w-full h-full rounded-xl overflow-hidden bg-gradient-to-b from-[#0d1525] to-[#060b18] border border-white/[.06]">
        <Canvas shadows>
          <PerspectiveCamera makeDefault fov={45} position={[200, 150, 300]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[200, 300, 200]} intensity={1.0} castShadow />
          <directionalLight position={[-150, 200, -100]} intensity={0.3} />
          <hemisphereLight color="#b8d0ff" groundColor="#1a1a2e" intensity={0.4} />

          <Suspense fallback={<LoadingFallback />}>
            <AutoFit>
              {files.map((file) => (
                <STLMesh
                  key={file.filename}
                  url={file.url}
                  partType={file.partType}
                  visible={!hiddenTypes.has(file.partType)}
                  highlight={selectedObj === null || selectedObj === file.objectId}
                  offset={explodeOffset(file.partType)}
                />
              ))}
            </AutoFit>
          </Suspense>

          <OrbitControls enableDamping dampingFactor={0.06} rotateSpeed={0.7} zoomSpeed={1.0} panSpeed={0.6} minDistance={10} maxDistance={3000} />
          <gridHelper args={[1000, 40, '#1a2030', '#0f1520']} position={[0, -100, 0]} />
        </Canvas>
      </div>

      {/* ─── Left panel: Objects (letters) ─── */}
      <div className="absolute top-2.5 left-2.5 z-10">
        <div className="bg-black/75 backdrop-blur-md rounded-xl p-2 border border-white/[.08] min-w-[130px]">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-semibold px-1 mb-1.5">Objekty</div>

          {/* "All" button */}
          <button
            onClick={() => setSelectedObj(null)}
            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all mb-0.5 ${
              selectedObj === null
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'text-gray-400 hover:bg-white/[.04] border border-transparent'
            }`}
          >
            <span className="w-3 h-3 rounded-sm bg-gradient-to-br from-amber-400 to-orange-500 shrink-0" />
            <span>Všetky</span>
            <span className="text-[8px] text-gray-600 ml-auto">{objectEntries.length}</span>
          </button>

          {/* Individual objects */}
          <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
            {objectEntries.map(([id, obj]) => {
              const isActive = selectedObj === id;
              const color = OBJ_COLORS[obj.colorIdx % OBJ_COLORS.length];
              return (
                <button
                  key={id}
                  onClick={() => setSelectedObj(isActive ? null : id)}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                    isActive
                      ? 'bg-white/[.08] text-white border border-white/15'
                      : selectedObj === null
                        ? 'text-white/70 hover:bg-white/[.04] border border-transparent'
                        : 'text-gray-600 hover:bg-white/[.03] border border-transparent'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-sm shrink-0 border"
                    style={{
                      backgroundColor: isActive || selectedObj === null ? color : 'transparent',
                      borderColor: color,
                      opacity: isActive || selectedObj === null ? 1 : 0.35,
                    }}
                  />
                  <span className="truncate">{obj.label}</span>
                  <span className="text-[8px] text-gray-600 ml-auto">{obj.files.length}</span>
                </button>
              );
            })}
          </div>

          {/* Part type filter */}
          <div className="border-t border-white/[.06] mt-1.5 pt-1.5">
            <div className="text-[8px] text-gray-500 uppercase tracking-widest font-semibold px-1 mb-1">Typ dielu</div>
            {partTypes.map(([type, count]) => {
              const cfg = PART_CFG[type] || { label: type, color: '#ccc' };
              const visible = !hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`flex items-center gap-2 w-full px-2 py-1 rounded-lg text-[10px] transition-all ${
                    visible ? 'text-white/70 hover:bg-white/[.04]' : 'text-gray-600 hover:bg-white/[.03]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0 border transition-all"
                    style={{
                      backgroundColor: visible ? cfg.color : 'transparent',
                      borderColor: visible ? cfg.color : '#444',
                    }}
                  />
                  <span className={!visible ? 'line-through opacity-40' : ''}>{cfg.label}</span>
                  <span className="text-[8px] text-gray-600 ml-auto">{count}×</span>
                </button>
              );
            })}
          </div>

          {/* Explode */}
          <div className="border-t border-white/[.06] mt-1.5 pt-1.5">
            <button onClick={() => setExploded(e => !e)}
              className={`w-full text-[9px] py-1 px-2 rounded-lg transition-all ${
                exploded ? 'text-amber-400 bg-amber-500/10' : 'text-gray-500 hover:text-amber-400 hover:bg-white/[.04]'
              }`}>
              {exploded ? '⟵ Zložiť diely' : 'Rozložiť diely ⟶'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Help hint ─── */}
      <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10">
        <div className="text-[8px] text-white/25 bg-black/40 backdrop-blur-sm px-3 py-1 rounded-full border border-white/[.04]">
          🖱️ Rotácia · Koliesko = zoom · Pravé = posun
        </div>
      </div>

      {/* ─── Legend ─── */}
      <div className="absolute bottom-2.5 right-2.5 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 border border-white/[.05] flex gap-3">
          {partTypes.filter(([t]) => !hiddenTypes.has(t)).map(([t]) => {
            const cfg = PART_CFG[t] || { label: t, color: '#ccc' };
            return (
              <div key={t} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: cfg.color }} />
                <span className="text-[8px] text-white/50">{cfg.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
