# Plotter Geometry

Generative geometric line art built for pen plotters. Pick a design, push the
sliders around (or hit **Randomize** until something grabs you), then export a
plot-ready file. Everything is lines, in millimeters, already cut to the margins,
with pen strokes joined and ordered so the plotter spends as little time
as possible in the air.

No build step and no dependencies: open `src/index.html` in a browser, or run
`npm start` for a live-reloading server.

## Designs

45 designs, each with its own controls, seeded randomness and a curated **Randomize**.

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
* **Wireframe**: a triangulated wire mesh draped over a landscape, like the terrain plots from early computer graphics. The ground can be city blocks, rolling hills, ridged peaks, an island, canyons, craters or ripples, and it can be cut into flat terraces with a cliff between each step. Hidden lines are removed exactly, by walking the sight line from each point back to the eye across the mesh. The mesh fills the page by default and can fray at the edge, where border cells drop out and leave loose threads sticking out. It can also be drawn as a whole tile, face on or isometric. Diagonals run one way, in zigzag rows, diamonds or crosses, follow the slope, or are left off for a plain grid. Pens color it by elevation, by distance or by line direction.
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
* **Moon Base**: a dense settlement on the Moon or Mars. Garden biospheres, greenhouses, paired habitats, workshops and a control tower are connected by ribbed tunnels and service roads. A rocket stands beside its launch gantry, a lander waits on an octagonal pad, and rovers travel between solar fields, fission reactors, propellant tanks, cargo cranes and a crater drilling rig. Every seed plans a different colony. There are five plans (a loose constellation, a crescent, a spine, a ring around a landmark and twin outposts), the facilities go wherever there is room left on the page, and each colony settles on a house style: geodesic, ribbed or printed regolith domes, and habitats as pressure cylinders, upright cans, printed towers or hulls buried under sandbags. Rockets, landers, tanks, greenhouses, workshop roofs and the control tower vary too. Dome and habitat styles can also be picked by hand. The Moon gets a radio telescope strung across a crater. Mars trades most of the craters for barchan dunes, mesas, wind streaks and dust devils, adds wind turbines and a scout helicopter, and draws its ground with the red pen. Clear front glazing reveals the growing beds, with a tree in the main dome. Adjustable density, terrain and camera controls use the same isometric hidden-line engine as Town and Harbor. Six pens separate black structures, red collars, blue shadows and solar cells, gold equipment, green gardens and light blue glass. Seven add astronauts and eight add brown dust.
* **Town**: an isometric town built as a small 3D scene, with houses, apartments, A-frames, windmills, cars, fences, trees and yard clutter. The middle gets built up with terraces, shops and squares, and there can be a church, a clock tower, boulevards, roundabouts and a river with bridges and boats. Hidden lines are removed exactly, so only the visible outlines get plotted. The camera angle, scale, block size and how busy the streets are can all be changed. Up to eight pens, where 5 to 8 give cars, people, the river and fences a pen each.
* **Harbor**: a fishing town on the quay with piers, moored boats, canals, docks, wharves with cranes, canal houses, a church and a clock tower. The lighthouse sits on a straight or bent breakwater or on its own island, and can have red bands. Out in the bay there are boats on moorings, a cargo ship at anchor or a schooner under full sail, channel buoys, rocks with a beacon, people rowing and gulls. Boats get painted stripes, some sails are tan, and ripple lines follow the shore like on an old chart. Drawn for four pens: red and black roof hatching, blue shadows and water, yellow canopies. Six pens make the trees green and the people and cars purple, and eight add light blue water and brown piers and boats.
* **Castle Town**: a walled town standing in its moat, drawn whole with the fields round it. Each seed gives a different town: the walls are an uneven shape, an even octagon, a square or a long town, and the towers are round, square or square between round ones, taller in some towns than others. They stand at the corners and along the curtain walls, under pointed roofs, timber galleries or battlements, and each gatehouse has a portcullis, a drawbridge and a stone bridge over the moat. The castle takes the back corner of the town or the one on the right with its keep, which can have corner turrets, be a plain square keep or a round donjon, and a great hall. Inside, the streets are a grid round a market square with a market hall or a belfry and stalls, the church is on a block next to it, and the rest is rows of half-timbered and stone houses with gardens behind, sometimes with a walled orchard among them. Outside there are roads out of the gates, a patchwork of plowed fields, meadows with sheep, orchards, vineyards, ponds and woods, in a different mix round every town, thatched cottages, a post mill and a tournament, plus swans and lily pads on the moat. The camera fits the whole moat on the page. Small details like the timber framing, battlements and portcullis bars are spaced for a 0.35 mm pen, so they thin out when the town is small on the page and fill back in as you zoom in. Uses the Harbor colors from five pens, so the fields and trees are green. Six pens make the people and horses purple, seven give the moat light blue and eight make the timber brown.
* **Fairground**: a funfair with a big wheel, a figure-of-eight roller coaster, a striped big top, a carousel, a helter skelter, swing rides, a drop tower, a pirate ship, teacups, bumper cars, a boating lake with swan pedalos, game stalls and bunting. The paths come from a Voronoi diagram, so they wind between the rides. Drawn for the same pens as Harbor, except with eight it's the paths that go brown.
* **Trainyard**: a railway yard where the tracks fan out both ways from the lead, with a coaling tower, a water tower and a long lattice footbridge over the lot. The engine depot is a roundhouse round a turntable, a round engine house under a conical roof or a straight shed. The yard is full of boxcars, reefers, tank cars, hoppers, cattle wagons, car carriers, gondolas, flat cars with logs and containers, and cabooses, with steam engines and diesels shunting. A train goes by on the main line trailing its steam, under overhead wires with electric engines if you turn them on. On the near side there's a station under canopies or an arched train shed, or a goods yard with a gantry crane over the container stacks. Terraced streets fill the corners, and the ones on the near side show their back yards and washing lines. Works with tall chimneys and gasholders can take over some of the blocks. Uses the Harbor colors, and from five pens the track gets its own brown.
* **Alpine Valley**: an illustrated mountain village looking up a valley to jagged snowy peaks. The mountains come from a quick erosion pass, so ridges and gullies branch like real ones, and they're drawn with blue shading on the slopes away from the sun and broken ink ledges on the steep rock. The village has chalets with timber balconies and shutters, a square with a fountain and the church, a grand hotel, a station, and farms with fields, haystacks and cows. A train crosses a stone viaduct, a cable car goes up to the highest summit, and there are barns dotted up the slopes, fir woods, boats on the lake and a cross on a summit. It shares Harbor and Fairground's ink, red, blue and gold palette. Extra pens separate the forest, people, water and timber. It fills the page by default, or shows the whole valley as a block with optional topographic contours and a cutaway base.
* **Skyline District**: a crowded city in isometric ink. Neighboring blocks share a district, so glass towers cluster downtown, deco and office towers fill midtown and Kowloon-style blocks covered in rooms and AC units make up the old quarter. Around a faceted diagrid cone or a TV tower there are garden towers, a gothic cathedral, a building site with a tower crane and a geodesic dome. A river or canal crosses the lower part of the page with steel bridges, boats and container barges. An elevated highway and a monorail cut through, with cables, neon signs, rooftop pools, yellow cabs, a helicopter and an airship overhead. Drawn for five pens: black, red signs and roofs, blue shade, shadows and water, yellow markings and taxis, and green trees.
* **Stadium**: a stadium drawn whole from above with the streets round it. The seed picks the kind: an old football ground with four odd stands and a floodlight pylon at each corner, a bowl under one ring of roof, an athletics stadium round an eight-lane track, a horseshoe open at one end, a ballpark, a cricket ground with a pavilion, or a bullring with its seats sold in the sun and the shade. Stands have one to three tiers with glazed boxes between them. Roofs are cantilevered, pitched on posts with a gable in the middle, barrel vaulted, folded or tented, and a bowl can have a great arch over one side with cables down to the roof, or a spiral ramp tower at each corner. The seat rows are drawn in the club's colors as plain blocks, hoops, stripes, checks, chevrons or a word spelled out along the stand. On the field there's a football, rugby or American football pitch with mown stripes, a running track with the jumps in its ends, a diamond, a wicket or a ring of sand, with the teams on it and the score on the board. Outside, the crowd queues at the gates and the blocks beyond are terraced streets, car parks, parkland, training pitches and tennis courts. Every kind is built the same way, by sweeping a cross section round the edge of the field. Rows, rafters and wall details are spaced by what they come to on paper, so they thin out when the stadium is small on the page, and shadows replace the mowing lines instead of going over them. Drawn for five pens: black, red roofs and seats, blue shadows and seats, gold lights and flags, and green grass. Six pens make the people purple, seven the glass light blue and eight the track and streets brown.
* **Megastructure**: one tower block in isometric outline, packed like a machine the size of a building. Tiers step back to leave terraces crowded with slab stacks, fin banks, portal frames and racks of boards. The faces are cut into piers with teeth, stepped panels with grilles, deep racks, slots and ducts that jog up the wall. Rows of small blocks, cornices and piles of floor plates separate the tiers, and the top can be left open with two walls behind it. The block is built on a grid of small cells by filling and carving boxes, so parts that touch merge into one solid and only real edges get drawn. `Finest detail` sets the cell size in millimeters, which is what keeps lines far enough apart for the pen. Big sheets hit a limit on the number of cells and get bigger cells instead. It's one black pen by default. More pens pick out the fins, stacks, studs, ducts, blocks, the plinth and every other tier, and the left or right faces can be hatched.
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
   Turn on `Skip lines already drawn` for felt tips and markers. Busy scenes
   draw some lines twice, like edges shared by two buildings, and a marker
   dragged back over ink picks it up, dries out and leaves gaps in the next
   lines. This cuts the parts of strokes that land on ink the same pen already
   put down, using each pen's width. At 100% only stretches that are fully on
   ink go, so the plot looks the same. That's about 1.5 to 3% of the black ink in
   the scenes with a 0.35 mm pen, or 5 to 13% with a 0.8 mm marker. Lower
   values also skip lines that partly overlap, which saves more ink but can
   leave thin gaps in dense hatching. Overlaps under 1 mm, like where lines
   cross, are drawn anyway since they'd each cost a pen lift. Pens don't check
   each other's ink, only their own.
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
    optimize.js    simplify, merge, overlap removal, travel ordering, stats
    export.js      SVG, PDF, DXF and EPS export
    render.js      canvas preview
    loader.js      list of design files
  generators/      one file per design
  dev/sheet.html   contact sheet of designs + random variants
scripts/
  check.js         runs every design through the pipeline (npm run check)
  check-overlap.js overlap removal, checked by brute force (npm run check:overlap)
  shot.js          headless-Chrome screenshot of any page
  drive.js         tiny DevTools-protocol driver for UI tests (npm run smoke)
  build-pages.js   design pages and sitemap (npm run build:pages)
```

## Publishing

`.github/workflows/pages.yml` (at the repo root) publishes `src/` to GitHub Pages
on every push to `master` that touches it, or on demand from the Actions tab.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The faster node checks run before publishing and nothing goes out if one fails.
The slower scene checks and the browser smoke tests don't run there, so run them
locally for UI changes. `npm run smoke:a11y` covers keyboard and screen reader
access, short screens, redo timing and stored photo cleanup.

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
