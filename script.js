
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const cameraMessage = document.getElementById("camera-message");
const systemMessage = document.getElementById("system-message");

const postureIndicator = document.getElementById("posture-indicator");
const postureText = document.getElementById("posture-text");
const postureDescription = document.getElementById("posture-description");

const neckValue = document.getElementById("neck-value");
const torsoValue = document.getElementById("torso-value");
const shoulderValue = document.getElementById("shoulder-value");

const neckBar = document.getElementById("neck-bar");
const torsoBar = document.getElementById("torso-bar");
const shoulderStatus = document.getElementById("shoulder-status");

const timerDisplay = document.getElementById("timer");
const timerBar = document.getElementById("timer-bar");
const timerDescription = document.getElementById("timer-description");
const cameraClock = document.getElementById("camera-clock");

const NECK_LIMIT = 40;
const TORSO_LIMIT = 10;
const BAD_POSTURE_LIMIT = 180;
const SHOULDER_LIMIT = 0.08;

let pose;
let camera;
let running = false;
let badPostureStart = null;
let alertPlayed = false;
let sessionStart = null;
let animationFrame = null;
let audioContext = null;

function midpoint(pointA, pointB) {
    return {
        x: (pointA.x + pointB.x) / 2,
        y: (pointA.y + pointB.y) / 2
    };
}

function calculateAngleFromVertical(pointA, pointB) {
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;

    const angle = Math.atan2(Math.abs(dx), Math.abs(dy)) * 180 / Math.PI;

    return angle;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(remainingSeconds).padStart(2, "0")
    );
}

function updateClock() {
    if (!running || sessionStart === null) return;

    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);

    const hours = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const seconds = String(elapsed % 60).padStart(2, "0");

    cameraClock.textContent = `${hours}:${minutes}:${seconds}`;

    animationFrame = requestAnimationFrame(updateClock);
}

function setPostureStatus(status, description) {
    postureIndicator.className = "posture-indicator " + status;
    postureText.textContent =
        status === "good" ? "Postura adequada" :
        status === "bad" ? "Postura inadequada" :
        "Aguardando análise";

    postureDescription.textContent = description;
}

function updateMetric(bar, value, maximum) {
    const percentage = Math.min((value / maximum) * 100, 100);
    bar.style.width = `${percentage}%`;
}

function resetTimer() {
    badPostureStart = null;
    alertPlayed = false;
    timerDisplay.textContent = "00:00";
    timerBar.style.width = "0%";

    timerDescription.textContent =
        "O contador começa quando uma postura inadequada é detectada.";
}

function updateBadPostureTimer(isBad) {
    if (!isBad) {
        resetTimer();
        return;
    }

    if (badPostureStart === null) {
        badPostureStart = Date.now();
    }

    const elapsed = Math.floor((Date.now() - badPostureStart) / 1000);
    const progress = Math.min((elapsed / BAD_POSTURE_LIMIT) * 100, 100);

    timerDisplay.textContent = formatTime(elapsed);
    timerBar.style.width = `${progress}%`;

    if (elapsed >= BAD_POSTURE_LIMIT) {
        timerDescription.textContent =
            "Atenção! A postura inadequada persistiu por 3 minutos.";

        if (!alertPlayed) {
            alertPlayed = true;
            showPostureAlert();
        }
    } else {
        timerDescription.textContent =
            `Alerta em ${formatTime(BAD_POSTURE_LIMIT - elapsed)}.`;
    }
}

function showPostureAlert() {
    postureDescription.textContent =
        "Atenção! Corrija sua posição e alinhe o pescoço e o tronco.";

    systemMessage.textContent =
        "ALERTA: postura inadequada detectada por 3 minutos.";

    playAlertSound();

    alert(
        "AEROTECH - ALERTA POSTURAL\n\n" +
        "Sua postura inadequada foi detectada por 3 minutos.\n" +
        "Tente ajustar sua posição."
    );
}

function playAlertSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gain.gain.value = 0.15;

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start();

        gain.gain.exponentialRampToValueAtTime(
            0.001,
            audioContext.currentTime + 1
        );

        oscillator.stop(audioContext.currentTime + 1);
    } catch (error) {
        console.error("Não foi possível reproduzir o alerta:", error);
    }
}

function resetMetrics() {
    neckValue.textContent = "--°";
    torsoValue.textContent = "--°";
    shoulderValue.textContent = "--";

    neckBar.style.width = "0%";
    torsoBar.style.width = "0%";

    shoulderStatus.textContent = "Aguardando detecção";

    setPostureStatus(
        "waiting",
        "Aguardando detecção dos pontos corporais."
    );

    resetTimer();
}

function onResults(results) {
    if (!running) return;

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) return;

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    ctx.translate(width, 0);
    ctx.scale(-1, 1);

    ctx.drawImage(results.image, 0, 0, width, height);

    ctx.restore();

    const landmarks = results.poseLandmarks;

    if (!landmarks) {
        resetMetrics();

        systemMessage.textContent =
            "Pessoa não identificada. Posicione-se diante da câmera.";

        return;
    }

    const visibilityThreshold = 0.5;

    const requiredPoints = [7, 8, 11, 12, 23, 24];

    const visible = requiredPoints.every(index =>
        landmarks[index] &&
        landmarks[index].visibility >= visibilityThreshold
    );

    if (!visible) {
        resetMetrics();

        systemMessage.textContent =
            "Não foi possível identificar todos os pontos. Ajuste sua posição.";

        return;
    }

    const leftEar = landmarks[7];
    const rightEar = landmarks[8];

    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const earCenter = midpoint(leftEar, rightEar);
    const shoulderCenter = midpoint(leftShoulder, rightShoulder);
    const hipCenter = midpoint(leftHip, rightHip);

    const neckAngle = calculateAngleFromVertical(
        shoulderCenter,
        earCenter
    );

    const torsoAngle = calculateAngleFromVertical(
        shoulderCenter,
        hipCenter
    );

    const shoulderDifference = Math.abs(
        leftShoulder.y - rightShoulder.y
    );

    const shouldersAligned = shoulderDifference <= SHOULDER_LIMIT;

    const neckBad = neckAngle > NECK_LIMIT;
    const torsoBad = torsoAngle > TORSO_LIMIT;

    const isBad = neckBad || torsoBad || !shouldersAligned;

    neckValue.textContent = `${neckAngle.toFixed(1)}°`;
    torsoValue.textContent = `${torsoAngle.toFixed(1)}°`;

    updateMetric(neckBar, neckAngle, 90);
    updateMetric(torsoBar, torsoAngle, 30);

    shoulderValue.textContent = shouldersAligned ? "OK" : "DESALINHADO";

    shoulderStatus.textContent = shouldersAligned
        ? "Ombros alinhados"
        : "Verifique o alinhamento dos ombros";

    if (isBad) {
        let reasons = [];

        if (neckBad) reasons.push("inclinação do pescoço");
        if (torsoBad) reasons.push("inclinação do tronco");
        if (!shouldersAligned) reasons.push("desalinhamento dos ombros");

        setPostureStatus(
            "bad",
            "Verifique: " + reasons.join(", ") + "."
        );
    } else {
        setPostureStatus(
            "good",
            "Os ângulos estão dentro dos limites configurados."
        );
    }

    updateBadPostureTimer(isBad);

    systemMessage.textContent =
        "Análise em andamento. Os pontos corporais estão sendo acompanhados.";
}

async function startMonitoring() {
    if (running) return;

    startButton.disabled = true;
    systemMessage.textContent = "Inicializando câmera e modelo de visão computacional...";

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error(
                "Seu navegador não permite acesso à webcam neste endereço. Use localhost ou HTTPS."
            );
        }

        pose = new Pose({
            locateFile: file =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });

        pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        pose.onResults(onResults);

        camera = new Camera(video, {
            onFrame: async () => {
                if (running) {
                    await pose.send({ image: video });
                }
            },
            width: 640,
            height: 480
        });

        await camera.start();

        running = true;
        sessionStart = Date.now();

        cameraMessage.classList.add("hidden");

        startButton.disabled = true;
        stopButton.disabled = false;

        systemMessage.textContent = "Monitoramento iniciado.";

        updateClock();

    } catch (error) {
        console.error(error);

        systemMessage.textContent =
            "Erro ao iniciar: " + error.message;

        startButton.disabled = false;
        running = false;
    }
}

async function stopMonitoring() {
    running = false;

    if (camera) {
        camera.stop();
        camera = null;
    }

    if (pose) {
        await pose.close();
        pose = null;
    }

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    cameraMessage.classList.remove("hidden");

    startButton.disabled = false;
    stopButton.disabled = true;

    systemMessage.textContent = "Monitoramento encerrado.";

    sessionStart = null;
    cameraClock.textContent = "00:00:00";

    resetMetrics();
}

startButton.addEventListener("click", startMonitoring);
stopButton.addEventListener("click", stopMonitoring);

resetMetrics();