/**
 * GET /api/presets/[id]    – Jeden preset
 * PUT /api/presets/[id]    – Aktualizovať preset
 * DELETE /api/presets/[id] – Vymazať preset
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { manufacturingPresets } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const preset = db
      .select()
      .from(manufacturingPresets)
      .where(eq(manufacturingPresets.id, id))
      .get();

    if (!preset) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ preset });
  } catch (err) {
    console.error('Error fetching preset:', err);
    return NextResponse.json(
      { error: 'Failed to fetch preset', message: String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await req.json();

    // Check if preset exists
    const existing = db
      .select()
      .from(manufacturingPresets)
      .where(eq(manufacturingPresets.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 },
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    const fields = [
      'name', 'description', 'lightingType', 'isDefault',
      'wallThickness', 'wallHeight', 'wallOffset',
      'externalWallRecess', 'internalWallRecess',
      'faceThickness', 'faceIsSeparate', 'faceIsTranslucent', 'faceInset',
      'acrylicThickness', 'acrylicClearance',
      'backPanelThickness', 'backIsOpen', 'backStandoff',
      'bottomThickness', 'baseThickness',
      'ledModule', 'ledCavityDepth', 'ledCavityOffset', 'ledBaseThickness',
      'innerLining', 'internalWalls', 'ribSpacing', 'minRibSize', 'ribThickness',
      'mountingHoleDiameter', 'mountingHoleSpacing', 'mountingTabSize', 'standoffLength',
      'ventHoleDiameter', 'ventHoleSpacing',
      'maxSinglePiece', 'connectorType', 'connectorDepth', 'connectorTolerance',
      'geometryPrecision', 'sortOrder', 'isActive',
    ];

    for (const field of fields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    db.update(manufacturingPresets)
      .set(updateData)
      .where(eq(manufacturingPresets.id, id))
      .run();

    // Fetch updated preset
    const updated = db
      .select()
      .from(manufacturingPresets)
      .where(eq(manufacturingPresets.id, id))
      .get();

    return NextResponse.json({ preset: updated });
  } catch (err) {
    console.error('Error updating preset:', err);
    return NextResponse.json(
      { error: 'Failed to update preset', message: String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const existing = db
      .select()
      .from(manufacturingPresets)
      .where(eq(manufacturingPresets.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 },
      );
    }

    db.delete(manufacturingPresets)
      .where(eq(manufacturingPresets.id, id))
      .run();

    return NextResponse.json({ success: true, deleted: id });
  } catch (err) {
    console.error('Error deleting preset:', err);
    return NextResponse.json(
      { error: 'Failed to delete preset', message: String(err) },
      { status: 500 },
    );
  }
}
