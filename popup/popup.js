class PopupManager {
    constructor() {
        this.currentView = 'setup';
        this.currentSessionSettings = {
            workDuration: 45,
            breakDuration: 5,
            enableBreaks: true
        };
        this.isTracking = false;
        
        this.initializeEventListeners();
        this.loadCurrentState();
    }

    initializeEventListeners() {
        // Focus keyword input
        document.getElementById('focusKeyword').addEventListener('input', (e) => {
            this.updateFocusWordsPreview(e.target.value);
        });

        // Number input buttons
        document.querySelectorAll('.number-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.handleNumberInputChange(e);
            });
        });

        // Number inputs
        document.getElementById('workDuration').addEventListener('change', (e) => {
            this.currentSessionSettings.workDuration = parseInt(e.target.value);
            this.updatePresetButtons();
        });

        document.getElementById('breakDuration').addEventListener('change', (e) => {
            this.currentSessionSettings.breakDuration = parseInt(e.target.value);
            this.updatePresetButtons();
        });

        // Break toggle
        document.getElementById('enableBreaks').addEventListener('change', (e) => {
            this.currentSessionSettings.enableBreaks = e.target.checked;
            this.updatePresetButtons();
        });

        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.handlePresetSelect(e.target.dataset.preset);
            });
        });

        // Start session button
        document.getElementById('startBtn').addEventListener('click', () => {
            this.startSession();
        });

        // Stop session button
        document.getElementById('stopBtn').addEventListener('click', () => {
            this.stopSession();
        });

        // Dashboard break controls
        document.getElementById('breakToggle').addEventListener('change', (e) => {
            this.updateBreakSettings();
        });

        document.getElementById('workDurationDashboard').addEventListener('change', (e) => {
            this.currentSessionSettings.workDuration = parseInt(e.target.value);
            this.updateBreakSettings();
        });

        document.getElementById('breakDurationDashboard').addEventListener('change', (e) => {
            this.currentSessionSettings.breakDuration = parseInt(e.target.value);
            this.updateBreakSettings();
        });

        document.getElementById('startBreakBtn').addEventListener('click', () => {
            this.startBreakNow();
        });

        document.getElementById('endBreakBtn').addEventListener('click', () => {
            this.endBreakNow();
        });
    }

    updateFocusWordsPreview(keyword) {
        const preview = document.getElementById('focusWordsPreview');
        if (!keyword.trim()) {
            preview.innerHTML = '';
            return;
        }

        const words = this.extractFocusWords(keyword);
        preview.innerHTML = words.map(word => 
            `<span class="word-tag">${word}</span>`
        ).join('');
    }

    extractFocusWords(keyword) {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'learn', 'study', 'practice',
            'master', 'understand', 'working', 'focus', 'topic', 'subject'
        ]);

        const words = keyword.toLowerCase().split(/\s+/);
        const meaningful = words.filter(w => w.length > 2 && !stopWords.has(w));
        meaningful.push(keyword.toLowerCase());
        return [...new Set(meaningful)];
    }

    handleNumberInputChange(event) {
        const target = event.target.dataset.target;
        const change = parseInt(event.target.dataset.change);
        const input = document.getElementById(target);
        let value = parseInt(input.value) + change;

        // Apply min/max constraints
        const min = parseInt(input.min);
        const max = parseInt(input.max);
        value = Math.max(min, Math.min(max, value));

        input.value = value;
        
        // Update settings
        if (target === 'workDuration') {
            this.currentSessionSettings.workDuration = value;
        } else if (target === 'breakDuration') {
            this.currentSessionSettings.breakDuration = value;
        }

        this.updatePresetButtons();
    }

    handlePresetSelect(preset) {
        // Remove active class from all preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to the clicked button
        const clickedButton = document.querySelector(`[data-preset="${preset}"]`);
        if (clickedButton) {
            clickedButton.classList.add('active');
        }

        switch(preset) {
            case 'pomodoro':
                this.currentSessionSettings.workDuration = 25;
                this.currentSessionSettings.breakDuration = 5;
                this.currentSessionSettings.enableBreaks = true;
                break;
            case 'deepwork':
                this.currentSessionSettings.workDuration = 45;
                this.currentSessionSettings.breakDuration = 15;
                this.currentSessionSettings.enableBreaks = true;
                break;
            case 'custom':
                // Keep current settings - don't change anything
                break;
        }

        this.updateNumberInputs();
        // Don't call updatePresetButtons() here as it would override the active state
    }

    updateNumberInputs() {
        document.getElementById('workDuration').value = this.currentSessionSettings.workDuration;
        document.getElementById('breakDuration').value = this.currentSessionSettings.breakDuration;
        document.getElementById('enableBreaks').checked = this.currentSessionSettings.enableBreaks;
    }

    updatePresetButtons() {
        const isPomodoro = this.currentSessionSettings.workDuration === 25 && 
                          this.currentSessionSettings.breakDuration === 5;
        const isDeepWork = this.currentSessionSettings.workDuration === 45 && 
                          this.currentSessionSettings.breakDuration === 15;

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (isPomodoro) {
            document.querySelector('[data-preset="pomodoro"]').classList.add('active');
        } else if (isDeepWork) {
            document.querySelector('[data-preset="deepwork"]').classList.add('active');
        } else {
            document.querySelector('[data-preset="custom"]').classList.add('active');
        }
    }

    async loadCurrentState() {
        try {
            const response = await this.sendMessage({ action: 'getStatus' });
            if (response) {
                this.isTracking = response.isTracking;
                this.updateUI(response);
                
                if (this.isTracking) {
                    this.showDashboard();
                    this.startDashboardUpdates();
                } else {
                    this.showSetup();
                }
            }
        } catch (error) {
            console.error('Error loading current state:', error);
            this.showSetup();
        }
    }

    async startSession() {
        const keyword = document.getElementById('focusKeyword').value.trim();
        if (!keyword) {
            alert('Please enter a focus topic');
            return;
        }

        try {
            const response = await this.sendMessage({
                action: 'startSession',
                keyword: keyword,
                sessionSettings: this.currentSessionSettings
            });

            if (response.success) {
                this.isTracking = true;
                this.showDashboard();
                this.startDashboardUpdates();
                this.updateBreakSettings();  // Added to automatically start the break timer if breaks are enabled
            } else {
                alert('Failed to start session: ' + (response.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error starting session:', error);
            alert('Failed to start session');
        }
    }

    async stopSession() {
        try {
            const response = await this.sendMessage({ action: 'stopSession' });
            if (response.success) {
                this.isTracking = false;
                this.showSetup();
                this.stopDashboardUpdates();
            }
        } catch (error) {
            console.error('Error stopping session:', error);
        }
    }

    async updateBreakSettings() {
        const settings = {
            workDuration: parseInt(document.getElementById('workDurationDashboard').value),
            breakDuration: parseInt(document.getElementById('breakDurationDashboard').value),
            enabled: document.getElementById('breakToggle').checked
        };

        try {
            await this.sendMessage({
                action: 'updateBreakSettings',
                settings: settings
            });
        } catch (error) {
            console.error('Error updating break settings:', error);
        }
    }

    async startBreakNow() {
        try {
            await this.sendMessage({ action: 'startBreakNow' });
        } catch (error) {
            console.error('Error starting break:', error);
        }
    }

    async endBreakNow() {
        try {
            await this.sendMessage({ action: 'endBreakNow' });
        } catch (error) {
            console.error('Error ending break:', error);
        }
    }

    showSetup() {
        document.getElementById('setupView').classList.remove('hidden');
        document.getElementById('dashboardView').classList.add('hidden');
        document.getElementById('statusIndicator').textContent = 'Not Tracking';
    }

    showDashboard() {
        document.getElementById('setupView').classList.add('hidden');
        document.getElementById('dashboardView').classList.remove('hidden');
        document.getElementById('statusIndicator').textContent = 'Tracking';
    }

    updateUI(data) {
        // Update session info
        if (data.focusKeyword) {
            document.getElementById('currentTopic').textContent = data.focusKeyword;
        }

        // Update stats
        if (data.focusTime !== undefined) {
            document.getElementById('focusTime').textContent = `${data.focusTime}m`;
            document.getElementById('distractionTime').textContent = `${data.distractionTime}m`;
            document.getElementById('focusRatio').textContent = `${data.focusRatio}%`;
            
            // Update progress ring
            this.updateProgressRing(data.focusRatio);
            
            // Update legend
            document.getElementById('legendFocus').textContent = `${data.focusTime}m`;
            document.getElementById('legendDistraction').textContent = `${data.distractionTime}m`;
        }

        // Update activity indicator
        this.updateActivityIndicator(data.currentActivity);

        // Update break settings in dashboard
        if (data.breakStatus) {
            this.updateBreakTimer(data.breakStatus);
        }

        // Update session duration display
        const durationText = `${this.currentSessionSettings.workDuration}m focus • ${this.currentSessionSettings.breakDuration}m break`;
        document.getElementById('sessionDuration').textContent = durationText;
    }

    updateProgressRing(ratio) {
        const circle = document.getElementById('progressCircle');
        const valueElement = document.getElementById('ringValue');
        
        if (circle && valueElement) {
            const circumference = 2 * Math.PI * 64;
            const offset = circumference - (ratio / 100) * circumference;
            
            circle.style.strokeDashoffset = offset;
            valueElement.textContent = `${ratio}%`;
        }
    }

    updateActivityIndicator(activity) {
        const dot = document.getElementById('activityDot');
        const text = document.getElementById('activityText');
        
        if (dot && text) {
            // Remove all activity classes
            dot.classList.remove('focus', 'distraction', 'unknown');
            
            // Add the current activity class
            dot.classList.add(activity || 'unknown');
            
            // Update text
            text.textContent = `Currently: ${this.getActivityText(activity)}`;
        }
    }

    getActivityText(activity) {
        switch(activity) {
            case 'focus': return 'Focused 🎯';
            case 'distraction': return 'Distracted 😔';
            default: return 'Loading...';
        }
    }

    updateBreakTimer(breakStatus) {
        const breakToggle = document.getElementById('breakToggle');
        const workDurationInput = document.getElementById('workDurationDashboard');
        const breakDurationInput = document.getElementById('breakDurationDashboard');
        const timerText = document.getElementById('timerText');
        const startBreakBtn = document.getElementById('startBreakBtn');
        const endBreakBtn = document.getElementById('endBreakBtn');

        // Update settings controls
        if (breakStatus.settings) {
            breakToggle.checked = breakStatus.settings.enabled;
            workDurationInput.value = breakStatus.settings.workDuration;
            breakDurationInput.value = breakStatus.settings.breakDuration;
        }

        // Update timer display
        if (breakStatus.isOnBreak) {
            const minutes = Math.floor(breakStatus.timeRemaining / 60);
            const seconds = breakStatus.timeRemaining % 60;
            timerText.textContent = `Break time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            startBreakBtn.classList.add('hidden');
            endBreakBtn.classList.remove('hidden');
        } else {
            const minutes = Math.floor(breakStatus.nextBreakIn / 60);
            const seconds = breakStatus.nextBreakIn % 60;
            timerText.textContent = `Next break in: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            startBreakBtn.classList.remove('hidden');
            endBreakBtn.classList.add('hidden');
        }
    }

    startDashboardUpdates() {
        // Update immediately
        this.updateDashboard();
        
        // Set up periodic updates
        this.dashboardInterval = setInterval(() => {
            this.updateDashboard();
        }, 1000);
    }

    stopDashboardUpdates() {
        if (this.dashboardInterval) {
            clearInterval(this.dashboardInterval);
            this.dashboardInterval = null;
        }
    }

    async updateDashboard() {
        try {
            const response = await this.sendMessage({ action: 'getStats' });
            if (response) {
                this.updateUI(response);
            }
        } catch (error) {
            console.error('Error updating dashboard:', error);
        }
    }

    sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});
