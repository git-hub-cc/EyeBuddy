// --- 标签页切换逻辑 ---
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetTabId = button.dataset.tab;

// 停止当前活跃标签页可能正在进行的动画
        stopAllAnimations(); // This will now handle stopping tracking animations too

// 移除所有按钮和内容的 active 类
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

// 为被点击的按钮和对应的内容添加 active 类
        button.classList.add('active');
        document.getElementById(targetTabId).classList.add('active');

// 在切换标签页后，确保canvas重新渲染以避免显示问题
        if (targetTabId === 'eyeChart') {
            drawEyeChart(); // 重新绘制E字表
        } else if (targetTabId === 'tracking') {
// 重置物体追踪位置并绘制，但不开始动画
            objectX = trackingCanvas.width / 2;
            objectY = trackingCanvas.height / 2;
            drawObject(); // Initial draw of the object
// Ensure stop button is disabled, start button is enabled
            startTrackingButton.disabled = false;
            stopTrackingButton.disabled = true;
        }
    });
});

// 新增：停止所有动画的函数，在标签页切换时调用
function stopAllAnimations() {
// 停止视力表模糊循环
    if (blurInterval) {
        clearInterval(blurInterval);
        blurInterval = null;
        toggleBlurButton.textContent = '开始模糊循环';
        blurAmountInput.disabled = false;
        blurSpeedInput.disabled = false;
    }

// 停止物体追踪动画
    stopTrackingAnimations(); // Call the dedicated function
}


// --- E字视力表与模糊训练模块 ---
const eyeChartCanvas = document.getElementById('eyeChartCanvas');
const eyeChartCtx = eyeChartCanvas.getContext('2d');
const chartSizeInput = document.getElementById('chartSize');
const blurAmountInput = document.getElementById('blurAmount');
const blurSpeedInput = document.getElementById('blurSpeed');
const toggleBlurButton = document.getElementById('toggleBlur');

let currentChartSize = 50; // 百分比
let currentBlurAmount = 0; // 0-20 (新的范围)
let currentBlurSpeed = 3; // 1-5，1最慢，5最快
let blurInterval = null;
let isBlurringUp = true; // 模糊是增加还是减少

// E字表方向 (0, 90, 180, 270 度) 对应的弧度
const eDirections = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

// 获取一个随机的E字方向
function getRandomEDirection() {
    return eDirections[Math.floor(Math.random() * eDirections.length)];
}

/**
 * 绘制一个E字
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {number} x - E字左上角的x坐标
 * @param {number} y - E字左上角的y坐标
 * @param {number} unitSize - E字的基本单元大小（即E字笔画的宽度）
 * @param {number} rotation - E字旋转的弧度
 */
function drawE(ctx, x, y, unitSize, rotation) {
// E字是5个单元宽，5个单元高
    const E_WIDTH_UNITS = 5;
    const E_HEIGHT_UNITS = 5;

// 实际的E字中心点在 (x + 2.5 * unitSize, y + 2.5 * unitSize)
    const centerX = x + (E_WIDTH_UNITS / 2) * unitSize;
    const centerY = y + (E_HEIGHT_UNITS / 2) * unitSize;

    ctx.save(); // 保存当前状态
    ctx.translate(centerX, centerY); // 移动到E字中心
    ctx.rotate(rotation); // 旋转
    ctx.fillStyle = '#333'; // E字的颜色

// 绘制E字的各个部分，相对于新的原点 (-2.5*unitSize, -2.5*unitSize)
// 垂直主干
    ctx.fillRect(-2.5 * unitSize, -2.5 * unitSize, unitSize, E_HEIGHT_UNITS * unitSize);
// 上横线
    ctx.fillRect(-2.5 * unitSize, -2.5 * unitSize, E_WIDTH_UNITS * unitSize, unitSize);
// 中横线 (通常比上下短一个单元)
    ctx.fillRect(-2.5 * unitSize, -0.5 * unitSize, (E_WIDTH_UNITS - 1) * unitSize, unitSize);
// 下横线
    ctx.fillRect(-2.5 * unitSize, 1.5 * unitSize, E_WIDTH_UNITS * unitSize, unitSize);

    ctx.restore(); // 恢复之前保存的状态
}


function drawEyeChart() {
    eyeChartCtx.clearRect(0, 0, eyeChartCanvas.width, eyeChartCanvas.height);

// 应用全局模糊滤镜
    eyeChartCanvas.style.filter = `blur(${currentBlurAmount}px)`;

// 视力表行的定义，unitSizeMultiplier 对应 E字实际大小，eCount 对应每行E字数量
// 视力表中，每个字母的高度是其笔画宽度的5倍，行间距和字母间距通常是笔画宽度的1倍
// 也就是说，每个E字及其右侧或下方的标准间隔，共同占据6个单位
    const eChartLevels = [
        { unitSizeMultiplier: 1.0, eCount: 1 }, // 最大E字，一个
        { unitSizeMultiplier: 0.8, eCount: 2 }, // 第二行，两个E
        { unitSizeMultiplier: 0.6, eCount: 3 }, // 第三行，三个E
        { unitSizeMultiplier: 0.4, eCount: 4 }, // 第四行，四个E
        { unitSizeMultiplier: 0.3, eCount: 5 }, // 第五行，五个E
        { unitSizeMultiplier: 0.25, eCount: 6 } // 更多行，按需添加
    ];

// 计算基础单元大小 (baseUnitSize)，它与chartSizeInput挂钩，并控制所有E字的大小
// 当chartSizeInput为50时，我们希望有一个合适的初始大小
// 假设Canvas宽800，一个大E字(5单位宽)大概占1/5到1/4，即单位大小在30-40
// (currentChartSize / 100) 使得滑块值0-100映射到0-1，再乘以一个系数
    const maxUnitSize = eyeChartCanvas.width / 15; // 限制最大E字不要过大
    const minUnitSize = eyeChartCanvas.width / 100; // 限制最小E字不要过小
    const mappedChartSize = currentChartSize / 100; // 0-1
// 线性映射：unitSize = min + (max-min) * mappedChartSize
    const baseUnitSize = minUnitSize + (maxUnitSize - minUnitSize) * mappedChartSize;


    let currentY = 50; // 初始行顶部Y坐标

    eChartLevels.forEach(level => {
// 当前行E字的实际单元大小
        const rowUnitSize = baseUnitSize * level.unitSizeMultiplier;
// 单个E字的实际宽度和高度（包含笔画）
        const ePixelWidth = rowUnitSize * 5;
        const ePixelHeight = rowUnitSize * 5;

// 计算当前行所有E字的总宽度，包括它们之间的标准间隔 (1个unitSize)
// 每个E字及其右侧的空间总共占用 6 * rowUnitSize
        const spacingUnit = rowUnitSize; // E字之间的间隔通常是1个笔画单位
        const totalRowOccupiedWidth = level.eCount * (ePixelWidth + spacingUnit) - spacingUnit; // 减去最后一个E字右侧多余的间隔

// 计算当前行E字的起始X坐标，使其在画布上居中
        const startX = (eyeChartCanvas.width - totalRowOccupiedWidth) / 2;

        for (let i = 0; i < level.eCount; i++) {
// 计算当前E字的左上角坐标
            const eX = startX + i * (ePixelWidth + spacingUnit);
            const eY = currentY; // E字顶部对齐当前行Y坐标

            drawE(eyeChartCtx, eX, eY, rowUnitSize, getRandomEDirection());
        }

// 更新下一行的Y坐标。行高通常是字母高度的1.2倍或者更多，留出垂直间隔
        const rowOccupiedHeight = ePixelHeight + spacingUnit;
        currentY += rowOccupiedHeight;
    });
}

// 事件监听：调整视力表大小
chartSizeInput.addEventListener('input', (e) => {
    currentChartSize = parseInt(e.target.value);
    drawEyeChart();
});

// 事件监听：手动调整模糊程度
blurAmountInput.addEventListener('input', (e) => {
    currentBlurAmount = parseFloat(e.target.value); // Use parseFloat for decimal steps
    drawEyeChart(); // 更新显示以反映模糊变化
});

// 事件监听：调整模糊速度
blurSpeedInput.addEventListener('input', (e) => {
    currentBlurSpeed = parseInt(e.target.value);
// 如果模糊循环正在进行，需要停止旧的，以新速度启动新的
    if (blurInterval) {
        clearInterval(blurInterval);
        startBlurCycle(); // 重新启动循环
    }
});

// 启动模糊循环的内部函数
function startBlurCycle() {
// Speed: 1 (slow) to 5 (fast). IntervalTime: 400 (slow) to 100 (fast)
// 1 -> 400ms, 5 -> 100ms. interval = 500 - speed * 100
// This allows blur to change by 0.3 per tick.
    const intervalTime = 500 - (currentBlurSpeed * 80); // Adjust calculation for better range, e.g., 400ms to 80ms

    blurInterval = setInterval(() => {
        if (isBlurringUp) {
            currentBlurAmount += 0.3;
            if (currentBlurAmount >= 20) { // CHANGED: from 33 to 20
                currentBlurAmount = 20; // Cap at max
                isBlurringUp = false;
            }
        } else {
            currentBlurAmount -= 0.3;
            if (currentBlurAmount <= 0) {
                currentBlurAmount = 0; // Cap at min
                isBlurringUp = true;
            }
        }
        // Ensure blur amount is always within valid range and rounded for slider display
        currentBlurAmount = Math.max(0, Math.min(20, currentBlurAmount)); // CHANGED: from 33 to 20
        blurAmountInput.value = currentBlurAmount.toFixed(1); // Update slider position, use toFixed for decimal
        drawEyeChart();
    }, intervalTime);
}

// 模糊循环逻辑
toggleBlurButton.addEventListener('click', () => {
    if (blurInterval) {
// 停止循环
        clearInterval(blurInterval);
        blurInterval = null;
        toggleBlurButton.textContent = '开始模糊循环';
        blurAmountInput.disabled = false; // 停止时允许手动调节
        blurSpeedInput.disabled = false; // 停止时允许调节速度
    } else {
// 启动循环
        toggleBlurButton.textContent = '停止模糊循环';
        blurAmountInput.disabled = true; // 循环时禁用手动调节
// blurSpeedInput.disabled = true; // 循环时允许调节速度，所以不禁用
        startBlurCycle();
    }
});

// 初始只绘制视力表，因为它是默认活跃的标签页
drawEyeChart();


// --- 物体追踪训练模块 ---
const trackingCanvas = document.getElementById('trackingCanvas');
const trackingCtx = trackingCanvas.getContext('2d');
const objectSpeedInput = document.getElementById('objectSpeed');
const flashFrequencyInput = document.getElementById('flashFrequency'); // New
const randomPositionCheckbox = document.getElementById('randomPosition'); // New
const startTrackingButton = document.getElementById('startTracking');
const stopTrackingButton = document.getElementById('stopTracking');

let objectX = trackingCanvas.width / 2;
let objectY = trackingCanvas.height / 2;
let objectRadius = 20;
let objectDx = 5; // x方向速度

let animationFrameId = null; // For requestAnimationFrame
let flashIntervalId = null; // For setInterval for flashing

let currentObjectSpeed = 5;
let currentFlashFrequency = 0; // 0 means no flash
let isRandomPositionEnabled = false;
let isObjectVisible = true; // Controls drawing for flashing

function drawObject() {
// Only draw if the object is supposed to be visible
    if (!isObjectVisible) {
        trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height); // Clear if invisible
        return;
    }

    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
    trackingCtx.beginPath();
    trackingCtx.arc(objectX, objectY, objectRadius, 0, Math.PI * 2);
    trackingCtx.fillStyle = 'green';
    trackingCtx.fill();
    trackingCtx.closePath();
}

// Function to update position for smooth horizontal movement
function updateObjectPositionSmooth() {
    objectX += objectDx * (currentObjectSpeed / 5);

    if (objectX + objectRadius > trackingCanvas.width || objectX - objectRadius < 0) {
        objectDx *= -1;
    }
}

// Function to jump object to a random position
function jumpObjectRandomly() {
// Ensure object stays within canvas bounds
    objectX = Math.random() * (trackingCanvas.width - 2 * objectRadius) + objectRadius;
    objectY = Math.random() * (trackingCanvas.height - 2 * objectRadius) + objectRadius;
}

// Main animation loop
function animateTracking() {
    if (!isRandomPositionEnabled) { // Only apply smooth movement if random position is OFF
        updateObjectPositionSmooth();
    }
    drawObject(); // Draw (or clear if invisible due to flash)
    animationFrameId = requestAnimationFrame(animateTracking);
}

// Function to start the flashing behavior
function startFlash() {
// Clear any existing flash interval first
    if (flashIntervalId) clearInterval(flashIntervalId);

// Calculate interval time based on frequency (Hz). 1/freq is period. Half period for on/off.
// If currentFlashFrequency is 0.5, interval = 1000 / 1 = 1000ms. (on 1s, off 1s)
// If currentFlashFrequency is 5, interval = 1000 / 10 = 100ms. (on 0.1s, off 0.1s)
    const intervalTime = 1000 / (currentFlashFrequency * 2);

// Initial state for flashing
    isObjectVisible = true;
    if (isRandomPositionEnabled) { // If random position, jump immediately on first appearance
        jumpObjectRandomly();
    }

    flashIntervalId = setInterval(() => {
        isObjectVisible = !isObjectVisible; // Toggle visibility

        if (isObjectVisible && isRandomPositionEnabled) {
            jumpObjectRandomly(); // Jump when it becomes visible if random position is enabled
        }
// drawObject() is handled by animateTracking loop, no need to call here
// The animateTracking loop will continuously draw or clear based on isObjectVisible
    }, intervalTime);
}

// Function to stop all tracking related animations and reset state
function stopTrackingAnimations() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (flashIntervalId) {
        clearInterval(flashIntervalId);
        flashIntervalId = null;
    }

// Reset visibility and redraw object at center
    isObjectVisible = true;
    startTrackingButton.disabled = false;
    stopTrackingButton.disabled = true;
    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height); // Clear entire canvas
    objectX = trackingCanvas.width / 2; // Reset position to center
    objectY = trackingCanvas.height / 2;
    drawObject(); // Draw object in its reset position
}

// Event listener: Adjust object speed
objectSpeedInput.addEventListener('input', (e) => {
    currentObjectSpeed = parseInt(e.target.value);
});

// Event listener: Adjust flash frequency
flashFrequencyInput.addEventListener('input', (e) => {
    currentFlashFrequency = parseFloat(e.target.value);
    if (animationFrameId) { // If animation is running
        if (currentFlashFrequency > 0) {
            startFlash(); // Restart flash with new frequency
        } else {
// If frequency is 0, stop flashing and ensure object is visible
            if (flashIntervalId) clearInterval(flashIntervalId);
            flashIntervalId = null;
            isObjectVisible = true; // Ensure visibility when flash is off
            drawObject(); // Redraw immediately
        }
    }
});

// Event listener: Toggle random position
randomPositionCheckbox.addEventListener('change', (e) => {
    isRandomPositionEnabled = e.target.checked;
// If animation is running, reset position and redraw for immediate effect
    if (animationFrameId) {
        if (isRandomPositionEnabled) {
            jumpObjectRandomly(); // Jump to random if enabled
        } else {
            objectX = trackingCanvas.width / 2; // Reset to center for smooth movement
            objectY = trackingCanvas.height / 2;
        }
        drawObject();
    }
});


// Event listener: Start tracking
startTrackingButton.addEventListener('click', () => {
    if (!animationFrameId) { // Prevent multiple starts
        startTrackingButton.disabled = true;
        stopTrackingButton.disabled = false;

// Set initial position based on random setting
        if (isRandomPositionEnabled) {
            jumpObjectRandomly();
        } else {
            objectX = trackingCanvas.width / 2;
            objectY = trackingCanvas.height / 2;
        }
        isObjectVisible = true; // Always start visible
        drawObject(); // Draw initial state

// Start flashing if frequency > 0
        if (currentFlashFrequency > 0) {
            startFlash();
        }
// Always start the animation loop (it handles smooth movement or just drawing based on randomPosition)
        animateTracking();
    }
});

// Event listener: Stop tracking
stopTrackingButton.addEventListener('click', () => {
    stopTrackingAnimations();
});

// Initial state for tracking tab when loaded (but not yet active)
// The tab switching logic will handle initial setup when it becomes active.
// No initial call to drawObject() here, as it's done when tab is activated.