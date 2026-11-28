# StreetView Studio v2.0 — Current System Architecture
**Author / Creator:** Md Sayeem Sheikh  
**AI Co-Architect:** Google Gemini  
**Current Version:** `v2.0.0` (Stable Release)

---

## 1. System Overview
**StreetView Studio** is an offline-first, portable desktop web application built with Python's standard library (`http.server`), `streetlevel`, and `Pannellum v2.5.6`. It archives historical Google Street View 360° equirectangular panoramas (`zoom=5`, ~13K resolution) along road paths and renders them in a zero-internet, browser-based virtual driving viewer.

## 2. Directory Structure & File Responsibilities
```text
StreetView_Studio_v2/               # Portable root folder (safe to rename/move anywhere)
├── Launch_Studio.bat               # Windows 1-click launcher (waits 2s, opens browser, runs server.py)
├── server.py                       # Local HTTP server, REST API & background panorama scraper
├── ARCHITECTURE.md                 # Current implemented system blueprint (this file)
├── ROADMAP.md                      # Future feature backlog & task checklist for Builder AI
├── README.md                       # Public GitHub documentation & setup guide
├── USER_GUIDE.md                   # End-user manual in Bengali
├── LICENSE                         # MIT License
├── studio/                         # Core Frontend Engine
│   ├── index.html                  # Dashboard UI (Creator, Scan Estimator, Extend Modal, Tour Library)
│   ├── style.css                   # Glassmorphism dark UI & dynamic background slideshow styles
│   ├── studio.js                   # Dashboard API client, progress poller, validated slideshow loader
│   ├── viewer.html                 # Standalone cinematic virtual tour viewer
│   ├── viewer.css                  # Viewer HUD, scrollable minimap, 5s Zen-mode, hidden load-box
│   ├── viewer.js                   # Compass-locked transitions, zoom motion, autopilot, driving keys
│   ├── pannellum.js                # Local offline Pannellum v2.5.6 engine
│   ├── pannellum.css               # Local offline Pannellum v2.5.6 stylesheet
│   ├── logo.png                    # Creator circular emblem (graceful fallback if missing)
│   └── backgrounds/                # Custom drop-in background images (any filename, auto-validated)
└── tours/                          # User road archives (ignored by Git via .gitignore)
    └── <Tour_Name>/                # Self-contained road tour directory
        ├── tour_data.json          # Ordered panorama sequence metadata
        └── pano_001.jpg ...        # Full-resolution equirectangular panoramas (~13-14 MB each)
```

## 3. Golden Rules (Backward Compatibility & Portability)
1. **`tour_data.json` Schema Lock:** Never break compatibility with existing `tour_data.json` files (`id`, `file`, `lat`, `lon`, `heading`, `links`). Any folder inside `tours/` from `v1.0` or `v2.0` must work seamlessly in future versions.
2. **Sequence by Array Order:** The viewer determines panorama playback order strictly by the array index in `tour_data.json`, NOT by filename (`pano_001.jpg`).
3. **Zero Hardcoded Paths:** All backend paths resolve relative to `os.path.abspath(__file__)` and relative HTTP routes (`/tours/...`, `/backgrounds/...`).

## 4. Environment & Critical Fixes (DO NOT REGRESS)
1. **Windows `streetlevel` Installation:** Standard `pip install streetlevel` fails on Windows due to C++ compiler requirements for `pyfrpc`. Always document/use:
   `$env:PYFRPC_NOEXT="1"; pip install streetlevel`
2. **Batch Startup Timing:** `Launch_Studio.bat` delays browser launch by 2 seconds (`timeout /t 2 /nobreak >nul`) so Python binds `127.0.0.1:8080` before the browser requests it.
3. **Suppressed Pannellum Loading Box:** `.pnlm-load-box { display: none !important; }` in `viewer.css` prevents black loading box flashes during transitions.
4. **Validated Background Slideshow:** `studio.js` encodes image URLs (`encodeURI`) and validates each image via `Image.onload` before adding to the rotation to prevent black screen frames on corrupt/unsupported formats.

## 5. Implemented Backend REST API (`server.py`)
- `GET /api/config` & `POST /api/config`: Reads or atomically saves `config.json`. Missing config is created at server startup with default tours path, slideshow interval, Zen timeout, and panorama zoom.
- `GET /api/tours`: Scans `tours/*` for valid `tour_data.json`, calculates total MB size, and returns start/end GPS coordinates.
- `GET /api/backgrounds`: Scans `studio/backgrounds/` for `.jpg/.jpeg/.png/.webp` files.
- `POST /api/scan`: Extracts `@lat,lon` from Start & End Google Maps URLs, traverses `pano.links` using weighted target+momentum bearing (`score = diff_target*0.6 + diff_momentum*0.4`), and returns panorama count + estimated disk size (`count * 13.5 MB`).
- `POST /api/download`: Downloads `zoom=5` panoramas in a daemon thread and flushes `tour_data.json` incrementally after each image.
- `GET /api/status`: Exposes live background worker progress (`active`, `current`, `total`, `message`).
- `POST /api/extend`: Appends panoramas forward from the last entry in `tour_data.json` using a numeric limit and an optional `end_link` for junction steering.
- `POST /api/trim`: Removes a `first` or `last` panorama entry and its on-disk image from a tour. `POST /api/trim-last` remains as a backward-compatible alias for trimming the last image. Both refuse to trim a tour with only one image and reject trimming while a background operation is active.
- **Dashboard Trim Flow:** The `Trim (-)` card action opens a start/end choice modal. Selecting an endpoint requires an explicit irreversible-deletion `confirm(...)` before the `/api/trim` request is sent.
- `POST /api/rename` & `POST /api/delete`: Renames or deletes tour folders inside `tours/`.

## 6. Implemented Viewer Engine (`studio/viewer.js`)
- **Compass-Locked Camera:** Preserves real-world compass bearing (`worldCompassBearing = (oldHeadingDeg + currentYaw) % 360`) across scene switches.
- **Pre-Jump Zoom Motion:** Narrows `hfov` (`currentHfov - 18` over `220ms`) before `loadScene()` on forward steps.
- **Autopilot & Controls:** `Up`/`W` (Forward), `Down`/`S` (Backward), `Left`/`A` (Yaw Left), `Right`/`D` (Yaw Right), `Space` (Autopilot at `4000ms`/`2500ms`/`1500ms`), `F` (Fullscreen).
- **5-Second Zen Mode:** Adds `.zen-mode` after 5000ms of user inactivity to hide all HUD overlays and cursor.
