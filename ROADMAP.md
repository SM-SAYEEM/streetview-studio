# StreetView Studio — Feature Roadmap & Builder AI Task Queue

> **Instructions for AI Coding Agents (Copilot / Cline):**
> 1. Implement **only one task at a time** when requested by the user.
> 2. Follow all Golden Rules in `ARCHITECTURE.md` (especially preserving `tour_data.json` backward compatibility).
> 3. After completing a task, mark its checkbox `[x]` in this file (`ROADMAP.md`) and document the new code/API changes in `ARCHITECTURE.md`.

---

## Milestone 1: `v2.1.0` — Smart Settings, Controls & Path Editing

- [x] **Task 1.1: External Settings & Custom Storage Path (`config.json`)**
  - Create a `config.json` file (auto-generated with defaults if missing) and add a **Settings (⚙️)** modal in `studio/index.html` & `studio/studio.js`.
  - Configurable options:
    1. `tours_directory`: Custom path where road tours are stored (default: `"./tours"`). Updating this lets users store gigabytes of panoramas on any external drive while keeping the app engine lightweight.
    2. `bg_slide_interval_ms`: Dashboard background slideshow interval (default: `8000`).
    3. `zen_mode_timeout_ms`: Viewer auto-hide HUD delay (default: `5000`).
    4. `default_zoom_level`: Panorama download quality (`5` = Ultra 13K, `4` = High ~6K, `3` = Medium ~3K).

- [x] **Task 1.2: One-Click "Remove Last Image" (`POST /api/trim-last`)**
  - Add a **"Trim Last (-1)"** button on each tour card in the dashboard (`studio/index.html`, `studio/studio.js`) and a `/api/trim-last` endpoint in `server.py`.
  - Safely deletes the final panorama file on disk and pops the last entry from `tour_data.json` (preventing deletion if only 1 image remains).

- [x] **Task 1.2b: Bidirectional Trim with Safety Confirmation (`Trim (-)` from Start or End)**
  - Upgrade the `Trim Last (-1)` button into a **`Trim (-)`** button on each tour card (`studio/index.html`, `studio/studio.js`) and update the backend endpoint (`POST /api/trim` accepting `{"name": "...", "side": "first" | "last"}`) in `server.py`.
  - Clicking **`Trim (-)`** opens a choice modal/dialog to select either **First Point (Start)** or **Last Point (End)**.
  - **Mandatory Safety Confirmation:** Selecting either option must trigger an explicit confirmation prompt (`confirm(...)`) warning that the specific image will be permanently deleted from disk and cannot be undone before sending the API request. Keep at least 1 image intact.

- [ ] **Task 1.3: Prepend / Extend Backward from Start Point (`POST /api/prepend`)**
  - Enhance the **Extend** modal to allow choosing direction: **Forward (from End)** or **Backward (from Start)** with an optional target link.
  - Because `viewer.js` reads sequence order from `tour_data.json` array index rather than filename, new backward images can be saved as `pano_051.jpg...` and inserted at the **beginning** (`index 0`) of `tour_data.json` (reversed in travel order) without renaming existing files.

- [ ] **Task 1.4: Ergonomic Two-Handed Driving Keyboard Layout (`studio/viewer.js`)**
  - Update keyboard bindings in `viewer.js`:
    - `W` / `PageUp`: Move forward (`goToStep(currentIndex + 1)`).
    - `S` / `PageDown`: Move backward (`goToStep(currentIndex - 1)`).
    - `A` / `D`: Steer camera yaw left/right.
    - `ArrowUp` / `ArrowDown`: Tilt camera pitch up/down (`viewer.setPitch(...)`) to view sky/trees or road surface.
    - `ArrowLeft` / `ArrowRight`: Steer camera yaw left/right.
    - `Home` / `End`: Jump immediately to the first (`0`) or last (`length - 1`) panorama in the route.
    - `Spacebar`: Toggle Autopilot Play/Pause.
    - `F`: Toggle Fullscreen.

---

## Milestone 2: `v3.0.0` — Cinematic Video-Flow, Live Mini-Map & Standalone `.exe`

- [ ] **Task 2.1: Background Image Preloader Cache (`+3` Ahead, `-1` Behind)**
  - In `studio/viewer.js`, whenever `currentIndex` changes, asynchronously preload `currentIndex + 1`, `currentIndex + 2`, `currentIndex + 3`, and `currentIndex - 1` into memory using `new Image()` so panorama switches feel instantaneous even on older hardware.

- [ ] **Task 2.2: Continuous Zoom-Through Autopilot Motion**
  - Upgrade Autopilot in `studio/viewer.js` so that instead of waiting statically before jumping, the camera smoothly and continuously zooms forward (`hfov` animating from `100` down to `74` over the step duration via `requestAnimationFrame`), seamlessly cross-fading into the next panorama (compass-locked) at `hfov = 96` and continuing the zoom—creating a continuous video-like road trip feel.

- [ ] **Task 2.3: Live Interactive Route Mini-Map (`studio/viewer.html`, `viewer.js`)**
  - Add a compact, collapsible mini-map overlay in the bottom-left corner of the viewer (auto-hidden during 5s Zen Mode).
  - Plot the full road polyline using `lat, lon` from `tour_data.json` (using offline canvas rendering or Leaflet.js with online map tiles when available), highlight the current position marker live, and allow clicking any point on the route line to jump directly to that panorama.

- [ ] **Task 2.4: Ambient Village Soundscape Toggle**
  - Add an optional ambient nature/village audio toggle button in the viewer HUD (gracefully disabled if no `.mp3`/`.ogg` audio file is placed in `studio/audio/`).

- [ ] **Task 2.5: Standalone Windows `.exe` Packaging (`PyInstaller`)**
  - Create a `build_exe.bat` script using `PyInstaller` to bundle `server.py` and `studio/` into a single portable `StreetViewStudio.exe` that auto-opens the browser on launch without requiring Python to be installed on target Windows PCs.
