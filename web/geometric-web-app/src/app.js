const canvasSize = 800;
let petalCount = 12;
let lineDensity = 40;
let pointsPerLine = 100;
let flowerRadius = 140;
let lineThickness = 0.5;
let lineColor = "black";

// Spirograph parameters
let R = 200;
let r = 80;
let d = 120;
let spiroSmoothness = 500;
let spiroLayers = 5;
let layerOffset = 30; // New: offset between layers
let rotationStep = 15; // New: rotation between layers

let mode = "flower";

const svgNamespace = "http://www.w3.org/2000/svg";
const svgElement = document.getElementById("flowerCanvas");

function polarToCartesian(cx, cy, angleDeg, r) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = cx + r * Math.cos(angleRad);
    const y = cy + r * Math.sin(angleRad);
    return [x, y];
}

function addPolyline(points, strokeColor = lineColor, strokeWidth = lineThickness) {
    const pathData = points.map(point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ");
    const polyline = document.createElementNS(svgNamespace, "polyline");
    polyline.setAttribute("points", pathData);
    polyline.setAttribute("stroke", strokeColor);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke-width", strokeWidth);
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("stroke-linecap", "round");
    svgElement.appendChild(polyline);
}

function drawFlower() {
    svgElement.innerHTML = "";
    const center = canvasSize / 2;

    for (let i = 0; i < petalCount; i++) {
        const angleOffset = (360 / petalCount) * i;
        for (let j = 1; j < lineDensity; j++) {
            const r = flowerRadius * (j / lineDensity);
            const points = [];
            for (let k = 0; k <= pointsPerLine; k++) {
                const t = k / pointsPerLine;
                const angle = angleOffset + t * (360 / petalCount);
                const modR = r * (0.7 + 0.3 * Math.sin(petalCount * (angle * Math.PI / 180)));
                points.push(polarToCartesian(center, center, angle, modR));
            }
            addPolyline(points);
        }
    }
}

function drawSpirograph() {
    svgElement.innerHTML = "";
    const center = canvasSize / 2;
    
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
    const revolutions = Math.abs(R) / gcd(Math.abs(R), Math.abs(r));
    const maxPoints = 15000;
    const pointsPerRevolution = Math.min(spiroSmoothness, maxPoints / revolutions);
    
    for (let layer = 0; layer < spiroLayers; layer++) {
        const points = [];
        
        // Vary parameters for each layer
        const layerR = R + (layer * layerOffset / spiroLayers);
        const layerD = d + (layer * 10);
        const rotation = (layer * rotationStep * Math.PI) / 180;
        
        const totalPoints = pointsPerRevolution * revolutions;
        
        for (let i = 0; i <= totalPoints; i++) {
            const t = (2 * Math.PI * i) / pointsPerRevolution;
            
            // Hypotrochoid formula
            const x = (layerR - r) * Math.cos(t) + layerD * Math.cos(((layerR - r) / r) * t);
            const y = (layerR - r) * Math.sin(t) - layerD * Math.sin(((layerR - r) / r) * t);
            
            // Apply rotation and center
            const rotatedX = center + x * Math.cos(rotation) - y * Math.sin(rotation);
            const rotatedY = center + x * Math.sin(rotation) + y * Math.cos(rotation);
            
            points.push([rotatedX, rotatedY]);
        }
        
        // Use slightly different colors for each layer if desired
        const layerColor = mode === "spirograph" ? lineColor : `hsl(${layer * 60}, 70%, 50%)`;
        addPolyline(points, layerColor);
    }
}

function updateParameters() {
    mode = document.getElementById("modeToggle").value;
    
    // Show/hide controls based on mode
    const spiroControls = document.getElementById("spiroControls");
    const flowerControls = document.getElementById("flowerControls");
    
    if (mode === "spirograph") {
        spiroControls.style.display = "";
        flowerControls.style.display = "none";
    } else {
        spiroControls.style.display = "none";
        flowerControls.style.display = "";
    }
    
    // Update parameters
    petalCount = parseInt(document.getElementById("petalCount").value) || 12;
    lineDensity = parseInt(document.getElementById("lineDensity").value) || 40;
    pointsPerLine = parseInt(document.getElementById("pointsPerLine").value) || 100;
    flowerRadius = parseInt(document.getElementById("flowerRadius").value) || 140;
    lineThickness = parseFloat(document.getElementById("lineThickness").value) || 0.5;
    lineColor = document.getElementById("lineColor").value || "black";

    // Spirograph parameters
    if (document.getElementById("R")) R = parseInt(document.getElementById("R").value) || 200;
    if (document.getElementById("r")) r = parseInt(document.getElementById("r").value) || 80;
    if (document.getElementById("d")) d = parseInt(document.getElementById("d").value) || 120;
    if (document.getElementById("spiroSmoothness")) spiroSmoothness = parseInt(document.getElementById("spiroSmoothness").value) || 500;
    if (document.getElementById("spiroLayers")) spiroLayers = parseInt(document.getElementById("spiroLayers").value) || 5;
    if (document.getElementById("layerOffset")) layerOffset = parseInt(document.getElementById("layerOffset").value) || 30;
    if (document.getElementById("rotationStep")) rotationStep = parseInt(document.getElementById("rotationStep").value) || 15;

    if (mode === "flower") {
        drawFlower();
    } else {
        drawSpirograph();
    }
}

function exportSVG() {
    const svgData = svgElement.outerHTML;
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geometric-pattern-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
}

function randomizeParameters() {
    if (mode === "spirograph") {
        document.getElementById("R").value = Math.floor(Math.random() * 300) + 50;
        document.getElementById("r").value = Math.floor(Math.random() * 120) + 20;
        document.getElementById("d").value = Math.floor(Math.random() * 250) + 50;
        document.getElementById("spiroLayers").value = Math.floor(Math.random() * 10) + 3;
        document.getElementById("layerOffset").value = Math.floor(Math.random() * 60) + 10;
        document.getElementById("rotationStep").value = Math.floor(Math.random() * 45) + 5;
    } else {
        document.getElementById("petalCount").value = Math.floor(Math.random() * 18) + 6;
        document.getElementById("lineDensity").value = Math.floor(Math.random() * 60) + 20;
        document.getElementById("flowerRadius").value = Math.floor(Math.random() * 250) + 100;
    }
    updateParameters();
}

document.addEventListener("DOMContentLoaded", () => {
    const modeToggle = document.getElementById("modeToggle");
    
    modeToggle.addEventListener("change", updateParameters);

    // Sync range and number inputs
    document.querySelectorAll("input[type='range']").forEach(range => {
        const num = document.getElementById(range.id + "_num");
        if (num) {
            range.addEventListener("input", () => {
                num.value = range.value;
                updateParameters();
            });
            num.addEventListener("input", () => {
                range.value = num.value;
                updateParameters();
            });
        } else {
            range.addEventListener("input", updateParameters);
        }
    });

    document.querySelectorAll("input[type='number']").forEach(num => {
        const range = document.getElementById(num.id.replace("_num", ""));
        if (!range) num.addEventListener("input", updateParameters);
    });

    document.querySelectorAll("input[type='color'], select").forEach(input => {
        input.addEventListener("input", updateParameters);
    });

    updateParameters(); // Initial draw

    document.getElementById("exportSVG").addEventListener("click", exportSVG);
    document.getElementById("randomize").addEventListener("click", randomizeParameters);
});