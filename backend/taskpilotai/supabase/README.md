# TaskPilot Supabase Setup

Use this for Google login and engineer/manager profile storage.

## 1. Project URL

From your screenshot:

```env
SUPABASE_URL=https://pfotrcjqnopvyihwqvhu.supabase.co
SUPABASE_ANON_KEY=copy_from_supabase_dashboard_api_settings
```

Add those values in:

```text
backend/utkarsh/.env
```

The anon key is in Supabase Dashboard -> Project Settings -> API.

## 2. Create Database Tables

Open Supabase Dashboard -> SQL Editor -> New query.

Paste and run:

```text
backend/utkarsh/supabase/001_taskpilot_profiles.sql
```

This creates:

- `departments`
- `teams`
- `engineer_profiles`
- `task_source_connections`
- `agent_execution_history`
- Row Level Security policies
- A trigger that creates an engineer profile when a Google-auth user is created

## 3. Enable Google Auth

Supabase Dashboard:

1. Go to Authentication -> Providers.
2. Enable Google.
3. Add Google OAuth Client ID.
4. Add Google OAuth Client Secret.
5. Save.

Then go to Authentication -> URL Configuration and add this desktop redirect URL:

```text
http://127.0.0.1:47835/auth/callback
```

Google Cloud Console:

1. Create OAuth Client ID.
2. Choose Web application.
3. Add authorized JavaScript origins:

```text
https://pfotrcjqnopvyihwqvhu.supabase.co
http://localhost:5173
http://127.0.0.1:5173
```

4. Add authorized redirect URI:

```text
https://pfotrcjqnopvyihwqvhu.supabase.co/auth/v1/callback
```

Google redirects to Supabase first. Supabase then redirects the completed desktop session to TaskPilot's temporary localhost callback on port `47835`.

## 4. Engineer Profile Fields

`engineer_profiles` stores real IT-company fields:

- full name, display name, email, avatar
- role: engineer, manager, admin
- employee ID
- department, team, manager
- job title, seniority
- location, timezone, phone
- skills, primary stack
- current sprint
- weekly capacity
- focus hours
- notification channels
- work preferences
- onboarding status

## 5. Manager Use

Set `role = 'manager'` for manager users. TaskPilot writes the selected login role to `engineer_profiles.role` after Google authentication succeeds.
