# Vercel Fresh Deployment Checklist

## Pre-Deployment: Verify Code is Ready

✅ **Source code has OAuth guards:**
```bash
cd frontend/taskpilotai
grep -c "if (isDesktopShell && window.taskPilotDesktop?.googleLogin)" src/main.js
# Should output: 2
```

✅ **Latest changes pushed to GitHub:**
```bash
git status
# Should show: nothing to commit, working tree clean
```

---

## Vercel Project Setup

### Step 1: Delete Old Project (if exists)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the old `error-404` project
3. Settings → Delete Project

### Step 2: Create New Project
1. Click **"Add New"** → **"Project"**
2. Import from **GitHub**: `KishuSInha/Error-404` (or your repo name)
3. Select repository and click **Import**

### Step 3: Configure Project Settings

#### Framework Preset
- **Framework Preset:** Other

#### Root Directory
- **Root Directory:** `frontend/taskpilotai` ⚠️ **IMPORTANT!**

#### Build & Output Settings
- **Build Command:** `node scripts/build.mjs`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

#### Environment Variables
- None needed (backend URL is hardcoded in the app)

### Step 4: Deploy
1. Click **"Deploy"**
2. Wait 2-3 minutes for build to complete
3. Vercel will give you a URL like `error-404-xyz.vercel.app`

---

## Post-Deployment: Verify

### Test 1: Check OAuth Guards Are Present
```bash
# Replace with your actual Vercel URL
curl -s "https://YOUR-APP.vercel.app" | grep -c "isDesktopShell && window.taskPilotDesktop"
# Should output: 2 or more (not 0)
```

### Test 2: Demo Mode Works
1. Visit your Vercel URL in browser
2. Click **"Engineer Mode"** button
3. Should load dashboard without errors

### Test 3: No Console Errors
1. Open browser DevTools (F12) → Console
2. Should NOT see: `undefined is not an object (evaluating 'window.taskPilotDesktop.googleLogin')`
3. Should see: Backend offline warning (expected - demo mode uses local data)

---

## Configure Google OAuth (After Successful Deployment)

### Step 1: Add Vercel URL to Supabase
1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/pfotrcjqnopvyihwqvhu)
2. Navigate: **Authentication** → **URL Configuration**
3. Under **Redirect URLs**, add:
   ```
   https://YOUR-APP.vercel.app
   https://YOUR-APP.vercel.app/
   ```
4. Click **Save**

### Step 2: Test Google OAuth
1. Visit your Vercel URL
2. Click **"Sign in with Google · Engineer"**
3. Should redirect to Google login
4. After login, should redirect back to TaskPilot dashboard

---

## Troubleshooting

### Issue: Build Fails
**Error:** `Cannot find module 'scripts/build.mjs'`
**Solution:** Make sure Root Directory is set to `frontend/taskpilotai`

### Issue: 404 on deployment
**Error:** Page not found
**Solution:** Verify Output Directory is `dist` and build command ran successfully

### Issue: Still seeing old code
**Solution:** Wait 5 minutes for CDN cache, then hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

### Issue: White/blank page
**Solution:** Check browser console for errors, verify build logs in Vercel dashboard

---

## Expected Behavior After Fresh Deploy

✅ **Demo Mode** - Works immediately, no auth required  
✅ **Google OAuth** - Works after adding Vercel URL to Supabase  
✅ **Backend API** - Connects to `https://taskpilotaibackend.onrender.com`  
✅ **No Console Errors** - Clean browser console (except backend offline warning in demo mode)

---

## Vercel Configuration Files

All configuration is in these files (already committed):
- `frontend/taskpilotai/vercel.json` - Build settings and headers
- `frontend/taskpilotai/.gitignore` - Excludes dist/ from git (forces Vercel to build)
- `frontend/taskpilotai/package.json` - Dependencies

---

**Last Updated:** July 6, 2026 16:12  
**Latest Commit:** `46ecbb0` - Removed dist/ from git, forces Vercel to build from source
