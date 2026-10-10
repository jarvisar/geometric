# Pen Colors

Every design gets a 1–8 pen control. Defaults use a small palette picked for the
design. One pen remains useful for plotting, and changing the count should only
change ink assignments, not regenerate different geometry.

The shared configuration lives in `src/lib/pens.js`: palette slots, defaults,
control hints and scene mappings. Generators choose groups using their own
geometry. The pipeline maps those groups onto the selected pen slots before
preview, clipping and export. Custom pen colors still belong to the user.

| Designs | Color assignment |
| --- | --- |
| Spirograph, Mystery, Harmonograph | Curve progress, with separate echoes where available |
| Maurer, Times Table | Chord progression, with the rose or boundary kept distinct |
| Superformula | Nested shapes, or progress around a single shape |
| Guilloché | Bands and the phase-shifted threads within each band |
| Flower | Petal families, offset for the inner ring |
| Phyllotaxis | Seed growth bands and Fibonacci spiral families |
| Attractor | Depth or elapsed time |
| Ribbon Sculpture | The two sides of the band, then whole loops or stretches along the band |
| Flow Field | Flow direction, position or coherent noise |
| Ridgelines | Near-to-far depth bands |
| Topographic | Elevation bands, with index contours in the darkest ink |
| Wireframe | Elevation bands from the coldest ink to the hottest, near-to-far bands, or one color per line direction |
| Chladni | Distance from the nodal lines and vibration polarity |
| Field Lines | Source fans and potential levels |
| Moiré | Line families, subdivided into broad bands |
| Warp | Woven directions and successive warped stripes |
| Truchet, Celtic, Islamic | Connected strands, keeping each strand together |
| Penrose | Tile orientation and decoration family |
| Hyperbolic | Distance from the center of the disk |
| Whirl | Pursuit depth, including the single-cell layout |
| Maze | Bands of walls, with a distinct solution route |
| L-system | Branch depth or progress along an unbranched curve |
| Circle Packing, Apollonian | Circle size or recursive generation |
| Subdivision, Voronoi | Quilt tones or coherent patches of neighboring cells |
| Town, Harbor, Castle Town, Fairground, Trainyard, Moon Base, Alpine, Skyline District | Scene materials and objects |
| Moon Base on Mars | Same as the Moon, with the ground on the red pen until an eighth pen takes it over in brown |
| Stadium | Scene materials and objects, with the seats in the club's colors. The running track, clay courts and infield stay on the red pen until an eighth pen takes them over in brown, along with the streets |
| Megastructure | Tiers in ink, then fins and grilles, slab stacks, studs and teeth, ducts and frames, loose blocks, the plinth and every other tier. Hatching takes the second pen when it's on |
| Infinite Stairwell | Steps and walls, the handrail and shading, then the floor or skylight, balusters, string, walls and every other turn |
| Tidal Atlas | Water and land, then the cut block, elevation bands, survey marks and the sea surface |
| Cosmic Comics | Dark outlines, a warm sun and cool skies, then sand, distant ranges, plants, crystals and rock |
| Image | Tonal bands in every drawing mode |

Checks cover all pen counts, deterministic output, unchanged geometry, legacy
settings, SVG layers and browser previews. Sparse designs can use fewer colors
when they contain fewer distinct objects or bands.
