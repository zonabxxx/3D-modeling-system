/**
 * API utils — volá existujúci Next.js / Python backend
 *
 * Stratégia: Najprv skúsi Next.js proxy (port 3001), ak nedostupný → priamo Python backend (port 8000)
 * Na dev-e: http://localhost:3001 (Next.js) a http://localhost:8000 (Python STL)
 */

const NEXTJS_API = import.meta.env.PUBLIC_API_URL || 'http://localhost:3001';
const PYTHON_API = import.meta.env.PUBLIC_STL_BACKEND_URL || 'http://localhost:8000';

/**
 * Smart fetch — skúsi primárnu URL, ak zlyhá (network error), skúsi fallback
 */
async function smartFetch(primaryUrl: string, fallbackUrl: string | null, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(primaryUrl, init);
    return res;
  } catch (_networkErr) {
    // Network error (ECONNREFUSED) → skús fallback
    if (fallbackUrl) {
      console.warn(`[API] ${primaryUrl} nedostupný, skúšam ${fallbackUrl}`);
      return fetch(fallbackUrl, init);
    }
    throw _networkErr;
  }
}

export async function generateLogo(opts: {
  businessName: string;
  industry: string;
  style: string;
  description: string;
  provider?: string;
  variantCount?: number;
}) {
  const res = await fetch(`${NEXTJS_API}/api/generate-logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Logo gen error: ${res.status}`);
  return res.json();
}

export async function vectorize(pngBase64: string, targetHeightMm = 200) {
  const body = JSON.stringify({ png_base64: pngBase64, target_height_mm: targetHeightMm });
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
  const res = await smartFetch(
    `${NEXTJS_API}/api/vectorize`,
    `${PYTHON_API}/vectorize`,
    init,
  );
  if (!res.ok) throw new Error(`Vectorize error: ${res.status}`);
  return res.json();
}

/* ═══════════════════════════════════════════ */
/* STL Generation & Download                   */
/* ═══════════════════════════════════════════ */

// Font mapping (family → file path relative to stl-generator/)
const FONT_MAP: Record<string, string> = {
  'Montserrat':    'fonts/Montserrat-Bold.ttf',
  'Bebas Neue':    'fonts/BebasNeue-Regular.ttf',
  'Oswald':        'fonts/Oswald-Bold.ttf',
  'Poppins':       'fonts/Poppins-Black.ttf',
  'Roboto':        'fonts/Roboto-Bold.ttf',
  'Inter':         'fonts/Inter-Bold.ttf',
  'Raleway':       'fonts/Raleway-Black.ttf',
  'Archivo Black': 'fonts/ArchivoBlack-Regular.ttf',
  'Outfit':        'fonts/Outfit-Bold.ttf',
  'Barlow':        'fonts/Barlow-Bold.ttf',
};

export interface PartInfo {
  name: string;
  filename: string;
  part_type: string;
  description: string;
}

export interface LetterInfo {
  char: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number;
  parts_count: number;
  is_segmented: boolean;
  segment_count: number;
  led_count: number;
  weight_g: number;
  parts: PartInfo[];
}

export interface STLResult {
  jobId: string;
  downloadUrl: string;
  directUrl?: string;
  totalParts: number;
  totalWeightG: number;
  totalLedCount: number;
  lightingType: string;
  material: string;
  letters: LetterInfo[];
}

export interface GenerateSTLOpts {
  text: string;
  fontFamily: string;
  letterHeightMm: number;
  depthMm: number;
  lightingType: string;
  profileType: string;
  svgContent?: string | null;
  material?: string;
}

// Track which backend is available
let _stlBackend: 'nextjs' | 'python' | null = null;

/**
 * Generovať STL súbory — automaticky vyberie dostupný backend
 * 1. Skúsi Next.js proxy (port 3001) — podporuje presety z DB
 * 2. Ak nedostupný → priamo Python CadQuery backend (port 8000)
 */
export async function generateSTL(opts: GenerateSTLOpts): Promise<STLResult> {
  const fontPath = FONT_MAP[opts.fontFamily] || 'fonts/Roboto-Bold.ttf';

  // Python backend request body (snake_case)
  const pythonBody = {
    text: opts.text || 'ADSUN',
    font_path: fontPath,
    letter_height_mm: opts.letterHeightMm,
    depth_mm: opts.depthMm,
    lighting_type: opts.lightingType,
    material: opts.material || 'asa',
    letter_spacing_mm: 10,
    profile_type: opts.profileType,
    svg_content: opts.svgContent || null,
  };

  // Next.js proxy request body (camelCase)
  const nextjsBody = {
    text: opts.text || 'ADSUN',
    fontFamily: opts.fontFamily,
    letterHeightMm: opts.letterHeightMm,
    depthMm: opts.depthMm,
    lightingType: opts.lightingType,
    material: opts.material || 'asa',
    profileType: opts.profileType,
    svgContent: opts.svgContent || null,
  };

  const headers = { 'Content-Type': 'application/json' };
  let data: any;

  // Strategy: use cached backend, or try Next.js first, then Python
  if (_stlBackend === 'python' || _stlBackend === null) {
    try {
      // Try Python backend directly (faster, no middleman)
      const res = await fetch(`${PYTHON_API}/generate-stl`, {
        method: 'POST', headers,
        body: JSON.stringify(pythonBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `STL error: ${res.status}`);
      }
      _stlBackend = 'python';
      const raw = await res.json();
      // Map Python response (snake_case) → our interface (camelCase)
      data = {
        jobId: raw.job_id,
        downloadUrl: `/download/${raw.job_id}`, // relative to Python backend
        directUrl: `${PYTHON_API}/download/${raw.job_id}`,
        totalParts: raw.total_parts,
        totalWeightG: raw.total_weight_g,
        totalLedCount: raw.total_led_count,
        lightingType: raw.lighting_type,
        material: raw.material,
        letters: raw.letters,
      };
    } catch (err: any) {
      if (_stlBackend === 'python') throw err; // Already confirmed this backend, don't fallback
      // First attempt, try Next.js proxy as fallback
      console.warn('[API] Python backend nedostupný, skúšam Next.js proxy...');
      try {
        const res = await fetch(`${NEXTJS_API}/api/generate-stl`, {
          method: 'POST', headers,
          body: JSON.stringify(nextjsBody),
        });
        if (!res.ok) {
          const err2 = await res.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(err2.message || `STL error: ${res.status}`);
        }
        _stlBackend = 'nextjs';
        data = await res.json();
      } catch (_) {
        throw new Error(
          'STL generátor nie je dostupný.\n\n' +
          'Spustite Python backend:\n' +
          '  cd stl-generator && uvicorn app.main:app --reload --port 8000\n\n' +
          'Alebo Next.js (port 3001):\n' +
          '  cd "3D_modelovanie_web" && npm run dev'
        );
      }
    }
  } else {
    // Use Next.js proxy (cached)
    const res = await fetch(`${NEXTJS_API}/api/generate-stl`, {
      method: 'POST', headers,
      body: JSON.stringify(nextjsBody),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(err.message || `STL error: ${res.status}`);
    }
    data = await res.json();
  }

  if (data.totalParts === 0 || !data.letters?.length) {
    throw new Error('Neboli vygenerované žiadne diely.\nSkontrolujte SVG alebo text.');
  }

  return data as STLResult;
}

/**
 * Stiahnuť ZIP so STL súbormi
 */
export function downloadSTL(downloadUrl: string) {
  // If directUrl is available (Python backend), use it. Otherwise use Next.js proxy.
  if (downloadUrl.startsWith('http')) {
    window.open(downloadUrl, '_blank');
  } else if (_stlBackend === 'python') {
    window.open(`${PYTHON_API}${downloadUrl}`, '_blank');
  } else {
    window.open(`${NEXTJS_API}${downloadUrl}`, '_blank');
  }
}
