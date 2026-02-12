/**
 * Prepočet px → mm na základe referenčného rozmeru
 */

import type { Point2D } from '@/types/configurator';

/**
 * Vypočíta koeficient px→mm z dvoch referenčných bodov a reálnej vzdialenosti
 */
export function calculatePxToMm(
  point1: Point2D,
  point2: Point2D,
  realDistanceMm: number,
): number {
  const pixelDistance = Math.sqrt(
    Math.pow(point2.x - point1.x, 2) +
    Math.pow(point2.y - point1.y, 2)
  );

  if (pixelDistance === 0) return 0;
  return realDistanceMm / pixelDistance;
}

/**
 * Prevedie rozmery z pixelov na milimetre
 */
export function pxToMm(px: number, factor: number): number {
  return px * factor;
}

/**
 * Prevedie rozmery z milimetrov na pixely
 */
export function mmToPx(mm: number, factor: number): number {
  if (factor === 0) return 0;
  return mm / factor;
}

/**
 * Predvolené referenčné rozmery (bežné prvky fasády)
 */
export const COMMON_REFERENCES = [
  { label: 'Štandardné dvere (šírka)', valueMm: 900 },
  { label: 'Štandardné dvere (výška)', valueMm: 2000 },
  { label: 'Okno 1-krídlové (šírka)', valueMm: 600 },
  { label: 'Okno 2-krídlové (šírka)', valueMm: 1200 },
  { label: 'Výkladná skriňa (šírka)', valueMm: 2000 },
  { label: 'Tehla (dĺžka)', valueMm: 250 },
  { label: 'Meter', valueMm: 1000 },
] as const;

/**
 * Vypočíta odporúčanú výšku písmen na základe vzdialenosti čítania
 * (podľa normy pre svetelné reklamy)
 */
export function recommendedLetterHeight(readingDistanceM: number): {
  minHeightMm: number;
  optimalHeightMm: number;
  maxHeightMm: number;
} {
  // Pravidlo: 25mm výšky na každý meter čítacej vzdialenosti (pre deň)
  // Pre noc: 15mm na meter (LED svietenie zlepšuje čitateľnosť)
  return {
    minHeightMm: Math.round(readingDistanceM * 15),
    optimalHeightMm: Math.round(readingDistanceM * 25),
    maxHeightMm: Math.round(readingDistanceM * 40),
  };
}
