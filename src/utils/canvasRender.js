import { fetchOSMRoute } from "./osmRouter";
const CIRCUMFERENCE = 2 * Math.PI * 6378137.0;

function latLonToMercator(lat, lon) {
  const rMajor = 6378137.0;
  const x = rMajor * lon * Math.PI / 180.0;
  const latRad = lat * Math.PI / 180.0;
  const y = rMajor * Math.log(Math.tan(Math.PI / 4.0 + latRad / 2.0));
  return [x, y];
}

function tileXYToMercatorBounds(tx, ty, zoom) {
  const halfC = CIRCUMFERENCE / 2;
  const numTiles = Math.pow(2, zoom);
  const minX = (tx / numTiles) * CIRCUMFERENCE - halfC;
  const maxX = ((tx + 1) / numTiles) * CIRCUMFERENCE - halfC;
  const maxY = halfC - (ty / numTiles) * CIRCUMFERENCE;
  const minY = halfC - ((ty + 1) / numTiles) * CIRCUMFERENCE;
  return { minX, maxX, minY, maxY };
}

function mercatorToTileXY(mx, my, zoom) {
  const halfC = CIRCUMFERENCE / 2;
  const xFrac = (mx + halfC) / CIRCUMFERENCE;
  const yFrac = 1.0 - (my + halfC) / CIRCUMFERENCE;
  return [xFrac * Math.pow(2, zoom), yFrac * Math.pow(2, zoom)];
}

export async function preloadMapTiles(renderMinX, renderMaxX, renderMinY, renderMaxY, zoom, theme, onProgress) {
  const [minTx, minTy] = mercatorToTileXY(renderMinX, renderMaxY, zoom);
  const [maxTx, maxTy] = mercatorToTileXY(renderMaxX, renderMinY, zoom);
  const startX = Math.floor(Math.min(minTx, maxTx)) - 1;
  const endX = Math.ceil(Math.max(minTx, maxTx)) + 1;
  const startY = Math.floor(Math.min(minTy, maxTy)) - 1;
  const endY = Math.ceil(Math.max(minTy, maxTy)) + 1;

  const tilesToLoad = [];
  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      tilesToLoad.push({ x, y, z: zoom });
    }
  }

  let loaded = 0;
  const cache = {};
  const style = theme === "dark" ? "dark_all" : "light_all";

  const promises = tilesToLoad.map(t => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = `https://basemaps.cartocdn.com/${style}/${t.z}/${t.x}/${t.y}.png`;
      img.onload = () => {
        cache[`${t.z}_${t.x}_${t.y}`] = img;
        loaded++;
        onProgress(`Downloading high-resolution base map (${loaded}/${tilesToLoad.length})...`, Math.round((loaded / tilesToLoad.length) * 100));
        resolve();
      };
      img.onerror = () => {
        img.src = `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
        img.onload = () => { cache[`${t.z}_${t.x}_${t.y}`] = img; loaded++; resolve(); };
        img.onerror = () => { loaded++; resolve(); };
      };
    });
  });

  await Promise.all(promises);
  return { cache, startX, endX, startY, endY, zoom };
}

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

// Helper to calculate trailing points along the path for articulated vehicles (train coaches)
function getTrailingPoint(leadIdx, targetDist, mercPoints, smoothedAngles, toCanvas) {
  let currentDist = 0;
  let idx = leadIdx;
  
  let [px, py] = toCanvas(mercPoints[idx][0], mercPoints[idx][1]);
  let angle = smoothedAngles[idx];
  
  while (idx > 0 && currentDist < targetDist) {
    const nextIdx = idx - 1;
    const [npx, npy] = toCanvas(mercPoints[nextIdx][0], mercPoints[nextIdx][1]);
    const segmentDist = Math.hypot(npx - px, npy - py);
    
    if (currentDist + segmentDist >= targetDist) {
      const ratio = (targetDist - currentDist) / segmentDist;
      const ix = px + ratio * (npx - px);
      const iy = py + ratio * (npy - py);
      
      const angleA = smoothedAngles[idx];
      const angleB = smoothedAngles[nextIdx];
      let diff = angleB - angleA;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      const iAngle = angleA + ratio * diff;
      
      return { x: ix, y: iy, angle: iAngle, emerged: true };
    }
    
    currentDist += segmentDist;
    px = npx;
    py = npy;
    idx = nextIdx;
  }
  
  const fallX = px - Math.cos(angle) * (targetDist - currentDist);
  const fallY = py - Math.sin(angle) * (targetDist - currentDist);
  return { x: fallX, y: fallY, angle, emerged: false };
}

// Procedurally draws dynamic, highly detailed vehicle avatars on map path
function drawVehicle(ctx, leadIdx, mercPoints, smoothedAngles, toCanvas, mode) {
  const leadPt = mercPoints[leadIdx];
  const [x, y] = toCanvas(leadPt[0], leadPt[1]);
  const angle = smoothedAngles[leadIdx];

  // Sleek shadow for vehicle depth
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;

  if (mode === "rail") {
    // A REAL ARTICULATED PASSENGER TRAIN (5 segments: Engine + 4 Coaches bending at couplings!)
    const coachW = 20; // Bigger!
    const coachL = 30; // Bigger!
    
    // Get Trailing points for Coach 1, 2, 3, and 4
    const coach1 = getTrailingPoint(leadIdx, 36, mercPoints, smoothedAngles, toCanvas);
    const coach2 = getTrailingPoint(leadIdx, 72, mercPoints, smoothedAngles, toCanvas);
    const coach3 = getTrailingPoint(leadIdx, 108, mercPoints, smoothedAngles, toCanvas);
    const coach4 = getTrailingPoint(leadIdx, 144, mercPoints, smoothedAngles, toCanvas);

    const drawCoach = (coach) => {
      if (!coach.emerged) return; // Do not draw if not emerged yet!
      ctx.save();
      ctx.translate(coach.x, coach.y);
      ctx.rotate(-coach.angle);
      ctx.fillStyle = "#f5f5f7";
      ctx.beginPath();
      roundRectPath(ctx, -coachL / 2, -coachW / 2, coachL, coachW, 4);
      ctx.fill();
      // Orange stripe
      ctx.fillStyle = "#ff5b00";
      ctx.fillRect(-coachL / 2, -coachW / 2 + 2, coachL, 2.5);
      ctx.fillRect(-coachL / 2, coachW / 2 - 4.5, coachL, 2.5);
      // Dark window panes
      ctx.fillStyle = "#1c1c1e";
      ctx.fillRect(-9, -coachW / 2 + 4.5, 4, 3);
      ctx.fillRect(-2, -coachW / 2 + 4.5, 4, 3);
      ctx.fillRect(5, -coachW / 2 + 4.5, 4, 3);
      ctx.fillRect(-9, coachW / 2 - 7.5, 4, 3);
      ctx.fillRect(-2, coachW / 2 - 7.5, 4, 3);
      ctx.fillRect(5, coachW / 2 - 7.5, 4, 3);
      // Coupling link at front of coach to bridge to preceding segment
      ctx.fillStyle = "#2c2c2e";
      ctx.fillRect(-coachL / 2 - 3, -4, 3, 8);
      ctx.restore();
    };

    // Draw Rear to Front for correct layering
    drawCoach(coach4);
    drawCoach(coach3);
    drawCoach(coach2);
    drawCoach(coach1);

    // --- DRAW ENGINE LOCOMOTIVE (FRONT) ---
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-angle);
    ctx.fillStyle = "#f5f5f7";
    ctx.beginPath();
    ctx.moveTo(-15, -coachW / 2);
    ctx.lineTo(3, -coachW / 2);
    ctx.quadraticCurveTo(17, -coachW / 2, 17, 0); // Bullet nose
    ctx.quadraticCurveTo(17, coachW / 2, 3, coachW / 2);
    ctx.lineTo(-15, coachW / 2);
    ctx.quadraticCurveTo(-15, coachW / 2, -15, 0);
    ctx.fill();
    // Orange stripe
    ctx.fillStyle = "#ff5b00";
    ctx.fillRect(-15, -coachW / 2 + 2, 32, 2.5);
    ctx.fillRect(-15, coachW / 2 - 4.5, 32, 2.5);
    // Windshield
    ctx.fillStyle = "#1c1c1e";
    ctx.beginPath();
    ctx.arc(3, 0, 6, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    // Roof grills
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(-9, -2, 4, 4);
    ctx.fillRect(-2, -2, 4, 4);
    // Coupling Link at rear of Engine
    ctx.fillStyle = "#2c2c2e";
    ctx.fillRect(-18, -4, 3, 8);
    ctx.restore();

  } else {
    // DETAILED SPORTS CAR (Ferrari red sports car, made exactly as big as the train coach!)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-angle);
    
    const length = 30; // Same length as train coach!
    const width = 20;  // Same width as train coach!

    // 1. Draw 4 Rubber Tires extending from sides
    ctx.fillStyle = "#1c1c1e"; // Tire black
    ctx.fillRect(7, -12, 10, 3.5);
    ctx.fillRect(7, 8.5, 10, 3.5);
    ctx.fillRect(-17, -12, 10, 3.5);
    ctx.fillRect(-17, 8.5, 10, 3.5);

    // 2. Main Car Shell (Ferrari red)
    ctx.fillStyle = "#d30f1a";
    ctx.beginPath();
    roundRectPath(ctx, -length / 2, -width / 2, length, width, 6);
    ctx.fill();

    // 3. Black Racing Stripes down center
    ctx.fillStyle = "#1c1c1e";
    ctx.fillRect(-length / 2 + 2, -3.5, length - 4, 1.8);
    ctx.fillRect(-length / 2 + 2, 1.7, length - 4, 1.8);

    // 4. Rear Spoiler Wing
    ctx.fillStyle = "#1c1c1e"; // spoiler black
    ctx.fillRect(-length / 2 - 2, -width / 2, 4, width); // Main wing
    ctx.fillStyle = "#d30f1a";
    ctx.fillRect(-length / 2 - 3, -width / 2, 1, 3); // Left tip
    ctx.fillRect(-length / 2 - 3, width / 2 - 3, 1, 3); // Right tip

    // 5. Glowing Headlights & Tail Lights
    ctx.fillStyle = "#ffcc00"; // Glowing yellow headlights
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 12;
    ctx.fillRect(length / 2 - 4, -width / 2 + 2, 4, 2);
    ctx.fillRect(length / 2 - 4, width / 2 - 4, 4, 2);
    
    ctx.fillStyle = "#ff3b30"; // Red tail lights
    ctx.shadowColor = "#ff3b30";
    ctx.shadowBlur = 6;
    ctx.fillRect(-length / 2, -width / 2 + 3, 2, 2);
    ctx.fillRect(-length / 2, width / 2 - 5, 2, 2);
    ctx.shadowBlur = 0; // Reset shadow glow

    // 6. Windshield & Glass Cabin
    ctx.fillStyle = "#111111"; // glossy glass black
    ctx.beginPath();
    ctx.moveTo(-9, -width / 2 + 3);
    ctx.lineTo(11, -width / 2 + 4.5);
    ctx.quadraticCurveTo(16, 0, 11, width / 2 - 4.5);
    ctx.lineTo(-9, width / 2 - 3);
    ctx.quadraticCurveTo(-14, 0, -9, -width / 2 + 3);
    ctx.fill();

    // Windshield glass shine (macOS style overlay)
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    ctx.moveTo(4, -width / 2 + 5.5);
    ctx.lineTo(10, -width / 2 + 6);
    ctx.quadraticCurveTo(13, 0, 10, width / 2 - 6);
    ctx.lineTo(4, width / 2 - 5.5);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

export async function renderAndRecordAnimation({ routeGeometry, stations, options, onProgress }) {
  const { duration, fps, language, showLabels, showVehicle = true, theme = "light", pathMode = "rail" } = options;
  const totalFrames = duration * fps;

  const canvas = document.createElement("canvas");
  canvas.width = 2880;
  canvas.height = 1620;
  const ctx = canvas.getContext("2d");

  const mercPoints = routeGeometry.map(pt => latLonToMercator(pt[0], pt[1]));
  const stationMercs = stations.map(s => {
    const coords = latLonToMercator(s.lat, s.lon);
    return { name: s.customName || s.name, x: coords[0], y: coords[1], hindi: s.hindi };
  });

  const xs = mercPoints.map(p => p[0]);
  const ys = mercPoints.map(p => p[1]);

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  const padX = Math.max((maxX - minX) * 0.22, 100000) || 100000;
  const padY = Math.max((maxY - minY) * 0.22, 100000) || 100000;

  minX -= padX; maxX += padX; minY -= padY; maxY += padY;

  const canvasRatio = 2880 / 1620;
  const dataRatio = (maxX - minX) / (maxY - minY);

  let renderMinX = minX, renderMaxX = maxX, renderMinY = minY, renderMaxY = maxY;

  if (canvasRatio > dataRatio) {
    const targetW = (maxY - minY) * canvasRatio;
    const diff = targetW - (maxX - minX);
    renderMinX -= diff / 2; renderMaxX += diff / 2;
  } else {
    const targetH = (maxX - minX) / canvasRatio;
    const diff = targetH - (maxY - minY);
    renderMinY -= diff / 2; renderMaxY += diff / 2;
  }

  const metersSpan = renderMaxX - renderMinX;
  let zoom = Math.round(Math.log2((CIRCUMFERENCE * 15.0) / metersSpan));
  zoom = Math.max(3, Math.min(zoom, 17));

  function toCanvas(mx, my) {
    const px = ((mx - renderMinX) / (renderMaxX - renderMinX)) * 2880;
    const py = 1620 - ((my - renderMinY) / (renderMaxY - renderMinY)) * 1620;
    return [px, py];
  }

  onProgress("Initializing map assets...", 10);
  const tileSet = await preloadMapTiles(renderMinX, renderMaxX, renderMinY, renderMaxY, zoom, theme, (text, pct) => {
    onProgress(text, Math.round(10 + pct * 0.25));
  });

  const labelFontFamily = language === "hindi" 
    ? "'Kohinoor Devanagari', 'ITF Devanagari', sans-serif" 
    : "'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif";
  const labelFontSize = 32;

  // 1. Mathematically precompute smoothed vector heading angles for vehicles (with EMA filter)
  const smoothedAngles = [];
  if (mercPoints.length > 0) {
    let prevX = 0;
    let prevY = 0;
    let initialized = false;
    const alpha = 0.15; // Smooth exponential filter

    for (let i = 0; i < mercPoints.length; i++) {
      let nextIdx = Math.min(i + 5, mercPoints.length - 1);
      if (nextIdx === i) nextIdx = Math.min(i + 1, mercPoints.length - 1);
      let prevIdx = Math.max(i - 5, 0);
      if (prevIdx === i) prevIdx = Math.max(i - 1, 0);

      const pCurr = mercPoints[prevIdx];
      const pNext = mercPoints[nextIdx];

      let rawAngle = 0;
      if (pNext[0] !== pCurr[0] || pNext[1] !== pCurr[1]) {
        rawAngle = Math.atan2(pNext[1] - pCurr[1], pNext[0] - pCurr[0]);
      } else if (i > 0) {
        rawAngle = smoothedAngles[i - 1];
      }

      if (!initialized) {
        prevX = Math.cos(rawAngle);
        prevY = Math.sin(rawAngle);
        initialized = true;
        smoothedAngles.push(rawAngle);
      } else {
        prevX = alpha * Math.cos(rawAngle) + (1 - alpha) * prevX;
        prevY = alpha * Math.sin(rawAngle) + (1 - alpha) * prevY;
        smoothedAngles.push(Math.atan2(prevY, prevX));
      }
    }
  }

  // 2. Precompute Smart GIS Label Offsets to place labels on the outside of bends
  stationMercs.forEach((station) => {
    let closestIdx = 0;
    let closestDist = Infinity;
    
    // Find closest index in path geometry
    for (let i = 0; i < mercPoints.length; i++) {
      const dist = Math.hypot(mercPoints[i][0] - station.x, mercPoints[i][1] - station.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    const leftIdx = Math.max(0, closestIdx - 6);
    const rightIdx = Math.min(mercPoints.length - 1, closestIdx + 6);
    const pLeft = mercPoints[leftIdx];
    const pRight = mercPoints[rightIdx];

    let segmentAngle = 0;
    let crossProduct = 0;

    if (pRight && pLeft && (pRight[0] !== pLeft[0] || pRight[1] !== pLeft[1])) {
      segmentAngle = Math.atan2(pRight[1] - pLeft[1], pRight[0] - pLeft[0]);
      
      const pMid = mercPoints[closestIdx];
      const dx1 = pMid[0] - pLeft[0];
      const dy1 = pMid[1] - pLeft[1];
      const dx2 = pRight[0] - pMid[0];
      const dy2 = pRight[1] - pMid[1];
      crossProduct = dx1 * dy2 - dy1 * dx2;
    }

    // Default to top side (above segment direction)
    let offsetAngle = segmentAngle + Math.PI / 2;
    if (crossProduct > 0) {
      offsetAngle = segmentAngle - Math.PI / 2; // Flip to right side (outside of curve)
    }

    // Assign perpendicular unit offset vectors
    station.lxOffset = Math.cos(offsetAngle);
    station.lyOffset = Math.sin(offsetAngle);
  });

  function renderFrame(frameIdx) {
    ctx.clearRect(0, 0, 2880, 1620);

    for (let tx = tileSet.startX; tx <= tileSet.endX; tx++) {
      for (let ty = tileSet.startY; ty <= tileSet.endY; ty++) {
        const key = `${tileSet.zoom}_${tx}_${ty}`;
        const img = tileSet.cache[key];
        if (img) {
          const bounds = tileXYToMercatorBounds(tx, ty, tileSet.zoom);
          const [px1, py1] = toCanvas(bounds.minX, bounds.maxY);
          const [px2, py2] = toCanvas(bounds.maxX, bounds.minY);
          ctx.drawImage(img, px1, py1, px2 - px1 + 1, py2 - py1 + 1);
        }
      }
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = theme === "dark" ? "#888888" : "#555555";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = theme === "dark" ? 0.35 : 0.15;
    ctx.beginPath();
    
    let first = true;
    for (const pt of mercPoints) {
      const [px, py] = toCanvas(pt[0], pt[1]);
      if (first) { ctx.moveTo(px, py); first = false; }
      else { ctx.lineTo(px, py); }
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    const t = Math.min(frameIdx / totalFrames, 1.0);
    const activeCount = Math.max(1, Math.floor(t * mercPoints.length));
    
    if (activeCount > 1) {
      ctx.shadowColor = theme === "dark" ? "#ffcc55" : "#ffbb44";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = theme === "dark" ? "#ffcc55" : "#ffbb44";
      ctx.lineWidth = 20;
      ctx.globalAlpha = theme === "dark" ? 0.45 : 0.35;
      ctx.beginPath();
      ctx.moveTo(...toCanvas(mercPoints[0][0], mercPoints[0][1]));
      for (let i = 1; i < activeCount; i++) {
        ctx.lineTo(...toCanvas(mercPoints[i][0], mercPoints[i][1]));
      }
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#e06020";
      ctx.lineWidth = 9;
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.moveTo(...toCanvas(mercPoints[0][0], mercPoints[0][1]));
      for (let i = 1; i < activeCount; i++) {
        ctx.lineTo(...toCanvas(mercPoints[i][0], mercPoints[i][1]));
      }
      ctx.stroke();

      // Render Dynamic Articulated Vehicle Avatar at the head of the path
      if (showVehicle) {
        const leadIdx = Math.min(activeCount - 1, mercPoints.length - 1);
        drawVehicle(ctx, leadIdx, mercPoints, smoothedAngles, toCanvas, pathMode);
      }
    }

    stationMercs.forEach((station, idx) => {
      const [px, py] = toCanvas(station.x, station.y);
      ctx.shadowColor = "rgba(0,0,0,0.15)";
      ctx.shadowBlur = 8; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 4;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(px, py, 22, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
      if (idx === 0) ctx.fillStyle = "#34c759";
      else if (idx === stationMercs.length - 1) ctx.fillStyle = "#ff3b30";
      else ctx.fillStyle = "#0071e3";
      ctx.beginPath(); ctx.arc(px, py, 14, 0, 2 * Math.PI); ctx.fill();
    });

    if (showLabels) {
      stationMercs.forEach((station) => {
        const [px, py] = toCanvas(station.x, station.y);
        const nameText = (language === "hindi" && station.hindi) ? station.hindi : station.name;
        
        // Calculate label card offset location (px + normalOffset * radius)
        const radiusOffset = 85;
        const lx = px + station.lxOffset * radiusOffset;
        const ly = py - station.lyOffset * radiusOffset; // Canvas Y goes down

        // Draw dynamic dotted leader lines
        ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.16)";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash

        ctx.font = `600 ${labelFontSize}px ${labelFontFamily}`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(nameText).width;
        const padX = 24, padY = 12;
        const cardW = textWidth + padX * 2;
        const cardH = labelFontSize + padY * 2;

        ctx.fillStyle = theme === "dark" ? "rgba(28, 28, 30, 0.95)" : "rgba(255, 255, 255, 0.94)";
        ctx.shadowColor = theme === "dark" ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.08)";
        ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
        ctx.beginPath();
        roundRect(ctx, lx - cardW / 2, ly - cardH / 2, cardW, cardH, 12);
        ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
        ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)";
        ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = theme === "dark" ? "#f5f5f7" : "#1d1d1f";
        ctx.fillText(nameText, lx, ly - 1);
      });
    }
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }

  renderFrame(0);
  onProgress("Initializing high-fidelity MP4 video encoder...", 40);
  
  let mimeType = "video/mp4;codecs=avc1";
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm;codecs=h264";
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12000000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => { resolve(new Blob(chunks, { type: mimeType })); };
    recorder.onerror = (err) => reject(err);
    recorder.start();

    let currentFrame = 0;
    const intervalMs = 1000 / fps;
    const startTime = performance.now();

    function nextFrame() {
      if (currentFrame > totalFrames) { recorder.stop(); return; }
      renderFrame(currentFrame);
      onProgress(`Compiling frame ${currentFrame}/${totalFrames} (60fps)...`, Math.round(40 + (currentFrame / totalFrames) * 55));
      currentFrame++;
      
      const nextTargetTime = startTime + currentFrame * intervalMs;
      const delay = Math.max(0, nextTargetTime - performance.now());
      setTimeout(nextFrame, delay);
    }
    nextFrame();
  });
}
