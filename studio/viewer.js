const params = new URLSearchParams(window.location.search);
const tourName = params.get('tour');

let viewer = null;
let tourData = [];
let currentIndex = 0;
let isTransitioning = false;
let autopilotTimer = null;
let idleTimer = null;
let zenModeTimeoutMs = 5000;
const rotatingKeys = new Set();
let cameraRotationFrame = null;
let cameraRotation = {
    startYaw: 0,
    startPitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    startedAt: 0,
    duration: 320,
    lastFrameAt: 0
};

if (!tourName) {
    document.getElementById('tour-title').innerText = "No tour selected";
} else {
    document.title = `${tourName} - StreetView Tour`;
    document.getElementById('tour-title').innerText = tourName;
    loadZenConfig().finally(loadTourData);
}

async function loadZenConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.ok && data.config) {
            zenModeTimeoutMs = data.config.zen_mode_timeout_ms;
        }
    } catch (err) {}
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
    }, zenModeTimeoutMs);
}

function easeOutCubic(progress) {
    return 1 - Math.pow(1 - progress, 3);
}

function getRotationVelocity(start, target, progress) {
    return start + (target - start) * easeOutCubic(progress);
}

function smoothRotateCamera(deltaYaw, deltaPitch, duration = 320) {
    if (!viewer) return;
    if (cameraRotation.targetYaw === deltaYaw && cameraRotation.targetPitch === deltaPitch) return;

    const now = performance.now();
    const progress = Math.min(1, (now - cameraRotation.startedAt) / cameraRotation.duration);
    const currentYawVelocity = getRotationVelocity(cameraRotation.startYaw, cameraRotation.targetYaw, progress);
    const currentPitchVelocity = getRotationVelocity(cameraRotation.startPitch, cameraRotation.targetPitch, progress);

    if (currentYawVelocity === deltaYaw && currentPitchVelocity === deltaPitch) return;

    cameraRotation = {
        startYaw: currentYawVelocity,
        startPitch: currentPitchVelocity,
        targetYaw: deltaYaw,
        targetPitch: deltaPitch,
        startedAt: now,
        duration,
        lastFrameAt: now
    };

    if (cameraRotationFrame === null) {
        cameraRotationFrame = requestAnimationFrame(animateCameraRotation);
    }
}

function animateCameraRotation(timestamp) {
    const progress = Math.min(1, (timestamp - cameraRotation.startedAt) / cameraRotation.duration);
    const yawVelocity = getRotationVelocity(cameraRotation.startYaw, cameraRotation.targetYaw, progress);
    const pitchVelocity = getRotationVelocity(cameraRotation.startPitch, cameraRotation.targetPitch, progress);
    const deltaSeconds = Math.min((timestamp - cameraRotation.lastFrameAt) / 1000, 0.05);
    cameraRotation.lastFrameAt = timestamp;

    if (deltaSeconds > 0) {
        viewer.setYaw(viewer.getYaw() + yawVelocity * deltaSeconds, 0);
        viewer.setPitch(Math.max(-90, Math.min(90, viewer.getPitch() + pitchVelocity * deltaSeconds)), 0);
    }

    const settled = progress === 1 && cameraRotation.targetYaw === 0 && cameraRotation.targetPitch === 0;
    if (settled) {
        cameraRotationFrame = null;
        return;
    }
    cameraRotationFrame = requestAnimationFrame(animateCameraRotation);
}

function updateCameraRotationFromKeys() {
    const left = rotatingKeys.has('ArrowLeft') || rotatingKeys.has('a');
    const right = rotatingKeys.has('ArrowRight') || rotatingKeys.has('d');
    const up = rotatingKeys.has('ArrowUp');
    const down = rotatingKeys.has('ArrowDown');
    smoothRotateCamera((Number(right) - Number(left)) * 72, (Number(up) - Number(down)) * 60);
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

    // ড্রাইভিং কিবোর্ড কন্ট্রোল
    window.addEventListener('keydown', (e) => {
        resetIdleTimer();

        if (e.target instanceof HTMLElement && (
            e.target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
        )) {
            return;
        }

        if (e.key === "w" || e.key === "W" || e.key === "PageUp") {
            e.preventDefault();
            stopAutopilot();
            goToStep(currentIndex + 1, true);
        } else if (e.key === "s" || e.key === "S" || e.key === "PageDown") {
            e.preventDefault();
            stopAutopilot();
            goToStep(currentIndex - 1, false);
        } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
            e.preventDefault();
            rotatingKeys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
            updateCameraRotationFromKeys();
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
            e.preventDefault();
            rotatingKeys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
            updateCameraRotationFromKeys();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            rotatingKeys.add(e.key);
            updateCameraRotationFromKeys();
        } else if (e.key === "Home") {
            e.preventDefault();
            stopAutopilot();
            goToStep(0, false);
        } else if (e.key === "End") {
            e.preventDefault();
            stopAutopilot();
            goToStep(tourData.length - 1, false);
        } else if (e.code === "Space" || e.key === " ") {
            e.preventDefault();
            toggleAutopilot();
        } else if (e.key === "f" || e.key === "F") {
            e.preventDefault();
            toggleFullscreen();
        }
    }, true);

    window.addEventListener('keyup', (e) => {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (rotatingKeys.delete(key)) {
            resetIdleTimer();
            updateCameraRotationFromKeys();
        }
    }, true);

    window.addEventListener('blur', () => {
        if (rotatingKeys.size > 0) {
            rotatingKeys.clear();
            smoothRotateCamera(0, 0);
        }
    });

    ['mousemove', 'mousedown', 'wheel', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
}
