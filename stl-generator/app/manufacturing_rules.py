"""
manufacturing_rules.py – Výrobné pravidlá pre svetelné písmená

Definuje parametre konštrukcie podľa typu podsvietenia:
  - none:       Plné 3D písmeno (dekoratívne, bez LED)
  - front:      Front-lit (svietenie spredu cez opálové čelo)
  - halo:       Halo (svietenie zozadu cez medzeru)
  - front_halo: Kombinácia front + halo

Každý typ má špecifické pravidlá pre:
  - Hrúbky stien, čelo, zadný panel
  - LED priestor a rozmiestnenie
  - Vetranie, montáž, segmentácia
"""

from dataclasses import dataclass, field
from typing import List, Optional


# ─────────────────────────────────────────────
# Konfigurácia materiálov
# ─────────────────────────────────────────────

@dataclass
class MaterialConfig:
    """Materiálové vlastnosti pre 3D tlač."""
    name: str
    min_wall_thickness: float  # mm
    max_print_size: float      # mm (najdlhšia strana)
    density: float             # g/cm³
    uv_resistant: bool
    max_temperature: int       # °C


MATERIALS = {
    'asa': MaterialConfig(
        name='ASA',
        min_wall_thickness=1.5,
        max_print_size=400,
        density=1.07,
        uv_resistant=True,
        max_temperature=95,
    ),
    'abs': MaterialConfig(
        name='ABS',
        min_wall_thickness=1.5,
        max_print_size=400,
        density=1.04,
        uv_resistant=False,
        max_temperature=85,
    ),
    'petg': MaterialConfig(
        name='PETG',
        min_wall_thickness=1.2,
        max_print_size=400,
        density=1.27,
        uv_resistant=False,
        max_temperature=70,
    ),
    'pla': MaterialConfig(
        name='PLA',
        min_wall_thickness=1.0,
        max_print_size=400,
        density=1.24,
        uv_resistant=False,
        max_temperature=55,
    ),
}


# ─────────────────────────────────────────────
# LED moduly
# ─────────────────────────────────────────────

@dataclass
class LEDModuleSpec:
    """Špecifikácia LED modulu."""
    name: str
    width: float   # mm
    height: float  # mm
    depth: float   # mm - hĺbka vrátane kabeláže
    spacing: float  # mm - odporúčaný rozstup medzi modulmi
    power_per_module: float  # W
    voltage: float  # V (typicky 12 alebo 24)


LED_MODULES = {
    'smd_2835_front': LEDModuleSpec(
        name='SMD 2835 Front-lit modul',
        width=18, height=12, depth=8,
        spacing=70,
        power_per_module=0.72,
        voltage=12,
    ),
    'smd_2835_halo': LEDModuleSpec(
        name='SMD 2835 Halo modul',
        width=18, height=12, depth=5,
        spacing=80,
        power_per_module=0.72,
        voltage=12,
    ),
    'cob_front': LEDModuleSpec(
        name='COB LED strip (front)',
        width=10, height=3, depth=5,
        spacing=0,  # continuous strip
        power_per_module=0.5,  # per cm
        voltage=24,
    ),
}


# ─────────────────────────────────────────────
# Výrobné pravidlá per lighting type
# ─────────────────────────────────────────────

@dataclass
class ManufacturingRule:
    """Kompletné výrobné pravidlá pre jeden typ podsvietenia."""
    
    lighting_type: str
    
    # Rozmery stien
    wall_thickness: float       # mm – hrúbka bočných stien korpusu
    face_thickness: float       # mm – hrúbka prednej plochy (čela)
    back_panel_thickness: float # mm – hrúbka zadného panelu
    
    # Čelo (face)
    face_is_separate: bool      # Či je čelo samostatný diel
    face_is_translucent: bool   # Či je čelo priepustné (opálové)
    face_inset: float           # mm – zapustenie čela do korpusu
    
    # Drážky pre akrylát (recess) – KĽÚČOVÉ pre svetelné písmená
    external_wall_recess: float # mm – drážka na vonkajšej stene pre zasadenie plexi
    internal_wall_recess: float # mm – zníženie vnútornej steny (priestor za plexi pre LED)
    acrylic_thickness: float    # mm – hrúbka akrylátového (plexi) čela
    acrylic_clearance: float    # mm – vôľa medzi akrylátom a korpusom
    
    # Zadný panel
    back_is_open: bool          # Halo: zadok je otvorený/priepustný
    back_standoff: float        # mm – dištanc od steny (pre halo efekt)
    
    # LED priestor
    led_module: str             # kľúč do LED_MODULES
    led_cavity_depth: float     # mm – hĺbka dutiny pre LED
    led_cavity_offset: float    # mm – offset dutiny od čela
    led_base_thickness: float   # mm – hrúbka LED základne
    
    # Vnútorná štruktúra
    internal_walls: bool        # Pridať vnútorné priečky pre stabilitu
    inner_lining: float         # mm – vnútorné lemovanie
    bottom_thickness: float     # mm – hrúbka dna
    
    # Montáž
    mounting_hole_diameter: float  # mm (M4 = 4.0, M5 = 5.0)
    mounting_hole_spacing: float   # mm – max rozstup montážnych dier
    mounting_tab_size: float       # mm – veľkosť montážnych ušiek
    standoff_length: float         # mm – dĺžka dištančných stĺpikov
    
    # Vetranie
    vent_hole_diameter: float   # mm
    vent_hole_spacing: float    # mm
    
    # Segmentácia (ak písmeno > max_single_piece)
    max_single_piece: float     # mm – maximálna veľkosť jedného kusu
    connector_type: str         # 'mortise_tenon' / 'pin' / 'tongue_groove'
    connector_depth: float      # mm
    connector_tolerance: float  # mm

    # Výstuhy
    rib_spacing: float          # mm – rozstup výstuh (ak > min_rib_size)
    min_rib_size: float         # mm – minimálna veľkosť písmena pre výstuhy
    rib_thickness: float        # mm


# ─────────────────────────────────────────────
# Predvolené pravidlá
# ─────────────────────────────────────────────

MANUFACTURING_RULES = {
    # ══════════════════════════════════════════════
    # 1. Kanálové písmeno (bez LED)
    #    Duté, 2.5mm stena, čelo aj zadok integrálne.
    #    Žiadna drážka – nie je akrylát.
    # ══════════════════════════════════════════════
    'channel': ManufacturingRule(
        lighting_type='channel',
        wall_thickness=2.5,             # Robustná 2.5mm stena
        face_thickness=2.0,             # Plné čelo (integrálne)
        back_panel_thickness=2.0,       # Zadná stena 2mm
        face_is_separate=False,         # Čelo je súčasť korpusu
        face_is_translucent=False,
        face_inset=0,                   # Žiadne zapustenie
        external_wall_recess=0,         # Bez drážky (nie je akrylát)
        internal_wall_recess=0,
        acrylic_thickness=0,
        acrylic_clearance=0,
        back_is_open=False,
        back_standoff=0,
        led_module='',
        led_cavity_depth=0,
        led_cavity_offset=0,
        led_base_thickness=0,
        internal_walls=False,
        inner_lining=0,
        bottom_thickness=2.0,
        mounting_hole_diameter=5.0,     # M5
        mounting_hole_spacing=150,
        mounting_tab_size=15,
        standoff_length=25,
        vent_hole_diameter=0,           # Nepotrebné (bez LED)
        vent_hole_spacing=0,
        max_single_piece=400,
        connector_type='mortise_tenon',
        connector_depth=8,
        connector_tolerance=0.2,
        rib_spacing=120,
        min_rib_size=200,
        rib_thickness=2.0,
    ),
    
    # ══════════════════════════════════════════════
    # 2. Kanálové písmeno s LED (front-lit channel)
    #    2.5mm stena, drážka 3mm pre akrylát, LED spredu.
    #    PRAVIDLO: externalWallRecess ≥ acrylicThickness
    # ══════════════════════════════════════════════
    'channel_front': ManufacturingRule(
        lighting_type='channel_front',
        wall_thickness=2.5,             # 2.5mm bočná stena
        face_thickness=0,               # Čelo = akrylát (nie 3D tlač)
        back_panel_thickness=2.0,       # Zadná stena 2mm
        face_is_separate=True,          # Akrylát je oddelený diel
        face_is_translucent=True,       # Opálové/priesvitné
        face_inset=3.0,                 # = acrylicThickness → sedí flush
        external_wall_recess=3.0,       # Drážka 3mm pre zasadenie akrylátu
        internal_wall_recess=0,
        acrylic_thickness=3.0,          # Akrylát 3mm
        acrylic_clearance=0.15,
        back_is_open=False,
        back_standoff=0,
        led_module='smd_2835_front',
        led_cavity_depth=20,
        led_cavity_offset=5,            # Offset pre rozptýlenie svetla
        led_base_thickness=2.0,
        internal_walls=True,
        inner_lining=0,
        bottom_thickness=2.0,
        mounting_hole_diameter=5.0,
        mounting_hole_spacing=150,
        mounting_tab_size=15,
        standoff_length=25,
        vent_hole_diameter=2.5,
        vent_hole_spacing=50,
        max_single_piece=400,
        connector_type='mortise_tenon',
        connector_depth=8,
        connector_tolerance=0.2,
        rib_spacing=100,
        min_rib_size=150,
        rib_thickness=2.0,
    ),
    
    # ══════════════════════════════════════════════
    # 3. Plné 3D písmeno (bez dutiny)
    #    Masívne, dekoratívne. Žiadne LED, žiadna drážka.
    # ══════════════════════════════════════════════
    'none': ManufacturingRule(
        lighting_type='none',
        wall_thickness=3.0,
        face_thickness=3.0,
        back_panel_thickness=3.0,
        face_is_separate=False,
        face_is_translucent=False,
        face_inset=0,
        external_wall_recess=0,
        internal_wall_recess=0,
        acrylic_thickness=0,
        acrylic_clearance=0,
        back_is_open=False,
        back_standoff=0,
        led_module='',
        led_cavity_depth=0,
        led_cavity_offset=0,
        led_base_thickness=0,
        internal_walls=False,
        inner_lining=0,
        bottom_thickness=3.0,
        mounting_hole_diameter=5.0,
        mounting_hole_spacing=150,
        mounting_tab_size=15,
        standoff_length=25,
        vent_hole_diameter=0,
        vent_hole_spacing=0,
        max_single_piece=400,
        connector_type='mortise_tenon',
        connector_depth=8,
        connector_tolerance=0.2,
        rib_spacing=120,
        min_rib_size=200,
        rib_thickness=2.0,
    ),
    
    # ══════════════════════════════════════════════
    # 4. Front-lit (štandardný)
    #    Robustnejší korpus, drážka 3mm pre akrylát, LED spredu.
    # ══════════════════════════════════════════════
    'front': ManufacturingRule(
        lighting_type='front',
        wall_thickness=2.5,
        face_thickness=0,              # Čelo = akrylát
        back_panel_thickness=2.5,
        face_is_separate=True,
        face_is_translucent=True,
        face_inset=3.0,                # = acrylicThickness → flush
        external_wall_recess=3.0,      # Drážka 3mm pre zasadenie akrylátu
        internal_wall_recess=0,
        acrylic_thickness=3.0,         # Akrylát 3mm
        acrylic_clearance=0.15,
        back_is_open=False,
        back_standoff=0,
        led_module='smd_2835_front',
        led_cavity_depth=25,
        led_cavity_offset=5,
        led_base_thickness=2.0,
        internal_walls=True,
        inner_lining=0,
        bottom_thickness=2.5,
        mounting_hole_diameter=5.0,
        mounting_hole_spacing=150,
        mounting_tab_size=15,
        standoff_length=30,
        vent_hole_diameter=3.0,
        vent_hole_spacing=60,
        max_single_piece=400,
        connector_type='mortise_tenon',
        connector_depth=10,
        connector_tolerance=0.2,
        rib_spacing=100,
        min_rib_size=180,
        rib_thickness=2.0,
    ),
    
    # ══════════════════════════════════════════════
    # 5. Halo (zadné podsvietenie)
    #    Otvorený zadok, nepriesvitné hrubé čelo (3mm).
    #    Žiadna drážka – čelo je integrálne.
    # ══════════════════════════════════════════════
    'halo': ManufacturingRule(
        lighting_type='halo',
        wall_thickness=2.5,
        face_thickness=3.0,            # Hrubšie nepriesvitné čelo
        back_panel_thickness=0,        # Otvorený zadok
        face_is_separate=False,
        face_is_translucent=False,
        face_inset=0,
        external_wall_recess=0,        # Bez drážky (čelo je integrálne)
        internal_wall_recess=0,
        acrylic_thickness=0,
        acrylic_clearance=0,
        back_is_open=True,
        back_standoff=40,              # Dištanc pre halo efekt
        led_module='smd_2835_halo',
        led_cavity_depth=15,
        led_cavity_offset=0,
        led_base_thickness=2.0,
        internal_walls=True,
        inner_lining=0,
        bottom_thickness=2.0,
        mounting_hole_diameter=5.0,
        mounting_hole_spacing=150,
        mounting_tab_size=15,
        standoff_length=40,            # = backStandoff
        vent_hole_diameter=0,          # Nepotrebné (otvorený zadok)
        vent_hole_spacing=0,
        max_single_piece=400,
        connector_type='mortise_tenon',
        connector_depth=10,
        connector_tolerance=0.2,
        rib_spacing=120,
        min_rib_size=200,
        rib_thickness=2.0,
    ),
    
    # ══════════════════════════════════════════════
    # 6. Front + Halo (kombinácia)
    #    Akrylát spredu (3mm v drážke) + otvorený zadok.
    # ══════════════════════════════════════════════
    'front_halo': ManufacturingRule(
        lighting_type='front_halo',
        wall_thickness=2.5,
        face_thickness=0,              # Čelo = akrylát
        back_panel_thickness=0,        # Otvorený zadok (halo)
        face_is_separate=True,
        face_is_translucent=True,
        face_inset=3.0,                # = acrylicThickness
        external_wall_recess=3.0,      # Drážka 3mm pre akrylát
        internal_wall_recess=0,
        acrylic_thickness=3.0,
        acrylic_clearance=0.15,
        back_is_open=True,
        back_standoff=40,
        led_module='smd_2835_front',
        led_cavity_depth=25,
        led_cavity_offset=5,
        led_base_thickness=2.0,
        internal_walls=True,
        inner_lining=0,
        bottom_thickness=2.0,
        mounting_hole_diameter=5.0,
        mounting_hole_spacing=150,
        mounting_tab_size=15,
        standoff_length=40,
        vent_hole_diameter=3.0,
        vent_hole_spacing=80,
        max_single_piece=400,
        connector_type='mortise_tenon',
        connector_depth=10,
        connector_tolerance=0.2,
        rib_spacing=100,
        min_rib_size=180,
        rib_thickness=2.0,
    ),
}


def get_rules(lighting_type: str) -> ManufacturingRule:
    """Získať výrobné pravidlá pre daný typ podsvietenia."""
    return MANUFACTURING_RULES.get(lighting_type, MANUFACTURING_RULES['none'])


def estimate_led_count(
    letter_area_mm2: float,
    rules: ManufacturingRule,
) -> int:
    """Odhadnúť počet LED modulov pre jedno písmeno."""
    if not rules.led_module:
        return 0
    
    led = LED_MODULES.get(rules.led_module)
    if not led or led.spacing <= 0:
        return 0
    
    # Hrubý odhad: plocha / (spacing²)
    return max(1, int(letter_area_mm2 / (led.spacing ** 2)))


def estimate_weight_g(volume_mm3: float, material: str = 'asa') -> float:
    """Odhadnúť hmotnosť v gramoch."""
    mat = MATERIALS.get(material, MATERIALS['asa'])
    volume_cm3 = volume_mm3 / 1000
    return volume_cm3 * mat.density


def needs_segmentation(
    width_mm: float,
    height_mm: float,
    rules: ManufacturingRule,
) -> bool:
    """Zistiť, či písmeno potrebuje segmentáciu."""
    return max(width_mm, height_mm) > rules.max_single_piece


def calculate_segments(
    width_mm: float,
    height_mm: float,
    rules: ManufacturingRule,
) -> int:
    """Počet segmentov pri segmentácii."""
    max_dim = max(width_mm, height_mm)
    if max_dim <= rules.max_single_piece:
        return 1
    return max(2, int(math.ceil(max_dim / (rules.max_single_piece * 0.85))))


import math
