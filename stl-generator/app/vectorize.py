"""
vectorize.py – PNG → SVG vektorizácia pre 3D tlač

Dva režimy:
  1. potrace CLI (najvyššia kvalita, ak je nainštalovaný: brew install potrace)
  2. Pure Python fallback (Pillow + numpy – žiadne externé závislosti)

Výstup: Čisté SVG kontúry vhodné pre CadQuery extrúziu.
"""

import io
import os
import shutil
import subprocess
import tempfile
import base64
import math
from typing import Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter, ImageOps

# ─────────────────────────────────────────────
# Hlavná API funkcia
# ─────────────────────────────────────────────

def png_to_svg(
    png_data: bytes,
    threshold: int = 128,
    invert: bool = False,
    blur_radius: float = 1.0,
    simplify_tolerance: float = 1.0,
    min_area: int = 100,
    target_width_mm: Optional[float] = None,
    target_height_mm: Optional[float] = None,
) -> dict:
    """
    Konvertuje PNG obrázok na SVG vektorovú grafiku.

    Args:
        png_data: Raw PNG bytes
        threshold: Prah pre binarizáciu (0-255, default 128)
        invert: Invertovať čierne/biele (pre tmavé logá na bielom pozadí)
        blur_radius: Gaussian blur pred binarizáciou (vyhladzuje šum)
        simplify_tolerance: Tolerancia zjednodušenia kontúr (vyššia = menej bodov)
        min_area: Minimálna plocha kontúry v pixeloch (odfiltruje šum)
        target_width_mm: Cieľová šírka v mm (ak None, použije px)
        target_height_mm: Cieľová výška v mm (ak None, použije px)

    Returns:
        dict s kľúčmi:
          - svg: str (SVG obsah)
          - width: float (šírka v mm alebo px)
          - height: float (výška v mm alebo px)
          - contour_count: int (počet kontúr)
          - method: str ('potrace' alebo 'python')
    """
    # Načítať a predspracovať obrázok
    img = Image.open(io.BytesIO(png_data))

    # Konvertovať RGBA → RGB → Grayscale
    if img.mode == 'RGBA':
        # Nahradiť alfa kanál bielym pozadím
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    img_gray = img.convert('L')

    # Blur pre vyhladzenie
    if blur_radius > 0:
        img_gray = img_gray.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    # Auto-detect: ak je pozadie tmavé, invertovať
    pixels = np.array(img_gray)
    border_mean = np.mean([
        pixels[0, :].mean(),
        pixels[-1, :].mean(),
        pixels[:, 0].mean(),
        pixels[:, -1].mean(),
    ])

    if border_mean < 128:
        invert = not invert

    # Binarizácia
    if invert:
        img_bin = img_gray.point(lambda x: 0 if x > threshold else 255, '1')
    else:
        img_bin = img_gray.point(lambda x: 255 if x > threshold else 0, '1')

    # Orezať whitespace
    img_bin = _autocrop(img_bin, padding=5)

    w, h = img_bin.size

    # Spočítať mierku pre mm
    scale_x = 1.0
    scale_y = 1.0
    out_w = float(w)
    out_h = float(h)

    if target_width_mm and target_height_mm:
        scale_x = target_width_mm / w
        scale_y = target_height_mm / h
        # Zachovať pomer strán
        scale = min(scale_x, scale_y)
        scale_x = scale_y = scale
        out_w = w * scale
        out_h = h * scale
    elif target_height_mm:
        scale = target_height_mm / h
        scale_x = scale_y = scale
        out_w = w * scale
        out_h = target_height_mm
    elif target_width_mm:
        scale = target_width_mm / w
        scale_x = scale_y = scale
        out_w = target_width_mm
        out_h = h * scale

    # Pokus 1: potrace CLI
    potrace_path = shutil.which('potrace')
    if potrace_path:
        try:
            svg_content = _vectorize_potrace(
                img_bin, potrace_path, simplify_tolerance, out_w, out_h
            )
            contour_count = svg_content.count('<path')
            return {
                'svg': svg_content,
                'width': round(out_w, 2),
                'height': round(out_h, 2),
                'contour_count': contour_count,
                'method': 'potrace',
            }
        except Exception as e:
            print(f"[vectorize] potrace failed, fallback to Python: {e}")

    # Pokus 2: Python fallback
    svg_content = _vectorize_python(
        img_bin, min_area, simplify_tolerance, scale_x, scale_y, out_w, out_h
    )
    contour_count = svg_content.count('<path')
    return {
        'svg': svg_content,
        'width': round(out_w, 2),
        'height': round(out_h, 2),
        'contour_count': contour_count,
        'method': 'python',
    }


# ─────────────────────────────────────────────
# Potrace CLI
# ─────────────────────────────────────────────

def _vectorize_potrace(
    img_bin: Image.Image,
    potrace_path: str,
    turdsize: float,
    out_w: float,
    out_h: float,
) -> str:
    """Vektorizácia cez potrace CLI (najvyššia kvalita)."""
    with tempfile.TemporaryDirectory(prefix="vectorize_") as tmpdir:
        # Uložiť ako PBM (potrace input)
        pbm_path = os.path.join(tmpdir, "input.pbm")
        svg_path = os.path.join(tmpdir, "output.svg")

        # Potrace potrebuje invertnú logiku: čierne = vyplnené
        # PBM: 1 = čierna, 0 = biela
        img_bin.save(pbm_path, format='PPM')

        # Spustiť potrace
        cmd = [
            potrace_path,
            pbm_path,
            '-s',  # SVG výstup
            '-o', svg_path,
            '--flat',  # Bez skupín
            '-t', str(max(1, int(turdsize))),  # Turd size (min area)
            '-a', '1.0',  # Corner threshold
            '--opttolerance', '0.2',  # Optimization tolerance
            '-W', str(out_w),  # Width
            '-H', str(out_h),  # Height
            '--unit', '1',  # 1 unit = 1mm
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            raise RuntimeError(f"potrace exit {result.returncode}: {result.stderr}")

        with open(svg_path, 'r') as f:
            svg_raw = f.read()

        # Očistiť SVG (odstrániť potrace metadata, nastaviť viewBox)
        return _clean_potrace_svg(svg_raw, out_w, out_h)


def _clean_potrace_svg(svg_raw: str, width: float, height: float) -> str:
    """Vyčistiť SVG výstup z potrace."""
    import re

    # Extrahovať path elementy
    paths = re.findall(r'<path[^>]*d="([^"]*)"[^>]*/>', svg_raw)
    if not paths:
        paths = re.findall(r'<path[^>]*d="([^"]*)"[^>]*>', svg_raw)

    if not paths:
        # Skúsiť nájsť d= atribút
        paths = re.findall(r'd="([^"]*)"', svg_raw)

    svg_paths = '\n'.join(
        f'  <path d="{d}" fill="black" fill-rule="evenodd"/>'
        for d in paths
        if d.strip()
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width:.2f} {height:.2f}" '
        f'width="{width:.2f}" height="{height:.2f}">\n'
        f'{svg_paths}\n'
        f'</svg>'
    )


# ─────────────────────────────────────────────
# Python fallback – Marching Squares + SVG
# ─────────────────────────────────────────────

def _vectorize_python(
    img_bin: Image.Image,
    min_area: int,
    simplify_tolerance: float,
    scale_x: float,
    scale_y: float,
    out_w: float,
    out_h: float,
) -> str:
    """Pure Python vektorizácia pomocou boundary tracing."""
    pixels = np.array(img_bin, dtype=np.uint8)
    h, w = pixels.shape

    # Nájsť kontúry (boundary tracing)
    contours = _find_contours(pixels)

    # Filtrovať malé kontúry
    contours = [c for c in contours if _contour_area(c) >= min_area]

    # Zjednodušiť (Douglas-Peucker)
    simplified = []
    for contour in contours:
        s = _douglas_peucker(contour, simplify_tolerance)
        if len(s) >= 3:
            simplified.append(s)

    # Previesť na SVG paths
    svg_paths = []
    for contour in simplified:
        # Škálovať body
        scaled = [(x * scale_x, y * scale_y) for x, y in contour]
        path_d = _contour_to_svg_path(scaled)
        svg_paths.append(f'  <path d="{path_d}" fill="black" fill-rule="evenodd"/>')

    svg_content = '\n'.join(svg_paths)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {out_w:.2f} {out_h:.2f}" '
        f'width="{out_w:.2f}" height="{out_h:.2f}">\n'
        f'{svg_content}\n'
        f'</svg>'
    )


def _find_contours(binary: np.ndarray) -> list:
    """
    Nájde kontúry v binárnom obrázku.
    Používa Suzuki-Abe boundary following algorithm (zjednodušený).

    binary: 2D numpy array, 0=pozadie, 255=objekt (alebo >0)
    Returns: List kontúr, kde každá kontúra je list (x, y) bodov.
    """
    h, w = binary.shape
    # Normalizovať na 0/1
    bw = (binary > 0).astype(np.int32)

    # Padding pre boundary detection
    padded = np.pad(bw, 1, mode='constant', constant_values=0)

    visited = set()
    contours = []

    # Skenovať po riadkoch
    for y in range(1, h + 1):
        for x in range(1, w + 1):
            # Hranica: pixel je objekt a predchádzajúci je pozadie
            if padded[y, x] == 1 and padded[y, x - 1] == 0:
                if (x, y) in visited:
                    continue

                contour = _trace_boundary(padded, x, y, visited)
                if len(contour) >= 3:
                    # Odstrániť padding offset
                    contour = [(px - 1, py - 1) for px, py in contour]
                    contours.append(contour)

    return contours


def _trace_boundary(
    padded: np.ndarray,
    start_x: int,
    start_y: int,
    visited: set,
) -> list:
    """Moore boundary tracing algorithm."""
    # 8-connectivity directions (clockwise from left)
    #   5 6 7
    #   4 . 0
    #   3 2 1
    dx = [1, 1, 0, -1, -1, -1, 0, 1]
    dy = [0, 1, 1, 1, 0, -1, -1, -1]

    contour = [(start_x, start_y)]
    visited.add((start_x, start_y))

    x, y = start_x, start_y
    direction = 0  # Začať smerom vpravo

    max_steps = padded.shape[0] * padded.shape[1]  # Safety limit
    steps = 0

    while steps < max_steps:
        steps += 1

        # Začať hľadať od (direction + 5) % 8 (otočiť doľava a skenovať CW)
        search_start = (direction + 5) % 8
        found = False

        for i in range(8):
            d = (search_start + i) % 8
            nx, ny = x + dx[d], y + dy[d]

            if (0 <= nx < padded.shape[1] and 0 <= ny < padded.shape[0]
                    and padded[ny, nx] == 1):
                x, y = nx, ny
                direction = d

                if (x, y) == (start_x, start_y):
                    return contour  # Dokončená slučka

                contour.append((x, y))
                visited.add((x, y))
                found = True
                break

        if not found:
            break  # Izolovaný pixel

    return contour


def _contour_area(contour: list) -> float:
    """Shoelace formula pre plochu kontúry."""
    n = len(contour)
    if n < 3:
        return 0.0

    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += contour[i][0] * contour[j][1]
        area -= contour[j][0] * contour[i][1]
    return abs(area) / 2.0


def _douglas_peucker(points: list, tolerance: float) -> list:
    """Douglas-Peucker line simplification algorithm."""
    if len(points) <= 2:
        return points

    # Nájsť bod s najväčšou vzdialenosťou od úsečky start-end
    start = points[0]
    end = points[-1]

    max_dist = 0.0
    max_idx = 0

    for i in range(1, len(points) - 1):
        d = _point_line_distance(points[i], start, end)
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > tolerance:
        # Rekurzívne zjednodušiť obe polovice
        left = _douglas_peucker(points[:max_idx + 1], tolerance)
        right = _douglas_peucker(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [start, end]


def _point_line_distance(
    point: Tuple[float, float],
    line_start: Tuple[float, float],
    line_end: Tuple[float, float],
) -> float:
    """Vzdialenosť bodu od úsečky."""
    x0, y0 = point
    x1, y1 = line_start
    x2, y2 = line_end

    dx = x2 - x1
    dy = y2 - y1

    if dx == 0 and dy == 0:
        return math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2)

    t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))

    px = x1 + t * dx
    py = y1 + t * dy

    return math.sqrt((x0 - px) ** 2 + (y0 - py) ** 2)


def _contour_to_svg_path(points: list) -> str:
    """Konvertuje kontúru na SVG path dáta s cubic bezier krivkami."""
    if len(points) < 3:
        return ""

    # Pre hladkejšie krivky použijeme cubic bezier
    # Ale pre jednoduché línie stačí L
    # Tu použijeme kombináciu: riadne body → L, s vyhladzením → C

    path = f"M {points[0][0]:.2f},{points[0][1]:.2f}"

    # Catmull-Rom → Cubic Bezier conversion pre hladké krivky
    n = len(points)
    if n <= 4:
        # Pre málo bodov použiť priame línie
        for x, y in points[1:]:
            path += f" L {x:.2f},{y:.2f}"
    else:
        # Cubic bezier z Catmull-Rom spline
        for i in range(1, n):
            p0 = points[(i - 1) % n]
            p1 = points[i % n]
            p2 = points[(i + 1) % n]
            p3 = points[(i + 2) % n]

            # Catmull-Rom to Bezier
            cp1x = p1[0] + (p2[0] - p0[0]) / 6.0
            cp1y = p1[1] + (p2[1] - p0[1]) / 6.0
            cp2x = p2[0] - (p3[0] - p1[0]) / 6.0
            cp2y = p2[1] - (p3[1] - p1[1]) / 6.0

            path += f" C {cp1x:.2f},{cp1y:.2f} {cp2x:.2f},{cp2y:.2f} {p2[0]:.2f},{p2[1]:.2f}"

    path += " Z"
    return path


def _autocrop(img: Image.Image, padding: int = 5) -> Image.Image:
    """Orezať whitespace okolo objektu."""
    # Konvertovať na numpy
    arr = np.array(img, dtype=np.uint8)

    # Nájsť bounding box nenulových pixelov
    if arr.max() == 0:
        return img  # Celé je prázdne

    # Pre 1-bit obrázok: 0 = biela (pozadie), 1/255 = čierna (objekt)
    # Pillow '1' mode ukladá ako 0/255
    nonzero = np.argwhere(arr > 0)
    if len(nonzero) == 0:
        return img

    y_min, x_min = nonzero.min(axis=0)
    y_max, x_max = nonzero.max(axis=0)

    # Pridať padding
    h, w = arr.shape
    x_min = max(0, x_min - padding)
    y_min = max(0, y_min - padding)
    x_max = min(w - 1, x_max + padding)
    y_max = min(h - 1, y_max + padding)

    return img.crop((x_min, y_min, x_max + 1, y_max + 1))


# ─────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────

def png_base64_to_svg(
    png_base64: str,
    target_height_mm: float = 200.0,
    **kwargs,
) -> dict:
    """
    Convenience wrapper: base64 PNG → SVG.

    Args:
        png_base64: Base64-encoded PNG (s alebo bez data: prefix)
        target_height_mm: Cieľová výška v mm
        **kwargs: Ostatné parametre pre png_to_svg()
    """
    # Odstrániť data URL prefix
    if ',' in png_base64:
        png_base64 = png_base64.split(',', 1)[1]

    png_data = base64.b64decode(png_base64)

    return png_to_svg(
        png_data,
        target_height_mm=target_height_mm,
        **kwargs,
    )
