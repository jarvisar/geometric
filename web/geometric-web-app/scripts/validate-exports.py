"""Independent reader checks. Run check:exports first. See README for dependencies."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import ezdxf
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1] / 'shots' / 'exports' / 'fixtures'
PT = 72 / 25.4
GS = os.environ.get('GS') or shutil.which('gswin64c') or shutil.which('gs')
if not GS:
    sys.exit('Ghostscript is required. Put gs/gswin64c on PATH or set GS.')


def near(actual, expected, tolerance=0.000011):
    assert len(actual) == len(expected), (actual, expected)
    assert all(abs(float(a) - float(b)) <= tolerance for a, b in zip(actual, expected)), (actual, expected)


def pen_for(fixture, index):
    pens = fixture['pens']
    return pens[index] if index < len(pens) else {'color': '#000000', 'width': 0.3}


def expected_segments(fixture):
    h = fixture['paper']['h']
    for layer in fixture['result']['layers']:
        pen = pen_for(fixture, layer['pen'])
        color = [int(pen['color'][i:i + 2], 16) / 255 for i in (1, 3, 5)]
        for points in layer['paths']:
            for a, b in zip(points, points[1:]):
                yield ([a[0] * PT, (h - a[1]) * PT, b[0] * PT, (h - b[1]) * PT], pen['width'] * PT, color)


def check_pdf(stem, fixture):
    pdf = PdfReader(stem.with_suffix('.pdf'), strict=True)
    assert len(pdf.pages) == 1
    assert pdf.metadata.title == fixture['meta']['title']
    page = pdf.pages[0]
    near(page.mediabox, [0, 0, fixture['paper']['w'] * PT, fixture['paper']['h'] * PT])
    assert not page.images
    expected = iter(expected_segments(fixture))
    current = None
    width = color = None
    cap = join = None
    painted = pending = 0
    for operands, operator in page.get_contents().operations:
        if operator == b'w':
            width = operands[0]
        elif operator == b'RG':
            color = operands
        elif operator == b'J':
            cap = operands[0]
        elif operator == b'j':
            join = operands[0]
        elif operator == b'm':
            assert pending == 0, 'unpainted stroke'
            current = operands
        elif operator == b'l':
            segment, pen_width, pen_color = next(expected)
            near([*current, *operands], segment)
            near([width], [pen_width])
            near(color, pen_color)
            assert cap == join == 1
            current = operands
            pending += 1
        elif operator == b'S':
            assert pending > 0
            painted += pending
            pending = 0
            current = None
        else:
            assert operator in (b'q', b'Q', b'd'), operator
    assert pending == 0
    assert next(expected, None) is None, 'missing segments'
    # PDFium is a second reader, also used by Chromium. Render every exported design.
    doc = pdfium.PdfDocument(stem.with_suffix('.pdf'))
    bitmap = doc[0].render(scale=0.5)
    if painted:
        extrema = bitmap.to_pil().convert('RGB').getextrema()
        assert any(low < 250 for low, high in extrema), 'blank PDF rendering'
    bitmap.close()
    doc.close()


def check_dxf(stem, fixture):
    doc = ezdxf.readfile(stem.with_suffix('.dxf'))
    assert doc.dxfversion == 'AC1018' and doc.units == 4
    audit = doc.audit()
    assert not audit.errors and not audit.fixes, (audit.errors, audit.fixes)
    entities = iter(doc.modelspace())
    h = fixture['paper']['h']
    layer_names = set()
    for layer in fixture['result']['layers']:
        for points in layer['paths']:
            if len(points) < 2:
                continue
            entity = next(entities)
            assert entity.dxftype() == 'LWPOLYLINE'
            name = entity.dxf.layer
            assert name.startswith(f"Pen_{layer['pen'] + 1}_")
            layer_names.add(name)
            rgb = int(pen_for(fixture, layer['pen'])['color'][1:], 16)
            assert entity.dxf.true_color == rgb == doc.layers.get(name).dxf.true_color
            assert entity.dxf.const_width == 0, 'stroke became a cut outline'
            actual = list(entity.get_points('xy'))
            closed = len(points) > 3 and points[0] == points[-1]
            assert bool(entity.closed) == closed
            if closed:
                actual.append(actual[0])
            assert len(actual) == len(points)
            for a, b in zip(actual, points):
                near(a, [b[0], h - b[1]])
    assert next(entities, None) is None, 'extra geometry (border or pen travel)'
    assert len(layer_names) == sum(any(len(p) >= 2 for p in l['paths']) for l in fixture['result']['layers'])


def ghostscript(*args):
    proc = subprocess.run([GS, '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', *map(str, args)], capture_output=True, text=True)
    assert proc.returncode == 0 and not proc.stderr.strip(), proc.stdout + proc.stderr


fixtures = sorted(ROOT.glob('*.json'))
assert fixtures, 'Run npm run check:exports first'
for file in fixtures:
    fixture = json.loads(file.read_text(encoding='utf-8'))
    check_pdf(file, fixture)
    check_dxf(file, fixture)
    ghostscript('-sDEVICE=nullpage', file.with_suffix('.pdf'), file.with_suffix('.eps'))
    print('PASS', file.stem, flush=True)

# Compare EPS and PDF raster output at the same paper size. EPS importers normally
# crop to BoundingBox, so FIXEDMEDIA keeps the paper for this comparison only.
for name in ['asymmetric', 'page-edge', 'long-path', 'landscape', 'design-town']:
    file = ROOT / (name + '.json')
    fixture = json.loads(file.read_text(encoding='utf-8'))
    for ext in ('pdf', 'eps'):
        ghostscript('-sDEVICE=png16m', '-r96', '-dGraphicsAlphaBits=4', '-dFIXEDMEDIA',
                    f"-dDEVICEWIDTHPOINTS={fixture['paper']['w'] * PT}",
                    f"-dDEVICEHEIGHTPOINTS={fixture['paper']['h'] * PT}",
                    f'-sOutputFile={ROOT / (name + "-" + ext + ".png")}', file.with_suffix('.' + ext))
    with Image.open(ROOT / (name + '-pdf.png')) as pdf, Image.open(ROOT / (name + '-eps.png')) as eps:
        assert pdf.size == eps.size
        error = max(ImageStat.Stat(ImageChops.difference(pdf, eps)).mean)
        assert error < 0.15, (name, error)
    print('PASS PDF/EPS rendering', name, flush=True)

print(f'{len(fixtures)} fixtures passed pypdf, PDFium, ezdxf audit and Ghostscript.')
