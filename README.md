# Plotter Geometry

Web app for generating geometric line art for pen plotters like the AxiDraw. Pick from 45 generative art designs, adjust them in the browser and export plot-ready SVG files. Built using JavaScript, HTML and CSS with no dependencies.

Visit the [Plotter Geometry web app](https://geometric.jarvisar.com/) to access the latest deployment. It also works offline after the first visit.

## Designs

Currently supports 45 designs:

- Curves: spirograph, mystery curves, harmonograph, Maurer rose, superformula, guilloché, times table, flower, phyllotaxis, strange attractors (Lorenz, Aizawa, Thomas and more) and ribbon sculptures of knots and linked bands
- Fields: flow fields, ridgelines, topographic contour maps, wireframe terrain meshes with hidden lines removed, an island drowning as the sea rises, Chladni patterns, electric and magnetic field lines, moiré and op-art warp
- Tiles: Truchet tiles, Islamic star patterns, Penrose tiling, hyperbolic tiling, Celtic knots, whirls, mazes and L-system fractals
- Packing: circle packing, Apollonian gaskets, recursive subdivision and Voronoi
- Scenes: an isometric town of houses, apartments, A-frames, windmills, cars and trees, a harbor town with boats and a lighthouse, a walled castle town in its moat, a moon or Mars base with domes, greenhouses and rovers, a fairground of rides and tents, a railway yard with a roundhouse and steam engines, an alpine valley cut out like a topographic model, a cyberpunk skyline, a stadium that can be an old football ground, a bowl, a running track, a ballpark or a bullring, a megastructure tower packed with slab stacks, fins and grilles, and a spiral stairwell in one-point perspective, all with hidden lines removed. There are also comic pages of little alien landscapes.
- Image: converts photos into line art in 12 styles, including squiggle spirals, waves, halftone, stipples, TSP art and string art

## Usage

Select a design from the menu and use the sliders to adjust it. Click `Randomize` to generate new settings, or lock individual parameters to keep them from changing. Using the same seed and settings produces the same drawing.

Set the paper size (A6 to A2, Letter, Legal, Tabloid or custom), margins and pen widths to match your plotter setup. Designs can be scaled, rotated or arranged in a grid. Every design supports one to eight pens, with color defaults based on its geometry. Change the pen count in the design controls and edit the colors under `Paper & Output`. The pen list shows which parts of a scene each pen draws. If you plot with markers, turn on `Skip lines already drawn` under `Optimize` so a pen doesn't go back over its own ink and dry out.

Click `Export SVG` to download the drawing. Exported SVGs use millimeter units and a separate Inkscape layer for each pen, so they work with the AxiDraw Inkscape extension, vpype and saxi. The export menu also includes vector PDF for printing, DXF for CAD and engraving, EPS for graphics software, PNG, one SVG file per pen, and a share link. Print PDF at actual size. Import DXF in millimeters. EPS crops to the artwork. See the [export notes](web/geometric-web-app/README.md#export-checks) for format details and checks. Drop an exported SVG back onto the preview to restore its settings.

Press `?` to view the keyboard shortcuts.

## Local Installation

Clone the repository and open `web/geometric-web-app/src/index.html` in a browser.

To run with a local server, install Node.js and run:

```sh
git clone https://github.com/jarvisar/geometric.git
cd geometric/web/geometric-web-app
npm install
npm start
```

See [GENERATORS.md](web/geometric-web-app/GENERATORS.md) for instructions on adding designs.
