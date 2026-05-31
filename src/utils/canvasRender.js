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

export async function preloadMapTiles(mercPoints, zoom, theme, mapStyle = "satellite", onProgress) {
  // If third argument is a function, then the caller used the old signature: (mercPoints, zoom, theme, onProgress)
  // Let's handle backward compatibility robustly!
  let actualMapStyle = mapStyle;
  let actualOnProgress = onProgress;
  if (typeof mapStyle === "function") {
    actualOnProgress = mapStyle;
    actualMapStyle = "satellite";
  }

  const uniqueTiles = new Set();
  
  // Find all tiles touched by the path at the zoom level
  mercPoints.forEach(pt => {
    const [tx, ty] = mercatorToTileXY(pt[0], pt[1], zoom);
    const fX = Math.floor(tx);
    const fY = Math.floor(ty);
    
    // Add a 3x3 grid of tiles around each point along the path
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        uniqueTiles.add(`${zoom}_${fX + dx}_${fY + dy}`);
      }
    }
  });

  const tilesToLoad = Array.from(uniqueTiles).map(key => {
    const [z, x, y] = key.split("_").map(Number);
    return { z, x, y };
  });

  let loaded = 0;
  const cacheSat = {};
  const cacheRef = {};

  const promises = tilesToLoad.map(t => {
    return new Promise((resolve) => {
      const imgSat = new Image();
      imgSat.crossOrigin = "anonymous";
      
      const checkResolve = () => {
        if (cacheSat[`${t.z}_${t.x}_${t.y}`] && cacheRef[`${t.z}_${t.x}_${t.y}`]) {
          loaded++;
          const mapTypeName = actualMapStyle === "satellite" ? "satellite imagery" : "political map";
          if (actualOnProgress) {
            actualOnProgress(`Downloading ${mapTypeName} (${loaded}/${tilesToLoad.length})...`, Math.round((loaded / tilesToLoad.length) * 100));
          }
          resolve();
        }
      };

      // 1. Load Base Tile (Satellite or Political nolabels)
      if (actualMapStyle === "satellite") {
        imgSat.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`;
      } else {
        imgSat.src = theme === "dark"
          ? `https://basemaps.cartocdn.com/dark_nolabels/${t.z}/${t.x}/${t.y}.png`
          : `https://basemaps.cartocdn.com/light_nolabels/${t.z}/${t.x}/${t.y}.png`;
      }

      imgSat.onload = () => {
        cacheSat[`${t.z}_${t.x}_${t.y}`] = imgSat;
        checkResolve();
      };
      
      imgSat.onerror = () => {
        // Fallback to OSM tile if base fails
        const imgFall = new Image();
        imgFall.crossOrigin = "anonymous";
        imgFall.src = `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
        imgFall.onload = () => {
          cacheSat[`${t.z}_${t.x}_${t.y}`] = imgFall;
          checkResolve();
        };
        imgFall.onerror = () => {
          cacheSat[`${t.z}_${t.x}_${t.y}`] = new Image();
          checkResolve();
        };
      };

      // 2. ALWAYS Load Esri World Reference (Boundaries and Place names) for dense labels
      let refUrl;
      if (actualMapStyle === "satellite") {
        refUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${t.z}/${t.y}/${t.x}`;
      } else {
        refUrl = theme === "dark"
          ? `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/${t.z}/${t.y}/${t.x}`
          : `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/${t.z}/${t.y}/${t.x}`;
      }

      const imgRef = new Image();
      imgRef.crossOrigin = "anonymous";
      imgRef.src = refUrl;
      
      imgRef.onload = () => {
        cacheRef[`${t.z}_${t.x}_${t.y}`] = imgRef;
        checkResolve();
      };
      
      imgRef.onerror = () => {
        // Transparent fallback if reference layer fails
        const imgBlank = new Image();
        imgBlank.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        cacheRef[`${t.z}_${t.x}_${t.y}`] = imgBlank;
        checkResolve();
      };
    });
  });

  await Promise.all(promises);
  return { cacheSat, cacheRef, zoom, tiles: tilesToLoad };
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
  const { duration, fps, language, showLabels, showVehicle = true, theme = "light", pathMode = "rail", stopDuration = 0.5, mapStyle = "satellite" } = options;
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

  const zoom = 12;
  const scale = (256 * Math.pow(2, zoom)) / CIRCUMFERENCE;

  // 1. Find indices of stations in mercPoints
  const stationIndices = stationMercs.map(station => {
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < mercPoints.length; i++) {
      const dist = Math.hypot(mercPoints[i][0] - station.x, mercPoints[i][1] - station.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    return closestIdx;
  });

  // 2. Precompute frame mapping with 60-frame intro (30s spin, 30s vehicle appearance)
  const frameToNodeIdx = new Array(totalFrames);
  const introFrames = 60; // 30 frames for spin, 30 frames for vehicle appearance
  const activeFrames = Math.max(0, totalFrames - introFrames);
  const numInterStops = stationMercs.length - 2;
  const stopDurationFrames = Math.round(stopDuration * fps);
  
  // First 60 frames are pinned to node 0 (start station)
  for (let f = 0; f < introFrames; f++) {
    frameToNodeIdx[f] = 0;
  }

  // Cap total stop duration at 50% of the active travel frames to guarantee the vehicle travels!
  const maxTotalStopFrames = Math.round(activeFrames * 0.5);
  const totalStopFrames = Math.min(numInterStops * stopDurationFrames, maxTotalStopFrames);
  const stopFramesPerStop = numInterStops > 0 ? Math.floor(totalStopFrames / numInterStops) : 0;
  const travelFrames = activeFrames - (numInterStops * stopFramesPerStop);

  let currentFrame = introFrames;
  for (let seg = 0; seg < stationIndices.length - 1; seg++) {
    const startNode = stationIndices[seg];
    const endNode = stationIndices[seg + 1];
    const nodeSpan = endNode - startNode;

    // Distribute travel frames proportionally to the segment length (nodeSpan)
    const segFrac = nodeSpan / mercPoints.length;
    const segTravelFrames = Math.round(segFrac * travelFrames);

    // Populate travel frames
    for (let f = 0; f < segTravelFrames; f++) {
      if (currentFrame < totalFrames) {
        const ratio = f / Math.max(1, segTravelFrames - 1);
        frameToNodeIdx[currentFrame] = Math.round(startNode + ratio * nodeSpan);
        currentFrame++;
      }
    }

    // Populate stop frames if it is an intermediate stop
    if (seg < stationIndices.length - 2) {
      for (let f = 0; f < stopFramesPerStop; f++) {
        if (currentFrame < totalFrames) {
          frameToNodeIdx[currentFrame] = endNode;
          currentFrame++;
        }
      }
    }
  }

  // Fill any remaining frames with the last node index
  while (currentFrame < totalFrames) {
    frameToNodeIdx[currentFrame] = mercPoints.length - 1;
    currentFrame++;
  }

  // Precompute sliding average camera path coordinates (low-pass filter)
  const camPoints = [];
  const windowSize = 45; // 45 points before, 45 points after
  for (let i = 0; i < mercPoints.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    const start = Math.max(0, i - windowSize);
    const end = Math.min(mercPoints.length - 1, i + windowSize);
    for (let j = start; j <= end; j++) {
      sumX += mercPoints[j][0];
      sumY += mercPoints[j][1];
      count++;
    }
    camPoints.push([sumX / count, sumY / count]);
  }

  onProgress("Initializing map assets...", 10);
  const tileSet = await preloadMapTiles(mercPoints, zoom, theme, mapStyle, (text, pct) => {
    onProgress(text, Math.round(10 + pct * 0.25));
  });

  const labelFontFamily = language === "hindi" 
    ? "'Kohinoor Devanagari', 'ITF Devanagari', sans-serif" 
    : "'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif";
  const labelFontSize = 32;

  // 3. Mathematically precompute smoothed vector heading angles for vehicles (with EMA filter)
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

  // 4. Precompute Smart GIS Label Offsets to place labels on the outside of bends
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

    // Fill background color based on theme and style to avoid visible flickers
    ctx.fillStyle = theme === "dark" ? "#151516" : (mapStyle === "satellite" ? "#2b3d28" : "#f4f3f0");
    ctx.fillRect(0, 0, 2880, 1620);

    const activeIdx = frameToNodeIdx[Math.min(frameIdx, totalFrames - 1)];
    const activeCount = Math.max(1, activeIdx + 1);
    const leadIdx = Math.min(activeIdx, mercPoints.length - 1);
    const [camX, camY] = camPoints[leadIdx];

    const toCanvas = (mx, my) => {
      const px = 1440 + (mx - camX) * scale;
      const py = 810 - (my - camY) * scale;
      return [px, py];
    };

    // Calculate map tile indices covering the camera focus
    const [ctxFrac, ctyFrac] = mercatorToTileXY(camX, camY, zoom);
    const cx = Math.floor(ctxFrac);
    const cy = Math.floor(ctyFrac);

    // 1. Draw base tiles in 13x9 viewport grid
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const tx = cx + dx;
        const ty = cy + dy;
        const key = `${zoom}_${tx}_${ty}`;
        const img = tileSet.cacheSat[key];
        if (img) {
          const bounds = tileXYToMercatorBounds(tx, ty, zoom);
          const [px1, py1] = toCanvas(bounds.minX, bounds.maxY);
          const [px2, py2] = toCanvas(bounds.maxX, bounds.minY);
          ctx.drawImage(img, px1, py1, px2 - px1 + 1, py2 - py1 + 1);
        }
      }
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.15)";
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
      if (showVehicle && frameIdx >= 30) {
        drawVehicle(ctx, leadIdx, mercPoints, smoothedAngles, toCanvas, pathMode);
      }
    }

    // Draw Station concentric rings with dynamic clock-sweep spinny fill animation
    stationMercs.forEach((station, idx) => {
      const [px, py] = toCanvas(station.x, station.y);
      
      // White outer backing circle with soft shadow
      ctx.shadowColor = "rgba(0,0,0,0.15)";
      ctx.shadowBlur = 8; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 4;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(px, py, 22, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowColor = "transparent";

      // Calculate smooth approaching radial fill ratio
      let ratio = 0;
      const targetNodeIdx = stationIndices[idx];
      
      if (idx === 0) {
        ratio = Math.min(1, frameIdx / 30); // Start station spins and fills during the first 30 frames
      } else if (activeIdx >= targetNodeIdx) {
        ratio = 1; // Already crossed stops
      } else {
        const nodeDist = targetNodeIdx - activeIdx;
        if (nodeDist <= 40) {
          ratio = (40 - nodeDist) / 40; // Sweeps from 0 to 1
        }
      }

      // Assign station colors
      if (idx === 0) ctx.fillStyle = "#34c759"; // Green
      else if (idx === stationMercs.length - 1) ctx.fillStyle = "#ff3b30"; // Red
      else ctx.fillStyle = "#0071e3"; // Blue

      if (ratio > 0) {
        ctx.beginPath();
        if (ratio >= 1) {
          ctx.arc(px, py, 14, 0, 2 * Math.PI);
        } else {
          ctx.moveTo(px, py);
          // Start angle is exactly 0 (the right) for a spinning clock-sweep starting from the right!
          const startAngle = 0;
          ctx.arc(px, py, 14, startAngle, startAngle + ratio * 2 * Math.PI);
        }
        ctx.fill();
      }

      // Draw subtle hollow guide outline when not fully filled
      if (ratio < 1) {
        ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.12)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });

    // 2. Draw circle radar approach animation for upcoming intermediate/final stations
    stationMercs.forEach((station, sIdx) => {
      if (sIdx > 0) {
        const targetNodeIdx = stationIndices[sIdx];
        const nodeDist = targetNodeIdx - activeIdx;
        
        if (nodeDist > 0 && nodeDist <= 40) {
          const [spx, spy] = toCanvas(station.x, station.y);
          ctx.save();
          ctx.lineWidth = 3.5;

          const t1 = ((40 - nodeDist) / 40);
          const r1 = 22 + t1 * 60; // Grows from concentric ring size
          ctx.strokeStyle = theme === "dark" 
            ? `rgba(255, 204, 85, ${1 - t1})` 
            : `rgba(224, 96, 32, ${1 - t1})`;
          ctx.beginPath();
          ctx.arc(spx, spy, r1, 0, 2 * Math.PI);
          ctx.stroke();

          if (nodeDist < 25) {
            const t2 = ((25 - nodeDist) / 25);
            const r2 = 22 + t2 * 40;
            ctx.strokeStyle = theme === "dark" 
              ? `rgba(255, 204, 85, ${(1 - t2) * 0.6})` 
              : `rgba(224, 96, 32, ${(1 - t2) * 0.6})`;
            ctx.beginPath();
            ctx.arc(spx, spy, r2, 0, 2 * Math.PI);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    });

    // 3. Draw Place Names & Reference boundaries layer on top of tracks so geography is readable
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const tx = cx + dx;
        const ty = cy + dy;
        const key = `${zoom}_${tx}_${ty}`;
        const img = tileSet.cacheRef[key];
        if (img) {
          const bounds = tileXYToMercatorBounds(tx, ty, zoom);
          const [px1, py1] = toCanvas(bounds.minX, bounds.maxY);
          const [px2, py2] = toCanvas(bounds.maxX, bounds.minY);
          ctx.drawImage(img, px1, py1, px2 - px1 + 1, py2 - py1 + 1);
        }
      }
    }

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
