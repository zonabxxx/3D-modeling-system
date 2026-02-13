import type { ProfileType, LightingType, PriceBreakdown } from './types';

export interface PriceInput {
  letterCount: number;
  letterHeightMm: number;
  totalWidthMm: number;
  depthMm: number;
  profileType: ProfileType;
  lightingType: LightingType;
  colorCategory: 'standard' | 'metallic' | 'custom';
  includeInstallation: boolean;
  installationHeightM?: number;
  hasLogo: boolean;
  logoAreaMm2?: number;
  logoIsRelief?: boolean;
  logoComplexity?: number;
}

const CFG = {
  matPerCm3: 0.08, hourly: 25, timePerLetter: 0.5, timePerCm2: 0.001,
  ledMod: 2.5, led12V: 15, led24V: 25, ledSpacing: 25,
  paintM2: 35,
  profile: { flat: 1.0, rounded: 1.15, chamfer: 1.1 } as Record<ProfileType, number>,
  light: { none: 1.0, front: 1.4, halo: 1.3, front_halo: 1.6 } as Record<LightingType, number>,
  design: 25, pack: 15, ship: 20,
  instBase: 150, instPerLetter: 15, instPerMeterH: 50,
  metalMul: 1.2, customMul: 1.1,
  logoCm2: 0.5, logoReliefCm2: 0.35, logoMin: 15, logoComplexMul: 1.0,
};

function r(v: number, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; }

export function calculatePrice(input: PriceInput): PriceBreakdown {
  const {
    letterCount, letterHeightMm, totalWidthMm, depthMm, profileType,
    lightingType, colorCategory, includeInstallation, installationHeightM = 3,
    hasLogo = false, logoAreaMm2 = 0, logoIsRelief = false, logoComplexity = 1.0,
  } = input;

  const avgW = totalWidthMm / Math.max(letterCount, 1);
  const avgA = avgW * letterHeightMm * 0.6;
  const volPer = (avgA * depthMm) / 1000;
  const totalVol = volPer * letterCount;
  const materialCost = totalVol * CFG.matPerCm3;

  const surfCm2 = (avgA * letterCount * 2 + letterCount * (letterHeightMm + avgW) * 2 * depthMm) / 100;
  const laborH = letterCount * CFG.timePerLetter + surfCm2 * CFG.timePerCm2;
  const laborCost = laborH * CFG.hourly;

  let ledCost = 0, ledMods = 0, ledSrc = 0;
  if (lightingType !== 'none') {
    ledMods = Math.ceil(letterHeightMm / CFG.ledSpacing) * letterCount;
    if (lightingType === 'front_halo') ledMods *= 2;
    ledCost = ledMods * CFG.ledMod;
    ledSrc = ledMods > 20 ? CFG.led24V : CFG.led12V;
    ledCost += ledSrc;
  }

  const paintM2 = surfCm2 / 10000;
  const colMul = colorCategory === 'metallic' ? CFG.metalMul : colorCategory === 'custom' ? CFG.customMul : 1;
  const paintCost = paintM2 * CFG.paintM2 * colMul;

  let installCost = 0;
  if (includeInstallation) installCost = CFG.instBase + letterCount * CFG.instPerLetter + installationHeightM * CFG.instPerMeterH;

  let logoCost = 0;
  let logoDetails = '';
  if (hasLogo && logoAreaMm2 > 0) {
    const cm2 = logoAreaMm2 / 100;
    logoCost = cm2 * (logoIsRelief ? CFG.logoReliefCm2 : CFG.logoCm2) * logoComplexity * CFG.logoComplexMul;
    logoCost = Math.max(logoCost, CFG.logoMin);
    logoDetails = logoIsRelief ? `Reliéf: ${r(cm2)} cm²` : `SVG 3D: ${r(cm2)} cm²`;
  }

  const sub = (materialCost + laborCost + paintCost) * CFG.profile[profileType] * CFG.light[lightingType] + ledCost + logoCost;
  const total = sub + installCost + CFG.design + CFG.pack + CFG.ship;
  const items = letterCount + (hasLogo ? 1 : 0);

  return {
    materialCost: r(materialCost), materialDetails: `${r(totalVol)} cm³`,
    laborCost: r(laborCost), laborHours: r(laborH, 1),
    logoCost: r(logoCost), logoAreaMm2: r(logoAreaMm2), logoDetails,
    ledCost: r(ledCost), ledModulesCount: ledMods, ledSourceCost: r(ledSrc),
    paintCost: r(paintCost), paintAreaM2: r(paintM2, 3), colorMultiplier: colMul,
    profileMultiplier: CFG.profile[profileType],
    installationCost: r(installCost),
    designFee: CFG.design, packagingCost: CFG.pack, shippingCost: CFG.ship,
    subtotal: r(sub), totalPrice: r(total),
    pricePerLetter: r(total / Math.max(letterCount, 1)),
    pricePerItem: r(total / Math.max(items, 1)),
  };
}

export function quickEstimate(count: number, heightMm: number, light: LightingType) {
  const ranges: Record<string, [number, number]> = {
    small_none: [8, 15], small_front: [18, 25], small_halo: [15, 22], small_front_halo: [25, 35],
    medium_none: [15, 30], medium_front: [25, 45], medium_halo: [22, 40], medium_front_halo: [35, 55],
    large_none: [30, 80], large_front: [50, 120], large_halo: [45, 100], large_front_halo: [70, 150],
    xlarge_none: [80, 200], xlarge_front: [120, 300], xlarge_halo: [100, 250], xlarge_front_halo: [150, 400],
  };
  const sz = heightMm <= 100 ? 'small' : heightMm <= 200 ? 'medium' : heightMm <= 500 ? 'large' : 'xlarge';
  const [min, max] = ranges[`${sz}_${light}`] || [10, 50];
  return { min: min * count, max: max * count };
}
