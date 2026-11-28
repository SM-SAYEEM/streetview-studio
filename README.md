# StreetView Studio v2.0

An offline-first, portable desktop web studio for archiving historical Google Street View 360° equirectangular panoramas along any road path at maximum original resolution (`zoom=5`) and exploring them in a cinematic, browser-based virtual driving viewer.

**Created by:** Md Sayeem Sheikh  
**AI Co-Architect:** Google Gemini

---

## Story & Motivation
Google Street View imagery can change, get blurred, or disappear over time when roads are reconstructed or privacy requests are processed. Having a deep attachment to rural life and wanting to preserve the earliest 2022 Street View memories of my village roads without expensive cameras or paid software, I built **StreetView Studio** in collaboration with **Google Gemini**.

It turns any road stretch into a permanent, offline virtual road trip—complete with autopilot driving, compass-locked camera transitions, and a clean screenshot mode.

---

## Quick Download & Setup (For Non-Coders)

You do **not** need to know programming or Git to use this tool:

1. **Download:** Go to the [**Releases**](../../releases) section on the right side of this page and download **`Source code (zip)`** from the latest release (or click **Code -> Download ZIP** above), then extract it anywhere on your PC.
2. **Install Python:** Download and install **Python 3.8+** on your computer *(make sure to check **"Add python.exe to PATH"** during installation)*.
3. **Install Required Library:** Open your terminal / PowerShell and run:
   ```powershell
   $env:PYFRPC_NOEXT="1"; pip install streetlevel
   ```
4. **Launch the Studio:**
   - **Windows:** Double-click **`Launch_Studio.bat`**. Your browser will automatically open `http://localhost:8080`.
   - **Linux / macOS / Android (Termux):** Run `python server.py` in your terminal and open `http://localhost:8080` in your browser.

---

## Need Help Setting Up? Copy & Paste This Prompt into Any AI!

If you are unsure how to set this up on your specific device (Windows, Mac, Linux, or Android Termux), copy the prompt below and paste it into **Gemini, ChatGPT, or Claude**:

> *"I want to set up and run the open-source project **StreetView Studio** (`github.com/SM-SAYEEM/streetview-studio`) on my device. My operating system is **[Write Windows / Mac / Linux / Android Termux here]**, and I currently have **[mention if Python is installed or not]**. Please read the repository structure and `ARCHITECTURE.md` / `README.md` guidelines (especially the Windows `PYFRPC_NOEXT="1"` flag for `streetlevel`) and guide me step-by-step in simple language on how to download, install, and run it."*

---

## Key Features

### 1. Path Scanner & Storage Estimator
- Paste the **Start** and **End** Google Maps Street View URLs to automatically trace the road graph (`pano.links`), calculate the total number of panoramas, and estimate disk space (`~13.5 MB` per 13K panorama) before downloading.
- Download the entire route or set a custom image count limit.

### 2. Smart Tour Manager & Junction-Aware Extend
- **Organized Library:** Keep multiple road segments in isolated folders with instant **Rename**, **Delete**, and **View End Point on Map** links.
- **Smart Extend (+):** Resume and append more panoramas from the end of any saved route—with an optional **Target End Link** to guide turns at 3-way junctions.

### 3. Cinematic Virtual Driving Viewer
- **Compass-Locked Camera:** Preserves your real-world compass direction across panorama jumps so looking left, right, or straight ahead feels seamless.
- **Smooth Forward Zoom Transition:** Simulates forward road motion during step transitions.
- **Autopilot (Cruise Mode):** Hands-free playback with adjustable speeds (`Slow 4s`, `Normal 2.5s`, `Fast 1.5s`) while allowing live steering.
- **5-Second Zen Mode:** Automatically fades out all HUD controls and cursor after 5 seconds of inactivity for an unobstructed, video-like view and clean screenshots.
- **Scrollable Step Minimap:** Notion-style vertical tick bar on the right edge for instant random-access jumps across long routes.

### 4. Dynamic Glassmorphism Dashboard
- Drop any custom landscape images into `studio/backgrounds/` (no renaming needed) for a smooth background slideshow, with automatic fallback to your archived tour panoramas.

---

## Keyboard Shortcuts (Viewer)

| Key | Action |
| :--- | :--- |
| `W` / `PageUp` | Move forward along the road |
| `S` / `PageDown` | Move backward along the road |
| `A` / `D` or `Left Arrow` / `Right Arrow` | Steer camera view left / right |
| `Up Arrow` / `Down Arrow` | Tilt camera view up / down |
| `Home` / `End` | Jump to the first / last panorama |
| `Spacebar` | Play / Pause Autopilot mode |
| `F` | Toggle Fullscreen |

---

## Project Architecture & AI Handoff
For developers or AI assistants looking to extend this project to **v3.0**, please refer to [`ARCHITECTURE.md`](ARCHITECTURE.md) for the complete technical blueprint, REST API specifications, and known platform workarounds.

---

## Credits & License
- **Conceived, Designed & Built by:** **Md Sayeem Sheikh**
- **AI Development Partner:** **Google Gemini** (architecture design, backend engine, and iterative debugging)
- **Powered by:** Python Standard Library, [`streetlevel`](https://github.com), and [`Pannellum`](https://pannellum.org)
- Licensed under the **MIT License** — free to use, modify, and share.
