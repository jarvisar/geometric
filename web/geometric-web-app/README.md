# Plotter Geometry

Generative geometric line art built for pen plotters. Pick a design, push the
sliders around (or hit **Randomize** until something grabs you), then export a
plot-ready file. Everything is lines, in millimetres, already cut to the margins,
with pen strokes joined and ordered so the plotter spends as little time
as possible in the air.

No build step and no dependencies: open `src/index.html` in a browser, or run
`npm start` for a live-reloading server.

## Designs

30 designs, each with its own controls, seeded randomness and a curated **Randomize**.

**Curves** — centred figures, mostly single continuous strokes
* **Spirograph**: hypotrochoids and epitrochoids with real tooth counts, so every curve closes exactly. Nested pen-hole rings.
* **Mystery Curves**: Frank Farris's "wheels on wheels", sums of rotating vectors with exact n-fold symmetry.
* **Harmonograph**: damped pendulums (plus an optional rotary table) near simple frequency ratios.
* **Maurer Rose**: straight chords stepping around a rose curve, with an optional second web.
* **Superformula**: Gielis supershapes stacked, shrinking, twisting and morphing inward.
* **Guilloché**: banknote-style rosettes from bands of phase-shifted waves.
* **Times Table**: modular-multiplication chords (cardioids, nephroids), drawn orbit by orbit.
* **Flower**: the original nested-petal flower, fixed and extended.
* **Phyllotaxis**: sunflower seed heads, as dots or Fibonacci spiral nets.
* **Strange Attractor**: Lorenz, Aizawa, Thomas, Halvorsen and more, integrated in 3D and projected.

**Fields**: designs that fill the page
* **Flow Field**: evenly spaced streamlines (Jobard–Lefer) through noise, curl, vortex, wave or spiral fields.
* **Ridgelines**: *Unknown Pleasures*-style stacked profiles with proper hidden-line removal.
* **Topographic**: contour maps of warped fractal terrain, with index contours on a second pen.
* **Chladni**: nodal patterns of vibrating square plates and circular membranes (real Bessel modes), with "sand" bands.
* **Field Lines**: electric field lines and equipotentials of charges (dipoles, quadrupoles, plates, random), or the magnetic field around wires, traced so line density follows field strength.
* **Moiré**: overlaid circles, gratings, spirals or rays on separate pens.
* **Op-Art Warp**: Vasarely-style bulges pushing hatched checkerboards out of the page.

**Tiles**
* **Truchet**: arc, hex-arc, diagonal and hatched-triangle tiles, random or noise-structured.
* **Islamic Stars**: Hankin's polygons-in-contact method over eight tilings, with optional woven strapwork.
* **Penrose Tiling**: aperiodic rhombs (P3) or kites and darts (P2) by Robinson-triangle deflation, with matching arcs, hatching or nested fills.
* **Hyperbolic Tiling**: regular {p, q} tilings of the Poincaré disk, like Escher's *Circle Limit*: edges, the triangle kaleidoscope, nested tiles or a hatched checkerboard.
* **Celtic Knot**: interlaced knotwork on a grid of dots, with random, symmetric or framed breaks and properly alternating over/under crossings.
* **Whirls**: pursuit-curve polygons, alone or tiled with alternating spin.
* **Maze**: rectangular or circular (theta) mazes, with the solution on a second pen.
* **L-System**: Hilbert, Peano, Gosper, dragons, Koch, Sierpiński, plants, kolams and your own rules, optionally with rounded corners.

**Packing**
* **Circle Packing**: packed circles filled with eccentric "bubble" rings, spirals, rings or hatching.
* **Apollonian Gasket**: every gap between tangent circles filled by Descartes' theorem, including the integral gaskets.
* **Subdivision**: recursive rectangles and triangles, each hatched, cross-hatched or nested at its own tone.
* **Voronoi**: relaxed Voronoi cells with spiral insets, hatching or rounded "pebble" outlines.

**Image**
* **Image**: turns a photo into a squiggle spiral, squiggled rows, cross-hatching or a single-line TSP portrait. Works with a built-in demo scene until you drop in a picture.

Any design can also be laid out as a **grid** on one sheet. Each cell gets its own seed or its own random parameters, or one parameter sweeps from cell to cell.

## Plotting workflow

1. **Paper**: pick a size (A6–A2, US sizes, cards, squares or custom) and a margin.
   Nothing is ever drawn outside the margin.
2. **Composition**: scale, rotate or offset the design, crop it to a circle,
   hexagon or diamond, and optionally draw a (double) frame.
3. **Pens**: up to six pens. Designs with a colour split put each part on its own pen.
   Set pen widths to match your pens: the preview draws true-to-scale
   line widths, so you can judge ink density before committing. Hide a pen to
   leave it out of the preview and the export.
4. **Optimize**: joins strokes that touch and simplifies points below a
   tolerance, for smaller, cleaner files. The status bar shows the path and
   point counts.
5. **Export**:
   * **SVG**: `width`/`height` in mm, one Inkscape layer per pen (`1 Pen 1`,
     `2 Pen 2`…), so AxiDraw's Inkscape extension, `vpype`, `saxi` and
     friends plot pens as separate layers. "One file per pen" is also available.
   * **PNG**: a 200 dpi picture of the preview.

Every exported SVG carries its full recipe (design, parameters, seed, paper,
pens). Drop an SVG or a saved `.json` back onto the preview to restore it. **Copy share link**
does the same through a URL.

## Handy bits

* **Seeds**: every random choice comes from the seed, so the same seed and settings
  always give the same drawing. `Space` rolls a new seed; `R` randomizes the
  parameters too.
* **Locks**: hover a parameter and click the lock to keep it fixed while
  randomizing.
* **Snapshots** (`S`): keep designs you like, with thumbnails, in the browser.
* **Undo / redo**: `Ctrl+Z` / `Ctrl+Shift+Z`. Double-click a parameter label to reset it.
* **Images**: the *Image* design turns a photo into spiral, squiggle, cross-hatch or
  single-line TSP art. Drop a picture onto the preview.
* Press `?` in the app for all keyboard shortcuts.

## Project layout

```
src/
  index.html, styles.css, app.js   UI
  lib/
    core.js        registry, seeded RNG, geometry helpers (hatching, insetting, …)
    noise.js       seeded simplex noise, fBm, curl noise
    contours.js    marching-squares iso-lines stitched into polylines
    pipeline.js    fit / rotate / clip to the drawing area / frame
    optimize.js    simplify, merge, travel ordering, stats
    export.js      SVG export
    render.js      canvas preview
    loader.js      list of design files
  generators/      one file per design
  dev/sheet.html   contact sheet of designs + random variants
scripts/
  check.js         runs every design through the pipeline (npm run check)
  shot.js          headless-Chrome screenshot of any page
  drive.js         tiny DevTools-protocol driver for UI tests (npm run smoke)
```

## Publishing

`.github/workflows/pages.yml` (at the repo root) publishes `src/` to GitHub Pages
on every push to `master` that touches it, or on demand from the Actions tab.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Adding a design

See [GENERATORS.md](GENERATORS.md). In short: add `src/generators/<id>.js` that calls
`PG.register({ id, name, params, generate })`, list it in `src/lib/loader.js`, and
the app builds its controls automatically. Check it with
`node scripts/check.js <id>` and
`node scripts/shot.js dev/sheet.html "gens=<id>&variants=3" out.png`.
