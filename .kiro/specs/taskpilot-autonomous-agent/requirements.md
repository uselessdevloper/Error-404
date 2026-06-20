# Requirements Document

## Introduction

TaskPilot AI is currently a chatbot-style application that requires users to manually request task analysis and prioritization. This specification transforms TaskPilot into a true autonomous AI agent that proactively monitors, analyzes, and manages a user's work without requiring explicit user prompts.

The autonomous agent will scan multiple data sources (emails, Slack, Jira, GitHub, meetings, calendar, ServiceNow), extract action items, detect duplicates, prioritize tasks intelligently using Gemini AI, and present a daily execution plan. The agent operates on a scheduled basis (e.g., every morning at 8 AM) and continuously throughout the workday, providing real-time insights into work patterns and urgent items.

## Glossary

- **TaskPilot_System**: The complete TaskPilot AI application including frontend, backend, and database
- **Autonomous_Agent**: The background service that proactively scans, analyzes, and prioritizes work without user prompts
- **Data_Source**: External systems providing work items (Jira, Outlook, Slack, GitHub, ServiceNow, Calendar, Meeting Notes)
- **Action_Item**: A discrete task or request extracted from communications or work tracking systems
- **Gemini_AI**: Google's Gemini API service used for intelligent task analysis and prioritization
- **Unified_Inbox**: Aggregated view showing action items from all data sources in one interface
- **Priority_Score**: AI-calculated numeric score (0-100) indicating task urgency and importance
- **Duplicate_Task**: Multiple action items referring to the same underlying work
- **Execution_Plan**: Daily schedule of tasks ranked by priority with time estimates
- **Hidden_Ask**: Implicit request or action item found within communications that isn't explicitly stated
- **Meeting_Memory**: System capability to extract and track action items from meeting notes
- **Autonomous_Scan**: Background process that regularly checks all data sources for new work items
- **User_Profile**: Engineer profile stored in Supabase containing name, preferences, notification settings, and work configuration
- **Supabase_Database**: PostgreSQL database hosted on Supabase for persistent storage of user profiles and agent execution history

## Requirements

### Requirement 1: Autonomous Background Scanning

**User Story:** As a user, I want the agent to automatically scan all my data sources on a schedule, so that I don't have to manually request updates.

#### Acceptance Criteria

1. THE Autonomous_Agent SHALL execute a complete scan of all enabled Data_Sources at 8:00 AM user local time daily
2. WHILE the user is logged in, THE Autonomous_Agent SHALL perform incremental scans of all enabled Data_Sources every 15 minutes
3. WHEN a scheduled scan completes, THE Autonomous_Agent SHALL store the scan timestamp and item count in the Supabase_Database
4. WHERE a Data_Source connection is disabled in user settings, THE Autonomous_Agent SHALL exclude that Data_Source from all scans
5. IF a Data_Source scan fails, THEN THE Autonomous_Agent SHALL log the error, continue scanning remaining sources, and retry the failed source after 5 minutes

### Requirement 2: Action Item Extraction

**User Story:** As a user, I want the agent to extract all action items from my data sources, so that I have a complete picture of my work.

#### Acceptance Criteria

1. WHEN scanning Outlook emails, THE Autonomous_Agent SHALL extract Action_Items from email body text, subject lines, and explicit requests using Gemini_AI
2. WHEN scanning Slack mentions, THE Autonomous_Agent SHALL identify Action_Items from direct mentions, thread requests, and channel assignments
3. WHEN scanning Jira tickets, THE Autonomous_Agent SHALL extract Action_Items from tickets assigned to the user with status "Todo" or "In Progress"
4. WHEN scanning GitHub work, THE Autonomous_Agent SHALL identify Action_Items from assigned pull requests, review requests, and open issues
5. WHEN scanning ServiceNow defects, THE Autonomous_Agent SHALL extract Action_Items from incidents assigned to the user with status "New" or "In Progress"
6. WHEN scanning meeting notes, THE Autonomous_Agent SHALL use Gemini_AI to identify explicit and implicit Action_Items assigned to or relevant to the user
7. WHEN scanning calendar blocks, THE Autonomous_Agent SHALL extract Action_Items from event descriptions containing task-related keywords
8. FOR ALL extracted Action_Items, THE Autonomous_Agent SHALL capture title, body, source, severity, due date, owner, team, dependencies, and execution details

### Requirement 3: Hidden Ask Detection

**User Story:** As a user, I want the agent to surface implicit requests from my communications, so that I don't miss important but unstated expectations.

#### Acceptance Criteria

1. WHEN analyzing email content, THE Autonomous_Agent SHALL use Gemini_AI to identify Hidden_Asks that are implied but not explicitly stated as requests
2. WHEN analyzing Slack messages, THE Autonomous_Agent SHALL detect Hidden_Asks from context clues such as questions about ETA, mentions of blockers, or discussions of incomplete work
3. WHEN a Hidden_Ask is detected, THE Autonomous_Agent SHALL create an Action_Item with a "hidden-ask" tag and severity based on urgency indicators
4. THE Autonomous_Agent SHALL display Hidden_Asks in a dedicated section of the Unified_Inbox with explanation of why it was flagged
5. WHEN presenting a Hidden_Ask, THE Autonomous_Agent SHALL include the original message context and the AI reasoning for flagging it

### Requirement 4: Intelligent Duplicate Detection

**User Story:** As a user, I want the agent to detect when multiple sources reference the same work, so that I don't duplicate effort or get confused by redundant items.

#### Acceptance Criteria

1. WHEN the Autonomous_Agent completes extracting Action_Items from all Data_Sources, THE Autonomous_Agent SHALL use Gemini_AI to identify Duplicate_Tasks across sources
2. THE Autonomous_Agent SHALL consider Action_Items as potential duplicates based on title similarity, body content overlap, due date proximity, and shared identifiers (e.g., Jira ticket IDs mentioned in emails)
3. WHEN Duplicate_Tasks are detected, THE Autonomous_Agent SHALL consolidate them into a single Action_Item with references to all source locations
4. THE Autonomous_Agent SHALL display consolidated Action_Items with badges indicating all source Data_Sources
5. WHEN presenting a consolidated Action_Item, THE Autonomous_Agent SHALL show a "View Sources" option that reveals all original messages or tickets

### Requirement 5: AI-Powered Task Prioritization

**User Story:** As a user, I want the agent to intelligently rank my tasks by priority, so that I focus on the most important work first.

#### Acceptance Criteria

1. WHEN all Action_Items have been extracted and deduplicated, THE Autonomous_Agent SHALL send the complete list to Gemini_AI for prioritization
2. THE Autonomous_Agent SHALL assign each Action_Item a Priority_Score between 0 and 100 based on severity, due date, impact, dependencies, and sender authority
3. FOR ALL prioritized Action_Items, THE Autonomous_Agent SHALL include an array of human-readable priority reasons explaining the score
4. THE Autonomous_Agent SHALL sort Action_Items by Priority_Score in descending order for display in the Today_Priority page
5. WHEN an Action_Item has a due date within 24 hours and severity "P1", THE Autonomous_Agent SHALL assign a Priority_Score of at least 90
6. WHEN an Action_Item is referenced in a VP or executive email, THE Autonomous_Agent SHALL increase the Priority_Score by 15 points
7. WHEN an Action_Item blocks other team members, THE Autonomous_Agent SHALL increase the Priority_Score by 10 points

### Requirement 6: Daily Execution Plan Generation

**User Story:** As a user, I want the agent to create a daily execution plan, so that I have a clear schedule of what to work on and when.

#### Acceptance Criteria

1. WHEN the morning scan completes at 8:00 AM, THE Autonomous_Agent SHALL generate an Execution_Plan for the current workday
2. THE Execution_Plan SHALL include the top 10 highest-priority Action_Items with estimated time durations and suggested time blocks
3. THE Autonomous_Agent SHALL consider the user's calendar blocks when scheduling Action_Items in the Execution_Plan
4. THE Autonomous_Agent SHALL allocate focus hours (as defined in User_Profile) for deep work tasks requiring concentration
5. WHEN generating the Execution_Plan, THE Autonomous_Agent SHALL respect the user's capacity_hours_per_week from the User_Profile
6. THE Execution_Plan SHALL display on the Today_Priority page with options to approve, modify, or defer tasks
7. WHEN a user completes an Action_Item, THE Autonomous_Agent SHALL update the Execution_Plan and suggest the next task

### Requirement 7: Unified Inbox Display

**User Story:** As a user, I want to see all my action items in one place, so that I don't have to check multiple tools.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL display a Unified_Inbox page showing all extracted Action_Items from all Data_Sources
2. THE Unified_Inbox SHALL support filtering by Data_Source type, severity, team, status, and due date
3. THE Unified_Inbox SHALL display each Action_Item with its source badge, Priority_Score, due date, and severity indicator
4. WHEN a user clicks an Action_Item in the Unified_Inbox, THE TaskPilot_System SHALL show the full details including dependencies, execution steps, and source links
5. THE Unified_Inbox SHALL provide a search function that searches across all Action_Item titles and body text
6. THE Unified_Inbox SHALL sort Action_Items by Priority_Score by default, with options to sort by due date or creation time

### Requirement 8: Meeting Memory Extraction

**User Story:** As a user, I want the agent to extract action items from my meeting notes, so that follow-ups don't get lost.

#### Acceptance Criteria

1. WHEN scanning the meeting_notes Data_Source, THE Autonomous_Agent SHALL use Gemini_AI to parse meeting transcripts or notes
2. THE Autonomous_Agent SHALL identify Action_Items explicitly assigned during meetings (e.g., "Utkarsh will review the design")
3. THE Autonomous_Agent SHALL detect implicit Action_Items from meeting discussions (e.g., unresolved questions requiring follow-up)
4. FOR ALL meeting-extracted Action_Items, THE Autonomous_Agent SHALL capture the meeting title, date, attendees, and relevant discussion context
5. THE TaskPilot_System SHALL display a Meeting_Memory page showing all meetings with extracted Action_Items organized chronologically
6. WHEN a user marks a meeting Action_Item as complete, THE TaskPilot_System SHALL update the agent_execution_history table in the Supabase_Database

### Requirement 9: User Profile Management

**User Story:** As a user, I want to manage my profile settings including name and preferences, so that the agent works according to my needs.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a Settings page where users can view and edit their User_Profile
2. THE Settings page SHALL allow users to update full_name, display_name, job_title, location, timezone, phone, skills, and primary_stack
3. THE Settings page SHALL allow users to configure capacity_hours_per_week (numeric value between 1.0 and 80.0)
4. THE Settings page SHALL allow users to set focus_hours with start and end times in 24-hour format
5. THE Settings page SHALL allow users to toggle notification channels (Slack, email, desktop) for agent updates
6. THE Settings page SHALL allow users to configure work_preferences including preferDeepWorkMorning, autoAssignNext, and requireApprovalBeforeExecution
7. WHEN a user saves Settings changes, THE TaskPilot_System SHALL update the engineer_profiles table in the Supabase_Database
8. WHEN a Settings save succeeds, THE TaskPilot_System SHALL display a success confirmation message
9. IF a Settings save fails due to database error, THEN THE TaskPilot_System SHALL display a descriptive error message and preserve the user's unsaved changes

### Requirement 10: Data Source Connection Management

**User Story:** As a user, I want to enable or disable specific data sources, so that I control what the agent monitors.

#### Acceptance Criteria

1. THE Settings page SHALL display a Data Source Connections section listing all available Data_Source types
2. FOR ALL Data_Source types, THE Settings page SHALL show the source name, connection status, and an enable/disable toggle
3. WHEN a user toggles a Data_Source connection, THE TaskPilot_System SHALL update the enabled field in the task_source_connections table
4. WHERE a Data_Source is disabled, THE Autonomous_Agent SHALL exclude it from all scans and not display items from that source in the Unified_Inbox
5. THE Settings page SHALL allow users to view and edit metadata for each Data_Source connection (e.g., account IDs, scopes)
6. WHEN a user enables a previously disabled Data_Source, THE Autonomous_Agent SHALL perform an immediate scan of that source within 60 seconds

### Requirement 11: Analytics and Work Insights

**User Story:** As a user, I want to see analytics about my work patterns, so that I can optimize my productivity.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide an Analytics page displaying work pattern insights generated by the Autonomous_Agent
2. THE Analytics page SHALL show the total number of Action_Items completed per day over the last 30 days as a line chart
3. THE Analytics page SHALL display the distribution of Action_Items by Data_Source type as a pie chart
4. THE Analytics page SHALL show the average Priority_Score of completed tasks versus deferred tasks
5. THE Analytics page SHALL calculate and display the user's average task completion time in minutes
6. THE Analytics page SHALL show the percentage of tasks completed within their original due date
7. WHEN generating analytics, THE Autonomous_Agent SHALL use data from the agent_execution_history table in the Supabase_Database
8. THE Analytics page SHALL provide a time range selector (last 7 days, last 30 days, last 90 days)

### Requirement 12: Overview Dashboard

**User Story:** As a user, I want a dashboard showing a summary of my work, so that I can quickly understand my current status.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide an Overview dashboard page as the default landing page after login
2. THE Overview dashboard SHALL display the total count of pending Action_Items grouped by severity (P1, P2, P3)
3. THE Overview dashboard SHALL show the count of Action_Items due today, this week, and overdue
4. THE Overview dashboard SHALL display the user's progress toward daily capacity_hours_per_week as a progress bar
5. THE Overview dashboard SHALL show the last scan timestamp and status for all enabled Data_Sources
6. THE Overview dashboard SHALL display the top 5 highest-priority Action_Items with quick action buttons (view details, mark complete, defer)
7. THE Overview dashboard SHALL show recent agent activity including scans performed, Action_Items extracted, and tasks prioritized
8. WHEN a Data_Source scan is currently in progress, THE Overview dashboard SHALL display a loading indicator for that source

### Requirement 13: Autonomous Scan Status Display

**User Story:** As a user, I want to see the status of background scans, so that I know when the agent has fresh data.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide an Autonomous_Scan page showing real-time status of all Data_Source scans
2. THE Autonomous_Scan page SHALL display each Data_Source with its last scan timestamp, next scheduled scan time, and current status
3. THE Autonomous_Scan page SHALL show the number of Action_Items extracted from each Data_Source in the most recent scan
4. THE Autonomous_Scan page SHALL provide a "Scan Now" button for each Data_Source to trigger an immediate on-demand scan
5. WHEN a scan is in progress, THE Autonomous_Scan page SHALL display a progress indicator and scanning status message
6. WHEN a scan completes successfully, THE Autonomous_Scan page SHALL update the status to "Success" and show the item count
7. IF a scan fails, THEN THE Autonomous_Scan page SHALL display the error message and a "Retry" button
8. THE Autonomous_Scan page SHALL show a global "Scan All Sources" button that triggers scans for all enabled Data_Sources

### Requirement 14: Jira Board Integration

**User Story:** As a user, I want to view my Jira sprint tasks within TaskPilot, so that I have a unified view of my sprint work.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a Jira_Board page displaying Action_Items from the jira_sprint_board Data_Source
2. THE Jira_Board page SHALL group Action_Items by status (Todo, In Progress, Done)
3. THE Jira_Board page SHALL display each Jira Action_Item with its ticket ID, title, severity, due date, dependencies, and Priority_Score
4. THE Jira_Board page SHALL support drag-and-drop to move Action_Items between status columns
5. WHEN a user moves a Jira Action_Item to "Done", THE TaskPilot_System SHALL update the agent_execution_history table with completed status
6. THE Jira_Board page SHALL provide a filter to show only current sprint items or all items
7. WHEN a user clicks a Jira ticket ID, THE TaskPilot_System SHALL open the original Jira ticket in a new browser tab

### Requirement 15: ServiceNow Incidents Tracking

**User Story:** As a user, I want to view and track ServiceNow defects within TaskPilot, so that I can manage incidents alongside other work.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide an Incidents page displaying Action_Items from the servicenow_defects Data_Source
2. THE Incidents page SHALL display each incident with its incident ID, title, severity, SLA deadline, impact score, and Priority_Score
3. THE Incidents page SHALL sort incidents by Priority_Score by default
4. THE Incidents page SHALL provide filters for incident severity (P1, P2, P3) and status (New, In Progress, Resolved)
5. WHEN an incident has an SLA expiration within 4 hours, THE Incidents page SHALL display a red urgent indicator
6. THE Incidents page SHALL show estimated resolution time from the execution.estimatedMinutes field
7. WHEN a user marks an incident as resolved, THE TaskPilot_System SHALL update the agent_execution_history table and exclude it from future scans

### Requirement 16: GitHub Review Tracking

**User Story:** As a user, I want to see pull requests needing my review, so that I don't block my teammates.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a GitHub_Reviews page displaying Action_Items from the github_work Data_Source
2. THE GitHub_Reviews page SHALL filter for Action_Items that are pull request review requests assigned to the user
3. THE GitHub_Reviews page SHALL display each PR with its PR number, title, author, age in days, and Priority_Score
4. THE GitHub_Reviews page SHALL show a "Blocks" indicator WHEN other team members are waiting on the review
5. THE GitHub_Reviews page SHALL sort PRs by Priority_Score, with blocking PRs ranked higher
6. WHEN a user clicks a PR title, THE TaskPilot_System SHALL open the GitHub PR page in a new browser tab
7. THE GitHub_Reviews page SHALL provide a "Mark Reviewed" button that updates the agent_execution_history table

### Requirement 17: Gemini AI Integration

**User Story:** As a system administrator, I want the agent to use Gemini AI for intelligent analysis, so that task prioritization and extraction are accurate.

#### Acceptance Criteria

1. THE Autonomous_Agent SHALL authenticate with Gemini_AI using the GEMINI_API_KEY from the backend environment configuration
2. WHEN calling Gemini_AI for task prioritization, THE Autonomous_Agent SHALL use the gemini-1.5-flash model
3. WHEN calling Gemini_AI for action item extraction, THE Autonomous_Agent SHALL provide relevant context including source type and user profile
4. THE Autonomous_Agent SHALL set responseMimeType to "application/json" WHEN requesting structured prioritization data
5. IF Gemini_AI returns an error response, THEN THE Autonomous_Agent SHALL log the error, use a fallback prioritization algorithm based on due date and severity, and display a warning to the user
6. THE Autonomous_Agent SHALL limit Gemini_AI requests to a maximum of 150 output tokens for efficiency
7. WHEN the GEMINI_API_KEY is not configured, THE TaskPilot_System SHALL display a configuration warning and disable AI-powered features

### Requirement 18: Secure Environment Configuration

**User Story:** As a system administrator, I want sensitive configuration stored securely, so that API keys and database credentials are protected.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL read all sensitive configuration values from the backend .env file
2. THE backend SHALL NOT expose the GEMINI_API_KEY, SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY in API responses
3. THE TaskPilot_System SHALL validate that required environment variables (SUPABASE_URL, GEMINI_API_KEY) are present at startup
4. IF required environment variables are missing, THEN THE backend SHALL log a descriptive error message and refuse to start
5. THE TaskPilot_System SHALL use the SUPABASE_ANON_KEY for frontend Supabase client initialization
6. THE backend SHALL use the SUPABASE_SERVICE_KEY for server-side database operations that bypass Row Level Security

### Requirement 19: Agent Execution History Tracking

**User Story:** As a user, I want the system to track what the agent has worked on, so that I have a record of autonomous actions taken.

#### Acceptance Criteria

1. WHEN the Autonomous_Agent assigns an Action_Item to the Execution_Plan, THE TaskPilot_System SHALL insert a record into the agent_execution_history table
2. THE agent_execution_history record SHALL include task_key, task_title, priority_score, priority_reason, definition_of_done, execution_steps, status, and assigned_at timestamp
3. WHEN a user marks an Action_Item as complete, THE TaskPilot_System SHALL update the corresponding agent_execution_history record with completed status and completed_at timestamp
4. WHEN the user defers an Action_Item, THE TaskPilot_System SHALL update the agent_execution_history status to "deferred"
5. THE TaskPilot_System SHALL provide a history view showing all agent_execution_history records for the logged-in user
6. THE agent_execution_history view SHALL support filtering by status and date range

### Requirement 20: Notification System

**User Story:** As a user, I want to receive notifications about urgent tasks, so that I don't miss critical work.

#### Acceptance Criteria

1. WHEN the Autonomous_Agent detects a new P1 Action_Item with a due date within 24 hours, THE TaskPilot_System SHALL send a notification to the user
2. THE TaskPilot_System SHALL respect the user's notification_channels preferences from the User_Profile (slack, email, desktop)
3. WHERE the desktop notification channel is enabled, THE TaskPilot_System SHALL display a browser notification with the Action_Item title and priority
4. THE TaskPilot_System SHALL provide a Notifications page showing a chronological list of all notifications sent to the user
5. THE Notifications page SHALL display each notification with timestamp, Action_Item reference, and notification reason
6. WHEN a user clicks a notification, THE TaskPilot_System SHALL navigate to the relevant Action_Item detail view
7. THE Notifications page SHALL provide a "Mark All Read" button that clears unread indicators

### Requirement 21: Frontend-Backend API Communication

**User Story:** As a developer, I want a well-defined API between frontend and backend, so that the system components integrate correctly.

#### Acceptance Criteria

1. THE backend SHALL provide a GET /api/taskpilot/data endpoint that returns all loaded Data_Source items, calendar blocks, and demo profiles
2. THE backend SHALL provide a GET /api/taskpilot/config endpoint that returns system configuration status (gemini configured, supabase configured, TEE mode)
3. THE backend SHALL provide a POST /api/taskpilot/prioritize endpoint that accepts a JSON array of tasks and returns prioritized tasks with scores and reasons
4. THE backend SHALL provide a POST /api/taskpilot/vision-summary endpoint that accepts screen context and returns an AI-generated summary
5. THE backend SHALL provide a POST /api/taskpilot/daily-report endpoint that generates an end-of-day summary report
6. THE backend SHALL set CORS headers allowing requests from the frontend origin
7. FOR ALL API endpoints, THE backend SHALL return responses in JSON format with appropriate content-type headers
8. IF an API request fails, THEN THE backend SHALL return an HTTP error status code (4xx or 5xx) with a descriptive error message in JSON format

### Requirement 22: Dependency Visualization

**User Story:** As a user, I want to see task dependencies visually, so that I understand what blocks what.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a Dependency_Map page that visualizes Action_Item dependencies as a directed graph
2. THE Dependency_Map SHALL display each Action_Item as a node with its title and Priority_Score
3. THE Dependency_Map SHALL draw edges between nodes WHEN one Action_Item depends on another
4. THE Dependency_Map SHALL highlight Action_Items that are currently blocking other tasks in red
5. THE Dependency_Map SHALL allow users to click a node to view full Action_Item details
6. THE Dependency_Map SHALL use the dependencies field from each Action_Item to construct the graph
7. WHEN circular dependencies are detected, THE Dependency_Map SHALL display a warning indicator

### Requirement 23: Weekly Planning

**User Story:** As a user, I want to see a weekly plan of my work, so that I can plan ahead beyond just today.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a Weekly_Plan page showing Action_Items organized by day of the week
2. THE Weekly_Plan SHALL distribute Action_Items across workdays based on due dates and Priority_Score
3. THE Weekly_Plan SHALL respect the user's capacity_hours_per_week by not over-scheduling any single day
4. FOR ALL days in the Weekly_Plan, THE TaskPilot_System SHALL show total estimated hours and capacity utilization percentage
5. THE Weekly_Plan SHALL allow users to drag and drop Action_Items between days to reschedule
6. WHEN a user reschedules an Action_Item, THE TaskPilot_System SHALL recalculate daily capacity utilization
7. THE Weekly_Plan SHALL highlight overbooked days (capacity > 100%) in red

### Requirement 24: Authentication and Authorization

**User Story:** As a user, I want to log in securely with Google, so that my TaskPilot data is protected.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a Login page with a "Sign in with Google" button
2. WHEN a user clicks "Sign in with Google", THE TaskPilot_System SHALL redirect to Supabase Google OAuth flow
3. WHEN Google authentication succeeds, THE Supabase_Database SHALL automatically create an engineer_profiles record using the handle_new_auth_user trigger
4. WHEN authentication is successful, THE TaskPilot_System SHALL store the Supabase session token and set isAuthenticated to true
5. WHEN a user is not authenticated, THE TaskPilot_System SHALL redirect them to the Login page
6. THE TaskPilot_System SHALL use Supabase Row Level Security policies to ensure users can only access their own data
7. WHEN a user logs out, THE TaskPilot_System SHALL clear the Supabase session and set isAuthenticated to false

### Requirement 25: Task Completion Workflow

**User Story:** As a user, I want to mark tasks complete and have the agent recognize my progress, so that my work status stays current.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL provide a "Mark Complete" button on all Action_Item detail views
2. WHEN a user marks an Action_Item complete, THE TaskPilot_System SHALL update the agent_execution_history status to "completed" and set completed_at timestamp
3. WHEN an Action_Item is marked complete, THE Autonomous_Agent SHALL remove it from the Today_Priority view and Execution_Plan
4. WHEN an Action_Item is marked complete, THE Autonomous_Agent SHALL recalculate Priority_Scores for remaining tasks that depended on the completed task
5. THE TaskPilot_System SHALL display a success confirmation message WHEN a task is marked complete
6. THE Overview dashboard SHALL increment the "Tasks Completed Today" counter WHEN a task is marked complete

### Requirement 26: Parser and Pretty Printer for Configuration

**User Story:** As a developer, I want to parse and format agent configuration files, so that configuration is reliable and human-readable.

#### Acceptance Criteria

1. THE TaskPilot_System SHALL parse the backend .env configuration file into a structured configuration object
2. WHEN the .env file is invalid or malformed, THE Parser SHALL return a descriptive error indicating the line number and nature of the problem
3. THE TaskPilot_System SHALL provide a Pretty_Printer that formats configuration objects back into valid .env file format
4. THE Pretty_Printer SHALL preserve comments and blank lines from the original .env file
5. FOR ALL valid configuration objects, parsing the object then pretty-printing then parsing again SHALL produce an equivalent configuration object (round-trip property)
6. THE Parser SHALL validate that required configuration keys (SUPABASE_URL, GEMINI_API_KEY) are present
7. THE Parser SHALL validate that TASKPILOT_PORT is a valid integer between 1 and 65535

### Requirement 27: Real-Time Updates

**User Story:** As a user, I want the UI to update automatically when the agent finds new work, so that I always see current information.

#### Acceptance Criteria

1. WHEN the Autonomous_Agent completes a scan and finds new Action_Items, THE TaskPilot_System SHALL update all open UI views within 5 seconds
2. THE TaskPilot_System SHALL use Supabase real-time subscriptions to detect changes to the agent_execution_history table
3. WHEN the agent_execution_history table is updated, THE Overview dashboard SHALL refresh its statistics automatically
4. WHEN new Action_Items are added, THE Unified_Inbox SHALL display them without requiring a manual page refresh
5. THE TaskPilot_System SHALL display a toast notification WHEN new high-priority (P1) Action_Items are detected
6. WHILE a scan is in progress, THE Autonomous_Scan page SHALL update the progress indicators in real-time

