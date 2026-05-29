import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import MapContainer from "./components/MapContainer";
import { fetchOSMRoute } from "./utils/osmRouter";
import { renderAndRecordAnimation, preloadMapTiles } from "./utils/canvasRender";

// Standard preset stops matching the original Indian Railways config to populate the map initially
const PRESET_STOPS = [];

export default function App() {
  // Load initial states from local storage or fallback to defaults
  const [stops, setStops] = useState(() => {
    const saved = localStorage.getItem("map_stops");
    return saved ? JSON.parse(saved) : PRESET_STOPS;
  });
  const [pathMode, setPathMode] = useState(() => {
    return localStorage.getItem("map_path_mode") || "rail";
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("map_theme") || "light";
  });
  const [routePath, setRoutePath] = useState([]); // Snap-to-OSM physical track geometry
  
  const [animOptions, setAnimOptions] = useState(() => {
    const saved = localStorage.getItem("map_anim_options");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.showVehicle === undefined) parsed.showVehicle = true;
      return parsed;
    }
    return {
      duration: 15,
      fps: 60,
      language: "english",
      showLabels: true,
      showVehicle: true,
      autoDuration: true,
      exportName: "",
      exportDirectory: ""
    };
  });

  // Loading & compilation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  // Live Infographics Movie Preview state
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(false);
  const previewCanvasRef = React.useRef(null);
  const previewLoopRef = React.useRef(null);

  // Synchronize CSS body class with active theme
  useEffect(() => {
    document.body.classList.toggle("dark-theme", theme === "dark");
  }, [theme]);

  // Synchronize stops changes to localStorage
  useEffect(() => {
    localStorage.setItem("map_stops", JSON.stringify(stops));
  }, [stops]);

  // Synchronize pathMode changes to localStorage
  useEffect(() => {
    localStorage.setItem("map_path_mode", pathMode);
  }, [pathMode]);

  // Synchronize theme changes to localStorage
  useEffect(() => {
    localStorage.setItem("map_theme", theme);
  }, [theme]);

  // Synchronize animOptions changes to localStorage
  useEffect(() => {
    localStorage.setItem("map_anim_options", JSON.stringify(animOptions));
  }, [animOptions]);

  // Resolve standard downloads folder on macOS Tauri launch
  useEffect(() => {
    const initExportDirectory = async () => {
      const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
      if (isTauri && !animOptions.exportDirectory) {
        try {
          const { downloadDir } = await import("@tauri-apps/api/path");
          const defaultDir = await downloadDir();
          setAnimOptions(prev => ({ ...prev, exportDirectory: defaultDir }));
        } catch (err) {
          console.error("Failed to resolve standard Downloads folder: ", err);
        }
      }
    };
    initExportDirectory();
  }, []);

  // Dynamic path distance in km
  const getPathDistanceKm = (path) => {
    if (path.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const R = 6371; // Earth radius in km
      const dLat = (p2[0] - p1[0]) * Math.PI / 180;
      const dLon = (p2[1] - p1[1]) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      total += R * c;
    }
    return total;
  };

  // Auto Duration Calculator
  useEffect(() => {
    if (animOptions.autoDuration && routePath.length > 0) {
      const distance = getPathDistanceKm(routePath);
      // Base 5s + 2.5s per 100km, capped between 5s and 45s
      const calculatedDuration = Math.max(5, Math.min(45, Math.round(5 + distance / 120)));
      setAnimOptions(prev => {
        if (prev.duration !== calculatedDuration) {
          return { ...prev, duration: calculatedDuration };
        }
        return prev;
      });
    }
  }, [routePath, animOptions.autoDuration]);

  // Automatically fetch and snap to exact physical OSM track/road geometry when stops change
  useEffect(() => {
    if (stops.length < 2) {
      setRoutePath([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        // Silently fetch curved OSM geometry in background (empty progress callback)
        const geom = await fetchOSMRoute(stops, pathMode, () => {});
        setRoutePath(geom);
      } catch (err) {
        console.error("Background pathfinding failed: ", err);
      }
    }, 600); // 600ms debounce to prevent API flooding during typing or edits

    return () => clearTimeout(timer);
  }, [stops, pathMode]);

  // Add stop handler (called from map clicks or search results)
  const handleAddStop = (newStop) => {
    const stopToAdd = {
      id: Date.now().toString(),
      customName: newStop.name,
      hindi: newStop.hindi || "",
      ...newStop
    };
    setStops(prev => [...prev, stopToAdd]);
  };

  // Remove stop
  const handleRemoveStop = (id) => {
    setStops(prev => prev.filter(s => s.id !== id));
  };

  // Reorder stops
  const handleReorderStops = (fromIdx, toIdx) => {
    setStops(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // Update custom display names/Hindi overrides
  const handleUpdateStop = (id, field, value) => {
    setStops(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleOptionChange = (key, val) => {
    setAnimOptions(prev => ({ ...prev, [key]: val }));
  };

  // Perform macOS Native File Saving / Browser download
  const saveVideoFile = async (blob) => {
    try {
      const buffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      // Determine file name dynamically based on stops
      let fileName = "route_animation.mp4";
      if (animOptions.exportName) {
        fileName = animOptions.exportName.endsWith(".mp4") ? animOptions.exportName : `${animOptions.exportName}.mp4`;
      } else if (stops.length >= 2) {
        const start = stops[0].customName || stops[0].name;
        const end = stops[stops.length - 1].customName || stops[stops.length - 1].name;
        const sanitized = `${start}_to_${end}`.replace(/[^a-zA-Z0-9_]/g, "_");
        fileName = `${sanitized}_animation.mp4`;
      } else {
        fileName = pathMode === "rail" ? "railway_animation.mp4" : "highway_animation.mp4";
      }
      
      // Safe Tauri environment check
      const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

      if (isTauri) {
        const { writeFile } = await import("@tauri-apps/plugin-fs");

        // If export directory is specified, write the file directly!
        if (animOptions.exportDirectory) {
          const separator = animOptions.exportDirectory.endsWith("/") ? "" : "/";
          const fullPath = `${animOptions.exportDirectory}${separator}${fileName}`;
          setProgressText(`Saving file directly to export directory...`);
          await writeFile(fullPath, uint8Array);
          console.log(`Saved video directly to macOS path: ${fullPath}`);
          return true;
        }

        // Fallback: Open macOS Native Save panel
        setProgressText("Opening macOS Save panel...");
        const { save } = await import("@tauri-apps/plugin-dialog");

        const filePath = await save({
          title: "Save Route Animation",
          defaultPath: fileName,
          filters: [{ name: "Video", extensions: ["mp4"] }]
        });

        if (filePath) {
          setProgressText("Writing animation file...");
          await writeFile(filePath, uint8Array);
          console.log(`Saved video to native macOS path: ${filePath}`);
          return true;
        }
        return false;
      } else {
        // Fallback to browser direct downloads
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
      }
    } catch (err) {
      console.error("Save error: ", err);
      alert("Error saving animation: " + (err.message || err));
      return false;
    }
  };

  // Action: EXPORT HIGH-FIDELITY MP4 VIDEO
  const handleMakeAnimation = async () => {
    if (stops.length < 2) return;
    
    setIsGenerating(true);
    setProgressText("Initializing route geometries...");
    setProgressPct(0);

    try {
      // 1. Fetch short-path route geometry (Takes 0% -> 10% of total progress)
      const routeGeometry = await fetchOSMRoute(stops, pathMode, (text, pct) => {
        setProgressText(text);
        setProgressPct(Math.round(pct * 0.1));
      });

      if (!routeGeometry || routeGeometry.length === 0) {
        throw new Error("Could not compute route geometry coordinates.");
      }

      // 2. Render and compile offscreen Canvas into high-res MP4 (Takes 10% -> 95%)
      const blob = await renderAndRecordAnimation({
        routeGeometry,
        stations: stops,
        options: { ...animOptions, theme, pathMode }, // Pass active theme and pathMode!
        onProgress: (text, pct) => {
          setProgressText(text);
          setProgressPct(pct);
        }
      });

      // 3. Save the compiled H.264 file natively (Takes 95% -> 100%)
      const success = await saveVideoFile(blob);
      if (success) {
        setProgressText("Animation successfully generated and saved!");
        setProgressPct(100);
      } else {
        setProgressText("Save cancelled.");
      }
    } catch (err) {
      console.error("Generation failed: ", err);
      setProgressText(`Error: ${err.message}`);
    } finally {
      // Wait 3 seconds to let user read the completion status, then hide progress area
      setTimeout(() => {
        setIsGenerating(false);
      }, 3500);
    }
  };

  // Action: REAL-TIME INFOGRAPHICS MOVIE PREVIEW RUN
  const handlePreviewRun = async () => {
    if (stops.length < 2) return;

    setPreviewProgress(true);
    setIsGenerating(true);
    setProgressText("Initializing preview track...");
    setProgressPct(0);

    try {
      // 1. Snapping offline route geometry (takes 0% -> 20%)
      const routeGeometry = await fetchOSMRoute(stops, pathMode, (text, pct) => {
        setProgressText(text);
        setProgressPct(Math.round(pct * 0.2));
      });

      if (!routeGeometry || routeGeometry.length === 0) {
        throw new Error("Could not compute preview geometry.");
      }

      // 2. Mathematically compute coordinate boundaries for tile preloading
      const circumference = 2 * Math.PI * 6378137.0;
      const rMajor = 6378137.0;
      
      function toMercator(lat, lon) {
        const x = rMajor * lon * Math.PI / 180.0;
        const latRad = lat * Math.PI / 180.0;
        return [x, rMajor * Math.log(Math.tan(Math.PI / 4.0 + latRad / 2.0))];
      }

      const mercPoints = routeGeometry.map(pt => toMercator(pt[0], pt[1]));
      const xs = mercPoints.map(p => p[0]);
      const ys = mercPoints.map(p => p[1]);

      let minX = Math.min(...xs);
      let maxX = Math.max(...xs);
      let minY = Math.min(...ys);
      let maxY = Math.max(...ys);

      const padX = Math.max((maxX - minX) * 0.22, 100000) || 100000;
      const padY = Math.max((maxY - minY) * 0.22, 100000) || 100000;

      minX -= padX; maxX += padX; minY -= padY; maxY += padY;

      const canvasRatio = 1280 / 720;
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
      let zoom = Math.round(Math.log2((circumference * 15.0) / metersSpan));
      zoom = Math.max(3, Math.min(zoom, 17));

      // 3. Preload Map Tiles in background (takes 20% -> 100%)
      setProgressText("Downloading high-resolution preview map...");
      const tileSet = await preloadMapTiles(renderMinX, renderMaxX, renderMinY, renderMaxY, zoom, theme, (text, pct) => {
        setProgressText(text);
        setProgressPct(Math.round(20 + pct * 0.8));
      });

      setIsGenerating(false);
      setPreviewProgress(false);
      setIsPreviewing(true);

      // Wait for React to render the canvas element in DOM
      setTimeout(() => {
        startPreviewLoop(routeGeometry, tileSet);
      }, 100);

    } catch (err) {
      console.error("Preview preparation failed: ", err);
      setProgressText(`Error: ${err.message}`);
      setPreviewProgress(false);
      setTimeout(() => setIsGenerating(false), 2000);
    }
  };

  // Real-time Canvas drawing preview loop (100% Client-side preview)
  // Real-time Canvas drawing preview loop (100% Client-side preview)
  const startPreviewLoop = (routeGeometry, tileSet) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const totalFrames = animOptions.duration * animOptions.fps;

    const canvasW = 1280;
    const canvasH = 720;
    canvas.width = canvasW;
    canvas.height = canvasH;

    // Web Mercator bounds matching logic
    const circumference = 2 * Math.PI * 6378137.0;
    const rMajor = 6378137.0;
    
    function toMercator(lat, lon) {
      const x = rMajor * lon * Math.PI / 180.0;
      const latRad = lat * Math.PI / 180.0;
      const y = rMajor * Math.log(Math.tan(Math.PI / 4.0 + latRad / 2.0));
      return [x, y];
    }

    const mercPoints = routeGeometry.map(pt => toMercator(pt[0], pt[1]));
    const stationMercs = stops.map(s => {
      const coords = toMercator(s.lat, s.lon);
      return { name: s.customName || s.name, x: coords[0], y: coords[1], hindi: s.hindi };
    });

    const xs = mercPoints.map(p => p[0]);
    const ys = mercPoints.map(p => p[1]);

    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    // Apply the 22% / 100km safety border margin to the preview canvas as well!
    const padX = Math.max((maxX - minX) * 0.22, 100000) || 100000;
    const padY = Math.max((maxY - minY) * 0.22, 100000) || 100000;

    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;

    const canvasRatio = canvasW / canvasH;
    const dataRatio = (maxX - minX) / (maxY - minY);

    let renderMinX = minX;
    let renderMaxX = maxX;
    let renderMinY = minY;
    let renderMaxY = maxY;

    if (canvasRatio > dataRatio) {
      const targetW = (maxY - minY) * canvasRatio;
      const diff = targetW - (maxX - minX);
      renderMinX -= diff / 2;
      renderMaxX += diff / 2;
    } else {
      const targetH = (maxX - minX) / canvasRatio;
      const diff = targetH - (maxY - minY);
      renderMinY -= diff / 2;
      renderMaxY += diff / 2;
    }

    function toCanvas(mx, my) {
      const px = ((mx - renderMinX) / (renderMaxX - renderMinX)) * canvasW;
      const py = canvasH - ((my - renderMinY) / (renderMaxY - renderMinY)) * canvasH;
      return [px, py];
    }

    // Helper to calculate trailing points along the path for articulated preview train
    function getTrailingPoint(leadIdx, targetDist) {
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

    // 1. Mathematically precompute smoothed vector heading angles for preview vehicle (with EMA filter)
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

      let offsetAngle = segmentAngle + Math.PI / 2;
      if (crossProduct > 0) {
        offsetAngle = segmentAngle - Math.PI / 2; // Flip to right side (outside of curve)
      }

      station.lxOffset = Math.cos(offsetAngle);
      station.lyOffset = Math.sin(offsetAngle);
    });

    let frame = 0;
    
    const draw = () => {
      ctx.clearRect(0, 0, canvasW, canvasH);

      // Render Preview high-resolution Map Background (CartoDB Light/Dark tiles)
      if (tileSet) {
        function tileXYToMercatorBounds(tx, ty, zoom) {
          const halfC = circumference / 2;
          const numTiles = Math.pow(2, zoom);
          const minX = (tx / numTiles) * circumference - halfC;
          const maxX = ((tx + 1) / numTiles) * circumference - halfC;
          const maxY = halfC - (ty / numTiles) * circumference;
          const minY = halfC - ((ty + 1) / numTiles) * circumference;
          return { minX, maxX, minY, maxY };
        }

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
      } else {
        ctx.fillStyle = theme === "dark" ? "#151516" : "#e8e4d8"; // Land color fallback
        ctx.fillRect(0, 0, canvasW, canvasH);
      }

      // Inactive outline path
      ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(...toCanvas(mercPoints[0][0], mercPoints[0][1]));
      for (let i = 1; i < mercPoints.length; i++) {
        ctx.lineTo(...toCanvas(mercPoints[i][0], mercPoints[i][1]));
      }
      ctx.stroke();

      // Active path neon glow
      const t = Math.min(frame / totalFrames, 1.0);
      const activeCount = Math.max(1, Math.floor(t * mercPoints.length));

      if (activeCount > 1) {
        // Glowing outline
        ctx.shadowColor = theme === "dark" ? "#ffcc55" : "#ffbb44";
        ctx.shadowBlur = 10;
        ctx.strokeStyle = theme === "dark" ? "#ffcc55" : "#ffbb44";
        ctx.lineWidth = 12;
        ctx.globalAlpha = theme === "dark" ? 0.45 : 0.4;
        ctx.beginPath();
        ctx.moveTo(...toCanvas(mercPoints[0][0], mercPoints[0][1]));
        for (let i = 1; i < activeCount; i++) {
          ctx.lineTo(...toCanvas(mercPoints[i][0], mercPoints[i][1]));
        }
        ctx.stroke();

        // Solid core active line
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#e06020";
        ctx.lineWidth = 5;
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.moveTo(...toCanvas(mercPoints[0][0], mercPoints[0][1]));
        for (let i = 1; i < activeCount; i++) {
          ctx.lineTo(...toCanvas(mercPoints[i][0], mercPoints[i][1]));
        }
        ctx.stroke();

        // Render Dynamic Articulated Vehicle Avatar at the head of the path
        const leadIdx = Math.min(activeCount - 1, mercPoints.length - 1);
        const leadPt = mercPoints[leadIdx];
        const [vpx, vpy] = toCanvas(leadPt[0], leadPt[1]);
        const vAngle = smoothedAngles[leadIdx];

        if (animOptions.showVehicle) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.3)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;

        if (pathMode === "rail") {
          // Highly detailed Articulated Train (5 segments: Engine + 4 Coaches bending independently!)
          const coachW = 12; // Bigger preview width!
          const coachL = 18; // Bigger preview length!
          
          // Get Trailing points for Coach 1, 2, 3, and 4 in preview spacing
          const coach1 = getTrailingPoint(leadIdx, 21.5);
          const coach2 = getTrailingPoint(leadIdx, 43.0);
          const coach3 = getTrailingPoint(leadIdx, 64.5);
          const coach4 = getTrailingPoint(leadIdx, 86.0);

          const drawPreviewCoach = (coach) => {
            if (!coach.emerged) return; // Do not draw if not emerged yet!
            ctx.save();
            ctx.translate(coach.x, coach.y);
            ctx.rotate(-coach.angle);
            ctx.fillStyle = "#f5f5f7";
            ctx.beginPath();
            const cx = -coachL / 2, cy = -coachW / 2, cw = coachL, ch = coachW, r = 2.5;
            ctx.moveTo(cx + r, cy);
            ctx.lineTo(cx + cw - r, cy);
            ctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + r);
            ctx.lineTo(cx + cw, cy + ch - r);
            ctx.quadraticCurveTo(cx + cw, cy + ch, cx + cw - r, cy + ch);
            ctx.lineTo(cx + r, cy + ch);
            ctx.quadraticCurveTo(cx, cy + ch, cx, cy + ch - r);
            ctx.lineTo(cx, cy + r);
            ctx.quadraticCurveTo(cx, cy, cx + r, cy);
            ctx.fill();
            
            ctx.fillStyle = "#ff5b00";
            ctx.fillRect(-coachL / 2, -coachW / 2 + 1, coachL, 1.2);
            ctx.fillRect(-coachL / 2, coachW / 2 - 2.2, coachL, 1.2);
            
            // Coupling Link front
            ctx.fillStyle = "#2c2c2e";
            ctx.fillRect(-coachL / 2 - 2, -1, 2, 2);
            ctx.restore();
          };

          // Draw Rear to Front for correct layering
          drawPreviewCoach(coach4);
          drawPreviewCoach(coach3);
          drawPreviewCoach(coach2);
          drawPreviewCoach(coach1);

          // Draw Engine Locomotive (Front)
          ctx.save();
          ctx.translate(vpx, vpy);
          ctx.rotate(-vAngle);
          ctx.fillStyle = "#f5f5f7";
          ctx.beginPath();
          ctx.moveTo(-9, -coachW / 2);
          ctx.lineTo(2, -coachW / 2);
          ctx.quadraticCurveTo(11.5, -coachW / 2, 11.5, 0); // Bullet nose
          ctx.quadraticCurveTo(11.5, coachW / 2, 2, coachW / 2);
          ctx.lineTo(-9, coachW / 2);
          ctx.quadraticCurveTo(-9, coachW / 2, -9, 0);
          ctx.fill();

          ctx.fillStyle = "#ff5b00";
          ctx.fillRect(-9, -coachW / 2 + 1, 20.5, 1.2);
          ctx.fillRect(-9, coachW / 2 - 2.2, 20.5, 1.2);

          // Windshield
          ctx.fillStyle = "#1c1c1e";
          ctx.beginPath();
          ctx.arc(2, 0, 3.5, -Math.PI / 2, Math.PI / 2);
          ctx.fill();

          // Coupling Link rear
          ctx.fillStyle = "#2c2c2e";
          ctx.fillRect(-11, -1, 2, 2);
          ctx.restore();

        } else {
          // Highly detailed Red Sports Car with black tires, stripes, and spoiler (scaled to be as big as a train coach)
          ctx.save();
          ctx.translate(vpx, vpy);
          ctx.rotate(-vAngle);
          const length = 18;
          const width = 12;
          
          // 4 black tires on sides
          ctx.fillStyle = "#1c1c1e";
          ctx.fillRect(4, -7.5, 5, 2);
          ctx.fillRect(4, 5.5, 5, 2);
          ctx.fillRect(-9, -7.5, 5, 2);
          ctx.fillRect(-9, 5.5, 5, 2);

          // Main shell (Ferrari red)
          ctx.fillStyle = "#d30f1a";
          ctx.beginPath();
          const cx = -length / 2, cy = -width / 2, cw = length, ch = width, r = 3;
          ctx.moveTo(cx + r, cy);
          ctx.lineTo(cx + cw - r, cy);
          ctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + r);
          ctx.lineTo(cx + cw, cy + ch - r);
          ctx.quadraticCurveTo(cx + cw, cy + ch, cx + cw - r, cy + ch);
          ctx.lineTo(cx + r, cy + ch);
          ctx.quadraticCurveTo(cx, cy + ch, cx, cy + ch - r);
          ctx.lineTo(cx, cy + r);
          ctx.quadraticCurveTo(cx, cy, cx + r, cy);
          ctx.fill();

          // Black stripes
          ctx.fillStyle = "#1c1c1e";
          ctx.fillRect(-length / 2 + 1.5, -2, length - 3, 1);
          ctx.fillRect(-length / 2 + 1.5, 1, length - 3, 1);

          // Spoiler wing
          ctx.fillStyle = "#1c1c1e";
          ctx.fillRect(-length / 2 - 1, -width / 2, 2, width);

          // Headlights & Tail lights
          ctx.fillStyle = "#ffcc00";
          ctx.fillRect(length / 2 - 2.5, -width / 2 + 1, 2.5, 1.2);
          ctx.fillRect(length / 2 - 2.5, width / 2 - 2.2, 2.5, 1.2);

          ctx.fillStyle = "#ff3b30";
          ctx.fillRect(-length / 2, -width / 2 + 1.8, 1.2, 1.2);
          ctx.fillRect(-length / 2, width / 2 - 3, 1.2, 1.2);

          // Windshield
          ctx.fillStyle = "#111111";
          ctx.beginPath();
          ctx.moveTo(-5, -width / 2 + 1.8);
          ctx.lineTo(6, -width / 2 + 2.7);
          ctx.quadraticCurveTo(9, 0, 6, width / 2 - 2.7);
          ctx.lineTo(-5, width / 2 - 1.8);
          ctx.quadraticCurveTo(-8, 0, -5, -width / 2 + 1.8);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        }
      }

      // Draw Station concentric rings
      stationMercs.forEach((station, idx) => {
        const [px, py] = toCanvas(station.x, station.y);
        
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.1)";
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, 2 * Math.PI);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        
        if (idx === 0) ctx.fillStyle = "#34c759";
        else if (idx === stationMercs.length - 1) ctx.fillStyle = "#ff3b30";
        else ctx.fillStyle = "#0071e3";

        ctx.beginPath();
        ctx.arc(px, py, 7, 0, 2 * Math.PI);
        ctx.fill();
      });

      // Draw Station labels using smart GIS offsets
      if (animOptions.showLabels) {
        const labelFontFamily = animOptions.language === "hindi" 
          ? "'Kohinoor Devanagari', 'ITF Devanagari', sans-serif" 
          : "'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif";
        
        stationMercs.forEach((station) => {
          const [px, py] = toCanvas(station.x, station.y);
          const nameText = (animOptions.language === "hindi" && station.hindi) ? station.hindi : station.name;
          
          // Calculate label card offset location (px + normalOffset * radius)
          const radiusOffset = 42;
          const lx = px + station.lxOffset * radiusOffset;
          const ly = py - station.lyOffset * radiusOffset;

          // Draw leaders connecting card to station dot
          ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.16)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.setLineDash([]); // Reset dash

          ctx.font = `600 15px ${labelFontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          const textWidth = ctx.measureText(nameText).width;
          const padX = 12;
          const padY = 6;
          const cardW = textWidth + padX * 2;
          const cardH = 15 + padY * 2;

          ctx.fillStyle = theme === "dark" ? "rgba(28, 28, 30, 0.95)" : "rgba(255, 255, 255, 0.96)";
          ctx.shadowColor = theme === "dark" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.06)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 2;
          ctx.beginPath();
          
          // Draw rounded rectangle
          const r = 6;
          ctx.moveTo(lx - cardW / 2 + r, ly - cardH / 2);
          ctx.lineTo(lx + cardW / 2 - r, ly - cardH / 2);
          ctx.quadraticCurveTo(lx + cardW / 2, ly - cardH / 2, lx + cardW / 2, ly - cardH / 2 + r);
          ctx.lineTo(lx + cardW / 2, ly + cardH / 2 - r);
          ctx.quadraticCurveTo(lx + cardW / 2, ly + cardH / 2, lx + cardW / 2 - r, ly + cardH / 2);
          ctx.lineTo(lx - cardW / 2 + r, ly + cardH / 2);
          ctx.quadraticCurveTo(lx - cardW / 2, ly + cardH / 2, lx - cardW / 2, ly + cardH / 2 - r);
          ctx.lineTo(lx - cardW / 2, ly - cardH / 2 + r);
          ctx.quadraticCurveTo(lx - cardW / 2, ly - cardH / 2, lx - cardW / 2 + r, ly - cardH / 2);
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.06)";
          ctx.stroke();

          ctx.fillStyle = theme === "dark" ? "#f5f5f7" : "#1d1d1f";
          ctx.fillText(nameText, lx, ly - 0.5);
        });
      }

      frame = (frame + 1) % (totalFrames + 30); // Loop preview indefinitely with a brief pause
      previewLoopRef.current = requestAnimationFrame(draw);
    };

    draw();
  };

  const handleClosePreview = () => {
    if (previewLoopRef.current) {
      cancelAnimationFrame(previewLoopRef.current);
    }
    setIsPreviewing(false);
  };

  return (
    <div className="macos-app">
      {/* 1. Left Sidebar controls */}
      <Sidebar
        stops={stops}
        onAddStop={handleAddStop}
        onRemoveStop={handleRemoveStop}
        onReorderStops={handleReorderStops}
        onUpdateStop={handleUpdateStop}
        pathMode={pathMode}
        onChangePathMode={setPathMode}
        animOptions={animOptions}
        onChangeOptions={handleOptionChange}
        onPreview={handlePreviewRun}
        onMakeAnimation={handleMakeAnimation}
        isGenerating={isGenerating}
        progressText={progressText}
        progressPct={progressPct}
        theme={theme}
        onChangeTheme={setTheme}
      />

      {/* 2. Interactive Map */}
      <MapContainer 
        stops={stops} 
        onAddStop={handleAddStop}
        theme={theme}
        routePath={routePath}
      />

      {/* 3. Sleek macOS Modal Infographics Movie Preview Overlay */}
      {isPreviewing && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.5)", backdropFilter: "blur(20px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ backgroundColor: theme === "dark" ? "#1e1e1f" : "#ffffff", border: theme === "dark" ? "1px solid #38383a" : "none", borderRadius: "18px", width: "1320px", padding: "20px", boxShadow: "0 24px 64px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 600, color: theme === "dark" ? "#f5f5f7" : "#1d1d1f" }}>Animation Preview</h3>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Real-time 60fps Infographic Preview</p>
              </div>
              <button 
                className="macos-btn secondary" 
                style={{ width: "80px", padding: "6px 0", fontSize: "12px", borderRadius: "8px" }} 
                onClick={handleClosePreview}
              >
                Close
              </button>
            </div>
            
            <div style={{ backgroundColor: theme === "dark" ? "#151516" : "#000000", border: theme === "dark" ? "1px solid #2c2c2e" : "none", borderRadius: "12px", width: "1280px", height: "720px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <canvas ref={previewCanvasRef} style={{ width: "1280px", height: "720px", display: "block" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
