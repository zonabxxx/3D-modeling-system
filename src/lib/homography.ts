/**
 * Homografia – perspektívna transformácia
 * 
 * Z 4 bodov na fotke (pixely) vypočíta transformačnú maticu
 * pre umiestnenie 3D objektov na rovinu fasády.
 */

import type { Point2D } from '@/types/configurator';

/**
 * Vypočíta homografiu z 4 bodov v zdrojovom obraze (fotka)
 * na 4 body v cieľovom priestore (obdĺžník).
 * 
 * Používa Direct Linear Transform (DLT) algoritmus.
 * 
 * @param src - 4 body na fotke (px)
 * @param dst - 4 body cieľového obdĺžnika
 * @returns 3×3 homografická matica
 */
export function computeHomography(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D],
): number[][] {
  // Zostavenie matice A pre DLT
  // Pre každý pár bodov (src[i], dst[i]) dostaneme 2 rovnice
  const A: number[][] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];

    A.push([
      -sx, -sy, -1, 0, 0, 0, sx * dx, sy * dx, dx,
    ]);
    A.push([
      0, 0, 0, -sx, -sy, -1, sx * dy, sy * dy, dy,
    ]);
  }

  // Riešenie Ah = 0 pomocou SVD (zjednodušená implementácia)
  // Pre 4 body máme presne 8 rovníc pre 8 neznámych (9. je normalizácia)
  const h = solveHomography8x9(A);

  // Reshape na 3×3 maticu
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], h[8]],
  ];
}

/**
 * Aplikuje homografiu na bod
 */
export function applyHomography(H: number[][], point: Point2D): Point2D {
  const w = H[2][0] * point.x + H[2][1] * point.y + H[2][2];
  return {
    x: (H[0][0] * point.x + H[0][1] * point.y + H[0][2]) / w,
    y: (H[1][0] * point.x + H[1][1] * point.y + H[1][2]) / w,
  };
}

/**
 * Konvertuje 3×3 homografiu na Three.js Matrix4
 * Pre umiestnenie 3D objektov na fasádu
 */
export function homographyToMatrix4(H: number[][]): number[] {
  // Three.js Matrix4 je column-major 4×4
  // Homografia je 3×3, prevedieme na 4×4
  return [
    H[0][0], H[1][0], 0, H[2][0],
    H[0][1], H[1][1], 0, H[2][1],
    0,       0,       1, 0,
    H[0][2], H[1][2], 0, H[2][2],
  ];
}

/**
 * Z 4 bodov na fotke (ľavý horný, pravý horný, pravý dolný, ľavý dolný)
 * vypočíta normálu roviny a pozíciu pre Three.js
 */
export function surfacePointsToPlane(
  points: [Point2D, Point2D, Point2D, Point2D],
  imageWidth: number,
  imageHeight: number,
): {
  center: { x: number; y: number };
  width: number;
  height: number;
  rotationRad: number;
  perspectiveScale: { top: number; bottom: number };
} {
  const [tl, tr, br, bl] = points;

  // Stred plochy
  const center = {
    x: (tl.x + tr.x + br.x + bl.x) / 4,
    y: (tl.y + tr.y + br.y + bl.y) / 4,
  };

  // Šírka (priemer hornej a dolnej hrany)
  const topWidth = Math.sqrt(Math.pow(tr.x - tl.x, 2) + Math.pow(tr.y - tl.y, 2));
  const bottomWidth = Math.sqrt(Math.pow(br.x - bl.x, 2) + Math.pow(br.y - bl.y, 2));
  const width = (topWidth + bottomWidth) / 2;

  // Výška (priemer ľavej a pravej hrany)
  const leftHeight = Math.sqrt(Math.pow(bl.x - tl.x, 2) + Math.pow(bl.y - tl.y, 2));
  const rightHeight = Math.sqrt(Math.pow(br.x - tr.x, 2) + Math.pow(br.y - tr.y, 2));
  const height = (leftHeight + rightHeight) / 2;

  // Rotácia (uhol hornej hrany)
  const rotationRad = Math.atan2(tr.y - tl.y, tr.x - tl.x);

  // Perspektívna škála (pomer hornej a dolnej šírky)
  const perspectiveScale = {
    top: topWidth / width,
    bottom: bottomWidth / width,
  };

  return {
    center: {
      x: center.x / imageWidth,
      y: center.y / imageHeight,
    },
    width: width / imageWidth,
    height: height / imageHeight,
    rotationRad,
    perspectiveScale,
  };
}

/**
 * Výpočet px→mm koeficientu z 2 referenčných bodov
 */
export function calculateScaleFactor(
  point1: Point2D,
  point2: Point2D,
  realDistanceMm: number,
): number {
  const pixelDistance = Math.sqrt(
    Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2)
  );

  if (pixelDistance === 0) return 0;
  return realDistanceMm / pixelDistance;
}

// === Interné helper funkcie ===

/**
 * Rieši sústavu 8 rovníc pre homografiu (zjednodušené Gaussian elimination)
 */
function solveHomography8x9(A: number[][]): number[] {
  // Normalizujeme h[8] = 1, takže riešime 8×8 sústavu
  const n = 8;
  const augmented: number[][] = [];

  for (let i = 0; i < n; i++) {
    const row = [...A[i].slice(0, n)];
    row.push(-A[i][8]); // pravá strana
    augmented.push(row);
  }

  // Gaussian elimination s pivotovaním
  for (let col = 0; col < n; col++) {
    // Nájdi pivot
    let maxRow = col;
    let maxVal = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > maxVal) {
        maxVal = Math.abs(augmented[row][col]);
        maxRow = row;
      }
    }

    // Swap rows
    if (maxRow !== col) {
      [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];
    }

    // Eliminate
    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  // Back-substitution
  const h = new Array(9);
  for (let i = 0; i < n; i++) {
    h[i] = augmented[i][n] / augmented[i][i];
  }
  h[8] = 1; // normalizácia

  return h;
}
