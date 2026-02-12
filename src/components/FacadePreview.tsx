'use client';

/**
 * FacadePreview – vizualizácia nápisu / loga priamo na fotke fasády
 *
 * Funkcie:
 * - Fotka fasády ako pozadie
 * - Text + logo overlay v správnej veľkosti (podľa škálovacej kalibrácie)
 * - Drag & drop presun nápisu po fotke (mouse + touch)
 * - 3D efekt textu cez CSS (viacvrstvový text-shadow pre hĺbku, bočnú farbu)
 * - Svetelné efekty (glow / halo) cez CSS text-shadow + filter
 * - Overlay s rozmermi (šírka × výška × hĺbka) – kóty priamo pri texte
 * - Font z Google Fonts (rovnaký ako vo FontSelector)
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useConfiguratorStore } from '@/stores/configurator-store';
import { svgToTransparentPngUrl, svgToDataUrl, recolorSVG } from '@/lib/svg-utils';

// Google Fonts – rovnaké ako FontSelector
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@700&family=Bebas+Neue&family=Oswald:wght@700&family=Poppins:wght@900&family=Roboto:wght@700&family=Inter:wght@700&family=Raleway:wght@900&family=Archivo+Black&family=Outfit:wght@700&family=Barlow:wght@700&display=swap';

/** Pomocná funkcia – tmavší odtieň pre bočnú farbu (3D efekt) */
function darkenColor(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * factor));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * factor));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * factor));
  return `rgb(${r},${g},${b})`;
}

export default function FacadePreview() {
  const photo = useConfiguratorStore((s) => s.photo);
  const text = useConfiguratorStore((s) => s.text);
  const fontFamily = useConfiguratorStore((s) => s.fontFamily);
  const faceColor = useConfiguratorStore((s) => s.faceColor);
  const sideColor = useConfiguratorStore((s) => s.sideColor);
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const computed = useConfiguratorStore((s) => s.computed);
  const scale = useConfiguratorStore((s) => s.scale);
  const position = useConfiguratorStore((s) => s.position);
  const setPosition = useConfiguratorStore((s) => s.setPosition);
  const depthMm = useConfiguratorStore((s) => s.depthMm);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [textWidth, setTextWidth] = useState(0);

  // Načítaj Google Fonts (ak ešte nie sú)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gf-configurator')) return;
    const link = document.createElement('link');
    link.id = 'gf-configurator';
    link.rel = 'stylesheet';
    link.href = FONTS_URL;
    document.head.appendChild(link);
  }, []);

  // Meranie šírky textu pre dimension overlay
  useEffect(() => {
    if (textRef.current) {
      setTextWidth(textRef.current.offsetWidth);
    }
  }, [text, fontFamily]);

  // ──────────────────────────────────────────
  // Výpočet veľkosti textu v display pixeloch
  // ──────────────────────────────────────────

  const getSignMetrics = useCallback(() => {
    const img = imgRef.current;
    if (!img || !imgLoaded) {
      return { fontSize: 48, logoH: 60 };
    }

    // Správna mierka pre object-fit:contain
    // (min z oboch osí, aby výška aj šírka sedeli)
    const scaleX = img.clientWidth / (photo.width || 1);
    const scaleY = img.clientHeight / (photo.height || 1);
    const displayScale = Math.min(scaleX, scaleY);

    const letterHeightMm = computed.letterHeightMm || 200;
    const factorPxToMm = scale.factorPxToMm;

    let letterHeightDisplayPx: number;
    if (factorPxToMm && factorPxToMm > 0) {
      // Kalibrácia existuje → PRESNÝ prepočet mm → px
      // letterHeightMm je VÝŠKA nastavená používateľom
      const letterHeightImgPx = letterHeightMm / factorPxToMm;
      letterHeightDisplayPx = letterHeightImgPx * displayScale;
      // Len minimálny guard
      letterHeightDisplayPx = Math.max(8, letterHeightDisplayPx);
    } else {
      // Bez kalibrácie → odhad z % výšky obrázka
      letterHeightDisplayPx = img.clientHeight * 0.12;
      letterHeightDisplayPx = Math.max(16, Math.min(letterHeightDisplayPx, img.clientHeight * 0.8));
    }

    return {
      fontSize: letterHeightDisplayPx * 0.85,
      logoH: letterHeightDisplayPx * logo.logoScale,
    };
  }, [photo.width, photo.height, computed.letterHeightMm, scale.factorPxToMm, logo.logoScale, imgLoaded]);

  // ──────────────────────────────────────────
  // 3D text shadow (hĺbka cez viacvrstvové text-shadow)
  // ──────────────────────────────────────────

  const build3DShadow = useMemo(() => {
    return (fs: number): string => {
      const result: string[] = [];

      // Počet vrstiev hĺbky – proporčne k hĺbke (depthMm) a fontSize
      const depthPx = Math.max(2, Math.min(fs * 0.14, (depthMm / 50) * fs * 0.1));
      const layers = Math.max(4, Math.min(18, Math.round(depthPx)));
      const sideColorDark = darkenColor(sideColor, 0.55);
      const sideColorMid = darkenColor(sideColor, 0.7);

      // 3D extrúzia – vrstvy smerom dolu-vpravo (simulácia hĺbky / perspektívy)
      for (let i = 1; i <= layers; i++) {
        const t = i / layers;
        const x = t * depthPx * 0.3;
        const y = t * depthPx;
        const color = i < layers * 0.5 ? sideColorMid : sideColorDark;
        result.push(`${x.toFixed(1)}px ${y.toFixed(1)}px 0px ${color}`);
      }

      // Tieň pod 3D textom (dopad na fasádu)
      const shadowDist = depthPx * 1.5;
      result.push(`${shadowDist * 0.5}px ${shadowDist}px ${shadowDist * 0.8}px rgba(0,0,0,0.35)`);

      // Stroke (bočná farba obrys)
      if (sideColor !== faceColor) {
        const s = Math.max(0.5, fs * 0.008);
        result.push(
          `${s}px 0 0 ${sideColor}`,
          `-${s}px 0 0 ${sideColor}`,
          `0 ${s}px 0 ${sideColor}`,
          `0 -${s}px 0 ${sideColor}`,
        );
      }

      // Front glow
      if (lightingType === 'front' || lightingType === 'front_halo') {
        const g = fs * 0.12;
        result.push(
          `0 0 ${g}px ${faceColor}aa`,
          `0 0 ${g * 2}px ${faceColor}55`,
          `0 0 ${g * 3}px ${faceColor}22`,
        );
      }

      // Halo glow (za textom)
      if (lightingType === 'halo' || lightingType === 'front_halo') {
        const g = fs * 0.18;
        result.push(
          `0 0 ${g}px #FFD700bb`,
          `0 0 ${g * 2}px #FFD70077`,
          `0 0 ${g * 3.5}px #FFD70033`,
        );
      }

      return result.join(', ');
    };
  }, [depthMm, sideColor, faceColor, lightingType]);

  // ──────────────────────────────────────────
  // Drag – pointer events
  // ──────────────────────────────────────────

  const toNorm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0.5, y: 0.5 };
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const norm = toNorm(e.clientX, e.clientY);
      dragOffset.current = {
        x: norm.x - position.x,
        y: norm.y - position.y,
      };
      setIsDragging(true);
    },
    [position, toNorm],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const norm = toNorm(e.clientX, e.clientY);
      setPosition({
        x: Math.max(0.05, Math.min(0.95, norm.x - dragOffset.current.x)),
        y: Math.max(0.05, Math.min(0.95, norm.y - dragOffset.current.y)),
      });
    },
    [isDragging, toNorm, setPosition],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ──────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────

  if (!photo.url) {
    return (
      <div className="w-full flex items-center justify-center min-h-[400px] bg-[#111] rounded-2xl">
        <p className="text-slate-500">Najprv nahrajte fotku fasády</p>
      </div>
    );
  }

  const { fontSize, logoH } = getSignMetrics();
  const showText = contentType !== 'logo_only' && text.length > 0;
  const showLogo =
    contentType !== 'text_only' && !!(logo.svgUrl || logo.rasterUrl || logo.svgContent);

  // SVG: renderovanie do PNG s transparentným pozadím (spoľahlivé pre všetky SVG)
  // + aplikácia faceColor na všetky výplne SVG
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  useEffect(() => {
    if (logo.svgContent) {
      // Recoloruj SVG na faceColor (predná strana)
      const recolored = recolorSVG(logo.svgContent, faceColor);
      // Najprv ukáž SVG data URL (rýchle), potom nahraď transparentným PNG
      setLogoSrc(svgToDataUrl(recolored));
      svgToTransparentPngUrl(recolored).then((pngUrl) => {
        setLogoSrc(pngUrl);
      });
    } else {
      setLogoSrc(logo.svgUrl || logo.rasterUrl || null);
    }
  }, [logo.svgContent, logo.svgUrl, logo.rasterUrl, faceColor]);

  const textShadow3D = build3DShadow(fontSize);

  // Rozmery pre overlay
  const letterHeightMm = computed.letterHeightMm || 0;
  const showDimensions = letterHeightMm > 0;
  // Odhad šírky celého objektu v mm
  const estimatedWidthMm = (() => {
    if (letterHeightMm <= 0) return 0;

    // Logo only → šírka podľa aspect ratio loga (celý objekt)
    if (contentType === 'logo_only' && logo.originalWidth > 0 && logo.originalHeight > 0) {
      return Math.round(letterHeightMm * (logo.originalWidth / logo.originalHeight) * logo.logoScale);
    }

    // Text → šírka podľa renderovanej šírky textu
    if (fontSize > 0 && textWidth > 0) {
      return Math.round((textWidth / (fontSize / 0.85)) * letterHeightMm);
    }

    return 0;
  })();

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl bg-black select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Fotka */}
      <img
        ref={imgRef}
        src={photo.url}
        alt="Fasáda"
        className="w-full max-h-[600px] object-contain pointer-events-none"
        draggable={false}
        onLoad={() => setImgLoaded(true)}
      />

      {/* ── Nápis overlay ── */}
      {imgLoaded && (showText || showLogo) && (
        <div
          className={`absolute z-10 transition-shadow ${
            isDragging ? 'ring-2 ring-[#f59e0b]/60 rounded-lg' : ''
          }`}
          style={{
            left: `${position.x * 100}%`,
            top: `${position.y * 100}%`,
            transform: 'translate(-50%, -50%)',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* === Logo-only: vždy zobraziť logo na stred === */}
          {showLogo && !showText && logoSrc && (
            <LogoImg
              src={logoSrc}
              height={logoH}
              lightingType={lightingType}
              faceColor={faceColor}
              depth3d={depthMm}
              sideColor={sideColor}
              centered
            />
          )}

          {/* Logo nad textom */}
          {showLogo && showText && logo.logoPlacement === 'above_text' && logoSrc && (
              <LogoImg
              src={logoSrc}
                height={logoH}
                lightingType={lightingType}
                faceColor={faceColor}
              depth3d={depthMm}
              sideColor={sideColor}
              centered
              />
            )}

          {/* Riadok s textom + prípadné logo vľavo/vpravo */}
          <div className="flex items-center gap-1">
            {showLogo && showText && logo.logoPlacement === 'left_of_text' && logoSrc && (
              <LogoImg
                src={logoSrc}
                height={logoH}
                lightingType={lightingType}
                faceColor={faceColor}
                depth3d={depthMm}
                sideColor={sideColor}
              />
            )}

            {/* Text s 3D efektom */}
            {showText && (
              <div
                ref={textRef}
                style={{
                  fontFamily: `'${fontFamily}', sans-serif`,
                  fontSize: `${fontSize}px`,
                  fontWeight: 700,
                  color: faceColor,
                  textShadow: textShadow3D,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.1,
                  letterSpacing: '0.02em',
                  userSelect: 'none',
                  // Jemný border pre lepší kontrast na fasáde
                  WebkitTextStroke:
                    sideColor !== faceColor ? `0.5px ${sideColor}` : undefined,
                }}
              >
                {text}
              </div>
            )}

            {/* Logo vpravo */}
            {showLogo && showText && logo.logoPlacement === 'right_of_text' && logoSrc && (
              <LogoImg
                src={logoSrc}
                height={logoH}
                lightingType={lightingType}
                faceColor={faceColor}
                depth3d={depthMm}
                sideColor={sideColor}
              />
            )}
          </div>

          {/* Logo pod textom */}
          {showLogo && showText && logo.logoPlacement === 'below_text' && logoSrc && (
            <LogoImg
              src={logoSrc}
              height={logoH}
              lightingType={lightingType}
              faceColor={faceColor}
              depth3d={depthMm}
              sideColor={sideColor}
              centered
            />
          )}

          {/* ── Kóty (dimension lines) priamo pri texte ── */}
          {showDimensions && showText && !isDragging && (
            <DimensionLines
              widthMm={estimatedWidthMm}
              heightMm={letterHeightMm}
              depthMm={depthMm}
              fontSize={fontSize}
              textWidth={textWidth}
            />
          )}
        </div>
      )}

      {/* Hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <span className="text-xs text-white/70 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-lg">
          ✋ Ťahaj nápis pre umiestnenie na fasáde
        </span>
      </div>

      {/* Mierka info */}
      {scale.factorPxToMm && (
        <div className="absolute top-3 right-3 z-20 pointer-events-none">
          <span className="text-xs text-white/60 bg-black/50 backdrop-blur-sm px-2 py-1 rounded">
            📏 {scale.factorPxToMm.toFixed(2)} mm/px
          </span>
        </div>
      )}

      {/* Rozmery info badge – ľavý horný roh */}
      {showDimensions && (
        <div className="absolute top-3 left-3 z-20 pointer-events-none">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-white/80 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 rounded flex items-center gap-1.5">
              <span className="text-amber-400">📐</span>
              <b>{letterHeightMm}</b>
              <span className="text-white/50">×</span>
              {estimatedWidthMm > 0 ? <b>{estimatedWidthMm}</b> : <span className="text-white/40">—</span>}
              <span className="text-white/50">×</span>
              <b>{depthMm}</b>
              <span className="text-white/40 ml-0.5">mm</span>
            </span>
            <span className="text-[10px] text-white/40 bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded">
              V × Š × H
          </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────
// Dimension lines (kóty) overlay
// ──────────────────────────────────────────

function DimensionLines({
  widthMm,
  heightMm,
  depthMm,
  fontSize,
  textWidth,
}: {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  fontSize: number;
  textWidth: number;
}) {
  const textHeightPx = fontSize * 1.1; // približná výška textu v px
  const lineColor = 'rgba(255,255,255,0.5)';
  const labelBg = 'rgba(0,0,0,0.7)';
  const offset = 8; // odsadenie čiar od textu

  return (
    <div className="pointer-events-none" style={{ position: 'absolute', inset: 0 }}>
      {/* ── Horizontálna kóta (šírka) – nad textom ── */}
      {widthMm > 0 && textWidth > 0 && (
        <div
          style={{
            position: 'absolute',
            top: -offset - 14,
            left: '50%',
            transform: 'translateX(-50%)',
            width: textWidth,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* Stredová čiara */}
          <div
            style={{
              width: '100%',
              height: 1,
              backgroundColor: lineColor,
              position: 'relative',
            }}
          >
            {/* Ľavá zarážka */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: -3,
                width: 1,
                height: 7,
                backgroundColor: lineColor,
              }}
            />
            {/* Pravá zarážka */}
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: -3,
                width: 1,
                height: 7,
                backgroundColor: lineColor,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.7)',
              backgroundColor: labelBg,
              padding: '1px 4px',
              borderRadius: 3,
              marginTop: 1,
              whiteSpace: 'nowrap',
            }}
          >
            ↔ ~{widthMm} mm
          </span>
        </div>
      )}

      {/* ── Vertikálna kóta (výška) – vpravo od textu ── */}
      <div
        style={{
          position: 'absolute',
          right: -offset - 36,
          top: '50%',
          transform: 'translateY(-50%)',
          height: textHeightPx,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
        }}
      >
        {/* Vertikálna čiara */}
        <div
          style={{
            width: 1,
            height: '100%',
            backgroundColor: lineColor,
            position: 'relative',
          }}
        >
          {/* Horná zarážka */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: -3,
              width: 7,
              height: 1,
              backgroundColor: lineColor,
            }}
          />
          {/* Dolná zarážka */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: -3,
              width: 7,
              height: 1,
              backgroundColor: lineColor,
            }}
          />
        </div>
        <span
          style={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.7)',
            backgroundColor: labelBg,
            padding: '1px 4px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
          }}
        >
          ↕ {heightMm} mm
        </span>
      </div>

      {/* ── Hĺbka indikátor – šikmá čiara dole ── */}
      <div
        style={{
          position: 'absolute',
          bottom: -offset - 16,
          left: textWidth > 0 ? textWidth + 4 : '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
        }}
      >
        <svg width="20" height="14" viewBox="0 0 20 14" style={{ opacity: 0.5 }}>
          <line x1="0" y1="14" x2="14" y2="0" stroke="white" strokeWidth="1" />
          <line x1="14" y1="0" x2="20" y2="0" stroke="white" strokeWidth="1" />
        </svg>
        <span
          style={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.6)',
            backgroundColor: labelBg,
            padding: '1px 4px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
          }}
        >
          ↗ {depthMm} mm
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────
// Logo image helper (s 3D shadow efektom)
// ──────────────────────────────────────────

function LogoImg({
  src,
  height,
  lightingType,
  faceColor,
  depth3d,
  sideColor,
  centered,
}: {
  src: string;
  height: number;
  lightingType: string;
  faceColor: string;
  depth3d: number;
  sideColor: string;
  centered?: boolean;
}) {
  // Viacvrstvový drop-shadow pre 3D efekt loga
  const depthPx = Math.max(1, Math.min(height * 0.08, (depth3d / 50) * height * 0.06));
  const layers = Math.max(2, Math.min(8, Math.round(depthPx)));
  const darkSide = darkenColor(sideColor, 0.5);

  const filters: string[] = [];
  for (let i = 1; i <= layers; i++) {
    const t = i / layers;
    const x = t * depthPx * 0.3;
    const y = t * depthPx;
    filters.push(`drop-shadow(${x.toFixed(1)}px ${y.toFixed(1)}px 0px ${darkSide})`);
  }
  // Tieň na fasádu
  filters.push(`drop-shadow(${depthPx}px ${depthPx * 1.5}px ${depthPx}px rgba(0,0,0,0.3))`);

  // Svetelný glow
  if (lightingType === 'front' || lightingType === 'front_halo') {
    filters.push(`drop-shadow(0 0 ${height * 0.06}px ${faceColor}88)`);
  }
  if (lightingType === 'halo' || lightingType === 'front_halo') {
    filters.push(`drop-shadow(0 0 ${height * 0.1}px #FFD70088)`);
  }

  return (
    <div style={{ display: 'flex', justifyContent: centered ? 'center' : undefined }}>
      <img
        src={src}
        alt="Logo"
        style={{
          height: `${height}px`,
          maxWidth: '100%',
          objectFit: 'contain',
          filter: filters.join(' '),
          pointerEvents: 'none',
        }}
        draggable={false}
      />
    </div>
  );
}
