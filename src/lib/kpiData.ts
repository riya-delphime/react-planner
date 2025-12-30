import { supabase } from './supabase';

/**
 * Planning KPI Cube View Interface
 * Aggregated KPI data with dimension breakdowns
 */
export interface PlanningKpiRecord {
  kpi: string;
  year_month: string;
  dim_type: string;  // 'All', 'Engine', 'Customer', etc.
  dim_value: string; // 'All', 'CFM56', 'Emirates', etc.
  value: number;
}

/**
 * Frontend-friendly KPI interface
 */
export interface PlanningKpi {
  kpi: string;
  yearMonth: string;
  dimType: string;
  dimValue: string;
  value: number;
}

/**
 * KPI data grouped by dimension for chart display
 */
export interface KpiByDimension {
  dimValue: string;
  value: number;
}

/**
 * KPI data for a specific month with dimension breakdown
 */
export interface MonthlyKpiData {
  yearMonth: string;
  total: number;
  breakdown: KpiByDimension[];  // Top 3 + Others
}

/**
 * Training expiry record from emp_trainings_in_window_weeks function
 */
export interface TrainingExpiryRecord {
  emp_id: string;
  name: string;
  training_name: string;
  start_date: string;
  end_date: string;
}

/**
 * Frontend-friendly training expiry interface
 */
export interface TrainingExpiry {
  empId: string;
  empName: string;
  trainingName: string;
  startDate: string;
  endDate: string;
}

/**
 * Training expiry grouped by training name for display
 */
export interface TrainingExpiryGroup {
  trainingName: string;
  count: number;
  employees: { id: string; name: string }[];
}

// ============================================================================
// KPI Cube Data Access Functions
// ============================================================================

/**
 * Convert database record to frontend format
 */
function convertKpiRecord(record: PlanningKpiRecord): PlanningKpi {
  return {
    kpi: record.kpi,
    yearMonth: record.year_month,
    dimType: record.dim_type,
    dimValue: record.dim_value,
    value: record.value,
  };
}

/**
 * Fetch all KPI data from planning_kpi_cube
 */
export async function getAllKpiData(): Promise<PlanningKpi[]> {
  try {
    const { data, error } = await supabase
      .from('planning_kpi_cube')
      .select('*')
      .order('year_month', { ascending: true });

    if (error) {
      console.error('Error fetching KPI data:', error);
      return [];
    }

    return (data || []).map(convertKpiRecord);
  } catch (err) {
    console.error('Exception fetching KPI data:', err);
    return [];
  }
}

/**
 * Fetch KPI data for a specific KPI type
 */
export async function getKpiByType(kpiType: string): Promise<PlanningKpi[]> {
  const { data, error } = await supabase
    .from('planning_kpi_cube')
    .select('*')
    .eq('kpi', kpiType)
    .order('year_month', { ascending: true });

  if (error) {
    console.error('Error fetching KPI data by type:', error);
    throw error;
  }

  return (data || []).map(convertKpiRecord);
}

/**
 * Fetch KPI data filtered by dimension type
 */
export async function getKpiByDimension(dimType: string): Promise<PlanningKpi[]> {
  const { data, error } = await supabase
    .from('planning_kpi_cube')
    .select('*')
    .eq('dim_type', dimType)
    .order('year_month', { ascending: true });

  if (error) {
    console.error('Error fetching KPI data by dimension:', error);
    throw error;
  }

  return (data || []).map(convertKpiRecord);
}

/**
 * Get unique dimension types available in the KPI cube
 */
export async function getAvailableDimensions(): Promise<string[]> {
  const { data, error } = await supabase
    .from('planning_kpi_cube')
    .select('dim_type')
    .order('dim_type');

  if (error) {
    console.error('Error fetching dimensions:', error);
    return ['All'];
  }

  const unique = [...new Set((data || []).map(d => d.dim_type).filter(Boolean))];
  return unique;
}

/**
 * Get unique KPI types available
 */
export async function getAvailableKpiTypes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('planning_kpi_cube')
    .select('kpi')
    .order('kpi');

  if (error) {
    console.error('Error fetching KPI types:', error);
    return [];
  }

  const unique = [...new Set((data || []).map(d => d.kpi).filter(Boolean))];
  return unique;
}

/**
 * Process KPI data to get Top 3 dimensions + Others for a specific KPI and month
 */
export function getTop3PlusOthers(
  kpiData: PlanningKpi[],
  kpiType: string,
  yearMonth: string,
  dimType: string
): KpiByDimension[] {
  // Filter data for specific KPI, month, and dimension type (exclude 'All')
  const filtered = kpiData.filter(
    d => d.kpi === kpiType &&
         d.yearMonth === yearMonth &&
         d.dimType === dimType &&
         d.dimValue !== 'All'
  );

  // Sort by value descending
  const sorted = [...filtered].sort((a, b) => b.value - a.value);

  // Take top 3
  const top3 = sorted.slice(0, 3).map(d => ({
    dimValue: d.dimValue,
    value: d.value,
  }));

  // Sum the rest as "Others"
  const othersSum = sorted.slice(3).reduce((sum, d) => sum + d.value, 0);

  if (othersSum > 0) {
    top3.push({
      dimValue: 'Others',
      value: othersSum,
    });
  }

  return top3;
}

/**
 * Get monthly KPI data with Top 3 + Others breakdown
 */
export function getMonthlyKpiWithBreakdown(
  kpiData: PlanningKpi[],
  kpiType: string,
  dimType: string
): MonthlyKpiData[] {
  // Filter data for this KPI type
  const kpiFiltered = kpiData.filter(d => d.kpi === kpiType);

  // Get unique months from the "All/All" records (these are the totals)
  const allAllRecords = kpiFiltered.filter(d => d.dimType === 'All' && d.dimValue === 'All');
  const months = [...new Set(allAllRecords.map(d => d.yearMonth))].sort();

  // If no All/All records, try getting months from any records
  const finalMonths = months.length > 0
    ? months
    : [...new Set(kpiFiltered.map(d => d.yearMonth))].sort();

  return finalMonths.map(yearMonth => {
    // Get total (dim_type = 'All', dim_value = 'All')
    const totalRecord = kpiFiltered.find(
      d => d.yearMonth === yearMonth && d.dimType === 'All' && d.dimValue === 'All'
    );

    // If no All/All total, sum up from the selected dimension
    let total = totalRecord?.value || 0;

    const breakdown = dimType === 'All'
      ? []
      : getTop3PlusOthers(kpiData, kpiType, yearMonth, dimType);

    // If total is 0 but we have breakdown, sum from breakdown
    if (total === 0 && breakdown.length > 0) {
      total = breakdown.reduce((sum, b) => sum + b.value, 0);
    }

    return {
      yearMonth,
      total,
      breakdown,
    };
  });
}

// ============================================================================
// Training Expiry Data Access Functions
// ============================================================================

/**
 * Fetch employees with trainings expiring within specified weeks
 * Calls the emp_trainings_in_window_weeks database function
 */
export async function getTrainingsExpiringInWeeks(weeks: number): Promise<TrainingExpiry[]> {
  const { data, error } = await supabase
    .rpc('emp_trainings_in_window_weeks', { weeks_ahead: weeks });

  if (error) {
    console.error('Error fetching training expiry data:', error);
    throw error;
  }

  return (data || []).map((record: TrainingExpiryRecord) => ({
    empId: record.emp_id,
    empName: record.name,
    trainingName: record.training_name,
    startDate: record.start_date,
    endDate: record.end_date,
  }));
}

/**
 * Group training expiry data by training name for display
 */
export function groupTrainingsByName(trainings: TrainingExpiry[]): TrainingExpiryGroup[] {
  const grouped = new Map<string, { id: string; name: string }[]>();

  trainings.forEach(t => {
    if (!grouped.has(t.trainingName)) {
      grouped.set(t.trainingName, []);
    }
    grouped.get(t.trainingName)!.push({ id: t.empId, name: t.empName });
  });

  return Array.from(grouped.entries())
    .map(([trainingName, employees]) => ({
      trainingName,
      count: employees.length,
      employees,
    }))
    .sort((a, b) => b.count - a.count);  // Sort by count descending
}