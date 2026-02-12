/**
 * POST /api/generate-stl
 *
 * Proxy pre CadQuery microservice (stl-generator na porte 8000).
 * Preposiela request a vracia výsledok + download URL.
 *
 * Body: { text, fontFamily, letterHeightMm, depthMm, lightingType, material, ... }
 * Response: { jobId, downloadUrl, totalParts, totalWeightG, letters, ... }
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { manufacturingPresets } from '@/db/schema';
import { eq } from 'drizzle-orm';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

// Mapovanie fontov z konfigurátora na cesty k TTF súborom
// Cesta je relatívna k stl-generator/ adresáru (Python server ich resoluje cez STL_GENERATOR_ROOT)
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

interface GenerateSTLBody {
  text: string;
  fontFamily?: string;
  letterHeightMm?: number;
  depthMm?: number;
  lightingType?: string;
  material?: string;
  letterSpacingMm?: number;
  profileType?: string;
  svgContent?: string | null;
  presetId?: string | null;       // ID výrobného presetu z DB
  wallThicknessMm?: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateSTLBody = await req.json();

    if (!body.text && !body.svgContent) {
      return NextResponse.json(
        { error: 'Text alebo SVG obsah je povinný' },
        { status: 400 },
      );
    }

    // SVG-based flow: frontend konvertuje text→SVG, backend iba extruduje
    // Font mapping sa použije len ako fallback ak nie je SVG
    const fontPath =
      FONT_MAP[body.fontFamily || 'Roboto'] ||
      'fonts/Roboto-Bold.ttf';

    // Ak je zadaný presetId, načítať preset z DB
    let presetOverrides: Record<string, unknown> = {};
    if (body.presetId) {
      try {
        const preset = db
          .select()
          .from(manufacturingPresets)
          .where(eq(manufacturingPresets.id, body.presetId))
          .get();

        if (preset) {
          presetOverrides = {
            wall_thickness_mm: preset.wallThickness,
            face_thickness_mm: preset.faceThickness,
            back_panel_thickness_mm: preset.backPanelThickness,
            face_is_separate: preset.faceIsSeparate,
            face_is_translucent: preset.faceIsTranslucent,
            face_inset_mm: preset.faceInset,
            back_is_open: preset.backIsOpen,
            back_standoff_mm: preset.backStandoff,
            external_wall_recess_mm: preset.externalWallRecess,
            internal_wall_recess_mm: preset.internalWallRecess,
            acrylic_thickness_mm: preset.acrylicThickness,
            acrylic_clearance_mm: preset.acrylicClearance,
            bottom_thickness_mm: preset.bottomThickness,
            led_module: preset.ledModule || undefined,
            led_cavity_depth_mm: preset.ledCavityDepth,
            led_cavity_offset_mm: preset.ledCavityOffset,
            led_base_thickness_mm: preset.ledBaseThickness,
            internal_walls: preset.internalWalls,
            inner_lining_mm: preset.innerLining,
            mounting_hole_diameter_mm: preset.mountingHoleDiameter,
            mounting_hole_spacing_mm: preset.mountingHoleSpacing,
            mounting_tab_size_mm: preset.mountingTabSize,
            standoff_length_mm: preset.standoffLength,
            vent_hole_diameter_mm: preset.ventHoleDiameter,
            vent_hole_spacing_mm: preset.ventHoleSpacing,
            max_single_piece_mm: preset.maxSinglePiece,
            rib_spacing_mm: preset.ribSpacing,
            rib_thickness_mm: preset.ribThickness,
            geometry_precision: preset.geometryPrecision,
            // Ak preset má lightingType, použiť ho
            ...(preset.lightingType ? { lighting_type: preset.lightingType } : {}),
          };
        }
      } catch (err) {
        console.warn('Failed to load preset:', err);
      }
    }

    // Preposlať na CadQuery microservice
    const serviceReq = {
      text: body.text || '',
      font_path: fontPath,
      letter_height_mm: body.letterHeightMm || 200,
      depth_mm: body.depthMm || 50,
      lighting_type: body.lightingType || 'front',
      material: body.material || 'asa',
      letter_spacing_mm: body.letterSpacingMm || 10,
      profile_type: body.profileType || 'flat',
      svg_content: body.svgContent || null,
      wall_thickness_mm: body.wallThicknessMm || null,
      // Preset overrides – Python service ich spracuje
      ...presetOverrides,
    };

    const res = await fetch(`${STL_SERVICE_URL}/generate-stl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serviceReq),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
      return NextResponse.json(
        {
          error: 'stl_generation_failed',
          message: errData.detail || 'STL generovanie zlyhalo',
        },
        { status: res.status },
      );
    }

    const data = await res.json();

    // Preloziť download URL cez náš proxy
    return NextResponse.json({
      jobId: data.job_id,
      downloadUrl: `/api/generate-stl/download?jobId=${data.job_id}`,
      directUrl: `${STL_SERVICE_URL}${data.download_url}`,
      totalParts: data.total_parts,
      totalWeightG: data.total_weight_g,
      totalLedCount: data.total_led_count,
      lightingType: data.lighting_type,
      material: data.material,
      letters: data.letters,
    });
  } catch (err) {
    console.error('generate-stl proxy error:', err);

    // Ak CadQuery service nebeží
    const isConnErr =
      err instanceof Error &&
      (err.message.includes('ECONNREFUSED') ||
        err.message.includes('fetch failed'));

    if (isConnErr) {
      return NextResponse.json(
        {
          error: 'service_unavailable',
          message:
            'STL generátor nie je spustený. Spustite: cd stl-generator && docker compose up',
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: 'server_error', message: String(err) },
      { status: 500 },
    );
  }
}
