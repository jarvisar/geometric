# Writing a generator

A generator is one file in `src/generators/` that calls `PG.register({...})`.
Add its file name (without `.js`) to `PG.GENERATOR_FILES` in `src/lib/loader.js`
and it shows up in the app with an auto-built control panel.

```js
(function () {
    'use strict';
    const { geo, TAU } = PG;

    PG.register({
        id: 'example',             // unique, matches the file name
        name: 'Example',           // shown in the UI
        category: 'Curves',        // Curves | Fields | Tiles | Packing | Image
        description: 'One sentence shown under the name.',
        fit: true,                 // see "Coordinates" below
        params: [
            { type: 'section', label: 'Shape' },
            { id: 'count', label: 'Count', type: 'range', min: 1, max: 50, step: 1, value: 12 },
            { id: 'mode', label: 'Mode', type: 'select', value: 'a',
              options: [['a', 'Option A'], ['b', 'Option B']], random: ['a', 'b'] },
            { id: 'outline', label: 'Outline', type: 'checkbox', value: true, random: 0.5 },
            { id: 'amp', label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3,
              show: p => p.mode === 'b', hint: 'Tooltip text' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
        ],
        randomize(rng, p) { return { count: rng.int(3, 20) }; }, // optional
        generate(p, ctx) {
            return [ /* paths */ ];   // or { layers: [pathsForPen1, pathsForPen2, ...] }
        },
    });
})();
```

## Output

* A **path** is an array of points; a **point** is `[x, y]`. Closed shapes repeat
  the first point at the end (`geo.circle` does this for you).
* Return an array of paths (one pen) or `{ layers: [paths, paths, ...] }` where
  layer *i* is drawn with pen *i*. `geo.toLayers(paths, pens, fn)` helps.
* Don't worry about path order, joining touching segments or dropping redundant
  points: the pipeline merges, simplifies and sorts everything afterwards. Do
  avoid emitting exact duplicate strokes (the pen would draw them twice).

## Coordinates

* `fit: true` — draw around the origin in whatever units are convenient; the
  pipeline rotates, then scales the result to fit the drawing area. Aspect
  ratio is preserved. Use this for centred, self-contained figures.
* `fit: false` — draw in millimetres into the rectangle `0..ctx.width × 0..ctx.height`,
  y pointing down. The pipeline clips anything outside. Use this for designs
  that fill the page (fields, tilings, packings). Design sizes such as spacing
  or cell size are then real millimetres, which matters for pen width.

## ctx

| field | |
|---|---|
| `ctx.width`, `ctx.height` | drawing area in mm (fill generators) |
| `ctx.rng` | seeded RNG: `random() range(a,b) int(a,b) pick(arr) chance(p) sign() gauss(m,sd) shuffle(arr) weighted([[w,v],...])` |
| `ctx.noise` | seeded simplex noise: `noise2(x,y) noise3(x,y,z) fbm2(x,y,oct,lac,gain) fbm3(...) curl2(x,y,oct)` in about [-1, 1] |
| `ctx.shape` | the clip shape in generator coordinates: `inside(x,y)`, `dist(x,y)` (signed mm, positive inside), `polygon()` (the visible region as a convex polygon), `kind` |
| `ctx.images` | loaded images for `type: 'image'` params, keyed by param id |
| `ctx.seed` | integer seed |

Always use `ctx.rng` / `ctx.noise`, never `Math.random`, so a seed reproduces a drawing.

## Helpers (`PG.geo`)

`lerp clamp smoothstep lerpPt dist dist2 rad deg gcd rotate`,
`circle(cx,cy,r,segs?,a0?,tol?) ellipse(cx,cy,rx,ry,rot?,segs?,tol?) arc(cx,cy,r,a0,a1,segs?,tol?) ngon(cx,cy,r,n,rot)` (open) `close(poly)`,
`bbox pathLength polygonArea centroid pointInPolygon lineIntersect(p,d,q,e)`,
`clipPolygonHalfPlane insetConvex(poly,d) cleanPolygon hatch(polys,spacing,angle,phase)`,
`hatchZigzag(poly,spacing,angle)` (convex fill as one stroke) `insetSpiral(poly,spacing,round)` (concentric fill as one stroke),
`chaikin resample roundCorners splitPath mapPaths translatePaths scalePaths rotatePaths toLayers`.
Contours: `PG.sampleField(fn,x0,y0,w,h,cell)`, `PG.isolines(field, level)`, `PG.contourLevels(field, n)`.

Automatic segment counts keep the chord error under `tol` (default 0.02) *in your
units*: fine for millimetres, too coarse for a fit generator drawing a unit circle —
pass explicit `segs` or a smaller `tol` there.

## Parameters

* `range`: `min max step value`. `random: false` excludes it from Randomize,
  `random: [lo, hi]` narrows the random range. Keep resolution/quality knobs
  `random: false`.
* `select`: `options: [[value, label], ...]`. Only randomised if `random` is set
  (`true` or an array of allowed values).
* `checkbox`: randomised only if `random` is set (a probability or `true`).
* `section`: a heading, no value.
* `show: p => bool` hides a control when irrelevant.
* `randomize(rng, p)` can return curated values (e.g. gear ratios that close nicely).

## Plotter etiquette

* Defaults should look great on A4 with a 0.3–0.5 mm pen, and generate in well under
  half a second. Aim for 1–40 m of line; above ~80 m the paper starts to saturate and tear.
* Prefer long continuous strokes to many tiny ones — every stroke is a pen lift.
* Guard against runaway sizes (cap point counts, iterations, cell counts).

## Checking your work

```
node scripts/check.js example                          # pipeline sanity + timings
node scripts/shot.js dev/sheet.html "gens=example&variants=3" out.png 1400 900
```
