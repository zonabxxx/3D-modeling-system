/**
 * SVG Utils — čistenie SVG pri uploade + transparentné renderovanie
 *
 * Prístup:
 * 1. Parsuj SVG cez DOMParser
 * 2. Nájdi <style> a extrahuj CSS triedy s fill farbami
 * 3. Nájdi veľké biele elementy (rect, path, circle, ellipse, polygon) → odstráň
 * 4. Canvas rendering → nájdi skutočné rozmery obsahu
 * 5. Aktualizuj viewBox na obsah
 * 6. Pre 2D zobrazenie: renderuj do PNG s transparentným pozadím
 */

export interface CleanSVGResult {
  /** Vyčistený SVG (bez bieleho pozadia, orezaný viewBox) */
  svg: string;
  /** Šírka obsahu */
  width: number;
  /** Výška obsahu */
  height: number;
}

// ─── Farby biele / takmer biele ───────────────────────

const WHITE_VALUES = new Set([
  '#fff', '#ffffff', '#fefefe', '#f5f5f5', '#fafafa',
  'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)',
]);

function isWhite(color: string): boolean {
  if (!color) return false;
  const c = color.toLowerCase().trim().replace(/\s/g, '');
  if (WHITE_VALUES.has(c)) return true;
  // rgb(2xx, 2xx, 2xx) kde všetky > 240
  const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (m && +m[1] > 240 && +m[2] > 240 && +m[3] > 240) return true;
  return false;
}

// ─── Parsovanie CSS tried z <style> ───────────────────

function parseCSSFills(svgDoc: Document): Map<string, string> {
  const map = new Map<string, string>();
  svgDoc.querySelectorAll('style').forEach((styleEl) => {
    const css = styleEl.textContent || '';
    // Nájdi .cls-1{fill:#fff} alebo .cls-1 { fill: #ffffff; }
    const re = /\.([a-zA-Z0-9_-]+)\s*\{[^}]*?\bfill\s*:\s*([^;}]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      map.set(m[1].trim(), m[2].trim());
    }
  });
  return map;
}

// ─── Získanie fill farby z elementu ───────────────────

function getElementFill(el: Element, cssFills: Map<string, string>): string {
  // 1. Inline fill atribút
  const inlineFill = el.getAttribute('fill');
  if (inlineFill && inlineFill !== 'none') return inlineFill;

  // 2. Inline style
  const style = el.getAttribute('style') || '';
  const styleMatch = style.match(/\bfill\s*:\s*([^;]+)/i);
  if (styleMatch) return styleMatch[1].trim();

  // 3. CSS trieda
  const cls = el.getAttribute('class');
  if (cls) {
    for (const className of cls.split(/\s+/)) {
      const fill = cssFills.get(className);
      if (fill) return fill;
    }
  }

  return '';
}

// ─── Parsovanie viewBox ───────────────────────────────

function parseViewBox(svg: Element): { x: number; y: number; w: number; h: number } {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.split(/[\s,]+/).map(Number);
    if (p.length >= 4 && p[2] > 0 && p[3] > 0) {
      return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
  }
  const w = parseFloat(svg.getAttribute('width') || '0');
  const h = parseFloat(svg.getAttribute('height') || '0');
  return { x: 0, y: 0, w: w || 100, h: h || 100 };
}

// ─── Path rectangle detection ─────────────────────────

/**
 * Zistí či <path d="..."> je jednoduchý obdĺžnik pokrývajúci viewBox.
 * Detekuje bežné vzory: M...H...V...H...Z, M...L...L...L...Z
 */
function isBackgroundPath(d: string, vb: { w: number; h: number }): boolean {
  // Parse path commands
  const tokens = d.replace(/([a-zA-Z])/g, '\n$1').trim().split('\n').filter(Boolean);
  if (tokens.length < 3 || tokens.length > 8) return false;

  const coords: [number, number][] = [];
  let cx = 0, cy = 0;

  for (const tok of tokens) {
    const letter = tok[0];
    const nums = tok.slice(1).trim().match(/-?\d+\.?\d*/g)?.map(Number) || [];

    switch (letter) {
      case 'M': cx = nums[0] ?? 0; cy = nums[1] ?? 0; coords.push([cx, cy]); break;
      case 'm': cx += nums[0] ?? 0; cy += nums[1] ?? 0; coords.push([cx, cy]); break;
      case 'L': cx = nums[0] ?? 0; cy = nums[1] ?? 0; coords.push([cx, cy]); break;
      case 'l': cx += nums[0] ?? 0; cy += nums[1] ?? 0; coords.push([cx, cy]); break;
      case 'H': cx = nums[0] ?? 0; coords.push([cx, cy]); break;
      case 'h': cx += nums[0] ?? 0; coords.push([cx, cy]); break;
      case 'V': cy = nums[0] ?? 0; coords.push([cx, cy]); break;
      case 'v': cy += nums[0] ?? 0; coords.push([cx, cy]); break;
      case 'Z': case 'z': break;
      default:
        // Complex path command (C, S, Q, A, etc.) → not a simple rect
        return false;
    }
  }

  if (coords.length < 3) return false;

  // Compute bounding box of the path
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  const w = maxX - minX;
  const h = maxY - minY;

  return w >= vb.w * 0.7 && h >= vb.h * 0.7;
}

// ─── Extended background removal ──────────────────────

const SHAPE_TAGS = new Set(['rect', 'path', 'circle', 'ellipse', 'polygon']);

function removeWhiteBackgrounds(
  svgEl: Element,
  vb: { x: number; y: number; w: number; h: number },
  cssFills: Map<string, string>,
): number {
  let removed = 0;

  // Collect candidates: direct children of <svg> and children of first <g>
  const candidates: Element[] = [];

  for (const child of Array.from(svgEl.children)) {
    const tag = child.tagName.toLowerCase();
    if (SHAPE_TAGS.has(tag)) {
      candidates.push(child);
    } else if (tag === 'g') {
      // Also check children inside first-level <g> groups
      for (const gChild of Array.from(child.children)) {
        if (SHAPE_TAGS.has(gChild.tagName.toLowerCase())) {
          candidates.push(gChild);
        }
      }
    }
  }

  for (const el of candidates) {
    const fill = getElementFill(el, cssFills);
    if (!fill || !isWhite(fill)) continue;

    const tag = el.tagName.toLowerCase();
    let isBackground = false;

    if (tag === 'rect') {
      const wStr = el.getAttribute('width') || '0';
      const hStr = el.getAttribute('height') || '0';
      const w = wStr.includes('%') ? vb.w : parseFloat(wStr);
      const h = hStr.includes('%') ? vb.h : parseFloat(hStr);
      const x = parseFloat(el.getAttribute('x') || '0');
      const y = parseFloat(el.getAttribute('y') || '0');
      isBackground = w >= vb.w * 0.7 && h >= vb.h * 0.7 && x <= vb.w * 0.2 && y <= vb.h * 0.2;
    }

    if (tag === 'circle') {
      const r = parseFloat(el.getAttribute('r') || '0');
      isBackground = r * 2 >= Math.min(vb.w, vb.h) * 0.7;
    }

    if (tag === 'ellipse') {
      const rx = parseFloat(el.getAttribute('rx') || '0');
      const ry = parseFloat(el.getAttribute('ry') || '0');
      isBackground = rx * 2 >= vb.w * 0.7 && ry * 2 >= vb.h * 0.7;
    }

    if (tag === 'path') {
      const d = el.getAttribute('d') || '';
      isBackground = isBackgroundPath(d, vb);
    }

    if (tag === 'polygon') {
      const points = el.getAttribute('points') || '';
      const nums = points.match(/-?\d+\.?\d*/g)?.map(Number);
      if (nums && nums.length >= 6) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < nums.length - 1; i += 2) {
          minX = Math.min(minX, nums[i]); maxX = Math.max(maxX, nums[i]);
          minY = Math.min(minY, nums[i + 1]); maxY = Math.max(maxY, nums[i + 1]);
        }
        isBackground = (maxX - minX) >= vb.w * 0.7 && (maxY - minY) >= vb.h * 0.7;
      }
    }

    if (isBackground) {
      console.log(`[cleanSVG] Removing background <${tag}> fill="${fill}"`);
      el.remove();
      removed++;
    }
  }

  // Also remove white fill from root <svg>
  const svgFill = getElementFill(svgEl, cssFills);
  if (isWhite(svgFill)) {
    svgEl.removeAttribute('fill');
    const style = svgEl.getAttribute('style') || '';
    if (style) {
      svgEl.setAttribute('style', style.replace(/\bfill\s*:[^;]+;?/gi, '').trim());
    }
  }

  // Remove background-color from style
  const svgStyle = svgEl.getAttribute('style') || '';
  if (/background(-color)?:/i.test(svgStyle)) {
    svgEl.setAttribute('style',
      svgStyle.replace(/background(-color)?:\s*[^;]+;?/gi, '').trim()
    );
  }

  return removed;
}

// ─── Hlavná funkcia: cleanSVG ─────────────────────────

/**
 * Vyčistí SVG:
 * 1. Odstráni biele pozadie (veľké elementy s bielou výplňou — rect, path, circle...)
 * 2. Nájde skutočné rozmery obsahu cez canvas rendering
 * 3. Oreže viewBox na obsah
 *
 * Vracia Promise (kvôli canvas rendering).
 */
export async function cleanSVG(rawSvg: string): Promise<CleanSVGResult> {
  if (!rawSvg || typeof document === 'undefined') {
    return { svg: rawSvg || '', width: 100, height: 100 };
  }

  // ── 1. Parsuj SVG ──
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');

  if (!svgEl) {
    console.warn('[cleanSVG] No <svg> element found');
    return { svg: rawSvg, width: 100, height: 100 };
  }

  const vb = parseViewBox(svgEl);
  console.log(`[cleanSVG] ViewBox: ${vb.w} × ${vb.h}`);

  // ── 2. Extrahuj CSS fill mapu ──
  const cssFills = parseCSSFills(doc);
  console.log(`[cleanSVG] CSS fills:`, Object.fromEntries(cssFills));

  // ── 3. Nájdi a odstráň biele pozadie (ALL element types) ──
  const removed = removeWhiteBackgrounds(svgEl, vb, cssFills);
  console.log(`[cleanSVG] Removed ${removed} background elements`);

  // ── 4. Serializuj medzivýsledok ──
  if (!svgEl.getAttribute('xmlns')) {
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const serializer = new XMLSerializer();
  const cleanedSvg = serializer.serializeToString(svgEl);

  // ── 5. Nájdi skutočné rozmery obsahu cez canvas ──
  try {
    const bounds = await findContentBounds(cleanedSvg, vb);

    if (bounds && bounds.w > 1 && bounds.h > 1) {
      const pad = Math.max(bounds.w, bounds.h) * 0.02;
      const newVB = `${(bounds.x - pad).toFixed(2)} ${(bounds.y - pad).toFixed(2)} ${(bounds.w + pad * 2).toFixed(2)} ${(bounds.h + pad * 2).toFixed(2)}`;

      const doc2 = parser.parseFromString(cleanedSvg, 'image/svg+xml');
      const svg2 = doc2.querySelector('svg');
      if (svg2) {
        const finalW = bounds.w + pad * 2;
        const finalH = bounds.h + pad * 2;

        svg2.setAttribute('viewBox', newVB);
        svg2.setAttribute('width', finalW.toFixed(2));
        svg2.setAttribute('height', finalH.toFixed(2));
        if (!svg2.getAttribute('xmlns')) {
          svg2.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }

        const finalSvg = serializer.serializeToString(svg2);
        console.log(`[cleanSVG] ViewBox cropped: ${vb.w.toFixed(0)}×${vb.h.toFixed(0)} → ${Math.round(finalW)}×${Math.round(finalH)}`);

        return { svg: finalSvg, width: finalW, height: finalH };
      }
    }
  } catch (err) {
    console.warn('[cleanSVG] Canvas bounds detection failed:', err);
  }

  // Fallback: vráť čistený SVG s pôvodnými rozmermi
  return { svg: cleanedSvg, width: vb.w, height: vb.h };
}

// ─── Canvas-based content bounds detection ────────────

function findContentBounds(
  svgString: string,
  vb: { x: number; y: number; w: number; h: number },
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const CANVAS_SIZE = 512;
    const scaleX = CANVAS_SIZE / vb.w;
    const scaleY = CANVAS_SIZE / vb.h;

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(null); return; }

    // Biele pozadie
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      URL.revokeObjectURL(url);

      const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const data = imageData.data;

      let minX = CANVAS_SIZE, minY = CANVAS_SIZE, maxX = 0, maxY = 0;
      let found = false;

      for (let y = 0; y < CANVAS_SIZE; y++) {
        for (let x = 0; x < CANVAS_SIZE; x++) {
          const i = (y * CANVAS_SIZE + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];

          if (r < 245 || g < 245 || b < 245) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            found = true;
          }
        }
      }

      if (!found) {
        // Try with transparent background (for white logos)
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const data2 = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;

        for (let y = 0; y < CANVAS_SIZE; y++) {
          for (let x = 0; x < CANVAS_SIZE; x++) {
            const i = (y * CANVAS_SIZE + x) * 4;
            const a = data2[i + 3];
            if (a > 10) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }
      }

      if (!found || maxX <= minX || maxY <= minY) {
        resolve(null);
        return;
      }

      resolve({
        x: vb.x + minX / scaleX,
        y: vb.y + minY / scaleY,
        w: (maxX - minX) / scaleX,
        h: (maxY - minY) / scaleY,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(null);
    }, 3000);

    img.src = url;
  });
}

// ─── SVG → transparentný PNG (pre 2D zobrazenie) ─────

/**
 * Renderuje SVG do canvas a konvertuje biele pixely na transparentné.
 * Spoľahlivé riešenie pre 2D zobrazenie SVG bez bieleho pozadia,
 * nezávisle od štruktúry SVG.
 */
export async function svgToTransparentPngUrl(
  svgContent: string,
  maxSize: number = 1024,
): Promise<string> {
  return new Promise((resolve) => {
    if (!svgContent || typeof document === 'undefined') {
      resolve(svgToDataUrl(svgContent || ''));
      return;
    }

    let svg = svgContent;
    if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Get SVG dimensions for aspect ratio
    const vbMatch = svg.match(/viewBox=["']([^"']+)["']/);
    let svgW = 1, svgH = 1;
    if (vbMatch) {
      const parts = vbMatch[1].split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
        svgW = parts[2]; svgH = parts[3];
      }
    }

    const aspect = svgW / svgH;
    let canvasW: number, canvasH: number;
    if (aspect >= 1) {
      canvasW = maxSize;
      canvasH = Math.round(maxSize / aspect);
    } else {
      canvasH = maxSize;
      canvasW = Math.round(maxSize * aspect);
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(svgToDataUrl(svgContent)); return; }

    // Transparent background
    ctx.clearRect(0, 0, canvasW, canvasH);

    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch { /* ok */ } };

    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      cleanup();

      // Convert white/near-white opaque pixels → transparent
      const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
        if (a > 200 && r > 240 && g > 240 && b > 240) {
          d[i + 3] = 0; // Make transparent
        }
      }
      ctx.putImageData(imageData, 0, 0);

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      cleanup();
      // Fallback to SVG data URL
      resolve(svgToDataUrl(svgContent));
    };

    setTimeout(() => {
      cleanup();
      resolve(svgToDataUrl(svgContent));
    }, 3000);

    img.src = url;
  });
}

// ─── Jednoduché utility ───────────────────────────────

/**
 * Synchronná verzia — len odstráni biele pozadie, BEZ canvas orezania.
 */
export function stripSvgBackgroundSync(rawSvg: string): string {
  if (!rawSvg) return rawSvg;

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return rawSvg;

  const vb = parseViewBox(svgEl);
  const cssFills = parseCSSFills(doc);
  removeWhiteBackgrounds(svgEl, vb, cssFills);

  return new XMLSerializer().serializeToString(svgEl);
}

/** Konvertuje SVG na data URL (zabezpečí xmlns pre <img> kompatibilitu) */
export function svgToDataUrl(svgContent: string): string {
  let svg = svgContent;
  if (!svg.includes('xmlns')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Pre kompatibilitu – teraz vracia SVG data URL (synchrónne) */
export function svgToTransparentDataUrl(svgContent: string | null): string | null {
  if (!svgContent) return null;
  return svgToDataUrl(svgContent);
}

/** Pre kompatibilitu */
export function stripSvgBackground(svgContent: string): string {
  return stripSvgBackgroundSync(svgContent);
}

// ─── Recolor SVG fills ────────────────────────────────

/**
 * Recoloruje všetky viditeľné výplne v SVG na zadanú farbu.
 * Používa sa pre 2D preview kde chceme aby logo malo faceColor.
 * Ignoruje elementy s fill="none" a priehľadné elementy.
 */
export function recolorSVG(svgContent: string, newFillColor: string): string {
  if (!svgContent || !newFillColor) return svgContent;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svgContent;

  // 1. Nahradiť fill farby v <style> elementoch
  svgEl.querySelectorAll('style').forEach((styleEl) => {
    let css = styleEl.textContent || '';
    // Replace fill: #xxx → fill: newFillColor
    css = css.replace(/(\bfill\s*:\s*)([^;}]+)/gi, `$1${newFillColor}`);
    styleEl.textContent = css;
  });

  // 2. Nahradiť fill atribúty na všetkých grafických elementoch
  const allElements = svgEl.querySelectorAll('*');
  allElements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    // Preskočiť <svg>, <defs>, <style>, <clipPath>, <mask>, metadata
    if (['svg', 'defs', 'style', 'clippath', 'mask', 'metadata', 'title', 'desc', 'lineargradient', 'radialgradient', 'stop', 'pattern'].includes(tag)) return;

    // Inline fill atribút
    const fill = el.getAttribute('fill');
    if (fill && fill !== 'none' && fill !== 'transparent' && !fill.startsWith('url(')) {
      el.setAttribute('fill', newFillColor);
    }

    // Inline style fill
    const style = el.getAttribute('style') || '';
    if (/\bfill\s*:/i.test(style)) {
      const newStyle = style.replace(/\bfill\s*:\s*([^;]+)/gi, (match, val) => {
        const v = val.trim();
        if (v === 'none' || v === 'transparent' || v.startsWith('url(')) return match;
        return `fill: ${newFillColor}`;
      });
      el.setAttribute('style', newStyle);
    }

    // Ak element nemá žiadny fill (dedí), a je to grafický element, nastav fill
    if (!fill && !style.includes('fill') && ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan'].includes(tag)) {
      // Len ak je priamy grafický element (nie <g>)
      el.setAttribute('fill', newFillColor);
    }
  });

  if (!svgEl.getAttribute('xmlns')) {
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  return new XMLSerializer().serializeToString(svgEl);
}
