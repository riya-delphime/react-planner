import { supabase } from './supabase';

/**
 * Employee 360 View Interface
 * Comprehensive employee profile aggregating data from multiple tables
 * Matches the emp_360 database view schema
 */
export interface Emp360Record {
  // Employee Identity
  emp_id: string;
  emp_name: string;
  title: string;  // ENGR, CC, TECH
  profit_center: string;
  team: string;
  date_of_joining: string;

  // Experience & Skills
  years_of_experience: number;
  most_worked_aircraft: string;

  // License Information
  licenses: string[];  // Array of "AIRCRAFT-ENGINE-LIC" strings
  license_count: number;

  // Leave & Availability
  al_leave_balance: number;
  sl_leave_balance: number;
  total_leave_balance: number;
  upcoming_leaves_4w_count: number;

  // Trainings (next 4 weeks)
  upcoming_trainings_4w: string[];
  upcoming_trainings_4w_count: number;

  // Planned Assignments (for reference date)
  planned_core: string;
  planned_support: string;
}

/**
 * Frontend-friendly Employee 360 interface
 * Matches the emp_360 database view with camelCase naming
 */
export interface Employee360 {
  id: string;
  name: string;
  title: string;
  profitCenter: string;
  team: string;
  dateOfJoining: string;

  // Experience & Skills
  yearsOfExperience: number;
  mostWorkedAircraft: string;

  // License Information
  licenses: string[];
  licenseCount: number;

  // Leave & Availability
  alLeaveBalance: number;
  slLeaveBalance: number;
  totalLeaveBalance: number;
  upcomingLeaves4wCount: number;

  // Trainings (next 4 weeks)
  upcomingTrainings4w: string[];
  upcomingTrainings4wCount: number;

  // Planned Assignments (for reference date)
  plannedCore: string;
  plannedSupport: string;
}

/**
 * Convert database record to frontend-friendly format
 */
function convertEmp360ToEmployee360(record: Emp360Record): Employee360 {
  return {
    id: record.emp_id,
    name: record.emp_name,
    title: record.title,
    profitCenter: record.profit_center,
    team: record.team,
    dateOfJoining: record.date_of_joining,

    yearsOfExperience: record.years_of_experience,
    mostWorkedAircraft: record.most_worked_aircraft,

    licenses: record.licenses || [],
    licenseCount: record.license_count,

    alLeaveBalance: record.al_leave_balance,
    slLeaveBalance: record.sl_leave_balance,
    totalLeaveBalance: record.total_leave_balance,
    upcomingLeaves4wCount: record.upcoming_leaves_4w_count,

    upcomingTrainings4w: record.upcoming_trainings_4w || [],
    upcomingTrainings4wCount: record.upcoming_trainings_4w_count,

    plannedCore: record.planned_core || '',
    plannedSupport: record.planned_support || '',
  };
}

/**
 * Fetch all employees from emp_360 view
 */
export async function getAllEmployees(): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees:', error);
    throw error;
  }

  return (data || []).map(convertEmp360ToEmployee360);
}

/**
 * Fetch a single employee by ID
 */
export async function getEmployeeById(empId: string): Promise<Employee360 | null> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .eq('emp_id', empId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching employee:', error);
    throw error;
  }

  return data ? convertEmp360ToEmployee360(data) : null;
}

/**
 * Fetch employees by title (ENGR, CC, TECH)
 */
export async function getEmployeesByTitle(title: string): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .eq('title', title)
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees by title:', error);
    throw error;
  }

  return (data || []).map(convertEmp360ToEmployee360);
}

/**
 * Fetch employees by team
 */
export async function getEmployeesByTeam(team: string): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .eq('team', team)
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees by team:', error);
    throw error;
  }

  return (data || []).map(convertEmp360ToEmployee360);
}

/**
 * Fetch employees by profit center
 */
export async function getEmployeesByProfitCenter(profitCenter: string): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .eq('profit_center', profitCenter)
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees by profit center:', error);
    throw error;
  }

  return (data || []).map(convertEmp360ToEmployee360);
}

/**
 * Fetch employees with a specific license (partial match)
 */
export async function getEmployeesByLicense(licensePattern: string): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees by license:', error);
    throw error;
  }

  // Filter by license pattern (array contains)
  const filtered = (data || []).filter(emp =>
    emp.licenses?.some((lic: string) =>
      lic.toLowerCase().includes(licensePattern.toLowerCase())
    )
  );

  return filtered.map(convertEmp360ToEmployee360);
}

/**
 * Fetch employees with upcoming leaves (next 4 weeks)
 */
export async function getEmployeesWithUpcomingLeaves(): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .gt('upcoming_leaves_4w_count', 0)
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees with upcoming leaves:', error);
    throw error;
  }

  return (data || []).map(convertEmp360ToEmployee360);
}

/**
 * Fetch employees with upcoming trainings (next 4 weeks)
 */
export async function getEmployeesWithUpcomingTrainings(): Promise<Employee360[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('*')
    .gt('upcoming_trainings_4w_count', 0)
    .order('emp_name', { ascending: true });

  if (error) {
    console.error('Error fetching employees with upcoming trainings:', error);
    throw error;
  }

  return (data || []).map(convertEmp360ToEmployee360);
}

/**
 * Get unique profit centers for filtering
 */
export async function getProfitCenters(): Promise<string[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('profit_center')
    .order('profit_center');

  if (error) {
    console.error('Error fetching profit centers:', error);
    return [];
  }

  // Get unique profit centers
  const uniqueProfitCenters = [...new Set((data || []).map(d => d.profit_center).filter(Boolean))];
  return uniqueProfitCenters;
}

/**
 * Get unique teams for filtering
 */
export async function getTeams(): Promise<string[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('team')
    .order('team');

  if (error) {
    console.error('Error fetching teams:', error);
    return [];
  }

  // Get unique teams
  const uniqueTeams = [...new Set((data || []).map(d => d.team).filter(Boolean))];
  return uniqueTeams;
}

/**
 * Get unique titles for filtering
 */
export async function getTitles(): Promise<string[]> {
  const { data, error } = await supabase
    .from('emp_360')
    .select('title')
    .order('title');

  if (error) {
    console.error('Error fetching titles:', error);
    return [];
  }

  // Get unique titles
  const uniqueTitles = [...new Set((data || []).map(d => d.title).filter(Boolean))];
  return uniqueTitles;
}