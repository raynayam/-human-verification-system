/**
 * Anti-Scraper Client-side Script
 * This script collects browser fingerprints and handles the challenge verification
 */

class AntiScraperClient {
  constructor(options = {}) {
    this.options = {
      verificationEndpoint: '/api/verify',
      redirectOnFailure: '/blocked',
      tokenName: 'verification_token',
      ...options
    };
    
    this.fingerprint = null;
  }

  /**
   * Initialize the anti-scraper client
   */
  async init() {
    // Check if we already have a valid token
    if (this.getCookie(this.options.tokenName)) {
      return true;
    }
    
    // Collect fingerprint data
    await this.collectFingerprint();
    
    // If we're on the verification page, don't auto-verify
    if (window.location.pathname === '/verify') {
      return false;
    }
    
    // Otherwise, try to verify automatically
    return this.verify();
  }

  /**
   * Collect browser fingerprint data
   */
  async collectFingerprint() {
    this.fingerprint = {
      screen: {
        width: screen.width,
        height: screen.height,
        depth: screen.colorDepth,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight
      },
      navigator: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages,
        platform: navigator.platform,
        vendor: navigator.vendor,
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        hardwareConcurrency: navigator.hardwareConcurrency,
        maxTouchPoints: navigator.maxTouchPoints
      },
      timezone: {
        offset: new Date().getTimezoneOffset(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      canvas: await this.getCanvasFingerprint(),
      webgl: await this.getWebGLFingerprint(),
      audio: await this.getAudioFingerprint(),
      fonts: await this.getFontFingerprint(),
      plugins: this.getPluginsData(),
      touchSupport: 'ontouchstart' in window,
      devicePixelRatio: window.devicePixelRatio
    };
    
    return this.fingerprint;
  }

  /**
   * Verify the client with the server
   */
  async verify() {
    try {
      const response = await fetch(this.options.verificationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fingerprint: this.fingerprint
        }),
        credentials: 'same-origin'
      });
      
      const data = await response.json();
      
      if (data.success) {
        return true;
      } else {
        if (this.options.redirectOnFailure) {
          window.location.href = this.options.redirectOnFailure;
        }
        return false;
      }
    } catch (error) {
      console.error('Verification failed:', error);
      return false;
    }
  }

  /**
   * Get a browser cookie by name
   */
  getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.startsWith(name + '=')) {
        return cookie.substring(name.length + 1);
      }
    }
    return null;
  }

  /**
   * Canvas fingerprinting
   */
  async getCanvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = 200;
      canvas.height = 60;
      
      // Text with different font, color, and background
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 200, 60);
      ctx.fillStyle = '#069';
      ctx.fillText('Anti-Scraper Fingerprint', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Canvas Test', 4, 45);
      
      // Add some shapes
      ctx.strokeStyle = '#f2f2f2';
      ctx.beginPath();
      ctx.moveTo(30, 20);
      ctx.lineTo(130, 40);
      ctx.stroke();
      
      return canvas.toDataURL().slice(0, 100);
    } catch (e) {
      return 'canvas-error';
    }
  }

  /**
   * WebGL fingerprinting
   */
  async getWebGLFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        return 'no-webgl';
      }
      
      // Collect information that doesn't change across browsers but can
      // differ from device to device
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      
      // Also collect some capability information
      const extensionsInfo = gl.getSupportedExtensions().join('~');
      
      return {
        vendor,
        renderer,
        extensions: extensionsInfo.slice(0, 150)
      };
    } catch (e) {
      return 'webgl-error';
    }
  }

  /**
   * Audio fingerprinting using the Web Audio API
   */
  async getAudioFingerprint() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const oscillator = audioContext.createOscillator();
      const dynamicsCompressor = audioContext.createDynamicsCompressor();
      
      // Set up audio nodes
      analyser.fftSize = 32;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, audioContext.currentTime);
      
      // Connect nodes
      oscillator.connect(dynamicsCompressor);
      dynamicsCompressor.connect(analyser);
      analyser.connect(audioContext.destination);
      
      // Set compressor parameters
      dynamicsCompressor.threshold.setValueAtTime(-50, audioContext.currentTime);
      dynamicsCompressor.knee.setValueAtTime(40, audioContext.currentTime);
      dynamicsCompressor.ratio.setValueAtTime(12, audioContext.currentTime);
      dynamicsCompressor.attack.setValueAtTime(0, audioContext.currentTime);
      dynamicsCompressor.release.setValueAtTime(0.25, audioContext.currentTime);
      
      // Start the oscillator for a very short time
      oscillator.start(0);
      oscillator.stop(audioContext.currentTime + 0.01);
      
      // Wait for processing and then get the frequency data
      return new Promise(resolve => {
        setTimeout(() => {
          const frequencyData = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(frequencyData);
          
          // Convert to string for easy comparison
          const result = Array.from(frequencyData).join(',');
          
          // Clean up
          audioContext.close();
          
          resolve(result);
        }, 50);
      });
    } catch (e) {
      return 'audio-api-error';
    }
  }

  /**
   * Font detection fingerprinting
   */
  async getFontFingerprint() {
    const fontTestString = 'mmmmmmmmmmlli';
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const fontList = [
      'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math',
      'Comic Sans MS', 'Courier', 'Courier New', 'Georgia', 'Helvetica', 'Impact',
      'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype',
      'Segoe UI', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana'
    ];
    
    // Create test elements
    const h = document.createElement('span');
    h.style.fontSize = '72px';
    h.style.visibility = 'hidden';
    h.innerHTML = fontTestString;
    document.body.appendChild(h);
    
    // Get width with base fonts
    const baseFontWidths = {};
    for (let i = 0; i < baseFonts.length; i++) {
      h.style.fontFamily = baseFonts[i];
      baseFontWidths[baseFonts[i]] = h.offsetWidth;
    }
    
    // Detect what fonts are available by checking width
    const available = [];
    for (let i = 0; i < fontList.length; i++) {
      let detected = false;
      
      for (let j = 0; j < baseFonts.length; j++) {
        h.style.fontFamily = fontList[i] + ',' + baseFonts[j];
        if (h.offsetWidth !== baseFontWidths[baseFonts[j]]) {
          detected = true;
          break;
        }
      }
      
      if (detected) {
        available.push(fontList[i]);
      }
    }
    
    // Clean up
    document.body.removeChild(h);
    
    return available.join(',');
  }

  /**
   * Browser plugins data
   */
  getPluginsData() {
    try {
      const plugins = [];
      
      for (let i = 0; i < navigator.plugins.length; i++) {
        const p = navigator.plugins[i];
        const pluginData = {
          name: p.name,
          filename: p.filename,
          description: p.description
        };
        plugins.push(pluginData);
      }
      
      return plugins;
    } catch (e) {
      return 'plugins-error';
    }
  }
}

// Auto-initialize if not in a module context
if (typeof window !== 'undefined') {
  window.antiScraper = new AntiScraperClient();
  window.addEventListener('DOMContentLoaded', () => {
    window.antiScraper.init();
  });
} 