import { create } from 'zustand';
import type {
  ConfiguratorStep,
  ContentType,
  ProfileType,
  LightingType,
  LedColor,
  OrderType,
  PriceBreakdown,
  Point2D,
  LogoConfig,
  LogoPlacement,
  LogoSourceType,
} from '@/types/configurator';
import { DEFAULT_LOGO_CONFIG } from '@/types/configurator';

interface PhotoState {
  url: string | null;
  width: number;
  height: number;
  file: File | null;
}

interface ScaleState {
  point1: Point2D | null;
  point2: Point2D | null;
  realMm: number | null;
  factorPxToMm: number | null;
}

interface ComputedDimensions {
  totalWidthMm: number;
  totalHeightMm: number;
  letterHeightMm: number;
  letterCount: number;
  logoAreaMm2: number;
}

interface OrderState {
  type: OrderType;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  installationAddress: string;
  notes: string;
}

interface PriceState {
  total: number;
  breakdown: PriceBreakdown | null;
  isCalculating: boolean;
}

interface ConfiguratorState {
  // === State ===
  configId: string | null;
  currentStep: ConfiguratorStep;

  // Typ obsahu
  contentType: ContentType;

  // Fotka
  photo: PhotoState;

  // Plocha (4 body)
  surfacePoints: Point2D[];

  // Mierka
  scale: ScaleState;

  // Text
  text: string;
  fontFamily: string;
  fontUrl: string;
  fontId: string;

  // Logo
  logo: LogoConfig;

  // 3D profil
  profileType: ProfileType;
  depthMm: number;

  // Farby
  faceColor: string;
  sideColor: string;
  faceRal: string;
  sideRal: string;

  // Podsvietenie
  lightingType: LightingType;
  ledColor: LedColor;

  // Vypočítané rozmery
  computed: ComputedDimensions;

  // Pozícia na fasáde
  position: Point2D;
  positionScale: number;

  // Cena
  price: PriceState;

  // Objednávka
  order: OrderState;

  // === Actions ===
  setConfigId: (id: string) => void;
  setStep: (step: ConfiguratorStep) => void;
  nextStep: () => void;
  prevStep: () => void;

  // Typ obsahu
  setContentType: (type: ContentType) => void;

  // Fotka
  setPhoto: (url: string, width: number, height: number, file: File) => void;
  clearPhoto: () => void;

  // Plocha
  setSurfacePoints: (points: Point2D[]) => void;
  clearSurfacePoints: () => void;

  // Mierka
  setScalePoints: (point1: Point2D, point2: Point2D) => void;
  setScaleRealMm: (mm: number) => void;
  clearScale: () => void;

  // Text
  setText: (text: string) => void;
  setFont: (family: string, url: string, id: string) => void;

  // Logo
  setLogoSVG: (svgUrl: string, svgContent: string, width: number, height: number) => void;
  setLogoRaster: (rasterUrl: string, file: File, width: number, height: number) => void;
  setLogoPlacement: (placement: LogoPlacement) => void;
  setLogoScale: (scale: number) => void;
  setLogoOffset: (x: number, y: number) => void;
  setLogoExtrudeAsRelief: (value: boolean) => void;
  setLogoReliefDepth: (mm: number) => void;
  setLogoDimensions: (widthMm: number, heightMm: number) => void;
  clearLogo: () => void;

  // Profil
  setProfileType: (type: ProfileType) => void;
  setDepthMm: (mm: number) => void;

  // Farby
  setFaceColor: (hex: string, ral?: string) => void;
  setSideColor: (hex: string, ral?: string) => void;

  // Podsvietenie
  setLightingType: (type: LightingType) => void;
  setLedColor: (color: LedColor) => void;

  // Rozmery
  setComputed: (dimensions: Partial<ComputedDimensions>) => void;

  // Pozícia
  setPosition: (pos: Point2D) => void;
  setPositionScale: (scale: number) => void;

  // Cena
  setPrice: (price: Partial<PriceState>) => void;

  // Objednávka
  setOrder: (order: Partial<OrderState>) => void;

  // Reset
  reset: () => void;
}

const STEP_ORDER: ConfiguratorStep[] = ['upload', 'content', 'scale', 'preview', 'order'];

const initialState = {
  configId: null as string | null,
  currentStep: 'upload' as ConfiguratorStep,

  contentType: 'text_only' as ContentType,

  photo: {
    url: null,
    width: 0,
    height: 0,
    file: null,
  } as PhotoState,

  surfacePoints: [] as Point2D[],

  scale: {
    point1: null,
    point2: null,
    realMm: null,
    factorPxToMm: null,
  } as ScaleState,

  text: '',
  fontFamily: 'Montserrat',
  fontUrl: '/fonts/Montserrat-Bold.ttf',
  fontId: '',

  logo: { ...DEFAULT_LOGO_CONFIG } as LogoConfig,

  profileType: 'flat' as ProfileType,
  depthMm: 50,

  faceColor: '#FFFFFF',
  sideColor: '#FFFFFF',
  faceRal: 'RAL 9003',
  sideRal: 'RAL 9003',

  lightingType: 'none' as LightingType,
  ledColor: 'warm_white' as LedColor,

  computed: {
    totalWidthMm: 0,
    totalHeightMm: 0,
    letterHeightMm: 0,
    letterCount: 0,
    logoAreaMm2: 0,
  },

  position: { x: 0.5, y: 0.5 },
  positionScale: 1,

  price: {
    total: 0,
    breakdown: null,
    isCalculating: false,
  } as PriceState,

  order: {
    type: 'production_only' as OrderType,
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    installationAddress: '',
    notes: '',
  },
};

export const useConfiguratorStore = create<ConfiguratorState>((set, get) => ({
  ...initialState,

  // === Navigation ===
  setConfigId: (id) => set({ configId: id }),

  setStep: (step) => set({ currentStep: step }),

  nextStep: () => {
    const { currentStep } = get();
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx < STEP_ORDER.length - 1) {
      set({ currentStep: STEP_ORDER[idx + 1] });
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx > 0) {
      set({ currentStep: STEP_ORDER[idx - 1] });
    }
  },

  // === Content Type ===
  setContentType: (type) => {
    set({ contentType: type });
    // Ak logo_only, vymaž text
    if (type === 'logo_only') {
      set({ text: '' });
    }
    // Ak text_only, vymaž logo
    if (type === 'text_only') {
      set({ logo: { ...DEFAULT_LOGO_CONFIG } });
    }
  },

  // === Photo ===
  setPhoto: (url, width, height, file) =>
    set({ photo: { url, width, height, file } }),

  clearPhoto: () =>
    set({ photo: { url: null, width: 0, height: 0, file: null }, surfacePoints: [] }),

  // === Surface Points ===
  setSurfacePoints: (points) => set({ surfacePoints: points }),
  clearSurfacePoints: () => set({ surfacePoints: [] }),

  // === Scale ===
  setScalePoints: (point1, point2) =>
    set((state) => ({
      scale: { ...state.scale, point1, point2 },
    })),

  setScaleRealMm: (mm) =>
    set((state) => {
      const { point1, point2 } = state.scale;
      let factorPxToMm: number | null = null;

      if (point1 && point2) {
        const pixelDist = Math.sqrt(
          Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2)
        );
        if (pixelDist > 0) {
          factorPxToMm = mm / pixelDist;
        }
      }

      return {
        scale: { ...state.scale, realMm: mm, factorPxToMm },
      };
    }),

  clearScale: () =>
    set({
      scale: { point1: null, point2: null, realMm: null, factorPxToMm: null },
    }),

  // === Text ===
  setText: (text) =>
    set({
      text,
      computed: {
        ...get().computed,
        letterCount: text.replace(/\s/g, '').length,
      },
    }),

  setFont: (family, url, id) =>
    set({ fontFamily: family, fontUrl: url, fontId: id }),

  // === Logo ===
  setLogoSVG: (svgUrl, svgContent, width, height) =>
    set((state) => ({
      logo: {
        ...state.logo,
        sourceType: 'svg' as LogoSourceType,
        svgUrl,
        svgContent,
        originalWidth: width,
        originalHeight: height,
        rasterUrl: null,
        rasterFile: null,
        extrudeAsRelief: false,
      },
    })),

  setLogoRaster: (rasterUrl, file, width, height) =>
    set((state) => ({
      logo: {
        ...state.logo,
        sourceType: 'raster' as LogoSourceType,
        rasterUrl,
        rasterFile: file,
        originalWidth: width,
        originalHeight: height,
        svgUrl: null,
        svgContent: null,
        extrudeAsRelief: true, // Raster → reliéf / flat panel
      },
    })),

  setLogoPlacement: (placement) =>
    set((state) => ({
      logo: { ...state.logo, logoPlacement: placement },
    })),

  setLogoScale: (scale) =>
    set((state) => ({
      logo: { ...state.logo, logoScale: Math.max(0.1, Math.min(3.0, scale)) },
    })),

  setLogoOffset: (x, y) =>
    set((state) => ({
      logo: { ...state.logo, logoOffsetX: x, logoOffsetY: y },
    })),

  setLogoExtrudeAsRelief: (value) =>
    set((state) => ({
      logo: { ...state.logo, extrudeAsRelief: value },
    })),

  setLogoReliefDepth: (mm) =>
    set((state) => ({
      logo: { ...state.logo, reliefDepthMm: Math.max(2, Math.min(50, mm)) },
    })),

  setLogoDimensions: (widthMm, heightMm) =>
    set((state) => ({
      logo: { ...state.logo, logoWidthMm: widthMm, logoHeightMm: heightMm },
      computed: {
        ...state.computed,
        logoAreaMm2: widthMm * heightMm * 0.7, // ~70% fill ratio pre logá
      },
    })),

  clearLogo: () =>
    set((state) => ({
      logo: { ...DEFAULT_LOGO_CONFIG },
      computed: { ...state.computed, logoAreaMm2: 0 },
    })),

  // === Profile ===
  setProfileType: (type) => set({ profileType: type }),

  setDepthMm: (mm) => set({ depthMm: Math.max(20, Math.min(200, mm)) }),

  // === Colors ===
  setFaceColor: (hex, ral) =>
    set({ faceColor: hex, ...(ral ? { faceRal: ral } : {}) }),

  setSideColor: (hex, ral) =>
    set({ sideColor: hex, ...(ral ? { sideRal: ral } : {}) }),

  // === Lighting ===
  setLightingType: (type) => {
    const { depthMm } = get();
    const minDepths: Record<LightingType, number> = {
      none: 20,
      front: 50,
      halo: 40,
      front_halo: 60,
    };
    const minDepth = minDepths[type];
    set({
      lightingType: type,
      ...(depthMm < minDepth ? { depthMm: minDepth } : {}),
    });
  },

  setLedColor: (color) => set({ ledColor: color }),

  // === Computed ===
  setComputed: (dimensions) =>
    set((state) => ({
      computed: { ...state.computed, ...dimensions },
    })),

  // === Position ===
  setPosition: (pos) => set({ position: pos }),
  setPositionScale: (scale) => set({ positionScale: scale }),

  // === Price ===
  setPrice: (price) =>
    set((state) => ({
      price: { ...state.price, ...price },
    })),

  // === Order ===
  setOrder: (order) =>
    set((state) => ({
      order: { ...state.order, ...order },
    })),

  // === Reset ===
  reset: () => set(initialState),
}));
