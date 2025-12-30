import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Save, Calendar, X, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';

// AI Allocation API configuration
const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:8000';

interface AircraftSchedule {
  id: string;
  visit_id: string;
  aircraft_reg: string;
  customer: string;
  fleet: string;
  check_type: string;
  induct_date: string;
  ets_date: string;
  min_engineers: number;
  min_technicians: number;
  status_category: 'Ongoing' | 'Upcoming' | 'Completed';
  is_from_db: boolean;
  lic_req?: string; // License authority only (e.g., "GCAA", "EASA", "FAA")
  full_lic_req?: string; // Full license requirement for API allocation (e.g., "A320-CFM56-GCAA")
}

interface AdditionalAircraft {
  id: string;
  aircraft_engine_license: string;
  tail_number: string;
  customer: string;
  fleet: string;
  check_type: string;
  lic_req: string; // License requirement (e.g., "A320-CFM56-GCAA") - required for allocation
  min_engineers: number;
  min_technicians: number;
  induct_date: string;
  ets_date: string;
  display_order: number;
}

interface MapKeyOption {
  map_key: string;
  aircraft: string;
  engine: string;
  lic_req: string;
}

interface DaywisePlan {
  [date: string]: {
    CC: number;
    ENGR: number;
    TECH: number;
  };
}

interface CapacityWarning {
  date: string;
  required: number;
  available: number;
  shortfall: number;
  affectedAircraft: string[];
}

interface SavedScenario {
  id: string;
  scenario_name: string;
  created_at: string;
  status: string;
  source: 'ai' | 'legacy';
}

export function PlanningScenarioBuilder() {
  const [scenarioName, setScenarioName] = useState('');
  const [aircraftSchedules, setAircraftSchedules] = useState<AircraftSchedule[]>([]);
  const [additionalAircraft, setAdditionalAircraft] = useState<AdditionalAircraft[]>([]);
  const [mapKeyOptions, setMapKeyOptions] = useState<MapKeyOption[]>([]);
  const [daywisePlans, setDaywisePlans] = useState<Record<string, DaywisePlan>>({});
  const [showDaywiseModal, setShowDaywiseModal] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState<AircraftSchedule | null>(null);
  const [currentDaywisePlan, setCurrentDaywisePlan] = useState<DaywisePlan>({});
  const [capacityWarnings, setCapacityWarnings] = useState<CapacityWarning[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState('');
  
  // New state for scenario management
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('new');
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    loadSavedScenarios();
    loadVisitPlanningData();
  }, []);

  // Load scenario data when selection changes
  useEffect(() => {
    if (selectedScenarioId && selectedScenarioId !== 'new') {
      loadScenarioFromDb(selectedScenarioId);
    } else if (selectedScenarioId === 'new') {
      // Reset to default/sample data for new scenario
      setScenarioName('');
      loadVisitPlanningData();
    }
  }, [selectedScenarioId]);

  // Track unsaved changes
  useEffect(() => {
    if (selectedScenarioId !== 'new') {
      setHasUnsavedChanges(true);
    }
  }, [aircraftSchedules, additionalAircraft, daywisePlans]);

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

    const allScenarios: SavedScenario[] = [];

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

  async function loadScenarioFromDb(scenarioId: string) {
    setIsLoading(true);
    try {
      // Check if it's a legacy scenario
      if (scenarioId.startsWith('legacy_')) {
        const actualId = scenarioId.replace('legacy_', '');
        const { data: legacyScenario } = await supabase
          .from('planning_scenarios')
          .select('*')
          .eq('id', actualId)
          .single();

        if (legacyScenario) {
          setScenarioName(legacyScenario.name);
          
          // Legacy scenarios store data differently - extract what we can
          const legacySchedules = legacyScenario.aircraft_schedules || [];
          const loadedSchedules: AircraftSchedule[] = legacySchedules.map((s: any, idx: number) => ({
            id: `legacy-${idx}-${Date.now()}`,
            visit_id: s.visit_id || '',
            aircraft_reg: s.tailNumber || s.aircraft_reg || '',
            customer: s.customer || '',
            fleet: s.fleet || '',
            check_type: s.checkType || s.check_type || '',
            induct_date: s.startDate || s.induct_date || '',
            ets_date: s.endDate || s.ets_date || '',
            min_engineers: s.minEngineers || s.min_engineers || s.min_eng_team_size || 0,
            min_technicians: s.min_technicians || 0,
            status_category: s.status_category || (s.is_ongoing ? 'Ongoing' : 'Upcoming'),
            is_from_db: false,
            lic_req: s.lic_req || undefined,
          }));
          setAircraftSchedules(loadedSchedules);

          // Load additional aircraft if available
          const additional = legacyScenario.additional_aircraft || [];
          const loadedAdditional: AdditionalAircraft[] = additional.map((a: any, idx: number) => ({
            id: `additional-${idx}-${Date.now()}`,
            aircraft_engine_license: a.aircraft_engine_license || '',
            tail_number: a.tail_number || '',
            customer: a.customer || '',
            fleet: a.fleet || '',
            check_type: a.check_type || '',
            lic_req: a.lic_req || a.aircraft_engine_license || '', // Load lic_req or fallback to aircraft_engine_license
            min_engineers: a.min_engineers || 2,
            min_technicians: a.min_technicians || 0,
            induct_date: a.induct_date || '',
            ets_date: a.ets_date || '',
            display_order: a.display_order || idx,
          }));
          setAdditionalAircraft(loadedAdditional);

          // Load daywise plans if available
          setDaywisePlans(legacyScenario.daywise_plans || {});
          
          setHasUnsavedChanges(false);
        }
      } else {
        // AI allocation scenario
        const { data: scenario } = await supabase
          .from('ai_allocation_scenarios_v2')
          .select('*')
          .eq('id', scenarioId)
          .single();

        if (scenario) {
          setScenarioName(scenario.scenario_name);
          
          // Load aircraft schedules from JSON
          const schedules = scenario.aircraft_schedules || [];
          const loadedSchedules: AircraftSchedule[] = schedules.map((s: any, idx: number) => ({
            id: `loaded-${idx}-${Date.now()}`,
            visit_id: s.visit_id || '',
            aircraft_reg: s.aircraft_reg || '',
            customer: s.customer || '',
            fleet: s.fleet || '',
            check_type: s.check_type || '',
            induct_date: s.induct_date || '',
            ets_date: s.ets_date || '',
            min_engineers: s.min_engineers || s.min_eng_team_size || 0,
            min_technicians: s.min_technicians || 0,
            status_category: s.status_category || (s.is_ongoing ? 'Ongoing' : 'Upcoming'),
            is_from_db: false,
            lic_req: s.lic_req || undefined,
          }));
          setAircraftSchedules(loadedSchedules);

          // Load additional aircraft from JSON
          const additional = scenario.additional_aircraft || [];
          const loadedAdditional: AdditionalAircraft[] = additional.map((a: any, idx: number) => ({
            id: `additional-${idx}-${Date.now()}`,
            aircraft_engine_license: a.aircraft_engine_license || '',
            tail_number: a.tail_number || '',
            customer: a.customer || '',
            fleet: a.fleet || '',
            check_type: a.check_type || '',
            lic_req: a.lic_req || a.aircraft_engine_license || '', // Load lic_req or fallback to aircraft_engine_license
            min_engineers: a.min_engineers || 2,
            min_technicians: a.min_technicians || 0,
            induct_date: a.induct_date || '',
            ets_date: a.ets_date || '',
            display_order: a.display_order || idx,
          }));
          setAdditionalAircraft(loadedAdditional);

          // Load daywise plans
          setDaywisePlans(scenario.daywise_plans || {});
          
          setHasUnsavedChanges(false);
        }
      }
    } catch (error) {
      console.error('Error loading scenario:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveScenarioToDb() {
    if (!scenarioName.trim()) {
      alert('Please enter a scenario name');
        return;
      }

    setIsLoading(true);
    try {
      const aircraftSchedulesJson = aircraftSchedules.map(schedule => ({
        visit_id: schedule.visit_id,
        aircraft_reg: schedule.aircraft_reg,
        customer: schedule.customer,
        fleet: schedule.fleet,
        check_type: schedule.check_type,
        induct_date: schedule.induct_date,
        ets_date: schedule.ets_date,
        min_engineers: schedule.min_engineers,
        min_technicians: schedule.min_technicians,
        status_category: schedule.status_category,
        is_from_db: schedule.is_from_db,
        lic_req: schedule.lic_req,
      }));

      const additionalAircraftJson = additionalAircraft.map(aircraft => ({
        aircraft_engine_license: aircraft.aircraft_engine_license,
        tail_number: aircraft.tail_number,
        customer: aircraft.customer,
        fleet: aircraft.fleet,
        check_type: aircraft.check_type,
        lic_req: aircraft.lic_req, // License requirement for allocation
        min_engineers: aircraft.min_engineers,
        min_technicians: aircraft.min_technicians,
        induct_date: aircraft.induct_date,
        ets_date: aircraft.ets_date,
        display_order: aircraft.display_order,
      }));

      // Check if scenario with same name exists
      const { data: existingScenario } = await supabase
        .from('ai_allocation_scenarios_v2')
        .select('id')
        .eq('scenario_name', scenarioName)
        .single();

      if (existingScenario) {
        // Update existing
        await supabase
          .from('ai_allocation_scenarios_v2')
          .update({
            aircraft_schedules: aircraftSchedulesJson,
            additional_aircraft: additionalAircraftJson,
            daywise_plans: daywisePlans,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingScenario.id);

        setSelectedScenarioId(existingScenario.id);
      } else {
        // Insert new
        const { data: newScenario } = await supabase
          .from('ai_allocation_scenarios_v2')
          .insert({
            scenario_name: scenarioName,
            status: 'draft',
            aircraft_schedules: aircraftSchedulesJson,
            additional_aircraft: additionalAircraftJson,
            daywise_plans: daywisePlans,
          })
          .select()
          .single();

        if (newScenario) {
          setSelectedScenarioId(newScenario.id);
        }
      }

      setHasUnsavedChanges(false);
      await loadSavedScenarios();
      alert('Scenario saved successfully!');
    } catch (error: any) {
      console.error('Error saving scenario:', error);
      alert(`Failed to save scenario: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  function handleScenarioChange(scenarioId: string) {
    if (hasUnsavedChanges && selectedScenarioId !== 'new') {
      if (!confirm('You have unsaved changes. Do you want to discard them?')) {
        return;
      }
    }
    setSelectedScenarioId(scenarioId);
    setHasUnsavedChanges(false);
  }

  async function deleteScenario() {
    if (selectedScenarioId === 'new') {
      alert('No scenario selected to delete');
      return;
    }

    const scenarioToDelete = savedScenarios.find(s => s.id === selectedScenarioId);
    if (!scenarioToDelete) {
      alert('Scenario not found');
      return;
    }

    if (!confirm(`Are you sure you want to delete the scenario "${scenarioToDelete.scenario_name}"?\n\nThis action cannot be undone.`)) {
      return;
    }

    setIsLoading(true);
    try {
      // Handle deletion based on source
      if (scenarioToDelete.source === 'legacy') {
        const actualId = selectedScenarioId.replace('legacy_', '');
        const { error } = await supabase
          .from('planning_scenarios')
          .delete()
          .eq('id', actualId);

        if (error) {
          throw error;
        }
        } else {
        const { error } = await supabase
          .from('ai_allocation_scenarios_v2')
          .delete()
          .eq('id', selectedScenarioId);

        if (error) {
          throw error;
        }
      }

      // Reset to new scenario and reload list
      setSelectedScenarioId('new');
      setScenarioName('');
      setHasUnsavedChanges(false);
      await loadSavedScenarios();
      loadVisitPlanningData(); // Reload default data
      
      alert(`Scenario "${scenarioToDelete.scenario_name}" deleted successfully`);
    } catch (error: any) {
      console.error('Error deleting scenario:', error);
      alert(`Failed to delete scenario: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (aircraftSchedules.length > 0) {
      runCapacityCheck(aircraftSchedules);
    }
  }, [aircraftSchedules, additionalAircraft]);

  // Load data from visit_planning_combined view
  async function loadVisitPlanningData() {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('visit_planning_combined')
        .select('*')
        .order('induction_date', { ascending: true });

      if (error) {
        console.error('Error loading visit planning data:', error);
        return;
      }

      if (!data || data.length === 0) {
        console.log('No visit planning data found');
        setIsLoading(false);
        return;
      }

      // Convert to AircraftSchedule format and segregate by status
      const schedules: AircraftSchedule[] = data.map((visit: any) => {
        // Build lic_req from aircraft-engine-lic_req if available
        const licReq = (visit.aircraft && visit.engine && visit.lic_req) 
          ? `${visit.aircraft}-${visit.engine}-${visit.lic_req}` 
          : undefined;
        return {
          id: `visit-${visit.visit_id}`,
          visit_id: visit.visit_id,
          aircraft_reg: visit.tail_num || '',
          customer: visit.customer || '',
          fleet: visit.aircraft || '',
          check_type: visit.check_type || '',
          induct_date: visit.induction_date || '',
          ets_date: visit.ets_date || '',
          min_engineers: visit.min_engineers || 0,
          min_technicians: visit.min_technicians || 0,
          status_category: visit.status as 'Ongoing' | 'Upcoming' | 'Completed',
          is_from_db: true,
          lic_req: licReq, // Include license requirement for allocation
        };
      });

      console.log('=== LOADED VISIT PLANNING DATA ===');
      console.log('📊 Total schedules loaded:', schedules.length);
      console.log('📊 Schedules by status:',{
        ongoing: schedules.filter(s => s.status_category === 'Ongoing').length,
        upcoming: schedules.filter(s => s.status_category === 'Upcoming').length,
        completed: schedules.filter(s => s.status_category === 'Completed').length
      });
      console.log('📊 All loaded schedules:', schedules.map(s => ({
        aircraft_reg: s.aircraft_reg,
        status: s.status_category,
        induct_date: s.induct_date,
        ets_date: s.ets_date,
        is_from_db: s.is_from_db,
        lic_req: s.lic_req
      })));

      setAircraftSchedules(schedules);

      // Extract unique map_key options (aircraft-engine-lic combinations)
      const mapKeys = new Map<string, MapKeyOption>();
      data.forEach((visit: any) => {
        if (visit.aircraft && visit.engine && visit.lic_req) {
          const mapKey = `${visit.aircraft}-${visit.engine}-${visit.lic_req}`;
          if (!mapKeys.has(mapKey)) {
            mapKeys.set(mapKey, {
              map_key: mapKey,
              aircraft: visit.aircraft,
              engine: visit.engine,
              lic_req: visit.lic_req,
            });
          }
        }
      });
      setMapKeyOptions(Array.from(mapKeys.values()));

    } catch (err) {
      console.error('Exception loading visit planning data:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function generateFutureAircraft(): AircraftSchedule[] {
    return [
      {
        id: 'future-1',
        visit_id: '',
        aircraft_reg: 'VH-OQC',
        customer: 'Qantas',
        fleet: 'A380',
        check_type: '7 Days Check',
        induct_date: '2025-05-04',
        ets_date: '2025-05-11',
        min_engineers: 3,
        min_technicians: 2,
        status_category: 'Upcoming',
        is_from_db: false,
      },
      {
        id: 'future-2',
        visit_id: '',
        aircraft_reg: 'VH-OQL',
        customer: 'Qantas',
        fleet: 'A380',
        check_type: 'Periodic Check',
        induct_date: '2025-05-06',
        ets_date: '2025-05-13',
        min_engineers: 2,
        min_technicians: 1,
        status_category: 'Upcoming',
        is_from_db: false,
      },
      {
        id: 'future-3',
        visit_id: '',
        aircraft_reg: 'G-ZBKK',
        customer: 'British Airways',
        fleet: 'B787',
        check_type: 'C Check',
        induct_date: '2025-05-08',
        ets_date: '2025-05-22',
        min_engineers: 4,
        min_technicians: 3,
        status_category: 'Upcoming',
        is_from_db: false,
      },
      {
        id: 'future-4',
        visit_id: '',
        aircraft_reg: 'F-GZNQ',
        customer: 'Air France',
        fleet: 'B777',
        check_type: 'HSC Check',
        induct_date: '2025-05-10',
        ets_date: '2025-05-24',
        min_engineers: 3,
        min_technicians: 2,
        status_category: 'Upcoming',
        is_from_db: false,
      },
      {
        id: 'future-5',
        visit_id: '',
        aircraft_reg: 'A6-APD',
        customer: 'Etihad Airways',
        fleet: 'A380',
        check_type: '12 Year Check',
        induct_date: '2025-05-15',
        ets_date: '2025-06-10',
        min_engineers: 5,
        min_technicians: 4,
        status_category: 'Upcoming',
        is_from_db: false,
      },
    ];
  }

  function loadSampleFutureData() {
    setAircraftSchedules(generateFutureAircraft());
  }

  function runCapacityCheck(schedules: AircraftSchedule[]) {
    const dateToAircraft = new Map<string, Set<string>>();
    const dateToRequired = new Map<string, number>();

    // Include both main schedules and additional aircraft
    const allSchedules = [
      ...schedules,
      ...additionalAircraft.map(a => ({
        aircraft_reg: a.aircraft_engine_license,
        induct_date: a.induct_date,
        ets_date: a.ets_date,
        min_engineers: a.min_engineers,
      }))
    ];

    allSchedules.forEach(aircraft => {
      if (!aircraft.induct_date || !aircraft.ets_date) {
        return;
      }

      const start = new Date(aircraft.induct_date);
      const end = new Date(aircraft.ets_date);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];

        if (!dateToAircraft.has(dateStr)) {
          dateToAircraft.set(dateStr, new Set());
          dateToRequired.set(dateStr, 0);
        }

        dateToAircraft.get(dateStr)!.add(aircraft.aircraft_reg);
        dateToRequired.set(dateStr, (dateToRequired.get(dateStr) || 0) + aircraft.min_engineers);
      }
    });

    // Assume a pool of 50 engineers for capacity check
    const totalAvailableENGR = 50;
    const warnings: CapacityWarning[] = [];

    dateToRequired.forEach((required, date) => {
      if (required > totalAvailableENGR) {
        warnings.push({
          date,
          required,
          available: totalAvailableENGR,
          shortfall: required - totalAvailableENGR,
          affectedAircraft: Array.from(dateToAircraft.get(date) || []),
        });
      }
    });

    warnings.sort((a, b) => a.date.localeCompare(b.date));
    setCapacityWarnings(warnings.slice(0, 5));
  }

  const addAircraftRow = () => {
    const newRow: AircraftSchedule = {
      id: Date.now().toString(),
      visit_id: '',
      aircraft_reg: '',
      customer: '',
      fleet: '',
      check_type: '',
      induct_date: '',
      ets_date: '',
      min_engineers: 0,
      min_technicians: 0,
      status_category: 'Upcoming',
      is_from_db: false,
    };
    setAircraftSchedules([...aircraftSchedules, newRow]);
    setHasUnsavedChanges(true);
  };

  const deleteAircraftRow = (id: string) => {
    setAircraftSchedules(aircraftSchedules.filter(a => a.id !== id));
    setHasUnsavedChanges(true);
  };

  const updateAircraftRow = (id: string, field: keyof AircraftSchedule, value: string | number | boolean) => {
    setAircraftSchedules(aircraftSchedules.map(a =>
      a.id === id ? { ...a, [field]: value } : a
    ));
    setHasUnsavedChanges(true);
  };

  const openDaywisePlanModal = (aircraft: AircraftSchedule) => {
    setSelectedAircraft(aircraft);

    const existingPlan = daywisePlans[aircraft.id];
    if (existingPlan) {
      setCurrentDaywisePlan(existingPlan);
    } else {
      const plan: DaywisePlan = {};
      if (aircraft.induct_date && aircraft.ets_date) {
      const start = new Date(aircraft.induct_date);
      const end = new Date(aircraft.ets_date);

        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        plan[dateStr] = { CC: 0, ENGR: 0, TECH: 0 };
      }
        }
      }
      setCurrentDaywisePlan(plan);
    }

    setShowDaywiseModal(true);
  };

  const saveDaywisePlan = () => {
    if (selectedAircraft) {
      setDaywisePlans({
        ...daywisePlans,
        [selectedAircraft.id]: currentDaywisePlan,
      });
      setHasUnsavedChanges(true);
    }
    setShowDaywiseModal(false);
    setSelectedAircraft(null);
  };

  const updateDaywisePlanCell = (date: string, role: 'CC' | 'ENGR' | 'TECH', value: number) => {
    setCurrentDaywisePlan({
      ...currentDaywisePlan,
      [date]: {
        ...currentDaywisePlan[date],
        [role]: Math.max(0, value),
      },
    });
  };

  const addAdditionalAircraft = () => {
    const newAircraft: AdditionalAircraft = {
      id: Date.now().toString(),
      aircraft_engine_license: '',
      tail_number: '',
      customer: '',
      fleet: '',
      check_type: '',
      lic_req: '', // License requirement for engineer allocation
      min_engineers: 2,
      min_technicians: 0,
      induct_date: '',
      ets_date: '',
      display_order: additionalAircraft.length,
    };
    setAdditionalAircraft([...additionalAircraft, newAircraft]);
    setHasUnsavedChanges(true);
  };

  const deleteAdditionalAircraft = (id: string) => {
    setAdditionalAircraft(additionalAircraft.filter(a => a.id !== id));
    setHasUnsavedChanges(true);
  };

  const updateAdditionalAircraft = (id: string, field: keyof AdditionalAircraft, value: string | number) => {
    setAdditionalAircraft(additionalAircraft.map(a =>
      a.id === id ? { ...a, [field]: value } : a
    ));
    setHasUnsavedChanges(true);
  };

  // Handle Aircraft-Engine-License selection and auto-populate related fields
  const handleAircraftEngineLicenseChange = (id: string, licenseValue: string) => {
    // Find the selected option to get aircraft details
    const selectedOption = mapKeyOptions.find(opt => opt.map_key === licenseValue);
    
    // Extract just the license part (e.g., "GCAA" from "A350-RRTRENTXWB-GCAA")
    // The lic_req in MapKeyOption is already just the license authority
    const licenseOnly = selectedOption?.lic_req || (licenseValue ? licenseValue.split('-').pop() : '');
    
    setAdditionalAircraft(additionalAircraft.map(a => {
      if (a.id === id) {
        return {
          ...a,
          aircraft_engine_license: licenseValue,
          // Auto-populate fleet from the aircraft field
          fleet: selectedOption?.aircraft || a.fleet,
          // Auto-populate lic_req with just the license authority (e.g., "GCAA")
          lic_req: licenseOnly || '',
        };
      }
      return a;
    }));
    setHasUnsavedChanges(true);
  };

  // Combine additional aircraft into main table based on ETS dates
  const combinedSchedules = useMemo(() => {
    // Add additional aircraft as temporary entries for display
    // Include if they have either aircraft_engine_license OR tail_number, plus dates
    const additionalAsSchedules: AircraftSchedule[] = additionalAircraft
      .filter(a => (a.aircraft_engine_license || a.tail_number) && a.induct_date && a.ets_date)
      .map(a => {
        // Use tail_number as aircraft_reg if provided, otherwise use aircraft_engine_license
        const aircraftIdentifier = a.tail_number || a.aircraft_engine_license;
        // Use fleet from user input, or derive from aircraft_engine_license if not provided
        const fleetValue = a.fleet || (a.aircraft_engine_license ? a.aircraft_engine_license.split('-')[0] : '');
        return {
          id: `additional-${a.id}`,
          visit_id: '',
          aircraft_reg: aircraftIdentifier,
          customer: a.customer || 'Scenario Planning',
          fleet: fleetValue,
          check_type: a.check_type || 'Scenario',
          induct_date: a.induct_date,
          ets_date: a.ets_date,
          min_engineers: a.min_engineers,
          min_technicians: a.min_technicians,
          status_category: 'Upcoming' as const,
          is_from_db: false,
          lic_req: a.lic_req || a.aircraft_engine_license || undefined, // Use lic_req field for allocation
        };
      });

    return [...aircraftSchedules, ...additionalAsSchedules];
  }, [aircraftSchedules, additionalAircraft]);

  const buildScenario = async () => {
    if (!scenarioName.trim()) {
      alert('Please enter a scenario name');
      return;
    }

    setIsBuilding(true);
    setBuildProgress('Preparing scenario data...');

    try {
      // Step 1: Only process additional aircraft added by the user (NOT from database)
      // Convert additionalAircraft to the schedule format for processing
      const additionalSchedules = additionalAircraft
        .filter(a => (a.aircraft_engine_license || a.tail_number) && a.induct_date && a.ets_date)
        .map(a => {
          const aircraftIdentifier = a.tail_number || a.aircraft_engine_license;
          const fleetValue = a.fleet || (a.aircraft_engine_license ? a.aircraft_engine_license.split('-')[0] : '');
          return {
            id: `additional-${a.id}`,
            visit_id: '',
            aircraft_reg: aircraftIdentifier,
            customer: a.customer || 'Scenario Planning',
            fleet: fleetValue,
            check_type: a.check_type || 'Scenario',
            induct_date: a.induct_date,
            ets_date: a.ets_date,
            min_engineers: a.min_engineers,
            min_technicians: a.min_technicians,
            status_category: 'Upcoming' as const,
            is_from_db: false,
            lic_req: a.lic_req || '', // License authority only (e.g., "GCAA")
            full_lic_req: a.aircraft_engine_license || undefined, // Full string for allocation (e.g., "A350-RRTRENTXWB-GCAA")
          };
        });

      const validSchedules = additionalSchedules.filter(s => {
        if (!s.aircraft_reg) return false;
        if (!s.induct_date || !s.ets_date) return false;
        return true;
      });

      // Check if we have any requirements to process (new flights, ongoing tasks, or upcoming tasks)
      const baselineTasksCount = aircraftSchedules.filter(s =>
        s.is_from_db && (s.status_category === 'Ongoing' || s.status_category === 'Upcoming') && s.induct_date && s.ets_date
      ).length;

      if (validSchedules.length === 0 && baselineTasksCount === 0) {
        alert('No flights to process for this scenario.\n\nPlease add new flights in the "Add New Flights for Scenario" section, or ensure there are ongoing/upcoming tasks in the baseline to create a scenario with allocations.');
        setIsBuilding(false);
        return;
      }

      // Check if any flights are missing Aircraft-Engine-License (required for allocation)
      const flightsWithoutLicense = validSchedules.filter(s => !s.full_lic_req);
      if (flightsWithoutLicense.length > 0) {
        const proceed = window.confirm(
          `⚠️ ${flightsWithoutLicense.length} flight(s) do not have an Aircraft-Engine-License:\n\n` +
          flightsWithoutLicense.map(s => `• ${s.aircraft_reg}`).join('\n') +
          `\n\nWithout a valid Aircraft-Engine-License (e.g., A350-RRTRENTXWB-GCAA), the system cannot find eligible engineers.\n\n` +
          `Please select an Aircraft-Engine-License from the dropdown.\n\n` +
          `Do you want to continue anyway? (Engineers will likely not be allocated for these flights)`
        );
        if (!proceed) {
          setIsBuilding(false);
          return;
        }
      }

      // Step 2: Prepare the input data for storage
      // Include both ongoing AND upcoming tasks from baseline and new flights
      const baselineTasksForStorage = aircraftSchedules
        .filter(schedule => schedule.is_from_db && (schedule.status_category === 'Ongoing' || schedule.status_category === 'Upcoming'))
        .map(schedule => ({
          visit_id: schedule.visit_id,
          aircraft_reg: schedule.aircraft_reg,
          customer: schedule.customer,
          fleet: schedule.fleet,
          check_type: schedule.check_type,
          induct_date: schedule.induct_date,
          ets_date: schedule.ets_date,
          min_engineers: schedule.min_engineers,
          min_technicians: schedule.min_technicians,
          status_category: schedule.status_category,
          is_from_db: schedule.is_from_db,
          lic_req: schedule.lic_req,
        }));

      const newFlightsForStorage = validSchedules.map(schedule => ({
        visit_id: schedule.visit_id,
        aircraft_reg: schedule.aircraft_reg,
        customer: schedule.customer,
        fleet: schedule.fleet,
        check_type: schedule.check_type,
        induct_date: schedule.induct_date,
        ets_date: schedule.ets_date,
        min_engineers: schedule.min_engineers,
        min_technicians: schedule.min_technicians,
        status_category: schedule.status_category,
        is_from_db: schedule.is_from_db,
        lic_req: schedule.lic_req,
      }));

      const aircraftSchedulesJson = [...baselineTasksForStorage, ...newFlightsForStorage];

      const additionalAircraftJson = additionalAircraft.map(aircraft => ({
        aircraft_engine_license: aircraft.aircraft_engine_license,
        tail_number: aircraft.tail_number,
        customer: aircraft.customer,
        fleet: aircraft.fleet,
        check_type: aircraft.check_type,
        lic_req: aircraft.lic_req, // License requirement for allocation
        min_engineers: aircraft.min_engineers,
        min_technicians: aircraft.min_technicians,
        induct_date: aircraft.induct_date,
        ets_date: aircraft.ets_date,
        display_order: aircraft.display_order,
      }));

      // Step 3: Prepare API request payload
      // First, include ongoing AND upcoming tasks from baseline (visible on UI) as requirements for allocation
      // These tasks from the database baseline should get allocation recommendations from the AI model
      // IMPORTANT: For AI allocation, use TODAY's date as start_date (not induction date) and ETS as end_date
      // This ensures we allocate resources from today onwards, not from when the aircraft originally arrived

      console.log('=== STEP 3: PREPARING BASELINE TASKS FOR ALLOCATION ===');
      console.log('Total aircraftSchedules:', aircraftSchedules.length);
      console.log('All aircraftSchedules:', aircraftSchedules.map(s => ({
        aircraft_reg: s.aircraft_reg,
        is_from_db: s.is_from_db,
        status_category: s.status_category,
        induct_date: s.induct_date,
        ets_date: s.ets_date,
        lic_req: s.lic_req
      })));

      // Today's date for allocation planning (April 30, 2022)
      const todayDate = '2022-04-30';
      const todayDateObj = new Date(todayDate);

      const baselineTasksForAllocation = aircraftSchedules
        .filter(schedule => {
          // Include BOTH ongoing AND upcoming tasks from database (baseline)
          if (!schedule.is_from_db) {
            console.log(`❌ Skipping ${schedule.aircraft_reg}: not from DB (is_from_db=${schedule.is_from_db})`);
            return false;
          }
          // Include both Ongoing and Upcoming tasks
          if (schedule.status_category !== 'Ongoing' && schedule.status_category !== 'Upcoming') {
            console.log(`❌ Skipping ${schedule.aircraft_reg}: status is ${schedule.status_category}, not Ongoing or Upcoming`);
            return false;
          }
          if (!schedule.induct_date || !schedule.ets_date) {
            console.log(`❌ Skipping ${schedule.aircraft_reg}: missing dates (induct=${schedule.induct_date}, ets=${schedule.ets_date})`);
            return false;
          }
          // Filter out visits where ETS date is before today's date (already completed)
          const etsDateObj = new Date(schedule.ets_date);
          if (etsDateObj < todayDateObj) {
            console.log(`❌ Skipping ${schedule.aircraft_reg}: ETS date ${schedule.ets_date} is before today ${todayDate}`);
            return false;
          }
          console.log(`✅ Including ${schedule.aircraft_reg}: status=${schedule.status_category}, is_from_db=${schedule.is_from_db}`);
          return true;
        })
        .map(schedule => {
          // For allocation, use TODAY's date as start_date for ongoing tasks (where induct_date <= today)
          // For upcoming tasks (where induct_date > today), use the original induct_date
          const inductDateObj = new Date(schedule.induct_date);
          const effectiveStartDate = inductDateObj <= todayDateObj ? todayDate : schedule.induct_date;

          const visitData = {
            tail_num: schedule.aircraft_reg,
            start_date: effectiveStartDate,  // Use today's date for ongoing, induct_date for upcoming
            end_date: schedule.ets_date,
            num_engineers: schedule.min_engineers || 1, // Ensure at least 1 engineer
            num_technicians: schedule.min_technicians || 0,
            aircraft_size: getAircraftSize(schedule.fleet),
            // lic_req for baseline tasks is already in full format (aircraft-engine-license) from loadVisitPlanningData
            lic_req: schedule.lic_req || undefined,
          };
          console.log(`📋 Mapped baseline task (${schedule.status_category}):`, visitData);
          console.log(`   Original induct_date: ${schedule.induct_date}, Effective start_date: ${effectiveStartDate}`);
          return visitData;
        });

      console.log('🎯 BASELINE TASKS FOR ALLOCATION:', baselineTasksForAllocation);
      console.log('📊 Total baseline tasks found:', baselineTasksForAllocation.length);

      // Then, include new flights added by user
      // Apply same date logic: use today's date if induct_date is before today
      const newFlightsForAllocation = validSchedules
        .filter(schedule => {
          // Filter out new flights where ETS is before today
          if (!schedule.ets_date) return true; // Keep if no ETS (user still editing)
          const etsDateObj = new Date(schedule.ets_date);
          return etsDateObj >= todayDateObj;
        })
        .map(schedule => {
          const inductDateObj = schedule.induct_date ? new Date(schedule.induct_date) : null;
          const effectiveStartDate = inductDateObj && inductDateObj <= todayDateObj
            ? todayDate
            : schedule.induct_date;

          return {
            tail_num: schedule.aircraft_reg,
            start_date: effectiveStartDate,  // Use today's date if induct_date is before today
            end_date: schedule.ets_date,
            num_engineers: schedule.min_engineers,
            num_technicians: schedule.min_technicians || 0, // Technicians required (based on work history)
            aircraft_size: getAircraftSize(schedule.fleet),
            // Include full license requirement for allocation (e.g., "A350-RRTRENTXWB-GCAA")
            // This allows finding eligible engineers/technicians by matching aircraft, engine, and license
            lic_req: schedule.full_lic_req || undefined,
          };
        });

      console.log('New flights for allocation:', newFlightsForAllocation);
      console.log('Total new flights:', newFlightsForAllocation.length);

      // Combine baseline tasks (ongoing + upcoming from DB) and newly added flights
      const futureVisits = [
        ...baselineTasksForAllocation,
        ...newFlightsForAllocation
      ];

      console.log('Total future visits (baseline + new):', futureVisits.length);
      console.log('Future visits array:', futureVisits);

      // Step 3b: Identify ongoing jobs from the baseline (Business Rule)
      // Ongoing jobs are jobs where: induct_date <= today AND ets_date >= today
      // Resources assigned with planned_core/planned_support to these jobs will be retained
      // Use the same todayDate constant defined above for consistency
      const ongoingJobsFromBaseline = aircraftSchedules.filter(schedule => {
        if (!schedule.is_from_db) return false; // Only consider baseline jobs from database
        if (!schedule.induct_date || !schedule.ets_date) return false;
        const inductDate = new Date(schedule.induct_date);
        const etsDate = new Date(schedule.ets_date);
        // A job is ongoing if it started on or before today and ends on or after today
        return inductDate <= todayDateObj && etsDate >= todayDateObj;
      });

      // Fetch retained resources for ongoing jobs
      // Query emp_360 view to get employees with planned_core/planned_support matching ongoing job tails
      // Business Rule: 
      //   - If planned_core == planned_support → Employee is CORE on that job
      //   - If planned_core != planned_support → Employee is SUPPORT (planned_support indicates the job)
      let ongoingJobs: Array<{
        tail_num: string;
        start_date: string;
        end_date: string;
        lic_req?: string;
        retained_resources: Array<{
          emp_id: string;
          emp_name?: string;
          role: string;
          assignment_type: 'core' | 'support';  // core if planned_core==planned_support, else support
          planned_core?: string;
          planned_support?: string;
        }>;
      }> = [];

      if (ongoingJobsFromBaseline.length > 0) {
        setBuildProgress(`Fetching retained resources for ${ongoingJobsFromBaseline.length} ongoing jobs...`);
        
        // Query emp_360 for employees with planned assignments matching ongoing job tails
        const { data: emp360Data, error: empError } = await supabase
          .from('emp_360')
          .select('emp_id, name, title, planned_core, planned_support')
          .or(
            ongoingJobsFromBaseline.map(job => 
              `planned_core.ilike.%${job.aircraft_reg.split('-').pop()}%,planned_support.ilike.%${job.aircraft_reg.split('-').pop()}%`
            ).join(',')
          );

        if (empError) {
          console.warn('Could not fetch retained resources:', empError);
        }

        // Build ongoing jobs with retained resources
        ongoingJobs = ongoingJobsFromBaseline.map(job => {
          const tailCode = job.aircraft_reg.split('-').pop()?.toUpperCase() || '';
          
          // Find employees retained for this job
          const retainedForJob = (emp360Data || []).filter((emp: any) => {
            const plannedCore = (emp.planned_core || '').toUpperCase();
            const plannedSupport = (emp.planned_support || '').toUpperCase();
            return plannedCore.includes(tailCode) || plannedSupport.includes(tailCode) ||
                   plannedCore === job.aircraft_reg.toUpperCase() || plannedSupport === job.aircraft_reg.toUpperCase();
          });

          return {
            tail_num: job.aircraft_reg,
            start_date: todayDate,  // Use today's date for ongoing jobs (since induct_date is before today)
            end_date: job.ets_date,
            lic_req: job.lic_req || undefined,
            retained_resources: retainedForJob.map((emp: any) => {
              // Determine assignment_type: 'core' if planned_core == planned_support, else 'support'
              const plannedCore = (emp.planned_core || '').toUpperCase().trim();
              const plannedSupport = (emp.planned_support || '').toUpperCase().trim();
              const assignmentType = (plannedCore === plannedSupport && plannedCore !== '') ? 'core' : 'support';
              
              return {
                emp_id: emp.emp_id,
                emp_name: emp.name,
                role: emp.title === 'TECH' ? 'technician' : 'engineer',
                assignment_type: assignmentType,
                planned_core: emp.planned_core,
                planned_support: emp.planned_support,
              };
            }),
          };
        });

        console.log('Ongoing jobs with retained resources:', ongoingJobs);
      }

      const apiRequest = {
        future_visits: futureVisits,
        ongoing_jobs: ongoingJobs, // Business Rule: ongoing jobs with retained resources
        verbose: false,
      };

      console.log('=== API REQUEST PAYLOAD ===');
      console.log('📤 Future Visits Count:', futureVisits.length);
      console.log('📤 Future Visits Details:', futureVisits.map(v => ({
        tail_num: v.tail_num,
        start_date: v.start_date,
        end_date: v.end_date,
        num_engineers: v.num_engineers,
        num_technicians: v.num_technicians,
        lic_req: v.lic_req
      })));
      console.log('📤 Ongoing Jobs Count:', ongoingJobs.length);
      console.log('📤 Ongoing Jobs Details:', ongoingJobs);
      console.log('📤 Full API Request:', JSON.stringify(apiRequest, null, 2));

      console.log('API Request being sent:', {
        future_visits_count: futureVisits.length,
        ongoing_jobs_count: ongoingJobs.length,
        future_visits: futureVisits,
        ongoing_jobs: ongoingJobs
      });

      setBuildProgress('Checking for existing scenario...');

      // Step 4: Check if scenario with same name exists and upsert
      const { data: existingScenario } = await supabase
        .from('ai_allocation_scenarios_v2')
        .select('id')
        .eq('scenario_name', scenarioName)
        .single();

      let scenario;
      const isUpdate = !!existingScenario;

      if (existingScenario) {
        // Update existing scenario
        setBuildProgress('Updating existing scenario...');
        const { data: updatedScenario, error: updateError } = await supabase
          .from('ai_allocation_scenarios_v2')
          .update({
            status: 'processing',
            planning_date: '2022-04-30',
            aircraft_schedules: aircraftSchedulesJson,
            additional_aircraft: additionalAircraftJson,
            daywise_plans: daywisePlans,
            api_request: apiRequest,
            total_visits: futureVisits.length,
            updated_at: new Date().toISOString(),
            // Reset previous results - only api_response, read everything from there
            api_response: null,
            total_engineers_allocated: 0,
            is_valid: false,
            error_message: null,
          })
          .eq('id', existingScenario.id)
          .select()
          .single();

        if (updateError) {
          console.error('Update error:', updateError);
          throw new Error(`Failed to update scenario: ${updateError.message}`);
        }
        scenario = updatedScenario;
      } else {
        // Insert new scenario
        setBuildProgress('Saving new scenario to database...');
        const { data: newScenario, error: insertError } = await supabase
          .from('ai_allocation_scenarios_v2')
          .insert({
            scenario_name: scenarioName,
            status: 'processing',
            planning_date: '2022-04-30',
            aircraft_schedules: aircraftSchedulesJson,
            additional_aircraft: additionalAircraftJson,
            daywise_plans: daywisePlans,
            api_request: apiRequest,
            total_visits: futureVisits.length,
          })
          .select()
          .single();

        if (insertError) {
          console.error('Insert error:', insertError);
          throw new Error(`Failed to save scenario: ${insertError.message}`);
        }
        scenario = newScenario;
      }

      setBuildProgress('Calling AI allocation API...');

      // Step 5: Call AI allocation API
      let aiResponse = null;
      let apiError = null;

      try {
        const response = await fetch(`${AI_API_URL}/allocate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(apiRequest),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        aiResponse = await response.json();

        console.log('=== API RESPONSE RECEIVED ===');
        console.log('📥 Full AI Response:', aiResponse);
        console.log('📥 Number of allocations:', aiResponse?.allocations?.length || 0);

        if (aiResponse?.allocations) {
          console.log('📥 Allocations breakdown:', {
            total: aiResponse.allocations.length,
            tail_numbers: aiResponse.allocations.map((a: any) => a.tail_num || a.visit_id),
            details: aiResponse.allocations.map((a: any) => ({
              tail_num: a.tail_num,
              visit_id: a.visit_id,
              engineers_count: a.assigned_engineers?.length || 0,
              technicians_count: a.assigned_technicians?.length || 0
            }))
          });
        }

        console.log('AI Allocation Response:', aiResponse);
        console.log('Number of allocations in response:', aiResponse?.allocations?.length || 0);
        if (aiResponse?.allocations) {
          console.log('Allocations breakdown:', {
            total: aiResponse.allocations.length,
            tail_numbers: aiResponse.allocations.map((a: any) => a.tail_num || a.visit_id)
          });
        }
      } catch (err: any) {
        console.error('AI API call failed:', err);
        apiError = err.message;
        aiResponse = {
          success: false,
          error: err.message,
          allocations: [],
          bay_allocations: null,
          validation: null,
        };
      }

      setBuildProgress('Saving AI allocation results...');

      // Step 6: Update scenario with API response
      // Count unique engineers allocated (not total day-assignments)
      // API response structure: allocations[] contains visits, each with assigned_engineers[] and assigned_technicians[]
      const uniqueEngineers = new Set<string>();
      const uniqueTechnicians = new Set<string>();

      if (aiResponse?.allocations) {
        aiResponse.allocations.forEach((visitAllocation: any) => {
          // Each visit allocation has assigned_engineers[] and assigned_technicians[]
          if (visitAllocation.assigned_engineers) {
            visitAllocation.assigned_engineers.forEach((engineer: any) => {
              if (engineer.emp_id) {
                uniqueEngineers.add(engineer.emp_id);
              }
            });
          }
          if (visitAllocation.assigned_technicians) {
            visitAllocation.assigned_technicians.forEach((technician: any) => {
              if (technician.emp_id) {
                uniqueTechnicians.add(technician.emp_id);
              }
            });
          }
        });
      }

      const totalEngineersAllocated = uniqueEngineers.size;
      const totalTechniciansAllocated = uniqueTechnicians.size;
      const isValid = aiResponse?.validation?.is_valid || false;

      console.log('Allocation counts:', {
        uniqueEngineers: Array.from(uniqueEngineers),
        uniqueTechnicians: Array.from(uniqueTechnicians),
        totalEngineersAllocated,
        totalTechniciansAllocated,
        isValid
      });

      const { error: updateError } = await supabase
        .from('ai_allocation_scenarios_v2')
        .update({
          status: aiResponse?.success ? 'completed' : 'failed',
          api_response: aiResponse,  // Store full response - read allocations, bay_allocations, validation from here
          total_engineers_allocated: totalEngineersAllocated,
          is_valid: isValid,
          error_message: apiError,
          updated_at: new Date().toISOString(),
        })
        .eq('id', scenario.id);

      if (updateError) {
        console.error('Error updating scenario with AI response:', updateError);
      }

      setBuildProgress('');
      setIsBuilding(false);

      // Refresh the scenarios list and select this scenario
      await loadSavedScenarios();
      setSelectedScenarioId(scenario.id);
      setHasUnsavedChanges(false);

      if (aiResponse?.success) {
        // Get bay allocations - now keyed by tail_num
        const bayInfo = aiResponse.bay_allocations
          ? `\nBays allocated: ${Object.entries(aiResponse.bay_allocations).map(([tail, b]: [string, any]) => `${tail}: ${b.bay}`).filter(([_, b]) => b).join(', ')}`
          : '';

        // Use summary from API response if available
        const summary = aiResponse.summary || {};
        const displayEngineers = totalEngineersAllocated || summary.primary_employees_used || 0;
        const displayTechnicians = totalTechniciansAllocated || summary.technicians_used || 0;

        // Check for flights with no engineers or understaffed
        const allocations = aiResponse.allocations || [];
        const understaffedFlights: string[] = [];
        const partiallyStaffedFlights: string[] = [];

        allocations.forEach((alloc: any) => {
          const engineerCount = alloc.assigned_engineers?.length || 0;
          const status = alloc.engineer_status || '';
          const tailNum = alloc.tail_num || `Visit ${alloc.visit_id}`;
          const notes = alloc.notes || '';

          if (status === 'understaffed' || engineerCount === 0) {
            const reason = notes ? ` (${notes})` : ' (no eligible engineers available)';
            understaffedFlights.push(`${tailNum}${reason}`);
          } else if (status === 'partially_staffed') {
            const reason = notes ? ` (${notes})` : '';
            partiallyStaffedFlights.push(`${tailNum}: ${engineerCount} assigned${reason}`);
          }
        });

        // Build warning info for understaffed flights
        let warningInfo = '';
        if (understaffedFlights.length > 0) {
          warningInfo += `\n\n⚠️ UNDERSTAFFED FLIGHTS (0 engineers):\n`;
          understaffedFlights.forEach(f => {
            warningInfo += `  • ${f}\n`;
          });
        }
        if (partiallyStaffedFlights.length > 0) {
          warningInfo += `\n⚡ PARTIALLY STAFFED FLIGHTS:\n`;
          partiallyStaffedFlights.forEach(f => {
            warningInfo += `  • ${f}\n`;
          });
        }

        // Add general warning if no engineers at all
        if (displayEngineers === 0) {
          warningInfo += '\n\n⚠️ WARNING: No engineers were allocated to any flight!\n' +
            'This usually means the Aircraft-Engine-License could not be matched.\n' +
            'Please ensure you selected a valid Aircraft-Engine-License from the dropdown.';
        }

        const ongoingCount = baselineTasksForAllocation.filter(t =>
          aircraftSchedules.find(s => s.aircraft_reg === t.tail_num && s.status_category === 'Ongoing')
        ).length;
        const upcomingCount = baselineTasksForAllocation.filter(t =>
          aircraftSchedules.find(s => s.aircraft_reg === t.tail_num && s.status_category === 'Upcoming')
        ).length;

        const baselineInfo = baselineTasksForAllocation.length > 0
          ? `\n✓ ${baselineTasksForAllocation.length} baseline task(s): ${ongoingCount} ongoing, ${upcomingCount} upcoming`
          : '';
        const newFlightsInfo = validSchedules.length > 0
          ? `\n✓ ${validSchedules.length} new flight(s) added`
          : '';

        // Count fully staffed
        const fullyStaffedCount = allocations.filter((a: any) =>
          a.engineer_status === 'fully_staffed' || (a.assigned_engineers?.length || 0) > 0 && a.engineer_status !== 'understaffed' && a.engineer_status !== 'partially_staffed'
        ).length;

        alert(
          `Scenario "${scenarioName}" ${isUpdate ? 'updated' : 'created'} successfully!\n\n` +
          `✓ ${allocations.length || futureVisits.length} total aircraft visits processed` +
          baselineInfo +
          newFlightsInfo +
          `\n✓ ${displayEngineers} unique engineers allocated` +
          (displayTechnicians > 0 ? `\n✓ ${displayTechnicians} technicians allocated` : '') +
          `\n✓ Fully staffed: ${fullyStaffedCount}/${allocations.length} flights` +
          `\n✓ Validation: ${isValid ? 'PASSED' : 'Check required'}` +
          bayInfo +
          warningInfo
        );
      } else {
        alert(
          `Scenario "${scenarioName}" ${isUpdate ? 'updated' : 'saved'}, but AI allocation failed.\n\n` +
          `Error: ${apiError || aiResponse?.error || 'Unknown error'}\n\n` +
          `The scenario inputs have been saved. You can retry the allocation later.\n\n` +
          `Scenario ID: ${scenario.id}`
        );
      }
    } catch (error: any) {
      console.error('Error building scenario:', error);
      alert(`Failed to build scenario: ${error.message || 'Unknown error'}`);
      setIsBuilding(false);
      setBuildProgress('');
    }
  };

  // Helper function to determine aircraft size based on fleet type
  function getAircraftSize(fleet: string): string {
    const widebodyFleets = ['A330', 'A340', 'A350', 'A380', 'B747', 'B767', 'B777', 'B787'];
    const fleetUpper = fleet.toUpperCase();
    
    for (const wb of widebodyFleets) {
      if (fleetUpper.includes(wb)) {
        return 'widebody';
      }
    }
    return 'narrowbody';
  }

  const getWeekColor = (category: string) => {
    switch (category) {
      case 'ongoing': return 'bg-blue-100';
      case '1 week': return 'bg-amber-100';
      case '2 week': return 'bg-yellow-100';
      case '2-4 week': return 'bg-orange-100';
      default: return 'bg-white';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Ongoing': return 'bg-blue-50';
      case 'Upcoming': return 'bg-amber-50';
      case 'Completed': return 'bg-gray-100';
      default: return 'bg-white';
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'Ongoing': return 'bg-blue-500 text-white';
      case 'Upcoming': return 'bg-amber-500 text-white';
      case 'Completed': return 'bg-gray-500 text-white';
      default: return 'bg-gray-300 text-gray-700';
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-lg text-gray-600">Loading visit planning data...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-2 border-gray-800 rounded mb-4">
        <div className="bg-gray-800 text-white p-4">
          <h2 className="text-xl font-bold text-center">Planning Scenario Builder</h2>
        </div>

        {/* Baseline Info Banner */}
        <div className="bg-green-50 border-b-2 border-green-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-lg">✈️</span>
            <div>
              <div className="font-semibold text-green-800">Visits Baseline (Ongoing & Upcoming)</div>
              <div className="text-sm text-green-700">
                These visits from the Visits module are your baseline and included in all scenarios. 
                Add new flights below to create scenarios.
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          {capacityWarnings.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border-2 border-red-500 rounded">
              <div className="font-bold text-red-900 mb-2">Capacity Warnings:</div>
              {capacityWarnings.map((warning, idx) => (
                <div key={idx} className="text-xs text-red-800 mb-1">
                  <span className="font-semibold">{new Date(warning.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  : Required ENGR = {warning.required}, Available ENGR = {warning.available} (Short by {warning.shortfall})
                  <span className="ml-2 text-red-600">Affected: {warning.affectedAircraft.slice(0, 3).join(', ')}{warning.affectedAircraft.length > 3 ? '...' : ''}</span>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs border-2 border-gray-800">
              <thead className="sticky top-0 bg-purple-900 text-white z-10">
                <tr>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">Status</th>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">Aircraft Reg</th>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">Customer</th>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">Fleet</th>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">Check Type</th>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">Induction Date</th>
                  <th className="border-r border-white px-2 py-2 text-left font-bold">ETS</th>
                  <th className="border-r border-white px-2 py-2 text-center font-bold">
                    <div>Min Eng Req</div>
                    <div className="text-[10px] font-normal">(Engineers)</div>
                  </th>
                  <th className="border-r border-white px-2 py-2 text-center font-bold">
                    <div>Min Tech Req</div>
                    <div className="text-[10px] font-normal">(Technicians)</div>
                  </th>
                  <th className="border-r border-white px-2 py-2 text-center font-bold">Daywise</th>
                  <th className="px-2 py-2 text-center font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {['Ongoing', 'Upcoming'].map(statusCategory => {
                  const categorySchedules = combinedSchedules.filter(a => a.status_category === statusCategory);
                  if (categorySchedules.length === 0) return null;

                  return (
                    <>
                      <tr key={statusCategory} className={getStatusColor(statusCategory)}>
                        <td colSpan={11} className="px-2 py-1 font-bold border-b-2 border-gray-800">
                          {statusCategory} ({categorySchedules.length})
                      </td>
                    </tr>
                      {categorySchedules.map(aircraft => (
                        <tr key={aircraft.id} className={`${getStatusColor(aircraft.status_category)} border-b border-gray-300`}>
                          <td className="border-r border-gray-300 px-2 py-1 text-center">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded ${getStatusBadgeColor(aircraft.status_category)}`}>
                              {aircraft.status_category}
                            </span>
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1">
                          <input
                            type="text"
                            value={aircraft.aircraft_reg}
                            onChange={(e) => updateAircraftRow(aircraft.id, 'aircraft_reg', e.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-gray-300 rounded text-xs"
                              disabled={aircraft.is_from_db}
                          />
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1">
                          <input
                            type="text"
                            value={aircraft.customer}
                            onChange={(e) => updateAircraftRow(aircraft.id, 'customer', e.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-gray-300 rounded text-xs"
                              disabled={aircraft.is_from_db}
                          />
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1">
                          <input
                            type="text"
                            value={aircraft.fleet}
                            onChange={(e) => updateAircraftRow(aircraft.id, 'fleet', e.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-gray-300 rounded text-xs"
                              disabled={aircraft.is_from_db}
                          />
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1">
                          <input
                            type="text"
                            value={aircraft.check_type}
                            onChange={(e) => updateAircraftRow(aircraft.id, 'check_type', e.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-gray-300 rounded text-xs"
                              disabled={aircraft.is_from_db}
                          />
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1">
                          <input
                            type="text"
                            value={aircraft.induct_date}
                            onChange={(e) => updateAircraftRow(aircraft.id, 'induct_date', e.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-gray-300 rounded text-xs"
                            placeholder="YYYY-MM-DD"
                              disabled={aircraft.is_from_db}
                          />
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1">
                          <input
                            type="text"
                            value={aircraft.ets_date}
                            onChange={(e) => updateAircraftRow(aircraft.id, 'ets_date', e.target.value)}
                              className="w-full px-1 py-0.5 bg-transparent border border-gray-300 rounded text-xs"
                            placeholder="YYYY-MM-DD"
                              disabled={aircraft.is_from_db}
                          />
                        </td>
                          <td className="border-r border-gray-300 px-2 py-1 text-center">
                          <input
                            type="number"
                              value={aircraft.min_engineers}
                              onChange={(e) => updateAircraftRow(aircraft.id, 'min_engineers', parseInt(e.target.value) || 0)}
                              className="w-14 px-1 py-0.5 bg-white border-2 border-blue-500 rounded text-center font-bold text-xs"
                            />
                        </td>
                        <td className="border-r border-gray-300 px-2 py-1 text-center">
                            <input
                              type="number"
                              value={aircraft.min_technicians}
                              onChange={(e) => updateAircraftRow(aircraft.id, 'min_technicians', parseInt(e.target.value) || 0)}
                              className="w-14 px-1 py-0.5 bg-white border-2 border-green-500 rounded text-center font-bold text-xs"
                            />
                          </td>
                          <td className="border-r border-gray-300 px-2 py-1 text-center">
                            <button
                              onClick={() => openDaywisePlanModal(aircraft)}
                              className="text-blue-600 hover:text-blue-800 relative"
                              title="Open daywise planning"
                            >
                              <Calendar size={14} />
                              {daywisePlans[aircraft.id] && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full"></span>
                              )}
                            </button>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            onClick={() => deleteAircraftRow(aircraft.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Remove from scenario"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border-2 border-orange-500 rounded p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-orange-500 text-xl">➕</span>
            <h3 className="text-lg font-bold text-orange-700">Add New Flights for Scenario</h3>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            Add new flights here to create your scenario. These will be planned alongside the baseline visits above.
          </p>

          <div className="space-y-2 mb-4 max-h-[400px] overflow-y-auto">
            {additionalAircraft.map(aircraft => {
              const hasIdentifier = aircraft.aircraft_engine_license || aircraft.tail_number;
              return (
                <div key={aircraft.id} className={`border-2 rounded p-3 ${hasIdentifier ? 'border-orange-400' : 'border-red-400'}`}>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500 italic">Fill at least one: Aircraft-Engine-License OR Tail Number</span>
                  <button
                    onClick={() => deleteAdditionalAircraft(aircraft.id)}
                      className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                  {/* Row 1: Aircraft-Engine-License and Tail Number */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                      <label className="text-xs font-medium block mb-1">Aircraft-Engine-License:</label>
                      <div className="relative">
                        <select
                          value={aircraft.aircraft_engine_license}
                          onChange={(e) => handleAircraftEngineLicenseChange(aircraft.id, e.target.value)}
                          className={`w-full px-2 py-1 border rounded text-sm appearance-none pr-8 ${
                            !hasIdentifier ? 'border-red-300 bg-red-50' : 'border-gray-300'
                          }`}
                        >
                          <option value="">Select...</option>
                          {mapKeyOptions.map(option => (
                            <option key={option.map_key} value={option.map_key}>
                              {option.map_key}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">Tail Number:</label>
                      <input
                        type="text"
                        value={aircraft.tail_number}
                        onChange={(e) => updateAdditionalAircraft(aircraft.id, 'tail_number', e.target.value)}
                        placeholder="e.g., VH-ABC"
                        className={`w-full px-2 py-1 border rounded text-sm ${
                          !hasIdentifier ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                      />
                    </div>
                  </div>
                  {/* Row 2: License Requirement (read-only, auto-populated) */}
                  <div className="mb-2">
                    <label className="text-xs font-medium block mb-1">
                      License Requirement <span className="text-orange-600">(for engineer allocation)</span>:
                    </label>
                    <input
                      type="text"
                      value={aircraft.lic_req}
                      onChange={(e) => updateAdditionalAircraft(aircraft.id, 'lic_req', e.target.value)}
                      placeholder="e.g., GCAA, EASA, FAA (auto-populated)"
                      className={`w-full px-2 py-1 border rounded text-sm ${
                        aircraft.lic_req ? 'border-green-500 bg-green-50' : 'border-gray-300'
                      }`}
                    />
                    {!aircraft.lic_req && aircraft.aircraft_engine_license && (
                      <p className="text-xs text-gray-500 mt-1">
                        License extracted from Aircraft-Engine-License
                      </p>
                    )}
                  </div>
                  {/* Row 3: Customer, Fleet, Check Type */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="text-xs font-medium block mb-1">Customer:</label>
                      <input
                        type="text"
                        value={aircraft.customer}
                        onChange={(e) => updateAdditionalAircraft(aircraft.id, 'customer', e.target.value)}
                        placeholder="e.g., Qantas"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">Fleet:</label>
                      <input
                        type="text"
                        value={aircraft.fleet}
                        onChange={(e) => updateAdditionalAircraft(aircraft.id, 'fleet', e.target.value)}
                        placeholder="e.g., A320"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">Check Type:</label>
                      <input
                        type="text"
                        value={aircraft.check_type}
                        onChange={(e) => updateAdditionalAircraft(aircraft.id, 'check_type', e.target.value)}
                        placeholder="e.g., C-Check"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  </div>
                  {/* Row 4: Dates */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-xs font-medium block mb-1">Induction Date:</label>
                    <input
                      type="date"
                      value={aircraft.induct_date}
                      onChange={(e) => updateAdditionalAircraft(aircraft.id, 'induct_date', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">ETS:</label>
                    <input
                      type="date"
                      value={aircraft.ets_date}
                      onChange={(e) => updateAdditionalAircraft(aircraft.id, 'ets_date', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                </div>
                  {/* Row 5: Min Engineers and Technicians */}
                  <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                      <label className="text-xs font-medium">Min Engineers:</label>
                  <input
                    type="number"
                    value={aircraft.min_engineers}
                    onChange={(e) => updateAdditionalAircraft(aircraft.id, 'min_engineers', parseInt(e.target.value) || 0)}
                        className="w-16 px-2 py-1 border-2 border-blue-500 rounded text-center text-sm"
                  />
                </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium">Min Technicians:</label>
                      <input
                        type="number"
                        value={aircraft.min_technicians}
                        onChange={(e) => updateAdditionalAircraft(aircraft.id, 'min_technicians', parseInt(e.target.value) || 0)}
                        className="w-16 px-2 py-1 border-2 border-green-500 rounded text-center text-sm"
                      />
              </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={addAdditionalAircraft}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 text-sm font-medium"
          >
            <Plus size={16} />
            Add New Flight
          </button>
        </div>

        <div className="bg-white border-2 border-gray-800 rounded p-4 flex flex-col justify-between">
          <div>
            {/* Scenario Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Load Existing Scenario:</label>
              <div className="flex gap-2">
                <select
                  value={selectedScenarioId}
                  onChange={(e) => handleScenarioChange(e.target.value)}
                  disabled={isLoading || isBuilding}
                  className="flex-1 px-3 py-2 border-2 border-gray-300 rounded"
                >
                  <option value="new">+ Create New Scenario</option>
                  {savedScenarios.map(scenario => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.source === 'ai' ? '🤖 ' : ''}{scenario.scenario_name} {scenario.status === 'completed' ? '✓' : scenario.status === 'failed' ? '✗' : scenario.status === 'draft' ? '📝' : scenario.status === 'legacy' ? '📋' : ''}
                    </option>
                  ))}
                </select>
                {selectedScenarioId !== 'new' && (
                  <button
                    onClick={deleteScenario}
                    disabled={isLoading || isBuilding}
                    className={`px-3 py-2 rounded flex items-center justify-center ${
                      isLoading || isBuilding
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                    title="Delete this scenario"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
              {hasUnsavedChanges && selectedScenarioId !== 'new' && (
                <div className="text-xs text-orange-600 mt-1">* Unsaved changes</div>
              )}
            </div>

            <h3 className="text-lg font-bold mb-3">Scenario Name</h3>
            <input
              type="text"
              value={scenarioName}
              onChange={(e) => {
                setScenarioName(e.target.value);
                setHasUnsavedChanges(true);
              }}
              placeholder="Amd_2025_11_28_v1"
              className="w-full px-3 py-2 border-2 border-blue-500 rounded text-lg"
            />

            {/* Save Draft Button */}
            <button
              onClick={saveScenarioToDb}
              disabled={isLoading || isBuilding || !scenarioName.trim()}
              className={`mt-3 w-full px-4 py-2 font-medium rounded flex items-center justify-center gap-2 ${
                isLoading || isBuilding || !scenarioName.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <Save size={16} />
              {hasUnsavedChanges ? 'Save Changes' : 'Save Draft'}
            </button>
          </div>

          <div className="mt-4">
            <button
              onClick={buildScenario}
              disabled={isBuilding || isLoading}
              className={`w-full px-6 py-3 font-bold rounded text-lg flex items-center justify-center gap-2 ${
                isBuilding || isLoading
                  ? 'bg-slate-500 text-gray-200 cursor-not-allowed' 
                  : 'bg-slate-700 text-white hover:bg-slate-800'
              }`}
            >
              {isBuilding ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {buildProgress || 'Building...'}
                </>
              ) : (
                <>
              <Save size={20} />
              Build & Save Scenario
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {showDaywiseModal && selectedAircraft && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-gray-800 text-white p-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">
                Daywise Plan - {selectedAircraft.aircraft_reg}
              </h3>
              <button
                onClick={() => setShowDaywiseModal(false)}
                className="text-white hover:text-gray-300"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-4 overflow-auto flex-1">
              {Object.keys(currentDaywisePlan).length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No date range available. Please set induction and ETS dates first.
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-2 border-gray-800">
                  <thead className="bg-purple-900 text-white sticky top-0">
                    <tr>
                      <th className="border-r border-white px-2 py-2 text-left font-bold">Role</th>
                      {Object.keys(currentDaywisePlan).sort().map(date => (
                        <th key={date} className="border-r border-white px-2 py-2 text-center font-bold min-w-[80px]">
                          {new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['CC', 'ENGR', 'TECH'] as const).map(role => (
                      <tr key={role} className="border-b border-gray-300">
                        <td className="border-r border-gray-300 px-2 py-2 font-bold bg-gray-100">
                          {role}
                        </td>
                        {Object.keys(currentDaywisePlan).sort().map(date => (
                          <td key={date} className="border-r border-gray-300 px-2 py-1 text-center">
                            <input
                              type="number"
                              min="0"
                              value={currentDaywisePlan[date][role]}
                              onChange={(e) => updateDaywisePlanCell(date, role, parseInt(e.target.value) || 0)}
                              className="w-full px-1 py-1 border border-gray-300 rounded text-center"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>

            <div className="bg-gray-100 p-4 flex justify-end gap-3">
              <button
                onClick={() => setShowDaywiseModal(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={saveDaywisePlan}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
              >
                <Save size={16} />
                Save Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}