const params = new URLSearchParams(window.location.search);
const tourName = params.get('tour');
const transitionOverlay = document.getElementById('transition-overlay');

let viewer = null;
let tourData = [];
let currentIndex = 0;
let isTransitioning = false;
const preloadedImages = new Map();
let cameraFrame = null;
let isAutopilotPlaying = false;
let autopilotWaitingForSceneLoad = false;
let autopilotStartedAt = 0;
let autopilotDuration = 2500;
let autopilotStartHfov = 100;
let viewerLoaded = false;
let transitionOverlayFadeHandler = null;
let idleTimer = null;
let zenModeTimeoutMs = 5000;
const rotatingKeys = new Set();
let cameraRotationActive = false;
let isPointerSteering = false;
let isSwayEnabled = false;
let swayStartedAt = 0;
let swayLastAngle = 0;
const swayAmplitude = 10;
const swayPeriodMs = 12000;
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
    viewer.on('load', handleViewerLoad);
    viewer.on('error', handleViewerError);
    viewerLoaded = viewer.isLoaded();

    buildMinimap();
    updatePreloadCache();
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

function updatePreloadCache() {
    const preloadIndexes = [currentIndex + 1, currentIndex + 2, currentIndex + 3, currentIndex - 1]
        .filter(idx => idx >= 0 && idx < tourData.length);
    const preloadIndexSet = new Set(preloadIndexes);

    for (const [idx, image] of preloadedImages) {
        if (!preloadIndexSet.has(idx)) {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute('src');
            preloadedImages.delete(idx);
        }
    }

    preloadIndexes.forEach(idx => {
        if (preloadedImages.has(idx)) return;

        const image = new Image();
        preloadedImages.set(idx, image);
        image.src = `/tours/${encodeURIComponent(tourName)}/${tourData[idx].file}`;
    });
}

// স্মুথ জুম-ইন ট্রানজিশন + কম্পাস অ্যাঙ্গেল লক করে পরের ছবিতে যাওয়া
function goToStep(targetIdx, useZoomEffect = true) {
    if (isTransitioning || targetIdx < 0 || targetIdx >= tourData.length || targetIdx === currentIndex) {
        if (targetIdx >= tourData.length && isAutopilotPlaying) {
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
        updatePreloadCache();
        captureTransitionFrame();
        viewerLoaded = false;
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
        tick.addEventListener('click', () => {
            stopAutopilot();
            goToStep(idx, false);
        });
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
    if (isAutopilotPlaying) {
        stopAutopilot();
    } else {
        startAutopilot();
    }
}

function startAutopilot() {
    if (tourData.length < 2 || isAutopilotPlaying) return;

    if (currentIndex >= tourData.length - 1) {
        goToStep(0, false);
    }
    const btn = document.getElementById('btn-autopilot');
    btn.classList.add('playing');
    btn.innerHTML = "&#10074;&#10074; Pause";

    autopilotDuration = parseInt(document.getElementById('speed-select').value, 10) || 2500;
    isAutopilotPlaying = true;
    if (isSwayEnabled) {
        swayStartedAt = performance.now();
        swayLastAngle = 0;
    }
    if (viewerLoaded) {
        autopilotStartHfov = viewer.getHfov();
        autopilotStartedAt = performance.now();
    } else {
        autopilotWaitingForSceneLoad = true;
    }
    requestCameraFrame();
}

function captureTransitionFrame() {
    const renderer = viewer.getRenderer();
    const canvas = renderer && renderer.getCanvas();
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;

    try {
        transitionOverlay.style.backgroundImage = `url("${canvas.toDataURL('image/jpeg', 0.55)}")`;
        transitionOverlay.classList.add('visible');
    } catch (error) {
        console.warn('Could not capture panorama transition frame:', error);
        clearTransitionOverlay();
    }
}

function clearTransitionOverlay() {
    transitionOverlay.classList.remove('visible');
    transitionOverlay.style.backgroundImage = 'none';
    if (transitionOverlayFadeHandler) {
        transitionOverlay.removeEventListener('transitionend', transitionOverlayFadeHandler);
        transitionOverlayFadeHandler = null;
    }
}

function fadeTransitionOverlay() {
    if (!transitionOverlay.classList.contains('visible')) return;

    if (transitionOverlayFadeHandler) {
        transitionOverlay.removeEventListener('transitionend', transitionOverlayFadeHandler);
    }
    transitionOverlayFadeHandler = (event) => {
        if (event.target !== transitionOverlay || event.propertyName !== 'opacity') return;
        if (!transitionOverlay.classList.contains('visible')) {
            transitionOverlay.style.backgroundImage = 'none';
        }
        transitionOverlay.removeEventListener('transitionend', transitionOverlayFadeHandler);
        transitionOverlayFadeHandler = null;
    };
    transitionOverlay.addEventListener('transitionend', transitionOverlayFadeHandler);
    transitionOverlay.classList.remove('visible');
}

function handleViewerLoad() {
    viewerLoaded = true;
    cameraRotation.lastFrameAt = performance.now();
    fadeTransitionOverlay();
    if (isAutopilotPlaying && autopilotWaitingForSceneLoad) {
        autopilotWaitingForSceneLoad = false;
        autopilotStartHfov = viewer.getHfov();
        autopilotStartedAt = performance.now();
        if (isSwayEnabled) {
            swayLastAngle = getSwayAngle(autopilotStartedAt);
        }
    }
    requestCameraFrame();
}

function handleViewerError(error) {
    console.error('Panorama scene failed to load:', error);
    clearTransitionOverlay();
    viewerLoaded = viewer.isLoaded();
    if (isAutopilotPlaying && autopilotWaitingForSceneLoad) {
        stopAutopilot();
    }
}

function requestCameraFrame() {
    if (!viewerLoaded || (!isAutopilotPlaying && !cameraRotationActive) || cameraFrame !== null) return;
    cameraFrame = requestAnimationFrame(animateCameraFrame);
}

function animateCameraFrame(timestamp) {
    cameraFrame = null;
    if (!viewerLoaded) return;

    let deltaYaw = 0;
    let deltaPitch = 0;
    let deltaSway = 0;
    let rotationSettled = false;

    if (cameraRotationActive) {
        const rotationProgress = Math.min(1, (timestamp - cameraRotation.startedAt) / cameraRotation.duration);
        const yawVelocity = getRotationVelocity(cameraRotation.startYaw, cameraRotation.targetYaw, rotationProgress);
        const pitchVelocity = getRotationVelocity(cameraRotation.startPitch, cameraRotation.targetPitch, rotationProgress);
        const deltaSeconds = Math.min((timestamp - cameraRotation.lastFrameAt) / 1000, 0.05);
        cameraRotation.lastFrameAt = timestamp;
        deltaYaw = yawVelocity * deltaSeconds;
        deltaPitch = pitchVelocity * deltaSeconds;
        rotationSettled = rotationProgress === 1 &&
            cameraRotation.targetYaw === 0 && cameraRotation.targetPitch === 0;
    }

    if (isAutopilotPlaying) {
        if (isSwayEnabled) {
            const swayAngle = getSwayAngle(timestamp);
            const userSteering = isPointerSteering || rotatingKeys.size > 0 || cameraRotationActive;
            if (!userSteering) {
                deltaSway = swayAngle - swayLastAngle;
            }
            swayLastAngle = swayAngle;
        }

        const currentYaw = viewer.getYaw();
        const currentPitch = viewer.getPitch();
        viewer.setYaw(currentYaw + deltaYaw + deltaSway, false);
        viewer.setPitch(Math.max(-90, Math.min(90, currentPitch + deltaPitch)), false);

        const progress = Math.min(1, (timestamp - autopilotStartedAt) / autopilotDuration);
        const hfov = autopilotStartHfov + (82 - autopilotStartHfov) * progress;
        viewer.setHfov(hfov, false);

        if (progress === 1) {
            const nextIndex = currentIndex + 1;
            if (nextIndex >= tourData.length) {
                stopAutopilot();
                return;
            }

            const oldHeadingDeg = (tourData[currentIndex].heading * 180) / Math.PI;
            const worldCompassBearing = (oldHeadingDeg + viewer.getYaw() + 360) % 360;
            const newHeadingDeg = (tourData[nextIndex].heading * 180) / Math.PI;
            const targetYaw = normalizeYaw(worldCompassBearing - newHeadingDeg);
            const targetPitch = viewer.getPitch();

            currentIndex = nextIndex;
            updatePreloadCache();
            captureTransitionFrame();
            viewerLoaded = false;
            autopilotWaitingForSceneLoad = true;
            viewer.loadScene("scene_" + nextIndex, targetPitch, targetYaw, 96);
            updateUI(nextIndex);

            if (nextIndex >= tourData.length - 1) {
                stopAutopilot();
                return;
            }
        }
    } else if (cameraRotationActive) {
        viewer.setYaw(viewer.getYaw() + deltaYaw, false);
        viewer.setPitch(Math.max(-90, Math.min(90, viewer.getPitch() + deltaPitch)), false);
    }

    if (rotationSettled) {
        cameraRotationActive = false;
        cameraRotation.startYaw = 0;
        cameraRotation.startPitch = 0;
    }

    requestCameraFrame();
}

function stopAutopilot() {
    isAutopilotPlaying = false;
    autopilotWaitingForSceneLoad = false;
    if (!cameraRotationActive && cameraFrame !== null) {
        cancelAnimationFrame(cameraFrame);
        cameraFrame = null;
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

function getSwayAngle(timestamp) {
    const phase = ((timestamp - swayStartedAt) / swayPeriodMs) * Math.PI * 2;
    return Math.sin(phase) * swayAmplitude;
}

function toggleSway() {
    isSwayEnabled = !isSwayEnabled;
    const button = document.getElementById('btn-sway');
    button.setAttribute('aria-pressed', String(isSwayEnabled));
    if (isSwayEnabled) {
        swayStartedAt = performance.now();
        swayLastAngle = 0;
    }
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

    cameraRotationActive = true;
    requestCameraFrame();
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
        if (isAutopilotPlaying) {
            autopilotDuration = parseInt(document.getElementById('speed-select').value, 10) || 2500;
            if (viewerLoaded && !autopilotWaitingForSceneLoad) {
                autopilotStartHfov = viewer.getHfov();
                autopilotStartedAt = performance.now();
            }
        }
    });

    document.getElementById('btn-sway').addEventListener('click', toggleSway);
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
            e.stopPropagation();
            stopAutopilot();
            goToStep(currentIndex + 1, true);
        } else if (e.key === "s" || e.key === "S" || e.key === "PageDown") {
            e.preventDefault();
            e.stopPropagation();
            stopAutopilot();
            goToStep(currentIndex - 1, false);
        } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
            e.preventDefault();
            e.stopPropagation();
            rotatingKeys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
            updateCameraRotationFromKeys();
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
            e.preventDefault();
            e.stopPropagation();
            rotatingKeys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
            updateCameraRotationFromKeys();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            rotatingKeys.add(e.key);
            updateCameraRotationFromKeys();
        } else if (e.key === "Home") {
            e.preventDefault();
            e.stopPropagation();
            stopAutopilot();
            goToStep(0, false);
        } else if (e.key === "End") {
            e.preventDefault();
            e.stopPropagation();
            stopAutopilot();
            goToStep(tourData.length - 1, false);
        } else if (e.code === "Space" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            toggleAutopilot();
        } else if (e.key === "f" || e.key === "F") {
            e.preventDefault();
            e.stopPropagation();
            toggleFullscreen();
        }
    }, true);

    window.addEventListener('keyup', (e) => {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (rotatingKeys.delete(key)) {
            e.stopPropagation();
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

    window.addEventListener('pointerdown', () => {
        isPointerSteering = true;
    }, { passive: true });

    ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'].forEach(evt => {
        window.addEventListener(evt, () => {
            isPointerSteering = false;
        }, { passive: true });
    });

    ['mousemove', 'mousedown', 'wheel', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
}
