"""
font_utils.py – Extrakcia 2D obrysov písmen z TTF/OTF fontov

Používa fonttools na získanie glyph contours, konvertuje ich na CadQuery Wires.
Podporuje:
  - TTF/OTF fonty (TrueType & OpenType)
  - Quadratické aj kubické Bézierové krivky
  - Vnútorné diery (napr. "A", "O", "B")
  - SVG paths pre logá – PRIAMA konverzia na CadQuery Bezier hrany
"""

import math
from pathlib import Path
from typing import List, Tuple, Optional

import cadquery as cq
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

import svgpathtools


# ─────────────────────────────────────────────
# Typy
# ─────────────────────────────────────────────

Point = Tuple[float, float]
Contour = List[Point]  # Uzavretý obrys


# ─────────────────────────────────────────────
# Font → 2D obrysy
# ─────────────────────────────────────────────

def load_font(font_path: str) -> TTFont:
    """Načítaj TTF/OTF font."""
    return TTFont(font_path)


def get_glyph_contours(
    font: TTFont,
    char: str,
    target_height_mm: float = 200.0,
) -> Tuple[List[List[Point]], float]:
    """
    Extrahovať obrysy jedného znaku.
    
    Returns:
        (contours, advance_width_mm) - zoznam obrysov + šírka znaku v mm
    """
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    
    glyph_name = cmap.get(ord(char))
    if not glyph_name:
        raise ValueError(f"Znak '{char}' nie je vo fonte")
    
    glyph = glyph_set[glyph_name]
    
    # Nahrať krivky cez RecordingPen
    pen = RecordingPen()
    glyph.draw(pen)
    
    # UPM = units per em (typicky 1000 alebo 2048)
    upm = font['head'].unitsPerEm
    
    # Výškový ascent (typicky ascender - descender)
    os2 = font.get('OS/2')
    if os2:
        font_height = os2.sTypoAscender - os2.sTypoDescender
    else:
        font_height = upm
    
    # Scale faktor: font units → mm
    scale = target_height_mm / font_height
    
    # Advance width v mm
    advance_width_mm = glyph.width * scale
    
    # Konvertovať recording pen operácie na body
    contours = _recording_to_contours(pen.value, scale)
    
    return contours, advance_width_mm


def _recording_to_contours(
    operations: list,
    scale: float,
    bezier_steps: int = 64,
) -> List[List[Point]]:
    """
    Konvertovať RecordingPen operácie na zoznam obrysov (polyline).
    Bézierové krivky sa aproximujú bodmi.
    
    bezier_steps = 64 → veľmi hladké krivky aj na veľkých písmenách (500mm+).
    """
    contours: List[List[Point]] = []
    current_contour: List[Point] = []
    current_pos: Point = (0.0, 0.0)
    
    for op, args in operations:
        if op == 'moveTo':
            if current_contour:
                contours.append(current_contour)
            pt = args[0]
            current_pos = (pt[0] * scale, pt[1] * scale)
            current_contour = [current_pos]
            
        elif op == 'lineTo':
            pt = args[0]
            current_pos = (pt[0] * scale, pt[1] * scale)
            current_contour.append(current_pos)
            
        elif op == 'qCurveTo':
            # TrueType quadratické Bézier krivky
            points = [(p[0] * scale, p[1] * scale) for p in args]
            
            if len(points) == 1:
                current_pos = points[0]
                current_contour.append(current_pos)
            elif len(points) == 2:
                ctrl, end = points[0], points[1]
                pts = _quadratic_bezier(current_pos, ctrl, end, bezier_steps)
                current_contour.extend(pts[1:])
                current_pos = end
            else:
                off_curves = points[:-1]
                on_curve_end = points[-1]
                
                for i, ctrl in enumerate(off_curves):
                    if i < len(off_curves) - 1:
                        next_ctrl = off_curves[i + 1]
                        implied_on = (
                            (ctrl[0] + next_ctrl[0]) / 2,
                            (ctrl[1] + next_ctrl[1]) / 2,
                        )
                        pts = _quadratic_bezier(current_pos, ctrl, implied_on, bezier_steps)
                        current_contour.extend(pts[1:])
                        current_pos = implied_on
                    else:
                        pts = _quadratic_bezier(current_pos, ctrl, on_curve_end, bezier_steps)
                        current_contour.extend(pts[1:])
                        current_pos = on_curve_end
                
        elif op == 'curveTo':
            pts_raw = [(p[0] * scale, p[1] * scale) for p in args]
            if len(pts_raw) >= 3:
                ctrl1, ctrl2, end = pts_raw[0], pts_raw[1], pts_raw[2]
                pts = _cubic_bezier(current_pos, ctrl1, ctrl2, end, bezier_steps)
                current_contour.extend(pts[1:])
                current_pos = end
                
        elif op == 'closePath' or op == 'endPath':
            if current_contour and len(current_contour) >= 3:
                if current_contour[0] != current_contour[-1]:
                    current_contour.append(current_contour[0])
                contours.append(current_contour)
            current_contour = []
    
    if current_contour and len(current_contour) >= 3:
        contours.append(current_contour)
    
    return contours


def _quadratic_bezier(p0: Point, p1: Point, p2: Point, steps: int) -> List[Point]:
    """Quadratický Bézier: P0 → P1 (control) → P2"""
    points = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        points.append((x, y))
    return points


def _cubic_bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps: int) -> List[Point]:
    """Kubický Bézier: P0 → P1 → P2 → P3"""
    points = []
    for i in range(steps + 1):
        t = i / steps
        x = ((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] +
             3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0])
        y = ((1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] +
             3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1])
        points.append((x, y))
    return points


# ─────────────────────────────────────────────
# Text → pozícované obrysy všetkých písmen
# ─────────────────────────────────────────────

def text_to_letter_outlines(
    font_path: str,
    text: str,
    letter_height_mm: float = 200.0,
    letter_spacing_mm: float = 10.0,
) -> List[dict]:
    """
    Celý text → zoznam dict-ov, každý pre jedno písmeno.
    """
    font = load_font(font_path)
    result = []
    cursor_x = 0.0
    
    for char in text:
        if char == ' ':
            cursor_x += letter_height_mm * 0.3
            continue
            
        try:
            contours, advance_width = get_glyph_contours(
                font, char, letter_height_mm
            )
        except ValueError:
            print(f"  Warning: Znak '{char}' nie je vo fonte, preskakujem")
            cursor_x += letter_height_mm * 0.3
            continue
        
        if not contours:
            print(f"  Warning: Znak '{char}' má prázdne kontúry, preskakujem")
            cursor_x += letter_height_mm * 0.3
            continue
        
        result.append({
            'char': char,
            'contours': contours,
            'offset_x': cursor_x,
            'width': advance_width,
            'height': letter_height_mm,
        })
        
        cursor_x += advance_width + letter_spacing_mm
    
    return result


# ─────────────────────────────────────────────
# SVG → 2D obrysy (pre logá aj pre text z frontendu)
# ─────────────────────────────────────────────

def svg_to_contours(
    svg_content: str,
    target_height_mm: float = 200.0,
) -> List[List[Point]]:
    """
    SVG obsah → zoznam 2D obrysov (polyline) v mm.
    Používa svgpathtools na parsovanie SVG paths.
    """
    import tempfile
    import os
    
    tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.svg', delete=False)
    tmp.write(svg_content)
    tmp.close()
    
    try:
        paths, attributes = svgpathtools.svg2paths(tmp.name)
    finally:
        os.unlink(tmp.name)
    
    if not paths:
        return []
    
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')
    
    all_points: List[List[Point]] = []
    
    for path in paths:
        contour: List[Point] = []
        for segment in path:
            num_samples = max(8, int(segment.length() / 1))
            for i in range(num_samples + 1):
                t = i / num_samples
                pt = segment.point(t)
                x, y = pt.real, pt.imag
                contour.append((x, y))
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
        
        if len(contour) >= 3:
            if contour[0] != contour[-1]:
                contour.append(contour[0])
            all_points.append(contour)
    
    if not all_points:
        return []
    
    is_mm = 'mm"' in svg_content or "mm'" in svg_content
    
    if is_mm:
        scaled: List[List[Point]] = []
        for contour in all_points:
            scaled_contour = [
                (x - min_x, y - min_y)
                for x, y in contour
            ]
            scaled.append(scaled_contour)
        return scaled
    
    svg_height = max_y - min_y
    if svg_height < 0.001:
        return []
    
    scale = target_height_mm / svg_height
    
    scaled = []
    for contour in all_points:
        scaled_contour = [
            ((x - min_x) * scale, (y - min_y) * scale)
            for x, y in contour
        ]
        scaled.append(scaled_contour)
    
    return scaled


# ─────────────────────────────────────────────
# SVG path parsing – vráti kontúry A segmenty
# ─────────────────────────────────────────────

def _parse_svg_path_to_subpaths(path) -> List[Tuple[List[Point], list]]:
    """
    Rozdeliť svgpathtools Path na subpaths.
    
    Returns:
        List of (contour_points, segments) tuples.
        contour_points: sampled polyline pre analýzu a fallback
        segments: originálne svgpathtools segmenty pre priamu CadQuery konverziu
    """
    subpaths: List[Tuple[List[Point], list]] = []
    current_points: List[Point] = []
    current_segments: list = []
    
    for segment in path:
        start = segment.start
        
        # Detekcia nového subpath (veľký skok)
        if current_points:
            last = current_points[-1]
            dist = ((start.real - last[0])**2 + (start.imag - last[1])**2)**0.5
            if dist > 0.1:  # Nový subpath
                if len(current_points) >= 3:
                    if current_points[0] != current_points[-1]:
                        current_points.append(current_points[0])
                    subpaths.append((current_points, current_segments))
                current_points = [(start.real, start.imag)]
                current_segments = []
        
        # Uložiť originálny segment
        current_segments.append(segment)
        
        # Sample body pre analýzu (Shapely grouping)
        seg_len = segment.length()
        num_samples = max(8, int(seg_len / 0.5))
        num_samples = min(num_samples, 200)
        for i in range(num_samples + 1):
            t = i / num_samples
            pt = segment.point(t)
            x, y = pt.real, pt.imag
            
            if current_points:
                last = current_points[-1]
                if abs(x - last[0]) < 0.001 and abs(y - last[1]) < 0.001:
                    continue
            
            current_points.append((x, y))
    
    # Posledný subpath
    if len(current_points) >= 3:
        if current_points[0] != current_points[-1]:
            current_points.append(current_points[0])
        subpaths.append((current_points, current_segments))
    
    return subpaths


def _parse_svg_path_to_contours(path) -> List[List[Point]]:
    """
    Compatibility wrapper – vráti iba kontúry (bez segmentov).
    """
    subpaths = _parse_svg_path_to_subpaths(path)
    return [sp[0] for sp in subpaths]


# ─────────────────────────────────────────────
# Kontúrová analýza – grouping outer + holes
# ─────────────────────────────────────────────

def _group_contours_into_objects(contours: List[List[Point]]) -> Tuple[List[List[List[Point]]], List[List[int]]]:
    """
    Rozdeliť kontúry na samostatné objekty (vonkajší tvar + diery).
    
    Returns:
        (groups, index_groups)
        groups: List of [outer_contour, hole1, hole2, ...]
        index_groups: List of [outer_index, hole1_index, hole2_index, ...]
    """
    from shapely.geometry import Polygon as ShapelyPolygon
    
    if len(contours) <= 1:
        groups = [contours] if contours else []
        indices = [[0]] if contours else []
        return groups, indices
    
    # ═══ 1. Vytvoriť Shapely polygóny ═══
    items = []
    for i, contour in enumerate(contours):
        try:
            coords = [(p[0], p[1]) for p in contour]
            if len(coords) < 4:
                continue
            poly = ShapelyPolygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty or poly.area < 0.01:
                continue
            items.append((i, poly))
        except Exception as e:
            print(f"    _group: contour #{i} Shapely error: {e}")
            continue
    
    if not items:
        return [contours], [list(range(len(contours)))]
    
    items.sort(key=lambda x: x[1].area, reverse=True)
    n = len(items)
    
    # ═══ 2. Nájsť rodiča ═══
    parent_pos = {}
    
    for i in range(n):
        _, poly_i = items[i]
        best_parent = None
        for j in range(i - 1, -1, -1):
            _, poly_j = items[j]
            try:
                rep = poly_i.representative_point()
                if poly_j.contains(rep):
                    if best_parent is None or items[j][1].area < items[best_parent][1].area:
                        best_parent = j
            except Exception:
                continue
        if best_parent is not None:
            parent_pos[i] = best_parent
    
    # ═══ 3. Vypočítať hĺbku vnorenia ═══
    depth = {}
    for i in range(n):
        d = 0
        current = i
        while current in parent_pos:
            d += 1
            current = parent_pos[current]
        depth[i] = d
    
    # ═══ 4. Zoskupiť ═══
    groups_map = {}
    for i in range(n):
        d = depth[i]
        if d % 2 == 0:
            groups_map[i] = []
        else:
            p = parent_pos.get(i)
            if p is not None and p in groups_map:
                groups_map[p].append(i)
    
    # ═══ 5. Zostaviť výsledné skupiny ═══
    result = []
    result_indices = []
    for outer_pos in sorted(groups_map.keys()):
        hole_positions = groups_map[outer_pos]
        orig_idx = items[outer_pos][0]
        group = [contours[orig_idx]]
        indices = [orig_idx]
        for hp in hole_positions:
            hole_idx = items[hp][0]
            group.append(contours[hole_idx])
            indices.append(hole_idx)
        result.append(group)
        result_indices.append(indices)
    
    print(f"    _group: {len(contours)} contours → {len(result)} objects "
          f"(depths: {[depth[i] for i in range(n)]})")
    
    return result, result_indices


# ─────────────────────────────────────────────
# PRIAMA SVG → CadQuery konverzia (Bezier hrany)
# ─────────────────────────────────────────────

def _svg_segment_to_cq_edges(
    segment,
    scale: float = 1.0,
    translate_x: float = 0.0,
    translate_y: float = 0.0,
) -> List[cq.Edge]:
    """
    Konvertovať jeden svgpathtools segment PRIAMO na CadQuery Edge(s).
    
    Používa natívne CadQuery typy hrán pre presnú geometriu:
      - Line → cq.Edge.makeLine (presná priamka)
      - CubicBezier → cq.Edge.makeBezier (presná kubická krivka)
      - QuadraticBezier → konverzia na kubický → cq.Edge.makeBezier
      - Arc → cq.Edge.makeSpline (jemne samplovaná)
    
    Transform: point_mm = svg_point * scale + (translate_x, translate_y)
    """
    def v(pt):
        """Complex SVG point → CadQuery Vector (scaled + translated)."""
        return cq.Vector(pt.real * scale + translate_x, pt.imag * scale + translate_y, 0)
    
    try:
        if isinstance(segment, svgpathtools.path.Line):
            s, e = segment.start, segment.end
            if abs(s - e) < 1e-6:
                return []
            return [cq.Edge.makeLine(v(s), v(e))]
        
        elif isinstance(segment, svgpathtools.path.CubicBezier):
            pts = [segment.start, segment.control1, segment.control2, segment.end]
            # Detekcia degenerovanej krivky
            if all(abs(pts[i] - pts[0]) < 1e-6 for i in range(1, 4)):
                return []
            vectors = [v(p) for p in pts]
            return [cq.Edge.makeBezier(vectors)]
        
        elif isinstance(segment, svgpathtools.path.QuadraticBezier):
            p0 = segment.start
            p1 = segment.control
            p2 = segment.end
            if abs(p0 - p2) < 1e-6 and abs(p1 - p0) < 1e-6:
                return []
            # Konverzia quadratic → cubic Bezier
            # CP1 = P0 + 2/3 * (P1 - P0)
            # CP2 = P2 + 2/3 * (P1 - P2)
            cp1 = p0 + (2.0 / 3.0) * (p1 - p0)
            cp2 = p2 + (2.0 / 3.0) * (p1 - p2)
            vectors = [v(p0), v(cp1), v(cp2), v(p2)]
            return [cq.Edge.makeBezier(vectors)]
        
        elif isinstance(segment, svgpathtools.path.Arc):
            # Arc → samplovaný BSpline (Arc nemá priamu CadQuery analógiu)
            seg_len = segment.length()
            n = max(24, int(seg_len / 0.3))
            n = min(n, 300)
            pts = []
            for i in range(n + 1):
                pt = segment.point(i / n)
                pts.append(v(pt))
            
            # Odstrániť duplikáty
            cleaned = [pts[0]]
            for p in pts[1:]:
                dist = ((p.x - cleaned[-1].x)**2 + (p.y - cleaned[-1].y)**2)**0.5
                if dist > 1e-5:
                    cleaned.append(p)
            
            if len(cleaned) < 2:
                return []
            
            try:
                return [cq.Edge.makeSpline(cleaned, periodic=False)]
            except Exception:
                # Fallback: polyline pre arc
                edges = []
                for i in range(len(cleaned) - 1):
                    try:
                        edges.append(cq.Edge.makeLine(cleaned[i], cleaned[i + 1]))
                    except Exception:
                        pass
                return edges
    
    except Exception as e:
        # Fallback: sample segment na polyline
        try:
            seg_len = segment.length()
            n = max(16, int(seg_len / 0.5))
            pts = []
            for i in range(n + 1):
                pt = segment.point(i / n)
                pts.append(v(pt))
            
            edges = []
            for i in range(len(pts) - 1):
                dist = ((pts[i].x - pts[i+1].x)**2 + (pts[i].y - pts[i+1].y)**2)**0.5
                if dist > 1e-5:
                    try:
                        edges.append(cq.Edge.makeLine(pts[i], pts[i + 1]))
                    except Exception:
                        pass
            return edges
        except Exception:
            return []
    
    return []


def _svg_subpath_to_wire(
    segments: list,
    scale: float = 1.0,
    translate_x: float = 0.0,
    translate_y: float = 0.0,
) -> cq.Wire:
    """
    Konvertovať zoznam svgpathtools segmentov (jeden uzavretý subpath)
    na CadQuery Wire s natívnymi Bezier hranami.
    """
    all_edges = []
    for seg in segments:
        edges = _svg_segment_to_cq_edges(seg, scale, translate_x, translate_y)
        all_edges.extend(edges)
    
    if not all_edges:
        raise ValueError("Žiadne hrany z SVG subpath")
    
    # Uzavrieť wire: ak koniec poslednej hrany ≠ začiatok prvej, pridať čiaru
    try:
        first_start = all_edges[0].startPoint()
        last_end = all_edges[-1].endPoint()
        dist = ((first_start.x - last_end.x)**2 + 
                (first_start.y - last_end.y)**2 + 
                (first_start.z - last_end.z)**2)**0.5
        if dist > 1e-4:
            closing_edge = cq.Edge.makeLine(
                cq.Vector(last_end.x, last_end.y, last_end.z),
                cq.Vector(first_start.x, first_start.y, first_start.z),
            )
            all_edges.append(closing_edge)
    except Exception:
        pass
    
    wire = cq.Wire.assembleEdges(all_edges)
    return wire


def svg_segments_to_face(
    subpath_segment_lists: List[list],
    scale: float = 1.0,
    translate_x: float = 0.0,
    translate_y: float = 0.0,
) -> cq.Face:
    """
    Vytvoriť CadQuery Face z SVG subpath segmentov.
    Prvý subpath = vonkajší obrys, ďalšie = diery.
    Používa natívne Bezier hrany pre presnú geometriu.
    """
    wires = []
    for seg_list in subpath_segment_lists:
        try:
            wire = _svg_subpath_to_wire(seg_list, scale, translate_x, translate_y)
            wires.append(wire)
        except Exception as e:
            print(f"  Warning: SVG subpath→wire zlyhalo: {e}")
            continue
    
    if not wires:
        raise ValueError("Žiadne wire z SVG segmentov")
    
    outer = wires[0]
    holes = wires[1:] if len(wires) > 1 else []
    
    if holes:
        face = cq.Face.makeFromWires(outer, holes)
    else:
        face = cq.Face.makeFromWires(outer)
    
    return face


def svg_data_to_cq_workplane(
    svg_subpath_data: List[Tuple[List[Point], list]],
    scale: float = 1.0,
    translate_x: float = 0.0,
    translate_y: float = 0.0,
    contours_fallback: Optional[List[List[Point]]] = None,
) -> cq.Workplane:
    """
    Konvertovať SVG dáta na CadQuery Workplane.
    
    Pokúsi sa o priamu konverziu SVG segmentov na Bezier hrany.
    Ak zlyhá, použije polyline fallback.
    
    Args:
        svg_subpath_data: list of (contour_points, segments) tuples
        scale: SVG → mm scale faktor
        translate_x, translate_y: posun v mm (centering offset)
        contours_fallback: already-scaled contours pre fallback
    """
    # ═══ Pokus 1: Priama SVG → Bezier konverzia ═══
    try:
        seg_lists = [segs for _, segs in svg_subpath_data]
        face = svg_segments_to_face(seg_lists, scale, translate_x, translate_y)
        print(f"  ✓ Direct SVG→Bezier conversion SUCCESS ({len(seg_lists)} subpaths)")
        return cq.Workplane("XY").add(face)
    except Exception as e:
        print(f"  ⚠ Direct SVG→Bezier failed: {e}, using polyline fallback")
    
    # ═══ Pokus 2: Polyline fallback ═══
    if contours_fallback:
        return contours_to_cq_wire(contours_fallback)
    
    # ═══ Pokus 3: Vytvoriť polyline kontúry z SVG dát ═══
    contours = [pts for pts, _ in svg_subpath_data]
    # Aplikovať scale a translate
    scaled = []
    for c in contours:
        scaled.append([(x * scale + translate_x, y * scale + translate_y) for x, y in c])
    return contours_to_cq_wire(scaled)


# ─────────────────────────────────────────────
# SVG → kompletné letter_data (pre STL generátor)
# ─────────────────────────────────────────────

def svg_to_letter_data(
    svg_content: str,
    target_height_mm: float = 200.0,
) -> List[dict]:
    """
    SVG → zoznam samostatných objektov pre STL generáciu.
    
    KĽÚČOVÝ ALGORITMUS:
      1. Parsovať SVG XML → extrahovať <path> elementy
      2. Pre každý <path>: rozdeliť na subpaths (kontúry + segmenty)
      3. Kontúrová analýza: outer/holes grouping
      4. Uniformné škálovanie
      5. Vrátiť aj originálne segmenty pre priamu CadQuery konverziu
    """
    import xml.etree.ElementTree as ET
    import re
    
    # ═══ Farby pozadia ═══
    def _is_background_fill(path_el) -> bool:
        fill = path_el.get('fill', '').strip().lower()
        if fill in {'#fff', '#ffffff', 'white', 'none'}:
            return True
        style = path_el.get('style', '')
        if style:
            m = re.search(r'fill\s*:\s*([^;]+)', style)
            if m and m.group(1).strip().lower() in {'#fff', '#ffffff', 'white', 'none'}:
                return True
        return False
    
    def _is_simple_rect_path(d: str) -> bool:
        commands = re.findall(r'[A-Za-z]', d)
        if len(commands) <= 6 and 'c' not in d.lower() and 's' not in d.lower():
            return True
        return False
    
    # ═══ FÁZA 0: Parsovať SVG XML ═══
    letter_paths = []
    has_any_data_char = False
    skipped_bg = 0
    try:
        root = ET.fromstring(svg_content)
        
        path_count = 0
        for path_el in root.iter():
            tag = path_el.tag
            if '}' in tag:
                tag = tag.split('}')[1]
            
            if tag == 'path':
                d = path_el.get('d', '')
                char = path_el.get('data-char', '')
                path_count += 1
                
                is_bg = _is_background_fill(path_el)
                is_rect = _is_simple_rect_path(d) if d else False
                
                if is_bg and is_rect:
                    skipped_bg += 1
                    print(f"  SVG path #{path_count}: SKIPPED (background rect, "
                          f"fill='{path_el.get('fill', '')}', d_len={len(d)})")
                    continue
                
                if char:
                    has_any_data_char = True
                print(f"  SVG path #{path_count}: data-char='{char}', "
                      f"d_len={len(d)}, fill='{path_el.get('fill', '')}', "
                      f"attrs={list(path_el.attrib.keys())}")
                if d:
                    letter_paths.append((char, d, path_count - 1))
        
        print(f"  SVG XML: found {path_count} <path> elements, "
              f"{len(letter_paths)} usable, {skipped_bg} backgrounds skipped, "
              f"has_data_char={has_any_data_char}")
    except Exception as e:
        print(f"  SVG XML parsing failed: {e}, falling back to svgpathtools")
    
    is_mm = 'mm"' in svg_content or "mm'" in svg_content
    
    if letter_paths:
        # ═══ FÁZA 1: Parse paths → subpaths (kontúry + segmenty) ═══
        global_min_x, global_min_y = float('inf'), float('inf')
        global_max_x, global_max_y = float('-inf'), float('-inf')
        
        # all_objects: [(label, contours_group, seg_group_list)]
        all_objects = []
        obj_counter = 0
        
        for char, path_d, path_idx in letter_paths:
            try:
                path = svgpathtools.parse_path(path_d)
            except Exception as e:
                print(f"  Warning: SVG path #{path_idx} ('{char}') parse failed: {e}")
                continue
            
            if not path:
                continue
            
            # Rozdeliť na subpaths s kontúrami A segmentami
            subpaths = _parse_svg_path_to_subpaths(path)
            if not subpaths:
                continue
            
            contours = [sp[0] for sp in subpaths]
            seg_groups = [sp[1] for sp in subpaths]
            
            print(f"  SVG path #{path_idx+1}: {len(contours)} contours")
            
            # Aktualizovať globálny bbox
            for contour in contours:
                for x, y in contour:
                    global_min_x = min(global_min_x, x)
                    global_min_y = min(global_min_y, y)
                    global_max_x = max(global_max_x, x)
                    global_max_y = max(global_max_y, y)
            
            # ── Rozhodnutie: rozdeliť alebo nie? ──
            if has_any_data_char and char:
                # Frontend text→SVG: data-char → 1 path = 1 objekt
                all_objects.append((char, contours, seg_groups))
                obj_counter += 1
            elif len(contours) == 1:
                label = char if char else f"obj_{obj_counter}"
                all_objects.append((label, contours, seg_groups))
                obj_counter += 1
            else:
                # Kontúrová analýza: rozdeliť na objekty
                groups, index_groups = _group_contours_into_objects(contours)
                print(f"  SVG path #{path_idx+1}: split {len(contours)} contours "
                      f"→ {len(groups)} independent objects")
                for group_contours, group_indices in zip(groups, index_groups):
                    label = f"obj_{obj_counter}"
                    # Vybrať segmenty pre túto skupinu podľa indexov
                    group_segs = [seg_groups[i] for i in group_indices]
                    all_objects.append((label, group_contours, group_segs))
                    obj_counter += 1
        
        if not all_objects:
            print(f"  SVG: No valid objects found after parsing")
        else:
            # ═══ FÁZA 2: Uniformné škálovanie ═══
            global_width = global_max_x - global_min_x
            global_height = global_max_y - global_min_y
            
            print(f"  SVG global bbox: [{global_min_x:.1f}, {global_min_y:.1f}] - "
                  f"[{global_max_x:.1f}, {global_max_y:.1f}], "
                  f"size {global_width:.1f} × {global_height:.1f}")
            
            if is_mm:
                scale = 1.0
            elif global_height > 0.001:
                scale = target_height_mm / global_height
            else:
                scale = 1.0
            
            total_scaled_w = global_width * scale
            total_scaled_h = global_height * scale
            
            result = []
            filtered_bg = 0
            for label, contours_group, seg_groups in all_objects:
                if is_mm:
                    scaled = contours_group
                else:
                    scaled = [
                        [(x * scale, y * scale) for x, y in c]
                        for c in contours_group
                    ]
                
                # Bounding box
                all_x = [p[0] for c in scaled for p in c]
                all_y = [p[1] for c in scaled for p in c]
                obj_min_x = min(all_x)
                obj_max_x = max(all_x)
                obj_min_y = min(all_y)
                obj_max_y = max(all_y)
                
                obj_width = obj_max_x - obj_min_x
                obj_height = obj_max_y - obj_min_y
                
                # Post-filter pozadia
                if (len(contours_group) == 1 and
                    total_scaled_w > 0 and total_scaled_h > 0):
                    coverage_w = obj_width / total_scaled_w
                    coverage_h = obj_height / total_scaled_h
                    if coverage_w > 0.95 and coverage_h > 0.95:
                        n_pts = len(contours_group[0])
                        if n_pts <= 10:
                            filtered_bg += 1
                            print(f"  FILTERED background: '{label}' "
                                  f"({obj_width:.0f}×{obj_height:.0f}mm, "
                                  f"{coverage_w:.0%}×{coverage_h:.0%} coverage, "
                                  f"{n_pts} points)")
                            continue
                
                # Vytvoriť subpath_data: [(contour_points, segments), ...]
                # pre priamu CadQuery konverziu
                subpath_data = []
                for i, contour in enumerate(contours_group):
                    segs = seg_groups[i] if i < len(seg_groups) else []
                    subpath_data.append((contour, segs))
                
                result.append({
                    'char': label,
                    'contours': scaled,
                    'svg_subpath_data': subpath_data,  # Originálne segmenty
                    'svg_scale': scale,                 # SVG → mm scale
                    'offset_x': obj_min_x,
                    'width': obj_width if obj_width > 0 else 1.0,
                    'height': obj_height if obj_height > 0 else target_height_mm,
                })
            
            if result:
                print(f"\n  ═══ SVG DECOMPOSITION: {len(result)} objects "
                      f"(uniform scale={scale:.4f})"
                      f"{f', {filtered_bg} backgrounds removed' if filtered_bg else ''}"
                      f" ═══")
                for r in result:
                    n_contours = len(r['contours'])
                    holes = n_contours - 1
                    hole_str = f" + {holes} holes" if holes > 0 else ""
                    has_segs = bool(r.get('svg_subpath_data'))
                    print(f"    '{r['char']}': {r['width']:.1f} × {r['height']:.1f} mm "
                          f"({n_contours} contours{hole_str})"
                          f"{' [native Bezier]' if has_segs else ''}")
                return result
    
    # Fallback
    contours = svg_to_contours(svg_content, target_height_mm)
    if not contours:
        return []
    
    width = max(p[0] for c in contours for p in c)
    return [{
        'char': 'logo',
        'contours': contours,
        'offset_x': 0,
        'width': width,
        'height': target_height_mm,
    }]


# ─────────────────────────────────────────────
# Kontúry → CadQuery Wire (polyline, fallback)
# ─────────────────────────────────────────────

def _make_wire_from_points(points: List[Point]) -> cq.Wire:
    """
    Vytvoriť CadQuery Wire z bodov.
    
    Vždy používa polyline (priamkové segmenty).
    S 64 bodmi na Bézierovú krivku sú segmenty < 1mm,
    čo je presnejšie ako BSpline fitting (ktorý môže oscilovať).
    """
    # Odstrániť duplikátne po sebe idúce body
    cleaned = [points[0]]
    for i in range(1, len(points)):
        dx = points[i][0] - cleaned[-1][0]
        dy = points[i][1] - cleaned[-1][1]
        if (dx * dx + dy * dy) > 1e-8:  # min 0.01mm vzdialenosť
            cleaned.append(points[i])
    
    # Uzavri ak nie je uzavretý
    if len(cleaned) >= 3:
        dx = cleaned[0][0] - cleaned[-1][0]
        dy = cleaned[0][1] - cleaned[-1][1]
        if (dx * dx + dy * dy) > 1e-8:
            cleaned.append(cleaned[0])
    
    if len(cleaned) < 4:
        raise ValueError(f"Príliš málo bodov pre wire: {len(cleaned)}")
    
    # ═══ Polyline – spoľahlivé a presné pri hustom vzorkovaní ═══
    edges = []
    for i in range(len(cleaned) - 1):
        p1 = cleaned[i]
        p2 = cleaned[i + 1]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        if (dx * dx + dy * dy) > 1e-10:  # Preskočiť degenerované hrany
            try:
                edges.append(
                    cq.Edge.makeLine(
                        cq.Vector(p1[0], p1[1], 0),
                        cq.Vector(p2[0], p2[1], 0),
                    )
                )
            except Exception:
                pass  # Preskočiť problémovú hranu
    
    if not edges:
        raise ValueError("Žiadne platné hrany z bodov")
    
    return cq.Wire.assembleEdges(edges)


def contours_to_cq_wire(contours: List[List[Point]]) -> cq.Workplane:
    """
    Konvertovať zoznam obrysov na CadQuery Workplane s Wire-mi.
    Prvý obrys = vonkajší, ďalšie = diery.
    """
    if not contours:
        raise ValueError("Žiadne kontúry")
    
    # Outer wire
    outer_wire = _make_wire_from_points(contours[0])
    face = cq.Face.makeFromWires(outer_wire)
    
    # Holes (inner wires)
    if len(contours) > 1:
        inner_wires = []
        for hole_contour in contours[1:]:
            if len(hole_contour) < 3:
                continue
            try:
                hw = _make_wire_from_points(hole_contour)
                inner_wires.append(hw)
            except Exception:
                continue
        
        if inner_wires:
            face = cq.Face.makeFromWires(outer_wire, inner_wires)
    
    return cq.Workplane("XY").add(face)
