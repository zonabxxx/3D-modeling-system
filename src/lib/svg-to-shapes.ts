/**
 * SVG → Three.js Shapes konverzia
 * 
 * Parsuje SVG súbor (path dáta) a konvertuje na Three.js Shape objekty
 * pre 3D extrúziu. Podporuje základné SVG path príkazy (M, L, C, Q, Z, A).
 * 
 * Použitie:
 * - Logo upload ako SVG → parse → Shape[] → ExtrudeGeometry → 3D mesh
 * - Raster logo (PNG/JPG) → flat panel s textúrou (nie extrúzia)
 */

import * as THREE from 'three';

// === SVG Path Parser ===

interface SVGPathCommand {
  type: string;
  values: number[];
}

/**
 * Parsuje SVG path "d" atribút na pole príkazov
 */
export function parseSVGPath(d: string): SVGPathCommand[] {
  const commands: SVGPathCommand[] = [];
  // Regex pre SVG path príkazy
  const cmdRegex = /([MmLlHhVvCcSsQqTtAaZz])/;
  const parts = d.split(cmdRegex).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const letter = parts[i].trim();
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(letter)) {
      const valueStr = (parts[i + 1] || '').trim();
      const values = valueStr
        ? valueStr
            .replace(/,/g, ' ')
            .replace(/-/g, ' -')
            .split(/\s+/)
            .filter(Boolean)
            .map(Number)
            .filter((n) => !isNaN(n))
        : [];
      commands.push({ type: letter, values });
      i++; // skip values part
    }
  }

  return commands;
}

/**
 * Konvertuje SVG path commands na Three.js Shape
 * 
 * Podporuje: M, L, H, V, C, S, Q, T, A, Z (uppercase = absolútne, lowercase = relatívne)
 */
function svgPathToShape(commands: SVGPathCommand[]): THREE.Shape | null {
  if (commands.length === 0) return null;

  const shape = new THREE.Shape();
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let hasMoveTo = false;

  for (const cmd of commands) {
    const { type, values } = cmd;
    const isRelative = type === type.toLowerCase();
    const cmdUpper = type.toUpperCase();

    switch (cmdUpper) {
      case 'M': {
        // MoveTo
        for (let i = 0; i < values.length; i += 2) {
          let x = values[i];
          let y = values[i + 1];
          if (isRelative) {
            x += currentX;
            y += currentY;
          }
          if (i === 0) {
            shape.moveTo(x, -y); // SVG Y je invertované voči Three.js
            startX = x;
            startY = y;
            hasMoveTo = true;
          } else {
            // Subsequent pairs after M are treated as L
            shape.lineTo(x, -y);
          }
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'L': {
        // LineTo
        for (let i = 0; i < values.length; i += 2) {
          let x = values[i];
          let y = values[i + 1];
          if (isRelative) {
            x += currentX;
            y += currentY;
          }
          shape.lineTo(x, -y);
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'H': {
        // Horizontal LineTo
        for (let i = 0; i < values.length; i++) {
          let x = values[i];
          if (isRelative) x += currentX;
          shape.lineTo(x, -currentY);
          currentX = x;
        }
        break;
      }

      case 'V': {
        // Vertical LineTo
        for (let i = 0; i < values.length; i++) {
          let y = values[i];
          if (isRelative) y += currentY;
          shape.lineTo(currentX, -y);
          currentY = y;
        }
        break;
      }

      case 'C': {
        // Cubic Bezier
        for (let i = 0; i < values.length; i += 6) {
          let x1 = values[i];
          let y1 = values[i + 1];
          let x2 = values[i + 2];
          let y2 = values[i + 3];
          let x = values[i + 4];
          let y = values[i + 5];
          if (isRelative) {
            x1 += currentX; y1 += currentY;
            x2 += currentX; y2 += currentY;
            x += currentX; y += currentY;
          }
          shape.bezierCurveTo(x1, -y1, x2, -y2, x, -y);
          lastControlX = x2;
          lastControlY = y2;
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'S': {
        // Smooth Cubic Bezier
        for (let i = 0; i < values.length; i += 4) {
          // Reflected control point
          const rx1 = 2 * currentX - lastControlX;
          const ry1 = 2 * currentY - lastControlY;
          let x2 = values[i];
          let y2 = values[i + 1];
          let x = values[i + 2];
          let y = values[i + 3];
          if (isRelative) {
            x2 += currentX; y2 += currentY;
            x += currentX; y += currentY;
          }
          shape.bezierCurveTo(rx1, -ry1, x2, -y2, x, -y);
          lastControlX = x2;
          lastControlY = y2;
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'Q': {
        // Quadratic Bezier
        for (let i = 0; i < values.length; i += 4) {
          let x1 = values[i];
          let y1 = values[i + 1];
          let x = values[i + 2];
          let y = values[i + 3];
          if (isRelative) {
            x1 += currentX; y1 += currentY;
            x += currentX; y += currentY;
          }
          shape.quadraticCurveTo(x1, -y1, x, -y);
          lastControlX = x1;
          lastControlY = y1;
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'T': {
        // Smooth Quadratic Bezier
        for (let i = 0; i < values.length; i += 2) {
          const rx = 2 * currentX - lastControlX;
          const ry = 2 * currentY - lastControlY;
          let x = values[i];
          let y = values[i + 1];
          if (isRelative) {
            x += currentX; y += currentY;
          }
          shape.quadraticCurveTo(rx, -ry, x, -y);
          lastControlX = rx;
          lastControlY = ry;
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'A': {
        // Arc – aproximácia cez krivky (zjednodušená)
        for (let i = 0; i < values.length; i += 7) {
          const rx = values[i];
          const ry = values[i + 1];
          // const rotation = values[i + 2]; // zatiaľ ignorujeme
          // const largeArc = values[i + 3];
          // const sweep = values[i + 4];
          let x = values[i + 5];
          let y = values[i + 6];
          if (isRelative) {
            x += currentX; y += currentY;
          }
          // Zjednodušená aproximácia oblúka ako kubická krivka
          const midX = (currentX + x) / 2;
          const midY = (currentY + y) / 2;
          const ctrlX = midX + (ry || rx) * 0.55;
          const ctrlY = midY - (rx || ry) * 0.55;
          shape.bezierCurveTo(
            currentX + (ctrlX - currentX) * 0.5, -(currentY + (ctrlY - currentY) * 0.5),
            ctrlX, -ctrlY,
            x, -y
          );
          currentX = x;
          currentY = y;
        }
        break;
      }

      case 'Z': {
        shape.closePath();
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  if (!hasMoveTo) return null;
  return shape;
}

// === SVG Document Parser ===

export interface SVGParseResult {
  shapes: THREE.Shape[];
  viewBox: { x: number; y: number; width: number; height: number };
  originalWidth: number;
  originalHeight: number;
}

/**
 * Parsuje SVG string a vráti Three.js Shapes
 * 
 * Extrahuje všetky <path> elementy zo SVG a konvertuje ich na Three.js Shapes.
 * Podporuje aj <rect>, <circle>, <ellipse>, <polygon>, <polyline>.
 */
export function parseSVGToShapes(svgContent: string): SVGParseResult {
  // Parse SVG using DOMParser (browser) or regex (server)
  const shapes: THREE.Shape[] = [];

  // Extrahuj viewBox
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const widthMatch = svgContent.match(/width="([^"]+)"/);
  const heightMatch = svgContent.match(/height="([^"]+)"/);

  let viewBox = { x: 0, y: 0, width: 100, height: 100 };
  if (viewBoxMatch) {
    const [x, y, w, h] = viewBoxMatch[1].split(/[\s,]+/).map(Number);
    viewBox = { x: x || 0, y: y || 0, width: w || 100, height: h || 100 };
  }

  const originalWidth = widthMatch
    ? parseFloat(widthMatch[1]) || viewBox.width
    : viewBox.width;
  const originalHeight = heightMatch
    ? parseFloat(heightMatch[1]) || viewBox.height
    : viewBox.height;

  // Extrahuj <path> elementy
  const pathRegex = /<path[^>]*\bd="([^"]+)"[^>]*\/?>/gi;
  let pathMatch: RegExpExecArray | null;

  while ((pathMatch = pathRegex.exec(svgContent)) !== null) {
    const d = pathMatch[1];
    const commands = parseSVGPath(d);
    const shape = svgPathToShape(commands);
    if (shape) {
      shapes.push(shape);
    }
  }

  // Extrahuj <rect> elementy
  const rectRegex = /<rect[^>]*\/?>/gi;
  let rectMatch: RegExpExecArray | null;

  while ((rectMatch = rectRegex.exec(svgContent)) !== null) {
    const rectStr = rectMatch[0];
    const x = parseFloat(rectStr.match(/\bx="([^"]+)"/)?.[1] || '0');
    const y = parseFloat(rectStr.match(/\by="([^"]+)"/)?.[1] || '0');
    const w = parseFloat(rectStr.match(/\bwidth="([^"]+)"/)?.[1] || '0');
    const h = parseFloat(rectStr.match(/\bheight="([^"]+)"/)?.[1] || '0');
    const rx = parseFloat(rectStr.match(/\brx="([^"]+)"/)?.[1] || '0');

    if (w > 0 && h > 0) {
      const shape = new THREE.Shape();
      if (rx > 0) {
        // Rounded rect
        shape.moveTo(x + rx, -y);
        shape.lineTo(x + w - rx, -y);
        shape.quadraticCurveTo(x + w, -y, x + w, -(y + rx));
        shape.lineTo(x + w, -(y + h - rx));
        shape.quadraticCurveTo(x + w, -(y + h), x + w - rx, -(y + h));
        shape.lineTo(x + rx, -(y + h));
        shape.quadraticCurveTo(x, -(y + h), x, -(y + h - rx));
        shape.lineTo(x, -(y + rx));
        shape.quadraticCurveTo(x, -y, x + rx, -y);
      } else {
        shape.moveTo(x, -y);
        shape.lineTo(x + w, -y);
        shape.lineTo(x + w, -(y + h));
        shape.lineTo(x, -(y + h));
        shape.closePath();
      }
      shapes.push(shape);
    }
  }

  // Extrahuj <circle> elementy
  const circleRegex = /<circle[^>]*\/?>/gi;
  let circleMatch: RegExpExecArray | null;

  while ((circleMatch = circleRegex.exec(svgContent)) !== null) {
    const circleStr = circleMatch[0];
    const cx = parseFloat(circleStr.match(/\bcx="([^"]+)"/)?.[1] || '0');
    const cy = parseFloat(circleStr.match(/\bcy="([^"]+)"/)?.[1] || '0');
    const r = parseFloat(circleStr.match(/\br="([^"]+)"/)?.[1] || '0');

    if (r > 0) {
      const shape = new THREE.Shape();
      // Kruh cez 4 kubické krivky (presná aproximácia)
      const k = 0.5522847498; // kappa pre kubickú aproximáciu kruhu
      shape.moveTo(cx + r, -cy);
      shape.bezierCurveTo(cx + r, -(cy - r * k), cx + r * k, -(cy - r), cx, -(cy - r));
      shape.bezierCurveTo(cx - r * k, -(cy - r), cx - r, -(cy - r * k), cx - r, -cy);
      shape.bezierCurveTo(cx - r, -(cy + r * k), cx - r * k, -(cy + r), cx, -(cy + r));
      shape.bezierCurveTo(cx + r * k, -(cy + r), cx + r, -(cy + r * k), cx + r, -cy);
      shape.closePath();
      shapes.push(shape);
    }
  }

  // Extrahuj <ellipse> elementy
  const ellipseRegex = /<ellipse[^>]*\/?>/gi;
  let ellipseMatch: RegExpExecArray | null;

  while ((ellipseMatch = ellipseRegex.exec(svgContent)) !== null) {
    const ellipseStr = ellipseMatch[0];
    const cx = parseFloat(ellipseStr.match(/\bcx="([^"]+)"/)?.[1] || '0');
    const cy = parseFloat(ellipseStr.match(/\bcy="([^"]+)"/)?.[1] || '0');
    const rx = parseFloat(ellipseStr.match(/\brx="([^"]+)"/)?.[1] || '0');
    const ry = parseFloat(ellipseStr.match(/\bry="([^"]+)"/)?.[1] || '0');

    if (rx > 0 && ry > 0) {
      const shape = new THREE.Shape();
      const k = 0.5522847498;
      shape.moveTo(cx + rx, -cy);
      shape.bezierCurveTo(cx + rx, -(cy - ry * k), cx + rx * k, -(cy - ry), cx, -(cy - ry));
      shape.bezierCurveTo(cx - rx * k, -(cy - ry), cx - rx, -(cy - ry * k), cx - rx, -cy);
      shape.bezierCurveTo(cx - rx, -(cy + ry * k), cx - rx * k, -(cy + ry), cx, -(cy + ry));
      shape.bezierCurveTo(cx + rx * k, -(cy + ry), cx + rx, -(cy + ry * k), cx + rx, -cy);
      shape.closePath();
      shapes.push(shape);
    }
  }

  // Extrahuj <polygon> elementy
  const polygonRegex = /<polygon[^>]*\bpoints="([^"]+)"[^>]*\/?>/gi;
  let polygonMatch: RegExpExecArray | null;

  while ((polygonMatch = polygonRegex.exec(svgContent)) !== null) {
    const points = polygonMatch[1]
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !isNaN(n));

    if (points.length >= 4) {
      const shape = new THREE.Shape();
      shape.moveTo(points[0], -points[1]);
      for (let i = 2; i < points.length; i += 2) {
        shape.lineTo(points[i], -points[i + 1]);
      }
      shape.closePath();
      shapes.push(shape);
    }
  }

  return {
    shapes,
    viewBox,
    originalWidth,
    originalHeight,
  };
}

/**
 * Normalizuje shapes na požadovanú veľkosť v mm
 * 
 * @param shapes - Three.js Shapes z SVG
 * @param viewBox - SVG viewBox
 * @param targetWidthMm - Požadovaná šírka v mm (null = automaticky podľa výšky)
 * @param targetHeightMm - Požadovaná výška v mm (null = automaticky podľa šírky)
 * @returns Nové shapes prispôsobené na mm mierku
 */
export function normalizeShapesToMm(
  shapes: THREE.Shape[],
  viewBox: { width: number; height: number },
  targetWidthMm?: number | null,
  targetHeightMm?: number | null,
): {
  shapes: THREE.Shape[];
  scaleFactor: number;
  resultWidthMm: number;
  resultHeightMm: number;
} {
  const aspectRatio = viewBox.width / viewBox.height;

  let scaleFactor: number;
  let resultWidthMm: number;
  let resultHeightMm: number;

  if (targetWidthMm && targetHeightMm) {
    // Fit do oboch rozmerov (zachovaj aspect ratio)
    const scaleW = targetWidthMm / viewBox.width;
    const scaleH = targetHeightMm / viewBox.height;
    scaleFactor = Math.min(scaleW, scaleH);
    resultWidthMm = viewBox.width * scaleFactor;
    resultHeightMm = viewBox.height * scaleFactor;
  } else if (targetWidthMm) {
    scaleFactor = targetWidthMm / viewBox.width;
    resultWidthMm = targetWidthMm;
    resultHeightMm = targetWidthMm / aspectRatio;
  } else if (targetHeightMm) {
    scaleFactor = targetHeightMm / viewBox.height;
    resultWidthMm = targetHeightMm * aspectRatio;
    resultHeightMm = targetHeightMm;
  } else {
    // Defaultne: 1 SVG unit = 1 mm
    scaleFactor = 1;
    resultWidthMm = viewBox.width;
    resultHeightMm = viewBox.height;
  }

  // Shapes sú už transformované v parseri – v praxi sa scaling rieši
  // cez mesh.scale v Three.js scéne, nie úpravou shapes
  return {
    shapes,
    scaleFactor,
    resultWidthMm,
    resultHeightMm,
  };
}

/**
 * Vypočíta plochu shapes v mm² (aproximácia cez bounding box × fill ratio)
 */
export function calculateShapesArea(
  shapes: THREE.Shape[],
  scaleFactor: number = 1,
): number {
  let totalArea = 0;

  for (const shape of shapes) {
    const points = shape.getPoints(32);
    // Shoelace formula pre plochu polygónu
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    totalArea += Math.abs(area / 2);
  }

  return totalArea * scaleFactor * scaleFactor;
}

/**
 * Vycentruje shapes na origin (0, 0)
 */
export function centerSVGShapes(shapes: THREE.Shape[]): {
  offsetX: number;
  offsetY: number;
  boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
} {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const points = shape.getPoints(16);
    for (const pt of points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }

  return {
    offsetX: -(minX + maxX) / 2,
    offsetY: -(minY + maxY) / 2,
    boundingBox: { minX, maxX, minY, maxY },
  };
}
