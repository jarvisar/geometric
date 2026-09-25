# Plotter Geometry

Web app for generating geometric line art and exporting SVG files for pen plotters. Built using JavaScript, HTML and CSS.

Access the latest deployment [here](https://jarvisar.github.io/geometric/).

## Usage

Currently supports 30 designs, including spirographs, flow fields, topographic contours, mazes and Penrose tiling. Images can also be converted into line art.

Select a design from the menu and use the sliders to adjust it. Click `Randomize` to generate new settings, or lock individual parameters to keep them from changing. Using the same seed and settings produces the same drawing.

Set the paper size, margins and pen widths to match your plotter setup. Designs can be scaled, rotated or arranged in a grid. Supports up to six pens, with a separate SVG layer for each pen.

Click `Export SVG` to download the drawing. The export menu also includes PNG export, one SVG file per pen, and a link for sharing the current design. Drop an exported SVG back onto the preview to restore its settings.

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
