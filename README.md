# StreetView Studio v2.0

An offline-first, portable desktop web application for archiving historical Google Street View 360° equirectangular panoramas along any road path at maximum original resolution (`zoom=5`) and experiencing them in a cinematic, browser-based virtual driving viewer.

**Crafted by:** Md Sayeem Sheikh

---

## Why I Built This
Google Street View imagery can change, get blurred, or disappear over time when roads are updated or privacy requests are processed. I built **StreetView Studio** to preserve historical views of my village roads in full resolution so they can be explored offline anytime—like a virtual road trip—without needing any external paid software or API keys.

---

## Key Features

### 1. Path Scanner & Disk Estimator
- Paste the **Start** and **End** Google Maps Street View URLs to automatically trace the road graph (`pano.links`), count total available panoramas, and estimate required storage space before downloading.
- Choose a custom download limit or archive the entire route at original 13K equirectangular resolution (`zoom=5`).

### 2. Smart Tour Library & Junction-Aware Extend
- **Manage Multiple Routes:** Organize different road segments in isolated folders with instant **Rename**, **Delete**, and **End-Point Map Pin** lookup.
- **Smart Extend (+):** Seamlessly append more panoramas from the end of an existing route—with an optional target end link to guide turns at 3-way junctions.

### 3. Cinematic Virtual Driving Viewer
- **Compass-Locked Camera:** Maintains your real-world compass direction across panorama transitions so looking left, right, or straight ahead feels continuous.
- **Smooth Zoom-In Motion:** Simulates forward movement along the road during step transitions.
- **Autopilot (Cruise Mode):** Hands-free playback with adjustable speeds (`Slow 4s`, `Normal 2.5s`, `Fast 1.5s`) while allowing live steering.
- **5-Second Zen Mode:** Automatically fades out all HUD controls and cursor after 5 seconds of inactivity for an unobstructed, video-like experience and clean screenshots.
- **Scrollable Step Minimap:** Notion-style vertical tick bar on the right edge for instant random-access jumps across long routes.

### 4. Dynamic Glassmorphism Dashboard
- Supports custom drop-in background slideshows (`studio/backgrounds/`) with automatic fallback to archived tour panoramas.

---

## Keyboard Shortcuts (Viewer)

| Key | Action |
| :--- | :--- |
| `Up Arrow` / `W` | Move forward along the road |
| `Down Arrow` / `S` | Move backward |
| `Left Arrow` / `A` | Steer camera view left |
| `Right Arrow` / `D` | Steer camera view right |
| `Spacebar` | Play / Pause Autopilot mode |
| `F` | Toggle Fullscreen |

---

## Installation & Quick Start

### Prerequisites
- **Python 3.8+** (Ensure **"Add python.exe to PATH"** is checked during installation)
- **`streetlevel`** library

### Setup (Windows PowerShell)
Install the required library (using `PYFRPC_NOEXT="1"` to skip unnecessary C++ build tools on Windows):
```powershell
$env:PYFRPC_NOEXT="1"; pip install streetlevel
```

### Running the Application
- **Windows:** Double-click `Launch_Studio.bat` (starts the local server and opens `http://localhost:8080` automatically).
- **Linux / macOS / Android (Termux):**
  ```bash
  python server.py
  ```
  Then open `http://localhost:8080` in your browser.

---

## Folder Structure
```text
StreetView_Studio_v2/
├── Launch_Studio.bat       # Windows 1-click launcher
├── server.py               # Python HTTP server, REST API & background scraper
├── ARCHITECTURE.md         # Technical architecture & AI handoff blueprint
├── USER_GUIDE.md           # User manual (Bengali)
├── studio/                 # Frontend dashboard & offline Pannellum viewer
│   └── backgrounds/        # Drop custom background images here
└── tours/                  # Downloaded panorama archives (ignored by Git)
```

---

## License & Credits
- Built using Python standard library, [`streetlevel`](https://github.com), and [`Pannellum`](https://pannellum.org).
- Designed and developed by **Md Sayeem Sheikh**.
