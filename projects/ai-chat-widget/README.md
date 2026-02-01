# AI Chat Widget

A reusable chat widget for CoCreate with session persistence, file uploads, and login/signup integration.

## Project Structure

```
ai-chat-widget/
├── backend/                 # AWS Lambda backend
│   ├── index.mjs           # Main Lambda handler
│   ├── package.json        # Dependencies
│   ├── package-lock.json
│   └── deploy.sh           # Deployment script
├── frontend/               # Browser-side code
│   ├── js/
│   │   ├── chat-widget.js  # Main widget class
│   │   └── chat-loader.js  # Loader and page integration
│   └── css/
│       └── chat-widget.css # Widget styles
└── README.md
```

## Features

- Real-time chat with Claude AI
- Session persistence by phone/email (returning users get their chat history)
- File uploads (PDF, DOCX, images)
- Screenshot capture
- Voice input
- Form auto-fill from uploaded documents
- Login/signup integration
- Token usage tracking
- Minimizable sidebar

## Backend Setup

```bash
cd backend
npm install
```

### Environment Variables

Set these in AWS Lambda:
- `ANTHROPIC_API_KEY` - Claude API key
- `OPENAI_API_KEY` - OpenAI API key (backup)
- `NOTIFICATION_EMAIL` - Email for lead notifications
- `ADMIN_PASSWORD` - Admin panel password

### Deploy to AWS Lambda

```bash
cd backend
bash deploy.sh
```

## Frontend Integration

### 1. Include Scripts

```html
<!-- Required: html2canvas for screenshots -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>

<!-- Chat Widget -->
<link rel="stylesheet" href="css/chat-widget.css">
<script src="js/chat-widget.js"></script>
<script src="js/chat-loader.js"></script>
```

### 2. Basic Usage

The chat widget initializes automatically. No additional code needed.

### 3. Login/Signup Integration

```javascript
// On user login - restores previous chat session
ChatLoader.onUserLogin({
    phone: '9876543210',
    email: 'user@example.com',
    name: 'John Doe'
});

// On user signup - starts fresh chat
ChatLoader.onUserSignup({
    phone: '9876543210',
    email: 'user@example.com',
    name: 'John Doe'
});
```

### 4. Public API

```javascript
// Open/close/toggle chat
ChatLoader.open();
ChatLoader.close();
ChatLoader.toggle();

// Get/set visitor info
ChatLoader.getVisitorInfo();
ChatLoader.setVisitorInfo({ name: 'John', email: 'john@example.com' });

// Get current page context
ChatLoader.getPageContext();
```

## Session Persistence

When a user provides their phone or email:
1. Backend saves session with a lookup index
2. Next time they return and provide same phone/email
3. Previous chat history is automatically restored

## API Endpoints

| Action | Description |
|--------|-------------|
| (default) | Send chat message |
| `lookup-session` | Find existing session by phone/email |
| `admin-login` | Admin authentication |
| `admin-list` | List all applications |
| `admin-chats` | List chat sessions |
| `admin-clients` | List client profiles |

## S3 Storage Structure

```
ai-product-studio-applications/
├── applications/           # Form submissions
├── chats/
│   ├── landing/           # Landing page chat sessions
│   └── apply/             # Apply page chat sessions
├── clients/               # Client profiles
├── session-lookups/       # Phone/email to session index
│   └── index.json
├── jobs/                  # Build jobs
├── progress/              # Build progress
└── builds/                # Completed builds
```

## License

Proprietary - CoCreate
