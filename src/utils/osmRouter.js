// OpenStreetMap Snapping & BFS Shortest-Path Router for Tauri & React
// Equip with 100% offline indexing fallback for ultra-fast macOS desktop operations

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Caching variables for offline railway routing database
let offlineRailData = null;
let offlineNodeToWays = null;

// Caching variables for offline highway routing database
let offlineHighwayData = null;
let offlineHighwayNodeToWays = null;

// Load and index the compressed 40 MB Indian Railways offline database
async function loadOfflineRailData(onProgress) {
  if (offlineRailData) {
    return { 
      nodes: offlineRailData.nodes, 
      ways: offlineRailData.ways, 
      nodeToWays: offlineNodeToWays 
    };
  }

  onProgress("Loading offline Indian Railways database...", 10);
  const resp = await fetch("/data/india_railways.json");
  if (!resp.ok) {
    throw new Error("Offline database file not found. Falling back to online Overpass API.");
  }
  
  offlineRailData = await resp.json();
  
  onProgress("Indexing railway network...", 25);
  offlineNodeToWays = {};
  for (const [wid, nodeIds] of Object.entries(offlineRailData.ways)) {
    for (const nid of nodeIds) {
      if (!offlineNodeToWays[nid]) {
        offlineNodeToWays[nid] = [];
      }
      offlineNodeToWays[nid].push(wid);
    }
  }
  
  return { 
    nodes: offlineRailData.nodes, 
    ways: offlineRailData.ways, 
    nodeToWays: offlineNodeToWays 
  };
}

// Load and index the compressed Indian Highways offline database
async function loadOfflineHighwayData(onProgress) {
  if (offlineHighwayData) {
    return { 
      nodes: offlineHighwayData.nodes, 
      ways: offlineHighwayData.ways, 
      nodeToWays: offlineHighwayNodeToWays 
    };
  }

  onProgress("Loading offline Indian Highways database...", 10);
  const resp = await fetch("/data/india_highways.json");
  if (!resp.ok) {
    throw new Error("Offline highways database file not found. Falling back to online Overpass API.");
  }
  
  offlineHighwayData = await resp.json();
  
  onProgress("Indexing highway network...", 25);
  offlineHighwayNodeToWays = {};
  for (const [wid, nodeIds] of Object.entries(offlineHighwayData.ways)) {
    for (const nid of nodeIds) {
      if (!offlineHighwayNodeToWays[nid]) {
        offlineHighwayNodeToWays[nid] = [];
      }
      offlineHighwayNodeToWays[nid].push(wid);
    }
  }
  
  return { 
    nodes: offlineHighwayData.nodes, 
    ways: offlineHighwayData.ways, 
    nodeToWays: offlineHighwayNodeToWays 
  };
}

// Haversine formula to compute distance in km between two lat/lon coordinates
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Bounding box with padding
function getBBox(stations, pad = 0.15) {
  const lats = stations.map(s => s.lat);
  const lons = stations.map(s => s.lon);
  return {
    s: Math.min(...lats) - pad,
    w: Math.min(...lons) - pad,
    n: Math.max(...lats) + pad,
    e: Math.max(...lons) + pad
  };
}

// Snap a station coordinates to the closest node on any OSM way
function snapStation(station, ways, nodes, maxKm = 15.0) {
  let bestWayId = null;
  let bestIdx = 0;
  let bestDist = Infinity;

  const { name, lat, lon } = station;

  for (const [wayId, nodeIds] of Object.entries(ways)) {
    for (let i = 0; i < nodeIds.length; i++) {
      const nid = nodeIds[i];
      if (!nodes[nid]) continue;
      const [nLat, nLon] = nodes[nid];
      const dist = haversineKm(lat, lon, nLat, nLon);
      if (dist < bestDist) {
        bestDist = dist;
        bestWayId = wayId;
        bestIdx = i;
      }
    }
  }

  if (bestDist > maxKm) {
    console.warn(`WARNING: Station ${name} is ${bestDist.toFixed(1)}km away from nearest matching OSM element.`);
    return null;
  }

  console.log(`Snapped ${name} to way ${bestWayId} node idx ${bestIdx} (${(bestDist * 1000).toFixed(0)}m away)`);
  return { wayId: bestWayId, idx: bestIdx };
}

// Graph-based BFS pathfinding to find sequence of connected ways between two snapped way IDs
function findWayPath(startWayId, endWayId, ways, nodeToWays) {
  if (startWayId === endWayId) {
    return [startWayId];
  }

  const queue = [startWayId];
  const visited = new Set([startWayId]);
  const parent = {};

  while (queue.length > 0) {
    const currWayId = queue.shift();

    const nodeIds = ways[currWayId] || [];
    for (const nid of nodeIds) {
      const neighborWays = nodeToWays[nid] || [];
      for (const nextWayId of neighborWays) {
        if (visited.has(nextWayId)) continue;
        visited.add(nextWayId);
        parent[nextWayId] = currWayId;

        if (nextWayId === endWayId) {
          const path = [endWayId];
          while (path[path.length - 1] !== startWayId) {
            path.push(parent[path[path.length - 1]]);
          }
          return path.reverse();
        }
        queue.push(nextWayId);
      }
    }
  }

  return null; // No path found
}

// Find shared node between two OSM ways
function getSharedNodeId(wayIdA, wayIdB, ways) {
  const setA = new Set(ways[wayIdA]);
  const setB = new Set(ways[wayIdB]);
  for (const nid of setA) {
    if (setB.has(nid)) return nid;
  }
  return null;
}

function getNodeIndexInWay(nodeId, wayId, ways) {
  const nodeIds = ways[wayId] || [];
  return nodeIds.indexOf(nodeId);
}

// Compile coordinate points along a sequence of connected ways
function getPathGeometry(wayPath, startIdx, endIdx, ways, nodes) {
  if (!wayPath || wayPath.length === 0) return null;
  const result = [];

  for (let i = 0; i < wayPath.length; i++) {
    const wid = wayPath[i];
    const nodeIds = ways[wid] || [];

    if (i === 0 && wayPath.length === 1) {
      const step = startIdx <= endIdx ? 1 : -1;
      for (let j = startIdx; step === 1 ? j <= endIdx : j >= endIdx; j += step) {
        if (nodeIds[j] && nodes[nodeIds[j]]) {
          result.push(nodes[nodeIds[j]]);
        }
      }
    } else if (i === 0) {
      const snid = getSharedNodeId(wid, wayPath[1], ways);
      if (snid === null) continue;
      const sidx = getNodeIndexInWay(snid, wid, ways);
      if (sidx < 0) continue;
      const step = startIdx <= sidx ? 1 : -1;
      for (let j = startIdx; step === 1 ? j <= sidx : j >= sidx; j += step) {
        if (nodeIds[j] && nodes[nodeIds[j]]) {
          result.push(nodes[nodeIds[j]]);
        }
      }
    } else if (i === wayPath.length - 1) {
      const pnid = getSharedNodeId(wid, wayPath[i - 1], ways);
      if (pnid === null) continue;
      const pidx = getNodeIndexInWay(pnid, wid, ways);
      if (pidx < 0) continue;
      const step = pidx <= endIdx ? 1 : -1;
      for (let j = pidx; step === 1 ? j <= endIdx : j >= endIdx; j += step) {
        if (nodeIds[j] && nodes[nodeIds[j]]) {
          result.push(nodes[nodeIds[j]]);
        }
      }
    } else {
      const pnid = getSharedNodeId(wid, wayPath[i - 1], ways);
      const snid = getSharedNodeId(wid, wayPath[i + 1], ways);
      if (pnid === null || snid === null) continue;
      const pidx = getNodeIndexInWay(pnid, wid, ways);
      const sidx = getNodeIndexInWay(snid, wid, ways);
      if (pidx < 0 || sidx < 0) continue;
      const step = pidx <= sidx ? 1 : -1;
      for (let j = pidx; step === 1 ? j <= sidx : j >= sidx; j += step) {
        if (nodeIds[j] && nodes[nodeIds[j]]) {
          result.push(nodes[nodeIds[j]]);
        }
      }
    }
  }

  // Deduplicate subsequent identical coordinates
  const deduped = [];
  if (result.length > 0) {
    deduped.push(result[0]);
    for (let i = 1; i < result.length; i++) {
      const p1 = result[i];
      const p2 = deduped[deduped.length - 1];
      if (p1[0] !== p2[0] || p1[1] !== p2[1]) {
        deduped.push(p1);
      }
    }
  }
  return deduped;
}

// Fallback straight-line geodesic interpolation
function getStraightLineGeometry(s1, s2, steps = 100) {
  const geom = [];
  const dLat = s2.lat - s1.lat;
  const dLon = s2.lon - s1.lon;
  
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    geom.push([s1.lat + t * dLat, s1.lon + t * dLon]);
  }
  return geom;
}

// Appends coordinates while avoiding duplicating joint nodes
function appendSegment(target, segment) {
  if (segment.length === 0) return;
  if (target.length === 0) {
    target.push(...segment);
  } else {
    const lastNode = target[target.length - 1];
    const firstNew = segment[0];
    if (lastNode[0] === firstNew[0] && lastNode[1] === firstNew[1]) {
      target.push(...segment.slice(1));
    } else {
      target.push(...segment);
    }
  }
}

function fallbackAllSegments(stations) {
  const full = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const seg = getStraightLineGeometry(stations[i], stations[i + 1]);
    appendSegment(full, seg);
  }
  return full;
}

// Shared offline routing execution
function routeOffline(stations, db, onProgress, modeName) {
  onProgress(`Snapping stops to offline ${modeName} network...`, 60);
  const stationAccess = {};
  for (const s of stations) {
    const snapped = snapStation(s, db.ways, db.nodes);
    stationAccess[s.name] = snapped;
  }

  onProgress(`Reconstructing offline ${modeName} path...`, 85);
  const finalRoute = [];
  
  for (let i = 0; i < stations.length - 1; i++) {
    const s1 = stations[i];
    const s2 = stations[i + 1];
    
    const snap1 = stationAccess[s1.name];
    const snap2 = stationAccess[s2.name];

    if (!snap1 || !snap2) {
      console.warn(`Could not snap ${s1.name} or ${s2.name}. Falling back to straight line.`);
      const seg = getStraightLineGeometry(s1, s2);
      appendSegment(finalRoute, seg);
      continue;
    }

    const wayPath = findWayPath(snap1.wayId, snap2.wayId, db.ways, db.nodeToWays);
    if (!wayPath) {
      console.warn(`No path found between ${s1.name} and ${s2.name}. Falling back to straight line.`);
      const seg = getStraightLineGeometry(s1, s2);
      appendSegment(finalRoute, seg);
      continue;
    }

    const seg = getPathGeometry(wayPath, snap1.idx, snap2.idx, db.ways, db.nodes);
    if (seg && seg.length > 0) {
      appendSegment(finalRoute, seg);
      console.log(`Successfully routed segment ${s1.name} -> ${s2.name}: ${seg.length} points`);
    } else {
      const fallbackSeg = getStraightLineGeometry(s1, s2);
      appendSegment(finalRoute, fallbackSeg);
    }
  }

  onProgress("Offline route compiled successfully!", 100);
  return finalRoute;
}

// Main routing function
export async function fetchOSMRoute(stations, mode = "rail", onProgress) {
  if (stations.length < 2) return [];

  // Mode: offline local railway database
  if (mode === "rail") {
    try {
      const db = await loadOfflineRailData(onProgress);
      return routeOffline(stations, db, onProgress, "railway");
    } catch (err) {
      console.warn("Offline rail routing failed, falling back to online Overpass API...", err);
    }
  } 
  
  // Mode: offline local highway database
  if (mode === "highway") {
    try {
      const db = await loadOfflineHighwayData(onProgress);
      return routeOffline(stations, db, onProgress, "highway");
    } catch (err) {
      console.warn("Offline highway routing failed, falling back to online Overpass API...", err);
    }
  }

  // Fallback: Online Overpass API
  onProgress("Calculating bounding box...", 5);
  const bbox = getBBox(stations, 0.20);
  
  let q = "";
  if (mode === "rail") {
    q = `[out:json][timeout:90];(way["railway"="rail"](${bbox.s.toFixed(4)},${bbox.w.toFixed(4)},${bbox.n.toFixed(4)},${bbox.e.toFixed(4)}););out body;>;out skel qt;`;
  } else {
    // Highway mode - Motorways, trunks, primary, secondary, and tertiary roads
    q = `[out:json][timeout:90];(way["highway"~"motorway|trunk|primary|secondary"](${bbox.s.toFixed(4)},${bbox.w.toFixed(4)},${bbox.n.toFixed(4)},${bbox.e.toFixed(4)}););out body;>;out skel qt;`;
  }

  onProgress("Downloading route map elements from OpenStreetMap...", 15);
  console.log(`OSM Fetch bbox: s=${bbox.s}, w=${bbox.w}, n=${bbox.n}, e=${bbox.e}`);

  let osmData;
  try {
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      body: `data=${encodeURIComponent(q)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    if (!resp.ok) throw new Error(`Overpass API returned status: ${resp.status}`);
    osmData = await resp.json();
  } catch (err) {
    console.error("OSM Overpass query failed, using straight-line fallback.", err);
    onProgress("OSM Downloader failed (Network offline or timeout). Falling back to straight lines.", 40);
    return fallbackAllSegments(stations);
  }

  onProgress("Parsing map topology...", 40);
  const nodes = {};
  const ways = {};
  const nodeToWays = {};

  if (!osmData.elements || osmData.elements.length === 0) {
    console.warn("No OSM elements found in bounding box. Falling back to straight-line interpolation.");
    return fallbackAllSegments(stations);
  }

  for (const el of osmData.elements) {
    if (el.type === "node") {
      nodes[el.id] = [el.lat, el.lon];
    } else if (el.type === "way") {
      const wNodes = el.nodes || [];
      ways[el.id] = wNodes;
      for (const nid of wNodes) {
        if (!nodeToWays[nid]) nodeToWays[nid] = new Set();
        nodeToWays[nid].add(el.id);
      }
    }
  }

  onProgress("Snapping stops to nearest tracks...", 60);
  const stationAccess = {};
  for (const s of stations) {
    const snapped = snapStation(s, ways, nodes);
    stationAccess[s.name] = snapped;
  }

  onProgress("Reconstructing route path...", 80);
  const finalRoute = [];
  
  for (let i = 0; i < stations.length - 1; i++) {
    const s1 = stations[i];
    const s2 = stations[i + 1];
    
    const snap1 = stationAccess[s1.name];
    const snap2 = stationAccess[s2.name];

    if (!snap1 || !snap2) {
      console.warn(`Could not snap ${s1.name} or ${s2.name}. Falling back to straight line.`);
      const seg = getStraightLineGeometry(s1, s2);
      appendSegment(finalRoute, seg);
      continue;
    }

    const wayPath = findWayPath(snap1.wayId, snap2.wayId, ways, nodeToWays);
    if (!wayPath) {
      console.warn(`No path found between ${s1.name} and ${s2.name}. Falling back to straight line.`);
      const seg = getStraightLineGeometry(s1, s2);
      appendSegment(finalRoute, seg);
      continue;
    }

    const seg = getPathGeometry(wayPath, snap1.idx, snap2.idx, ways, nodes);
    if (seg && seg.length > 0) {
      appendSegment(finalRoute, seg);
      console.log(`Successfully routed segment ${s1.name} -> ${s2.name}: ${seg.length} points`);
    } else {
      const fallbackSeg = getStraightLineGeometry(s1, s2);
      appendSegment(finalRoute, fallbackSeg);
    }
  }

  onProgress("Route compiled successfully!", 100);
  return finalRoute;
}
