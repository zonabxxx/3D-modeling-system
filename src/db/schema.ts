import {
  sqliteTable,
  text,
  integer,
  real,
} from 'drizzle-orm/sqlite-core';

// ==========================================
// KONFIGURÁCIE NÁPISOV
// ==========================================

export const signConfigurations = sqliteTable('sign_configurations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  clientEmail: text('client_email'),
  clientName: text('client_name'),
  clientPhone: text('client_phone'),
  status: text('status').notNull().default('draft'),
  // draft | preview | ordered | manufacturing | completed

  // Fotka fasády
  photoUrl: text('photo_url').notNull(),
  photoWidth: integer('photo_width').notNull(),
  photoHeight: integer('photo_height').notNull(),

  // Plocha označenia (4 body v px) - JSON: [{x,y},{x,y},{x,y},{x,y}]
  surfacePoints: text('surface_points', { mode: 'json' }),

  // Mierka
  scaleRefPoint1: text('scale_ref_point1', { mode: 'json' }), // {x,y}
  scaleRefPoint2: text('scale_ref_point2', { mode: 'json' }), // {x,y}
  scaleRefRealMm: real('scale_ref_real_mm'),
  scaleFactorPxToMm: real('scale_factor_px_to_mm'),

  // Typ obsahu: text_only | logo_only | text_and_logo
  contentType: text('content_type').notNull().default('text_only'),

  // Text konfigurácia
  signText: text('sign_text').notNull().default(''),
  fontFamily: text('font_family').notNull().default('Montserrat'),
  fontId: text('font_id').references(() => signFonts.id),

  // Logo konfigurácia
  logoSourceType: text('logo_source_type'), // svg | raster
  logoUrl: text('logo_url'), // URL nahraného SVG/raster súboru
  logoSvgContent: text('logo_svg_content'), // raw SVG XML (pre SVG logá)
  logoOriginalWidth: real('logo_original_width'),
  logoOriginalHeight: real('logo_original_height'),
  logoExtrudeAsRelief: integer('logo_extrude_as_relief', { mode: 'boolean' }).default(false),
  logoReliefDepthMm: real('logo_relief_depth_mm').default(5),
  logoPlacement: text('logo_placement').default('above_text'),
  // above_text | below_text | left_of_text | right_of_text | standalone | behind_text
  logoWidthMm: real('logo_width_mm'),
  logoHeightMm: real('logo_height_mm'),
  logoScale: real('logo_scale').default(1),
  logoOffsetX: real('logo_offset_x').default(0),
  logoOffsetY: real('logo_offset_y').default(0),

  // 3D profil
  profileType: text('profile_type').notNull().default('flat'),
  // flat | rounded | chamfer
  profileId: text('profile_id').references(() => signProfiles.id),
  depthMm: real('depth_mm').notNull().default(50),

  // Farby
  faceColor: text('face_color').notNull().default('#FFFFFF'),
  sideColor: text('side_color').notNull().default('#FFFFFF'),
  faceRal: text('face_ral'),
  sideRal: text('side_ral'),

  // Podsvietenie
  lightingType: text('lighting_type').notNull().default('none'),
  // none | front | halo | front_halo
  lightingId: text('lighting_id').references(() => signLightingOptions.id),
  ledColor: text('led_color').default('warm_white'),
  // warm_white | cool_white | rgb

  // Vypočítané rozmery
  totalWidthMm: real('total_width_mm'),
  letterHeightMm: real('letter_height_mm'),
  letterCount: integer('letter_count'),

  // Pozícia na fasáde (normalizované 0-1)
  positionX: real('position_x'),
  positionY: real('position_y'),
  positionScale: real('position_scale').default(1),

  // Vizualizácia
  previewImageUrl: text('preview_image_url'),
  previewSceneData: text('preview_scene_data', { mode: 'json' }),

  // Objednávka
  orderType: text('order_type'),
  // production_only | production_and_installation
  installationAddress: text('installation_address'),
  installationNotes: text('installation_notes'),

  // Prepojenie na business-flow-ai
  externalOrderId: text('external_order_id'),
  externalCalcId: text('external_calc_id'),

  // Cena
  calculatedPrice: real('calculated_price'),
  priceBreakdown: text('price_breakdown', { mode: 'json' }),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ==========================================
// FONTY
// ==========================================

export const signFonts = sqliteTable('sign_fonts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // "Montserrat Bold"
  displayName: text('display_name').notNull(), // "Montserrat (tučné)"
  family: text('family').notNull(), // "Montserrat"
  weight: text('weight').notNull().default('700'),
  fileUrl: text('file_url').notNull(), // /fonts/montserrat-bold.ttf
  previewUrl: text('preview_url'),
  isExtrusionSafe: integer('is_extrusion_safe', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
  minRecommendedMm: real('min_recommended_mm').default(50),
  sortOrder: integer('sort_order').default(0),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ==========================================
// 3D PROFILY
// ==========================================

export const signProfiles = sqliteTable('sign_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // "flat", "rounded", "chamfer"
  displayName: text('display_name').notNull(),
  description: text('description'),
  previewImageUrl: text('preview_image_url'),
  // Three.js ExtrudeGeometry settings as JSON
  extrudeSettings: text('extrude_settings', { mode: 'json' }),
  priceMultiplier: real('price_multiplier').default(1.0),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
  sortOrder: integer('sort_order').default(0),
});

// ==========================================
// TYPY PODSVIETENIA
// ==========================================

export const signLightingOptions = sqliteTable('sign_lighting_options', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // none | front | halo | front_halo
  displayName: text('display_name').notNull(),
  description: text('description'),
  previewImageUrl: text('preview_image_url'),
  pricePerLetterEur: real('price_per_letter_eur').default(0),
  priceFixedEur: real('price_fixed_eur').default(0),
  // Requirements JSON: { minDepthMm, needsOpalFace, ... }
  requirements: text('requirements', { mode: 'json' }),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
  sortOrder: integer('sort_order').default(0),
});

// ==========================================
// RAL FARBY
// ==========================================

export const signColors = sqliteTable('sign_colors', {
  id: text('id').primaryKey(),
  ralCode: text('ral_code'), // "RAL 9003"
  name: text('name').notNull(), // "Signálna biela"
  hexColor: text('hex_color').notNull(), // "#F4F4F4"
  category: text('category').default('standard'),
  // standard | metallic | custom
  priceMultiplier: real('price_multiplier').default(1.0),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
  sortOrder: integer('sort_order').default(0),
});

// ==========================================
// VÝROBNÉ PRAVIDLÁ
// ==========================================

export const manufacturingRules = sqliteTable('manufacturing_rules', {
  id: text('id').primaryKey(),
  ruleName: text('rule_name').notNull(),
  ruleType: text('rule_type').notNull(),
  // min_size | max_size | min_wall | segmentation | material | led
  parameters: text('parameters', { mode: 'json' }),
  errorMessage: text('error_message').notNull(),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
});

// ==========================================
// CENOVÉ PRAVIDLÁ
// ==========================================

export const pricingRules = sqliteTable('pricing_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  ruleType: text('rule_type').notNull(),
  // per_letter | per_area | fixed | multiplier
  conditions: text('conditions', { mode: 'json' }),
  // { minHeightMm, maxHeightMm, profileType, lightingType }
  priceValue: real('price_value').notNull(),
  unit: text('unit'),
  // eur_per_letter | eur_per_m2 | multiplier
  priority: integer('priority').default(0),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
});

// ==========================================
// VÝROBNÉ PRESETY (Manufacturing Presets)
// ==========================================
// Ukladajú kompletné nastavenia pre generovanie STL
// Inšpirované LetraMaker PRO parametrami

export const manufacturingPresets = sqliteTable('manufacturing_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),                     // "Kanálové písmeno s LED"
  description: text('description'),                  // Popis presetu
  lightingType: text('lighting_type').notNull(),      // none | front | halo | front_halo | channel | channel_front
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),

  // ── Rozmery stien (Wall) ──
  wallThickness: real('wall_thickness').notNull().default(2.0),       // mm – hrúbka bočných stien
  wallHeight: real('wall_height').default(0),                         // mm – výška steny (0 = plná hĺbka)
  wallOffset: real('wall_offset').default(0),                         // mm – odsadenie steny od obrysu

  // ── Drážky / Recess (kľúčové pre plexi) ──
  externalWallRecess: real('external_wall_recess').default(0),        // mm – drážka na vonkajšej stene pre plexi (0-50)
  internalWallRecess: real('internal_wall_recess').default(0),        // mm – zníženie vnútornej steny (0-max)

  // ── Čelo (Face / Acrylic) ──
  faceThickness: real('face_thickness').notNull().default(2.0),       // mm – hrúbka predného čela
  faceIsSeparate: integer('face_is_separate', { mode: 'boolean' }).default(false),
  faceIsTranslucent: integer('face_is_translucent', { mode: 'boolean' }).default(false),
  faceInset: real('face_inset').default(0),                           // mm – zapustenie čela do korpusu

  // ── Akrylát / Plexi parametre ──
  acrylicThickness: real('acrylic_thickness').default(3.0),           // mm – hrúbka akrylátového čela
  acrylicClearance: real('acrylic_clearance').default(0.15),          // mm – vôľa medzi akrylátom a korpusom (krok 0.05)

  // ── Zadný panel (Back) ──
  backPanelThickness: real('back_panel_thickness').notNull().default(2.0),
  backIsOpen: integer('back_is_open', { mode: 'boolean' }).default(false),
  backStandoff: real('back_standoff').default(0),                     // mm – dištanc od steny

  // ── Dno / Základňa ──
  bottomThickness: real('bottom_thickness').default(2.0),             // mm – hrúbka dna
  baseThickness: real('base_thickness').default(0),                   // mm – hrúbka montážnej základne

  // ── LED priestor ──
  ledModule: text('led_module').default(''),                          // typ LED modulu
  ledCavityDepth: real('led_cavity_depth').default(0),                // mm – hĺbka dutiny pre LED
  ledCavityOffset: real('led_cavity_offset').default(0),              // mm – offset od čela
  ledBaseThickness: real('led_base_thickness').default(0),            // mm – základňa pre LED modul

  // ── Vnútorné výstuhy ──
  innerLining: real('inner_lining').default(0),                       // mm – vnútorné lemovanie
  internalWalls: integer('internal_walls', { mode: 'boolean' }).default(false),
  ribSpacing: real('rib_spacing').default(120),                       // mm – rozstup výstuh
  minRibSize: real('min_rib_size').default(200),                      // mm – min veľkosť pre výstuhy
  ribThickness: real('rib_thickness').default(2.0),                   // mm – hrúbka výstuh

  // ── Montáž ──
  mountingHoleDiameter: real('mounting_hole_diameter').default(5.0),  // mm (M4/M5)
  mountingHoleSpacing: real('mounting_hole_spacing').default(150),    // mm
  mountingTabSize: real('mounting_tab_size').default(15),              // mm
  standoffLength: real('standoff_length').default(25),                // mm

  // ── Vetranie ──
  ventHoleDiameter: real('vent_hole_diameter').default(0),            // mm
  ventHoleSpacing: real('vent_hole_spacing').default(0),              // mm

  // ── Segmentácia ──
  maxSinglePiece: real('max_single_piece').default(400),              // mm
  connectorType: text('connector_type').default('mortise_tenon'),     // mortise_tenon | pin | tongue_groove
  connectorDepth: real('connector_depth').default(8),                 // mm
  connectorTolerance: real('connector_tolerance').default(0.2),       // mm

  // ── Geometria ──
  geometryPrecision: integer('geometry_precision').default(16),       // subdivízie kriviek

  // ── Metadáta ──
  sortOrder: integer('sort_order').default(0),
  isActive: integer('is_active', { mode: 'boolean' })
    .$defaultFn(() => true)
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
});
