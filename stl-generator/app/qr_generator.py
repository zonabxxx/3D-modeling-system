"""
qr_generator.py – Generovanie 3D tlačiteľných QR kódov na prívesok

Výstup: 1 × 3MF súbor v NATÍVNOM Bambu Studio formáte:
  - 2 objekty (base_plate + qr_modules) ako časti jedného assembly
  - Metadata/model_settings.config s priradením extrudérov
  - Extrudér 1 = Čierny filament (base plate)
  - Extrudér 2 = Biely filament (QR kód)

Bambu Studio: File → Open → qr_keychain.3mf → hotové, 2 farby automaticky.
"""

import os
import struct
import uuid
import zipfile
import shutil
from typing import List, Tuple
from dataclasses import dataclass

import cadquery as cq

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    HAS_QRCODE = True
except ImportError:
    HAS_QRCODE = False

from .letter_generator import OUTPUT_DIR, _export_stl


@dataclass
class QrKeychainResult:
    """Výsledok generovania QR príveskov."""
    job_id: str
    zip_path: str
    files: list
    qr_size_mm: float
    plate_size_mm: tuple
    module_count: int


# ═══════════════════════════════════════════════════════════════════════════════
#  STL PARSING
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_binary_stl(filepath: str) -> Tuple[List[Tuple[float, ...]], List[Tuple[int, ...]]]:
    """Parsovať binárny STL → (vertices, triangles)."""
    with open(filepath, 'rb') as f:
        f.read(80)  # header
        num_tris = struct.unpack('<I', f.read(4))[0]
        vertices, triangles, vmap = [], [], {}

        for _ in range(num_tris):
            struct.unpack('<3f', f.read(12))  # normal
            v1 = struct.unpack('<3f', f.read(12))
            v2 = struct.unpack('<3f', f.read(12))
            v3 = struct.unpack('<3f', f.read(12))
            struct.unpack('<H', f.read(2))  # attr

            tri = []
            for v in (v1, v2, v3):
                key = (round(v[0], 6), round(v[1], 6), round(v[2], 6))
                if key not in vmap:
                    vmap[key] = len(vertices)
                    vertices.append(v)
                tri.append(vmap[key])
            triangles.append(tuple(tri))

    return vertices, triangles


def _mesh_to_xml(vertices: list, triangles: list) -> str:
    """Konvertovať mesh na 3MF XML <mesh> element."""
    lines = ["        <mesh>", "          <vertices>"]
    for vx, vy, vz in vertices:
        lines.append(f'            <vertex x="{vx:.6f}" y="{vy:.6f}" z="{vz:.6f}"/>')
    lines.append("          </vertices>")
    lines.append("          <triangles>")
    for v1, v2, v3 in triangles:
        lines.append(f'            <triangle v1="{v1}" v2="{v2}" v3="{v3}"/>')
    lines.append("          </triangles>")
    lines.append("        </mesh>")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
#  BAMBU STUDIO 3MF GENERATOR
# ═══════════════════════════════════════════════════════════════════════════════

def _create_bambu_3mf(
    stl_paths: List[str],
    part_names: List[str],
    extruder_ids: List[int],
    assembly_name: str,
    output_path: str,
):
    """
    Vytvoriť .3mf v natívnom Bambu Studio formáte.

    stl_paths:     cesty k STL súborom
    part_names:    mená častí ["base_plate", "qr_modules"]
    extruder_ids:  čísla extrudérov [1, 2]
    assembly_name: meno zostavy "QR Keychain"
    output_path:   výstupný .3mf
    """
    # ── Parse STL meshes ──
    meshes = []
    for i, path in enumerate(stl_paths):
        verts, tris = _parse_binary_stl(path)
        meshes.append((verts, tris))
        print(f"[3MF] Part '{part_names[i]}': {len(verts)} verts, {len(tris)} tris → extruder {extruder_ids[i]}")

    # ── 3D/3dmodel.model ──
    # Object IDs: 1, 2, ... = parts;  N+1 = assembly
    part_object_ids = list(range(1, len(meshes) + 1))
    assembly_id = len(meshes) + 1

    model_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<model unit="millimeter"',
        '  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"',
        '  xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"',
        '  xml:lang="en-US">',
        '  <metadata name="BambuStudio:3mfVersion">1</metadata>',
        '  <resources>',
    ]

    # Part objects
    for idx, ((verts, tris), name, obj_id) in enumerate(zip(meshes, part_names, part_object_ids)):
        model_lines.append(f'    <object id="{obj_id}" type="model">')
        model_lines.append(_mesh_to_xml(verts, tris))
        model_lines.append(f'    </object>')

    # Assembly object (components)
    model_lines.append(f'    <object id="{assembly_id}" type="model">')
    model_lines.append(f'      <components>')
    for obj_id in part_object_ids:
        model_lines.append(f'        <component objectid="{obj_id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>')
    model_lines.append(f'      </components>')
    model_lines.append(f'    </object>')

    model_lines.append('  </resources>')
    model_lines.append('  <build>')
    model_lines.append(f'    <item objectid="{assembly_id}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>')
    model_lines.append('  </build>')
    model_lines.append('</model>')

    model_xml = "\n".join(model_lines)

    # ── Metadata/model_settings.config (KĽÚČOVÝ SÚBOR pre Bambu Studio) ──
    config_lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<config>',
        '  <plate>',
        '    <metadata key="plater_id" value="1"/>',
        '    <metadata key="plater_name" value=""/>',
        '    <metadata key="locked" value="false"/>',
        '  </plate>',
        f'  <object id="{assembly_id}">',
        f'    <metadata key="name" value="{assembly_name}"/>',
    ]

    for obj_id, name, extruder in zip(part_object_ids, part_names, extruder_ids):
        config_lines.extend([
            f'    <part id="{obj_id}" subtype="normal_part">',
            f'      <metadata key="name" value="{name}"/>',
            f'      <metadata key="matrix" value="1 0 0 0 1 0 0 0 1 0 0 0 0 0 0 0"/>',
            f'      <metadata key="source_file" value="{name}.stl"/>',
            f'      <metadata key="source_object_id" value="0"/>',
            f'      <metadata key="source_volume_id" value="0"/>',
            f'      <metadata key="extruder" value="{extruder}"/>',
            f'    </part>',
        ])

    config_lines.extend([
        f'  </object>',
        '</config>',
    ])

    config_xml = "\n".join(config_lines)

    # ── [Content_Types].xml ──
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '<Default Extension="config" ContentType="text/xml"/>'
        '</Types>'
    )

    # ── _rels/.rels ──
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>'
    )

    # ── Zabaliť do ZIP (.3mf) ──
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("3D/3dmodel.model", model_xml)
        zf.writestr("Metadata/model_settings.config", config_xml)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"[3MF] Created Bambu Studio 3MF: {output_path} ({size_kb:.0f} KB)")
    print(f"[3MF] Parts: {', '.join(f'{n} → extruder {e}' for n, e in zip(part_names, extruder_ids))}")


# ═══════════════════════════════════════════════════════════════════════════════
#  HLAVNÝ GENERÁTOR
# ═══════════════════════════════════════════════════════════════════════════════

def generate_qr_keychain_stl(
    qr_data: str,
    employee_name: str = "",
    plate_width_mm: float = 40.0,
    plate_height_mm: float = 50.0,
    plate_thickness_mm: float = 2.0,
    qr_module_height_mm: float = 0.8,
    corner_radius_mm: float = 3.0,
    hole_diameter_mm: float = 4.0,
    hole_margin_mm: float = 4.0,
    qr_margin_mm: float = 3.0,
    text_enabled: bool = True,
) -> QrKeychainResult:
    """
    Generovať 3MF pre QR kód prívesok (Bambu Lab H2D multi-color).

    Výstup v natívnom Bambu Studio formáte:
      - qr_keychain.3mf s 2 časťami (parts) a Metadata/model_settings.config
      - Extrudér 1 = čierny základ
      - Extrudér 2 = biely QR kód
    """
    if not HAS_QRCODE:
        raise RuntimeError("Knižnica 'qrcode' nie je nainštalovaná.")

    job_id = str(uuid.uuid4())[:8]
    job_dir = os.path.join(OUTPUT_DIR, f"qr_{job_id}")
    os.makedirs(job_dir, exist_ok=True)

    total_height = plate_thickness_mm + qr_module_height_mm

    # ── 1. QR matica ──
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_H, box_size=1, border=0)
    qr.add_data(qr_data)
    qr.make(fit=True)
    matrix = qr.modules
    qr_n = len(matrix)

    print(f"[QR] Job {job_id}: '{qr_data[:30]}...', {qr_n}x{qr_n} matrix")

    # ── 2. Rozmery ──
    qr_area_w = plate_width_mm - 2 * qr_margin_mm
    top_res = hole_margin_mm + hole_diameter_mm / 2 + 2.0
    qr_area_h = plate_height_mm - qr_margin_mm - top_res
    qr_area = min(qr_area_w, qr_area_h)
    mod_sz = qr_area / qr_n
    qr_total = mod_sz * qr_n
    qr_x0 = -qr_total / 2
    qr_y0 = -plate_height_mm / 2 + qr_margin_mm

    print(f"[QR] Module: {mod_sz:.2f}mm, Plate: {plate_width_mm}x{plate_height_mm}x{total_height}mm")

    # ── 3. Base plate (celková výška + vyrezané QR recesy) ──
    base = (
        cq.Workplane("XY")
        .rect(plate_width_mm, plate_height_mm)
        .extrude(total_height)
    )
    try:
        base = base.edges("|Z").fillet(corner_radius_mm)
    except Exception:
        try:
            base = base.edges("|Z").chamfer(corner_radius_mm * 0.7)
        except Exception:
            pass

    hole_y = plate_height_mm / 2 - hole_margin_mm
    try:
        base = base.faces(">Z").workplane().center(0, hole_y).hole(hole_diameter_mm)
    except Exception as e:
        print(f"[QR] Hole failed: {e}")

    # ── 4. QR moduly ──
    qr_solid = None
    mod_count = 0

    for ri, row in enumerate(matrix):
        for ci, dark in enumerate(row):
            if not dark:
                continue
            mx = qr_x0 + ci * mod_sz + mod_sz / 2
            my = qr_y0 + (qr_n - 1 - ri) * mod_sz + mod_sz / 2

            box = (
                cq.Workplane("XY")
                .transformed(offset=cq.Vector(mx, my, plate_thickness_mm))
                .rect(mod_sz - 0.02, mod_sz - 0.02)
                .extrude(qr_module_height_mm)
            )
            if qr_solid is None:
                qr_solid = box
            else:
                try:
                    qr_solid = qr_solid.union(box)
                except Exception:
                    qr_solid = qr_solid.add(box)
            mod_count += 1

    if qr_solid is None:
        raise RuntimeError("Žiadne QR moduly")
    print(f"[QR] {mod_count} modules built")

    # ── 5. Vyrezať QR z base ──
    qr_cut = None
    for ri, row in enumerate(matrix):
        for ci, dark in enumerate(row):
            if not dark:
                continue
            mx = qr_x0 + ci * mod_sz + mod_sz / 2
            my = qr_y0 + (qr_n - 1 - ri) * mod_sz + mod_sz / 2
            cut = (
                cq.Workplane("XY")
                .transformed(offset=cq.Vector(mx, my, plate_thickness_mm - 0.01))
                .rect(mod_sz, mod_sz)
                .extrude(qr_module_height_mm + 0.02)
            )
            if qr_cut is None:
                qr_cut = cut
            else:
                try:
                    qr_cut = qr_cut.union(cut)
                except Exception:
                    qr_cut = qr_cut.add(cut)

    try:
        base_final = base.cut(qr_cut)
        print(f"[QR] Base recess cut ✓")
    except Exception as e:
        print(f"[QR] Cut failed ({e})")
        base_final = base

    # ── 6. Export dočasné STL ──
    base_stl = os.path.join(job_dir, "base_plate.stl")
    qr_stl = os.path.join(job_dir, "qr_modules.stl")
    _export_stl(base_final, base_stl)
    _export_stl(qr_solid, qr_stl)

    # ── 7. Vytvoriť Bambu Studio 3MF ──
    threemf_path = os.path.join(job_dir, "qr_keychain.3mf")
    _create_bambu_3mf(
        stl_paths=[base_stl, qr_stl],
        part_names=["base_plate", "qr_modules"],
        extruder_ids=[1, 2],  # 1 = čierny, 2 = biely
        assembly_name=f"QR Keychain - {employee_name}" if employee_name else "QR Keychain",
        output_path=threemf_path,
    )

    # ── 8. Finálny ZIP ──
    files_info = [
        {
            "filename": "qr_keychain.3mf",
            "description": "Bambu Studio – 2 časti, 2 extrudéry (OTVOR TOTO)",
            "color": "multi",
        },
        {
            "filename": "base_plate.stl",
            "description": f"Záloha – základ {plate_width_mm}x{plate_height_mm}x{total_height}mm (ČIERNY)",
            "color": "black",
        },
        {
            "filename": "qr_modules.stl",
            "description": f"Záloha – QR {mod_count} modulov (BIELY)",
            "color": "white",
        },
    ]

    navod = _build_navod(
        employee_name, qr_data, plate_width_mm, plate_height_mm,
        total_height, qr_module_height_mm, mod_sz, mod_count,
        hole_diameter_mm, qr_total,
    )

    zip_path = os.path.join(OUTPUT_DIR, f"qr_{job_id}_keychain.zip")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in files_info:
            fpath = os.path.join(job_dir, f["filename"])
            if os.path.exists(fpath):
                zf.write(fpath, f["filename"])
        zf.writestr("NAVOD.txt", navod)

    print(f"[QR] ZIP: {zip_path}")
    shutil.rmtree(job_dir, ignore_errors=True)

    return QrKeychainResult(
        job_id=job_id,
        zip_path=zip_path,
        files=files_info,
        qr_size_mm=qr_total,
        plate_size_mm=(plate_width_mm, plate_height_mm),
        module_count=mod_count,
    )


def _build_navod(name, data, pw, ph, th, qh, ms, mc, hd, qt) -> str:
    return "\n".join([
        "=" * 50,
        "QR PRÍVESOK – BAMBU STUDIO H2D",
        "=" * 50,
        f"Zamestnanec: {name}" if name else "",
        f"QR: {data[:50]}{'...' if len(data) > 50 else ''}",
        "",
        "IMPORT: File → Open → qr_keychain.3mf",
        "  Extrudér 1 (ľavý): ČIERNY filament",
        "  Extrudér 2 (pravý): BIELY filament",
        "  Slice → Print!",
        "",
        f"Rozmery: {pw}x{ph}x{th}mm",
        f"QR: {qt:.1f}mm, {mc} modulov, modul {ms:.2f}mm",
        f"Dierka: ⌀{hd}mm",
        "=" * 50,
    ])
