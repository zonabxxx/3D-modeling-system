// ==========================================
// HLAVNÉ TYPY PRE 3D KONFIGURÁTOR
// ==========================================

// === Geometrické typy ===

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  width: number;
  height: number;
  depth: number;
}

// === Typ obsahu (text, logo alebo oboje) ===

export type ContentType = 'text_only' | 'logo_only' | 'text_and_logo';

export type LogoSourceType = 'svg' | 'raster';

export interface LogoConfig {
  sourceType: LogoSourceType;
  // SVG logo
  svgUrl: string | null;       // URL nahraného SVG súboru
  svgContent: string | null;   // SVG XML obsah (vyčistený pri uploade)
  // Raster logo (PNG/JPG)
  rasterUrl: string | null;    // URL nahraného rastra
  rasterFile: File | null;
  // Spoločné
  originalWidth: number;       // šírka obsahu
  originalHeight: number;      // výška obsahu
  // 3D nastavenia
  extrudeAsRelief: boolean;    // true = reliéf z rastra, false = vektorová extrúzia
  reliefDepthMm: number;       // hĺbka reliéfu
  // Pozícia voči textu
  logoPlacement: LogoPlacement;
  logoWidthMm: number | null;  // šírka loga v mm
  logoHeightMm: number | null; // výška loga v mm
  // Transformácie
  logoScale: number;           // scale faktor 0.1–3.0
  logoOffsetX: number;         // offset X v mm voči centru
  logoOffsetY: number;         // offset Y v mm voči centru
}

export type LogoPlacement = 'above_text' | 'below_text' | 'left_of_text' | 'right_of_text' | 'standalone' | 'behind_text';

export const LOGO_PLACEMENT_LABELS: Record<LogoPlacement, string> = {
  above_text: 'Nad textom',
  below_text: 'Pod textom',
  left_of_text: 'Naľavo od textu',
  right_of_text: 'Napravo od textu',
  standalone: 'Samostatné (bez textu)',
  behind_text: 'Za textom (pozadie)',
};

export const DEFAULT_LOGO_CONFIG: LogoConfig = {
  sourceType: 'svg',
  svgUrl: null,
  svgContent: null,
  rasterUrl: null,
  rasterFile: null,
  originalWidth: 0,
  originalHeight: 0,
  extrudeAsRelief: false,
  reliefDepthMm: 5,
  logoPlacement: 'above_text',
  logoWidthMm: null,
  logoHeightMm: null,
  logoScale: 1,
  logoOffsetX: 0,
  logoOffsetY: 0,
};

// === Profily ===

export type ProfileType = 'flat' | 'rounded' | 'chamfer';

export interface ExtrudeSettings {
  depth: number;
  bevelEnabled: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelSegments?: number;
  bevelOffset?: number;
  curveSegments?: number;
}

export const PROFILE_EXTRUDE_SETTINGS: Record<ProfileType, (depthMm: number) => ExtrudeSettings> = {
  flat: (depth) => ({
    depth,
    bevelEnabled: false,
  }),
  rounded: (depth) => ({
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(depth * 0.1, 5),
    bevelSize: Math.min(depth * 0.1, 5),
    bevelSegments: 8,
  }),
  chamfer: (depth) => ({
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(depth * 0.15, 8),
    bevelSize: Math.min(depth * 0.15, 8),
    bevelSegments: 1,
  }),
};

// === Podsvietenie ===

export type LightingType = 'none' | 'front' | 'halo' | 'front_halo';
export type LedColor = 'warm_white' | 'cool_white' | 'rgb';

export interface LightingRequirements {
  minDepthMm: number;
  needsOpalFace: boolean;
  needsBackGap: boolean;
  backGapMm?: number;
}

export const LIGHTING_REQUIREMENTS: Record<LightingType, LightingRequirements> = {
  none: { minDepthMm: 20, needsOpalFace: false, needsBackGap: false },
  front: { minDepthMm: 50, needsOpalFace: true, needsBackGap: false },
  halo: { minDepthMm: 40, needsOpalFace: false, needsBackGap: true, backGapMm: 20 },
  front_halo: { minDepthMm: 60, needsOpalFace: true, needsBackGap: true, backGapMm: 20 },
};

// === Farby ===

export interface SignColor {
  id: string;
  ralCode: string | null;
  name: string;
  hexColor: string;
  category: 'standard' | 'metallic' | 'custom';
  priceMultiplier: number;
}

// === Fonty ===

export interface SignFont {
  id: string;
  name: string;
  displayName: string;
  family: string;
  weight: string;
  fileUrl: string;
  previewUrl: string | null;
  isExtrusionSafe: boolean;
  minRecommendedMm: number;
}

// === Konfigurácia ===

export type ConfigStatus = 'draft' | 'preview' | 'ordered' | 'manufacturing' | 'completed';
export type OrderType = 'production_only' | 'production_and_installation';

export interface SignConfiguration {
  id: string;
  sessionId: string;
  status: ConfigStatus;

  // Typ obsahu
  contentType: ContentType;

  // Fotka
  photo: {
    url: string;
    width: number;
    height: number;
  };

  // Plocha (4 body)
  surfacePoints: [Point2D, Point2D, Point2D, Point2D] | null;

  // Mierka
  scale: {
    point1: Point2D | null;
    point2: Point2D | null;
    realMm: number | null;
    factorPxToMm: number | null;
  };

  // Text (prázdny ak contentType === 'logo_only')
  text: string;
  font: SignFont;

  // Logo (null ak contentType === 'text_only')
  logo: LogoConfig | null;

  // 3D
  profileType: ProfileType;
  depthMm: number;

  // Farby
  faceColor: string;
  sideColor: string;
  faceRal: string | null;
  sideRal: string | null;

  // Podsvietenie
  lightingType: LightingType;
  ledColor: LedColor;

  // Vypočítané
  computed: {
    totalWidthMm: number;
    totalHeightMm: number;
    letterHeightMm: number;
    letterCount: number;
    logoAreaMm2: number;
  };

  // Pozícia
  position: Point2D;
  positionScale: number;

  // Cena
  price: PriceBreakdown | null;

  // Objednávka
  order: OrderInfo | null;
}

// === Cenový model ===

export interface PriceBreakdown {
  // Materiál
  materialCost: number;
  materialDetails: string;

  // Práca (3D tlač + post-processing)
  laborCost: number;
  laborHours: number;

  // Logo (ak je súčasťou konfigurácie)
  logoCost: number;
  logoAreaMm2: number;
  logoDetails: string;

  // LED
  ledCost: number;
  ledModulesCount: number;
  ledSourceCost: number;

  // Náter
  paintCost: number;
  paintAreaM2: number;
  colorMultiplier: number;

  // Profil prirážka
  profileMultiplier: number;

  // Montáž
  installationCost: number;

  // Fixné náklady
  designFee: number;
  packagingCost: number;
  shippingCost: number;

  // Súčty
  subtotal: number;
  totalPrice: number;
  pricePerLetter: number;
  pricePerItem: number; // per letter + logo ako 1 item
}

export interface OrderInfo {
  type: OrderType;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  installationAddress: string;
  notes: string;
  externalOrderId: string | null;
}

// === Výrobné pravidlá ===

export interface ManufacturingLimits {
  minLetterHeightMm: number;
  maxLetterHeightMm: number;
  minDepthMm: number;
  maxDepthMm: number;
  minWallThicknessMm: number;
  maxSinglePieceMm: number;
  minStrokeWidthMm: number;
}

export const DEFAULT_MANUFACTURING_LIMITS: ManufacturingLimits = {
  minLetterHeightMm: 30,
  maxLetterHeightMm: 2000,
  minDepthMm: 20,
  maxDepthMm: 200,
  minWallThicknessMm: 2.0,
  maxSinglePieceMm: 400,
  minStrokeWidthMm: 3.0,
};

export interface ManufacturingValidation {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  autoFixes: Array<{
    field: string;
    oldValue: number;
    newValue: number;
    reason: string;
  }>;
}

// === STL Export ===

export type ExportItemType = 'letter' | 'logo' | 'logo_segment';

export interface STLExportResult {
  itemType: ExportItemType;
  letterIndex?: number;
  character?: string;
  segmentIndex?: number;
  totalSegments?: number;
  stlBuffer: ArrayBuffer;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  fileName: string;
}

export interface LetterSegmentation {
  needsSegmentation: boolean;
  segments: Array<{
    index: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    hasConnectorLeft: boolean;
    hasConnectorRight: boolean;
    hasConnectorTop: boolean;
    hasConnectorBottom: boolean;
  }>;
}

// === Konfigurátor Store ===

export type ConfiguratorStep = 'upload' | 'content' | 'scale' | 'preview' | 'order';

export const STEP_ORDER: ConfiguratorStep[] = ['upload', 'content', 'scale', 'preview', 'order'];

export const STEP_LABELS: Record<ConfiguratorStep, string> = {
  upload: 'Fotka fasády',
  content: 'Text / Logo',
  scale: 'Rozmery',
  preview: '3D náhľad',
  order: 'Objednávka',
};

// === Depth predvoľby ===

export const DEPTH_PRESETS = [
  { value: 30, label: '30 mm', description: 'Tenké – interiér' },
  { value: 50, label: '50 mm', description: 'Štandard' },
  { value: 80, label: '80 mm', description: 'Stredné' },
  { value: 100, label: '100 mm', description: 'Hrubé – exteriér' },
  { value: 150, label: '150 mm', description: 'Extra hrubé' },
] as const;

// === Predvolené fonty ===

export const DEFAULT_FONTS: Array<{
  name: string;
  displayName: string;
  family: string;
  weight: string;
  fileName: string;
}> = [
  { name: 'Montserrat Bold', displayName: 'Montserrat (tučné)', family: 'Montserrat', weight: '700', fileName: 'montserrat-bold.ttf' },
  { name: 'Bebas Neue', displayName: 'Bebas Neue', family: 'Bebas Neue', weight: '400', fileName: 'bebas-neue.ttf' },
  { name: 'Oswald Bold', displayName: 'Oswald (tučné)', family: 'Oswald', weight: '700', fileName: 'oswald-bold.ttf' },
  { name: 'Poppins Black', displayName: 'Poppins (extra tučné)', family: 'Poppins', weight: '900', fileName: 'poppins-black.ttf' },
  { name: 'Roboto Bold', displayName: 'Roboto (tučné)', family: 'Roboto', weight: '700', fileName: 'roboto-bold.ttf' },
  { name: 'Inter Bold', displayName: 'Inter (tučné)', family: 'Inter', weight: '700', fileName: 'inter-bold.ttf' },
  { name: 'Raleway Black', displayName: 'Raleway (extra tučné)', family: 'Raleway', weight: '900', fileName: 'raleway-black.ttf' },
  { name: 'Archivo Black', displayName: 'Archivo Black', family: 'Archivo Black', weight: '400', fileName: 'archivo-black.ttf' },
  { name: 'Outfit Bold', displayName: 'Outfit (tučné)', family: 'Outfit', weight: '700', fileName: 'outfit-bold.ttf' },
  { name: 'Barlow Bold', displayName: 'Barlow (tučné)', family: 'Barlow', weight: '700', fileName: 'barlow-bold.ttf' },
];
