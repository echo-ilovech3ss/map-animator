import json, requests, math, sys
from collections import defaultdict, deque

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CONFIG_PATH = "config.json"
OUTPUT_PATH = "data/route_geometry.json"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko; +https://github.com/arunmehta/indian-railways-animation)"
REFERER = "https://github.com/arunmehta/indian-railways-animation"


def haversine_km(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return 2 * 6371 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def get_bbox(stations, pad=0.15):
    lats = [s["lat"] for s in stations.values()]
    lons = [s["lon"] for s in stations.values()]
    return min(lats) - pad, min(lons) - pad, max(lats) + pad, max(lons) + pad


def fetch_osm(bbox):
    s, w, n, e = bbox
    q = f"""[out:json][timeout:120];
(way["railway"="rail"]({s},{w},{n},{e}););
out body; >; out skel qt;"""
    print(f"Fetching railway data from OSM Overpass API...")
    print(f"  Bbox: {s:.2f},{w:.2f} to {n:.2f},{e:.2f}")
    headers = {"User-Agent": USER_AGENT, "Referer": REFERER, "Accept": "application/json"}
    resp = requests.post(OVERPASS_URL, data={"data": q}, headers=headers, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    print(f"  Got {len(data.get('elements', []))} elements")
    return data


def parse_osm(data):
    nodes = {}
    ways = {}
    for el in data.get("elements", []):
        if el["type"] == "node":
            nodes[el["id"]] = (el["lat"], el["lon"])
        elif el["type"] == "way":
            ways[el["id"]] = el.get("nodes", [])
    return nodes, ways


def build_node_index(ways):
    node_to_ways = defaultdict(set)
    for wid, node_ids in ways.items():
        for nid in set(node_ids):
            node_to_ways[nid].add(wid)
    return node_to_ways


def snap_station(name, lat, lon, ways, nodes, max_km=5.0):
    best_wid = None
    best_idx = 0
    best_dist = float("inf")
    for wid, node_ids in ways.items():
        for i, nid in enumerate(node_ids):
            if nid not in nodes:
                continue
            nl, no = nodes[nid]
            d = haversine_km(lat, lon, nl, no)
            if d < best_dist:
                best_dist = d
                best_wid = wid
                best_idx = i
    if best_dist > max_km:
        print(f"  WARNING: {name} is {best_dist:.1f}km from nearest track!")
        return None, 0
    print(f"  {name}: {best_dist*1000:.0f}m at way {best_wid} node idx {best_idx}")
    return best_wid, best_idx


def find_way_path(wid_a, wid_b, ways, node_to_ways):
    if wid_a == wid_b:
        return [wid_a]
    parent = {wid_a: None}
    q = deque([wid_a])
    visited = {wid_a}
    while q:
        wid = q.popleft()
        for nid in ways[wid]:
            for nb in node_to_ways.get(nid, set()):
                if nb in visited:
                    continue
                visited.add(nb)
                parent[nb] = wid
                if nb == wid_b:
                    path = [wid_b]
                    while path[-1] != wid_a:
                        path.append(parent[path[-1]])
                    return list(reversed(path))
                q.append(nb)
    return None


def shared_node_id(wid_a, wid_b, ways):
    set_a = set(ways[wid_a])
    set_b = set(ways[wid_b])
    shared = set_a & set_b
    if not shared:
        return None
    return next(iter(shared))


def node_idx_in_way(nid, wid, ways):
    node_ids = ways[wid]
    for i, n in enumerate(node_ids):
        if n == nid:
            return i
    return -1


def path_geometry(way_path, start_idx, end_idx, ways, nodes):
    if not way_path:
        return None
    result = []
    for i, wid in enumerate(way_path):
        node_ids = ways[wid]
        if i == 0 and len(way_path) == 1:
            rng = range(start_idx, end_idx + 1) if start_idx <= end_idx else range(start_idx, end_idx - 1, -1)
            for j in rng:
                if node_ids[j] in nodes:
                    result.append(nodes[node_ids[j]])
        elif i == 0:
            snid = shared_node_id(wid, way_path[1], ways)
            if snid is None:
                continue
            sidx = node_idx_in_way(snid, wid, ways)
            if sidx < 0:
                continue
            rng = range(start_idx, sidx + 1) if start_idx <= sidx else range(start_idx, sidx - 1, -1)
            for j in rng:
                if node_ids[j] in nodes:
                    result.append(nodes[node_ids[j]])
        elif i == len(way_path) - 1:
            pnid = shared_node_id(wid, way_path[i - 1], ways)
            if pnid is None:
                continue
            pidx = node_idx_in_way(pnid, wid, ways)
            if pidx < 0:
                continue
            rng = range(pidx, end_idx + 1) if pidx <= end_idx else range(pidx, end_idx - 1, -1)
            for j in rng:
                if node_ids[j] in nodes:
                    result.append(nodes[node_ids[j]])
        else:
            pnid = shared_node_id(wid, way_path[i - 1], ways)
            snid = shared_node_id(wid, way_path[i + 1], ways)
            if pnid is None or snid is None:
                continue
            pidx = node_idx_in_way(pnid, wid, ways)
            sidx = node_idx_in_way(snid, wid, ways)
            if pidx < 0 or sidx < 0:
                continue
            rng = range(pidx, sidx + 1) if pidx <= sidx else range(pidx, sidx - 1, -1)
            for j in rng:
                if node_ids[j] in nodes:
                    result.append(nodes[node_ids[j]])

    deduped = [result[0]] if result else []
    for pt in result[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)
    return deduped


config = load_config()
stations = config["stations"]
routes = config["routes"]

print("=" * 60)
print("INDIAN RAILWAYS ROUTE GEOMETRY FETCHER")
print("=" * 60)

bbox = get_bbox(stations, pad=0.15)
osm_data = fetch_osm(bbox)
nodes, ways = parse_osm(osm_data)
node_to_ways = build_node_index(ways)
print(f"Parsed: {len(nodes)} nodes, {len(ways)} ways")

station_access = {}
for sname, sdata in stations.items():
    wid, idx = snap_station(sname, sdata["lat"], sdata["lon"], ways, nodes)
    station_access[sname] = (wid, idx)

route_geometries = {}
for rname, snames in routes.items():
    print(f"\nRoute: {rname} ({' -> '.join(snames)})")
    full = []
    for i in range(len(snames) - 1):
        s1, s2 = snames[i], snames[i + 1]
        w1, i1 = station_access.get(s1, (None, 0))
        w2, i2 = station_access.get(s2, (None, 0))
        if w1 is None or w2 is None:
            print(f"  SKIP: {s1} or {s2} not found")
            continue
        wp = find_way_path(w1, w2, ways, node_to_ways)
        if not wp:
            print(f"  FAIL: no path from {s1} (way {w1}) to {s2} (way {w2})")
            continue
        seg = path_geometry(wp, i1, i2, ways, nodes)
        if seg:
            if full and seg[0] == full[-1]:
                full.extend(seg[1:])
            else:
                full.extend(seg)
            print(f"  Segment {s1}->{s2}: {len(wp)} ways, {len(seg)} coords")

    if full:
        route_geometries[rname] = full
        print(f"  Total: {len(full)} coords")
    else:
        route_geometries[rname] = None
        print(f"  FAILED: no geometry")

for rname, snames in routes.items():
    if route_geometries.get(rname):
        continue
    print(f"\nFALLBACK: straight-line for {rname}")
    geom = []
    for i in range(len(snames) - 1):
        s1, s2 = stations[snames[i]], stations[snames[i + 1]]
        dx = s2["lat"] - s1["lat"]
        dy = s2["lon"] - s1["lon"]
        n = max(10, int(math.hypot(dx * 111, dy * 111 * math.cos(
            math.radians((s1["lat"] + s2["lat"]) / 2))) / 0.3))
        for j in range(n + 1):
            t = j / n
            geom.append((s1["lat"] + t * dx, s1["lon"] + t * dy))
    route_geometries[rname] = geom

output = {
    "stations": {k: {"lat": v["lat"], "lon": v["lon"], "hindi": v.get("hindi", "")}
                 for k, v in stations.items()},
    "routes": routes,
    "route_geometries": {k: v for k, v in route_geometries.items() if v}
}

with open(OUTPUT_PATH, "w") as f:
    json.dump(output, f, indent=2)
print(f"\nSaved to {OUTPUT_PATH}")
for rn, g in route_geometries.items():
    print(f"  {rn}: {len(g) if g else 0} pts")
