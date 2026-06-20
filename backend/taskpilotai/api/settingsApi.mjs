/**
 * Settings API - Manages user profiles and preferences
 */

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
      transport: ws
    }
  });
}

export class SettingsAPI {
  /**
   * Get user profile by email or auth ID
   */
  static async getUserProfile(identifier) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      // Try to find by email first
      let { data, error } = await supabase
        .from('engineer_profiles')
        .select('*')
        .eq('email', identifier)
        .single();

      // If not found by email, try by ID
      if (error && identifier.length === 36) {
        ({ data, error } = await supabase
          .from('engineer_profiles')
          .select('*')
          .eq('id', identifier)
          .single());
      }

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  static async updateUserProfile(userId, updates) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const allowedFields = [
        'full_name',
        'display_name',
        'job_title',
        'phone',
        'location',
        'timezone',
        'skills',
        'primary_stack',
        'capacity_hours_per_week',
        'focus_hours',
        'notification_channels',
        'work_preferences'
      ];

      // Filter updates to only allowed fields
      const filteredUpdates = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});

      const { data, error } = await supabase
        .from('engineer_profiles')
        .update(filteredUpdates)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }

  /**
   * Get user's task source connections
   */
  static async getSourceConnections(profileId) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('task_source_connections')
        .select('*')
        .eq('profile_id', profileId);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching source connections:', error);
      throw error;
    }
  }

  /**
   * Update task source connection
   */
  static async updateSourceConnection(profileId, sourceType, updates) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('task_source_connections')
        .upsert({
          profile_id: profileId,
          source_type: sourceType,
          ...updates
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating source connection:', error);
      throw error;
    }
  }

  /**
   * Get user's execution history
   */
  static async getExecutionHistory(profileId, limit = 50) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('agent_execution_history')
        .select('*')
        .eq('profile_id', profileId)
        .order('assigned_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching execution history:', error);
      throw error;
    }
  }

  /**
   * Get all profiles (for manager dashboard)
   */
  static async getAllProfiles(teamId = null) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      let query = supabase
        .from('engineer_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (teamId) {
        query = query.eq('team_id', teamId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching all profiles:', error);
      throw error;
    }
  }

  /**
   * Get team statistics (for manager dashboard)
   */
  static async getTeamStats(teamId) {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      // Get team members
      const { data: members, error: membersError } = await supabase
        .from('engineer_profiles')
        .select('id, full_name, role')
        .eq('team_id', teamId);

      if (membersError) throw membersError;

      // Get execution stats for team
      const memberIds = members.map(m => m.id);
      
      const { data: execHistory, error: execError } = await supabase
        .from('agent_execution_history')
        .select('*')
        .in('profile_id', memberIds)
        .gte('assigned_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Last 7 days

      if (execError) throw execError;

      // Calculate stats
      const stats = {
        totalMembers: members.length,
        totalTasksThisWeek: execHistory.length,
        completedTasks: execHistory.filter(t => t.status === 'completed').length,
        inProgressTasks: execHistory.filter(t => t.status === 'in_progress').length,
        blockedTasks: execHistory.filter(t => t.status === 'blocked').length,
        avgPriorityScore: execHistory.reduce((sum, t) => sum + (t.priority_score || 0), 0) / (execHistory.length || 1),
        members: members.map(member => ({
          ...member,
          taskCount: execHistory.filter(t => t.profile_id === member.id).length,
          completedCount: execHistory.filter(t => t.profile_id === member.id && t.status === 'completed').length
        }))
      };

      return stats;
    } catch (error) {
      console.error('Error fetching team stats:', error);
      throw error;
    }
  }
}

export default SettingsAPI;