"""
letter_generator.py – Parametrické generovanie výrobných STL súborov

Pipeline pre jedno písmeno/logo:
  1. 2D obrys (z fontu alebo SVG)
  2. Extrúzia → plný blok
  3. Shell (dutý korpus) podľa pravidiel
  4. Generácia čela (face) – buď súčasť alebo samostatný diel
  5. Generácia zadného panelu (back) – s montážnymi dierami
  6. Montážne úchyty, ventilačné otvory
  7. Segmentácia ak je písmeno príliš veľké
  8. Export jednotlivých dielov do STL

Výrobné pravidlá sa berú z manufacturing_rules.py podľa lighting_type.
"""

import math
import os
import zipfile
import tempfile
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

import cadquery as cq

from .manufacturing_rules import (
    get_rules,
    ManufacturingRule,
    LED_MODULES,
    needs_segmentation,
    calculate_segments,
    estimate_led_count,
    estimate_weight_g,
)
from .font_utils import (
    text_to_letter_outlines,
    svg_to_contours,
    svg_to_letter_data,
    contours_to_cq_wire,
    svg_data_to_cq_workplane,
    Point,
)


# ─────────────────────────────────────────────
# Typy
# ─────────────────────────────────────────────

@dataclass
class GeneratedPart:
    """Jeden vygenerovaný STL diel."""
    name: str           # napr. "A_korpus", "A_celo", "A_zadok"
    filename: str       # napr. "A_korpus.stl"
    part_type: str      # 'shell', 'face', 'back', 'rib', 'connector'
    stl_path: str       # cesta k STL súboru
    volume_mm3: float   # objem pre odhad hmotnosti
    description: str    # popis dielu


@dataclass
class LetterResult:
    """Výsledok generovania pre jedno písmeno."""
    char: str
    parts: List[GeneratedPart]
    width_mm: float
    height_mm: float
    depth_mm: float
    is_segmented: bool
    segment_count: int
    led_count: int
    estimated_weight_g: float


@dataclass
class GenerationResult:
    """Celkový výsledok generovania."""
    job_id: str
    letters: List[LetterResult]
    zip_path: str               # cesta k ZIP súboru so všetkými STL
    total_parts: int
    total_weight_g: float
    total_led_count: int
    lighting_type: str
    material: str


# ─────────────────────────────────────────────
# Hlavný generátor
# ─────────────────────────────────────────────

OUTPUT_DIR = os.environ.get('STL_OUTPUT_DIR', '/tmp/stl-output')

# ── STL export kvalita ──
# tolerance = lineárna deflekcia v mm (menšia = hladší mesh)
# angularTolerance = uhlová tolerancia v radiánoch (menšia = hladší mesh)
# S natívnymi Bezier hranami OCCT kernel tesselluje krivky presne
STL_TOLERANCE = 0.005      # 5 mikrónov – veľmi hladké krivky
STL_ANGULAR_TOLERANCE = 0.02  # ~1.1° – jemná uhlov á diskretizácia


def _export_stl(solid, stl_path: str):
    """Export CadQuery solid do STL s vysokou kvalitou meshu + oprava non-manifold hrán."""
    
    # ═══ 1. OCCT Sewing – opraví topologické chyby z boolean operácií ═══
    try:
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing
        shape = solid.val().wrapped
        sew = BRepBuilderAPI_Sewing(STL_TOLERANCE * 10)
        sew.Add(shape)
        sew.Perform()
        n_free = sew.NbFreeEdges()
        n_multi = sew.NbMultipleEdges()
        if n_free > 0 or n_multi > 0:
            print(f"    OCCT Sewing: {n_free} free edges, {n_multi} multiple edges → fixing")
            sewn_shape = sew.SewedShape()
            solid = cq.Workplane("XY").newObject([cq.Shape(sewn_shape)])
    except Exception as e:
        print(f"    OCCT sewing skipped: {e}")
    
    # ═══ 2. CadQuery STL export ═══
    cq.exporters.export(
        solid, stl_path,
        exportType='STL',
        tolerance=STL_TOLERANCE,
        angularTolerance=STL_ANGULAR_TOLERANCE,
    )
    
    # ═══ 3. Trimesh repair – oprava non-manifold hrán, dier, normálov ═══
    try:
        import trimesh
        mesh = trimesh.load(stl_path)
        
        if not mesh.is_watertight:
            n_faces_before = len(mesh.faces)
            print(f"    ⚠ Mesh NOT watertight ({n_faces_before} faces) – repairing...")
            
            # Krok 1: Kompletný process (merge vertices, remove duplicates, fix normals)
            mesh.process(validate=True)
            
            # Krok 2: Odstrániť duplicitné faces
            unique_mask = mesh.unique_faces()
            mesh.update_faces(unique_mask)
            
            # Krok 3: Odstrániť degenerované faces (nulová plocha)
            nondegen_mask = mesh.nondegenerate_faces()
            mesh.update_faces(nondegen_mask)
            
            # Krok 4: Opraviť normály a orientáciu
            trimesh.repair.fix_normals(mesh)
            trimesh.repair.fix_winding(mesh)
            trimesh.repair.fix_inversion(mesh)
            
            # Krok 5: Vyplniť diery
            trimesh.repair.fill_holes(mesh)
            
            # Krok 6: Finálny process
            mesh.process(validate=True)
            
            mesh.export(stl_path)
            
            status = "✓ watertight" if mesh.is_watertight else "⚠ still has issues"
            print(f"    Mesh repair: {status}, "
                  f"{n_faces_before}→{len(mesh.faces)} faces, "
                  f"volume={mesh.volume:.0f} mm³")
        else:
            print(f"    ✓ Mesh watertight ({len(mesh.faces)} faces)")
    except ImportError:
        print(f"    ⚠ trimesh not installed – mesh repair skipped!")
    except Exception as e:
        import traceback
        print(f"    ⚠ Mesh repair error: {e}")
        traceback.print_exc()


def generate_sign_stl(
    text: str,
    font_path: str,
    letter_height_mm: float = 200.0,
    depth_mm: float = 50.0,
    lighting_type: str = 'front',
    material: str = 'asa',
    letter_spacing_mm: float = 10.0,
    profile_type: str = 'flat',  # flat / rounded / chamfer
    svg_content: Optional[str] = None,  # pre logo
    wall_thickness_mm: Optional[float] = None,  # vlastná hrúbka steny (legacy)
    rules_override: Optional[ManufacturingRule] = None,  # kompletné custom rules z presetu
) -> GenerationResult:
    """
    Hlavná funkcia – generuje kompletné výrobné STL pre celý nápis.
    
    Returns:
        GenerationResult so ZIP súborom obsahujúcim všetky STL.
    """
    job_id = str(uuid.uuid4())[:8]
    
    # Použiť custom rules z presetu, alebo default
    if rules_override is not None:
        rules = rules_override
    else:
        rules = get_rules(lighting_type)
        # Legacy: prepísať hrúbku steny
        if wall_thickness_mm is not None:
            from dataclasses import replace
            rules = replace(
                rules,
                wall_thickness=wall_thickness_mm,
                back_panel_thickness=wall_thickness_mm if rules.back_panel_thickness > 0 else 0,
            )
    
    # Vytvoriť output adresár
    job_dir = os.path.join(OUTPUT_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    print(f"\n{'='*60}")
    print(f"[STL] Job {job_id}: text='{text}', depth={depth_mm}mm, height={letter_height_mm}mm")
    print(f"[STL] Rules: wall={rules.wall_thickness}mm, "
          f"face={rules.face_thickness}mm (separate={rules.face_is_separate}), "
          f"back={rules.back_panel_thickness}mm (open={rules.back_is_open})")
    print(f"[STL] Recess: external={rules.external_wall_recess}mm, "
          f"face_inset={rules.face_inset}mm, "
          f"acrylic={rules.acrylic_thickness}mm")
    print(f"{'='*60}")
    
    # ── Získať obrysy ──
    # SVG-based flow (primárny): frontend konvertuje text→SVG, backend extruduje
    # Font-based flow (záložný): pre spätnú kompatibilitu
    if svg_content:
        # SVG vstup – z frontendu (text→SVG) alebo importované logo
        letter_data = svg_to_letter_data(svg_content, letter_height_mm)
        if not letter_data:
            # Fallback: skúsiť staré svg_to_contours
            contours = svg_to_contours(svg_content, letter_height_mm)
            if contours:
                letter_data = [{
                    'char': 'logo',
                    'contours': contours,
                    'offset_x': 0,
                    'width': _calc_contours_width(contours),
                    'height': letter_height_mm,
                }]
            else:
                letter_data = []
    else:
        # Záložný font-based flow (ak frontend neposlal SVG)
        letter_data = text_to_letter_outlines(
            font_path, text, letter_height_mm, letter_spacing_mm
        )
    
    # ── Generovať diely pre každé písmeno ──
    all_letters: List[LetterResult] = []
    
    for letter_idx, letter_info in enumerate(letter_data):
        char = letter_info['char']
        contours = letter_info['contours']
        letter_width = letter_info['width']
        
        if not contours:
            continue
        
        # ── Centrovať kontúry na [0,0] ──
        # Vypočítať centering offset PRED centrovanie (pre SVG segmenty)
        centering_min_x = min(x for c in contours for x, y in c)
        centering_min_y = min(y for c in contours for x, y in c)
        
        contours = _center_contours(contours)
        
        # ── SVG segment data pre priamu Bezier konverziu ──
        svg_subpath_data = letter_info.get('svg_subpath_data')
        svg_scale = letter_info.get('svg_scale', 1.0)
        
        # Pre SVG segmenty: translate = centering offset v mm
        # Segmenty sú v SVG jednotkách, centering je v mm
        svg_translate_x = -centering_min_x
        svg_translate_y = -centering_min_y
        
        letter_prefix = f"{letter_idx}_{_safe_name(char)}"
        
        has_native_bezier = svg_subpath_data is not None and len(svg_subpath_data) > 0
        print(f"  Letter [{letter_idx}] '{char}': "
              f"width={letter_width:.0f}mm, height={letter_height_mm:.0f}mm, "
              f"depth={depth_mm:.0f}mm, wall={rules.wall_thickness}mm, "
              f"recess={rules.external_wall_recess}mm"
              f"{' [native Bezier]' if has_native_bezier else ''}")
        
        # Segmentácia check
        is_seg = needs_segmentation(letter_width, letter_height_mm, rules)
        seg_count = calculate_segments(letter_width, letter_height_mm, rules) if is_seg else 1
        
        parts: List[GeneratedPart] = []
        total_volume = 0.0
        
        try:
            # 1. KORPUS (shell)
            shell_part = _generate_shell(
                char, contours, depth_mm, rules, profile_type, job_dir,
                letter_prefix=letter_prefix,
                svg_subpath_data=svg_subpath_data,
                svg_scale=svg_scale,
                svg_translate_x=svg_translate_x,
                svg_translate_y=svg_translate_y,
            )
            if shell_part:
                parts.append(shell_part)
                total_volume += shell_part.volume_mm3
            
            # 2. ČELO (face)
            if rules.face_is_separate and rules.face_thickness > 0:
                face_part = _generate_face(
                    char, contours, rules, job_dir,
                    letter_prefix=letter_prefix,
                    svg_subpath_data=svg_subpath_data,
                    svg_scale=svg_scale,
                    svg_translate_x=svg_translate_x,
                    svg_translate_y=svg_translate_y,
                )
                if face_part:
                    parts.append(face_part)
                    total_volume += face_part.volume_mm3
            
            # 3. ZADNÝ PANEL (back)
            if not rules.back_is_open:
                back_part = _generate_back_panel(
                    char, contours, rules, job_dir,
                    letter_prefix=letter_prefix,
                    svg_subpath_data=svg_subpath_data,
                    svg_scale=svg_scale,
                    svg_translate_x=svg_translate_x,
                    svg_translate_y=svg_translate_y,
                )
                if back_part:
                    parts.append(back_part)
                    total_volume += back_part.volume_mm3
            
            # 4. MONTÁŽNE ÚCHYTY
            mounting_part = _generate_mounting_tabs(
                char, contours, rules, depth_mm, job_dir,
                letter_prefix=letter_prefix
            )
            if mounting_part:
                parts.append(mounting_part)
                total_volume += mounting_part.volume_mm3
            
        except Exception as e:
            print(f"Error generating parts for '{char}': {e}")
            import traceback
            traceback.print_exc()
            # Fallback: aspoň plný blok
            fallback = _generate_solid_block(
                char, contours, depth_mm, job_dir,
                letter_prefix=letter_prefix
            )
            if fallback:
                parts = [fallback]
                total_volume = fallback.volume_mm3
        
        # LED count
        letter_area = letter_width * letter_height_mm * 0.6  # ~60% fill
        led_count = estimate_led_count(letter_area, rules)
        
        weight = estimate_weight_g(total_volume, material)
        
        all_letters.append(LetterResult(
            char=char,
            parts=parts,
            width_mm=letter_width,
            height_mm=letter_height_mm,
            depth_mm=depth_mm,
            is_segmented=is_seg,
            segment_count=seg_count,
            led_count=led_count,
            estimated_weight_g=weight,
        ))
    
    # ── Vytvoriť ZIP ──
    zip_path = os.path.join(OUTPUT_DIR, f'{job_id}_sign.zip')
    _create_zip(all_letters, zip_path, job_id, rules, text or 'logo')
    
    # Sumárne údaje
    total_parts = sum(len(l.parts) for l in all_letters)
    total_weight = sum(l.estimated_weight_g for l in all_letters)
    total_leds = sum(l.led_count for l in all_letters)
    
    print(f"\n{'='*60}")
    print(f"[STL] Job {job_id} COMPLETE: {len(all_letters)} letters, {total_parts} parts")
    for lr in all_letters:
        part_names = [p.filename for p in lr.parts]
        print(f"  '{lr.char}': {len(lr.parts)} parts → {', '.join(part_names)}")
    print(f"{'='*60}\n")
    
    return GenerationResult(
        job_id=job_id,
        letters=all_letters,
        zip_path=zip_path,
        total_parts=total_parts,
        total_weight_g=total_weight,
        total_led_count=total_leds,
        lighting_type=lighting_type,
        material=material,
    )


# ─────────────────────────────────────────────
# Generácia jednotlivých dielov
# ─────────────────────────────────────────────

def _generate_shell(
    char: str,
    contours: List[List[Point]],
    depth_mm: float,
    rules: ManufacturingRule,
    profile_type: str,
    output_dir: str,
    letter_prefix: str = '',
    svg_subpath_data=None,
    svg_scale: float = 1.0,
    svg_translate_x: float = 0.0,
    svg_translate_y: float = 0.0,
) -> Optional[GeneratedPart]:
    """
    Generovať dutý korpus (shell) písmena.
    
    Ak sú k dispozícii SVG segmenty, použije priamu Bezier konverziu
    pre presné hrany podľa SVG.
    
    Prístup 1 (primárny) – Boolean subtraction (produkuje watertight mesh)
    Prístup 2 (záložný) – CadQuery shell()
    """
    try:
        wall = rules.wall_thickness
        
        # ═══ 1. Plný vonkajší solid ═══
        # Pokús sa o priamu SVG → Bezier konverziu
        if svg_subpath_data:
            wp_outer = svg_data_to_cq_workplane(
                svg_subpath_data, svg_scale,
                svg_translate_x, svg_translate_y,
                contours_fallback=contours,
            )
        else:
            wp_outer = contours_to_cq_wire(contours)
        outer_solid = wp_outer.extrude(depth_mm)
        outer_vol = _estimate_volume(outer_solid)
        
        print(f"  '{char}': Outer solid volume = {outer_vol:.0f} mm³")
        
        used_boolean = False  # Track which method was used (boolean already includes recess)
        
        # ═══ PRÍSTUP 1: Boolean subtraction (produkuje watertight mesh) ═══
        shelled = _try_boolean_shell(
            outer_solid, contours, depth_mm, wall, rules, char
        )
        if shelled is not None:
            used_boolean = True
        
        if shelled is None:
            # ═══ PRÍSTUP 2: CadQuery shell() (záložný) ═══
            print(f"  '{char}': Boolean subtraction failed, trying CadQuery shell()...")
            shelled = _try_cq_shell(outer_solid, wall, rules, char)
        
        if shelled is None:
            # ═══ PRÍSTUP 3: Boolean s menšou stenou ═══
            print(f"  '{char}': CQ shell() also failed, trying thinner wall...")
            for thinner in [wall * 0.75, wall * 0.5, max(wall * 0.3, 1.0), max(wall * 0.25, 0.8)]:
                shelled = _try_boolean_shell(
                    outer_solid, contours, depth_mm, thinner, rules, char
                )
                if shelled is not None:
                    wall = thinner
                    print(f"  '{char}': Success with thinner wall = {thinner}mm")
                    break
        
        if shelled is None:
            # ═══ PRÍSTUP 4: Zjednodušený shell – len vonkajší obrys, bez dier ═══
            print(f"  '{char}': All methods failed, trying simplified (outer only)...")
            try:
                simplified_contours = [contours[0]]  # Len vonkajší obrys
                shelled = _try_boolean_shell(
                    outer_solid, simplified_contours, depth_mm, wall, rules, char
                )
                if shelled is None:
                    shelled = _try_boolean_shell(
                        outer_solid, simplified_contours, depth_mm, wall * 0.5, rules, char
                    )
                    if shelled is not None:
                        wall = wall * 0.5
                if shelled is not None:
                    print(f"  '{char}': Simplified shell SUCCESS (without holes)")
            except Exception:
                pass
        
        if shelled is None:
            # Posledná záchrana – plný blok
            print(f"  '{char}': All shell methods failed – exporting solid")
            prefix = letter_prefix or _safe_name(char)
            filename = f"{prefix}_korpus.stl"
            stl_path = os.path.join(output_dir, filename)
            _export_stl(outer_solid, stl_path)
            return GeneratedPart(
                name=f"{char}_korpus", filename=filename, part_type='shell',
                stl_path=stl_path, volume_mm3=outer_vol,
                description=f'Korpus "{char}" – plný (shell generation failed)',
            )
        
        # Verifikácia – cut naozaj odpočítal objem?
        shelled_vol = _estimate_volume(shelled)
        vol_ratio = shelled_vol / outer_vol if outer_vol > 0 else 1.0
        print(f"  '{char}': Shell volume = {shelled_vol:.0f} mm³ "
              f"({vol_ratio*100:.0f}% of solid)")
        
        if vol_ratio > 0.92:
            print(f"  ⚠️ '{char}': Shell barely differs from solid "
                  f"({vol_ratio*100:.0f}%) – cut may have failed!")
        
        # ── DRÁŽKA pre CadQuery shell() prístup ──
        # Boolean subtraction (prístup 1) už drážku zahŕňa → preskočiť
        # Len pre CadQuery shell() prístup (prístup 2) pridáme drážku
        if not used_boolean and rules.external_wall_recess > 0 and rules.face_inset > 0:
            try:
                from shapely.geometry import Polygon, MultiPolygon
                
                recess_depth_z = rules.face_inset  # Z depth
                groove_width = min(wall * 0.5, wall - 0.8)
                groove_width = max(groove_width, 0.5)
                thin_wall = wall - groove_width
                
                # Vytvoriť Shapely polygon z pôvodných kontúr
                outer_contour = contours[0]
                holes = contours[1:] if len(contours) > 1 else []
                outer_ring = [(p[0], p[1]) for p in outer_contour]
                hole_rings = [[(p[0], p[1]) for p in h] for h in holes]
                
                try:
                    poly = Polygon(outer_ring, hole_rings)
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                except Exception:
                    poly = Polygon(outer_ring)
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                
                recess_poly = poly.buffer(-thin_wall, resolution=32, join_style=2, mitre_limit=3.0)
                
                if not recess_poly.is_empty:
                    recess_contours = _shapely_to_contours(recess_poly)
                    if recess_contours:
                        # Z pozícia drážky
                        z_end_recess = depth_mm
                        if not rules.face_is_separate:
                            z_end_recess = depth_mm - rules.face_thickness
                        recess_z = z_end_recess - recess_depth_z
                        if recess_z < 0:
                            recess_z = 0
                        
                        recess_shapes = []
                        if isinstance(recess_poly, MultiPolygon):
                            for sub_poly in recess_poly.geoms:
                                if sub_poly.is_empty:
                                    continue
                                sub_contours = _shapely_to_contours(sub_poly)
                                if sub_contours:
                                    try:
                                        wp_sub = contours_to_cq_wire(sub_contours)
                                        rs = wp_sub.extrude(recess_depth_z)
                                        rs_shape = rs.val()
                                        rs_shape = rs_shape.moved(cq.Location(cq.Vector(0, 0, recess_z)))
                                        recess_shapes.append(rs_shape)
                                    except Exception:
                                        pass
                        else:
                            try:
                                wp_recess = contours_to_cq_wire(recess_contours)
                                rs = wp_recess.extrude(recess_depth_z)
                                rs_shape = rs.val()
                                rs_shape = rs_shape.moved(cq.Location(cq.Vector(0, 0, recess_z)))
                                recess_shapes = [rs_shape]
                            except Exception:
                                pass
                        
                        if recess_shapes:
                            try:
                                # Fúzovať recess shapes do jedného
                                combined_recess = recess_shapes[0]
                                for i in range(1, len(recess_shapes)):
                                    try:
                                        combined_recess = combined_recess.fuse(recess_shapes[i])
                                    except Exception:
                                        pass
                                # Jeden cut
                                outer_shape = shelled.val()
                                cut_result = outer_shape.cut(combined_recess)
                                shelled = cq.Workplane("XY").newObject([cut_result])
                                print(f"  '{char}': Recess (drážka) added to CQ shell – "
                                      f"lip {thin_wall:.1f}mm, groove {groove_width:.1f}mm, "
                                      f"Z depth {recess_depth_z:.1f}mm")
                            except Exception as e:
                                print(f"  '{char}': CQ shell recess cut failed: {e}")
            except Exception as e:
                print(f"  '{char}': CQ shell recess generation failed: {e}")
        
        # ── Voliteľné: profil hrany (chamfer / fillet) ──
        if profile_type == 'rounded':
            try:
                shelled = shelled.edges('>Z').fillet(min(wall * 0.4, 1.0))
            except Exception:
                pass
        elif profile_type == 'chamfer':
            try:
                shelled = shelled.edges('>Z').chamfer(min(wall * 0.3, 0.8))
            except Exception:
                pass
        
        # Export
        prefix = letter_prefix or _safe_name(char)
        filename = f"{prefix}_korpus.stl"
        stl_path = os.path.join(output_dir, filename)
        _export_stl(shelled, stl_path)
        
        # Popis podľa typu
        recess_info = ""
        if rules.external_wall_recess > 0 and rules.face_inset > 0:
            recess_info = f', drážka {rules.external_wall_recess}mm pre akrylát {rules.acrylic_thickness}mm'
        
        if rules.face_is_separate and rules.back_is_open:
            desc = f'Korpus "{char}" – bočnice {wall}mm (bez čela, bez zadku){recess_info}'
        elif rules.face_is_separate:
            desc = f'Korpus "{char}" – bočnice {wall}mm + zadná stena {rules.back_panel_thickness}mm{recess_info}'
        elif rules.back_is_open:
            desc = f'Korpus "{char}" – bočnice {wall}mm + čelo {rules.face_thickness}mm (zadok otvorený)'
        else:
            desc = f'Korpus "{char}" – duté písmeno, stena {wall}mm, čelo {rules.face_thickness}mm, zadok {rules.back_panel_thickness}mm'
        
        return GeneratedPart(
            name=f"{char}_korpus",
            filename=filename,
            part_type='shell',
            stl_path=stl_path,
            volume_mm3=shelled_vol,
            description=desc,
        )
    except Exception as e:
        print(f"Shell generation error for '{char}': {e}")
        import traceback
        traceback.print_exc()
        return None


def _try_cq_shell(
    outer_solid,
    wall: float,
    rules: ManufacturingRule,
    char: str,
):
    """
    Prístup 1: Použiť CadQuery shell() na extrudovaný solid.
    Vyberie plochy na otvorenie (face/back) a vytvori dutinu.
    """
    try:
        # Určiť, ktoré plochy otvoriť
        faces_to_open = []
        
        if rules.face_is_separate:
            faces_to_open.append(">Z")  # Predná plocha
        
        if rules.back_is_open:
            faces_to_open.append("<Z")  # Zadná plocha
        
        if not faces_to_open:
            # Bez otvorenej plochy – otvor top face, potom pridáme stenu späť
            # CadQuery shell() potrebuje aspoň jednu otvorenú plochu
            faces_to_open.append(">Z")
        
        # Vybrať plochy a aplikovať shell()
        # shell(-wall) = smerom dovnútra
        result = outer_solid
        for face_sel in faces_to_open:
            try:
                result = result.faces(face_sel).shell(-wall)
            except Exception as e:
                print(f"  '{char}': CadQuery shell({face_sel}) error: {e}")
                return None
        
        # Ak čelo nie je oddelené a zadok nie je otvorený,
        # CadQuery shell() otvorila top face – to je ok pre väčšinu prípadov.
        # Čelo a zadný panel sa generujú ako samostatné diely v _generate_face/_generate_back_panel.
        
        # Verifikácia
        outer_vol = _estimate_volume(outer_solid)
        result_vol = _estimate_volume(result)
        
        if outer_vol > 0 and result_vol / outer_vol > 0.92:
            print(f"  '{char}': CadQuery shell() didn't reduce volume enough "
                  f"({result_vol/outer_vol*100:.0f}%)")
            return None
        
        print(f"  '{char}': CadQuery shell() SUCCESS – wall {wall}mm")
        
        # ═══ DRÁŽKA (RECESS) – aj pre CadQuery shell prístup ═══
        if rules.external_wall_recess > 0 and rules.face_inset > 0:
            try:
                from shapely.geometry import Polygon, MultiPolygon
                
                # Potrebujeme kontúry z outer_solid – neprístupné priamo
                # Drážku implementujeme v _generate_shell po shell() volaniach
                # Nechaj na _generate_shell, kde sa pridá drážka k výsledku
                pass
            except Exception:
                pass
        
        return result
    except Exception as e:
        print(f"  '{char}': CadQuery shell() failed: {e}")
        return None


def _try_boolean_shell(
    outer_solid,
    contours: List[List[Point]],
    depth_mm: float,
    wall: float,
    rules: ManufacturingRule,
    char: str,
):
    """
    Prístup 2: Boolean subtraction s Shapely buffer.
    Vytvori zmenšený 2D obrys a odreže ho z plného bloku.
    """
    try:
        from shapely.geometry import Polygon, MultiPolygon
        from shapely.ops import unary_union
        
        # ═══ Zmenšiť 2D kontúry o wall_thickness (Shapely) ═══
        outer_contour = contours[0]
        holes = contours[1:] if len(contours) > 1 else []
        
        outer_ring = [(p[0], p[1]) for p in outer_contour]
        hole_rings = [[(p[0], p[1]) for p in h] for h in holes]
        
        try:
            poly = Polygon(outer_ring, hole_rings)
            if not poly.is_valid:
                poly = poly.buffer(0)
        except Exception:
            poly = Polygon(outer_ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
        
        # Negatívny buffer (zmenšenie dovnútra)
        inner_poly = poly.buffer(-wall, resolution=32, join_style=2, mitre_limit=3.0)
        
        if inner_poly.is_empty:
            print(f"  '{char}': Shapely buffer(-{wall}) returned empty polygon")
            return None
        
        # Konvertovať Shapely → CadQuery kontúry
        # Pre MultiPolygon spracujeme každý polygon zvlášť
        inner_contours = _shapely_to_contours(inner_poly)
        
        if not inner_contours:
            print(f"  '{char}': Failed to extract inner contours from Shapely")
            return None
        
        # ═══ Z-rozsah dutiny ═══
        z_start = 0.0
        z_end = depth_mm
        
        if not rules.face_is_separate:
            z_end = depth_mm - rules.face_thickness
        
        if not rules.back_is_open and rules.back_panel_thickness > 0:
            z_start = rules.back_panel_thickness
        
        cavity_height = z_end - z_start
        
        if cavity_height <= 0.5:
            print(f"  '{char}': Cavity height too small ({cavity_height:.1f}mm)")
            return None
        
        # ═══ Vytvoriť vnútorný solid ═══
        # Pre MultiPolygon: spracujeme kontúry skupinu po skupine
        if isinstance(inner_poly, MultiPolygon):
            # Každý polygon sa extruduje a oreže zvlášť
            inner_solids = []
            for sub_poly in inner_poly.geoms:
                if sub_poly.is_empty:
                    continue
                sub_contours = _shapely_to_contours(sub_poly)
                if not sub_contours:
                    continue
                try:
                    wp_sub = contours_to_cq_wire(sub_contours)
                    sub_solid = wp_sub.extrude(cavity_height)
                    inner_solids.append(sub_solid)
                except Exception as e:
                    print(f"  '{char}': Sub-polygon extrude failed: {e}")
                    continue
        else:
            try:
                wp_inner = contours_to_cq_wire(inner_contours)
                inner_solids = [wp_inner.extrude(cavity_height)]
            except Exception as e:
                print(f"  '{char}': Inner contour extrude failed: {e}")
                return None
        
        if not inner_solids:
            print(f"  '{char}': No valid inner solids created")
            return None
        
        # ═══ Zbieranie VŠETKÝCH vnútorných solidov (cavity + recess) ═══
        # Namiesto sekvenčných boolean cutov ich spojíme do jedného
        # a vykonáme JEDEN boolean cut → minimalizácia non-manifold hrán
        all_cut_shapes = []
        
        # Cavity solidy – posunúť na správnu Z pozíciu
        for idx, inner_solid in enumerate(inner_solids):
            try:
                inner_shape = inner_solid.val()
                if z_start > 0:
                    inner_shape = inner_shape.moved(
                        cq.Location(cq.Vector(0, 0, z_start))
                    )
                all_cut_shapes.append(inner_shape)
                print(f"  '{char}': Cavity shape #{idx+1} prepared")
            except Exception as e:
                print(f"  '{char}': Cavity shape #{idx+1} failed: {e}")
        
        # ═══ DRÁŽKA (RECESS) pre akrylátové čelo ═══
        if rules.external_wall_recess > 0 and rules.face_inset > 0:
            recess_depth_z = rules.face_inset
            groove_width = min(wall * 0.5, wall - 0.8)
            groove_width = max(groove_width, 0.5)
            thin_wall = wall - groove_width
            
            try:
                recess_poly = poly.buffer(-thin_wall, resolution=32, join_style=2, mitre_limit=3.0)
                
                if not recess_poly.is_empty:
                    recess_contours = _shapely_to_contours(recess_poly)
                    
                    if recess_contours:
                        recess_z = z_end - recess_depth_z
                        if recess_z < z_start:
                            recess_z = z_start
                        
                        recess_polys = []
                        if isinstance(recess_poly, MultiPolygon):
                            recess_polys = [sp for sp in recess_poly.geoms if not sp.is_empty]
                        else:
                            recess_polys = [recess_poly]
                        
                        for sub_poly in recess_polys:
                            sub_contours = _shapely_to_contours(sub_poly)
                            if sub_contours:
                                try:
                                    wp_sub = contours_to_cq_wire(sub_contours)
                                    rs = wp_sub.extrude(recess_depth_z)
                                    rs_shape = rs.val()
                                    rs_shape = rs_shape.moved(
                                        cq.Location(cq.Vector(0, 0, recess_z))
                                    )
                                    all_cut_shapes.append(rs_shape)
                                except Exception:
                                    pass
                        
                        print(f"  '{char}': Recess (drážka) prepared – "
                              f"lip {thin_wall:.1f}mm, groove {groove_width:.1f}mm, "
                              f"Z depth {recess_depth_z:.1f}mm")
                    
            except Exception as e:
                print(f"  '{char}': Recess generation failed: {e}")
        
        if not all_cut_shapes:
            print(f"  '{char}': No cut shapes available")
            return None
        
        # ═══ JEDEN Boolean cut – všetky shapes naraz ═══
        # Najprv fúzovať všetky vnútorné shapes do jedného compound
        shelled = outer_solid
        
        if len(all_cut_shapes) == 1:
            # Jednoduchý prípad – jeden cut
            try:
                outer_shape = shelled.val()
                cut_result = outer_shape.cut(all_cut_shapes[0])
                shelled = cq.Workplane("XY").newObject([cut_result])
                print(f"  '{char}': Single boolean cut succeeded")
            except Exception as e:
                print(f"  '{char}': Single cut failed: {e}")
                return None
        else:
            # Viacero shapes → fúzia do jedného, potom jeden cut
            try:
                combined = all_cut_shapes[0]
                for i in range(1, len(all_cut_shapes)):
                    try:
                        combined = combined.fuse(all_cut_shapes[i])
                    except Exception as e:
                        print(f"  '{char}': Fuse #{i+1} failed: {e}, trying individual cut")
                        # Ak fúzia zlyhá, skúsime individuálny cut pre tento shape
                        try:
                            outer_shape = shelled.val()
                            cut_result = outer_shape.cut(all_cut_shapes[i])
                            shelled = cq.Workplane("XY").newObject([cut_result])
                        except Exception:
                            pass
                
                # Hlavný cut s fúzovaným compound
                outer_shape = shelled.val()
                cut_result = outer_shape.cut(combined)
                shelled = cq.Workplane("XY").newObject([cut_result])
                print(f"  '{char}': Combined boolean cut succeeded "
                      f"({len(all_cut_shapes)} shapes fused)")
                
            except Exception as e:
                print(f"  '{char}': Combined cut failed: {e}, trying sequential fallback")
                # Fallback: sekvenčné cuty (pôvodný prístup)
                shelled = outer_solid
                for idx, shape in enumerate(all_cut_shapes):
                    try:
                        outer_shape = shelled.val()
                        cut_result = outer_shape.cut(shape)
                        shelled = cq.Workplane("XY").newObject([cut_result])
                        print(f"  '{char}': Sequential cut #{idx+1} succeeded")
                    except Exception as e2:
                        print(f"  '{char}': Sequential cut #{idx+1} failed: {e2}")
        
        # Verifikácia – naozaj sa odpočítal objem?
        outer_vol = _estimate_volume(outer_solid)
        shelled_vol = _estimate_volume(shelled)
        
        if outer_vol > 0 and shelled_vol / outer_vol > 0.92:
            print(f"  '{char}': Boolean cut didn't reduce volume enough "
                  f"({shelled_vol:.0f}/{outer_vol:.0f} = {shelled_vol/outer_vol*100:.0f}%)")
            return None
        
        print(f"  '{char}': Hollow shell created – wall {wall}mm, "
              f"cavity z=[{z_start:.1f}, {z_end:.1f}]mm, "
              f"vol {shelled_vol:.0f}/{outer_vol:.0f} mm³")
        
        return shelled
        
    except Exception as e:
        print(f"  '{char}': Boolean shell error: {e}")
        import traceback
        traceback.print_exc()
        return None


def _shapely_to_contours(geom) -> List[List[Point]]:
    """
    Konvertovať Shapely polygon/multipolygon na CadQuery-kompatibilné kontúry.
    
    Pre SINGLE Polygon: vracia [outer_contour, hole1, hole2, ...]
    Pre MultiPolygon: spracuje najväčší polygon, ostatné ignoruje
    (MultiPolygon sa spracováva v _try_boolean_shell zvlášť)
    """
    from shapely.geometry import Polygon, MultiPolygon
    
    contours: List[List[Point]] = []
    
    polygons = []
    if isinstance(geom, MultiPolygon):
        # Zoradiť podľa plochy – najväčší polygon prvý
        polygons = sorted(geom.geoms, key=lambda p: p.area, reverse=True)
    elif isinstance(geom, Polygon):
        polygons = [geom]
    else:
        return []
    
    # Pre CadQuery: prvý polygon = hlavný (vonkajší obrys + jeho diery)
    # Ďalšie polygony sa ignorujú tu (spracujú sa v _try_boolean_shell)
    for poly in polygons:
        if poly.is_empty:
            continue
        
        # Vonkajší obrys
        exterior = list(poly.exterior.coords)
        if len(exterior) >= 3:
            contours.append([(p[0], p[1]) for p in exterior])
        
        # Diery tohto polygonu
        for interior in poly.interiors:
            hole = list(interior.coords)
            if len(hole) >= 3:
                contours.append([(p[0], p[1]) for p in hole])
        
        # Pre single polygon mode: len prvý polygon
        # (MultiPolygon sa spracuje v _try_boolean_shell separátne)
        if len(polygons) == 1:
            break
    
    return contours


def _generate_face(
    char: str,
    contours: List[List[Point]],
    rules: ManufacturingRule,
    output_dir: str,
    letter_prefix: str = '',
    svg_subpath_data=None,
    svg_scale: float = 1.0,
    svg_translate_x: float = 0.0,
    svg_translate_y: float = 0.0,
) -> Optional[GeneratedPart]:
    """
    Generovať čelo (face) písmena – samostatný diel.
    """
    try:
        if svg_subpath_data:
            wp = svg_data_to_cq_workplane(
                svg_subpath_data, svg_scale,
                svg_translate_x, svg_translate_y,
                contours_fallback=contours,
            )
        else:
            wp = contours_to_cq_wire(contours)
        
        # Extrúzia na hrúbku čela
        face_solid = wp.extrude(rules.face_thickness)
        
        # Ak je inset > 0, zmenšiť o inset (aby sa zasunulo do korpusu)
        # CadQuery offset: create slightly smaller version
        if rules.face_inset > 0:
            try:
                # Skús 2D offset
                # Pre zjednodušenie: extruduj pôvodné kontúry
                # V reálnej produkcii by sme urobili 2D offset
                pass
            except Exception:
                pass
        
        prefix = letter_prefix or _safe_name(char)
        filename = f"{prefix}_celo.stl"
        stl_path = os.path.join(output_dir, filename)
        _export_stl(face_solid, stl_path)
        
        vol = _estimate_volume(face_solid)
        
        mat_note = "opálový" if rules.face_is_translucent else "nepriesvitný"
        
        return GeneratedPart(
            name=f"{char}_celo",
            filename=filename,
            part_type='face',
            stl_path=stl_path,
            volume_mm3=vol,
            description=f'Čelo písmena "{char}" – {mat_note}, hrúbka {rules.face_thickness}mm',
        )
    except Exception as e:
        print(f"Face generation error for '{char}': {e}")
        return None


def _generate_back_panel(
    char: str,
    contours: List[List[Point]],
    rules: ManufacturingRule,
    output_dir: str,
    letter_prefix: str = '',
    svg_subpath_data=None,
    svg_scale: float = 1.0,
    svg_translate_x: float = 0.0,
    svg_translate_y: float = 0.0,
) -> Optional[GeneratedPart]:
    """
    Generovať zadný panel s montážnymi a ventilačnými dierami.
    """
    try:
        if svg_subpath_data:
            wp = svg_data_to_cq_workplane(
                svg_subpath_data, svg_scale,
                svg_translate_x, svg_translate_y,
                contours_fallback=contours,
            )
        else:
            wp = contours_to_cq_wire(contours)
        
        # Tenký plný panel
        panel = wp.extrude(rules.back_panel_thickness)
        
        # Montážne diery – v pravidelnom rastri
        # Nájdi bounding box kontúr
        bbox = _contours_bbox(contours)
        if bbox:
            min_x, min_y, max_x, max_y = bbox
            cx = (min_x + max_x) / 2
            cy = (min_y + max_y) / 2
            w = max_x - min_x
            h = max_y - min_y
            
            # Montážne body
            mounting_pts = _generate_mounting_points(
                cx, cy, w, h,
                rules.mounting_hole_spacing,
                rules.mounting_hole_diameter,
            )
            
            if mounting_pts:
                try:
                    panel = (
                        panel.faces('>Z').workplane()
                        .pushPoints(mounting_pts)
                        .hole(rules.mounting_hole_diameter)
                    )
                except Exception:
                    pass  # Niektoré diery nemusia byť vnútri obrysu
            
            # Ventilačné otvory
            if rules.vent_hole_diameter > 0 and rules.vent_hole_spacing > 0:
                vent_pts = _generate_vent_points(
                    cx, cy, w * 0.6, h * 0.6,
                    rules.vent_hole_spacing,
                )
                if vent_pts:
                    try:
                        panel = (
                            panel.faces('>Z').workplane()
                            .pushPoints(vent_pts)
                            .hole(rules.vent_hole_diameter)
                        )
                    except Exception:
                        pass
            
            # Otvor na kabeláž (stred, väčší)
            try:
                panel = (
                    panel.faces('>Z').workplane()
                    .pushPoints([(cx, cy)])
                    .hole(8.0)  # 8mm otvor na kabeláž
                )
            except Exception:
                pass
        
        prefix = letter_prefix or _safe_name(char)
        filename = f"{prefix}_zadok.stl"
        stl_path = os.path.join(output_dir, filename)
        _export_stl(panel, stl_path)
        
        vol = _estimate_volume(panel)
        
        return GeneratedPart(
            name=f"{char}_zadok",
            filename=filename,
            part_type='back',
            stl_path=stl_path,
            volume_mm3=vol,
            description=(
                f'Zadný panel "{char}" – hrúbka {rules.back_panel_thickness}mm, '
                f'montážne diery M{int(rules.mounting_hole_diameter)}'
            ),
        )
    except Exception as e:
        print(f"Back panel generation error for '{char}': {e}")
        return None


def _generate_mounting_tabs(
    char: str,
    contours: List[List[Point]],
    rules: ManufacturingRule,
    depth_mm: float,
    output_dir: str,
    letter_prefix: str = '',
) -> Optional[GeneratedPart]:
    """
    Generovať montážne úchyty / dištančné stĺpiky.
    
    Toto sú malé valcové stĺpiky so závitovou dierou,
    ktoré sa prilepujú na zadnú stranu korpusu.
    """
    try:
        bbox = _contours_bbox(contours)
        if not bbox:
            return None
        
        min_x, min_y, max_x, max_y = bbox
        cx = (min_x + max_x) / 2
        cy = (min_y + max_y) / 2
        w = max_x - min_x
        h = max_y - min_y
        
        mounting_pts = _generate_mounting_points(
            cx, cy, w, h,
            rules.mounting_hole_spacing,
            rules.mounting_hole_diameter,
        )
        
        if not mounting_pts:
            return None
        
        # Vytvoriť stĺpiky
        standoff_d = rules.mounting_tab_size
        standoff_h = rules.standoff_length
        hole_d = rules.mounting_hole_diameter
        
        result = cq.Workplane("XY")
        
        for px, py in mounting_pts:
            tab = (
                cq.Workplane("XY")
                .transformed(offset=cq.Vector(px, py, 0))
                .circle(standoff_d / 2)
                .extrude(standoff_h)
                .faces(">Z").workplane()
                .hole(hole_d)
            )
            result = result.add(tab)
        
        prefix = letter_prefix or _safe_name(char)
        filename = f"{prefix}_montaz.stl"
        stl_path = os.path.join(output_dir, filename)
        _export_stl(result, stl_path)
        
        vol = len(mounting_pts) * math.pi * (standoff_d / 2) ** 2 * standoff_h
        
        return GeneratedPart(
            name=f"{char}_montaz",
            filename=filename,
            part_type='mounting',
            stl_path=stl_path,
            volume_mm3=vol,
            description=(
                f'Montážne stĺpiky "{char}" – {len(mounting_pts)}× '
                f'⌀{standoff_d}mm × {standoff_h}mm, diera M{int(hole_d)}'
            ),
        )
    except Exception as e:
        print(f"Mounting tabs generation error for '{char}': {e}")
        return None


def _generate_solid_block(
    char: str,
    contours: List[List[Point]],
    depth_mm: float,
    output_dir: str,
    letter_prefix: str = '',
) -> Optional[GeneratedPart]:
    """Fallback: plný blok (bez shell/dier)."""
    try:
        wp = contours_to_cq_wire(contours)
        solid = wp.extrude(depth_mm)
        
        prefix = letter_prefix or _safe_name(char)
        filename = f"{prefix}_plny.stl"
        stl_path = os.path.join(output_dir, filename)
        _export_stl(solid, stl_path)
        
        vol = _estimate_volume(solid)
        
        return GeneratedPart(
            name=f"{char}_plny",
            filename=filename,
            part_type='solid',
            stl_path=stl_path,
            volume_mm3=vol,
            description=f'Plné písmeno "{char}" – hĺbka {depth_mm}mm (fallback)',
        )
    except Exception as e:
        print(f"Solid block error for '{char}': {e}")
        return None


# ─────────────────────────────────────────────
# Pomocné funkcie
# ─────────────────────────────────────────────

def _center_contours(contours: List[List[Point]]) -> List[List[Point]]:
    """
    Centrovať kontúry tak, aby bounding box začínal na [0, 0].
    
    Toto je kritické pre STL export – každé písmeno musí byť
    na pôvode (0,0), nie na absolútnej pozícii z SVG.
    Bez tohto by sa v sliceri (Bambu Studio) písmená prekrývali
    alebo boli posunuté mimo podložku.
    """
    if not contours:
        return contours
    
    # Nájsť globálny bounding box
    min_x = float('inf')
    min_y = float('inf')
    
    for contour in contours:
        for x, y in contour:
            if x < min_x:
                min_x = x
            if y < min_y:
                min_y = y
    
    if min_x == float('inf'):
        return contours
    
    # Posunúť všetky body tak, aby minimum bolo na [0, 0]
    centered = []
    for contour in contours:
        centered.append([(x - min_x, y - min_y) for x, y in contour])
    
    return centered


def _safe_name(char: str) -> str:
    """Bezpečný názov súboru pre znak (aj multi-character ako 'obj_0')."""
    # Nahradiť všetky nebezpečné znaky podčiarkovníkom
    safe = ""
    for c in char:
        if c.isalnum() or c in ('_', '-'):
            safe += c
        else:
            safe += f"u{ord(c)}"
    return safe if safe else "unknown"


def _contours_bbox(
    contours: List[List[Point]],
) -> Optional[Tuple[float, float, float, float]]:
    """Bounding box kontúr → (min_x, min_y, max_x, max_y)."""
    if not contours:
        return None
    
    all_pts = [p for c in contours for p in c]
    if not all_pts:
        return None
    
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    return min(xs), min(ys), max(xs), max(ys)


def _calc_contours_width(contours: List[List[Point]]) -> float:
    """Šírka kontúr v mm."""
    bbox = _contours_bbox(contours)
    if not bbox:
        return 0
    return bbox[2] - bbox[0]


def _generate_mounting_points(
    cx: float, cy: float,
    width: float, height: float,
    spacing: float, hole_d: float,
) -> List[Tuple[float, float]]:
    """
    Generovať body pre montážne diery v pravidelnom rastri.
    Minimálne 2 body (hore-dole), max podľa spacing.
    """
    points = []
    margin = hole_d * 2
    
    # Minimálne 2 body (hore, dole)
    y_start = cy - height / 2 + margin
    y_end = cy + height / 2 - margin
    
    if y_end - y_start < spacing:
        # Malé písmeno – len 2 body
        points.append((cx, y_start))
        points.append((cx, y_end))
    else:
        # Väčšie – raster
        n_y = max(2, int(math.ceil((y_end - y_start) / spacing)) + 1)
        y_step = (y_end - y_start) / (n_y - 1)
        
        for iy in range(n_y):
            y = y_start + iy * y_step
            
            if width > spacing * 1.5:
                # Aj horizontálne body
                points.append((cx - width / 4, y))
                points.append((cx + width / 4, y))
            else:
                points.append((cx, y))
    
    return points


def _generate_vent_points(
    cx: float, cy: float,
    width: float, height: float,
    spacing: float,
) -> List[Tuple[float, float]]:
    """Generovať body pre ventilačné otvory."""
    points = []
    
    n_x = max(1, int(width / spacing))
    n_y = max(1, int(height / spacing))
    
    x_start = cx - (n_x - 1) * spacing / 2
    y_start = cy - (n_y - 1) * spacing / 2
    
    for ix in range(n_x):
        for iy in range(n_y):
            x = x_start + ix * spacing
            y = y_start + iy * spacing
            points.append((x, y))
    
    return points


def _estimate_volume(solid) -> float:
    """Odhadnúť objem CadQuery solid v mm³."""
    try:
        # CadQuery / OCCT volume
        val = solid.val()
        if hasattr(val, 'Volume'):
            return val.Volume()
        if hasattr(solid, 'objects') and solid.objects:
            return sum(o.Volume() for o in solid.objects if hasattr(o, 'Volume'))
    except Exception:
        pass
    return 0.0


def _create_zip(
    letters: List[LetterResult],
    zip_path: str,
    job_id: str,
    rules: ManufacturingRule,
    text: str,
) -> None:
    """Vytvoriť ZIP súbor so všetkými STL a info súborom."""
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # STL súbory – s indexom pre unikátne priečinky
        for idx, letter in enumerate(letters):
            safe = _safe_name(letter.char)
            folder = f"{idx}_{safe}"
            for part in letter.parts:
                if os.path.exists(part.stl_path):
                    zf.write(part.stl_path, f"{folder}/{part.filename}")
        
        # Info súbor
        info = _generate_info_txt(letters, job_id, rules, text)
        zf.writestr("INFO.txt", info)
        
        # Montážny návod
        assembly = _generate_assembly_guide(letters, rules)
        zf.writestr("MONTAZNY_NAVOD.txt", assembly)


def _generate_info_txt(
    letters: List[LetterResult],
    job_id: str,
    rules: ManufacturingRule,
    text: str,
) -> str:
    """Generovať info súbor s prehľadom objednávky."""
    lines = [
        "=" * 60,
        "ADSUN 3D Sign Generator – Výrobná dokumentácia",
        "=" * 60,
        f"Job ID:        {job_id}",
        f"Text:          {text}",
        f"Podsvietenie:  {rules.lighting_type}",
        f"Hrúbka steny:  {rules.wall_thickness} mm",
        f"Hrúbka čela:   {rules.face_thickness} mm",
        "",
        "-" * 60,
        "DIELY:",
        "-" * 60,
    ]
    
    total_weight = 0
    total_leds = 0
    
    for letter in letters:
        lines.append(f'\nPísmeno "{letter.char}":')
        lines.append(f'  Rozmery: {letter.width_mm:.0f} × {letter.height_mm:.0f} × {letter.depth_mm:.0f} mm')
        lines.append(f'  Hmotnosť: ~{letter.estimated_weight_g:.0f} g')
        lines.append(f'  LED modulov: {letter.led_count}')
        
        if letter.is_segmented:
            lines.append(f'  ⚠ SEGMENTOVANÉ: {letter.segment_count} dielov')
        
        for part in letter.parts:
            lines.append(f'    • {part.filename} – {part.description}')
        
        total_weight += letter.estimated_weight_g
        total_leds += letter.led_count
    
    lines.extend([
        "",
        "-" * 60,
        "SUMÁR:",
        "-" * 60,
        f"Celková hmotnosť: ~{total_weight:.0f} g",
        f"Celkový počet LED: {total_leds}",
        f"Celkový počet dielov: {sum(len(l.parts) for l in letters)}",
        "",
        "MATERIÁL: Odporúčaný ASA pre exteriér (UV odolný)",
        "",
        "=" * 60,
    ])
    
    return "\n".join(lines)


def _generate_assembly_guide(
    letters: List[LetterResult],
    rules: ManufacturingRule,
) -> str:
    """Generovať montážny návod."""
    lines = [
        "=" * 60,
        "MONTÁŽNY NÁVOD",
        "=" * 60,
        "",
        "1. PRÍPRAVA DIELOV",
        "   - Skontrolujte všetky vytlačené diely",
        "   - Odstráňte support materiál",
        "   - Prebrúste kontaktné plochy (jemný P220)",
        "",
    ]
    
    step = 2
    
    if rules.face_is_separate:
        lines.extend([
            f"{step}. OSADENIE ČELA",
            f"   - Čelo sa zasúva do korpusu (inset {rules.face_inset} mm)",
            "   - Použite priehľadné lepidlo (UV bond alebo Acrifix)",
            f"   - Čelo je {'opálové (priepustné)' if rules.face_is_translucent else 'nepriesvitné'}",
            "",
        ])
        step += 1
    
    if rules.led_module:
        led = LED_MODULES.get(rules.led_module)
        led_name = led.name if led else rules.led_module
        lines.extend([
            f"{step}. INŠTALÁCIA LED",
            f"   - Typ modulu: {led_name}",
            f"   - Napájanie: {led.voltage if led else '?'} V",
            f"   - LED sa lepia na vnútornú stranu {'čela' if rules.lighting_type in ('front', 'front_halo') else 'zadnej strany'}",
            "   - Dodržiavajte polaritu! Červená = +, čierna = –",
            "   - Kabeláž previesť cez otvor v zadnom paneli",
            "",
        ])
        step += 1
    
    if not rules.back_is_open:
        lines.extend([
            f"{step}. ZADNÝ PANEL",
            "   - Priskrutkujte zadný panel na korpus",
            f"   - Použite skrutky M{int(rules.mounting_hole_diameter)} × {rules.back_panel_thickness + 5:.0f} mm",
            "   - Utiahnite rovnomerne, nekrížte",
            "",
        ])
        step += 1
    
    lines.extend([
        f"{step}. MONTÁŽ NA STENU",
        f"   - Dištančné stĺpiky: ⌀{rules.mounting_tab_size} mm × {rules.standoff_length} mm",
        f"   - Závitové tyče M{int(rules.mounting_hole_diameter)} × {rules.standoff_length + 50:.0f} mm do steny",
        "   - Použite chemickú kotvu do betónu/tehly",
        f"   - Odstup písmena od steny: {rules.standoff_length} mm",
        "",
        f"{step + 1}. ZAPOJENIE",
        "   - Zapojte LED kabeláž paralelne",
        "   - Pripojte na napájací zdroj (v chráničke IP65)",
        "   - Otestujte pred uzavretím",
        "",
        "=" * 60,
        "⚠ BEZPEČNOSŤ:",
        "  - Všetky elektrické spoje musia byť v IP65+ krytí",
        "  - Napájací zdroj musí byť v rozvádzači",
        "  - Montáž na výšku > 3m vyžaduje plošinu",
        "=" * 60,
    ])
    
    return "\n".join(lines)
