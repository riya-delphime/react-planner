/**
 * Workforce Planning Component - Redesigned
 *
 * Layout: Two horizontal panes
 * - TOP: Assignments & Roster Plan (primary grid from planning_master_fn)
 * - BOTTOM: Assignment Overview (structure preserved, redesign deferred)
 *
 * Key Features:
 * - Date selector moved to top-right after KPI block
 * - Date ruler/slider highlights selected date column
 * - Cell rendering follows zone rules (past/current/future)
 * - Roster legend styling per reference screenshots
 * - Alerts panel with no-show/leave counts
 * - Search bar for employee and tail search
 * - Recommendations workflow for alert resolution
 *
 * Reference Screenshots:
 * - Slider behavior: Selected column has full-height highlight band + boundary
 * - Roster legend: Different shading for roster codes vs tail numbers
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, AlertTriangle, Search, X, Check, XCircle, CheckCircle2, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown, User, Settings, Play } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmployeeDetailDrawer } from './EmployeeDetailDrawer';
import {
  CURRENT_DATE,
  initializeWorkforcePlanning,
  formatDateForHeader,
  formatDateForDetailsHeader,
  getDateZone,
  getCellColors,
  CELL_COLORS,
  NO_SHOW_COLORS,
  extractAlertsForDate,
  groupAlertsByTail,
  fetchReplacementCandidates,
  applyAlertFix,
  isTailNumber,
  aggregateAssignmentsByTail,
  formatRoleForDisplay,
  type WorkforceGridRow,
  type AlertData,
  type TailAlertSummary,
  type ReplacementCandidate,
} from '../lib/workforcePlanningData';

/**
 * Format TTL Login timestamp - strip date portion, show only time in AM/PM format
 * Input: "30/04/2022 7:02" -> Output: "7:02 AM"
 * Input: "30/04/2022 14:30" -> Output: "2:30 PM"
 */
function formatTtlLogin(ttlLogin: string | undefined): string {
  if (!ttlLogin || ttlLogin === '-' || ttlLogin.trim() === '') return '-';

  let hours: number | null = null;
  let minutes: number | null = null;

  // Try to extract time from various formats
  // Format: "30/04/2022 7:02" or "DD/MM/YYYY H:mm" (single or double digit hour)
  const ddmmyyyyMatch = ttlLogin.match(/\d{2}\/\d{2}\/\d{4}\s+(\d{1,2}):(\d{2})/);
  if (ddmmyyyyMatch) {
    hours = parseInt(ddmmyyyyMatch[1], 10);
    minutes = parseInt(ddmmyyyyMatch[2], 10);
  }

  // Format: ISO "2022-04-30T14:30:00"
  if (hours === null) {
    const isoMatch = ttlLogin.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) {
      hours = parseInt(isoMatch[1], 10);
      minutes = parseInt(isoMatch[2], 10);
    }
  }

  // Format: "HH:mm" or "H:mm" already
  if (hours === null) {
    const timeOnlyMatch = ttlLogin.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (timeOnlyMatch) {
      hours = parseInt(timeOnlyMatch[1], 10);
      minutes = parseInt(timeOnlyMatch[2], 10);
    }
  }

  // If it's just a time with seconds "14:30:00"
  if (hours === null) {
    const timeSecsMatch = ttlLogin.match(/(\d{1,2}):(\d{2}):\d{2}/);
    if (timeSecsMatch) {
      hours = parseInt(timeSecsMatch[1], 10);
      minutes = parseInt(timeSecsMatch[2], 10);
    }
  }

  // Convert to 12-hour format with AM/PM
  if (hours !== null && minutes !== null) {
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12; // Convert 0 to 12 for midnight
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  // Return as-is if we can't parse
  return ttlLogin;
}

// =============================================================================
// RECOMMENDATION ITEM STATE
// =============================================================================
interface RecommendationState {
  alertKey: string; // empId + date
  status: 'pending' | 'fixed' | 'no-fix';
  selectedReplacement?: ReplacementCandidate;
  candidates: ReplacementCandidate[];
  isLoading: boolean;
  message?: string;
  isCoreTakenFromAssignment?: boolean;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function WorkforcePlanning() {
  // State
  const [gridData, setGridData] = useState<WorkforceGridRow[]>([]);
  const [dateRange, setDateRange] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(CURRENT_DATE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Utilization KPIs state
  const [weeklyUtilization, setWeeklyUtilization] = useState<number>(0);
  const [dailyUtilization, setDailyUtilization] = useState<number>(0);
  const [engineerUtilization, setEngineerUtilization] = useState<number>(0);
  const [technicianUtilization, setTechnicianUtilization] = useState<number>(0);
  const [weeklyEngineerUtilization, setWeeklyEngineerUtilization] = useState<number>(0);
  const [weeklyTechnicianUtilization, setWeeklyTechnicianUtilization] = useState<number>(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchMode, setSearchMode] = useState<'employee' | 'tail' | 'alert' | null>(null);

  // Alerts state
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [showAlertDetails, setShowAlertDetails] = useState(false);
  const [alertDetailsTab, setAlertDetailsTab] = useState<'summary' | 'recommendations'>('summary');
  const [tailSummaries, setTailSummaries] = useState<TailAlertSummary[]>([]);

  // Recommendations state
  const [recommendationStates, setRecommendationStates] = useState<Map<string, RecommendationState>>(new Map());
  const [selectedReplacementEmpIds, setSelectedReplacementEmpIds] = useState<Set<string>>(new Set());
  // Track pending selection per alert (selected from dropdown but not yet applied)
  const [pendingSelections, setPendingSelections] = useState<Map<string, ReplacementCandidate>>(new Map());

  // UI-only cell overrides for demo mode (empId-date -> { displayValue, isNoShow, supportValue })
  // These show the visual changes without DB writes
  // displayValue = value for the Schedule column (30-Apr)
  // supportValue = value for the Support column in Details section
  const [cellOverrides, setCellOverrides] = useState<Map<string, { displayValue: string; isNoShow: boolean; supportValue?: string }>>(new Map());

  // Role column sorting state: null (unsorted), 'asc', or 'desc'
  const [roleSortDirection, setRoleSortDirection] = useState<'asc' | 'desc' | null>(null);

  // Employee detail drawer state
  const [showEmployeeDrawer, setShowEmployeeDrawer] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<WorkforceGridRow | null>(null);

    // Settings popup state for Active Scenario
    const [showSettingsPopup, setShowSettingsPopup] = useState(false);
    const [activeScenario, setActiveScenario] = useState<string>('');
    const [savedScenarios, setSavedScenarios] = useState<Array<{
      id: string;
      scenario_name: string;
      created_at: string;
      status: string;
      source: 'ai' | 'legacy';
    }>>([]);  

  // Refs for scroll synchronization
  const dateHeaderRef = useRef<HTMLDivElement>(null);
  const selectedColumnRef = useRef<HTMLDivElement>(null);
  // Refs for vertical scroll sync across all three sections
  const fixedColumnsBodyRef = useRef<HTMLDivElement>(null);
  const detailsColumnsBodyRef = useRef<HTMLDivElement>(null);
  const dateColumnsBodyRef = useRef<HTMLDivElement>(null);
  // Track if initial scroll to CURRENT_DATE has been done
  const initialScrollDoneRef = useRef<boolean>(false);

  // Load data on mount
  useEffect(() => {
    loadData();
    loadSavedScenarios();
  }, []);

  // Load saved scenarios for settings popup
  async function loadSavedScenarios() {
    // Load from AI allocation scenarios table
    const { data: aiData } = await supabase
      .from('ai_allocation_scenarios_v2')
      .select('id, scenario_name, created_at, status')
      .order('created_at', { ascending: false });

    // Load from legacy planning_scenarios table
    const { data: legacyData } = await supabase
      .from('planning_scenarios')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });

    const allScenarios: Array<{
      id: string;
      scenario_name: string;
      created_at: string;
      status: string;
      source: 'ai' | 'legacy';
    }> = [];

    // Add AI scenarios
    if (aiData) {
      aiData.forEach((s: any) => {
        allScenarios.push({
          id: s.id,
          scenario_name: s.scenario_name,
          created_at: s.created_at,
          status: s.status || 'draft',
          source: 'ai',
        });
      });
    }

    // Add legacy scenarios
    if (legacyData) {
      legacyData.forEach((s: any) => {
        allScenarios.push({
          id: `legacy_${s.id}`,
          scenario_name: s.name,
          created_at: s.created_at,
          status: 'legacy',
          source: 'legacy',
        });
      });
    }

    // Sort by created_at descending
    allScenarios.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    setSavedScenarios(allScenarios);
  }


  // Extract alerts when grid data or selected date changes
  useEffect(() => {
    if (gridData.length > 0) {
      const extractedAlerts = extractAlertsForDate(gridData, selectedDate);
      setAlerts(extractedAlerts);
      setTailSummaries(groupAlertsByTail(extractedAlerts));
    }
  }, [gridData, selectedDate]);

  // Scroll selected date column to align left edge with TTL column edge
  // This handles user-initiated date changes (after initial scroll is done)
  useEffect(() => {
    // Only handle user-initiated date changes, not initial scroll
    // Initial scroll is handled by the visibility-aware useEffect below
    if (dateColumnsBodyRef.current && dateRange.length > 0 && initialScrollDoneRef.current) {
      const selectedIndex = dateRange.indexOf(selectedDate);
      if (selectedIndex !== -1) {
        const columnWidth = 80; // w-20 = 5rem = 80px
        const scrollLeft = selectedIndex * columnWidth;

        // Smooth scroll for user-initiated changes
        dateColumnsBodyRef.current.scrollTo({
          left: scrollLeft,
          behavior: 'smooth'
        });
        if (dateHeaderRef.current) {
          dateHeaderRef.current.scrollTo({
            left: scrollLeft,
            behavior: 'smooth'
          });
        }
      }
    }
  }, [selectedDate, dateRange]);

  // Ensure initial scroll happens when component becomes visible (tab switch)
  // This handles the case where the component was mounted but hidden
  useEffect(() => {
    if (dateRange.length > 0 && !isLoading) {
      const performInitialScroll = () => {
        if (dateColumnsBodyRef.current) {
          const offsetWidth = dateColumnsBodyRef.current.offsetWidth;
          const selectedIndex = dateRange.indexOf(CURRENT_DATE);

          if (offsetWidth > 0 && selectedIndex !== -1 && !initialScrollDoneRef.current) {
            const columnWidth = 80;
            const scrollLeft = selectedIndex * columnWidth;
            console.log('[Scroll Debug] Scrolling to:', scrollLeft);

            dateColumnsBodyRef.current.scrollTo({ left: scrollLeft, behavior: 'instant' });
            if (dateHeaderRef.current) {
              dateHeaderRef.current.scrollTo({ left: scrollLeft, behavior: 'instant' });
            }
            initialScrollDoneRef.current = true;
            return true;
          }
        }
        return false;
      };

      // Try immediately
      if (performInitialScroll()) return;

      // Use ResizeObserver to detect when the element gets dimensions (becomes visible)
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        console.log('[Scroll Debug] ResizeObserver:', entry?.contentRect?.width);
        if (entry && entry.contentRect.width > 0 && !initialScrollDoneRef.current) {
          requestAnimationFrame(() => {
            performInitialScroll();
          });
        }
      });

      if (dateColumnsBodyRef.current) {
        resizeObserver.observe(dateColumnsBodyRef.current);
      }

      // Polling fallback
      const intervalId = setInterval(() => {
        if (!initialScrollDoneRef.current && performInitialScroll()) {
          console.log('[Scroll Debug] Polling succeeded');
          clearInterval(intervalId);
        }
      }, 200);

      return () => {
        resizeObserver.disconnect();
        clearInterval(intervalId);
      };
    }
  }, [dateRange, isLoading]);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const { gridData: data, dateRange: dates } = await initializeWorkforcePlanning(CURRENT_DATE);
      setGridData(data);
      setDateRange(dates);

      // Calculate utilization KPIs based on loaded data (for initial load with CURRENT_DATE)
      calculateUtilization(data, dates, CURRENT_DATE);
    } catch (err) {
      console.error('Failed to load workforce planning data:', err);
      setError('Failed to load data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  // Recalculate utilization when selected date changes
  useEffect(() => {
    if (gridData.length > 0 && dateRange.length > 0) {
      calculateUtilization(gridData, dateRange, selectedDate);
    }
  }, [selectedDate, gridData, dateRange]);

  // Calculate weekly and daily utilization from grid data
  // Utilization = employees working on aircraft (tail numbers) / total employees
  // Excludes: HSE-KPNG, HSKPNG, PRESERVATION, Night Shift, Quarantine, MVMNT, AL, SK, TR, O, DO
  // forDate: the selected date to calculate daily utilization and week-to-date (7 days ending on forDate)
  function calculateUtilization(data: WorkforceGridRow[], dates: string[], forDate: string) {
    if (data.length === 0 || dates.length === 0) {
      setWeeklyUtilization(0);
      setDailyUtilization(0);
      setEngineerUtilization(0);
      setTechnicianUtilization(0);
      setWeeklyEngineerUtilization(0);
      setWeeklyTechnicianUtilization(0);
      return;
    }

    // Split employees by role: ENGR, CC, TECH (matching RPC values)
    const engineers = data.filter(row => row.role.toUpperCase() === 'ENGR');
    const ccStaff = data.filter(row => row.role.toUpperCase() === 'CC');
    const technicians = data.filter(row => row.role.toUpperCase() === 'TECH');

    const totalEmployees = data.length;
    const totalEngineers = engineers.length;
    const totalCc = ccStaff.length;
    const totalTechnicians = technicians.length;

    // Calculate daily utilization (for selected date)
    let dailyAssigned = 0;
    let dailyEngineersAssigned = 0;
    let dailyCcAssigned = 0;
    let dailyTechniciansAssigned = 0;

    // Debug: count cells with tail-looking values but isTail=false
    let debugMismatchCount = 0;
    const debugSamples: string[] = [];

    data.forEach(row => {
      const cellData = row.dailyData.get(forDate);
      const roleUpper = row.role.toUpperCase();
      if (cellData && cellData.isTail) {
        dailyAssigned++;
        if (roleUpper === 'ENGR') {
          dailyEngineersAssigned++;
        } else if (roleUpper === 'CC') {
          dailyCcAssigned++;
        } else if (roleUpper === 'TECH') {
          dailyTechniciansAssigned++;
        }
      }
      // Debug: check for potential mismatches
      if (cellData && cellData.displayValue && !cellData.isTail) {
        const val = cellData.displayValue.toUpperCase();
        // Check if it looks like a tail but isn't flagged as one
        if (/^[A-Z]{1,2}-[A-Z0-9]{2,5}/.test(val) || /^[A-Z]{2}[0-9]{3,4}/.test(val)) {
          debugMismatchCount++;
          if (debugSamples.length < 5) {
            debugSamples.push(`${row.empId}: "${cellData.displayValue}" (isTail=${cellData.isTail}, isRoster=${cellData.isRosterLike})`);
          }
        }
      }
    });

    // Log debug info
    console.log(`[Utilization Debug] Date: ${forDate}, Total: ${totalEmployees}, Assigned: ${dailyAssigned}, Mismatches: ${debugMismatchCount}`);
    if (debugSamples.length > 0) {
      console.log('[Utilization Debug] Sample mismatches:', debugSamples);
    }

    // Additional debug: log first 5 cells for this date to see what values they have
    const cellSamples: string[] = [];
    data.slice(0, 10).forEach(row => {
      const cellData = row.dailyData.get(forDate);
      if (cellData) {
        cellSamples.push(`${row.empId}: display="${cellData.displayValue}", isTail=${cellData.isTail}, isRoster=${cellData.isRosterLike}`);
      } else {
        cellSamples.push(`${row.empId}: NO CELL DATA for ${forDate}`);
      }
    });
    console.log(`[Utilization Debug] First 10 cell samples for ${forDate}:`, cellSamples);

    const daily = totalEmployees > 0 ? Math.round((dailyAssigned / totalEmployees) * 100) : 0;
    const dailyEng = totalEngineers > 0 ? Math.round((dailyEngineersAssigned / totalEngineers) * 100) : 0;
    const dailyCc = totalCc > 0 ? Math.round((dailyCcAssigned / totalCc) * 100) : 0;
    const dailyTech = totalTechnicians > 0 ? Math.round((dailyTechniciansAssigned / totalTechnicians) * 100) : 0;

    setDailyUtilization(daily);
    setEngineerUtilization(dailyEng);
    setTechnicianUtilization(dailyTech);

    // Calculate weekly utilization (last 7 days ending on selected date)
    const selectedDateObj = new Date(forDate);
    const weekStartObj = new Date(selectedDateObj);
    weekStartObj.setDate(weekStartObj.getDate() - 6); // 7 days including selected date
    const weekStartStr = weekStartObj.toISOString().split('T')[0];

    // Get dates in the week range
    const weekDates = dates.filter(d => d >= weekStartStr && d <= forDate);

    let totalWeeklySlots = 0;
    let assignedWeeklySlots = 0;
    let weeklyEngSlots = 0;
    let weeklyEngAssigned = 0;
    let weeklyCcSlots = 0;
    let weeklyCcAssigned = 0;
    let weeklyTechSlots = 0;
    let weeklyTechAssigned = 0;

    data.forEach(row => {
      const roleUpper = row.role.toUpperCase();
      weekDates.forEach(dateStr => {
        totalWeeklySlots++;
        const cellData = row.dailyData.get(dateStr);

        if (roleUpper === 'ENGR') {
          weeklyEngSlots++;
          if (cellData && cellData.isTail) {
            weeklyEngAssigned++;
            assignedWeeklySlots++;
          }
        } else if (roleUpper === 'CC') {
          weeklyCcSlots++;
          if (cellData && cellData.isTail) {
            weeklyCcAssigned++;
            assignedWeeklySlots++;
          }
        } else if (roleUpper === 'TECH') {
          weeklyTechSlots++;
          if (cellData && cellData.isTail) {
            weeklyTechAssigned++;
            assignedWeeklySlots++;
          }
        }
      });
    });

    const weekly = totalWeeklySlots > 0 ? Math.round((assignedWeeklySlots / totalWeeklySlots) * 100) : 0;
    const weeklyEng = weeklyEngSlots > 0 ? Math.round((weeklyEngAssigned / weeklyEngSlots) * 100) : 0;
    const weeklyCc = weeklyCcSlots > 0 ? Math.round((weeklyCcAssigned / weeklyCcSlots) * 100) : 0;
    const weeklyTech = weeklyTechSlots > 0 ? Math.round((weeklyTechAssigned / weeklyTechSlots) * 100) : 0;

    setWeeklyUtilization(weekly);
    setWeeklyEngineerUtilization(weeklyEng);
    setWeeklyTechnicianUtilization(weeklyTech);
  }

  // Equivalent search terms (synonyms that should match each other)
  const SEARCH_SYNONYMS: Record<string, string[]> = {
    'HSKPNG': ['HSKPNG', 'HSE-KPNG', 'HSEKPNG', 'HOUSEKEEPING'],
    'HSE-KPNG': ['HSKPNG', 'HSE-KPNG', 'HSEKPNG', 'HOUSEKEEPING'],
    'HSEKPNG': ['HSKPNG', 'HSE-KPNG', 'HSEKPNG', 'HOUSEKEEPING'],
    'HOUSEKEEPING': ['HSKPNG', 'HSE-KPNG', 'HSEKPNG', 'HOUSEKEEPING'],
  };

  // Get all search terms including synonyms
  const getSearchTerms = (query: string): string[] => {
    const upperQuery = query.toUpperCase().trim();
    const synonyms = SEARCH_SYNONYMS[upperQuery];
    return synonyms ? synonyms : [upperQuery];
  };

  // Filter grid data based on search query
  const filteredGridData = useMemo(() => {
    let result: WorkforceGridRow[];

    if (!searchQuery.trim()) {
      setSearchMode(null);
      result = gridData;
    } else {
      const query = searchQuery.toLowerCase().trim();
      const queryUpper = searchQuery.toUpperCase().trim();
      const searchTerms = getSearchTerms(queryUpper);

      // Check if searching for alerts or no-show
      if (query === 'alerts' || query === 'alert' || query === 'no-show' || query === 'no show' || query === 'noshow') {
        setSearchMode('alert');
        const alertEmpIds = new Set(alerts.map(a => a.empId));
        result = gridData.filter(row => alertEmpIds.has(row.empId));
      } else {
        // Helper function to check if a cell value matches any of the search terms
        // Handles concatenated tails like "9H-SXK/ 9H-SXI/ A6-EYM"
        // Also handles synonym matching (HSKPNG = HSE-KPNG)
        const cellMatchesQuery = (cellValue: string | undefined, terms: string[]): boolean => {
          if (!cellValue) return false;
          const cellUpper = cellValue.toUpperCase();

          // Check each search term (includes synonyms)
          for (const term of terms) {
            // Direct match (case-insensitive)
            if (cellUpper.includes(term)) {
              return true;
            }

            // For concatenated values (separated by / or ,), check each part
            const parts = cellValue.split(/[\/,]/).map(p => p.trim().toUpperCase());
            if (parts.some(part => part.includes(term))) {
              return true;
            }
          }
          return false;
        };

        // Check if it looks like a tail number search (e.g., VH-OQC, A6-EYO, 9H-SXI)
        // More permissive pattern: starts with letters, may have dash, then alphanumeric
        const looksLikeTail = /^[A-Z]{1,2}-?[A-Z0-9]{2,5}$/i.test(queryUpper) ||
                             isTailNumber(queryUpper);

        if (looksLikeTail) {
          setSearchMode('tail');
          // Filter to employees who have worked on this tail (or concatenated tail containing this)
          result = gridData.filter(row => {
            for (const [, cellData] of row.dailyData) {
              if (cellMatchesQuery(cellData.displayValue, searchTerms)) {
                return true;
              }
            }
            // Also check Core and Support columns from dateDetails
            for (const [, details] of row.dateDetails) {
              if (cellMatchesQuery(details?.plannedCore, searchTerms) ||
                  cellMatchesQuery(details?.plannedSupport, searchTerms)) {
                return true;
              }
            }
            return false;
          });
        } else {
          // General search: matches employee name, ID, team, OR any cell value
          // This handles roster codes like AL, PRESERVATION, Night Shift, HSKPNG, TR, etc.
          setSearchMode('employee');
          result = gridData.filter(row => {
            // Match on employee details
            if (row.name.toLowerCase().includes(query) ||
                row.empId.toLowerCase().includes(query) ||
                row.team.toLowerCase().includes(query)) {
              return true;
            }

            // Match on any daily cell value (roster codes, tails, etc.)
            for (const [, cellData] of row.dailyData) {
              if (cellMatchesQuery(cellData.displayValue, searchTerms)) {
                return true;
              }
            }

            // Match on Core/Support columns
            for (const [, details] of row.dateDetails) {
              if (cellMatchesQuery(details?.plannedCore, searchTerms) ||
                  cellMatchesQuery(details?.plannedSupport, searchTerms)) {
                return true;
              }
            }

            return false;
          });
        }
      }
    }

    // Apply role sorting if active
    if (roleSortDirection) {
      const roleOrder = { 'Engineer': 1, 'Tech': 2, 'CC': 3 };
      result = [...result].sort((a, b) => {
        const aOrder = roleOrder[a.role as keyof typeof roleOrder] || 99;
        const bOrder = roleOrder[b.role as keyof typeof roleOrder] || 99;
        return roleSortDirection === 'asc' ? aOrder - bOrder : bOrder - aOrder;
      });
    }

    return result;
  }, [gridData, searchQuery, alerts, roleSortDirection]);

  // Calculate filtered date range based on search results
  // Shows only dates where the searched value actually appears (the job was done)
  const filteredDateRange = useMemo(() => {
    // If no search, show full date range
    if (!searchQuery.trim()) {
      return dateRange;
    }

    const query = searchQuery.toLowerCase().trim();

    // If searching for alerts, show full date range (alert mode doesn't filter dates)
    if (query === 'alerts' || query === 'alert' || query === 'no-show' || query === 'no show' || query === 'noshow') {
      return dateRange;
    }

    const searchTerms = getSearchTerms(searchQuery.toUpperCase().trim());

    // Helper to check cell match - must match the actual search term, not just any value
    const cellMatchesSearchTerm = (cellValue: string | undefined): boolean => {
      if (!cellValue) return false;
      // Skip single-character values like "O" which are roster codes, not tail numbers
      // This prevents false positives when filtering by tail number
      if (cellValue.length === 1) return false;

      const cellUpper = cellValue.toUpperCase();
      for (const term of searchTerms) {
        if (cellUpper.includes(term)) return true;
        // For concatenated values (separated by / or ,), check each part
        const parts = cellValue.split(/[\/,]/).map(p => p.trim().toUpperCase());
        if (parts.some(part => part.includes(term))) return true;
      }
      return false;
    };

    // Collect only dates where the searched term ACTUALLY appears in a cell
    const matchingDates = new Set<string>();

    filteredGridData.forEach(row => {
      dateRange.forEach((dateStr) => {
        const cellData = row.dailyData.get(dateStr);
        const details = row.dateDetails.get(dateStr);

        // Only add date if the cell actually contains the search term
        if (cellMatchesSearchTerm(cellData?.displayValue) ||
            cellMatchesSearchTerm(details?.plannedCore) ||
            cellMatchesSearchTerm(details?.plannedSupport)) {
          matchingDates.add(dateStr);
        }
      });
    });

    // If no matches found, return full range
    if (matchingDates.size === 0) {
      return dateRange;
    }

    // Return only the dates that have matches, preserving original order
    return dateRange.filter(d => matchingDates.has(d));
  }, [dateRange, filteredGridData, searchQuery]);

  // When search results change, scroll to the first matching date (leftmost position)
  // This aligns the earliest assignment date with the Support column
  useEffect(() => {
    if (searchQuery.trim() && filteredDateRange.length > 0 && filteredDateRange.length < dateRange.length) {
      // Scroll to position 0 (first column in filtered range)
      if (dateColumnsBodyRef.current) {
        dateColumnsBodyRef.current.scrollTo({
          left: 0,
          behavior: 'smooth'
        });
      }
      if (dateHeaderRef.current) {
        dateHeaderRef.current.scrollTo({
          left: 0,
          behavior: 'smooth'
        });
      }
    }
  }, [filteredDateRange, searchQuery, dateRange.length]);

  // Generate date options for dropdown - show FULL date range (Feb 1 - May 31)
  const dateOptions = useMemo(() => {
    if (dateRange.length === 0) return [];

    // Show ALL dates in the range (Feb 1 - May 31)
    return dateRange.map(d => ({
      value: d,
      label: formatDateForHeader(d),
      isPast: getDateZone(d, CURRENT_DATE) === 'past',
      isCurrent: d === CURRENT_DATE,
      isFuture: getDateZone(d, CURRENT_DATE) === 'future'
    }));
  }, [dateRange]);


  // Handle horizontal scroll sync between header and body
  const handleHorizontalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    if (dateHeaderRef.current) {
      dateHeaderRef.current.scrollLeft = scrollLeft;
    }
  }, []);

  // Handle vertical scroll sync across all three body sections
  const handleVerticalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const target = e.currentTarget;

    // Sync all other scroll containers
    if (fixedColumnsBodyRef.current && fixedColumnsBodyRef.current !== target) {
      fixedColumnsBodyRef.current.scrollTop = scrollTop;
    }
    if (detailsColumnsBodyRef.current && detailsColumnsBodyRef.current !== target) {
      detailsColumnsBodyRef.current.scrollTop = scrollTop;
    }
    if (dateColumnsBodyRef.current && dateColumnsBodyRef.current !== target) {
      dateColumnsBodyRef.current.scrollTop = scrollTop;
    }
  }, []);

  // Combined scroll handler for the date columns body (both horizontal and vertical)
  const handleDateBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    handleHorizontalScroll(e);
    handleVerticalScroll(e);
  }, [handleHorizontalScroll, handleVerticalScroll]);

  // Navigate dates with arrows
  const navigateDate = (direction: 'prev' | 'next') => {
    const currentIdx = dateRange.indexOf(selectedDate);
    if (currentIdx === -1) return;

    const newIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
    if (newIdx >= 0 && newIdx < dateRange.length) {
      setSelectedDate(dateRange[newIdx]);
    }
  };

  // Load replacement candidates for an alert
  const loadReplacementCandidates = async (alert: AlertData) => {
    const alertKey = `${alert.empId}-${alert.date}`;

    // Skip if already loaded
    if (recommendationStates.has(alertKey) && recommendationStates.get(alertKey)!.candidates.length > 0) {
      return;
    }

    // Set loading state
    setRecommendationStates(prev => {
      const newMap = new Map(prev);
      newMap.set(alertKey, {
        alertKey,
        status: 'pending',
        candidates: [],
        isLoading: true
      });
      return newMap;
    });

    // Build exclude list - employees already affected by alerts + already selected as replacements
    const excludeNames = [
      ...alerts.map(a => a.empName),
      ...Array.from(selectedReplacementEmpIds).map(id => {
        const row = gridData.find(r => r.empId === id);
        return row?.name || '';
      }).filter(Boolean)
    ];

    const candidates = await fetchReplacementCandidates(
      alert.tailNumber || '',
      alert.date,
      excludeNames,
      gridData
    );

    setRecommendationStates(prev => {
      const newMap = new Map(prev);
      newMap.set(alertKey, {
        alertKey,
        status: 'pending',
        candidates,
        isLoading: false
      });
      return newMap;
    });
  };

  // Handle applying a fix
  const handleApplyFix = async (alert: AlertData, replacement: ReplacementCandidate) => {
    const alertKey = `${alert.empId}-${alert.date}`;

    // Mark as loading
    setRecommendationStates(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(alertKey);
      if (existing) {
        newMap.set(alertKey, { ...existing, isLoading: true });
      }
      return newMap;
    });

    const result = await applyAlertFix(alert, replacement);

    // Update state with result
    setRecommendationStates(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(alertKey);
      if (existing) {
        newMap.set(alertKey, {
          ...existing,
          status: result.success ? 'fixed' : 'pending',
          selectedReplacement: result.success ? replacement : undefined,
          isLoading: false,
          message: result.message,
          isCoreTakenFromAssignment: result.isCoreTakenFromAssignment
        });
      }
      return newMap;
    });

    // Mark replacement as used and update cell overrides for UI
    if (result.success) {
      setSelectedReplacementEmpIds(prev => new Set([...prev, replacement.empId]));

      // Update cell overrides for demo mode (UI-only rendering)
      // 1. No-show employee: show "NO SHOW" with red styling, support = "No-Show"
      // 2. Replacement employee: show the tail number, support = tail number
      setCellOverrides(prev => {
        const newMap = new Map(prev);
        // No-show employee cell - Schedule shows "NO SHOW", Support shows "No-Show"
        newMap.set(`${alert.empId}-${alert.date}`, {
          displayValue: 'NO SHOW',
          isNoShow: true,
          supportValue: 'No-Show'
        });
        // Replacement employee cell - Schedule shows tail, Support shows tail
        newMap.set(`${replacement.empId}-${alert.date}`, {
          displayValue: alert.tailNumber || '',
          isNoShow: false,
          supportValue: alert.tailNumber || ''
        });
        return newMap;
      });
    }
  };

  // Handle no-fix for a single alert
  const handleNoFix = (alert: AlertData) => {
    const alertKey = `${alert.empId}-${alert.date}`;
    setRecommendationStates(prev => {
      const newMap = new Map(prev);
      newMap.set(alertKey, {
        alertKey,
        status: 'no-fix',
        candidates: prev.get(alertKey)?.candidates || [],
        isLoading: false,
        message: 'Marked as no-fix'
      });
      return newMap;
    });
  };

  // Handle no-fix for all remaining alerts
  const handleNoFixAll = () => {
    setRecommendationStates(prev => {
      const newMap = new Map(prev);
      alerts.forEach(alert => {
        const alertKey = `${alert.empId}-${alert.date}`;
        const existing = newMap.get(alertKey);
        if (!existing || existing.status === 'pending') {
          newMap.set(alertKey, {
            alertKey,
            status: 'no-fix',
            candidates: existing?.candidates || [],
            isLoading: false,
            message: 'Marked as no-fix'
          });
        }
      });
      return newMap;
    });
  };

  // Create a Set of empId-date keys that have alerts for quick lookup
  const alertCellKeys = useMemo(() => {
    const keys = new Set<string>();
    alerts.forEach(alert => {
      keys.add(`${alert.empId}-${alert.date}`);
    });
    return keys;
  }, [alerts]);

  // Render cell using explicit color rules (no regex)
  // hasAlert parameter indicates if this cell belongs to an employee with an alert on this date
  // searchTerm is used to highlight matching cells in yellow
  // dateStr is used to determine if this is a future date (for lighter green styling)
  const renderCell = (displayValue: string | undefined, dateStr: string, searchTerm?: string, hasAlert?: boolean) => {
    if (!displayValue || displayValue === '-') {
      return <span className="text-gray-300">-</span>;
    }

    // Check for NO SHOW - special red styling
    // Also apply red styling if employee has an alert on this date (no-show or leave)
    if (displayValue.toUpperCase() === 'NO SHOW' || hasAlert) {
      return (
        <div
          className={`${NO_SHOW_COLORS.bg} ${NO_SHOW_COLORS.text} text-xs px-1.5 py-0.5 rounded truncate max-w-full`}
          title={displayValue}
        >
          {displayValue}
        </div>
      );
    }

    // For search, highlight matching cells in yellow
    // Check direct match or concatenated match (e.g., "9H-SXK/ 9H-SXI/ A6-EYM")
    if (searchTerm) {
      const cellUpper = displayValue.toUpperCase();
      const searchUpper = searchTerm.toUpperCase();
      const directMatch = cellUpper.includes(searchUpper);
      const parts = displayValue.split(/[\/,]/).map(p => p.trim().toUpperCase());
      const partMatch = parts.some(part => part.includes(searchUpper));

      if (directMatch || partMatch) {
        return (
          <div
            className="bg-yellow-400 text-gray-900 font-bold text-xs px-1.5 py-0.5 rounded truncate max-w-full ring-2 ring-yellow-600"
            title={displayValue}
          >
            {displayValue}
          </div>
        );
      }
    }

    // Determine if this is a future date relative to reference date (CURRENT_DATE = 2022-04-30)
    const isFutureDate = dateStr > CURRENT_DATE;
    
    // Check if this is a tail number
    const isTail = isTailNumber(displayValue);
    
    // Check if this is a simulated tail (contains '--')
    const isSimulatedTail = isTail && displayValue.includes('--');

    // Apply conditional styling for tails based on date and simulation status
    let colors;
    if (isTail) {
      if (isSimulatedTail) {
        // Simulated tails (with '--') always show in grey
        colors = CELL_COLORS.TAIL_SIMULATED;
      } else if (isFutureDate) {
        // Future tails show in lighter green
        colors = CELL_COLORS.TAIL_FUTURE;
      } else {
        // Past/current tails show in dark green (existing behavior)
        colors = CELL_COLORS.TAIL;
      }
    } else {
      // Non-tail values use standard roster code colors
      colors = getCellColors(displayValue);
    }

    return (
      <div
        className={`${colors.bg} ${colors.text} text-xs px-1.5 py-0.5 rounded truncate max-w-full`}
        title={displayValue}
      >
        {displayValue}
      </div>
    );
  };

  // Open alerts modal and load recommendations
  const openAlertDetails = () => {
    setShowAlertDetails(true);
    setAlertDetailsTab('summary');
    // Pre-load candidates for all alerts
    alerts.forEach(alert => loadReplacementCandidates(alert));
  };

  // Count resolved alerts (fixed or no-fix) - MUST be before early returns (React hooks rule)
  const resolvedAlertCount = useMemo(() => {
    let count = 0;
    alerts.forEach(alert => {
      const alertKey = `${alert.empId}-${alert.date}`;
      const state = recommendationStates.get(alertKey);
      if (state?.status === 'fixed' || state?.status === 'no-fix') {
        count++;
      }
    });
    return count;
  }, [alerts, recommendationStates]);

  // Count fixed vs no-fix - MUST be before early returns (React hooks rule)
  const fixedCount = useMemo(() => {
    let count = 0;
    alerts.forEach(alert => {
      const alertKey = `${alert.empId}-${alert.date}`;
      const state = recommendationStates.get(alertKey);
      if (state?.status === 'fixed') {
        count++;
      }
    });
    return count;
  }, [alerts, recommendationStates]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 text-center">
        <p className="text-red-700 font-medium">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  // Format selected date for display in KPI card (e.g., 30-04-2022)
  const formattedSelectedDate = (() => {
    const d = new Date(selectedDate);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  })();

  // Alert counts - total from extracted alerts
  const totalAlerts = alerts.length;
  const noShowCount = alerts.filter(a => a.alertType === 'no-show').length;
  const leaveCount = alerts.filter(a => a.alertType === 'leave').length;

  // Remaining open alerts
  const openAlertCount = totalAlerts - resolvedAlertCount;
  const allAlertsResolved = totalAlerts > 0 && openAlertCount === 0;

  const noFixCount = resolvedAlertCount - fixedCount;

  return (
    <div className="space-y-6">
      {/* ================================================================== */}
      {/* UTILIZATION KPI CARDS */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 gap-6">
        {/* Week-to-Date Utilization */}
        <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-700">Week-to-Date Utilization</h3>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(weeklyUtilization, 100)}%` }}
                ></div>
              </div>
            </div>
            <div className="text-4xl font-bold text-blue-600 ml-4">{weeklyUtilization}%</div>
          </div>
          {/* Breakup by role */}
          <div className="border-t border-gray-200 pt-4 mt-2">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-3">Breakup by Role</div>
            <div className="flex gap-6">
              {/* Engineers */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600">Engineers</span>
                  <span className="text-sm font-bold text-purple-600">{weeklyEngineerUtilization}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-purple-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(weeklyEngineerUtilization, 100)}%` }}
                  ></div>
                </div>
              </div>
              {/* Technicians */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600">Technicians</span>
                  <span className="text-sm font-bold text-cyan-600">{weeklyTechnicianUtilization}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-cyan-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(weeklyTechnicianUtilization, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Today's Utilization */}
        <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-700">Daily Utilization</h3>
              <p className="text-sm text-slate-500">{formattedSelectedDate}</p>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(dailyUtilization, 100)}%` }}
                ></div>
              </div>
            </div>
            <div className="text-4xl font-bold text-emerald-600 ml-4">{dailyUtilization}%</div>
          </div>
          {/* Breakup by role */}
          <div className="border-t border-gray-200 pt-4 mt-2">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-3">Breakup by Role</div>
            <div className="flex gap-6">
              {/* Engineers */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600">Engineers</span>
                  <span className="text-sm font-bold text-purple-600">{engineerUtilization}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-purple-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(engineerUtilization, 100)}%` }}
                  ></div>
                </div>
              </div>
              {/* Technicians */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600">Technicians</span>
                  <span className="text-sm font-bold text-cyan-600">{technicianUtilization}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-cyan-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(technicianUtilization, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* TOP PANE: Assignments & Roster Plan */}
      {/* ================================================================== */}
      <div className="bg-white border-2 border-gray-800 rounded-lg shadow-lg overflow-hidden">
        {/* Header with Title, KPIs, and Date Selector */}
        <div className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-2 border-gray-800 p-4">
          <div className="flex items-center justify-between">
            {/* Title with Settings Icon */}
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-800">
                Assignments & Roster Plan
              </h2>
              {/* Active Scenario Badge */}
              {activeScenario && (
                <span className="text-sm font-semibold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
                  Active: {savedScenarios.find(s => s.id === activeScenario)?.scenario_name || activeScenario}
                </span>
              )}
              {/* Settings Icon */}
              <button
                className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                onClick={() => setShowSettingsPopup(true)}
                title="Active Scenario Settings"
              >
                <Settings className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-6">
              {/* Date Navigation */}
              <div className="flex items-center gap-2 bg-white rounded-lg px-2 py-1 shadow-sm border border-slate-200">
                <button
                  onClick={() => navigateDate('prev')}
                  className="p-1 hover:bg-slate-100 rounded transition-colors"
                  disabled={dateRange.indexOf(selectedDate) === 0}
                >
                  <ChevronLeft size={20} className="text-slate-600" />
                </button>

                <div className="relative">
                  <select
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="appearance-none px-4 py-2 pr-8 border-0 font-semibold text-slate-700 bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 rounded"
                  >
                    {dateOptions.map(opt => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        className={opt.isCurrent ? 'font-bold' : ''}
                      >
                        {opt.label} {opt.isCurrent ? '(Today)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>

                <button
                  onClick={() => navigateDate('next')}
                  className="p-1 hover:bg-slate-100 rounded transition-colors"
                  disabled={dateRange.indexOf(selectedDate) === dateRange.length - 1}
                >
                  <ChevronRight size={20} className="text-slate-600" />
                </button>
              </div>
            </div>
          </div>

          {/* ================================================================== */}
          {/* ALERTS PANEL */}
          {/* ================================================================== */}
          {alerts.length > 0 && (
            <div className={`mt-4 rounded-lg p-3 flex items-center justify-between border-2 ${
              allAlertsResolved
                ? 'bg-blue-50 border-blue-300'
                : 'bg-orange-50 border-orange-300'
            }`}>
              <div className="flex items-center gap-3">
                {allAlertsResolved ? (
                  <CheckCircle2 className="text-blue-500" size={24} />
                ) : (
                  <AlertTriangle className="text-orange-500" size={24} />
                )}
                <span className={`font-semibold ${allAlertsResolved ? 'text-blue-800' : 'text-orange-800'}`}>
                  {allAlertsResolved ? (
                    <>{formatDateForHeader(selectedDate)}: All {totalAlerts} alerts resolved ({fixedCount} fixed, {noFixCount} no-fix)</>
                  ) : (
                    <>{formatDateForHeader(selectedDate)} Alerts: {openAlertCount} open ({noShowCount} no-show, {leaveCount} leave)</>
                  )}
                </span>
              </div>
              <button
                onClick={openAlertDetails}
                className={`px-4 py-2 text-white font-semibold rounded-lg transition-colors ${
                  allAlertsResolved
                    ? 'bg-blue-500 hover:bg-blue-600'
                    : 'bg-orange-500 hover:bg-orange-600'
                }`}
              >
                View Details
              </button>
            </div>
          )}

          {/* ================================================================== */}
          {/* SEARCH BAR */}
          {/* ================================================================== */}
          <div className="mt-4 relative">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-white border-2 border-gray-300 rounded-lg px-3 py-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
                <Search size={20} className="text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, team, tail (A6-EYO, 9H-SXI), roster code (AL, PRESERVATION, Night Shift), or 'alerts'/'no-show'..."
                  className="flex-1 outline-none text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <X size={16} className="text-gray-500" />
                  </button>
                )}
              </div>
              {/* Modern Reset Button - only show when search is active */}
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-600 to-slate-700 text-white font-medium rounded-lg hover:from-slate-700 hover:to-slate-800 transition-all shadow-md hover:shadow-lg active:scale-95"
                  title="Reset search and restore original view"
                >
                  <RotateCcw size={16} className="animate-spin-slow" />
                  <span>Reset</span>
                </button>
              )}
            </div>
            {searchMode && (
              <div className="absolute left-0 top-full mt-1 text-xs text-gray-500 flex items-center gap-2">
                {searchMode === 'tail' && (
                  <>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                      {filteredGridData.length} employees
                    </span>
                    <span>worked on "{searchQuery.toUpperCase()}"</span>
                    <span className="text-gray-400">•</span>
                    <span>Showing {formatDateForHeader(filteredDateRange[0])} - {formatDateForHeader(filteredDateRange[filteredDateRange.length - 1])}</span>
                  </>
                )}
                {searchMode === 'employee' && (
                  <>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                      {filteredGridData.length} matches
                    </span>
                    <span>for "{searchQuery}"</span>
                    {filteredDateRange.length < dateRange.length && (
                      <>
                        <span className="text-gray-400">•</span>
                        <span>Dates: {formatDateForHeader(filteredDateRange[0])} - {formatDateForHeader(filteredDateRange[filteredDateRange.length - 1])}</span>
                      </>
                    )}
                  </>
                )}
                {searchMode === 'alert' && (
                  <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">
                    {filteredGridData.length} employees with alerts
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Grid Container */}
        <div className="overflow-hidden">
          {/* Fixed columns + scrollable date columns */}
          <div className="flex">
            {/* Fixed Left Columns (Employee Details) */}
            <div className="flex-shrink-0 border-r-2 border-gray-800">
              {/* Header - Two rows to match Details section */}
              <div className="bg-gray-200 border-b-2 border-gray-800">
                {/* Row 1: Merged header to match Details section */}
                <div className="px-2 py-1 text-xs font-bold text-center text-gray-700 bg-gray-300">
                  Employee Details
                </div>
                {/* Row 2: Column headers */}
                <div className="flex border-t border-gray-400">
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center border-r border-gray-400">ID</div>
                  <div className="w-32 px-2 py-1 text-xs font-bold text-center border-r border-gray-400">Employee</div>
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center border-r border-gray-400">Team</div>
                  <div
                    className="w-24 px-2 py-1 text-xs font-bold text-center flex items-center justify-center gap-1 cursor-pointer hover:bg-gray-300 transition-colors"
                    onClick={() => {
                      setRoleSortDirection(prev =>
                        prev === null ? 'asc' : prev === 'asc' ? 'desc' : null
                      );
                    }}
                    title="Click to sort by role"
                  >
                    Role
                    {roleSortDirection === null && <ArrowUpDown size={12} className="text-gray-400" />}
                    {roleSortDirection === 'asc' && <ArrowUp size={12} className="text-blue-600" />}
                    {roleSortDirection === 'desc' && <ArrowDown size={12} className="text-blue-600" />}
                  </div>
                </div>
              </div>

              {/* Body - Fixed columns */}
              <div
                ref={fixedColumnsBodyRef}
                onScroll={handleVerticalScroll}
                className="max-h-[500px] overflow-y-auto"
                style={{ scrollbarWidth: 'none' }}
              >
                {filteredGridData.map((row, idx) => (
                  <div
                    key={row.empId}
                    className={`flex border-b border-gray-300 h-8 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    onClick={() => {
                      setSelectedEmployee(row);
                      setShowEmployeeDrawer(true);
                    }}
                    title={`Click to view ${row.name}'s details`}
                  >
                    <div className="w-20 px-2 text-xs font-medium border-r border-gray-300 truncate bg-gray-100 hover:bg-blue-100 flex items-center">
                      {row.empId}
                    </div>
                    <div className="w-32 px-2 text-xs border-r border-gray-300 truncate bg-gray-100 hover:bg-blue-100 flex items-center" title={row.name}>
                      <User size={12} className="mr-1 text-slate-400 flex-shrink-0" />
                      {row.name}
                    </div>
                    <div className="w-20 px-2 text-xs border-r border-gray-300 truncate bg-gray-100 hover:bg-blue-100 flex items-center">
                      {row.team}
                    </div>
                    <div className="w-24 px-2 text-xs truncate bg-gray-100 hover:bg-blue-100 flex items-center" title={formatRoleForDisplay(row.role)}>
                      {formatRoleForDisplay(row.role)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Details for Selected Date columns */}
            <div className="flex-shrink-0 border-r-2 border-gray-800">
              {/* Header - Merged header for selected date details */}
              <div className="bg-blue-100 border-b-2 border-gray-800">
                <div className="px-2 py-1 text-xs font-bold text-center text-blue-800">
                  Details for {formatDateForDetailsHeader(selectedDate)}
                </div>
                <div className="flex border-t border-blue-300">
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center border-r border-blue-300">Core</div>
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center border-r border-blue-300">Support</div>
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center">TTL Login</div>
                </div>
              </div>

              {/* Body - Selected date detail columns */}
              <div
                ref={detailsColumnsBodyRef}
                onScroll={handleVerticalScroll}
                className="max-h-[500px] overflow-y-auto"
                style={{ scrollbarWidth: 'none' }}
              >
                {filteredGridData.map((row, idx) => {
                  // Get details for the selected date
                  const details = row.dateDetails.get(selectedDate);
                  // Check for UI override (demo mode updates for Support column)
                  const cellKey = `${row.empId}-${selectedDate}`;
                  const override = cellOverrides.get(cellKey);
                  const supportValue = override?.supportValue ?? details?.plannedSupport;
                  const isNoShowSupport = override?.isNoShow && override?.supportValue;

                  return (
                    <div
                      key={row.empId}
                      className={`flex border-b border-gray-300 h-8 ${idx % 2 === 0 ? 'bg-blue-50/30' : 'bg-blue-50/50'}`}
                    >
                      <div className="w-20 px-2 text-xs text-center border-r border-gray-300 truncate flex items-center justify-center" title={details?.plannedCore || ''}>
                        {details?.plannedCore || '-'}
                      </div>
                      <div
                        className={`w-20 px-2 text-xs text-center border-r border-gray-300 truncate flex items-center justify-center ${
                          isNoShowSupport ? 'text-red-600 font-semibold' : ''
                        }`}
                        title={supportValue || ''}
                      >
                        {supportValue || '-'}
                      </div>
                      <div className="w-20 px-2 text-xs text-center truncate flex items-center justify-center" title={details?.ttlLogin || ''}>
                        {formatTtlLogin(details?.ttlLogin)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Date Columns */}
            <div className="flex-1 overflow-hidden">
              {/* Date Header - Two rows to match other sections */}
              <div
                ref={dateHeaderRef}
                className="bg-gray-100 border-b-2 border-gray-800 overflow-x-hidden"
              >
                {/* Row 1: Merged header to match other sections */}
                <div className="px-2 py-1 text-xs font-bold text-center text-gray-700 bg-gray-300 border-b border-gray-400">
                  Schedule ({filteredDateRange.length > 0 ? formatDateForHeader(filteredDateRange[0]) + ' - ' + formatDateForHeader(filteredDateRange[filteredDateRange.length - 1]) : 'Loading...'})
                  {filteredDateRange.length < dateRange.length && searchQuery && (
                    <span className="ml-2 text-blue-600">(filtered)</span>
                  )}
                </div>
                {/* Row 2: Date columns */}
                <div className="flex">
                  {filteredDateRange.map((dateStr) => {
                    const isSelected = dateStr === selectedDate;
                    const zone = getDateZone(dateStr, CURRENT_DATE);

                    return (
                      <div
                        key={dateStr}
                        ref={isSelected ? selectedColumnRef : null}
                        className={`
                          flex-shrink-0 w-20 px-1 py-1 text-xs font-bold text-center border-r border-gray-400
                          cursor-pointer transition-all relative
                          ${isSelected
                            ? 'bg-blue-500 text-white ring-2 ring-blue-600 ring-inset z-10'
                            : zone === 'past'
                              ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              : zone === 'current'
                                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                          }
                        `}
                        onClick={() => setSelectedDate(dateStr)}
                        title={`Click to select ${formatDateForHeader(dateStr)}`}
                      >
                        {formatDateForHeader(dateStr)}
                        {dateStr === CURRENT_DATE && !isSelected && (
                          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-amber-500 rounded-full"></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Date Column Body */}
              <div
                ref={dateColumnsBodyRef}
                onScroll={handleDateBodyScroll}
                className="max-h-[500px] overflow-x-auto overflow-y-auto"
              >
                {filteredGridData.map((row, idx) => (
                  <div
                    key={row.empId}
                    className={`flex border-b border-gray-300 h-8 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    {filteredDateRange.map((dateStr) => {
                      const cellData = row.dailyData.get(dateStr);
                      const isSelected = dateStr === selectedDate;
                      // Check if this cell has an alert (no-show or leave)
                      const cellKey = `${row.empId}-${dateStr}`;
                      const hasAlert = alertCellKeys.has(cellKey);

                      // Check for UI override (demo mode updates)
                      const override = cellOverrides.get(cellKey);
                      const displayValue = override?.displayValue ?? cellData?.displayValue;
                      // If override exists and is NO SHOW, treat as having alert styling
                      const shouldShowAsNoShow = override?.isNoShow || hasAlert;

                      return (
                        <div
                          key={dateStr}
                          className={`
                            flex-shrink-0 w-20 px-1 text-center border-r border-gray-300 relative flex items-center justify-center
                            ${isSelected
                              ? 'bg-blue-100/70 ring-1 ring-blue-400 ring-inset'
                              : ''
                            }
                          `}
                        >
                          {/* Selected column highlight band */}
                          {isSelected && (
                            <div className="absolute inset-0 bg-blue-500/10 pointer-events-none"></div>
                          )}
                          <div className="relative z-10">
                            {renderCell(displayValue, dateStr, searchMode && searchMode !== 'alert' ? searchQuery : undefined, shouldShowAsNoShow)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Roster Legend Footer - Color coded per type */}
        <div className="bg-slate-50 border-t-2 border-gray-800 p-3">
          <div className="flex items-center gap-6 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Legend:</span>

            {/* Tail number (Current/Past) - Dark Green with white font */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.TAIL.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">Tail (Current/Past)</span>
            </div>

            {/* Tail number (Future) - Lighter Green */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.TAIL_FUTURE.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">Tail (Future)</span>
            </div>

            {/* Simulated Tail - Grey */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.TAIL_SIMULATED.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">Simulated Tail</span>
            </div>

            {/* AL, TR, SK - Light Green */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.LEAVE_TRAINING.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">AL / TR / SK</span>
            </div>

            {/* O (Off) - Grey */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.OFF.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">O (Off)</span>
            </div>

            {/* DO - Orange */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.DAY_OFF.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">DO (Day Off)</span>
            </div>

            {/* Shift codes - Light Blue */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.SHIFT.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">1 / D / E / B1</span>
            </div>

            {/* NO SHOW - Red */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${NO_SHOW_COLORS.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">No Show</span>
            </div>

            {/* Miscellaneous - Pink (last item) */}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 ${CELL_COLORS.HOUSEKEEPING.bg} rounded`}></div>
              <span className="text-xs font-medium text-slate-700">Miscellaneous (Housekeeping, Night Shift, Movement etc.)</span>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* BOTTOM PANE: Assignment Overview */}
      {/* ================================================================== */}
      {(() => {
        // Aggregate assignments by tail for the selected date
        const assignmentOverview = aggregateAssignmentsByTail(gridData, selectedDate);

        // Calculate totals
        const totals = assignmentOverview.reduce(
          (acc, item) => ({
            core: {
              cc: acc.core.cc + item.core.cc,
              engr: acc.core.engr + item.core.engr,
              tech: acc.core.tech + item.core.tech,
            },
            support: {
              cc: acc.support.cc + item.support.cc,
              engr: acc.support.engr + item.support.engr,
              tech: acc.support.tech + item.support.tech,
            },
          }),
          {
            core: { cc: 0, engr: 0, tech: 0 },
            support: { cc: 0, engr: 0, tech: 0 },
          }
        );

        return (
          <div className="bg-white border-2 border-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-2 border-gray-800 p-4">
              <h2 className="text-xl font-bold text-slate-800">
                Assignment Overview
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Capacity breakdown by tail for {formatDateForDetailsHeader(selectedDate)}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  {/* Header Row 1: Group headers */}
                  <tr className="bg-gray-100 border-b-2 border-gray-300">
                    <th rowSpan={2} className="px-4 py-3 text-left text-sm font-bold text-slate-700 border-r-2 border-gray-300 bg-gray-200 w-28">
                      Tail Num
                    </th>
                    <th colSpan={3} className="px-4 py-2 text-center text-sm font-bold text-slate-700 border-r-2 border-gray-300 bg-red-50">
                      Core
                    </th>
                    <th colSpan={3} className="px-4 py-2 text-center text-sm font-bold text-slate-700 bg-green-50">
                      Support
                    </th>
                  </tr>
                  {/* Header Row 2: Role columns */}
                  <tr className="bg-gray-50 border-b-2 border-gray-400">
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r border-gray-300 bg-red-50/50 w-20">CC</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r border-gray-300 bg-red-50/50 w-20">Engineer</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r-2 border-gray-300 bg-red-50/50 w-20">Technician</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r border-gray-300 bg-green-50/50 w-20">CC</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-r border-gray-300 bg-green-50/50 w-20">Engineer</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 bg-green-50/50 w-20">Technician</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Totals Row */}
                  <tr className="bg-slate-100 border-b-2 border-gray-400 font-bold">
                    <td className="px-4 py-3 text-sm text-slate-700 border-r-2 border-gray-300">
                      Totals
                    </td>
                    <td className="px-3 py-3 text-center text-lg text-slate-800 border-r border-gray-300 bg-red-100/50">
                      {totals.core.cc}
                    </td>
                    <td className="px-3 py-3 text-center text-lg text-slate-800 border-r border-gray-300 bg-red-100/50">
                      {totals.core.engr}
                    </td>
                    <td className="px-3 py-3 text-center text-lg text-slate-800 border-r-2 border-gray-300 bg-red-100/50">
                      {totals.core.tech}
                    </td>
                    <td className="px-3 py-3 text-center text-lg text-slate-800 border-r border-gray-300 bg-green-100/50">
                      {totals.support.cc}
                    </td>
                    <td className="px-3 py-3 text-center text-lg text-slate-800 border-r border-gray-300 bg-green-100/50">
                      {totals.support.engr}
                    </td>
                    <td className="px-3 py-3 text-center text-lg text-slate-800 bg-green-100/50">
                      {totals.support.tech}
                    </td>
                  </tr>
                  {/* Data Rows */}
                  {assignmentOverview.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        No tail assignments for this date
                      </td>
                    </tr>
                  ) : (
                    assignmentOverview.map((item, idx) => (
                      <tr
                        key={item.tailNumber}
                        className={`border-b border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        }`}
                        onClick={() => setSearchQuery(item.tailNumber)}
                        title={`Click to search for ${item.tailNumber} in Assignments & Roster`}
                      >
                        <td className="px-4 py-2 border-r-2 border-gray-300">
                          <span className={`px-2 py-1 ${CELL_COLORS.TAIL.bg} ${CELL_COLORS.TAIL.text} rounded text-xs font-bold`}>
                            {item.tailNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-sm border-r border-gray-300 bg-red-50/30">
                          {item.core.cc || <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-sm border-r border-gray-300 bg-red-50/30">
                          {item.core.engr || <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-sm border-r-2 border-gray-300 bg-red-50/30">
                          {item.core.tech || <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-sm border-r border-gray-300 bg-green-50/30">
                          {item.support.cc || <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-sm border-r border-gray-300 bg-green-50/30">
                          {item.support.engr || <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-sm bg-green-50/30">
                          {item.support.tech || <span className="text-gray-300">0</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer with instructions */}
            <div className="bg-slate-50 border-t border-gray-200 px-4 py-2">
              <p className="text-xs text-slate-500">
                Click on a tail number to filter the Assignments & Roster view above
              </p>
            </div>
          </div>
        );
      })()}

      {/* ================================================================== */}
      {/* ALERT DETAILS MODAL */}
      {/* ================================================================== */}
      {showAlertDetails && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[80vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className={`p-4 flex items-center justify-between ${
              allAlertsResolved
                ? 'bg-gradient-to-r from-blue-500 to-blue-600'
                : 'bg-gradient-to-r from-orange-500 to-orange-600'
            }`}>
              <div className="flex items-center gap-3">
                {allAlertsResolved ? (
                  <CheckCircle2 className="text-white" size={24} />
                ) : (
                  <AlertTriangle className="text-white" size={24} />
                )}
                <h3 className="text-xl font-bold text-white">
                  {allAlertsResolved
                    ? `${formatDateForHeader(selectedDate)}: All ${totalAlerts} alerts resolved`
                    : `${formatDateForHeader(selectedDate)} Alerts`
                  }
                </h3>
              </div>
              <button
                onClick={() => setShowAlertDetails(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="text-white" size={24} />
              </button>
            </div>

            {/* Alert Counts */}
            <div className="flex gap-4 p-4 border-b border-gray-200">
              {allAlertsResolved ? (
                <>
                  <div className="bg-green-50 border-2 border-green-200 rounded-lg px-4 py-2">
                    <div className="text-sm font-medium text-green-800">Fixed</div>
                    <div className="text-2xl font-bold text-green-600">{fixedCount}</div>
                  </div>
                  <div className="bg-gray-50 border-2 border-gray-200 rounded-lg px-4 py-2">
                    <div className="text-sm font-medium text-gray-800">No-fix</div>
                    <div className="text-2xl font-bold text-gray-600">{noFixCount}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-red-50 border-2 border-red-200 rounded-lg px-4 py-2">
                    <div className="text-sm font-medium text-red-800">Open No-show</div>
                    <div className="text-2xl font-bold text-red-600">{noShowCount}</div>
                  </div>
                  <div className="bg-green-50 border-2 border-green-200 rounded-lg px-4 py-2">
                    <div className="text-sm font-medium text-green-800">Open Leaves</div>
                    <div className="text-2xl font-bold text-green-600">{leaveCount}</div>
                  </div>
                  {resolvedAlertCount > 0 && (
                    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg px-4 py-2">
                      <div className="text-sm font-medium text-blue-800">Resolved</div>
                      <div className="text-2xl font-bold text-blue-600">{resolvedAlertCount}</div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setAlertDetailsTab('summary')}
                className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                  alertDetailsTab === 'summary'
                    ? 'text-orange-600 border-b-2 border-orange-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Summary
              </button>
              <button
                onClick={() => setAlertDetailsTab('recommendations')}
                className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                  alertDetailsTab === 'recommendations'
                    ? 'text-orange-600 border-b-2 border-orange-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Recommendations
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {alertDetailsTab === 'summary' && (
                <div className="space-y-4">
                  {/* Tail-level summary */}
                  {tailSummaries.map(summary => (
                    <div
                      key={summary.tailNumber}
                      className="border-2 border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 ${CELL_COLORS.TAIL.bg} ${CELL_COLORS.TAIL.text} rounded-lg font-bold`}>
                            {summary.tailNumber}
                          </span>
                          <span className="text-sm text-gray-600">
                            {summary.noShowCount > 0 && (
                              <span className="text-red-600 font-medium">
                                {summary.noShowCount} no-show{summary.noShowCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {summary.noShowCount > 0 && summary.leaveCount > 0 && ', '}
                            {summary.leaveCount > 0 && (
                              <span className="text-green-600 font-medium">
                                {summary.leaveCount} leave{summary.leaveCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Affected employees */}
                      <div className="grid grid-cols-2 gap-2">
                        {summary.alerts.map(alert => (
                          <div
                            key={alert.empId}
                            className={`px-3 py-2 rounded-lg border ${
                              alert.alertType === 'no-show'
                                ? 'bg-red-50 border-red-200'
                                : 'bg-green-50 border-green-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-medium text-gray-800">{alert.empName}</div>
                              {alert.tailNumber && (
                                <span className="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-bold">
                                  {alert.tailNumber}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">ID: {alert.empId}</div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                alert.alertType === 'no-show'
                                  ? 'bg-red-200 text-red-800'
                                  : 'bg-green-200 text-green-800'
                              }`}>
                                {alert.alertType === 'no-show' ? 'No-show' : 'Leave'}
                              </span>
                              {alert.plannedCore && (
                                <span className="text-xs text-gray-500">
                                  Core: {alert.plannedCore}
                                </span>
                              )}
                              {alert.plannedSupport && (
                                <span className="text-xs text-gray-500">
                                  Support: {alert.plannedSupport}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {alertDetailsTab === 'recommendations' && (
                <div className="space-y-4">
                  {/* Global actions */}
                  <div className="flex justify-end">
                    <button
                      onClick={handleNoFixAll}
                      className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      No-fix to all
                    </button>
                  </div>

                  {/* Recommendation table */}
                  <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Employee Details</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Tail Assigned</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Flight/Context</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Recommended Replacements</th>
                          <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alerts.map(alert => {
                          const alertKey = `${alert.empId}-${alert.date}`;
                          const state = recommendationStates.get(alertKey);
                          const isResolved = state?.status === 'fixed' || state?.status === 'no-fix';

                          // Filter out already-selected replacements from candidates
                          const availableCandidates = (state?.candidates || []).filter(
                            c => !selectedReplacementEmpIds.has(c.empId) || state?.selectedReplacement?.empId === c.empId
                          );

                          return (
                            <tr
                              key={alertKey}
                              className={`border-t border-gray-200 ${isResolved ? 'bg-gray-50 opacity-70' : ''}`}
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-800">{alert.empName}</div>
                                <div className="text-xs text-gray-500">ID: {alert.empId}</div>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  alert.alertType === 'no-show'
                                    ? 'bg-red-200 text-red-800'
                                    : 'bg-green-200 text-green-800'
                                }`}>
                                  {alert.alertType === 'no-show' ? 'No-show' : 'Leave'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 bg-red-600 text-white rounded font-bold text-sm">
                                  {alert.tailNumber || 'N/A'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {alert.tailNumber}: {alert.plannedCore || 'N/A'} short by 1
                              </td>
                              <td className="px-4 py-3">
                                {state?.isLoading ? (
                                  <div className="animate-pulse bg-gray-200 h-8 rounded"></div>
                                ) : isResolved ? (
                                  <div className="text-sm">
                                    {state?.status === 'fixed' ? (
                                      <span className="text-green-600 font-medium">
                                        Assigned: {state.selectedReplacement?.empName}
                                      </span>
                                    ) : (
                                      <span className="text-gray-500">No-fix applied</span>
                                    )}
                                    {state?.message && (
                                      <div className="text-xs text-gray-500 mt-1">{state.message}</div>
                                    )}
                                  </div>
                                ) : (
                                  <select
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                    value={pendingSelections.get(alertKey)?.empId || ''}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        const candidate = availableCandidates.find(c => c.empId === e.target.value);
                                        if (candidate) {
                                          setPendingSelections(prev => {
                                            const newMap = new Map(prev);
                                            newMap.set(alertKey, candidate);
                                            return newMap;
                                          });
                                        }
                                      } else {
                                        setPendingSelections(prev => {
                                          const newMap = new Map(prev);
                                          newMap.delete(alertKey);
                                          return newMap;
                                        });
                                      }
                                    }}
                                  >
                                    <option value="">Select replacement...</option>
                                    {availableCandidates.map(candidate => (
                                      <option key={candidate.empId} value={candidate.empId}>
                                        {candidate.profileText}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-2">
                                  {isResolved ? (
                                    state?.status === 'fixed' ? (
                                      <Check className="text-green-500" size={20} />
                                    ) : (
                                      <XCircle className="text-gray-400" size={20} />
                                    )
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => {
                                          const pendingCandidate = pendingSelections.get(alertKey);
                                          if (pendingCandidate) {
                                            handleApplyFix(alert, pendingCandidate);
                                            // Clear pending selection after applying
                                            setPendingSelections(prev => {
                                              const newMap = new Map(prev);
                                              newMap.delete(alertKey);
                                              return newMap;
                                            });
                                          }
                                        }}
                                        disabled={!pendingSelections.has(alertKey)}
                                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                          pendingSelections.has(alertKey)
                                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                        }`}
                                      >
                                        Assign & Notify
                                      </button>
                                      <button
                                        onClick={() => handleNoFix(alert)}
                                        className="px-3 py-1 border border-gray-300 rounded text-xs font-medium text-gray-600 hover:bg-gray-100"
                                      >
                                        No-Fix
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-gray-200 p-4 flex justify-end">
              <button
                onClick={() => setShowAlertDetails(false)}
                className="px-6 py-2 bg-gray-800 text-white font-semibold rounded-lg hover:bg-gray-900 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Detail Drawer */}
      <EmployeeDetailDrawer
        isOpen={showEmployeeDrawer}
        onClose={() => setShowEmployeeDrawer(false)}
        employee={selectedEmployee}
        selectedDate={selectedDate}
      />

      {/* SETTINGS POPUP - Active Scenario */}
      {showSettingsPopup && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="w-[420px] rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">
            {/* Top Accent */}
            <div className="h-1 bg-gradient-to-r from-emerald-400 to-blue-500" />

            {/* Header */}
            <div className="px-6 pt-6 pb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-teal-700">
                  Active Scenario
                </h2>
                <button
                  onClick={() => setShowSettingsPopup(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Configure and manage your active planning scenario
              </p>
            </div>

            {/* Content */}
            <div className="px-6 pb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Current Active Scenario
              </label>

              <div className="relative mb-6">
                <select
                  value={activeScenario}
                  onChange={(e) => setActiveScenario(e.target.value)}
                  className="w-full h-11 px-4 pr-10 rounded-xl border border-gray-300 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="" disabled>
                    -- Select a scenario --
                  </option>
                  {savedScenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.source === 'ai' ? '🤖 ' : ''}{scenario.scenario_name} {scenario.status === 'completed' ? '✓' : scenario.status === 'failed' ? '✗' : scenario.status === 'draft' ? '📝' : scenario.status === 'legacy' ? '📋' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Set Active Button */}
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    // Close the popup - activeScenario is now set
                    setShowSettingsPopup(false);
                  }}
                  disabled={!activeScenario}
                  className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold shadow-md transition ${
                    activeScenario 
                      ? 'bg-teal-500 hover:bg-teal-600 text-white cursor-pointer' 
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-4 h-4" />
                  Set Active
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkforcePlanning;