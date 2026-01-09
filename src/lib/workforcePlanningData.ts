/**
 * Workforce Planning Data Layer
 *
 * Primary data source: planning_master_fn Postgres function
 * Supporting table: shift_code_master (for OFF/roster code classification)
 *
 * Reference: Screenshots define the visual treatment for:
 * - Slider/date ruler highlight behavior
 * - Roster legend cell rendering
 */

import { supabase } from './supabase';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Fixed "today" reference date for the application
 * Passed to DB backend as current_date parameter
 */
export const CURRENT_DATE = '2022-04-30';

/**
 * Window calculation: 88 days before current_date
 */
export const WINDOW_DAYS_BEFORE = 88;

/**
 * Window calculation: 31 days after current_date
 */
export const WINDOW_DAYS_AFTER = 31;

/**
 * Fallback list for roster-like tasks NOT in shift_code_master
 * These are known non-tail entries that should be rendered with roster styling
 *
 * Rationale:
 * - TR/Training: Employee training sessions
 * - HSKping/HSKPING/Housekeeping: Facility maintenance duties
 * - Movement: Aircraft movement duties (e.g., "N797AV MOVEMENT")
 * - Night Shift: Non-aircraft work shift
 * - OFF: General off-duty
 * - O: Common abbreviation for Off/Available
 * - D: Day shift indicator
 */
export const ROSTER_LIKE_FALLBACK_CODES = [
  'TR',
  'TRAINING',
  'HSKPING',
  'HSKING',
  'HOUSEKEEPING',
  'MOVEMENT',
  'NIGHT SHIFT',
  'OFF',
  'O',
  'D',
];

/**
 * Roster-like keywords that may appear as part of longer strings
 * Used for partial matching (e.g., "N797AV MOVEMENT" contains "MOVEMENT")
 */
export const ROSTER_LIKE_KEYWORDS = [
  'MOVEMENT',
  'TRAINING',
  'HOUSEKEEPING',
  'NIGHT SHIFT',
];

/**
 * Format role/title for display
 * Converts RPC values (CC, ENGR, TECH) to user-friendly labels
 */
export function formatRoleForDisplay(role: string): string {
  const upperRole = (role || '').toUpperCase().trim();
  switch (upperRole) {
    case 'ENGR':
      return 'Engineer';
    case 'TECH':
      return 'Technician';
    case 'CC':
      return 'CC';
    default:
      return role || '-';
  }
}

// =============================================================================
// INTERFACES
// =============================================================================

/**
 * Raw record from planning_master_fn function
 * Returns one row per employee per date with these columns:
 * - id, name, mobile, team, date
 * - roster_entry, planned_core, planned_support, actual_task
 * - ttl_timestamp, alert
 */
export interface PlanningMasterRecord {
  id: string;
  name: string;
  mobile: string;
  team: string;
  date: string;
  roster_entry: string;
  planned_core: string;
  planned_support: string;
  actual_task: string;
  ttl_timestamp: string;
  alert: string;
  title: string;  // Role/title (e.g., 'CC', 'Tech', 'Engineer')
  expired_trainings: string | null;  // Comma-separated list of expired trainings for this employee on this date
}

/**
 * Parsed daily task data for a specific date
 */
export interface DailyTaskData {
  actualTask: string | null;
  rosterEntry: string | null;
}

/**
 * Shift code record from shift_code_master table
 * Used to identify OFF/roster codes where duration_hours = 0
 */
export interface ShiftCodeRecord {
  code: string;
  description?: string;
  duration_hours: number;
}

/**
 * Processed employee row for the grid
 */
export interface WorkforceGridRow {
  empId: string;
  name: string;
  team: string;
  role: string;
  plannedCore: string;
  plannedSupport: string;
  ttlLogin: string;
  // Map of date string to display value and styling info
  dailyData: Map<string, DailyCellData>;
  // Map of date string to planned_core/planned_support/ttl_timestamp for that date
  dateDetails: Map<string, { plannedCore: string; plannedSupport: string; ttlLogin: string }>;
}

/**
 * Cell data for a specific date column
 */
export interface DailyCellData {
  displayValue: string;
  isRosterLike: boolean;
  isTail: boolean;
  rosterCode?: string; // Original roster code for legend matching
  alert?: string; // Alert message from planning_master_fn
  employeeTrainings?: string; // Comma-separated list of expired trainings (from employee_trainings field)
}

/**
 * Alert data structure for the Alerts panel
 */
export interface AlertData {
  empId: string;
  empName: string;
  team: string;
  date: string;
  alertType: 'no-show' | 'leave' | 'other';
  alertMessage: string;
  tailNumber?: string; // Affected tail if applicable
  plannedCore?: string;
  plannedSupport?: string;
}

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Calculate window start date (current_date - 88 days)
 */
export function getWindowStartDate(currentDate: string = CURRENT_DATE): string {
  const date = new Date(currentDate);
  date.setDate(date.getDate() - WINDOW_DAYS_BEFORE);
  return date.toISOString().split('T')[0];
}

/**
 * Calculate window end date (current_date + 31 days)
 */
export function getWindowEndDate(currentDate: string = CURRENT_DATE): string {
  const date = new Date(currentDate);
  date.setDate(date.getDate() + WINDOW_DAYS_AFTER);
  return date.toISOString().split('T')[0];
}

/**
 * Generate array of dates within the window
 * Uses UTC to avoid timezone issues
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  // Parse as UTC to avoid timezone shifts
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

  const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  while (current <= end) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, '0');
    const day = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Format date for column header display (e.g., "30-Apr")
 */
export function formatDateForHeader(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  return `${day}-${month}`;
}

/**
 * Format date for "Details for" header (e.g., "Apr 30th")
 */
export function formatDateForDetailsHeader(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];

  // Add ordinal suffix
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd'
    : 'th';

  return `${month} ${day}${suffix}`;
}

/**
 * Determine date zone relative to current date
 */
export type DateZone = 'past' | 'current' | 'future';

export function getDateZone(dateStr: string, currentDate: string = CURRENT_DATE): DateZone {
  const date = new Date(dateStr);
  const current = new Date(currentDate);

  // Reset time components for date-only comparison
  date.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);

  if (date < current) return 'past';
  if (date > current) return 'future';
  return 'current';
}

// =============================================================================
// ROSTER/TAIL CLASSIFICATION
// =============================================================================

/**
 * Regex pattern for tail number detection
 * Matches patterns like: A6-EYE, OY-VKF, HZ-AQB, F-WTAK, N123AB, D-EFGH, VH-XYZ, TC-TUV, A6-BMC, A6-ETQ, A350-RRTRE
 *
 * Pattern explanation:
 * - ^[A-Z][A-Z0-9]?-[A-Z0-9]{2,5}$ : International format with alphanumeric prefix (A6-EYE, A6-BMC, F-WTAK, HZ-AQB)
 * - ^N[0-9]+[A-Z]*$ : US N-number format (N123AB, N797AV)
 * - ^[A-Z]-[A-Z]{4}$ : Single-letter European prefix (D-EFGH, F-ABCD)
 * - ^[A-Z]{2}-[A-Z]{3}$ : Two-letter prefix with 3-letter suffix (VH-XYZ, EI-GWZ)
 * - ^[A-Z]{2}[0-9]{3,4}[A-Z]{0,2}$ : No-dash formats (EC123, PR1234AB)
 * - ^[A-Z][0-9]{2,3}-[A-Z0-9\/-]+$ : Aircraft type + registration format (A350-RRTRE, A350-RRTRENTXWB-GC/O, B737-XXXXX)
 */
export const TAIL_NUMBER_PATTERN = /^([A-Z][A-Z0-9]?-[A-Z0-9]{2,5}|N[0-9]+[A-Z]*|[A-Z]-[A-Z]{4}|[A-Z]{2}-[A-Z]{3}|[A-Z]{2}[0-9]{3,4}[A-Z]{0,2}|[A-Z][0-9]{2,3}-[A-Z0-9\/-]+)$/i;

/**
 * Set of OFF/roster codes loaded from shift_code_master (duration_hours = 0)
 * Populated by loadShiftCodes()
 */
let offRosterCodes: Set<string> = new Set();

/**
 * Load shift codes from shift_code_master where duration_hours = 0
 * These are considered OFF/roster codes
 */
export async function loadShiftCodes(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('shift_code_master')
      .select('code, duration_hours')
      .eq('duration_hours', 0);

    if (error) {
      console.error('Error loading shift codes:', error);
      return new Set();
    }

    offRosterCodes = new Set((data || []).map(r => r.code.toUpperCase()));
    return offRosterCodes;
  } catch (err) {
    console.error('Exception loading shift codes:', err);
    return new Set();
  }
}

/**
 * Check if a value is a roster-like entry (not a tail number)
 *
 * Classification precedence:
 * 1. Check against shift_code_master OFF codes (duration_hours = 0)
 * 2. Check against fallback roster-like codes list
 * 3. Check for roster-like keywords in the value
 * 4. If none of above, check if it looks like a tail number
 * 5. If not a tail number, treat as roster-like
 */
export function isRosterLike(value: string | null | undefined): boolean {
  if (!value || value.trim() === '' || value === '-') {
    return false; // Empty values are neither roster nor tail
  }

  const normalized = value.trim().toUpperCase();

  // 1. Check shift_code_master OFF codes
  if (offRosterCodes.has(normalized)) {
    return true;
  }

  // 2. Check fallback roster codes (exact match)
  if (ROSTER_LIKE_FALLBACK_CODES.some(code => normalized === code.toUpperCase())) {
    return true;
  }

  // 3. Check for roster-like keywords (partial match)
  if (ROSTER_LIKE_KEYWORDS.some(keyword => normalized.includes(keyword.toUpperCase()))) {
    return true;
  }

  // 4. Check if it looks like a tail number
  if (TAIL_NUMBER_PATTERN.test(normalized)) {
    return false; // It's a tail number
  }

  // 5. If it doesn't look like a tail, treat as roster-like
  // This catches codes like "AL", "SL", "DO", etc.
  return true;
}

/**
 * Check if a value looks like a tail number
 */
export function isTailNumber(value: string | null | undefined): boolean {
  if (!value || value.trim() === '') {
    return false;
  }
  return TAIL_NUMBER_PATTERN.test(value.trim().toUpperCase());
}

// =============================================================================
// DATA FETCHING
// =============================================================================

/**
 * Fetch workforce planning data from planning_master_fn
 *
 * Usage: planning_master_fn(current_date, win_start_date, win_end_date)
 * Example:
 *   SELECT * FROM public.planning_master_fn(
 *     '2022-04-30'::date,
 *     '2022-04-30'::date - 88,
 *     '2022-04-30'::date + 31
 *   );
 *
 * @param currentDate - The reference "today" date (default: CURRENT_DATE)
 * @returns Array of planning master records
 */
export async function fetchPlanningMasterData(
  currentDate: string = CURRENT_DATE
): Promise<PlanningMasterRecord[]> {
  const winStartDate = getWindowStartDate(currentDate);
  const winEndDate = getWindowEndDate(currentDate);

  console.log('Fetching planning_master_fn with params:', {
    currentDate,
    winStartDate,
    winEndDate
  });

  try {
    // RPC call with parameters matching the function signature:
    // planning_master_fn_v2(p_curr_date date, p_win_start date, p_win_end date)
    // The RPC function returns all rows in a single call
    const { data, error } = await supabase
      .rpc('planning_master_fn_v2', {
        p_curr_date: currentDate,
        p_win_start: winStartDate,
        p_win_end: winEndDate
      });

    if (error) {
      console.error('Error fetching planning master data:', error);
      throw error;
    }

    return data || [];
  } catch (err) {
    console.error('Exception fetching planning master data:', err);
    return [];
  }
}

/**
 * Pivot raw data from flat (one row per emp+date) to grid format (one row per employee)
 *
 * The planning_master_fn returns flat rows like:
 * { id, name, team, date, roster_entry, planned_core, planned_support, actual_task, ... }
 *
 * We need to pivot this to:
 * { empId, name, team, dailyData: Map<date, cellData> }
 *
 * NOTE: Multiple rows can exist per employee per date when there are multiple tasks.
 * These must be collected and actual_task values concatenated with '/'.
 */
interface EmployeeData {
  id: string;
  name: string;
  team: string;
  title: string;  // Role/title from RPC (e.g., 'CC', 'Tech', 'Engineer')
  // Map of date string to array of records for that date (multiple tasks possible)
  dateRecords: Map<string, PlanningMasterRecord[]>;
}

/**
 * Process raw planning master data into grid-ready rows
 * Applies zone-based rendering rules for date columns
 *
 * ZONE RULES (relative to current_date = 2022-04-30):
 *
 * ZONE 1 - PAST (date < current_date):
 *   - Display actual_task
 *   - Style as tail (if tail number) or roster (if roster-like)
 *   - Concatenate multiple tasks with '/'
 *
 * ZONE 2 - CURRENT (date = current_date):
 *   - If roster-like, render with roster styling
 *   - Otherwise render actual_task with tail styling
 *   - Concatenate multiple tasks with '/'
 *
 * ZONE 3 - FUTURE (date > current_date):
 *   - Only show roster_entry
 *   - Render with roster styling
 *   - Do NOT show tail numbers from actual_task
 */
/**
 * Normalize a date value to YYYY-MM-DD string format
 * Handles: Date objects, ISO strings with time, plain date strings
 */
function normalizeDateToString(dateValue: unknown): string {
  if (!dateValue) return '';

  // If it's already a string
  if (typeof dateValue === 'string') {
    // Handle ISO format with time (2022-02-26T00:00:00.000Z or 2022-02-26T00:00:00+00:00)
    if (dateValue.includes('T')) {
      return dateValue.split('T')[0];
    }
    // Handle plain date string (2022-02-26)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }
    // Try to parse other formats
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      // Use UTC to avoid timezone shifts
      return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    }
    return dateValue;
  }

  // If it's a Date object
  if (dateValue instanceof Date) {
    return `${dateValue.getUTCFullYear()}-${String(dateValue.getUTCMonth() + 1).padStart(2, '0')}-${String(dateValue.getUTCDate()).padStart(2, '0')}`;
  }

  // Last resort - convert to string
  return String(dateValue);
}

export function processGridData(
  rawData: PlanningMasterRecord[],
  dateRange: string[],
  currentDate: string = CURRENT_DATE
): WorkforceGridRow[] {
  // Step 1: Group records by employee ID
  const employeeMap = new Map<string, EmployeeData>();

  // Debug: log a sample of dates being processed
  if (rawData.length > 0) {
    // Debug: Log title values from RPC
    const sampleTitles = rawData.slice(0, 10).map(r => ({
      id: r.id,
      name: r.name,
      title: r.title
    }));
    console.log('[Title Debug] Sample records with title field:', sampleTitles);
    const uniqueTitles = [...new Set(rawData.map(r => r.title))];
    console.log('[Title Debug] Unique title values from RPC:', uniqueTitles);

    const sampleDates = rawData.slice(0, 5).map(r => ({
      original: r.date,
      normalized: normalizeDateToString(r.date as string)
    }));
    console.log('Sample date normalization:', sampleDates);

    // Debug: Check if we have data for Feb 1st specifically
    const feb1Records = rawData.filter(r => {
      const dateStr = normalizeDateToString(r.date as string);
      return dateStr === '2022-02-01';
    });
    console.log(`[Data Debug] Records for 2022-02-01: ${feb1Records.length}`);
    if (feb1Records.length > 0) {
      // Show first 10 records with their actual_task values - log each individually for visibility
      console.log('[Data Debug] Feb 1st sample records:');
      feb1Records.slice(0, 10).forEach((r, i) => {
        console.log(`  [${i}] empId=${r.id}, actual_task="${r.actual_task || ''}", roster_entry="${r.roster_entry || ''}"`);
      });
      // Count how many have non-empty actual_task
      const withActualTask = feb1Records.filter(r => r.actual_task && r.actual_task.trim() !== '');
      console.log(`[Data Debug] Feb 1st records with actual_task: ${withActualTask.length}/${feb1Records.length}`);
      // Show what values are in actual_task
      const uniqueTasks = [...new Set(withActualTask.map(r => r.actual_task))];
      console.log(`[Data Debug] Unique actual_task values for Feb 1st:`, uniqueTasks);
      // Debug: test classification of values with leading spaces
      uniqueTasks.forEach(task => {
        const trimmed = task?.trim() || '';
        const matchesTailPattern = TAIL_NUMBER_PATTERN.test(trimmed.toUpperCase());
        const isRosterResult = isRosterLike(task);
        const isTailResult = isTailNumber(task);
        console.log(`[Classification Debug] "${task}" -> trimmed="${trimmed}", matchesPattern=${matchesTailPattern}, isRoster=${isRosterResult}, isTail=${isTailResult}`);
      });
    }
  }

  rawData.forEach(record => {
    const empId = record.id;
    // Normalize the date using the helper function
    const dateStr = normalizeDateToString(record.date as string);

    if (!dateStr) {
      console.warn('Empty date for record:', record);
      return;
    }

    if (!employeeMap.has(empId)) {
      employeeMap.set(empId, {
        id: empId,
        name: record.name,
        team: record.team,
        title: record.title || '',  // Role/title from RPC
        dateRecords: new Map()
      });
    }

    // Collect multiple records per date (for task concatenation)
    const empDateRecords = employeeMap.get(empId)!.dateRecords;
    if (!empDateRecords.has(dateStr)) {
      empDateRecords.set(dateStr, []);
    }
    empDateRecords.get(dateStr)!.push(record);
  });

  console.log(`Pivoted ${rawData.length} records into ${employeeMap.size} employees`);

  // Step 2: Convert to WorkforceGridRow format
  const gridRows: WorkforceGridRow[] = [];

  employeeMap.forEach((empData) => {
    const dailyData = new Map<string, DailyCellData>();
    const dateDetails = new Map<string, { plannedCore: string; plannedSupport: string; ttlLogin: string }>();

    // Process each date in the range
    dateRange.forEach(dateStr => {
      const records = empData.dateRecords.get(dateStr);

      let displayValue = '';
      let isRoster = false;
      let isTail = false;
      let rosterCode: string | undefined;

      if (records && records.length > 0) {
        // Collect all actual_task values for concatenation (filter out empty/null)
        const actualTasks = records
          .map(r => r.actual_task || '')
          .filter(task => task.trim() !== '');

        // Use first record for roster_entry (should be same across all records for same emp+date)
        const firstRecord = records[0];
        const rosterEntry = firstRecord.roster_entry || '';

        // Concatenate multiple tasks with '/'
        const concatenatedTask = actualTasks.join('/');

        // Step 2.1: Same logic for ALL zones (past, current, future)
        // Rule: If actual_task is non-empty → display actual_task, else → display roster_entry
        if (concatenatedTask) {
          displayValue = concatenatedTask;
          // For styling, check the first task (or if all are tails, it's a tail display)
          const firstTask = actualTasks[0] || '';
          isRoster = isRosterLike(firstTask);
          isTail = !isRoster && isTailNumber(firstTask);
          if (isRoster) rosterCode = firstTask;
        } else if (rosterEntry) {
          // Fallback to roster_entry if no actual_task
          displayValue = rosterEntry;
          isRoster = true;
          rosterCode = rosterEntry;
        }

        // Store date-specific details for Core/Support/TTL Login columns (use first record)
        dateDetails.set(dateStr, {
          plannedCore: firstRecord.planned_core || '',
          plannedSupport: firstRecord.planned_support || '',
          ttlLogin: firstRecord.ttl_timestamp || ''
        });
      } else {
        // No records for this date
        dateDetails.set(dateStr, {
          plannedCore: '',
          plannedSupport: '',
          ttlLogin: ''
        });
      }

      // Capture alert from first record (should be same across all records for same emp+date)
      const alertValue = records && records.length > 0 ? (records[0].alert || '') : '';
      // Capture expired_trainings from first record (same for all records for same emp+date)
      const trainingsValue = records && records.length > 0 ? (records[0].expired_trainings || '') : '';

      dailyData.set(dateStr, {
        displayValue,
        isRosterLike: isRoster,
        isTail,
        rosterCode,
        alert: alertValue,
        employeeTrainings: trainingsValue
      });
    });

    // Get planned_core and planned_support from the current date record (or any record)
    // Use first record from the array since these values should be the same across all records for same emp+date
    const currentDateRecords = empData.dateRecords.get(currentDate);
    const anyRecords = empData.dateRecords.values().next().value;
    const refRecord = (currentDateRecords && currentDateRecords[0]) || (anyRecords && anyRecords[0]);

    gridRows.push({
      empId: empData.id,
      name: empData.name,
      team: empData.team,
      role: empData.title || '',  // Role/title from RPC
      plannedCore: refRecord?.planned_core || '',
      plannedSupport: refRecord?.planned_support || '',
      ttlLogin: refRecord?.ttl_timestamp || '',
      dailyData,
      dateDetails
    });
  });

  // Sort by employee ID for consistent ordering
  gridRows.sort((a, b) => a.empId.localeCompare(b.empId));

  // Debug: Log final role values in gridRows
  const roleCounts = new Map<string, number>();
  gridRows.forEach(row => {
    const role = row.role || '(empty)';
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  });
  console.log('[Title Debug] Role distribution in gridRows:', Object.fromEntries(roleCounts));

  return gridRows;
}

/**
 * Fetch employee roles from emp_cc_tech_master table
 * Returns a map of employee ID to role/title
 *
 * Three role types expected:
 * - Engineer: Licensed aircraft engineers
 * - CC: Cabin Crew certifying staff
 * - Tech: Technicians (default for unrecognized roles)
 */
async function fetchEmployeeRoles(): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase
      .from('emp_cc_tech_master')
      .select('id, title');

    if (error) {
      console.error('Error fetching employee roles:', error);
      return new Map();
    }

    const roleMap = new Map<string, string>();
    (data || []).forEach(emp => {
      // Normalize title for display consistency
      const titleUpper = (emp.title || '').toUpperCase().trim();
      let normalizedTitle: string;

      if (titleUpper === 'ENGINEER' || titleUpper === 'ENG' || titleUpper === 'ENGR') {
        normalizedTitle = 'Engineer';
      } else if (titleUpper === 'CC') {
        normalizedTitle = 'CC';
      } else if (titleUpper === 'TECH' || titleUpper === 'TECHNICIAN') {
        normalizedTitle = 'Tech';
      } else {
        // Default to Tech for unrecognized roles
        normalizedTitle = 'Tech';
      }

      roleMap.set(emp.id, normalizedTitle);
    });

    // Log role distribution for debugging
    const roleCounts = new Map<string, number>();
    roleMap.forEach(role => {
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    });
    console.log(`Loaded ${roleMap.size} employee roles from emp_cc_tech_master:`, Object.fromEntries(roleCounts));

    return roleMap;
  } catch (err) {
    console.error('Exception fetching employee roles:', err);
    return new Map();
  }
}

/**
 * Initialize workforce planning data layer
 * Loads shift codes, employee roles, and returns planning data
 */
export async function initializeWorkforcePlanning(
  currentDate: string = CURRENT_DATE
): Promise<{
  gridData: WorkforceGridRow[];
  dateRange: string[];
  shiftCodes: Set<string>;
}> {
  // Load shift codes and employee roles in parallel
  const [shiftCodes, employeeRoles] = await Promise.all([
    loadShiftCodes(),
    fetchEmployeeRoles()
  ]);

  // Fetch planning master data
  const rawData = await fetchPlanningMasterData(currentDate);

  // Calculate date range
  const winStartDate = getWindowStartDate(currentDate);
  const winEndDate = getWindowEndDate(currentDate);
  const dateRange = getDateRange(winStartDate, winEndDate);

  // Process into grid format
  const gridData = processGridData(rawData, dateRange, currentDate);

  // Role/title is now provided directly from the planning_master_fn RPC
  // Only fall back to emp_cc_tech_master lookup if RPC didn't provide a title
  gridData.forEach(row => {
    if (!row.role) {
      // Use role from emp_cc_tech_master as fallback, default to ENGR if not found
      row.role = employeeRoles.get(row.empId) || 'ENGR';
    }
  });

  return {
    gridData,
    dateRange,
    shiftCodes
  };
}

// =============================================================================
// COLOR MAPPING - Explicit rules (no regex)
// =============================================================================

/**
 * Color definitions per user requirements:
 *
 * 1. AL, TR, SK - green fill with black font (leave/training codes)
 * 2. O, 0 - grey fill with black font (off/available)
 * 3. DO - orange fill with black font (day off)
 * 4. HSE-KPNG, HSKPNG, PRESERVATION, Night Shift, Quarantine, MVMNT - pink fill with red font
 * 5. 1, D, E, B1 - light blue fill with black font (shift codes)
 * 6. Everything else (tail numbers) - green fill with bold white font
 */

// Leave/Training codes - green with black font
const LEAVE_TRAINING_CODES = ['AL', 'TR', 'SK'];

// Off/Available codes - grey with black font
const OFF_CODES = ['O', '0'];

// Day Off codes - orange with black font
const DAY_OFF_CODES = ['DO'];

// Housekeeping/Special codes - pink with red font
const HOUSEKEEPING_CODES = ['HSE-KPNG', 'HSKPNG', 'PRESERVATION', 'NIGHT SHIFT', 'QUARANTINE', 'MVMNT'];

// Shift codes - light blue with black font
const SHIFT_CODES = ['1', 'D', 'E', 'B1'];

export const CELL_COLORS = {
  LEAVE_TRAINING: { bg: 'bg-green-300', text: 'text-gray-900' },      // AL, TR, SK
  OFF: { bg: 'bg-gray-400', text: 'text-gray-900' },                   // O, 0
  DAY_OFF: { bg: 'bg-orange-400', text: 'text-gray-900' },             // DO
  HOUSEKEEPING: { bg: 'bg-pink-200', text: 'text-red-700' },           // HSE-KPNG, etc.
  SHIFT: { bg: 'bg-blue-200', text: 'text-gray-900' },                 // 1, D, E, B1
  TAIL: { bg: 'bg-green-600', text: 'text-white font-bold' },          // Everything else (tails) - past/current
  TAIL_FUTURE: { bg: 'bg-green-200', text: 'text-green-700 font-bold' },  // Future tail assignments (lighter green)
  TAIL_SIMULATED: { bg: 'bg-gray-500', text: 'text-white font-bold' },    // Simulated tails (contains '--')
};

// Legacy exports for compatibility
export const TAIL_COLOR = CELL_COLORS.TAIL;
export const ROSTER_COLORS = {
  AL: CELL_COLORS.LEAVE_TRAINING,
  TR: CELL_COLORS.LEAVE_TRAINING,
  SK: CELL_COLORS.LEAVE_TRAINING,
  DEFAULT: CELL_COLORS.TAIL,
};
export const ROSTER_COLOR = CELL_COLORS.TAIL;

/**
 * Get color classes for a cell value based on explicit rules
 * No regex - uses explicit code lists
 */
export function getCellColors(value: string | undefined): { bg: string; text: string } {
  if (!value || value.trim() === '' || value === '-') {
    return { bg: '', text: 'text-gray-400' }; // Empty cell
  }

  const normalized = value.trim().toUpperCase();

  // 1. Leave/Training codes - green with black font
  if (LEAVE_TRAINING_CODES.includes(normalized)) {
    return CELL_COLORS.LEAVE_TRAINING;
  }

  // 2. Off/Available codes - grey with black font
  if (OFF_CODES.includes(normalized)) {
    return CELL_COLORS.OFF;
  }

  // 3. Day Off codes - orange with black font
  if (DAY_OFF_CODES.includes(normalized)) {
    return CELL_COLORS.DAY_OFF;
  }

  // 4. Housekeeping/Special codes - pink with red font (check includes for partial match)
  for (const code of HOUSEKEEPING_CODES) {
    if (normalized === code || normalized.includes(code)) {
      return CELL_COLORS.HOUSEKEEPING;
    }
  }

  // 5. Shift codes - light blue with black font
  if (SHIFT_CODES.includes(normalized)) {
    return CELL_COLORS.SHIFT;
  }

  // 6. Everything else (tail numbers) - green with bold white font
  return CELL_COLORS.TAIL;
}

// Keep getRosterColors for backward compatibility - maps to getCellColors
export function getRosterColors(code: string | undefined): { bg: string; text: string } {
  return getCellColors(code);
}

// =============================================================================
// NO SHOW COLOR
// =============================================================================

export const NO_SHOW_COLORS = { bg: 'bg-red-600', text: 'text-white font-bold' };

// =============================================================================
// ALERT EXTRACTION
// =============================================================================

/**
 * Extract alerts from grid data for a specific date
 * Parses the alert field from planning_master_fn and categorizes them
 */
export function extractAlertsForDate(
  gridData: WorkforceGridRow[],
  targetDate: string
): AlertData[] {
  const alerts: AlertData[] = [];

  gridData.forEach(row => {
    const cellData = row.dailyData.get(targetDate);
    const dateDetails = row.dateDetails.get(targetDate);

    if (cellData?.alert && cellData.alert.trim() !== '') {
      const alertMessage = cellData.alert.trim();
      const alertLower = alertMessage.toLowerCase();

      // Determine alert type from message content
      // SK = Sick Leave (same as SL), AL = Annual Leave
      let alertType: 'no-show' | 'leave' | 'other' = 'other';
      if (alertLower.includes('no-show') || alertLower.includes('no show') || alertLower.includes('noshow')) {
        alertType = 'no-show';
      } else if (alertLower.includes('leave') || alertLower.includes('al') || alertLower.includes('sl') || alertLower.includes('sk') || alertLower === 'sick') {
        alertType = 'leave';
      }

      // Extract tail number if present in the alert or from the cell display value
      let tailNumber: string | undefined;
      if (cellData.isTail && cellData.displayValue) {
        tailNumber = cellData.displayValue.split('/')[0]; // Use first tail if multiple
      }
      // Also try to extract from planned_core or planned_support
      if (!tailNumber && dateDetails?.plannedCore && isTailNumber(dateDetails.plannedCore)) {
        tailNumber = dateDetails.plannedCore;
      }
      if (!tailNumber && dateDetails?.plannedSupport && isTailNumber(dateDetails.plannedSupport)) {
        tailNumber = dateDetails.plannedSupport;
      }

      alerts.push({
        empId: row.empId,
        empName: row.name,
        team: row.team,
        date: targetDate,
        alertType,
        alertMessage,
        tailNumber,
        plannedCore: dateDetails?.plannedCore,
        plannedSupport: dateDetails?.plannedSupport
      });
    }
  });

  return alerts;
}

/**
 * Group alerts by tail number for tail-level summary view
 */
export interface TailAlertSummary {
  tailNumber: string;
  alerts: AlertData[];
  totalAffected: number;
  noShowCount: number;
  leaveCount: number;
}

export function groupAlertsByTail(alerts: AlertData[]): TailAlertSummary[] {
  const tailMap = new Map<string, AlertData[]>();

  alerts.forEach(alert => {
    const tail = alert.tailNumber || 'Unassigned';
    if (!tailMap.has(tail)) {
      tailMap.set(tail, []);
    }
    tailMap.get(tail)!.push(alert);
  });

  const summaries: TailAlertSummary[] = [];
  tailMap.forEach((tailAlerts, tailNumber) => {
    summaries.push({
      tailNumber,
      alerts: tailAlerts,
      totalAffected: tailAlerts.length,
      noShowCount: tailAlerts.filter(a => a.alertType === 'no-show').length,
      leaveCount: tailAlerts.filter(a => a.alertType === 'leave').length
    });
  });

  // Sort by tail number
  summaries.sort((a, b) => a.tailNumber.localeCompare(b.tailNumber));
  return summaries;
}

// =============================================================================
// REPLACEMENT CANDIDATE FETCHING
// =============================================================================

/**
 * Replacement candidate structure from emp_360 view with additional context
 */
export interface ReplacementCandidate {
  empId: string;
  empName: string;
  title: string;
  team: string;
  support: string;
  plannedCore: string; // Employee's planned core assignment
  currentTail: string;
  alLeaveBalance: number;
  upcomingLeaves2wCount: number;
  upcomingTrainings: string[];
  yearsOfExperience: number;
  profileText: string; // Formatted profile string for dropdown
}

/**
 * Fetch replacement candidates for a given tail on a specific date
 * Uses emp_360 view and filters out:
 * - Employees with OFF/roster codes on the target date
 * - Employees with blank ttl_login on the target date
 * - Employees in the exclude list (already assigned or alert-affected)
 * - Employees already assigned to the SAME tail (core or support)
 */
export async function fetchReplacementCandidates(
  tailNumber: string,
  targetDate: string,
  excludeEmpNames: string[],
  gridData: WorkforceGridRow[]
): Promise<ReplacementCandidate[]> {
  try {
    // First, get all employees from emp_360
    const { data: emp360Data, error: emp360Error } = await supabase
      .from('emp_360')
      .select('*')
      .order('years_of_experience', { ascending: false });

    if (emp360Error) {
      console.error('Error fetching emp_360 data:', emp360Error);
      return [];
    }

    // Build a map of employee availability on the target date from gridData
    const empAvailabilityMap = new Map<string, {
      isAvailable: boolean;
      hasTtlLogin: boolean;
      currentTask: string;
      support: string;
      plannedCore: string;
      isOnSameTail: boolean; // NEW: track if employee is already on the affected tail
    }>();

    gridData.forEach(row => {
      const cellData = row.dailyData.get(targetDate);
      const dateDetails = row.dateDetails.get(targetDate);

      // Check if employee has an OFF/roster code on this date
      const isOffOrRoster = cellData?.isRosterLike || false;
      // Check if they have TTL login
      const hasTtlLogin = dateDetails?.ttlLogin && dateDetails.ttlLogin.trim() !== '';
      // Current task assignment
      const currentTask = cellData?.displayValue || '';
      const support = dateDetails?.plannedSupport || '';
      const plannedCore = dateDetails?.plannedCore || '';

      // Check if employee is already assigned to the same tail (via core, support, or actual task)
      const isOnSameTail = Boolean(
        (plannedCore && plannedCore.toUpperCase() === tailNumber.toUpperCase()) ||
        (support && support.toUpperCase() === tailNumber.toUpperCase()) ||
        (currentTask && currentTask.toUpperCase().includes(tailNumber.toUpperCase()))
      );

      empAvailabilityMap.set(row.empId, {
        isAvailable: !isOffOrRoster && !!hasTtlLogin,
        hasTtlLogin: !!hasTtlLogin,
        currentTask,
        support,
        plannedCore,
        isOnSameTail
      });
    });

    // Filter and build candidates
    const candidates: ReplacementCandidate[] = [];

    (emp360Data || []).forEach((emp: Record<string, unknown>) => {
      const empId = emp.emp_id as string;
      const empName = emp.emp_name as string;

      // Skip if in exclude list
      if (excludeEmpNames.includes(empName)) {
        return;
      }

      // Check availability from gridData
      const availability = empAvailabilityMap.get(empId);

      // Skip if not available (OFF/roster code or no TTL login)
      if (!availability || !availability.isAvailable) {
        return;
      }

      // Skip if employee is already assigned to the same tail
      if (availability.isOnSameTail) {
        return;
      }

      // Build profile text for dropdown display
      const currentTail = availability.currentTask || 'N/A';
      const upcomingTrainings = (emp.upcoming_trainings as string[]) || [];
      const upcomingTrainings4wCount = (emp.upcoming_trainings_4w_count as number) || 0;

      const profileText = [
        `${empName} (${empId})`,
        `Support: ${availability.support || 'AV'}`,
        `Current Tail: ${currentTail}`,
        `Avl Leaves: ${emp.al_leave_balance || 0}`,
        `Next 2W Leaves: ${(emp.upcoming_leaves_count as number) || 0}`,
        upcomingTrainings4wCount > 0 ? `Up Coming Trainings: ${upcomingTrainings.join(', ')}` : ''
      ].filter(Boolean).join(' | ');

      candidates.push({
        empId,
        empName,
        title: (emp.title as string) || '',
        team: (emp.team as string) || '',
        support: availability.support || 'AV',
        plannedCore: availability.plannedCore || '',
        currentTail,
        alLeaveBalance: (emp.al_leave_balance as number) || 0,
        upcomingLeaves2wCount: (emp.upcoming_leaves_count as number) || 0,
        upcomingTrainings,
        yearsOfExperience: (emp.years_of_experience as number) || 0,
        profileText
      });
    });

    // Sort by years of experience (desc), then name (asc)
    candidates.sort((a, b) => {
      if (b.yearsOfExperience !== a.yearsOfExperience) {
        return b.yearsOfExperience - a.yearsOfExperience;
      }
      return a.empName.localeCompare(b.empName);
    });

    // Return top 3 candidates
    return candidates.slice(0, 3);
  } catch (err) {
    console.error('Exception fetching replacement candidates:', err);
    return [];
  }
}

// =============================================================================
// DATABASE UPDATE FUNCTIONS
// =============================================================================

/**
 * Update emp_planned for a replacement employee
 * Sets planned_support to the affected tail number
 */
export async function updateEmpPlannedSupport(
  empId: string,
  targetDate: string,
  tailNumber: string
): Promise<boolean> {
  try {
    // First try to update existing record
    const { data: existingRecord, error: selectError } = await supabase
      .from('emp_planned')
      .select('*')
      .eq('id', empId)
      .eq('date', targetDate)
      .eq('task_type', 'planned-support')
      .maybeSingle();

    if (selectError) {
      console.error('Error checking existing emp_planned record:', selectError);
    }

    if (existingRecord) {
      // Update existing record
      const { error } = await supabase
        .from('emp_planned')
        .update({ task: tailNumber })
        .eq('id', empId)
        .eq('date', targetDate)
        .eq('task_type', 'planned-support');

      if (error) {
        console.error('Error updating emp_planned:', error);
        return false;
      }
    } else {
      // Insert new record
      const { error } = await supabase
        .from('emp_planned')
        .insert({
          id: empId,
          task_type: 'planned-support',
          task: tailNumber,
          date: targetDate
        });

      if (error) {
        console.error('Error inserting emp_planned:', error);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Exception updating emp_planned:', err);
    return false;
  }
}

/**
 * Update emp_actual for a replacement employee
 * Sets actual_task to the affected tail number
 */
export async function updateEmpActual(
  empId: string,
  empName: string,
  targetDate: string,
  task: string
): Promise<boolean> {
  try {
    // Get employee info from emp_360 for team/mobile
    const { data: empData } = await supabase
      .from('emp_360')
      .select('team')
      .eq('emp_id', empId)
      .single();

    // First check if record exists
    const { data: existingRecord, error: selectError } = await supabase
      .from('emp_actual')
      .select('*')
      .eq('id', empId)
      .eq('date', targetDate)
      .maybeSingle();

    if (selectError) {
      console.error('Error checking existing emp_actual record:', selectError);
    }

    if (existingRecord) {
      // Update existing record
      const { error } = await supabase
        .from('emp_actual')
        .update({ task: task })
        .eq('id', empId)
        .eq('date', targetDate);

      if (error) {
        console.error('Error updating emp_actual:', error);
        return false;
      }
    } else {
      // Insert new record
      const { error } = await supabase
        .from('emp_actual')
        .insert({
          id: empId,
          name: empName,
          team: empData?.team || '',
          date: targetDate,
          task: task,
          mobile: ''
        });

      if (error) {
        console.error('Error inserting emp_actual:', error);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Exception updating emp_actual:', err);
    return false;
  }
}

// =============================================================================
// DEMO MODE FLAG
// =============================================================================

/**
 * DEMO_MODE: When true, "Assign & Notify" only updates UI state without writing to DB.
 * Set to false for production/release to enable actual database writes.
 * Refresh the page to reset all UI state back to original.
 */
export const DEMO_MODE = true;

/**
 * Apply a fix for an alert - assigns replacement and marks original as NO SHOW
 *
 * Workflow:
 * 1. For the NO-SHOW employee (alert.empId):
 *    a. Update emp_planned -> planned_support to "No-show"
 *    b. Update emp_actual (df_actual) -> task to "NO SHOW"
 *
 * 2. For the REPLACEMENT employee:
 *    a. Update emp_planned -> planned_support to the affected tail number
 *    b. Update emp_actual (df_actual) -> task to the affected tail number
 *
 * Two cases for messaging:
 * - Case 1: Replacement's support was already a tail (not 'AV') - simple assignment
 * - Case 2: Replacement's support was 'AV' (no support activity) - show "Note: Support updated from AV"
 *
 * NOTE: When DEMO_MODE is true, skips DB writes and only returns success for UI updates.
 */
// =============================================================================
// ASSIGNMENT OVERVIEW AGGREGATION
// =============================================================================

/**
 * Assignment counts by role for a single tail
 */
export interface TailAssignmentCounts {
  cc: number;
  engr: number;
  tech: number;
}

/**
 * Assignment overview data for a single tail number
 */
export interface TailAssignmentOverview {
  tailNumber: string;
  core: TailAssignmentCounts;    // planned_core == planned_support AND support != 'AV'
  support: TailAssignmentCounts; // All other assignments to this tail
}

/**
 * Aggregate assignment data by tail number for a specific date
 *
 * Logic:
 * - Core: Cases where planned_core == planned_support AND planned_support != 'AV'
 *   (Employee is assigned to the same tail for both core and support work)
 * - Support: All other cases where the employee is assigned to the tail
 *   (Employee's support assignment differs from core, or core is different)
 *
 * @param gridData - The workforce grid data
 * @param targetDate - The date to aggregate for
 * @returns Array of tail assignment overviews sorted by tail number
 */
export function aggregateAssignmentsByTail(
  gridData: WorkforceGridRow[],
  targetDate: string
): TailAssignmentOverview[] {
  // Map to accumulate counts per tail
  const tailMap = new Map<string, {
    core: { cc: number; engr: number; tech: number };
    support: { cc: number; engr: number; tech: number };
  }>();

  gridData.forEach(row => {
    const dateDetails = row.dateDetails.get(targetDate);
    if (!dateDetails) return;

    const plannedCore = (dateDetails.plannedCore || '').trim().toUpperCase();
    const plannedSupport = (dateDetails.plannedSupport || '').trim().toUpperCase();

    // Skip if no assignments
    if (!plannedCore && !plannedSupport) return;

    // Determine employee role - match against RPC title values: CC, ENGR, TECH
    const role = row.role.toUpperCase().trim();
    const isCC = role === 'CC';
    const isEngineer = role === 'ENGR' || role === 'ENGINEER' || role === 'ENG';
    const isTech = role === 'TECH' || role === 'TECHNICIAN';
    // Default to tech if not CC or Engineer

    // Helper to increment counts
    const incrementCount = (counts: { cc: number; engr: number; tech: number }) => {
      if (isCC) {
        counts.cc++;
      } else if (isEngineer) {
        counts.engr++;
      } else if (isTech) {
        counts.tech++;
      } else {
        // Default unknown roles to tech
        counts.tech++;
      }
    };

    // Helper to ensure tail exists in map
    const ensureTail = (tail: string) => {
      if (!tailMap.has(tail)) {
        tailMap.set(tail, {
          core: { cc: 0, engr: 0, tech: 0 },
          support: { cc: 0, engr: 0, tech: 0 }
        });
      }
      return tailMap.get(tail)!;
    };

    // Check if this is a Core assignment:
    // planned_core == planned_support AND planned_support != 'AV'
    if (plannedCore && plannedSupport &&
        plannedCore === plannedSupport &&
        plannedSupport !== 'AV' &&
        isTailNumber(plannedCore)) {
      // This is a Core assignment
      const tailData = ensureTail(plannedCore);
      incrementCount(tailData.core);
    } else {
      // Support assignments - count based on planned_support if it's a tail
      if (plannedSupport && plannedSupport !== 'AV' && isTailNumber(plannedSupport)) {
        const tailData = ensureTail(plannedSupport);
        incrementCount(tailData.support);
      }
      // Also check planned_core if different from support and is a tail
      // This handles cases where core is assigned but support is different
      if (plannedCore && plannedCore !== plannedSupport &&
          plannedCore !== 'AV' && isTailNumber(plannedCore)) {
        // Core assignment exists but support is different, count in core
        const tailData = ensureTail(plannedCore);
        incrementCount(tailData.core);
      }
    }
  });

  // Convert map to array and sort by tail number
  const result: TailAssignmentOverview[] = [];
  tailMap.forEach((counts, tailNumber) => {
    result.push({
      tailNumber,
      core: counts.core,
      support: counts.support
    });
  });

  // Sort alphabetically by tail number
  result.sort((a, b) => a.tailNumber.localeCompare(b.tailNumber));

  return result;
}

export async function applyAlertFix(
  alert: AlertData,
  replacement: ReplacementCandidate
): Promise<{ success: boolean; message: string; isCoreTakenFromAssignment: boolean }> {
  try {
    const targetDate = alert.date;
    const tailNumber = alert.tailNumber || '';

    if (!tailNumber) {
      return {
        success: false,
        message: 'No tail number associated with this alert',
        isCoreTakenFromAssignment: false
      };
    }

    // Case 2: Employee's support was 'AV' (no support activity) and is now being assigned
    // This means they had a core assignment but no support, now support is being set
    const wasSupportAV = !replacement.support || replacement.support.toUpperCase() === 'AV';
    const hasCoreTail = Boolean(
      replacement.plannedCore &&
      replacement.plannedCore.toUpperCase() !== 'AV' &&
      replacement.plannedCore.trim() !== ''
    );

    // ========================================================================
    // DEMO MODE: Skip DB writes, just return success for UI updates
    // ========================================================================
    if (DEMO_MODE) {
      console.log('[DEMO MODE] Skipping DB writes for alert fix:', {
        noShowEmployee: alert.empName,
        replacementEmployee: replacement.empName,
        tailNumber,
        targetDate
      });

      // Build success message based on the case
      let message: string;
      if (wasSupportAV && hasCoreTail) {
        message = `${replacement.empName} assigned to ${tailNumber}. Note: Support updated from AV for this assignment.`;
      } else {
        message = `${replacement.empName} assigned to ${tailNumber}.`;
      }

      return {
        success: true,
        message,
        isCoreTakenFromAssignment: wasSupportAV && hasCoreTail
      };
    }

    // ========================================================================
    // PRODUCTION MODE: Write to DB
    // ========================================================================

    // ========================================================================
    // STEP 1: Update NO-SHOW employee
    // ========================================================================

    // 1a. Update no-show employee's planned_support to "No-show"
    const noShowPlannedResult = await updateEmpPlannedSupport(
      alert.empId,
      targetDate,
      'No-show'
    );

    if (!noShowPlannedResult) {
      console.error('Failed to update planned_support for no-show employee');
      // Continue anyway - this is not critical
    }

    // 1b. Update no-show employee's actual_task to 'NO SHOW'
    const noShowActualResult = await updateEmpActual(
      alert.empId,
      alert.empName,
      targetDate,
      'NO SHOW'
    );

    if (!noShowActualResult) {
      return {
        success: false,
        message: 'Failed to mark employee as NO SHOW',
        isCoreTakenFromAssignment: false
      };
    }

    // ========================================================================
    // STEP 2: Update REPLACEMENT employee
    // ========================================================================

    // 2a. Update replacement employee's planned_support to the affected tail
    const replacementPlannedResult = await updateEmpPlannedSupport(
      replacement.empId,
      targetDate,
      tailNumber
    );

    if (!replacementPlannedResult) {
      return {
        success: false,
        message: 'Failed to update planned support for replacement',
        isCoreTakenFromAssignment: false
      };
    }

    // 2b. Update replacement employee's actual_task to the affected tail
    const replacementActualResult = await updateEmpActual(
      replacement.empId,
      replacement.empName,
      targetDate,
      tailNumber
    );

    if (!replacementActualResult) {
      return {
        success: false,
        message: 'Failed to update actual task for replacement',
        isCoreTakenFromAssignment: false
      };
    }

    // Build success message based on the case
    let message: string;
    if (wasSupportAV && hasCoreTail) {
      // Case 2: Had core assignment, no support (AV), now assigned to support
      message = `${replacement.empName} assigned to ${tailNumber}. Note: Support updated from AV for this assignment.`;
    } else {
      // Case 1: Simple assignment (support was already a tail)
      message = `${replacement.empName} assigned to ${tailNumber}.`;
    }

    return {
      success: true,
      message,
      isCoreTakenFromAssignment: wasSupportAV && hasCoreTail
    };
  } catch (err) {
    console.error('Exception applying alert fix:', err);
    return {
      success: false,
      message: 'An error occurred while applying the fix',
      isCoreTakenFromAssignment: false
    };
  }
}

// =============================================================================
// SCENARIO-BASED DATA LOADING
// =============================================================================

/**
 * Interface for data returned from get_roster_with_scenario_overrides_with_trainings RPC
 */
interface ScenarioRosterRow {
  id: string;        // emp_id
  name: string;
  team: string;
  title: string;     // Role: CC, ENGR, TECH
  date: string;
  tail_num: string | null;
  task: string;
  planned_core: string | null;
  planned_support: string | null;
  bay: string | null;
  expired_trainings: string | null;
}

/**
 * Load workforce planning data for a specific scenario
 * Uses get_roster_with_scenario_overrides_with_trainings RPC to fetch scenario-specific roster data
 * 
 * IMPORTANT: The scenario RPC only returns data for May 1+ (future dates).
 * For the planning date (April 30) and before, we need to fetch from planning_master_fn_v2
 * and merge the results.
 * 
 * @param scenarioName - The name of the scenario to load
 * @param currentDate - The reference "today" date (defaults to CURRENT_DATE)
 * @returns Grid data and date range for the scenario
 */
export async function loadScenarioData(
  scenarioName: string,
  currentDate: string = CURRENT_DATE
): Promise<{
  gridData: WorkforceGridRow[];
  dateRange: string[];
  shiftCodes: Set<string>;
}> {
  console.log('[Scenario] Loading data for scenario:', scenarioName);

  // Load shift codes for classification
  const shiftCodes = await loadShiftCodes();

  // Calculate date range (same as default view)
  const winStartDate = getWindowStartDate(currentDate);
  const winEndDate = getWindowEndDate(currentDate);
  const dateRange = getDateRange(winStartDate, winEndDate);

  // Normalize the planning date
  const normalizedPlanningDate = currentDate; // e.g., '2022-04-30'

  // Fetch BOTH scenario data AND planning_master_fn_v2 data in parallel
  // The scenario RPC only returns May 1+ data, so we need planning_master_fn_v2 for April 30 and before
  const [scenarioResult, planningMasterResult] = await Promise.all([
    // Scenario RPC - returns May 1+ data with scenario overrides
    supabase
      .rpc('get_roster_with_scenario_overrides_with_trainings', { p_scenario_name: scenarioName })
      .limit(100000),
    // Planning master - returns data for planning date (April 30) and before
    // Using planning_master_fn_v2 (same as default loading) for consistency
    supabase
      .rpc('planning_master_fn_v2', {
        p_curr_date: normalizedPlanningDate,
        p_win_start: winStartDate,
        p_win_end: normalizedPlanningDate  // Only fetch up to planning date (April 30)
      })
  ]);

  if (scenarioResult.error) {
    console.error('[Scenario] Error loading scenario data:', scenarioResult.error);
    throw new Error(`Failed to load scenario: ${scenarioResult.error.message}`);
  }

  const scenarioData = (scenarioResult.data || []) as ScenarioRosterRow[];
  console.log(`[Scenario] Loaded ${scenarioData.length} rows from scenario RPC for: ${scenarioName}`);

  // Process planning_master_fn_v2 data for dates <= planning date
  const planningMasterRows: ScenarioRosterRow[] = [];
  if (planningMasterResult.data && !planningMasterResult.error) {
    console.log(`[Scenario] Loaded ${planningMasterResult.data.length} rows from planning_master_fn_v2 for dates <= ${normalizedPlanningDate}`);
    
    (planningMasterResult.data as PlanningMasterRecord[]).forEach((row: PlanningMasterRecord) => {
      if (row.id) {
        const rosterEntry = row.roster_entry || '';
        const actualTask = row.actual_task || '';
        // Use actual_task if available, otherwise roster_entry
        const displayTask = actualTask || rosterEntry;
        
        // Check if it's a tail number
        const isTailValue = isTailNumber(displayTask);
        
        planningMasterRows.push({
          id: row.id,
          name: row.name || row.id,
          team: row.team || '',
          title: row.title || 'ENGR',
          date: row.date,
          tail_num: isTailValue ? displayTask : null,
          task: displayTask,
          planned_core: row.planned_core || '',
          planned_support: row.planned_support || '',
          bay: null,
          expired_trainings: row.expired_trainings || null,
        });
      }
    });
    console.log(`[Scenario] Created ${planningMasterRows.length} rows from planning_master_fn_v2`);
  } else if (planningMasterResult.error) {
    console.warn('[Scenario] Error calling planning_master_fn_v2:', planningMasterResult.error);
  }

  // Filter scenario data to only include dates AFTER planning date (May 1+)
  // This avoids duplicate data for the planning date
  const futureScenarioRows = scenarioData.filter(row => {
    const dateStr = normalizeDateToString(row.date);
    return dateStr && dateStr > normalizedPlanningDate;
  });
  console.log(`[Scenario] After filtering: ${futureScenarioRows.length} future rows from scenario RPC (removed ${scenarioData.length - futureScenarioRows.length} planning date rows)`);

  // Merge: planning_master_fn_v2 data (for dates <= April 30) + scenario data (for May 1+)
  const mergedData = [...planningMasterRows, ...futureScenarioRows];
  console.log(`[Scenario] Total merged rows: ${mergedData.length} (${planningMasterRows.length} from planning_master_fn_v2 + ${futureScenarioRows.length} from scenario RPC)`);

  // Transform merged data into WorkforceGridRow format
  const gridData = processScenarioData(mergedData, dateRange, currentDate);

  console.log(`[Scenario] Processed ${gridData.length} employees for scenario: ${scenarioName}`);

  return {
    gridData,
    dateRange,
    shiftCodes
  };
}

/**
 * Process scenario roster data into WorkforceGridRow format
 * Similar to processGridData but handles ScenarioRosterRow structure
 */
function processScenarioData(
  scenarioData: ScenarioRosterRow[],
  dateRange: string[],
  currentDate: string = CURRENT_DATE
): WorkforceGridRow[] {
  // Group records by employee ID
  const employeeMap = new Map<string, {
    id: string;
    name: string;
    team: string;
    title: string;
    dateRecords: Map<string, ScenarioRosterRow[]>;
  }>();

  // Process each scenario row
  scenarioData.forEach(record => {
    const empId = record.id;
    const dateStr = normalizeDateToString(record.date);

    if (!dateStr) {
      return;
    }

    if (!employeeMap.has(empId)) {
      employeeMap.set(empId, {
        id: empId,
        name: record.name,
        team: record.team,
        title: record.title || '',
        dateRecords: new Map()
      });
    }

    const empDateRecords = employeeMap.get(empId)!.dateRecords;
    if (!empDateRecords.has(dateStr)) {
      empDateRecords.set(dateStr, []);
    }
    empDateRecords.get(dateStr)!.push(record);
  });

  // Convert to WorkforceGridRow array
  const gridRows: WorkforceGridRow[] = [];

  employeeMap.forEach((empData, empId) => {
    const dailyData = new Map<string, DailyCellData>();
    const dateDetails = new Map<string, { plannedCore: string; plannedSupport: string; ttlLogin: string }>();

    // Initialize all dates in range
    dateRange.forEach(dateStr => {
      dailyData.set(dateStr, {
        displayValue: '-',
        isRosterLike: false,
        isTail: false
      });
      dateDetails.set(dateStr, {
        plannedCore: '',
        plannedSupport: '',
        ttlLogin: ''
      });
    });

    // Populate with actual data
    empData.dateRecords.forEach((records, dateStr) => {
      if (!dateRange.includes(dateStr)) return;

      // Use the first record's data (or concatenate if multiple)
      const primaryRecord = records[0];
      
      // Determine display value - prefer task/tail_num
      let displayValue = primaryRecord.task || primaryRecord.tail_num || '-';
      
      // If we have multiple records with different tails, concatenate them
      if (records.length > 1) {
        const allTails = records
          .map(r => r.tail_num || r.task)
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i); // Unique values
        
        if (allTails.length > 1) {
          displayValue = allTails.join('/ ');
        }
      }

      // Classify the display value
      const trimmedValue = displayValue.trim();
      const isRoster = isRosterLike(trimmedValue);
      const isTail = !isRoster && isTailNumber(trimmedValue);

      dailyData.set(dateStr, {
        displayValue: trimmedValue || '-',
        isRosterLike: isRoster,
        isTail: isTail,
        rosterCode: isRoster ? trimmedValue : undefined,
        employeeTrainings: primaryRecord.expired_trainings || undefined
      });

      dateDetails.set(dateStr, {
        plannedCore: primaryRecord.planned_core || '',
        plannedSupport: primaryRecord.planned_support || '',
        ttlLogin: '' // Scenario RPC doesn't provide TTL login
      });
    });

    // Get most common planned core/support for the employee row (for default display)
    let mostCommonCore = '';
    let mostCommonSupport = '';
    const coreCount = new Map<string, number>();
    const supportCount = new Map<string, number>();

    dateDetails.forEach(details => {
      if (details.plannedCore) {
        coreCount.set(details.plannedCore, (coreCount.get(details.plannedCore) || 0) + 1);
      }
      if (details.plannedSupport) {
        supportCount.set(details.plannedSupport, (supportCount.get(details.plannedSupport) || 0) + 1);
      }
    });

    let maxCore = 0;
    coreCount.forEach((count, value) => {
      if (count > maxCore) {
        maxCore = count;
        mostCommonCore = value;
      }
    });

    let maxSupport = 0;
    supportCount.forEach((count, value) => {
      if (count > maxSupport) {
        maxSupport = count;
        mostCommonSupport = value;
      }
    });

    gridRows.push({
      empId: empData.id,
      name: empData.name,
      team: empData.team,
      role: empData.title || 'ENGR',
      plannedCore: mostCommonCore,
      plannedSupport: mostCommonSupport,
      ttlLogin: '',
      dailyData,
      dateDetails
    });
  });

  // Sort by employee name
  gridRows.sort((a, b) => a.name.localeCompare(b.name));

  return gridRows;
}