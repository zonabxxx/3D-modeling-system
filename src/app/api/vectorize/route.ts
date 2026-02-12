/**
 * POST /api/vectorize
 *
 * Proxy pre Python backend /vectorize endpoint.
 * Konvertuje PNG obrázok na SVG vektorovú grafiku.
 *
 * Body: { imageBase64: string, targetHeightMm?: number, threshold?: number, ... }
 * Response: { svg: string, width: number, height: number, contourCount: number, method: string }
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_BACKEND = process.env.STL_BACKEND_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.imageBase64) {
      return NextResponse.json(
        { error: 'imageBase64 is required' },
        { status: 400 },
      );
    }

    const res = await fetch(`${STL_BACKEND}/vectorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: body.imageBase64,
        target_height_mm: body.targetHeightMm ?? 200,
        threshold: body.threshold ?? 128,
        invert: body.invert ?? false,
        blur_radius: body.blurRadius ?? 1.0,
        simplify_tolerance: body.simplifyTolerance ?? 1.0,
        min_area: body.minArea ?? 100,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[vectorize] Backend error (${res.status}):`, errText);
      return NextResponse.json(
        { error: 'vectorization_failed', message: errText },
        { status: res.status },
      );
    }

    const data = await res.json();

    return NextResponse.json({
      svg: data.svg,
      width: data.width,
      height: data.height,
      contourCount: data.contour_count,
      method: data.method,
    });
  } catch (err) {
    console.error('[vectorize] Error:', err);
    return NextResponse.json(
      { error: 'server_error', message: String(err) },
      { status: 500 },
    );
  }
}
