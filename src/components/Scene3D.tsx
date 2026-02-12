'use client';

/**
 * Scene3D – 3D náhľad svetelnej reklamy NA fasáde
 *
 * Koncept:
 *   1. Fotka fasády je na 3D rovine (stena budovy)
 *   2. 3D extrudované písmená sú prilepené NA stene
 *   3. Používateľ môže orbitovať kamerou okolo budovy
 *   4. Svetelné efekty (halo/front) simulované v scéne
 *
 * Fonty: lokálne z /public/fonts/ (žiadne externé URL)
 */

import React, { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Center,
  Text,
  RoundedBox,
} from '@react-three/drei';
// Namespace import – property access on objects never throws ReferenceError,
// even when Turbopack HMR invalidates module bindings during hot reload.
import * as _DreiNS from '@react-three/drei';
import * as THREE from 'three';
import { useConfiguratorStore } from '@/stores/configurator-store';
import { Font, SVGLoader } from 'three-stdlib';

/**
 * Safe wrapper for Text3D – handles Turbopack HMR edge case where
 * the Text3D import binding becomes undefined during hot module replacement.
 *
 * By accessing Text3D through a namespace object (`_DreiNS.Text3D`), we avoid
 * the ReferenceError that occurs when a named import binding is invalidated.
 * Property access on an object returns `undefined` instead of throwing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SafeText3D(props: any) {
  // Access via namespace – never throws ReferenceError
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const T3D = (_DreiNS as any)?.Text3D;
  if (!T3D) {
    return null;
  }
  try {
    return <T3D {...props} />;
  } catch {
    // Fallback for any other HMR-related crash
    console.warn('[Scene3D] Text3D render failed (HMR). Refresh if needed.');
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fontCache = new Map<string, any>();
// Clear cache on module load to invalidate old scale-factor conversions
fontCache.clear();

/**
 * Načíta TTF font a skonvertuje na typeface JSON formát
 * kompatibilný s Text3D / TextGeometry.
 * Rovnaký algoritmus ako Three.js TTFLoader.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTTFAsTypefaceJSON(ttfUrl: string): Promise<any> {
  if (fontCache.has(ttfUrl)) {
    const cached = fontCache.get(ttfUrl);
    if (cached) return cached;
  }

  const opentype = await import('opentype.js');
  const response = await fetch(ttfUrl);
  const buffer = await response.arrayBuffer();
  const font = opentype.parse(buffer);

  const round = Math.round;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const glyphs: Record<string, any> = {};
  // Normalizácia na EM-square: 1000 zodpovedá 1 EM (rovnaké ako CSS font-size)
  // Pôvodný TTFLoader používal 100000/(upm*72) čo nafúklo text o 100/72 = 1.389×
  const scale = 1000 / (font.unitsPerEm || 2048);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const glyphIndexMap = (font.encoding as any).cmap?.glyphIndexMap ?? (font as any).encoding?.cmap?.glyphIndexMap ?? {};
  const unicodes = Object.keys(glyphIndexMap);

  for (let i = 0; i < unicodes.length; i++) {
    const unicode = unicodes[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const glyph = (font.glyphs as any).glyphs[glyphIndexMap[unicode as any]];
    if (unicode !== undefined && glyph) {
      const token: { ha: number; x_min: number; x_max: number; o: string } = {
        ha: round(glyph.advanceWidth * scale),
        x_min: round((glyph.xMin ?? 0) * scale),
        x_max: round((glyph.xMax ?? 0) * scale),
        o: '',
      };

      if (glyph.path && glyph.path.commands) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        glyph.path.commands.forEach((cmd: any) => {
          let type = cmd.type.toLowerCase();
          if (type === 'c') type = 'b'; // cubic → bezier notation for Three.js
          token.o += type + ' ';
          if (cmd.x !== undefined && cmd.y !== undefined) {
            token.o += round(cmd.x * scale) + ' ' + round(cmd.y * scale) + ' ';
          }
          if (cmd.x1 !== undefined && cmd.y1 !== undefined) {
            token.o += round(cmd.x1 * scale) + ' ' + round(cmd.y1 * scale) + ' ';
          }
          if (cmd.x2 !== undefined && cmd.y2 !== undefined) {
            token.o += round(cmd.x2 * scale) + ' ' + round(cmd.y2 * scale) + ' ';
          }
        });
      }

      glyphs[String.fromCodePoint(glyph.unicode)] = token;
    }
  }

  const typefaceData = {
    glyphs,
    familyName: font.getEnglishName('fullName'),
    ascender: round(font.ascender * scale),
    descender: round(font.descender * scale),
    underlinePosition: font.tables.post.underlinePosition,
    underlineThickness: font.tables.post.underlineThickness,
    boundingBox: {
      xMin: font.tables.head.xMin,
      xMax: font.tables.head.xMax,
      yMin: font.tables.head.yMin,
      yMax: font.tables.head.yMax,
    },
    resolution: 1000,
    original_font_information: font.tables.name,
  };

  fontCache.set(ttfUrl, typefaceData);
  return typefaceData;
}

/**
 * Hook: načíta TTF font → vráti Font objekt kompatibilný s Text3D
 */
function useTTFFont(ttfUrl: string): Font | null {
  const [font, setFont] = useState<Font | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadTTFAsTypefaceJSON(ttfUrl)
      .then((data) => {
        if (cancelled) return;
        const threeFont = new Font(data);
        setFont(threeFont);
      })
      .catch((err) => {
        console.warn('Failed to load TTF font:', ttfUrl, err);
      });

    return () => { cancelled = true; };
  }, [ttfUrl]);

  return font;
}

// ──────────────────────────────────────────────
// Error Boundary
// ──────────────────────────────────────────────

class Scene3DErrorBoundary extends React.Component<
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
            <p className="text-white font-medium mb-2">3D scéna sa nepodarila načítať</p>
            <p className="text-slate-500 text-sm mb-4 max-w-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors"
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
// Loader spinner (inside Canvas)
// ──────────────────────────────────────────────

function CanvasLoader() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) {
      ref.current.rotation.y = s.clock.elapsedTime * 1.5;
    }
  });
  return (
    <group>
      <mesh ref={ref}>
        <torusGeometry args={[0.5, 0.15, 8, 32]} />
        <meshStandardMaterial color="#f59e0b" wireframe />
      </mesh>
      <Text position={[0, -1.2, 0]} fontSize={0.15} color="#555" anchorX="center" anchorY="middle">
        Načítavam 3D scénu...
      </Text>
    </group>
  );
}

// ──────────────────────────────────────────────
// Fasáda – 3D stena budovy s fotkou
// ──────────────────────────────────────────────

function FacadeWall() {
  const photoUrl = useConfiguratorStore((s) => s.photo.url);
  const photoFile = useConfiguratorStore((s) => s.photo.file);
  const photoW = useConfiguratorStore((s) => s.photo.width);
  const photoH = useConfiguratorStore((s) => s.photo.height);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    if (!photoUrl && !photoFile) {
      setTexture(null);
      return;
    }

    let cancelled = false;

    // Vytvor textúru z načítaného obrázku – správne nastavenie pre ľubovoľný rozmer
    function applyTexture(img: HTMLImageElement | ImageBitmap) {
      if (cancelled) return;
      const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
      // Kľúčové: vypnúť mipmaps pre NPOT textúry (fotky majú ľubovoľné rozmery)
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
          setTexture(tex);
      invalidate();
    }

    // Priorita: File → data URL → blob URL
    if (photoFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (cancelled || !e.target?.result) return;
        const img = document.createElement('img');
        img.onload = () => applyTexture(img);
        img.src = e.target.result as string;
      };
      reader.readAsDataURL(photoFile);
    } else if (photoUrl) {
      const img = document.createElement('img');
      img.onload = () => applyTexture(img);
      img.src = photoUrl;
    }

    return () => { cancelled = true; };
  }, [photoUrl, photoFile, invalidate]);

  // Rozmer steny podľa pomeru strán fotky
  const rawAspect = photoW && photoH ? photoW / photoH : 16 / 10;
  const aspect = (!rawAspect || isNaN(rawAspect) || rawAspect <= 0) ? 1.6 : rawAspect;
  const wallH = 6;
  const wallW = wallH * aspect;
  const wallDepth = 0.3; // hrúbka steny

  return (
    <group>
      {/* Fotka fasády – len čistý plane na celú plochu */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[wallW, wallH]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : (
          <meshStandardMaterial color="#8B7355" roughness={0.9} metalness={0.05} />
        )}
      </mesh>
    </group>
  );
}

// ──────────────────────────────────────────────
// 3D Nápis (Text3D extrudované písmená)
// Prilepený NA stene fasády
// ──────────────────────────────────────────────

function Sign3D() {
  const text = useConfiguratorStore((s) => s.text) || 'ADSUN';
  const fontUrl = useConfiguratorStore((s) => s.fontUrl);
  const faceColor = useConfiguratorStore((s) => s.faceColor);
  const sideColor = useConfiguratorStore((s) => s.sideColor);
  const rawDepthMm = useConfiguratorStore((s) => s.depthMm);
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const ledColor = useConfiguratorStore((s) => s.ledColor);
  const profileType = useConfiguratorStore((s) => s.profileType);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const computed = useConfiguratorStore((s) => s.computed);

  // Pozícia a mierka zo store
  const position = useConfiguratorStore((s) => s.position);
  const photoW = useConfiguratorStore((s) => s.photo.width);
  const photoH = useConfiguratorStore((s) => s.photo.height);
  const factorPxToMm = useConfiguratorStore((s) => s.scale.factorPxToMm);

  // ── Načítanie fontu z TTF (dynamicky) ──
  // Mapovanie fontId → správny TTF súbor (pre prípad starého fontUrl v store)
  const FONT_URL_MAP: Record<string, string> = {
    'Montserrat':    '/fonts/Montserrat-Bold.ttf',
    'Bebas Neue':    '/fonts/BebasNeue-Regular.ttf',
    'Oswald':        '/fonts/Oswald-Bold.ttf',
    'Poppins':       '/fonts/Poppins-Black.ttf',
    'Roboto':        '/fonts/Roboto-Bold.ttf',
    'Inter':         '/fonts/Inter-Bold.ttf',
    'Raleway':       '/fonts/Raleway-Black.ttf',
    'Archivo Black': '/fonts/ArchivoBlack-Regular.ttf',
    'Outfit':        '/fonts/Outfit-Bold.ttf',
    'Barlow':        '/fonts/Barlow-Bold.ttf',
  };
  const fontFamily = useConfiguratorStore((s) => s.fontFamily);
  // Preferuj mapovanie podľa fontFamily, fallback na fontUrl zo store
  const resolvedFontUrl = FONT_URL_MAP[fontFamily] || fontUrl || '/fonts/Montserrat-Bold.ttf';
  const font3D = useTTFFont(resolvedFontUrl);

  // ── Rozmer steny (rovnaký ako vo FacadeWall) ──
  const rawAspect = photoW && photoH ? photoW / photoH : 16 / 10;
  const aspect = (!rawAspect || isNaN(rawAspect) || rawAspect <= 0) ? 1.6 : rawAspect;
  const wallH = 6;
  const wallW = wallH * aspect;

  // ── Výška písmen v 3D (proporčne k stene) ──
  const facadeHeightMm = (factorPxToMm && photoH) ? photoH * factorPxToMm : null;
  const letterHeightMm = computed.letterHeightMm || 0;
  const safeDepthMm = (!rawDepthMm || isNaN(rawDepthMm) || rawDepthMm < 20) ? 50 : rawDepthMm;

  // Presná výška objektu v 3D jednotkách (bez korekcie)
  let baseHeight: number;
  if (facadeHeightMm && letterHeightMm > 0) {
    // Kalibrácia existuje → PRESNÝ prepočet mm → 3D jednotky, žiadny % cap
    baseHeight = (letterHeightMm / facadeHeightMm) * wallH;
  } else if (letterHeightMm > 0) {
    // Bez kalibrácie → odhad (predpoklad fasáda = 3m)
    baseHeight = (letterHeightMm / 3000) * wallH;
  } else {
    baseHeight = wallH * 0.08;
  }
  baseHeight = Math.max(wallH * 0.01, baseHeight);

  // Text3D používa font size (EM-square), CSS font-size = výška * 0.85
  // Logo nepoužíva font korekciu — výška = presná hodnota z nastavenia
  const letterHeight = contentType === 'logo_only'
    ? baseHeight                  // Logo: presná výška bez korekcie
    : baseHeight * 0.85;          // Text: korekcia pre EM-square vs cap-height

  // Hĺbka extruzie proporčne k výške písmen
  // Kľúčové: hĺbka nesmie byť príliš veľká voči výške písmen
  const extrudeDepth = facadeHeightMm
    ? (safeDepthMm / facadeHeightMm) * wallH
    : letterHeight * (safeDepthMm / Math.max(letterHeightMm, 200));
  // Obmedzenie: max 0.6× výšky písmena (vizuálne rozumné na fasáde)
  const safeExtrudeDepth = Math.max(0.01, Math.min(extrudeDepth, letterHeight * 0.6));

  // ── Pozícia na stene (mapovanie z 2D pozície) ──
  const posX = (position.x - 0.5) * wallW;
  const posY = (0.5 - position.y) * wallH;
  const posZ = 0.02;

  const bevelEnabled = profileType !== 'flat';
  const bevelSize = profileType === 'rounded'
    ? letterHeight * 0.03
    : profileType === 'chamfer'
      ? letterHeight * 0.02
      : 0;
  const bevelThickness = bevelSize * 0.8;

  const showText = contentType !== 'logo_only';
  const showLogo = contentType !== 'text_only' && !!(logo.svgUrl || logo.rasterUrl);

  // Materiály: group 0 = čelo/zadok (faceColor), group 1 = bočnice (sideColor)
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ color: faceColor, metalness: 0.15, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: sideColor, metalness: 0.2, roughness: 0.4 }),
  ], [faceColor, sideColor]);

  return (
    <group position={[posX, posY, posZ]}>
      {/* 3D text – SafeText3D s fontom načítaným z TTF (HMR-safe) */}
      {showText && font3D && (
        <Center>
          <SafeText3D
            font={font3D.data}
            size={letterHeight}
            height={safeExtrudeDepth}
            bevelEnabled={bevelEnabled}
            bevelThickness={Math.min(bevelThickness, letterHeight * 0.08)}
            bevelSize={Math.min(bevelSize, letterHeight * 0.08)}
            bevelSegments={bevelEnabled ? 3 : 1}
            letterSpacing={0.02}
            curveSegments={16}
            material={materials}
          >
            {text}
          </SafeText3D>
        </Center>
      )}

      {/* SVG Logo – 3D extrudované (using SVGLoader), s fallback na flat image */}
      {showLogo && logo.svgContent && !logo.extrudeAsRelief && (
        <SVGLogo3DWithFallback
          svgContent={logo.svgContent}
          faceColor={faceColor}
          sideColor={sideColor}
          depth={safeExtrudeDepth}
          height={letterHeight}
          logoScale={logo.logoScale}
          placement={showText ? logo.logoPlacement : 'standalone'}
          textHeight={letterHeight}
          aspectRatio={
            logo.originalWidth && logo.originalHeight
              ? logo.originalWidth / logo.originalHeight
              : 1
          }
        />
      )}

      {/* Raster/relief logo panel (PNG/JPG, or SVG fallback as image) */}
      {showLogo && (logo.rasterUrl || (logo.svgUrl && logo.extrudeAsRelief)) && (
        <LogoPanel
          imageUrl={logo.svgUrl || logo.rasterUrl}
          svgContent={logo.extrudeAsRelief ? logo.svgContent : null}
          rasterFile={logo.rasterFile}
          faceColor={faceColor}
          depth={logo.extrudeAsRelief ? (logo.reliefDepthMm / (facadeHeightMm || 3000)) * wallH : safeExtrudeDepth}
          height={letterHeight}
          logoScale={logo.logoScale}
          aspectRatio={
            logo.originalWidth && logo.originalHeight
              ? logo.originalWidth / logo.originalHeight
              : 1
          }
          placement={showText ? logo.logoPlacement : 'standalone'}
          textHeight={letterHeight}
        />
      )}

      {/* Svetelné efekty */}
      <SignLighting
        lightingType={lightingType}
        ledColor={ledColor}
        textWidth={text.length * letterHeight * 0.65}
        height={letterHeight}
        depth={safeExtrudeDepth}
      />
    </group>
  );
}

// ──────────────────────────────────────────────
// Svetelné efekty reklamy – realistické LED
// ──────────────────────────────────────────────

function SignLighting({
  lightingType,
  ledColor,
  textWidth,
  height,
  depth,
}: {
  lightingType: string;
  ledColor: string;
  textWidth: number;
  height: number;
  depth: number;
}) {
  // LED farba → hex
  const ledHex = ledColor === 'cool_white' ? '#e0eaff' : ledColor === 'rgb' ? '#ff6b9d' : '#fff3cd';

  if (lightingType === 'none') return null;

  const w = textWidth;
  const h = height;
  const isFront = lightingType === 'front' || lightingType === 'front_halo';
  const isHalo = lightingType === 'halo' || lightingType === 'front_halo';

  return (
    <group>
      {/* FRONT-LIT: jemné bodové svetlá pred písmenami */}
      {isFront && (
        <>
          <pointLight position={[0, 0, depth + 0.3]} intensity={1.5} color={ledHex} distance={3} decay={2} />
          <pointLight position={[-w * 0.35, 0, depth + 0.2]} intensity={0.5} color={ledHex} distance={2} decay={2} />
          <pointLight position={[w * 0.35, 0, depth + 0.2]} intensity={0.5} color={ledHex} distance={2} decay={2} />
        </>
      )}

      {/* HALO: bodové svetlá za písmenami → jemná žiara na stene */}
      {isHalo && (
        <>
          <pointLight position={[0, 0, -0.08]} intensity={2} color={ledHex} distance={2.5} decay={2} />
          <pointLight position={[-w * 0.3, 0, -0.06]} intensity={0.8} color={ledHex} distance={1.8} decay={2} />
          <pointLight position={[w * 0.3, 0, -0.06]} intensity={0.8} color={ledHex} distance={1.8} decay={2} />
          <pointLight position={[0, h * 0.35, -0.06]} intensity={0.5} color={ledHex} distance={1.5} decay={2} />
          <pointLight position={[0, -h * 0.35, -0.06]} intensity={0.5} color={ledHex} distance={1.5} decay={2} />
        </>
      )}
    </group>
  );
}

// ──────────────────────────────────────────────
// SVG Logo → 3D  (using three-stdlib SVGLoader)
// s fallback na flat image ak 3D extrúzia zlyhá
// ──────────────────────────────────────────────

interface SVGMeshData {
  shape: THREE.Shape;
  color: string;
}

/**
 * Wrapper: pokúsi sa o 3D extrúziu SVG.
 * Ak SVGLoader neparsne nič (alebo crash), zobrazí flat image fallback.
 */
function SVGLogo3DWithFallback(props: {
  svgContent: string;
  faceColor: string;
  sideColor: string;
  depth: number;
  height: number;
  logoScale: number;
  placement: string;
  textHeight: number;
  aspectRatio: number;
}) {
  const [has3DShapes, setHas3DShapes] = useState<boolean | null>(null); // null = still parsing

  return (
    <>
      <SVGLogo3D {...props} onShapesResolved={setHas3DShapes} />
      {/* Flat image fallback – len ak 3D extrúzia zlyhala alebo nevyprodukovala nič */}
      {has3DShapes === false && (
        <SVGImagePlane
          svgContent={props.svgContent}
          height={props.height}
          logoScale={props.logoScale}
          aspectRatio={props.aspectRatio}
          placement={props.placement}
          textHeight={props.textHeight}
          depth={props.depth}
        />
      )}
    </>
  );
}

function SVGLogo3D({
  svgContent,
  faceColor,
  sideColor,
  depth,
  height,
  logoScale,
  placement,
  textHeight,
  onShapesResolved,
}: {
  svgContent: string;
  faceColor: string;
  sideColor: string;
  depth: number;
  height: number;
  logoScale: number;
  placement: string;
  textHeight: number;
  onShapesResolved?: (hasShapes: boolean) => void;
}) {
  // Parse SVG using three-stdlib SVGLoader (handles transforms, groups, complex paths)
  const parsed = useMemo(() => {
    if (!svgContent || svgContent.length < 10) {
      console.warn('[SVGLogo3D] Empty or too short SVG content');
      return null;
    }
    try {
      const loader = new SVGLoader();
      const result = loader.parse(svgContent);
      console.log(`[SVGLogo3D] Parsed: ${result.paths.length} paths`);
      return result;
    } catch (err) {
      console.warn('[SVGLogo3D] SVGLoader.parse failed:', err);
      return null;
    }
  }, [svgContent]);

  // Get viewBox dimensions
  const viewBoxInfo = useMemo(() => {
    if (!parsed?.xml) return { w: 100, h: 100 };
    try {
      const el = parsed.xml.documentElement;
      const vbAttr = el?.getAttribute('viewBox');
      if (vbAttr) {
        const parts = vbAttr.split(/[\s,]+/).map(Number);
        return { w: parts[2] || 100, h: parts[3] || 100 };
      }
      const w = parseFloat(el?.getAttribute('width') || '100');
      const h = parseFloat(el?.getAttribute('height') || '100');
      return { w: w || 100, h: h || 100 };
    } catch {
      return { w: 100, h: 100 };
    }
  }, [parsed]);

  // Build extrudable shapes from SVG paths, preserving per-path fill colors
  const meshDataList = useMemo((): SVGMeshData[] => {
    if (!parsed) return [];

    const result: SVGMeshData[] = [];
    const vbArea = viewBoxInfo.w * viewBoxInfo.h;

    try {
      for (const path of parsed.paths) {
        const style = path.userData?.style;
        const fillColor = style?.fill;

        // Skip invisible / no-fill paths
        if (fillColor === 'none' || style?.fillOpacity === '0' || style?.visibility === 'hidden') continue;

        // Use path.color (THREE.Color set from fill) for reliable color matching
        const pathColorHex = '#' + (path.color?.getHexString?.() || 'ffffff');

        let shapes: THREE.Shape[];
        try {
          shapes = SVGLoader.createShapes(path);
        } catch (err) {
          console.warn('SVGLoader.createShapes failed for path:', err);
          continue;
        }

        for (const shape of shapes) {
          // Heuristic: skip large background rectangles (>85 % of viewBox area)
          try {
            const pts = shape.getPoints(8);
            if (pts.length >= 3) {
              let a = 0;
              for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
              }
              const shapeArea = Math.abs(a / 2);
              // Skip large background rects (white/near-white fills covering >85% area)
              if (shapeArea > vbArea * 0.85) {
                const c = path.color;
                const isWhitish = c && c.r > 0.9 && c.g > 0.9 && c.b > 0.9;
                if (isWhitish) continue; // skip white background
              }
            }
          } catch {
            // ignore area calc errors
          }

          const col =
            !fillColor || fillColor === 'inherit' || fillColor === ''
              ? faceColor
              : pathColorHex;

          result.push({ shape, color: col });
        }
      }
    } catch (err) {
      console.warn('SVG shape processing failed:', err);
    }

    return result;
  }, [parsed, faceColor, viewBoxInfo]);

  // ── Compute ACTUAL bounding box of all shapes (not relying on viewBox metadata) ──
  const actualBounds = useMemo(() => {
    if (meshDataList.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100, w: 100, h: 100 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { shape } of meshDataList) {
      try {
        const pts = shape.getPoints(16);
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        // Also check holes
        if (shape.holes) {
          for (const hole of shape.holes) {
            const hPts = hole.getPoints(16);
            for (const p of hPts) {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            }
          }
        }
      } catch { /* ignore */ }
    }

    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100, w: 100, h: 100 };
    const w = Math.max(0.001, maxX - minX);
    const h = Math.max(0.001, maxY - minY);
    return { minX, minY, maxX, maxY, w, h };
  }, [meshDataList]);

  // Notify parent whether we have valid 3D shapes
  useEffect(() => {
    console.log(`[SVGLogo3D] Shapes resolved: ${meshDataList.length} shapes, viewBox: ${viewBoxInfo.w}×${viewBoxInfo.h}, actual bounds: ${actualBounds.w.toFixed(1)}×${actualBounds.h.toFixed(1)}`);
    onShapesResolved?.(meshDataList.length > 0);
  }, [meshDataList.length, onShapesResolved, viewBoxInfo, actualBounds]);

  if (meshDataList.length === 0) return null;

  // ── Scale based on ACTUAL shape bounds (robust, ignores viewBox inaccuracies) ──
  const svgScale = (height * logoScale) / Math.max(actualBounds.h, 0.001);
  const pos = getLogoPosition(placement, textHeight, height * logoScale);

  // Hĺbka v SVG priestore – musí sa prenásobiť svgScale v Z osi
  // depth je v 3D scene units, depth/svgScale je v SVG units
  // Potom group scale [svgScale, -svgScale, svgScale] to vráti späť
  const svgDepth = Math.max(0.5, depth / svgScale);

  // Center using actual shape bounds center (not viewBox metadata)
  const centerX = (actualBounds.minX + actualBounds.maxX) / 2;
  const centerY = (actualBounds.minY + actualBounds.maxY) / 2;

  return (
    <group position={pos} scale={[svgScale, -svgScale, svgScale]}>
      {/* Center relative to actual content bounds */}
      <group position={[-centerX, -centerY, 0]}>
        {meshDataList.map((m, i) => (
          <SVGShapeMesh
            key={i}
            shape={m.shape}
            faceColor={faceColor}
            sideColor={sideColor}
            depth={svgDepth}
          />
        ))}
      </group>
    </group>
  );
}

/**
 * Bezpečný mesh pre jednu SVG shape – ak extrudeGeometry zlyhá,
 * nevyhodí error do celého stromu.
 */
function SVGShapeMesh({ shape, faceColor, sideColor, depth }: { shape: THREE.Shape; faceColor: string; sideColor: string; depth: number }) {
  const geometry = useMemo(() => {
    try {
      return new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.1, depth),
        bevelEnabled: false,
      });
    } catch (err) {
      console.warn('ExtrudeGeometry failed for SVG shape:', err);
      return null;
    }
  }, [shape, depth]);

  // Material array: group 0 = front/back faces (faceColor), group 1 = sides (sideColor)
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ color: faceColor, metalness: 0.15, roughness: 0.3, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: sideColor, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide }),
  ], [faceColor, sideColor]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} material={materials} />
  );
}

// ──────────────────────────────────────────────
// Logo panel (raster/relief – PNG/JPG or SVG as image)
// ──────────────────────────────────────────────

function LogoPanel({
  imageUrl,
  svgContent,
  rasterFile,
  faceColor,
  depth,
  height,
  logoScale,
  aspectRatio,
  placement,
  textHeight,
}: {
  imageUrl: string | null;
  svgContent: string | null;
  rasterFile: File | null;
  faceColor: string;
  depth: number;
  height: number;
  logoScale: number;
  aspectRatio: number;
  placement: string;
  textHeight: number;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    if (!imageUrl && !svgContent && !rasterFile) {
      setTexture(null);
      return;
    }

    let cancelled = false;

    function applyTexture(img: HTMLImageElement) {
      if (cancelled) return;
      const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
          setTexture(tex);
      invalidate();
    }

    if (svgContent) {
      // SVG → data URL (no blob URL issues, works reliably)
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);
      const img = document.createElement('img');
      img.onload = () => applyTexture(img);
      img.onerror = () => console.warn('Logo SVG data-url load failed');
      img.src = dataUrl;
    } else if (rasterFile) {
      // Raster file → FileReader → data URL (reliable, same as FacadeWall)
      const reader = new FileReader();
      reader.onload = (e) => {
        if (cancelled || !e.target?.result) return;
        const img = document.createElement('img');
        img.onload = () => applyTexture(img);
        img.src = e.target.result as string;
      };
      reader.readAsDataURL(rasterFile);
    } else if (imageUrl) {
      // Fallback: direct URL load
      const img = document.createElement('img');
      img.onload = () => applyTexture(img);
      img.onerror = () => console.warn('Logo image URL load failed');
      img.src = imageUrl;
    }

    return () => { cancelled = true; };
  }, [imageUrl, svgContent, rasterFile, invalidate]);

  const panelH = height * logoScale;
  const panelW = panelH * aspectRatio;
  const pos = getLogoPosition(placement, textHeight, panelH);

  return (
    <group position={pos}>
      {/* Colored backing panel */}
      <RoundedBox args={[panelW, panelH, depth]} radius={0.015} smoothness={4}>
        <meshStandardMaterial color={faceColor} metalness={0.15} roughness={0.35} />
      </RoundedBox>
      {/* Logo image on front */}
      {texture && (
        <mesh position={[0, 0, depth / 2 + 0.002]}>
          <planeGeometry args={[panelW * 0.9, panelH * 0.9]} />
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

// ──────────────────────────────────────────────
// SVG image plane – flat transparent image fallback
// Renders SVG as a texture plane in front of the 3D logo
// so the logo is always visible even if extrusion fails
// ──────────────────────────────────────────────

function SVGImagePlane({
  svgContent,
  height,
  logoScale,
  aspectRatio,
  placement,
  textHeight,
  depth,
}: {
  svgContent: string;
  height: number;
  logoScale: number;
  aspectRatio: number;
  placement: string;
  textHeight: number;
  depth: number;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    if (!svgContent) return;
    let cancelled = false;

    // Ensure SVG has proper dimensions for <img> rendering
    let safeSvg = svgContent;
    if (!safeSvg.includes('xmlns')) {
      safeSvg = safeSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Convert SVG content to a data URL and load as texture
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(safeSvg);
    const img = document.createElement('img');
    img.onload = () => {
      if (cancelled) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      setTexture(tex);
      invalidate();
    };
    img.onerror = () => console.warn('[SVGImagePlane] Failed to load SVG as image');
    img.src = dataUrl;

    return () => { cancelled = true; };
  }, [svgContent, invalidate]);

  const panelH = height * logoScale;
  const panelW = panelH * aspectRatio;
  const pos = getLogoPosition(placement, textHeight, panelH);

  if (!texture) return null;

  return (
    <group position={pos}>
      {/* Flat transparent plane with SVG image – shown in front of 3D extrusion */}
      <mesh position={[0, 0, depth + 0.005]}>
        <planeGeometry args={[panelW, panelH]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ──────────────────────────────────────────────
// Pozícia loga
// ──────────────────────────────────────────────

function getLogoPosition(
  placement: string,
  textHeight: number,
  logoHeight: number,
): [number, number, number] {
  switch (placement) {
    case 'above_text':
      return [0, textHeight / 2 + logoHeight / 2 + 0.12, 0];
    case 'below_text':
      return [0, -textHeight / 2 - logoHeight / 2 - 0.12, 0];
    case 'left_of_text':
      return [-2.5, 0, 0];
    case 'right_of_text':
      return [2.5, 0, 0];
    case 'behind_text':
      return [0, 0, -0.2];
    default:
      return [0, 0, 0];
  }
}

// ──────────────────────────────────────────────
// GL dispose on unmount (gentle – no forceContextLoss)
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Auto-fit kamera: prispôsobí pozíciu kamery tak,
// aby celá stena bola viditeľná (object-contain)
// ──────────────────────────────────────────────

function AutoFitCamera() {
  const { camera, size } = useThree();
  const photoW = useConfiguratorStore((s) => s.photo.width);
  const photoH = useConfiguratorStore((s) => s.photo.height);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const rawAspect = photoW && photoH ? photoW / photoH : 16 / 10;
    const wallAspect = (!rawAspect || isNaN(rawAspect) || rawAspect <= 0) ? 1.6 : rawAspect;
    const wallH = 6;
    const wallW = wallH * wallAspect;

    const fovRad = camera.fov * Math.PI / 180;
    const canvasAspect = size.width / size.height;

    let z: number;
    if (canvasAspect >= wallAspect) {
      // Canvas je širší ako stena → fit podľa výšky
      z = (wallH / 2) / Math.tan(fovRad / 2);
    } else {
      // Canvas je užší ako stena → fit podľa šírky
      z = (wallW / 2) / (Math.tan(fovRad / 2) * canvasAspect);
    }

    // Malý margin aby stena nebola úplne tesne na hranách
    z *= 1.05;

    camera.position.set(0, 0, z);
    camera.updateProjectionMatrix();
  }, [camera, size, photoW, photoH]);

  return null;
}

// ──────────────────────────────────────────────
// Adaptívne osvetlenie scény (stlmené pri LED)
// ──────────────────────────────────────────────

function AdaptiveSceneLights() {
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const isLit = lightingType !== 'none';

  return (
    <>
      {/* Svetlá pre scénu – vždy rovnaké, aby farby písmen sedeli */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 8]} intensity={1.2} color="#ffeedd" />
      <directionalLight position={[-5, 3, 3]} intensity={0.4} color="#b3d4fc" />
      <directionalLight position={[0, 2, 5]} intensity={0.5} color="#ffffff" />
    </>
  );
}

// ──────────────────────────────────────────────
// Exported Scene3D
// ──────────────────────────────────────────────

export default function Scene3D() {
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

  // Automatický retry po 1.5s pri prvom context loss
  useEffect(() => {
    if (contextLost && retryCount < 2) {
      const timer = setTimeout(() => {
        handleRetry();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [contextLost, retryCount, handleRetry]);

  // Keď sa kontext stratí, OKAMŽITE odpojiť Canvas (zastaviť render loop)
  if (contextLost) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0f0f0f] rounded-2xl min-h-[400px]">
        <div className="text-center p-8">
          {retryCount >= 2 ? (
            <>
          <div className="text-5xl mb-4">🖥️</div>
              <p className="text-white font-medium mb-2">3D náhľad nie je dostupný</p>
              <p className="text-slate-500 text-sm mb-4 max-w-sm">
                Prehliadač nemá dostatok WebGL kontextov. Skúste zavrieť iné taby alebo reštartovať prehliadač.
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
    <Scene3DErrorBoundary>
      <Canvas
        key={canvasKey}
        camera={{
          position: [0, 0, 8],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
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
        {/* Auto-fit: kamera sa prispôsobí tak aby celá fasáda vyplnila viewport */}
        <AutoFitCamera />
        <color attach="background" args={['#0a0a0a']} />

        {/* Dynamické scénové svetlá – stlmené pri aktívnom LED */}
        <AdaptiveSceneLights />

        <Suspense fallback={<CanvasLoader />}>
          <FacadeWall />
          <Sign3D />
        </Suspense>

        {/* Orbit – voľné otáčanie okolo fotky */}
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          target={[0, 0, 0]}
          maxPolarAngle={Math.PI * 0.85}
          minPolarAngle={Math.PI * 0.15}
          minDistance={1.5}
          maxDistance={15}
          enablePan
        />
      </Canvas>
    </Scene3DErrorBoundary>
  );
}

