"""
Dataset Cleaning Script for TaskPilot AI
Cleans and validates all data sources according to problem statement requirements
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Any

class DatasetCleaner:
    """Cleans and normalizes task data from multiple sources"""
    
    def __init__(self, dataset_dir='./datasets'):
        self.dataset_dir = dataset_dir
        self.cleaned_data = {}
        
    def clean_jira_sprint_board(self, filepath: str) -> List[Dict[str, Any]]:
        """Clean and normalize Jira sprint board data"""
        print("🧹 Cleaning Jira Sprint Board...")
        
        with open(filepath, 'r') as f:
            raw_data = json.load(f)
        
        # Handle nested structure
        items = raw_data.get('items', []) if isinstance(raw_data, dict) else raw_data
        
        cleaned_tasks = []
        for item in items:
            task = {
                'id': f"JIRA-{item.get('id', '')}",
                'title': item.get('title', '').strip(),
                'description': item.get('body', '').strip(),
                'source': 'jira',
                'status': item.get('status', 'unknown').lower(),
                'priority': self._normalize_priority(item.get('severity', 'medium')),
                'severity': self._calculate_severity(item.get('severity', 'medium')),
                'assignee': item.get('owner', '').strip(),
                'deadline': self._normalize_date(item.get('due')),
                'created_at': datetime.now().isoformat(),
                'labels': [],
                'dependencies': item.get('dependencies', []),
                'story_points': 0,
                'impact': item.get('impact', 5),
                'team': item.get('team', ''),
                'execution': item.get('execution', {}),
                'raw_data': item
            }
            
            # Validate required fields
            if task['title'] and task['id']:
                cleaned_tasks.append(task)
        
        print(f"✅ Cleaned {len(cleaned_tasks)} Jira tasks")
        return cleaned_tasks
    
    def clean_servicenow_defects(self, filepath: str) -> List[Dict[str, Any]]:
        """Clean and normalize ServiceNow defect data"""
        print("🧹 Cleaning ServiceNow Defects...")
        
        with open(filepath, 'r') as f:
            raw_data = json.load(f)
        
        # Handle nested structure
        items = raw_data.get('items', []) if isinstance(raw_data, dict) else raw_data
        
        cleaned_tasks = []
        for item in items:
            task = {
                'id': f"DEFECT-{item.get('id', '')}",
                'title': item.get('title', '').strip(),
                'description': item.get('body', '').strip(),
                'source': 'servicenow',
                'status': item.get('status', 'open').lower(),
                'priority': self._normalize_priority(item.get('severity', 'medium')),
                'severity': self._calculate_severity(item.get('severity', 'medium')),
                'assignee': item.get('owner', '').strip(),
                'deadline': self._normalize_date(item.get('due')) or self._calculate_sla_deadline(item.get('severity', 'medium')),
                'created_at': datetime.now().isoformat(),
                'category': '',
                'impact': item.get('impact', 5),
                'sla_remaining': None,
                'team': item.get('team', ''),
                'raw_data': item
            }
            
            if task['title'] and task['id']:
                cleaned_tasks.append(task)
        
        print(f"✅ Cleaned {len(cleaned_tasks)} ServiceNow defects")
        return cleaned_tasks
    
    def clean_outlook_emails(self, filepath: str) -> List[Dict[str, Any]]:
        """Extract action items from email data"""
        print("🧹 Cleaning Outlook Emails and extracting action items...")
        
        with open(filepath, 'r') as f:
            raw_data = json.load(f)
        
        # Handle nested structure
        items = raw_data.get('items', []) if isinstance(raw_data, dict) else raw_data
        
        cleaned_tasks = []
        for idx, email in enumerate(items):
            # Check if email contains action items
            if self._contains_action_item({'subject': email.get('title', ''), 'body': email.get('body', '')}):
                task = {
                    'id': f"EMAIL-{idx+1}",
                    'title': email.get('title', '').strip() or self._extract_action_title({'subject': email.get('title', ''), 'body': email.get('body', '')}),
                    'description': email.get('body', '').strip()[:500],  # First 500 chars
                    'source': 'email',
                    'status': 'pending',
                    'priority': self._infer_priority_from_email({'subject': email.get('title', ''), 'body': email.get('body', '')}),
                    'severity': self._infer_severity_from_email({'subject': email.get('title', ''), 'body': email.get('body', '')}),
                    'assignee': email.get('owner', '') or '',
                    'deadline': self._extract_deadline_from_text(email.get('body', '')),
                    'created_at': datetime.now().isoformat(),
                    'sender': email.get('from', ''),
                    'subject': email.get('title', ''),
                    'impact': email.get('impact', 5),
                    'raw_data': email
                }
                
                if task['title']:
                    cleaned_tasks.append(task)
        
        print(f"✅ Extracted {len(cleaned_tasks)} action items from emails")
        return cleaned_tasks
    
    def clean_slack_mentions(self, filepath: str) -> List[Dict[str, Any]]:
        """Extract action items from Slack mentions"""
        print("🧹 Cleaning Slack Mentions...")
        
        with open(filepath, 'r') as f:
            raw_data = json.load(f)
        
        # Handle nested structure
        items = raw_data.get('items', []) if isinstance(raw_data, dict) else raw_data
        
        cleaned_tasks = []
        for idx, message in enumerate(items):
            text = message.get('body', '') or message.get('title', '')
            if self._contains_action_item({'body': text}):
                task = {
                    'id': f"SLACK-{idx+1}",
                    'title': message.get('title', '').strip() or text.strip()[:100],
                    'description': text.strip(),
                    'source': 'slack',
                    'status': 'pending',
                    'priority': 'medium',
                    'severity': 3,
                    'assignee': message.get('owner', ''),
                    'deadline': None,
                    'created_at': datetime.now().isoformat(),
                    'channel': message.get('from', ''),
                    'impact': message.get('impact', 5),
                    'raw_data': message
                }
                
                if task['title']:
                    cleaned_tasks.append(task)
        
        print(f"✅ Extracted {len(cleaned_tasks)} action items from Slack")
        return cleaned_tasks
    
    def clean_meeting_notes(self, filepath: str) -> List[Dict[str, Any]]:
        """Extract action items from meeting notes"""
        print("🧹 Cleaning Meeting Notes...")
        
        with open(filepath, 'r') as f:
            raw_data = json.load(f)
        
        # Handle nested structure
        items = raw_data.get('items', []) if isinstance(raw_data, dict) else raw_data
        
        cleaned_tasks = []
        for idx, meeting in enumerate(items):
            # Extract action items from meeting
            notes = meeting.get('body', '') or meeting.get('title', '')
            action_items = self._extract_meeting_action_items(notes)
            
            for action_idx, action in enumerate(action_items):
                task = {
                    'id': f"MEETING-{idx+1}-{action_idx+1}",
                    'title': action.get('title', '').strip(),
                    'description': action.get('description', '').strip(),
                    'source': 'meeting',
                    'status': 'pending',
                    'priority': 'medium',
                    'severity': 3,
                    'assignee': action.get('assignee', '') or meeting.get('owner', ''),
                    'deadline': action.get('deadline'),
                    'created_at': datetime.now().isoformat(),
                    'meeting_title': meeting.get('title', ''),
                    'impact': meeting.get('impact', 5),
                    'raw_data': meeting
                }
                
                if task['title']:
                    cleaned_tasks.append(task)
        
        print(f"✅ Extracted {len(cleaned_tasks)} action items from meetings")
        return cleaned_tasks
    
    def clean_github_work(self, filepath: str) -> List[Dict[str, Any]]:
        """Clean GitHub PR and issue data"""
        print("🧹 Cleaning GitHub Work...")
        
        with open(filepath, 'r') as f:
            raw_data = json.load(f)
        
        # Handle nested structure
        items = raw_data.get('items', []) if isinstance(raw_data, dict) else raw_data
        
        cleaned_tasks = []
        for item in items:
            task = {
                'id': f"GITHUB-{item.get('id', '')}",
                'title': item.get('title', '').strip(),
                'description': item.get('body', '').strip(),
                'source': 'github',
                'status': item.get('status', 'open').lower(),
                'priority': self._normalize_priority(item.get('severity', 'medium')),
                'severity': self._calculate_severity(item.get('severity', 'medium')),
                'assignee': item.get('owner', '').strip(),
                'deadline': self._normalize_date(item.get('due')),
                'created_at': datetime.now().isoformat(),
                'labels': [],
                'pr_or_issue': 'issue',
                'team': item.get('team', ''),
                'impact': item.get('impact', 5),
                'raw_data': item
            }
            
            if task['title'] and task['id']:
                cleaned_tasks.append(task)
        
        print(f"✅ Cleaned {len(cleaned_tasks)} GitHub items")
        return cleaned_tasks
    
    # Helper methods
    
    def _normalize_priority(self, priority: str) -> str:
        """Normalize priority to standard values"""
        priority = str(priority).lower()
        if priority in ['p0', 'critical', 'highest', '1']:
            return 'critical'
        elif priority in ['p1', 'high', '2']:
            return 'high'
        elif priority in ['p2', 'medium', 'normal', '3']:
            return 'medium'
        elif priority in ['p3', 'low', 'lowest', '4']:
            return 'low'
        return 'medium'
    
    def _calculate_severity(self, priority: str, severity: str = None) -> int:
        """Calculate numeric severity (1-5, 5 being most severe)"""
        priority = self._normalize_priority(priority)
        severity_map = {
            'critical': 5,
            'high': 4,
            'medium': 3,
            'low': 2
        }
        return severity_map.get(priority, 3)
    
    def _normalize_date(self, date_str: Any) -> str:
        """Normalize date to ISO format"""
        if not date_str:
            return None
        
        try:
            if isinstance(date_str, (int, float)):
                # Unix timestamp
                dt = datetime.fromtimestamp(date_str)
            else:
                # Try parsing string
                dt = datetime.fromisoformat(str(date_str).replace('Z', '+00:00'))
            return dt.isoformat()
        except:
            return None
    
    def _calculate_sla_deadline(self, priority: str) -> str:
        """Calculate SLA deadline based on priority"""
        from datetime import timedelta
        
        priority = self._normalize_priority(priority)
        hours_map = {
            'critical': 4,
            'high': 24,
            'medium': 72,
            'low': 168
        }
        
        hours = hours_map.get(priority, 72)
        deadline = datetime.now() + timedelta(hours=hours)
        return deadline.isoformat()
    
    def _contains_action_item(self, email: Dict) -> bool:
        """Check if email/message contains action items"""
        action_keywords = [
            'please', 'can you', 'could you', 'need you to', 'action required',
            'todo', 'to-do', 'task', 'deadline', 'urgent', 'asap', 'follow up',
            'complete', 'finish', 'deliver', 'submit', 'review', 'approve'
        ]
        
        text = (email.get('subject', '') + ' ' + email.get('body', '')).lower()
        return any(keyword in text for keyword in action_keywords)
    
    def _extract_action_title(self, email: Dict) -> str:
        """Extract action item title from email"""
        subject = email.get('subject', '')
        body = email.get('body', '')
        
        # Use subject if it exists
        if subject and len(subject.strip()) > 10:
            return subject.strip()[:100]
        
        # Extract first sentence from body
        sentences = body.split('.')
        if sentences:
            return sentences[0].strip()[:100]
        
        return 'Action Item from Email'
    
    def _infer_priority_from_email(self, email: Dict) -> str:
        """Infer priority from email content"""
        text = (email.get('subject', '') + ' ' + email.get('body', '')).lower()
        
        if any(word in text for word in ['urgent', 'critical', 'asap', 'immediately']):
            return 'high'
        elif any(word in text for word in ['important', 'priority']):
            return 'medium'
        return 'medium'
    
    def _infer_severity_from_email(self, email: Dict) -> int:
        """Infer severity from email content"""
        priority = self._infer_priority_from_email(email)
        return self._calculate_severity(priority)
    
    def _extract_deadline_from_text(self, text: str) -> str:
        """Extract deadline from text (basic implementation)"""
        # This is a simplified version - in production, use NLP
        deadline_keywords = ['by', 'before', 'deadline', 'due']
        # For now, return None - will be enhanced by LLM
        return None
    
    def _extract_meeting_action_items(self, notes: str) -> List[Dict]:
        """Extract action items from meeting notes"""
        # Basic extraction - looks for common patterns
        action_items = []
        
        lines = notes.split('\n')
        for line in lines:
            line = line.strip()
            if any(marker in line.lower() for marker in ['action:', '- [ ]', 'todo:', 'task:']):
                action_items.append({
                    'title': line,
                    'description': line,
                    'assignee': '',
                    'deadline': None
                })
        
        return action_items
    
    def run_cleaning(self) -> Dict[str, List[Dict]]:
        """Run cleaning on all datasets"""
        print("\n" + "="*60)
        print("🚀 TaskPilot AI Dataset Cleaning")
        print("="*60 + "\n")
        
        results = {}
        
        # Clean each dataset
        dataset_files = {
            'jira': 'jira_sprint_board.json',
            'defects': 'servicenow_defects.json',
            'emails': 'outlook_emails.json',
            'slack': 'slack_mentions.json',
            'meetings': 'meeting_notes.json',
            'github': 'github_work.json'
        }
        
        for source, filename in dataset_files.items():
            filepath = os.path.join(self.dataset_dir, filename)
            
            if not os.path.exists(filepath):
                print(f"⚠️  {filename} not found, skipping...")
                continue
            
            try:
                if source == 'jira':
                    results[source] = self.clean_jira_sprint_board(filepath)
                elif source == 'defects':
                    results[source] = self.clean_servicenow_defects(filepath)
                elif source == 'emails':
                    results[source] = self.clean_outlook_emails(filepath)
                elif source == 'slack':
                    results[source] = self.clean_slack_mentions(filepath)
                elif source == 'meetings':
                    results[source] = self.clean_meeting_notes(filepath)
                elif source == 'github':
                    results[source] = self.clean_github_work(filepath)
            except Exception as e:
                print(f"❌ Error cleaning {source}: {e}")
                results[source] = []
        
        # Save cleaned data
        output_file = os.path.join(self.dataset_dir, 'cleaned_tasks.json')
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        print("\n" + "="*60)
        print("✅ Dataset Cleaning Complete!")
        print(f"📊 Total tasks across all sources:")
        for source, tasks in results.items():
            print(f"   - {source}: {len(tasks)} tasks")
        print(f"\n💾 Cleaned data saved to: {output_file}")
        print("="*60 + "\n")
        
        return results


if __name__ == '__main__':
    cleaner = DatasetCleaner()
    cleaner.run_cleaning()
