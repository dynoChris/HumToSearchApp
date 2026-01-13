document.addEventListener('DOMContentLoaded', () => {
    // === DOM ELEMENTS ===
    const screens = {
        home: document.getElementById('screen-home'),
        recording: document.getElementById('screen-recording'),
        processing: document.getElementById('screen-processing'),
        paywall: document.getElementById('screen-paywall'),
        notify: document.getElementById('screen-notify')
    };

    const buttons = {
        start: document.getElementById('btn-start'),
        stopEarly: document.getElementById('btn-stop-early'),
        pay: document.getElementById('btn-pay'),
        notify: document.getElementById('btn-notify')
    };

    const inputs = {
        email: document.getElementById('email-input')
    };

    const msgs = {
        notifySuccess: document.getElementById('notify-success')
    };

    // === STATE MANAGEMENT ===
    let recordingTimeout;
    let processingTimeout;

    function switchScreen(screenName) {
        // Hide all screens
        Object.values(screens).forEach(s => {
            s.classList.remove('active');
            // Adding a small delay to display:none to allow fade out
            setTimeout(() => {
                if (!s.classList.contains('active')) {
                    s.classList.add('hidden');
                }
            }, 500);
        });

        const target = screens[screenName];
        if (target) {
            target.classList.remove('hidden');
            // Small delay to allow display:block to apply before opacity transition
            requestAnimationFrame(() => {
                target.classList.add('active');
            });
        }
    }

    // === VISUALIZER & AUDIO ===
    const visualizerBars = document.querySelectorAll('.visualizer .bar');
    let audioContext;
    let analyser;
    let microphone;
    let javascriptNode;
    let animationId;
    let isRecording = false;

    async function startRecording() {
        if (isRecording) return;
        isRecording = true;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Setup Audio Context
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);

            analyser.fftSize = 64; // Small size for fewer bars
            const frequencyData = new Uint8Array(analyser.frequencyBinCount);

            function renderFrame() {
                if (!isRecording) return;

                analyser.getByteFrequencyData(frequencyData);

                // Map frequency data to 5 bars
                // We'll take 5 roughly spaced indices from the frequency data
                // fftSize 64 gives 32 bins. We can pick indices 0, 3, 7, 12, 20 for spread.
                const indices = [1, 3, 6, 12, 18];

                visualizerBars.forEach((bar, i) => {
                    const value = frequencyData[indices[i]] || 0;
                    // Scale value (0-255) to height (10px-70px)
                    const height = 10 + (value / 255) * 60;
                    bar.style.height = `${height}px`;
                    bar.style.opacity = 0.5 + (value / 255) * 0.5;
                });

                animationId = requestAnimationFrame(renderFrame);
            }

            renderFrame();

            // Start the 10-second timer ONLY after mic is active
            recordingTimeout = setTimeout(() => {
                stopRecording();
                startProcessing();
            }, 10000);

        } catch (err) {
            console.error('Microphone access denied:', err);
            // Fallback to fake animation if mic denied
            visualizerBars.forEach(bar => {
                bar.style.animation = "sound-wave 1s infinite ease-in-out";
            });

            // Fallback: wait 10s if mic denied
            recordingTimeout = setTimeout(() => {
                stopRecording();
                startProcessing();
            }, 10000);
        }
    }

    function stopRecording() {
        isRecording = false;
        if (animationId) cancelAnimationFrame(animationId);
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
        // Reset bars
        visualizerBars.forEach(bar => {
            bar.style.height = '10px';
            bar.style.animation = '';
        });
    }


    // === FLOW CONTROL ===

    // 1. Start Recording
    buttons.start.addEventListener('click', () => {
        switchScreen('recording');
        startRecording();
    });

    // Cancel Recording
    buttons.stopEarly.addEventListener('click', () => {
        clearTimeout(recordingTimeout);
        stopRecording();
        switchScreen('home');
    });

    // 2. Processing
    function startProcessing() {
        switchScreen('processing');

        // Simulate 2.5 seconds of searching
        processingTimeout = setTimeout(() => {
            showPaywall();
        }, 2500);
    }

    // 3. Show Paywall
    function showPaywall() {
        switchScreen('paywall');
    }

    // 4. Pay Button Click -> Notify Screen
    buttons.pay.addEventListener('click', () => {
        switchScreen('notify');
    });

    // 5. Notify Me Action
    buttons.notify.addEventListener('click', () => {
        const email = inputs.email.value;
        if (email && email.includes('@')) {
            // Mock success
            btns = buttons.notify;
            btns.textContent = "Saved!";
            btns.style.background = "#4CAF50";
            btns.style.color = "white";

            msgs.notifySuccess.classList.remove('hidden');

            // Disable button
            btns.disabled = true;
        } else {
            // Simple validation error
            inputs.email.style.borderColor = "#ff4444";
            setTimeout(() => {
                inputs.email.style.borderColor = "rgba(255,255,255,0.2)";
            }, 1000);
        }
    });
});
