# Vercel Redeployment Instructions

## Issue
The Vercel deployment at `https://error-404-mu.vercel.app` is serving cached/stale code without the OAuth browser guards. The source code and committed `dist/` folder are correct, but Vercel's CDN is not serving the latest version.

## Solution: Force Manual Redeploy

### Option 1: Vercel Dashboard (Recommended)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the `error-404` project
3. Go to **Deployments** tab
4. Find the latest deployment (commit: `6a7291a "Trigger Vercel rebuild with timestamp"`)
5. Click the **three dots menu (⋯)** on that deployment
6. Click **"Redeploy"**
7. Wait 2-3 minutes for the new deployment to complete

### Option 2: Vercel CLI
```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Login to Vercel
vercel login

# Navigate to frontend folder
cd frontend/taskpilotai

# Deploy with force flag
vercel --force --prod
```

### Option 3: Empty Commit Push
```bash
# In the project root
cd /Users/utkarshsinha/Documents/GitHub/Error-404

# Create an empty commit
git commit --allow-empty -m "Force Vercel redeploy"

# Push to trigger auto-deploy
git push
```

## Verify Deployment

After redeployment, run this command to verify the OAuth guard is present:

```bash
curl -s "https://error-404-mu.vercel.app" > /tmp/vercel_check.html
grep -A 5 "loginEngineerBtn" /tmp/vercel_check.html | grep "isDesktopShell"
```

**Expected output:** Should see `if (isDesktopShell && window.taskPilotDesktop?.googleLogin)`

## What Should Work After Redeploy

1. ✅ **Demo Mode** (Engineer/Manager buttons) - should work immediately
2. ⚠️ **Google OAuth** - will work AFTER you add Vercel URL to Supabase (see DEPLOYMENT_STATUS.md)

## Files Changed (Latest Commit)
- `frontend/taskpilotai/src/main.js` - Added timestamp comment
- `frontend/taskpilotai/dist/index.html` - Rebuilt with OAuth guards
- `frontend/taskpilotai/vercel.json` - Added Cache-Control headers

## Why This Happened
Vercel's edge CDN aggressively caches static content. Even though we:
1. ✅ Fixed the source code (`src/main.js`)
2. ✅ Rebuilt the dist folder with `npm run build`
3. ✅ Committed and pushed to GitHub
4. ✅ Added no-cache headers to `vercel.json`

The CDN may still serve cached content for 5-15 minutes. A manual redeploy forces Vercel to invalidate all caches.

## Post-Redeploy Checklist
- [ ] Visit `https://error-404-mu.vercel.app`
- [ ] Open browser DevTools → Console
- [ ] Verify no errors about `window.taskPilotDesktop` being undefined
- [ ] Click "Engineer Mode" button - should enter demo mode successfully
- [ ] (After Supabase setup) Click "Sign in with Google" - should redirect to Google OAuth

---

**Last Updated:** July 6, 2026 16:06  
**Deployment Commit:** `6a7291a`
