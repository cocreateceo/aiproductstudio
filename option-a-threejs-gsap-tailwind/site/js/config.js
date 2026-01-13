/**
 * AI Product Studio - Centralized Configuration
 *
 * Single source of truth for all frontend configuration.
 * Auto-detects environment (local vs production) and sets appropriate values.
 */

(function(window) {
  'use strict';

  // Environment detection
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isDev = isLocal || hostname.includes('dev.') || hostname.includes('staging.');

  // Configuration object
  const Config = {
    // Environment
    env: isLocal ? 'local' : 'production',
    isLocal: isLocal,
    isDev: isDev,
    isProduction: !isDev,

    // Ports (local development)
    ports: {
      http: 5000,
      websocket: 5001
    },

    // API Configuration
    api: {
      // Chat endpoint
      chat: isLocal
        ? `http://localhost:5000/api/chat`
        : 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat',

      // Admin endpoints (local only)
      admin: isLocal ? `http://localhost:5000/api/admin` : null,
      applications: isLocal ? `http://localhost:5000/api/admin/applications` : null,
      approve: isLocal ? `http://localhost:5000/api/admin/approve` : null,
      builds: isLocal ? `http://localhost:5000/api/builds` : null,
      triggerBuild: isLocal ? `http://localhost:5000/api/admin/trigger-build` : null
    },

    // WebSocket Configuration
    websocket: {
      url: isLocal ? `ws://localhost:5001` : null,
      enabled: isLocal, // WebSocket only for local dev
      reconnectInterval: 3000,
      maxReconnectAttempts: 5
    },

    // AWS Configuration
    aws: {
      region: 'ap-south-1',
      apiGatewayId: 'bx0ywfkona',
      s3Bucket: 'ai-product-studio-applications'
    },

    // UI Configuration
    ui: {
      pollInterval: 5000,        // 5 seconds for UI updates
      toastDuration: 3000,       // 3 seconds for toast messages
      animationDuration: 300,    // 300ms for animations
      maxChatHistory: 50         // Max messages in chat history
    },

    // Contact/Support
    contact: {
      supportEmail: 'support@sunwaretechnologies.com',
      notificationEmail: 'gopi@sunwaretechnologies.com'
    },

    // Feature Flags
    features: {
      voiceInput: true,
      screenshot: true,
      markdown: true,
      tokenTracking: true,
      liveBuildProgress: isLocal  // Only in local dev
    },

    // Debug
    debug: isDev,

    // Helper methods
    getApiUrl: function(endpoint) {
      if (this.api[endpoint]) {
        return this.api[endpoint];
      }
      // Fallback: construct URL
      const base = isLocal
        ? `http://localhost:${this.ports.http}`
        : `https://${this.aws.apiGatewayId}.execute-api.${this.aws.region}.amazonaws.com/prod`;
      return `${base}/${endpoint}`;
    },

    log: function(...args) {
      if (this.debug) {
        console.log('[Config]', ...args);
      }
    }
  };

  // Freeze config to prevent modifications
  Object.freeze(Config.ports);
  Object.freeze(Config.api);
  Object.freeze(Config.websocket);
  Object.freeze(Config.aws);
  Object.freeze(Config.ui);
  Object.freeze(Config.contact);
  Object.freeze(Config.features);
  Object.freeze(Config);

  // Export to window
  window.AppConfig = Config;

  // Log environment on load
  Config.log('Environment:', Config.env);
  Config.log('API Chat URL:', Config.api.chat);
  if (Config.websocket.enabled) {
    Config.log('WebSocket URL:', Config.websocket.url);
  }

})(window);
