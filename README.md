# Map Animator v2.0 🗺️🚂🚗

A high-fidelity, premium offline travel infographic desktop application built with **Tauri v2 + React + HTML5 Canvas**. 

**Map Animator** snaps routes dynamically on a local GIS network and renders gorgeous high-definition 60fps animations of trains and cars traversing physical tracks, exporting directly as H.264 MP4 videos onto macOS.

---

## 🎨 Key Features

### 1. Articulated Train Physics (Slithering Locomotive)
* **5-Segment Articulated Train**: A sleek top-down aerodynamic bullet locomotive followed by **4 passenger coaches**.
* **Bending Couplings**: Powered by a custom **geodesic trailing path solver** (`getTrailingPoint`), all segments rotate independently and snake gracefully around track curves, bending realistically at couplings.
* **Gradual Emergence**: Coaches slide smoothly out of the starting station point one-by-one as the train head advances, mimicking a real train pulling out of a terminal instead of popping out of thin air.

### 2. Sizing Parity & Detail
* **Ferrari Red Sports Car**: For highway routes, draws a detailed sports car complete with headlights, windows, racing stripes, spoiler wings, and rubber tires.
* **Perfect Proportional Scale**: The sports car is scaled to match the visual weight and bounding dimensions of the train coaches perfectly.

### 3. Dynamic Timing-Compensation
* Implemented a self-correcting frame encoder timing loop. By tracking canvas render latency using `performance.now()`, the recorder dynamically trims `setTimeout` delays. 
* This ensures that exported MP4 videos match the target duration (e.g. 14s) exactly to the millisecond instead of being stretched by rendering overhead.

### 4. GIS Smart Label Cards
* Rather than drawing static labels that overlap vertical paths, the canvas engine calculates incoming/outgoing track angles and places station labels dynamically on the **outside of curves** with elegant dotted leader lines.

### 5. Full Offline Snapping Router
* Snaps stops to railways or highways completely offline using integrated JSON indexes of the Indian GIS network, defaulting to online Overpass API downloads if needed.

### 6. Persistent Local Storage
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
* **Database**: Local railway and highway JSON coordinates (`public/data/`)

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
