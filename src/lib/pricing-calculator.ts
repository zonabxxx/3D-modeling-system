/**
 * Cenový kalkulátor pre 3D svetelné reklamy
 * 
 * Výpočet: materiál + práca + LED + náter + montáž + fixné náklady
 */

import type {
  ProfileType,
  LightingType,
  PriceBreakdown,
} from '@/types/configurator';

// === Cenové konštanty (konfigurovateľné cez admin) ===

interface PricingConfig {
  // Materiál (ASA/ABS)
  materialPricePerCm3: number; // €/cm³

  // Práca
  hourlyRate: number; // €/hod
  timePerLetterBaseHours: number; // základný čas na písmeno
  timePerCm2SurfaceHours: number; // čas na cm² povrchu

  // LED
  ledModulePriceEur: number; // cena za 1 LED modul
  ledSourcePrice12V: number; // zdroj 12V
  ledSourcePrice24V: number; // zdroj 24V
  ledSpacingMm: number; // rozstup modulov

  // Náter
  paintPricePerM2: number; // €/m² náter

  // Profil multiplikátory
  profileMultipliers: Record<ProfileType, number>;

  // Podsvietenie multiplikátory
  lightingMultipliers: Record<LightingType, number>;

  // Fixné náklady
  designFeeEur: number;
  packagingEur: number;
  shippingEur: number;

  // Montáž
  installationBaseEur: number; // základná cena montáže
  installationPerLetterEur: number; // za písmeno
  installationPerMeterHeightEur: number; // za meter výšky

  // Farebné prirážky
  metallicColorMultiplier: number;
  customRalMultiplier: number;

  // Logo prirážky
  logoPricePerCm2: number; // €/cm² plochy loga (SVG extrúzia)
  logoReliefPricePerCm2: number; // €/cm² pre reliéf (raster)
  logoMinPriceEur: number; // minimálna cena za logo
  logoComplexityMultiplier: number; // prirážka za zložité logá (veľa kriviek)
}

const DEFAULT_PRICING: PricingConfig = {
  materialPricePerCm3: 0.08,
  hourlyRate: 25,
  timePerLetterBaseHours: 0.5,
  timePerCm2SurfaceHours: 0.001,

  ledModulePriceEur: 2.5,
  ledSourcePrice12V: 15,
  ledSourcePrice24V: 25,
  ledSpacingMm: 25,

  paintPricePerM2: 35,

  profileMultipliers: {
    flat: 1.0,
    rounded: 1.15,
    chamfer: 1.1,
  },

  lightingMultipliers: {
    none: 1.0,
    front: 1.4,
    halo: 1.3,
    front_halo: 1.6,
  },

  designFeeEur: 25,
  packagingEur: 15,
  shippingEur: 20,

  installationBaseEur: 150,
  installationPerLetterEur: 15,
  installationPerMeterHeightEur: 50,

  metallicColorMultiplier: 1.2,
  customRalMultiplier: 1.1,

  logoPricePerCm2: 0.5, // €/cm² SVG logo extrúzia
  logoReliefPricePerCm2: 0.35, // €/cm² reliéf (raster logo)
  logoMinPriceEur: 15, // minimálna cena za logo
  logoComplexityMultiplier: 1.0, // base, can be 1.3 for complex logos
};

// === Kalkulátor ===

export interface PriceCalculationInput {
  letterCount: number;
  letterHeightMm: number;
  totalWidthMm: number;
  depthMm: number;
  profileType: ProfileType;
  lightingType: LightingType;
  colorCategory: 'standard' | 'metallic' | 'custom';
  includeInstallation: boolean;
  installationHeightM?: number; // výška montáže v metroch
  // Logo
  hasLogo: boolean;
  logoAreaMm2?: number; // plocha loga v mm²
  logoIsRelief?: boolean; // true = raster reliéf, false = SVG extrúzia
  logoComplexity?: number; // 1.0–2.0 multiplikátor zložitosti
}

export function calculatePrice(
  input: PriceCalculationInput,
  config: PricingConfig = DEFAULT_PRICING,
): PriceBreakdown {
  const {
    letterCount,
    letterHeightMm,
    totalWidthMm,
    depthMm,
    profileType,
    lightingType,
    colorCategory,
    includeInstallation,
    installationHeightM = 3,
    hasLogo = false,
    logoAreaMm2 = 0,
    logoIsRelief = false,
    logoComplexity = 1.0,
  } = input;

  // 1. Materiál – objem písmen (zjednodušený odhad)
  // Skutočný objem závisí od fontu, toto je konzervatívny odhad
  const avgLetterWidthMm = totalWidthMm / Math.max(letterCount, 1);
  const avgLetterAreaMm2 = avgLetterWidthMm * letterHeightMm * 0.6; // ~60% fill ratio
  const volumePerLetterCm3 = (avgLetterAreaMm2 * depthMm) / 1000; // mm³ → cm³
  const totalVolumeCm3 = volumePerLetterCm3 * letterCount;
  const materialCost = totalVolumeCm3 * config.materialPricePerCm3;

  // 2. Práca
  const surfaceAreaCm2 = (avgLetterAreaMm2 * letterCount * 2 + // predná + zadná
    letterCount * (letterHeightMm + avgLetterWidthMm) * 2 * depthMm) / 100; // bočnice
  const laborHours =
    letterCount * config.timePerLetterBaseHours +
    surfaceAreaCm2 * config.timePerCm2SurfaceHours;
  const laborCost = laborHours * config.hourlyRate;

  // 3. LED
  let ledCost = 0;
  let ledModulesCount = 0;
  let ledSourceCost = 0;

  if (lightingType !== 'none') {
    // Počet LED modulov na písmeno (podľa výšky a rozostupu)
    const modulesPerLetter = Math.ceil(letterHeightMm / config.ledSpacingMm);
    ledModulesCount = modulesPerLetter * letterCount;

    if (lightingType === 'front_halo') {
      ledModulesCount *= 2; // Dvojitá sada
    }

    ledCost = ledModulesCount * config.ledModulePriceEur;
    ledSourceCost = ledModulesCount > 20 ? config.ledSourcePrice24V : config.ledSourcePrice12V;
    ledCost += ledSourceCost;
  }

  // 4. Náter
  const totalPaintAreaM2 = surfaceAreaCm2 / 10000; // cm² → m²
  let colorMultiplier = 1.0;
  if (colorCategory === 'metallic') {
    colorMultiplier = config.metallicColorMultiplier;
  } else if (colorCategory === 'custom') {
    colorMultiplier = config.customRalMultiplier;
  }
  const paintCost = totalPaintAreaM2 * config.paintPricePerM2 * colorMultiplier;

  // 5. Profil prirážka
  const profileMultiplier = config.profileMultipliers[profileType];

  // 6. Montáž
  let installationCost = 0;
  if (includeInstallation) {
    installationCost =
      config.installationBaseEur +
      letterCount * config.installationPerLetterEur +
      installationHeightM * config.installationPerMeterHeightEur;
  }

  // 7. Logo
  let logoCost = 0;
  let logoDetails = '';
  if (hasLogo && logoAreaMm2 > 0) {
    const logoAreaCm2 = logoAreaMm2 / 100; // mm² → cm²
    const pricePerCm2 = logoIsRelief
      ? config.logoReliefPricePerCm2
      : config.logoPricePerCm2;
    
    logoCost = logoAreaCm2 * pricePerCm2 * logoComplexity * config.logoComplexityMultiplier;
    logoCost = Math.max(logoCost, config.logoMinPriceEur);
    logoDetails = logoIsRelief
      ? `Reliéf logo: ${round(logoAreaCm2)} cm²`
      : `3D logo (SVG extrúzia): ${round(logoAreaCm2)} cm²`;
  }

  // 8. Fixné náklady
  const { designFeeEur: designFee, packagingEur: packagingCost, shippingEur: shippingCost } = config;

  // === Celková cena ===
  const subtotal =
    (materialCost + laborCost + paintCost) * profileMultiplier *
    config.lightingMultipliers[lightingType] +
    ledCost +
    logoCost;

  const totalPrice = subtotal + installationCost + designFee + packagingCost + shippingCost;

  // Celkový počet položiek (písmená + logo ako 1 položka)
  const totalItems = letterCount + (hasLogo ? 1 : 0);

  return {
    materialCost: round(materialCost),
    materialDetails: `${round(totalVolumeCm3)} cm³ ASA/ABS`,

    laborCost: round(laborCost),
    laborHours: round(laborHours, 1),

    logoCost: round(logoCost),
    logoAreaMm2: round(logoAreaMm2),
    logoDetails,

    ledCost: round(ledCost),
    ledModulesCount,
    ledSourceCost: round(ledSourceCost),

    paintCost: round(paintCost),
    paintAreaM2: round(totalPaintAreaM2, 3),
    colorMultiplier,

    profileMultiplier,

    installationCost: round(installationCost),

    designFee,
    packagingCost,
    shippingCost,

    subtotal: round(subtotal),
    totalPrice: round(totalPrice),
    pricePerLetter: round(totalPrice / Math.max(letterCount, 1)),
    pricePerItem: round(totalPrice / Math.max(totalItems, 1)),
  };
}

function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Rýchly orientačný odhad ceny (pre zobrazenie pred plnou kalkuláciou)
 */
export function quickEstimate(
  letterCount: number,
  letterHeightMm: number,
  lightingType: LightingType,
): { min: number; max: number } {
  // Jednoduché tabuľkové rozsahy
  const priceRanges: Record<string, [number, number]> = {
    // [min_per_letter, max_per_letter]
    'small_none': [8, 15],
    'small_front': [18, 25],
    'small_halo': [15, 22],
    'small_front_halo': [25, 35],
    'medium_none': [15, 30],
    'medium_front': [25, 45],
    'medium_halo': [22, 40],
    'medium_front_halo': [35, 55],
    'large_none': [30, 80],
    'large_front': [50, 120],
    'large_halo': [45, 100],
    'large_front_halo': [70, 150],
    'xlarge_none': [80, 200],
    'xlarge_front': [120, 300],
    'xlarge_halo': [100, 250],
    'xlarge_front_halo': [150, 400],
  };

  let sizeKey: string;
  if (letterHeightMm <= 100) sizeKey = 'small';
  else if (letterHeightMm <= 200) sizeKey = 'medium';
  else if (letterHeightMm <= 500) sizeKey = 'large';
  else sizeKey = 'xlarge';

  const key = `${sizeKey}_${lightingType}`;
  const [minPerLetter, maxPerLetter] = priceRanges[key] || [10, 50];

  return {
    min: minPerLetter * letterCount,
    max: maxPerLetter * letterCount,
  };
}
