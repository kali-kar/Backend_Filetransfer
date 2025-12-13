# Render Deployment Fix

## Problem
If you see the error: `Error: Cannot find module '/opt/render/project/src/start'`

This means Render is trying to run `node start` instead of `npm start`.

## Solution

### Option 1: Fix in Render Dashboard (Recommended)

1. Go to your Render dashboard: https://dashboard.render.com
2. Click on your service (e.g., "backend-079a" or "p2p-signaling-server")
3. Go to **Settings** tab
4. Scroll down to **Start Command**
5. Change it from `node start` to: `npm start`
6. Save changes
7. Render will automatically redeploy

### Option 2: Using render.yaml

If you're using `render.yaml` for deployment:

1. Make sure `backend/render.yaml` exists (it should be in the backend folder)
2. In Render dashboard, go to your service settings
3. Enable "Render Blueprint" or use the `render.yaml` file
4. The start command should be set to `npm start`

## Verify Configuration

Your `package.json` should have:
```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

This is correct! Render just needs to run `npm start` (not `node start`).

## Root Directory

Also verify in Render settings:
- **Root Directory**: Should be `backend` (or leave empty if deploying from backend folder directly)

## Build Command

- **Build Command**: `npm install`

## Start Command

- **Start Command**: `npm start` (NOT `node start`)

## After Fixing

After updating the start command:
1. Render will automatically trigger a new deployment
2. Wait for the deployment to complete
3. Check the logs to verify it's running correctly
4. Test your service at: `https://your-service.onrender.com/health`

