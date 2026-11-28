import os
import re
import json
import math
import shutil
import threading
import tkinter as tk
from tkinter import filedialog
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from streetlevel import streetview

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STUDIO_DIR = os.path.join(BASE_DIR, "studio")
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "tours_directory": "./tours",
    "bg_slide_interval_ms": 8000,
    "zen_mode_timeout_ms": 5000,
    "default_zoom_level": 5
}

def resolve_tours_directory(path_value):
    path_value = str(path_value).strip() or DEFAULT_CONFIG["tours_directory"]
    return path_value if os.path.isabs(path_value) else os.path.abspath(os.path.join(BASE_DIR, path_value))

def load_config():
    config = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
            if isinstance(stored, dict):
                for key in DEFAULT_CONFIG:
                    if key in stored:
                        config[key] = stored[key]
        except (json.JSONDecodeError, OSError):
            pass
    else:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)

    try:
        config["bg_slide_interval_ms"] = max(1000, int(config["bg_slide_interval_ms"]))
    except (TypeError, ValueError):
        config["bg_slide_interval_ms"] = DEFAULT_CONFIG["bg_slide_interval_ms"]
    try:
        config["zen_mode_timeout_ms"] = max(500, int(config["zen_mode_timeout_ms"]))
    except (TypeError, ValueError):
        config["zen_mode_timeout_ms"] = DEFAULT_CONFIG["zen_mode_timeout_ms"]
    try:
        config["default_zoom_level"] = min(5, max(3, int(config["default_zoom_level"])))
    except (TypeError, ValueError):
        config["default_zoom_level"] = DEFAULT_CONFIG["default_zoom_level"]
    config["tours_directory"] = str(config["tours_directory"]).strip() or DEFAULT_CONFIG["tours_directory"]
    return config

CONFIG = load_config()
TOURS_DIR = resolve_tours_directory(CONFIG["tours_directory"])

os.makedirs(STUDIO_DIR, exist_ok=True)
os.makedirs(TOURS_DIR, exist_ok=True)

# ব্যাকগ্রাউন্ড ডাউনলোড স্ট্যাটাস ট্র্যাকার
download_status = {
    "active": False,
    "tour_name": "",
    "current": 0,
    "total": 0,
    "message": "Idle",
    "error": None
}

def extract_coords(url_or_text):
    """গুগল ম্যাপস URL বা টেক্সট থেকে @lat,lon বের করা"""
    match = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', url_or_text)
    if match:
        return float(match.group(1)), float(match.group(2))
    match_plain = re.search(r'(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)', url_or_text)
    if match_plain:
        return float(match_plain.group(1)), float(match_plain.group(2))
    return None, None

def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_bearing(lat1, lon1, lat2, lon2):
    y = math.sin(math.radians(lon2 - lon1)) * math.cos(math.radians(lat2))
    x = (math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) -
         math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon2 - lon1)))
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def angle_diff(a, b):
    diff = abs(a - b) % 360
    return 360 - diff if diff > 180 else diff

def sanitize_folder_name(name):
    clean = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    return clean.replace(" ", "_") if clean else "Untitled_Tour"

def trace_road_panos(start_lat, start_lon, end_lat=None, end_lon=None, initial_bearing=None, max_limit=150, skip_ids=None):
    """রাস্তার গ্রাফ ধরে স্টার্ট থেকে এন্ড পয়েন্ট পর্যন্ত প্যানোরামা লিস্ট তৈরি"""
    if skip_ids is None:
        skip_ids = set()

    current = streetview.find_panorama(start_lat, start_lon)
    if not current:
        return []

    has_end = end_lat is not None and end_lon is not None
    end_pano = streetview.find_panorama(end_lat, end_lon) if has_end else None
    target_bearing = initial_bearing if initial_bearing is not None else (
        get_bearing(start_lat, start_lon, end_lat, end_lon) if has_end else 0
    )

    visited = set(skip_ids)
    results = []

    for _ in range(max_limit):
        if not current or current.id in visited:
            break

        visited.add(current.id)
        detail = streetview.find_panorama_by_id(current.id)
        results.append(detail)

        # শেষ বিন্দুতে পৌঁছে গেলে থামা
        if end_pano and detail.id == end_pano.id:
            break
        if has_end and haversine_meters(detail.lat, detail.lon, end_lat, end_lon) < 15:
            if end_pano and end_pano.id not in visited:
                visited.add(end_pano.id)
                end_detail = streetview.find_panorama_by_id(end_pano.id)
                if end_detail:
                    results.append(end_detail)
            break

        # শেষ বিন্দু দেওয়া থাকলে সেদিকে দিক আপডেট করা, নাহলে রাস্তার স্বাভাবিক বাঁক অনুসরণ করা
        desired_bearing = get_bearing(detail.lat, detail.lon, end_lat, end_lon) if has_end else target_bearing

        best_link = None
        best_score = 999
        for link in detail.links:
            if link.pano.id not in visited:
                link_deg = math.degrees(link.direction) % 360
                diff_target = angle_diff(desired_bearing, link_deg)
                diff_momentum = angle_diff(target_bearing, link_deg)
                # রাস্তার বাঁক ও গন্তব্যের দিকের সমন্বয়
                score = (diff_target * 0.6) + (diff_momentum * 0.4)
                if diff_momentum < 95 and score < best_score:
                    best_score = score
                    best_link = link

        if best_link:
            target_bearing = math.degrees(best_link.direction) % 360
            current = best_link.pano
        else:
            break

    return results

def background_download_worker(tour_name, pano_list, existing_data=None, prepend=False):
    global download_status
    tour_path = os.path.join(TOURS_DIR, tour_name)
    os.makedirs(tour_path, exist_ok=True)

    tour_data = list(existing_data) if existing_data else []
    start_idx = len(tour_data)
    downloaded_data = []

    try:
        for i, detail in enumerate(pano_list):
            if not download_status["active"]:
                download_status["message"] = "Cancelled by user."
                return

            idx_num = start_idx + i + 1
            while prepend and os.path.exists(os.path.join(tour_path, f"pano_{idx_num:03d}.jpg")):
                idx_num += 1
            filename = f"pano_{idx_num:03d}.jpg"
            filepath = os.path.join(tour_path, filename)

            download_status["current"] = i + 1
            download_status["message"] = f"Downloading {filename} ({i+1}/{len(pano_list)})..."

            if not os.path.exists(filepath):
                streetview.download_panorama(detail, filepath, zoom=CONFIG["default_zoom_level"])

            downloaded_data.append({
                "id": detail.id,
                "file": filename,
                "lat": detail.lat,
                "lon": detail.lon,
                "heading": detail.heading,
                "links": [{"id": l.pano.id, "direction": math.degrees(l.direction)} for l in detail.links]
            })

            # প্রতি ছবি নামার সাথে সাথে JSON সেভ রাখা যাতে মাঝপথে থামলেও ডেটা নষ্ট না হয়
            with open(os.path.join(tour_path, "tour_data.json"), "w", encoding="utf-8") as f:
                ordered_data = list(reversed(downloaded_data)) + tour_data if prepend else tour_data + downloaded_data
                json.dump(ordered_data, f, indent=2)

        download_status["message"] = f"Completed! {len(pano_list)} panoramas saved."
    except Exception as e:
        download_status["error"] = str(e)
        download_status["message"] = f"Error: {str(e)}"
    finally:
        download_status["active"] = False

class StudioHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # /tours/... রিকোয়েস্ট গেলে tours ফোল্ডার থেকে সার্ভ করবে, নাহলে studio ফোল্ডার থেকে
        parsed = urlparse(path).path
        if parsed.startswith("/tours/"):
            rel = parsed[len("/tours/"):]
            return os.path.join(TOURS_DIR, *rel.split("/"))
        rel = parsed.lstrip("/")
        if rel == "":
            rel = "index.html"
        return os.path.join(STUDIO_DIR, *rel.split("/"))

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

    def trim_tour(self, payload, side):
        if download_status["active"]:
            return self.send_json({"ok": False, "error": "A download or processing operation is currently running."}, 409)
        if side not in ("first", "last"):
            return self.send_json({"ok": False, "error": 'Side must be "first" or "last".'}, 400)

        tour_name = payload.get("name", "")
        t_path = os.path.abspath(os.path.join(TOURS_DIR, tour_name))
        tours_root = os.path.abspath(TOURS_DIR)
        try:
            if os.path.commonpath([tours_root, t_path]) != tours_root:
                return self.send_json({"ok": False, "error": "Invalid tour name."}, 400)
        except ValueError:
            return self.send_json({"ok": False, "error": "Invalid tour name."}, 400)

        json_file = os.path.join(t_path, "tour_data.json")
        if not os.path.isdir(t_path) or not os.path.isfile(json_file):
            return self.send_json({"ok": False, "error": "Tour not found."}, 404)

        try:
            with open(json_file, "r", encoding="utf-8") as f:
                tour_data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            return self.send_json({"ok": False, "error": f"Could not read tour data: {str(e)}"}, 500)

        if not isinstance(tour_data, list) or len(tour_data) <= 1:
            return self.send_json({"ok": False, "error": "Cannot trim an image. Tours must keep at least one image."}, 400)

        removed_entry = tour_data[0] if side == "first" else tour_data[-1]
        filename = removed_entry.get("file") if isinstance(removed_entry, dict) else None
        if not filename or os.path.basename(filename) != filename:
            return self.send_json({"ok": False, "error": "The selected panorama has an invalid file reference."}, 500)

        filepath = os.path.join(t_path, filename)
        if not os.path.isfile(filepath):
            return self.send_json({"ok": False, "error": f"Selected panorama file not found: {filename}"}, 404)

        reduced_data = tour_data[1:] if side == "first" else tour_data[:-1]
        temp_json = json_file + ".trim.tmp"
        try:
            with open(temp_json, "w", encoding="utf-8") as f:
                json.dump(reduced_data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp_json, json_file)
        except OSError as e:
            if os.path.exists(temp_json):
                os.remove(temp_json)
            return self.send_json({"ok": False, "error": f"Could not update tour data: {str(e)}"}, 500)

        try:
            os.remove(filepath)
        except OSError as e:
            restore_temp = json_file + ".restore.tmp"
            try:
                with open(restore_temp, "w", encoding="utf-8") as f:
                    json.dump(tour_data, f, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(restore_temp, json_file)
            except OSError:
                pass
            return self.send_json({"ok": False, "error": f"Could not delete the selected panorama: {str(e)}"}, 500)

        self.send_json({"ok": True, "removed": filename, "side": side, "count": len(reduced_data)})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/browse-folder":
            try:
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                selected = filedialog.askdirectory(
                    parent=root,
                    title="Select Tours Directory",
                    initialdir=TOURS_DIR
                )
                root.destroy()
                if selected:
                    self.send_json({"ok": True, "path": selected})
                else:
                    self.send_json({"ok": False, "cancelled": True})
            except Exception as e:
                self.send_json({"ok": False, "error": f"Folder picker unavailable: {str(e)}"}, 500)
        elif parsed.path == "/api/config":
            self.send_json({"ok": True, "config": CONFIG})
        elif parsed.path == "/api/tours":
            tours = []
            for name in sorted(os.listdir(TOURS_DIR)):
                t_path = os.path.join(TOURS_DIR, name)
                json_file = os.path.join(t_path, "tour_data.json")
                if os.path.isdir(t_path) and os.path.exists(json_file):
                    try:
                        with open(json_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        size_bytes = sum(os.path.getsize(os.path.join(t_path, fn)) for fn in os.listdir(t_path) if os.path.isfile(os.path.join(t_path, fn)))
                        tours.append({
                            "name": name,
                            "count": len(data),
                            "size_mb": round(size_bytes / (1024 * 1024), 1),
                            "start_lat": data[0]["lat"] if data else None,
                            "start_lon": data[0]["lon"] if data else None,
                            "end_lat": data[-1]["lat"] if data else None,
                            "end_lon": data[-1]["lon"] if data else None
                        })
                    except Exception:
                        pass
            self.send_json({"tours": tours})
        elif parsed.path == "/api/status":
            self.send_json(download_status)
        elif parsed.path == "/api/backgrounds":
            bg_dir = os.path.join(STUDIO_DIR, "backgrounds")
            os.makedirs(bg_dir, exist_ok=True)
            exts = (".jpg", ".jpeg", ".png", ".webp")
            files = [f"/backgrounds/{fn}" for fn in sorted(os.listdir(bg_dir)) if fn.lower().endswith(exts)]
            self.send_json({"images": files})
        else:
            super().do_GET()

    def do_POST(self):
        global download_status
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        parsed = urlparse(self.path)

        if parsed.path == "/api/config":
            if download_status["active"]:
                return self.send_json({"ok": False, "error": "A download is already running. Settings can be changed after it finishes."}, 409)

            tours_directory = str(payload.get("tours_directory", CONFIG["tours_directory"])).strip()
            if not tours_directory:
                return self.send_json({"ok": False, "error": "Tours directory cannot be empty."}, 400)
            try:
                bg_interval = max(1000, int(payload.get("bg_slide_interval_ms", CONFIG["bg_slide_interval_ms"])))
                zen_timeout = max(500, int(payload.get("zen_mode_timeout_ms", CONFIG["zen_mode_timeout_ms"])))
                zoom_level = int(payload.get("default_zoom_level", CONFIG["default_zoom_level"]))
            except (TypeError, ValueError):
                return self.send_json({"ok": False, "error": "Numeric settings contain invalid values."}, 400)
            if zoom_level not in (3, 4, 5):
                return self.send_json({"ok": False, "error": "Default zoom level must be 3, 4, or 5."}, 400)

            next_config = {
                "tours_directory": tours_directory,
                "bg_slide_interval_ms": bg_interval,
                "zen_mode_timeout_ms": zen_timeout,
                "default_zoom_level": zoom_level
            }
            try:
                temp_config = CONFIG_FILE + ".tmp"
                with open(temp_config, "w", encoding="utf-8") as f:
                    json.dump(next_config, f, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(temp_config, CONFIG_FILE)
            except OSError as e:
                if os.path.exists(CONFIG_FILE + ".tmp"):
                    os.remove(CONFIG_FILE + ".tmp")
                return self.send_json({"ok": False, "error": f"Could not save config.json: {str(e)}"}, 500)

            CONFIG.clear()
            CONFIG.update(next_config)
            globals()["TOURS_DIR"] = resolve_tours_directory(CONFIG["tours_directory"])
            os.makedirs(TOURS_DIR, exist_ok=True)
            self.send_json({"ok": True, "config": CONFIG})

        elif parsed.path == "/api/scan":
            s_lat, s_lon = extract_coords(payload.get("start_link", ""))
            e_lat, e_lon = extract_coords(payload.get("end_link", ""))
            if not s_lat or not e_lat:
                return self.send_json({"ok": False, "error": "Invalid Google Maps URLs. Ensure @lat,lon is in the link."}, 400)
            panos = trace_road_panos(s_lat, s_lon, e_lat, e_lon, max_limit=250)
            mb_per_image = {5: 13.5, 4: 4.5, 3: 1.2}.get(CONFIG["default_zoom_level"], 13.5)
            est_mb = round(len(panos) * mb_per_image, 1)
            self.send_json({"ok": True, "count": len(panos), "est_mb": est_mb})

        elif parsed.path == "/api/download":
            if download_status["active"]:
                return self.send_json({"ok": False, "error": "A download is already running."}, 400)
            tour_name = sanitize_folder_name(payload.get("name", ""))
            s_lat, s_lon = extract_coords(payload.get("start_link", ""))
            e_lat, e_lon = extract_coords(payload.get("end_link", ""))
            limit = int(payload.get("limit", 50))
            if not s_lat or not e_lat:
                return self.send_json({"ok": False, "error": "Invalid Start or End link."}, 400)

            panos = trace_road_panos(s_lat, s_lon, e_lat, e_lon, max_limit=limit)
            if not panos:
                return self.send_json({"ok": False, "error": "No Street View found at start location."}, 404)

            download_status = {"active": True, "tour_name": tour_name, "current": 0, "total": len(panos), "message": "Starting...", "error": None}
            t = threading.Thread(target=background_download_worker, args=(tour_name, panos))
            t.daemon = True
            t.start()
            self.send_json({"ok": True, "total": len(panos)})

        elif parsed.path == "/api/extend":
            if download_status["active"]:
                return self.send_json({"ok": False, "error": "A download is already running."}, 400)
            tour_name = payload.get("name", "")
            extra_count = int(payload.get("extra", 20))
            end_link = payload.get("end_link", "").strip()
            e_lat, e_lon = extract_coords(end_link) if end_link else (None, None)

            t_path = os.path.join(TOURS_DIR, tour_name)
            json_file = os.path.join(t_path, "tour_data.json")
            if not os.path.exists(json_file):
                return self.send_json({"ok": False, "error": "Tour not found."}, 404)

            with open(json_file, "r", encoding="utf-8") as f:
                existing_data = json.load(f)

            last = existing_data[-1]
            prev = existing_data[-2] if len(existing_data) >= 2 else last
            last_bearing = get_bearing(prev["lat"], prev["lon"], last["lat"], last["lon"]) if len(existing_data) >= 2 else math.degrees(last["heading"])
            skip_ids = {item["id"] for item in existing_data}

            # অপশনাল এন্ড-লিংক দেওয়া থাকলে সেই দিক অনুসরণ করবে এবং ওখানে পৌঁছালে থামবে
            panos = trace_road_panos(
                last["lat"], last["lon"],
                end_lat=e_lat, end_lon=e_lon,
                initial_bearing=last_bearing,
                max_limit=extra_count + 1,
                skip_ids=set()
            )
            new_panos = [p for p in panos if p.id not in skip_ids][:extra_count]

            if not new_panos:
                return self.send_json({"ok": False, "error": "No further panoramas found ahead."}, 404)

            download_status = {"active": True, "tour_name": tour_name, "current": 0, "total": len(new_panos), "message": "Extending...", "error": None}
            t = threading.Thread(target=background_download_worker, args=(tour_name, new_panos, existing_data))
            t.daemon = True
            t.start()
            self.send_json({"ok": True, "total": len(new_panos)})

        elif parsed.path == "/api/prepend":
            if download_status["active"]:
                return self.send_json({"ok": False, "error": "A download is already running."}, 400)

            tour_name = payload.get("name", "")
            try:
                extra_count = int(payload.get("extra", 20))
            except (TypeError, ValueError):
                return self.send_json({"ok": False, "error": "Image count must be a positive number."}, 400)
            if extra_count < 1:
                return self.send_json({"ok": False, "error": "Image count must be a positive number."}, 400)
            end_link = payload.get("end_link", "").strip()
            e_lat, e_lon = extract_coords(end_link) if end_link else (None, None)

            t_path = os.path.abspath(os.path.join(TOURS_DIR, tour_name))
            tours_root = os.path.abspath(TOURS_DIR)
            try:
                if os.path.commonpath([tours_root, t_path]) != tours_root:
                    return self.send_json({"ok": False, "error": "Invalid tour name."}, 400)
            except ValueError:
                return self.send_json({"ok": False, "error": "Invalid tour name."}, 400)

            json_file = os.path.join(t_path, "tour_data.json")
            if not os.path.isdir(t_path) or not os.path.isfile(json_file):
                return self.send_json({"ok": False, "error": "Tour not found."}, 404)

            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    existing_data = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                return self.send_json({"ok": False, "error": f"Could not read tour data: {str(e)}"}, 500)
            if not isinstance(existing_data, list) or not existing_data:
                return self.send_json({"ok": False, "error": "Tour has no starting panorama."}, 400)

            first = existing_data[0]
            if not isinstance(first, dict) or "lat" not in first or "lon" not in first:
                return self.send_json({"ok": False, "error": "Tour has invalid starting panorama coordinates."}, 500)

            if len(existing_data) >= 2:
                forward_bearing = get_bearing(first["lat"], first["lon"], existing_data[1]["lat"], existing_data[1]["lon"])
            else:
                forward_bearing = math.degrees(first.get("heading", 0))
            backward_bearing = (forward_bearing + 180) % 360
            existing_ids = {item.get("id") for item in existing_data if isinstance(item, dict)}
            panos = trace_road_panos(
                first["lat"], first["lon"],
                end_lat=e_lat, end_lon=e_lon,
                initial_bearing=backward_bearing,
                max_limit=extra_count + 1
            )
            new_panos = [p for p in panos if p.id not in existing_ids][:extra_count]
            if not new_panos:
                return self.send_json({"ok": False, "error": "No further panoramas found behind the tour start."}, 404)

            download_status = {"active": True, "tour_name": tour_name, "current": 0, "total": len(new_panos), "message": "Prepending...", "error": None}
            t = threading.Thread(target=background_download_worker, args=(tour_name, new_panos, existing_data, True))
            t.daemon = True
            t.start()
            self.send_json({"ok": True, "total": len(new_panos)})

        elif parsed.path in ("/api/trim", "/api/trim-last"):
            side = payload.get("side", "last") if parsed.path == "/api/trim" else "last"
            self.trim_tour(payload, side)

        elif parsed.path == "/api/rename":
            old_name = payload.get("old_name", "")
            new_name = sanitize_folder_name(payload.get("new_name", ""))
            old_path = os.path.join(TOURS_DIR, old_name)
            new_path = os.path.join(TOURS_DIR, new_name)
            if not os.path.exists(old_path) or os.path.exists(new_path):
                return self.send_json({"ok": False, "error": "Invalid name or destination already exists."}, 400)
            os.rename(old_path, new_path)
            self.send_json({"ok": True})

        elif parsed.path == "/api/delete":
            name = payload.get("name", "")
            t_path = os.path.join(TOURS_DIR, name)
            if os.path.exists(t_path) and os.path.isdir(t_path):
                shutil.rmtree(t_path)
                return self.send_json({"ok": True})
            self.send_json({"ok": False, "error": "Tour folder not found."}, 404)

if __name__ == "__main__":
    print(f"StreetView Studio v2.1.0 running at http://localhost:{PORT}")
    print("Keep this window open while using the Studio. Press Ctrl+C to stop.")
    server = HTTPServer(("127.0.0.1", PORT), StudioHandler)
    server.serve_forever()

            