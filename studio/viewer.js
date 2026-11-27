const params = new URLSearchParams(window.location.search);
const tourName = params.get('tour');

let viewer = null;
let tourData = [];
let currentIndex = 0;
let isTransitioning = false;
let autopilotTimer = null;
let idleTimer = null;

if (!tourName) {
    document.getElementById('tour-title').innerText = "No tour selected";
} else {
    document.title = `${tourName} - StreetView Tour`;
    document.getElementById('tour-title').innerText = tourName;
    loadTourData();
}

function loadTourData() {
    fetch(`/tours/${encodeURIComponent(tourName)}/tour_data.json`)
        .then(res => res.json())
        .then(data => {
            tourData = data;
            initViewer();
        })
        .catch(err => {
            document.getElementById('step-counter').innerText = "Failed to load tour data";
            console.error(err);
        });
}

function initViewer() {
    const scenes = {};
    tourData.forEach((item, idx) => {
        scenes["scene_" + idx] = {
            type: "equirectangular",
            panorama: `/tours/${encodeURIComponent(tourName)}/${item.file}`,
            autoLoad: true
        };
    });

    const initialYaw = getRoadForwardYaw(0);

    viewer = pannellum.viewer('panorama', {
        default: {
            firstScene: "scene_0",
            yaw: initialYaw,
            pitch: 0,
            hfov: 100,
            sceneFadeDuration: 350,
            showControls: true,
            keyboardZoom: false
        },
        scenes: scenes
    });

    buildMinimap();
    updateUI(0);
    setupControls();
    resetIdleTimer();
}

function getRoadForwardYaw(idx) {
    const item = tourData[idx];
    const headingDeg = (item.heading * 180) / Math.PI;
    if (idx + 1 < tourData.length) {
        const nextItem = tourData[idx + 1];
        const link = item.links.find(l => l.id === nextItem.id);
        if (link) {
            return normalizeYaw(link.direction - headingDeg);
        }
    }
    return 0;
}

function normalizeYaw(deg) {
    let a = deg % 360;
    if (a > 180) a -= 360;
    if (a < -180) a += 360;
    return a;
}

// স্মুথ জুম-ইন ট্রানজিশন + কম্পাস অ্যাঙ্গেল লক করে পরের ছবিতে যাওয়া
function goToStep(targetIdx, useZoomEffect = true) {
    if (isTransitioning || targetIdx < 0 || targetIdx >= tourData.length || targetIdx === currentIndex) {
        if (targetIdx >= tourData.length && autopilotTimer) {
            stopAutopilot();
        }
        return;
    }

    isTransitioning = true;
    const isForward = targetIdx > currentIndex;

    const currentPitch = viewer.getPitch();
    const currentHfov = viewer.getHfov();
    const currentYaw = viewer.getYaw();

    const oldHeadingDeg = (tourData[currentIndex].heading * 180) / Math.PI;
    const worldCompassBearing = (oldHeadingDeg + currentYaw + 360) % 360;

    const newHeadingDeg = (tourData[targetIdx].heading * 180) / Math.PI;
    const targetYaw = normalizeYaw(worldCompassBearing - newHeadingDeg);

    const performSwitch = () => {
        currentIndex = targetIdx;
        viewer.loadScene("scene_" + targetIdx, currentPitch, targetYaw, currentHfov);
        updateUI(targetIdx);
        setTimeout(() => {
            isTransitioning = false;
        }, 250);
    };

    // সামনে গেলে হালকা জুম-ইন মোশন ইফেক্ট দেবে
    if (useZoomEffect && isForward && Math.abs(targetIdx - currentIndex) === 1) {
        const zoomTarget = Math.max(55, currentHfov - 18);
        viewer.setHfov(zoomTarget, 220);
        setTimeout(performSwitch, 210);
    } else {
        performSwitch();
    }
}

function buildMinimap() {
    const minimap = document.getElementById('step-minimap');
    minimap.innerHTML = '';

    tourData.forEach((item, idx) => {
        const tick = document.createElement('div');
        tick.className = 'step-tick';
        tick.id = 'tick-' + idx;
        tick.title = `Point ${idx + 1}`;
        tick.addEventListener('click', () => goToStep(idx, false));
        minimap.appendChild(tick);
    });
}

function updateUI(idx) {
    const total = tourData.length;
    document.getElementById('step-counter').innerText = `Point ${idx + 1} / ${total}`;

    document.getElementById('btn-prev').disabled = (idx === 0);
    document.getElementById('btn-next').disabled = (idx === total - 1);

    document.querySelectorAll('.step-tick').forEach((el, i) => {
        const isActive = (i === idx);
        el.classList.toggle('active', isActive);
        if (isActive) {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
}

// অটোপাইলট (Auto-Play) কন্ট্রোল
function toggleAutopilot() {
    if (autopilotTimer) {
        stopAutopilot();
    } else {
        startAutopilot();
    }
}

function startAutopilot() {
    if (currentIndex >= tourData.length - 1) {
        goToStep(0, false);
    }
    const btn = document.getElementById('btn-autopilot');
    btn.classList.add('playing');
    btn.innerHTML = "&#10074;&#10074; Pause";

    const delay = parseInt(document.getElementById('speed-select').value, 10) || 2500;
    autopilotTimer = setInterval(() => {
        if (currentIndex < tourData.length - 1) {
            goToStep(currentIndex + 1, true);
        } else {
            stopAutopilot();
        }
    }, delay);
}

function stopAutopilot() {
    if (autopilotTimer) {
        clearInterval(autopilotTimer);
        autopilotTimer = null;
    }
    const btn = document.getElementById('btn-autopilot');
    btn.classList.remove('playing');
    btn.innerHTML = "&#9654; Autopilot";
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

// ৫-সেকেন্ড নাড়াচাড়া না করলে সব HUD লুকিয়ে ক্লিন স্ক্রিন করা (Zen Mode)
function resetIdleTimer() {
    document.body.classList.remove('zen-mode');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        document.body.classList.add('zen-mode');
    }, 5000);
}

function setupControls() {
    document.getElementById('btn-prev').addEventListener('click', () => {
        stopAutopilot();
        goToStep(currentIndex - 1, false);
    });

    document.getElementById('btn-next').addEventListener('click', () => {
        stopAutopilot();
        goToStep(currentIndex + 1, true);
    });

    document.getElementById('btn-autopilot').addEventListener('click', toggleAutopilot);

    document.getElementById('speed-select').addEventListener('change', () => {
        if (autopilotTimer) {
            stopAutopilot();
            startAutopilot();
        }
    });

    document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

    // ড্রাইভিং কিবোর্ড কন্ট্রোল (Up/Down = চলা, Left/Right = ক্যামেরা ঘোরানো)
    window.addEventListener('keydown', (e) => {
        resetIdleTimer();

        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
            e.preventDefault();
            stopAutopilot();
            goToStep(currentIndex + 1, true);
        } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
            e.preventDefault();
            stopAutopilot();
            goToStep(currentIndex - 1, false);
        } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
            e.preventDefault();
            viewer.setYaw(viewer.getYaw() - 12, 120);
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
            e.preventDefault();
            viewer.setYaw(viewer.getYaw() + 12, 120);
        } else if (e.key === " ") {
            e.preventDefault();
            toggleAutopilot();
        } else if (e.key === "f" || e.key === "F") {
            e.preventDefault();
            toggleFullscreen();
        }
    }, true);

    ['mousemove', 'mousedown', 'wheel', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
}
