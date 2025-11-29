class BreakManager {
    constructor() {
        this.breakSettings = {
            workDuration: 45,
            breakDuration: 5,
            enabled: true
        };
        this.breakState = {
            isOnBreak: false,
            breakStartTime: null,
            breakEndTime: null,
            lastWorkSessionEnd: null,
            nextBreakScheduled: null
        };
    }

    async init() {
        const data = await chrome.storage.local.get(['breakSettings', 'breakState']);
        if (data.breakSettings) {
            this.breakSettings = { ...this.breakSettings, ...data.breakSettings };
        }
        if (data.breakState) {
            this.breakState = { ...this.breakState, ...data.breakState };
        }

        console.log('BreakManager initialized:', this.breakState);

        // Restore break state
        if (this.breakState.isOnBreak && this.breakState.breakEndTime) {
            const timeLeft = this.breakState.breakEndTime - Date.now();
            if (timeLeft > 0) {
                this.scheduleBreakEnd(timeLeft);
                console.log('Break resumed with', Math.round(timeLeft/1000), 'seconds remaining');
            } else {
                this.endBreak();
            }
        }

        // Schedule next break if needed
        if (!this.breakState.isOnBreak && this.breakState.nextBreakScheduled) {
            const timeUntilBreak = this.breakState.nextBreakScheduled - Date.now();
            if (timeUntilBreak > 0) {
                this.scheduleNextBreak(timeUntilBreak);
                console.log('Next break scheduled in', Math.round(timeUntilBreak/1000), 'seconds');
            }
        }
    }

    async saveBreakData() {
        await chrome.storage.local.set({
            breakSettings: this.breakSettings,
            breakState: this.breakState
        });
    }

    updateSettings(newSettings) {
        this.breakSettings = { ...this.breakSettings, ...newSettings };
        this.saveBreakData();

        console.log('Break settings updated:', this.breakSettings);

        // Reschedule break if tracking is active
        if (typeof focusGuardian !== 'undefined' && focusGuardian.isTracking && !this.breakState.isOnBreak) {
            this.scheduleNextBreak();
        }
    }

    scheduleNextBreak(delay = null) {
        chrome.alarms.clear('scheduled-break');

        if (!this.breakSettings.enabled) {
            this.breakState.nextBreakScheduled = null;
            this.saveBreakData();
            console.log('Breaks disabled - no break scheduled');
            return;
        }

        const delayMs = delay || this.breakSettings.workDuration * 60 * 1000;
        this.breakState.nextBreakScheduled = Date.now() + delayMs;

        chrome.alarms.create('scheduled-break', {
            delayInMinutes: delayMs / 60000
        });

        this.saveBreakData();
        console.log(`Next break scheduled in ${delayMs / 60000} minutes`);
    }

    startBreak() {
        if (this.breakState.isOnBreak) return;

        this.breakState.isOnBreak = true;
        this.breakState.breakStartTime = Date.now();
        this.breakState.breakEndTime = Date.now() + (this.breakSettings.breakDuration * 60 * 1000);
        this.breakState.lastWorkSessionEnd = Date.now();
        this.breakState.nextBreakScheduled = null;

        console.log('Break started for', this.breakSettings.breakDuration, 'minutes');

        // Clear ModeOn timers if available
        if (typeof focusGuardian !== 'undefined') {
            focusGuardian.clearAllTimers();
            focusGuardian.isCurrentlyDistracted = false;
            focusGuardian.lastTabStatus = null;
        }

        this.showBreakNotification('start');
        this.scheduleBreakEnd();
        this.saveBreakData();

        // Notify popup
        chrome.runtime.sendMessage({
            action: 'breakStateChanged',
            breakState: this.breakState
        }).catch(() => {});
    }

    scheduleBreakEnd(delay = null) {
        chrome.alarms.clear('break-end');

        const delayMs = delay || this.breakSettings.breakDuration * 60 * 1000;

        chrome.alarms.create('break-end', {
            delayInMinutes: delayMs / 60000
        });

        console.log('Break end scheduled in', delayMs / 60000, 'minutes');
    }

    endBreak() {
        if (!this.breakState.isOnBreak) return;

        console.log('Break ended');

        this.breakState.isOnBreak = false;
        this.breakState.breakStartTime = null;
        this.breakState.breakEndTime = null;

        this.showBreakNotification('end');
        this.scheduleNextBreak();
        this.saveBreakData();

        // Resume tracking if available
        if (typeof focusGuardian !== 'undefined' && focusGuardian.isTracking) {
            focusGuardian.checkCurrentTab();
        }

        chrome.runtime.sendMessage({
            action: 'breakStateChanged',
            breakState: this.breakState
        }).catch(() => {});
    }

    skipBreak() {
        if (!this.breakState.isOnBreak) return;

        this.endBreak();
        this.showBreakNotification('skipped');
    }

    showBreakNotification(type) {
        const messages = {
            start: {
                title: '🌴 Time for a Break!',
                message: `Take ${this.breakSettings.breakDuration} minutes to relax. You've earned it!`
            },
            end: {
                title: '⏰ Break Time Over!',
                message: 'Time to get back to work. Stay focused!'
            },
            skipped: {
                title: '🚀 Break Skipped!',
                message: 'Back to work mode. Stay productive!'
            }
        };

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: messages[type].title,
            message: messages[type].message,
            priority: 2
        });
    }

    getBreakStatus() {
        const now = Date.now();
        let timeRemaining = 0;

        if (this.breakState.isOnBreak && this.breakState.breakEndTime) {
            timeRemaining = Math.max(0, this.breakState.breakEndTime - now);
        }

        let nextBreakIn = 0;
        if (!this.breakState.isOnBreak && this.breakState.nextBreakScheduled) {
            nextBreakIn = Math.max(0, this.breakState.nextBreakScheduled - now);
        }

        return {
            isOnBreak: this.breakState.isOnBreak,
            timeRemaining: Math.ceil(timeRemaining / 1000),
            nextBreakIn: Math.ceil(nextBreakIn / 1000),
            breakStartTime: this.breakState.breakStartTime,
            settings: this.breakSettings
        };
    }
}

class FocusGuardian {
    constructor() {
        this.focusKeyword = '';
        this.isTracking = false;
        this.focusWords = [];
        this.currentSession = {
            focusTime: 0,
            distractionTime: 0,
            startTime: null,
            breaksTaken: 0,
            totalBreakTime: 0,
            lastUpdateTime: null
        };
        this.distractionTimer = null;
        this.repeatWarningTimer = null;
        this.hasShownInitialWarning = false;
        this.isCurrentlyDistracted = false;
        this.lastDistractionStartTime = null;
        this.breakManager = new BreakManager();
        this.lastTabStatus = null;
        this.focusTimeAccumulator = 0;
        this.distractionTimeAccumulator = 0;

        this.relatedWords = {
            "react": ["javascript", "frontend", "hooks", "next.js", "redux", "jsx", "reactjs", "components", "state", "props"],
            "python": ["flask", "django", "machine learning", "numpy", "pandas", "python3", "data science", "automation"],
            "ai": ["artificial intelligence", "machine learning", "neural network", "deep learning", "llm", "gpt", "transformer", "computer vision"],
            "javascript": ["js", "ecmascript", "node.js", "frontend", "typescript", "es6", "web development"],
            "coding": ["programming", "development", "algorithm", "github", "stackoverflow", "debugging", "software engineering", "code review"],
            "web development": ["html", "css", "javascript", "frontend", "backend", "fullstack", "web design", "responsive design"],
            "database": ["sql", "mysql", "mongodb", "postgresql", "queries", "schema", "indexing"],
            "android": ["kotlin", "java", "mobile development", "android studio", "sdk", "app development"]
        };

        this.stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'learn', 'study', 'practice',
            'master', 'understand', 'working', 'focus', 'topic', 'subject'
        ]);

        this.educationalPatterns = [
            'tutorial', 'course', 'lesson', 'guide', 'how to', 'training',
            'introduction', 'fundamentals', 'explained', 'basics', 'docs'
        ];

        this.distractionSites = {
            "youtube.com": this.isYouTubeDistraction.bind(this),
            "youtu.be": this.isYouTubeDistraction.bind(this),
            "netflix.com": () => true,
            "twitter.com": () => true,
            "facebook.com": () => true,
            "instagram.com": () => true,
            "tiktok.com": () => true,
            "reddit.com": () => true
        };

        this.init();
    }

    async init() {
        const data = await chrome.storage.local.get(['focusKeyword', 'currentSession', 'isTracking']);
        if (data.focusKeyword) this.focusKeyword = data.focusKeyword;
        if (data.currentSession) {
            this.currentSession = { ...this.currentSession, ...data.currentSession };
            // Reset lastUpdateTime to avoid large time jumps
            this.currentSession.lastUpdateTime = Date.now();
        }
        this.isTracking = data.isTracking || false;
        await this.breakManager.init();

        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'scheduled-break') {
                console.log('Scheduled break alarm triggered');
                this.breakManager.startBreak();
            } else if (alarm.name === 'break-end') {
                console.log('Break end alarm triggered');
                this.breakManager.endBreak();
            }
        });

        // Start time tracking interval
        setInterval(() => this.updateTimeTracking(), 1000);

        // Debug logging
        setInterval(() => {
            if (this.isTracking && !this.breakManager.breakState.isOnBreak) {
                console.log('Time Tracking Debug:', {
                    lastTabStatus: this.lastTabStatus,
                    focusAccumulator: this.focusTimeAccumulator.toFixed(1),
                    distractionAccumulator: this.distractionTimeAccumulator.toFixed(1),
                    sessionFocus: this.currentSession.focusTime.toFixed(1),
                    sessionDistraction: this.currentSession.distractionTime.toFixed(1)
                });
            }
        }, 10000);

        if (this.isTracking) this.startTracking();
    }

    async saveData() {
        await chrome.storage.local.set({
            focusKeyword: this.focusKeyword,
            currentSession: this.currentSession,
            isTracking: this.isTracking
        });
    }

    extractFocusWords(keyword) {
        const words = keyword.toLowerCase().split(/\s+/);
        const meaningful = words.filter(w => w.length > 2 && !this.stopWords.has(w));
        meaningful.push(keyword.toLowerCase());
        return [...new Set(meaningful)];
    }

    async startSession(keyword, sessionSettings = null) {
        this.focusKeyword = keyword.toLowerCase();
        this.focusWords = this.extractFocusWords(this.focusKeyword);

        console.log('Starting session with focus words:', this.focusWords);

        this.currentSession = {
            focusTime: 0,
            distractionTime: 0,
            startTime: Date.now(),
            breaksTaken: 0,
            totalBreakTime: 0,
            lastUpdateTime: Date.now()
        };
        this.isTracking = true;
        this.lastTabStatus = null;
        this.clearAllTimers();

        if (sessionSettings) {
            this.breakManager.updateSettings(sessionSettings);
        }

        await this.saveData();
        this.startTracking();

        if (this.breakManager.breakSettings.enabled) {
            this.breakManager.scheduleNextBreak();
        }

        console.log('Session started successfully');
    }

    stopSession() {
        console.log('Session stopped');
        this.isTracking = false;
        this.clearAllTimers();
        this.saveData();
        
        // Clear break scheduling
        this.breakManager.updateSettings({ enabled: false });
    }

    async isTabOnTopic(tab) {
        if (!this.focusKeyword || !this.focusWords) return false;
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return false;

        const searchText = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();

        try {
            const domain = new URL(tab.url).hostname.replace('www.', '');
            if (this.distractionSites[domain]) {
                const isDistraction = await this.distractionSites[domain](tab);
                if (isDistraction) return false;
            }
        } catch (_) {}

        if (searchText.includes(this.focusKeyword)) return true;

        for (const word of this.focusWords) {
            if (word === this.focusKeyword || word.length < 3) continue;
            if (searchText.includes(word)) return true;
            const related = this.relatedWords[word];
            if (related && related.some(r => searchText.includes(r.toLowerCase()))) return true;
        }

        return this.isEducationalContent(tab);
    }

    isEducationalContent(tab) {
        const searchText = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();

        for (const word of this.focusWords) {
            if (word === this.focusKeyword || word.length < 3) continue;
            if (searchText.includes(word)) return true;
        }

        return this.educationalPatterns.some(p => searchText.includes(p));
    }

    isYouTubeDistraction(tab) {
        // Check if YouTube video is educational
        const searchText = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();
        const educationalKeywords = [...this.focusWords, ...this.educationalPatterns];
        
        return !educationalKeywords.some(keyword => 
            searchText.includes(keyword.toLowerCase())
        );
    }

    startTracking() {
        console.log('Starting tab tracking');
        // Add tab change listeners
        chrome.tabs.onActivated.addListener(this.checkCurrentTab.bind(this));
        chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
        
        // Check current tab immediately
        this.checkCurrentTab();
    }

    clearAllTimers() {
        if (this.distractionTimer) {
            clearTimeout(this.distractionTimer);
            this.distractionTimer = null;
        }
        if (this.repeatWarningTimer) {
            clearTimeout(this.repeatWarningTimer);
            this.repeatWarningTimer = null;
        }
        this.hasShownInitialWarning = false;
        this.isCurrentlyDistracted = false;
        this.focusTimeAccumulator = 0;
        this.distractionTimeAccumulator = 0;
    }

    async checkCurrentTab() {
        if (!this.isTracking || this.breakManager.breakState.isOnBreak) return;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await this.analyzeTab(tab);
            }
        } catch (error) {
            console.error('Error checking current tab:', error);
        }
    }

    async handleTabUpdate(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete' && tab.active && this.isTracking && !this.breakManager.breakState.isOnBreak) {
            await this.analyzeTab(tab);
        }
    }

    async analyzeTab(tab) {
        if (!this.isTracking || this.breakManager.breakState.isOnBreak) return;

        const isOnTopic = await this.isTabOnTopic(tab);
        
        console.log(`Tab analysis: ${tab.url} - On topic: ${isOnTopic}`);
        
        // CORRECTED: Clear logic for status assignment
        if (isOnTopic) {
            this.lastTabStatus = 'focus';
            this.handleFocusTime();
        } else {
            this.lastTabStatus = 'distraction'; 
            this.handleDistractionTime();
        }
    }

    handleFocusTime() {
        if (this.isCurrentlyDistracted) {
            this.isCurrentlyDistracted = false;
            this.lastDistractionStartTime = null;
            this.clearDistractionTimers();
        }
    }

    handleDistractionTime() {
        if (!this.isCurrentlyDistracted) {
            this.isCurrentlyDistracted = true;
            this.lastDistractionStartTime = Date.now();
            this.startDistractionWarning();
        }
    }

    startDistractionWarning() {
        // Show initial warning after 1 minute
        this.distractionTimer = setTimeout(() => {
            this.showDistractionWarning();
            
            // Schedule repeat warnings every 30 seconds
            this.repeatWarningTimer = setInterval(() => {
                this.showDistractionWarning();
            }, 10000);
            
        }, 60000); // 1 minute
    }

    clearDistractionTimers() {
        if (this.distractionTimer) {
            clearTimeout(this.distractionTimer);
            this.distractionTimer = null;
        }
        if (this.repeatWarningTimer) {
            clearInterval(this.repeatWarningTimer);  
            this.repeatWarningTimer = null;
        }
        this.hasShownInitialWarning = false;
    }

    showDistractionWarning() {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: '⚠️ Stay Focused!',
            message: `You're on a distracting site. Get back to ${this.focusKeyword}!`,
            priority: 1
        });
        this.hasShownInitialWarning = true;
    }

    updateTimeTracking() {
        if (!this.isTracking || this.breakManager.breakState.isOnBreak) {
            this.currentSession.lastUpdateTime = Date.now();
            return;
        }

        const now = Date.now();
        const lastUpdate = this.currentSession.lastUpdateTime || now;
        const timeDiff = (now - lastUpdate) / 1000; // in seconds

        if (timeDiff <= 0) return;

        // CORRECTED: Clear logic for time accumulation
        if (this.lastTabStatus === 'focus') {
            this.focusTimeAccumulator += timeDiff;
        } else if (this.lastTabStatus === 'distraction') {
            this.distractionTimeAccumulator += timeDiff;
        } else {
            // If status is unknown, don't accumulate time
            console.log('Unknown tab status, no time accumulated');
        }

        // Update session time every 5 seconds to reduce storage operations
        if (this.focusTimeAccumulator >= 5 || this.distractionTimeAccumulator >= 5) {
            this.currentSession.focusTime += this.focusTimeAccumulator;
            this.currentSession.distractionTime += this.distractionTimeAccumulator;
            this.currentSession.lastUpdateTime = now;
            
            console.log(`Session updated - Focus: ${this.currentSession.focusTime.toFixed(1)}s, Distraction: ${this.currentSession.distractionTime.toFixed(1)}s`);
            
            this.focusTimeAccumulator = 0;
            this.distractionTimeAccumulator = 0;
            
            this.saveData();
        }
    }

    getStats() {
        const totalTime = this.currentSession.focusTime + this.currentSession.distractionTime;
        const focusRatio = totalTime > 0 ? Math.round((this.currentSession.focusTime / totalTime) * 100) : 0;

        console.log(`Stats calculated - Focus: ${Math.floor(this.currentSession.focusTime/60)}m, Distraction: ${Math.floor(this.currentSession.distractionTime/60)}m, Ratio: ${focusRatio}%`);

        return {
            focusKeyword: this.focusKeyword,
            focusTime: Math.floor(this.currentSession.focusTime / 60), // Convert to minutes
            distractionTime: Math.floor(this.currentSession.distractionTime / 60), // Convert to minutes
            focusRatio: focusRatio,
            breakStatus: this.breakManager.getBreakStatus(),
            isTracking: this.isTracking,
            currentActivity: this.lastTabStatus
        };
    }
}

// Initialize ModeOn
const focusGuardian = new FocusGuardian();

// Handle popup messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handleAsync = async () => {
        try {
            console.log('Received message:', request.action);
            
            switch (request.action) {
                case 'startSession':
                    await focusGuardian.startSession(request.keyword, request.sessionSettings);
                    return { success: true };
                    
                case 'stopSession':
                    focusGuardian.stopSession();
                    return { success: true };
                    
                case 'getStats':
                    const stats = focusGuardian.getStats();
                    return stats;
                    
                case 'getStatus':
                    return {
                        isTracking: focusGuardian.isTracking,
                        focusKeyword: focusGuardian.focusKeyword,
                        breakStatus: focusGuardian.breakManager.getBreakStatus(),
                        currentActivity: focusGuardian.lastTabStatus
                    };
                    
                case 'updateBreakSettings':
                    focusGuardian.breakManager.updateSettings(request.settings);
                    return { 
                        success: true, 
                        breakStatus: focusGuardian.breakManager.getBreakStatus() 
                    };
                    
                case 'startBreakNow':
                    focusGuardian.breakManager.startBreak();
                    return { success: true };
                    
                case 'endBreakNow':
                    focusGuardian.breakManager.endBreak();
                    return { success: true };
                    
                case 'skipBreak':
                    focusGuardian.breakManager.skipBreak();
                    return { success: true };
                    
                case 'checkCurrentTab':
                    await focusGuardian.checkCurrentTab();
                    return { success: true };
                    
                default:
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            console.error('Error handling message:', error);
            return { success: false, error: error.message };
        }
    };

    // Handle async response properly
    handleAsync().then(sendResponse);
    return true;
});