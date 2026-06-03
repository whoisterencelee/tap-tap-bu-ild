class RRWebRecorder {
    constructor(serverUrl = null, userId = null, options = {}) {
        this.serverUrl = serverUrl || this.detectServerUrl();
        this.sessionId = this.generateSessionId();
        this.userId = userId || this.getUserId();
        this.events = [];
        this.isRecording = false;
        this.stopFn = null;
        this.chunkSize = options.chunkSize || 100;
        this.currentChunk = 0;
        this.recordStartTime = null;
        this.retryCount = 0;
        this.maxRetries = options.maxRetries || 3;
        this.autoSendInterval = options.autoSendInterval || 10000; // 10 seconds
        this.chunkInterval = null;
        this.originalConsole = {};
        this.pendingEvents = [];
        this.isSending = false;
        
        // Recording options
        this.recordOptions = {
            recordCrossOriginIframes: true,
            recordAfter: 'DOMContentLoaded',
            inlineStylesheet: true,
            collectFonts: true,
            blockClass: 'rr-block',
            ignoreClass: 'rr-ignore',
            maskTextClass: 'rr-mask',
            maskAllInputs: true,
            maskInputOptions: {
                password: true,
                email: true,
                tel: true,
                number: true,
                text: false
            },
            sampling: {
                scroll: 150,
                mouseInteraction: {
                    MouseUp: false,
                    MouseDown: false,
                    Click: false,
                    ContextMenu: false,
                    DoubleClick: false,
                    Focus: false,
                    Blur: false,
                    TouchStart: false,
                    TouchEnd: false
                }
            },
            plugins: [
                // rrweb.getRecordConsolePlugin({
                //     level: ['error', 'warn', 'log', 'info'],
                //     lengthThreshold: 10000,
                //     stringifyOptions: {
                //         stringLengthLimit: 1000
                //     }
                // })
            ],
            ...options.recordOptions
        };

        console.log('🎥 RRWeb Recorder Initialized:', {
            userId: this.userId,
            sessionId: this.sessionId,
            serverUrl: this.serverUrl
        });

        this.initializeSession();
    }

    // Generate unique session ID
    generateSessionId() {
        return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    // Get or generate user ID from localStorage
    getUserId() {
        let userId = localStorage.getItem('rrweb_user_id');
        
        if (!userId) {
            userId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('rrweb_user_id', userId);
            console.log('🆕 Generated new user ID:', userId);
        }
        
        return userId;
    }

    // Set custom user ID (for when you have your own auth system)
    setUserId(newUserId) {
        if (newUserId && newUserId !== this.userId) {
            this.userId = newUserId;
            localStorage.setItem('rrweb_user_id', newUserId);
            console.log('👤 User ID updated:', newUserId);
            
            // Update the session with new userId
            if (this.isRecording) {
                this.updateSessionUserId();
            }
        }
    }

    // Auto-detect server URL based on current environment
    detectServerUrl() {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        
        // Development URLs
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return `${protocol}//${hostname}:3040`;
        }
        
        // Production URL for functional.limited
        if (hostname.includes('functional.limited') || hostname.includes('particiate.org')) {
            return 'https://particiate.org/record';
        }
        
        // Fallback
        return 'http://localhost:3040';
    }

    // Enhanced request handler with retry logic
    async makeRequest(url, options, retry = 0) {
        try {
            console.log('📤 Making request to:', url);
            const response = await fetch(url, {
                ...options,
                mode: 'cors',
                credentials: 'omit'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('✅ Request successful:', data);
            return data;
            
        } catch (error) {
            console.error(`❌ Request failed (attempt ${retry + 1}/${this.maxRetries + 1}):`, error);
            
            if (retry < this.maxRetries) {
                const delay = Math.pow(2, retry) * 1000;
                console.log(`🔄 Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.makeRequest(url, options, retry + 1);
            }
            
            throw error;
        }
    }

    // Test server connection
    async testConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                mode: 'cors'
            });
            return response.ok;
        } catch (error) {
            console.error('🔌 Connection test failed:', error);
            return false;
        }
    }

    // Initialize session with backend
    async initializeSession() {
        const isConnected = await this.testConnection();
        
        if (!isConnected) {
            console.warn('🚫 Cannot connect to server. Recording will work locally but data will not be saved.');
            this.showWarning('Cannot connect to server. Recording locally only.');
            return;
        }

        try {
            const data = await this.makeRequest(`${this.serverUrl}/api/session`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    userId: this.userId,
                    screenResolution: {
                        width: screen.width,
                        height: screen.height
                    },
                    viewportSize: {
                        width: window.innerWidth,
                        height: window.innerHeight
                    },
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                })
            });
            
            console.log('🎬 Session initialized:', data);
            this.updateSessionInfo(data.deviceType, data.userId);
            this.showSuccess('Connected to server');
            
        } catch (error) {
            console.error('❌ Failed to initialize session:', error);
            this.showError('Failed to connect to server. Recording locally.');
        }
    }

    // Update session with new user ID
    async updateSessionUserId() {
        try {
            await this.makeRequest(`${this.serverUrl}/api/session`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    userId: this.userId,
                    screenResolution: {
                        width: screen.width,
                        height: screen.height
                    },
                    viewportSize: {
                        width: window.innerWidth,
                        height: window.innerHeight
                    },
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                })
            });
            
            console.log('✅ Session updated with userId:', this.userId);
        } catch (error) {
            console.error('❌ Failed to update session userId:', error);
        }
    }

    // Start recording
    async startRecording() {
        if (this.isRecording) {
            console.log('⚠️ Recording already in progress');
            return;
        }

        this.events = [];
        this.currentChunk = 0;
        this.recordStartTime = Date.now();
        this.isRecording = true;

        this.updateUIState(true);
        console.log('🎥 Starting rrweb recording...');

        try {
            // Start rrweb recording
            this.stopFn = rrweb.record({
                emit: (event) => {
                    this.handleRecordedEvent(event);
                },
                ...this.recordOptions
            });

            // Intercept console logs
            this.interceptConsole();

            // Start periodic chunk sending
            this.chunkInterval = setInterval(() => {
                if (this.events.length > 0 && !this.isSending) {
                    this.sendChunk(false);
                }
            }, this.autoSendInterval);

            // Add event listeners for page visibility changes
            this.setupVisibilityHandlers();

            console.log('✅ RRWeb recording started');
            this.showSuccess('Recording started');

        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            this.showError('Failed to start recording');
            this.isRecording = false;
            this.updateUIState(false);
        }
    }

    // Handle recorded events from rrweb
    handleRecordedEvent(event) {
        if (!this.isRecording) return;

        // Add timestamp if not present
        if (!event.timestamp) {
            event.timestamp = Date.now();
        }

        this.events.push(event);
        this.updateEventCount();
        
        // Send chunk if size limit reached
        if (this.events.length >= this.chunkSize && !this.isSending) {
            this.sendChunk(false);
        }
    }

    // Intercept console methods to record logs
    interceptConsole() {
        const methods = ['log', 'error', 'warn', 'info', 'debug'];
        
        methods.forEach(method => {
            this.originalConsole[method] = console[method];
            console[method] = (...args) => {
                // Call original console method
                this.originalConsole[method].apply(console, args);
                
                // Record console event if recording
                if (this.isRecording) {
                    const consoleEvent = {
                        type: 6, // Plugin event type
                        data: {
                            plugin: 'rrweb/console@1',
                            payload: {
                                level: method,
                                trace: [],
                                payload: args.map(arg => 
                                    typeof arg === 'object' ? 
                                    (arg instanceof Error ? arg.toString() : JSON.stringify(arg)) : 
                                    String(arg)
                                )
                            }
                        },
                        timestamp: Date.now()
                    };
                    this.handleRecordedEvent(consoleEvent);
                }
            };
        });
    }

    // Restore original console methods
    restoreConsole() {
        if (this.originalConsole) {
            Object.keys(this.originalConsole).forEach(method => {
                console[method] = this.originalConsole[method];
            });
        }
    }

    // Send chunk of events to server
    async sendChunk(isFinal = false) {
        if (this.events.length === 0 || this.isSending) return;

        this.isSending = true;
        const chunkEvents = [...this.events];
        this.events = [];

        try {
            const data = await this.makeRequest(`${this.serverUrl}/api/recordings`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    userId: this.userId,
                    events: chunkEvents,
                    startTime: this.recordStartTime,
                    endTime: Date.now(),
                    metadata: {
                        url: window.location.href,
                        title: document.title,
                        referrer: document.referrer,
                        userAgent: navigator.userAgent
                    },
                    chunkIndex: this.currentChunk,
                    totalChunks: isFinal ? this.currentChunk + 1 : undefined,
                    isComplete: isFinal
                })
            });

            console.log(`✅ Chunk ${this.currentChunk} sent:`, data);
            this.currentChunk++;
            this.updateEventCount();
            this.retryCount = 0; // Reset retry count on success
            
        } catch (error) {
            console.error('❌ Failed to send chunk:', error);
            // Re-add events to retry later
            this.events.unshift(...chunkEvents);
            this.retryCount++;
            
            if (this.retryCount >= this.maxRetries) {
                this.showError('Failed to send data to server after multiple attempts');
                // Store events locally for later recovery
                this.storeEventsLocally(chunkEvents);
            }
        } finally {
            this.isSending = false;
        }
    }

    // Store events in localStorage when server is unavailable
    storeEventsLocally(events) {
        try {
            const stored = JSON.parse(localStorage.getItem('rrweb_pending_events') || '[]');
            stored.push({
                timestamp: Date.now(),
                sessionId: this.sessionId,
                userId: this.userId,
                events: events
            });
            
            // Keep only last 10 pending chunks to avoid filling storage
            if (stored.length > 10) {
                stored.splice(0, stored.length - 10);
            }
            
            localStorage.setItem('rrweb_pending_events', JSON.stringify(stored));
            console.log('💾 Events stored locally for later recovery');
        } catch (error) {
            console.error('❌ Failed to store events locally:', error);
        }
    }

    // Stop recording and send final chunk
    async stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        console.log('🛑 Stopping recording...');

        // Stop rrweb recording
        if (this.stopFn) {
            this.stopFn();
            this.stopFn = null;
        }

        // Clear interval
        if (this.chunkInterval) {
            clearInterval(this.chunkInterval);
            this.chunkInterval = null;
        }

        // Restore console
        this.restoreConsole();

        // Remove visibility handlers
        this.removeVisibilityHandlers();

        // Send final chunk
        if (this.events.length > 0) {
            await this.sendChunk(true);
        }

        this.updateUIState(false);
        console.log('✅ Recording stopped');
        this.showSuccess('Recording stopped');
    }

    // Setup page visibility change handlers
    setupVisibilityHandlers() {
        this.handleVisibilityChange = () => {
            if (document.hidden) {
                console.log('📄 Page hidden, sending current chunk...');
                this.sendChunk(false);
            }
        };

        this.handleBeforeUnload = () => {
            if (this.isRecording) {
                console.log('📄 Page unloading, sending final chunk...');
                
                // Use sendBeacon for more reliable unload sending
                if (this.events.length > 0) {
                    const eventsData = JSON.stringify({
                        sessionId: this.sessionId,
                        userId: this.userId,
                        events: this.events,
                        startTime: this.recordStartTime,
                        endTime: Date.now(),
                        metadata: {
                            url: window.location.href,
                            title: document.title,
                            referrer: document.referrer,
                            userAgent: navigator.userAgent
                        },
                        chunkIndex: this.currentChunk,
                        isComplete: true,
                        isUnload: true
                    });

                    const blob = new Blob([eventsData], { type: 'application/json' });
                    navigator.sendBeacon(`${this.serverUrl}/api/recordings`, blob);
                }
            }
        };

        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('beforeunload', this.handleBeforeUnload);
        window.addEventListener('pagehide', this.handleBeforeUnload);
    }

    // Remove visibility handlers
    removeVisibilityHandlers() {
        if (this.handleVisibilityChange) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }
        if (this.handleBeforeUnload) {
            window.removeEventListener('beforeunload', this.handleBeforeUnload);
            window.removeEventListener('pagehide', this.handleBeforeUnload);
        }
    }

    // UI update methods
    updateUIState(recording) {
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const replayBtn = document.getElementById('replayBtn');
        const statusElement = document.getElementById('status');
        
        if (startBtn) startBtn.disabled = recording;
        if (stopBtn) stopBtn.disabled = !recording;
        if (replayBtn) replayBtn.disabled = recording;
        
        if (statusElement) {
            statusElement.textContent = recording ? '🔴 Recording...' : '⚫ Stopped';
            statusElement.className = recording ? 'recording' : '';
            statusElement.style.color = recording ? '#dc3545' : '';
        }
    }

    updateEventCount() {
        const eventCountElement = document.getElementById('eventCount');
        const chunkCountElement = document.getElementById('chunkCount');
        
        if (eventCountElement) {
            eventCountElement.textContent = this.events.length + (this.currentChunk * this.chunkSize);
        }
        if (chunkCountElement) {
            chunkCountElement.textContent = this.currentChunk;
        }
    }

    updateSessionInfo(deviceType, userId = null) {
        const sessionIdElement = document.getElementById('sessionId');
        const deviceTypeElement = document.getElementById('deviceType');
        const userIdElement = document.getElementById('userId');
        
        if (sessionIdElement) {
            sessionIdElement.textContent = this.sessionId;
        }
        if (deviceTypeElement) {
            deviceTypeElement.textContent = deviceType || 'unknown';
        }
        if (userIdElement) {
            userIdElement.textContent = userId || this.userId;
        }
    }

    // Notification methods
    showError(message) {
        console.error('❌ Error:', message);
        this.updateStatus(message, 'error');
    }

    showWarning(message) {
        console.warn('⚠️ Warning:', message);
        this.updateStatus(message, 'warning');
    }

    showSuccess(message) {
        console.log('✅ Success:', message);
        this.updateStatus(message, 'success');
    }

    updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = type;
            
            // Auto-clear success messages after 3 seconds
            if (type === 'success') {
                setTimeout(() => {
                    if (statusElement.textContent === message) {
                        statusElement.textContent = this.isRecording ? '🔴 Recording...' : '⚫ Stopped';
                        statusElement.className = this.isRecording ? 'recording' : '';
                    }
                }, 3000);
            }
        }
    }

    // Get recording statistics
    getStats() {
        return {
            sessionId: this.sessionId,
            userId: this.userId,
            eventsRecorded: this.events.length + (this.currentChunk * this.chunkSize),
            chunksSent: this.currentChunk,
            isRecording: this.isRecording,
            startTime: this.recordStartTime,
            duration: this.recordStartTime ? Date.now() - this.recordStartTime : 0
        };
    }

    // Replay recorded events (for testing)
    async replayRecording(events = null) {
        const eventsToReplay = events || this.events;
        
        if (eventsToReplay.length === 0) {
            console.warn('No events to replay');
            return;
        }

        try {
            const replayContainer = document.getElementById('replayPlayer');
            if (replayContainer) {
                replayContainer.innerHTML = '';
                
                new rrwebPlayer({
                    target: replayContainer,
                    props: {
                        events: eventsToReplay,
                        width: '100%',
                        height: 500,
                        autoPlay: true,
                        speedOption: [0.5, 1, 2, 4],
                        showController: true,
                        tags: {
                            live: 'Live',
                            play: 'Play',
                            pause: 'Pause',
                            backward: 'Backward',
                            forward: 'Forward',
                            reset: 'Reset',
                        }
                    }
                });
            }

            return eventsToReplay;
        } catch (error) {
            console.error('Replay failed:', error);
        }
    }

    // Cleanup method
    destroy() {
        if (this.isRecording) {
            this.stopRecording();
        }
        this.removeVisibilityHandlers();
        this.restoreConsole();
        console.log('🧹 RRWeb Recorder destroyed');
    }
}

// Global instance and functions
let recorder = null;

// Initialize when page loads
window.addEventListener('DOMContentLoaded', () => {
    // Check if we're in a recording-enabled environment
    if (typeof rrweb !== 'undefined') {
        recorder = new RRWebRecorder();
        
        // Auto-start recording after a short delay (optional)
        setTimeout(() => {
            if (recorder && !recorder.isRecording) {
                console.log('🚀 Auto-starting recording...');
                startRecording();
            }
        }, 1000);
    } else {
        console.error('❌ RRWeb not loaded. Make sure rrweb is included before this script.');
    }
});

// Global functions for UI controls
function startRecording() {
    if (recorder) {
        recorder.startRecording();
    }
}

function stopRecording() {
    if (recorder) {
        recorder.stopRecording();
    }
}

function setUserId(userId) {
    if (recorder && userId) {
        recorder.setUserId(userId);
    }
}

function getRecordingStats() {
    return recorder ? recorder.getStats() : null;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RRWebRecorder;
}
