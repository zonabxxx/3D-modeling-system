/**
 * SVG Utils — čistenie, recolor, konverzia na PNG
 */

export interface CleanSVGResult { svg: string; width: number; height: number; }

const WHITE_SET = new Set([
  '#fff', '#ffffff', '#fefefe', '#f5f5f5', '#fafafa', 'white',
  'rgb(255,255,255)', 'rgb(255, 255, 255)',
]);

function isWhite(c: string) {
  if (!c) return false;
  const n = c.toLowerCase().trim().replace(/\s/g, '');
  if (WHITE_SET.has(n)) return true;
  const m = n.match(/rgb\((\d+),(\d+),(\d+)\)/);
  return !!(m && +m[1] > 240 && +m[2] > 240 && +m[3] > 240);
}

function parseCSSFills(doc: Document) {
  const map = new Map<string, string>();
  doc.querySelectorAll('style').forEach((s) => {
    const re = /\.([a-zA-Z0-9_-]+)\s*\{[^}]*?\bfill\s*:\s*([^;}]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.textContent || '')) !== null) map.set(m[1].trim(), m[2].trim());
  });
  return map;
}

function getFill(el: Element, css: Map<string, string>) {
  const f = el.getAttribute('fill');
  if (f && f !== 'none') return f;
  const sm = (el.getAttribute('style') || '').match(/\bfill\s*:\s*([^;]+)/i);
  if (sm) return sm[1].trim();
  for (const cn of (el.getAttribute('class') || '').split(/\s+/)) {
    const cf = css.get(cn);
    if (cf) return cf;
  }
  return '';
}

function parseVB(svg: Element) {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.split(/[\s,]+/).map(Number);
    if (p.length >= 4 && p[2] > 0 && p[3] > 0) return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  return { x: 0, y: 0, w: parseFloat(svg.getAttribute('width') || '100'), h: parseFloat(svg.getAttribute('height') || '100') };
}

function isBgPath(d: string, vb: { w: number; h: number }) {
  const toks = d.replace(/([a-zA-Z])/g, '\n$1').trim().split('\n').filter(Boolean);
  if (toks.length < 3 || toks.length > 8) return false;
  const coords: [number, number][] = [];
  let cx = 0, cy = 0;
  for (const t of toks) {
    const l = t[0], ns = t.slice(1).trim().match(/-?\d+\.?\d*/g)?.map(Number) || [];
    switch (l) {
      case 'M': cx = ns[0] ?? 0; cy = ns[1] ?? 0; coords.push([cx, cy]); break;
      case 'L': cx = ns[0] ?? 0; cy = ns[1] ?? 0; coords.push([cx, cy]); break;
      case 'H': cx = ns[0] ?? 0; coords.push([cx, cy]); break;
      case 'V': cy = ns[0] ?? 0; coords.push([cx, cy]); break;
      case 'h': cx += ns[0] ?? 0; coords.push([cx, cy]); break;
      case 'v': cy += ns[0] ?? 0; coords.push([cx, cy]); break;
      case 'Z': case 'z': break;
      default: return false;
    }
  }
  if (coords.length < 3) return false;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  for (const [x, y] of coords) { mnX = Math.min(mnX, x); mxX = Math.max(mxX, x); mnY = Math.min(mnY, y); mxY = Math.max(mxY, y); }
  return (mxX - mnX) >= vb.w * 0.7 && (mxY - mnY) >= vb.h * 0.7;
}

const SHAPES = new Set(['rect', 'path', 'circle', 'ellipse', 'polygon']);

function removeBgs(svgEl: Element, vb: ReturnType<typeof parseVB>, css: Map<string, string>) {
  let rm = 0;
  const cands: Element[] = [];
  for (const ch of Array.from(svgEl.children)) {
    const t = ch.tagName.toLowerCase();
    if (SHAPES.has(t)) cands.push(ch);
    else if (t === 'g') for (const gc of Array.from(ch.children)) if (SHAPES.has(gc.tagName.toLowerCase())) cands.push(gc);
  }
  for (const el of cands) {
    const fill = getFill(el, css);
    if (!fill || !isWhite(fill)) continue;
    const tag = el.tagName.toLowerCase();
    let bg = false;
    if (tag === 'rect') {
      const w = parseFloat(el.getAttribute('width') || '0'), h = parseFloat(el.getAttribute('height') || '0');
      bg = w >= vb.w * 0.7 && h >= vb.h * 0.7;
    }
    if (tag === 'path') bg = isBgPath(el.getAttribute('d') || '', vb);
    if (bg) { el.remove(); rm++; }
  }
  return rm;
}

export async function cleanSVG(raw: string): Promise<CleanSVGResult> {
  if (!raw || typeof document === 'undefined') return { svg: raw || '', width: 100, height: 100 };
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return { svg: raw, width: 100, height: 100 };
  const vb = parseVB(svgEl);
  const css = parseCSSFills(doc);
  removeBgs(svgEl, vb, css);
  if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const cleaned = new XMLSerializer().serializeToString(svgEl);
  try {
    const bounds = await findBounds(cleaned, vb);
    if (bounds && bounds.w > 1 && bounds.h > 1) {
      const pad = Math.max(bounds.w, bounds.h) * 0.02;
      const d2 = new DOMParser().parseFromString(cleaned, 'image/svg+xml');
      const s2 = d2.querySelector('svg');
      if (s2) {
        const fw = bounds.w + pad * 2, fh = bounds.h + pad * 2;
        s2.setAttribute('viewBox', `${(bounds.x - pad).toFixed(2)} ${(bounds.y - pad).toFixed(2)} ${fw.toFixed(2)} ${fh.toFixed(2)}`);
        s2.setAttribute('width', fw.toFixed(2));
        s2.setAttribute('height', fh.toFixed(2));
        if (!s2.getAttribute('xmlns')) s2.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return { svg: new XMLSerializer().serializeToString(s2), width: fw, height: fh };
      }
    }
  } catch { /* fallback */ }
  return { svg: cleaned, width: vb.w, height: vb.h };
}

function findBounds(svg: string, vb: ReturnType<typeof parseVB>): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const S = 512;
    const sx = S / vb.w, sy = S / vb.h;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    if (!ctx) return resolve(null);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, S, S); URL.revokeObjectURL(url);
      const d = ctx.getImageData(0, 0, S, S).data;
      let mnX = S, mnY = S, mxX = 0, mxY = 0, found = false;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
          if (x < mnX) mnX = x; if (y < mnY) mnY = y; if (x > mxX) mxX = x; if (y > mxY) mxY = y; found = true;
        }
      }
      if (!found || mxX <= mnX) return resolve(null);
      resolve({ x: vb.x + mnX / sx, y: vb.y + mnY / sy, w: (mxX - mnX) / sx, h: (mxY - mnY) / sy });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    setTimeout(() => { URL.revokeObjectURL(url); resolve(null); }, 3000);
    img.src = url;
  });
}

export function svgToDataUrl(svg: string) {
  let s = svg;
  if (!s.includes('xmlns')) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

export async function svgToTransparentPng(svg: string, maxSz = 1024): Promise<string> {
  return new Promise((resolve) => {
    if (!svg || typeof document === 'undefined') return resolve(svgToDataUrl(svg || ''));
    let s = svg;
    if (!s.includes('xmlns="http://www.w3.org/2000/svg"')) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const vbM = s.match(/viewBox=["']([^"']+)["']/);
    let sw = 1, sh = 1;
    if (vbM) { const p = vbM[1].split(/[\s,]+/).map(Number); if (p.length >= 4 && p[2] > 0 && p[3] > 0) { sw = p[2]; sh = p[3]; } }
    const asp = sw / sh;
    const cw = asp >= 1 ? maxSz : Math.round(maxSz * asp);
    const ch = asp >= 1 ? Math.round(maxSz / asp) : maxSz;
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    if (!ctx) return resolve(svgToDataUrl(svg));
    ctx.clearRect(0, 0, cw, ch);
    const img = new Image();
    const blob = new Blob([s], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, cw, ch); URL.revokeObjectURL(url);
      const d = ctx.getImageData(0, 0, cw, ch);
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i + 3] > 200 && d.data[i] > 240 && d.data[i + 1] > 240 && d.data[i + 2] > 240) d.data[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(svgToDataUrl(svg)); };
    setTimeout(() => { URL.revokeObjectURL(url); resolve(svgToDataUrl(svg)); }, 3000);
    img.src = url;
  });
}

export function recolorSVG(svg: string, color: string) {
  if (!svg || !color) return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.querySelector('svg');
  if (!el) return svg;
  el.querySelectorAll('style').forEach((s) => {
    s.textContent = (s.textContent || '').replace(/(\bfill\s*:\s*)([^;}]+)/gi, `$1${color}`);
  });
  el.querySelectorAll('*').forEach((e) => {
    const tag = e.tagName.toLowerCase();
    if (['svg', 'defs', 'style', 'clippath', 'mask', 'metadata'].includes(tag)) return;
    const f = e.getAttribute('fill');
    if (f && f !== 'none' && f !== 'transparent' && !f.startsWith('url(')) e.setAttribute('fill', color);
    const st = e.getAttribute('style') || '';
    if (/\bfill\s*:/i.test(st)) {
      e.setAttribute('style', st.replace(/\bfill\s*:\s*([^;]+)/gi, (m, v) => v.trim() === 'none' || v.trim().startsWith('url(') ? m : `fill: ${color}`));
    }
    if (!f && !st.includes('fill') && ['path', 'rect', 'circle', 'ellipse', 'polygon', 'text'].includes(tag)) e.setAttribute('fill', color);
  });
  if (!el.getAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(el);
}
