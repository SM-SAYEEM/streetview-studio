const params = new URLSearchParams(window.location.search);
const tourName = params.get('tour');
const transitionOverlay = document.getElementById('transition-overlay');
const routeMap = document.getElementById('route-map');
const routeMapCanvas = document.getElementById('route-map-canvas');

let viewer = null;
let tourData = [];
let currentIndex = 0;
let routeMapContext = null;
let routeMapPoints = [];
let routeMapWidth = 0;
let routeMapHeight = 0;
let ambientAudioUrl = null;
let ambientAudio = null;
let audioLookupError = null;
let audioMessageTimer = null;
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

setupRouteMap();
setupSoundscape();

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
            resizeRouteMap();
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
    viewer.on('animatefinished', drawMiniMap);
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
    drawMiniMap();
}

function setupRouteMap() {
    routeMapCanvas.addEventListener('click', jumpToNearestRoutePoint);
    document.getElementById('route-map-collapse').addEventListener('click', toggleRouteMapCollapse);
    document.getElementById('route-map-toggle').addEventListener('click', toggleRouteMapVisibility);
    window.addEventListener('keydown', (event) => {
        if ((event.key === 'm' || event.key === 'M') &&
            !(event.target instanceof HTMLElement && (
                event.target.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
            ))) {
            event.preventDefault();
            toggleRouteMapVisibility();
            resetIdleTimer();
        }
    }, true);
    window.addEventListener('resize', resizeRouteMap, { passive: true });
    resizeRouteMap();
    drawMiniMap();
}

function setupSoundscape() {
    const soundButton = document.getElementById('btn-sound');
    const message = document.getElementById('sound-message');
    const audioLookup = fetch('/api/audio')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Audio lookup failed with HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (!data || typeof data.available !== 'boolean') {
                throw new Error('Audio lookup returned an invalid response.');
            }
            ambientAudioUrl = data.available && typeof data.url === 'string' ? data.url : null;
        })
        .catch(error => {
            audioLookupError = error;
            console.error(error);
        });

    soundButton.addEventListener('click', async () => {
        await audioLookup;
        if (audioLookupError) {
            showSoundMessage('Could not check for audio. Please try again later.');
            return;
        }
        if (!ambientAudioUrl) {
            showSoundMessage('No audio found. Add an .mp3, .ogg, or .wav file to studio/audio/.');
            return;
        }

        if (ambientAudio && !ambientAudio.paused) {
            ambientAudio.pause();
            soundButton.textContent = '🔇 Sound';
            soundButton.setAttribute('aria-pressed', 'false');
            return;
        }

        if (!ambientAudio) {
            ambientAudio = new Audio(ambientAudioUrl);
            ambientAudio.loop = true;
            ambientAudio.volume = 0.35;
        }
        try {
            await ambientAudio.play();
            soundButton.textContent = '🔊 Sound';
            soundButton.setAttribute('aria-pressed', 'true');
        } catch (error) {
            console.error('Could not play ambient audio:', error);
            showSoundMessage('Could not play the audio file. Check its format and try again.');
        }
    });

    function showSoundMessage(text) {
        message.textContent = text;
        message.hidden = false;
        clearTimeout(audioMessageTimer);
        audioMessageTimer = setTimeout(() => {
            message.hidden = true;
        }, 4000);
    }
}

function resizeRouteMap() {
    const rect = routeMapCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * pixelRatio);
    const pixelHeight = Math.round(rect.height * pixelRatio);
    if (routeMapCanvas.width !== pixelWidth || routeMapCanvas.height !== pixelHeight) {
        routeMapCanvas.width = pixelWidth;
        routeMapCanvas.height = pixelHeight;
    }

    routeMapContext = routeMapCanvas.getContext('2d');
    if (!routeMapContext) {
        console.error('Could not initialize the route map canvas context.');
        return;
    }
    routeMapContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    routeMapWidth = rect.width;
    routeMapHeight = rect.height;

    const hasCompleteCoordinates = tourData.length > 0 && tourData.every(item => {
        if (!item || item.lat === null || item.lat === undefined ||
            item.lon === null || item.lon === undefined ||
            String(item.lat).trim() === '' || String(item.lon).trim() === '') return false;
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) &&
            lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    });
    const coordinates = hasCompleteCoordinates
        ? tourData.map((item, index) => ({
            index,
            lat: Number(item.lat),
            lon: Number(item.lon)
        }))
        : tourData.map((item, index) => ({
            index,
            x: index,
            y: Math.sin(index * 0.7)
        }));

    if (coordinates.length === 0) {
        routeMapPoints = [];
        drawMiniMap();
        return;
    }

    if (hasCompleteCoordinates) {
        const meanLatitude = coordinates.reduce((sum, point) => sum + point.lat, 0) / coordinates.length;
        const longitudeScale = Math.cos(meanLatitude * Math.PI / 180);
        coordinates.forEach(point => {
            point.x = point.lon * longitudeScale;
            point.y = point.lat;
        });
    }

    const bounds = coordinates.reduce((result, point) => ({
        minX: Math.min(result.minX, point.x),
        maxX: Math.max(result.maxX, point.x),
        minY: Math.min(result.minY, point.y),
        maxY: Math.max(result.maxY, point.y)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const padding = 26;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const scale = Math.min(
        (routeMapWidth - padding * 2) / (spanX || 1),
        (routeMapHeight - padding * 2) / (spanY || 1)
    );
    const offsetX = (routeMapWidth - spanX * scale) / 2;
    const offsetY = (routeMapHeight - spanY * scale) / 2;

    routeMapPoints = coordinates.map(point => ({
        index: point.index,
        x: offsetX + (point.x - bounds.minX) * scale,
        y: routeMapHeight - offsetY - (point.y - bounds.minY) * scale
    }));
    drawMiniMap();
}

function drawMiniMap() {
    if (!routeMapContext || routeMap.classList.contains('map-hidden') ||
        routeMap.classList.contains('collapsed')) return;

    const context = routeMapContext;
    context.clearRect(0, 0, routeMapWidth, routeMapHeight);
    context.font = '10px sans-serif';
    context.fillStyle = 'rgba(226, 232, 240, 0.72)';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText('N', routeMapWidth / 2, 4);
    context.textBaseline = 'bottom';
    context.fillText('S', routeMapWidth / 2, routeMapHeight - 3);
    context.textBaseline = 'middle';
    context.fillText('W', 7, routeMapHeight / 2);
    context.fillText('E', routeMapWidth - 7, routeMapHeight / 2);

    if (routeMapPoints.length === 0) {
        context.fillStyle = 'rgba(203, 213, 225, 0.8)';
        context.font = '12px sans-serif';
        context.textAlign = 'center';
        context.fillText('No route coordinates', routeMapWidth / 2, routeMapHeight / 2);
        return;
    }

    context.beginPath();
    routeMapPoints.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
    });
    context.lineWidth = 2.5;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = '#38bdf8';
    context.stroke();

    drawRouteMapMarker(routeMapPoints[0], '#34d399', 4);
    if (routeMapPoints.length > 1) {
        drawRouteMapMarker(routeMapPoints[routeMapPoints.length - 1], '#fb7185', 4);
    }

    const currentPoint = routeMapPoints.find(point => point.index === currentIndex);
    if (!currentPoint) return;

    const bearing = getWorldCompassBearing();
    if (bearing !== null) {
        const direction = (bearing - 90) * Math.PI / 180;
        const coneRadius = 24;
        context.beginPath();
        context.moveTo(currentPoint.x, currentPoint.y);
        context.arc(currentPoint.x, currentPoint.y, coneRadius, direction - 0.32, direction + 0.32);
        context.closePath();
        context.fillStyle = 'rgba(250, 204, 21, 0.2)';
        context.fill();
        context.strokeStyle = 'rgba(250, 204, 21, 0.55)';
        context.lineWidth = 1;
        context.stroke();
    }
    drawRouteMapMarker(currentPoint, '#facc15', 5);
}

function drawRouteMapMarker(point, color, radius) {
    const context = routeMapContext;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = 'rgba(15, 23, 42, 0.9)';
    context.stroke();
}

function getWorldCompassBearing() {
    if (!viewer || !tourData[currentIndex]) return null;
    const heading = Number(tourData[currentIndex].heading);
    if (!Number.isFinite(heading)) return null;
    return (heading * 180 / Math.PI + viewer.getYaw() + 360) % 360;
}

function jumpToNearestRoutePoint(event) {
    if (routeMapPoints.length === 0) return;
    const rect = routeMapCanvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    let nearestPoint = routeMapPoints[0];
    let nearestDistance = Infinity;

    routeMapPoints.forEach(point => {
        const dx = point.x - clickX;
        const dy = point.y - clickY;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = point;
        }
    });

    stopAutopilot();
    goToStep(nearestPoint.index, false);
}

function toggleRouteMapCollapse() {
    const button = document.getElementById('route-map-collapse');
    const collapsed = routeMap.classList.toggle('collapsed');
    button.textContent = collapsed ? '+' : '−';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand route map' : 'Collapse route map');
    if (!collapsed) resizeRouteMap();
}

function toggleRouteMapVisibility() {
    const hidden = routeMap.classList.toggle('map-hidden');
    routeMap.setAttribute('aria-hidden', String(hidden));
    const toggle = document.getElementById('route-map-toggle');
    toggle.setAttribute('aria-pressed', String(!hidden));
    toggle.textContent = hidden ? 'Map' : 'Map ✓';
    if (!hidden) resizeRouteMap();
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
    drawMiniMap();
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
        drawMiniMap();

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
        drawMiniMap();
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

    window.addEventListener('mousemove', () => {
        resetIdleTimer();
        if (isPointerSteering) drawMiniMap();
    }, { passive: true });

    window.addEventListener('touchmove', drawMiniMap, { passive: true });

    ['mousedown', 'wheel', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
}
