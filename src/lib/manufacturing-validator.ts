/**
 * Validátor výrobných pravidiel
 * 
 * Kontroluje, či konfigurácia spĺňa výrobné limity
 * a automaticky opravuje parametre kde je to možné.
 */

import type {
  ProfileType,
  LightingType,
  ManufacturingValidation,
  ManufacturingLimits,
  DEFAULT_MANUFACTURING_LIMITS,
  LIGHTING_REQUIREMENTS,
} from '@/types/configurator';

interface ValidationInput {
  letterHeightMm: number;
  letterWidthMm: number; // priemerná šírka
  depthMm: number;
  profileType: ProfileType;
  lightingType: LightingType;
  letterCount: number;
  totalWidthMm: number;
  isExterior: boolean;
}

const LIMITS: ManufacturingLimits = {
  minLetterHeightMm: 30,
  maxLetterHeightMm: 2000,
  minDepthMm: 20,
  maxDepthMm: 200,
  minWallThicknessMm: 2.0,
  maxSinglePieceMm: 400,
  minStrokeWidthMm: 3.0,
};

export function validateManufacturing(input: ValidationInput): ManufacturingValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  const autoFixes: ManufacturingValidation['autoFixes'] = [];

  // === 1. Výška písmen ===
  if (input.letterHeightMm < LIMITS.minLetterHeightMm) {
    errors.push(
      `Minimálna výška písmen je ${LIMITS.minLetterHeightMm}mm. Zadaná: ${input.letterHeightMm}mm.`
    );
    autoFixes.push({
      field: 'letterHeightMm',
      oldValue: input.letterHeightMm,
      newValue: LIMITS.minLetterHeightMm,
      reason: 'Zvýšená na minimálnu výrobnú výšku',
    });
  }

  if (input.letterHeightMm > LIMITS.maxLetterHeightMm) {
    errors.push(
      `Maximálna výška písmen je ${LIMITS.maxLetterHeightMm}mm. Zadaná: ${input.letterHeightMm}mm.`
    );
  }

  // === 2. Hĺbka ===
  if (input.depthMm < LIMITS.minDepthMm) {
    autoFixes.push({
      field: 'depthMm',
      oldValue: input.depthMm,
      newValue: LIMITS.minDepthMm,
      reason: 'Zvýšená na minimálnu hĺbku',
    });
  }

  if (input.depthMm > LIMITS.maxDepthMm) {
    errors.push(
      `Maximálna hĺbka je ${LIMITS.maxDepthMm}mm. Zadaná: ${input.depthMm}mm.`
    );
  }

  // === 3. LED požiadavky na hĺbku ===
  const lightingReqs: Record<LightingType, number> = {
    none: 20,
    front: 50,
    halo: 40,
    front_halo: 60,
  };

  const minDepthForLighting = lightingReqs[input.lightingType];
  if (input.depthMm < minDepthForLighting) {
    warnings.push(
      `Pre ${input.lightingType} podsvit je minimálna hĺbka ${minDepthForLighting}mm. Automaticky upravené.`
    );
    autoFixes.push({
      field: 'depthMm',
      oldValue: input.depthMm,
      newValue: minDepthForLighting,
      reason: `Zvýšená pre ${input.lightingType} podsvit`,
    });
  }

  // === 4. Segmentácia ===
  if (input.letterHeightMm > LIMITS.maxSinglePieceMm) {
    warnings.push(
      `Písmená vyššie ako ${LIMITS.maxSinglePieceMm}mm budú automaticky rozdelené na segmenty pre tlač.`
    );
  }

  if (input.letterWidthMm > LIMITS.maxSinglePieceMm) {
    warnings.push(
      `Písmená širšie ako ${LIMITS.maxSinglePieceMm}mm budú automaticky rozdelené na segmenty.`
    );
  }

  // === 5. Exteriér ===
  if (input.isExterior) {
    if (input.letterHeightMm < 50) {
      warnings.push(
        'Pre exteriér sa odporúča minimálna výška 50mm kvôli čitateľnosti a odolnosti.'
      );
    }
  }

  // === 6. Malé písmená + podsvit ===
  if (input.lightingType !== 'none' && input.letterHeightMm < 80) {
    warnings.push(
      'Pre písmená menšie ako 80mm s podsvitom môže byť obtiažna montáž LED modulov.'
    );
  }

  // === 7. Veľmi dlhý nápis ===
  if (input.totalWidthMm > 5000) {
    warnings.push(
      `Celková šírka nápisu ${Math.round(input.totalWidthMm / 10)}cm. Odporúčame konzultáciu pre montáž.`
    );
  }

  // === 8. Veľa písmen ===
  if (input.letterCount > 20) {
    warnings.push(
      'Pre viac ako 20 písmen odporúčame zvážiť montážnu lištu.'
    );
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    autoFixes,
  };
}

/**
 * Skontroluje, či písmeno potrebuje segmentáciu
 */
export function needsSegmentation(
  widthMm: number,
  heightMm: number,
  maxPieceMm: number = LIMITS.maxSinglePieceMm,
): boolean {
  return widthMm > maxPieceMm || heightMm > maxPieceMm;
}

/**
 * Vypočíta počet segmentov pre písmeno
 */
export function calculateSegments(
  widthMm: number,
  heightMm: number,
  maxPieceMm: number = LIMITS.maxSinglePieceMm,
  overlapMm: number = 5,
): {
  cols: number;
  rows: number;
  totalSegments: number;
  segmentWidth: number;
  segmentHeight: number;
} {
  const effectiveMax = maxPieceMm - overlapMm;
  const cols = Math.ceil(widthMm / effectiveMax);
  const rows = Math.ceil(heightMm / effectiveMax);

  return {
    cols,
    rows,
    totalSegments: cols * rows,
    segmentWidth: widthMm / cols + overlapMm,
    segmentHeight: heightMm / rows + overlapMm,
  };
}
