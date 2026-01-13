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
        notify: document.getElementById('btn-notify'),
        tryAgain: document.getElementById('btn-try-again')
    };

    const inputs = {
        email: document.getElementById('email-input')
    };

    const msgs = {
        notifySuccess: document.getElementById('notify-success')
    };

    const recordingHint = document.getElementById('recording-hint');
    const hintStart = recordingHint && recordingHint.dataset.start
        ? recordingHint.dataset.start
        : 'Please sing or speak into the microphone.';
    const hintSilence = recordingHint && recordingHint.dataset.silence
        ? recordingHint.dataset.silence
        : 'Please keep singing.';
    const hintContinue = recordingHint && recordingHint.dataset['continue']
        ? recordingHint.dataset['continue']
        : 'Keep going.';
    const hintAlmost = recordingHint && recordingHint.dataset.almost
        ? recordingHint.dataset.almost
        : 'Almost there, keep singing.';
    const hintWait = recordingHint && recordingHint.dataset.wait
        ? recordingHint.dataset.wait
        : 'Great job. Keep singing a bit longer.';
    const hintRetry = recordingHint && recordingHint.dataset.retry
        ? recordingHint.dataset.retry
        : 'Try again.';

    function setRecordingHint(text) {
        if (!recordingHint || !text) {
            return;
        }
        if (recordingHint.textContent !== text) {
            recordingHint.textContent = text;
        }
    }

    const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    function isValidEmail(value) {
        return emailPattern.test(value);
    }

    function trackTiktokEvent(pixelId, eventName, data) {
        if (window.ttq && typeof window.ttq.instance === 'function') {
            const instance = window.ttq.instance(pixelId);
            if (instance && typeof instance.track === 'function') {
                if (data) {
                    instance.track(eventName, data);
                } else {
                    instance.track(eventName);
                }
            }
        }
    }

    function logUserEvent(eventName, data) {
        if (typeof window.logUserEvent !== 'function') {
            return;
        }
        window.logUserEvent(eventName, data).catch(err => {
            console.error('Failed to log user event:', err);
        });
    }

    logUserEvent('opened_website');
    logUserEvent('screen_home');

    let emailTypingStarted = false;
    let emailInputTimeout = null;
    let lastLoggedEmail = '';

    function logEmailInput(value) {
        const trimmed = value.trim();
        if (trimmed === lastLoggedEmail) {
            return;
        }
        lastLoggedEmail = trimmed;
        logUserEvent('email_input_changed', {
            length: trimmed.length,
            isValid: trimmed.length > 0 ? isValidEmail(trimmed) : false
        });
    }

    if (inputs.email) {
        inputs.email.addEventListener('focus', () => {
            logUserEvent('email_input_focused');
        });

        inputs.email.addEventListener('input', () => {
            const value = inputs.email.value;
            if (!emailTypingStarted && value.length > 0) {
                emailTypingStarted = true;
                logUserEvent('email_input_started');
            }

            if (emailInputTimeout) {
                clearTimeout(emailInputTimeout);
            }

            emailInputTimeout = setTimeout(() => {
                logEmailInput(inputs.email.value);
            }, 400);
        });

        inputs.email.addEventListener('blur', () => {
            if (emailInputTimeout) {
                clearTimeout(emailInputTimeout);
                emailInputTimeout = null;
            }
            logEmailInput(inputs.email.value);
            logUserEvent('email_input_blurred');
        });
    }

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
            logUserEvent(`screen_${screenName}`);
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
    let hasSoundStarted = false;
    let listeningStartTime = 0;
    let lastSoundTime = 0;
    let noiseFloor = null;
    let activeSoundMs = 0;
    let lastFrameTime = 0;
    let retryShown = false;
    const minActiveMs = 5000;
    const minTotalMs = 10000;
    const silencePromptMs = 1000;
    const silenceRetryMs = 10000;
    const silenceGraceMs = 1000;
    const hardSoundThreshold = 10;

    function updateRecordingHint(totalElapsed, silenceDuration) {
        if (!recordingHint) {
            return;
        }

        if (retryShown) {
            setRecordingHint(hintRetry);
            return;
        }

        if (!hasSoundStarted) {
            setRecordingHint(hintStart);
            return;
        }

        if (silenceDuration >= silencePromptMs) {
            setRecordingHint(hintSilence);
            return;
        }

        const remainingMs = Math.max(minActiveMs - activeSoundMs, 0);
        if (remainingMs <= 2000 && activeSoundMs < minActiveMs) {
            setRecordingHint(hintAlmost);
            return;
        }

        if (activeSoundMs >= minActiveMs && totalElapsed < minTotalMs) {
            setRecordingHint(hintWait);
            return;
        }

        setRecordingHint(hintContinue);
    }

    function showTryAgain() {
        if (retryShown) {
            return;
        }
        retryShown = true;
        logUserEvent('try_again_shown');
        setRecordingHint(hintRetry);
        if (buttons.tryAgain) {
            buttons.tryAgain.classList.remove('hidden');
        }
        stopRecording();
    }

    async function startRecording() {
        if (isRecording) return;
        isRecording = true;
        hasSoundStarted = false;
        listeningStartTime = 0;
        lastSoundTime = 0;
        noiseFloor = null;
        activeSoundMs = 0;
        lastFrameTime = 0;
        retryShown = false;
        setRecordingHint(hintStart);
        if (buttons.tryAgain) {
            buttons.tryAgain.classList.add('hidden');
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Setup Audio Context
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);

            analyser.fftSize = 64; // Small size for fewer bars
            const frequencyData = new Uint8Array(analyser.frequencyBinCount);
            const timeData = new Uint8Array(analyser.fftSize);
            listeningStartTime = Date.now();

            function renderFrame() {
                if (!isRecording) return;

                analyser.getByteFrequencyData(frequencyData);
                analyser.getByteTimeDomainData(timeData);

                let sumSquares = 0;
                for (let i = 0; i < timeData.length; i++) {
                    const centered = timeData[i] - 128;
                    sumSquares += centered * centered;
                }
                const rms = Math.sqrt(sumSquares / timeData.length);
                if (noiseFloor === null) {
                    noiseFloor = rms;
                } else if (!hasSoundStarted || rms < noiseFloor) {
                    noiseFloor = (noiseFloor * 0.9) + (rms * 0.1);
                }

                const threshold = Math.min(Math.max(noiseFloor + 4, 6), 24);
                const now = Date.now();
                if (!lastFrameTime) {
                    lastFrameTime = now;
                }
                const delta = now - lastFrameTime;
                lastFrameTime = now;

                const isSound = rms > threshold || rms > hardSoundThreshold;
                if (isSound) {
                    lastSoundTime = now;
                    if (!hasSoundStarted) {
                        hasSoundStarted = true;
                    }
                    activeSoundMs += delta;
                } else if (lastSoundTime && now - lastSoundTime <= silenceGraceMs) {
                    activeSoundMs += delta;
                }

                const totalElapsed = now - listeningStartTime;
                const silenceDuration = lastSoundTime ? now - lastSoundTime : totalElapsed;

                if (activeSoundMs >= minActiveMs && totalElapsed >= minTotalMs) {
                    stopRecording();
                    startProcessing();
                    return;
                }

                if (silenceDuration >= silenceRetryMs) {
                    showTryAgain();
                    return;
                }

                updateRecordingHint(totalElapsed, silenceDuration);

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

        } catch (err) {
            console.error('Microphone access denied:', err);
            // Fallback to fake animation if mic denied
            visualizerBars.forEach(bar => {
                bar.style.animation = "sound-wave 1s infinite ease-in-out";
            });

            setRecordingHint('Microphone access is blocked. Please allow it to continue.');
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
        if (recordingTimeout) {
            clearTimeout(recordingTimeout);
            recordingTimeout = null;
        }
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
        logUserEvent('tap_to_hum');
        switchScreen('recording');
        startRecording();
    });

    if (buttons.tryAgain) {
        buttons.tryAgain.addEventListener('click', () => {
            logUserEvent('try_again_clicked');
            startRecording();
        });
    }

    // Cancel Recording
    buttons.stopEarly.addEventListener('click', () => {
        clearTimeout(recordingTimeout);
        stopRecording();
        logUserEvent('recording_cancelled');
        switchScreen('home');
    });

    // 2. Processing
    function startProcessing() {
        logUserEvent('processing_started');
        switchScreen('processing');

        // Simulate 2.5 seconds of searching
        processingTimeout = setTimeout(() => {
            showPaywall();
        }, 2500);
    }

    // 3. Show Paywall
    function showPaywall() {
        logUserEvent('paywall_shown');
        switchScreen('paywall');
    }

    // 4. Pay Button Click -> Notify Screen
    buttons.pay.addEventListener('click', () => {
        trackTiktokEvent('D5IQ5E3C77UAODHQ3EQG', 'PayButtonPressed');
        trackTiktokEvent('D5IQ5E3C77UAODHQ3EQG', 'CompletePayment', {
            value: 1.99,
            currency: 'GBP',
            content_id: 'search_pack_20',
            content_type: 'product'
        });
        logUserEvent('pay_button_pressed');
        switchScreen('notify');
    });

    // 5. Notify Me Action
    buttons.notify.addEventListener('click', async () => {
        const email = inputs.email.value.trim();
        inputs.email.value = email;
        inputs.email.setCustomValidity('');

        if (!email) {
            inputs.email.setCustomValidity('Please enter your email address.');
        } else if (!isValidEmail(email)) {
            inputs.email.setCustomValidity('Please enter a valid email address.');
        }

        if (!inputs.email.checkValidity()) {
            inputs.email.reportValidity();
            inputs.email.focus();
            inputs.email.style.borderColor = "#ff4444";
            setTimeout(() => {
                inputs.email.style.borderColor = "rgba(255,255,255,0.2)";
            }, 1000);
            return;
        }

        const notifyButton = buttons.notify;
        const originalButtonText = notifyButton.textContent;

        notifyButton.disabled = true;
        notifyButton.textContent = "Saving...";

        trackTiktokEvent('D5IQQ1BC77U666PPKKS0', 'NotifyMePressed');

        try {
            if (typeof window.logUserEvent !== 'function' || typeof window.setUserEmail !== 'function') {
                throw new Error('Firebase not initialized');
            }

            await window.logUserEvent('notify_me_pressed', { email });
            await window.setUserEmail(email);

            notifyButton.textContent = "Saved!";
            notifyButton.style.background = "#4CAF50";
            notifyButton.style.color = "white";

            msgs.notifySuccess.classList.remove('hidden');
        } catch (err) {
            console.error('Failed to save email:', err);
            notifyButton.disabled = false;
            notifyButton.textContent = originalButtonText;
            inputs.email.setCustomValidity('Could not save. Please try again.');
            inputs.email.reportValidity();
            inputs.email.style.borderColor = "#ff4444";
            setTimeout(() => {
                inputs.email.style.borderColor = "rgba(255,255,255,0.2)";
            }, 1000);
        }
    });
});
