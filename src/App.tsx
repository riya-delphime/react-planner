import { useEffect, useState } from 'react';
import { PlanningScenarioBuilder } from './components/PlanningScenarioBuilder';
import { PlanningScenarioVisualizer } from './components/PlanningScenarioVisualizer';
import { ExecutiveOverview } from './components/ExecutiveOverview';
import { WorkforcePlanning } from './components/WorkforcePlanning';
import VisitIntake, { Visit } from './components/VisitIntake';
import VisitsManager from './components/VisitsManager';
import { getAllVisits, type VisitPlanningRecord, type BayDayWise } from './lib/visitData';

type TabType = 'daily-planning' | 'scenario-builder' | 'scenario-visualizer' | 'executive-overview' | 'visit-intake' | 'visits-manager';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('executive-overview');

  // Visits state
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitCounter, setVisitCounter] = useState(23);
  const [duplicateVisitData, setDuplicateVisitData] = useState<Partial<Visit> | null>(null);

  // Reset scroll position on mount to prevent layout shift
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  }, []);

  useEffect(() => {
    fetchVisits();
  }, []);

  async function fetchVisits() {
    try {
      const visitRecords = await getAllVisits();
      const convertedVisits: Visit[] = visitRecords.map(convertVisitRecordToVisit);
      setVisits(convertedVisits);

      if (visitRecords.length > 0) {
        // visit_id is now numeric (visit_number from DB)
        const maxId = visitRecords.reduce((max, v) => {
          const num = parseInt(v.visit_id, 10);
          return !isNaN(num) && num > max ? num : max;
        }, 0);
        setVisitCounter(maxId + 1);
      }
    } catch (error) {
      console.error('Error fetching visits:', error);
    }
  }

  // Calculate visit status based on current date and visit dates
  function calculateVisitStatus(inductionDate: string, etsDate: string): 'Upcoming' | 'Ongoing' | 'Completed' {
    // Fixed current date: April 30, 2022
    const currentDate = new Date('2022-04-30');
    const induction = new Date(inductionDate);
    const ets = new Date(etsDate);

    if (currentDate > ets) {
      return 'Completed';
    } else if (currentDate >= induction && currentDate <= ets) {
      return 'Ongoing';
    } else {
      return 'Upcoming';
    }
  }

  // Helper to parse JSON fields that may come as strings from the database
  function parseJsonField<T>(field: T | string | null | undefined, defaultValue: T): T {
    if (field === null || field === undefined) return defaultValue;
    if (typeof field === 'string') {
      try {
        return JSON.parse(field) as T;
      } catch {
        return defaultValue;
      }
    }
    return field;
  }

  function convertVisitRecordToVisit(record: VisitPlanningRecord): Visit {
    // Parse JSON fields that may come as strings from the database
    const daywiseRescRaw = parseJsonField<any>(record.daywise_resc, null);
    const bayDaywiseRaw = parseJsonField<any>(record.bay_daywise, null);

    // Parse license_authorities - may be JSON array or use lic_req as fallback (comma-separated string)
    let licenseAuthoritiesParsed = parseJsonField<string[]>(record.license_authorities, []);

    // If license_authorities is empty, try to parse from lic_req (comma-separated string)
    if ((!licenseAuthoritiesParsed || licenseAuthoritiesParsed.length === 0) && record.lic_req) {
      licenseAuthoritiesParsed = record.lic_req
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    }

    // Handle daywise_resc - can be array format or object format {'2022-04-30': 1}
    const dayWiseRequirements: Visit['dayWiseRequirements'] = {};
    if (daywiseRescRaw) {
      if (Array.isArray(daywiseRescRaw)) {
        // Array format: [{date: '2022-04-30', CC: 1, ENGR: 2, TECH: 3}, ...]
        daywiseRescRaw.forEach((dr: any) => {
          if (dr && dr.date) {
            dayWiseRequirements[dr.date] = {
              CC: dr.CC || 0,
              ENGR: dr.ENGR || 0,
              TECH: dr.TECH || 0
            };
          }
        });
      } else if (typeof daywiseRescRaw === 'object') {
        // Object format from visit_planning: {'2022-04-30': 1, '2022-05-01': 2}
        // The value is total count - we'll put it in TECH for now (or distribute)
        Object.entries(daywiseRescRaw).forEach(([date, count]) => {
          const total = typeof count === 'number' ? count : parseInt(String(count)) || 0;
          dayWiseRequirements[date] = {
            CC: 0,
            ENGR: 0,
            TECH: total
          };
        });
      }
    }

    // Handle bay_daywise - can be array format or object format {'2022-04-30': 'bay19'}
    let bayDaywise: BayDayWise[] = [];
    if (bayDaywiseRaw) {
      if (Array.isArray(bayDaywiseRaw)) {
        // Array format: [{date: '2022-04-30', bay_id: 'bay19'}, ...]
        bayDaywise = bayDaywiseRaw.filter((b: any) => b && b.date);
      } else if (typeof bayDaywiseRaw === 'object') {
        // Object format from visit_planning: {'2022-04-30': 'bay19', '2022-05-01': 'bay20'}
        bayDaywise = Object.entries(bayDaywiseRaw).map(([date, bay_id]) => ({
          date,
          bay_id: String(bay_id)
        }));
      }
    }

    // Calculate status dynamically based on dates
    const status = calculateVisitStatus(record.induction_date, record.ets_date);

    return {
      id: record.visit_id,
      poConfirmed: record.po_confirmed,
      poNumber: record.po_number || '',
      tailNumber: record.tail_num || '',
      customer: record.customer || '',
      checkType: record.check_type || '',
      customerNotes: record.notes || '',
      aircraftType: record.aircraft || '',
      engineType: record.engine || '',
      licenseRequirements: Array.isArray(licenseAuthoritiesParsed) ? licenseAuthoritiesParsed : [],
      toolingConstraints: record.tooling_constraints || '',
      inductionDate: record.induction_date,
      etsDate: record.ets_date,
      minEngineers: record.min_engineers || 1,
      minTechnicians: record.min_technicians || 0,
      dayWiseRequirements,
      bayAlloc: record.bay_alloc || '',
      bayDaywise,
      status
    };
  }

  // Visit handler functions
  const handleAddVisit = (visit: Visit) => {
    setVisits(prev => [...prev, visit]);
    fetchVisits();
  };

  const handleUpdateVisit = (visitId: string, updatedVisit: Visit) => {
    setVisits(prev => prev.map(v => v.id === visitId ? updatedVisit : v));
    fetchVisits();
  };

  const handleDeleteVisit = (visitId: string) => {
    setVisits(prev => prev.filter(v => v.id !== visitId));
    fetchVisits();
  };

  const handleDuplicateVisit = (visit: Visit) => {
    // Create a copy with dates cleared - redirect to intake page for user to set dates
    const duplicateData: Partial<Visit> = {
      ...visit,
      id: '', // Will be assigned by intake
      inductionDate: '', // Clear dates - user must set new dates
      etsDate: '',
      dayWiseRequirements: {}, // Clear day-wise data since dates are cleared
      bayDaywise: [],
      status: 'Upcoming',
      poConfirmed: false, // New visit needs PO confirmation
      poNumber: '',
    };
    setDuplicateVisitData(duplicateData);
    setActiveTab('visit-intake'); // Navigate to intake page
  };

  const handleIncrementVisitCounter = () => {
    setVisitCounter(prev => prev + 1);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden">
      <div className="glass-effect border-b border-slate-200 shadow-soft sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-8 py-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
            MRO Workforce Planning & Bay Allocation
          </h1>
          <div className="flex items-center gap-3 bg-white rounded-xl px-5 py-3 shadow-soft border border-slate-200">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Today</div>
            <div className="text-lg font-bold text-slate-800">30-04-2022</div>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-8 py-6">
        <div className="glass-effect rounded-2xl shadow-soft-lg mb-6 overflow-hidden border border-white/20">
          <div className="flex bg-gradient-to-r from-slate-50 to-slate-100">
            <button
              onClick={() => setActiveTab('executive-overview')}
              className={`flex-1 px-6 py-4 font-semibold text-base transition-all relative group ${
                activeTab === 'executive-overview'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              Executive Overview
              {activeTab === 'executive-overview' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-full"></div>}
            </button>
            <button
              onClick={() => setActiveTab('visit-intake')}
              className={`flex-1 px-6 py-4 font-semibold text-base transition-all relative group ${
                activeTab === 'visit-intake'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              Visit Intake & Requirements
              {activeTab === 'visit-intake' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-full"></div>}
            </button>
            <button
              onClick={() => setActiveTab('visits-manager')}
              className={`flex-1 px-6 py-4 font-semibold text-base transition-all relative group ${
                activeTab === 'visits-manager'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              Visits Manager
              {activeTab === 'visits-manager' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-full"></div>}
            </button>
            <button
              onClick={() => setActiveTab('daily-planning')}
              className={`flex-1 px-6 py-4 font-semibold text-base transition-all relative group ${
                activeTab === 'daily-planning'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              Workforce Planning
              {activeTab === 'daily-planning' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-full"></div>}
            </button>
            <button
              onClick={() => setActiveTab('scenario-builder')}
              className={`flex-1 px-6 py-4 font-semibold text-base transition-all relative group ${
                activeTab === 'scenario-builder'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              Planning Scenario Builder
              {activeTab === 'scenario-builder' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-full"></div>}
            </button>
            <button
              onClick={() => setActiveTab('scenario-visualizer')}
              className={`flex-1 px-6 py-4 font-semibold text-base transition-all relative group ${
                activeTab === 'scenario-visualizer'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              Planning Scenario Visualizer
              {activeTab === 'scenario-visualizer' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-full"></div>}
            </button>
          </div>
        </div>

        {/* Keep all tabs mounted to preserve state - use visibility to hide inactive tabs */}
        {/* visibility:hidden + height:0 + overflow:hidden keeps component in DOM but removes from layout */}
        <div className={activeTab === 'daily-planning' ? '' : 'hidden'}>
          <WorkforcePlanning />
        </div>

        <div className={activeTab === 'scenario-builder' ? '' : 'hidden'}>
          <PlanningScenarioBuilder />
        </div>

        <div className={activeTab === 'scenario-visualizer' ? '' : 'hidden'}>
          <PlanningScenarioVisualizer />
        </div>

        <div className={activeTab === 'executive-overview' ? '' : 'hidden'}>
          <ExecutiveOverview />
        </div>

        <div className={activeTab === 'visit-intake' ? '' : 'hidden'}>
          <VisitIntake
            visits={visits}
            visitCounter={visitCounter}
            onAddVisit={handleAddVisit}
            onIncrementCounter={handleIncrementVisitCounter}
            duplicateVisitData={duplicateVisitData}
            onClearDuplicateData={() => setDuplicateVisitData(null)}
          />
        </div>

        <div className={activeTab === 'visits-manager' ? '' : 'hidden'}>
          <VisitsManager
            visits={visits}
            onUpdateVisit={handleUpdateVisit}
            onDeleteVisit={handleDeleteVisit}
            onDuplicateVisit={handleDuplicateVisit}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
