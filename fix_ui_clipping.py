with open('frontend/taskpilotai/src/main.js', 'r') as f:
    text = f.read()

# 1. Fix Right Panel (Post Job Update) container style: remove max-height and internal overflow clipping
old_right_panel = '<div style="background:#ffffff; border:1px solid #e2e8f0; border-left:3px solid #6366f1; border-radius:16px; padding:20px; box-shadow:0 2px 8px rgba(0,0,0,0.02); align-self:start; max-height:calc(100vh - 120px); overflow-y:auto;">'
new_right_panel = '<div style="background:#ffffff; border:1px solid #e2e8f0; border-left:3px solid #6366f1; border-radius:16px; padding:20px; box-shadow:0 2px 8px rgba(0,0,0,0.02); align-self:start; height:fit-content;">'
text = text.replace(old_right_panel, new_right_panel)

# 2. Fix Left Panel (Team Execution Queue) lane containers: remove max-height clipping on lane task lists
old_lane_container = 'display:flex; flex-direction:column; gap:10px; min-width:0; max-height:480px; overflow-y:auto; padding-right:2px;'
new_lane_container = 'display:flex; flex-direction:column; gap:12px; min-width:0;'
text = text.replace(old_lane_container, new_lane_container)

# 3. Ensure card titles have min-height and line-clamp / clean wrapping so cards are not clipped abruptly
old_title_style = 'font-size:13px; font-weight:600; color:#1e293b; line-height:1.4; margin-bottom:12px;'
new_title_style = 'font-size:13px; font-weight:600; color:#1e293b; line-height:1.4; margin-bottom:10px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; min-height:36px;'
text = text.replace(old_title_style, new_title_style)

with open('frontend/taskpilotai/src/main.js', 'w') as f:
    f.write(text)

print("Successfully fixed UI clipping on right panel and left kanban lane cards in main.js!")