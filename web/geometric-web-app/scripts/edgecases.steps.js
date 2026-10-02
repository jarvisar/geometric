// Reproductions from the October 2 QA pass. Each case runs even if an earlier one fails.
const failures = [];
let cases = 0;
const until = async expression => {
    const end = Date.now() + 15000;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(50); }
    throw new Error('Timed out: ' + expression);
};
const ready = () => until(`!!plotterApp.result && document.querySelector('#busy').hidden && plotterApp.state.gen===plotterApp.result.gen`);
const test = async (name, run) => {
    cases++;
    try { await run(); log('PASS', name); }
    catch (err) { failures.push(name); log('FAIL', name, err.message); await shot(name + '.png'); }
};
const check = async (expression, message) => { if (!await evaluate(expression)) throw new Error(message); };
const fresh = async page => { await open('about:blank'); await open(page || 'index.html'); await ready(); };
await fresh();
await evaluate(`localStorage.clear()`);
await fresh();

await test('equal-spirograph-gears', async () => {
    await evaluate(`plotterApp.select('spirograph');plotterApp.resetAll();plotterApp.regenerate()`);
    await evaluate(`const input=document.querySelector('[data-param="r"] input[type=number]');input.value=96;input.dispatchEvent(new Event('change',{bubbles:true}));plotterApp.regenerate()`);
    await check(`!!plotterApp.result && document.querySelector('#errorMsg').hidden`, 'valid R=96, r=96 clears the drawing: ' + await evaluate(`document.querySelector('#errorMsg').textContent`));
});

await test('failed-photo-drop', async () => {
    await evaluate(`plotterApp.resetParams();plotterApp.select('spirograph');plotterApp.regenerate()`); await ready();
    await evaluate(`const dt=new DataTransfer();dt.items.add(new File(['invalid png'],'broken.png',{type:'image/png'}));document.querySelector('#stage').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}))`);
    await until(`[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('Could not read that image'))`);
    await check(`plotterApp.state.gen===plotterApp.result?.gen`, 'Image controls retain a Spirograph preview after upload failure');
});

await test('shared-scene-reload', async () => {
    await evaluate(`localStorage.clear()`);
    const link = await evaluate(`location.href.split('#')[0]+'#s='+btoa(JSON.stringify({app:'plotter-geometry',v:3,gen:'tidal',seed:123}))`);
    await fresh(link);
    await check(`plotterApp.state.gen==='tidal' && plotterApp.state.seed===123`, 'shared scene did not open');
    await sleep(700);
    await fresh();
    await check(`plotterApp.state.gen==='tidal' && plotterApp.result.gen==='tidal' && plotterApp.state.seed===123`, 'reload replaced the shared scene with Spirograph');
});

const canLoseContext = await evaluate(`!!document.querySelector('#lines').getContext('webgl2')?.getExtension('WEBGL_lose_context')`);
if (canLoseContext) {
    await test('graphics-context-loss', async () => {
        await evaluate(`window.__paperBefore=document.querySelector('#view').toDataURL();document.querySelector('#lines').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`);
        await sleep(600);
        await check(`document.querySelector('#view').toDataURL()!==__paperBefore`, 'lost graphics context leaves a blank paper until the next interaction');
    });
} else log('SKIP graphics-context-loss: WebGL loss extension unavailable');

log(`${cases - failures.length}/${cases} edge cases passed`);
if (failures.length) throw new Error(`${failures.length} reproduced bugs: ${failures.join(', ')}`);
