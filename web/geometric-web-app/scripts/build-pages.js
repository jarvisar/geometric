/*
 * Static HTML for /designs/, a page per design and the sitemap, built from the generator definitions.
 * The design pages are mainly there so search engines have something to index besides the app.
 * Preview images come from `npm run previews`.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = path.resolve(__dirname, '../src');
const SITE = 'https://geometric.jarvisar.com/';

const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'loader'].forEach(n => load(`lib/${n}.js`));
PG.GENERATOR_FILES.forEach(n => load(`generators/${n}.js`));

// Scenes are left off the public pages for now
const designs = PG.generators.filter(d => d.category !== 'Scenes');
const categories = [...new Set(designs.map(d => d.category))];
const slug = cat => cat.toLowerCase();

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 16L16 1.5L28.6 8.8ZM16 12.4L19.1 3.3L25.4 10.6ZM16.8 10.1L20.7 5.1L23.1 11ZM17.8 8.9L21.3 6.6L21.5 10.8ZM16 16L28.6 23.2L28.6 8.8ZM19.1 17.8L28.6 19.6L25.4 10.6ZM21.5 18.3L27.8 17.4L23.8 12.4ZM23.1 18L26.8 16.1L23.3 13.8ZM16 16L28.6 23.2L16 30.5ZM19.1 17.8L25.4 25.1L16 26.9ZM20.7 19.6L23.1 25.5L16.8 24.6ZM21.3 21.1L21.5 25.3L17.8 23.4ZM16 16L3.4 23.3L16 30.5ZM12.9 17.8L6.6 25.1L16 26.9ZM11.3 19.6L8.9 25.5L15.2 24.6ZM10.7 21.1L10.5 25.3L14.2 23.4ZM16 16L3.4 23.3L3.4 8.7ZM12.9 17.8L3.4 19.6L6.6 10.6ZM10.5 18.3L4.2 17.4L8.2 12.4ZM8.9 18L5.2 16.1L8.7 13.8ZM16 16L16 1.5L3.4 8.7ZM16 12.4L12.9 3.3L6.6 10.6ZM15.2 10.1L11.3 5.1L8.9 11ZM14.2 8.9L10.7 6.6L10.5 10.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

// root is the relative path back to the site root, e.g. '../../'
function page({ title, description, url, image, root, body }) {
    return `<!DOCTYPE html>
<!-- Built by scripts/build-pages.js. Edit the generator or the script instead. -->
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${SITE}${url}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Plotter Geometry">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${SITE}${url}">
    <meta property="og:image" content="${SITE}${image}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" href="${root}icons/favicon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="${root}icons/apple-touch-icon.png">
    <meta name="theme-color" content="#0f1113">
    <link rel="stylesheet" href="${root}pages.css">
    <script>
      if (location.hostname === 'geometric.jarvisar.com') {
        const beacon = document.createElement('script');
        beacon.type = 'module';
        beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        beacon.dataset.cfBeacon = '{"token": "a52a84e110ba48c0868dd4ae87e235b7"}';
        document.head.appendChild(beacon);
      }
    </script>
</head>
<body>
    <header class="site-head">
        <a class="brand" href="${root}">${LOGO}<span>Plotter Geometry</span></a>
        <nav>
            <a href="${root}designs/">Designs</a>
            <a href="${root}about/">About</a>
            <a class="btn accent" href="${root}">Open app</a>
        </nav>
    </header>
${body}
    <footer class="site-foot">
        <a href="${root}">App</a>
        <a href="${root}designs/">Designs</a>
        <a href="${root}about/">About</a>
        <a href="https://github.com/jarvisar/geometric">GitHub</a>
    </footer>
</body>
</html>
`;
}

function designPage(def) {
    const pens = PG.pens.designs[def.id] || {};
    const count = pens.value || 1;
    const settings = [...new Set(def.params.filter(q => !['section', 'image'].includes(q.type) && q.id !== 'pens').map(q => q.label))];
    const related = designs.filter(d => d.category === def.category && d.id !== def.id);
    const root = '../../';
    const body = `    <main class="page">
        <div class="design">
            <figure class="sheet"><img src="${root}images/designs/${def.id}.webp" width="800" height="1131" alt="${esc(def.name)} pen plotter drawing with the default settings"></figure>
            <div>
                <p class="cat"><a href="../#${slug(def.category)}">${esc(def.category)}</a></p>
                <h1>${esc(def.name)}</h1>
                <p class="lead">${esc(def.description)}</p>
                <div class="actions">
                    <a class="btn accent" href="${root}#gen=${def.id}">Open in the app</a>
                    <a class="btn" href="../">All designs</a>
                </div>
                <h2>Pens</h2>
                <p>${pens.hint ? esc(pens.hint) + ' ' : ''}Starts with ${count} pen${count === 1 ? '' : 's'} and works with anywhere from 1 to ${PG.MAX_PENS}.</p>
                <h2>Settings</h2>
                <p>${esc(settings.join(', '))}.</p>
                <p class="note">The preview uses the default settings on A4. Press <kbd>R</kbd> in the app for random variations. The SVG export is in millimeters with one Inkscape layer per pen, so it works with the AxiDraw extension, vpype and saxi.</p>${related.length ? `
                <h2>More ${esc(slug(def.category))}</h2>
                <ul class="related">
${related.map(d => `                    <li><a href="../${d.id}/">${esc(d.name)}</a></li>`).join('\n')}
                </ul>` : ''}
            </div>
        </div>
    </main>`;
    return page({
        title: `${def.name} Generator for Pen Plotters · Plotter Geometry`,
        description: `${def.description} Free in the browser, with layered SVG export for the AxiDraw and other pen plotters.`,
        url: `designs/${def.id}/`,
        image: `images/designs/${def.id}.webp`,
        root,
        body,
    });
}

function listPage() {
    const sections = categories.map(cat => `        <h2 id="${slug(cat)}">${esc(cat)}</h2>
        <div class="cards">
${designs.filter(d => d.category === cat).map(d => `            <a class="card" href="${d.id}/"><img src="../images/designs/thumbs/${d.id}.webp" width="360" height="509" alt="" loading="lazy"><span><b>${esc(d.name)}</b>${esc(d.description)}</span></a>`).join('\n')}
        </div>`).join('\n');
    const body = `    <main class="page">
        <h1>Designs</h1>
        <p class="lead">Generative line art for pen plotters. Every design runs in the browser and exports a layered SVG. Previews use the default settings on A4.</p>
${sections}
        <h2 id="more-tools">More Tools</h2>
        <div class="cards">
            <a class="card" href="https://svgmap.jarvisar.com/"><img src="../images/svgmap.webp" width="360" height="509" alt="" loading="lazy"><span><b>SVGmap</b>Street maps of any city from OpenStreetMap, for pen plotters, laser engraving or print.</span></a>
        </div>
    </main>`;
    return page({
        title: 'Generative Line Art Designs for Pen Plotters · Plotter Geometry',
        description: 'Spirographs, harmonographs, flow fields, contour maps, Penrose tilings, circle packing, mazes and more. Free in the browser, with SVG export for pen plotters.',
        url: 'designs/',
        image: 'icons/og-image.png',
        root: '../',
        body,
    });
}

function sitemap() {
    const urls = ['', 'about/', 'designs/', ...designs.map(d => `designs/${d.id}/`)];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${SITE}${u}</loc>\n  </url>`).join('\n')}
</urlset>
`;
}

const outputs = { 'designs/index.html': listPage(), 'sitemap.xml': sitemap() };
for (const def of designs) outputs[`designs/${def.id}/index.html`] = designPage(def);

if (process.argv.includes('--check')) {
    const stale = Object.keys(outputs).filter(f => {
        const file = path.join(src, f);
        return !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== outputs[f];
    });
    if (stale.length) throw new Error(`Pages are stale (${stale.join(', ')}). Run npm run build:pages.`);
    const missing = designs.filter(d => !fs.existsSync(path.join(src, 'images/designs', `${d.id}.webp`)));
    if (missing.length) throw new Error(`No preview image for ${missing.map(d => d.id).join(', ')}. Run npm run previews.`);
    console.log(`${designs.length} design pages and the sitemap are up to date`);
} else {
    // Drop pages for designs that were removed or renamed
    fs.mkdirSync(path.join(src, 'designs'), { recursive: true });
    for (const dir of fs.readdirSync(path.join(src, 'designs'), { withFileTypes: true })) {
        if (dir.isDirectory() && !outputs[`designs/${dir.name}/index.html`]) fs.rmSync(path.join(src, 'designs', dir.name), { recursive: true });
    }
    for (const [f, text] of Object.entries(outputs)) {
        fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
        fs.writeFileSync(path.join(src, f), text);
    }
    console.log(`Built ${designs.length} design pages and the sitemap`);
}
