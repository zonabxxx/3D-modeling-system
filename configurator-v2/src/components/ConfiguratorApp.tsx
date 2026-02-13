import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import {
  type ContentType, type LogoPlacement, type LightingType,
  type LedColor, type Point2D, LOGO_PLACEMENT_LABELS, FONT_OPTIONS,
} from '@/lib/types';
import { calculatePrice, quickEstimate } from '@/lib/pricing';
import { cleanSVG, svgToTransparentPng, recolorSVG } from '@/lib/svg-utils';
import { generateSTL, downloadSTL, type STLResult, type LetterInfo } from '@/lib/api';
import LogoGenerator from './LogoGenerator';
import STLViewer from './STLViewer';

/* ────────── helpers ────────── */
function darken(hex: string, f: number) {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * f));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * f));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * f));
  return `rgb(${r},${g},${b})`;
}
const METALLIC = new Set(['GOLD','SILVER','ROSE_GOLD','COPPER','CHROME','RAL 9006','RAL 9007']);
const DEPTH_PRESETS = [
  { value: 30, label: '30' }, { value: 50, label: '50' },
  { value: 80, label: '80' }, { value: 100, label: '100' },
  { value: 150, label: '150' },
];
const COLOR_PRESETS = [
  { hex: '#FFFFFF', name: 'Biela' }, { hex: '#000000', name: 'Čierna' },
  { hex: '#FFD700', name: 'Zlatá' }, { hex: '#C0C0C0', name: 'Strieborná' },
  { hex: '#DC2626', name: 'Červená' }, { hex: '#2563EB', name: 'Modrá' },
  { hex: '#16A34A', name: 'Zelená' }, { hex: '#9333EA', name: 'Fialová' },
];
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@700&family=Bebas+Neue&family=Oswald:wght@700&family=Poppins:wght@900&family=Roboto:wght@700&family=Inter:wght@700&family=Raleway:wght@900&family=Archivo+Black&family=Outfit:wght@700&family=Barlow:wght@700&display=swap';

const LIGHT_LABELS: Record<string, string> = {
  none: 'Bez podsvietenia', front: 'Frontlit', halo: 'Halo', front_halo: 'DUO (front-lit + halo)',
};

/* ════════════════════════════════════════════════════ */
export default function ConfiguratorApp() {
  const s = useStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  /* UI micro-state */
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [signSelected, setSignSelected] = useState(false);
  const [rotation, setRotation] = useState(0);
  const dragOff = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ pointerX: 0, pointerY: 0, startScale: 1, startHeight: 200, centerX: 0, centerY: 0, startDist: 1 });
  const rotateStart = useRef({ startAngle: 0, centerX: 0, centerY: 0, startRotation: 0 });
  const signWrapperRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [textPxW, setTextPxW] = useState(0);
  const [logoTab, setLogoTab] = useState<'upload' | 'ai'>('upload');
  const [measuring, setMeasuring] = useState(false);
  const [mp1, setMp1] = useState<Point2D | null>(s.scale.point1);
  const [mp2, setMp2] = useState<Point2D | null>(s.scale.point2);
  const [realCm, setRealCm] = useState(s.scale.realMm ? String(Math.round(s.scale.realMm / 10)) : '');
  const [htInput, setHtInput] = useState(String(s.computed.letterHeightMm || 200));
  const [darkness, setDarkness] = useState(0); // 0 = day, 1 = full night
  const nightMode = darkness > 0.3; // threshold for "night-like" effects
  const [showOrder, setShowOrder] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rgbPhase, setRgbPhase] = useState(0);
  const rgbActive = s.ledColor === 'rgb' && s.lightingType !== 'none';

  /* RGB LED color cycling – uses requestAnimationFrame for smooth performance */
  useEffect(() => {
    if (!rgbActive) return;
    let raf: number;
    let last = 0;
    const step = (ts: number) => {
      if (ts - last >= 40) { // ~25fps, smooth but not wasteful
        last = ts;
        setRgbPhase(p => (p + 3) % 360); // 3° per frame = full cycle in ~4.8s
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rgbActive]);

  /* Convert HSL phase to hex for maximum browser compatibility */
  const rgbColor = useMemo(() => {
    const h = rgbPhase / 360;
    const s2 = 1, l = 0.55;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }, [rgbPhase]);

  /* Google Fonts */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gf-cfg')) return;
    const lnk = document.createElement('link');
    lnk.id = 'gf-cfg'; lnk.rel = 'stylesheet'; lnk.href = GOOGLE_FONTS_URL;
    document.head.appendChild(lnk);
  }, []);

  useEffect(() => { if (textRef.current) setTextPxW(textRef.current.offsetWidth); }, [s.text, s.fontFamily]);
  useEffect(() => {
    const v = parseFloat(htInput) || 200;
    if (v > 0 && v !== s.computed.letterHeightMm) s.setComputed({ letterHeightMm: v });
  }, [htInput]);
  useEffect(() => {
    const mm = parseFloat(realCm) * 10;
    if (!mp1 || !mp2 || !mm || mm <= 0) return;
    const px = Math.sqrt((mp2.x - mp1.x) ** 2 + (mp2.y - mp1.y) ** 2);
    if (px > 0) s.setScaleRealMm(mm);
  }, [realCm, mp1, mp2]);

  /* ── Photo upload ── */
  const onPhoto = useCallback((file: File) => {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.heic')) return;
    if (file.size > 10 * 1024 * 1024) { alert('Max 10 MB!'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { s.setPhoto(url, img.naturalWidth, img.naturalHeight, file); setImgLoaded(false); /* reset — wait for <img> element onLoad */ };
    img.src = url;
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onPhoto(f); }, [onPhoto]);

  /* ── Helper: convert click coords to original image pixels (handles object-fit: contain) ── */
  const clickToOrigPx = useCallback((clientX: number, clientY: number): Point2D | null => {
    const el = imgRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    // object-fit: contain uses uniform scale with centering
    const dS = Math.min(r.width / (s.photo.width || 1), r.height / (s.photo.height || 1));
    const renderedW = (s.photo.width || 1) * dS;
    const renderedH = (s.photo.height || 1) * dS;
    const offsetX = (r.width - renderedW) / 2;
    const offsetY = (r.height - renderedH) / 2;
    const x = (clientX - r.left - offsetX) / dS;
    const y = (clientY - r.top - offsetY) / dS;
    return { x: Math.round(x), y: Math.round(y) };
  }, [s.photo.width, s.photo.height]);

  /* ── Measurement ── */
  const onMeasureClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!measuring) return;
    const pt = clickToOrigPx(e.clientX, e.clientY);
    if (!pt) return;
    if (!mp1) { setMp1(pt); }
    else if (!mp2) { setMp2(pt); s.setScalePoints(mp1, pt); setMeasuring(false); }
  }, [measuring, mp1, mp2, clickToOrigPx]);
  const resetMeasure = () => { setMp1(null); setMp2(null); setRealCm(''); setMeasuring(false); s.clearScale(); };

  /* ── Sign display metrics ── */
  const getMetrics = useCallback(() => {
    const el = imgRef.current;
    if (!el || !imgLoaded) return { fs: 48, lh: 60 };
    const dS = Math.min(el.clientWidth / (s.photo.width || 1), el.clientHeight / (s.photo.height || 1));
    const mm = s.computed.letterHeightMm || 200;
    const f = s.scale.factorPxToMm;
    let dPx: number;
    if (f && f > 0) { dPx = Math.max(8, (mm / f) * dS); }
    else { dPx = Math.max(16, Math.min(el.clientHeight * 0.12, el.clientHeight * 0.8)); }
    return { fs: dPx * 0.85, lh: dPx * s.logo.logoScale };
  }, [s.photo.width, s.photo.height, s.computed.letterHeightMm, s.scale.factorPxToMm, s.logo.logoScale, imgLoaded]);
  const { fs: fontSize, lh: logoH } = getMetrics();

  /* ── Realistic illuminated sign shadows & glow ── */
  const hasFrontLight = s.lightingType === 'front' || s.lightingType === 'front_halo';
  const hasHaloLight = s.lightingType === 'halo' || s.lightingType === 'front_halo';
  const isLit = s.lightingType !== 'none';

  const shadow = useMemo(() => {
    const arr: string[] = [];
    const dp = Math.max(2, Math.min(fontSize * 0.14, (s.depthMm / 50) * fontSize * 0.1));
    const layers = Math.max(4, Math.min(18, Math.round(dp)));
    // Darken side gradually with darkness
    const nightDark = !hasFrontLight ? 1 - darkness * 0.6 : 1;
    const dk1 = darken(s.sideColor, 0.55 * nightDark), dk2 = darken(s.sideColor, 0.7 * nightDark);

    for (let i = 1; i <= layers; i++) {
      const t = i / layers;
      arr.push(`${(t * dp * 0.3).toFixed(1)}px ${(t * dp).toFixed(1)}px 0 ${i < layers * 0.5 ? dk2 : dk1}`);
    }
    const shadowOpacity = 0.35 + (!hasFrontLight ? darkness * 0.3 : 0);
    arr.push(`${(dp * 0.75).toFixed(1)}px ${(dp * 1.5).toFixed(1)}px ${(dp * 0.8).toFixed(1)}px rgba(0,0,0,${shadowOpacity.toFixed(2)})`);

    if (s.sideColor !== s.faceColor) {
      const sc = !hasFrontLight && darkness > 0.3 ? darken(s.sideColor, 0.5) : s.sideColor;
      const b = Math.max(0.5, fontSize * 0.008);
      arr.push(`${b}px 0 0 ${sc}`, `-${b}px 0 0 ${sc}`, `0 ${b}px 0 ${sc}`, `0 -${b}px 0 ${sc}`);
    }

    return arr.join(', ');
  }, [fontSize, s.depthMm, s.sideColor, s.faceColor, darkness, hasFrontLight]);

  // LED color resolved (warm/cool/rgb) – realistic Kelvin values
  // Warm white ≈ 3000K → amber/yellowish glow
  // Cool white ≈ 6000K → blueish-white crisp glow
  // RGB → cycling through full spectrum
  const ledResolvedColor = useMemo(() => {
    if (s.ledColor === 'warm_white') return '#FFCC66'; // 3000K amber-warm
    if (s.ledColor === 'cool_white') return '#D4E4FF'; // 6000K blue-white
    return rgbColor; // RGB cycling
  }, [s.ledColor, rgbColor]);

  // Front-lit glow (on the text face) – scales with darkness
  const frontGlow = useMemo(() => {
    if (!hasFrontLight) return '';
    const n = 1 + darkness * 1.2; // 1.0 (day) → 2.2 (night)
    const g = fontSize * 0.15 * n;
    const fc = s.faceColor === '#000000' ? '#FFFFFF' : s.faceColor;
    const lc = ledResolvedColor;
    // Outer glow opacity scales with darkness
    const outerA = Math.round(0x44 + darkness * (0xcc - 0x44)).toString(16).padStart(2, '0');
    const midA = Math.round(0x66 + darkness * (0xee - 0x66)).toString(16).padStart(2, '0');
    return [
      `0 0 ${(g * 0.3).toFixed(0)}px ${fc}`,
      `0 0 ${(g * 0.8).toFixed(0)}px ${darkness > 0.3 ? lc : fc}${midA}`,
      `0 0 ${(g * 2).toFixed(0)}px ${lc}${outerA}`,
      `0 0 ${(g * 4).toFixed(0)}px ${lc}44`,
    ].join(', ');
  }, [hasFrontLight, fontSize, s.faceColor, darkness, ledResolvedColor]);

  // Combined text shadow
  const fullTextShadow = useMemo(() => {
    const parts = [shadow];
    if (frontGlow) parts.push(frontGlow);
    return parts.join(', ');
  }, [shadow, frontGlow]);

  // Face color: affected by LED temperature at night
  // Warm LED → face gets yellowish tint, Cool LED → blueish-white, RGB → cycles
  const textColor = useMemo(() => {
    if (hasFrontLight) {
      if (nightMode) {
        // RGB LED: the face itself cycles through colors (LED illuminates face)
        if (s.ledColor === 'rgb') return ledResolvedColor;
        // Front-lit at night: face is brightly illuminated by LED
        if (s.faceColor === '#000000') return ledResolvedColor;
        if (s.faceColor === '#FFFFFF' || s.faceColor === '#F5F5F5') {
          if (s.ledColor === 'warm_white') return '#FFF0D0';
          if (s.ledColor === 'cool_white') return '#F0F4FF';
          return ledResolvedColor;
        }
        return s.faceColor;
      }
      // RGB in day mode: subtle tint cycling
      if (s.ledColor === 'rgb') return ledResolvedColor;
      return s.faceColor;
    }
    if (hasHaloLight && nightMode) {
      // Halo-only at night: face is dark (not illuminated from front), but RGB glows
      if (s.ledColor === 'rgb') return darken(ledResolvedColor, 0.6);
      return darken(s.faceColor, 0.5);
    }
    if (!isLit && nightMode) {
      return darken(s.faceColor, 0.35);
    }
    return s.faceColor;
  }, [hasFrontLight, hasHaloLight, isLit, s.faceColor, s.ledColor, nightMode, ledResolvedColor]);

  // Logo filter style for front-lit lighting effects (halo is handled by blur layer)
  // Uses LED color for the outer glow spill (light temperature visible in surroundings)
  const logoFilterStyle = useMemo((): React.CSSProperties => {
    const filters: string[] = [];
    const isRgb = s.ledColor === 'rgb';
    if (hasFrontLight) {
      const gc = isRgb ? ledResolvedColor : (s.faceColor === '#000000' ? ledResolvedColor : s.faceColor);
      const lc = ledResolvedColor;
      const g = fontSize * (0.03 + darkness * 0.08); // scales with darkness
      filters.push(`drop-shadow(0 0 ${g.toFixed(0)}px ${gc})`);
      if (darkness > 0.2) {
        const outerG = g * (1 + darkness * 3);
        filters.push(`drop-shadow(0 0 ${outerG.toFixed(0)}px ${lc})`);
        filters.push(`brightness(${(1 + darkness * 0.4).toFixed(2)})`);
      }
    } else if (hasHaloLight && isRgb) {
      const g = fontSize * (0.02 + darkness * 0.05);
      filters.push(`drop-shadow(0 0 ${g.toFixed(0)}px ${ledResolvedColor}88)`);
    }
    const style: React.CSSProperties = filters.length > 0 ? { filter: filters.join(' ') } : {};
    if (!isRgb && filters.length > 0) style.transition = 'filter 0.3s';
    return style;
  }, [hasFrontLight, hasHaloLight, fontSize, s.faceColor, ledResolvedColor, darkness, s.ledColor]);

  /* ── Image rendering area (accounts for object-fit: contain letterboxing) ── */
  const getImageArea = useCallback(() => {
    const el = imgRef.current;
    if (!el) return { ox: 0, oy: 0, rw: 1, rh: 1 };
    const dS = Math.min(el.clientWidth / (s.photo.width || 1), el.clientHeight / (s.photo.height || 1));
    const rw = (s.photo.width || 1) * dS;
    const rh = (s.photo.height || 1) * dS;
    const ox = (el.clientWidth - rw) / 2;
    const oy = (el.clientHeight - rh) / 2;
    return { ox, oy, rw, rh };
  }, [s.photo.width, s.photo.height]);

  /* ── Coord helpers (normalized 0-1 within rendered image area) ── */
  const toNorm = useCallback((cx: number, cy: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return { x: .5, y: .5 };
    const { ox, oy, rw, rh } = getImageArea();
    return { x: (cx - r.left - ox) / rw, y: (cy - r.top - oy) / rh };
  }, [getImageArea]);

  /* ── Sign pointer handlers ── */
  const pointerDownTime = useRef(0);
  const pointerMoved = useRef(false);

  const onSignPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointerDownTime.current = Date.now();
    pointerMoved.current = false;
    if (signSelected) {
    const n = toNorm(e.clientX, e.clientY);
      dragOff.current = { x: n.x - s.position.x, y: n.y - s.position.y };
      setDragging(true);
    }
  }, [s.position, toNorm, signSelected]);

  const onSignPointerMove = useCallback((e: React.PointerEvent) => {
    pointerMoved.current = true;
    if (rotating) {
      const rect = signWrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      setRotation(rotateStart.current.startRotation + angle - rotateStart.current.startAngle);
      return;
    }
    if (resizing) {
      // Distance-from-center approach: dragging away from center = enlarge
      const { centerX, centerY, startDist, startScale, startHeight } = resizeStart.current;
      const dx = e.clientX - centerX, dy = e.clientY - centerY;
      const curDist = Math.sqrt(dx * dx + dy * dy);
      const ratio = curDist / Math.max(startDist, 1);
      const newScale = Math.max(0.2, Math.min(3, startScale * ratio));
      if (s.contentType === 'logo_only') {
        s.setLogoScale(newScale);
      } else {
        setHtInput(String(Math.max(30, Math.min(2000, Math.round(startHeight * ratio)))));
      }
      return;
    }
    if (!dragging) return;
    const n = toNorm(e.clientX, e.clientY);
    s.setPosition({ x: Math.max(.05, Math.min(.95, n.x - dragOff.current.x)), y: Math.max(.05, Math.min(.95, n.y - dragOff.current.y)) });
  }, [dragging, resizing, rotating, toNorm, s.contentType]);

  const onSignPointerUp = useCallback(() => {
    const wasDrag = dragging || resizing || rotating;
    const wasQuickTap = Date.now() - pointerDownTime.current < 250 && !pointerMoved.current;
    setDragging(false); setResizing(null); setRotating(false);
    if (wasQuickTap && !wasDrag) setSignSelected(prev => !prev);
  }, [dragging, resizing, rotating]);

  const onViewportClick = useCallback((e: React.MouseEvent) => {
    if (signSelected && !signWrapperRef.current?.contains(e.target as Node)) setSignSelected(false);
  }, [signSelected]);

  const onResizeDown = useCallback((corner: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // Compute center of sign wrapper
    const rect = signWrapperRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : e.clientX;
    const cy = rect ? rect.top + rect.height / 2 : e.clientY;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const startDist = Math.sqrt(dx * dx + dy * dy) || 1;
    resizeStart.current = {
      pointerX: e.clientX, pointerY: e.clientY,
      startScale: s.contentType === 'logo_only' ? s.logo.logoScale : 1,
      startHeight: parseFloat(htInput) || 200,
      centerX: cx, centerY: cy, startDist,
    };
    setResizing(corner);
  }, [s.logo.logoScale, s.contentType, htInput]);

  const onRotateDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = signWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    rotateStart.current = { startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI), centerX: cx, centerY: cy, startRotation: rotation };
    setRotating(true);
  }, [rotation]);

  /* ── Logo upload ── */
  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.type === 'image/svg+xml' || f.name.endsWith('.svg')) {
      const raw = await f.text(); const url = URL.createObjectURL(f);
      const c = await cleanSVG(raw);
      s.setLogoSVG(url, c.svg, c.width, c.height); s.setContentType('logo_only');
    } else {
      const url = URL.createObjectURL(f); const img = new Image();
      img.onload = () => { s.setLogoRaster(url, f, img.naturalWidth, img.naturalHeight); s.setContentType('logo_only'); };
      img.src = url;
    }
  };

  const handleAILogo = useCallback(async (v: any) => {
    if (v.vectorized && v.svgContent) {
      const b = new Blob([v.svgContent], { type: 'image/svg+xml' });
      s.setLogoSVG(URL.createObjectURL(b), v.svgContent, v.width || 200, v.height || 200);
    } else if (v.type === 'svg') {
      let c = '';
      if (v.url.startsWith('data:image/svg+xml;base64,')) c = atob(v.url.replace('data:image/svg+xml;base64,', ''));
      else if (v.url.startsWith('data:image/svg+xml')) c = decodeURIComponent(v.url.split(',')[1] || '');
      if (!c) return;
      const cl = await cleanSVG(c);
      s.setLogoSVG(URL.createObjectURL(new Blob([cl.svg], { type: 'image/svg+xml' })), cl.svg, cl.width, cl.height);
    } else {
      const img = document.createElement('img');
      img.onload = () => {
        let u = v.url; let file: File | null = null;
        if (v.url.startsWith('data:')) {
          const [hdr, b64] = v.url.split(','); const mime = hdr.match(/:(.*?);/)?.[1] || 'image/png';
          const bytes = atob(b64); const ab = new ArrayBuffer(bytes.length); const ia = new Uint8Array(ab);
          for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
          const blob = new Blob([ab], { type: mime }); file = new File([blob], 'ai-logo.png', { type: mime }); u = URL.createObjectURL(blob);
        }
        if (file) s.setLogoRaster(u, file, img.naturalWidth, img.naturalHeight);
      };
      img.src = v.url;
    }
    s.setContentType('logo_only');
  }, []);

  /* logo 2D preview */
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  useEffect(() => {
    if (s.logo.svgContent) { svgToTransparentPng(recolorSVG(s.logo.svgContent, s.faceColor), 512).then(setLogoSrc); }
    else if (s.logo.rasterUrl) { setLogoSrc(s.logo.rasterUrl); }
    else if (s.logo.svgUrl) { setLogoSrc(s.logo.svgUrl); }
    else { setLogoSrc(null); }
  }, [s.logo.svgContent, s.logo.svgUrl, s.logo.rasterUrl, s.faceColor]);

  /* ── Price ── */
  const letterCount = s.text.replace(/\s/g, '').length;
  const letterH = s.computed.letterHeightMm || 200;
  const hasLogo = s.contentType !== 'text_only' && !!(s.logo.svgUrl || s.logo.rasterUrl || s.logo.svgContent);
  const price = useMemo(() => {
    if (letterCount === 0 && !hasLogo) return null;
    return calculatePrice({
      letterCount: Math.max(letterCount, 0), letterHeightMm: letterH,
      totalWidthMm: s.contentType === 'logo_only' && s.logo.originalWidth > 0 && s.logo.originalHeight > 0
        ? letterH * (s.logo.originalWidth / s.logo.originalHeight) * s.logo.logoScale
        : letterH * 0.65 * Math.max(letterCount, 1),
      depthMm: s.depthMm, profileType: s.profileType, lightingType: s.lightingType,
      colorCategory: METALLIC.has(s.faceRal) ? 'metallic' : 'standard',
      includeInstallation: s.order.type === 'production_and_installation',
      hasLogo, logoAreaMm2: s.computed.logoAreaMm2 || (hasLogo ? letterH * letterH * 0.7 : 0),
      logoIsRelief: s.logo.extrudeAsRelief, logoComplexity: 1.0,
    });
  }, [letterCount, letterH, s.depthMm, s.profileType, s.lightingType, s.faceRal, s.order.type, hasLogo, s.computed.logoAreaMm2, s.logo.extrudeAsRelief, s.contentType, s.logo.originalWidth, s.logo.originalHeight, s.logo.logoScale]);
  const est = useMemo(() => quickEstimate(Math.max(letterCount, 1), letterH, s.lightingType), [letterCount, letterH, s.lightingType]);

  /* ── Derived ── */
  const showText = s.contentType !== 'logo_only' && s.text.length > 0;
  const showLogo = s.contentType !== 'text_only' && !!(s.logo.svgUrl || s.logo.rasterUrl || s.logo.svgContent);
  const hMm = s.computed.letterHeightMm || 0;
  const wMm = (() => {
    if (hMm <= 0) return 0;
    if (s.contentType === 'logo_only' && s.logo.originalWidth > 0) return Math.round(hMm * (s.logo.originalWidth / s.logo.originalHeight) * s.logo.logoScale);
    if (fontSize > 0 && textPxW > 0) return Math.round((textPxW / (fontSize / 0.85)) * hMm);
    return 0;
  })();
  const canOrder = (letterCount > 0 || hasLogo) && s.photo.url && s.scale.factorPxToMm;
  const orderMissing: string[] = [];
  if (!s.photo.url) orderMissing.push('fotka fasády');
  if (letterCount === 0 && !hasLogo) orderMissing.push('text alebo logo');
  if (!s.scale.factorPxToMm) orderMissing.push('zameranie (meranie)');

  /* ── Progress ── */
  const progress = useMemo(() => {
    let p = 0;
    if (s.photo.url) p += 20;
    if (s.text.length > 0 || hasLogo) p += 20;
    if (s.lightingType !== 'none') p += 15;
    if (s.scale.factorPxToMm) p += 20;
    if (s.faceColor !== '#FFFFFF' || s.sideColor !== '#000000') p += 10;
    if (s.depthMm !== 50) p += 5;
    if (s.profileType !== 'flat') p += 5;
    if (s.computed.letterHeightMm && s.computed.letterHeightMm !== 200) p += 5;
    return Math.min(100, p);
  }, [s.photo.url, s.text, hasLogo, s.lightingType, s.scale.factorPxToMm, s.faceColor, s.sideColor, s.depthMm, s.profileType, s.computed.letterHeightMm]);

  /* ═════════════════════════ RENDER ═════════════════════════ */
  return (
    <div className="h-screen flex flex-col bg-[#060b18] text-gray-200 overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ─── TOP BAR: Progress ─── */}
      <header className="shrink-0 border-b border-white/5 px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-amber-500">⚙</span>
          <span className="text-gray-400">Váš dizajn je hotový na <b className="text-amber-400">{progress}%</b></span>
        </div>
        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors" title="Nastavenia">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors" title="Grid">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </button>
        </div>
      </header>

      {/* ─── MAIN 3-COL ─── */}
      <main className="flex-1 flex overflow-hidden">

        {/* ═══ LEFT PANEL ═══ */}
        <aside className="w-[200px] bg-[#0a0f1e] border-r border-white/5 overflow-y-auto shrink-0">
          <div className="p-3 space-y-3">

            {/* ── Content ── */}
            <PanelGroup title="Content">
              <input
                type="text" value={s.text} onChange={e => s.setText(e.target.value)} maxLength={50}
                placeholder="ADSUN"
                className="w-full px-2.5 py-2 rounded-lg bg-[#060b18] border border-white/10 text-amber-400 text-base font-bold placeholder-gray-600 focus:border-amber-500 outline-none tracking-wide"
              />
                {!hasLogo ? (
                <label className="flex items-center justify-center gap-2 mt-2 px-3 py-2 rounded-lg border border-dashed border-white/10 hover:border-amber-500/40 cursor-pointer transition-colors bg-white/[.02]">
                        <input type="file" accept=".svg,image/svg+xml,image/png,image/jpeg" className="hidden" onChange={handleLogoFile} />
                  <span className="text-amber-500">🖼️</span>
                  <span className="text-xs text-gray-400">Upload Logo</span>
                      </label>
                    ) : (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-[#060b18]">
                  {logoSrc && <img src={logoSrc} alt="" className="h-8 max-w-[60px] object-contain" />}
                  <span className="text-[10px] text-gray-400 flex-1 font-medium">{s.logo.sourceType === 'svg' ? 'SVG' : 'PNG'}</span>
                  <button onClick={s.clearLogo} className="text-red-400 text-xs hover:text-red-300 font-bold">✕</button>
                      </div>
                    )}
              {!hasLogo && (
                <div className="mt-2">
                  <button onClick={() => setLogoTab(logoTab === 'ai' ? 'upload' : 'ai')} className="text-[10px] text-amber-500 hover:text-amber-400">
                    {logoTab === 'ai' ? '← Späť na upload' : '✨ Generovať AI logo'}
                  </button>
                  {logoTab === 'ai' && <div className="mt-2"><LogoGenerator onLogoSelected={handleAILogo} /></div>}
                  </div>
                )}
            </PanelGroup>

            {/* ── Style (Svietenie) ── */}
            <PanelGroup title="Style" collapsible>
              <div className="flex gap-1.5">
                {([
                  { t: 'none' as LightingType },
                  { t: 'front' as LightingType },
                  { t: 'halo' as LightingType },
                  { t: 'front_halo' as LightingType },
                ] as const).map(o => (
                  <LightCard key={o.t} active={s.lightingType === o.t} onClick={() => s.setLightingType(o.t)} type={o.t} faceColor={s.faceColor} sideColor={s.sideColor} ledColor={ledResolvedColor} />
                ))}
              </div>
              {s.lightingType === 'front_halo' && (
                <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/8 border border-amber-500/15">
                  <span className="text-amber-400 text-xs">↓</span>
                  <span className="text-amber-400 text-[10px]">⚡ Best visual impact</span>
              </div>
              )}
              {s.lightingType !== 'none' && (
                <div className="grid grid-cols-3 gap-1 mt-2">
                  {([
                    ['warm_white', 'Teplá', '#FFD080'] as const,
                    ['cool_white', 'Studená', '#C0D8FF'] as const,
                    ['rgb', 'RGB', rgbColor] as const,
                  ]).map(([c, l, clr]) => (
                    <button key={c} onClick={() => s.setLedColor(c as LedColor)}
                      className={`flex items-center justify-center gap-1 px-1 py-1 rounded-lg text-[9px] font-medium truncate ${s.ledColor === c ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40' : 'bg-white/[.03] text-gray-500 border border-white/5 hover:border-white/15'}`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{
                        background: c === 'rgb'
                          ? (rgbActive ? rgbColor : `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)`)
                          : clr,
                        boxShadow: s.ledColor === c ? `0 0 8px ${c === 'rgb' ? rgbColor : clr}` : 'none',
                      }} />
                      {l}
                    </button>
                ))}
              </div>
              )}
              {s.contentType !== 'logo_only' && (
                <div className="mt-2">
                  <span className="text-[9px] text-gray-500 block mb-1">Font</span>
                  <select
                    value={s.fontFamily}
                    onChange={e => s.setFont(e.target.value, `/fonts/${FONT_OPTIONS.find(f => f.family === e.target.value)?.file || ''}`)}
                    className="w-full px-2 py-1.5 rounded-lg bg-[#060b18] border border-white/10 text-white text-[11px] focus:border-amber-500 outline-none"
                  >
                    {FONT_OPTIONS.map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
                  </select>
                </div>
              )}
            </PanelGroup>

            {/* ── Cross-section / Color ── */}
            <PanelGroup title="Color" collapsible>
              {/* Cross-section diagram */}
              <div className="flex items-end gap-2 mb-2">
                <CrossSectionDiagram faceColor={s.faceColor} sideColor={s.sideColor} depthMm={s.depthMm} heightMm={hMm || 500} />
              </div>
              {/* Front colors */}
              <div className="mb-2">
                <span className="text-[9px] text-gray-500 block mb-1">Front</span>
                <div className="flex flex-wrap gap-1">
                {COLOR_PRESETS.map(c => (
                  <button key={c.hex} onClick={() => s.setFaceColor(c.hex)} title={c.name}
                      className={`w-5 h-5 rounded border-2 transition-all ${s.faceColor === c.hex ? 'border-amber-500 scale-110 shadow-lg shadow-amber-500/20' : 'border-white/10 hover:border-white/25'}`}
                    style={{ backgroundColor: c.hex }} />
                ))}
              </div>
              </div>
              {/* Side colors */}
              <div className="mb-1">
                <span className="text-[9px] text-gray-500 block mb-1">Side</span>
                <div className="flex flex-wrap gap-1">
                {COLOR_PRESETS.map(c => (
                  <button key={c.hex} onClick={() => s.setSideColor(c.hex)} title={c.name}
                      className={`w-5 h-5 rounded border-2 transition-all ${s.sideColor === c.hex ? 'border-amber-500 scale-110 shadow-lg shadow-amber-500/20' : 'border-white/10 hover:border-white/25'}`}
                    style={{ backgroundColor: c.hex }} />
                ))}
              </div>
              </div>
              <button className="w-full text-center text-[10px] text-gray-500 hover:text-gray-400 py-0.5 transition-colors">
                ▼ More colors
              </button>
            </PanelGroup>

            {/* ── Dimensions / Measure ── */}
            <PanelGroup title="Rozmery">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[9px] text-gray-500 mb-0.5 block">Výška (mm)</label>
                  <input type="number" value={htInput} onChange={e => setHtInput(e.target.value)} min={30} max={2000}
                    className="w-full px-2 py-1.5 rounded-lg bg-[#060b18] border border-white/10 text-white text-xs focus:border-amber-500 outline-none" />
              </div>
                <div className="flex-1">
                  <label className="text-[9px] text-gray-500 mb-0.5 block">Hĺbka <span className="text-amber-400 font-bold">{s.depthMm}</span> mm</label>
                  <input
                    type="range"
                    min={20}
                    max={200}
                    step={5}
                    value={s.depthMm}
                    onChange={e => s.setDepthMm(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-amber-500"
                    style={{
                      background: `linear-gradient(to right, #f59e0b ${((s.depthMm - 20) / 180) * 100}%, rgba(255,255,255,0.06) ${((s.depthMm - 20) / 180) * 100}%)`,
                    }}
                  />
                  <div className="flex justify-between text-[7px] text-gray-600 mt-0.5">
                    <span>20</span>
                    <span>50</span>
                    <span>100</span>
                    <span>200</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5 mt-2">
                {!measuring ? (
                  <button onClick={() => setMeasuring(true)} disabled={!s.photo.url}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-amber-600/20 text-amber-400 text-[10px] font-medium disabled:opacity-30 hover:bg-amber-600/30 transition-colors border border-amber-600/30">
                    📏 Merať na fotke
                  </button>
                ) : (
                  <button onClick={() => { setMeasuring(false); setMp1(null); setMp2(null); }}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-red-600/20 text-red-400 text-[10px] font-medium hover:bg-red-600/30 transition-colors border border-red-600/30 animate-pulse">
                    ✕ Zrušiť
                  </button>
                )}
                {mp1 && <button onClick={resetMeasure} className="px-2 py-1.5 rounded-lg bg-white/5 text-gray-500 text-[10px] hover:bg-white/10">↻</button>}
              </div>
              {measuring && <p className="text-[9px] text-amber-400 animate-pulse mt-1">Klikni 2 body na fotke</p>}
              {mp1 && mp2 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="text-[9px] text-gray-500">cm:</label>
                  <input type="number" value={realCm} onChange={e => setRealCm(e.target.value)} min={1}
                    className="w-16 px-2 py-1 rounded bg-[#060b18] border border-white/10 text-white text-[10px] focus:border-amber-500 outline-none" />
                  {s.scale.factorPxToMm && <span className="text-[9px] text-green-400">{s.scale.factorPxToMm.toFixed(1)} mm/px</span>}
                </div>
              )}
            </PanelGroup>

            {/* Logo placement */}
            {s.contentType !== 'logo_only' && hasLogo && (
              <PanelGroup title="Umiestnenie loga">
                <div className="grid grid-cols-2 gap-1">
                  {(Object.entries(LOGO_PLACEMENT_LABELS) as [LogoPlacement, string][]).filter(([k]) => k !== 'standalone' && k !== 'behind_text').map(([k, l]) => (
                    <button key={k} onClick={() => s.setLogoPlacement(k)}
                      className={`px-2 py-1.5 rounded text-[10px] transition-all ${s.logo.logoPlacement === k ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40' : 'bg-white/[.03] text-gray-500 border border-white/5'}`}
                    >{l}</button>
                  ))}
              </div>
              </PanelGroup>
            )}

          </div>
        </aside>

        {/* ═══ CENTER VIEWPORT ═══ */}
        <section className="flex-1 relative flex items-center justify-center overflow-hidden">
          {s.photo.url ? (
            <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-black select-none" style={{ touchAction: 'none' }}>
              {darkness > 0 && <div className="absolute inset-0 pointer-events-none z-[2]" style={{
                background: `linear-gradient(180deg, rgba(5,8,22,${darkness * 0.75}) 0%, rgba(10,14,26,${darkness * 0.85}) 100%)`,
                transition: 'background 0.3s',
              }} />}

              <img ref={imgRef} src={s.photo.url} alt=""
                style={{ filter: `brightness(${1 - darkness * 0.7}) saturate(${1 - darkness * 0.3})`, position: 'relative', zIndex: 0 }}
                className={`w-full h-full object-contain ${measuring ? 'cursor-crosshair' : ''}`}
                draggable={false} onLoad={() => setImgLoaded(true)} onClick={(e) => { onMeasureClick(e); onViewportClick(e); }} />

              {/* Measure overlay — visible only during active measurement, hidden once scale is set */}
              {imgLoaded && imgRef.current && (measuring || (mp1 && !s.scale.factorPxToMm)) && (() => {
                const el = imgRef.current!;
                const dS = Math.min(el.clientWidth / (s.photo.width || 1), el.clientHeight / (s.photo.height || 1));
                const rw = (s.photo.width || 1) * dS, rh = (s.photo.height || 1) * dS;
                const ox = (el.clientWidth - rw) / 2, oy = (el.clientHeight - rh) / 2;
                const toDisp = (p: Point2D) => ({ x: p.x * dS + ox, y: p.y * dS + oy });
                const d1 = mp1 ? toDisp(mp1) : null;
                const d2 = mp2 ? toDisp(mp2) : null;
                return (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-[15]" viewBox={`0 0 ${el.clientWidth} ${el.clientHeight}`} preserveAspectRatio="none">
                    {d1 && <circle cx={d1.x} cy={d1.y} r="8" fill="#f59e0b" stroke="white" strokeWidth="2" />}
                    {d2 && <circle cx={d2.x} cy={d2.y} r="8" fill="#f59e0b" stroke="white" strokeWidth="2" />}
                    {d1 && d2 && <line x1={d1.x} y1={d1.y} x2={d2.x} y2={d2.y} stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 4" />}
                </svg>
                );
              })()}

              {/* Sign overlay */}
              {imgLoaded && (showText || showLogo) && (() => {
                const ia = getImageArea();
                return (
                <div ref={signWrapperRef} className="absolute z-10"
                  style={{ left: ia.ox + s.position.x * ia.rw, top: ia.oy + s.position.y * ia.rh, transform: `translate(-50%,-50%) rotate(${rotation}deg)`, pointerEvents: measuring ? 'none' : 'auto', opacity: measuring ? 0.5 : 1, transition: 'opacity 0.2s' }}
                  onPointerMove={onSignPointerMove} onPointerUp={onSignPointerUp} onPointerCancel={onSignPointerUp}>
                  <div className="relative" style={{ padding: signSelected ? 8 : 0 }}>
                    {signSelected && <div className="absolute inset-0 border-2 border-dashed border-amber-500/60 rounded-lg pointer-events-none" />}
                    {signSelected && !dragging && (
                      <>
                        <ResizeHandle pos="nw" onDown={onResizeDown('nw')} />
                        <ResizeHandle pos="ne" onDown={onResizeDown('ne')} />
                        <ResizeHandle pos="sw" onDown={onResizeDown('sw')} />
                        <ResizeHandle pos="se" onDown={onResizeDown('se')} />
                      </>
                    )}
                    {signSelected && !dragging && !resizing && (
                      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: -32 }}>
                        <div className="absolute left-1/2 -translate-x-1/2 top-[14px] w-px h-[18px] bg-amber-500/40" />
                        <div onPointerDown={onRotateDown} className="w-5 h-5 rounded-full bg-amber-500 border-2 border-[#060b18] cursor-grab active:cursor-grabbing flex items-center justify-center hover:scale-110 transition-transform" title="Otočiť">
                          <span className="text-[8px] text-[#060b18] font-bold select-none">↻</span>
                        </div>
                      </div>
                    )}

                    <div style={{ cursor: signSelected ? (dragging ? 'grabbing' : 'grab') : 'pointer' }} onPointerDown={onSignPointerDown}>
                      {/* Halo: duplicate content behind with halo glow (follows letter/logo shape) */}
                      {hasHaloLight && (
                        <div className="absolute inset-0 pointer-events-none" style={{
                          filter: `blur(${Math.max(3, fontSize * (0.06 + darkness * 0.08))}px)`,
                          opacity: 0.4 + darkness * 0.5,
                        }}>
                          {showLogo && !showText && logoSrc && <LogoImg src={logoSrc} h={logoH} center haloOnly haloColor={ledResolvedColor} fontSize={fontSize} nightMode={nightMode} />}
                          {showLogo && showText && s.logo.logoPlacement === 'above_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} center haloOnly haloColor={ledResolvedColor} fontSize={fontSize} nightMode={nightMode} />}
                  <div className="flex items-center gap-1">
                            {showLogo && showText && s.logo.logoPlacement === 'left_of_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} haloOnly haloColor={ledResolvedColor} fontSize={fontSize} nightMode={nightMode} />}
                    {showText && (
                              <div style={{
                                fontFamily: `'${s.fontFamily}',sans-serif`, fontSize, fontWeight: 700,
                                color: ledResolvedColor,
                                whiteSpace: 'nowrap', lineHeight: 1.1, letterSpacing: '.02em', userSelect: 'none',
                              }}>{s.text}</div>
                            )}
                            {showLogo && showText && s.logo.logoPlacement === 'right_of_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} haloOnly haloColor={ledResolvedColor} fontSize={fontSize} nightMode={nightMode} />}
                  </div>
                          {showLogo && showText && s.logo.logoPlacement === 'below_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} center haloOnly haloColor={ledResolvedColor} fontSize={fontSize} nightMode={nightMode} />}
                </div>
              )}

                      {/* Main content layer */}
                      <div style={{ position: 'relative', ...logoFilterStyle }}>
                        {showLogo && !showText && logoSrc && <LogoImg src={logoSrc} h={logoH} center lightingType={s.lightingType} nightMode={nightMode} faceColor={s.faceColor} ledColor={s.ledColor} fontSize={fontSize} ledResolvedColor={ledResolvedColor} />}
                        {showLogo && showText && s.logo.logoPlacement === 'above_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} center lightingType={s.lightingType} nightMode={nightMode} faceColor={s.faceColor} ledColor={s.ledColor} fontSize={fontSize} ledResolvedColor={ledResolvedColor} />}
                        <div className="flex items-center gap-1">
                          {showLogo && showText && s.logo.logoPlacement === 'left_of_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} lightingType={s.lightingType} nightMode={nightMode} faceColor={s.faceColor} ledColor={s.ledColor} fontSize={fontSize} ledResolvedColor={ledResolvedColor} />}
                          {showText && (
                            <div ref={textRef} style={{
                              fontFamily: `'${s.fontFamily}',sans-serif`, fontSize, fontWeight: 700,
                              color: textColor,
                              textShadow: fullTextShadow,
                              whiteSpace: 'nowrap', lineHeight: 1.1, letterSpacing: '.02em', userSelect: 'none',
                              WebkitTextStroke: s.sideColor !== s.faceColor ? `0.5px ${s.sideColor}` : undefined,
                              transition: s.ledColor === 'rgb' ? 'none' : 'color 0.3s, text-shadow 0.3s',
                            }}>{s.text}</div>
                          )}
                          {showLogo && showText && s.logo.logoPlacement === 'right_of_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} lightingType={s.lightingType} nightMode={nightMode} faceColor={s.faceColor} ledColor={s.ledColor} fontSize={fontSize} ledResolvedColor={ledResolvedColor} />}
                        </div>
                        {showLogo && showText && s.logo.logoPlacement === 'below_text' && logoSrc && <LogoImg src={logoSrc} h={logoH} center lightingType={s.lightingType} nightMode={nightMode} faceColor={s.faceColor} ledColor={s.ledColor} fontSize={fontSize} ledResolvedColor={ledResolvedColor} />}
                      </div>
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* DAY ↔ NIGHT continuous slider */}
              <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-1.5 border border-white/10 z-20">
                <span className="text-base" title="Deň" style={{ opacity: 1 - darkness * 0.6 }}>☀️</span>
                <input
                  type="range" min={0} max={100} step={1}
                  value={Math.round(darkness * 100)}
                  onChange={e => setDarkness(Number(e.target.value) / 100)}
                  className="w-24 h-1 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #f59e0b ${(1 - darkness) * 100}%, #312e81 ${(1 - darkness) * 100}%)`,
                  }}
                  title={darkness < 0.15 ? 'Deň' : darkness < 0.4 ? 'Súmrak' : darkness < 0.7 ? 'Večer' : 'Noc'}
                />
                <span className="text-base" title="Noc" style={{ opacity: 0.4 + darkness * 0.6 }}>🌙</span>
                <span className="text-[9px] font-medium w-10 text-right" style={{
                  color: darkness < 0.15 ? '#fbbf24' : darkness < 0.4 ? '#fb923c' : darkness < 0.7 ? '#818cf8' : '#6366f1',
                }}>
                  {darkness < 0.15 ? 'Deň' : darkness < 0.4 ? 'Súmrak' : darkness < 0.7 ? 'Večer' : 'Noc'}
                </span>
              </div>

              {/* Dimension badge */}
              {hMm > 0 && (
                <div className="absolute top-3 left-3 z-20 pointer-events-none">
                  <span className="text-[10px] text-white/70 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg flex items-center gap-1 border border-white/5">
                    📐 <b>{hMm}</b>×{wMm > 0 ? <b>{wMm}</b> : '—'}×<b>{s.depthMm}</b> <span className="text-white/30">mm</span>
                  </span>
                </div>
              )}

              {/* Scale bar — visual reference showing what 1m looks like */}
              {s.scale.factorPxToMm && imgRef.current && (() => {
                const el = imgRef.current!;
                const dS = Math.min(el.clientWidth / (s.photo.width || 1), el.clientHeight / (s.photo.height || 1));
                const oneMeterPx = (1000 / s.scale.factorPxToMm) * dS;
                // Show 1m bar, or 0.5m if 1m is too wide
                const barMm = oneMeterPx > el.clientWidth * 0.4 ? 500 : 1000;
                const barPx = (barMm / s.scale.factorPxToMm) * dS;
                const signHeightPx = (hMm / s.scale.factorPxToMm) * dS;
                return (
                  <div className="absolute bottom-3 left-3 z-20 pointer-events-none flex flex-col gap-1">
                    {/* Horizontal scale bar */}
                    <div className="flex flex-col items-start">
                      <div className="flex items-end gap-0">
                        <div style={{ width: barPx, height: 4 }} className="bg-amber-500/70 rounded-full" />
              </div>
                      <span className="text-[9px] text-amber-400/80 mt-0.5">{barMm >= 1000 ? `${barMm / 1000} m` : `${barMm} mm`}</span>
                    </div>
                    {/* Vertical sign height indicator */}
                    <div className="flex items-end gap-1.5 mt-1">
                      <div style={{ width: 4, height: Math.min(signHeightPx, 200) }} className="bg-green-500/70 rounded-full" />
                      <span className="text-[9px] text-green-400/80">↕ {hMm} mm ({Math.round(signHeightPx)}px)</span>
                    </div>
                    {/* Debug info */}
                    <span className="text-[8px] text-white/30 mt-0.5">
                      dS={dS.toFixed(3)} | foto={s.photo.width}×{s.photo.height} | 1m={Math.round(oneMeterPx)}px
                    </span>
                  </div>
                );
              })()}
            </div>
          ) : (
            /* Empty state — photo upload */
            <label className="flex flex-col items-center justify-center gap-3 cursor-pointer text-center p-12 border-2 border-dashed border-white/10 rounded-2xl hover:border-amber-500/30 transition-colors m-6" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
              <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && onPhoto(e.target.files[0])} />
              <span className="text-5xl">📸</span>
              <span className="text-lg font-medium text-white">Nahrajte fotku fasády</span>
              <span className="text-xs text-gray-500">JPG, PNG, HEIC · Max 10 MB · Drag & drop</span>
            </label>
          )}
        </section>

        {/* ═══ RIGHT PANEL ═══ */}
        <aside className="w-[190px] bg-[#0a0f1e] border-l border-white/5 overflow-y-auto shrink-0 flex flex-col">
          <div className="p-3 space-y-3 flex-1">

            {/* Summary card */}
            <div className="rounded-xl border border-white/[.08] bg-white/[.01] p-3">
              <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">konfigurácia</div>
              <div className="text-base font-bold text-white mb-2 truncate">{s.text || 'Logo'}</div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-gray-500">Výška</span>
                  <span className="text-white font-medium">{hMm || 500} mm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Hĺbka</span>
                  <span className="text-white font-medium">{s.depthMm} mm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Šírka</span>
                  <span className="text-white font-medium">{wMm > 0 ? `${wMm} mm` : '—'}</span>
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between">
                  <span className="text-gray-500">Svietenie</span>
                  <span className="text-amber-400 text-[10px]">{LIGHT_LABELS[s.lightingType]}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Farby</span>
                  <div className="flex items-center gap-1">
                    <div className="w-3.5 h-3.5 rounded border border-white/15" style={{ backgroundColor: s.faceColor }} />
                    <span className="text-gray-600 text-[9px]">/</span>
                    <div className="w-3.5 h-3.5 rounded border border-white/15" style={{ backgroundColor: s.sideColor }} />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">LED</span>
                  {s.lightingType !== 'none' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{
                        background: s.ledColor === 'rgb' ? `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)` : ledResolvedColor,
                        boxShadow: `0 0 4px ${ledResolvedColor}`,
                      }} />
                      <span className="text-white font-medium">
                        {s.ledColor === 'warm_white' ? 'Teplá 3000K' : s.ledColor === 'cool_white' ? 'Studená 6000K' : 'RGB'}
                      </span>
                    </div>
                  ) : <span className="text-gray-600">—</span>}
                </div>
              </div>
            </div>

            {/* Price */}
            <div className="text-center py-4 rounded-xl border border-amber-500/10 bg-amber-500/[.02]">
              {price ? (
                <>
                  <div className="text-3xl font-bold text-amber-400 tracking-tight">
                    {Math.round(price.totalPrice).toLocaleString('sk-SK')}<span className="text-xl ml-0.5">€</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">orientačná, bez montáže</div>
                </>
              ) : (
                <>
                  <div className="text-3xl font-bold text-amber-400 tracking-tight">
                    {est.min}–{est.max}<span className="text-xl ml-0.5">€</span>
                </div>
                  <div className="text-[10px] text-gray-500 mt-1">orientačný odhad</div>
                </>
              )}
            </div>

            {/* Info */}
            <div className="rounded-xl border border-white/[.08] bg-white/[.01] p-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-6 h-6 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400 text-xs">✓</span>
                <div><div className="text-white text-[11px] font-medium">Výroba</div><div className="text-gray-500 text-[9px]">do 7 prac. dní</div></div>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 text-xs">🔧</span>
                <div><div className="text-white text-[11px] font-medium">Montáž</div><div className="text-gray-500 text-[9px]">po celom SK</div></div>
              </div>
              {s.lightingType !== 'none' && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 text-xs">⚡</span>
                  <div><div className="text-white text-[11px] font-medium">Spotreba</div><div className="text-gray-500 text-[9px]">{Math.max(1, letterCount || 1) * (s.lightingType === 'front_halo' ? 12 : s.lightingType === 'halo' ? 8 : 6)}W</div></div>
                </div>
              )}
            </div>
          </div>

          {/* CTA buttons — sticky bottom */}
          <div className="p-3 space-y-2 border-t border-white/5">
            <button onClick={() => setShowOrder(true)} disabled={!canOrder}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-[#060b18] text-xs font-bold tracking-wide disabled:opacity-30 disabled:cursor-not-allowed hover:from-amber-500 hover:to-amber-400 transition-all active:scale-[0.98] shadow-lg shadow-amber-600/20">
              OBJEDNAŤ TERAZ
            </button>
            {!canOrder && orderMissing.length > 0 && (
              <div className="text-[9px] text-red-400/70 text-center">
                Chýba: {orderMissing.join(', ')}
            </div>
            )}
            <button className="w-full py-2.5 rounded-xl border border-amber-500/25 text-amber-400 text-[11px] font-semibold hover:bg-amber-500/5 transition-colors tracking-wide">
              ZÍSKAŤ PONUKU
            </button>
          </div>
        </aside>
      </main>

      {/* ── Order Modal with STL generation ── */}
      {showOrder && (
        <OrderModal
          text={s.text}
          fontFamily={s.fontFamily}
          letterHeightMm={s.computed.letterHeightMm || 200}
          depthMm={s.depthMm}
          lightingType={s.lightingType}
          profileType={s.profileType}
          svgContent={s.logo.svgContent}
          contentType={s.contentType}
          faceColor={s.faceColor}
          sideColor={s.sideColor}
          ledColor={s.ledColor}
          hMm={hMm}
          wMm={wMm}
          price={price}
          onClose={() => setShowOrder(false)}
        />
      )}

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-[#0a0f1e] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">Nastavenia</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Typ obsahu</span>
                <select value={s.contentType} onChange={e => s.setContentType(e.target.value as ContentType)}
                  className="px-2 py-1 rounded bg-[#060b18] border border-white/10 text-white text-xs outline-none">
                  <option value="text_only">Text</option>
                  <option value="logo_only">Logo</option>
                  <option value="text_and_logo">Text + Logo</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Montáž</span>
                <select value={s.order.type} onChange={e => s.setOrder({ type: e.target.value as any })}
                  className="px-2 py-1 rounded bg-[#060b18] border border-white/10 text-white text-xs outline-none">
                  <option value="production_only">Len výroba</option>
                  <option value="production_and_installation">Výroba + montáž</option>
                </select>
              </div>
              {hasLogo && (
                <div className="space-y-1">
                  <label className="flex justify-between text-gray-400 text-xs"><span>Veľkosť loga</span><span className="text-white">{Math.round(s.logo.logoScale * 100)}%</span></label>
                  <input type="range" min={10} max={300} value={Math.round(s.logo.logoScale * 100)} onChange={e => s.setLogoScale(Number(e.target.value) / 100)} className="w-full accent-amber-500 h-1" />
                </div>
              )}
            </div>
            <button onClick={() => setShowSettings(false)} className="w-full py-2 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">Zavrieť</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════ SUB-COMPONENTS ═══════════════ */

function PanelGroup({ title, children, collapsible, arrows }: { title: string; children: React.ReactNode; collapsible?: boolean; arrows?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-white/[.08] overflow-hidden bg-white/[.01]">
      <button
        onClick={() => collapsible && setOpen(!open)}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold text-white ${collapsible ? 'cursor-pointer hover:bg-white/[.02]' : 'cursor-default'}`}
      >
        <span>{title}</span>
        <div className="flex items-center gap-1">
          {arrows && <span className="text-gray-600 text-[8px]">‹ ‹</span>}
          {collapsible && <span className={`text-gray-500 text-[8px] transition-transform ml-1 ${open ? '' : '-rotate-90'}`}>▼</span>}
          {arrows && <span className="text-gray-600 text-[8px]">›</span>}
        </div>
    </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

/* ── Light Card: Dynamic lighting preview based on settings ── */
const LIGHT_CARD_LABELS: Record<LightingType, string> = {
  none: 'Žiadne', front: 'Predné', halo: 'Halo', front_halo: 'DUO',
};

function LightCard({ active, onClick, type, faceColor, sideColor, ledColor = '#FFD080' }: { active: boolean; onClick: () => void; type: LightingType; faceColor: string; sideColor: string; ledColor?: string }) {
  const sc = sideColor;
  const frontGlowColor = faceColor === '#000000' ? '#F8991D' : faceColor;
  const haloGlowColor = ledColor; // LED color for halo (warm/cool/RGB)
  const hasFront = type === 'front' || type === 'front_halo';
  const hasHalo = type === 'halo' || type === 'front_halo';
  const uid = `lc-${type}`;

  /* Letter colors: dark if unlit face, bright if front-lit */
  const letterFill = type === 'none' ? '#333' : (hasFront ? frontGlowColor : darken(faceColor, 0.4));

  return (
    <button onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 px-0.5 rounded-lg border-2 transition-all min-w-0 ${active ? 'border-amber-500 bg-amber-500/8' : 'border-white/[.06] hover:border-white/15 bg-white/[.02]'}`}>
      <svg width="36" height="32" viewBox="0 0 52 42" className="overflow-visible">
        <defs>
          <filter id={`${uid}-blur`}><feGaussianBlur stdDeviation="3"/></filter>
          <filter id={`${uid}-glow`}><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>

        {/* === WALL / dark facade background === */}
        <rect x="0" y="0" width="52" height="42" rx="4" fill={type === 'none' ? '#1e1e26' : '#111118'} />

        {/* === HALO: colored glow on wall behind letter === */}
        {hasHalo && (
          <>
            <ellipse cx="26" cy="22" rx="20" ry="16" fill={haloGlowColor} opacity="0" filter={`url(#${uid}-blur)`}>
              <animate attributeName="opacity" values="0.08;0.4;0.25;0.4;0.08" dur="2.5s" repeatCount="indefinite"/>
            </ellipse>
            <ellipse cx="26" cy="22" rx="13" ry="11" fill={haloGlowColor} opacity="0" filter={`url(#${uid}-blur)`}>
              <animate attributeName="opacity" values="0.05;0.25;0.15;0.25;0.05" dur="2.5s" repeatCount="indefinite"/>
            </ellipse>
          </>
        )}

        {/* === 3D Letter body (side/depth) === */}
        <rect x="15" y="13" width="22" height="20" rx="2" fill={darken(sc, 0.6)} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
        {/* Front face */}
        <rect x="14" y="11" width="22" height="20" rx="2" fill={type === 'none' ? '#2a2a2a' : (active ? sc : '#2a2a2a')} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"/>

        {/* === Letter A === */}
        <text x="25" y="27" textAnchor="middle" fontSize="15" fontWeight="bold" fill={active ? letterFill : (type === 'none' ? '#444' : '#555')} fontFamily="sans-serif"
          filter={hasFront ? `url(#${uid}-glow)` : undefined}
        >A</text>

        {/* === FRONT-LIT: letter face pulsing glow === */}
        {hasFront && (
          <>
            <text x="25" y="27" textAnchor="middle" fontSize="15" fontWeight="bold" fill={frontGlowColor} fontFamily="sans-serif" opacity="0" filter={`url(#${uid}-blur)`}>
              <animate attributeName="opacity" values="0.1;0.8;0.5;0.8;0.1" dur="2.5s" repeatCount="indefinite"/>
              A
            </text>
            {/* Light spill on surface below */}
            <ellipse cx="25" cy="34" rx="10" ry="3" fill={frontGlowColor} opacity="0">
              <animate attributeName="opacity" values="0.05;0.3;0.15;0.3;0.05" dur="2.5s" repeatCount="indefinite"/>
            </ellipse>
          </>
        )}

        {/* === NONE: "off" slash indicator === */}
        {type === 'none' && (
          <>
            <line x1="37" y1="7" x2="43" y2="1" stroke="#555" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
            <circle cx="40" cy="4" r="3" fill="none" stroke="#555" strokeWidth="1" opacity="0.3"/>
          </>
        )}

        {/* === DUO star === */}
        {type === 'front_halo' && <text x="43" y="8" fontSize="7" fill="#FFD700">★</text>}
      </svg>
      <span className={`text-[8px] font-medium leading-tight ${active ? 'text-amber-400' : 'text-gray-500'}`}>{LIGHT_CARD_LABELS[type]}</span>
    </button>
  );
}

/* ── Cross-section diagram showing face/side colors + dimensions ── */
function CrossSectionDiagram({ faceColor, sideColor, depthMm, heightMm }: { faceColor: string; sideColor: string; depthMm: number; heightMm: number }) {
  return (
    <div className="flex items-end gap-3 w-full">
      {/* Front face label + block */}
      <div className="flex flex-col items-center gap-0.5">
        <svg width="40" height="32" viewBox="0 0 52 40">
          {/* Side (depth) visible edge */}
          <path d="M 8 4 L 44 4 L 48 8 L 48 36 L 44 40 L 8 40 Z" fill={sideColor} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" opacity="0.6" />
          {/* Front face */}
          <rect x="4" y="4" width="40" height="32" rx="2" fill={faceColor} stroke={faceColor === '#000000' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'} strokeWidth="1"/>
          {/* Dimension arrow */}
          <line x1="2" y1="38" x2="46" y2="38" stroke="rgba(248,153,29,0.4)" strokeWidth="0.5"/>
        </svg>
        <span className={`text-[10px] font-semibold ${true ? 'text-amber-400' : 'text-gray-500'}`}>Front</span>
      </div>

      {/* Side profile cross-section */}
      <div className="flex flex-col items-center gap-0.5">
        <svg width="28" height="32" viewBox="0 0 36 40">
          {/* Depth block (side view) */}
          <rect x="4" y="4" width="12" height="32" rx="1" fill={sideColor} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5"/>
          {/* Front face line */}
          <rect x="4" y="4" width="3" height="32" rx="0.5" fill={faceColor} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5"/>
          {/* Dimension */}
          <text x="22" y="24" fontSize="7" fill="#666" fontFamily="sans-serif">{depthMm}</text>
          <text x="22" y="32" fontSize="6" fill="#555" fontFamily="sans-serif">mm</text>
        </svg>
      </div>

      {/* Full dimension text */}
      <div className="flex flex-col gap-0.5 text-[10px] text-gray-500 ml-auto">
        <span>{heightMm} | {depthMm} mm</span>
      </div>
    </div>
  );
}

function ResizeHandle({ pos, onDown }: { pos: 'nw' | 'ne' | 'sw' | 'se'; onDown: (e: React.PointerEvent) => void }) {
  const posStyle: React.CSSProperties = {
    position: 'absolute', width: 10, height: 10, borderRadius: 2,
    background: '#f59e0b', border: '2px solid #060b18', zIndex: 20,
    ...(pos.includes('n') ? { top: -5 } : { bottom: -5 }),
    ...(pos.includes('w') ? { left: -5 } : { right: -5 }),
    cursor: pos === 'nw' || pos === 'se' ? 'nwse-resize' : 'nesw-resize',
  };
  return <div style={posStyle} onPointerDown={onDown} />;
}

function LogoImg({ src, h, center, lightingType = 'none', nightMode = false, faceColor = '#FFFFFF', ledColor = 'warm_white', fontSize = 48, ledResolvedColor = '#FFD080', haloOnly = false, haloColor }: {
  src: string; h: number; center?: boolean;
  lightingType?: LightingType; nightMode?: boolean; faceColor?: string; ledColor?: string; fontSize?: number; ledResolvedColor?: string;
  haloOnly?: boolean; haloColor?: string;
}) {
  /* Halo-only mode: just render a tinted version for the blur layer behind */
  if (haloOnly) {
    const tint = haloColor || ledResolvedColor;
  return (
      <div style={{ display: 'flex', justifyContent: center ? 'center' : undefined, position: 'relative' }}>
        <img src={src} alt="" style={{
          height: h, maxWidth: '100%', objectFit: 'contain', pointerEvents: 'none',
          filter: `brightness(2) saturate(0) drop-shadow(0 0 6px ${tint}) drop-shadow(0 0 12px ${tint}) drop-shadow(0 0 2px ${tint})`,
          opacity: nightMode ? 1 : 0.7,
        }} draggable={false} />
    </div>
  );
}

  const hasFront = lightingType === 'front' || lightingType === 'front_halo';
  const isRgb = ledColor === 'rgb';
  // RGB LED: use cycling LED color for the glow, otherwise use face color
  const gc = isRgb ? ledResolvedColor : (faceColor === '#000000' ? '#F8991D' : faceColor);

  const filters: string[] = [];
  if (hasFront) {
    const g = nightMode ? h * 0.08 : h * 0.02;
    filters.push(`drop-shadow(0 0 ${g.toFixed(0)}px ${gc})`);
    if (nightMode) {
      filters.push(`drop-shadow(0 0 ${(g * 2.5).toFixed(0)}px ${gc}99)`);
      filters.push(`brightness(1.4)`);
    }
    // RGB: tint the logo image itself with hue-rotate + saturate
    if (isRgb) {
      // Extract hue from the resolved color and apply as hue-rotate
      // ledResolvedColor is a hex like #ff0000 → we need the hue angle
      const hex = ledResolvedColor.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g2 = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
      let hue = 0;
      if (mx !== mn) {
        const d = mx - mn;
        if (mx === r) hue = ((g2 - b) / d + (g2 < b ? 6 : 0)) * 60;
        else if (mx === g2) hue = ((b - r) / d + 2) * 60;
        else hue = ((r - g2) / d + 4) * 60;
      }
      filters.push(`hue-rotate(${Math.round(hue)}deg)`);
      filters.push(`saturate(2.5)`);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: center ? 'center' : undefined, position: 'relative' }}>
      <img src={src} alt="" style={{
        height: h, maxWidth: '100%', objectFit: 'contain', pointerEvents: 'none',
        filter: filters.length > 0 ? filters.join(' ') : undefined,
        transition: isRgb ? 'none' : 'filter 0.3s',
      }} draggable={false} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════ */
/* ── ORDER MODAL with STL Generation                      */
/* ════════════════════════════════════════════════════════ */

const LIGHTING_LABELS_FULL: Record<string, string> = {
  none: 'Bez podsvitu',
  front: 'Front-lit (predné)',
  halo: 'Halo (zadné)',
  front_halo: 'DUO (front + halo)',
};

const PART_CONFIG_MAP: Record<string, string> = {
  shell: '#b8c0cc', face: '#7eb8f0', back: '#8a8a96', mounting: '#f0a040', solid: '#c0c0c0', rib: '#a0a0a8',
};

interface OrderModalProps {
  text: string;
  fontFamily: string;
  letterHeightMm: number;
  depthMm: number;
  lightingType: string;
  profileType: string;
  svgContent: string | null;
  contentType: string;
  faceColor: string;
  sideColor: string;
  ledColor: string;
  hMm: number;
  wMm: number;
  price: { totalPrice: number } | null;
  onClose: () => void;
}

const PYTHON_API_URL = import.meta.env.PUBLIC_STL_BACKEND_URL || 'http://localhost:8000';

function OrderModal({ text, fontFamily, letterHeightMm, depthMm, lightingType, profileType, svgContent, contentType, faceColor, sideColor, ledColor, hMm, wMm, price, onClose }: OrderModalProps) {
  const [step, setStep] = useState<'summary' | 'generating' | 'result' | 'error'>('summary');
  const [stlResult, setStlResult] = useState<STLResult | null>(null);
  const [error, setError] = useState<string>('');
  const [expandedLetter, setExpandedLetter] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [show3D, setShow3D] = useState(true);

  // Build STL file list for 3D viewer — include object/letter grouping
  const stlFiles = useMemo(() => {
    if (!stlResult) return [];
    const files: { filename: string; url: string; partType: string; objectId: string; objectLabel: string }[] = [];
    for (let i = 0; i < stlResult.letters.length; i++) {
      const letter = stlResult.letters[i];
      const objId = `obj_${i}`;
      const objLabel = letter.char || objId;
      for (const part of letter.parts) {
        files.push({
          filename: part.filename,
          url: `${PYTHON_API_URL}/stl-file/${stlResult.jobId}/${part.filename}`,
          partType: part.part_type,
          objectId: objId,
          objectLabel: objLabel,
        });
      }
    }
    return files;
  }, [stlResult]);

  const handleGenerate = useCallback(async () => {
    setStep('generating');
    setError('');
    setProgress(0);

    // Simulácia progress baru (STL generovanie môže trvať)
    const interval = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 8, 90));
    }, 500);

    try {
      const result = await generateSTL({
        text: text || 'ADSUN',
        fontFamily,
        letterHeightMm,
        depthMm,
        lightingType,
        profileType,
        svgContent: contentType !== 'text_only' && svgContent ? svgContent : undefined,
      });

      clearInterval(interval);
      setProgress(100);
      setStlResult(result);
      setStep('result');
    } catch (err: any) {
      clearInterval(interval);
      setError(err.message || 'Generovanie STL zlyhalo');
      setStep('error');
    }
  }, [text, fontFamily, letterHeightMm, depthMm, lightingType, profileType, svgContent, contentType]);

  const handleDownload = useCallback(() => {
    if (stlResult?.directUrl) {
      downloadSTL(stlResult.directUrl);
    } else if (stlResult?.downloadUrl) {
      downloadSTL(stlResult.downloadUrl);
    }
  }, [stlResult]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0a0f1e] border border-white/10 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏭</span>
            <div>
              <h3 className="text-lg font-bold text-white">Objednávka & STL generátor</h3>
              <p className="text-xs text-gray-500">Výrobné súbory pre 3D tlač svetelnej reklamy</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* ── STEP: Summary ── */}
          {step === 'summary' && (
            <>
              {/* Configuration summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[.08] bg-white/[.01] p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Konfigurácia</h4>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Obsah</span>
                      <span className="text-white font-medium">{contentType === 'logo_only' ? 'Logo' : contentType === 'text_and_logo' ? 'Text + Logo' : `"${text}"`}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Font</span>
                      <span className="text-white">{fontFamily}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Rozmery</span>
                      <span className="text-white">{hMm}×{wMm > 0 ? wMm : '—'}×{depthMm} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Profil</span>
                      <span className="text-white">{profileType}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[.08] bg-white/[.01] p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Svietenie & Farby</h4>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Podsvietenie</span>
                      <span className="text-amber-400">{LIGHTING_LABELS_FULL[lightingType] || lightingType}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Farba čela</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded border border-white/15" style={{ background: faceColor }} />
                        <span className="text-white">{faceColor}</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Farba boku</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded border border-white/15" style={{ background: sideColor }} />
                        <span className="text-white">{sideColor}</span>
                      </div>
                    </div>
                    {lightingType !== 'none' && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">LED</span>
                        <span className="text-white">{ledColor === 'warm_white' ? 'Teplá 3000K' : ledColor === 'cool_white' ? 'Studená 6000K' : 'RGB'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Price */}
              {price && (
                <div className="text-center py-3 rounded-xl border border-amber-500/15 bg-amber-500/[.03]">
                  <div className="text-2xl font-bold text-amber-400">{Math.round(price.totalPrice).toLocaleString('sk-SK')} €</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">orientačná cena</div>
                </div>
              )}

              {/* Info box */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-900/15 border border-emerald-500/15">
                <span className="text-lg">ℹ️</span>
                <div className="text-[11px] text-gray-400 space-y-1">
                  <p>STL generátor vytvorí kompletné výrobné súbory pre 3D tlač:</p>
                  <ul className="list-disc ml-4 space-y-0.5">
                    <li><b>Korpus</b> (shell) — vonkajšie steny písmena</li>
                    <li><b>Čelo</b> (face) — predný kryt (priehľadný ak front-lit)</li>
                    <li><b>Zadný panel</b> (back) — montáž na stenu</li>
                    <li><b>Dištance</b> (mounting) — pre halo podsvietenie</li>
                  </ul>
                </div>
              </div>

              {/* Generate button */}
              <button onClick={handleGenerate}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-sm font-bold tracking-wide hover:from-emerald-500 hover:to-emerald-400 transition-all active:scale-[0.98] shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2">
                <span className="text-lg">🏭</span>
                Generovať výrobné STL súbory
              </button>

              <p className="text-[9px] text-gray-600 text-center">
                Vyžaduje spustený STL backend (Python + CadQuery). <code className="text-gray-500">cd stl-generator && docker compose up</code>
              </p>
            </>
          )}

          {/* ── STEP: Generating ── */}
          {step === 'generating' && (
            <div className="text-center py-8 space-y-4">
              <div className="text-4xl animate-bounce">🏭</div>
              <h4 className="text-lg font-bold text-white">Generujem STL súbory...</h4>
              <p className="text-sm text-gray-400">CadQuery vytvára 3D modely. Toto môže trvať 10-60 sekúnd.</p>

              {/* Progress bar */}
              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-600 to-amber-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }} />
              </div>
              <p className="text-[10px] text-gray-500">{Math.round(progress)}%</p>
            </div>
          )}

          {/* ── STEP: Error ── */}
          {step === 'error' && (
            <div className="text-center py-6 space-y-4">
              <div className="text-4xl">⚠️</div>
              <h4 className="text-lg font-bold text-red-400">Chyba generovania</h4>
              <pre className="text-sm text-gray-400 whitespace-pre-wrap bg-red-900/10 border border-red-500/15 rounded-xl px-4 py-3">{error}</pre>
              <div className="flex gap-2 justify-center">
                <button onClick={handleGenerate}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 transition-colors">
                  Skúsiť znova
                </button>
                <button onClick={() => setStep('summary')}
                  className="px-5 py-2 rounded-xl bg-white/5 text-gray-300 text-sm hover:bg-white/10 transition-colors">
                  Späť
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Result ── */}
          {step === 'result' && stlResult && (
            <>
              {/* Success header — compact */}
              <div className="flex items-center gap-3 py-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-xl">✅</div>
                <div>
                  <h4 className="text-base font-bold text-emerald-400">STL súbory pripravené</h4>
                  <p className="text-[10px] text-gray-500">
                    {stlResult.letters.length} {stlResult.letters.length === 1 ? 'písmeno' : stlResult.letters.length < 5 ? 'písmená' : 'písmen'} · {stlResult.totalParts} dielov · {Math.round(stlResult.totalWeightG)}g
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] text-gray-500">{stlResult.material.toUpperCase()}</div>
                  {stlResult.totalLedCount > 0 && <div className="text-[10px] text-amber-400">💡 {stlResult.totalLedCount} LED</div>}
                </div>
              </div>

              {/* 3D Preview — main hero */}
              {stlFiles.length > 0 && (
                <div className="rounded-xl overflow-hidden border border-white/[.06]">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/[.02] border-b border-white/[.04]">
                    <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">3D Náhľad výrobných dielov</span>
                    <button onClick={() => setShow3D(!show3D)}
                      className="text-[10px] text-gray-500 hover:text-amber-400 transition-colors px-2 py-0.5 rounded hover:bg-white/[.04]">
                      {show3D ? '▼ Skryť' : '▶ Zobraziť'}
                    </button>
                  </div>
                  {show3D && <STLViewer files={stlFiles} className="h-[350px]" />}
                </div>
              )}

              {/* Parts breakdown — grouped by letter */}
              <div className="rounded-xl border border-white/[.06] overflow-hidden">
                <div className="px-3 py-2 bg-white/[.02] border-b border-white/[.04]">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Rozpis dielov</span>
                </div>
                <div className="divide-y divide-white/[.04]">
                  {stlResult.letters.map((letter: LetterInfo, i: number) => {
                    const isExpanded = expandedLetter === `${letter.char}-${i}`;
                    return (
                      <div key={`${letter.char}-${i}`}>
                        <button onClick={() => setExpandedLetter(isExpanded ? null : `${letter.char}-${i}`)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[.02] transition-colors">
                          {/* Letter badge */}
                          <span className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm shrink-0">
                            {letter.char}
                          </span>
                          {/* Info */}
                          <div className="flex-1 text-left">
                            <div className="text-[11px] text-white font-medium">
                              {letter.width_mm}×{letter.height_mm}×{letter.depth_mm} mm
                              {letter.is_segmented && <span className="ml-1.5 text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">{letter.segment_count} seg.</span>}
                            </div>
                            <div className="text-[9px] text-gray-500">{letter.parts_count} dielov · {letter.weight_g}g{letter.led_count > 0 ? ` · ${letter.led_count} LED` : ''}</div>
                          </div>
                          {/* Parts preview dots */}
                          <div className="flex gap-0.5">
                            {letter.parts.map(p => (
                              <span key={p.filename} className="w-2 h-2 rounded-sm" title={p.name}
                                style={{ backgroundColor: PART_CONFIG_MAP[p.part_type] || '#888' }} />
                            ))}
                          </div>
                          <span className="text-[10px] text-gray-600 ml-1">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                        {isExpanded && (
                          <div className="bg-white/[.01] px-3 pb-2 pt-1 ml-11 space-y-1">
                            {letter.parts.map(p => (
                              <div key={p.filename} className="flex items-center gap-2 text-[10px] py-0.5">
                                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: PART_CONFIG_MAP[p.part_type] || '#888' }} />
                                <span className="text-white/80 font-medium">{p.name}</span>
                                <span className="text-gray-600 flex-1 truncate">{p.description}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button onClick={handleDownload}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-[#060b18] text-sm font-bold tracking-wide hover:from-amber-500 hover:to-amber-400 transition-all active:scale-[0.98] shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2">
                  📦 Stiahnuť ZIP
                </button>
                <button onClick={handleGenerate}
                  className="px-4 py-3 rounded-xl border border-white/10 text-gray-400 text-[11px] font-semibold hover:bg-white/5 transition-colors">
                  🔄
                </button>
                <button onClick={onClose}
                  className="px-4 py-3 rounded-xl border border-white/10 text-gray-400 text-[11px] font-semibold hover:bg-white/5 transition-colors">
                  ✕
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
