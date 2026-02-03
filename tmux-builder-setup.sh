#!/bin/bash
# Tmux Builder Setup Script for EC2
# Run as: sudo bash tmux-builder-setup.sh

set -e

echo "=== Phase 2: Installing Dependencies ==="

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Python 3.11
apt install -y python3.11 python3.11-venv python3-pip

# Install other dependencies
apt install -y git tmux nginx

# Install PM2 globally
npm install -g pm2

echo "=== Cloning Repository ==="
cd /home/ubuntu
git clone https://github.com/cocreateceo/tmux-builder.git
cd tmux-builder
git checkout wsocket_ui

echo "=== Setting up Backend ==="
cd /home/ubuntu/tmux-builder/backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

echo "=== Setting up Frontend ==="
cd /home/ubuntu/tmux-builder/frontend
npm install
npm run build

echo "=== Phase 3: Configuring Nginx ==="
cat > /etc/nginx/sites-available/tmux-builder << 'NGINX_EOF'
server {
    listen 80;
    server_name _;

    # Frontend
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8080/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/tmux-builder /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "=== Phase 4: Starting Services with PM2 ==="
cd /home/ubuntu/tmux-builder

# Start backend
cd backend
pm2 start "source venv/bin/activate && python main.py" --name tmux-backend

# Start frontend
cd ../frontend
pm2 start npm --name tmux-frontend -- run start

# Save PM2 config
pm2 save
pm2 startup

echo "=== Setup Complete ==="
echo "Elastic IP: 18.211.207.2"
echo "Test: http://18.211.207.2"
