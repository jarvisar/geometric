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
let spiroSmoothness = 500; // Default value
let spiroLayers = 5; // Number of layers for spirograph

let mode = "flower";

const svgNamespace = "http://www.w3.org/2000/svg";
const svgElement = document.getElementById("flowerCanvas");

function polarToCartesian(cx, cy, angleDeg, r) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = cx + r * Math.cos(angleRad);
    const y = cy + r * Math.sin(angleRad);
    return [x, y];
}

function addPolyline(points) {
    const pathData = points.map(point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ");
    const polyline = document.createElementNS(svgNamespace, "polyline");
    polyline.setAttribute("points", pathData);
    polyline.setAttribute("stroke", lineColor);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke-width", lineThickness);
    polyline.setAttribute("stroke-linejoin", "round");
    svgElement.appendChild(polyline);
}

function drawFlower() {
    svgElement.innerHTML = ""; // Clear previous drawings
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
    const revolutions = R / gcd(R, r);
    const maxPoints = 20000;
    const totalPoints = Math.min(spiroSmoothness * revolutions, maxPoints);

    for (let layer = 0; layer < spiroLayers; layer++) {
        const points = [];
        // Vary the phase for each layer to create overlapping patterns
        const phase = (2 * Math.PI * layer) / spiroLayers;
        for (let t = 0; t <= totalPoints; t++) {
            const theta = (2 * Math.PI * t) / spiroSmoothness + phase;
            const x = center + (R - r) * Math.cos(theta) + d * Math.cos(((R - r) / r) * theta);
            const y = center + (R - r) * Math.sin(theta) - d * Math.sin(((R - r) / r) * theta);
            points.push([x, y]);
        }
        addPolyline(points);
    }
}

function updateParameters() {
    mode = document.getElementById("modeToggle").value;
    petalCount = parseInt(document.getElementById("petalCount").value);
    lineDensity = parseInt(document.getElementById("lineDensity").value);
    pointsPerLine = parseInt(document.getElementById("pointsPerLine").value);
    flowerRadius = parseInt(document.getElementById("flowerRadius").value);
    lineThickness = parseFloat(document.getElementById("lineThickness").value);
    lineColor = document.getElementById("lineColor").value;

    if (document.getElementById("spiroSmoothness")) {
        spiroSmoothness = parseInt(document.getElementById("spiroSmoothness").value);
    }
    if (document.getElementById("R")) R = parseInt(document.getElementById("R").value);
    if (document.getElementById("r")) r = parseInt(document.getElementById("r").value);
    if (document.getElementById("d")) d = parseInt(document.getElementById("d").value);

    if (mode === "flower") {
        drawFlower();
    } else {
        drawSpirograph();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Show/hide spirograph controls
    const modeToggle = document.getElementById("modeToggle");
    const spiroControls = document.getElementById("spiroControls");
    flowerControls.style.display = "";
    modeToggle.addEventListener("change", () => {
        if (modeToggle.value === "spirograph") {
            spiroControls.style.display = "";
            flowerControls.style.display = "none";
        } else if (modeToggle.value === "flower") {
            flowerControls.style.display = "";
            spiroControls.style.display = "none";
        }
        updateParameters();
    });

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
});