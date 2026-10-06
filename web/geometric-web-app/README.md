# Plotter Geometry

Generative geometric line art built for pen plotters. Pick a design, push the
sliders around (or hit **Randomize** until something grabs you), then export a
plot-ready file. Everything is lines, in millimeters, already cut to the margins,
with pen strokes joined and ordered so the plotter spends as little time
as possible in the air.

No build step and no dependencies: open `src/index.html` in a browser, or run
`npm start` for a live-reloading server.

## Designs

41 designs, each with its own controls, seeded randomness and a curated **Randomize**.

**Curves** — centered figures, mostly single continuous strokes
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
* **Ribbon Sculpture**: twisted bands of fine chevron ribs, as a linked chain, a Möbius band, torus knots, a figure-eight knot, Borromean rings, a torus of linked rings, a coil or an infinity loop. The side of the band facing you picks the pen, so every twist shows up as a change of color. Ribs are spaced evenly along the band and thin out where it turns edge-on, so folds don't turn into blobs of ink.

**Fields**: designs that fill the page
* **Flow Field**: evenly spaced streamlines (Jobard–Lefer) through noise, curl, vortex, wave or spiral fields.
* **Ridgelines**: *Unknown Pleasures*-style stacked profiles with proper hidden-line removal.
* **Topographic**: contour maps of warped fractal terrain, with index contours on a second pen.
* **Chladni**: nodal patterns of vibrating square plates and circular membranes (real Bessel modes), with "sand" bands.
* **Field Lines**: electric field lines and equipotentials of charges (dipoles, quadrupoles, plates, random), or the magnetic field around wires, traced so line density follows field strength.
* **Moiré**: overlaid circles, gratings, spirals or rays on separate pens.
* **Op-Art Warp**: Vasarely-style bulges pushing hatched checkerboards out of the page.
* **Tidal Atlas**: one landscape drawn again and again as the sea rises, so the valleys drown into fjords and the ridges break up into islands. The terrain comes from a quick erosion simulation, as an alpine massif, a fjord coast, an archipelago or a volcanic island. Land is drawn with fine ridge lines, contours, hachures or a wire mesh, and the sea with coastal ripple lines like an old atlas. Each study can be cut out as a block with the water standing in section and a tide staff beside it.

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

**Scenes**
* **Moon Base**: a dense lunar settlement of geodesic garden biospheres and barrel-vault greenhouses, paired pressure habitats, workshops and a tall control tower, connected by ribbed tunnels and service roads. A shuttle stands beside its launch gantry, a four-legged lander waits on an octagonal pad, and rovers travel between solar fields, oxygen tanks, cargo cranes and a crater drilling rig. Clear front glazing reveals growing beds and trees. Three colony plans, adjustable density, crater terrain and camera controls use the same isometric hidden-line engine as Town and Harbor. Six pens separate black structures, red collars, blue shadows and solar cells, gold equipment, green gardens and light blue glass; seven add astronauts and eight lunar dust.
* **Town**: an isometric town built as a small 3D scene, with houses, apartments, A-frames, windmills, cars, fences, trees and yard clutter. The middle gets built up with terraces, shops and squares, and there can be a church, a clock tower, boulevards, roundabouts and a river with bridges and boats. Hidden lines are removed exactly, so only the visible outlines get plotted. The camera angle, scale, block size and how busy the streets are can all be changed. Up to eight pens, where 5 to 8 give cars, people, the river and fences a pen each.
* **Harbor**: a fishing town on the quay with piers, moored boats, canals, docks, wharves with cranes, canal houses, a church and a clock tower. The lighthouse sits on a straight or bent breakwater or on its own island, and can have red bands. Out in the bay there are boats on moorings, a cargo ship at anchor or a schooner under full sail, channel buoys, rocks with a beacon, people rowing and gulls. Boats get painted stripes, some sails are tan, and ripple lines follow the shore like on an old chart. Drawn for four pens: red and black roof hatching, blue shadows and water, yellow canopies. Six pens make the trees green and the people and cars purple, and eight add light blue water and brown piers and boats.
* **Fairground**: a funfair with a big wheel, a figure-of-eight roller coaster, a striped big top, a carousel, a helter skelter, swing rides, a drop tower, a pirate ship, teacups, bumper cars, a boating lake with swan pedalos, game stalls and bunting. The paths come from a Voronoi diagram, so they wind between the rides. Drawn for the same pens as Harbor, except with eight it's the paths that go brown.
* **Trainyard**: a railway yard where the tracks fan out both ways from the lead, with a coaling tower, a water tower and a long lattice footbridge over the lot. The engine depot is a roundhouse round a turntable, a round engine house under a conical roof or a straight shed. The yard is full of boxcars, reefers, tank cars, hoppers, cattle wagons, car carriers, gondolas, flat cars with logs and containers, and cabooses, with steam engines and diesels shunting. A train goes by on the main line trailing its steam, under overhead wires with electric engines if you turn them on. On the near side there's a station under canopies or an arched train shed, or a goods yard with a gantry crane over the container stacks. Terraced streets fill the corners, and the ones on the near side show their back yards and washing lines. Works with tall chimneys and gasholders can take over some of the blocks. Uses the Harbor colors, and from five pens the track gets its own brown.
* **Alpine Valley**: an illustrated mountain village looking up a valley to jagged snowy peaks. The mountains come from a quick erosion pass, so ridges and gullies branch like real ones, and they're drawn with blue shading on the slopes away from the sun and broken ink ledges on the steep rock. The village has chalets with timber balconies and shutters, a square with a fountain and the church, a grand hotel, a station, and farms with fields, haystacks and cows. A train crosses a stone viaduct, a cable car goes up to the highest summit, and there are barns dotted up the slopes, fir woods, boats on the lake and a cross on a summit. It shares Harbor and Fairground's ink, red, blue and gold palette. Extra pens separate the forest, people, water and timber. It fills the page by default, or shows the whole valley as a block with optional topographic contours and a cutaway base.
* **Skyline District**: a crowded city in isometric ink. Neighboring blocks share a district, so glass towers cluster downtown, deco and office towers fill midtown and Kowloon-style blocks covered in rooms and AC units make up the old quarter. Around a faceted diagrid cone or a TV tower there are garden towers, a gothic cathedral, a building site with a tower crane and a geodesic dome. A river or canal crosses the lower part of the page with steel bridges, boats and container barges. An elevated highway and a monorail cut through, with cables, neon signs, rooftop pools, yellow cabs, a helicopter and an airship overhead. Drawn for five pens: black, red signs and roofs, blue shade, shadows and water, yellow markings and taxis, and green trees.
* **Infinite Stairwell**: looking straight down a spiral stairwell, or up it from the floor, in one-point perspective. The string along the open well winds away in a spiral, with the handrail and balusters on top and a compass or checkered floor, or a glazed lantern, at the far end. Round, octagonal and hexagonal wells, or a square one with landings in the corners. Step edges and balusters thin out as they recede, so the middle doesn't fill in with ink.
* **Cosmic Comics**: comic pages of little alien landscapes. The panels come from recursive cuts, and the time of day moves along the page, from day into night, night into day, or with a planet getting closer. There are faceted mountains, lakes, mesas and arches, moons, crystal worlds, puffy clouds with hatched undersides, ringed planets, sunbursts and the odd flying saucer. Each page keeps one sky style per time of day, and the mountains go dark once the sun is down. A little astronaut turns up across the panels, sometimes in a big over-the-shoulder shot in the feature panel. Also works as a contact sheet or a single postcard.

**Image**
* **Image**: turns a photo into plotter lines. Each style has its own card in the gallery: squiggle spiral, squiggle rows, waves with hidden lines, cross-hatch, engraving-style flow lines, contours, halftone, stipple, TSP art, scribble loops, an adaptive Hilbert curve and string art. They're all modes of one design, so a loaded photo carries over when you switch. Until you drop in a picture it uses a built-in demo, either spheres, the moon or Saturn.

Any design can also be laid out as a **grid** on one sheet. Each cell gets its own seed or its own random parameters, or one parameter sweeps from cell to cell.

## Plotting

1. **Paper**: pick a size (A6–A2, US sizes, cards, squares or custom) and a margin.
   Nothing is ever drawn outside the margin.
2. **Composition**: scale, rotate or offset the design, crop it to a circle,
   hexagon or diamond, and optionally draw a (double) frame.
3. **Pens**: up to eight pens. Designs with a color split put each part on its own pen.
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
     Each pen's strokes are written as one compound path, so Bambu Suite and
     similar importers bring in one object per pen instead of thousands. Use
     `Path > Break Apart` in Inkscape if you want to edit single strokes.
   * **PDF**: vector strokes on a page matching the selected paper size. Keeps
     pen colors, widths and round ends. Use `Actual size` or `100%` when printing.
     Good for printing, placing artwork in a layout and opening in a vector editor.
   * **DXF**: AutoCAD 2004 ASCII DXF, with one numbered layer per pen, RGB colors
     and millimeter units. Each stroke is a zero-width polyline for CAD, laser
     engraving and cutter software. Pen widths do not become cut outlines.
     Select millimeters if the importer asks. Importers that ignore RGB colors
     use an approximate indexed color. Layer names use ASCII and replace special
     characters with underscores. DXF has no paper background or artboard.
   * **EPS**: EPSF 3.0, PostScript Level 2, with RGB strokes and pen widths. Its
     bounds include the ink rather than the full paper, so placing it usually
     crops away the margins. Use PDF when the full page size matters.
   * **PNG**: a 600 dpi picture of the preview.

Vector exports contain the visible pens only, without the preview's paper color,
travel lines or guides. PDF and EPS retain colors but do not retain named pen
layers. Use SVG for layered editing and plotter workflows. The artwork stays as
centerlines with open strokes, so choose a draw/score/engrave operation in cutter
software as needed. It is not automatically converted to closed cutting contours.
PDF and EPS use RGB, without a CMYK profile or PDF/X prepress setup.

Every exported SVG carries its full recipe (design, parameters, seed, paper,
pens). Drop an SVG or a saved `.json` back onto the preview to restore it. **Copy share link**
does the same through a URL for drawings without uploaded photos. For photo
drawings, share the JSON or SVG file instead. Both include the image data.

## Usage

* **Seeds**: every random choice comes from the seed, so the same seed and settings
  always give the same drawing. `Space` rolls a new seed; `R` randomizes the
  parameters too. `Shift+R` jumps to a random design and randomizes that.
* **Locks**: hover a parameter and click the lock to keep it fixed while
  randomizing. Locking **Pens** also keeps the pen count when switching designs,
  including gallery presets and `Shift+R`. Unlock it to use each design's own count.
* **Snapshots** (`S`): keep designs you like, with thumbnails, in the browser.
* **Undo / redo**: `Ctrl+Z` / `Ctrl+Shift+Z`. Double-click a parameter label to reset it.
  `Reset` puts the design's parameters back to defaults. The arrow next to it has
  `Reset everything`, which does that for every design, resets the seed, paper,
  pens and layout, and clears the locks. Undo brings it all back except the locks.
* **Images**: the *Image* design turns a photo into line art in 12 styles. Drop a
  picture onto the preview. Photos stay in this browser across reloads, and undo
  restores cleared or replaced photos. TSP refinement and the flow line packing
  count work instead of elapsed time, so CPU speed does not change the drawing.
  String art works best when the subject fills the circle of pins. It stops by
  itself once another line would make the drawing darker than the photo.
* **Sections**: click a heading in the settings pane to collapse it. Each design
  remembers its collapsed sections. The pen-count control is at the top.
* Press `?` in the app for all keyboard shortcuts.

## Code layout

```
src/
  index.html, styles.css, app.js   UI
  about/, pages.css                about page
  designs/         a page per design, built by scripts/build-pages.js
  images/          design previews and screenshots, from npm run previews
  lib/
    core.js        registry, seeded RNG, geometry helpers (hatching, insetting, …)
    noise.js       seeded simplex noise, fBm, curl noise
    contours.js    marching-squares iso-lines stitched into polylines
    iso.js         3D scenes for the Scenes designs: camera, solids, hidden-line removal, shadows
    isokit.js      walls, windows, roofs, cars, fences and people shared by the Scenes designs
    pipeline.js    fit / rotate / clip to the drawing area / frame
    optimize.js    simplify, merge, travel ordering, stats
    export.js      SVG, PDF, DXF and EPS export
    render.js      canvas preview
    loader.js      list of design files
  generators/      one file per design
  dev/sheet.html   contact sheet of designs + random variants
scripts/
  check.js         runs every design through the pipeline (npm run check)
  shot.js          headless-Chrome screenshot of any page
  drive.js         tiny DevTools-protocol driver for UI tests (npm run smoke)
  build-pages.js   design pages and sitemap (npm run build:pages)
```

## Publishing

`.github/workflows/pages.yml` (at the repo root) publishes `src/` to GitHub Pages
on every push to `master` that touches it, or on demand from the Actions tab.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Export Checks

Run `npm run check:exports` for format checks and fixtures from every design,
including long strokes, closed loops, Unicode metadata, page edges, individual
pens and custom paper sizes. Files go in the ignored `shots/exports/fixtures/`
folder. Run `npm run smoke:exports` for downloads, hidden pens, pending edits and
the mobile menu in Chrome or Edge.

For independent readers, install Python packages `ezdxf==1.4.3`, `pypdf==6.19.0`,
`pypdfium2==5.13.0` and Pillow in a test environment, and install Ghostscript.
Run `python scripts/validate-exports.py` after generating the fixtures. This
checks each DXF with ezdxf's auditor, compares imported geometry against the
source, reads each PDF with pypdf and PDFium, and renders PDF/EPS with Ghostscript.
Set `GS` to the Ghostscript executable if it is not on `PATH`.

The writers follow the [Adobe PDF reference](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf),
[Adobe EPS specification](https://printtechnologies.org/standards/files/epsf_spec_v3_0.pdf)
and Autodesk's [DXF header](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-DXF/files/GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A.htm)
and [polyline](https://help.autodesk.com/cloudhelp/2015/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm)
references. Format choices cover [Illustrator's supported formats](https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/supported-file-formats.html)
and [LightBurn's vector imports](https://docs.lightburnsoftware.com/latest/Reference/FileManagement/).
LightBurn's [DXF unit settings](https://docs.lightburnsoftware.com/1.7/Reference/SettingsPreferences/)
can override file units. Silhouette documents [DXF import limitations](https://silhouetteamerica.freshdesk.com/support/solutions/articles/35000276938-importing-and-exporting-troubleshooting)
and recommends an older dialect for some workflows, so this export is not a
promise of compatibility with every cutter. SVG remains the default for Cricut.
These automated checks do not replace testing in specific versions of commercial
editors and machine software.

Also checked with Inkscape 1.3's Poppler PDF importer and its EPS/DXF import
extensions. The sample remains vector artwork in all three. DXF keeps its pen
layers and a measured 50 mm line, but this Inkscape version uses indexed colors
instead of the stored RGB colors.

## Adding a design

Generation runs in a cancellable worker, including gallery thumbnails. After
editing a generator or generation library, run `npm run build:worker` to refresh
`src/lib/worker-source.js`. The bundled source keeps workers working over both
HTTP and `file://`. `npm start` and deployment rebuild it, and `npm run check`
rejects a stale bundle. `npm run check:generation` compares worker geometry with
the synchronous pipeline and checks TSP with different clocks.

See [GENERATORS.md](GENERATORS.md). In short: add `src/generators/<id>.js` that calls
`PG.register({ id, name, params, generate })`, list it in `src/lib/loader.js`, and
the app builds its controls automatically. Check it with
`node scripts/check.js <id>` and
`node scripts/shot.js dev/sheet.html "gens=<id>&variants=3" out.png`.

Each design also gets a static page under `src/designs/` so search engines have
something to index. They're built from the generator's name, description and
params. Run `npm run previews` to render the preview images (needs Chrome or
Edge), then `npm run build:pages` to rebuild the pages and sitemap. `npm run check`
fails if the pages are out of date. Scenes are left out of the pages for now.
