# Calendar Testing Guide 🗓️

## Quick Test Checklist

### ✅ Day View Testing
1. Navigate to **Engineer Dashboard** → **My Calendar** → **Day** tab
2. Check these items:

| Test | Expected Result | Status |
|------|----------------|--------|
| No "AMBIENT REST" text | Should only see: Morning Tea, Lunch Break, Afternoon Tea, and actual tasks | [ ] |
| Tasks in columns | Overlapping time slots show tasks side-by-side, not on top | [ ] |
| Hover popups | Hovering shows task details with platform link | [ ] |
| Click "Open in..." | Opens correct platform (GitHub/Jira/Slack/etc) | [ ] |
| Colors correct | P1=Red, P2=Orange, P3=Purple | [ ] |
| Prev/Next buttons | Moves 1 day forward/backward | [ ] |

### ✅ Week View Testing  
1. Navigate to **Engineer Dashboard** → **My Calendar** → **Week** tab
2. Check these items:

| Test | Expected Result | Status |
|------|----------------|--------|
| 7 columns visible | SUN, MON, TUE, WED, THU, FRI, SAT | [ ] |
| Today highlighted | Today's column has blue background, date in blue circle | [ ] |
| No overlaps per day | Each day's tasks in separate columns if they overlap | [ ] |
| Hover popups work | All tasks show popup on hover | [ ] |
| Compact layout | Tasks show title (and time if tall enough) | [ ] |
| Prev/Next buttons | Moves 7 days forward/backward (1 week) | [ ] |

---

## What You Should See

### Day View Layout
```
┌─────────────────────────────────────────┐
│ GMT-5    SUN  19                        │
├─────────┬───────────────────────────────┤
│ 7 AM    │                               │
│ 8 AM    │                               │
│ 9 AM    │ ┌──────────────┐              │
│         │ │ Task 1 (P1)  │              │
│ 10 AM   │ └──────────────┘              │
│         │ ┌──────┐ ┌──────┐             │
│ 11 AM   │ │ Tea  │ │Task 2│             │ ← Side by side
│         │ └──────┘ └──────┘             │
│ 12 PM   │                               │
│ 1 PM    │ ┌──────────────┐              │
│         │ │ Lunch Break  │              │
│ 2 PM    │ └──────────────┘              │
│ 3 PM    │ ┌──────────────┐              │
│         │ │ Task 3 (P2)  │              │
│ 4 PM    │ └──────────────┘              │
│         │ ┌──────┐                      │
│ 5 PM    │ │ Tea  │                      │
└─────────┴───────────────────────────────┘
```

### Week View Layout
```
┌────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│GMT │ SUN │ MON │ TUE │ WED │ THU │ FRI │ SAT │
│ -5 │  19 │  20 │  21 │  22 │  23 │  24 │  25 │
├────┼─────┴─────┴─────┴─────┴─────┴─────┴─────┤
│7AM │                                          │
│8AM │  Task Task Task  Task  Task Task  Task  │
│9AM │   │    │    │     │     │    │     │   │
│10  │  Task Task Task  Task  Task Task  Task  │
│11  │   │    │    │     │     │    │     │   │
│12  │  ━━━━━━ Lunch Breaks ━━━━━━━━━━━━━━━━  │
│1PM │                                          │
│2PM │  Task Task Task  Task  Task Task  Task  │
│3PM │   │    │    │     │     │    │     │   │
│4PM │  Task Task Task  Task  Task Task  Task  │
│5PM │  Tea  Tea  Tea   Tea   Tea  Tea   Tea   │
└────┴──────────────────────────────────────────┘
       ▲
    Today column highlighted in blue
```

---

## What You Should NOT See

### ❌ Problems That Are Fixed

1. **No More "AMBIENT REST" Overlays**
```
BEFORE (BAD):
┌──────────────┐
│ Task Name    │
│ AMBIENT REST │ ← This text showing on top
│ 9:00 AM      │
└──────────────┘

AFTER (GOOD):
┌──────────────┐
│ Task Name    │
│ 9:00 AM      │
└──────────────┘
```

2. **No More Overlapping Events**
```
BEFORE (BAD):
┌──────────────┐
│ Task 1       │
│ Task 2       │ ← Both on top of each other
│ 9:00 AM      │
└──────────────┘

AFTER (GOOD):
┌──────┐ ┌──────┐
│Task 1│ │Task 2│ ← Side by side in columns
└──────┘ └──────┘
```

3. **Week View Now Works**
```
BEFORE (BAD):
Week tab clicked → Nothing shows

AFTER (GOOD):
Week tab clicked → 7-column grid with all tasks
```

---

## Hover Popup Content

When you hover over any task, you should see:

```
┌─────────────────────────────────────┐
│ Fix CSV upload timeout              │ ← Task title
│ ─────────────────────────────────── │
│ [P1] · Due: 2026-06-20             │ ← Priority + Due date
│                                     │
│ P1 customer escalation. Imports    │ ← Description
│ above 20MB time out after proxy... │   (scrollable)
│                                     │
│ ┌─────────────────────────────┐   │
│ │ 🔗 Open in Jira             │   │ ← Platform button
│ └─────────────────────────────┘   │
│                                     │
│ [Jira] [Platform Apps]             │ ← Source tags
└─────────────────────────────────────┘
```

---

## Common Issues & Solutions

### Issue: Week view shows blank
**Solution**: Hard refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### Issue: "AMBIENT REST" still showing
**Solution**: Clear browser cache and reload

### Issue: Tasks still overlapping
**Solution**: 
1. Check browser console for JavaScript errors
2. Verify you're on the latest code
3. Hard refresh (Cmd+Shift+R)

### Issue: Hover popups not appearing
**Solution**:
1. Make sure you're hovering directly on the colored task block
2. Check if popup is appearing below viewport (scroll up)
3. Try different tasks

### Issue: "Open in [Platform]" not working
**Solution**:
1. Check if task has `sources` field with platform name
2. Verify popup blocker is not blocking new tabs
3. Links should open in new tab

---

## Navigation Testing

### Day View Navigation
- **Today Button**: Should jump to current date
- **Prev Arrow**: Should go back 1 day
- **Next Arrow**: Should go forward 1 day
- **Date Header**: Should show "SUN 19" format

### Week View Navigation  
- **Today Button**: Should show current week
- **Prev Arrow**: Should go back 7 days
- **Next Arrow**: Should go forward 7 days
- **Date Header**: Should show week range

---

## Performance Checks

The calendar should:
- ✅ Load in under 500ms
- ✅ Scroll smoothly (no lag)
- ✅ Hover animations smooth (no jank)
- ✅ Tab switching instant (day ↔ week)
- ✅ Navigation responsive (prev/next)

---

## Browser Compatibility

Tested on:
- ✅ Chrome/Edge (Chromium)
- ✅ Firefox
- ✅ Safari

Should work on any modern browser with:
- CSS Grid support
- Flexbox support
- ES6 JavaScript

---

## Mobile Responsiveness

**Note**: Calendar is optimized for desktop/laptop screens (1024px+)

On smaller screens:
- Week view may require horizontal scrolling
- Day view should work fine
- Hover popups become tap-to-show

---

## Accessibility

Current implementation:
- ✅ Keyboard navigation for tabs
- ✅ High contrast colors for visibility
- ✅ Clear visual hierarchy
- ⚠️ Screen reader support: partial (could be improved)

---

## Data Validation

Check that tasks show correct:
- ✅ Task titles from backend
- ✅ Priority levels (P1/P2/P3)
- ✅ Due dates formatted correctly
- ✅ Source platforms detected
- ✅ Task descriptions (if available)
- ✅ Time slots calculated correctly

---

## Final Verification Commands

### Check if servers are running:
```bash
# Backend
lsof -ti:8787

# Frontend  
lsof -ti:5174
```

### View recent changes:
```bash
# Check main.js changes
git diff frontend/taskpilotai/src/main.js | head -50

# Check styles.css changes
git diff frontend/taskpilotai/src/styles.css | head -50
```

---

## Success Criteria ✅

Your calendar is working correctly if ALL these are true:

1. ✅ Day view shows tasks in separate columns when they overlap
2. ✅ No "AMBIENT REST" text visible on task blocks
3. ✅ Week view shows 7-day grid with all tasks
4. ✅ Hover popups appear with full task details
5. ✅ "Open in [Platform]" buttons work
6. ✅ Colors match priority (Red=P1, Orange=P2, Purple=P3)
7. ✅ Navigation buttons move by correct intervals
8. ✅ Today is highlighted in week view
9. ✅ Breaks show (Morning Tea, Lunch, Afternoon Tea)
10. ✅ Layout looks clean and professional

---

*Testing Guide Version 1.0*
*For TaskPilot AI Calendar - Day & Week Views*
