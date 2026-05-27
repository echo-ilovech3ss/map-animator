import json, math, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import matplotlib.offsetbox as offsetbox
from matplotlib.font_manager import FontProperties
from PIL import Image, ImageDraw, ImageFont
import numpy as np

with open("config.json") as f:
    config = json.load(f)
with open("data/route_geometry.json") as f:
    gdata = json.load(f)

stations = gdata["stations"]
route_geometries = gdata["route_geometries"]
route_names = list(route_geometries.keys())

DURATION = config["animation"]["duration_seconds"]
FPS = config["animation"]["fps"]
OUTPUT = config["animation"]["output_file"]
TOTAL_FRAMES = DURATION * FPS
LABEL_LANG = config["animation"].get("label_language", "english")

MAIN_ROUTE = route_names[0]
BRANCH_ROUTES = route_names[1:]
MAIN_FRAC = 0.60
BRANCH_FRAC = 0.40

FIG_W, FIG_H = 19.2, 10.8
DPI = 150

lats = [s["lat"] for s in stations.values()]
lons = [s["lon"] for s in stations.values()]
PAD_TOP = 0.22
PAD_BOT = 0.18
PAD_SIDE = 0.05
LAT0 = (min(lats) + max(lats)) / 2
lat_rng = max(lats) - min(lats)
lon_rng = max(lons) - min(lons)
km_lon = 111.0 * math.cos(math.radians(LAT0))
km_lat = 111.0
data_ratio = (lon_rng * km_lon) / (lat_rng * km_lat)
target_ratio = 16.0 / 9.0
if target_ratio > data_ratio:
    need_lon = lon_rng * (target_ratio / data_ratio)
    cx = (min(lons) + max(lons)) / 2
    LON_MIN = cx - need_lon / 2 - PAD_SIDE
    LON_MAX = cx + need_lon / 2 + PAD_SIDE
    LAT_MIN = min(lats) - PAD_BOT
    LAT_MAX = max(lats) + PAD_TOP
else:
    need_lat = lat_rng * (data_ratio / target_ratio)
    cy = (min(lats) + max(lats)) / 2
    LAT_MIN = cy - need_lat / 2 - PAD_BOT
    LAT_MAX = cy + need_lat / 2 + PAD_TOP
    LON_MIN = min(lons) - PAD_SIDE
    LON_MAX = max(lons) + PAD_SIDE

EN_FONT = FontProperties(family="Helvetica Neue", size=20, weight="bold")

fig = plt.figure(figsize=(FIG_W, FIG_H), dpi=DPI)
ax = fig.add_subplot(111)

try:
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature
    fig.delaxes(ax)
    ax = fig.add_subplot(111, projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.LAND, facecolor="#e8e4d8", edgecolor="none")
    ax.add_feature(cfeature.OCEAN, facecolor="#c8dce8", edgecolor="none")
    ax.add_feature(cfeature.COASTLINE, linewidth=0.5, edgecolor="#888888")
    ax.add_feature(cfeature.BORDERS, linewidth=0.35, edgecolor="#999999", alpha=0.5)
    ax.add_feature(cfeature.LAKES, facecolor="#c8dce8", edgecolor="#aaaaaa", linewidth=0.2, alpha=0.7)
    ax.add_feature(cfeature.RIVERS, linewidth=0.35, edgecolor="#7090a0", alpha=0.5)
    TRANS = ccrs.PlateCarree()
    HAS_CARTOPY = True
except ImportError:
    TRANS = ax.transData
    ax.set_facecolor("#c8dce8")
    ax.set_xlim(LON_MIN, LON_MAX)
    ax.set_ylim(LAT_MIN, LAT_MAX)
    HAS_CARTOPY = False

plt.subplots_adjust(left=0, right=1, bottom=0, top=1)
ax.set_aspect(1.0 / math.cos(math.radians(LAT0)))
for sp in ax.spines.values():
    sp.set_visible(False)
ax.tick_params(left=False, labelleft=False, bottom=False, labelbottom=False)


def plot_route(g, c, lw, a, z=1):
    ax.plot([p[1] for p in g], [p[0] for p in g],
            color=c, linewidth=lw, alpha=a, transform=TRANS, zorder=z,
            solid_capstyle="round")

for rname in route_names:
    plot_route(route_geometries[rname], "#555555", 3.5, 0.15, 1)


def get_label_text(sname, sd):
    if LABEL_LANG == "hindi" and sd.get("hindi"):
        return sd["hindi"]
    return sname


def render_hindi_label(text, fontsize=38):
    """Render Hindi text as PIL image for stations that matplotlib can't shape correctly."""
    font_paths = [
        "/System/Library/Fonts/Kohinoor.ttc",
        "/System/Library/Fonts/Supplemental/Shree714.ttc",
        "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
    ]
    font = None
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, fontsize, index=0)
                break
            except:
                pass
    if font is None:
        return None

    tmp_img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    tmp_draw = ImageDraw.Draw(tmp_img)
    bbox = tmp_draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    pad_x, pad_y = 14, 8
    w = text_w + pad_x * 2
    h = text_h + pad_y * 2

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=12,
                           fill=(255, 255, 255, 235), outline="#cccccc", width=1)
    draw.text((pad_x, pad_y - 2), text, fill="#111111", font=font)
    return img, w, h


# Stations whose Hindi names matplotlib shapes incorrectly
BROKEN_HINDI = {"Kiul"}


label_offsets = {
    "Dhanbad":       (-0.015, 0.08),
    "Pradhankhunta": (0.04, -0.16),
    "Asansol":       (0.03, 0.07),
    "Jhajha":        (0, 0.10),
    "Kiul":          (0.02, 0.07),
    "Barauni":       (0.04, 0.10),
    "Barh":          (-0.04, 0.10),
}

for sname, sd in stations.items():
    ax.plot(sd["lon"], sd["lat"], "o", color="#1a1a3a", markersize=18,
            markeredgecolor="white", markeredgewidth=3, transform=TRANS, zorder=20)

    label_text = get_label_text(sname, sd)
    dx, dy = label_offsets.get(sname, (0, 0.085))

    use_pil = LABEL_LANG == "hindi" and sd.get("hindi") and sname in BROKEN_HINDI

    if use_pil:
        result = render_hindi_label(sd["hindi"])
        if result is not None:
            pil_img, pw, ph = result
            img_arr = np.array(pil_img)
            # Match native matplotlib label size (~0.08 lon x 0.05 lat)
            extent = [sd["lon"] + dx - 0.055, sd["lon"] + dx + 0.055,
                      sd["lat"] + dy - 0.005, sd["lat"] + dy + 0.055]
            ax.imshow(img_arr, extent=extent, transform=TRANS, zorder=25, aspect="auto")
    else:
        ax.text(sd["lon"] + dx, sd["lat"] + dy, label_text,
                fontproperties=EN_FONT if LABEL_LANG != "hindi" else FontProperties(family="Kohinoor Devanagari", size=22),
                ha="center", va="bottom", color="#111111",
                transform=TRANS, zorder=20,
                bbox=dict(boxstyle="round,pad=0.35", facecolor="white",
                          edgecolor="#cccccc", linewidth=1, alpha=0.9))

route_lines = {}
route_glows = {}
for rname in route_names:
    line = ax.plot([], [], color="#e06020", linewidth=5, alpha=1.0,
                   transform=TRANS, zorder=15, solid_capstyle="butt")[0]
    glow = ax.plot([], [], color="#ffbb44", linewidth=12, alpha=0.25,
                   transform=TRANS, zorder=14, solid_capstyle="butt")[0]
    route_lines[rname] = line
    route_glows[rname] = glow


def animate(frame):
    t = frame / TOTAL_FRAMES
    t = min(t, 1.0)

    if t <= MAIN_FRAC:
        pt = t / MAIN_FRAC
        bf = 0.0
        show_branches = False
    else:
        pt = 1.0
        raw = (t - MAIN_FRAC) / BRANCH_FRAC
        bf = 0.06 + 0.94 * raw
        show_branches = True

    main_geom = route_geometries[MAIN_ROUTE]
    n_m = len(main_geom)
    me = max(1, int(pt * (n_m - 1)))
    route_lines[MAIN_ROUTE].set_data([p[1] for p in main_geom[:me + 1]],
                                      [p[0] for p in main_geom[:me + 1]])
    route_glows[MAIN_ROUTE].set_data([p[1] for p in main_geom[:me + 1]],
                                      [p[0] for p in main_geom[:me + 1]])

    if show_branches:
        for rname in BRANCH_ROUTES:
            geom = route_geometries[rname]
            n = len(geom)
            end = max(2, int(bf * (n - 1)))
            route_lines[rname].set_data([p[1] for p in geom[:end]],
                                         [p[0] for p in geom[:end]])
            route_glows[rname].set_data([p[1] for p in geom[:end]],
                                         [p[0] for p in geom[:end]])
    else:
        for rname in BRANCH_ROUTES:
            route_lines[rname].set_data([], [])
            route_glows[rname].set_data([], [])

    return list(route_lines.values()) + list(route_glows.values())


print(f"Generating {TOTAL_FRAMES}f ({DURATION}s @ {FPS}fps)...")
ani = animation.FuncAnimation(fig, animate, frames=TOTAL_FRAMES,
                              interval=1000 / FPS, blit=True)
print(f"Rendering {OUTPUT}...")
writer = animation.FFMpegWriter(fps=FPS, bitrate=10000, codec="libx264",
                                extra_args=["-profile:v", "high",
                                            "-pix_fmt", "yuv420p",
                                            "-preset", "medium"])
ani.save(OUTPUT, writer=writer, dpi=DPI)
print("Done!")
