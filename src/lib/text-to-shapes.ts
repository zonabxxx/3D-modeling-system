/**
 * Text → Three.js Shapes konverzia
 * 
 * Používa opentype.js na načítanie fontu a konverziu textu
 * na vektorové krivky, ktoré Three.js vie extrudovať do 3D.
 *
 * Správne spracúva písmená s dierami (O, A, B, D, P, R, 8 …)
 * rozpoznaním vonkajších obrysov (shapes) a vnútorných dier (holes).
 */

import * as THREE from 'three';

// opentype.js types (zjednodušené)
interface PathCommand {
  type: 'M' | 'L' | 'Q' | 'C' | 'Z';
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface GlyphPath {
  commands: PathCommand[];
  fill: string | null;
}

interface OpentypeGlyph {
  advanceWidth: number;
  path: GlyphPath;
  getPath: (x: number, y: number, fontSize: number) => GlyphPath;
}

interface OpentypeFont {
  getPaths: (text: string, x: number, y: number, fontSize: number) => GlyphPath[];
  getPath: (text: string, x: number, y: number, fontSize: number) => GlyphPath;
  getAdvanceWidth: (text: string, fontSize: number) => number;
  charToGlyph: (char: string) => OpentypeGlyph;
  unitsPerEm: number;
  forEachGlyph: (
    text: string, x: number, y: number, fontSize: number,
    options: Record<string, unknown>,
    callback: (glyph: OpentypeGlyph, x: number, y: number, fontSize: number) => void,
  ) => number;
}

// Font cache – načíta sa raz, potom z cache
const fontCache = new Map<string, OpentypeFont>();

/**
 * Načíta font z URL a uloží do cache
 */
export async function loadFont(fontUrl: string): Promise<OpentypeFont> {
  if (fontCache.has(fontUrl)) {
    return fontCache.get(fontUrl)!;
  }

  // Dynamic import opentype.js (funguje v browser aj Node)
  const opentype = await import('opentype.js');
  const font = await opentype.load(fontUrl);
  fontCache.set(fontUrl, font as unknown as OpentypeFont);
  return font as unknown as OpentypeFont;
}

/**
 * Skonvertuje text na pole Three.js Shape objektov
 * 
 * Každé písmeno sa rozdelí na vonkajšie obrysy a diery.
 * Diery sa správne priradia k rodičovským tvarom.
 * 
 * @param text - Text na konverziu
 * @param fontUrl - URL fontu (.ttf/.otf)
 * @param fontSize - Veľkosť fontu v jednotkách Three.js
 * @returns Pole shapes pre celý text
 */
export async function textToShapes(
  text: string,
  fontUrl: string,
  fontSize: number = 100,
): Promise<{
  shapes: THREE.Shape[];
  totalWidth: number;
  totalHeight: number;
  letterShapes: Array<{
    char: string;
    shapes: THREE.Shape[];
    offsetX: number;
    width: number;
  }>;
}> {
  const font = await loadFont(fontUrl);

  const allShapes: THREE.Shape[] = [];
  const letterShapes: Array<{
    char: string;
    shapes: THREE.Shape[];
    offsetX: number;
    width: number;
  }> = [];

  // Iteruj cez glyphs a získaj cestu pre každé písmeno
  const scale = fontSize / font.unitsPerEm;
  let cursorX = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === ' ') {
      const glyph = font.charToGlyph(char);
      const advance = glyph.advanceWidth * scale;
      cursorX += advance;
      continue;
    }

    const glyph = font.charToGlyph(char);
    const advance = glyph.advanceWidth * scale;
    
    // Získaj path pre tento glyph na správnej pozícii
    const glyphPath = glyph.getPath(cursorX, 0, fontSize);

    // Rozdeľ path na kontúry (každé M začína novú kontúru)
    const contours = splitPathToContours(glyphPath.commands);
    
    // Konvertuj na Three.js Shape/Path objekty
    const { outerShapes, holes } = classifyContours(contours);

    // Priraď diery k správnym vonkajším tvarom
    for (const outer of outerShapes) {
      for (const hole of holes) {
        // Skontroluj či je diera vnútri tohto vonkajšieho tvaru
        const holePoint = hole.getPoints(4)[0];
        if (holePoint && isPointInShape(holePoint, outer)) {
          outer.holes.push(hole);
        }
      }
      allShapes.push(outer);
    }

    letterShapes.push({
      char,
      shapes: outerShapes,
      offsetX: cursorX,
      width: advance,
    });

    cursorX += advance;
  }

  const totalWidth = cursorX;
  const totalHeight = fontSize;

  return {
    shapes: allShapes,
    totalWidth,
    totalHeight,
    letterShapes,
  };
}

/**
 * Rozdelí path commands na individuálne kontúry
 * Každé M (moveTo) začína novú kontúru
 */
function splitPathToContours(commands: PathCommand[]): PathCommand[][] {
  const contours: PathCommand[][] = [];
  let current: PathCommand[] = [];

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      if (current.length > 0) {
        contours.push(current);
      }
      current = [cmd];
    } else {
      current.push(cmd);
    }
  }

  if (current.length > 0) {
    contours.push(current);
  }

  return contours;
}

/**
 * Klasifikuje kontúry na vonkajšie tvary a diery
 * Vonkajšie tvary majú CCW orientáciu, diery CW (alebo naopak)
 * Rozhoduje sa podľa podpísanej plochy
 */
function classifyContours(contours: PathCommand[][]): {
  outerShapes: THREE.Shape[];
  holes: THREE.Path[];
} {
  const outerShapes: THREE.Shape[] = [];
  const holes: THREE.Path[] = [];

  for (const contour of contours) {
    if (contour.length < 2) continue;

    const path = commandsToPath(contour);
    if (!path) continue;

    const points = path.getPoints(16);
    if (points.length < 3) continue;

    const area = signedArea(points);
    
    // Three.js: CCW = vonkajší tvar (kladná plocha po invertovaní Y)
    // Rozlíšenie: väčšia absolútna plocha → pravdepodobne vonkajší tvar
    if (area > 0) {
      // Vonkajší tvar
      const shape = new THREE.Shape();
      copyPathToShape(contour, shape);
      outerShapes.push(shape);
    } else {
      // Diera
      const hole = new THREE.Path();
      copyPathToHole(contour, hole);
      holes.push(hole);
    }
  }

  return { outerShapes, holes };
}

/**
 * Konvertuje path commands na Three.js Path
 */
function commandsToPath(commands: PathCommand[]): THREE.Path | null {
  const path = new THREE.Path();
  let hasMoveTo = false;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (cmd.x !== undefined && cmd.y !== undefined) {
          path.moveTo(cmd.x, -cmd.y);
          hasMoveTo = true;
        }
        break;
      case 'L':
        if (cmd.x !== undefined && cmd.y !== undefined) {
          path.lineTo(cmd.x, -cmd.y);
        }
        break;
      case 'Q':
        if (cmd.x1 !== undefined && cmd.y1 !== undefined &&
            cmd.x !== undefined && cmd.y !== undefined) {
          path.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
        }
        break;
      case 'C':
        if (cmd.x1 !== undefined && cmd.y1 !== undefined &&
            cmd.x2 !== undefined && cmd.y2 !== undefined &&
            cmd.x !== undefined && cmd.y !== undefined) {
          path.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
        }
        break;
      case 'Z':
        path.closePath();
        break;
    }
  }

  return hasMoveTo ? path : null;
}

function copyPathToShape(commands: PathCommand[], shape: THREE.Shape): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (cmd.x !== undefined && cmd.y !== undefined) shape.moveTo(cmd.x, -cmd.y);
        break;
      case 'L':
        if (cmd.x !== undefined && cmd.y !== undefined) shape.lineTo(cmd.x, -cmd.y);
        break;
      case 'Q':
        if (cmd.x1 !== undefined && cmd.y1 !== undefined &&
            cmd.x !== undefined && cmd.y !== undefined) {
          shape.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
        }
        break;
      case 'C':
        if (cmd.x1 !== undefined && cmd.y1 !== undefined &&
            cmd.x2 !== undefined && cmd.y2 !== undefined &&
            cmd.x !== undefined && cmd.y !== undefined) {
          shape.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
        }
        break;
      case 'Z':
        shape.closePath();
        break;
    }
  }
}

function copyPathToHole(commands: PathCommand[], path: THREE.Path): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (cmd.x !== undefined && cmd.y !== undefined) path.moveTo(cmd.x, -cmd.y);
        break;
      case 'L':
        if (cmd.x !== undefined && cmd.y !== undefined) path.lineTo(cmd.x, -cmd.y);
        break;
      case 'Q':
        if (cmd.x1 !== undefined && cmd.y1 !== undefined &&
            cmd.x !== undefined && cmd.y !== undefined) {
          path.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
        }
        break;
      case 'C':
        if (cmd.x1 !== undefined && cmd.y1 !== undefined &&
            cmd.x2 !== undefined && cmd.y2 !== undefined &&
            cmd.x !== undefined && cmd.y !== undefined) {
          path.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
        }
        break;
      case 'Z':
        path.closePath();
        break;
    }
  }
}

/**
 * Podpísaná plocha (Shoelace formula)
 * Kladná = CCW, Záporná = CW
 */
function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

/**
 * Skontroluje či bod leží vnútri tvaru (ray casting)
 */
function isPointInShape(point: THREE.Vector2, shape: THREE.Shape): boolean {
  const pts = shape.getPoints(16);
  let inside = false;
  
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

/**
 * Vycentruje shapes na stred (0,0)
 */
export function centerShapes(shapes: THREE.Shape[]): {
  shapes: THREE.Shape[];
  offsetX: number;
  offsetY: number;
} {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const points = shape.getPoints(12);
    for (const pt of points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }

  const offsetX = -(minX + maxX) / 2;
  const offsetY = -(minY + maxY) / 2;

  return { shapes, offsetX, offsetY };
}
