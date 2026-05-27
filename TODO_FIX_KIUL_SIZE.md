# TODO: Fix Kiul Label Size Mismatch

## Problem

The Hindi label for **किऊल** (Kiul) renders smaller than all other station labels. This happens because:

- **Other stations**: rendered natively by matplotlib with `ax.text()` + `bbox`
- **Kiul**: rendered as a PIL image overlay via `ax.imshow()` because matplotlib's FreeType shaper breaks कि+ऊ into कउिल

The PIL image extent is hardcoded to `[-0.055, +0.055]` lon and `[-0.005, +0.055]` lat, which doesn't match the actual rendered size of matplotlib's bbox labels.

## Root Cause

`animate.py` line ~175:
```python
extent = [sd["lon"] + dx - 0.055, sd["lon"] + dx + 0.055,
          sd["lat"] + dy - 0.005, sd["lat"] + dy + 0.055]
```

This fixed extent doesn't scale with the actual PIL image dimensions or match matplotlib's label sizing logic.

## How to Fix

### Option A: Dynamic extent based on PIL image size (recommended)

Replace the hardcoded extent with one derived from the PIL image pixel dimensions, mapped to data coordinates:

```python
# In the use_pil block, after render_hindi_label():
pil_img, pw, ph = result
img_arr = np.array(pil_img)

# Calculate scale: pixels → data coordinates
# Figure is FIG_W x FIG_H inches at DPI
# Data range is (LON_MAX - LON_MIN) x (LAT_MAX - LAT_MIN)
pixels_per_lon = (FIG_W * DPI) / (LON_MAX - LON_MIN)
pixels_per_lat = (FIG_H * DPI) / (LAT_MAX - LAT_MIN)

data_w = pw / pixels_per_lon
data_h = ph / pixels_per_lat

# Center on station position with offset
extent = [
    sd["lon"] + dx - data_w / 2,
    sd["lon"] + dx + data_w / 2,
    sd["lat"] + dy,
    sd["lat"] + dy + data_h
]
ax.imshow(img_arr, extent=extent, transform=TRANS, zorder=25, aspect="auto")
```

### Option B: Match matplotlib bbox size empirically

Measure a native matplotlib label's bbox in data coordinates, then use that as the target extent for PIL images:

```python
# Add this once during setup (outside the loop):
test_text = ax.text(0, 0, "Test", fontproperties=FontProperties(family="Kohinoor Devanagari", size=22),
                    bbox=dict(boxstyle="round,pad=0.35", facecolor="white"))
fig.canvas.draw()
bbox = test_text.get_window_extent().transformed(ax.transData.inverted())
NATIVE_LABEL_W = bbox.x1 - bbox.x0  # in data coords
NATIVE_LABEL_H = bbox.y1 - bbox.y0
test_text.remove()

# Then in the use_pil block:
extent = [
    sd["lon"] + dx - NATIVE_LABEL_W / 2,
    sd["lon"] + dx + NATIVE_LABEL_W / 2,
    sd["lat"] + dy,
    sd["lat"] + dy + NATIVE_LABEL_H
]
```

### Option C: Use `matplotlib.offsetbox.AnnotationBbox` instead of `imshow`

This handles sizing automatically but was tricky with cartopy transforms. Worth revisiting:

```python
from matplotlib.offsetbox import OffsetImage, AnnotationBbox

img_arr = np.array(pil_img)
imagebox = OffsetImage(img_arr, zoom=1.0)
ab = AnnotationBbox(
    imagebox,
    (sd["lon"] + dx, sd["lat"] + dy),
    xycoords=TRANS,
    boxcoords="offset points",
    frameon=False,
    pad=0,
    zorder=25
)
ax.add_artist(ab)
```

## Files to Edit

- `animate.py` — the `use_pil` block inside the station label loop (~line 165-180)

## Testing

After fixing, render both languages and verify all labels are visually consistent:

```bash
# Hindi
python3 -c "import json; c=json.load(open('config.json')); c['animation']['label_language']='hindi'; json.dump(c, open('config.json','w'), indent=2)"
python3 animate.py

# English
python3 -c "import json; c=json.load(open('config.json')); c['animation']['label_language']='english'; json.dump(c, open('config.json','w'), indent=2)"
python3 animate.py
```

Check the output frame at ~10 seconds into the video — all labels should be roughly the same visual size.
