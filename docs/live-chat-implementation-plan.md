# Live Chat Implementation Plan for AI Product Studio

> A discussion document for implementing a visitor chat interface with human support operators

---

## Overview

**Goal:** Add a chat widget to AI Product Studio landing pages where:
1. Visitors can ask questions about the product/partnership
2. Support team can monitor and respond via Teams or a custom dashboard
3. Conversations are tracked and managed

**Current Setup:**
- Landing pages are **static HTML** hosted on **S3**
- No backend server on S3 (static hosting only)
- 6 options deployed: ai-product-studio-sunware, option-b through option-f

**Key Constraint:**
S3 only serves static files - we need an external chat server that the embedded widget connects to.

---

## Architecture for S3-Hosted Sites

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CURRENT S3 SETUP                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   S3 Buckets (Static HTML)                                              │
│   ├── ai-product-studio-sunware     → Option A                          │
│   ├── ai-product-studio-option-b    → Option B                          │
│   ├── ai-product-studio-option-c    → Option C                          │
│   ├── ai-product-studio-option-d    → Option D                          │
│   ├── ai-product-studio-option-e    → Option E                          │
│   └── ai-product-studio-option-f    → Option F                          │
│                                                                          │
│   Each index.html needs: <script src="chat-widget.js">                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket / HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CHAT BACKEND (Separate Service)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Option A: AWS Serverless (API Gateway WebSocket + Lambda + DynamoDB)  │
│   Option B: EC2/ECS with Node.js + Socket.io + MongoDB                  │
│   Option C: Third-Party Service (Tawk.to, Crisp - just embed script)   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      OPERATOR INTERFACE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Option A: Custom Admin Dashboard (React app on S3/CloudFront)         │
│   Option B: Microsoft Teams Channel (via webhooks)                       │
│   Option C: Third-Party Dashboard (Tawk.to/Crisp admin panel)           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Options (for S3 Static Sites)

### Option 1: Microsoft Teams Integration (Simplest)

**How it works:**
- Visitor sends message via chat widget
- Message delivered to a Teams channel
- Team responds in Teams, reply sent back to visitor

**Pros:**
- No custom chat server needed
- Team already uses Teams
- Mobile notifications built-in
- Free (with existing Microsoft 365)

**Cons:**
- Requires Azure Bot Service setup
- Limited customization
- Dependent on Microsoft ecosystem

**Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Landing Page   │────▶│  Azure Bot      │────▶│  Microsoft      │
│  Chat Widget    │◀────│  Service        │◀────│  Teams Channel  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Estimated Effort:** 2-3 days

---

### Option 2: Custom WebSocket Chat Server (Most Control)

**How it works:**
- Build custom Node.js server with WebSocket
- Admin dashboard to view/respond to conversations
- Database stores all chat history

**Pros:**
- Full control over features and UI
- No third-party dependencies
- Can add AI later if needed
- Own your data

**Cons:**
- More development time
- Need to host and maintain server
- Build notifications yourself

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                         VISITOR SIDE                             │
├─────────────────────────────────────────────────────────────────┤
│  Landing Page                                                    │
│    └── ChatWidget.jsx (WebSocket client)                        │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         CHAT SERVER                              │
├─────────────────────────────────────────────────────────────────┤
│  Node.js + Socket.io                                            │
│    ├── Visitor connections (anonymous)                          │
│    ├── Operator connections (authenticated)                     │
│    ├── Message routing                                          │
│    └── Persistence (MongoDB/PostgreSQL)                         │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       OPERATOR DASHBOARD                         │
├─────────────────────────────────────────────────────────────────┤
│  React Admin Panel                                              │
│    ├── Active conversations list                                │
│    ├── Chat interface                                           │
│    ├── Visitor info (page, time, etc.)                         │
│    └── Notification system                                      │
└─────────────────────────────────────────────────────────────────┘
```

**Estimated Effort:** 1-2 weeks

---

### Option 3: Third-Party Live Chat (Fastest)

**Popular Options:**

| Service | Free Tier | Pros | Cons |
|---------|-----------|------|------|
| **Tawk.to** | Unlimited | Free forever, full-featured | Branding on free tier |
| **Crisp** | 2 seats | Modern UI, mobile apps | Limited on free |
| **Intercom** | No | Most features, best UX | Expensive ($74/mo+) |
| **Drift** | Limited | Sales-focused | Expensive |
| **LiveChat** | Trial | Reliable, good support | Paid only ($20/mo+) |
| **Zendesk Chat** | Trial | Enterprise features | Complex, expensive |

**Recommended for MVP: Tawk.to or Crisp**

**Pros:**
- Ready in 30 minutes
- Mobile apps for team
- Analytics built-in
- No server maintenance

**Cons:**
- Less control
- Data with third-party
- May have branding
- Monthly cost for premium features

**Estimated Effort:** 1-2 hours

---

### Option 4: Hybrid (Custom + Teams Notifications)

**How it works:**
- Custom chat server handles conversations
- Sends notifications to Teams when new message
- Team can respond from dashboard OR Teams

**Architecture:**
```
┌─────────────────┐
│  Landing Page   │
│  Chat Widget    │──────┐
└─────────────────┘      │
                         ▼
              ┌─────────────────────┐
              │   Chat Server       │
              │   (Node.js)         │
              └─────────────────────┘
                    │         │
          ┌─────────┘         └─────────┐
          ▼                             ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Admin Dashboard    │     │  Teams Webhook      │
│  (Primary)          │     │  (Notifications)    │
└─────────────────────┘     └─────────────────────┘
```

**Estimated Effort:** 1 week

---

---

## S3 Integration Guide

Since landing pages are static HTML on S3, here's how to integrate chat:

### Method 1: Third-Party Widget (Fastest - 5 minutes)

Add ONE line to each `index.html` before `</body>`:

**Tawk.to (Free):**
```html
<!-- Add before </body> in each landing page -->
<script type="text/javascript">
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/YOUR_PROPERTY_ID/YOUR_WIDGET_ID';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();
</script>
```

**Crisp:**
```html
<!-- Add before </body> in each landing page -->
<script type="text/javascript">
window.$crisp=[];window.CRISP_WEBSITE_ID="YOUR_WEBSITE_ID";
(function(){d=document;s=d.createElement("script");
s.src="https://client.crisp.chat/l.js";s.async=1;
d.getElementsByTagName("head")[0].appendChild(s);})();
</script>
```

**Pros:** Works immediately, mobile apps for operators, free tier available
**Cons:** Branding on free tier, data with third-party

---

### Method 2: AWS Serverless Chat (Full Control)

**Architecture:**
```
┌──────────────────┐        ┌─────────────────────────────────────────┐
│  S3 Landing Page │        │              AWS Backend                 │
│  (Static HTML)   │        │                                         │
│                  │        │  ┌─────────────────────────────────┐   │
│  ┌────────────┐  │  WSS   │  │  API Gateway (WebSocket API)    │   │
│  │ chat.js    │──┼────────┼─▶│  wss://xxxxx.execute-api.region │   │
│  │ (embedded) │  │        │  └─────────────────────────────────┘   │
│  └────────────┘  │        │              │                          │
│                  │        │              ▼                          │
└──────────────────┘        │  ┌─────────────────────────────────┐   │
                            │  │  Lambda Functions                │   │
                            │  │  ├── onConnect                   │   │
                            │  │  ├── onDisconnect                │   │
                            │  │  ├── sendMessage                 │   │
                            │  │  └── getHistory                  │   │
                            │  └─────────────────────────────────┘   │
                            │              │                          │
                            │              ▼                          │
                            │  ┌─────────────────────────────────┐   │
                            │  │  DynamoDB                        │   │
                            │  │  ├── Connections table           │   │
                            │  │  ├── Conversations table         │   │
                            │  │  └── Messages table              │   │
                            │  └─────────────────────────────────┘   │
                            │              │                          │
                            │              ▼                          │
                            │  ┌─────────────────────────────────┐   │
                            │  │  SNS → Teams Webhook             │   │
                            │  │  (Notifications)                 │   │
                            │  └─────────────────────────────────┘   │
                            └─────────────────────────────────────────┘
```

**Estimated Cost:** ~$5-20/month for low-medium traffic

---

### Method 3: Custom Chat Server on EC2/Lightsail

**Architecture:**
```
┌──────────────────┐        ┌─────────────────────────────────────────┐
│  S3 Landing Page │        │         EC2 / Lightsail ($5-20/mo)      │
│  (Static HTML)   │        │                                         │
│                  │  WSS   │  ┌─────────────────────────────────┐   │
│  ┌────────────┐  │────────┼─▶│  Node.js + Socket.io             │   │
│  │ chat.js    │  │        │  │  https://chat.sunware.tech       │   │
│  └────────────┘  │        │  └─────────────────────────────────┘   │
│                  │        │              │                          │
└──────────────────┘        │              ▼                          │
                            │  ┌─────────────────────────────────┐   │
                            │  │  MongoDB (Atlas free tier)       │   │
                            │  └─────────────────────────────────┘   │
                            │              │                          │
                            │              ▼                          │
                            │  ┌─────────────────────────────────┐   │
                            │  │  Operator Dashboard (same server)│   │
                            │  │  https://chat.sunware.tech/admin │   │
                            │  └─────────────────────────────────┘   │
                            └─────────────────────────────────────────┘
```

---

## Embeddable Chat Widget (Vanilla JS for Static HTML)

This is the code to add to S3-hosted landing pages:

### File: `chat-widget.js` (Host on same S3 or CDN)

```javascript
/**
 * Live Chat Widget for AI Product Studio
 * Embed in static HTML with: <script src="chat-widget.js"></script>
 */
(function() {
  'use strict';

  // Configuration - Change this to your chat server URL
  const CHAT_SERVER = 'wss://chat.sunware.tech';
  // const CHAT_SERVER = 'wss://your-api-gateway-url.execute-api.ap-south-1.amazonaws.com/prod';

  // Widget state
  let isOpen = false;
  let socket = null;
  let messages = [];
  let unreadCount = 0;
  let sessionId = getOrCreateSessionId();

  // Create and inject styles
  const styles = `
    .sunware-chat-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .sunware-chat-btn {
      position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 50%; border: none; cursor: pointer; z-index: 99999;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.3s, box-shadow 0.3s;
    }
    .sunware-chat-btn:hover { transform: scale(1.1); box-shadow: 0 6px 30px rgba(102, 126, 234, 0.6); }
    .sunware-chat-btn svg { width: 28px; height: 28px; fill: white; }
    .sunware-chat-badge {
      position: absolute; top: -4px; right: -4px; width: 22px; height: 22px;
      background: #ef4444; border-radius: 50%; color: white; font-size: 12px;
      display: flex; align-items: center; justify-content: center; font-weight: 600;
    }
    .sunware-chat-window {
      position: fixed; bottom: 100px; right: 24px; width: 380px; height: 520px;
      background: white; border-radius: 16px; z-index: 99998;
      box-shadow: 0 10px 50px rgba(0,0,0,0.2); display: none; flex-direction: column;
      overflow: hidden; animation: slideUp 0.3s ease;
    }
    .sunware-chat-window.open { display: flex; }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .sunware-chat-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; padding: 16px 20px; flex-shrink: 0;
    }
    .sunware-chat-header h3 { margin: 0 0 4px 0; font-size: 16px; font-weight: 600; }
    .sunware-chat-header p { margin: 0; font-size: 13px; opacity: 0.9; }
    .sunware-chat-close {
      position: absolute; top: 12px; right: 12px; background: rgba(255,255,255,0.2);
      border: none; width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .sunware-chat-close:hover { background: rgba(255,255,255,0.3); }
    .sunware-chat-close svg { width: 14px; height: 14px; fill: white; }
    .sunware-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px; background: #f9fafb;
    }
    .sunware-chat-msg {
      max-width: 85%; margin-bottom: 12px; padding: 10px 14px;
      border-radius: 16px; font-size: 14px; line-height: 1.4;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .sunware-chat-msg.visitor {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; margin-left: auto; border-bottom-right-radius: 4px;
    }
    .sunware-chat-msg.operator {
      background: white; color: #1f2937; border: 1px solid #e5e7eb;
      border-bottom-left-radius: 4px;
    }
    .sunware-chat-msg.system {
      background: #fef3c7; color: #92400e; text-align: center;
      max-width: 100%; font-size: 12px; border-radius: 8px;
    }
    .sunware-chat-typing {
      font-size: 13px; color: #9ca3af; padding: 8px 0;
    }
    .sunware-chat-input-area {
      padding: 12px 16px; border-top: 1px solid #e5e7eb; background: white;
      display: flex; gap: 8px; flex-shrink: 0;
    }
    .sunware-chat-input {
      flex: 1; border: 1px solid #d1d5db; border-radius: 20px;
      padding: 10px 16px; font-size: 14px; outline: none;
      transition: border-color 0.2s;
    }
    .sunware-chat-input:focus { border-color: #667eea; }
    .sunware-chat-send {
      width: 40px; height: 40px; border-radius: 50%; border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s;
    }
    .sunware-chat-send:hover { transform: scale(1.05); }
    .sunware-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .sunware-chat-send svg { width: 18px; height: 18px; fill: white; }
    .sunware-chat-welcome {
      text-align: center; padding: 40px 20px; color: #6b7280;
    }
    .sunware-chat-welcome-icon { font-size: 48px; margin-bottom: 12px; }
    .sunware-chat-welcome h4 { margin: 0 0 8px 0; color: #374151; font-size: 16px; }
    .sunware-chat-welcome p { margin: 0; font-size: 14px; }
    @media (max-width: 480px) {
      .sunware-chat-window { width: calc(100% - 32px); right: 16px; bottom: 90px; height: 70vh; }
      .sunware-chat-btn { bottom: 16px; right: 16px; }
    }
  `;

  // Inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Create widget HTML
  const widgetHTML = `
    <button class="sunware-chat-btn" id="sunwareChatBtn">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      <span class="sunware-chat-badge" id="sunwareChatBadge" style="display:none">0</span>
    </button>
    <div class="sunware-chat-window" id="sunwareChatWindow">
      <div class="sunware-chat-header">
        <h3>💬 Chat with Us</h3>
        <p>We typically reply within minutes</p>
        <button class="sunware-chat-close" id="sunwareChatClose">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="sunware-chat-messages" id="sunwareChatMessages">
        <div class="sunware-chat-welcome">
          <div class="sunware-chat-welcome-icon">👋</div>
          <h4>Welcome to AI Product Studio!</h4>
          <p>Ask us anything about our partnership opportunities.</p>
        </div>
      </div>
      <div class="sunware-chat-input-area">
        <input type="text" class="sunware-chat-input" id="sunwareChatInput" placeholder="Type your message..." />
        <button class="sunware-chat-send" id="sunwareChatSend">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  `;

  // Create container and inject HTML
  const container = document.createElement('div');
  container.id = 'sunwareChatWidget';
  container.innerHTML = widgetHTML;
  document.body.appendChild(container);

  // Get elements
  const btn = document.getElementById('sunwareChatBtn');
  const window_ = document.getElementById('sunwareChatWindow');
  const closeBtn = document.getElementById('sunwareChatClose');
  const messagesEl = document.getElementById('sunwareChatMessages');
  const input = document.getElementById('sunwareChatInput');
  const sendBtn = document.getElementById('sunwareChatSend');
  const badge = document.getElementById('sunwareChatBadge');

  // Toggle chat
  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    window_.classList.toggle('open', isOpen);
    if (isOpen) {
      unreadCount = 0;
      badge.style.display = 'none';
      input.focus();
      connectSocket();
    }
  });

  closeBtn.addEventListener('click', () => {
    isOpen = false;
    window_.classList.remove('open');
  });

  // Send message
  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    addMessage('visitor', text);
    input.value = '';

    // Send to server
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: 'sendMessage',
        sessionId: sessionId,
        content: text,
        page: window.location.href,
        timestamp: new Date().toISOString()
      }));
    } else {
      // Fallback: Store offline or show error
      addMessage('system', 'Message queued. Connecting...');
      connectSocket();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Add message to UI
  function addMessage(type, text) {
    // Remove welcome message on first real message
    const welcome = messagesEl.querySelector('.sunware-chat-welcome');
    if (welcome) welcome.remove();

    const msg = document.createElement('div');
    msg.className = `sunware-chat-msg ${type}`;
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Update unread badge if window closed
    if (!isOpen && type === 'operator') {
      unreadCount++;
      badge.textContent = unreadCount;
      badge.style.display = 'flex';
    }
  }

  // WebSocket connection
  function connectSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    try {
      socket = new WebSocket(CHAT_SERVER);

      socket.onopen = () => {
        console.log('Chat connected');
        socket.send(JSON.stringify({
          action: 'connect',
          sessionId: sessionId,
          page: window.location.href,
          referrer: document.referrer,
          userAgent: navigator.userAgent
        }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') {
            addMessage('operator', data.content);
          } else if (data.type === 'typing') {
            // Show typing indicator
          } else if (data.type === 'history') {
            // Load message history
            data.messages.forEach(m => {
              addMessage(m.sender, m.content);
            });
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      };

      socket.onclose = () => {
        console.log('Chat disconnected');
        // Reconnect after 5 seconds
        setTimeout(connectSocket, 5000);
      };

      socket.onerror = (error) => {
        console.error('Chat error:', error);
      };

    } catch (e) {
      console.error('Failed to connect:', e);
    }
  }

  // Session management
  function getOrCreateSessionId() {
    let id = localStorage.getItem('sunware_chat_session');
    if (!id) {
      id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('sunware_chat_session', id);
    }
    return id;
  }

  // Auto-connect after page load
  setTimeout(connectSocket, 2000);

})();
```

### Add to Landing Pages

Add this single line before `</body>` in each landing page:

```html
<!-- AI Product Studio Live Chat -->
<script src="https://ai-product-studio-sunware.s3.ap-south-1.amazonaws.com/chat-widget.js"></script>
```

Or inline for testing:
```html
<script>
  // Paste the entire chat-widget.js content here
</script>
```

---

## Recommendation

For AI Product Studio, I recommend **Option 2 (Custom) or Option 4 (Hybrid)** because:

1. **Partnership inquiries are high-value** - Need full conversation control
2. **Data ownership** - Keep visitor data in-house
3. **Future AI integration** - Can add Claude/GPT later for auto-responses
4. **Branding** - Fully customizable widget matching site design
5. **Analytics** - Track conversion from chat to partnership applications

---

## Custom Implementation Plan

If we proceed with custom implementation, here's the breakdown:

### Phase 1: Chat Widget (Frontend)

```
frontend/
├── components/
│   └── LiveChat/
│       ├── LiveChat.jsx          # Main container
│       ├── ChatWindow.jsx        # Chat UI
│       ├── ChatInput.jsx         # Message input
│       ├── ChatMessage.jsx       # Message bubbles
│       └── ChatToggle.jsx        # Floating button
├── hooks/
│   └── useChatSocket.js          # WebSocket connection
└── services/
    └── chatService.js            # API calls
```

**Features:**
- Floating chat button (bottom-right)
- Expandable chat window
- Message history (localStorage for session)
- Typing indicators
- Read receipts
- Offline message queuing
- Mobile responsive

### Phase 2: Chat Server (Backend)

```
chat-server/
├── src/
│   ├── index.js                  # Express + Socket.io
│   ├── socket/
│   │   ├── handlers.js           # Socket event handlers
│   │   ├── rooms.js              # Room management
│   │   └── middleware.js         # Auth middleware
│   ├── routes/
│   │   ├── conversations.js      # REST API
│   │   └── operators.js          # Operator management
│   ├── models/
│   │   ├── Conversation.js       # Chat sessions
│   │   ├── Message.js            # Individual messages
│   │   └── Operator.js           # Support team
│   └── services/
│       ├── notificationService.js # Teams/Email alerts
│       └── analyticsService.js    # Tracking
├── .env
└── package.json
```

**Features:**
- WebSocket real-time messaging
- Conversation persistence (MongoDB)
- Operator authentication
- Auto-assignment to available operators
- Typing indicators
- Offline message handling
- Teams webhook notifications

### Phase 3: Operator Dashboard

```
operator-dashboard/
├── src/
│   ├── pages/
│   │   ├── Dashboard.jsx         # Overview
│   │   ├── Conversations.jsx     # Active chats
│   │   ├── History.jsx           # Past conversations
│   │   └── Settings.jsx          # Team settings
│   ├── components/
│   │   ├── ConversationList.jsx  # Chat list sidebar
│   │   ├── ChatPanel.jsx         # Active chat
│   │   ├── VisitorInfo.jsx       # Visitor details
│   │   └── QuickResponses.jsx    # Canned responses
│   └── hooks/
│       └── useOperatorSocket.js  # Operator connection
└── package.json
```

**Features:**
- Real-time conversation list
- Multi-conversation handling
- Visitor information (page, referrer, location)
- Canned/quick responses
- Conversation transfer
- Chat history search
- Analytics dashboard

---

## Database Schema (MongoDB)

```javascript
// Conversation
{
  _id: ObjectId,
  sessionId: String,           // Browser session
  visitorId: String,           // Unique visitor ID
  visitorInfo: {
    name: String,              // Optional (if provided)
    email: String,             // Optional (if provided)
    page: String,              // Current page URL
    referrer: String,          // How they found us
    userAgent: String,
    location: String           // Geo IP
  },
  status: 'waiting' | 'active' | 'resolved' | 'missed',
  operatorId: ObjectId,        // Assigned operator
  messages: [MessageId],
  startedAt: Date,
  resolvedAt: Date,
  tags: [String],              // 'partnership', 'pricing', etc.
  rating: Number,              // 1-5 feedback
  notes: String                // Internal notes
}

// Message
{
  _id: ObjectId,
  conversationId: ObjectId,
  sender: 'visitor' | 'operator' | 'system',
  senderId: String,
  content: String,
  type: 'text' | 'image' | 'file',
  timestamp: Date,
  readAt: Date
}

// Operator
{
  _id: ObjectId,
  name: String,
  email: String,
  password: String,            // Hashed
  role: 'admin' | 'operator',
  status: 'online' | 'away' | 'offline',
  activeChats: [ConversationId],
  maxChats: Number,            // Concurrent chat limit
  quickResponses: [{
    shortcut: String,
    text: String
  }]
}
```

---

## Chat Widget Code Preview

### ChatWidget.jsx (Landing Page Integration)

```jsx
// Minimal embed code for landing pages
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const CHAT_SERVER = 'wss://chat.sunware.tech';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [socket, setSocket] = useState(null);
  const [unread, setUnread] = useState(0);
  const [operatorTyping, setOperatorTyping] = useState(false);

  // Connect to chat server
  useEffect(() => {
    const s = io(CHAT_SERVER, {
      query: {
        page: window.location.pathname,
        referrer: document.referrer,
        sessionId: getOrCreateSessionId()
      }
    });

    s.on('connect', () => {
      console.log('Chat connected');
    });

    s.on('message', (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!isOpen) setUnread(prev => prev + 1);
    });

    s.on('operator_typing', () => {
      setOperatorTyping(true);
      setTimeout(() => setOperatorTyping(false), 3000);
    });

    setSocket(s);

    return () => s.disconnect();
  }, []);

  const sendMessage = (text) => {
    socket?.emit('message', { content: text });
    setMessages(prev => [...prev, {
      sender: 'visitor',
      content: text,
      timestamp: new Date()
    }]);
  };

  return (
    <>
      {/* Chat Toggle Button */}
      <button
        onClick={() => { setIsOpen(!isOpen); setUnread(0); }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-lg
          flex items-center justify-center text-white hover:bg-blue-700 z-50"
      >
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full
            text-xs flex items-center justify-center">{unread}</span>
        )}
        💬
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-96 h-[500px] bg-white rounded-2xl
          shadow-2xl flex flex-col overflow-hidden z-50">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
            <h3 className="font-semibold">Chat with Us</h3>
            <p className="text-sm text-blue-100">We typically reply within minutes</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.sender === 'visitor' ? 'justify-end' : ''}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  msg.sender === 'visitor'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {operatorTyping && (
              <div className="text-gray-400 text-sm">Operator is typing...</div>
            )}
          </div>

          {/* Input */}
          <ChatInput onSend={sendMessage} />
        </div>
      )}
    </>
  );
}

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('chat_session');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('chat_session', id);
  }
  return id;
}
```

---

## Teams Integration (Notifications)

If using Teams for notifications:

```javascript
// services/teamsNotification.js
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;

async function notifyNewChat(conversation) {
  await fetch(TEAMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": "0076D7",
      "summary": "New Chat from AI Product Studio",
      "sections": [{
        "activityTitle": "💬 New Visitor Chat",
        "facts": [
          { "name": "Page", "value": conversation.visitorInfo.page },
          { "name": "Message", "value": conversation.messages[0].content },
          { "name": "Time", "value": new Date().toLocaleString() }
        ],
        "markdown": true
      }],
      "potentialAction": [{
        "@type": "OpenUri",
        "name": "Open Dashboard",
        "targets": [{
          "os": "default",
          "uri": `https://chat-admin.sunware.tech/conversation/${conversation._id}`
        }]
      }]
    })
  });
}
```

---

## Deployment Options

### Option A: AWS (Recommended)

```
┌─────────────────────────────────────────────────────────────────┐
│                          AWS                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ CloudFront  │───▶│    ALB      │───▶│    ECS      │         │
│  │ (Landing)   │    │             │    │ (Chat Srv)  │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                               │                  │
│                                               ▼                  │
│                           ┌─────────────────────────────┐       │
│                           │    DocumentDB / MongoDB     │       │
│                           │    (Chat History)           │       │
│                           └─────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Estimated Cost:** ~$50-100/month

### Option B: Simple VPS

- DigitalOcean/Linode droplet ($12-24/month)
- PM2 for process management
- Nginx reverse proxy
- Let's Encrypt SSL

---

## Questions for Discussion

1. **Which option do you prefer?**
   - [ ] Option 1: Teams Integration only
   - [ ] Option 2: Full custom solution
   - [ ] Option 3: Third-party (Tawk.to/Crisp)
   - [ ] Option 4: Hybrid (Custom + Teams)

2. **Who will operate the chat?**
   - How many operators?
   - Working hours or 24/7?
   - Need mobile notifications?

3. **Feature priorities:**
   - [ ] Real-time typing indicators
   - [ ] File/image sharing
   - [ ] Canned responses
   - [ ] Chat transcripts via email
   - [ ] Visitor analytics
   - [ ] Chat ratings/feedback
   - [ ] Multi-language support

4. **Data requirements:**
   - How long to keep chat history?
   - Need GDPR compliance?
   - Export/backup requirements?

5. **Integration needs:**
   - CRM integration?
   - Email follow-ups?
   - Lead capture forms?

---

## Next Steps

1. **Decide on approach** (discuss above options)
2. **Define MVP features** (what's essential for launch?)
3. **Choose hosting** (AWS, VPS, or managed service)
4. **Implementation** (estimated timeline below)

### Timeline Estimates

| Approach | MVP | Full Featured |
|----------|-----|---------------|
| Teams Integration | 2-3 days | 1 week |
| Custom Solution | 1 week | 2-3 weeks |
| Third-Party | 1-2 hours | 1 day |
| Hybrid | 1 week | 2 weeks |

---

## References

- [Socket.io Documentation](https://socket.io/docs/v4/)
- [Microsoft Teams Webhooks](https://docs.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/)
- [Tawk.to Free Live Chat](https://www.tawk.to/)
- [Crisp Chat](https://crisp.chat/)
- [Reference: AI Chat Implementation](/docs/CHAT_INTERFACE_GUIDE.md)

---

*Document created: January 2026*
*Status: Discussion Draft - Awaiting Decision*
