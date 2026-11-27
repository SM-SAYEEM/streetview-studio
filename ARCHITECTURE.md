# StreetView Studio v2.0 — Complete System Architecture & AI Handoff Guide
**Author / Creator:** Md Sayeem Sheikh
**Architecture Type:** Portable, Zero-External-Framework Local Web Application (Python Stdlib + `streetlevel` + Pannellum v2.5.6)

## 1. Complete Directory Structure
```text
StreetView_Studio_v2/               # Portable root folder (safe to move/rename anywhere)
├── Launch_Studio.bat               # Windows 1-click launcher (waits 2s, opens browser, runs server.py)
├── server.py                       # Local HTTP server, REST API & background panorama scraper
├── ARCHITECTURE.md                 # AI-to-AI technical specification (this file)
├── USER_GUIDE.md                   # End-user manual in Bengali
├── studio/                         # Core Frontend Engine
│   ├── index.html                  # Dashboard UI (Creator, Scan Estimator, Extend Modal, Tour Library)
│   ├── style.css                   # Glassmorphism dark UI & dynamic background layer styles
│   ├── studio.js                   # Dashboard API client, progress poller, dynamic slideshow controller
│   ├── viewer.html                 # Standalone cinematic virtual tour viewer
│   ├── viewer.css                  # HUD styles, scrollable minimap, 5s Zen-mode, hidden load-box
│   ├── viewer.js                   # Compass-locked transitions, zoom motion, autopilot, driving keys
│   ├── pannellum.js                # Local offline Pannellum v2.5.6 engine
│   ├── pannellum.css               # Local offline Pannellum v2.5.6 stylesheet
│   ├── logo.png                    # Creator circular emblem/logo (optional; graceful fallback)
│   └── backgrounds/                # Drop any custom background images here (auto-detected)
└── tours/                          # User road archives (auto-created if missing)
    └── <Tour_Name>/                # Self-contained road tour directory
        ├── tour_data.json          # Ordered panorama graph metadata
        └── pano_001.jpg ...        # Full-resolution 13K equirectangular panoramas (~13-14 MB each)
```

## 2. Core Engine vs. User Data
- **Core Engine (Lightweight Backup):** `Launch_Studio.bat`, `server.py`, and `studio/` (~500 KB excluding custom backgrounds). Even if `tours/` is deleted, `server.py` auto-creates an empty `tours/` folder on boot.
- **No Hardcoded Paths:** All file paths resolve relative to `os.path.abspath(__file__)` and relative HTTP routes (`/tours/...`, `/backgrounds/...`), making the entire folder 100% portable across drives and machines.

## 3. Environment & Critical Fixes (DO NOT REPEAT TRIAL-AND-ERROR)
1. **Windows `streetlevel` Installation:** Standard `pip install streetlevel` fails on Windows due to C++ compiler requirements for `pyfrpc`. Always install via:
   `$env:PYFRPC_NOEXT="1"; pip install streetlevel`
2. **Batch Startup Race Condition:** `Launch_Studio.bat` delays browser launch by 2 seconds (`timeout /t 2 /nobreak >nul`) so Python binds `127.0.0.1:8080` before the browser requests it.
3. **Suppressed Pannellum Loading Box:** `.pnlm-load-box { display: none !important; }` in `viewer.css` removes the jarring black loading box during rapid keyboard/autopilot transitions.

## 4. Backend REST API (`server.py`)
- `GET /api/tours`: Lists valid tour folders containing `tour_data.json` with image count, total MB size, and start/end GPS coordinates.
- `GET /api/backgrounds`: Scans `studio/backgrounds/` for `.jpg/.jpeg/.png/.webp` files (any filename) for the dashboard slideshow.
- `POST /api/scan`: Parses `@lat,lon` from Start & End Google Maps URLs, traverses `pano.links` using weighted target+momentum bearing (`score = diff_target*0.6 + diff_momentum*0.4`), and estimates count + disk size (`count * 13.5 MB`).
- `POST /api/download`: Downloads `zoom=5` equirectangular panoramas in a daemon thread and flushes `tour_data.json` incrementally after every image.
- `GET /api/status`: Exposes live background worker progress (`active`, `current`, `total`, `message`).
- `POST /api/extend`: Appends panoramas starting from the last entry in `tour_data.json`. Supports both a numeric count limit and an optional `end_link` to navigate junctions and stop within `15m` of the target.
- `POST /api/rename` & `POST /api/delete`: Renames or removes tour folders inside `tours/`.

## 5. Viewer Engine (`studio/viewer.js`)
- **Compass-Locked Camera:** Maintains real-world compass bearing across panorama jumps (`worldCompassBearing = (oldHeadingDeg + currentYaw) % 360`).
- **Pre-Jump Zoom Animation:** Smoothly narrows `hfov` (`currentHfov - 18` over `220ms`) before `loadScene()` on forward steps.
- **Autopilot & Driving Controls:** `Up`/`W` (Forward), `Down`/`S` (Backward), `Left`/`A` (Yaw Left), `Right`/`D` (Yaw Right), `Space` (Autopilot Play/Pause at 4s/2.5s/1.5s), `F` (Fullscreen).
- **5-Second Zen Mode:** Fades out all HUD elements and cursor after 5000ms of inactivity for unobstructed viewing and clean screenshots.
