import { useState, useEffect } from 'react';
import { Resource, Requirement } from '../lib/supabase';
import { ChevronDown, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Exception } from './ExceptionsModal';

type ResolutionStatus = 'NO_FIX_DEFAULT' | 'NO_FIX_EXPLICIT' | 'ASSIGNED';

interface AssignedReplacement {
  employeeId: string;
  alertResourceId: string;
  alertTail: string;
  employeeName: string;
  employeeCurrentTail: string;
  employeeSupport: string;
  supportNormalized: boolean;
}

interface ResolvedNoShow {
  resourceId: string;
  resourceName: string;
  tailNumber: string;
}

interface PlanningTableProps {
  resources: Resource[];
  requirements: Requirement[];
  onAssignmentChange?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onRequirementRemoved?: () => void;
  filterByTailNumber?: string | null;
  onShowExceptions?: () => void;
  onResetFilters?: () => void;
  exceptions: Exception[];
  resolutionStatus: Map<string, ResolutionStatus>;
  assignedReplacements: Map<string, AssignedReplacement>;
  resolvedNoShows: ResolvedNoShow[];
  may1Inputs?: Record<string, { CC: number; ENGR: number; TECH: number }>;
}

interface AssignmentRecord {
  id: string;
  resource_id: string;
  requirement_id: string;
  date: string;
  role_type: string;
}

const days = ['23-Apr', '24-Apr', '25-Apr', '26-Apr', '27-Apr', '30-Apr'];

function generateLoginTime(resourceId: string): string {
  if (resourceId === 'AB12386') {
    return '';
  }

  const seed = parseInt(resourceId.replace(/\D/g, ''));
  const random = Math.abs(Math.sin(seed) * 10000);
  const probability = random - Math.floor(random);

  if (probability < 0.3) {
    return '';
  }

  const baseMinutes = 6 * 60 + 45;
  const maxMinutes = 8 * 60;
  const minuteRange = maxMinutes - baseMinutes;
  const totalMinutes = baseMinutes + Math.floor((random % 1) * minuteRange);

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function PlanningTable({ resources, requirements, onAssignmentChange, searchQuery = '', onSearchChange, onRequirementRemoved, filterByTailNumber, onShowExceptions, onResetFilters, exceptions, resolutionStatus, assignedReplacements, resolvedNoShows, may1Inputs = {} }: PlanningTableProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [dayAssignments, setDayAssignments] = useState<Record<string, Record<string, string>>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [allRequirements, setAllRequirements] = useState<Requirement[]>([]);
  const [showFixAllSuccess, setShowFixAllSuccess] = useState(false);
  const [showFixedState, setShowFixedState] = useState(false);
  const [allAssignmentsComplete, setAllAssignmentsComplete] = useState(false);
  const [fixedResources, setFixedResources] = useState<Set<string>>(new Set());
  const [exceptionsData, setExceptionsData] = useState({ noShowCount: 0, leavePendingCount: 0, total: 0 });
  const [multiTailAssignments, setMultiTailAssignments] = useState<Record<string, string[]>>({});
  const [showMultiTailTooltip, setShowMultiTailTooltip] = useState<string | null>(null);

  let filteredResources = resources.filter(resource => {
    if (filterByTailNumber) {
      const checkDate = '2025-04-30';
      const hasAssignmentOnApr30 = Object.keys(dayAssignments).some(key =>
        key.startsWith(`${resource.id}-${checkDate}`)
      );
      const dayAssignment = dayAssignments[`${resource.id}-${checkDate}`];
      const apr30TailNumber = dayAssignment?.[resource.id];

      if (apr30TailNumber === filterByTailNumber) {
        return true;
      }
      return false;
    }

    const query = searchQuery.toLowerCase();

    if (query.includes('alert') || query.includes('error')) {
      const checkDate = '2025-04-30';
      const loginTime = generateLoginTime(resource.id);
      let normalizedTtlLogin = loginTime && loginTime !== '';
      const leaveType = resource.leave_data?.[checkDate];
      const hasAssignmentOnApr30 = Object.keys(dayAssignments).some(key =>
        key.startsWith(`${resource.id}-${checkDate}`)
      );

      if ((leaveType === 'SL' || leaveType === 'AL') && normalizedTtlLogin) {
        normalizedTtlLogin = false;
      }

      const resourceResolutionStatus = resolutionStatus.get(resource.id);
      const isResolved = resourceResolutionStatus === 'NO_FIX_EXPLICIT' || resourceResolutionStatus === 'ASSIGNED';

      const hasActualTailAssignment = hasAssignmentOnApr30 && !leaveType;
      const isRuleB = hasActualTailAssignment && !normalizedTtlLogin && !showFixedState && !isResolved;

      const isRuleA = leaveType === 'SL' && !showFixedState && !isResolved;

      return isRuleB || isRuleA;
    }

    if (query.includes('need a lead engineer') && query.includes('airbus') && query.includes('rr trent') && query.includes('easa')) {
      return ['Benny Red', 'Oba Lomi'].includes(resource.name);
    }

    if (query.includes('2 fte engineers') && query.includes('airbus 330')) {
      return ['Cam Dwight', 'Benny Red', 'Jimmy Wang'].includes(resource.name);
    }

    return (
      resource.name.toLowerCase().includes(query) ||
      resource.team.toLowerCase().includes(query) ||
      resource.core.toLowerCase().includes(query) ||
      resource.support.toLowerCase().includes(query) ||
      resource.title.toLowerCase().includes(query) ||
      resource.licenses.toLowerCase().includes(query) ||
      resource.id.toLowerCase().includes(query)
    );
  });

  if (filterByTailNumber && filteredResources.length > 0) {
    const checkDate = '2025-04-30';
    const assignedIds = new Set(filteredResources.map(r => r.id));

    const tailCode = filterByTailNumber.split('-').pop() || '';
    const unassignedQualified = resources.find(resource =>
      !assignedIds.has(resource.id) &&
      (resource.core === tailCode || resource.support === tailCode) &&
      (resource.title === 'ENGR' || resource.title === 'TECH') &&
      !Object.keys(dayAssignments).some(key => key.startsWith(`${resource.id}-${checkDate}`))
    );

    if (unassignedQualified) {
      filteredResources = [...filteredResources, unassignedQualified];
    }
  }

  useEffect(() => {
    loadAssignments();
  }, [requirements]);

  useEffect(() => {
    const resourcesNeedingAssignment = resources.filter(r => {
      if (r.support === 'AV') return false;
      const leaveType = r.leave_data?.['2025-05-01'];
      if (leaveType === 'AL' || leaveType === 'SL') return false;
      return true;
    });

    const assignedCount = Object.keys(assignments).length;
    const totalNeeded = resourcesNeedingAssignment.length;

    setAllAssignmentsComplete(assignedCount === totalNeeded && totalNeeded > 0);
  }, [resources, assignments]);

  useEffect(() => {
    const counts = getExceptionsCount();
    setExceptionsData(counts);
  }, [dayAssignments, resources, showFixedState, fixedResources, resolutionStatus]);

  useEffect(() => {
    const handleClickOutside = () => {
      if (showMultiTailTooltip) {
        setShowMultiTailTooltip(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showMultiTailTooltip]);

  async function loadAssignments() {
    const historicalDates = ['2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30'];
    const today = '2025-05-01';

    const { data: historicalRequirements } = await supabase
      .from('requirements')
      .select('*')
      .in('date', historicalDates);

    const { data: todayRequirements } = await supabase
      .from('requirements')
      .select('*')
      .eq('date', today);

    const allReqs = [...(historicalRequirements || []), ...(todayRequirements || [])];
    const requirementIds = allReqs.map(r => r.id);

    const { data } = await supabase
      .from('assignments')
      .select('*')
      .in('requirement_id', requirementIds);

    const todayAssignments: Record<string, string> = {};
    const allDayAssignments: Record<string, Record<string, string>> = {};
    const multiTailMap: Record<string, string[]> = {};

    if (data) {
      const assignmentsByResourceAndDate: Record<string, string[]> = {};

      data.forEach((assignment: AssignmentRecord) => {
        const requirement = allReqs.find(r => r.id === assignment.requirement_id);
        if (!requirement) return;

        if (assignment.date === today) {
          todayAssignments[assignment.resource_id] = requirement.tail_number;
        }

        const dayKey = `${assignment.resource_id}-${assignment.date}`;
        if (!allDayAssignments[dayKey]) {
          allDayAssignments[dayKey] = {};
        }
        allDayAssignments[dayKey][assignment.resource_id] = requirement.tail_number;

        if (!assignmentsByResourceAndDate[dayKey]) {
          assignmentsByResourceAndDate[dayKey] = [];
        }
        if (!assignmentsByResourceAndDate[dayKey].includes(requirement.tail_number)) {
          assignmentsByResourceAndDate[dayKey].push(requirement.tail_number);
        }
      });

      Object.entries(assignmentsByResourceAndDate).forEach(([key, tails]) => {
        if (tails.length > 1) {
          multiTailMap[key] = tails;
        }
      });
    }

    setAllRequirements(allReqs);
    setAssignments(todayAssignments);
    setDayAssignments(allDayAssignments);
    setMultiTailAssignments(multiTailMap);
  }

  const handleAssign = async (resourceId: string, tailNumber: string) => {
    const requirement = requirements.find(r => r.tail_number === tailNumber);
    if (!requirement) return;

    const today = '2025-05-01';

    try {
      const { data: existingAssignment } = await supabase
        .from('assignments')
        .select('*')
        .eq('requirement_id', requirement.id)
        .eq('resource_id', resourceId)
        .eq('date', today)
        .maybeSingle();

      if (!existingAssignment) {
        await supabase.from('assignments').insert({
          requirement_id: requirement.id,
          resource_id: resourceId,
          date: today,
          role_type: 'support',
        });

        // Randomly remove one requirement after assignment
        if (requirements.length > 0 && Math.random() < 0.5) {
          const randomIndex = Math.floor(Math.random() * requirements.length);
          const requirementToRemove = requirements[randomIndex];

          await supabase
            .from('requirements')
            .delete()
            .eq('id', requirementToRemove.id);

          onRequirementRemoved?.();
        }
      }

      setAssignments(prev => ({
        ...prev,
        [resourceId]: tailNumber,
      }));

      setOpenDropdown(null);
      onAssignmentChange?.();
    } catch (error) {
      console.error('Failed to create assignment:', error);
    }
  };

  const handleRemoveAssignment = async (resourceId: string) => {
    const tailNumber = assignments[resourceId];
    const requirement = requirements.find(r => r.tail_number === tailNumber);
    if (!requirement) return;

    try {
      await supabase
        .from('assignments')
        .delete()
        .eq('requirement_id', requirement.id)
        .eq('resource_id', resourceId);

      setAssignments(prev => {
        const updated = { ...prev };
        delete updated[resourceId];
        return updated;
      });

      onAssignmentChange?.();
    } catch (error) {
      console.error('Failed to remove assignment:', error);
    }
  };

  const handleDownloadMay1 = () => {
    const csvRows = [];
    csvRows.push('Tail Number,CC,ENGR,TECH');

    Object.entries(may1Inputs).forEach(([tailNumber, allocations]) => {
      csvRows.push(`${tailNumber},${allocations.CC},${allocations.ENGR},${allocations.TECH}`);
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'may1_planning_inputs.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getExceptionsCount = () => {
    let noShowCount = 0;
    let leaveCount = 0;
    const checkDate = '2025-04-30';

    resources.forEach(resource => {
      const loginTime = generateLoginTime(resource.id);
      let normalizedTtlLogin = loginTime && loginTime !== '';
      const leaveType = resource.leave_data?.[checkDate];

      const dayKey = `${resource.id}-${checkDate}`;
      let tailNumber = dayAssignments[dayKey] ? Object.values(dayAssignments[dayKey])[0] : null;

      if (!tailNumber && !leaveType) {
        const apr27Key = `${resource.id}-2025-04-27`;
        const apr27Assignment = dayAssignments[apr27Key];
        tailNumber = apr27Assignment ? Object.values(apr27Assignment)[0] : null;
      }

      const displayValue = leaveType || tailNumber;

      if ((leaveType === 'SL' || leaveType === 'AL') && normalizedTtlLogin) {
        normalizedTtlLogin = false;
      }

      const resourceResolutionStatus = resolutionStatus.get(resource.id);
      const isResolved = resourceResolutionStatus === 'NO_FIX_EXPLICIT' || resourceResolutionStatus === 'ASSIGNED';

      const hasActualTailAssignment = !leaveType && displayValue && displayValue !== 'AL' && displayValue !== 'SL' && displayValue !== 'NO-SHOW';
      const isRuleB = hasActualTailAssignment && !normalizedTtlLogin && !showFixedState && !isResolved;

      if (isRuleB) {
        noShowCount++;
      }

      const apr26Leave = resource.leave_data?.['2025-04-26'];
      const apr27Leave = resource.leave_data?.['2025-04-27'];
      const wasOnSLBothDays = apr26Leave === 'SL' && apr27Leave === 'SL';

      const isRuleA = leaveType === 'SL' && !showFixedState && !isResolved && !wasOnSLBothDays;
      if (isRuleA) {
        leaveCount++;
      }
    });

    return { noShowCount, leavePendingCount: leaveCount, total: noShowCount + leaveCount };
  };

  const handleFixAll = async () => {
    const checkDate = '2025-04-30';
    const resourcesToFix: string[] = [];

    const { data: apr30Assignments } = await supabase
      .from('assignments')
      .select('resource_id')
      .eq('date', checkDate);

    const resourcesWithAssignments = new Set(
      apr30Assignments?.map(a => a.resource_id) || []
    );

    resources.forEach(resource => {
      const loginTime = generateLoginTime(resource.id);
      const hasLoginTime = loginTime && loginTime !== '';
      const leaveType = resource.leave_data?.[checkDate];
      const hasAssignmentOnApr30 = resourcesWithAssignments.has(resource.id);

      if (hasAssignmentOnApr30) {
        if (!hasLoginTime && leaveType !== 'AL' && leaveType !== 'SL' && leaveType !== 'NO-SHOW') {
          resourcesToFix.push(resource.id);
        } else if ((leaveType === 'AL') && leaveType !== 'SL') {
          resourcesToFix.push(resource.id);
        }
      }
    });

    setFixedResources(new Set(resourcesToFix));
    setShowFixedState(true);
    setShowFixAllSuccess(true);
    setTimeout(() => setShowFixAllSuccess(false), 5000);

    const newCounts = getExceptionsCount();
    setExceptionsData(newCounts);

    if (onAssignmentChange) {
      onAssignmentChange();
    }
  };

  const hasActiveFilters = searchQuery !== '' || filterByTailNumber !== null;

  return (
    <div className="bg-white border-2 border-gray-800 rounded">
      <div className="bg-white border-b-2 border-gray-800 p-3">
        <h2 className="text-lg font-bold text-center mb-3">Assignments & Roster Plan</h2>

        {showFixAllSuccess && (
          <div className="mb-3 bg-green-50 border-2 border-green-500 rounded p-3">
            <div className="flex items-center gap-2">
              <span className="text-green-600 font-bold text-lg">✓</span>
              <div>
                <p className="text-sm font-bold text-green-800">All alerts resolved, email notification sent.</p>
                <p className="text-xs text-green-700 mt-1">Changes have been applied to the table below.</p>
              </div>
            </div>
          </div>
        )}

        {(() => {
          const baseNoShowCount = exceptionsData.noShowCount;
          const baseLeaveUpdateCount = exceptionsData.leavePendingCount;

          let resolvedNoShowCount = 0;
          let resolvedLeaveUpdateCount = 0;

          if (exceptions.length > 0) {
            resolvedNoShowCount = exceptions.filter(e =>
              e.type === 'no-show' &&
              (resolutionStatus.get(e.resourceId) === 'ASSIGNED' || resolutionStatus.get(e.resourceId) === 'NO_FIX_EXPLICIT')
            ).length;

            resolvedLeaveUpdateCount = exceptions.filter(e =>
              e.type === 'leave-update' &&
              (resolutionStatus.get(e.resourceId) === 'ASSIGNED' || resolutionStatus.get(e.resourceId) === 'NO_FIX_EXPLICIT')
            ).length;
          }

          const openNoShowCount = Math.max(0, baseNoShowCount - resolvedNoShowCount);
          const openLeaveUpdateCount = Math.max(0, baseLeaveUpdateCount - resolvedLeaveUpdateCount);
          const openTotal = openNoShowCount + openLeaveUpdateCount;

          const hasExceptions = exceptions.length > 0;
          const allExceptionsResolved = hasExceptions && exceptions.every(e =>
            resolutionStatus.get(e.resourceId) === 'ASSIGNED' || resolutionStatus.get(e.resourceId) === 'NO_FIX_EXPLICIT'
          );
          const allResolved = (exceptionsData.total > 0 && openTotal === 0) || allExceptionsResolved;

          if (allResolved) {
            return (
              <div className="mb-3 bg-green-50 border-2 border-green-500 rounded p-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-green-600 font-bold text-lg">✓</span>
                  <span className="text-sm font-semibold text-green-800">
                    All Apr 30 alerts fixed
                  </span>
                </div>
                <button
                  onClick={() => onShowExceptions?.()}
                  className="text-xs px-3 py-1 bg-green-600 text-white font-semibold rounded hover:bg-green-700 transition-colors"
                >
                  View Details
                </button>
              </div>
            );
          }

          if (openTotal > 0 && !showFixAllSuccess && !showFixedState) {
            return (
              <div className="mb-3 bg-orange-50 border-2 border-orange-400 rounded p-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-orange-600 font-bold">⚠</span>
                  <span className="text-sm font-medium text-gray-700">
                    Apr 30 Alerts: {openTotal} ({openNoShowCount} no-show, {openLeaveUpdateCount} leave)
                  </span>
                </div>
                <button
                  onClick={() => onShowExceptions?.()}
                  className="text-xs px-3 py-1 bg-orange-500 text-white font-semibold rounded hover:bg-orange-600 transition-colors"
                >
                  View Details
                </button>
              </div>
            );
          }

          return null;
        })()}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Search by name, team, core, support, title, or licenses..."
              className="w-full px-4 py-2 pr-10 border-2 border-gray-300 rounded focus:outline-none focus:border-blue-500 text-sm"
            />
            <Search className="absolute right-3 top-2.5 text-gray-400" size={20} />
          </div>
          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="px-4 py-2 bg-gray-600 text-white font-semibold rounded hover:bg-gray-700 transition-colors flex items-center gap-2 text-sm"
            >
              <X size={16} />
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-100">
            <tr className="border-b border-gray-800">
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold" rowSpan={2}>Employee ID</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold" rowSpan={2}>Employee</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold" rowSpan={2}>Team</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold bg-green-100" rowSpan={2}>Core</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold bg-green-100" rowSpan={2}>Support</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold bg-yellow-100" rowSpan={2}>Role</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left font-bold" rowSpan={2}>TTL Login</th>
              <th className="border-r border-gray-800 px-2 py-1 text-center font-bold" colSpan={6}>Schedule (23–30 Apr)</th>
            </tr>
            <tr className="border-b-2 border-gray-800">
              {days.map((day) => (
                <th key={day} className="border-r border-gray-800 px-2 py-1 text-center font-bold text-[10px]">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredResources.map((resource, idx) => (
              <tr
                key={resource.id}
                className={`border-b border-gray-300 ${
                  idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                }`}
              >
                <td className="border-r border-gray-300 px-2 py-1 font-medium">
                  {resource.id}
                </td>
                <td className="border-r border-gray-300 px-2 py-1">{resource.name}</td>
                <td className="border-r border-gray-300 px-2 py-1">{resource.team}</td>
                <td className="border-r border-gray-300 px-2 py-1 bg-green-50">{resource.core}</td>
                <td className="border-r border-gray-300 px-2 py-1 bg-green-50">
                  {(() => {
                    const checkDate = '2025-04-30';
                    const isFixed = fixedResources.has(resource.id);
                    const leaveType = resource.leave_data?.[checkDate];
                    const loginTime = generateLoginTime(resource.id);
                    const hasLoginTime = loginTime && loginTime !== '';

                    const assignedReplacement = assignedReplacements.get(resource.id);
                    if (assignedReplacement && assignedReplacement.supportNormalized) {
                      return 'AV';
                    }

                    if (showFixedState && isFixed) {
                      if (!hasLoginTime && leaveType !== 'AL' && leaveType !== 'SL' && leaveType !== 'NO-SHOW') {
                        return 'NO-SHOW';
                      } else if (leaveType === 'AL') {
                        return 'SL';
                      }
                    }
                    return resource.support;
                  })()}
                </td>
                <td className="border-r border-gray-300 px-2 py-1 bg-yellow-50">{resource.title}</td>
                <td className="border-r border-gray-300 px-2 py-1 text-center">
                  {(() => {
                    const isFixed = fixedResources.has(resource.id);
                    if (showFixedState && isFixed) {
                      return '';
                    }
                    const apr30LeaveType = resource.leave_data?.['2025-04-30'];
                    if (apr30LeaveType === 'SL' || apr30LeaveType === 'AL') {
                      return '';
                    }
                    return (
                      <div className="flex items-center justify-center gap-1">
                        {generateLoginTime(resource.id)}
                      </div>
                    );
                  })()}
                </td>
                {days.map((day, dayIndex) => {
                  const dayNum = day.split('-')[0];
                  const dateStr = `2025-04-${dayNum}`;
                  const dayKey = `${resource.id}-${dateStr}`;
                  const assignment = dayAssignments[dayKey];
                  let tailNumber = assignment ? Object.values(assignment)[0] : null;
                  const leaveType = resource.leave_data?.[dateStr];

                  const isApr30 = dateStr === '2025-04-30';
                  const isFixed = fixedResources.has(resource.id);

                  const assignedReplacement = assignedReplacements.get(resource.id);
                  if (isApr30 && assignedReplacement) {
                    tailNumber = assignedReplacement.alertTail;
                  } else if (isApr30 && !tailNumber && !leaveType) {
                    const apr27Key = `${resource.id}-2025-04-27`;
                    const apr27Assignment = dayAssignments[apr27Key];
                    tailNumber = apr27Assignment ? Object.values(apr27Assignment)[0] : null;
                  }

                  let displayValue = leaveType || tailNumber;

                  const isResolvedNoShow = resolvedNoShows.some(ns => ns.resourceId === resource.id);
                  if (isApr30 && isResolvedNoShow && !leaveType) {
                    displayValue = 'NO-SHOW';
                  } else if (isApr30 && showFixedState && isFixed) {
                    const loginTime = generateLoginTime(resource.id);
                    const hasLoginTime = loginTime && loginTime !== '';

                    if (!hasLoginTime && leaveType !== 'AL' && leaveType !== 'SL' && leaveType !== 'NO-SHOW') {
                      displayValue = 'NO-SHOW';
                    } else if (leaveType === 'AL') {
                      displayValue = 'SL';
                    }
                  }

                  const isAL = displayValue === 'AL';
                  const isSL = displayValue === 'SL';
                  const isNoShow = displayValue === 'NO-SHOW';

                  const loginTime = generateLoginTime(resource.id);
                  let normalizedTtlLogin = loginTime && loginTime !== '';

                  if (isApr30 && (leaveType === 'SL' || leaveType === 'AL') && normalizedTtlLogin) {
                    normalizedTtlLogin = false;
                  }

                  const resourceResolutionStatus = resolutionStatus.get(resource.id);
                  const isResolved = resourceResolutionStatus === 'NO_FIX_EXPLICIT' || resourceResolutionStatus === 'ASSIGNED';

                  const apr26Leave = resource.leave_data?.['2025-04-26'];
                  const apr27Leave = resource.leave_data?.['2025-04-27'];
                  const wasOnSLBothDays = apr26Leave === 'SL' && apr27Leave === 'SL';

                  const isRuleA = isApr30 && leaveType === 'SL' && !showFixedState && !isResolved && !wasOnSLBothDays;

                  return (
                    <td key={day} className="border-r border-gray-300 px-2 py-1 text-center">
                      {isAL ? (
                        <div className="bg-green-300 text-gray-800 text-xs px-1 py-0.5 rounded font-medium">
                          AL
                        </div>
                      ) : isSL ? (
                        <div className="flex items-center justify-center gap-1">
                          <div className="bg-yellow-200 text-gray-800 text-xs px-1 py-0.5 rounded font-medium">
                            SL
                          </div>
                          {isRuleA && (
                            <span className="text-red-600 font-bold text-sm">!</span>
                          )}
                        </div>
                      ) : isNoShow ? (
                        <div className="bg-red-500 text-white text-xs px-1 py-0.5 rounded font-bold">
                          NO-SHOW
                        </div>
                      ) : displayValue ? (() => {
                        const req = allRequirements.find(r => r.tail_number === displayValue);
                        const bgColor = req?.status === 'on_track' ? 'bg-green-500' : 'bg-orange-400';

                        const hasActualTailAssignment = !leaveType && displayValue && displayValue !== 'AL' && displayValue !== 'SL' && displayValue !== 'NO-SHOW';
                        const isRuleB = isApr30 && hasActualTailAssignment && !normalizedTtlLogin && !showFixedState && !isResolved;

                        const allTails = multiTailAssignments[dayKey] || [];
                        const additionalTails = allTails.filter(tail => tail !== displayValue);
                        const hasMultipleTails = additionalTails.length > 0;
                        const tooltipKey = `${dayKey}-${displayValue}`;
                        const isTooltipOpen = showMultiTailTooltip === tooltipKey;

                        return (
                          <div className="flex items-center justify-center gap-1">
                            <div
                              className={`${bgColor} text-white text-xs px-1 py-0.5 rounded font-medium relative ${hasMultipleTails ? 'cursor-pointer' : ''}`}
                              onClick={(e) => {
                                if (hasMultipleTails) {
                                  e.stopPropagation();
                                  setShowMultiTailTooltip(isTooltipOpen ? null : tooltipKey);
                                }
                              }}
                            >
                              {displayValue}
                              {hasMultipleTails && (
                                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-600 rounded-full"></div>
                              )}
                              {isTooltipOpen && hasMultipleTails && (
                                <div
                                  className="absolute z-50 top-full left-1/2 transform -translate-x-1/2 mt-1 bg-slate-700 text-white text-xs px-3 py-2 rounded shadow-lg whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="font-semibold mb-1 text-center">Additional Support</div>
                                  {additionalTails.map((tail, idx) => (
                                    <div key={idx} className="text-center">{idx + 1}. {tail}</div>
                                  ))}
                                  <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-slate-700 rotate-45"></div>
                                </div>
                              )}
                            </div>
                            {isRuleB && (
                              <span className="text-red-600 font-bold text-sm">!</span>
                            )}
                          </div>
                        );
                      })() : (
                        <div className="text-gray-400 text-xs">-</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between px-4 pb-4">
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="font-medium">On Track</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-400 rounded"></div>
            <span className="font-medium">Delay Expected</span>
          </div>
        </div>
        <button
          onClick={handleDownloadMay1}
          className="px-6 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 transition-colors"
        >
          Download
        </button>
      </div>
    </div>
  );
}
