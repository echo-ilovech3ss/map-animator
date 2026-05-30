# Map Animator v3.6 🗺️🚂🚗

A high-fidelity, premium offline travel infographic desktop application built with **Tauri v2 + React + HTML5 Canvas**. 

**Map Animator** snaps routes dynamically on a local GIS network and renders gorgeous high-definition 60fps animations of trains and cars traversing physical tracks, exporting directly as H.264 MP4 videos onto macOS.

---

## 🎨 Key Features

### 1. Cinematic Intro Transitions
* **Marker-First Radial Spin (Frames 0 to 30)**: The starting station marker spins and fills clockwise from the right (angle 0) at the very beginning of the animation, while the vehicle remains hidden.
* **Vehicle Appearance Phase (Frames 30 to 60)**: The starting marker is fully filled, and the vehicle appears (engine for train, or car) at the starting station dot while remaining stationary.
* **Journey Starts (Frame 60+)**: The vehicle begins moving along the track. For the train mode, each coach emerges one by one behind the engine normally as it moves, creating a premium narrative opening.

### 2. Configurable Station Halts
* **Halt Customization**: Added a sleek **Station Stop Duration** slider under the Settings panel, allowing you to configure stops from `0.0s` up to `2.0s` (in `0.1s` steps, defaulting to `0.5s`).
* **Halt Timing Mathematics**: Precomputes an exact frame-to-node mapping (`frameToNodeIdx`) at compilation. When the vehicle reaches any intermediate station, it remains stationary for exactly your configured halt duration.
* **Travel Preservation**: Halts are capped at 50% of total video duration so that the vehicle is guaranteed travel time even with numerous stops.

### 3. Pulsing Concentric Station Approach Ripples
* **Concentric Radar Ripple**: As the vehicle approaches any intermediate or final station (within `40 nodes` of the coordinates), a gorgeous expanding circular outline pulses outward from the station dot and fades.
* **Dynamic Wave Scaling**: Renders two overlapping expanding concentric waves that adapt to Y-axis coordinates and expand from the white rings, acting as a highly engaging "Approaching Station..." visual radar indicator.

### 4. Double-Layer Esri Satellite Mapping
* **Esri World Imagery**: Replaces the flat backdrops with high-resolution satellite tiles fetched directly from Esri.
* **Overlaid Reference Labels**: Overlays a transparent World Boundaries and Places map layer above the track routes, keeping place names (like the **Ganga River** and town centers) legible regardless of the underlying land imagery colors.

### 5. Articulated Train Physics (Slithering Locomotive)
* **5-Segment Articulated Train**: A sleek top-down aerodynamic bullet locomotive followed by **4 passenger coaches**.
* **Bending Couplings**: Powered by a custom **geodesic trailing path solver** (`getTrailingPoint`), all segments rotate independently and snake gracefully around track curves, bending realistically at couplings.
* **Gradual Emergence**: Coaches slide smoothly out of the starting station point one-by-one as the train head advances, mimicking a real train pulling out of a terminal instead of popping out of thin air.

### 6. Sizing Parity & Detail
* **Ferrari Red Sports Car**: For highway routes, draws a detailed sports car complete with headlights, windows, racing stripes, spoiler wings, and rubber tires.
* **Perfect Proportional Scale**: The sports car is scaled to match the visual weight and bounding dimensions of the train coaches perfectly.

### 7. Dynamic Timing-Compensation
* Implemented a self-correcting frame encoder timing loop. By tracking canvas render latency using `performance.now()`, the recorder dynamically trims `setTimeout` delays. 
* This ensures that exported MP4 videos match the target duration (e.g. 14s) exactly to the millisecond instead of being stretched by rendering overhead.

### 8. GIS Smart Label Cards
* Rather than drawing static labels that overlap vertical paths, the canvas engine calculates incoming/outgoing track angles and places station labels dynamically on the **outside of curves** with elegant dotted leader lines.

### 9. Full Offline Snapping Router
* Snaps stops to railways or highways completely offline using integrated JSON indexes of the Indian GIS network, defaulting to online Overpass API downloads if needed.

### 10. Persistent Local Storage
* Saves and restores active stops, timed settings, theme choices, custom stop labels, and default macOS export directories (`Downloads/` resolved natively) automatically across launches.

---

## 🚀 Commands

### Development Mode
Launch the live, hot-reloading development dashboard:
```bash
npm run dev
```

### Build & Package Standalone Application
Compile the frontend assets and Rust backend, generating standalone `.app` and `.dmg` bundles:
```bash
npm run tauri build
```
* **macOS Output Bundle:** `src-tauri/target/release/bundle/macos/MapAnimator.app`
* Copy the standalone app cleanly to `/Applications/MapAnimator.app` to run!

---

## 📁 Technical Architecture

* **Frontend**: React 18 + HTML5 Canvas (`src/App.jsx`, `src/utils/canvasRender.js`)
* **Styling**: Vanilla CSS with elegant glassmorphism, dynamic transitions, and responsive macOS-Sonoma aesthetics (`src/index.css`)
* **Backend**: Rust + Tauri v2 (`src-tauri/src/main.rs`, `src-tauri/capabilities/default.json` for filesystem ACL controls)
* **Database & Snapping Caches**: 
  - **Offline Snapping Caches**: The app includes fully pre-compiled JSON databases for the entire Indian railway and highway networks inside `public/data/` (so snapping operates 100% offline with zero external requests!).
  - **Raw Geofabrik Dataset**: The raw 1.6GB OpenStreetMap dataset for India (`india-latest.osm.pbf`) used to build these snapping caches is ignored from Git tracking for speed and safety.
  - **Download Link**: If you wish to rebuild the snapping databases from scratch, download the raw PBF file directly from the [Geofabrik India Download Page](https://download.geofabrik.de/asia/india.html) (or via [direct link](https://download.geofabrik.de/asia/india-latest.osm.pbf)) and save it in the root folder as `india-260529.osm.pbf`.

---

## 🐍 Legacy Python Pipelines (Optional CLI)

If you wish to use the console-based matplotlib generator scripts, they remain fully operational in the root folder:

1. **Setup dependencies**:
   ```bash
   pip3 install requests matplotlib cartopy Pillow numpy
   ```
2. **Fetch Track Geometry**:
   Configure `config.json` and download tracks:
   ```bash
   python3 fetch_tracks.py
   ```
3. **Compile Python Animation**:
   ```bash
   python3 animate.py
   ```

---

## 🛠️ Development Requirements

* **Node.js**: v18+
* **Rust**: v1.75+ (Cargo package manager)
* **macOS Target**: OS X 10.15+ (Compatible with both Intel and Apple Silicon chips)
