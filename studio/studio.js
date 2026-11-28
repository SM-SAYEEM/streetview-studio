const btnScan = document.getElementById('btn-scan');
const btnDownload = document.getElementById('btn-download');
const btnRefresh = document.getElementById('btn-refresh');
const scanResult = document.getElementById('scan-result');
const scanSummary = document.getElementById('scan-summary');
const downloadLimit = document.getElementById('download-limit');
const progressBox = document.getElementById('progress-box');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const progressFill = document.getElementById('progress-fill');
const toursList = document.getElementById('tours-list');

let bgSlides = [];
let bgIndex = 0;
let bgInterval = null;
let extendingTourName = "";
let trimmingTourName = "";
let trimmingTourCount = 0;
let bgSlideIntervalMs = 8000;
let statusPollTimer = null;
let downloadWasActive = false;

window.addEventListener('DOMContentLoaded', () => {
    loadTours();
    refreshServerStatus();
    statusPollTimer = setInterval(refreshServerStatus, 1500);
    loadSettings();
});

btnRefresh.addEventListener('click', loadTours);

btnScan.addEventListener('click', async () => {
    const startLink = document.getElementById('start-link').value.trim();
    const endLink = document.getElementById('end-link').value.trim();

    if (!startLink || !endLink) {
        alert("Please paste both Start and End Google Maps links.");
        return;
    }

    btnScan.disabled = true;
    btnScan.innerText = "Scanning road path...";
    scanResult.classList.add('hidden');

    try {
        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_link: startLink, end_link: endLink })
        });
        const data = await res.json();

        if (!data.ok) {
            alert(data.error || "Scan failed.");
        } else {
            scanSummary.innerHTML = `Found <strong>${data.count} panoramas</strong> along this route (Est. Space: <strong>${data.est_mb} MB</strong>)`;
            downloadLimit.value = data.count;
            scanResult.classList.remove('hidden');
        }
    } catch (err) {
        alert("Connection error with Studio server.");
    } finally {
        btnScan.disabled = false;
        btnScan.innerText = "1. Scan & Estimate Path";
    }
});

btnDownload.addEventListener('click', async () => {
    const name = document.getElementById('tour-name').value.trim() || "New_Road_Tour";
    const startLink = document.getElementById('start-link').value.trim();
    const endLink = document.getElementById('end-link').value.trim();
    const limit = parseInt(downloadLimit.value, 10) || 50;

    btnDownload.disabled = true;

    try {
        const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, start_link: startLink, end_link: endLink, limit })
        });
        const data = await res.json();

        if (!data.ok) {
            alert(data.error || "Could not start download.");
            btnDownload.disabled = false;
        } else {
            startProgressPolling();
        }
    } catch (err) {
        alert("Server error.");
        btnDownload.disabled = false;
    }
});

function startProgressPolling() {
    progressBox.classList.remove('hidden');
    downloadWasActive = true;
    refreshServerStatus();
}

function setEngineStatus(state) {
    const pill = document.getElementById('engine-status');
    pill.classList.remove('status-ready', 'status-downloading', 'status-offline');
    if (state === 'downloading') {
        pill.innerText = "Downloading...";
        pill.classList.add('status-downloading');
    } else if (state === 'offline') {
        pill.innerText = "Server Offline";
        pill.classList.add('status-offline');
    } else {
        pill.innerText = "Engine Ready";
        pill.classList.add('status-ready');
    }
}

async function refreshServerStatus() {
    try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
        const st = await res.json();
        setEngineStatus(st.active ? 'downloading' : 'ready');

        if (st.active) {
            downloadWasActive = true;
            progressBox.classList.remove('hidden');
            const pct = st.total > 0 ? Math.round((st.current / st.total) * 100) : 0;
            progressText.innerText = st.message;
            progressPercent.innerText = pct + "%";
            progressFill.style.width = pct + "%";
        } else {
            btnDownload.disabled = false;
            if (downloadWasActive) {
                downloadWasActive = false;
                loadTours();
            }
        }
    } catch (err) {
        setEngineStatus('offline');
    }
}

async function loadTours() {
    try {
        const res = await fetch('/api/tours');
        const data = await res.json();
        const tours = data.tours || [];
        renderTours(tours);
        setupDynamicBackground(tours);
    } catch (err) {
        toursList.innerHTML = `<p class="muted">Failed to load tours.</p>`;
    }
}

// ডাইনামিক ব্যাকগ্রাউন্ড স্লাইডশো (সেভ করা ট্যুরগুলোর ছবি থেকে অটোমেটিক চলবে)
async function setupDynamicBackground(tours) {
    let rawSlides = [];
    try {
        const res = await fetch('/api/backgrounds');
        const data = await res.json();
        if (data.images && data.images.length > 0) {
            rawSlides = data.images;
        }
    } catch (e) {}

    if (rawSlides.length === 0) {
        tours.forEach(t => {
            if (t.count >= 1) rawSlides.push(`/tours/${encodeURIComponent(t.name)}/pano_001.jpg`);
            if (t.count >= 15) rawSlides.push(`/tours/${encodeURIComponent(t.name)}/pano_015.jpg`);
        });
    }

    const bgLayer = document.getElementById('dynamic-bg-layer');
    if (!bgLayer || rawSlides.length === 0) return;

    // শুধু যেসব ছবি ব্রাউজারে সঠিকভাবে লোড হবে, সেগুলোই স্লাইডশোতে নেবে (কালো স্ক্রিন প্রতিরোধ)
    const validUrls = [];
    rawSlides.forEach(src => {
        const encoded = encodeURI(src);
        const img = new Image();
        img.onload = () => {
            validUrls.push(encoded);
            if (validUrls.length === 1) {
                bgLayer.style.backgroundImage = `url("${validUrls[0]}")`;
            }
        };
        img.src = encoded;
    });

    if (bgInterval) clearInterval(bgInterval);
    bgInterval = setInterval(() => {
        if (validUrls.length > 1) {
            bgIndex = (bgIndex + 1) % validUrls.length;
            bgLayer.style.backgroundImage = `url("${validUrls[bgIndex]}")`;
        }
    }, bgSlideIntervalMs);
}

function renderTours(tours) {
    if (tours.length === 0) {
        toursList.innerHTML = `<p class="muted">No saved tours yet. Paste links above to create your first tour!</p>`;
        return;
    }

    toursList.innerHTML = '';
    tours.forEach(t => {
        const card = document.createElement('div');
        card.className = 'tour-item';

        const mapUrl = (t.end_lat && t.end_lon)
            ? 'https://www.google.' + 'com/maps/@' + t.end_lat + ',' + t.end_lon + ',3a,75y,0h,90t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192'
            : '#';

        card.innerHTML = `
            <div class="tour-meta">
                <h3>${t.name}</h3>
                <div class="tour-stats">
                    <span>Images: <strong>${t.count}</strong></span>
                    <span>Size: <strong>${t.size_mb} MB</strong></span>
                    ${t.end_lat ? `<a href="${mapUrl}" target="_blank" style="color:#60a5fa; text-decoration:none;">View End Point on Map &#8599;</a>` : ''}
                </div>
            </div>
            <div class="tour-actions">
                <button class="btn primary small" onclick="openViewer('${t.name}')">Open Viewer</button>
                <button class="btn secondary small" onclick="extendTour('${t.name}')">Extend (+)</button>
                <button class="btn secondary small" onclick="openTrimModal('${t.name}', ${t.count})" ${t.count <= 1 ? 'disabled title="Tours must keep at least one image"' : ''}>Trim (-)</button>
                <button class="btn secondary small" onclick="renameTour('${t.name}')">Rename</button>
                <button class="btn danger small" onclick="deleteTour('${t.name}')">Delete</button>
            </div>
        `;
        toursList.appendChild(card);
    });
}

function openViewer(tourName) {
    window.open(`viewer.html?tour=${encodeURIComponent(tourName)}`, '_blank');
}

function extendTour(tourName) {
    extendingTourName = tourName;
    document.getElementById('extend-modal-title').innerText = `Extend "${tourName}"`;
    document.getElementById('extend-direction').value = 'forward';
    document.getElementById('extend-end-link').value = "";
    updateExtendTargetLabel();
    document.getElementById('extend-modal').classList.remove('hidden');
}

document.getElementById('btn-extend-cancel').addEventListener('click', () => {
    document.getElementById('extend-modal').classList.add('hidden');
});

document.getElementById('btn-extend-confirm').addEventListener('click', async () => {
    const extra = parseInt(document.getElementById('extend-count').value, 10) || 20;
    const endLink = document.getElementById('extend-end-link').value.trim();
    const direction = document.getElementById('extend-direction').value;
    document.getElementById('extend-modal').classList.add('hidden');

    try {
        const endpoint = direction === 'backward' ? '/api/prepend' : '/api/extend';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: extendingTourName, extra, end_link: endLink })
        });
        const data = await res.json();
        if (!data.ok) {
            alert(data.error || "Failed to extend tour.");
        } else {
            startProgressPolling();
        }
    } catch (err) {
        alert("Server error.");
    }
});

function updateExtendTargetLabel() {
    const backward = document.getElementById('extend-direction').value === 'backward';
    document.getElementById('extend-target-label').innerText = backward
        ? "Target Start Link (Optional — recommended if there is a junction/turn behind the start)"
        : "Target End Link (Optional — recommended if there is a junction/turn ahead)";
}

document.getElementById('extend-direction').addEventListener('change', updateExtendTargetLabel);

async function renameTour(oldName) {
    const newName = prompt("Enter new name for this tour:", oldName);
    if (!newName || newName.trim() === oldName) return;

    const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldName, new_name: newName.trim() })
    });
    const data = await res.json();
    if (!data.ok) alert(data.error || "Rename failed.");
    else loadTours();
}

async function deleteTour(name) {
    if (!confirm(`Are you sure you want to permanently delete "${name}" and all its images?`)) return;

    const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!data.ok) alert(data.error || "Delete failed.");
    else loadTours();
}

function openTrimModal(name, count) {
    if (count <= 1) {
        alert("Cannot trim an image. Tours must keep at least one image.");
        return;
    }
    trimmingTourName = name;
    trimmingTourCount = count;
    document.getElementById('trim-modal-title').innerText = `Trim "${name}"`;
    document.getElementById('trim-modal').classList.remove('hidden');
}

document.getElementById('btn-trim-cancel').addEventListener('click', () => {
    document.getElementById('trim-modal').classList.add('hidden');
});

async function confirmTrim(side) {
    const pointName = side === 'first' ? 'First Point (Start)' : 'Last Point (End)';
    if (!confirm(`Permanently delete the ${pointName} panorama image from "${trimmingTourName}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const res = await fetch('/api/trim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmingTourName, side })
        });
        const data = await res.json();
        document.getElementById('trim-modal').classList.add('hidden');
        if (!data.ok) {
            alert(data.error || "Could not trim the selected image.");
        } else {
            loadTours();
        }
    } catch (err) {
        alert("Server error.");
    }
}

document.getElementById('btn-trim-first').addEventListener('click', () => confirmTrim('first'));
document.getElementById('btn-trim-last').addEventListener('click', () => confirmTrim('last'));

async function loadSettings() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (!data.ok) return;
        applySettingsToModal(data.config);
        bgSlideIntervalMs = data.config.bg_slide_interval_ms;
    } catch (err) {}
}

function applySettingsToModal(config) {
    document.getElementById('settings-tours-directory').value = config.tours_directory;
    document.getElementById('settings-bg-interval').value = config.bg_slide_interval_ms;
    document.getElementById('settings-zen-timeout').value = config.zen_mode_timeout_ms;
    document.getElementById('settings-default-zoom').value = String(config.default_zoom_level);
}

document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('btn-settings-cancel').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('btn-browse-folder').addEventListener('click', async () => {
    const browseButton = document.getElementById('btn-browse-folder');
    browseButton.disabled = true;
    try {
        const res = await fetch('/api/browse-folder');
        const data = await res.json();
        if (data.ok && data.path) {
            document.getElementById('settings-tours-directory').value = data.path;
        } else if (!data.cancelled) {
            alert(data.error || "Could not open the folder picker.");
        }
    } catch (err) {
        alert("Server error.");
    } finally {
        browseButton.disabled = false;
    }
});

document.getElementById('btn-settings-save').addEventListener('click', async () => {
    const payload = {
        tours_directory: document.getElementById('settings-tours-directory').value.trim(),
        bg_slide_interval_ms: parseInt(document.getElementById('settings-bg-interval').value, 10),
        zen_mode_timeout_ms: parseInt(document.getElementById('settings-zen-timeout').value, 10),
        default_zoom_level: parseInt(document.getElementById('settings-default-zoom').value, 10)
    };

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) {
            alert(data.error || "Could not save settings.");
            return;
        }
        bgSlideIntervalMs = data.config.bg_slide_interval_ms;
        applySettingsToModal(data.config);
        document.getElementById('settings-modal').classList.add('hidden');
        loadTours();
    } catch (err) {
        alert("Server error.");
    }
});
