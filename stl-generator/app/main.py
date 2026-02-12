"""
main.py – FastAPI REST API pre generovanie výrobných STL súborov

Endpointy:
  POST /generate-stl       – Generovať STL pre celý nápis
  GET  /download/{job_id}  – Stiahnuť ZIP so STL súbormi
  GET  /health             – Health check
  GET  /rules/{type}       – Získať výrobné pravidlá

CORS povolený pre localhost:3001 (Next.js konfigurátor)
"""

import os
import zipfile
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# Koreňový adresár stl-generator (app/ -> stl-generator/)
STL_GENERATOR_ROOT = Path(__file__).resolve().parent.parent

from .letter_generator import generate_sign_stl, OUTPUT_DIR
from .qr_generator import generate_qr_keychain_stl
from .manufacturing_rules import (
    get_rules,
    MANUFACTURING_RULES,
    MATERIALS,
    LED_MODULES,
    ManufacturingRule,
)
from .bambu_integration import (
    BambuPrinter,
    BambuConnection,
    generate_3mf,
    convert_stl_zip_to_3mf,
    PRINTER_PROFILES,
)
from .vectorize import png_to_svg, png_base64_to_svg

# ─────────────────────────────────────────────
# App
# ─────────────────────────────────────────────

app = FastAPI(
    title="ADSUN STL Generator",
    description="Generovanie výrobných STL súborov pre svetelné písmená",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vytvoriť output directory
os.makedirs(OUTPUT_DIR, exist_ok=True)


# ─────────────────────────────────────────────
# Modely
# ─────────────────────────────────────────────

class GenerateSTLRequest(BaseModel):
    """Request body pre /generate-stl."""
    text: str = Field(..., min_length=1, max_length=50, description="Text nápisu")
    font_path: str = Field(
        default="stl-generator/fonts/Roboto-Bold.ttf",
        description="Cesta k TTF/OTF fontu",
    )
    letter_height_mm: float = Field(
        default=200.0, ge=20, le=2000,
        description="Výška písmen v mm",
    )
    depth_mm: float = Field(
        default=50.0, ge=10, le=200,
        description="Hĺbka (hrúbka) písmen v mm",
    )
    lighting_type: str = Field(
        default="front",
        description="Typ podsvietenia: channel, channel_front, none, front, halo, front_halo",
    )
    material: str = Field(
        default="asa",
        description="Materiál: asa, abs, petg, pla",
    )
    letter_spacing_mm: float = Field(
        default=10.0, ge=0, le=100,
        description="Rozostup medzi písmenami v mm",
    )
    profile_type: str = Field(
        default="flat",
        description="Profil: flat, rounded, chamfer",
    )
    svg_content: Optional[str] = Field(
        default=None,
        description="SVG obsah pre logo (namiesto textu)",
    )
    wall_thickness_mm: Optional[float] = Field(
        default=None, ge=1.0, le=10.0,
        description="Vlastná hrúbka steny v mm (prepisuje predvoľbu z lighting_type)",
    )
    
    # ── Preset overrides (z DB cez Next.js API proxy) ──
    face_thickness_mm: Optional[float] = Field(default=None)
    back_panel_thickness_mm: Optional[float] = Field(default=None)
    face_is_separate: Optional[bool] = Field(default=None)
    face_is_translucent: Optional[bool] = Field(default=None)
    face_inset_mm: Optional[float] = Field(default=None)
    external_wall_recess_mm: Optional[float] = Field(default=None)
    internal_wall_recess_mm: Optional[float] = Field(default=None)
    acrylic_thickness_mm: Optional[float] = Field(default=None)
    acrylic_clearance_mm: Optional[float] = Field(default=None)
    back_is_open: Optional[bool] = Field(default=None)
    back_standoff_mm: Optional[float] = Field(default=None)
    led_module: Optional[str] = Field(default=None)
    led_cavity_depth_mm: Optional[float] = Field(default=None)
    led_cavity_offset_mm: Optional[float] = Field(default=None)
    led_base_thickness_mm: Optional[float] = Field(default=None)
    internal_walls: Optional[bool] = Field(default=None)
    inner_lining_mm: Optional[float] = Field(default=None)
    bottom_thickness_mm: Optional[float] = Field(default=None)
    mounting_hole_diameter_mm: Optional[float] = Field(default=None)
    mounting_hole_spacing_mm: Optional[float] = Field(default=None)
    mounting_tab_size_mm: Optional[float] = Field(default=None)
    standoff_length_mm: Optional[float] = Field(default=None)
    vent_hole_diameter_mm: Optional[float] = Field(default=None)
    vent_hole_spacing_mm: Optional[float] = Field(default=None)
    max_single_piece_mm: Optional[float] = Field(default=None)
    rib_spacing_mm: Optional[float] = Field(default=None)
    rib_thickness_mm: Optional[float] = Field(default=None)
    geometry_precision: Optional[int] = Field(default=None)


class GenerateSTLResponse(BaseModel):
    """Response pre /generate-stl."""
    job_id: str
    download_url: str
    total_parts: int
    total_weight_g: float
    total_led_count: int
    lighting_type: str
    material: str
    letters: list


class LetterInfo(BaseModel):
    char: str
    width_mm: float
    height_mm: float
    depth_mm: float
    parts_count: int
    is_segmented: bool
    segment_count: int
    led_count: int
    weight_g: float
    parts: list


class PartInfo(BaseModel):
    name: str
    filename: str
    part_type: str
    description: str


# ─────────────────────────────────────────────
# Endpointy
# ─────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "service": "adsun-stl-generator",
        "version": "1.0.0",
        "cadquery": True,
    }


@app.post("/generate-stl", response_model=GenerateSTLResponse)
async def generate_stl(req: GenerateSTLRequest):
    """
    Generovať výrobné STL súbory pre celý nápis.
    
    Vracia job_id a download URL pre ZIP so všetkými STL.
    """
    # Validácia
    if req.lighting_type not in MANUFACTURING_RULES:
        raise HTTPException(
            status_code=400,
            detail=f"Neznámy lighting_type: {req.lighting_type}. "
                   f"Povolené: {list(MANUFACTURING_RULES.keys())}",
        )
    
    if req.material not in MATERIALS:
        raise HTTPException(
            status_code=400,
            detail=f"Neznámy materiál: {req.material}. "
                   f"Povolené: {list(MATERIALS.keys())}",
        )
    
    # Overiť font – resolovať relatívne cesty voči STL_GENERATOR_ROOT
    font_path_resolved = req.font_path
    if not os.path.isabs(font_path_resolved):
        # Skúsiť najprv relatívne k stl-generator/ adresáru
        candidate = str(STL_GENERATOR_ROOT / font_path_resolved)
        if os.path.exists(candidate):
            font_path_resolved = candidate
        # Ak nie, skúsiť relatívne k CWD (pre prípad lokálneho spustenia)
        elif not os.path.exists(font_path_resolved):
            # Fallback fonty
            fallback_fonts = [
                str(STL_GENERATOR_ROOT / "fonts" / "Roboto-Bold.ttf"),
                str(STL_GENERATOR_ROOT / "fonts" / "Oswald-Bold.ttf"),
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ]
            font_found = False
            for fb in fallback_fonts:
                if os.path.exists(fb):
                    font_path_resolved = fb
                    font_found = True
                    break
            
            if not font_found and not req.svg_content:
                raise HTTPException(
                    status_code=400,
                    detail=f"Font nenájdený: {req.font_path} (root: {STL_GENERATOR_ROOT})",
                )
    
    req.font_path = font_path_resolved
    print(f"[STL] Using font: {req.font_path}")
    
    # ── Zostaviť ManufacturingRule z default + preset overrides ──
    rules = get_rules(req.lighting_type)
    
    # Aplikovať preset overrides na rules
    from dataclasses import replace as dc_replace
    overrides = {}
    
    # Mapovanie: request field → ManufacturingRule field
    FIELD_MAP = {
        'wall_thickness_mm': 'wall_thickness',
        'face_thickness_mm': 'face_thickness',
        'back_panel_thickness_mm': 'back_panel_thickness',
        'face_is_separate': 'face_is_separate',
        'face_is_translucent': 'face_is_translucent',
        'face_inset_mm': 'face_inset',
        'external_wall_recess_mm': 'external_wall_recess',
        'internal_wall_recess_mm': 'internal_wall_recess',
        'acrylic_thickness_mm': 'acrylic_thickness',
        'acrylic_clearance_mm': 'acrylic_clearance',
        'back_is_open': 'back_is_open',
        'back_standoff_mm': 'back_standoff',
        'led_module': 'led_module',
        'led_cavity_depth_mm': 'led_cavity_depth',
        'led_cavity_offset_mm': 'led_cavity_offset',
        'led_base_thickness_mm': 'led_base_thickness',
        'internal_walls': 'internal_walls',
        'inner_lining_mm': 'inner_lining',
        'bottom_thickness_mm': 'bottom_thickness',
        'mounting_hole_diameter_mm': 'mounting_hole_diameter',
        'mounting_hole_spacing_mm': 'mounting_hole_spacing',
        'mounting_tab_size_mm': 'mounting_tab_size',
        'standoff_length_mm': 'standoff_length',
        'vent_hole_diameter_mm': 'vent_hole_diameter',
        'vent_hole_spacing_mm': 'vent_hole_spacing',
        'max_single_piece_mm': 'max_single_piece',
        'rib_spacing_mm': 'rib_spacing',
        'rib_thickness_mm': 'rib_thickness',
    }
    
    for req_field, rule_field in FIELD_MAP.items():
        val = getattr(req, req_field, None)
        if val is not None:
            overrides[rule_field] = val
    
    if overrides:
        rules = dc_replace(rules, **overrides)
        print(f"[STL] Applied {len(overrides)} preset overrides: "
              f"{', '.join(f'{k}={v}' for k, v in overrides.items())}")
    
    print(f"[STL] Rules: wall={rules.wall_thickness}mm, "
          f"recess={rules.external_wall_recess}mm, "
          f"acrylic={rules.acrylic_thickness}mm, "
          f"face_inset={rules.face_inset}mm, "
          f"face_separate={rules.face_is_separate}")
    
    try:
        result = generate_sign_stl(
            text=req.text,
            font_path=req.font_path,
            letter_height_mm=req.letter_height_mm,
            depth_mm=req.depth_mm,
            lighting_type=req.lighting_type,
            material=req.material,
            letter_spacing_mm=req.letter_spacing_mm,
            profile_type=req.profile_type,
            svg_content=req.svg_content,
            rules_override=rules,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Chyba generovania: {str(e)}",
        )
    
    # Zostaviť response
    letters_info = []
    for letter in result.letters:
        parts_info = [
            {
                "name": p.name,
                "filename": p.filename,
                "part_type": p.part_type,
                "description": p.description,
            }
            for p in letter.parts
        ]
        letters_info.append({
            "char": letter.char,
            "width_mm": round(letter.width_mm, 1),
            "height_mm": round(letter.height_mm, 1),
            "depth_mm": round(letter.depth_mm, 1),
            "parts_count": len(letter.parts),
            "is_segmented": letter.is_segmented,
            "segment_count": letter.segment_count,
            "led_count": letter.led_count,
            "weight_g": round(letter.estimated_weight_g, 0),
            "parts": parts_info,
        })
    
    return GenerateSTLResponse(
        job_id=result.job_id,
        download_url=f"/download/{result.job_id}",
        total_parts=result.total_parts,
        total_weight_g=round(result.total_weight_g, 0),
        total_led_count=result.total_led_count,
        lighting_type=result.lighting_type,
        material=result.material,
        letters=letters_info,
    )


@app.get("/download/{job_id}")
async def download_stl(job_id: str):
    """Stiahnuť ZIP so všetkými STL súbormi."""
    zip_path = os.path.join(OUTPUT_DIR, f"{job_id}_sign.zip")
    
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="ZIP súbor nenájdený")
    
    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"adsun_sign_{job_id}.zip",
    )


@app.get("/stl-file/{job_id}/{filename}")
async def get_stl_file(job_id: str, filename: str):
    """
    Získať jednotlivý STL súbor pre 3D náhľad v prehliadači.
    
    Hľadá v job adresári aj v ZIP súbore.
    """
    import tempfile
    
    # Bezpečnostná kontrola filename
    if '..' in filename or '/' in filename:
        raise HTTPException(status_code=400, detail="Neplatný názov súboru")
    
    # 1. Skúsiť priamo z job adresára
    direct_path = os.path.join(OUTPUT_DIR, job_id, filename)
    if os.path.exists(direct_path):
        return FileResponse(
            path=direct_path,
            media_type="application/sla",
            filename=filename,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600",
            },
        )
    
    # 2. Extrahovať zo ZIP
    zip_path = os.path.join(OUTPUT_DIR, f"{job_id}_sign.zip")
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Job nenájdený")
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Hľadať súbor v ZIP (môže byť v podadresári)
            for name in zf.namelist():
                if name.endswith(filename):
                    # Extrahovať do temp
                    temp_dir = tempfile.mkdtemp(prefix="stl_preview_")
                    extracted = zf.extract(name, temp_dir)
                    return FileResponse(
                        path=extracted,
                        media_type="application/sla",
                        filename=filename,
                        headers={
                            "Access-Control-Allow-Origin": "*",
                            "Cache-Control": "public, max-age=3600",
                        },
                    )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chyba extrakcie: {str(e)}")
    
    raise HTTPException(status_code=404, detail=f"STL súbor '{filename}' nenájdený")


@app.get("/stl-files/{job_id}")
async def list_stl_files(job_id: str):
    """Zoznam všetkých STL súborov pre daný job."""
    zip_path = os.path.join(OUTPUT_DIR, f"{job_id}_sign.zip")
    
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Job nenájdený")
    
    files = []
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            for name in zf.namelist():
                if name.lower().endswith('.stl'):
                    info = zf.getinfo(name)
                    files.append({
                        "path": name,
                        "filename": Path(name).name,
                        "size_bytes": info.file_size,
                    })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    return {"job_id": job_id, "files": files}


@app.get("/rules/{lighting_type}")
async def get_manufacturing_rules(lighting_type: str):
    """Získať výrobné pravidlá pre daný typ podsvietenia."""
    if lighting_type == 'all':
        return {k: _rule_to_dict(v) for k, v in MANUFACTURING_RULES.items()}
    
    if lighting_type not in MANUFACTURING_RULES:
        raise HTTPException(
            status_code=404,
            detail=f"Neznámy typ: {lighting_type}",
        )
    
    return _rule_to_dict(MANUFACTURING_RULES[lighting_type])


@app.get("/materials")
async def get_materials():
    """Získať dostupné materiály."""
    return {
        k: {
            "name": v.name,
            "min_wall_thickness": v.min_wall_thickness,
            "max_print_size": v.max_print_size,
            "uv_resistant": v.uv_resistant,
            "max_temperature": v.max_temperature,
        }
        for k, v in MATERIALS.items()
    }


@app.get("/led-modules")
async def get_led_modules():
    """Získať dostupné LED moduly."""
    return {
        k: {
            "name": v.name,
            "width": v.width,
            "height": v.height,
            "depth": v.depth,
            "spacing": v.spacing,
            "power_per_module": v.power_per_module,
            "voltage": v.voltage,
        }
        for k, v in LED_MODULES.items()
    }


# ─────────────────────────────────────────────
# PNG → SVG Vektorizácia
# ─────────────────────────────────────────────

class VectorizeRequest(BaseModel):
    """Request body pre /vectorize."""
    image_base64: str = Field(
        ..., description="Base64-encoded PNG obrázok (s alebo bez data: prefix)"
    )
    target_height_mm: float = Field(
        default=200.0, ge=10, le=2000,
        description="Cieľová výška v mm",
    )
    threshold: int = Field(
        default=128, ge=0, le=255,
        description="Prah binarizácie (0-255)",
    )
    invert: bool = Field(
        default=False,
        description="Invertovať farby (pre tmavé logá)",
    )
    blur_radius: float = Field(
        default=1.0, ge=0, le=10,
        description="Gaussian blur radius",
    )
    simplify_tolerance: float = Field(
        default=1.0, ge=0.1, le=10,
        description="Tolerancia zjednodušenia kontúr",
    )
    min_area: int = Field(
        default=100, ge=1, le=10000,
        description="Minimálna plocha kontúry v pixeloch",
    )


class VectorizeResponse(BaseModel):
    """Response pre /vectorize."""
    svg: str
    width: float
    height: float
    contour_count: int
    method: str


@app.post("/vectorize", response_model=VectorizeResponse)
async def vectorize_png(req: VectorizeRequest):
    """
    Konvertuje PNG obrázok na SVG vektorovú grafiku.

    Ideálne pre AI-generované logá (DALL-E, Midjourney) → 3D tlač.
    Automaticky:
      - Odstráni pozadie
      - Binarizuje obrázok
      - Vektorizuje kontúry
      - Škáluje na požadovanú výšku v mm

    Metóda: potrace CLI (ak nainštalovaný) alebo pure Python fallback.
    Inštalácia potrace: brew install potrace
    """
    try:
        result = png_base64_to_svg(
            png_base64=req.image_base64,
            target_height_mm=req.target_height_mm,
            threshold=req.threshold,
            invert=req.invert,
            blur_radius=req.blur_radius,
            simplify_tolerance=req.simplify_tolerance,
            min_area=req.min_area,
        )
        return VectorizeResponse(**result)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Vektorizácia zlyhala: {str(e)}",
        )


# ─────────────────────────────────────────────
# QR kód prívesok
# ─────────────────────────────────────────────

class GenerateQrKeychainRequest(BaseModel):
    """Request body pre /generate-qr-keychain."""
    qr_data: str = Field(..., min_length=1, description="Údaje pre QR kód (qrToken)")
    employee_name: str = Field(default="", description="Meno zamestnanca")
    plate_width_mm: float = Field(default=40.0, ge=20, le=100, description="Šírka dosky v mm")
    plate_height_mm: float = Field(default=50.0, ge=25, le=120, description="Výška dosky v mm")
    plate_thickness_mm: float = Field(default=2.0, ge=1.0, le=5.0, description="Hrúbka dosky v mm")
    qr_module_height_mm: float = Field(default=0.8, ge=0.3, le=3.0, description="Výška QR modulov v mm")
    corner_radius_mm: float = Field(default=3.0, ge=0, le=10, description="Polomer zaoblenia rohov")
    hole_diameter_mm: float = Field(default=4.0, ge=2.0, le=8.0, description="Priemer dierky")


class GenerateQrKeychainResponse(BaseModel):
    """Response pre /generate-qr-keychain."""
    job_id: str
    download_url: str
    files: list
    qr_size_mm: float
    plate_size: list
    module_count: int


@app.post("/generate-qr-keychain", response_model=GenerateQrKeychainResponse)
async def generate_qr_keychain(req: GenerateQrKeychainRequest):
    """
    Generovať STL súbory pre QR kód prívesok na kľúče.

    Výstup: ZIP s 2 STL súbormi:
      - base_plate.stl (čierny filament)
      - qr_modules.stl (biely filament)
    """
    try:
        result = generate_qr_keychain_stl(
            qr_data=req.qr_data,
            employee_name=req.employee_name,
            plate_width_mm=req.plate_width_mm,
            plate_height_mm=req.plate_height_mm,
            plate_thickness_mm=req.plate_thickness_mm,
            qr_module_height_mm=req.qr_module_height_mm,
            corner_radius_mm=req.corner_radius_mm,
            hole_diameter_mm=req.hole_diameter_mm,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"QR STL generovanie zlyhalo: {str(e)}",
        )

    return GenerateQrKeychainResponse(
        job_id=result.job_id,
        download_url=f"/download-qr/{result.job_id}",
        files=result.files,
        qr_size_mm=round(result.qr_size_mm, 1),
        plate_size=[result.plate_size_mm[0], result.plate_size_mm[1]],
        module_count=result.module_count,
    )


@app.get("/download-qr/{job_id}")
async def download_qr_keychain(job_id: str):
    """Stiahnuť ZIP s QR kód STL súbormi."""
    zip_path = os.path.join(OUTPUT_DIR, f"qr_{job_id}_keychain.zip")

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="QR ZIP súbor nenájdený")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"qr_keychain_{job_id}.zip",
    )


# ─────────────────────────────────────────────
# Bambu Lab integrácia
# ─────────────────────────────────────────────

class BambuPrinterConfig(BaseModel):
    """Konfigurácia Bambu Lab tlačiarne."""
    name: str = Field(default="Bambu Lab Printer", description="Názov tlačiarne")
    ip: str = Field(..., description="IP adresa tlačiarne v LAN")
    serial: str = Field(default="", description="Sériové číslo tlačiarne")
    access_code: str = Field(..., description="Access code (z displeja tlačiarne)")
    model: str = Field(default="x1c", description="Model: x1c, p1s, p1p, a1, a1_mini")


class SendToBambuRequest(BaseModel):
    """Request pre odoslanie na Bambu Lab."""
    job_id: str = Field(..., description="ID jobu z /generate-stl")
    printer: BambuPrinterConfig
    auto_start: bool = Field(default=False, description="Automaticky spustiť tlač")
    print_settings: Optional[dict] = Field(default=None, description="Nastavenia tlače")


class ConvertTo3MFRequest(BaseModel):
    """Request pre konverziu na .3MF."""
    job_id: str = Field(..., description="ID jobu z /generate-stl")
    project_name: str = Field(default="ADSUN Sign", description="Názov projektu")
    material: str = Field(default="ASA", description="Materiál")
    printer_model: str = Field(default="x1c", description="Model tlačiarne")
    print_settings: Optional[dict] = Field(default=None, description="Nastavenia tlače")


@app.post("/convert-to-3mf")
async def convert_to_3mf(req: ConvertTo3MFRequest):
    """
    Konvertuje vygenerované STL (z jobu) na .3MF formát pre Bambu Studio.
    
    .3MF je natívny formát Bambu Lab Studio, ktorý obsahuje:
    - 3D modely (mesh dáta)
    - Nastavenia tlače (materiál, teploty, infill, podpery)
    - Rozloženie na platni
    
    Po konverzii si .3mf otvoríte priamo v Bambu Studio.
    """
    zip_path = os.path.join(OUTPUT_DIR, f"{req.job_id}_sign.zip")
    
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Job nenájdený. Najprv vygenerujte STL.")
    
    output_3mf = os.path.join(OUTPUT_DIR, f"{req.job_id}_bambu.3mf")
    
    try:
        convert_stl_zip_to_3mf(
            zip_path=zip_path,
            output_3mf_path=output_3mf,
            project_name=req.project_name,
            material=req.material,
            printer_model=req.printer_model,
            print_settings=req.print_settings or {},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Konverzia na .3MF zlyhala: {str(e)}")
    
    return {
        "success": True,
        "download_url": f"/download-3mf/{req.job_id}",
        "filename": f"adsun_sign_{req.job_id}.3mf",
        "printer_model": req.printer_model,
        "material": req.material,
    }


@app.get("/download-3mf/{job_id}")
async def download_3mf(job_id: str):
    """Stiahnuť .3MF súbor pre Bambu Studio."""
    path = os.path.join(OUTPUT_DIR, f"{job_id}_bambu.3mf")
    
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=".3MF súbor nenájdený")
    
    return FileResponse(
        path=path,
        media_type="application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        filename=f"adsun_sign_{job_id}.3mf",
    )


@app.post("/send-to-bambu")
async def send_to_bambu(req: SendToBambuRequest):
    """
    Odošle vygenerované STL priamo na Bambu Lab tlačiareň.
    
    Postup:
      1. Konvertuje STL → .3MF
      2. Upload .3MF na SD kartu tlačiarne cez FTP
      3. (Voliteľne) Spustí tlač cez MQTT
      
    Vyžaduje:
      - Tlačiareň na rovnakej sieti
      - IP adresa + access code (z displeja tlačiarne)
    """
    # 1. Overiť, že job existuje
    zip_path = os.path.join(OUTPUT_DIR, f"{req.job_id}_sign.zip")
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Job nenájdený. Najprv vygenerujte STL.")
    
    # 2. Konvertovať na .3MF
    output_3mf = os.path.join(OUTPUT_DIR, f"{req.job_id}_bambu.3mf")
    try:
        convert_stl_zip_to_3mf(
            zip_path=zip_path,
            output_3mf_path=output_3mf,
            project_name=f"ADSUN Sign {req.job_id[:8]}",
            material=req.print_settings.get("material", "ASA") if req.print_settings else "ASA",
            printer_model=req.printer.model,
            print_settings=req.print_settings or {},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Konverzia na .3MF zlyhala: {str(e)}")
    
    # 3. Pripojiť sa k tlačiarni a odoslať
    printer = BambuPrinter(
        name=req.printer.name,
        ip=req.printer.ip,
        serial=req.printer.serial,
        access_code=req.printer.access_code,
        model=req.printer.model,
    )
    
    conn = BambuConnection(printer)
    result = conn.upload_and_print(
        file_path=output_3mf,
        filename=f"adsun_{req.job_id[:8]}.3mf",
        auto_start=req.auto_start,
    )
    
    return result


@app.post("/bambu/status")
async def bambu_printer_status(printer: BambuPrinterConfig):
    """Získať aktuálny stav Bambu Lab tlačiarne."""
    bp = BambuPrinter(
        name=printer.name,
        ip=printer.ip,
        serial=printer.serial,
        access_code=printer.access_code,
        model=printer.model,
    )
    
    conn = BambuConnection(bp)
    return conn.get_status()


@app.get("/bambu/printer-profiles")
async def get_printer_profiles():
    """Získať dostupné profily Bambu Lab tlačiarní."""
    return {
        "profiles": {
            k: {
                "name": _printer_name(k),
                **v,
            }
            for k, v in PRINTER_PROFILES.items()
        }
    }


def _printer_name(model: str) -> str:
    """Čitateľný názov tlačiarne."""
    names = {
        "x1c": "Bambu Lab X1 Carbon",
        "p1s": "Bambu Lab P1S",
        "p1p": "Bambu Lab P1P",
        "a1": "Bambu Lab A1",
        "a1_mini": "Bambu Lab A1 Mini",
    }
    return names.get(model, f"Bambu Lab ({model})")


def _rule_to_dict(rule: ManufacturingRule) -> dict:
    """Konvertovať ManufacturingRule na dict."""
    return {
        field: getattr(rule, field)
        for field in rule.__dataclass_fields__
    }
