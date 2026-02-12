# 3D Konfigurátor Svetelných Reklám – Technický Návrh

## 📋 Obsah
1. [Prehľad produktu](#1-prehľad-produktu)
2. [Zákaznícky flow](#2-zákaznícky-flow)
3. [Architektúra systému](#3-architektúra-systému)
4. [Technologický stack](#4-technologický-stack)
5. [Databázová schéma](#5-databázová-schéma)
6. [API endpointy](#6-api-endpointy)
7. [Frontend architektúra](#7-frontend-architektúra)
8. [3D Pipeline](#8-3d-pipeline)
9. [Cenový model](#9-cenový-model)
10. [Výrobné pravidlá](#10-výrobné-pravidlá)
11. [Integrácia s business-flow-ai](#11-integrácia-s-business-flow-ai)
12. [Etapy implementácie](#12-etapy-implementácie)

---

## 1. Prehľad produktu

**Produkt:** "Navrhni si svetelnú reklamu z fotky prevádzky → okamžitý 3D náhľad → objednávka"

**Dva oddelené piliere:**
1. **Vizuálny návrh a náhľad** – to, čo vidí klient (interaktívny web konfigurátor)
2. **Technická výroba** – STL generovanie, parametre, montáž (backend + export)

**Standalone projekt** – beží nezávisle, komunikuje s business-flow-ai cez REST API pre objednávky.

---

## 2. Zákaznícky flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  A. Upload   │───▶│  B. Text &   │───▶│ C. Mierka &  │───▶│  D. 3D       │───▶│ E. Objednávka│
│    fotky     │    │    štýl      │    │   rozmer     │    │   náhľad     │    │   & cena     │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

### Krok A – Upload fotky fasády
- Klient nahrá 1–3 fotky (mobilom alebo PC)
- Max 10 MB/fotka, formáty: JPG, PNG, HEIC (auto-konverzia)
- V UI označí miesto nápisu: **klikne 4 rohy** → obdĺžniková plocha
- Canvas editor (fabric.js alebo custom) s drag & pinch-to-zoom na mobile

### Krok B – Obsah: Text, Logo alebo oboje
Klient si vyberie typ obsahu:
- **Iba text** – 3D písmená z textu
- **Iba logo** – nahraté logo (SVG → 3D extrúzia, alebo raster → reliéf)
- **Text + Logo** – kombinácia (logo nad/pod/vedľa textu)

#### Text konfigurácia
- **Text:** názov prevádzky (max 50 znakov)
- **Font:** 10–20 overených fontov (bezpečné pre extrúziu, bez tenkých serif)
  - Predvolené: Montserrat Bold, Bebas Neue, Oswald, Poppins Black, Roboto Bold...

#### Logo konfigurácia
- **SVG logo (odporúčané):** nahraný SVG súbor → parsovanie `<path>`, `<rect>`, `<circle>`, `<polygon>` → Three.js Shapes → plná 3D extrúzia
- **Raster logo (PNG/JPG):** nahraný obrázok → flat 3D panel s textúrou (reliéf) alebo automatická vektorizácia (budúcnosť)
- **Pozícia voči textu:** nad textom | pod textom | naľavo | napravo | za textom (pozadie)
- **Veľkosť:** škálovanie 10%–300%
- **3D metóda:**
  - Plná 3D extrúzia (len SVG) – vektorové tvary extrudované do 3D rovnako ako písmená
  - Reliéf / doska – flat panel s logom (vhodné pre rastre alebo jednoduché logá)
  - Hĺbka reliéfu: 2–30 mm (nastaviteľné)

#### Spoločné nastavenia
- **3D profil:** flat (rovný) | rounded (zaoblený) | chamfer (skosený)
- **Hrúbka:** 30mm | 50mm | 80mm | 100mm | 150mm (predvoľby)
- **Farba čela:** RAL výber (biela, čierna, červená, modrá, zlatá, striebro + custom RAL)
- **Farba bočnice:** rovnaká / iná RAL
- **Podsvit:** bez podsvitu | predné svietenie (front-lit) | halo (zadné) | front+halo

### Krok C – Škálovanie na reálny rozmer (KRITICKÉ)
Aby sme z fotky vedeli spraviť správnu veľkosť:

**Primárna metóda:** Klient zadá 1 referenčný rozmer
- "Šírka dverí", "Výška výkladu", "Šírka okna"
- Klient klikne 2 body na fotke a zadá reálnu dĺžku v cm
- Systém vypočíta px→mm koeficient

**Sekundárna metóda (v2):** AR meranie v mobile
- WebXR API na Chrome Android / Safari iOS
- Klient odmeria úsek kamerou

**Prepočet:**
```
scale_factor = real_dimension_mm / pixel_distance
letter_height_mm = letter_height_px * scale_factor
total_width_mm = total_text_width_px * scale_factor
```

### Krok D – Okamžitý 3D náhľad
- Three.js scéna s fotkou fasády ako pozadím
- **3D písmená** prilepené na perspektívnu rovinu (homografia z 4 bodov)
- **3D logo** (SVG → extrudované tvary, alebo raster → textúrovaný panel)
- Logo + text usporiadané podľa zvolenej pozície (nad/pod/vedľa)
- Interaktívne: veľkosť (posuvník), pozícia (drag), rotácia
- PBR materiál (kov/plast/opál) + tieň + simulovaný glow pre halo
- **Real-time** – zmena fontu/textu/loga = okamžitý update 3D

### Krok E – Objednávka
- Automaticky vygenerovaná cena (materiál × veľkosť × počet písmen × profil × podsvit)
- Klient schváli vizualizáciu → screenshot sa uloží
- Volba: **"len výroba"** / **"výroba + montáž"**
- Objednávka sa odošle do business-flow-ai (REST API)

---

## 3. Architektúra systému

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                    │
│                                                         │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐│
│  │  Upload   │ │  Text    │ │  Scale   │ │  3D View  ││
│  │  & Mark   │ │  Config  │ │  Calib   │ │  Three.js ││
│  │(fabric.js)│ │  Panel   │ │  Tool    │ │  R3F      ││
│  └───────────┘ └──────────┘ └──────────┘ └───────────┘│
│  ┌───────────┐ ┌──────────────────────────────────────┐│
│  │  Order    │ │         Zustand Store                 ││
│  │  Summary  │ │  (text, font, profile, scale, pos)   ││
│  └───────────┘ └──────────────────────────────────────┘│
└─────────────────────┬───────────────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────────────┐
│                    BACKEND (Next.js API)                 │
│                                                         │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐│
│  │  /upload  │ │ /generate│ │ /export  │ │  /order   ││
│  │  foto     │ │ mesh     │ │ STL      │ │  create   ││
│  └───────────┘ └──────────┘ └──────────┘ └───────────┘│
│  ┌──────────────────────┐ ┌──────────────────────────┐ │
│  │  3D Mesh Generator   │ │  Pricing Engine          │ │
│  │  (opentype→extrude)  │ │  (materiál+rozmer+LED)   │ │
│  └──────────────────────┘ └──────────────────────────┘ │
│  ┌──────────────────────┐ ┌──────────────────────────┐ │
│  │  Manufacturing Rules │ │  STL Export / Segmentácia│ │
│  │  (tolerancie, limity)│ │  (veľké písmená → diely) │ │
│  └──────────────────────┘ └──────────────────────────┘ │
└─────────────────────┬───────────────────────────────────┘
                      │ REST API (webhook)
┌─────────────────────▼───────────────────────────────────┐
│              BUSINESS-FLOW-AI (existujúci)               │
│  POST /api/public/v1/orders → vytvorí objednávku        │
│  + kalkulácia + úlohy pre oddelenia                     │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Technologický stack

### Frontend
| Technológia | Účel | Prečo |
|---|---|---|
| **Next.js 15** | Framework | Konzistencia s business-flow-ai |
| **React 19** | UI | Rovnaký stack |
| **@react-three/fiber (R3F)** | 3D scéna | React wrapper pre Three.js, deklaratívne |
| **@react-three/drei** | 3D helpers | OrbitControls, Text3D, Environment, ContactShadows |
| **Three.js** | 3D engine | Štandard pre web 3D |
| **fabric.js** | 2D canvas editor | Už používaný v business-flow-ai, výber plochy |
| **Zustand** | State management | Rovnaký stack, zdieľanie stavu medzi panelmi |
| **TailwindCSS 4** | Styling | Konzistencia |
| **opentype.js** | Font parsing | Text → vektorové krivky (glyph outlines) |

### Backend
| Technológia | Účel |
|---|---|
| **Next.js API Routes** | REST endpointy |
| **Drizzle ORM + SQLite** | Databáza konfigurácií |
| **opentype.js** (server) | Font → path konverzia |
| **three.js** (server) | STL generovanie (ExtrudeGeometry → STLExporter) |
| **sharp** | Obrazová manipulácia (resize, HEIC→JPG) |

### Budúcnosť (Etapa 3–4)
| Technológia | Účel |
|---|---|
| **SAM (Segment Anything)** | Semi-automatické maskovanie fasády |
| **WebXR** | AR meranie rozmerov |
| **ONNX Runtime Web** | Inference SAM modelu v prehliadači |

---

## 5. Databázová schéma

### Tabuľky (Drizzle ORM + SQLite)

```typescript
// === HLAVNÉ TABUĽKY ===

// Konfigurácia nápisu (uložený návrh)
sign_configurations {
  id                  TEXT PRIMARY KEY
  sessionId           TEXT NOT NULL        // anonymný session (pred registráciou)
  clientEmail         TEXT                 // voliteľné, po objednávke
  clientName          TEXT
  clientPhone         TEXT
  status              TEXT NOT NULL        // draft | preview | ordered | manufacturing | completed
  
  // Fotka fasády
  photoUrl            TEXT NOT NULL        // cesta k uloženej fotke
  photoWidth          INTEGER NOT NULL     // pôvodné rozmery
  photoHeight         INTEGER NOT NULL
  
  // Plocha označenia (4 body na fotke v px)
  surfacePoints       TEXT (JSON)          // [{x,y}, {x,y}, {x,y}, {x,y}]
  
  // Mierka
  scaleRefPoint1      TEXT (JSON)          // {x,y} bod 1 referenčnej úsečky
  scaleRefPoint2      TEXT (JSON)          // {x,y} bod 2
  scaleRefRealMm      REAL                // reálna vzdialenosť v mm
  scaleFactorPxToMm   REAL                // vypočítaný koeficient
  
  // Text konfigurácia
  text                TEXT NOT NULL        // "ADSUN" atď.
  fontFamily          TEXT NOT NULL        // "Montserrat Bold"
  fontFileUrl         TEXT                 // cesta k .ttf/.otf súboru
  
  // 3D profil
  profileType         TEXT NOT NULL        // flat | rounded | chamfer
  depthMm             REAL NOT NULL        // hrúbka v mm (30-150)
  
  // Farby
  faceColor           TEXT NOT NULL        // HEX alebo RAL kód
  sideColor           TEXT NOT NULL        // HEX alebo RAL kód
  
  // Podsvietenie
  lightingType        TEXT NOT NULL        // none | front | halo | front_halo
  ledColor            TEXT                 // warm_white | cool_white | rgb
  
  // Výsledné rozmery (vypočítané)
  totalWidthMm        REAL                // celková šírka nápisu
  letterHeightMm      REAL                // výška písmen
  letterCount         INTEGER             // počet písmen
  
  // Pozícia na fasáde (v mm od ľavého horného rohu plochy)
  positionXMm         REAL
  positionYMm         REAL
  
  // Vizualizácia
  previewImageUrl     TEXT                 // screenshot 3D náhľadu
  previewSceneData    TEXT (JSON)          // uložený stav Three.js scény
  
  // Objednávka
  orderType           TEXT                 // production_only | production_and_installation
  installationAddress TEXT
  installationNotes   TEXT
  
  // Prepojenie na business-flow-ai
  externalOrderId     TEXT                 // ID objednávky v business-flow-ai
  externalCalcId      TEXT                 // ID kalkulácie v business-flow-ai
  
  // Cena
  calculatedPrice     REAL                // automaticky vypočítaná cena
  priceBreakdown      TEXT (JSON)          // detail cenového rozpadu
  
  createdAt           TIMESTAMP
  updatedAt           TIMESTAMP
}

// Dostupné fonty
sign_fonts {
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL        // "Montserrat Bold"
  displayName         TEXT NOT NULL        // "Montserrat (tučné)"
  family              TEXT NOT NULL        // "Montserrat"
  weight              TEXT NOT NULL        // "700"
  fileUrl             TEXT NOT NULL        // /fonts/montserrat-bold.ttf
  previewUrl          TEXT                 // obrázok ukážky
  isExtrusionSafe     BOOLEAN DEFAULT true // bezpečné pre 3D extrúziu
  minRecommendedMm    REAL DEFAULT 50     // minimálna odporúčaná výška
  sortOrder           INTEGER DEFAULT 0
  isActive            BOOLEAN DEFAULT true
  createdAt           TIMESTAMP
}

// 3D profily (extrúzne tvary)
sign_profiles {
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL        // "flat", "rounded", "chamfer"
  displayName         TEXT NOT NULL        // "Rovný", "Zaoblený", "Skosený"
  description         TEXT
  previewImageUrl     TEXT                 // obrázok profilu
  extrudeSettings     TEXT (JSON)          // Three.js ExtrudeGeometry params
  // { depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments, ... }
  priceMultiplier     REAL DEFAULT 1.0     // 1.0=základ, 1.3=+30% pre rounded
  isActive            BOOLEAN DEFAULT true
  sortOrder           INTEGER DEFAULT 0
}

// Typy podsvietenia
sign_lighting_options {
  id                  TEXT PRIMARY KEY
  type                TEXT NOT NULL        // none | front | halo | front_halo
  displayName         TEXT NOT NULL        // "Bez podsvitu" | "Predné" | "Halo" | "Predné + Halo"
  description         TEXT
  previewImageUrl     TEXT
  pricePerLetterEur   REAL DEFAULT 0      // cena za LED modul na písmeno
  priceFixedEur       REAL DEFAULT 0      // fixná cena (zdroj, kabeláž)
  requirements        TEXT (JSON)          // { minDepthMm: 50, needsOpalFace: true, ... }
  isActive            BOOLEAN DEFAULT true
  sortOrder           INTEGER DEFAULT 0
}

// RAL farby
sign_colors {
  id                  TEXT PRIMARY KEY
  ralCode             TEXT                 // "RAL 9003"
  name                TEXT NOT NULL        // "Signálna biela"
  hexColor            TEXT NOT NULL        // "#F4F4F4"
  category            TEXT                 // standard | metallic | custom
  priceMultiplier     REAL DEFAULT 1.0     // metallic = 1.2x
  isActive            BOOLEAN DEFAULT true
  sortOrder           INTEGER DEFAULT 0
}

// Výrobné pravidlá (pre validáciu objednávky)
manufacturing_rules {
  id                  TEXT PRIMARY KEY
  ruleName            TEXT NOT NULL
  ruleType            TEXT NOT NULL        // min_size | max_size | min_wall | segmentation | ...
  parameters          TEXT (JSON)          // { minHeightMm: 50, maxHeightMm: 2000, ... }
  errorMessage        TEXT NOT NULL        // "Minimálna výška písmen je 50mm"
  isActive            BOOLEAN DEFAULT true
}

// Cenové pravidlá
pricing_rules {
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL
  description         TEXT
  ruleType            TEXT NOT NULL        // per_letter | per_area | fixed | multiplier
  conditions          TEXT (JSON)          // { minHeightMm, maxHeightMm, profileType, lightingType }
  priceValue          REAL NOT NULL        // hodnota (EUR/písmeno, EUR/m², multiplikátor)
  unit                TEXT                 // eur_per_letter | eur_per_m2 | multiplier
  priority            INTEGER DEFAULT 0    // vyššia priorita = aplikuje sa prednostne
  isActive            BOOLEAN DEFAULT true
}
```

---

## 6. API endpointy

### Verejné (zákaznícke)
```
POST   /api/upload              – Upload fotky fasády (multipart/form-data)
                                  → { photoId, photoUrl, width, height }

POST   /api/configuration       – Vytvorenie novej konfigurácie
                                  → { configId, sessionId }

PATCH  /api/configuration/:id   – Update konfigurácie (text, font, profil, farby, pozícia...)
                                  → { configId, updatedFields }

GET    /api/configuration/:id   – Načítanie konfigurácie (pre zdieľanie linku)
                                  → { ...fullConfig }

POST   /api/configuration/:id/preview  – Generovanie preview screenshotu
                                  → { previewImageUrl }

GET    /api/configuration/:id/price    – Výpočet ceny
                                  → { totalPrice, breakdown: {...} }

POST   /api/configuration/:id/order    – Odoslanie objednávky
                                  → { orderId, externalOrderId }

POST   /api/configuration/:id/export-stl  – Export STL (pre interné použitie)
                                  → { stlFileUrl, letterFiles: [...] }
```

### Konfiguračné (admin)
```
GET    /api/fonts               – Zoznam dostupných fontov
POST   /api/fonts               – Pridanie fontu

GET    /api/profiles            – Zoznam 3D profilov
GET    /api/lighting-options    – Zoznam typov podsvietenia
GET    /api/colors              – Zoznam RAL farieb

GET    /api/manufacturing-rules – Výrobné pravidlá
PATCH  /api/manufacturing-rules/:id – Update pravidla

GET    /api/pricing-rules       – Cenové pravidlá
POST   /api/pricing-rules       – Pridanie cenového pravidla
```

---

## 7. Frontend architektúra

### Štruktúra komponentov

```
src/
├── app/
│   ├── page.tsx                          # Landing page s CTA
│   ├── configurator/
│   │   └── page.tsx                      # Hlavný konfigurátor (client component)
│   ├── preview/[id]/
│   │   └── page.tsx                      # Zdieľateľný preview link
│   ├── order/[id]/
│   │   └── page.tsx                      # Stav objednávky
│   ├── admin/
│   │   ├── fonts/page.tsx                # Správa fontov
│   │   ├── profiles/page.tsx             # Správa profilov
│   │   ├── pricing/page.tsx              # Cenové pravidlá
│   │   └── rules/page.tsx                # Výrobné pravidlá
│   └── api/
│       ├── upload/route.ts
│       ├── configuration/route.ts
│       ├── configuration/[id]/route.ts
│       ├── configuration/[id]/price/route.ts
│       ├── configuration/[id]/order/route.ts
│       ├── configuration/[id]/export-stl/route.ts
│       ├── fonts/route.ts
│       ├── profiles/route.ts
│       ├── lighting-options/route.ts
│       ├── colors/route.ts
│       ├── manufacturing-rules/route.ts
│       └── pricing-rules/route.ts
│
├── components/
│   ├── configurator/
│   │   ├── photo-upload.tsx              # Upload + crop
│   │   ├── surface-selector.tsx          # 4-bodový výber plochy (fabric.js)
│   │   ├── text-config-panel.tsx         # Text, font, profil, farby
│   │   ├── scale-calibration.tsx         # 2-bodové meranie + reálny rozmer
│   │   ├── lighting-selector.tsx         # Výber podsvietenia
│   │   ├── color-picker.tsx              # RAL farby s náhľadom
│   │   ├── font-preview.tsx              # Náhľad fontu v texte
│   │   ├── profile-preview.tsx           # Prierez profilu
│   │   └── configurator-stepper.tsx      # Wizard kroky A→E
│   │
│   ├── viewer-3d/
│   │   ├── scene-canvas.tsx              # R3F Canvas wrapper
│   │   ├── facade-background.tsx         # Fotka fasády ako pozadie
│   │   ├── text-3d-mesh.tsx              # 3D písmená (generované z fontu)
│   │   ├── lighting-effects.tsx          # Front-lit / Halo glow efekty
│   │   ├── environment-setup.tsx         # Svetlá, tiene, HDRI
│   │   ├── camera-controls.tsx           # OrbitControls s limitmi
│   │   └── perspective-plane.tsx         # Homografia fasády
│   │
│   ├── order/
│   │   ├── price-summary.tsx             # Cenový rozpis
│   │   ├── order-form.tsx                # Kontaktné údaje + adresa montáže
│   │   └── order-confirmation.tsx        # Potvrdenie
│   │
│   └── ui/
│       ├── button.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── slider.tsx
│       ├── stepper.tsx
│       └── modal.tsx
│
├── stores/
│   └── configurator-store.ts             # Zustand – celý stav konfigurátora
│
├── lib/
│   ├── font-loader.ts                    # Načítanie a cache fontov (opentype.js)
│   ├── text-to-shapes.ts                 # Text → Three.js Shape[] (vektory)
│   ├── svg-to-shapes.ts                  # SVG → Three.js Shape[] (logo vektory)
│   ├── extrude-letters.ts                # Shape → ExtrudeGeometry
│   ├── stl-exporter.ts                   # Geometry → STL binary
│   ├── homography.ts                     # 4 body → perspektívna transformácia
│   ├── scale-calculator.ts               # px→mm prepočet
│   ├── pricing-calculator.ts             # Cenový výpočet
│   ├── manufacturing-validator.ts        # Validácia výrobných pravidiel
│   ├── letter-segmentation.ts            # Delenie veľkých písmen na segmenty
│   └── glow-shader.ts                    # Custom shader pre halo efekt
│
├── hooks/
│   ├── use-font.ts                       # Hook pre načítanie fontu
│   ├── use-text-geometry.ts              # Hook pre generovanie 3D geometrie
│   ├── use-price-calculation.ts          # Hook pre real-time cenu
│   └── use-configuration.ts              # Hook pre CRUD konfigurácie
│
├── types/
│   └── configurator.ts                   # TypeScript typy
│
└── db/
    ├── schema.ts                         # Drizzle schéma
    └── index.ts                          # DB connection
```

### Zustand Store (hlavný stav)

```typescript
interface ConfiguratorState {
  // Krok
  currentStep: 'upload' | 'text' | 'scale' | 'preview' | 'order';
  
  // Fotka
  photo: {
    url: string | null;
    width: number;
    height: number;
    file: File | null;
  };
  
  // Plocha (4 body)
  surfacePoints: Array<{ x: number; y: number }>;
  
  // Mierka
  scaleRef: {
    point1: { x: number; y: number } | null;
    point2: { x: number; y: number } | null;
    realMm: number | null;
    factorPxToMm: number | null;
  };
  
  // Text konfigurácia
  text: string;
  fontFamily: string;
  fontUrl: string;
  
  // 3D profil
  profileType: 'flat' | 'rounded' | 'chamfer';
  depthMm: number;
  
  // Farby
  faceColor: string;     // HEX
  sideColor: string;     // HEX
  faceRal: string;       // RAL kód
  sideRal: string;
  
  // Podsvietenie
  lightingType: 'none' | 'front' | 'halo' | 'front_halo';
  ledColor: 'warm_white' | 'cool_white' | 'rgb';
  
  // Vypočítané rozmery
  computed: {
    totalWidthMm: number;
    letterHeightMm: number;
    letterCount: number;
  };
  
  // Pozícia na fasáde (normalizované 0-1)
  position: { x: number; y: number };
  scale: number;
  
  // Cena
  price: {
    total: number;
    breakdown: PriceBreakdown | null;
    isCalculating: boolean;
  };
  
  // Objednávka
  order: {
    type: 'production_only' | 'production_and_installation';
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    installationAddress: string;
    notes: string;
  };
  
  // Actions
  setPhoto: (photo: File) => void;
  setSurfacePoints: (points: Array<{ x: number; y: number }>) => void;
  setText: (text: string) => void;
  setFont: (family: string, url: string) => void;
  setProfile: (type: string, depthMm: number) => void;
  setColors: (face: string, side: string) => void;
  setLighting: (type: string) => void;
  setScaleRef: (point1: any, point2: any, realMm: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
}
```

---

## 8. 3D Pipeline

### Text → 3D Mesh generovanie

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ opentype │───▶│  Glyph   │───▶│ Three.js │───▶│ Extrude  │───▶│  Mesh    │
│ .js load │    │  paths   │    │  Shape   │    │ Geometry │    │ + PBR    │
│  .ttf    │    │ (SVG-like│    │ (holes   │    │ (depth,  │    │ material │
│          │    │  cmds)   │    │  filled) │    │  bevel)  │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Logo → 3D Mesh generovanie

```
SVG logo:
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   SVG    │───▶│  Parse   │───▶│ Three.js │───▶│ Extrude  │───▶│  Mesh    │
│  upload  │    │ <path>,  │    │  Shape   │    │ Geometry │    │ + PBR    │
│  .svg    │    │ <rect>,  │    │ (holes   │    │ (depth,  │    │ material │
│          │    │ <circle> │    │  filled) │    │  bevel)  │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘

Raster logo:
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   PNG/   │───▶│  Texture │───▶│  Plane   │───▶│  Mesh    │
│   JPG    │    │  loader  │    │ Geometry │    │ + Texture │
│  upload  │    │  (Three) │    │ (panel)  │    │  map     │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

Podporované SVG elementy: `<path>` (M, L, C, Q, S, T, A, Z), `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`.

#### Krok 1: Font → Vektorové krivky
```typescript
import opentype from 'opentype.js';

function textToShapes(text: string, fontUrl: string, fontSize: number): THREE.Shape[] {
  const font = await opentype.load(fontUrl);
  const paths = font.getPaths(text, 0, 0, fontSize);
  
  const shapes: THREE.Shape[] = [];
  for (const path of paths) {
    const shape = new THREE.Shape();
    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'M': shape.moveTo(cmd.x, cmd.y); break;
        case 'L': shape.lineTo(cmd.x, cmd.y); break;
        case 'Q': shape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
        case 'C': shape.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
        case 'Z': shape.closePath(); break;
      }
    }
    shapes.push(shape);
  }
  return shapes;
}
```

#### Krok 2: Extrúzia podľa profilu
```typescript
const extrudeSettings = {
  flat:     { depth: depthMm, bevelEnabled: false },
  rounded:  { depth: depthMm, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 8 },
  chamfer:  { depth: depthMm, bevelEnabled: true, bevelThickness: 5, bevelSize: 5, bevelSegments: 1 },
};

const geometry = new THREE.ExtrudeGeometry(shapes, extrudeSettings[profileType]);
```

#### Krok 3: Materiál
```typescript
// Čelo písmena
const faceMaterial = new THREE.MeshStandardMaterial({
  color: faceColor,
  roughness: 0.3,
  metalness: 0.1,
});

// Bočnica
const sideMaterial = new THREE.MeshStandardMaterial({
  color: sideColor,
  roughness: 0.5,
  metalness: 0.0,
});

// Pre opálové čelo (front-lit)
const opalMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.6,
  roughness: 0.2,
  thickness: 3,
});
```

#### Krok 4: Halo efekt (glow)
```typescript
// Zadné svietenie simulované ako PointLight za každým písmenom
// + custom shader pre "aura" efekt na stene
function createHaloEffect(letterMesh: THREE.Mesh) {
  const light = new THREE.PointLight(0xffffff, 1, 500);
  light.position.copy(letterMesh.position);
  light.position.z -= depthMm + 20; // za písmenom
  
  // Glow sprite pre vizuálny efekt
  const glowSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: ledColor,
      transparent: true,
      blending: THREE.AdditiveBlending,
    })
  );
  glowSprite.scale.set(letterHeightMm * 1.5, letterHeightMm * 1.5, 1);
  glowSprite.position.copy(light.position);
  
  return { light, glowSprite };
}
```

### Homografia (perspektíva fasády)

```typescript
// Z 4 bodov na fotke (px) → transformačná matica
function computeHomography(
  srcPoints: [Point, Point, Point, Point],  // 4 body na fotke
  dstPoints: [Point, Point, Point, Point],  // 4 body v 3D priestore (obdĺžnik)
): THREE.Matrix4 {
  // Používame DLT (Direct Linear Transform) algoritmus
  // Vstup: 4 body v pixeloch
  // Výstup: 4×4 matica pre Three.js mesh.matrix
  
  // ... DLT implementácia ...
  
  return matrix;
}

// Aplikácia na mesh
textMesh.applyMatrix4(homographyMatrix);
```

### STL Export (výroba)

```typescript
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

function exportLettersToSTL(
  shapes: THREE.Shape[],
  extrudeSettings: object,
  scaleMmToUnit: number = 1 // 1 mm = 1 unit
): { letterIndex: number; stlBuffer: ArrayBuffer; widthMm: number; heightMm: number }[] {
  const exporter = new STLExporter();
  const results = [];
  
  for (let i = 0; i < shapes.length; i++) {
    const geometry = new THREE.ExtrudeGeometry([shapes[i]], extrudeSettings);
    const mesh = new THREE.Mesh(geometry);
    
    // Segmentácia ak písmeno > max print size
    if (needsSegmentation(mesh, maxPrintSizeMm)) {
      const segments = segmentLetter(mesh, maxPrintSizeMm);
      for (const segment of segments) {
        results.push({
          letterIndex: i,
          segmentIndex: segment.index,
          stlBuffer: exporter.parse(segment.mesh, { binary: true }),
          widthMm: segment.width,
          heightMm: segment.height,
        });
      }
    } else {
      results.push({
        letterIndex: i,
        stlBuffer: exporter.parse(mesh, { binary: true }),
        widthMm: getBoundingBox(mesh).x,
        heightMm: getBoundingBox(mesh).y,
      });
    }
  }
  
  return results;
}
```

---

## 9. Cenový model

### Vstupné premenné
```
text_length         = počet písmen (bez medzier)
letter_height_mm    = výška jedného písmena
letter_area_m2      = plocha jedného písmena (z vektorov)
total_area_m2       = súčet plôch všetkých písmen
profile_type        = flat | rounded | chamfer
depth_mm            = hrúbka
lighting_type       = none | front | halo | front_halo
face_color_type     = standard | metallic | custom_ral
order_type          = production_only | production_and_installation
```

### Cenová formula

```
CENA = (cena_materiálu + cena_práce + cena_LED + cena_náter) × množstevný_koeficient + fixné_náklady

kde:
  cena_materiálu    = total_area_m2 × depth_mm × material_price_per_cm3
  cena_práce        = text_length × time_per_letter_hours × hourly_rate
  cena_LED          = text_length × led_module_price + led_source_price (ak lighting != none)
  cena_náter        = total_area_m2 × paint_price_per_m2 × color_multiplier
  fixné_náklady     = design_fee + packaging + shipping
  
  // Prirážky
  profile_multiplier = { flat: 1.0, rounded: 1.15, chamfer: 1.1 }
  lighting_multiplier = { none: 1.0, front: 1.4, halo: 1.3, front_halo: 1.6 }
  installation_fee   = order_type == 'production_and_installation' ? calculated_installation : 0
```

### Orientačná cenová tabuľka (konfigurovateľná v admin)

| Výška písmen | Typ | Bez LED | Front-lit | Halo |
|---|---|---|---|---|
| 50–100mm | flat | 8–15 €/písmeno | 18–25 €/písmeno | 15–22 €/písmeno |
| 100–200mm | flat | 15–30 €/písmeno | 25–45 €/písmeno | 22–40 €/písmeno |
| 200–500mm | flat | 30–80 €/písmeno | 50–120 €/písmeno | 45–100 €/písmeno |
| 500–1000mm | flat | 80–200 €/písmeno | 120–300 €/písmeno | 100–250 €/písmeno |

---

## 10. Výrobné pravidlá

### Rozmerové limity
```json
{
  "min_letter_height_mm": 30,
  "max_letter_height_mm": 2000,
  "min_depth_mm": 20,
  "max_depth_mm": 200,
  "min_wall_thickness_mm": 2.0,
  "max_single_piece_mm": 400,
  "min_stroke_width_mm": 3.0
}
```

### Segmentácia veľkých písmen
```
Ak písmeno > max_print_size (400mm):
  1. Rozdeliť na segmenty s overlapom 5mm (pero-drážka)
  2. Každý segment ≤ max_print_size
  3. Automatické konektory na spojoch
  4. Značky orientácie (číslovanie segmentov)
```

### Materiálové pravidlá
```json
{
  "exteriér": {
    "material": "ASA",
    "infill": "20-30%",
    "wall_layers": 4,
    "top_bottom_layers": 5,
    "uv_resistant": true,
    "temp_range": "-30°C to +60°C",
    "expected_lifetime_years": 5
  },
  "interiér": {
    "material": "PLA/PETG",
    "infill": "15-20%",
    "wall_layers": 3,
    "top_bottom_layers": 4,
    "uv_resistant": false,
    "expected_lifetime_years": 10
  }
}
```

### LED pravidlá
```json
{
  "front_lit": {
    "min_depth_mm": 50,
    "face_material": "opál (3mm PMMA/PC)",
    "led_type": "SMD 2835 modul",
    "led_spacing_mm": 25,
    "power_per_module_w": 0.72,
    "voltage": "12V DC",
    "needs_ventilation": true,
    "service_access": "zadná strana (odnímateľná)"
  },
  "halo": {
    "min_depth_mm": 40,
    "min_wall_gap_mm": 20,
    "led_type": "SMD 2835 strip",
    "mounting": "distančné tyče 20-40mm od steny",
    "face_material": "plný (nepriehľadný)"
  },
  "front_halo": {
    "min_depth_mm": 60,
    "combines": ["front_lit", "halo"],
    "dual_led_circuit": true
  }
}
```

### Montážne pravidlá
```json
{
  "mounting_options": {
    "threaded_rods": {
      "description": "Závitové tyče M6/M8",
      "suitable_for": "všetky povrchy",
      "min_letter_height_mm": 100,
      "rod_spacing_mm": 200,
      "rod_protrusion_mm": "30-50"
    },
    "adhesive": {
      "description": "Špeciálne lepidlo (VHB páska)",
      "suitable_for": "hladké povrchy, sklo",
      "max_weight_per_letter_kg": 2,
      "min_letter_height_mm": 30
    },
    "rail_system": {
      "description": "Montážna lišta",
      "suitable_for": "dlhé nápisy > 2m",
      "min_letter_count": 5
    }
  },
  "cable_routing": {
    "max_distance_to_source_m": 10,
    "cable_channel": "behind letters, through wall",
    "transformer_location": "indoor (accessible)"
  }
}
```

---

## 11. Integrácia s business-flow-ai

### Objednávka → business-flow-ai

Po schválení objednávky klientom sa volá business-flow-ai API:

```typescript
// POST https://business-flow.example.com/api/public/v1/orders
const orderPayload = {
  apiKey: process.env.BUSINESS_FLOW_API_KEY,
  name: `3D Nápis: "${config.text}" - ${config.lightingType}`,
  description: buildOrderDescription(config),
  clientName: config.order.clientName,
  clientEmail: config.order.clientEmail,
  clientPhone: config.order.clientPhone,
  priority: 'MEDIUM',
  services: [
    {
      name: `3D písmená ${config.profileType} - ${config.text}`,
      quantity: config.computed.letterCount,
      totalPrice: config.price.breakdown.materialAndLabor,
      departmentId: '3d-print-dept',       // oddelenie 3D tlače
      inputFieldsData: {
        text: config.text,
        fontFamily: config.fontFamily,
        letterHeightMm: config.computed.letterHeightMm,
        depthMm: config.depthMm,
        profileType: config.profileType,
        faceColor: config.faceRal,
        sideColor: config.sideRal,
      }
    },
    // LED montáž (ak je podsvit)
    ...(config.lightingType !== 'none' ? [{
      name: `LED ${config.lightingType} - ${config.text}`,
      quantity: config.computed.letterCount,
      totalPrice: config.price.breakdown.ledCost,
      departmentId: 'led-dept',
      inputFieldsData: {
        lightingType: config.lightingType,
        ledColor: config.ledColor,
        letterCount: config.computed.letterCount,
      }
    }] : []),
    // Náter
    {
      name: `Náter RAL ${config.faceRal}/${config.sideRal}`,
      quantity: 1,
      totalPrice: config.price.breakdown.paintCost,
      departmentId: 'finishing-dept',
    },
    // Montáž (ak je zvolená)
    ...(config.order.type === 'production_and_installation' ? [{
      name: `Montáž na adrese: ${config.order.installationAddress}`,
      quantity: 1,
      totalPrice: config.price.breakdown.installationFee,
      departmentId: 'installation-dept',
      inputFieldsData: {
        address: config.order.installationAddress,
        notes: config.order.notes,
      }
    }] : []),
  ],
  metadata: {
    source: '3d-configurator',
    configurationId: config.id,
    previewImageUrl: config.previewImageUrl,
    stlExportUrl: config.stlExportUrl,
  }
};
```

### Zdieľaný link
```
https://3d.adsun.sk/preview/{configId}
```
Klient môže zdieľať link na vizualizáciu. Business-flow-ai môže zobraziť tento link v detaile objednávky.

---

## 12. Etapy implementácie

### ETAPA 1 – MVP (1–2 týždne)
**"Foto + text/logo + 3D náhľad + orientačná cena"**

- [ ] Projekt setup (Next.js + R3F + Tailwind + SQLite)
- [ ] Photo upload + resize (sharp)
- [ ] 4-bodový surface selector (fabric.js)
- [ ] **Výber obsahu: text / logo / text+logo**
- [ ] Text konfiguračný panel (10 fontov, 3 profily)
- [ ] **Logo upload (SVG → 3D extrúzia, raster → reliéf panel)**
- [ ] **SVG parser (path, rect, circle, ellipse, polygon → Three.js Shapes)**
- [ ] **Logo pozícia voči textu (nad/pod/vedľa)**
- [ ] Font → 3D extrúzia pipeline (opentype.js → Three.js)
- [ ] 3D náhľad s fotkou pozadím
- [ ] Jednoduchý PBR materiál (farba čela + bočnica)
- [ ] Orientačná cena (per písmeno × výška + logo plocha)
- [ ] Uloženie konfigurácie do DB
- [ ] Zdieľateľný preview link

### ETAPA 2 (1–2 týždne)
**"Mierka + STL export + objednávka"**

- [ ] Scale calibration tool (2 body + reálny rozmer)
- [ ] Presný px→mm prepočet
- [ ] STL export (per písmeno)
- [ ] Objednávkový formulár (kontakt + adresa)
- [ ] Integrácia s business-flow-ai (POST order)
- [ ] Email notifikácia (klient + admin)
- [ ] Admin panel: cenové pravidlá

### ETAPA 3 (2–3 týždne)
**"Výrobné profily + segmentácia + montáž"**

- [ ] Knižnica výrobných profilov (front-lit, halo, front+halo)
- [ ] LED simulácia v 3D náhľade (glow shader)
- [ ] Automatické delenie veľkých písmen (segmentácia)
- [ ] Pero-drážka konektory
- [ ] Montážne šablóny (PDF export)
- [ ] Výrobné pravidlá validácia (min. hrúbka, UV materiál...)
- [ ] Admin panel: výrobné pravidlá

### ETAPA 4 (2–3 týždne)
**"SAM maskovanie + AR + lepšia vizualizácia"**

- [ ] SAM model integrácia (semi-automatický výber fasády)
- [ ] WebXR AR meranie (Chrome/Safari)
- [ ] Lepšie PBR materiály (HDRI environment)
- [ ] Shadow mapping na fasáde
- [ ] Denné/nočné osvetlenie toggle
- [ ] Multi-riadkový text
- [ ] Automatická vektorizácia rastrového loga (potrace / AI tracing)
- [ ] Klientské účty + história konfigurácií

---

## Doplňujúce poznámky

### Bezpečné predvoľby (aby klient nevymyslel nereálny variant)
- Font výber je **obmedzený** na overené fonty (žiadne ultra-thin)
- Hĺbka je **predvoľba** (30/50/80/100/150mm), nie voľný vstup
- Ak `lightingType=front` a `depthMm < 50`, automaticky sa zvýši na 50mm
- Ak `letterHeightMm < 30mm`, zobrazí sa varovanie "príliš malé pre exteriér"
- Ak `letterHeightMm > max_print_size`, automaticky sa aktivuje segmentácia
- RAL farby sú z **kuratovaného** zoznamu (žiadne custom HEX v MVP)

### Výkon
- Fonty sa cachujú v IndexedDB (raz načítaný = offline dostupný)
- 3D geometria sa generuje **v hlavnom vlákne** (< 100ms pre 10 písmen)
- Pre > 20 písmen: Web Worker pre geometriu
- STL export na serveri (nie v prehliadači)
- Fotky sa resizujú na max 2048px pred uploadom

### Mobile-first
- Konfigurátor musí fungovať na mobile (60%+ klientov)
- Touch-friendly: pinch-to-zoom, drag
- 3D náhľad: touch orbit/pan
- Responsive layout: konfiguračný panel pod 3D viewportom na mobile
