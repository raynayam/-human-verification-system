/**
 * Anti-Scraper Client Library
 * 
 * A client-side script that collects browser fingerprinting and user behavior data
 * to help determine if the client is a real human or an automated bot.
 */
(function() {
    'use strict';

    /**
     * HumanVerifier - Client-side JavaScript class for human verification
     * Collects and analyzes user interaction patterns to distinguish humans from bots
     */
    class HumanVerifier {
        /**
         * Initialize a new HumanVerifier instance
         * @param {Object} options - Configuration options
         */
        constructor(options = {}) {
            // Default options
            this.options = {
                verificationEndpoint: '/verify',
                challengeEndpoint: '/challenge',
                mouseSampleRate: 100,  // milliseconds between mouse samples
                keyboardSampleRate: 50, // milliseconds between keyboard samples
                touchSampleRate: 100,  // milliseconds between touch samples
                maxEvents: 50,         // maximum events to collect per type
                ...options
            };
            
            // Data storage
            this.data = {
                sessionId: null,
                startTime: Date.now(),
                mouseEvents: [],
                keyboardEvents: [],
                touchEvents: [],
                eventSummary: {
                    mouseEvents: 0,
                    keyboardEvents: 0,
                    touchEvents: 0
                },
                environment: null,
                totalInteractionTime: 0
            };
            
            // Stats tracking
            this.mouseStats = {
                lastPosition: null,
                lastMoveTime: null,
                movementCount: 0,
                clickCount: 0,
                totalDistance: 0,
                speeds: [],
                directions: new Set(),
                get uniqueDirections() { return this.directions.size; },
                get averageSpeed() { 
                    return this.speeds.length ? 
                        this.speeds.reduce((sum, speed) => sum + speed, 0) / this.speeds.length : 
                        0; 
                }
            };
            
            this.keyboardStats = {
                keyPressCount: 0,
                keyHoldTimes: [],
                lastKeyTime: null,
                timeBetweenKeys: [],
                get averageKeyHoldTime() { 
                    return this.keyHoldTimes.length ? 
                        this.keyHoldTimes.reduce((sum, time) => sum + time, 0) / this.keyHoldTimes.length : 
                        0; 
                },
                get averageTimeBetweenKeys() { 
                    return this.timeBetweenKeys.length ? 
                        this.timeBetweenKeys.reduce((sum, time) => sum + time, 0) / this.timeBetweenKeys.length : 
                        0; 
                }
            };
            
            this.touchStats = {
                touchCount: 0,
                multiTouchUsed: false,
                touchDurations: [],
                get averageTouchDuration() { 
                    return this.touchDurations.length ? 
                        this.touchDurations.reduce((sum, duration) => sum + duration, 0) / this.touchDurations.length : 
                        0; 
                }
            };
            
            // Event tracking state
            this.isRecording = false;
            this.activeKeys = new Map();
            this.activeTouches = new Map();
            this.lastMouseSample = 0;
            this.lastKeyboardSample = 0;
            this.lastTouchSample = 0;
            
            // Bound event handlers (needed for proper cleanup)
            this.boundHandlers = {
                mousemove: this.handleMouseMove.bind(this),
                mousedown: this.handleMouseDown.bind(this),
                mouseup: this.handleMouseUp.bind(this),
                click: this.handleClick.bind(this),
                keydown: this.handleKeyDown.bind(this),
                keyup: this.handleKeyUp.bind(this),
                touchstart: this.handleTouchStart.bind(this),
                touchend: this.handleTouchEnd.bind(this),
                touchmove: this.handleTouchMove.bind(this)
            };
            
            // Event callback - can be overridden
            this.onEventCollected = null;
        }

        /**
         * Create a verification session with the server
         * @returns {Promise} - Resolves to session response
         */
        async createSession() {
            try {
                const response = await fetch(this.options.challengeEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include'
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.data.sessionId = result.sessionId;
                }
                
                return result;
            } catch (error) {
                console.error('Session creation failed:', error);
                return { success: false, error: 'Failed to create session' };
            }
        }

        /**
         * Attach all event listeners to begin collecting user interaction data
         */
        attachListeners() {
            if (this.isRecording) return;
            
            this.isRecording = true;
            this.data.startTime = Date.now();
            
            // Mouse events
            document.addEventListener('mousemove', this.boundHandlers.mousemove, { passive: true });
            document.addEventListener('mousedown', this.boundHandlers.mousedown, { passive: true });
            document.addEventListener('mouseup', this.boundHandlers.mouseup, { passive: true });
            document.addEventListener('click', this.boundHandlers.click, { passive: true });
            
            // Keyboard events
            document.addEventListener('keydown', this.boundHandlers.keydown, { passive: true });
            document.addEventListener('keyup', this.boundHandlers.keyup, { passive: true });
            
            // Touch events (for mobile)
            document.addEventListener('touchstart', this.boundHandlers.touchstart, { passive: true });
            document.addEventListener('touchend', this.boundHandlers.touchend, { passive: true });
            document.addEventListener('touchmove', this.boundHandlers.touchmove, { passive: true });
            
            // Collect environment data
            this.collectEnvironmentData();
        }

        /**
         * Remove all event listeners
         */
        detachListeners() {
            if (!this.isRecording) return;
            
            this.isRecording = false;
            
            // Calculate total interaction time
            this.data.totalInteractionTime = Date.now() - this.data.startTime;
            
            // Mouse events
            document.removeEventListener('mousemove', this.boundHandlers.mousemove);
            document.removeEventListener('mousedown', this.boundHandlers.mousedown);
            document.removeEventListener('mouseup', this.boundHandlers.mouseup);
            document.removeEventListener('click', this.boundHandlers.click);
            
            // Keyboard events
            document.removeEventListener('keydown', this.boundHandlers.keydown);
            document.removeEventListener('keyup', this.boundHandlers.keyup);
            
            // Touch events
            document.removeEventListener('touchstart', this.boundHandlers.touchstart);
            document.removeEventListener('touchend', this.boundHandlers.touchend);
            document.removeEventListener('touchmove', this.boundHandlers.touchmove);
        }

        /**
         * Handle mouse movement event
         * @param {MouseEvent} event - The mouse event
         */
        handleMouseMove(event) {
            const now = Date.now();
            
            // Respect sample rate to prevent excessive data collection
            if (now - this.lastMouseSample < this.options.mouseSampleRate) {
                return;
            }
            
            this.lastMouseSample = now;
            
            const { clientX, clientY } = event;
            const currentPosition = { x: clientX, y: clientY, timestamp: now };
            
            // Calculate movement statistics if we have a previous position
            if (this.mouseStats.lastPosition) {
                const prev = this.mouseStats.lastPosition;
                const timeDiff = (now - prev.timestamp) / 1000; // convert to seconds
                
                if (timeDiff > 0) {
                    // Calculate distance
                    const deltaX = clientX - prev.x;
                    const deltaY = clientY - prev.y;
                    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                    
                    this.mouseStats.totalDistance += distance;
                    this.mouseStats.movementCount++;
                    
                    // Calculate speed (pixels per second)
                    const speed = distance / timeDiff;
                    this.mouseStats.speeds.push(speed);
                    
                    // Track direction (in 45-degree increments)
                    if (distance > 3) { // Ignore tiny movements
                        const angle = Math.round((Math.atan2(deltaY, deltaX) * 180 / Math.PI + 360) % 360 / 45);
                        this.mouseStats.directions.add(angle);
                    }
                }
            }
            
            this.mouseStats.lastPosition = currentPosition;
            this.mouseStats.lastMoveTime = now;
            
            // Record the event if we haven't reached maximum
            if (this.data.mouseEvents.length < this.options.maxEvents) {
                this.data.mouseEvents.push({
                    x: clientX,
                    y: clientY,
                    timestamp: now - this.data.startTime // store relative time
                });
                
                this.data.eventSummary.mouseEvents++;
                
                // Trigger callback if defined
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('mousemove');
                }
            }
        }

        /**
         * Handle mouse down event
         * @param {MouseEvent} event - The mouse event
         */
        handleMouseDown(event) {
            const now = Date.now();
            
            if (this.data.mouseEvents.length < this.options.maxEvents) {
                this.data.mouseEvents.push({
                    type: 'mousedown',
                    button: event.button,
                    x: event.clientX,
                    y: event.clientY,
                    timestamp: now - this.data.startTime
                });
                
                this.data.eventSummary.mouseEvents++;
                
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('mousedown');
                }
            }
        }

        /**
         * Handle mouse up event
         * @param {MouseEvent} event - The mouse event
         */
        handleMouseUp(event) {
            const now = Date.now();
            
            if (this.data.mouseEvents.length < this.options.maxEvents) {
                this.data.mouseEvents.push({
                    type: 'mouseup',
                    button: event.button,
                    x: event.clientX,
                    y: event.clientY,
                    timestamp: now - this.data.startTime
                });
                
                this.data.eventSummary.mouseEvents++;
                
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('mouseup');
                }
            }
        }

        /**
         * Handle mouse click event
         * @param {MouseEvent} event - The mouse event
         */
        handleClick(event) {
            this.mouseStats.clickCount++;
        }

        /**
         * Handle key down event
         * @param {KeyboardEvent} event - The keyboard event
         */
        handleKeyDown(event) {
            const now = Date.now();
            const key = event.key;
            
            // Skip if key is already being tracked (key repeat)
            if (this.activeKeys.has(key)) {
                return;
            }
            
            // Track key press time for calculating hold duration
            this.activeKeys.set(key, now);
            
            // Calculate time between key presses
            if (this.keyboardStats.lastKeyTime && 
                this.keyboardStats.lastKeyTime !== now) {
                const timeBetween = now - this.keyboardStats.lastKeyTime;
                if (timeBetween < 2000) { // Ignore pauses longer than 2 seconds
                    this.keyboardStats.timeBetweenKeys.push(timeBetween);
                }
            }
            
            this.keyboardStats.lastKeyTime = now;
            this.keyboardStats.keyPressCount++;
            
            // Respect sample rate to prevent excessive data collection
            if (now - this.lastKeyboardSample < this.options.keyboardSampleRate) {
                return;
            }
            
            this.lastKeyboardSample = now;
            
            // Record event if we haven't reached maximum
            if (this.data.keyboardEvents.length < this.options.maxEvents) {
                // Don't store actual keys for privacy, just the fact that a key was pressed
                this.data.keyboardEvents.push({
                    // Store key category, not the key itself for privacy
                    type: 'keydown',
                    isModifier: ['Control', 'Alt', 'Shift', 'Meta'].includes(key),
                    isNavigation: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(key),
                    timestamp: now - this.data.startTime
                });
                
                this.data.eventSummary.keyboardEvents++;
                
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('keydown');
                }
            }
        }

        /**
         * Handle key up event
         * @param {KeyboardEvent} event - The keyboard event
         */
        handleKeyUp(event) {
            const now = Date.now();
            const key = event.key;
            
            // Calculate key hold time
            if (this.activeKeys.has(key)) {
                const keyDownTime = this.activeKeys.get(key);
                const holdTime = now - keyDownTime;
                
                this.keyboardStats.keyHoldTimes.push(holdTime);
                this.activeKeys.delete(key);
                
                // Respect sample rate to prevent excessive data collection
                if (now - this.lastKeyboardSample < this.options.keyboardSampleRate) {
                    return;
                }
                
                this.lastKeyboardSample = now;
                
                // Record event if we haven't reached maximum
                if (this.data.keyboardEvents.length < this.options.maxEvents) {
                    this.data.keyboardEvents.push({
                        type: 'keyup',
                        holdTime: holdTime,
                        isModifier: ['Control', 'Alt', 'Shift', 'Meta'].includes(key),
                        isNavigation: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(key),
                        timestamp: now - this.data.startTime
                    });
                    
                    this.data.eventSummary.keyboardEvents++;
                    
                    if (typeof this.onEventCollected === 'function') {
                        this.onEventCollected('keyup');
                    }
                }
            }
        }

        /**
         * Handle touch start event
         * @param {TouchEvent} event - The touch event
         */
        handleTouchStart(event) {
            const now = Date.now();
            const touches = event.changedTouches;
            
            // Check for multi-touch
            if (touches.length > 1) {
                this.touchStats.multiTouchUsed = true;
            }
            
            // Store start time for each touch point to calculate duration later
            for (let i = 0; i < touches.length; i++) {
                const touch = touches[i];
                this.activeTouches.set(touch.identifier, {
                    startTime: now,
                    startX: touch.clientX,
                    startY: touch.clientY
                });
            }
            
            this.touchStats.touchCount += touches.length;
            
            // Respect sample rate to prevent excessive data collection
            if (now - this.lastTouchSample < this.options.touchSampleRate) {
                return;
            }
            
            this.lastTouchSample = now;
            
            // Record event if we haven't reached maximum
            if (this.data.touchEvents.length < this.options.maxEvents) {
                this.data.touchEvents.push({
                    type: 'touchstart',
                    touches: touches.length,
                    timestamp: now - this.data.startTime
                });
                
                this.data.eventSummary.touchEvents++;
                
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('touchstart');
                }
            }
        }

        /**
         * Handle touch end event
         * @param {TouchEvent} event - The touch event
         */
        handleTouchEnd(event) {
            const now = Date.now();
            const touches = event.changedTouches;
            
            // Calculate touch duration for each ended touch
            for (let i = 0; i < touches.length; i++) {
                const touch = touches[i];
                const touchId = touch.identifier;
                
                if (this.activeTouches.has(touchId)) {
                    const touchData = this.activeTouches.get(touchId);
                    const duration = now - touchData.startTime;
                    
                    this.touchStats.touchDurations.push(duration);
                    this.activeTouches.delete(touchId);
                }
            }
            
            // Respect sample rate to prevent excessive data collection
            if (now - this.lastTouchSample < this.options.touchSampleRate) {
                return;
            }
            
            this.lastTouchSample = now;
            
            // Record event if we haven't reached maximum
            if (this.data.touchEvents.length < this.options.maxEvents) {
                this.data.touchEvents.push({
                    type: 'touchend',
                    touches: touches.length,
                    timestamp: now - this.data.startTime
                });
                
                this.data.eventSummary.touchEvents++;
                
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('touchend');
                }
            }
        }

        /**
         * Handle touch move event
         * @param {TouchEvent} event - The touch event
         */
        handleTouchMove(event) {
            const now = Date.now();
            
            // Respect sample rate to prevent excessive data collection
            if (now - this.lastTouchSample < this.options.touchSampleRate) {
                return;
            }
            
            this.lastTouchSample = now;
            
            // Record event if we haven't reached maximum
            if (this.data.touchEvents.length < this.options.maxEvents) {
                this.data.touchEvents.push({
                    type: 'touchmove',
                    touches: event.touches.length,
                    timestamp: now - this.data.startTime
                });
                
                this.data.eventSummary.touchEvents++;
                
                if (typeof this.onEventCollected === 'function') {
                    this.onEventCollected('touchmove');
                }
            }
        }

        /**
         * Collect browser environment information
         */
        collectEnvironmentData() {
            const screen = window.screen || {};
            const nav = window.navigator || {};
            
            // Check for automation indicators
            const automationDetected = this.detectAutomation();
            
            // Collect non-sensitive environment data
            this.data.environment = {
                screenWidth: screen.width,
                screenHeight: screen.height,
                colorDepth: screen.colorDepth,
                pixelRatio: window.devicePixelRatio || 1,
                timezone: new Date().getTimezoneOffset(),
                userAgent: nav.userAgent,
                language: nav.language || nav.userLanguage || '',
                platform: nav.platform,
                hasLocalStorage: !!window.localStorage,
                hasSessionStorage: !!window.sessionStorage,
                cookiesEnabled: nav.cookieEnabled,
                touchSupport: ('ontouchstart' in window) || (nav.maxTouchPoints > 0)
            };
            
            // WebGL fingerprinting
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                
                if (gl) {
                    this.data.webgl = {
                        available: true,
                        vendor: gl.getParameter(gl.VENDOR),
                        renderer: gl.getParameter(gl.RENDERER)
                    };
                } else {
                    this.data.webgl = { available: false };
                }
            } catch (e) {
                this.data.webgl = { available: false, error: true };
            }
            
            // Add automation detection
            this.data.features = {
                automationDetected: automationDetected
            };
        }

        /**
         * Detect browser automation
         * @returns {boolean} - True if automation is detected
         */
        detectAutomation() {
            const nav = window.navigator || {};
            
            // Check for common automation indicators
            const automationIndicators = [
                'webdriver' in nav && nav.webdriver,
                '_phantom' in window,
                'callPhantom' in window,
                'phantom' in window,
                'domAutomation' in window,
                'domAutomationController' in window,
                'selenium' in window,
                'driver' in window,
                'webdriver' in window,
                'callSelenium' in window,
                '__nightmare' in window,
                '__puppeteer__' in window
            ];
            
            return automationIndicators.some(indicator => indicator === true);
        }

        /**
         * Prepare data for verification
         * @returns {Object} - Data to be sent to the verification endpoint
         */
        prepareVerificationData() {
            // Add stats to the data
            const verificationData = {
                ...this.data,
                mouseStats: {
                    movementCount: this.mouseStats.movementCount,
                    clickCount: this.mouseStats.clickCount,
                    totalDistance: this.mouseStats.totalDistance,
                    uniqueDirections: this.mouseStats.uniqueDirections,
                    averageSpeed: this.mouseStats.averageSpeed
                },
                keyboardStats: {
                    keyPressCount: this.keyboardStats.keyPressCount,
                    averageKeyHoldTime: this.keyboardStats.averageKeyHoldTime,
                    averageTimeBetweenKeys: this.keyboardStats.averageTimeBetweenKeys
                },
                touchStats: {
                    touchCount: this.touchStats.touchCount,
                    multiTouchUsed: this.touchStats.multiTouchUsed,
                    averageTouchDuration: this.touchStats.averageTouchDuration
                }
            };
            
            return verificationData;
        }

        /**
         * Send collected data to the verification endpoint
         * @returns {Promise} - Resolves to verification result
         */
        async verify() {
            try {
                // Prepare data for submission
                const verificationData = this.prepareVerificationData();
                
                // Send data to the verification endpoint
                const response = await fetch(this.options.verificationEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(verificationData),
                    credentials: 'include'
                });
                
                return await response.json();
            } catch (error) {
                console.error('Verification failed:', error);
                return { success: false, error: 'Verification failed' };
            }
        }
    }

    // Expose HumanVerifier to the global scope
    window.HumanVerifier = HumanVerifier;

    // Auto-initialize verification if the page was redirected for verification
    document.addEventListener('DOMContentLoaded', () => {
        // Check if we're on a verification page
        if (window.location.pathname.includes('/verification')) {
            console.log('Anti-scraper client initialized on verification page');
        }
    });
})(); 