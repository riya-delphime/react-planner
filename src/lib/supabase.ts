import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'public'
  },
  global: {
    headers: {}
  }
});

export interface Resource {
  id: string;
  name: string;
  team: string;
  core: string;
  support: string;
  title: string;
  dob: string;
  department: string;
  licenses: string;
  leave_data?: Record<string, string>;
}

export interface Requirement {
  id: string;
  tail_number: string;
  tail_details: string;
  lic_engineers: number;
  support: number;
  date: string;
  status: string;
  notes?: string;
}

export interface Assignment {
  id: string;
  requirement_id: string;
  resource_id: string;
  date: string;
  role_type: string;
}

export interface KPI {
  date: string;
  weekly_utilization: number;
  daily_utilization: number;
}
