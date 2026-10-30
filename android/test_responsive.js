const { chromium } = require('C:/Users/dusha/AppData/Roaming/npm/node_modules/.openclaw-Rmg2tL3T/node_modules/playwright-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Minimal local static HTTP server to serve dashboard assets
const DASHBOARD_DIR = path.resolve('x:/ALL PROJECTS/deskOS/android/app/src/main/assets/dashboard');
const PORT = 8089;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
};

const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(DASHBOARD_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404);
        res.end('File Not Found');
    }
});

const VIEWPORTS = [
    { name: 'Portrait: 360 x 800 (Samsung M01s / Small)', width: 360, height: 800 },
    { name: 'Portrait: 393 x 873 (Pixel / Medium)', width: 393, height: 873 },
    { name: 'Portrait: 412 x 915 (OPPO / Modern Standard)', width: 412, height: 915 },
    { name: 'Landscape: 800 x 360 (Small Docked / M01s)', width: 800, height: 360 },
    { name: 'Landscape: 915 x 412 (Wide Docked / Modern)', width: 915, height: 412 }
];

async function runTests() {
    await new Promise(resolve => server.listen(PORT, resolve));
    console.log(`[TEST SERVER] Running on http://localhost:${PORT}`);

    // Launch Edge using Playwright Core
    const browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    });

    const testResults = {
        viewports: [],
        functional: {},
        errors: []
    };

    try {
        for (const vp of VIEWPORTS) {
            console.log(`\n--- TESTING VIEWPORT: ${vp.name} ---`);
            const context = await browser.newContext({
                viewport: { width: vp.width, height: vp.height }
            });
            const page = await context.newPage();

            // Track JS errors
            const consoleErrors = [];
            page.on('console', msg => {
                if (msg.type() === 'error') {
                    consoleErrors.push(msg.text());
                    console.log('   [PAGE CONSOLE ERROR]:', msg.text());
                }
            });
            page.on('pageerror', err => {
                consoleErrors.push(err.message);
            });

            // Mock NativeBridge before page scripts load
            await page.addInitScript(() => {
                window.DeskOSBridge = {
                    getDeviceInfo: () => JSON.stringify({
                        appVersion: "1.1.0",
                        manufacturer: "samsung",
                        model: "SM-M015G",
                        device: "m01s",
                        androidVersion: "11",
                        sdkInt: 30,
                        battery: {
                            percent: 85,
                            isCharging: true,
                            chargeType: "ac",
                            voltageMv: 4120,
                            temperatureC: "32.4",
                            isOverheating: false,
                            isNearLimit: true
                        },
                        sensorCapabilities: {
                            accelerometer: true,
                            gyroscope: false,
                            magnetometer: false,
                            light: true,
                            proximity: true
                        },
                        hasNotificationPermission: true
                    }),
                    getBatteryStatus: () => JSON.stringify({
                        percent: 85,
                        isCharging: true,
                        chargeType: "ac",
                        voltageMv: 4120,
                        temperatureC: "32.4",
                        isOverheating: false,
                        isNearLimit: true
                    }),
                    getSensorCapabilities: () => JSON.stringify({
                        accelerometer: true,
                        gyroscope: false,
                        magnetometer: false,
                        light: true,
                        proximity: true
                    }),
                    getLiveSensors: () => JSON.stringify({
                        accelX: "0.12",
                        accelY: "0.05",
                        accelZ: "9.81"
                    }),
                    setScreenDimmed: () => {},
                    setKeepScreenOn: () => {},
                    triggerHaptic: () => {},
                    showNotification: () => true,
                    checkNotificationPermission: () => true,
                    requestNotificationPermission: () => {},
                    getAgentStatus: () => JSON.stringify({
                        state: "CONNECTED",
                        isPaired: true,
                        hostName: "Lenovo LOQ",
                        hostIp: "192.168.1.45",
                        port: 8765
                    }),
                    pairAgent: () => JSON.stringify({ success: true, message: "Paired successfully" }),
                    connectAgent: () => true,
                    disconnectAgent: () => true,
                    forgetAgentDevice: () => true
                };
            });

            await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(400);

            // 1. Check Horizontal Scrolling
            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
            const clientWidth = await page.evaluate(() => window.innerWidth);
            const hasHScroll = scrollWidth > clientWidth || bodyScrollWidth > clientWidth;

            // 2. Check Card Bounds
            const boundsCheck = await page.evaluate(() => {
                const elements = document.querySelectorAll('.cyber-card, .top-nav, .personal-subnav');
                const outOfBounds = [];
                elements.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.right > window.innerWidth + 1) { // 1px rounding tolerance
                        outOfBounds.push({
                            id: el.id || el.className,
                            right: rect.right,
                            windowWidth: window.innerWidth
                        });
                    }
                });
                return outOfBounds;
            });

            // 3. Check Battery labels and normalized text
            const batteryTelemetry = await page.evaluate(() => {
                return {
                    voltage: document.getElementById('battery-volt-val')?.textContent,
                    temperature: document.getElementById('battery-temp-val')?.textContent,
                    pct: document.getElementById('battery-pct-val')?.textContent
                };
            });

            // 4. Test Switching to Personal Space
            await page.evaluate(() => DeskOS.switchView('personal-space'));
            await page.waitForTimeout(250);

            const psVisible = await page.evaluate(() => {
                const ps = document.getElementById('view-personal-space');
                const cc = document.getElementById('view-command-center');
                return ps && getComputedStyle(ps).display !== 'none' && cc && getComputedStyle(cc).display === 'none';
            });

            // Check subtabs
            await page.evaluate(() => DeskOS.switchPersonalSubTab('tasks'));
            await page.waitForTimeout(150);
            const tasksVisible = await page.evaluate(() => {
                const pane = document.getElementById('pane-tasks');
                return pane && pane.classList.contains('active');
            });

            await page.evaluate(() => DeskOS.switchPersonalSubTab('timers'));
            await page.waitForTimeout(150);
            const timersVisible = await page.evaluate(() => {
                const pane = document.getElementById('pane-timers');
                return pane && pane.classList.contains('active');
            });

            await page.evaluate(() => DeskOS.switchPersonalSubTab('calendar'));
            await page.waitForTimeout(150);
            const calendarVisible = await page.evaluate(() => {
                const pane = document.getElementById('pane-calendar');
                return pane && pane.classList.contains('active');
            });

            // Switch back to notes and command center
            await page.evaluate(() => DeskOS.switchPersonalSubTab('notes'));
            await page.evaluate(() => DeskOS.switchView('command-center'));
            await page.waitForTimeout(150);

            const vpResult = {
                viewport: vp.name,
                width: vp.width,
                height: vp.height,
                scrollWidth,
                clientWidth,
                horizontalOverflow: hasHScroll,
                outOfBoundsCards: boundsCheck.length,
                batteryTelemetry,
                viewSwitchingOk: psVisible && tasksVisible && timersVisible && calendarVisible,
                consoleErrors
            };

            console.log(`Result: Overflow=${hasHScroll ? 'FAIL' : 'PASS'} (scrollWidth=${scrollWidth}, clientWidth=${clientWidth}) | Bounds: ${boundsCheck.length === 0 ? 'PASS' : 'FAIL'} | Errors: ${consoleErrors.length}`);
            testResults.viewports.push(vpResult);

            await context.close();
        }

        // =====================================================================
        // FUNCTIONAL TESTS (CRUD, Timers, Persistence)
        // =====================================================================
        console.log('\n--- RUNNING FUNCTIONAL ENGINE TESTS ---');
        const funcContext = await browser.newContext({ viewport: { width: 393, height: 873 } });
        const funcPage = await funcContext.newPage();

        await funcPage.addInitScript(() => {
            window.DeskOSBridge = {
                getDeviceInfo: () => JSON.stringify({
                    appVersion: "1.1.0",
                    battery: { percent: 90, isCharging: false, chargeType: "unplugged", voltageMv: 4200, temperatureC: "31.0" },
                    sensorCapabilities: { accelerometer: true }
                }),
                getBatteryStatus: () => JSON.stringify({ percent: 90, isCharging: false, chargeType: "unplugged", voltageMv: 4200, temperatureC: "31.0" }),
                getSensorCapabilities: () => JSON.stringify({ accelerometer: true }),
                getLiveSensors: () => JSON.stringify({ accelX: 0, accelY: 0, accelZ: 9.8 }),
                setScreenDimmed: () => {},
                setKeepScreenOn: () => {},
                triggerHaptic: () => {},
                showNotification: () => true,
                checkNotificationPermission: () => true,
                requestNotificationPermission: () => {},
                getAgentStatus: () => JSON.stringify({
                    state: "CONNECTED",
                    isPaired: true,
                    hostName: "Lenovo LOQ",
                    hostIp: "192.168.1.45",
                    port: 8765
                }),
                pairAgent: () => JSON.stringify({ success: true, message: "Paired successfully" }),
                connectAgent: () => true,
                disconnectAgent: () => true,
                forgetAgentDevice: () => true
            };
        });

        await funcPage.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
        await funcPage.waitForTimeout(500);

        // 1. Notes CRUD & Persistence
        const notesTest = await funcPage.evaluate(async () => {
            // Switch to notes
            DeskOS.switchView('personal-space');
            DeskOS.switchPersonalSubTab('notes');

            // Create note
            NotesModule.createNote();
            document.getElementById('note-title-input').value = 'TEST_AUTOMATED_NOTE';
            document.getElementById('note-body-textarea').value = 'Content for automated verification.';
            NotesModule.commitCurrentNote();

            // Verify in storage
            const storedNotes = await DeskStorage.get('personal_notes', []);
            const found = storedNotes.find(n => n.title === 'TEST_AUTOMATED_NOTE');

            // Search filter
            NotesModule.filterNotes('TEST_AUTOMATED');
            const searchResultsCount = document.querySelectorAll('#notes-list-container .note-list-item').length;

            // Delete active note
            NotesModule.deleteActiveNote();
            const afterDelete = await DeskStorage.get('personal_notes', []);
            const stillFound = afterDelete.find(n => n.title === 'TEST_AUTOMATED_NOTE');

            return {
                savedSuccessfully: !!found,
                filterWorked: searchResultsCount >= 1,
                deletedSuccessfully: !stillFound
            };
        });
        testResults.functional.notes = notesTest;
        console.log('Notes Test:', notesTest);

        // 2. Tasks CRUD & Checklists
        const tasksTest = await funcPage.evaluate(async () => {
            DeskOS.switchPersonalSubTab('tasks');

            // Add Task
            const input = document.getElementById('new-task-input');
            input.value = 'Automated Verification Task';
            TasksModule.addTask();

            const storedTasks = await DeskStorage.get('personal_tasks', []);
            const activeList = storedTasks[0];
            const taskFound = activeList.tasks.find(t => t.text === 'Automated Verification Task');

            // Complete task via DOM checkbox click (mirrors real user tap)
            const checkbox = document.querySelector('#tasks-items-container .task-row:last-child input[type="checkbox"]');
            if (checkbox) {
                checkbox.click();
            }

            const progressText = document.getElementById('tasks-progress-label').textContent;

            // Clear completed
            await TasksModule.clearCompleted();
            const afterClear = await DeskStorage.get('personal_tasks', []);
            const clearedFound = afterClear[0].tasks.find(t => t.text === 'Automated Verification Task');

            return {
                taskAdded: !!taskFound,
                progressUpdated: progressText.includes('%'),
                clearedSuccessfully: !clearedFound
            };
        });
        testResults.functional.tasks = tasksTest;
        console.log('Tasks Test:', tasksTest);

        // 3. Pomodoro & Timers Engine
        const timersTest = await funcPage.evaluate(async () => {
            DeskOS.switchPersonalSubTab('timers');

            // Pomodoro Start / Pause / Reset / Skip
            TimersModule.startPomodoro();
            const pomoRunningText = document.getElementById('pomo-toggle-btn').textContent;
            TimersModule.pausePomodoro();
            const pomoPausedText = document.getElementById('pomo-toggle-btn').textContent;
            TimersModule.skipPomodoro();
            const pomoState = document.getElementById('pomo-state-label').textContent;

            // Stopwatch Start / Lap / Reset
            TimersModule.startStopwatch();
            await new Promise(r => setTimeout(r, 60));
            TimersModule.recordLap();
            const lapsCount = document.querySelectorAll('#stopwatch-laps-list .telemetry-row').length;
            TimersModule.resetStopwatch();
            const swResetTime = document.getElementById('stopwatch-time-display').textContent;

            // Countdown Preset & Start
            TimersModule.setCountdownMinutes(1);
            const cdText = document.getElementById('countdown-time-display').textContent;

            return {
                pomoRunningText,
                pomoPausedText,
                pomoState,
                lapsRecorded: lapsCount >= 1,
                swResetTime,
                countdownPresetSet: cdText === '01:00'
            };
        });
        testResults.functional.timers = timersTest;
        console.log('Timers Test:', timersTest);

        // 4. Calendar & Reminders Engine
        const calendarTest = await funcPage.evaluate(async () => {
            DeskOS.switchPersonalSubTab('calendar');

            // Check days rendered
            const dayCells = document.querySelectorAll('#cal-days-grid .cal-day-cell:not(.empty)');

            // Add reminder
            document.getElementById('new-rem-title').value = 'Automated Review Sync';
            document.getElementById('new-rem-time').value = '15:30';
            CalendarModule.addReminder();

            const storedRem = await DeskStorage.get('personal_reminders', []);
            const remFound = storedRem.find(r => r.title === 'Automated Review Sync');

            return {
                daysRendered: dayCells.length >= 28,
                reminderSaved: !!remFound
            };
        });
        testResults.functional.calendar = calendarTest;
        console.log('Calendar Test:', calendarTest);

        await funcContext.close();

    } finally {
        await browser.close();
        server.close();
        console.log('[TEST SERVER] Closed.');
    }

    fs.writeFileSync(path.resolve('x:/ALL PROJECTS/deskOS/test_results.json'), JSON.stringify(testResults, null, 2));
    console.log('[TEST COMPLETE] Results saved to test_results.json');
}

runTests().catch(err => {
    console.error('Test script failed:', err);
    process.exit(1);
});

