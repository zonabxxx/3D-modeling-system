import { create } from 'zustand';
import type {
  ContentType, ProfileType, LightingType, LedColor, OrderType,
  PriceBreakdown, Point2D, LogoConfig, LogoPlacement, LogoSourceType,
} from './types';
import { DEFAULT_LOGO_CONFIG } from './types';

interface PhotoState { url: string | null; width: number; height: number; file: File | null; }
interface ScaleState { point1: Point2D | null; point2: Point2D | null; realMm: number | null; factorPxToMm: number | null; }
interface ComputedDims { totalWidthMm: number; totalHeightMm: number; letterHeightMm: number; letterCount: number; logoAreaMm2: number; }
interface OrderState { type: OrderType; clientName: string; clientEmail: string; clientPhone: string; installationAddress: string; notes: string; }
interface PriceState { total: number; breakdown: PriceBreakdown | null; isCalculating: boolean; }

export interface ConfiguratorState {
  contentType: ContentType;
  photo: PhotoState;
  scale: ScaleState;
  text: string;
  fontFamily: string;
  fontUrl: string;
  logo: LogoConfig;
  profileType: ProfileType;
  depthMm: number;
  faceColor: string;
  sideColor: string;
  faceRal: string;
  sideRal: string;
  lightingType: LightingType;
  ledColor: LedColor;
  computed: ComputedDims;
  position: Point2D;
  positionScale: number;
  price: PriceState;
  order: OrderState;

  setContentType: (t: ContentType) => void;
  setPhoto: (url: string, w: number, h: number, file: File) => void;
  clearPhoto: () => void;
  setScalePoints: (p1: Point2D, p2: Point2D) => void;
  setScaleRealMm: (mm: number) => void;
  clearScale: () => void;
  setText: (t: string) => void;
  setFont: (family: string, url: string) => void;
  setLogoSVG: (svgUrl: string, svgContent: string, w: number, h: number) => void;
  setLogoRaster: (rasterUrl: string, file: File, w: number, h: number) => void;
  setLogoPlacement: (p: LogoPlacement) => void;
  setLogoScale: (s: number) => void;
  setLogoExtrudeAsRelief: (v: boolean) => void;
  setLogoReliefDepth: (mm: number) => void;
  clearLogo: () => void;
  setProfileType: (t: ProfileType) => void;
  setDepthMm: (mm: number) => void;
  setFaceColor: (hex: string, ral?: string) => void;
  setSideColor: (hex: string, ral?: string) => void;
  setLightingType: (t: LightingType) => void;
  setLedColor: (c: LedColor) => void;
  setComputed: (d: Partial<ComputedDims>) => void;
  setPosition: (p: Point2D) => void;
  setPositionScale: (s: number) => void;
  setOrder: (o: Partial<OrderState>) => void;
  reset: () => void;
}

const initial = {
  contentType: 'text_only' as ContentType,
  photo: { url: null, width: 0, height: 0, file: null } as PhotoState,
  scale: { point1: null, point2: null, realMm: null, factorPxToMm: null } as ScaleState,
  text: '',
  fontFamily: 'Montserrat',
  fontUrl: '/fonts/Montserrat-Bold.ttf',
  logo: { ...DEFAULT_LOGO_CONFIG },
  profileType: 'flat' as ProfileType,
  depthMm: 50,
  faceColor: '#FFFFFF',
  sideColor: '#FFFFFF',
  faceRal: 'RAL 9003',
  sideRal: 'RAL 9003',
  lightingType: 'front' as LightingType,
  ledColor: 'warm_white' as LedColor,
  computed: { totalWidthMm: 0, totalHeightMm: 0, letterHeightMm: 200, letterCount: 0, logoAreaMm2: 0 },
  position: { x: 0.5, y: 0.5 },
  positionScale: 1,
  price: { total: 0, breakdown: null, isCalculating: false } as PriceState,
  order: { type: 'production_only' as OrderType, clientName: '', clientEmail: '', clientPhone: '', installationAddress: '', notes: '' },
};

export const useStore = create<ConfiguratorState>((set, get) => ({
  ...initial,
  setContentType: (t) => set({ contentType: t }),
  setPhoto: (url, w, h, file) => set({ photo: { url, width: w, height: h, file } }),
  clearPhoto: () => set({ photo: { url: null, width: 0, height: 0, file: null } }),
  setScalePoints: (p1, p2) => set((s) => ({ scale: { ...s.scale, point1: p1, point2: p2 } })),
  setScaleRealMm: (mm) => set((s) => {
    const { point1: p1, point2: p2 } = s.scale;
    let f: number | null = null;
    if (p1 && p2) {
      const d = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      if (d > 0) f = mm / d;
    }
    return { scale: { ...s.scale, realMm: mm, factorPxToMm: f } };
  }),
  clearScale: () => set({ scale: { point1: null, point2: null, realMm: null, factorPxToMm: null } }),
  setText: (t) => set((s) => ({ text: t, computed: { ...s.computed, letterCount: t.replace(/\s/g, '').length } })),
  setFont: (family, url) => set({ fontFamily: family, fontUrl: url }),
  setLogoSVG: (svgUrl, svgContent, w, h) => set((s) => ({
    logo: { ...s.logo, sourceType: 'svg' as LogoSourceType, svgUrl, svgContent, originalWidth: w, originalHeight: h, rasterUrl: null, rasterFile: null, extrudeAsRelief: false },
  })),
  setLogoRaster: (rasterUrl, file, w, h) => set((s) => ({
    logo: { ...s.logo, sourceType: 'raster' as LogoSourceType, rasterUrl, rasterFile: file, originalWidth: w, originalHeight: h, svgUrl: null, svgContent: null, extrudeAsRelief: true },
  })),
  setLogoPlacement: (p) => set((s) => ({ logo: { ...s.logo, logoPlacement: p } })),
  setLogoScale: (sc) => set((s) => ({ logo: { ...s.logo, logoScale: Math.max(0.1, Math.min(3, sc)) } })),
  setLogoExtrudeAsRelief: (v) => set((s) => ({ logo: { ...s.logo, extrudeAsRelief: v } })),
  setLogoReliefDepth: (mm) => set((s) => ({ logo: { ...s.logo, reliefDepthMm: Math.max(2, Math.min(50, mm)) } })),
  clearLogo: () => set((s) => ({ logo: { ...DEFAULT_LOGO_CONFIG }, computed: { ...s.computed, logoAreaMm2: 0 } })),
  setProfileType: (t) => set({ profileType: t }),
  setDepthMm: (mm) => set({ depthMm: Math.max(20, Math.min(200, mm)) }),
  setFaceColor: (hex, ral) => set({ faceColor: hex, ...(ral ? { faceRal: ral } : {}) }),
  setSideColor: (hex, ral) => set({ sideColor: hex, ...(ral ? { sideRal: ral } : {}) }),
  setLightingType: (t) => {
    const mins: Record<LightingType, number> = { none: 20, front: 50, halo: 40, front_halo: 60 };
    const { depthMm } = get();
    set({ lightingType: t, ...(depthMm < mins[t] ? { depthMm: mins[t] } : {}) });
  },
  setLedColor: (c) => set({ ledColor: c }),
  setComputed: (d) => set((s) => ({ computed: { ...s.computed, ...d } })),
  setPosition: (p) => set({ position: p }),
  setPositionScale: (s) => set({ positionScale: s }),
  setOrder: (o) => set((s) => ({ order: { ...s.order, ...o } })),
  reset: () => set(initial),
}));
