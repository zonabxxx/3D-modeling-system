/**
 * Text → SVG konverzia na frontende
 *
 * Používa opentype.js na konverziu textu a fontu na SVG <path> elementy.
 * Výstupný SVG sa posiela na backend, ktorý ho extruduje do 3D.
 *
 * Rovnaký princíp ako LetraMaker PRO:
 *   1. Vstup = SVG krivky (z fontu alebo importované)
 *   2. Backend = iba 3D extrúzia SVG → STL
 *   3. Žiadna závislosť na fontoch na backende
 */

// Font cache – načíta sa raz, potom z cache
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fontCache = new Map<string, any>();

/**
 * Načítať font z URL (s cache)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFont(fontUrl: string): Promise<any> {
  if (fontCache.has(fontUrl)) {
    return fontCache.get(fontUrl);
  }

  const opentype = await import('opentype.js');
  const font = await opentype.load(fontUrl);
  fontCache.set(fontUrl, font);
  return font;
}

/**
 * Info o jednom písmene vo výslednom SVG
 */
export interface LetterSVGInfo {
  /** Pôvodný znak (napr. 'A') */
  char: string;
  /** SVG path `d` atribút pre tento znak */
  pathData: string;
  /** X offset v mm */
  offsetX: number;
  /** Šírka znaku v mm */
  widthMm: number;
  /** Výška znaku v mm */
  heightMm: number;
}

/**
 * Výsledok konverzie textu na SVG
 */
export interface TextToSVGResult {
  /** Kompletný SVG string so všetkými písmenami */
  svgContent: string;
  /** Info o jednotlivých písmenách */
  letters: LetterSVGInfo[];
  /** Celková šírka v mm */
  totalWidthMm: number;
  /** Celková výška v mm */
  totalHeightMm: number;
}

/**
 * Konvertuje text + font na SVG paths.
 *
 * Výstup je SVG s viewBox v mm, kde každé písmeno je samostatný <path>.
 * Toto SVG sa posiela na backend pre 3D extrúziu.
 *
 * @param text - Text na konverziu (napr. "ADSUN")
 * @param fontUrl - URL na TTF/OTF font (napr. "/fonts/BebasNeue-Regular.ttf")
 * @param letterHeightMm - Výška písmen v mm (napr. 200)
 * @param letterSpacingMm - Rozostup medzi písmenami v mm (napr. 10)
 */
export async function textToSVG(
  text: string,
  fontUrl: string,
  letterHeightMm: number = 200,
  letterSpacingMm: number = 10,
): Promise<TextToSVGResult> {
  const font = await loadFont(fontUrl);

  const unitsPerEm = font.unitsPerEm || 2048;
  // ascender-descender = celková výška fontu v font-units
  const ascender = font.ascender || unitsPerEm * 0.8;
  const descender = font.descender || -(unitsPerEm * 0.2);
  const fontUnitHeight = ascender - descender;

  // Scale: font-units → mm
  const scale = letterHeightMm / fontUnitHeight;

  const letters: LetterSVGInfo[] = [];
  const pathElements: string[] = [];
  let cursorX = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === ' ') {
      // Medzera – posunúť kurzor
      const spaceGlyph = font.charToGlyph(' ');
      const spaceAdvance = (spaceGlyph?.advanceWidth || unitsPerEm * 0.25) * scale;
      cursorX += spaceAdvance;
      continue;
    }

    // Získať glyph
    const glyph = font.charToGlyph(char);
    if (!glyph || glyph.index === 0) {
      // Znak nie je vo fonte – preskočiť
      console.warn(`Font neobsahuje znak '${char}', preskakujem`);
      cursorX += letterHeightMm * 0.3;
      continue;
    }

    const advanceWidth = (glyph.advanceWidth || unitsPerEm * 0.5) * scale;

    // Získať path pre tento glyph
    // opentype.js getPath(x, y, fontSize) – y je baseline
    // fontSize sa škáluje automaticky
    const glyphPath = glyph.getPath(cursorX / scale, 0, unitsPerEm);

    // Konvertovať na SVG path data
    const commands = glyphPath.commands || [];
    let pathData = '';

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'M':
          pathData += `M ${(cmd.x * scale).toFixed(3)} ${(-cmd.y * scale + letterHeightMm).toFixed(3)} `;
          break;
        case 'L':
          pathData += `L ${(cmd.x * scale).toFixed(3)} ${(-cmd.y * scale + letterHeightMm).toFixed(3)} `;
          break;
        case 'Q':
          pathData += `Q ${(cmd.x1 * scale).toFixed(3)} ${(-cmd.y1 * scale + letterHeightMm).toFixed(3)} ${(cmd.x * scale).toFixed(3)} ${(-cmd.y * scale + letterHeightMm).toFixed(3)} `;
          break;
        case 'C':
          pathData += `C ${(cmd.x1 * scale).toFixed(3)} ${(-cmd.y1 * scale + letterHeightMm).toFixed(3)} ${(cmd.x2 * scale).toFixed(3)} ${(-cmd.y2 * scale + letterHeightMm).toFixed(3)} ${(cmd.x * scale).toFixed(3)} ${(-cmd.y * scale + letterHeightMm).toFixed(3)} `;
          break;
        case 'Z':
          pathData += 'Z ';
          break;
      }
    }

    pathData = pathData.trim();

    if (pathData) {
      letters.push({
        char,
        pathData,
        offsetX: cursorX,
        widthMm: advanceWidth,
        heightMm: letterHeightMm,
      });

      // SVG path element – každé písmeno má id pre identifikáciu
      pathElements.push(
        `  <path id="letter-${i}" data-char="${char}" d="${pathData}" fill="black" />`
      );
    }

    cursorX += advanceWidth + letterSpacingMm;
  }

  const totalWidthMm = cursorX > 0 ? cursorX - letterSpacingMm : 0;
  const totalHeightMm = letterHeightMm;

  // Zostaviť kompletný SVG
  const svgContent = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `  viewBox="0 0 ${totalWidthMm.toFixed(1)} ${totalHeightMm.toFixed(1)}"`,
    `  width="${totalWidthMm.toFixed(1)}mm"`,
    `  height="${totalHeightMm.toFixed(1)}mm">`,
    ...pathElements,
    `</svg>`,
  ].join('\n');

  return {
    svgContent,
    letters,
    totalWidthMm,
    totalHeightMm,
  };
}

/**
 * Validácia SVG obsahu – kontrola či obsahuje <path> alebo <polygon> elementy
 */
export function validateSVG(svgContent: string): boolean {
  return (
    svgContent.includes('<path') ||
    svgContent.includes('<polygon') ||
    svgContent.includes('<rect') ||
    svgContent.includes('<circle') ||
    svgContent.includes('<ellipse')
  );
}
