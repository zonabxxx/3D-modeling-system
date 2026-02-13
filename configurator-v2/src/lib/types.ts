// ==========================================
// TYPY PRE KONFIGURÁTOR V2 (Astro)
// ==========================================

export interface Point2D { x: number; y: number; }

export type ContentType = 'text_only' | 'logo_only' | 'text_and_logo';
export type LogoSourceType = 'svg' | 'raster';
export type LogoPlacement = 'above_text' | 'below_text' | 'left_of_text' | 'right_of_text' | 'standalone' | 'behind_text';
export type ProfileType = 'flat' | 'rounded' | 'chamfer';
export type LightingType = 'none' | 'front' | 'halo' | 'front_halo';
export type LedColor = 'warm_white' | 'cool_white' | 'rgb';
export type OrderType = 'production_only' | 'production_and_installation';

export interface LogoConfig {
  sourceType: LogoSourceType;
  svgUrl: string | null;
  svgContent: string | null;
  rasterUrl: string | null;
  rasterFile: File | null;
  originalWidth: number;
  originalHeight: number;
  extrudeAsRelief: boolean;
  reliefDepthMm: number;
  logoPlacement: LogoPlacement;
  logoWidthMm: number | null;
  logoHeightMm: number | null;
  logoScale: number;
  logoOffsetX: number;
  logoOffsetY: number;
}

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

export interface PriceBreakdown {
  materialCost: number;
  materialDetails: string;
  laborCost: number;
  laborHours: number;
  logoCost: number;
  logoAreaMm2: number;
  logoDetails: string;
  ledCost: number;
  ledModulesCount: number;
  ledSourceCost: number;
  paintCost: number;
  paintAreaM2: number;
  colorMultiplier: number;
  profileMultiplier: number;
  installationCost: number;
  designFee: number;
  packagingCost: number;
  shippingCost: number;
  subtotal: number;
  totalPrice: number;
  pricePerLetter: number;
  pricePerItem: number;
}

export const LOGO_PLACEMENT_LABELS: Record<LogoPlacement, string> = {
  above_text: 'Nad textom',
  below_text: 'Pod textom',
  left_of_text: 'Naľavo',
  right_of_text: 'Napravo',
  standalone: 'Samostatné',
  behind_text: 'Za textom',
};

export const FONT_OPTIONS = [
  { family: 'Montserrat', label: 'Montserrat', file: 'Montserrat-Bold.ttf' },
  { family: 'Bebas Neue', label: 'Bebas', file: 'BebasNeue-Regular.ttf' },
  { family: 'Oswald', label: 'Oswald', file: 'Oswald-Bold.ttf' },
  { family: 'Poppins', label: 'Poppins', file: 'Poppins-Black.ttf' },
  { family: 'Roboto', label: 'Roboto', file: 'Roboto-Bold.ttf' },
  { family: 'Archivo Black', label: 'Archivo', file: 'ArchivoBlack-Regular.ttf' },
  { family: 'Raleway', label: 'Raleway', file: 'Raleway-Black.ttf' },
  { family: 'Outfit', label: 'Outfit', file: 'Outfit-Bold.ttf' },
  { family: 'Barlow', label: 'Barlow', file: 'Barlow-Bold.ttf' },
] as const;
