document.addEventListener('DOMContentLoaded', () => {

    // ===================================================================
    // == 核心系统与工具 (CORE SYSTEMS & UTILITIES)
    // ===================================================================

    /**
     * 防抖函数：在事件触发后等待指定时间再执行，如果期间再次触发，则重新计时。
     * @param {Function} func - 需要防抖的函数。
     * @param {number} delay - 延迟时间（毫秒）。
     * @returns {Function} - 经过防抖处理的函数。
     */
    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    /**
     * 全局状态管理器 (AppStore)
     * - 统一管理应用的所有状态。
     * - 提供加载和保存状态到 localStorage 的功能，以实现持久化。
     * - 更新状态时会通过事件总线通知其他模块。
     */
    const AppStore = {
        _state: {
            activeTab: 'eyeChart',
            eyeChart: { size: 50, blurAmount: 0, blurSpeed: 3 },
            tracking: { path: 'linear', speed: 10, flashFrequency: 0 },
            saccades: { speed: 1, targets: 2 },
            eyeExercises: { version: 'new' }
        },
        init() { this.loadState(); },
        getState() { return this._state; },
        updateSetting(keyPath, value) {
            const keys = keyPath.split('.');
            let obj = this._state;
            for (let i = 0; i < keys.length - 1; i++) { obj = obj[keys[i]]; }
            obj[keys[keys.length - 1]] = value;
            this.saveState();
            EventBus.publish('state:changed', { keyPath, value });
        },
        saveState() { localStorage.setItem('eyeBuddyState', JSON.stringify(this._state)); },
        loadState() {
            const savedState = localStorage.getItem('eyeBuddyState');
            if (savedState) {
                const loaded = JSON.parse(savedState);
                Object.keys(this._state).forEach(key => {
                    if (loaded[key]) {
                        if (typeof this._state[key] === 'object' && this._state[key] !== null) {
                            Object.assign(this._state[key], loaded[key]);
                        } else {
                            this._state[key] = loaded[key];
                        }
                    }
                });
            }
        }
    };

    /**
     * 事件总线 (EventBus)
     * - 实现发布/订阅模式，用于模块间的解耦通信。
     * - 模块可以订阅特定事件，当事件发布时，所有订阅者都会收到通知。
     */
    const EventBus = {
        _events: {},
        subscribe(eventName, callback) {
            if (!this._events[eventName]) this._events[eventName] = [];
            this._events[eventName].push(callback);
        },
        publish(eventName, data) {
            if (this._events[eventName]) {
                this._events[eventName].forEach(callback => callback(data));
            }
        }
    };

    // ===================================================================
    // == 全屏与尺寸调整管理器 (FULLSCREEN & RESIZE MANAGER)
    // ===================================================================
    const FullscreenModule = {
        init() {
            // 监听窗口尺寸变化和全屏状态变化
            window.addEventListener('resize', debounce(() => this.onResize(), 250));
            document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
            this.onResize(); // 初始调用以设置正确的画布尺寸
        },
        enter() {
            if (document.fullscreenElement) return;
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`进入全屏模式失败: ${err.message} (${err.name})`);
            });
        },
        exit() {
            if (!document.fullscreenElement) return;
            document.exitFullscreen();
        },
        onResize() {
            // 发布全局的画布尺寸调整事件，由各个模块自行处理
            EventBus.publish('canvas:resized');
        },
        onFullscreenChange() {
            document.body.classList.toggle('fullscreen-active', !!document.fullscreenElement);
            // 等待CSS过渡效果完成后再调整画布尺寸
            setTimeout(() => this.onResize(), 150);
        }
    };

    // ===================================================================
    // == 标签页模块 (TABS MODULE)
    // ===================================================================
    const TabsModule = {
        init() {
            this.tabButtons = document.querySelectorAll('.tab-button');
            this.tabContents = document.querySelectorAll('.tab-content');
            this.tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const targetTabId = button.dataset.tab;
                    AppStore.updateSetting('activeTab', targetTabId);
                });
            });
            // 监听状态变化，如果是 activeTab 变化，则切换标签页
            EventBus.subscribe('state:changed', (data) => {
                if (data.keyPath === 'activeTab') this.setActiveTab(data.value);
            });
            // 初始化时根据存储的状态设置当前标签页
            this.setActiveTab(AppStore.getState().activeTab);
        },
        setActiveTab(targetTabId) {
            // 切换标签前，停止所有正在进行的动画
            EventBus.publish('app:stopAllAnimations');
            this.tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === targetTabId));
            this.tabContents.forEach(content => content.classList.toggle('active', content.id === targetTabId));
            // 发布标签页切换事件，通知相关模块进行初始化或重绘
            EventBus.publish('tab:changed', { newTabId: targetTabId });
        }
    };

    // ===================================================================
    // == 训练模块: 视力表与模糊训练 (EYE CHART & BLUR MODULE)
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
            this.eDirections = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; // E字的四个方向

            this.bindEvents();
            this.updateControlsFromState();
            this.resize();
        },
        resize() {
            // 使画布的逻辑尺寸与其在页面上显示的CSS尺寸保持一致
            this.canvas.width = this.canvas.clientWidth;
            this.canvas.height = this.canvas.clientHeight;
            this.draw();
        },
        // 对模糊值应用非线性（立方）映射，使得在低模糊值时有更精细的控制
        _calculateNonLinearBlur(value) {
            const maxInput = 20;
            const maxOutput = 20;
            const normalized = value / maxInput; // 归一化到 0-1
            const skewed = Math.pow(normalized, 3); // 应用立方曲线
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
                // 如果在模糊循环中改变速度，则重启循环
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
            const state = AppStore.getState().eyeChart;
            this.sizeInput.value = state.size;
            this.blurAmountInput.value = state.blurAmount;
            this.blurSpeedInput.value = state.blurSpeed;
        },
        draw() {
            const state = AppStore.getState().eyeChart;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // 通过CSS filter应用非线性模糊效果
            const displayBlur = this._calculateNonLinearBlur(state.blurAmount);
            this.canvas.style.filter = `blur(${displayBlur}px)`;

            // 定义视力表的各行参数
            const eChartLevels = [
                { unitSizeMultiplier: 1.0, eCount: 1 }, { unitSizeMultiplier: 0.8, eCount: 2 },
                { unitSizeMultiplier: 0.6, eCount: 3 }, { unitSizeMultiplier: 0.4, eCount: 4 },
                { unitSizeMultiplier: 0.3, eCount: 5 }, { unitSizeMultiplier: 0.25, eCount: 6 }
            ];
            // 根据滑块值计算基础大小
            const maxUnitSize = this.canvas.width / 15;
            const minUnitSize = this.canvas.width / 100;
            const baseUnitSize = minUnitSize + (maxUnitSize - minUnitSize) * (state.size / 100);

            let currentY = this.canvas.height * 0.1;
            eChartLevels.forEach(level => {
                const rowUnitSize = baseUnitSize * level.unitSizeMultiplier;
                const ePixelWidth = rowUnitSize * 5;
                const spacingUnit = rowUnitSize;
                const totalRowOccupiedWidth = level.eCount * (ePixelWidth + spacingUnit) - spacingUnit;
                const startX = (this.canvas.width - totalRowOccupiedWidth) / 2;

                for (let i = 0; i < level.eCount; i++) {
                    const eX = startX + i * (ePixelWidth + spacingUnit);
                    this._drawE(this.ctx, eX, currentY, rowUnitSize, this._getRandomEDirection());
                }
                currentY += ePixelWidth + spacingUnit * 2;
            });
        },
        _drawE(ctx, x, y, unitSize, rotation) {
            const centerX = x + 2.5 * unitSize;
            const centerY = y + 2.5 * unitSize;
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(rotation);
            ctx.fillStyle = '#333';
            ctx.fillRect(-2.5 * unitSize, -2.5 * unitSize, unitSize, 5 * unitSize); // 竖
            ctx.fillRect(-2.5 * unitSize, -2.5 * unitSize, 5 * unitSize, unitSize); // 上横
            ctx.fillRect(-2.5 * unitSize, -0.5 * unitSize, 4 * unitSize, unitSize); // 中横
            ctx.fillRect(-2.5 * unitSize, 1.5 * unitSize, 5 * unitSize, unitSize); // 下横
            ctx.restore();
        },
        _getRandomEDirection() {
            return this.eDirections[Math.floor(Math.random() * this.eDirections.length)];
        },
        toggleBlurCycle() {
            this.blurInterval ? this.stopBlurCycle(true) : this.startBlurCycle();
        },
        startBlurCycle() {
            FullscreenModule.enter();
            this.toggleBlurButton.textContent = '停止模糊循环';
            this.blurAmountInput.disabled = true;
            const state = AppStore.getState().eyeChart;
            const intervalTime = 500 - (state.blurSpeed * 80); // 速度越快，间隔越短

            this.blurInterval = setInterval(() => {
                let currentBlur = AppStore.getState().eyeChart.blurAmount;
                if (this.isBlurringUp) {
                    currentBlur += 0.3;
                    if (currentBlur >= 20) { currentBlur = 20; this.isBlurringUp = false; }
                } else {
                    currentBlur -= 0.3;
                    if (currentBlur <= 0) { currentBlur = 0; this.isBlurringUp = true; }
                }
                currentBlur = Math.max(0, Math.min(20, currentBlur));
                AppStore.updateSetting('eyeChart.blurAmount', parseFloat(currentBlur.toFixed(1)));
            }, intervalTime);
        },
        stopBlurCycle(exitFullscreen) {
            if (this.blurInterval) {
                clearInterval(this.blurInterval);
                this.blurInterval = null;
                this.toggleBlurButton.textContent = '开始模糊循环';
                this.blurAmountInput.disabled = false;
                if (exitFullscreen) FullscreenModule.exit();
            }
        }
    };

    // ===================================================================
    // == 训练模块: 物体追随训练 (TRACKING MODULE)
    // ===================================================================
    const TrackingModule = {
        init() {
            this.canvas = document.getElementById('trackingCanvas'); this.ctx = this.canvas.getContext('2d');
            this.pathInput = document.getElementById('trackingPath'); this.speedInput = document.getElementById('objectSpeed'); this.flashInput = document.getElementById('flashFrequency'); this.startButton = document.getElementById('startTracking'); this.stopButton = document.getElementById('stopTracking');

            this.animationFrameId = null; this.flashIntervalId = null;
            this.objectRadius = 20; this.isObjectVisible = true; this.angle = 0;

            this.bindEvents(); this.updateControlsFromState(); this.resize();
        },
        resize() { this.canvas.width = this.canvas.clientWidth; this.canvas.height = this.canvas.clientHeight; this.resetAndDraw(); },
        bindEvents() {
            this.pathInput.addEventListener('change', e => AppStore.updateSetting('tracking.path', e.target.value));
            this.speedInput.addEventListener('input', e => AppStore.updateSetting('tracking.speed', parseInt(e.target.value)));
            this.flashInput.addEventListener('input', e => AppStore.updateSetting('tracking.flashFrequency', parseFloat(e.target.value)));
            this.startButton.addEventListener('click', () => this.start());
            this.stopButton.addEventListener('click', () => this.stop());

            EventBus.subscribe('state:changed', (data) => {
                if (data.keyPath.startsWith('tracking.')) {
                    this.updateControlsFromState();
                    if (this.animationFrameId && (data.keyPath === 'tracking.flashFrequency' || data.keyPath === 'tracking.path')) {
                        this.handleFlash(); // 重置闪烁
                        this.reset(); // 重置位置
                    }
                }
            });
            EventBus.subscribe('tab:changed', (data) => { if (data.newTabId === 'tracking') this.resize(); });
            EventBus.subscribe('app:stopAllAnimations', () => this.stop());
            EventBus.subscribe('canvas:resized', () => { if(AppStore.getState().activeTab === 'tracking') this.resize(); });
        },
        resetAndDraw() { this.reset(); this.draw(); },
        start() {
            if (this.animationFrameId) return;
            FullscreenModule.enter();
            this.startButton.disabled = true; this.stopButton.disabled = false;
            this.reset();
            this.handleFlash();
            this.animate();
        },
        stop() {
            if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
            if (this.flashIntervalId) { clearInterval(this.flashIntervalId); this.flashIntervalId = null; }
            this.startButton.disabled = false; this.stopButton.disabled = true;
            this.resetAndDraw();
            FullscreenModule.exit();
        },
        updateControlsFromState() { const state = AppStore.getState().tracking; this.pathInput.value = state.path; this.speedInput.value = state.speed; this.flashInput.value = state.flashFrequency; },
        reset() {
            const W = this.canvas.width; const H = this.canvas.height;
            this.objectX = W / 2; this.objectY = H / 2;
            this.objectDx = 1; // 用于水平移动的方向
            this.angle = 0;    // 用于圆形和无限符号的角度
            this.isObjectVisible = true;
        },
        draw() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (!this.isObjectVisible) return;
            this.ctx.beginPath();
            this.ctx.arc(this.objectX, this.objectY, this.objectRadius, 0, Math.PI * 2);
            this.ctx.fillStyle = 'green';
            this.ctx.fill();
        },
        updatePosition() {
            const state = AppStore.getState().tracking;
            const W = this.canvas.width; const H = this.canvas.height;
            const speed = state.speed * 0.5; // 将滑块值映射到实际速度
            switch(state.path) {
                case 'linear':
                    this.objectX += this.objectDx * speed;
                    if (this.objectX + this.objectRadius > W || this.objectX - this.objectRadius < 0) this.objectDx *= -1;
                    break;
                case 'circle':
                    this.angle += 0.01 * speed;
                    const radius = Math.min(W, H) / 2 - this.objectRadius - 10;
                    this.objectX = W / 2 + Math.cos(this.angle) * radius;
                    this.objectY = H / 2 + Math.sin(this.angle) * radius;
                    break;
                case 'infinity':
                    this.angle += 0.01 * speed;
                    const scaleX = W / 2 - this.objectRadius - 10;
                    const scaleY = H / 4 - this.objectRadius - 10;
                    this.objectX = W / 2 + Math.sin(this.angle) * scaleX;
                    this.objectY = H / 2 + Math.sin(this.angle * 2) * scaleY;
                    break;
            }
        },
        animate() { this.updatePosition(); this.draw(); this.animationFrameId = requestAnimationFrame(() => this.animate()); },
        handleFlash() {
            if (this.flashIntervalId) clearInterval(this.flashIntervalId);
            const freq = AppStore.getState().tracking.flashFrequency;
            if (freq > 0) {
                const intervalTime = 1000 / (freq * 2); // 闪烁一次（一开一关）为一个周期
                this.flashIntervalId = setInterval(() => { this.isObjectVisible = !this.isObjectVisible; }, intervalTime);
            } else {
                this.isObjectVisible = true;
            }
        },
    };

    // ===================================================================
    // == 训练模块: 扫视训练 (SACCADES MODULE)
    // ===================================================================
    const SaccadesModule = {
        init() {
            this.canvas = document.getElementById('saccadesCanvas'); this.ctx = this.canvas.getContext('2d');
            this.speedInput = document.getElementById('saccadesSpeed'); this.targetsInput = document.getElementById('saccadesTargets'); this.startButton = document.getElementById('startSaccades'); this.stopButton = document.getElementById('stopSaccades');

            this.jumpInterval = null; this.targetPoints = [];
            this.currentTargetIndex = 0; this.objectRadius = 15;

            this.bindEvents(); this.updateControlsFromState(); this.resize();
        },
        resize() {
            this.canvas.width = this.canvas.clientWidth; this.canvas.height = this.canvas.clientHeight;
            this.generateTargets(); // 窗口变化时重新生成目标点
            this.draw();
        },
        bindEvents() {
            this.speedInput.addEventListener('input', e => AppStore.updateSetting('saccades.speed', parseFloat(e.target.value)));
            this.targetsInput.addEventListener('input', e => {
                AppStore.updateSetting('saccades.targets', parseInt(e.target.value));
                this.generateTargets();
                if(!this.jumpInterval) this.draw(); // 如果未在运行，则立即重绘
            });
            this.startButton.addEventListener('click', () => this.start());
            this.stopButton.addEventListener('click', () => this.stop(true));
            EventBus.subscribe('state:changed', (data) => {
                if (data.keyPath.startsWith('saccades.')) this.updateControlsFromState();
                if (this.jumpInterval && data.keyPath === 'saccades.speed') {
                    this.stop(false); this.start(); // 改变速度时重启训练
                }
            });
            EventBus.subscribe('tab:changed', (data) => { if (data.newTabId === 'saccades') this.resize(); });
            EventBus.subscribe('app:stopAllAnimations', () => this.stop(true));
            EventBus.subscribe('canvas:resized', () => { if(AppStore.getState().activeTab === 'saccades') this.resize(); });
        },
        start() {
            if (this.jumpInterval) return;
            FullscreenModule.enter();
            this.startButton.disabled = true; this.stopButton.disabled = false; this.targetsInput.disabled = true;
            const speed = AppStore.getState().saccades.speed;
            const intervalTime = 1000 / speed; // 速度（次/秒）转换为间隔（毫秒）
            this.jumpToNextTarget(); // 立即跳一次
            this.jumpInterval = setInterval(() => this.jumpToNextTarget(), intervalTime);
        },
        stop(exitFullscreen) {
            if (this.jumpInterval) { clearInterval(this.jumpInterval); this.jumpInterval = null; }
            this.startButton.disabled = false; this.stopButton.disabled = true; this.targetsInput.disabled = false;
            this.currentTargetIndex = 0; // 重置到第一个目标点
            this.draw();
            if(exitFullscreen) FullscreenModule.exit();
        },
        updateControlsFromState() { const state = AppStore.getState().saccades; this.speedInput.value = state.speed; this.targetsInput.value = state.targets; },
        generateTargets() {
            this.targetPoints = [];
            const state = AppStore.getState().saccades;
            const W = this.canvas.width; const H = this.canvas.height;
            const padding = this.objectRadius + 20; // 确保目标点不会太靠近边缘
            for (let i = 0; i < state.targets; i++) {
                this.targetPoints.push({
                    x: Math.random() * (W - padding * 2) + padding,
                    y: Math.random() * (H - padding * 2) + padding,
                });
            }
            this.currentTargetIndex = 0;
        },
        draw() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = '#e0e0e0'; // 非活动目标点的颜色
            // 绘制所有非活动目标点
            this.targetPoints.forEach((p, index) => {
                if (index === this.currentTargetIndex) return; // 跳过当前活动目标
                this.ctx.beginPath(); this.ctx.arc(p.x, p.y, this.objectRadius, 0, Math.PI * 2); this.ctx.fill();
            });
            // 绘制当前活动目标点
            const currentPoint = this.targetPoints[this.currentTargetIndex];
            if (!currentPoint) return;
            this.ctx.fillStyle = '#dc3545'; // 活动目标点的颜色
            this.ctx.beginPath(); this.ctx.arc(currentPoint.x, currentPoint.y, this.objectRadius, 0, Math.PI * 2); this.ctx.fill();
        },
        jumpToNextTarget() {
            let nextIndex = this.currentTargetIndex;
            // 确保下一个目标不是当前目标
            if (this.targetPoints.length > 1) {
                while (nextIndex === this.currentTargetIndex) {
                    nextIndex = Math.floor(Math.random() * this.targetPoints.length);
                }
            }
            this.currentTargetIndex = nextIndex;
            this.draw();
        },
    };

    // ===================================================================
    // == 模块: 眼保健操 (EYE EXERCISES MODULE)
    // ===================================================================
    const EyeExercisesModule = {
        init() {
            this.select = document.getElementById('exerciseVersion');
            this.image = document.getElementById('eyeExerciseImage');
            this.playButton = document.getElementById('playExercise');
            this.stopButton = document.getElementById('stopExercise');
            this.audio = new Audio(); // 创建一个单一的 audio 对象，方便控制

            this.bindEvents();
            this.updateControlsFromState();
            this.setVersion(AppStore.getState().eyeExercises.version);
        },
        bindEvents() {
            this.select.addEventListener('change', (e) => {
                AppStore.updateSetting('eyeExercises.version', e.target.value);
            });
            this.playButton.addEventListener('click', () => this.togglePlay());
            this.stopButton.addEventListener('click', () => this.stop());

            // 监听 audio 自身事件来更新UI
            this.audio.addEventListener('play', () => this.updatePlayUI(true));
            this.audio.addEventListener('pause', () => this.updatePlayUI(false)); // 暂停和结束都会触发 pause

            // 订阅全局事件
            EventBus.subscribe('state:changed', (data) => {
                if (data.keyPath === 'eyeExercises.version') {
                    this.setVersion(data.value);
                }
            });
            EventBus.subscribe('tab:changed', (data) => {
                if (data.newTabId !== 'eyeExercises' && !this.audio.paused) {
                    this.stop();
                }
            });
            EventBus.subscribe('app:stopAllAnimations', () => this.stop());
        },
        updateControlsFromState() {
            this.select.value = AppStore.getState().eyeExercises.version;
        },
        setVersion(version) {
            this.stop(); // 切换版本前先停止当前播放
            const isNewVersion = version === 'new';
            this.image.src = isNewVersion ? 'img/新.jpg' : 'img/经典.jpg';
            this.audio.src = isNewVersion ? 'music/新.mp3' : 'music/经典.mp3';
            this.image.alt = `眼保健操图示 - ${isNewVersion ? '新版' : '经典版'}`;
            this.updateControlsFromState();
        },
        togglePlay() {
            this.audio.paused ? this.audio.play().catch(e => console.error("音频播放失败:", e)) : this.audio.pause();
        },
        stop() {
            this.audio.pause();
            this.audio.currentTime = 0; // 回到音频开头
        },
        updatePlayUI(isPlaying) {
            this.playButton.textContent = isPlaying ? '暂停' : '播放';
        }
    };

    // ===================================================================
    // == 应用初始化 (APPLICATION INITIALIZATION)
    // ===================================================================
    const App = {
        init() {
            // 按顺序初始化所有模块
            AppStore.init();
            FullscreenModule.init();
            TabsModule.init();
            EyeChartModule.init();
            TrackingModule.init();
            SaccadesModule.init();
            EyeExercisesModule.init();
        }
    };

    // 启动应用
    App.init();
});