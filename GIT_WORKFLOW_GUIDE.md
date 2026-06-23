# Git Workflow Guide

This guide explains how to upload project files to the GitHub repository and how to pull updates from GitHub onto the Proxmox server.

Project repository:

```text
https://github.com/dcswami/signage-chatgpt
```

## 1. Upload Project Files to GitHub

Use these steps from the project folder on your local computer.

Project folder:

```text
/Users/dcdas/Documents/Classroom Signage
```

### 1.1 First-Time Git Setup

Open a terminal in the project folder.

```bash
cd "/Users/dcdas/Documents/Classroom Signage"
```

Initialize Git:

```bash
git init
```

Set the default branch name:

```bash
git branch -M main
```

Add the GitHub repository as the remote:

```bash
git remote add origin https://github.com/dcswami/signage-chatgpt.git
```

Verify the remote:

```bash
git remote -v
```

### 1.2 Review Files Before Upload

Check which files Git sees:

```bash
git status
```

Review the current project files:

```bash
find . -maxdepth 3 -type f | sort
```

Do not commit secrets such as passwords, API keys, `.env` files, Cloudflare credentials, database dumps, or private certificates.

### 1.3 Add Files

Add the project files:

```bash
git add REQUIREMENTS.md
git add README.md
git add PROXMOX_DEPLOYMENT_GUIDE.md
git add TEST_ENVIRONMENT_DEPLOYMENT.md
git add GIT_WORKFLOW_GUIDE.md
git add package.json
git add Dockerfile
git add docker-compose.test.yml
git add .env.example
git add .gitignore
git add src/server.mjs
git add public/admin.css
git add public/admin.js
git add public/kiosk.css
git add public/kiosk.js
git add database/schema.sql
git add templates/kiosk-default.css
git add assets/branding/aksharderi-small2.png
git add assets/audio/alarm.mp3
git add assets/backgrounds/background.png
git add samples/README.md
git add samples/kiosk-layout-options.html
git add samples/kiosk-layout-options.css
```

Check status again:

```bash
git status
```

### 1.4 Commit Files

Create the first commit:

```bash
git commit -m "Add signage management requirements and deployment guides"
```

### 1.5 Push to GitHub

Push to GitHub:

```bash
git push -u origin main
```

If GitHub asks for credentials, use your GitHub username and a personal access token instead of your GitHub password.

### 1.6 Normal Upload After Future Changes

After editing files later, use:

```bash
cd "/Users/dcdas/Documents/Classroom Signage"
git status
git add .
git commit -m "Describe the update"
git push
```

Use a clear commit message, for example:

```bash
git commit -m "Update kiosk deployment requirements"
```

## 2. Pull from GitHub to the Proxmox Server

Use these steps on the Debian 12 VM running on Proxmox.

Recommended server project location:

```text
/opt/signage/source
```

### 2.1 Install Git on the Server

```bash
sudo apt update
sudo apt install -y git
```

### 2.2 First-Time Clone on the Server

Create the application parent folder:

```bash
sudo mkdir -p /opt/signage
sudo chown -R $USER:$USER /opt/signage
```

Clone the repository:

```bash
cd /opt/signage
git clone https://github.com/dcswami/signage-chatgpt.git source
```

Go into the cloned repository:

```bash
cd /opt/signage/source
```

Confirm files are present:

```bash
git status
find . -maxdepth 3 -type f | sort
```

### 2.3 Pull Future Updates

When new changes are pushed to GitHub, pull them on the server:

```bash
cd /opt/signage/source
git pull origin main
```

### 2.4 If the Server Has Local Changes

The server should normally not edit project source files directly. If `git pull` reports local changes, check them first:

```bash
git status
```

If the local changes are only accidental edits and are not needed, save a copy before removing them.

Avoid storing server-only files in the repository, including:

- `.env`
- Cloudflare Tunnel credentials
- Database backups
- Uploaded production files
- Private certificates or keys

### 2.5 Update Running Docker Services After Pull

If the repository later contains the real application code and Docker Compose file, update the running services after pulling:

```bash
cd /opt/signage/source
docker compose pull
docker compose up -d
docker compose ps
```

If the application image is built directly on the server, use:

```bash
cd /opt/signage/source
docker compose up -d --build
docker compose ps
```

### 2.6 Verify After Pull

After updating the server, verify:

- `https://signage.bapswest.org/admin` opens the management portal.
- `https://signage.bapswest.org/api/health` returns healthy status.
- `https://signage.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>` works for authenticated users.
- `https://signage.bapswest.org/<<UNIQUE-ROOM-CODE>>` loads the kiosk page.
- Emergency/Safety Broadcast reaches a test kiosk.
- Calendar sync workers are running.

## 3. Recommended Repository Rules

- Keep source code, requirements, templates, and deployment documentation in Git.
- Keep secrets and server-specific files outside Git.
- Use `.gitignore` before adding real application code.
- Use one main branch for stable updates.
- Test changes before pulling them onto the production server.
- Create a backup before major production updates.

## 4. Suggested `.gitignore`

When real application files are added, create a `.gitignore` file similar to this:

```gitignore
.env
.env.*
!.env.example
node_modules/
dist/
build/
.next/
coverage/
*.log
backups/
uploads/
data/
*.sql
*.sql.gz
*.pem
*.key
*.crt
.DS_Store
```

Add and commit `.gitignore` before adding application code.
