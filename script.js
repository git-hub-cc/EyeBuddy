document.addEventListener('DOMContentLoaded', () => {

    // ===================================================================
    // == CORE SYSTEMS & UTILITIES
    // ===================================================================

    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const AppStore = {
        _state: {
            activeTab: 'eyeChart',
            eyeChart: { size: 50, blurAmount: 0, blurSpeed: 3 },
            tracking: { path: 'linear', speed: 5, flashFrequency: 0 },
            saccades: { speed: 1, targets: 2 }
        },
        init() { this.loadState(); },
        getState() { return this._state; },
        updateSetting(keyPath, value) { const keys = keyPath.split('.'); let obj = this._state; for (let i = 0; i < keys.length - 1; i++) { obj = obj[keys[i]]; } obj[keys[keys.length - 1]] = value; this.saveState(); EventBus.publish('state:changed', { keyPath, value }); },
        saveState() { localStorage.setItem('eyeBuddyState', JSON.stringify(this._state)); },
        loadState() { const savedState = localStorage.getItem('eyeBuddyState'); if (savedState) { const loaded = JSON.parse(savedState); Object.keys(this._state).forEach(key => { if (loaded[key]) { if (typeof this._state[key] === 'object' && this._state[key] !== null) { Object.assign(this._state[key], loaded[key]); } else { this._state[key] = loaded[key]; } } }); } }
    };

    const EventBus = {
        _events: {},
        subscribe(eventName, callback) { if (!this._events[eventName]) { this._events[eventName] = []; } this._events[eventName].push(callback); },
        publish(eventName, data) { if (this._events[eventName]) { this._events[eventName].forEach(callback => callback(data)); } }
    };

    // ===================================================================
    // == NEW MODULE: FULLSCREEN & RESIZE MANAGER
    // ===================================================================
    const FullscreenModule = {
        init() {
            window.addEventListener('resize', debounce(() => this.onResize(), 250));
            document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
            this.onResize(); // Initial resize
        },
        enter() {
            if (document.fullscreenElement) return;
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        },
        exit() {
            if (!document.fullscreenElement) return;
            document.exitFullscreen();
        },
        onResize() {
            EventBus.publish('canvas:resized');
        },
        onFullscreenChange() {
            document.body.classList.toggle('fullscreen-active', !!document.fullscreenElement);
            // Allow time for CSS transitions before resizing
            setTimeout(() => this.onResize(), 150);
        }
    };


    // ===================================================================
    // == UI MODULE: TABS
    // ===================================================================
    const TabsModule = {
        init() { this.tabButtons = document.querySelectorAll('.tab-button'); this.tabContents = document.querySelectorAll('.tab-content'); this.tabButtons.forEach(button => { button.addEventListener('click', () => { const targetTabId = button.dataset.tab; AppStore.updateSetting('activeTab', targetTabId); }); }); EventBus.subscribe('state:changed', (data) => { if (data.keyPath === 'activeTab') { this.setActiveTab(data.value); } }); this.setActiveTab(AppStore.getState().activeTab); },
        setActiveTab(targetTabId) { EventBus.publish('app:stopAllAnimations'); this.tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === targetTabId)); this.tabContents.forEach(content => content.classList.toggle('active', content.id === targetTabId)); EventBus.publish('tab:changed', { newTabId: targetTabId }); }
    };

    // ===================================================================
    // == TRAINING MODULE: EYE CHART & BLUR (MODIFIED)
    // ===================================================================
    const EyeChartModule = {
        init() {
            this.canvas = document.getElementById('eyeChartCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.sizeInput = document.getElementById('chartSize');
            this.blurAmountInput = document.getElementById('blurAmount');
            this.blurSpeedInput = document.getElementById('blurSpeed');
            this.toggleBlurButton = document.getElementById('toggleBlur');

            this.blurInterval = null;
            this.isBlurringUp = true;
            this.eDirections = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

            this.bindEvents();
            this.updateControlsFromState();
            this.resize();
        },

        resize() {
            const parent = this.canvas.parentElement;
            // Respect the aspect ratio set in CSS
            this.canvas.width = this.canvas.clientWidth;
            this.canvas.height = this.canvas.clientHeight;
            this.draw();
        },

        // NEW: Apply non-linear (cubic) mapping to blur for better control at low values
        _calculateNonLinearBlur(value) {
            const maxInput = 20;
            const maxOutput = 20;
            const normalized = value / maxInput; // 0 to 1
            const skewed = Math.pow(normalized, 3); // Cubic curve
            return skewed * maxOutput;
        },

        bindEvents() {
            this.sizeInput.addEventListener('input', e => AppStore.updateSetting('eyeChart.size', parseInt(e.target.value)));
            this.blurAmountInput.addEventListener('input', e => AppStore.updateSetting('eyeChart.blurAmount', parseFloat(e.target.value)));
            this.blurSpeedInput.addEventListener('input', e => AppStore.updateSetting('eyeChart.blurSpeed', parseInt(e.target.value)));
            this.toggleBlurButton.addEventListener('click', () => this.toggleBlurCycle());

            EventBus.subscribe('state:changed', (data) => {
                if (data.keyPath.startsWith('eyeChart.')) {
                    this.updateControlsFromState();
                    this.draw();
                }
                if (data.keyPath === 'eyeChart.blurSpeed' && this.blurInterval) {
                    this.stopBlurCycle(false);
                    this.startBlurCycle();
                }
            });

            EventBus.subscribe('tab:changed', (data) => {
                if (data.newTabId === 'eyeChart') this.resize();
            });

            EventBus.subscribe('app:stopAllAnimations', () => this.stopBlurCycle(true));
            EventBus.subscribe('canvas:resized', () => {
                if(AppStore.getState().activeTab === 'eyeChart') this.resize();
            });
        },

        updateControlsFromState() {
            const state = AppStore.getState().eyeChart; this.sizeInput.value = state.size; this.blurAmountInput.value = state.blurAmount; this.blurSpeedInput.value = state.blurSpeed;
        },

        draw() {
            const state = AppStore.getState().eyeChart;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            const displayBlur = this._calculateNonLinearBlur(state.blurAmount);
            this.canvas.style.filter = `blur(${displayBlur}px)`;
            const eChartLevels = [ { unitSizeMultiplier: 1.0, eCount: 1 }, { unitSizeMultiplier: 0.8, eCount: 2 }, { unitSizeMultiplier: 0.6, eCount: 3 }, { unitSizeMultiplier: 0.4, eCount: 4 }, { unitSizeMultiplier: 0.3, eCount: 5 }, { unitSizeMultiplier: 0.25, eCount: 6 } ]; const maxUnitSize = this.canvas.width / 15; const minUnitSize = this.canvas.width / 100; const baseUnitSize = minUnitSize + (maxUnitSize - minUnitSize) * (state.size / 100); let currentY = this.canvas.height * 0.1; eChartLevels.forEach(level => { const rowUnitSize = baseUnitSize * level.unitSizeMultiplier; const ePixelWidth = rowUnitSize * 5; const spacingUnit = rowUnitSize; const totalRowOccupiedWidth = level.eCount * (ePixelWidth + spacingUnit) - spacingUnit; const startX = (this.canvas.width - totalRowOccupiedWidth) / 2; for (let i = 0; i < level.eCount; i++) { const eX = startX + i * (ePixelWidth + spacingUnit); this._drawE(this.ctx, eX, currentY, rowUnitSize, this._getRandomEDirection()); } currentY += ePixelWidth + spacingUnit * 2; });
        },

        _drawE(ctx, x, y, unitSize, rotation) {
            const centerX = x + 2.5 * unitSize; const centerY = y + 2.5 * unitSize; ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(rotation); ctx.fillStyle = '#333'; ctx.fillRect(-2.5 * unitSize, -2.5 * unitSize, unitSize, 5 * unitSize); ctx.fillRect(-2.5 * unitSize, -2.5 * unitSize, 5 * unitSize, unitSize); ctx.fillRect(-2.5 * unitSize, -0.5 * unitSize, 4 * unitSize, unitSize); ctx.fillRect(-2.5 * unitSize, 1.5 * unitSize, 5 * unitSize, unitSize); ctx.restore();
        },

        _getRandomEDirection() {
            return this.eDirections[Math.floor(Math.random() * this.eDirections.length)];
        },

        toggleBlurCycle() {
            if (this.blurInterval) {
                this.stopBlurCycle(true);
            } else {
                this.startBlurCycle();
            }
        },

        startBlurCycle() {
            FullscreenModule.enter();
            this.toggleBlurButton.textContent = '停止模糊循环';
            this.blurAmountInput.disabled = true;
            const state = AppStore.getState().eyeChart;
            const intervalTime = 500 - (state.blurSpeed * 80);

            this.blurInterval = setInterval(() => {
                let currentBlur = AppStore.getState().eyeChart.blurAmount; if (this.isBlurringUp) { currentBlur += 0.3; if (currentBlur >= 20) { currentBlur = 20; this.isBlurringUp = false; } } else { currentBlur -= 0.3; if (currentBlur <= 0) { currentBlur = 0; this.isBlurringUp = true; } } currentBlur = Math.max(0, Math.min(20, currentBlur)); AppStore.updateSetting('eyeChart.blurAmount', parseFloat(currentBlur.toFixed(1)));
            }, intervalTime);
        },

        stopBlurCycle(exitFullscreen) {
            if (this.blurInterval) {
                clearInterval(this.blurInterval);
                this.blurInterval = null;
                this.toggleBlurButton.textContent = '开始模糊循环';
                this.blurAmountInput.disabled = false;
                if(exitFullscreen) FullscreenModule.exit();
            }
        }
    };

    // ===================================================================
    // == TRACKING MODULE (MODIFIED FOR RESIZE & FULLSCREEN)
    // ===================================================================

    const TrackingModule = {
        init() {
            this.canvas = document.getElementById('trackingCanvas'); this.ctx = this.canvas.getContext('2d');
            this.pathInput = document.getElementById('trackingPath'); this.speedInput = document.getElementById('objectSpeed'); this.flashInput = document.getElementById('flashFrequency'); this.startButton = document.getElementById('startTracking'); this.stopButton = document.getElementById('stopTracking');

            this.animationFrameId = null; this.flashIntervalId = null; this.objectRadius = 20;
            this.isObjectVisible = true; this.angle = 0;

            this.bindEvents(); this.updateControlsFromState(); this.resize();
        },
        resize() { this.canvas.width = this.canvas.clientWidth; this.canvas.height = this.canvas.clientHeight; this.resetAndDraw(); },
        bindEvents() {
            this.pathInput.addEventListener('change', e => AppStore.updateSetting('tracking.path', e.target.value)); this.speedInput.addEventListener('input', e => AppStore.updateSetting('tracking.speed', parseInt(e.target.value))); this.flashInput.addEventListener('input', e => AppStore.updateSetting('tracking.flashFrequency', parseFloat(e.target.value))); this.startButton.addEventListener('click', () => this.start()); this.stopButton.addEventListener('click', () => this.stop());
            EventBus.subscribe('state:changed', (data) => { if (data.keyPath.startsWith('tracking.')) { this.updateControlsFromState(); if (this.animationFrameId && (data.keyPath === 'tracking.flashFrequency' || data.keyPath === 'tracking.path')) { this.handleFlash(); this.reset(); } } });
            EventBus.subscribe('tab:changed', (data) => { if (data.newTabId === 'tracking') this.resize(); });
            EventBus.subscribe('app:stopAllAnimations', () => this.stop());
            EventBus.subscribe('canvas:resized', () => { if(AppStore.getState().activeTab === 'tracking') this.resize(); });
        },
        resetAndDraw() { this.reset(); this.draw(); },
        start() { if (this.animationFrameId) return; FullscreenModule.enter(); this.startButton.disabled = true; this.stopButton.disabled = false; this.reset(); this.handleFlash(); this.animate(); },
        stop() { if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; } if (this.flashIntervalId) { clearInterval(this.flashIntervalId); this.flashIntervalId = null; } this.startButton.disabled = false; this.stopButton.disabled = true; this.resetAndDraw(); FullscreenModule.exit(); },
        updateControlsFromState() { const state = AppStore.getState().tracking; this.pathInput.value = state.path; this.speedInput.value = state.speed; this.flashInput.value = state.flashFrequency; },
        reset() { const W = this.canvas.width; const H = this.canvas.height; this.objectX = W / 2; this.objectY = H / 2; this.objectDx = 1; this.angle = 0; this.isObjectVisible = true; },
        draw() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); if (!this.isObjectVisible) return; this.ctx.beginPath(); this.ctx.arc(this.objectX, this.objectY, this.objectRadius, 0, Math.PI * 2); this.ctx.fillStyle = 'green'; this.ctx.fill(); this.ctx.closePath(); },
        updatePosition() { const state = AppStore.getState().tracking; const W = this.canvas.width; const H = this.canvas.height; const speed = state.speed * 0.5; switch(state.path) { case 'linear': this.objectX += this.objectDx * speed; if (this.objectX + this.objectRadius > W || this.objectX - this.objectRadius < 0) { this.objectDx *= -1; } break; case 'circle': this.angle += 0.01 * speed; const radius = Math.min(W, H) / 2 - this.objectRadius - 10; this.objectX = W / 2 + Math.cos(this.angle) * radius; this.objectY = H / 2 + Math.sin(this.angle) * radius; break; case 'infinity': this.angle += 0.01 * speed; const scaleX = W / 2 - this.objectRadius - 10; const scaleY = H / 4 - this.objectRadius - 10; this.objectX = W / 2 + Math.sin(this.angle) * scaleX; this.objectY = H / 2 + Math.sin(this.angle * 2) * scaleY; break; } },
        animate() { this.updatePosition(); this.draw(); this.animationFrameId = requestAnimationFrame(() => this.animate()); },
        handleFlash() { if (this.flashIntervalId) clearInterval(this.flashIntervalId); const freq = AppStore.getState().tracking.flashFrequency; if (freq > 0) { const intervalTime = 1000 / (freq * 2); this.flashIntervalId = setInterval(() => { this.isObjectVisible = !this.isObjectVisible; }, intervalTime); } else { this.isObjectVisible = true; } },
    };

    // ===================================================================
    // == NEW MODULE: SACCADES
    // ===================================================================
    const SaccadesModule = {
        init() {
            this.canvas = document.getElementById('saccadesCanvas'); this.ctx = this.canvas.getContext('2d');
            this.speedInput = document.getElementById('saccadesSpeed'); this.targetsInput = document.getElementById('saccadesTargets'); this.startButton = document.getElementById('startSaccades'); this.stopButton = document.getElementById('stopSaccades');

            this.jumpInterval = null; this.targetPoints = []; this.currentTargetIndex = 0; this.objectRadius = 15;

            this.bindEvents(); this.updateControlsFromState(); this.resize();
        },
        resize() { this.canvas.width = this.canvas.clientWidth; this.canvas.height = this.canvas.clientHeight; this.generateTargets(); this.draw(); },
        bindEvents() {
            this.speedInput.addEventListener('input', e => AppStore.updateSetting('saccades.speed', parseFloat(e.target.value)));
            this.targetsInput.addEventListener('input', e => { AppStore.updateSetting('saccades.targets', parseInt(e.target.value)); this.generateTargets(); if(!this.jumpInterval) this.draw(); });
            this.startButton.addEventListener('click', () => this.start());
            this.stopButton.addEventListener('click', () => this.stop(true));
            EventBus.subscribe('state:changed', (data) => { if (data.keyPath.startsWith('saccades.')) { this.updateControlsFromState(); } if (this.jumpInterval && data.keyPath === 'saccades.speed') { this.stop(false); this.start(); } });
            EventBus.subscribe('tab:changed', (data) => { if (data.newTabId === 'saccades') this.resize(); });
            EventBus.subscribe('app:stopAllAnimations', () => this.stop(true));
            EventBus.subscribe('canvas:resized', () => { if(AppStore.getState().activeTab === 'saccades') this.resize(); });
        },
        start() { if (this.jumpInterval) return; FullscreenModule.enter(); this.startButton.disabled = true; this.stopButton.disabled = false; this.targetsInput.disabled = true; const speed = AppStore.getState().saccades.speed; const intervalTime = 1000 / speed; this.jumpToNextTarget(); this.jumpInterval = setInterval(() => this.jumpToNextTarget(), intervalTime); },
        stop(exitFullscreen) { if (this.jumpInterval) { clearInterval(this.jumpInterval); this.jumpInterval = null; } this.startButton.disabled = false; this.stopButton.disabled = true; this.targetsInput.disabled = false; this.currentTargetIndex = 0; this.draw(); if(exitFullscreen) FullscreenModule.exit(); },
        updateControlsFromState() { const state = AppStore.getState().saccades; this.speedInput.value = state.speed; this.targetsInput.value = state.targets; },
        generateTargets() { this.targetPoints = []; const state = AppStore.getState().saccades; const W = this.canvas.width; const H = this.canvas.height; const padding = this.objectRadius + 20; for (let i = 0; i < state.targets; i++) { this.targetPoints.push({ x: Math.random() * (W - padding * 2) + padding, y: Math.random() * (H - padding * 2) + padding, }); } this.currentTargetIndex = 0; },
        draw() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.ctx.fillStyle = '#e0e0e0'; this.targetPoints.forEach((p, index) => { if (index === this.currentTargetIndex) return; this.ctx.beginPath(); this.ctx.arc(p.x, p.y, this.objectRadius, 0, Math.PI * 2); this.ctx.fill(); }); const currentPoint = this.targetPoints[this.currentTargetIndex]; if (!currentPoint) return; this.ctx.fillStyle = '#dc3545'; this.ctx.beginPath(); this.ctx.arc(currentPoint.x, currentPoint.y, this.objectRadius, 0, Math.PI * 2); this.ctx.fill(); },
        jumpToNextTarget() { let nextIndex = this.currentTargetIndex; if (this.targetPoints.length > 1) { while (nextIndex === this.currentTargetIndex) { nextIndex = Math.floor(Math.random() * this.targetPoints.length); } } this.currentTargetIndex = nextIndex; this.draw(); },
    };

    // ===================================================================
    // == APPLICATION INITIALIZATION
    // ===================================================================
    const App = {
        init() {
            AppStore.init();
            FullscreenModule.init(); // Initialize the new module
            TabsModule.init();
            EyeChartModule.init();
            TrackingModule.init();
            SaccadesModule.init();
        }
    };

    App.init();
});