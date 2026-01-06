import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { X, Search, User, ArrowUpDown, ArrowUp, ArrowDown, Settings, Play } from 'lucide-react';
import { getCellColors, CELL_COLORS, formatRoleForDisplay } from '../lib/workforcePlanningData';
import { EmployeeDetailDrawer, BasicEmployeeInfo } from './EmployeeDetailDrawer';

interface PlanningScenario {
  id: string;
  name: string;
  created_at: string;
  source: 'legacy' | 'ai'; // To differentiate between old and new scenarios
  planning_date: string; // The planning date for this scenario (used as "today" for the scenario)
}

interface AircraftSchedule {
  id: string;
  aircraft_reg: string;
  customer: string;
  fleet: string;
  check_type: string;
  induct_date: string;
  ets_date: string;
  cert_eng_req: number;
  bay_assignment: string;
}

interface BayAllocation {
  bayNumber: number;
  aircraft: AircraftSchedule;
  dates: string[];
}

interface AdditionalAircraftSlot {
  bayNumber: number;
  date: string;
  aircraftName: string;
}

interface EngineerAssignment {
  resourceId: string;
  resourceName: string;
  tailNumber: string;
  date: string;
  support: 'core' | 'AV';
  isAdditional: boolean;
}

interface Employee {
  id: string;
  name: string;
  title: string;
  licenses: string[];
  yearsExp: number;
  mostWorkedAircraft: string;
  leaveBalance: number;
  upcomingLeaves: number;
  trainings: string[];
  core: string;
  support: string;
}

interface MatchCandidate extends Employee {
  similarity: number;
  currentTail: string;
}

// Interface for data returned from get_roster_with_scenario_overrides_with_trainings RPC
// Matches the actual function output from RPC
interface RosterWithOverrideRow {
  id: string;        // emp_id
  name: string;
  team: string;
  title: string;     // Role: CC, ENGR, TECH
  date: string;
  tail_num: string | null;  // tail number if assigned to a task
  task: string;      // either tail_num (if assigned) or roster code
  planned_core: string | null;    // Core assignment for this date
  planned_support: string | null; // Support assignment for this date
  bay: string | null;
  expired_trainings: string | null;
}

// State shape for scenario roster data from get_roster_with_scenario_overrides_with_trainings
interface ScenarioRosterState {
  isLoading: boolean;
  error: string | null;
  scenarioName: string | null;
  rows: RosterWithOverrideRow[];
  // Derived/indexed data for quick lookups
  byEmployee: Map<string, RosterWithOverrideRow[]>; // emp_id -> rows for that employee
  byDate: Map<string, RosterWithOverrideRow[]>;     // date -> rows for that date
  byEmployeeDate: Map<string, RosterWithOverrideRow>; // `${emp_id}-${date}` -> single row
}

// Interface for tail details from visit_details/visit_planning_combined
interface TailDetails {
  tailNum: string;
  inductionDate: string;
  etsDate: string;
  airline: string;
  aircraft: string;
  engine: string;
  checkType: string;
  bay: string;
  minEngineers: number;
  minTechnicians: number;
}

// Interface for suggested engineer from get_emp_360_for_tail_excluding RPC
interface SuggestedEngineer {
  empId: string;
  empName: string;
  title: string;
  team: string;
  yearsOfExperience: number;
  mostWorkedAircraft: string;
  licenses: string[];
  licenseCount: number;
  totalLeaveBalance: number;
  upcomingLeaves4wCount: number;
}

// Interface for technician details from emp_cc_tech_work_summary_vw
interface TechnicianDetails {
  empId: string;
  empName: string;
  title: string;
  team: string;
  aircraft: string;
  engine: string;
}

// Cell colors are imported from workforcePlanningData.ts

const TODAY = '2022-04-30';

export function PlanningScenarioVisualizer() {
  const [scenarios, setScenarios] = useState<PlanningScenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>(''); // Default to no selection - used for viewing
  const [activeScenario, setActiveScenario] = useState<string>(''); // Separate state for "Current Active Scenario" in settings popup
  const [aircraftSchedules, setAircraftSchedules] = useState<AircraftSchedule[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [bayAllocations, setBayAllocations] = useState<BayAllocation[]>([]);
  const [additionalAircraftSlots, setAdditionalAircraftSlots] = useState<AdditionalAircraftSlot[]>([]);
  const [engineerAssignments, setEngineerAssignments] = useState<EngineerAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rosterData, setRosterData] = useState<Map<string, string>>(new Map()); // Key: `${employeeId}-${date}`, Value: roster_code
  const [rosterEmployeeNames, setRosterEmployeeNames] = useState<Map<string, { name: string; team: string }>>(new Map()); // Key: employeeId, Value: { name, team }
  const [selectedBay, setSelectedBay] = useState<{ bay: number; tail: string; date: string } | null>(null);
  const [selectedEmployeeForDrawer, setSelectedEmployeeForDrawer] = useState<BasicEmployeeInfo | null>(null);
  const [showEmployeeDrawer, setShowEmployeeDrawer] = useState(false);
  const [additionalEngReq, setAdditionalEngReq] = useState({ CC: 2, ENGR: 3, TECH: 4 });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<string | null>(null); // Selected task tail number for filtering
  const [selectedDate, setSelectedDate] = useState<string>(''); // Selected date for Core/Support display

  // Role column sorting state: null (unsorted), 'asc', or 'desc'
  const [roleSortDirection, setRoleSortDirection] = useState<'asc' | 'desc' | null>(null);

  // Multi-select dates for Bay Occupancy Chart
  const [selectedBayDates, setSelectedBayDates] = useState<Set<string>>(new Set());
  const [lastClickedBayDate, setLastClickedBayDate] = useState<string | null>(null);

  // Tracks selected cells as { bay: number, tail: string, dates: string[] }
  const [selectedBayCells, setSelectedBayCells] = useState<{ bay: number; tail: string; dates: string[] } | null>(null);
  // Drag selection state
  const [isDraggingBaySelection, setIsDraggingBaySelection] = useState(false);
  const [dragStartCell, setDragStartCell] = useState<{ bay: number; tail: string; dateIdx: number } | null>(null);

  // When columns are selected and user clicks a bay, highlight those cells in green
  const [selectedBayRowForHighlight, setSelectedBayRowForHighlight] = useState<number | null>(null);

  // State for tail selection UI panel
  const [selectedTailDetails, setSelectedTailDetails] = useState<TailDetails | null>(null);
  
  // Ref to skip resetting selectedTask when scenario changes due to commit
  const skipTaskResetOnScenarioChangeRef = useRef(false);
  const [suggestedEngineers, setSuggestedEngineers] = useState<SuggestedEngineer[]>([]);
  const [coreTeamDetails, setCoreTeamDetails] = useState<SuggestedEngineer[]>([]);
  const [supportTeamDetails, setSupportTeamDetails] = useState<SuggestedEngineer[]>([]);
  const [coreTechnicianDetails, setCoreTechnicianDetails] = useState<TechnicianDetails[]>([]);
  const [supportTechnicianDetails, setSupportTechnicianDetails] = useState<TechnicianDetails[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // State for drag-and-drop - base suggested technicians list
  const [suggestedTechnicians, setSuggestedTechnicians] = useState<TechnicianDetails[]>([]);
  const [draggedItem, setDraggedItem] = useState<{ type: 'engineer' | 'technician'; data: SuggestedEngineer | TechnicianDetails; source: string } | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  // Track which drop zone the mouse is currently over
  const [activeDropZone, setActiveDropZone] = useState<'coreEngineers' | 'coreTechnicians' | 'supportEngineers' | 'supportTechnicians' | 'suggestedEngineers' | 'suggestedTechnicians' | null>(null);

  // Date-specific UI assignments - tracks where each employee is assigned for each date
  // Key: `${empId}-${date}`, Value: { zone: 'core' | 'support', tail: string }
  // This is used to compute which section to display each employee in for the selected date
  const [uiDateAssignments, setUiDateAssignments] = useState<Map<string, { zone: 'core' | 'support'; tail: string }>>(new Map());

  // UI-only overrides for roster display - tracks core/support assignment changes from drag-and-drop
  // Key: `${empId}-${date}`, Value: { core: tailNum | null, support: tailNum | null }
  const [uiRosterOverrides, setUiRosterOverrides] = useState<Map<string, { core?: string | null; support?: string | null }>>(new Map());

  // Track removed core team members (empIds that user has removed via X button)
  const [removedCoreTeamMembers, setRemovedCoreTeamMembers] = useState<Set<string>>(new Set());
  
  // Track removed core team member details for logging
  const [removedCoreTeamDetails, setRemovedCoreTeamDetails] = useState<Map<string, { empName: string; tailNum: string; dates: string[] }>>(new Map());
  
  // Track added to core details for logging
  const [addedToCoreDetails, setAddedToCoreDetails] = useState<Map<string, { empName: string; tailNum: string; dates: string[] }>>(new Map());
  
  // Track added to support details for logging
  const [addedToSupportDetails, setAddedToSupportDetails] = useState<Map<string, { empName: string; tailNum: string; dates: string[] }>>(new Map());
  
  // Track removed support team members
  const [removedSupportMembers, setRemovedSupportMembers] = useState<Set<string>>(new Set());
  
  // Track removed support team member details for logging
  const [removedSupportDetails, setRemovedSupportDetails] = useState<Map<string, { empName: string; tailNum: string; dates: string[] }>>(new Map());
  
  // Track DB core engineers moved to support
  const [movedCoreDbEngineersToSupport, setMovedCoreDbEngineersToSupport] = useState<Map<string, SuggestedEngineer>>(new Map());
  
  // Committing changes state
  const [isCommitting, setIsCommitting] = useState(false);
  
  // Settings popup state
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);

  // Refs for synchronized scrolling - Assignment & Roster Chart
  const dateHeaderRef = useRef<HTMLDivElement>(null);
  const dateBodyRef = useRef<HTMLDivElement>(null);
  const fixedColumnsBodyRef = useRef<HTMLDivElement>(null);
  const detailsColumnsBodyRef = useRef<HTMLDivElement>(null);

  // Refs for synchronized scrolling - Bay Occupancy Chart
  const bayHeaderRef = useRef<HTMLDivElement>(null);
  const bayBodyRef = useRef<HTMLDivElement>(null);

  // Scroll synchronization handlers - syncs both charts horizontally
  const handleDateBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Sync horizontal scroll with header and Bay Occupancy Chart
    if (dateHeaderRef.current) {
      dateHeaderRef.current.scrollLeft = target.scrollLeft;
    }
    if (bayHeaderRef.current) {
      bayHeaderRef.current.scrollLeft = target.scrollLeft;
    }
    if (bayBodyRef.current) {
      bayBodyRef.current.scrollLeft = target.scrollLeft;
    }
    // Sync vertical scroll with fixed columns
    if (fixedColumnsBodyRef.current) {
      fixedColumnsBodyRef.current.scrollTop = target.scrollTop;
    }
    if (detailsColumnsBodyRef.current) {
      detailsColumnsBodyRef.current.scrollTop = target.scrollTop;
    }
  };

  const handleFixedColumnsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Sync vertical scroll with date body and details
    if (dateBodyRef.current) {
      dateBodyRef.current.scrollTop = target.scrollTop;
    }
    if (detailsColumnsBodyRef.current) {
      detailsColumnsBodyRef.current.scrollTop = target.scrollTop;
    }
  };

  const handleDetailsColumnsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Sync vertical scroll with date body and fixed columns
    if (dateBodyRef.current) {
      dateBodyRef.current.scrollTop = target.scrollTop;
    }
    if (fixedColumnsBodyRef.current) {
      fixedColumnsBodyRef.current.scrollTop = target.scrollTop;
    }
  };

  // Scroll handler for Bay Occupancy Chart - syncs with Assignment & Roster Chart
  const handleBayBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Sync horizontal scroll with Assignment & Roster Chart and Bay header
    if (dateHeaderRef.current) {
      dateHeaderRef.current.scrollLeft = target.scrollLeft;
    }
    if (dateBodyRef.current) {
      dateBodyRef.current.scrollLeft = target.scrollLeft;
    }
    if (bayHeaderRef.current) {
      bayHeaderRef.current.scrollLeft = target.scrollLeft;
    }
  };

  // State for roster data from get_roster_with_scenario_overrides_with_trainings RPC
  const [scenarioRosterData, setScenarioRosterData] = useState<ScenarioRosterState>({
    isLoading: false,
    error: null,
    scenarioName: null,
    rows: [],
    byEmployee: new Map(),
    byDate: new Map(),
    byEmployeeDate: new Map(),
  });

  // Handler to fetch roster data with scenario overrides
  async function handleScenarioSelection(scenarioName: string) {
    // Set loading state
    setScenarioRosterData(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      scenarioName,
    }));

    try {
      console.log('Fetching roster with scenario overrides for:', scenarioName);

      // Get the planning_date for this scenario
      const scenario = scenarios.find(s => s.name === scenarioName);
      const planningDate = scenario?.planning_date || '2022-04-30';
      const normalizedPlanningDate = new Date(planningDate).toISOString().split('T')[0];
      console.log('Scenario planning_date:', planningDate, 'normalized:', normalizedPlanningDate);

      // Fetch scenario data and planning_master_fn (for planning date only) in parallel
      const [scenarioResult, planningMasterResult] = await Promise.all([
        supabase
          .rpc('get_roster_with_scenario_overrides_with_trainings', { p_scenario_name: scenarioName })
          .limit(50000),
        supabase
          .rpc('planning_master_fn', {
            p_curr_date: planningDate,
            p_win_start: planningDate,
            p_win_end: planningDate
          })
      ]);

      if (scenarioResult.error) {
        console.error('Error calling get_roster_with_scenario_overrides_with_trainings:', scenarioResult.error);
        setScenarioRosterData(prev => ({
          ...prev,
          isLoading: false,
          error: scenarioResult.error.message,
          rows: [],
          byEmployee: new Map(),
          byDate: new Map(),
          byEmployeeDate: new Map(),
        }));
        return;
      }

      // Build rows for the PLANNING DATE from planning_master_fn
      // Planning date data comes EXCLUSIVELY from planning_master_fn
      const planningDateRows: RosterWithOverrideRow[] = [];
      if (planningMasterResult.data && !planningMasterResult.error) {
        console.log('planning_master_fn returned', planningMasterResult.data.length, 'rows for planning_date:', planningDate);
        // Debug: Log first few raw rows to see actual structure
        if (planningMasterResult.data.length > 0) {
          console.log('planning_master_fn RAW first 3 rows:', planningMasterResult.data.slice(0, 3));
          console.log('planning_master_fn column names:', Object.keys(planningMasterResult.data[0]));
        }
        (planningMasterResult.data as any[]).forEach((row: any) => {
          // planning_master_fn returns 'id' not 'emp_id'
          const empId = row.id;
          if (empId) {
            // planning_master_fn returns 'roster_entry' for the task/assignment
            const rosterEntry = row.roster_entry || '';
            const isTailNumber = rosterEntry && /^[A-Z0-9]{2,}-[A-Z0-9]+$/i.test(rosterEntry);

            planningDateRows.push({
              id: empId,
              name: row.name || empId,
              team: row.team || '',
              title: row.title || 'ENGR',
              date: normalizedPlanningDate,
              tail_num: isTailNumber ? rosterEntry : null,
              task: rosterEntry,
              planned_core: row.planned_core || '',
              planned_support: row.planned_support || '',
              bay: null,
              expired_trainings: null,
            });
          }
        });
        console.log('Created', planningDateRows.length, 'rows for planning date from planning_master_fn');
        // Log a sample with the composite key that will be used for lookups
        console.log('planningDateRows sample with keys:', planningDateRows.slice(0, 3).map(r => ({
          compositeKey: `${r.id}-${r.date}`,
          id: r.id,
          date: r.date,
          task: r.task,
          planned_core: r.planned_core,
          planned_support: r.planned_support,
        })));
      } else if (planningMasterResult.error) {
        console.warn('Error calling planning_master_fn:', planningMasterResult.error);
      } else {
        console.warn('planning_master_fn returned no data');
      }

      // Get scenario rows (for all OTHER dates, excluding planning date)
      const scenarioRows = (scenarioResult.data || []) as RosterWithOverrideRow[];
      console.log(`Loaded ${scenarioRows.length} roster rows for scenario: ${scenarioName}`);

      // Filter out any planning date rows from scenario data (we use planning_master_fn for that date)
      const nonPlanningDateRows = scenarioRows.filter(row => {
        const dateKey = new Date(row.date).toISOString().split('T')[0];
        return dateKey !== normalizedPlanningDate;
      });
      console.log(`After filtering planning date: ${nonPlanningDateRows.length} rows (removed ${scenarioRows.length - nonPlanningDateRows.length} planning date rows)`);

      // Combine: planning date rows + other date rows
      const rows = [...planningDateRows, ...nonPlanningDateRows];
      console.log(`Total combined rows: ${rows.length} (${planningDateRows.length} planning date + ${nonPlanningDateRows.length} other dates)`);

      // Build indexed maps for quick lookups
      const byEmployee = new Map<string, RosterWithOverrideRow[]>();
      const byDate = new Map<string, RosterWithOverrideRow[]>();
      const byEmployeeDate = new Map<string, RosterWithOverrideRow>();

      rows.forEach(row => {
        // Index by employee (using 'id' field which is emp_id)
        if (!byEmployee.has(row.id)) {
          byEmployee.set(row.id, []);
        }
        byEmployee.get(row.id)!.push(row);

        // Index by date - normalize to YYYY-MM-DD format for consistent lookups
        const dateKey = new Date(row.date).toISOString().split('T')[0];
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, []);
        }
        byDate.get(dateKey)!.push(row);

        // Index by employee-date composite key (using normalized date)
        const compositeKey = `${row.id}-${dateKey}`;
        byEmployeeDate.set(compositeKey, row);
      });

      // Update state with loaded data
      setScenarioRosterData({
        isLoading: false,
        error: null,
        scenarioName,
        rows,
        byEmployee,
        byDate,
        byEmployeeDate,
      });

      console.log('Scenario roster data loaded:', {
        totalRows: rows.length,
        uniqueEmployees: byEmployee.size,
        uniqueDates: byDate.size,
        byEmployeeDateSize: byEmployeeDate.size,
        planningDateRowsCount: planningDateRows.length,
      });

      // Debug: Show sample keys and dates in the maps
      console.log('byDate keys (all dates in data):', Array.from(byDate.keys()));
      console.log('byEmployeeDate sample keys (first 10):', Array.from(byEmployeeDate.keys()).slice(0, 10));
      // Check if planning date is in byDate
      console.log('Planning date in byDate?', byDate.has(normalizedPlanningDate), 'normalizedPlanningDate:', normalizedPlanningDate);
      if (byDate.has(normalizedPlanningDate)) {
        console.log('Rows for planning date:', byDate.get(normalizedPlanningDate)?.slice(0, 3));
      }

    } catch (err: any) {
      console.error('Exception in handleScenarioSelection:', err);
      setScenarioRosterData(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || 'Unknown error',
        rows: [],
        byEmployee: new Map(),
        byDate: new Map(),
        byEmployeeDate: new Map(),
      }));
    }
  }

  useEffect(() => {
    loadScenarios();
    loadEmployees();
    loadVisitsBaseline(); // Load visits baseline by default
  }, []);

  // Debug: Log when aircraftSchedules changes
  useEffect(() => {
    console.log('aircraftSchedules state changed:', aircraftSchedules.length, aircraftSchedules);
  }, [aircraftSchedules]);

  // Debug: Log when engineerAssignments changes
  useEffect(() => {
    console.log('engineerAssignments state changed:', engineerAssignments.length);
    if (engineerAssignments.length > 0) {
      const tailNumbers = new Set(engineerAssignments.map(a => a.tailNumber));
      console.log('engineerAssignments - tail numbers:', Array.from(tailNumbers));
      const dateRange = {
        min: engineerAssignments.reduce((min, a) => a.date < min ? a.date : min, engineerAssignments[0].date),
        max: engineerAssignments.reduce((max, a) => a.date > max ? a.date : max, engineerAssignments[0].date),
      };
      console.log('engineerAssignments - date range:', dateRange);
    }
  }, [engineerAssignments]);

  useEffect(() => {
    // Check if we should skip resetting selectedTask (e.g., after commit)
    if (skipTaskResetOnScenarioChangeRef.current) {
      // Reset the flag but preserve selectedTask
      skipTaskResetOnScenarioChangeRef.current = false;
      // Only clear the tracking states, not the selectedTask
      setUiDateAssignments(new Map());
      setUiRosterOverrides(new Map());
    } else {
      // Reset all filters and selections when switching scenarios
      setSelectedTask(null);
      setSearchQuery('');
      setSelectedBay(null);
      // Clear date-specific assignments when switching scenarios
      setUiDateAssignments(new Map());
      setUiRosterOverrides(new Map());
    }

    // Clear current data before loading new data
    setAircraftSchedules([]);
    setDates([]);
    setBayAllocations([]);
    setEngineerAssignments([]);
    setAdditionalAircraftSlots([]);

    if (!selectedScenario) {
      // No scenario selected - clear all data
      setScenarioRosterData({
        isLoading: false,
        error: null,
        scenarioName: null,
        rows: [],
        byEmployee: new Map(),
        byDate: new Map(),
        byEmployeeDate: new Map(),
      });
    } else {
      // Scenario ID is the scenario_name from scenario_allocations_v2_flat
      // Call the RPC to fetch roster data with scenario overrides
      handleScenarioSelection(selectedScenario);
    }
  }, [selectedScenario, scenarios]);

  async function loadScenarios() {
    // Load unique scenario names from scenario_master_view
    const { data, error } = await supabase
      .from('scenario_master_view')
      .select('scenario_name')
      .order('scenario_name');

    if (error) {
      console.error('Error loading scenarios from scenario_master_view:', error);
      return;
    }

    // Get unique scenario names
    const uniqueScenarioNames = new Set<string>();
    (data || []).forEach((row: { scenario_name: string }) => {
      if (row.scenario_name) {
        uniqueScenarioNames.add(row.scenario_name);
      }
    });

    // Convert to PlanningScenario format
    const allScenarios: PlanningScenario[] = Array.from(uniqueScenarioNames).map((name) => ({
      id: name, // Use scenario_name as the ID
      name: name,
      created_at: new Date().toISOString(),
      source: 'ai' as const,
      planning_date: '2022-04-30', // Default planning date, will be fetched from RPC when scenario is selected
    }));

    console.log('Loaded scenarios from scenario_master_view:', allScenarios.length, allScenarios);
    setScenarios(allScenarios);

    // Fetch the default active scenario from scenario_active_state table
    const { data: activeScenarioData, error: activeError } = await supabase
      .from('scenario_active_state')
      .select('scenario_name')
      .eq('isactive', true)
      .single();

    if (activeError) {
      console.log('No active scenario found or error fetching:', activeError.message);
    } else if (activeScenarioData?.scenario_name) {
      // Check if the active scenario exists in our loaded scenarios
      const activeExists = allScenarios.some(s => s.name === activeScenarioData.scenario_name);
      if (activeExists) {
        console.log('Auto-selecting active scenario from DB:', activeScenarioData.scenario_name);
        setSelectedScenario(activeScenarioData.scenario_name);
        setActiveScenario(activeScenarioData.scenario_name); // Also set activeScenario state
      } else {
        console.log('Active scenario from DB not found in available scenarios:', activeScenarioData.scenario_name);
      }
    }
  }

  // Update scenario_active_state when user changes dropdown selection
  async function updateActiveScenarioInDB(scenarioName: string) {
    try {
      // Deactivate all existing active scenarios
      await supabase
        .from('scenario_active_state')
        .update({ isactive: false, updated_at: new Date().toISOString() })
        .eq('isactive', true);

      // Activate the selected scenario
      const { error } = await supabase
        .from('scenario_active_state')
        .upsert({
          scenario_name: scenarioName,
          isactive: true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'scenario_name' });

      if (error) {
        console.error('Error updating active scenario:', error);
      } else {
        console.log('Successfully updated active scenario to:', scenarioName);
      }
    } catch (err) {
      console.error('Error in updateActiveScenarioInDB:', err);
    }
  }

  // Commit changes to scenario_action_log table
  async function commitChangesToDatabase() {
    // Check if ANY changes exist
    const hasChanges = removedCoreTeamDetails.size > 0 || addedToCoreDetails.size > 0 || addedToSupportDetails.size > 0 || removedSupportDetails.size > 0;
    
    if (!selectedScenario || !hasChanges) {
      console.log('No changes to commit');
      return;
    }

    setIsCommitting(true);
    
    try {
      console.log('Committing changes to scenario_action_log...');
      
      // Deactivate all existing records in scenario_action_log
      const { error: updateError } = await supabase
        .from('scenario_action_log')
        .update({ isactive: '' })
        .neq('isactive', ''); // Update all that aren't already empty
      
      if (updateError) {
        console.error('Error deactivating existing records:', updateError);
      } else {
        console.log('Successfully deactivated existing records');
      }

      // Prepare all records for different actions
      const allRecords: {
        created_at: string;
        scenario_name: string;
        tail_num: string;
        id: string;
        name: string;
        action: string;
        isactive: string;
        assignment_date: string | null;
      }[] = [];

      // REMOVED_FROM_CORE records - one per date
      Array.from(removedCoreTeamDetails.entries()).forEach(([empId, details]) => {
        details.dates.forEach(date => {
          allRecords.push({
            created_at: new Date().toISOString(),
            scenario_name: selectedScenario,
            tail_num: details.tailNum,
            id: empId,
            name: details.empName,
            action: 'REMOVED_FROM_CORE',
            isactive: 'active',
            assignment_date: date
          });
        });
      });

      // ADDED_TO_CORE records - one per date
      Array.from(addedToCoreDetails.entries()).forEach(([empId, details]) => {
        details.dates.forEach(date => {
          allRecords.push({
            created_at: new Date().toISOString(),
            scenario_name: selectedScenario,
            tail_num: details.tailNum,
            id: empId,
            name: details.empName,
            action: 'ADDED_TO_CORE',
            isactive: 'active',
            assignment_date: date
          });
        });
      });

      // ADDED_TO_SUPPORT records - one per date
      Array.from(addedToSupportDetails.entries()).forEach(([empId, details]) => {
        details.dates.forEach(date => {
          allRecords.push({
            created_at: new Date().toISOString(),
            scenario_name: selectedScenario,
            tail_num: details.tailNum,
            id: empId,
            name: details.empName,
            action: 'ADDED_TO_SUPPORT',
            isactive: 'active',
            assignment_date: date
          });
        });
      });

      // REMOVED_FROM_SUPPORT records - one per date
      Array.from(removedSupportDetails.entries()).forEach(([empId, details]) => {
        details.dates.forEach(date => {
          allRecords.push({
            created_at: new Date().toISOString(),
            scenario_name: selectedScenario,
            tail_num: details.tailNum,
            id: empId,
            name: details.empName,
            action: 'REMOVED_FROM_SUPPORT',
            isactive: 'active',
            assignment_date: date
          });
        });
      });

      if (allRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('scenario_action_log')
          .insert(allRecords);

        if (insertError) {
          console.error('Error inserting new records:', insertError);
          alert('Error saving changes: ' + insertError.message);
          return;
        }
      }

      // Set flag BEFORE any state changes to preserve selectedTask
      skipTaskResetOnScenarioChangeRef.current = true;

      // Calculate Base and displayName
      const base = selectedScenario.replace(/_latest$/, '');
      const latestScenarioName = `${base}_latest`;

      // Refresh scenarios list from scenario_master_view
      const { data: freshScenarios, error: scenarioError } = await supabase
        .from('scenario_master_view')
        .select('scenario_name')
        .order('scenario_name');

      if (scenarioError) {
        console.error('Error refreshing scenarios:', scenarioError);
      }

      // Build unique scenarios from fresh data
      const uniqueScenarioNames = new Set<string>();
      (freshScenarios || []).forEach((row: any) => {
        if (row.scenario_name) {
          uniqueScenarioNames.add(row.scenario_name);
        }
      });
      const scenariosList: PlanningScenario[] = Array.from(uniqueScenarioNames).map((name) => ({
        id: name,
        name: name,
        created_at: new Date().toISOString(),
        source: 'ai' as const,
        planning_date: '2022-04-30'
      }));
      setScenarios(scenariosList);
      console.log('Fresh scenarios loaded:', scenariosList.length);

      // Check for '_latest' scenario in FRESH data
      const latestScenario = scenariosList.find(s => s.name === latestScenarioName);
      
      // Clear tracking states FIRST (clear local pending changes)
      setRemovedCoreTeamMembers(new Set());
      setRemovedCoreTeamDetails(new Map());
      setAddedToCoreDetails(new Map());
      setAddedToSupportDetails(new Map());
      setRemovedSupportMembers(new Set());
      setRemovedSupportDetails(new Map());
      setUiDateAssignments(new Map());
      setUiRosterOverrides(new Map());

      // Force reload scenario data
      // If _latest scenario exists, switch to it; otherwise reload with base scenario
      if (latestScenario) {
        skipTaskResetOnScenarioChangeRef.current = true;
        setSelectedScenario(latestScenarioName);
        setActiveScenario(latestScenarioName); // Also update activeScenario state
        // Update active scenario in DB
        await updateActiveScenarioInDB(latestScenarioName);
      } else {
        // Try to load with base scenario name
        const baseScenario = scenariosList.find(s => s.name === base);
        if (baseScenario) {
          console.log('Switching to base scenario:', base);
          skipTaskResetOnScenarioChangeRef.current = true;
          setSelectedScenario(base);
          setActiveScenario(base); // Also update activeScenario state
          await updateActiveScenarioInDB(base);
        } else {
          // Force reload current scenario by calling handleScenarioSelection directly
          console.log('Reloading current scenario:', selectedScenario);
          await handleScenarioSelection(selectedScenario);
        }
      }

      alert('Changes committed successfully!');
      
    } catch (err: any) {
      console.error('Exception committing changes:', err);
      alert('Error saving changes: ' + (err.message || 'Unknown error'));
    } finally {
      setIsCommitting(false);
    }
  }

  async function loadEmployees() {
    const { data } = await supabase
      .from('resources')
      .select('*')
      .order('name');

    if (data) {
      const employeesData: Employee[] = data.map(r => ({
        id: r.id,
        name: r.name,
        title: r.title,
        licenses: generateLicenses(r.id),
        yearsExp: generateYearsExp(r.id),
        mostWorkedAircraft: generateMostWorkedAircraft(r.id),
        leaveBalance: generateLeaveBalance(r.id),
        upcomingLeaves: generateUpcomingLeaves(r.id),
        trainings: generateTrainings(r.id),
        core: r.core || '',
        support: r.support || '',
      }));
      setEmployees(employeesData);
    }
  }

  // Load roster data from emp_roster table
  // Loads ALL employees from emp_roster for the given date range
  // No longer depends on employees state - loads directly from emp_roster
  async function loadRosterData(dateRange: string[], filterToMayOnly: boolean = false) {
    if (dateRange.length === 0) {
      console.log('loadRosterData: Skipping - empty date range');
      setRosterData(new Map());
      return;
    }

    // If filtering to May 2022 only, adjust date range
    let queryStartDate = dateRange[0];
    let queryEndDate = dateRange[dateRange.length - 1];

    if (filterToMayOnly) {
      queryStartDate = '2022-05-01';
      queryEndDate = '2022-05-31';
      console.log(`loadRosterData: Filtering to May 2022 only for AI scenario merge`);
    }

    console.log(`loadRosterData: Loading ALL employees from emp_roster from ${queryStartDate} to ${queryEndDate}`);

    try {
      // Query emp_roster directly - get ALL employees (no filtering by employee ID)
      // This ensures we get roster data for every employee in the database
      const { data, error } = await supabase
        .from('emp_roster')
        .select('id, name, team, date, task')
        .gte('date', queryStartDate)
        .lte('date', queryEndDate);

      if (error) {
        console.error('Error loading roster data from emp_roster:', error);
        setRosterData(new Map());
        return;
      }

      // Build Map: ${empId}-${date} → task (roster code)
      const rosterMap = new Map<string, string>();
      const employeeNamesMap = new Map<string, { name: string; team: string }>();

      (data || []).forEach((record: any) => {
        const empId = record.id;
        const date = new Date(record.date).toISOString().split('T')[0];
        const rosterEntry = record.task || '';

        if (empId && date && rosterEntry) {
          rosterMap.set(`${empId}-${date}`, rosterEntry);
        }

        // Store employee name and team (only need to do this once per employee)
        if (empId && !employeeNamesMap.has(empId)) {
          employeeNamesMap.set(empId, {
            name: record.name || empId,
            team: record.team || '',
          });
        }
      });

      console.log(`loadRosterData: Loaded ${rosterMap.size} roster entries for ${employeeNamesMap.size} unique employees from emp_roster`);
      setRosterData(rosterMap);
      setRosterEmployeeNames(employeeNamesMap);
    } catch (err) {
      console.error('Exception loading roster data:', err);
      setRosterData(new Map());
    }
  }

  // Load only ongoing & upcoming visits from visit_planning_combined (Visits Baseline)
  async function loadVisitsBaseline() {
    // Reset all state first
    setAircraftSchedules([]);
    setDates([]);
    setBayAllocations([]);
    setEngineerAssignments([]);
    setAdditionalAircraftSlots([]);

    // Reload employees
    await loadEmployees();

    // Load only from visit_planning_combined - this is the visits baseline
    const { data: visitPlanningData } = await supabase
      .from('visit_planning_combined')
      .select('*')
      .order('induction_date', { ascending: true });

    if (!visitPlanningData || visitPlanningData.length === 0) {
      console.log('No visit planning data found');
      return;
    }

    // Filter for ongoing and upcoming visits only (induction_date >= today - 30 days OR ets_date >= today)
    const todayDate = new Date(TODAY);
    const thirtyDaysAgo = new Date(todayDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const filteredVisits = visitPlanningData.filter((visit: any) => {
      const inductionDate = new Date(visit.induction_date);
      const etsDate = new Date(visit.ets_date);
      // Include if: currently ongoing (started but not finished) OR upcoming (hasn't started yet)
      return etsDate >= todayDate || inductionDate >= thirtyDaysAgo;
    });

    if (filteredVisits.length === 0) {
      console.log('No ongoing or upcoming visits found');
      return;
    }

    // Convert to AircraftSchedule format
    const schedules: AircraftSchedule[] = filteredVisits.map((visit: any, idx: number) => ({
      id: `visit-${idx}`,
      aircraft_reg: visit.tail_num,
      customer: visit.customer || '',
      fleet: visit.aircraft || '',
      check_type: visit.check_type || '',
      induct_date: visit.induction_date,
      ets_date: visit.ets_date,
      cert_eng_req: visit.min_engineers || 0,
      bay_assignment: visit.bay || '',
    }));

    setAircraftSchedules(schedules);

    // Calculate date range from all schedules
    let minDate = new Date(schedules[0].induct_date);
    let maxDate = new Date(schedules[0].ets_date);

    schedules.forEach(s => {
      const induct = new Date(s.induct_date);
      const ets = new Date(s.ets_date);
      if (induct < minDate) minDate = induct;
      if (ets > maxDate) maxDate = ets;
    });

    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);

    const dateRange = generateDateRange(
      minDate.toISOString().split('T')[0],
      maxDate.toISOString().split('T')[0]
    );
    setDates(dateRange);

    // Allocate bays based on the schedules
    const bays = allocateBaysForDefaultView(schedules, dateRange);
    setBayAllocations(bays);

    // For visits baseline, we don't have assignments yet (they need to be created)
    // But we can try to load any existing assignments that match these tail numbers
    const tailNumbers = schedules.map(s => s.aircraft_reg);
    
    const { data: assignments } = await supabase
      .from('assignments')
      .select('*, requirements!inner(tail_number, date), resources!inner(name, title, core, support)')
      .in('requirements.tail_number', tailNumbers);

    if (assignments && assignments.length > 0) {
      const engineerAssignmentsData: EngineerAssignment[] = assignments.map((a: any) => ({
        resourceId: a.resource_id,
        resourceName: a.resources.name,
        tailNumber: a.requirements.tail_number || '',
        date: new Date(a.date).toISOString().split('T')[0],
        support: a.resources.core === a.resources.support ? 'core' : 'AV',
        isAdditional: false,
      }));
      setEngineerAssignments(engineerAssignmentsData);
    }

    // Load roster data for all employees from emp_roster
    if (dateRange.length > 0) {
      await loadRosterData(dateRange);
    }

    setAdditionalAircraftSlots([]);
  }

  // Fetch tail details from visit_planning_combined
  async function fetchTailDetails(tailNum: string): Promise<TailDetails | null> {
    try {
      const { data, error } = await supabase
        .from('visit_planning_combined')
        .select('*')
        .eq('tail_num', tailNum)
        .order('induction_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching tail details:', error);
        return null;
      }

      if (!data) {
        console.log('No tail details found for:', tailNum);
        return null;
      }

      return {
        tailNum: data.tail_num,
        inductionDate: data.induction_date,
        etsDate: data.ets_date,
        airline: data.customer || '',
        aircraft: data.aircraft || '',
        engine: data.engine || '',
        checkType: data.check_type || '',
        bay: data.bay_alloc || '',
        minEngineers: data.min_engineers || 0,
        minTechnicians: data.min_technicians || 0,
      };
    } catch (err) {
      console.error('Exception fetching tail details:', err);
      return null;
    }
  }

  // Fetch employee details from emp_360 table by emp_ids
  async function fetchEmployeeDetails(empIds: string[]): Promise<SuggestedEngineer[]> {
    if (!empIds || empIds.length === 0) return [];

    try {
      const { data, error } = await supabase
        .from('emp_360')
        .select('*')
        .in('emp_id', empIds);

      if (error) {
        console.error('Error fetching emp_360 details:', error);
        return [];
      }

      if (!data || data.length === 0) return [];

      return data.map((row: any) => ({
        empId: row.emp_id,
        empName: row.emp_name,
        title: row.title || 'ENGR',
        team: row.profit_center || row.team || '',
        yearsOfExperience: row.years_of_experience || 0,
        mostWorkedAircraft: row.most_worked_aircraft || '',
        licenses: row.licenses || [],
        licenseCount: row.license_count || 0,
        totalLeaveBalance: row.total_leave_balance || 0,
        upcomingLeaves4wCount: row.upcoming_leaves_4w_count || 0,
      }));
    } catch (err) {
      console.error('Exception fetching emp_360 details:', err);
      return [];
    }
  }

  // Fetch technician details from emp_cc_tech_work_summary_vw by emp_ids
  // View columns: id, name, team, title, max_worked_aircraft, max_worked_engine
  // Only returns aircraft & engine fields as requested
  async function fetchTechnicianDetails(empIds: string[]): Promise<TechnicianDetails[]> {
    if (!empIds || empIds.length === 0) return [];

    try {
      const { data, error } = await supabase
        .from('emp_cc_tech_work_summary_vw')
        .select('id, name, title, team, max_worked_aircraft, max_worked_engine')
        .in('id', empIds);

      if (error) {
        console.error('Error fetching technician details:', error);
        return [];
      }

      if (!data || data.length === 0) return [];

      console.log('Fetched technician details:', data.length, data);

      return data.map((row: any) => ({
        empId: row.id,
        empName: row.name,
        title: row.title || 'Technician',
        team: row.team || '',
        aircraft: row.max_worked_aircraft || '',
        engine: row.max_worked_engine || '',
      }));
    } catch (err) {
      console.error('Exception fetching technician details:', err);
      return [];
    }
  }

  // Fetch suggested technicians using get_union_recommended_techs RPC
  // Takes an array of core technician names and returns recommended technicians
  async function fetchSuggestedTechnicians(coreTechnicianNames: string[]): Promise<TechnicianDetails[]> {
    if (!coreTechnicianNames || coreTechnicianNames.length === 0) {
      console.log('No core technicians to base suggestions on');
      return [];
    }

    try {
      console.log('Fetching suggested technicians based on core techs:', coreTechnicianNames);

      // Try calling with different parameter name patterns
      // The SQL shows: get_union_recommended_techs(ARRAY['name1','name2'])
      const { data, error } = await supabase
        .rpc('get_union_recommended_techs', {
          tech_names: coreTechnicianNames
        });

      console.log('Suggested technicians RPC result:', { data, error });

      if (error) {
        console.error('Error fetching suggested technicians:', error);
        return [];
      }

      if (!data || data.length === 0) {
        console.log('No suggested technicians found from RPC');
        return [];
      }

      console.log('Suggested technicians RPC response:', data.length, data);
      console.log('First row structure:', JSON.stringify(data[0], null, 2));

      // Map RPC response to TechnicianDetails interface
      // Assuming RPC returns fields like: id/emp_id, name/emp_name, title, team, aircraft, engine
      return data.slice(0, 6).map((row: any) => ({
        empId: row.emp_id || row.id || '',
        empName: row.emp_name || row.name || '',
        title: row.title || 'TECH',
        team: row.team || '',
        aircraft: row.max_worked_aircraft || row.aircraft || '',
        engine: row.max_worked_engine || row.engine || '',
      }));
    } catch (err) {
      console.error('Exception fetching suggested technicians:', err);
      return [];
    }
  }

  // Fetch shift codes with duration_hours = 0 (non-working codes like AL, OFF, etc.)
  async function fetchNonWorkingShiftCodes(): Promise<Set<string>> {
    try {
      const { data, error } = await supabase
        .from('shift_code_master')
        .select('shift_code')
        .eq('duration_hours', 0);

      if (error) {
        console.error('Error fetching shift codes:', error);
        return new Set(['AL', 'TR', 'SK', 'O', 'OFF', 'DO']); // Fallback
      }

      const codes = new Set(data?.map(r => r.shift_code) || []);
      console.log('Non-working shift codes:', Array.from(codes));
      return codes;
    } catch (err) {
      console.error('Exception fetching shift codes:', err);
      return new Set(['AL', 'TR', 'SK', 'O', 'OFF', 'DO']); // Fallback
    }
  }

  // Check if an employee is available on a specific date (not on leave/off)
  function isEmployeeAvailableOnDate(empId: string, checkDate: string, nonWorkingCodes: Set<string>): boolean {
    if (!scenarioRosterData.rows || !checkDate) return true;

    const row = scenarioRosterData.rows.find(r => r.id === empId && r.date === checkDate);
    if (!row) return true;

    const task = row.task?.toUpperCase() || '';
    if (nonWorkingCodes.has(task)) {
      console.log(`Employee ${empId} (${row.name}) unavailable on ${checkDate}: ${task}`);
      return false;
    }

    return true;
  }

  // Filter technicians to only include those available on the check date
  async function filterAvailableTechnicians(techs: TechnicianDetails[], checkDate: string): Promise<TechnicianDetails[]> {
    if (!checkDate || techs.length === 0) return techs;

    const nonWorkingCodes = await fetchNonWorkingShiftCodes();
    const available = techs.filter(tech => isEmployeeAvailableOnDate(tech.empId, checkDate, nonWorkingCodes));
    console.log(`Filtered technicians: ${techs.length} -> ${available.length} available on ${checkDate}`);
    return available;
  }

  // Find available engineers from roster who are not assigned to another tail on the selected date
  async function findAvailableEngineersFromRoster(
    checkDate: string,
    excludeEmpIds: string[],
    selectedTail: string
  ): Promise<SuggestedEngineer[]> {
    if (!scenarioRosterData.rows || scenarioRosterData.rows.length === 0 || !checkDate) {
      return [];
    }

    const nonWorkingCodes = await fetchNonWorkingShiftCodes();
    const excludeSet = new Set(excludeEmpIds);

    // Find all engineers/CC from roster on this date who are:
    // 1. Not on leave (task not in nonWorkingCodes)
    // 2. Not already in excludeEmpIds
    // 3. Either: not assigned to any tail, OR assigned to the selected tail
    const engineerRows = scenarioRosterData.rows.filter(row => {
      if (row.date !== checkDate) return false;
      const isEngineer = row.title === 'ENGR' || row.title === 'CC' || row.title === 'Engineer';
      if (!isEngineer) return false;
      if (excludeSet.has(row.id)) return false;

      const task = row.task?.toUpperCase() || '';
      if (nonWorkingCodes.has(task)) return false;

      // Check if employee is available (not core for another tail)
      const coreForAnotherTail = row.planned_core && row.planned_core !== selectedTail;
      if (coreForAnotherTail) return false;

      return true;
    });

    // Get unique engineers
    const uniqueEngineers = new Map<string, { id: string; name: string; title: string; team: string }>();
    engineerRows.forEach(row => {
      if (!uniqueEngineers.has(row.id)) {
        uniqueEngineers.set(row.id, {
          id: row.id,
          name: row.name,
          title: row.title,
          team: row.team
        });
      }
    });

    console.log('Available engineers from roster:', Array.from(uniqueEngineers.values()));

    // Fetch full details from emp_360
    const empIds = Array.from(uniqueEngineers.keys());
    if (empIds.length === 0) return [];

    const details = await fetchEmployeeDetails(empIds);
    return details;
  }

  // Find available technicians from roster who are not assigned to another tail on the selected date
  async function findAvailableTechniciansFromRoster(
    checkDate: string,
    excludeEmpIds: string[],
    selectedTail: string
  ): Promise<TechnicianDetails[]> {
    if (!scenarioRosterData.rows || scenarioRosterData.rows.length === 0 || !checkDate) {
      return [];
    }

    const nonWorkingCodes = await fetchNonWorkingShiftCodes();
    const excludeSet = new Set(excludeEmpIds);

    // Find all technicians from roster on this date who are:
    // 1. Not on leave (task not in nonWorkingCodes)
    // 2. Not already in excludeEmpIds
    // 3. Either: not assigned to any tail, OR assigned to the selected tail
    const techRows = scenarioRosterData.rows.filter(row => {
      if (row.date !== checkDate) return false;
      const isTechnician = row.title === 'TECH' || row.title === 'Technician';
      if (!isTechnician) return false;
      if (excludeSet.has(row.id)) return false;

      const task = row.task?.toUpperCase() || '';
      if (nonWorkingCodes.has(task)) return false;

      // Check if employee is available (not core for another tail)
      const coreForAnotherTail = row.planned_core && row.planned_core !== selectedTail;
      if (coreForAnotherTail) return false;

      return true;
    });

    // Get unique technicians
    const uniqueTechs = new Map<string, { empId: string; empName: string; title: string; team: string }>();
    techRows.forEach(row => {
      if (!uniqueTechs.has(row.id)) {
        uniqueTechs.set(row.id, {
          empId: row.id,
          empName: row.name,
          title: row.title,
          team: row.team
        });
      }
    });

    console.log('Available technicians from roster:', Array.from(uniqueTechs.values()));

    // Fetch full details from emp_cc_tech_work_summary_vw
    const basicTechs = Array.from(uniqueTechs.values());
    if (basicTechs.length === 0) return [];

    const details = await fetchFullTechnicianDetails(basicTechs);
    return details;
  }

  // Fetch full technician details for a list of basic technician info
  async function fetchFullTechnicianDetails(basicTechs: { empId: string; empName: string; title: string; team: string }[]): Promise<TechnicianDetails[]> {
    if (basicTechs.length === 0) return [];

    const empIds = basicTechs.map(t => t.empId);
    const details = await fetchTechnicianDetails(empIds);

    // If fetchTechnicianDetails returns empty (view might not have all techs), use basic info
    if (details.length === 0) {
      return basicTechs.map(t => ({
        empId: t.empId,
        empName: t.empName,
        title: t.title,
        team: t.team,
        aircraft: '',
        engine: ''
      }));
    }

    return details;
  }

  // Fetch suggested engineers using get_emp_360_for_tail_excluding RPC
  // Then fetch full details from emp_360 table
  async function fetchSuggestedEngineers(tailNum: string, excludeNames: string[]): Promise<SuggestedEngineer[]> {
    try {
      // Ensure excludeNames is always an array (even if empty)
      const excludeArray = excludeNames || [];
      console.log('Fetching suggested engineers for tail:', tailNum, 'excluding:', excludeArray);

      // Call the RPC to get the list of suggested emp_ids
      const { data, error } = await supabase
        .rpc('get_emp_360_for_tail_excluding', {
          p_tail_num: tailNum,
          p_exclude_emp_names: excludeArray
        });

      console.log('RPC call completed. Error:', error, 'Data length:', data?.length);

      if (error) {
        console.error('Error fetching suggested engineers:', error);
        return [];
      }

      if (!data || data.length === 0) {
        console.log('No suggested engineers found for tail:', tailNum);
        return [];
      }

      // Log the raw response to see the actual structure
      console.log('RPC raw response (first row):', JSON.stringify(data[0], null, 2));

      // Get emp_ids from RPC response (limit to 4)
      const empIds = data.slice(0, 4).map((row: any) => row.emp_id);
      console.log('Fetching details for emp_ids:', empIds);

      // Fetch full details from emp_360 table
      const engineers = await fetchEmployeeDetails(empIds);
      console.log('Fetched suggested engineers with full details:', engineers.length, engineers);

      return engineers;
    } catch (err) {
      console.error('Exception fetching suggested engineers:', err);
      return [];
    }
  }

  function generateDateRange(start: string, end: string): string[] {
    const dates: string[] = [];
    let startDate = new Date(start);
    let endDate = new Date(end);

    // Ensure we're comparing dates correctly - swap if start > end
    if (startDate > endDate) {
      console.warn('generateDateRange: start date is after end date, swapping', start, end);
      [startDate, endDate] = [endDate, startDate];
    }

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      // Normalize to ISO format (YYYY-MM-DD)
      const isoDate = currentDate.toISOString().split('T')[0];
      dates.push(isoDate);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Remove duplicates and sort chronologically using Date comparison for accuracy
    const uniqueDates = Array.from(new Set(dates));
    return uniqueDates.sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateA.getTime() - dateB.getTime();
    });
  }

  // Auto-assign bays for the "All Data" view where schedules don't have explicit bay_assignment
  function allocateBaysForDefaultView(schedules: AircraftSchedule[], dateRange: string[]): BayAllocation[] {
    const allocations: BayAllocation[] = [];
    const bayOccupancy: Map<number, string[]> = new Map(); // bay number -> occupied dates

    // Initialize all 13 bays
    for (let i = 1; i <= 13; i++) {
      bayOccupancy.set(i, []);
    }

    // Sort schedules by induct_date to process earliest first
    const sortedSchedules = [...schedules].sort((a, b) => 
      new Date(a.induct_date).getTime() - new Date(b.induct_date).getTime()
    );

    sortedSchedules.forEach(schedule => {
      const scheduleDates = dateRange.filter(date => date >= schedule.induct_date && date <= schedule.ets_date);
      
      if (scheduleDates.length === 0) return;

      // Check if schedule already has a bay assignment
      const bayMatch = schedule.bay_assignment.match(/Bay (\d+)/i);
      let assignedBay = bayMatch ? parseInt(bayMatch[1]) : 0;

      // If no explicit assignment, find an available bay
      if (assignedBay === 0) {
        for (let bay = 1; bay <= 13; bay++) {
          const occupiedDates = bayOccupancy.get(bay) || [];
          const hasConflict = scheduleDates.some(date => occupiedDates.includes(date));
          
          if (!hasConflict) {
            assignedBay = bay;
            break;
          }
        }
      }

      // If we found a bay, create the allocation
      if (assignedBay > 0) {
        // Mark the dates as occupied
        const currentOccupied = bayOccupancy.get(assignedBay) || [];
        bayOccupancy.set(assignedBay, [...currentOccupied, ...scheduleDates]);

        allocations.push({
          bayNumber: assignedBay,
          aircraft: schedule,
          dates: scheduleDates,
        });
      }
    });

    return allocations;
  }


  function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function generateLicenses(id: string): string[] {
    const hash = hashCode(id);
    const licenseTypes = [
      'A320-CFM56-FAA',
      'A380-RR Trent 900-EASA',
      'B777-GE90-GCAA',
      'B787-RR Trent 1000-UKCAA',
      'A350-RR Trent XWB-EASA',
    ];
    const count = (hash % 3) + 1;
    return licenseTypes.slice(0, count);
  }

  function generateYearsExp(id: string): number {
    return (hashCode(id) % 15) + 3;
  }

  function generateMostWorkedAircraft(id: string): string {
    const aircraft = ['A320', 'A380', 'B777', 'B787', 'A350'];
    return aircraft[hashCode(id) % aircraft.length];
  }

  function generateLeaveBalance(id: string): number {
    return (hashCode(id) % 20) + 5;
  }

  function generateUpcomingLeaves(id: string): number {
    return (hashCode(id + 'leave') % 3);
  }

  function generateTrainings(id: string): string[] {
    const allTrainings = [
      'Safety Compliance',
      'Advanced Diagnostics',
      'Composite Repair',
      'Avionics Systems',
      'Engine Overhaul',
    ];
    const count = (hashCode(id + 'training') % 2);
    return allTrainings.slice(0, count);
  }

  const allEngineers = useMemo(() => {
    return employees.filter(e => e.title === 'ENGR');
  }, [employees]);

  // Extract core team members for the selected tail from scenario roster data
  // Core team = employees where planned_core = selectedTask (meaning they are assigned to this tail as their core assignment)
  const coreTeamForSelectedTail = useMemo(() => {
    if (!selectedTask || !scenarioRosterData.scenarioName || scenarioRosterData.rows.length === 0) {
      return [];
    }

    // Find unique employees who have this tail as their core assignment
    // An employee is "core" for a tail when planned_core === tail_num
    const coreEmployees = new Map<string, { empId: string; empName: string; title: string; team: string }>();

    scenarioRosterData.rows.forEach(row => {
      // Check if employee's core assignment matches the selected tail
      if (row.planned_core === selectedTask) {
        if (!coreEmployees.has(row.id)) {
          coreEmployees.set(row.id, {
            empId: row.id,
            empName: row.name,
            title: row.title || 'ENGR',
            team: row.team || '',
          });
        }
      }
    });

    const result = Array.from(coreEmployees.values());
    console.log('coreTeamForSelectedTail:', selectedTask, 'count:', result.length, result.map(e => e.empName));
    return result;
  }, [selectedTask, scenarioRosterData]);

  // Extract support team members for the selected tail from scenario roster data
  const supportTeamForSelectedTail = useMemo(() => {
    if (!selectedTask || !scenarioRosterData.scenarioName || scenarioRosterData.rows.length === 0) {
      return [];
    }

    // Find unique employees who have this tail as their support assignment
    const supportEmployees = new Map<string, { empId: string; empName: string; title: string; team: string }>();

    scenarioRosterData.rows.forEach(row => {
      // Check if employee's support assignment matches the selected tail
      if (row.planned_support === selectedTask) {
        if (!supportEmployees.has(row.id)) {
          supportEmployees.set(row.id, {
            empId: row.id,
            empName: row.name,
            title: row.title || 'ENGR',
            team: row.team || '',
          });
        }
      }
    });

    const result = Array.from(supportEmployees.values());
    return result;
  }, [selectedTask, scenarioRosterData]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return { matchingEngineers: new Set<string>(), matchingTails: new Set<string>(), isEngineerSearch: false };
    }

    const query = searchQuery.toLowerCase().trim();
    const matchingEngineers = new Set<string>();
    const matchingTails = new Set<string>();
    let isEngineerSearch = false;

    // Search in employees
    allEngineers.forEach(engineer => {
      const name = engineer.name || '';
      const id = engineer.id || '';
      if (name.toLowerCase().includes(query) || id.toLowerCase().includes(query)) {
        matchingEngineers.add(engineer.id);
        isEngineerSearch = true;
      }
    });

    // Also search in scenario employees (uniqueEngineers may not be computed yet, so use scenarioRosterData directly)
    if (scenarioRosterData.scenarioName && scenarioRosterData.byEmployee.size > 0) {
      scenarioRosterData.byEmployee.forEach((rows, empId) => {
        if (rows.length > 0) {
          const empName = rows[0].name || empId || '';
          const id = empId || '';
          if (empName.toLowerCase().includes(query) || id.toLowerCase().includes(query)) {
            matchingEngineers.add(empId);
            isEngineerSearch = true;
          }
        }
      });
    }

    // Search in aircraft schedules
    aircraftSchedules.forEach(schedule => {
      if (schedule.aircraft_reg && schedule.aircraft_reg.toLowerCase().includes(query)) {
        matchingTails.add(schedule.aircraft_reg);
      }
    });

    // Search in engineer assignments
    engineerAssignments.forEach(assignment => {
      if (assignment.tailNumber && assignment.tailNumber.toLowerCase().includes(query)) {
        matchingTails.add(assignment.tailNumber);
      }
    });

    // Search in scenario data for tails
    if (scenarioRosterData.scenarioName) {
      scenarioRosterData.rows.forEach(row => {
        if (row.tail_num && row.tail_num.toLowerCase().includes(query)) {
          matchingTails.add(row.tail_num);
        }
      });
    }

    // If searching for an employee, find all tails they're assigned to
    if (isEngineerSearch) {
      // From engineer assignments
      engineerAssignments.forEach(assignment => {
        if (matchingEngineers.has(assignment.resourceId)) {
          matchingTails.add(assignment.tailNumber);
        }
      });
      // From scenario data - find all tails assigned to matching employees
      if (scenarioRosterData.scenarioName) {
        scenarioRosterData.rows.forEach(row => {
          if (matchingEngineers.has(row.id) && row.tail_num) {
            matchingTails.add(row.tail_num);
          }
        });
      }
    } else {
      // If searching for a tail, find all engineers assigned to it
      engineerAssignments.forEach(assignment => {
        if (matchingTails.has(assignment.tailNumber)) {
          matchingEngineers.add(assignment.resourceId);
        }
      });
      // From scenario data
      if (scenarioRosterData.scenarioName) {
        scenarioRosterData.rows.forEach(row => {
          if (row.tail_num && matchingTails.has(row.tail_num)) {
            matchingEngineers.add(row.id);
          }
        });
      }
    }

    return { matchingEngineers, matchingTails, isEngineerSearch };
  }, [searchQuery, allEngineers, aircraftSchedules, engineerAssignments, scenarioRosterData]);

  const uniqueEngineers = useMemo(() => {
    // When a scenario is selected, ONLY use employees from scenario data
    // Don't mix with employees from resources table
    if (scenarioRosterData.scenarioName && scenarioRosterData.byEmployee.size > 0) {
      console.log('uniqueEngineers - Using ONLY scenario employees, count:', scenarioRosterData.byEmployee.size);
      let scenarioEngineers: Employee[] = [];

      scenarioRosterData.byEmployee.forEach((rows, empId) => {
        if (rows.length > 0) {
          const firstRow = rows[0];
          scenarioEngineers.push({
            id: empId,
            name: firstRow.name || empId,
            title: firstRow.title || 'ENGR',  // Use title from RPC data
            licenses: [],
            yearsExp: 0,
            mostWorkedAircraft: '',
            leaveBalance: 0,
            upcomingLeaves: 0,
            trainings: [],
            core: firstRow.team || '',
            support: '',
          });
        }
      });

      // Filter by search query
      if (searchQuery.trim()) {
        scenarioEngineers = scenarioEngineers.filter(e => searchResults.matchingEngineers.has(e.id));
      }

      // Filter by selected task - only show employees assigned to this task in scenario data
      // Also include employees added via drag-and-drop to Core/Support
      if (selectedTask) {
        const assignedToTask = new Set<string>();
        scenarioRosterData.rows.forEach(row => {
          if (row.tail_num === selectedTask) {
            assignedToTask.add(row.id);
          }
        });

        // Also add employees assigned via drag-and-drop (uiDateAssignments) for any date with this tail
        // AND add them to scenarioEngineers if they're not already there
        const existingEmployeeIds = new Set(scenarioEngineers.map(e => e.id));
        uiDateAssignments.forEach((assignment, key) => {
          if (assignment.tail === selectedTask) {
            // Key format is `${empId}-${date}`, extract empId
            const empId = key.split('-')[0];
            assignedToTask.add(empId);

            // If this employee isn't in scenarioEngineers, add them from suggestedEngineers/suggestedTechnicians
            if (!existingEmployeeIds.has(empId)) {
              // Look up in suggestedEngineers first
              const suggestedEng = suggestedEngineers.find(e => e.empId === empId);
              if (suggestedEng) {
                scenarioEngineers.push({
                  id: empId,
                  name: suggestedEng.empName,
                  title: suggestedEng.title || 'ENGR',
                  licenses: [],
                  yearsExp: 0,
                  mostWorkedAircraft: '',
                  leaveBalance: 0,
                  upcomingLeaves: 0,
                  trainings: [],
                  core: suggestedEng.team || '',
                  support: '',
                });
                existingEmployeeIds.add(empId);
              } else {
                // Look up in suggestedTechnicians
                const suggestedTech = suggestedTechnicians.find(t => t.empId === empId);
                if (suggestedTech) {
                  scenarioEngineers.push({
                    id: empId,
                    name: suggestedTech.empName,
                    title: suggestedTech.title || 'TECH',
                    licenses: [],
                    yearsExp: 0,
                    mostWorkedAircraft: '',
                    leaveBalance: 0,
                    upcomingLeaves: 0,
                    trainings: [],
                    core: suggestedTech.team || '',
                    support: '',
                  });
                  existingEmployeeIds.add(empId);
                }
              }
            }
          }
        });

        scenarioEngineers = scenarioEngineers.filter(e => assignedToTask.has(e.id));

        console.log('uniqueEngineers - Filtered by selectedTask:', selectedTask, 'remaining:', scenarioEngineers.length, 'including UI assignments');
      }

      // Apply role sorting if active, otherwise sort by name
      if (roleSortDirection) {
        const roleOrder = { 'Engineer': 1, 'ENGR': 1, 'Technician': 2, 'TECH': 2, 'CC': 3 };
        scenarioEngineers.sort((a, b) => {
          const aOrder = roleOrder[a.title as keyof typeof roleOrder] || 99;
          const bOrder = roleOrder[b.title as keyof typeof roleOrder] || 99;
          return roleSortDirection === 'asc' ? aOrder - bOrder : bOrder - aOrder;
        });
      } else {
        scenarioEngineers.sort((a, b) => a.name.localeCompare(b.name));
      }
      console.log('uniqueEngineers - Returning scenario employees:', scenarioEngineers.length);
      return scenarioEngineers;
    }

    // No scenario selected - use employees from resources table
    const engineersMap = new Map<string, Employee>();
    allEngineers.forEach(e => engineersMap.set(e.id, e));

    // Track which engineers have assignments
    const engineersWithAssignments = new Set(engineerAssignments.map(a => a.resourceId));

    // Add any engineers from assignments that aren't in allEngineers
    engineerAssignments.forEach(assignment => {
      if (!engineersMap.has(assignment.resourceId)) {
        // Create a minimal employee record for engineers with assignments but not in the employees list
        engineersMap.set(assignment.resourceId, {
          id: assignment.resourceId,
          name: assignment.resourceName,
          title: 'ENGR',
          licenses: [],
          yearsExp: 0,
          mostWorkedAircraft: '',
          leaveBalance: 0,
          upcomingLeaves: 0,
          trainings: [],
          core: '',
          support: '',
        });
      }
    });

    // Build set of engineers with roster data and add them if not already in engineersMap
    const engineersWithRoster = new Set<string>();

    // Fall back to original rosterData (no scenario selected case)
    rosterData.forEach((_, key) => {
      const empId = key.split('-')[0];  // Extract emp_id from "${empId}-${date}" key
      engineersWithRoster.add(empId);

      // Add employee from roster if not already in map
      if (!engineersMap.has(empId)) {
        // Get name and team from rosterEmployeeNames if available
        const rosterInfo = rosterEmployeeNames.get(empId);
        // Create a minimal employee record for employees from roster
        engineersMap.set(empId, {
          id: empId,
          name: rosterInfo?.name || empId,
          title: 'ENGR',
          licenses: [],
          yearsExp: 0,
          mostWorkedAircraft: '',
          leaveBalance: 0,
          upcomingLeaves: 0,
          trainings: [],
          core: rosterInfo?.team || '',
          support: '',
        });
      }
    });

    let engineers = Array.from(engineersMap.values());

    // Filter by search query
    if (searchQuery.trim()) {
      engineers = engineers.filter(e => searchResults.matchingEngineers.has(e.id));
    }

    // Filter by selected task - only show engineers assigned to this task
    if (selectedTask) {
      const assignedToTask = new Set(
        engineerAssignments
          .filter(a => a.tailNumber === selectedTask)
          .map(a => a.resourceId)
      );
      engineers = engineers.filter(e => assignedToTask.has(e.id));
    } else {
      // If no task selected, show engineers who have either assignments or roster data
      engineers = engineers.filter(e =>
        engineersWithAssignments.has(e.id) || engineersWithRoster.has(e.id)
      );
    }

    // Apply role sorting if active, otherwise sort by name
    if (roleSortDirection) {
      const roleOrder = { 'Engineer': 1, 'ENGR': 1, 'Technician': 2, 'TECH': 2, 'CC': 3 };
      engineers.sort((a, b) => {
        const aOrder = roleOrder[a.title as keyof typeof roleOrder] || 99;
        const bOrder = roleOrder[b.title as keyof typeof roleOrder] || 99;
        return roleSortDirection === 'asc' ? aOrder - bOrder : bOrder - aOrder;
      });
    } else {
      engineers.sort((a, b) => a.name.localeCompare(b.name));
    }

    return engineers;
  }, [allEngineers, searchQuery, searchResults, selectedTask, engineerAssignments, rosterData, rosterEmployeeNames, scenarioRosterData, uiDateAssignments, suggestedEngineers, suggestedTechnicians, roleSortDirection]);

  // Get the planning date for the currently selected scenario
  // Must be declared before displayDates since displayDates depends on it
  const scenarioPlanningDate = useMemo(() => {
    if (!selectedScenario) return TODAY;
    const scenario = scenarios.find(s => s.name === selectedScenario);
    return scenario?.planning_date || TODAY;
  }, [selectedScenario, scenarios]);

  // Filter dates to show relevant date range
  // When scenario is selected: show from planning_date (min) to max date from scenario data
  const displayDates = useMemo(() => {
    // Helper function to normalize and sort dates
    const normalizeAndSortDates = (dateArray: string[]): string[] => {
      const normalized = dateArray.map(d => {
        const date = new Date(d);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0];
      }).filter((d): d is string => d !== null);

      const uniqueDates = Array.from(new Set(normalized));
      return uniqueDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    };

    // When a scenario is selected, use scenario date range
    // But if a task is selected, filter to that task's date range within the scenario
    if (scenarioRosterData.scenarioName && scenarioRosterData.byDate.size > 0) {
      // If a task is selected, filter dates to when that task appears in the scenario
      if (selectedTask) {
        // Find all dates where this tail appears in the scenario data
        const taskDates = new Set<string>();
        scenarioRosterData.rows.forEach(row => {
          if (row.tail_num === selectedTask) {
            const normalized = new Date(row.date).toISOString().split('T')[0];
            taskDates.add(normalized);
          }
          // Also include dates where the employee is assigned to this tail AND has bay info
          if (row.bay && row.tail_num === selectedTask) {
            const normalized = new Date(row.date).toISOString().split('T')[0];
            taskDates.add(normalized);
          }
        });

        if (taskDates.size > 0) {
          const taskDatesArray = Array.from(taskDates).sort();
          const minTaskDate = taskDatesArray[0];
          const maxTaskDate = taskDatesArray[taskDatesArray.length - 1];

          // Start from planning date (don't go before it) - no buffer before planning date
          const planningDateObj = new Date(scenarioPlanningDate);
          const minTaskDateObj = new Date(minTaskDate);

          // Use planning date as start if task min date is after it, otherwise use planning date
          const startDate = minTaskDateObj < planningDateObj ? planningDateObj : minTaskDateObj;

          // Add 2 days buffer after the max date
          const endDate = new Date(maxTaskDate);
          endDate.setDate(endDate.getDate() + 2);

          // Generate continuous date range starting from planning date
          const filteredDates: string[] = [];
          const current = new Date(startDate);
          while (current <= endDate) {
            filteredDates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
          }

          console.log('displayDates - Scenario with selected task:', {
            selectedTask,
            planningDate: scenarioPlanningDate,
            minTaskDate,
            maxTaskDate,
            totalDates: filteredDates.length,
          });

          return filteredDates;
        }
      }

      // No task selected - show full scenario date range
      // Get all dates from scenario data
      const scenarioDates = Array.from(scenarioRosterData.byDate.keys()).map(d =>
        new Date(d).toISOString().split('T')[0]
      );

      // Min date = planning date for this scenario
      const minDate = scenarioPlanningDate;

      // Max date = maximum date from scenario data
      const maxDate = scenarioDates.reduce((max, d) => d > max ? d : max, scenarioDates[0]);

      // Generate all dates from minDate to maxDate
      const allDates: string[] = [];
      const current = new Date(minDate);
      const end = new Date(maxDate);
      while (current <= end) {
        allDates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }

      console.log('displayDates - Scenario date range:', {
        scenarioName: scenarioRosterData.scenarioName,
        planningDate: minDate,
        maxDate,
        totalDates: allDates.length,
      });

      return allDates;
    }

    if (selectedTask) {
      // When a task is selected, show that task's date range plus all assignment dates for that task
      const schedule = aircraftSchedules.find(s => s.aircraft_reg === selectedTask);
      const taskAssignmentDates = new Set(
        engineerAssignments
          .filter(a => a.tailNumber === selectedTask)
          .map(a => a.date)
      );
      
      console.log('displayDates - Selected task:', selectedTask, {
        hasSchedule: !!schedule,
        scheduleDates: schedule ? `${schedule.induct_date} to ${schedule.ets_date}` : 'none',
        assignmentDatesCount: taskAssignmentDates.size,
        assignmentDates: Array.from(taskAssignmentDates).slice(0, 10),
      });
      
      if (schedule) {
        const startDate = new Date(schedule.induct_date);
        const endDate = new Date(schedule.ets_date);
        startDate.setDate(startDate.getDate() - 2); // 2 days before
        endDate.setDate(endDate.getDate() + 2); // 2 days after
        
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];
        
        // Include dates from schedule range AND all assignment dates for this task
        // Also generate dates for assignment dates that might be outside the dates array
        const allRelevantDates = new Set<string>();
        
        // Add dates from the dates array that are in range (normalize first)
        dates.forEach(d => {
          const normalized = new Date(d).toISOString().split('T')[0];
          if (normalized >= startStr && normalized <= endStr) {
            allRelevantDates.add(normalized);
          }
        });
        
        // Add all assignment dates (even if not in the dates array) - normalize first
        taskAssignmentDates.forEach(date => {
          const normalized = new Date(date).toISOString().split('T')[0];
          allRelevantDates.add(normalized);
        });
        
        // Generate any missing dates between min and max
        const allDatesArray = Array.from(allRelevantDates);
        if (allDatesArray.length > 0) {
          const minDate = allDatesArray.reduce((min, d) => d < min ? d : min, allDatesArray[0]);
          const maxDate = allDatesArray.reduce((max, d) => d > max ? d : max, allDatesArray[0]);
          const generatedDates = generateDateRange(minDate, maxDate);
          generatedDates.forEach(d => {
            const normalized = new Date(d).toISOString().split('T')[0];
            allRelevantDates.add(normalized);
          });
        }
        
        // Ensure all dates are normalized and sorted
        const finalDates = Array.from(allRelevantDates).map(d => {
          const normalized = new Date(d).toISOString().split('T')[0];
          return normalized;
        });
        const sorted = normalizeAndSortDates(finalDates);
        console.log('displayDates - Selected task dates (first 10, last 10):', {
          first10: sorted.slice(0, 10),
          last10: sorted.slice(-10),
          total: sorted.length,
        });
        return sorted;
      } else if (taskAssignmentDates.size > 0) {
        // If no schedule but we have assignments, show those dates
        const assignmentDatesArray = Array.from(taskAssignmentDates);
        const minDate = assignmentDatesArray.reduce((min, d) => d < min ? d : min, assignmentDatesArray[0]);
        const maxDate = assignmentDatesArray.reduce((max, d) => d > max ? d : max, assignmentDatesArray[0]);
        
        // Generate full date range for assignments
        const generatedDates = generateDateRange(minDate, maxDate);
        return normalizeAndSortDates(generatedDates);
      }
    }
    
    // When no task is selected, prioritize showing dates around TODAY and dates with assignments
    // Also handle case when scenario is selected (dates array may be empty but scenarioRosterData has dates)
    if (dates.length > 0 || (scenarioRosterData.scenarioName && scenarioRosterData.byDate.size > 0)) {
      // Get all dates that have assignments (normalize them)
      const assignmentDates = new Set(
        engineerAssignments.map(a => new Date(a.date).toISOString().split('T')[0])
      );
      
      // Include all aircraft schedule dates
      const scheduleDates = aircraftSchedules.flatMap(schedule => {
        const start = new Date(schedule.induct_date);
        const end = new Date(schedule.ets_date);
        const datesInRange: string[] = [];
        const current = new Date(start);
        while (current <= end) {
          datesInRange.push(current.toISOString().split('T')[0]);
          current.setDate(current.getDate() + 1);
        }
        return datesInRange;
      });
      const scheduleSet = new Set(scheduleDates);
      
      // Combine: schedules + assignments + buffer around TODAY
      const relevantDates = new Set<string>();
      
      // Add all schedule dates (already normalized to ISO format)
      scheduleSet.forEach(d => relevantDates.add(d));
      
      // Add all assignment dates (normalize to ISO format)
      assignmentDates.forEach(d => {
        const normalized = new Date(d).toISOString().split('T')[0];
        relevantDates.add(normalized);
      });

      // Add all dates from scenarioRosterData if a scenario is selected
      // This is the PRIMARY source of dates when viewing a scenario
      if (scenarioRosterData.scenarioName && scenarioRosterData.byDate.size > 0) {
        console.log('displayDates - Adding dates from scenarioRosterData.byDate, size:', scenarioRosterData.byDate.size);

        // Get the scenario's planning date
        const scenario = scenarios.find(s => s.name === scenarioRosterData.scenarioName);
        const planningDate = scenario?.planning_date || TODAY;

        // Find the maximum date in the roster data
        const rosterDates: string[] = [];
        scenarioRosterData.byDate.forEach((_, dateKey) => {
          const normalized = new Date(dateKey).toISOString().split('T')[0];
          rosterDates.push(normalized);
        });

        const maxRosterDate = rosterDates.length > 0
          ? rosterDates.reduce((max, d) => d > max ? d : max, rosterDates[0])
          : planningDate;

        console.log('displayDates - Date range for scenario:', {
          planningDate,
          maxRosterDate,
          totalRosterDates: rosterDates.length
        });

        // Only add dates that are between planningDate and maxRosterDate (inclusive)
        rosterDates.forEach(date => {
          if (date >= planningDate && date <= maxRosterDate) {
            relevantDates.add(date);
          }
        });

        console.log('displayDates - relevantDates after filtering to range:', relevantDates.size);
      } else {
        // When no scenario is selected, add dates around TODAY (2 weeks before and after)
        const todayDate = new Date(TODAY);
        for (let i = -14; i <= 14; i++) {
          const d = new Date(todayDate);
          d.setDate(d.getDate() + i);
          relevantDates.add(d.toISOString().split('T')[0]);
        }

        // Also ensure we include dates up to end of May if TODAY is in April
        const todayDateObj = new Date(TODAY);
        const endOfMay = new Date(todayDateObj.getFullYear(), 4, 31); // May is month 4 (0-indexed)
        if (todayDateObj.getMonth() === 3) { // April (month 3, 0-indexed)
          // Add all dates from TODAY to end of May
          const current = new Date(todayDateObj);
          while (current <= endOfMay) {
            relevantDates.add(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
          }
        }

        // Also add dates up to 30 days from TODAY to ensure upcoming tasks are visible
        const thirtyDaysFromToday = new Date(todayDateObj);
        thirtyDaysFromToday.setDate(thirtyDaysFromToday.getDate() + 30);
        const current = new Date(todayDateObj);
        while (current <= thirtyDaysFromToday) {
          relevantDates.add(current.toISOString().split('T')[0]);
          current.setDate(current.getDate() + 1);
        }
      }
      
      // Collect all relevant dates, ensuring they're all normalized
      const allRelevantDatesArray: string[] = [];
      
      // Add dates from dates array that are relevant (normalize first)
      dates.forEach(d => {
        const normalized = new Date(d).toISOString().split('T')[0];
        if (relevantDates.has(normalized)) {
          allRelevantDatesArray.push(normalized);
        }
      });
      
      // Add any relevant dates that aren't in the dates array (already normalized)
      relevantDates.forEach(d => {
        const normalized = new Date(d).toISOString().split('T')[0];
        if (!allRelevantDatesArray.includes(normalized)) {
          allRelevantDatesArray.push(normalized);
        }
      });
      
      const sorted = normalizeAndSortDates(allRelevantDatesArray);
      console.log('displayDates - No task selected dates (first 10, last 10):', {
        first10: sorted.slice(0, 10),
        last10: sorted.slice(-10),
        total: sorted.length,
      });
      return sorted;
    }
    
    // Ensure dates are always sorted chronologically
    const sorted = normalizeAndSortDates(dates);
    console.log('displayDates - Fallback dates (first 10, last 10):', {
      first10: sorted.slice(0, 10),
      last10: sorted.slice(-10),
      total: sorted.length,
    });
    return sorted;
  }, [dates, selectedTask, aircraftSchedules, engineerAssignments, scenarioRosterData, scenarioPlanningDate]);

  // Set selectedDate when displayDates changes, scenario changes, or when current selection is not in range
  useEffect(() => {
    if (displayDates.length > 0) {
      // Check if current selectedDate is in the available dates
      const currentDateInRange = selectedDate && displayDates.includes(selectedDate);

      if (!currentDateInRange) {
        // Default to scenario's planning_date if it's in the range, otherwise first date in the range
        const planningDateInRange = displayDates.includes(scenarioPlanningDate);
        const newDate = planningDateInRange ? scenarioPlanningDate : displayDates[0];
        console.log('Setting selectedDate:', {
          previousDate: selectedDate,
          newDate,
          scenarioPlanningDate,
          planningDateInRange,
          displayDatesRange: `${displayDates[0]} to ${displayDates[displayDates.length - 1]}`
        });
        setSelectedDate(newDate);
      }
    }
  }, [displayDates, selectedDate, scenarioPlanningDate]);

  // Fetch tail details and suggested engineers when a tail is selected
  useEffect(() => {
    if (!selectedTask || !scenarioRosterData.scenarioName) {
      // Clear data when no tail selected or no scenario
      setSelectedTailDetails(null);
      setSuggestedEngineers([]);
      setSuggestedTechnicians([]);
      setCoreTeamDetails([]);
      setCoreTechnicianDetails([]);
      // Clear UI date-specific assignments when no tail selected
      setUiDateAssignments(new Map());
      setUiRosterOverrides(new Map());
      // Clear removed core team members when tail changes
      setRemovedCoreTeamMembers(new Set());
      setRemovedCoreTeamDetails(new Map());
      setAddedToCoreDetails(new Map());
      setAddedToSupportDetails(new Map());
      setRemovedSupportMembers(new Set());
      setRemovedSupportDetails(new Map());
      return;
    }

    // Load tail details, core team details, and suggested engineers
    const tailNum = selectedTask; // Capture for async closure
    // Reset tracking states when switching tails
    setRemovedCoreTeamMembers(new Set());
    setRemovedCoreTeamDetails(new Map());
    setAddedToCoreDetails(new Map());
    setAddedToSupportDetails(new Map());
    setRemovedSupportMembers(new Set());
    setRemovedSupportDetails(new Map());
    
    async function loadTailData() {
      setIsLoadingSuggestions(true);

      try {
        // Fetch tail details
        const tailDetails = await fetchTailDetails(tailNum);
        setSelectedTailDetails(tailDetails);

        // Separate engineers/CC from technicians based on title
        const coreEngineers = coreTeamForSelectedTail.filter(e =>
          e.title === 'ENGR' || e.title === 'CC' || e.title === 'Engineer'
        );
        const coreTechnicians = coreTeamForSelectedTail.filter(e =>
          e.title === 'Technician' || e.title === 'TECH' || (!['ENGR', 'CC', 'Engineer'].includes(e.title))
        );

        const coreEngineerEmpIds = coreEngineers.map(e => e.empId);
        const coreTechnicianEmpIds = coreTechnicians.map(e => e.empId);
        const coreTeamNames = coreTeamForSelectedTail.map(e => e.empName);

        console.log('Core team breakdown:', {
          allMembers: coreTeamForSelectedTail.map(e => ({ name: e.empName, title: e.title })),
          engineers: coreEngineers.map(e => ({ name: e.empName, title: e.title })),
          technicians: coreTechnicians.map(e => ({ name: e.empName, title: e.title })),
          engineerIds: coreEngineerEmpIds,
          technicianIds: coreTechnicianEmpIds
        });

        // Fetch full details for core engineers from emp_360
        if (coreEngineerEmpIds.length > 0) {
          const coreDetails = await fetchEmployeeDetails(coreEngineerEmpIds);
          setCoreTeamDetails(coreDetails);
        } else {
          setCoreTeamDetails([]);
        }

        // Fetch full details for core technicians from emp_cc_tech_work_summary_vw
        let coreTechNames: string[] = [];
        if (coreTechnicianEmpIds.length > 0) {
          const techDetails = await fetchTechnicianDetails(coreTechnicianEmpIds);
          setCoreTechnicianDetails(techDetails);
          // Get names for suggested technicians RPC
          coreTechNames = techDetails.map(t => t.empName);
        } else {
          setCoreTechnicianDetails([]);
        }

        // Separate support team into engineers and technicians
        const supportEngineers = supportTeamForSelectedTail.filter(e =>
          e.title === 'ENGR' || e.title === 'CC' || e.title === 'Engineer'
        );
        const supportTechnicians = supportTeamForSelectedTail.filter(e =>
          e.title === 'Technician' || e.title === 'TECH' || (!['ENGR', 'CC', 'Engineer'].includes(e.title))
        );

        const supportEngineerEmpIds = supportEngineers.map(e => e.empId);
        const supportTechnicianEmpIds = supportTechnicians.map(e => e.empId);

        // Fetch full details for support engineers
        if (supportEngineerEmpIds.length > 0) {
          const supportDetails = await fetchEmployeeDetails(supportEngineerEmpIds);
          setSupportTeamDetails(supportDetails);
        } else {
          setSupportTeamDetails([]);
        }

        // Fetch full details for support technicians
        if (supportTechnicianEmpIds.length > 0) {
          const supportTechDetails = await fetchTechnicianDetails(supportTechnicianEmpIds);
          setSupportTechnicianDetails(supportTechDetails);
        } else {
          setSupportTechnicianDetails([]);
        }

        // Combine core and support team names to exclude from suggestions
        const allAssignedNames = [...coreTeamForSelectedTail.map(e => e.empName), ...supportTeamForSelectedTail.map(e => e.empName)];
        const allAssignedEngineerIds = [...coreEngineerEmpIds, ...supportEngineerEmpIds];
        const allAssignedTechIds = [...coreTechnicianEmpIds, ...supportTechnicianEmpIds];

        // Fetch suggested engineers (excluding core AND support team members)
        // First get RPC suggestions based on tail history
        const rpcEngineers = await fetchSuggestedEngineers(tailNum, allAssignedNames);
        console.log('RPC suggested engineers:', rpcEngineers);

        // Also get available engineers from roster who are not assigned elsewhere
        const checkDate = selectedDate || displayDates[0] || '';
        const rpcEngineerIds = rpcEngineers.map(e => e.empId);
        const excludeEngineerIds = [...allAssignedEngineerIds, ...rpcEngineerIds];

        const rosterEngineers = await findAvailableEngineersFromRoster(checkDate, excludeEngineerIds, tailNum);
        console.log('Roster available engineers:', rosterEngineers);

        // Merge RPC and roster engineers (RPC first since they have tail history)
        const allSuggestedEngineers = [...rpcEngineers, ...rosterEngineers];
        // Remove duplicates by empId
        const uniqueSuggestedEngineers = allSuggestedEngineers.filter((eng, index, self) =>
          index === self.findIndex(e => e.empId === eng.empId) && !allAssignedEngineerIds.includes(eng.empId)
        );
        console.log('Final suggested engineers:', uniqueSuggestedEngineers);
        setSuggestedEngineers(uniqueSuggestedEngineers);

        // Fetch suggested technicians based on core technician names
        // If no core technicians, fallback to finding technicians by aircraft type
        console.log('Core technician names for suggestion RPC:', coreTechNames);
        let rpcSuggestedTechs: TechnicianDetails[] = [];
        if (coreTechNames.length > 0) {
          const suggestedTechs = await fetchSuggestedTechnicians(coreTechNames);
          console.log('Raw suggested technicians from RPC:', suggestedTechs);
          // Filter out technicians who are already in the core or support team
          rpcSuggestedTechs = suggestedTechs.filter(
            st => !allAssignedTechIds.includes(st.empId)
          );
          // Filter out technicians who are on leave/off on selected date
          rpcSuggestedTechs = await filterAvailableTechnicians(rpcSuggestedTechs, checkDate);
          console.log('Available RPC suggested technicians:', rpcSuggestedTechs);
        }

        // Also get available technicians from roster who are not assigned elsewhere
        const rpcTechIds = rpcSuggestedTechs.map(t => t.empId);
        const excludeTechIds = [...allAssignedTechIds, ...rpcTechIds];

        const rosterTechnicians = await findAvailableTechniciansFromRoster(checkDate, excludeTechIds, tailNum);
        console.log('Roster available technicians:', rosterTechnicians);

        // Merge RPC and roster technicians (RPC first since they have work history)
        const allSuggestedTechs = [...rpcSuggestedTechs, ...rosterTechnicians];
        // Remove duplicates by empId
        const uniqueSuggestedTechs = allSuggestedTechs.filter((tech, index, self) =>
          index === self.findIndex(t => t.empId === tech.empId)
        );
        console.log('Final suggested technicians:', uniqueSuggestedTechs);
        setSuggestedTechnicians(uniqueSuggestedTechs);
      } catch (err) {
        console.error('Error loading tail data:', err);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }

    loadTailData();
  }, [selectedTask, scenarioRosterData.scenarioName, coreTeamForSelectedTail, supportTeamForSelectedTail, selectedDate, displayDates]);

  // Derive bay allocations from scenario roster data when a scenario is selected
  // The RPC returns bay and tail_num for each row, we need to group by bay and tail
  // IMPORTANT: Bay data from get_roster_with_scenario_overrides_with_trainings starts from May 1+.
  // For the planning_date (e.g., Apr 30), we extend bay allocations backward to include it
  // if the tail's first bay date is within 1 day of planning_date.
  const scenarioBayAllocations = useMemo(() => {
    if (!scenarioRosterData.scenarioName || scenarioRosterData.rows.length === 0) {
      return [];
    }

    // Get the planning date for this scenario (normalized)
    const planningDate = scenarioPlanningDate;
    const planningDateObj = new Date(planningDate);

    // Group rows by bay and tail_num to find date ranges
    // Structure: Map<bayNumber, Map<tail_num, Set<date>>>
    const bayTailDates = new Map<number, Map<string, Set<string>>>();

    scenarioRosterData.rows.forEach(row => {
      if (row.bay && row.tail_num) {
        // Parse bay number (e.g., "Bay 1" -> 1, or just "1" -> 1)
        const bayMatch = row.bay.match(/(\d+)/);
        if (!bayMatch) return;
        const bayNum = parseInt(bayMatch[1], 10);

        if (!bayTailDates.has(bayNum)) {
          bayTailDates.set(bayNum, new Map());
        }

        const tailMap = bayTailDates.get(bayNum)!;
        if (!tailMap.has(row.tail_num)) {
          tailMap.set(row.tail_num, new Set());
        }

        // Normalize date
        const dateKey = new Date(row.date).toISOString().split('T')[0];
        tailMap.get(row.tail_num)!.add(dateKey);
      }
    });

    // Convert to BayAllocation format
    // Fill in gaps (weekends, etc.) - assume tail continues at bay between first and last date
    // Also extend backward to include planning_date if first bay date is May 1 (next day after planning date)
    const allocations: BayAllocation[] = [];

    bayTailDates.forEach((tailMap, bayNum) => {
      tailMap.forEach((dateSet, tailNum) => {
        const datesArray = Array.from(dateSet).sort();
        if (datesArray.length > 0) {
          let minDate = datesArray[0];
          const maxDate = datesArray[datesArray.length - 1];

          // Check if we should extend backward to include planning_date
          // If the first bay date is exactly 1 day after planning_date (e.g., May 1 when planning is Apr 30),
          // extend the bay allocation to include planning_date
          const minDateObj = new Date(minDate);
          const daysDiff = Math.floor((minDateObj.getTime() - planningDateObj.getTime()) / (1000 * 60 * 60 * 24));

          if (daysDiff === 1) {
            // First bay data is May 1, planning date is Apr 30 - extend backward
            minDate = planningDate;
            console.log(`scenarioBayAllocations: Extending Bay ${bayNum} / ${tailNum} backward to include planning_date ${planningDate}`);
          }

          // Generate continuous date range between min and max (fill gaps like weekends)
          const continuousDates: string[] = [];
          const current = new Date(minDate);
          const end = new Date(maxDate);
          while (current <= end) {
            continuousDates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
          }

          allocations.push({
            bayNumber: bayNum,
            aircraft: {
              id: `scenario-${tailNum}`,
              aircraft_reg: tailNum,
              customer: '',
              fleet: '',
              check_type: '',
              induct_date: minDate,
              ets_date: maxDate,
              cert_eng_req: 0,
              bay_assignment: `Bay ${bayNum}`,
            },
            dates: continuousDates, // Use continuous dates instead of sparse dates
          });
        }
      });
    });

    console.log('scenarioBayAllocations:', allocations.length, 'allocations from scenario data');
    if (allocations.length > 0) {
      console.log('Sample bay allocations:', allocations.slice(0, 3).map(a => ({
        bay: a.bayNumber,
        tail: a.aircraft.aircraft_reg,
        dateRange: `${a.dates[0]} to ${a.dates[a.dates.length - 1]}`,
        totalDates: a.dates.length
      })));
    }
    return allocations;
  }, [scenarioRosterData, scenarioPlanningDate]);

  // Use scenario bay allocations when a scenario is selected, otherwise use the regular bayAllocations
  const effectiveBayAllocations = useMemo(() => {
    if (scenarioRosterData.scenarioName && scenarioBayAllocations.length > 0) {
      return scenarioBayAllocations;
    }
    return bayAllocations;
  }, [scenarioRosterData.scenarioName, scenarioBayAllocations, bayAllocations]);

  const filteredBays = useMemo(() => {
    // Dynamically derive all bays from the data - preserve order as loaded (not numerical)
    // Use array to maintain insertion order
    const allBaysFromData: number[] = [];
    const seenBays = new Set<number>();

    effectiveBayAllocations.forEach(allocation => {
      if (!seenBays.has(allocation.bayNumber)) {
        seenBays.add(allocation.bayNumber);
        allBaysFromData.push(allocation.bayNumber);
      }
    });
    additionalAircraftSlots.forEach(slot => {
      if (!seenBays.has(slot.bayNumber)) {
        seenBays.add(slot.bayNumber);
        allBaysFromData.push(slot.bayNumber);
      }
    });

    // If we have bay data, use those bays in load order; otherwise default to bays 1-22
    const allBays = allBaysFromData.length > 0
      ? allBaysFromData
      : Array.from({ length: 22 }, (_, i) => i + 1); // Default: bays 1-22

    // Don't filter bays - always show all bays
    // Highlighting is done in the render instead of filtering
    return allBays;
  }, [effectiveBayAllocations, additionalAircraftSlots]);

  useEffect(() => {
    if (searchQuery.trim() && searchResults.matchingTails.size > 0 && effectiveBayAllocations.length > 0 && displayDates.length > 0) {
      const firstMatchingTail = Array.from(searchResults.matchingTails)[0];
      const allocation = effectiveBayAllocations.find(a => a.aircraft.aircraft_reg === firstMatchingTail);

      if (allocation && allocation.dates.length > 0) {
        const todayIdx = displayDates.findIndex(d => d === TODAY);
        const targetDate = todayIdx >= 0 && allocation.dates.includes(displayDates[todayIdx])
          ? displayDates[todayIdx]
          : allocation.dates[0];

        setSelectedBay({
          bay: allocation.bayNumber,
          tail: firstMatchingTail,
          date: targetDate
        });
      }
    }
  }, [searchQuery, searchResults, effectiveBayAllocations, displayDates]);

  const getAssignmentForEngineerAndDate = (engineerId: string, date: string): EngineerAssignment | null => {
    return engineerAssignments.find(a => a.resourceId === engineerId && a.date === date) || null;
  };

  const getEngineersForBayTailDate = (bay: number, tail: string, date: string): string[] => {
    return engineerAssignments
      .filter(a => a.tailNumber === tail && a.date === date)
      .map(a => a.resourceId);
  };

  const handleBayClick = (bay: number, tail: string, date: string) => {
    if (selectedBay?.bay === bay && selectedBay?.tail === tail && selectedBay?.date === date) {
      // Clicking same bay again - deselect
      setSelectedBay(null);
      setSearchQuery('');
      setSelectedTask(null);
    } else {
      // Select the bay and filter by this tail
      setSelectedBay({ bay, tail, date });
      setSearchQuery(tail);
      setSelectedTask(tail); // This triggers employee filtering and date range filtering
    }
  };

  const handleTailClick = (e: React.MouseEvent, tail: string, date?: string) => {
    e.stopPropagation();
    if (selectedTask === tail) {
      // Clicking same tail again - deselect
      setSearchQuery('');
      setSelectedBay(null);
      setSelectedTask(null);
    } else {
      // Select the tail - filter employees and dates, highlight in bay chart
      setSearchQuery(tail);
      setSelectedTask(tail);

      if (date) {
        const allocation = effectiveBayAllocations.find(a => a.aircraft.aircraft_reg === tail && a.dates.includes(date));
        if (allocation) {
          setSelectedBay({
            bay: allocation.bayNumber,
            tail: tail,
            date: date
          });
        }
      }
    }
  };

  const handleEmployeeClick = (employee: Employee) => {
    // Get planned core/support for the selected date from scenario roster data
    const currentDate = selectedDate || displayDates[0] || '';
    let plannedCore: string | undefined;
    let plannedSupport: string | undefined;

    if (scenarioRosterData.scenarioName && currentDate) {
      // Look up this employee's data for the selected date
      const employeeRows = scenarioRosterData.byEmployee.get(employee.id);
      if (employeeRows) {
        const rowForDate = employeeRows.find(r => r.date === currentDate);
        if (rowForDate) {
          plannedCore = rowForDate.planned_core || undefined;
          plannedSupport = rowForDate.planned_support || undefined;
        }
      }
    }

    // Check UI overrides for this employee on this date
    const overrideKey = `${employee.id}-${currentDate}`;
    const uiOverride = uiRosterOverrides.get(overrideKey);
    if (uiOverride) {
      if (uiOverride.core) plannedCore = uiOverride.core;
      if (uiOverride.support) plannedSupport = uiOverride.support;
    }

    // Convert Employee to BasicEmployeeInfo for the shared drawer
    const basicInfo: BasicEmployeeInfo = {
      empId: employee.id,
      name: employee.name,
      role: employee.title === 'TECH' ? 'Technician' : employee.title === 'CC' ? 'CC' : 'Engineer',
      team: employee.core || '',
      plannedCore,
      plannedSupport,
    };
    setSelectedEmployeeForDrawer(basicInfo);
    setShowEmployeeDrawer(true);
  };

  // Handler for clicking on technician cards (TechnicianDetails type)
  const handleTechnicianClick = (tech: TechnicianDetails) => {
    // Get planned core/support for the selected date from scenario roster data
    const currentDate = selectedDate || displayDates[0] || '';
    let plannedCore: string | undefined;
    let plannedSupport: string | undefined;

    if (scenarioRosterData.scenarioName && currentDate) {
      // Look up this technician's data for the selected date
      const employeeRows = scenarioRosterData.byEmployee.get(tech.empId);
      if (employeeRows) {
        const rowForDate = employeeRows.find(r => r.date === currentDate);
        if (rowForDate) {
          plannedCore = rowForDate.planned_core || undefined;
          plannedSupport = rowForDate.planned_support || undefined;
        }
      }
    }

    // Check UI overrides for this technician on this date
    const overrideKey = `${tech.empId}-${currentDate}`;
    const uiOverride = uiRosterOverrides.get(overrideKey);
    if (uiOverride) {
      if (uiOverride.core) plannedCore = uiOverride.core;
      if (uiOverride.support) plannedSupport = uiOverride.support;
    }

    // Convert TechnicianDetails to BasicEmployeeInfo for the shared drawer
    const basicInfo: BasicEmployeeInfo = {
      empId: tech.empId,
      name: tech.empName,
      role: 'Technician',
      team: tech.team || '',
      plannedCore,
      plannedSupport,
    };
    setSelectedEmployeeForDrawer(basicInfo);
    setShowEmployeeDrawer(true);
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    // Format as "May 1" (Month Day) for cleaner display
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    return `${month} ${day}`;
  };

  const formatDateFull = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const currentlyAssignedEngineers = useMemo(() => {
    if (!selectedBay) return [];

    const assigned = engineerAssignments
      .filter(a => a.tailNumber === selectedBay.tail && a.date === selectedBay.date)
      .map(a => {
        const employee = employees.find(e => e.id === a.resourceId);
        if (!employee) return null;
        return {
          ...employee,
          assignment: a,
        };
      })
      .filter(e => e !== null) as (Employee & { assignment: EngineerAssignment })[];

    return assigned;
  }, [selectedBay, engineerAssignments, employees]);

  const matchCandidates: MatchCandidate[] = useMemo(() => {
    if (!selectedBay) return [];

    const availableEngineers = allEngineers.filter(e => {
      const assignment = getAssignmentForEngineerAndDate(e.id, selectedBay.date);
      return !assignment;
    });

    return availableEngineers.slice(0, 10).map(e => {
      const currentAssignment = engineerAssignments.find(
        a => a.resourceId === e.id && a.date === selectedBay.date
      );

      return {
        ...e,
        similarity: Math.floor(60 + (hashCode(e.id + selectedBay.tail) % 40)),
        currentTail: currentAssignment?.tailNumber || 'Available',
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }, [selectedBay, allEngineers, engineerAssignments]);


  // Helper to get employee's core/support assignment on a specific date
  // Returns { hasCoreAssignment: boolean, coreAssignment: string | null, supportAssignment: string | null }
  const getEmployeeAssignmentInfo = (empId: string, checkDate: string): {
    hasCoreAssignment: boolean;
    coreAssignment: string | null;
    supportAssignment: string | null;
    assignmentDate: string | null;
  } => {
    if (!scenarioRosterData.rows || scenarioRosterData.rows.length === 0 || !checkDate) {
      return { hasCoreAssignment: false, coreAssignment: null, supportAssignment: null, assignmentDate: null };
    }

    // Find employee's assignment on the specific check date
    const dateRow = scenarioRosterData.rows.find(
      row => row.id === empId && row.date === checkDate
    );

    if (dateRow) {
      // Has conflict if employee has a core assignment to a DIFFERENT tail on this date
      const hasCoreConflict = !!(dateRow.planned_core && dateRow.planned_core !== selectedTask);
      return {
        hasCoreAssignment: hasCoreConflict,
        coreAssignment: dateRow.planned_core || null,
        supportAssignment: dateRow.planned_support || null,
        assignmentDate: checkDate
      };
    }

    return { hasCoreAssignment: false, coreAssignment: null, supportAssignment: null, assignmentDate: null };
  };

  // Get the reference date for checking assignments - use the selected date column from the grid
  // This is typically the date shown in "Details for [date]" header
  const assignmentCheckDate = selectedDate || selectedBay?.date || displayDates[0] || '';

  // Process drop based on activeDropZone - called from onDragEnd
  // NOTE: This is now DATE-SPECIFIC. Assignments only apply to the currently selected date.
  const processDrop = (item: typeof draggedItem, zone: typeof activeDropZone) => {
    if (!item || !zone) {
      console.log('processDrop: no item or zone', { item, zone });
      return;
    }

    const tailNum = selectedTask || '';
    
    // Get all dates to assign - use selectedBayDates if not empty, otherwise fall back to single date
    const datesToAssign: string[] = selectedBayDates.size > 0 
      ? Array.from(selectedBayDates) 
      : (selectedDate || displayDates[0] ? [selectedDate || displayDates[0]] : []);
    
    console.log('processDrop:', { itemType: item.type, source: item.source, zone, datesToAssign, tailNum });

    if (datesToAssign.length === 0) {
      console.log('processDrop: no dates selected, cannot assign');
      return;
    }

    // Engineer dropped on Core Engineers (from suggested)
    if (zone === 'coreEngineers' && item.type === 'engineer' && item.source === 'suggested') {
      const engineer = item.data as SuggestedEngineer;
      // Set date-specific assignment
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.set(`${engineer.empId}-${date}`, { zone: 'core', tail: tailNum });
        });
        return newMap;
      });
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { core: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - ADDED_TO_CORE
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(engineer.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(engineer.empId, { empName: engineer.empName, tailNum, dates: allDates });
        return newMap;
      });
      // Remove from addedToSupport if was there
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(engineer.empId);
        return newMap;
      });
      console.log('Engineer assigned to Core for dates:', datesToAssign, engineer.empName);
    }

    // Engineer dropped on Support Engineers (from suggested)
    if (zone === 'supportEngineers' && item.type === 'engineer' && item.source === 'suggested') {
      const engineer = item.data as SuggestedEngineer;
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.set(`${engineer.empId}-${date}`, { zone: 'support', tail: tailNum });
        });
        return newMap;
      });
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { support: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - ADDED_TO_SUPPORT
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(engineer.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(engineer.empId, { empName: engineer.empName, tailNum, dates: allDates });
        return newMap;
      });
      // Remove from addedToCore if was there
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(engineer.empId);
        return newMap;
      });
      console.log('Engineer assigned to Support for dates:', datesToAssign, engineer.empName);
    }

    // Technician dropped on Core Technicians (from suggested)
    if (zone === 'coreTechnicians' && item.type === 'technician' && item.source === 'suggested') {
      const technician = item.data as TechnicianDetails;
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.set(`${technician.empId}-${date}`, { zone: 'core', tail: tailNum });
        });
        return newMap;
      });
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${technician.empId}-${date}`, { core: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - ADDED_TO_CORE
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(technician.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(technician.empId, { empName: technician.empName, tailNum, dates: allDates });
        return newMap;
      });
      // Remove from addedToSupport if was there
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(technician.empId);
        return newMap;
      });
      console.log('Technician assigned to Core for dates:', datesToAssign, technician.empName);
    }

    // Technician dropped on Support Technicians (from suggested)
    if (zone === 'supportTechnicians' && item.type === 'technician' && item.source === 'suggested') {
      const technician = item.data as TechnicianDetails;
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.set(`${technician.empId}-${date}`, { zone: 'support', tail: tailNum });
        });
        return newMap;
      });
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${technician.empId}-${date}`, { support: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - ADDED_TO_SUPPORT
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(technician.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(technician.empId, { empName: technician.empName, tailNum, dates: allDates });
        return newMap;
      });
      // Remove from addedToCore if was there
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(technician.empId);
        return newMap;
      });
      console.log('Technician assigned to Support for dates:', datesToAssign, technician.empName);
    }

    // Engineer dropped on Core Engineers (from Support) - move from support to core
    if (zone === 'coreEngineers' && item.type === 'engineer' && item.source === 'support') {
      const engineer = item.data as SuggestedEngineer;
      
      // Check if this is a moved DB core engineer (originally from coreTeamDetails)
      const isMovedDbCoreEngineer = movedCoreDbEngineersToSupport.has(engineer.empId);
      
      if (isMovedDbCoreEngineer) {
        // This is a DB core engineer being moved back to core
        setMovedCoreDbEngineersToSupport(prev => {
          const newMap = new Map(prev);
          newMap.delete(engineer.empId);
          return newMap;
        });
        setRemovedCoreTeamMembers(prev => {
          const newSet = new Set(prev);
          newSet.delete(engineer.empId);
          return newSet;
        });
        // Remove from removedCoreTeamDetails since they're back in core
        setRemovedCoreTeamDetails(prev => {
          const newMap = new Map(prev);
          newMap.delete(engineer.empId);
          return newMap;
        });
      } else {
        // UI-added support engineer - update uiDateAssignments
        setUiDateAssignments(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { zone: 'core', tail: tailNum });
          });
          return newMap;
        });
      }
      
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { core: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - move from ADDED_TO_SUPPORT to ADDED_TO_CORE
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(engineer.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(engineer.empId, { empName: engineer.empName, tailNum, dates: allDates });
        return newMap;
      });
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(engineer.empId);
        return newMap;
      });
      console.log('Engineer moved from Support to Core for dates:', datesToAssign, engineer.empName);
    }

    // Engineer dropped on Support Engineers (from Core) - move from core to support
    if (zone === 'supportEngineers' && item.type === 'engineer' && item.source === 'core') {
      const engineer = item.data as SuggestedEngineer;
      
      // Check if this is a DB core engineer (from coreTeamDetails) or UI-added (from suggestedEngineers)
      const isDbCoreEngineer = coreTeamDetails.some(m => m.empId === engineer.empId);
      
      if (isDbCoreEngineer) {
        // DB core engineer - add to removedCoreTeamMembers and track in movedCoreDbEngineersToSupport
        setRemovedCoreTeamMembers(prev => new Set([...prev, engineer.empId]));
        setMovedCoreDbEngineersToSupport(prev => {
          const newMap = new Map(prev);
          newMap.set(engineer.empId, engineer);
          return newMap;
        });
        // Track removed core team details for logging
        setRemovedCoreTeamDetails(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(engineer.empId);
          const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
          newMap.set(engineer.empId, { empName: engineer.empName, tailNum: selectedTask || '', dates: allDates });
          return newMap;
        });
      } else {
        // UI-added core engineer - update uiDateAssignments
        setUiDateAssignments(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { zone: 'support', tail: tailNum });
          });
          return newMap;
        });
      }
      
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { support: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - move from ADDED_TO_CORE to ADDED_TO_SUPPORT
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(engineer.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(engineer.empId, { empName: engineer.empName, tailNum, dates: allDates });
        return newMap;
      });
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(engineer.empId);
        return newMap;
      });
      console.log('Engineer moved from Core to Support for dates:', datesToAssign, engineer.empName);
    }

    // Technician dropped on Core Technicians (from Support) - move from support to core
    if (zone === 'coreTechnicians' && item.type === 'technician' && item.source === 'support') {
      const technician = item.data as TechnicianDetails;
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.set(`${technician.empId}-${date}`, { zone: 'core', tail: tailNum });
        });
        return newMap;
      });
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${technician.empId}-${date}`, { core: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - move from ADDED_TO_SUPPORT to ADDED_TO_CORE
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(technician.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(technician.empId, { empName: technician.empName, tailNum, dates: allDates });
        return newMap;
      });
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(technician.empId);
        return newMap;
      });
      console.log('Technician moved from Support to Core for dates:', datesToAssign, technician.empName);
    }

    // Technician dropped on Support Technicians (from Core) - move from core to support
    if (zone === 'supportTechnicians' && item.type === 'technician' && item.source === 'core') {
      const technician = item.data as TechnicianDetails;
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.set(`${technician.empId}-${date}`, { zone: 'support', tail: tailNum });
        });
        return newMap;
      });
      if (tailNum) {
        setUiRosterOverrides(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${technician.empId}-${date}`, { support: tailNum });
          });
          return newMap;
        });
      }
      // Track for commit - move from ADDED_TO_CORE to ADDED_TO_SUPPORT
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(technician.empId);
        const allDates = existing ? [...new Set([...existing.dates, ...datesToAssign])] : datesToAssign;
        newMap.set(technician.empId, { empName: technician.empName, tailNum, dates: allDates });
        return newMap;
      });
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(technician.empId);
        return newMap;
      });
      console.log('Technician moved from Core to Support for dates:', datesToAssign, technician.empName);
    }

    // Engineer dropped on Suggested Engineers (from Core or Support) - remove date-specific assignment
    if (zone === 'suggestedEngineers' && item.type === 'engineer' && (item.source === 'core' || item.source === 'support')) {
      const engineer = item.data as SuggestedEngineer;
      // Remove date-specific assignment for ALL selected dates
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.delete(`${engineer.empId}-${date}`);
        });
        return newMap;
      });
      setUiRosterOverrides(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.delete(`${engineer.empId}-${date}`);
        });
        return newMap;
      });
      // Remove from added tracking
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(engineer.empId);
        return newMap;
      });
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(engineer.empId);
        return newMap;
      });
      console.log('Engineer removed from assignment for dates:', datesToAssign, engineer.empName);
    }

    // Technician dropped on Suggested Technicians (from Core or Support) - remove date-specific assignment
    if (zone === 'suggestedTechnicians' && item.type === 'technician' && (item.source === 'core' || item.source === 'support')) {
      const technician = item.data as TechnicianDetails;
      // Remove date-specific assignment for ALL selected dates
      setUiDateAssignments(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.delete(`${technician.empId}-${date}`);
        });
        return newMap;
      });
      setUiRosterOverrides(prev => {
        const newMap = new Map(prev);
        datesToAssign.forEach(date => {
          newMap.delete(`${technician.empId}-${date}`);
        });
        return newMap;
      });
      // Remove from added tracking
      setAddedToCoreDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(technician.empId);
        return newMap;
      });
      setAddedToSupportDetails(prev => {
        const newMap = new Map(prev);
        newMap.delete(technician.empId);
        return newMap;
      });
      console.log('Technician removed from assignment for dates:', datesToAssign, technician.empName);
    }
  };

  // Compute which engineers/technicians to display in each section based on selected date
  const currentDate = selectedDate || displayDates[0] || '';

  // Engineers assigned to Core for current date (UI additions only, not from roster)
  const displayCoreEngineers = useMemo(() => {
    if (!currentDate) return [];
    return suggestedEngineers.filter(eng => {
      const assignment = uiDateAssignments.get(`${eng.empId}-${currentDate}`);
      return assignment?.zone === 'core';
    });
  }, [suggestedEngineers, uiDateAssignments, currentDate]);

  // Engineers assigned to Support for current date (UI additions only)
  const displaySupportEngineers = useMemo(() => {
    if (!currentDate) return [];
    return suggestedEngineers.filter(eng => {
      const assignment = uiDateAssignments.get(`${eng.empId}-${currentDate}`);
      return assignment?.zone === 'support';
    });
  }, [suggestedEngineers, uiDateAssignments, currentDate]);

  // Engineers still in Suggested (not assigned to core/support for current date)
  const displaySuggestedEngineers = useMemo(() => {
    if (!currentDate) return suggestedEngineers;
    return suggestedEngineers.filter(eng => {
      const assignment = uiDateAssignments.get(`${eng.empId}-${currentDate}`);
      return !assignment; // Not assigned to any zone for this date
    });
  }, [suggestedEngineers, uiDateAssignments, currentDate]);

  // Technicians assigned to Core for current date (UI additions only)
  const displayCoreTechnicians = useMemo(() => {
    if (!currentDate) return [];
    return suggestedTechnicians.filter(tech => {
      const assignment = uiDateAssignments.get(`${tech.empId}-${currentDate}`);
      return assignment?.zone === 'core';
    });
  }, [suggestedTechnicians, uiDateAssignments, currentDate]);

  // Technicians assigned to Support for current date (UI additions only)
  const displaySupportTechnicians = useMemo(() => {
    if (!currentDate) return [];
    return suggestedTechnicians.filter(tech => {
      const assignment = uiDateAssignments.get(`${tech.empId}-${currentDate}`);
      return assignment?.zone === 'support';
    });
  }, [suggestedTechnicians, uiDateAssignments, currentDate]);

  // Technicians still in Suggested (not assigned to core/support for current date)
  const displaySuggestedTechnicians = useMemo(() => {
    if (!currentDate) return suggestedTechnicians;
    return suggestedTechnicians.filter(tech => {
      const assignment = uiDateAssignments.get(`${tech.empId}-${currentDate}`);
      return !assignment; // Not assigned to any zone for this date
    });
  }, [suggestedTechnicians, uiDateAssignments, currentDate]);

  // Drop handler for Support zones (kept for HTML5 drag-drop fallback)
  // NOTE: Applies to ALL selected bay dates (selectedBayDates) if any are selected
  const handleDropOnCoreSupport = (e: React.DragEvent, targetType: 'engineer' | 'technician') => {
    e.preventDefault();
    console.log('handleDropOnCoreSupport:', { targetType, draggedItem, selectedDate, selectedTask, selectedBayDates: Array.from(selectedBayDates) });
    if (!draggedItem || draggedItem.type !== targetType) {
      console.log('Drop rejected - type mismatch or no dragged item');
      return;
    }

    const tailNum = selectedTask || '';
    // Get all dates to assign - use selectedBayDates if not empty, otherwise fall back to single date
    const datesToAssign: string[] = selectedBayDates.size > 0 
      ? Array.from(selectedBayDates) 
      : (selectedDate || displayDates[0] ? [selectedDate || displayDates[0]] : []);
    console.log('Processing drop:', { datesToAssign, tailNum });

    if (datesToAssign.length === 0) {
      console.log('No dates selected, cannot assign');
      setDraggedItem(null);
      setActiveDropZone(null);
      return;
    }

    if (targetType === 'engineer') {
      const engineer = draggedItem.data as SuggestedEngineer;
      if (draggedItem.source === 'suggested') {
        // Set date-specific assignment to support for ALL selected dates
        setUiDateAssignments(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${engineer.empId}-${date}`, { zone: 'support', tail: tailNum });
          });
          return newMap;
        });
        if (tailNum) {
          setUiRosterOverrides(prev => {
            const newMap = new Map(prev);
            datesToAssign.forEach(date => {
              newMap.set(`${engineer.empId}-${date}`, { support: tailNum });
            });
            return newMap;
          });
        }
      }
    } else {
      const technician = draggedItem.data as TechnicianDetails;
      if (draggedItem.source === 'suggested') {
        // Set date-specific assignment to support for ALL selected dates
        setUiDateAssignments(prev => {
          const newMap = new Map(prev);
          datesToAssign.forEach(date => {
            newMap.set(`${technician.empId}-${date}`, { zone: 'support', tail: tailNum });
          });
          return newMap;
        });
        if (tailNum) {
          setUiRosterOverrides(prev => {
            const newMap = new Map(prev);
            datesToAssign.forEach(date => {
              newMap.set(`${technician.empId}-${date}`, { support: tailNum });
            });
            return newMap;
          });
        }
      }
    }
    setDraggedItem(null);
    setActiveDropZone(null);
  };

  // NOTE: Removes assignment for ALL selected dates (selectedBayDates)
  const handleDropOnSuggested = (e: React.DragEvent, targetType: 'engineer' | 'technician') => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== targetType) return;

    // Get all dates to remove assignment from
    const datesToRemove: string[] = selectedBayDates.size > 0 
      ? Array.from(selectedBayDates) 
      : (selectedDate || displayDates[0] ? [selectedDate || displayDates[0]] : []);

    if (targetType === 'engineer') {
      const engineer = draggedItem.data as SuggestedEngineer;
      // Remove date-specific assignment (move back to suggested for ALL selected dates)
      if (draggedItem.source === 'core' || draggedItem.source === 'support') {
        if (datesToRemove.length > 0) {
          setUiDateAssignments(prev => {
            const newMap = new Map(prev);
            datesToRemove.forEach(date => {
              newMap.delete(`${engineer.empId}-${date}`);
            });
            return newMap;
          });
          setUiRosterOverrides(prev => {
            const newMap = new Map(prev);
            datesToRemove.forEach(date => {
              newMap.delete(`${engineer.empId}-${date}`);
            });
            return newMap;
          });
        }
      }
    } else {
      const technician = draggedItem.data as TechnicianDetails;
      // Remove date-specific assignment (move back to suggested for ALL selected dates)
      if (draggedItem.source === 'core' || draggedItem.source === 'support') {
        if (datesToRemove.length > 0) {
          setUiDateAssignments(prev => {
            const newMap = new Map(prev);
            datesToRemove.forEach(date => {
              newMap.delete(`${technician.empId}-${date}`);
            });
            return newMap;
          });
          setUiRosterOverrides(prev => {
            const newMap = new Map(prev);
            datesToRemove.forEach(date => {
              newMap.delete(`${technician.empId}-${date}`);
            });
            return newMap;
          });
        }
      }
    }
    setDraggedItem(null);
    setActiveDropZone(null);
  };

  // Handler for drag end - processes the drop based on which zone the mouse is over
  const handleDragEnd = (item: typeof draggedItem) => {
    console.log('handleDragEnd:', { item, activeDropZone });
    if (item && activeDropZone) {
      processDrop(item, activeDropZone);
    }
    setDraggedItem(null);
    setActiveDropZone(null);
  };

  // Compute first expiry date for each employee
  const employeeFirstExpiryDate = useMemo(() => {
    const firstExpiry = new Map<string, string>();
    
    if (!scenarioRosterData.scenarioName || scenarioRosterData.rows.length === 0) {
      return firstExpiry;
    }
    
    // Sort rows by date to find the earliest expiry date for each employee
    const sortedRows = [...scenarioRosterData.rows].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    sortedRows.forEach(row => {
      if (row.expired_trainings && row.expired_trainings.length > 0) {
        const dateKey = new Date(row.date).toISOString().split('T')[0];
        if (!firstExpiry.has(row.id)) {
          firstExpiry.set(row.id, dateKey);
        }
      }
    });
    return firstExpiry;
  }, [scenarioRosterData]);

  // Compute detailed expired trainings map with expiry dates for each employee
  const employeeExpiredTrainingsDetail = useMemo(() => {
    const result = new Map<string, Map<string, string>>();
    
    if (!scenarioRosterData.scenarioName || scenarioRosterData.rows.length === 0) {
      return result;
    }
    
    // Sort rows by date to track when each training first appears as expired
    const sortedRows = [...scenarioRosterData.rows].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    // Track which trainings we've seen for each employee
    const seenTrainings = new Map<string, Set<string>>();
    
    sortedRows.forEach(row => {
      if (row.expired_trainings && row.expired_trainings.length > 0) {
        const dateKey = new Date(row.date).toISOString().split('T')[0];
        const empId = row.id;
        
        // Parse comma-separated trainings
        const trainings = row.expired_trainings.split(',').map(t => t.trim()).filter(t => t);
        
        if (!result.has(empId)) {
          result.set(empId, new Map());
          seenTrainings.set(empId, new Set());
        }
        
        const empTrainings = result.get(empId)!;
        const empSeen = seenTrainings.get(empId)!;
        
        // For each training, record its expiry date if we haven't seen it before
        trainings.forEach(training => {
          if (!empSeen.has(training)) {
            empTrainings.set(training, dateKey);
            empSeen.add(training);
          }
        });
      }
    });
    
    return result;
  }, [scenarioRosterData]);

  // Helper function to get expired trainings tooltip text for an employee on a specific date
  const getExpiredTrainingsTooltip = (empId: string, date: string): string => {
    const empTrainings = employeeExpiredTrainingsDetail.get(empId);
    if (!empTrainings || empTrainings.size === 0) {
      return '';
    }
    
    // Get all trainings that have expired by this date
    const expiredByDate: Array<{ name: string; expiryDate: string }> = [];
    empTrainings.forEach((expiryDate, trainingName) => {
      if (expiryDate <= date) {
        expiredByDate.push({ name: trainingName, expiryDate });
      }
    });
    
    if (expiredByDate.length === 0) {
      return '';
    }
    
    // Sort by expiry date
    expiredByDate.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    
    // Format tooltip text
    const lines = expiredByDate.map((t, index) => {
      const date = new Date(t.expiryDate);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const formattedDate = `${day}/${month}`;
      
      // Shorten training names for compact display
      let shortName = t.name;
      if (t.name.includes(' - ')) {
        const firstPart = t.name.split(' - ')[0].trim();
        shortName = `${firstPart} Training`;
      }
      if (index === 0) {
        return `${shortName} expires on ${formattedDate}`;
      }
      return `${shortName} on ${formattedDate}`;
    });
    
    return lines.join('\n ');
  };

  // Helper function to calculate expired training overlay opacity
  const getExpiredTrainingOpacity = (empId: string, date: string): number => {
    const firstExpiryDate = employeeFirstExpiryDate.get(empId);
    if (!firstExpiryDate || date < firstExpiryDate) {
      return 0;
    }
    
    const daysSinceExpiry = Math.floor(
      (new Date(date).getTime() - new Date(firstExpiryDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return Math.min(0.45, 0.15 + Math.floor(daysSinceExpiry / 3) * 0.08);
  };

  // Use scenario's planning_date as "today" for highlighting
  const todayIndex = displayDates.indexOf(scenarioPlanningDate);

  // Handler for multi-select dates in Bay Occupancy Chart
  const handleBayDateClick = (date: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (event.shiftKey && lastClickedBayDate) {
      // Select range from last clicked to current
      const startIdx = displayDates.indexOf(lastClickedBayDate);
      const endIdx = displayDates.indexOf(date);
      if (startIdx !== -1 && endIdx !== -1) {
        const [minIdx, maxIdx] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const newSelected = new Set(selectedBayDates);
        for (let i = minIdx; i <= maxIdx; i++) {
          newSelected.add(displayDates[i]);
        }
        setSelectedBayDates(newSelected);
        // Update selectedDate for the Core/Support detail view
        setSelectedDate(date);
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle single date without clearing others
      const newSelected = new Set(selectedBayDates);
      if (newSelected.has(date)) {
        newSelected.delete(date);
        // If this date was selectedDate, update it to another selected date or clear it
        if (selectedDate === date) {
          if (newSelected.size > 0) {
            // Set to the first remaining selected date
            setSelectedDate(Array.from(newSelected)[0]);
          } else {
            setSelectedDate('');
          }
        }
      } else {
        newSelected.add(date);
        // Update selectedDate only when selecting
        setSelectedDate(date);
      }
      setSelectedBayDates(newSelected);
      setLastClickedBayDate(date);
    } else {
      // Toggle selection (add if not present, remove if present)
      const newSelected = new Set(selectedBayDates);
      if (newSelected.has(date)) {
        newSelected.delete(date);
        // If this date was selectedDate, update it to another selected date or clear it
        if (selectedDate === date) {
          if (newSelected.size > 0) {
            // Set to the first remaining selected date
            setSelectedDate(Array.from(newSelected)[0]);
          } else {
            setSelectedDate('');
          }
        }
      } else {
        newSelected.add(date);
        // Update selectedDate only when selecting
        setSelectedDate(date);
      }
      setSelectedBayDates(newSelected);
      setLastClickedBayDate(date);
    }
  };

  // Handlers for row-specific multi-cell selection
  const handleBayCellMouseDown = (bayNum: number, tail: string | null, dateIdx: number, date: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!tail) return; // Only allow selection on cells with aircraft
    
    // Start drag selection
    setIsDraggingBaySelection(true);
    setDragStartCell({ bay: bayNum, tail, dateIdx });
    
    // Initialize selection with the clicked cell
    setSelectedBayCells({ bay: bayNum, tail, dates: [date] });
    setSelectedDate(date);
  };

  const handleBayCellMouseEnter = (bayNum: number, tail: string | null, dateIdx: number, date: string) => {
    if (!isDraggingBaySelection || !dragStartCell) return;
    
    // Only allow extending selection within the same bay and tail
    if (bayNum !== dragStartCell.bay || tail !== dragStartCell.tail) return;
    
    // Calculate range of dates
    const startIdx = Math.min(dragStartCell.dateIdx, dateIdx);
    const endIdx = Math.max(dragStartCell.dateIdx, dateIdx);
    
    const selectedDates: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      selectedDates.push(displayDates[i]);
    }
    
    setSelectedBayCells({ bay: bayNum, tail: dragStartCell.tail, dates: selectedDates });
  };

  const handleBayCellMouseUp = () => {
    if (isDraggingBaySelection && selectedBayCells) {
      // Selection complete - update selectedDate to the last date in selection
      if (selectedBayCells.dates.length > 0) {
        setSelectedDate(selectedBayCells.dates[selectedBayCells.dates.length - 1]);
      }
    }
    setIsDraggingBaySelection(false);
    setDragStartCell(null);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingBaySelection) {
        setIsDraggingBaySelection(false);
        setDragStartCell(null);
      }
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDraggingBaySelection]);

  // Helper to check if a cell is at the edge of the selection
  const getCellSelectionEdges = (bayNum: number, tail: string | null, date: string): { isFirst: boolean; isLast: boolean; isSelected: boolean } => {
    if (!selectedBayCells || !tail) return { isFirst: false, isLast: false, isSelected: false };
    
    const isSelected = selectedBayCells.bay === bayNum && 
                       selectedBayCells.tail === tail && 
                       selectedBayCells.dates.includes(date);
    
    if (!isSelected) return { isFirst: false, isLast: false, isSelected: false };
    
    const dateIdx = selectedBayCells.dates.indexOf(date);
    const isFirst = dateIdx === 0;
    const isLast = dateIdx === selectedBayCells.dates.length - 1;
    
    return { isFirst, isLast, isSelected };
  };

  // Clear bay date selection when scenario changes
  useEffect(() => {
    setSelectedBayDates(new Set());
    setLastClickedBayDate(null);
    setSelectedBayCells(null); // Also clear row-specific selection
    setSelectedBayRowForHighlight(null); // Clear bay row selection for column highlighting
  }, [selectedScenario]);

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="bg-white border-2 border-gray-800 rounded mb-4 p-4">
      <div className="flex items-center justify-between bg-white">
  
  {/* Left section */}
  <div className="flex items-center gap-2 py-2">
    <h2 className="text-xl font-bold mb-3">
      Planning Scenario Visualizer
    </h2>

    <button
      className="p-1 hover:bg-gray-100 rounded"
      onClick={() => setShowSettingsPopup(true)}
    >
      <Settings className="w-4 h-4 text-black mb-2" />
    </button>
  </div>

  {/* Right section */}
  <div className="bg-[#dff2d0] px-6 py-2 border-l border-gray-300 flex items-center">
    <span className="text-sm font-semibold text-[#1a5fce]">
      Active Scenario set – {activeScenario || 'None'}
    </span>
  </div>

</div>

        
        {/* Settings Popup - Active Scenario */}
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
            ✕
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Configure and manage your planning scenario
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
            onChange={(e) => {
              const newScenario = e.target.value;
              setActiveScenario(newScenario);
              if (newScenario) {
                updateActiveScenarioInDB(newScenario);
              }
            }}
            className="w-full h-11 px-4 pr-10 rounded-xl border border-gray-300 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="" disabled>
              -- Select a scenario --
            </option>
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>

          {/* Dropdown icon */}
          {/* <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div> */}
        </div>

        {/* Load Button */}
        <div className="flex justify-center">
          <button
            onClick={() => {
              // Just close the popup - activeScenario is already saved to DB on dropdown change
              // This does NOT affect selectedScenario (the viewing scenario)
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

        {/* Status */}
        {/* <div className="flex items-center justify-center gap-2 mt-4 text-sm text-gray-600">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          Scenario Ready
        </div> */}
      </div>
    </div>
  </div>
)}



        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Select Scenario:</label>
          <select
            value={selectedScenario}
            onChange={(e) => {
              const newScenario = e.target.value;
              setSelectedScenario(newScenario);
              // Note: This only loads/views the scenario locally
              // To set Active Scenario, use the Settings popup
            }}
            className="w-full px-3 py-2 border-2 border-gray-300 rounded"
          >
            <option value="">-- Select a scenario --</option>
            {scenarios.map(scenario => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.source === 'ai' ? '🤖 ' : '📁 '}{scenario.name}
              </option>
            ))}
          </select>
          {selectedScenario && scenarios.find(s => s.id === selectedScenario) && (
            <div className="mt-2 text-sm text-blue-600">
              🤖 AI-generated scenario with automated allocations merged with roster data
            </div>
          )}
        </div>

        {selectedScenario && (
        <div className="mb-2">
          <label className="block text-sm font-medium mb-2">Search Employee or Tail:</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Enter employee name or tail number..."
                className="w-full pl-10 pr-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              />
            </div>
            {(searchQuery || selectedTask) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedBay(null);
                  setSelectedTask(null);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors font-medium"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        )}
      </div>

      {selectedBay && selectedBayRowForHighlight !== null && selectedBayDates.size > 0 && (
        <div className="bg-white border-2 border-gray-800 rounded mb-4 p-4 sticky top-0 z-30">
          {/* Header with tail details and close button */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              {/* Tail Number and Details Header */}
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xl font-bold text-gray-900">{selectedBay.tail}</h3>
                {isLoadingSuggestions && (
                  <span className="text-sm text-blue-600 animate-pulse">Loading...</span>
                )}
              </div>

              {/* Tail Details Row */}
              {selectedTailDetails ? (
                <div className="flex flex-wrap gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Induction:</span>{' '}
                    <span className="font-medium">{formatDateFull(selectedTailDetails.inductionDate)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">ETS:</span>{' '}
                    <span className="font-medium">{formatDateFull(selectedTailDetails.etsDate)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Airline:</span>{' '}
                    <span className="font-medium">{selectedTailDetails.airline || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Aircraft:</span>{' '}
                    <span className="font-medium">{selectedTailDetails.aircraft || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Engine:</span>{' '}
                    <span className="font-medium">{selectedTailDetails.engine || 'N/A'}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  Bay {selectedBay.bay} | {formatDateFull(selectedBay.date)}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedBay(null);
                setSelectedTask(null);
                setSearchQuery('');
              }}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Requirements Section */}
          <div className="flex gap-6 mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Min Eng Req:</span>
              <span className="font-bold text-lg text-blue-600">
                {selectedTailDetails?.minEngineers ?? additionalEngReq.ENGR}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Min Tech Req:</span>
              <span className="font-bold text-lg text-green-600">
                {selectedTailDetails?.minTechnicians ?? additionalEngReq.TECH}
              </span>
            </div>
            {/* <div className="flex items-center gap-2 border-l pl-6 border-gray-300">
              <span className="text-sm text-gray-600">Core Engineers:</span>
              <span className="font-bold text-lg text-blue-600">{coreTeamDetails.filter(m => !removedCoreTeamMembers.has(m.empId)).length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Core Technicians:</span>
              <span className="font-bold text-lg text-green-600">{coreTechnicianDetails.filter(t => !removedCoreTeamMembers.has(t.empId)).length}</span>
            </div> */}
          </div>

          {/* ===== ENGINEERS SECTION (BLUE) ===== */}
          {/* Row 1: Core Engineers (left) | Support Engineers (right) */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            {/* Core Engineers (Drop Zone) */}
            <div
              className={`border-2 border-dashed rounded-lg p-3 min-h-[80px] transition-colors relative ${
                draggedItem?.type === 'engineer' ? 'border-blue-500 bg-blue-100/50' : 'border-blue-300 bg-blue-50/30'
              }`}
              onMouseEnter={() => {
                if (draggedItem) {
                  console.log('MouseEnter Core Engineers - setting activeDropZone');
                  setActiveDropZone('coreEngineers');
                }
              }}
              onMouseLeave={() => {
                if (activeDropZone === 'coreEngineers') {
                  console.log('MouseLeave Core Engineers - clearing activeDropZone');
                  setActiveDropZone(null);
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('DragEnter on Core Engineers');
                setActiveDropZone('coreEngineers');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div className="font-semibold text-blue-800 mb-2 flex items-center gap-2 pointer-events-none">
                <User className="w-4 h-4" />
                Core Engineers ({coreTeamDetails.filter(m => !removedCoreTeamMembers.has(m.empId)).length + displayCoreEngineers.length})
              </div>
              {(coreTeamDetails.filter(m => !removedCoreTeamMembers.has(m.empId)).length > 0 || displayCoreEngineers.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {/* Existing core team members (non-draggable - from plan) */}
                  {coreTeamDetails.filter(m => !removedCoreTeamMembers.has(m.empId)).map(member => (
                    <div
                      key={member.empId}
                      className="relative group select-none"
                      onMouseEnter={() => setHoveredCard(`core-eng-${member.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div className="border-2 border-blue-400 bg-blue-50 rounded px-3 py-2 pr-6 relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // Get dates for removal - use selectedBayDates if available, else selectedDate or all visible dates
                            const datesToRemove: string[] = selectedBayDates.size > 0 
                              ? Array.from(selectedBayDates) 
                              : (selectedDate ? [selectedDate] : displayDates);
                            // Track the removed member details for logging
                            setRemovedCoreTeamDetails(prev => {
                              const newMap = new Map(prev);
                              const existing = newMap.get(member.empId);
                              const allDates = existing ? [...new Set([...existing.dates, ...datesToRemove])] : datesToRemove;
                              newMap.set(member.empId, { empName: member.empName, tailNum: selectedTask || '', dates: allDates });
                              return newMap;
                            });
                            setRemovedCoreTeamMembers(prev => new Set([...prev, member.empId]));
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="absolute top-1 right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center z-10 cursor-pointer"
                          title="Remove from Core Team"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="font-semibold text-sm text-gray-900">{member.empName}</div>
                        <div className="text-xs text-gray-500">{member.title} | {member.team || 'N/A'}</div>
                      </div>
                      {hoveredCard === `core-eng-${member.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-56 border-2 border-blue-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{member.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {member.title}</div>
                            <div><span className="font-medium">Team:</span> {member.team || 'N/A'}</div>
                            <div><span className="font-medium">Exp:</span> {member.yearsOfExperience} yrs</div>
                            <div><span className="font-medium">Aircraft:</span> {member.mostWorkedAircraft || 'N/A'}</div>
                            <div><span className="font-medium">Licenses:</span> {member.licenseCount}</div>
                            <div><span className="font-medium">Leave Balance:</span> {member.totalLeaveBalance} days</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* UI-added core engineers for this date (draggable back to suggested) */}
                  {displayCoreEngineers.map(engineer => (
                    <div
                      key={engineer.empId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('Core Engineer DragStart:', engineer.empName);
                        setHoveredCard(null);
                        const item = { type: 'engineer' as const, data: engineer, source: 'core' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'engineer', source: 'core', id: engineer.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('Core Engineer DragEnd, activeDropZone:', activeDropZone);
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`ui-core-eng-${engineer.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div className="border-2 border-blue-600 bg-blue-100 rounded px-3 py-2 pointer-events-none">
                        <div className="font-semibold text-sm text-gray-900">{engineer.empName}</div>
                        <div className="text-xs text-gray-500">{engineer.title} | {engineer.team || 'N/A'}</div>
                        <div className="text-xs text-blue-600 font-medium">+ Added</div>
                      </div>
                      {hoveredCard === `ui-core-eng-${engineer.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-56 border-2 border-blue-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{engineer.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {engineer.title}</div>
                            <div><span className="font-medium">Team:</span> {engineer.team || 'N/A'}</div>
                            <div><span className="font-medium">Exp:</span> {engineer.yearsOfExperience} yrs</div>
                            <div><span className="font-medium">Aircraft:</span> {engineer.mostWorkedAircraft || 'N/A'}</div>
                            <div><span className="font-medium">Licenses:</span> {engineer.licenseCount}</div>
                            <div><span className="font-medium">Leave Balance:</span> {engineer.totalLeaveBalance} days</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic text-center py-2 pointer-events-none">
                  Drag engineers here to add to core
                </div>
              )}
            </div>

            {/* Support Engineers (Drop Zone) */}
            <div
              className={`border-2 border-dashed rounded-lg p-3 min-h-[80px] transition-colors relative ${
                draggedItem?.type === 'engineer' ? 'border-blue-500 bg-blue-100/50' : 'border-blue-300 bg-blue-50/30'
              }`}
              onMouseEnter={() => {
                if (draggedItem) {
                  console.log('MouseEnter Support Engineers - setting activeDropZone');
                  setActiveDropZone('supportEngineers');
                }
              }}
              onMouseLeave={() => {
                if (activeDropZone === 'supportEngineers') {
                  console.log('MouseLeave Support Engineers - clearing activeDropZone');
                  setActiveDropZone(null);
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('DragEnter on Support Engineers');
                setActiveDropZone('supportEngineers');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('DROP EVENT on Support Engineers!');
                handleDropOnCoreSupport(e, 'engineer');
              }}
            >
              <div className="font-semibold text-blue-800 mb-2 flex items-center gap-2 pointer-events-none">
                <User className="w-4 h-4" />
                Support Engineers ({supportTeamDetails.filter(m => !removedSupportMembers.has(m.empId)).length + displaySupportEngineers.length + movedCoreDbEngineersToSupport.size})
              </div>
              {(supportTeamDetails.filter(m => !removedSupportMembers.has(m.empId)).length > 0 || displaySupportEngineers.length > 0 || movedCoreDbEngineersToSupport.size > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {/* Existing support team members from database */}
                  {supportTeamDetails.filter(m => !removedSupportMembers.has(m.empId)).map(member => (
                    <div
                      key={member.empId}
                      className="relative group"
                      onMouseEnter={() => setHoveredCard(`support-eng-db-${member.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div className="border-2 border-blue-400 bg-blue-50 rounded px-3 py-2 pr-6 cursor-default relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Get dates for removal - use selectedBayDates if available, else selectedDate or all visible dates
                            const datesToRemove: string[] = selectedBayDates.size > 0 
                              ? Array.from(selectedBayDates) 
                              : (selectedDate ? [selectedDate] : displayDates);
                            // Track the removed member details for logging
                            setRemovedSupportDetails(prev => {
                              const newMap = new Map(prev);
                              const existing = newMap.get(member.empId);
                              const allDates = existing ? [...new Set([...existing.dates, ...datesToRemove])] : datesToRemove;
                              newMap.set(member.empId, { empName: member.empName, tailNum: selectedTask || '', dates: allDates });
                              return newMap;
                            });
                            setRemovedSupportMembers(prev => new Set([...prev, member.empId]));
                          }}
                          className="absolute top-1 right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center z-10"
                          title="Remove from Support Team"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="font-semibold text-sm text-gray-900">{member.empName}</div>
                        <div className="text-xs text-gray-500">{member.title} | {member.team || 'N/A'}</div>
                      </div>
                      {hoveredCard === `support-eng-db-${member.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-56 border-2 border-blue-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{member.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {member.title}</div>
                            <div><span className="font-medium">Team:</span> {member.team || 'N/A'}</div>
                            <div><span className="font-medium">Exp:</span> {member.yearsOfExperience} yrs</div>
                            <div><span className="font-medium">Aircraft:</span> {member.mostWorkedAircraft || 'N/A'}</div>
                            <div><span className="font-medium">Licenses:</span> {member.licenseCount}</div>
                            <div><span className="font-medium">Leave Balance:</span> {member.totalLeaveBalance} days</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* DB Core engineers moved to support (draggable back to core) */}
                  {Array.from(movedCoreDbEngineersToSupport.values()).map(engineer => (
                    <div
                      key={`moved-core-${engineer.empId}`}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('Moved Core DB Engineer DragStart (in Support):', engineer.empName);
                        setHoveredCard(null);
                        const item = { type: 'engineer' as const, data: engineer, source: 'support' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'engineer', source: 'support', id: engineer.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('Moved Core DB Engineer DragEnd, activeDropZone:', activeDropZone);
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`moved-core-support-${engineer.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div className="border-2 border-blue-600 bg-blue-100 rounded px-3 py-2 pr-6 pointer-events-none relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Remove from movedCoreDbEngineersToSupport and add back to core
                            setMovedCoreDbEngineersToSupport(prev => {
                              const newMap = new Map(prev);
                              newMap.delete(engineer.empId);
                              return newMap;
                            });
                            setRemovedCoreTeamMembers(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(engineer.empId);
                              return newSet;
                            });
                          }}
                          className="absolute top-1 right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center z-10 pointer-events-auto"
                          title="Remove from Support (return to Core)"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="font-semibold text-sm text-gray-900">{engineer.empName}</div>
                        <div className="text-xs text-gray-500">{engineer.title} | {engineer.team || 'N/A'}</div>
                        <div className="text-xs text-blue-600 font-medium">← Moved from Core</div>
                      </div>
                      {hoveredCard === `moved-core-support-${engineer.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-56 border-2 border-blue-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{engineer.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {engineer.title}</div>
                            <div><span className="font-medium">Team:</span> {engineer.team || 'N/A'}</div>
                            <div><span className="font-medium">Exp:</span> {engineer.yearsOfExperience} yrs</div>
                            <div><span className="font-medium">Aircraft:</span> {engineer.mostWorkedAircraft || 'N/A'}</div>
                            <div><span className="font-medium">Licenses:</span> {engineer.licenseCount}</div>
                            <div><span className="font-medium">Leave Balance:</span> {engineer.totalLeaveBalance} days</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* UI-added support engineers for this date */}
                  {displaySupportEngineers.map(engineer => (
                    <div
                      key={engineer.empId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('UI Support Engineer DragStart:', engineer.empName);
                        setHoveredCard(null);
                        const item = { type: 'engineer' as const, data: engineer, source: 'support' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'engineer', source: 'support', id: engineer.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('UI Support Engineer DragEnd, activeDropZone:', activeDropZone);
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`support-eng-ui-${engineer.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div className="border-2 border-blue-600 bg-blue-100 rounded px-3 py-2 pointer-events-none">
                        <div className="font-semibold text-sm text-gray-900">{engineer.empName}</div>
                        <div className="text-xs text-gray-500">{engineer.title} | {engineer.team || 'N/A'}</div>
                      </div>
                      {hoveredCard === `support-eng-ui-${engineer.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-56 border-2 border-blue-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{engineer.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {engineer.title}</div>
                            <div><span className="font-medium">Team:</span> {engineer.team || 'N/A'}</div>
                            <div><span className="font-medium">Exp:</span> {engineer.yearsOfExperience} yrs</div>
                            <div><span className="font-medium">Aircraft:</span> {engineer.mostWorkedAircraft || 'N/A'}</div>
                            <div><span className="font-medium">Licenses:</span> {engineer.licenseCount}</div>
                            <div><span className="font-medium">Leave Balance:</span> {engineer.totalLeaveBalance} days</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic text-center py-2 pointer-events-none">
                  Drag engineers here to add as support
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Suggested Engineers (full width) */}
          <div
            className={`border-2 border-dashed rounded-lg p-3 mb-4 min-h-[80px] transition-colors relative ${
              draggedItem?.type === 'engineer' && (draggedItem?.source === 'core' || draggedItem?.source === 'support')
                ? 'border-blue-500 bg-blue-100/50'
                : 'border-blue-300 bg-blue-50/30'
            }`}
            onMouseEnter={() => {
              if (draggedItem) {
                console.log('MouseEnter Suggested Engineers - setting activeDropZone');
                setActiveDropZone('suggestedEngineers');
              }
            }}
            onMouseLeave={() => {
              if (activeDropZone === 'suggestedEngineers') {
                console.log('MouseLeave Suggested Engineers - clearing activeDropZone');
                setActiveDropZone(null);
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveDropZone('suggestedEngineers');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('DROP EVENT on Suggested Engineers!');
              handleDropOnSuggested(e, 'engineer');
            }}
          >
            <div className="font-semibold text-blue-800 mb-2 flex items-center gap-2 pointer-events-none">
              <User className="w-4 h-4" />
              Suggested Engineers ({displaySuggestedEngineers.length})
              {isLoadingSuggestions && (
                <span className="text-sm font-normal text-blue-600 animate-pulse ml-2">Loading...</span>
              )}
            </div>
            {displaySuggestedEngineers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {displaySuggestedEngineers.map(engineer => {
                  const assignmentInfo = assignmentCheckDate ? getEmployeeAssignmentInfo(engineer.empId, assignmentCheckDate) : null;
                  const hasConflict = assignmentInfo?.hasCoreAssignment || false;

                  return (
                    <div
                      key={engineer.empId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('Suggested Engineer DragStart:', engineer.empName);
                        setHoveredCard(null);
                        const item = { type: 'engineer' as const, data: engineer, source: 'suggested' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'engineer', source: 'suggested', id: engineer.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('Suggested Engineer DragEnd, activeDropZone:', activeDropZone);
                        // Process drop using activeDropZone
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`sugg-eng-${engineer.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div
                        className={`border-2 rounded px-3 py-2 transition-colors pointer-events-none ${
                          hasConflict
                            ? 'border-red-400 bg-red-50'
                            : 'border-blue-400 bg-blue-50'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          {hasConflict && (
                            <span className="text-red-600 font-bold text-sm" title="Has core assignment">!</span>
                          )}
                          <div className="font-semibold text-sm text-gray-900">{engineer.empName}</div>
                        </div>
                        <div className="text-xs text-gray-500">{engineer.title} | {engineer.team || 'N/A'}</div>
                        {assignmentInfo?.coreAssignment && (
                          <div className="text-xs text-red-600 mt-1">Core: {assignmentInfo.coreAssignment}</div>
                        )}
                      </div>
                      {hoveredCard === `sugg-eng-${engineer.empId}` && (
                        <div className={`absolute z-50 left-0 top-full mt-1 w-56 border-2 bg-white rounded-lg shadow-xl p-3 ${
                          hasConflict ? 'border-red-500' : 'border-blue-500'
                        }`}>
                          <div className="font-bold text-sm text-gray-900 mb-2">{engineer.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {engineer.title}</div>
                            <div><span className="font-medium">Team:</span> {engineer.team || 'N/A'}</div>
                            <div><span className="font-medium">Exp:</span> {engineer.yearsOfExperience} yrs</div>
                            <div><span className="font-medium">Aircraft:</span> {engineer.mostWorkedAircraft || 'N/A'}</div>
                            <div><span className="font-medium">Licenses:</span> {engineer.licenseCount}</div>
                            <div><span className="font-medium">Leave Balance:</span> {engineer.totalLeaveBalance} days</div>
                          </div>
                          {(assignmentInfo?.coreAssignment || assignmentInfo?.supportAssignment) && (
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <div className="text-xs font-semibold text-red-600 mb-1">Current Assignment:</div>
                              {assignmentInfo?.coreAssignment && (
                                <div className="text-xs text-red-600">Core: {assignmentInfo.coreAssignment}</div>
                              )}
                              {assignmentInfo?.supportAssignment && (
                                <div className="text-xs text-orange-600">Support: {assignmentInfo.supportAssignment}</div>
                              )}
                              {assignmentInfo?.assignmentDate && (
                                <div className="text-xs text-gray-500">From: {assignmentInfo.assignmentDate}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : !isLoadingSuggestions ? (
              <div className="text-sm text-gray-500 italic text-center py-2">No suggested engineers available</div>
            ) : null}
            <div className="text-right text-xs text-gray-400 mt-2">
              Drag cards between Suggested and Core Support sections
            </div>
          </div>

          {/* Divider */}
          <div className="border-t-2 border-gray-300 my-4"></div>

          {/* ===== TECHNICIANS SECTION (GREEN) ===== */}
          {/* Row 3: Core Technicians (left) | Support Technicians (right) */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            {/* Core Technicians (Drop Zone) */}
            <div
              className={`border-2 border-dashed rounded-lg p-3 min-h-[80px] transition-colors relative ${
                draggedItem?.type === 'technician' ? 'border-green-500 bg-green-100/50' : 'border-green-300 bg-green-50/30'
              }`}
              onMouseEnter={() => {
                if (draggedItem) {
                  console.log('MouseEnter Core Technicians - setting activeDropZone');
                  setActiveDropZone('coreTechnicians');
                }
              }}
              onMouseLeave={() => {
                if (activeDropZone === 'coreTechnicians') {
                  console.log('MouseLeave Core Technicians - clearing activeDropZone');
                  setActiveDropZone(null);
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('DragEnter on Core Technicians');
                setActiveDropZone('coreTechnicians');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div className="font-semibold text-green-800 mb-2 flex items-center gap-2 pointer-events-none">
                <User className="w-4 h-4" />
                Core Technicians ({coreTechnicianDetails.filter(t => !removedCoreTeamMembers.has(t.empId)).length + displayCoreTechnicians.length})
              </div>
              {(coreTechnicianDetails.filter(t => !removedCoreTeamMembers.has(t.empId)).length > 0 || displayCoreTechnicians.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {/* Existing core technicians */}
                  {coreTechnicianDetails.filter(t => !removedCoreTeamMembers.has(t.empId)).map(tech => (
                    <div
                      key={tech.empId}
                      className="relative group cursor-pointer"
                      onMouseEnter={() => setHoveredCard(`core-tech-${tech.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                      onClick={() => handleTechnicianClick(tech)}
                    >
                      <div className="border-2 border-green-400 bg-green-50 rounded px-3 py-2 pr-6 hover:bg-green-100 transition-colors relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Get dates for removal - use selectedBayDates if available, else selectedDate or all visible dates
                            const datesToRemove: string[] = selectedBayDates.size > 0 
                              ? Array.from(selectedBayDates) 
                              : (selectedDate ? [selectedDate] : displayDates);
                            // Track the removed member details for logging
                            setRemovedCoreTeamDetails(prev => {
                              const newMap = new Map(prev);
                              const existing = newMap.get(tech.empId);
                              const allDates = existing ? [...new Set([...existing.dates, ...datesToRemove])] : datesToRemove;
                              newMap.set(tech.empId, { empName: tech.empName, tailNum: selectedTask || '', dates: allDates });
                              return newMap;
                            });
                            setRemovedCoreTeamMembers(prev => new Set([...prev, tech.empId]));
                          }}
                          className="absolute top-1 right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center z-10"
                          title="Remove from Core Team"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="font-semibold text-sm text-gray-900">{tech.empName}</div>
                        <div className="text-xs text-gray-500">{tech.title} | {tech.team || 'N/A'}</div>
                      </div>
                      {hoveredCard === `core-tech-${tech.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-48 border-2 border-green-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{tech.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {tech.title}</div>
                            <div><span className="font-medium">Team:</span> {tech.team || 'N/A'}</div>
                            <div><span className="font-medium">Aircraft:</span> {tech.aircraft || 'N/A'}</div>
                            <div><span className="font-medium">Engine:</span> {tech.engine || 'N/A'}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* UI-added core technicians for this date (draggable back to suggested) */}
                  {displayCoreTechnicians.map(tech => (
                    <div
                      key={tech.empId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('Core Technician DragStart:', tech.empName);
                        setHoveredCard(null);
                        const item = { type: 'technician' as const, data: tech, source: 'core' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'technician', source: 'core', id: tech.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('Core Technician DragEnd, activeDropZone:', activeDropZone);
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`ui-core-tech-${tech.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                      onClick={(e) => {
                        if (!draggedItem) {
                          e.stopPropagation();
                          handleTechnicianClick(tech);
                        }
                      }}
                    >
                      <div className="border-2 border-green-600 bg-green-100 rounded px-3 py-2 pointer-events-none">
                        <div className="font-semibold text-sm text-gray-900">{tech.empName}</div>
                        <div className="text-xs text-gray-500">{tech.title} | {tech.team || 'N/A'}</div>
                        <div className="text-xs text-green-600 font-medium">+ Added</div>
                      </div>
                      {hoveredCard === `ui-core-tech-${tech.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-48 border-2 border-green-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{tech.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {tech.title}</div>
                            <div><span className="font-medium">Team:</span> {tech.team || 'N/A'}</div>
                            <div><span className="font-medium">Aircraft:</span> {tech.aircraft || 'N/A'}</div>
                            <div><span className="font-medium">Engine:</span> {tech.engine || 'N/A'}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic text-center py-2 pointer-events-none">
                  Drag technicians here to add to core
                </div>
              )}
            </div>

            {/* Support Technicians (Drop Zone) */}
            <div
              className={`border-2 border-dashed rounded-lg p-3 min-h-[80px] transition-colors relative z-10 ${
                draggedItem?.type === 'technician' ? 'border-green-500 bg-green-100/50' : 'border-green-300 bg-green-50/30'
              }`}
              onMouseEnter={() => {
                if (draggedItem) {
                  console.log('MouseEnter Support Technicians - setting activeDropZone');
                  setActiveDropZone('supportTechnicians');
                }
              }}
              onMouseLeave={() => {
                if (activeDropZone === 'supportTechnicians') {
                  console.log('MouseLeave Support Technicians - clearing activeDropZone');
                  setActiveDropZone(null);
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('DragEnter on Support Technicians');
                setActiveDropZone('supportTechnicians');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('DROP EVENT on Support Technicians!');
                handleDropOnCoreSupport(e, 'technician');
              }}
            >
              <div className="font-semibold text-green-800 mb-2 flex items-center gap-2 pointer-events-none">
                <User className="w-4 h-4" />
                Support Technicians ({supportTechnicianDetails.filter(t => !removedSupportMembers.has(t.empId)).length + displaySupportTechnicians.length})
              </div>
              {(supportTechnicianDetails.filter(t => !removedSupportMembers.has(t.empId)).length > 0 || displaySupportTechnicians.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {/* Existing support technicians from database */}
                  {supportTechnicianDetails.filter(t => !removedSupportMembers.has(t.empId)).map(tech => (
                    <div
                      key={tech.empId}
                      className="relative group"
                      onMouseEnter={() => setHoveredCard(`support-tech-db-${tech.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                      onClick={(e) => {
                        if (!draggedItem) {
                          e.stopPropagation();
                          handleTechnicianClick(tech);
                        }
                      }}
                    >
                      <div className="border-2 border-green-400 bg-green-50 rounded px-3 py-2 pr-6 cursor-default relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Get dates for removal - use selectedBayDates if available, else selectedDate or all visible dates
                            const datesToRemove: string[] = selectedBayDates.size > 0 
                              ? Array.from(selectedBayDates) 
                              : (selectedDate ? [selectedDate] : displayDates);
                            // Track the removed member details for logging
                            setRemovedSupportDetails(prev => {
                              const newMap = new Map(prev);
                              const existing = newMap.get(tech.empId);
                              const allDates = existing ? [...new Set([...existing.dates, ...datesToRemove])] : datesToRemove;
                              newMap.set(tech.empId, { empName: tech.empName, tailNum: selectedTask || '', dates: allDates });
                              return newMap;
                            });
                            setRemovedSupportMembers(prev => new Set([...prev, tech.empId]));
                          }}
                          className="absolute top-1 right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center z-10"
                          title="Remove from Support Team"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="font-semibold text-sm text-gray-900">{tech.empName}</div>
                        <div className="text-xs text-gray-500">{tech.title} | {tech.team || 'N/A'}</div>
                      </div>
                      {hoveredCard === `support-tech-db-${tech.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-48 border-2 border-green-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{tech.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {tech.title}</div>
                            <div><span className="font-medium">Team:</span> {tech.team || 'N/A'}</div>
                            <div><span className="font-medium">Aircraft:</span> {tech.aircraft || 'N/A'}</div>
                            <div><span className="font-medium">Engine:</span> {tech.engine || 'N/A'}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* UI-added support technicians for this date (draggable back to suggested) */}
                  {displaySupportTechnicians.map(tech => (
                    <div
                      key={tech.empId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('UI Support Technician DragStart:', tech.empName);
                        setHoveredCard(null);
                        const item = { type: 'technician' as const, data: tech, source: 'support' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'technician', source: 'support', id: tech.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('UI Support Technician DragEnd, activeDropZone:', activeDropZone);
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`support-tech-ui-${tech.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                      onClick={(e) => {
                        if (!draggedItem) {
                          e.stopPropagation();
                          handleTechnicianClick(tech);
                        }
                      }}
                    >
                      <div className="border-2 border-green-600 bg-green-100 rounded px-3 py-2 pointer-events-none">
                        <div className="font-semibold text-sm text-gray-900">{tech.empName}</div>
                        <div className="text-xs text-gray-500">{tech.title} | {tech.team || 'N/A'}</div>
                      </div>
                      {hoveredCard === `support-tech-ui-${tech.empId}` && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-48 border-2 border-green-500 bg-white rounded-lg shadow-xl p-3">
                          <div className="font-bold text-sm text-gray-900 mb-2">{tech.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {tech.title}</div>
                            <div><span className="font-medium">Team:</span> {tech.team || 'N/A'}</div>
                            <div><span className="font-medium">Aircraft:</span> {tech.aircraft || 'N/A'}</div>
                            <div><span className="font-medium">Engine:</span> {tech.engine || 'N/A'}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic text-center py-2 pointer-events-none">
                  Drag technicians here to add as support
                </div>
              )}
            </div>
          </div>

          {/* Row 4: Suggested Technicians (full width) */}
          <div
            className={`border-2 border-dashed rounded-lg p-3 min-h-[80px] transition-colors relative ${
              draggedItem?.type === 'technician' && (draggedItem?.source === 'core' || draggedItem?.source === 'support')
                ? 'border-green-500 bg-green-100/50'
                : 'border-green-300 bg-green-50/30'
            }`}
            onMouseEnter={() => {
              if (draggedItem) {
                console.log('MouseEnter Suggested Technicians - setting activeDropZone');
                setActiveDropZone('suggestedTechnicians');
              }
            }}
            onMouseLeave={() => {
              if (activeDropZone === 'suggestedTechnicians') {
                console.log('MouseLeave Suggested Technicians - clearing activeDropZone');
                setActiveDropZone(null);
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveDropZone('suggestedTechnicians');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('DROP EVENT on Suggested Technicians!');
              handleDropOnSuggested(e, 'technician');
            }}
          >
            <div className="font-semibold text-green-800 mb-2 flex items-center gap-2 pointer-events-none">
              <User className="w-4 h-4" />
              Suggested Technicians ({displaySuggestedTechnicians.length})
            </div>
            {displaySuggestedTechnicians.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {displaySuggestedTechnicians.map(tech => {
                  const assignmentInfo = assignmentCheckDate ? getEmployeeAssignmentInfo(tech.empId, assignmentCheckDate) : null;
                  const hasConflict = assignmentInfo?.hasCoreAssignment || false;

                  return (
                    <div
                      key={tech.empId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        console.log('Suggested Technician DragStart:', tech.empName);
                        setHoveredCard(null);
                        const item = { type: 'technician' as const, data: tech, source: 'suggested' };
                        setDraggedItem(item);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'technician', source: 'suggested', id: tech.empId }));
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        console.log('Suggested Technician DragEnd, activeDropZone:', activeDropZone);
                        // Process drop using activeDropZone
                        handleDragEnd(draggedItem);
                      }}
                      className="relative group cursor-grab active:cursor-grabbing select-none"
                      onMouseEnter={() => setHoveredCard(`sugg-tech-${tech.empId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                      onClick={(e) => {
                        // Only open drawer if not dragging
                        if (!draggedItem) {
                          e.stopPropagation();
                          handleTechnicianClick(tech);
                        }
                      }}
                    >
                      <div
                        className={`border-2 rounded px-3 py-2 transition-colors pointer-events-none ${
                          hasConflict
                            ? 'border-red-400 bg-red-50'
                            : 'border-green-400 bg-green-50'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          {hasConflict && (
                            <span className="text-red-600 font-bold text-sm" title="Has core assignment">!</span>
                          )}
                          <div className="font-semibold text-sm text-gray-900">{tech.empName}</div>
                        </div>
                        <div className="text-xs text-gray-500">{tech.title} | {tech.team || 'N/A'}</div>
                        {assignmentInfo?.coreAssignment && (
                          <div className="text-xs text-red-600 mt-1">Core: {assignmentInfo.coreAssignment}</div>
                        )}
                      </div>
                      {hoveredCard === `sugg-tech-${tech.empId}` && (
                        <div className={`absolute z-50 left-0 top-full mt-1 w-48 border-2 bg-white rounded-lg shadow-xl p-3 ${
                          hasConflict ? 'border-red-500' : 'border-green-500'
                        }`}>
                          <div className="font-bold text-sm text-gray-900 mb-2">{tech.empName}</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div><span className="font-medium">Title:</span> {tech.title}</div>
                            <div><span className="font-medium">Team:</span> {tech.team || 'N/A'}</div>
                            <div><span className="font-medium">Aircraft:</span> {tech.aircraft || 'N/A'}</div>
                            <div><span className="font-medium">Engine:</span> {tech.engine || 'N/A'}</div>
                          </div>
                          {(assignmentInfo?.coreAssignment || assignmentInfo?.supportAssignment) && (
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <div className="text-xs font-semibold text-red-600 mb-1">Current Assignment:</div>
                              {assignmentInfo?.coreAssignment && (
                                <div className="text-xs text-red-600">Core: {assignmentInfo.coreAssignment}</div>
                              )}
                              {assignmentInfo?.supportAssignment && (
                                <div className="text-xs text-orange-600">Support: {assignmentInfo.supportAssignment}</div>
                              )}
                              {assignmentInfo?.assignmentDate && (
                                <div className="text-xs text-gray-500">From: {assignmentInfo.assignmentDate}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-500 italic text-center py-2">No suggested technicians available</div>
            )}
            <div className="text-right text-xs text-gray-400 mt-2">
              Drag cards between Suggested and Core Support sections
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-2 border-gray-800 rounded mb-4">
        <div className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-2 border-gray-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-800">
                Assignments & Roster Plan
                {scenarioRosterData.isLoading && (
                  <span className="ml-3 text-sm font-normal text-blue-600 animate-pulse">
                    Loading scenario data...
                  </span>
                )}
                {scenarioRosterData.error && (
                  <span className="ml-3 text-sm font-normal text-red-600">
                    Error: {scenarioRosterData.error}
                  </span>
                )}
                {selectedBay && (
                  <span className="ml-3 text-sm font-normal text-slate-600">
                    (Highlighted: {selectedBay.tail} on {formatDateFull(selectedBay.date)})
                  </span>
                )}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {scenarioRosterData.scenarioName
                  ? `Scenario: ${scenarioRosterData.scenarioName}`
                  : 'Tail numbers and roster items for the selected scenario'}
              </p>
            </div>
            <div>
              {(() => {
                const hasChanges = uiDateAssignments.size > 0 || uiRosterOverrides.size > 0 || removedCoreTeamMembers.size > 0 || addedToCoreDetails.size > 0 || addedToSupportDetails.size > 0 || removedSupportMembers.size > 0 || removedSupportDetails.size > 0;
                return (
                  <button 
                    className={`px-4 py-2 rounded-md transition-colors ${
                      hasChanges && !isCommitting
                        ? 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer' 
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                    disabled={!hasChanges || isCommitting}
                    onClick={commitChangesToDatabase}
                  >
                    {isCommitting ? 'Committing...' : 'Commit Changes'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>

        {!selectedScenario ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-gray-600 mb-2">No Scenario Selected</h4>
            <p className="text-gray-500 text-center max-w-md">
              Select a scenario from the dropdown above to view the assignments and roster plan.
            </p>
          </div>
        ) : (
        <>
        {/* Grid Container - Flex-based layout like Workforce Planning */}
        <div className="overflow-hidden">
          <div className="flex">
            {/* Fixed Left Columns (Employee Details) */}
            <div className="flex-shrink-0 border-r-2 border-gray-800">
              {/* Header */}
              <div className="bg-gray-200 border-b-2 border-gray-800">
                {/* Row 1: Section header */}
                <div className="px-2 py-1 text-xs font-bold text-center text-gray-700 bg-gray-300">
                  Employee Details
                </div>
                {/* Row 2: Column headers */}
                <div className="flex border-t border-gray-400">
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center border-r border-gray-400">ID</div>
                  <div className="w-32 px-2 py-1 text-xs font-bold text-center border-r border-gray-400">Employee</div>
                  <div className="w-16 px-2 py-1 text-xs font-bold text-center border-r border-gray-400">Team</div>
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
                onScroll={handleFixedColumnsScroll}
                className="max-h-[500px] overflow-y-auto"
                style={{ scrollbarWidth: 'none' }}
              >
                {uniqueEngineers.map((engineer, idx) => (
                  <div
                    key={engineer.id}
                    className={`flex border-b border-gray-300 h-8 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    onClick={() => handleEmployeeClick(engineer)}
                  >
                    <div className="w-20 px-2 text-xs font-medium border-r border-gray-300 truncate bg-gray-100 hover:bg-blue-100 flex items-center">
                      {engineer.id}
                    </div>
                    <div className="w-32 px-2 text-xs border-r border-gray-300 truncate bg-gray-100 hover:bg-blue-100 flex items-center" title={engineer.name}>
                      <User size={12} className="mr-1 text-slate-400 flex-shrink-0" />
                      {engineer.name}
                    </div>
                    <div className="w-16 px-2 text-xs border-r border-gray-300 truncate bg-gray-100 hover:bg-blue-100 flex items-center justify-center">
                      {scenarioRosterData.scenarioName && scenarioRosterData.byEmployee.get(engineer.id)?.[0]?.team || '--'}
                    </div>
                    <div className="w-24 px-2 text-xs truncate bg-gray-100 hover:bg-blue-100 flex items-center justify-center" title={formatRoleForDisplay(engineer.title)}>
                      {formatRoleForDisplay(engineer.title)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Details for Selected Date columns */}
            <div className="flex-shrink-0 border-r-2 border-gray-800">
              {/* Header */}
              <div className="bg-blue-100 border-b-2 border-gray-800">
                <div className="px-2 py-1 text-xs font-bold text-center text-blue-800">
                  Details for {selectedDate ? formatDate(selectedDate) : '--'}
                </div>
                <div className="flex border-t border-blue-300">
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center border-r border-blue-300">Core</div>
                  <div className="w-20 px-2 py-1 text-xs font-bold text-center">Support</div>
                </div>
              </div>
              {/* Body - Selected date detail columns */}
              <div
                ref={detailsColumnsBodyRef}
                onScroll={handleDetailsColumnsScroll}
                className="max-h-[500px] overflow-y-auto"
                style={{ scrollbarWidth: 'none' }}
              >
                {uniqueEngineers.map((engineer, idx) => {
                  const lookupKey = `${engineer.id}-${selectedDate}`;
                  const selectedDateData = scenarioRosterData.byEmployeeDate.get(lookupKey);
                  // Debug: Log first few lookups to see what's happening
                  if (idx < 3 && selectedDate) {
                    console.log('Core/Support lookup:', {
                      idx,
                      lookupKey,
                      found: !!selectedDateData,
                      data: selectedDateData,
                      planned_core: selectedDateData?.planned_core,
                      planned_support: selectedDateData?.planned_support,
                      allKeys: selectedDateData ? Object.keys(selectedDateData) : [],
                    });
                  }
                  // Check for UI override on core/support assignment (from drag-and-drop)
                  const overrideKey = `${engineer.id}-${selectedDate}`;
                  const uiOverride = uiRosterOverrides.get(overrideKey);

                  // Get Core value - check UI override first, then fall back to roster data
                  let plannedCore = selectedDateData?.planned_core || '--';
                  if (uiOverride !== undefined && uiOverride.core !== undefined) {
                    // UI override exists for core: null means cleared (show '--'), string means show that tail
                    plannedCore = uiOverride.core || '--';
                  }

                  // Get Support value - check UI override first, then fall back to roster data
                  let plannedSupport = selectedDateData?.planned_support || '--';
                  if (uiOverride !== undefined && uiOverride.support !== undefined) {
                    // UI override exists for support: null means cleared (show '--'), string means show that tail
                    plannedSupport = uiOverride.support || '--';
                  }
                  return (
                    <div
                      key={engineer.id}
                      className={`flex border-b border-gray-300 h-8 ${idx % 2 === 0 ? 'bg-blue-50/30' : 'bg-blue-50/50'}`}
                    >
                      <div className="w-20 px-2 text-xs text-center border-r border-gray-300 truncate flex items-center justify-center">
                        {plannedCore}
                      </div>
                      <div className="w-20 px-2 text-xs text-center truncate flex items-center justify-center">
                        {plannedSupport}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Date Columns */}
            <div className="flex-1 overflow-hidden">
              {/* Date Header - scrolls horizontally with body */}
              <div
                ref={dateHeaderRef}
                className="border-b-2 border-gray-800 overflow-x-hidden"
              >
                {/* Row 1: Section header - spans full width of date columns */}
                <div className="flex">
                  <div
                    className="bg-gray-300 px-2 py-1 text-xs font-bold text-center text-gray-700 border-b border-gray-400"
                    style={{ minWidth: `${displayDates.length * 80}px` }}
                  >
                    Schedule ({displayDates.length > 0 ? `${formatDate(displayDates[0])} - ${formatDate(displayDates[displayDates.length - 1])}` : '--'})
                  </div>
                </div>
                {/* Row 2: Date columns */}
                <div className="flex">
                  {displayDates.map((date, idx) => {
                    const isSelected = date === selectedDate;
                    const isBaySelected = selectedBayDates.has(date);
                    return (
                      <div
                        key={date}
                        className={`
                          flex-shrink-0 w-20 px-1 py-1 text-xs font-bold text-center border-r border-gray-400
                          cursor-pointer transition-all relative select-none
                          ${isBaySelected
                            ? 'bg-blue-500 text-white ring-2 ring-blue-600 ring-inset z-10'
                            : isSelected
                              ? 'bg-blue-500 text-white ring-2 ring-blue-600 ring-inset z-10'
                              : idx === todayIndex
                                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }
                        `}
                        onClick={(e) => handleBayDateClick(date, e)}
                      >
                        {formatDate(date)}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Date Column Body */}
              <div
                ref={dateBodyRef}
                onScroll={handleDateBodyScroll}
                className="max-h-[500px] overflow-x-auto overflow-y-auto"
              >
                {uniqueEngineers.map((engineer, rowIdx) => (
                  <div
                    key={engineer.id}
                    className={`flex border-b border-gray-300 h-8 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    {displayDates.map((date) => {
                      // Determine what to display based on data source
                      let displayValue = '';
                      let isTail = false;

                      // Check for UI override first
                      const overrideKey = `${engineer.id}-${date}`;
                      const uiOverride = uiRosterOverrides.get(overrideKey);

                      // Use scenarioRosterData when a scenario is selected
                      if (scenarioRosterData.scenarioName && scenarioRosterData.byEmployeeDate.size > 0) {
                        const scenarioRow = scenarioRosterData.byEmployeeDate.get(`${engineer.id}-${date}`);

                        // First check if there's a UI override (from drag-and-drop)
                        if (uiOverride !== undefined) {
                          // Check for core override first, then support
                          if (uiOverride.core) {
                            // Override: show the new core tail
                            displayValue = uiOverride.core;
                            isTail = true;
                          } else if (uiOverride.support) {
                            // Override: show the new support tail
                            displayValue = uiOverride.support;
                            isTail = true;
                          } else {
                            // Override: cleared - show original roster code (task without tail)
                            displayValue = scenarioRow ? (scenarioRow.tail_num ? '' : scenarioRow.task) : '';
                            isTail = false;
                          }
                        } else if (scenarioRow) {
                          // No override - use original data
                          displayValue = scenarioRow.task;
                          isTail = scenarioRow.tail_num !== null;
                        }
                        // If no scenarioRow and no override, displayValue remains empty
                      } else {
                        // Fall back to original logic when no scenario selected
                        const assignment = getAssignmentForEngineerAndDate(engineer.id, date);
                        const rosterValue = rosterData.get(`${engineer.id}-${date}`);

                        if (assignment) {
                          displayValue = assignment.tailNumber;
                          isTail = true;
                        } else if (rosterValue) {
                          displayValue = rosterValue;
                          isTail = false;
                        }
                      }

                      // Check if this tail should be highlighted (selected or matching search)
                      const isHighlightedTail = isTail && displayValue && (
                        selectedTask === displayValue ||
                        searchResults.matchingTails.has(displayValue)
                      );

                      // Get cell colors using the same logic as Workforce Planning tab
                      // Override with yellow for highlighted tails
                      const cellColors = isHighlightedTail
                        ? { bg: 'bg-yellow-400', text: 'text-yellow-900' }
                        : isTail
                          ? CELL_COLORS.TAIL  // Green background for tail numbers
                          : getCellColors(displayValue);  // Standard roster code colors

                      const isSelectedDate = date === selectedDate;
                      const isBayDateSelected = selectedBayDates.has(date);

                      // Calculate expired training overlay opacity for this employee-date
                      const expiredTrainingOpacity = getExpiredTrainingOpacity(engineer.id, date);

                      // Get expired trainings tooltip for hover
                      const expiredTrainingsTooltip = expiredTrainingOpacity > 0 
                        ? getExpiredTrainingsTooltip(engineer.id, date)
                        : '';

                      return (
                        <div
                          key={date}
                          onClick={(e) => handleBayDateClick(date, e)}
                          className={`
                            flex-shrink-0 w-20 px-1 text-center border-r border-gray-300 relative flex items-center justify-center cursor-pointer
                            ${isBayDateSelected 
                              ? 'bg-blue-100/70 ring-1 ring-blue-400 ring-inset' 
                              : isSelectedDate 
                                ? 'bg-blue-100/70 ring-1 ring-blue-400 ring-inset' 
                                : ''
                            }
                          `}
                          title={expiredTrainingsTooltip || undefined}
                        >
                          {/* Expired training red overlay - translucent gradient that increases over time */}
                          {expiredTrainingOpacity > 0 && (
                            <div 
                              className="absolute inset-0 pointer-events-none z-[1]" 
                              style={{ backgroundColor: `rgba(220, 38, 38, ${expiredTrainingOpacity})` }}
                            />
                          )}
                          {/* Multi-selected column highlight band */}
                          {isBayDateSelected && (
                            <div className="absolute inset-0 bg-blue-500/20 pointer-events-none z-[2]"></div>
                          )}
                          {/* Selected column highlight band */}
                          {isSelectedDate && !isBayDateSelected && (
                            <div className="absolute inset-0 bg-blue-500/10 pointer-events-none z-[2]"></div>
                          )}
                          <div className="relative z-10">
                            {displayValue ? (
                              <div
                                onClick={(e) => isTail && handleTailClick(e, displayValue, date)}
                                className={`${cellColors.bg} ${cellColors.text} text-xs px-1.5 py-0.5 rounded truncate max-w-full font-medium ${isTail ? 'cursor-pointer hover:ring-2 hover:ring-yellow-500' : ''} ${isHighlightedTail ? 'ring-2 ring-yellow-600' : ''}`}
                                title={displayValue}
                              >
                                {displayValue}
                              </div>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
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

        <div className="p-3 border-t-2 border-gray-800">
          {/* Roster Code Legend */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-700">Roster Code Legend:</span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 ${CELL_COLORS.LEAVE_TRAINING.bg} rounded`}></div>
                <span className="font-medium">Leave/Training (AL, TR, SK)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 ${CELL_COLORS.OFF.bg} rounded`}></div>
                <span className="font-medium">Off (O, OFF)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 ${CELL_COLORS.DAY_OFF.bg} rounded`}></div>
                <span className="font-medium">Day Off (DO)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 ${CELL_COLORS.HOUSEKEEPING.bg} rounded`}></div>
                <span className="font-medium">Housekeeping/Movement</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 ${CELL_COLORS.SHIFT.bg} rounded`}></div>
                <span className="font-medium">Shift Codes (1, D, E, B1)</span>
              </div>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      <div className="bg-white border-2 border-gray-800 rounded mb-4">
        <div className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-2 border-gray-800 p-4">
          <h3 className="text-xl font-bold text-slate-800">Bay Occupancy Chart</h3>
          <p className="text-sm text-slate-500 mt-1">Bay allocations for aircraft visits</p>
        </div>

        {!selectedScenario ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-gray-600 mb-2">No Scenario Selected</h4>
            <p className="text-gray-500 text-center max-w-md">
              Select a scenario from the dropdown above to view the bay occupancy chart.
            </p>
          </div>
        ) : (
        <>
        {/* Flex-based layout matching Assignment & Roster Chart */}
        <div className="overflow-hidden">
          <div className="flex">
            {/* Helper/Spacer Column (FIRST) - aligns date columns with Assignment & Roster Chart */}
            {/* Width = ID (w-20 = 80px) + Employee (w-32 = 128px) + Team (w-16 = 64px) + Role (w-24 = 96px) + Core (w-20 = 80px) + Support (w-20 = 80px) - Bay (w-20 = 80px) = 448px */}
            {/* Single merged cell spanning header + body with centered text */}
            <div
              className="flex-shrink-0 border-r border-gray-400 bg-gray-50 flex items-center justify-center"
              style={{ width: '448px' }}
            >
              <div className="text-sm text-gray-400 italic text-center px-4">
                Select a tail number on a bay to view employee roster details
              </div>
            </div>

            {/* Bay Info Column (SECOND) - w-20 = 80px */}
            <div className="flex-shrink-0 border-r-2 border-gray-800">
              {/* Header */}
              <div className="bg-gray-200 border-b-2 border-gray-800">
                <div className="w-20 px-2 py-1 text-xs font-bold text-center text-gray-700 bg-gray-300">
                  Bay Info
                </div>
                <div className="w-20 px-2 py-1 text-xs font-bold text-center border-t border-gray-400">
                  Bay
                </div>
              </div>
              {/* Body - Fixed column */}
              <div className="max-h-[300px] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {filteredBays.map((bayNum, idx) => {
                  // Check if this bay has the selected/highlighted tail
                  const bayHasHighlightedTail = selectedTask && effectiveBayAllocations.some(
                    a => a.bayNumber === bayNum && a.aircraft.aircraft_reg === selectedTask
                  );
                  return (
                    <div
                      key={bayNum}
                      onClick={() => {
                        if (selectedBayDates.size > 0) {
                          setSelectedBayRowForHighlight(prev => prev === bayNum ? null : bayNum);
                        }
                      }}
                      className={`w-20 h-8 px-2 text-xs font-bold border-b border-gray-300 flex items-center justify-center cursor-pointer transition-colors ${
                        selectedBayRowForHighlight === bayNum && selectedBayDates.size > 0
                          ? 'text-green-900 ring-inset'
                          : bayHasHighlightedTail
                            ? 'bg-yellow-200 text-yellow-900'
                            : idx % 2 === 0 ? 'bg-gray-100 hover:bg-gray-200' : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      Bay {bayNum}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Date Columns */}
            <div className="flex-1 overflow-hidden">
              {/* Date Header - scrolls horizontally with body */}
              <div
                ref={bayHeaderRef}
                className="border-b-2 border-gray-800 overflow-x-hidden"
              >
                {/* Row 1: Section header */}
                <div className="flex">
                  <div
                    className="bg-gray-300 px-2 py-1 text-xs font-bold text-center text-gray-700 border-b border-gray-400"
                    style={{ minWidth: `${displayDates.length * 80}px` }}
                  >
                    Bay Occupancy ({displayDates.length > 0 ? `${formatDate(displayDates[0])} - ${formatDate(displayDates[displayDates.length - 1])}` : '--'})
                  </div>
                </div>
                {/* Row 2: Date columns */}
                <div className="flex">
                  {displayDates.map((date, idx) => {
                    const isBaySelected = selectedBayDates.has(date);
                    return (
                      <div
                        key={date}
                        className={`
                          flex-shrink-0 w-20 px-1 py-1 text-xs font-bold text-center border-r border-gray-400
                          cursor-pointer transition-all relative select-none
                          ${isBaySelected
                            ? 'bg-blue-500 text-white ring-2 ring-blue-600 ring-inset z-10'
                            : idx === todayIndex
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }
                        `}
                        onClick={(e) => handleBayDateClick(date, e)}
                      >
                        {formatDate(date)}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bay Body - scrolls horizontally */}
              <div
                ref={bayBodyRef}
                onScroll={handleBayBodyScroll}
                className="max-h-[300px] overflow-x-auto overflow-y-auto"
              >
                {filteredBays.map((bayNum, rowIdx) => {
                  // Check if this bay row has the selected/highlighted tail
                  const bayRowHasHighlightedTail = selectedTask && effectiveBayAllocations.some(
                    a => a.bayNumber === bayNum && a.aircraft.aircraft_reg === selectedTask
                  );

                  // Helper to check if this is the first cell in a continuous span
                  const isFirstInSpan = (idx: number, tail: string | null) => {
                    if (idx === 0) return true;
                    const prevAllocation = effectiveBayAllocations.find(
                      ba => ba.bayNumber === bayNum && ba.dates.includes(displayDates[idx - 1])
                    );
                    const prevTail = prevAllocation?.aircraft.aircraft_reg || null;
                    return prevTail !== tail;
                  };

                  // Helper to get the span length for continuous allocation
                  const getContinuousSpan = (startIdx: number, tail: string | null) => {
                    if (!tail) return 0;
                    let span = 1;
                    for (let i = startIdx + 1; i < displayDates.length; i++) {
                      const nextAllocation = effectiveBayAllocations.find(
                        ba => ba.bayNumber === bayNum && ba.dates.includes(displayDates[i])
                      );
                      const nextTail = nextAllocation?.aircraft.aircraft_reg || null;
                      if (nextTail === tail) {
                        span++;
                      } else {
                        break;
                      }
                    }
                    return span;
                  };

                  return (
                    <div
                      key={bayNum}
                      className={`flex border-b border-gray-300 h-8 ${
                        bayRowHasHighlightedTail
                          ? 'bg-yellow-100'
                          : rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      {displayDates.map((date, idx) => {
                        const allocation = effectiveBayAllocations.find(
                          ba => ba.bayNumber === bayNum && ba.dates.includes(date)
                        );
                        const tail = allocation?.aircraft.aircraft_reg || null;
                        const showLabel = isFirstInSpan(idx, tail);
                        const span = showLabel && tail ? getContinuousSpan(idx, tail) : 0;
                        // Check if this tail should be highlighted (selected or matching search)
                        const isHighlightedTail = tail && (
                          selectedTask === tail ||
                          searchResults.matchingTails.has(tail)
                        );

                        const isBayDateSelected = selectedBayDates.has(date);
                        
                        // Check if this cell should be highlighted green
                        const isBayColumnIntersection = selectedBayRowForHighlight === bayNum && selectedBayDates.has(date);
                        
                        // Check row-specific selection
                        const cellSelectionEdges = getCellSelectionEdges(bayNum, tail, date);
                        const isInRowSelection = cellSelectionEdges.isSelected;
                        
                        return (
                          <div
                            key={date}
                            onMouseDown={(e) => {
                              if (allocation) {
                                handleBayCellMouseDown(bayNum, tail, idx, date, e);
                              }
                            }}
                            onMouseEnter={() => {
                              if (isDraggingBaySelection && allocation) {
                                handleBayCellMouseEnter(bayNum, tail, idx, date);
                              }
                            }}
                            onMouseUp={() => {
                              handleBayCellMouseUp();
                              if (allocation) {
                                handleBayClick(bayNum, allocation.aircraft.aircraft_reg, date);
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDate(date);
                              
                              // Track if we'll have dates selected after this action
                              let willHaveDatesSelected = selectedBayDates.size > 0;
                              
                              if (!selectedBayDates.has(date)) {
                                const newSelected = new Set(selectedBayDates);
                                newSelected.add(date);
                                setSelectedBayDates(newSelected);
                                setLastClickedBayDate(date);
                                willHaveDatesSelected = true; // We just added a date
                              }
                              
                              // Only toggle row highlight if we have dates selected AND there's an allocation
                              if (willHaveDatesSelected && allocation) {
                                setSelectedBayRowForHighlight(prev => prev === bayNum ? null : bayNum);
                              }
                            }}
                            className={`
                              flex-shrink-0 w-20 px-1 text-center border-r border-gray-300 relative flex items-center justify-center cursor-pointer select-none
                              ${isBayColumnIntersection
                                ? 'bg-green-400 hover:bg-green-500 ring-2 ring-green-600 ring-inset'
                                : allocation
                                  ? isHighlightedTail
                                    ? 'bg-yellow-400 hover:bg-yellow-500 ring-2 ring-yellow-600 ring-inset'
                                    : 'bg-blue-500 hover:bg-blue-600'
                                  : isBayDateSelected 
                                    ? 'bg-blue-100/70' 
                                    : ''
                              }
                            `}
                          >
                            {/* Row-specific multi-day selection highlight with green dashed border */}
                            {isInRowSelection && (
                              <div 
                                className="absolute inset-0 pointer-events-none z-20"
                                style={{
                                  borderTop: '3px dashed #22c55e',
                                  borderBottom: '3px dashed #22c55e',
                                  borderLeft: cellSelectionEdges.isFirst ? '3px dashed #22c55e' : 'none',
                                  borderRight: cellSelectionEdges.isLast ? '3px dashed #22c55e' : 'none',
                                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                                }}
                              />
                            )}
                            {/* Multi-selected column highlight */}
                            {isBayDateSelected && !allocation && !isInRowSelection && (
                              <div className="absolute inset-0 bg-blue-500/20 pointer-events-none"></div>
                            )}
                            {/* Planning date highlight */}
                            {idx === todayIndex && (
                              <div className="absolute inset-0 border-l-4 border-amber-500 pointer-events-none"></div>
                            )}
                            {/* Tail number label spanning multiple cells */}
                            {showLabel && allocation && (
                              <div
                                className={`absolute top-0 left-0 h-full flex items-center justify-center text-[10px] font-bold pointer-events-none z-10 truncate px-1 ${isBayColumnIntersection ? 'text-green-900' : isHighlightedTail ? 'text-yellow-900' : isBayDateSelected ? 'text-blue-900' : 'text-white'}`}
                                style={{ width: `${span * 80}px` }}
                              >
                                {allocation.aircraft.aircraft_reg}
                              </div>
                            )}
                            {/* Empty cell indicator */}
                            {!allocation && (
                              <span className="text-gray-300 text-xs">-</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 flex gap-6 text-sm border-t-2 border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span className="font-medium">Scheduled Aircraft</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-400 ring-2 ring-yellow-600 rounded"></div>
            <span className="font-medium">Selected/Highlighted Tail</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-amber-100 border-l-4 border-amber-500 rounded"></div>
            <span className="font-medium">Planning Date</span>
          </div>
        </div>
        </>
        )}
      </div>

      {/* Shared Employee Detail Drawer - Centered Modal */}
      <EmployeeDetailDrawer
        isOpen={showEmployeeDrawer}
        onClose={() => setShowEmployeeDrawer(false)}
        employee={selectedEmployeeForDrawer}
        selectedDate={selectedDate || displayDates[0] || ''}
      />
    </div>
  );
}
