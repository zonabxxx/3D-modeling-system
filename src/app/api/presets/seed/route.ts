/**
 * POST /api/presets/seed – Vytvoriť predvolené presety
 * Volá sa jednorazovo pre naplnenie databázy.
 */

import { NextResponse } from 'next/server';
import db from '@/db';
import { manufacturingPresets } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_PRESETS = [
  // ──────────────────────────────────────────────────────────────
  // 1. Kanálové písmeno (bez LED)
  //    Klasické duté 3D písmeno. Čelo aj zadok sú integrálne.
  //    Žiadna drážka – nie je akrylát.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Kanálové písmeno (bez LED)',
    description: 'Klasické duté 3D písmeno s 2.5mm stenou, bez podsvietenia. Čelo aj zadok sú súčasťou korpusu. Ideálne pre dekoratívne nápisy.',
    lightingType: 'channel',
    isDefault: true,
    wallThickness: 2.5,           // Bočná stena – robustná
    faceThickness: 2.0,           // Plné čelo (integrálne)
    backPanelThickness: 2.0,      // Zadná stena
    faceIsSeparate: false,
    faceIsTranslucent: false,
    faceInset: 0,                 // Žiadne zapustenie
    backIsOpen: false,
    backStandoff: 0,
    externalWallRecess: 0,        // ❌ BEZ drážky – nie je akrylát!
    internalWallRecess: 0,
    acrylicThickness: 0,          // Žiadny akrylát
    acrylicClearance: 0,
    sortOrder: 0,
  },

  // ──────────────────────────────────────────────────────────────
  // 2. Kanálové písmeno s LED (front-lit)
  //    Duté písmeno, 2.5mm stena, opálový akrylát 3mm v drážke.
  //    Drážka = acrylicThickness (3mm) aby akrylát sedel zrovnajúco.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Kanálové písmeno s LED (front-lit)',
    description: 'Duté písmeno s drážkou pre 3mm opálový akrylát a LED podsvietením spredu. Drážka 3mm = akrylát sedí zapustený.',
    lightingType: 'channel_front',
    isDefault: true,
    wallThickness: 2.5,           // Hrubšia stena pre LED korpus
    faceThickness: 0,             // Čelo = akrylát (nie 3D tlač)
    backPanelThickness: 2.0,
    faceIsSeparate: true,         // Akrylát je oddelený diel
    faceIsTranslucent: true,      // Opálový/priesvitný
    faceInset: 3.0,               // Zapustenie = hrúbka akrylátu → sedí zrovnajúco
    backIsOpen: false,
    backStandoff: 0,
    externalWallRecess: 3.0,      // ✅ Drážka = acrylicThickness → akrylát sedí flush
    internalWallRecess: 0.5,      // Mierne zníženie vnútornej steny pre LED kabeláž
    acrylicThickness: 3.0,        // Štandard opálový akrylát
    acrylicClearance: 0.15,       // Presná vôľa pre 3D tlač
    ledModule: 'smd_2835_front',
    ledCavityDepth: 20,
    ledCavityOffset: 5,           // Offset od čela pre lepšie rozptýlenie svetla
    ventHoleDiameter: 2.5,
    ventHoleSpacing: 50,
    sortOrder: 1,
  },

  // ──────────────────────────────────────────────────────────────
  // 3. Front-lit (štandardný)
  //    Robustnejší korpus, hrubšie steny. Akrylát 3mm v drážke.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Front-lit (štandardný)',
    description: 'Štandardné podsvietenie spredu cez 3mm opálový akrylát. Hrubšie steny pre väčšiu stabilitu a exteriér.',
    lightingType: 'front',
    isDefault: true,
    wallThickness: 2.5,
    faceThickness: 0,             // Čelo = akrylát
    backPanelThickness: 2.5,      // Hrubší zadok
    faceIsSeparate: true,
    faceIsTranslucent: true,
    faceInset: 3.0,               // ✅ = acrylicThickness
    backIsOpen: false,
    externalWallRecess: 3.0,      // ✅ = acrylicThickness
    internalWallRecess: 0.5,
    acrylicThickness: 3.0,
    acrylicClearance: 0.15,
    ledModule: 'smd_2835_front',
    ledCavityDepth: 25,
    ledCavityOffset: 5,
    ventHoleDiameter: 3.0,
    ventHoleSpacing: 60,
    sortOrder: 2,
  },

  // ──────────────────────────────────────────────────────────────
  // 4. Halo (zadné podsvietenie)
  //    Otvorený zadok, nepriesvitné čelo, svetlo ide dozadu.
  //    Žiadna drážka – čelo je integrálne.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Halo (zadné podsvietenie)',
    description: 'Podsvietenie zozadu – svätožiara efekt. Otvorený zadok, nepriesvitné hrubé čelo, dištanc 40mm od steny.',
    lightingType: 'halo',
    isDefault: true,
    wallThickness: 2.5,
    faceThickness: 3.0,           // Hrubšie nepriesvitné čelo
    backPanelThickness: 0,        // Otvorený zadok
    faceIsSeparate: false,        // Čelo = integrálne
    faceIsTranslucent: false,     // Nepriesvitné
    faceInset: 0,
    backIsOpen: true,
    backStandoff: 40,             // Dištanc pre halo efekt
    externalWallRecess: 0,        // Žiadna drážka
    internalWallRecess: 0,
    acrylicThickness: 0,          // Žiadny akrylát
    acrylicClearance: 0,
    ledModule: 'smd_2835_halo',
    ledCavityDepth: 15,
    ledCavityOffset: 0,
    standoffLength: 40,
    sortOrder: 3,
  },

  // ──────────────────────────────────────────────────────────────
  // 5. Front + Halo (kombinácia)
  //    Akrylát spredu (3mm v drážke) + otvorený zadok s dištancom.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Front + Halo (kombinácia)',
    description: 'Kombinácia predného (akrylát 3mm) a zadného podsvietenia (dištanc 40mm). Maximálny vizuálny efekt.',
    lightingType: 'front_halo',
    isDefault: true,
    wallThickness: 2.5,
    faceThickness: 0,             // Čelo = akrylát
    backPanelThickness: 0,        // Otvorený zadok (halo)
    faceIsSeparate: true,
    faceIsTranslucent: true,
    faceInset: 3.0,               // ✅ = acrylicThickness
    backIsOpen: true,
    backStandoff: 40,
    externalWallRecess: 3.0,      // ✅ = acrylicThickness
    internalWallRecess: 0.5,
    acrylicThickness: 3.0,
    acrylicClearance: 0.15,
    ledModule: 'smd_2835_front',
    ledCavityDepth: 25,
    ledCavityOffset: 5,
    standoffLength: 40,
    ventHoleDiameter: 3.0,
    ventHoleSpacing: 80,
    sortOrder: 4,
  },

  // ──────────────────────────────────────────────────────────────
  // 6. Plné 3D písmeno
  //    Masívne, bez dutiny. Interiérové dekoratívne nápisy.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Plné 3D písmeno',
    description: 'Masívne plné písmeno bez dutiny. Pre dekoratívne interiérové nápisy. Nie je duté – celý objem je vyplnený.',
    lightingType: 'none',
    isDefault: true,
    wallThickness: 3.0,
    faceThickness: 3.0,
    backPanelThickness: 3.0,
    faceIsSeparate: false,
    faceIsTranslucent: false,
    faceInset: 0,
    backIsOpen: false,
    externalWallRecess: 0,
    internalWallRecess: 0,
    acrylicThickness: 0,
    acrylicClearance: 0,
    sortOrder: 5,
  },

  // ──────────────────────────────────────────────────────────────
  // 7. Akrylátové písmeno (presné zasadenie)
  //    Korpus s presnou drážkou 3mm, vnútorná drážka 1mm,
  //    akrylát 3mm s vôľou 0.15mm. Referenčný preset.
  // ──────────────────────────────────────────────────────────────
  {
    name: 'Akrylátové písmeno (fit)',
    description: 'Korpus s presnou drážkou pre 3mm akrylátové čelo. Vonkajšia drážka 3mm + vnútorná 1mm. Referenčný preset pre presné zasadenie.',
    lightingType: 'front',
    isDefault: false,
    wallThickness: 3.0,
    faceThickness: 0,             // Čelo = akrylát
    backPanelThickness: 2.0,
    faceIsSeparate: true,
    faceIsTranslucent: true,
    faceInset: 3.0,               // = acrylicThickness
    backIsOpen: false,
    externalWallRecess: 3.0,      // = acrylicThickness
    internalWallRecess: 1.0,      // Extra priestor za akrylátom
    acrylicThickness: 3.0,
    acrylicClearance: 0.15,
    ledModule: 'smd_2835_front',
    ledCavityDepth: 30,
    ledCavityOffset: 5,
    ventHoleDiameter: 3.0,
    ventHoleSpacing: 50,
    sortOrder: 6,
  },
];

export async function POST() {
  try {
    const now = new Date();
    let created = 0;

    for (const preset of DEFAULT_PRESETS) {
      const id = uuidv4();
      // Určiť či preset potrebuje vnútorné výstuhy (LED presety áno)
      const hasLED = !!(preset.ledModule);
      
      db.insert(manufacturingPresets)
        .values({
          id,
          ...preset,
          wallHeight: 0,
          wallOffset: 0,
          bottomThickness: preset.backPanelThickness || 2.0,
          baseThickness: 0,
          ledModule: preset.ledModule || '',
          ledCavityDepth: preset.ledCavityDepth || 0,
          ledCavityOffset: preset.ledCavityOffset || 0,
          ledBaseThickness: hasLED ? 1.0 : 0,   // LED základňa 1mm pre LED presety
          innerLining: hasLED ? 0.5 : 0,         // Vnútorné lemovanie pre LED
          internalWalls: hasLED,                   // Výstuhy pre LED presety
          ribSpacing: hasLED ? 100 : 120,          // Hustejšie pre LED
          minRibSize: hasLED ? 150 : 200,
          ribThickness: 2.0,
          mountingHoleDiameter: 5.0,               // M5
          mountingHoleSpacing: 150,
          mountingTabSize: 15,
          standoffLength: preset.standoffLength || 25,
          ventHoleDiameter: preset.ventHoleDiameter || 0,
          ventHoleSpacing: preset.ventHoleSpacing || 0,
          maxSinglePiece: 400,
          connectorType: 'mortise_tenon',
          connectorDepth: 8,
          connectorTolerance: 0.2,
          geometryPrecision: 16,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      created++;
    }

    return NextResponse.json({
      success: true,
      message: `Vytvorených ${created} predvolených presetov`,
      count: created,
    });
  } catch (err) {
    console.error('Error seeding presets:', err);
    return NextResponse.json(
      { error: 'Failed to seed presets', message: String(err) },
      { status: 500 },
    );
  }
}
