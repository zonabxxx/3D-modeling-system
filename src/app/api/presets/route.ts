/**
 * GET /api/presets – Zoznam všetkých výrobných presetov
 * POST /api/presets – Vytvorenie nového presetu
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { manufacturingPresets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
  try {
    const presets = db
      .select()
      .from(manufacturingPresets)
      .orderBy(manufacturingPresets.sortOrder)
      .all();

    return NextResponse.json({ presets });
  } catch (err) {
    console.error('Error fetching presets:', err);
    return NextResponse.json(
      { error: 'Failed to fetch presets', message: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const id = uuidv4();
    const now = new Date();

    db.insert(manufacturingPresets)
      .values({
        id,
        name: body.name || 'Nový preset',
        description: body.description || '',
        lightingType: body.lightingType || 'none',
        isDefault: body.isDefault || false,

        // Steny
        wallThickness: body.wallThickness ?? 2.0,
        wallHeight: body.wallHeight ?? 0,
        wallOffset: body.wallOffset ?? 0,

        // Drážky
        externalWallRecess: body.externalWallRecess ?? 0,
        internalWallRecess: body.internalWallRecess ?? 0,

        // Čelo
        faceThickness: body.faceThickness ?? 2.0,
        faceIsSeparate: body.faceIsSeparate ?? false,
        faceIsTranslucent: body.faceIsTranslucent ?? false,
        faceInset: body.faceInset ?? 0,

        // Akrylát
        acrylicThickness: body.acrylicThickness ?? 3.0,
        acrylicClearance: body.acrylicClearance ?? 0.15,

        // Zadný panel
        backPanelThickness: body.backPanelThickness ?? 2.0,
        backIsOpen: body.backIsOpen ?? false,
        backStandoff: body.backStandoff ?? 0,

        // Dno
        bottomThickness: body.bottomThickness ?? 2.0,
        baseThickness: body.baseThickness ?? 0,

        // LED
        ledModule: body.ledModule || '',
        ledCavityDepth: body.ledCavityDepth ?? 0,
        ledCavityOffset: body.ledCavityOffset ?? 0,
        ledBaseThickness: body.ledBaseThickness ?? 0,

        // Výstuhy
        innerLining: body.innerLining ?? 0,
        internalWalls: body.internalWalls ?? false,
        ribSpacing: body.ribSpacing ?? 120,
        minRibSize: body.minRibSize ?? 200,
        ribThickness: body.ribThickness ?? 2.0,

        // Montáž
        mountingHoleDiameter: body.mountingHoleDiameter ?? 5.0,
        mountingHoleSpacing: body.mountingHoleSpacing ?? 150,
        mountingTabSize: body.mountingTabSize ?? 15,
        standoffLength: body.standoffLength ?? 25,

        // Vetranie
        ventHoleDiameter: body.ventHoleDiameter ?? 0,
        ventHoleSpacing: body.ventHoleSpacing ?? 0,

        // Segmentácia
        maxSinglePiece: body.maxSinglePiece ?? 400,
        connectorType: body.connectorType || 'mortise_tenon',
        connectorDepth: body.connectorDepth ?? 8,
        connectorTolerance: body.connectorTolerance ?? 0.2,

        // Geometria
        geometryPrecision: body.geometryPrecision ?? 16,

        sortOrder: body.sortOrder ?? 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Fetch the created preset
    const created = db
      .select()
      .from(manufacturingPresets)
      .where(eq(manufacturingPresets.id, id))
      .get();

    return NextResponse.json({ preset: created }, { status: 201 });
  } catch (err) {
    console.error('Error creating preset:', err);
    return NextResponse.json(
      { error: 'Failed to create preset', message: String(err) },
      { status: 500 },
    );
  }
}
