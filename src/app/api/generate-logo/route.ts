/**
 * POST /api/generate-logo
 *
 * Generuje logo cez AI API:
 *   1. Recraft V3 (primárny – výstup SVG)
 *   2. OpenAI gpt-image-1 / DALL-E 3 (PNG → automatická vektorizácia na SVG)
 *
 * Pipeline pre PNG:
 *   OpenAI PNG 1024×1024 → Python potrace/fallback → SVG kontúry → 3D extrúzia
 *
 * Body: { businessName: string, style: string, count?: number, vectorize?: boolean }
 * Response: { variants: Array<{ url: string, svgUrl?: string, type: 'svg' | 'png', provider: string }> }
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_BACKEND = process.env.STL_BACKEND_URL || 'http://localhost:8000';

// ───────────────────────────────────────────────
// Typy
// ───────────────────────────────────────────────

interface GenerateRequest {
  businessName: string;
  style: string;
  count?: number; // 1–4, default 4
  vectorize?: boolean; // auto-vectorize PNG → SVG (default true)
  targetHeightMm?: number; // cieľová výška v mm (default 200)
}

interface LogoVariant {
  url: string; // data: URL alebo https URL (PNG preview)
  svgUrl?: string; // data: URL so SVG (ak bolo vektorizované)
  svgContent?: string; // raw SVG obsah
  type: 'svg' | 'png';
  provider: 'recraft' | 'openai';
  vectorized?: boolean;
  vectorizeMethod?: string;
  width?: number; // šírka v mm
  height?: number; // výška v mm
}

// ───────────────────────────────────────────────
// Prompt builders
// ───────────────────────────────────────────────

const STYLE_PROMPTS: Record<string, string> = {
  modern:
    'modern and clean, geometric shapes, professional look, minimalist lines, contemporary sans-serif typography',
  retro:
    'retro vintage style, classic serif typography, warm tones, nostalgic feel, art deco influences',
  minimal:
    'ultra minimalist, thin clean lines, maximum whitespace, one color, refined simplicity',
  luxury:
    'luxury premium brand, gold/metallic accent, elegant serif font, refined sophistication, high-end feel',
  playful:
    'playful and friendly, rounded shapes, vibrant colors, approachable, fun dynamic layout',
  industrial:
    'industrial strength, bold heavy sans-serif, strong angular shapes, technical precision, raw power',
  nature:
    'nature-inspired, organic flowing shapes, leaf/tree/water motifs, earthy natural tones',
};

function buildRecraftPrompt(name: string, style: string): string {
  const styleHint = STYLE_PROMPTS[style] || STYLE_PROMPTS.modern;
  return (
    `Professional business logo design for a company called "${name}". ` +
    `The logo MUST prominently feature the business name "${name}" as stylized text/lettering. ` +
    `Style: ${styleHint}. ` +
    `Design requirements: Clean vector logo suitable for illuminated outdoor signage and 3D printing. ` +
    `Bold readable lettering with a complementary icon/symbol element. ` +
    `Flat design, single color (black on white), no gradients, no photorealism, no shadows. ` +
    `High contrast, clear silhouette shapes that work well when extruded into 3D.`
  );
}

function buildOpenAIPrompt(name: string, style: string): string {
  const styleHint = STYLE_PROMPTS[style] || STYLE_PROMPTS.modern;
  return (
    `Create a professional business logo for "${name}". ` +
    `The logo MUST include the name "${name}" as the main element, designed as stylized lettering/typography. ` +
    `It can also include a small icon or symbol that relates to the business. ` +
    `Style: ${styleHint}. ` +
    `Design for illuminated outdoor signage and 3D printed letters. ` +
    `Requirements: Pure white background, black logo only, bold readable text, clean sharp edges, ` +
    `high contrast silhouette, no gradients, no shadows, no 3D effects, no photorealism. ` +
    `The shapes must be simple and bold enough to be cut from solid material.`
  );
}

// ───────────────────────────────────────────────
// Recraft V3 API – SVG výstup
// ───────────────────────────────────────────────

async function generateWithRecraft(
  prompt: string,
  count: number,
): Promise<LogoVariant[]> {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error('RECRAFT_API_KEY not set');

  const results: LogoVariant[] = [];

  for (let i = 0; i < count; i++) {
    try {
      // Pokus 1: SVG formát cez response_format
      const res = await fetch('https://external.api.recraft.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          style: 'icon',
          model: 'recraftv3',
          response_format: 'svg',
          size: '1024x1024',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // SVG response: data.data[0].url alebo data.data[0].b64_json
        const item = data.data?.[0];
        if (item) {
          if (item.url) {
            // Stiahnuť SVG obsah z URL
            try {
              const svgRes = await fetch(item.url);
              const svgText = await svgRes.text();
              if (svgText.includes('<svg')) {
                const b64 = Buffer.from(svgText).toString('base64');
                results.push({
                  url: `data:image/svg+xml;base64,${b64}`,
                  type: 'svg',
                  provider: 'recraft',
                });
                continue;
              }
            } catch {
              console.warn('Failed to fetch SVG from Recraft URL');
            }
          }
          if (item.b64_json) {
            const decoded = Buffer.from(item.b64_json, 'base64').toString('utf-8');
            if (decoded.includes('<svg')) {
              results.push({
                url: `data:image/svg+xml;base64,${item.b64_json}`,
                type: 'svg',
                provider: 'recraft',
              });
              continue;
            }
            // Nie je SVG → PNG
            results.push({
              url: `data:image/png;base64,${item.b64_json}`,
              type: 'png',
              provider: 'recraft',
            });
            continue;
          }
        }
      }

      // Pokus 2: Fallback na b64_json (PNG)
      const resPng = await fetch('https://external.api.recraft.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          style: 'icon',
          model: 'recraftv3',
          response_format: 'b64_json',
          size: '1024x1024',
        }),
      });

      if (resPng.ok) {
        const data = await resPng.json();
        const b64 = data.data?.[0]?.b64_json;
        if (b64) {
          // Detekovať SVG vs PNG
          try {
            const decoded = Buffer.from(b64, 'base64').toString('utf-8').substring(0, 200);
            if (decoded.trimStart().startsWith('<svg') || decoded.trimStart().startsWith('<?xml')) {
              results.push({ url: `data:image/svg+xml;base64,${b64}`, type: 'svg', provider: 'recraft' });
            } else {
              results.push({ url: `data:image/png;base64,${b64}`, type: 'png', provider: 'recraft' });
            }
          } catch {
            results.push({ url: `data:image/png;base64,${b64}`, type: 'png', provider: 'recraft' });
          }
        }
      } else {
        const errText = await resPng.text();
        console.error(`Recraft API error (${resPng.status}):`, errText);
      }
    } catch (err) {
      console.error(`Recraft variant ${i} failed:`, err);
    }
  }

  return results;
}

// ───────────────────────────────────────────────
// OpenAI Image API (gpt-image-1 alebo dall-e-3)
// ───────────────────────────────────────────────

async function generateWithOpenAI(
  prompt: string,
  count: number,
): Promise<LogoVariant[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const results: LogoVariant[] = [];

  // Zistiť aký model použiť
  const preferGptImage = process.env.OPENAI_IMAGE_MODEL !== 'dall-e-3';

  for (let i = 0; i < count; i++) {
    try {
      let data: { data?: Array<{ b64_json?: string; url?: string }> } | null = null;

      if (preferGptImage) {
        // Pokus: gpt-image-1 (novší model, lepšia kvalita)
        try {
          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-image-1',
              prompt,
              n: 1,
              size: '1024x1024',
              quality: 'medium',
              output_format: 'png',
            }),
          });

          if (res.ok) {
            data = await res.json();
          } else {
            console.warn(`gpt-image-1 failed (${res.status}), falling back to dall-e-3`);
          }
        } catch {
          console.warn('gpt-image-1 not available, using dall-e-3');
        }
      }

      // Fallback: DALL-E 3
      if (!data) {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1024x1024',
            quality: 'standard',
            response_format: 'b64_json',
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`OpenAI API error (${res.status}):`, errText);
          continue;
        }

        data = await res.json();
      }

      const item = data?.data?.[0];
      if (item?.b64_json) {
        results.push({
          url: `data:image/png;base64,${item.b64_json}`,
          type: 'png',
          provider: 'openai',
        });
      } else if (item?.url) {
        // Stiahnuť obrázok a konvertovať na data URL
        try {
          const imgRes = await fetch(item.url);
          const buffer = await imgRes.arrayBuffer();
          const b64 = Buffer.from(buffer).toString('base64');
          results.push({
            url: `data:image/png;base64,${b64}`,
            type: 'png',
            provider: 'openai',
          });
        } catch {
          // URL výstup (krátka platnosť, ale funguje na preview)
          results.push({ url: item.url, type: 'png', provider: 'openai' });
        }
      }
    } catch (err) {
      console.error(`OpenAI variant ${i} failed:`, err);
    }
  }

  return results;
}

// ───────────────────────────────────────────────
// PNG → SVG Vektorizácia (cez Python backend)
// ───────────────────────────────────────────────

async function vectorizePNG(
  pngBase64: string,
  targetHeightMm: number = 200,
): Promise<{ svg: string; width: number; height: number; method: string } | null> {
  try {
    const res = await fetch(`${STL_BACKEND}/vectorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: pngBase64,
        target_height_mm: targetHeightMm,
        threshold: 128,
        blur_radius: 1.0,
        simplify_tolerance: 1.0,
        min_area: 100,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[vectorize] Failed (${res.status}):`, errText);
      return null;
    }

    const data = await res.json();
    return {
      svg: data.svg,
      width: data.width,
      height: data.height,
      method: data.method,
    };
  } catch (err) {
    console.warn('[vectorize] Error:', err);
    return null;
  }
}

// ───────────────────────────────────────────────
// Route handler
// ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: GenerateRequest = await req.json();

    if (!body.businessName || body.businessName.trim().length < 1) {
      return NextResponse.json(
        { error: 'businessName is required' },
        { status: 400 },
      );
    }

    const name = body.businessName.trim();
    const style = body.style || 'modern';
    const count = Math.min(Math.max(body.count || 4, 1), 4);
    const shouldVectorize = body.vectorize !== false; // default true
    const targetHeightMm = body.targetHeightMm || 200;

    const hasRecraft = !!process.env.RECRAFT_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;

    let variants: LogoVariant[] = [];
    let usedProvider = '';

    // 1. Skús Recraft V3 (SVG je ideálne pre 3D extrúziu)
    if (hasRecraft) {
      try {
        const prompt = buildRecraftPrompt(name, style);
        variants = await generateWithRecraft(prompt, count);
        usedProvider = 'recraft';
        console.log(`[generate-logo] Recraft generated ${variants.length} variants`);
      } catch (err) {
        console.warn('Recraft failed, falling back to OpenAI:', err);
      }
    }

    // 2. Fallback: OpenAI (PNG → automatická vektorizácia na SVG)
    if (variants.length === 0 && hasOpenAI) {
      try {
        const prompt = buildOpenAIPrompt(name, style);
        variants = await generateWithOpenAI(prompt, count);
        usedProvider = 'openai';
        console.log(`[generate-logo] OpenAI generated ${variants.length} variants`);
      } catch (err) {
        console.error('OpenAI also failed:', err);
      }
    }

    // 3. Žiadne API kľúče
    if (!hasRecraft && !hasOpenAI) {
      return NextResponse.json(
        {
          error: 'no_api_keys',
          message:
            'Nie sú nakonfigurované API kľúče pre AI generovanie.\n' +
            'Nastavte RECRAFT_API_KEY alebo OPENAI_API_KEY v .env.local',
        },
        { status: 503 },
      );
    }

    if (variants.length === 0) {
      return NextResponse.json(
        { error: 'generation_failed', message: 'Generovanie zlyhalo. Skúste to znova.' },
        { status: 500 },
      );
    }

    // 4. Auto-vektorizácia PNG → SVG (paralelne)
    if (shouldVectorize) {
      const vectorizePromises = variants.map(async (variant) => {
        if (variant.type === 'png' && variant.url.startsWith('data:image/png;base64,')) {
          const pngBase64 = variant.url; // celý data URL
          console.log(`[generate-logo] Vectorizing PNG variant...`);

          const result = await vectorizePNG(pngBase64, targetHeightMm);
          if (result && result.svg) {
            const svgB64 = Buffer.from(result.svg).toString('base64');
            return {
              ...variant,
              svgUrl: `data:image/svg+xml;base64,${svgB64}`,
              svgContent: result.svg,
              type: 'svg' as const,
              vectorized: true,
              vectorizeMethod: result.method,
              width: result.width,
              height: result.height,
            };
          }
        }
        return variant;
      });

      variants = await Promise.all(vectorizePromises);

      const vectorizedCount = variants.filter((v) => v.vectorized).length;
      console.log(
        `[generate-logo] Vectorized ${vectorizedCount}/${variants.length} variants`,
      );
    }

    return NextResponse.json({
      variants,
      provider: usedProvider,
      count: variants.length,
    });
  } catch (err) {
    console.error('generate-logo error:', err);
    return NextResponse.json(
      { error: 'server_error', message: String(err) },
      { status: 500 },
    );
  }
}
