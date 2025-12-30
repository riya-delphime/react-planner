import { useState, useEffect } from 'react';
import { supabase, Resource } from '../lib/supabase';
import { AlertTriangle, X, CheckCircle, XCircle } from 'lucide-react';

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

interface ExceptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFix?: () => void;
  exceptions: Exception[];
  setExceptions: (exceptions: Exception[]) => void;
  resolutionStatus: Map<string, ResolutionStatus>;
  setResolutionStatus: (status: Map<string, ResolutionStatus>) => void;
  selectedReplacements: Record<string, string>;
  setSelectedReplacements: (replacements: Record<string, string>) => void;
  assignedReplacements: Map<string, AssignedReplacement>;
  setAssignedReplacements: (replacements: Map<string, AssignedReplacement>) => void;
  resolvedNoShows: ResolvedNoShow[];
  setResolvedNoShows: (noShows: ResolvedNoShow[]) => void;
}

interface ReplacementCandidate {
  id: string;
  name: string;
  title: string;
  currentTail: string;
  support: string;
}

interface EnrichedCandidateData {
  avlLeaves: number;
  next2WLeaves: number;
  upcomingTraining: string;
  upcomingTrainingDate: string;
  matchScore: number;
}

export interface Exception {
  resourceId: string;
  resourceName: string;
  date: string;
  type: 'no-show' | 'leave-update';
  impact?: string;
  tailNumber?: string;
  title?: string;
  potentialReplacements?: ReplacementCandidate[];
}

interface ContingencyCount {
  tailNumber: string;
  noShowCount: number;
  leaveUpdateCount: number;
}

type TabView = 'summary' | 'recommendations';

export function ExceptionsModal({
  isOpen,
  onClose,
  onApplyFix,
  exceptions,
  setExceptions,
  resolutionStatus,
  setResolutionStatus,
  selectedReplacements,
  setSelectedReplacements,
  assignedReplacements,
  setAssignedReplacements,
  resolvedNoShows,
  setResolvedNoShows
}: ExceptionsModalProps) {
  const [contingencyCounts, setContingencyCounts] = useState<ContingencyCount[]>([]);
  const [activeTab, setActiveTab] = useState<TabView>('summary');
  const [selectedTailFilter, setSelectedTailFilter] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && exceptions.length === 0) {
      loadExceptions();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('summary');
      setSelectedTailFilter(null);
      setAssignmentError(null);
    }
  }, [isOpen]);

  async function loadExceptions() {
    const checkDate = '2025-04-30';

    const { data: resources } = await supabase
      .from('resources')
      .select('*');

    if (!resources) return;

    const { data: assignments } = await supabase
      .from('assignments')
      .select('*, requirements(tail_number, tail_details), resources!inner(name, title)')
      .eq('date', checkDate);

    const { data: apr27Assignments } = await supabase
      .from('assignments')
      .select('*, requirements(tail_number)')
      .eq('date', '2025-04-27');

    const foundExceptions: Exception[] = [];
    const tailNumberMap = new Map<string, { noShowCount: number; leaveUpdateCount: number }>();

    const resourceTailMap = new Map<string, string>();
    assignments?.forEach((assignment: any) => {
      const resourceId = assignment.resource_id;
      const tailNumber = assignment.requirements?.tail_number || 'Unknown';
      resourceTailMap.set(resourceId, tailNumber);
    });

    const apr27TailMap = new Map<string, string>();
    apr27Assignments?.forEach((assignment: any) => {
      const resourceId = assignment.resource_id;
      const tailNumber = assignment.requirements?.tail_number || 'Unknown';
      apr27TailMap.set(resourceId, tailNumber);
    });

    resources.forEach(resource => {
      const loginTime = generateLoginTime(resource.id);
      let normalizedTtlLogin = loginTime && loginTime !== '';
      const leaveType = resource.leave_data?.[checkDate];

      if ((leaveType === 'SL' || leaveType === 'AL') && normalizedTtlLogin) {
        normalizedTtlLogin = false;
      }

      const resourceAssignments = assignments?.filter((a: any) => a.resource_id === resource.id) || [];

      let tailNumber: string | null = null;
      let useApr27Fallback = false;

      if (resourceAssignments.length > 0 && !leaveType) {
        const assignment: any = resourceAssignments[0];
        tailNumber = assignment.requirements?.tail_number || 'Unknown';
      } else if (!leaveType) {
        const apr27Tail = apr27TailMap.get(resource.id);
        if (apr27Tail) {
          tailNumber = apr27Tail;
          useApr27Fallback = true;
        }
      }

      if (tailNumber && !leaveType) {
        if (!tailNumberMap.has(tailNumber)) {
          tailNumberMap.set(tailNumber, { noShowCount: 0, leaveUpdateCount: 0 });
        }

        if (!normalizedTtlLogin) {
          const availableSwaps = generateReplacementCandidates(
            resource,
            resources,
            useApr27Fallback ? apr27TailMap : resourceTailMap,
            checkDate,
            tailNumber
          );

          foundExceptions.push({
            resourceId: resource.id,
            resourceName: resource.name,
            date: checkDate,
            type: 'no-show',
            impact: `${tailNumber}: ${resource.title} short by 1`,
            tailNumber,
            title: resource.title,
            potentialReplacements: availableSwaps,
          });

          tailNumberMap.get(tailNumber)!.noShowCount++;
        }
      }

      if (leaveType === 'SL') {
        const apr26Leave = resource.leave_data?.['2025-04-26'];
        const apr27Leave = resource.leave_data?.['2025-04-27'];
        const wasOnSLBothDays = apr26Leave === 'SL' && apr27Leave === 'SL';

        if (!wasOnSLBothDays) {
          const apr27Tail = apr27TailMap.get(resource.id);
          const tailNumber = apr27Tail || 'Unknown';

          if (!tailNumberMap.has(tailNumber)) {
            tailNumberMap.set(tailNumber, { noShowCount: 0, leaveUpdateCount: 0 });
          }

          tailNumberMap.get(tailNumber)!.leaveUpdateCount++;

          const availableSwaps = generateReplacementCandidates(
            resource,
            resources,
            apr27TailMap,
            checkDate,
            tailNumber
          );

          foundExceptions.push({
            resourceId: resource.id,
            resourceName: resource.name,
            date: checkDate,
            type: 'leave-update',
            impact: `On sick leave (SL) for Apr 30`,
            tailNumber,
            title: resource.title,
            potentialReplacements: availableSwaps,
          });
        }
      }
    });

    setExceptions(foundExceptions);

    const counts = Array.from(tailNumberMap.entries()).map(([tailNumber, counts]) => ({
      tailNumber,
      noShowCount: counts.noShowCount,
      leaveUpdateCount: counts.leaveUpdateCount,
    }));

    setContingencyCounts(counts);

    const defaultStatus = new Map<string, ResolutionStatus>();
    foundExceptions.forEach(exception => {
      defaultStatus.set(exception.resourceId, 'NO_FIX_DEFAULT');
    });
    setResolutionStatus(defaultStatus);
  }

  function generateReplacementCandidates(
    alertResource: Resource,
    allResources: Resource[],
    resourceTailMap: Map<string, string>,
    checkDate: string,
    alertTail: string
  ): ReplacementCandidate[] {
    const candidates = allResources
      .filter(r => {
        if (r.id === alertResource.id) return false;

        const loginTime = generateLoginTime(r.id);
        let normalizedTtlLogin = loginTime && loginTime !== '';
        const leaveType = r.leave_data?.[checkDate];

        if ((leaveType === 'SL' || leaveType === 'AL') && normalizedTtlLogin) {
          normalizedTtlLogin = false;
        }

        if (!normalizedTtlLogin) return false;
        if (leaveType === 'AL' || leaveType === 'SL') return false;

        const candidateCurrentTail = resourceTailMap.get(r.id);
        if (candidateCurrentTail && candidateCurrentTail === alertTail) return false;

        return true;
      })
      .map(r => ({
        id: r.id,
        name: r.name,
        title: r.title,
        currentTail: resourceTailMap.get(r.id) || 'Unassigned',
        support: r.support,
        matchesRole: r.title === alertResource.title,
        supportPriority: getSupportPriority(r.support),
      }))
      .sort((a, b) => {
        if (a.matchesRole !== b.matchesRole) {
          return a.matchesRole ? -1 : 1;
        }
        return b.supportPriority - a.supportPriority;
      })
      .slice(0, 3)
      .map(({ id, name, title, currentTail, support }) => ({
        id,
        name,
        title,
        currentTail,
        support,
      }));

    return candidates;
  }

  function getSupportPriority(support: string): number {
    const priorities: Record<string, number> = {
      'AL': 3,
      'AV': 2,
      'CS': 1,
      'QT': 0,
      'OFF': 0,
    };
    return priorities[support] || 0;
  }

  function generateEnrichedData(employeeId: string): EnrichedCandidateData {
    const hash = employeeId.split('').reduce((acc, char) => {
      return acc + char.charCodeAt(0);
    }, 0);

    const avlLeaves = (hash % 13);
    const next2WLeaves = (hash % 7);
    const matchScore = 55 + (hash % 44);

    const trainings = [
      { name: 'Policy & Procedures Training - Etihad Engineering', days: 15 },
      { name: 'Human Factors Continuation Training', days: 22 },
      { name: 'Fuel Tank Safety Phase 1', days: 8 },
      { name: 'Fuel Tank Safety Phase 2', days: 30 },
    ];

    const trainingIndex = hash % trainings.length;
    const selectedTraining = trainings[trainingIndex];

    const baseDate = new Date('2025-05-01');
    baseDate.setDate(baseDate.getDate() + selectedTraining.days);
    const trainingDate = baseDate.toISOString().split('T')[0];

    return {
      avlLeaves,
      next2WLeaves,
      upcomingTraining: selectedTraining.name,
      upcomingTrainingDate: trainingDate,
      matchScore,
    };
  }

  function formatEnrichedLabel(
    candidate: ReplacementCandidate,
    enrichedData: EnrichedCandidateData
  ): string {
    return `${candidate.name} (${candidate.id}) | Support: ${candidate.support} | Current Tail: ${candidate.currentTail} | Avl Leaves: ${enrichedData.avlLeaves} | Next 2W Leaves: ${enrichedData.next2WLeaves} | Up Coming Trainings: ${enrichedData.upcomingTraining} ${enrichedData.upcomingTrainingDate} | Match: ${enrichedData.matchScore}/100`;
  }

  function generateLoginTime(resourceId: string): string {
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

  function handleAssignAndNotify(exception: Exception) {
    const replacementId = selectedReplacements[exception.resourceId];

    if (!replacementId) {
      setAssignmentError('Please select a replacement');
      setTimeout(() => setAssignmentError(null), 3000);
      return;
    }

    if (assignedReplacements.has(replacementId)) {
      const existing = assignedReplacements.get(replacementId);
      if (existing && existing.alertResourceId !== exception.resourceId) {
        setAssignmentError('Employee already assigned to another alert');
        setTimeout(() => setAssignmentError(null), 3000);
        return;
      }
    }

    const replacement = exception.potentialReplacements?.find(r => r.id === replacementId);
    if (!replacement) {
      setAssignmentError('Invalid replacement selected');
      setTimeout(() => setAssignmentError(null), 3000);
      return;
    }

    const supportNormalized = replacement.support !== 'AV';

    setAssignedReplacements(prev => {
      const newMap = new Map(prev);
      newMap.set(replacementId, {
        employeeId: replacementId,
        alertResourceId: exception.resourceId,
        alertTail: exception.tailNumber || 'Unknown',
        employeeName: replacement.name,
        employeeCurrentTail: replacement.currentTail,
        employeeSupport: supportNormalized ? 'AV' : replacement.support,
        supportNormalized,
      });
      return newMap;
    });

    setResolutionStatus(prev => {
      const newMap = new Map(prev);
      newMap.set(exception.resourceId, 'ASSIGNED');
      return newMap;
    });

    if (exception.type === 'no-show') {
      setResolvedNoShows(prev => {
        const existing = prev.find(ns => ns.resourceId === exception.resourceId);
        if (existing) return prev;
        return [...prev, {
          resourceId: exception.resourceId,
          resourceName: exception.resourceName,
          tailNumber: exception.tailNumber || 'Unknown'
        }];
      });
    }

    setAssignmentError(null);
    onApplyFix?.();
  }

  function handleNoFix(exception: Exception) {
    setResolutionStatus(prev => {
      const newMap = new Map(prev);
      newMap.set(exception.resourceId, 'NO_FIX_EXPLICIT');
      return newMap;
    });

    if (exception.type === 'no-show') {
      setResolvedNoShows(prev => {
        const existing = prev.find(ns => ns.resourceId === exception.resourceId);
        if (existing) return prev;
        return [...prev, {
          resourceId: exception.resourceId,
          resourceName: exception.resourceName,
          tailNumber: exception.tailNumber || 'Unknown'
        }];
      });
    }
  }

  function handleTailClick(tailNumber: string) {
    setSelectedTailFilter(tailNumber);
    setActiveTab('recommendations');
  }

  function getAvailableReplacements(exception: Exception): ReplacementCandidate[] {
    if (!exception.potentialReplacements) return [];

    return exception.potentialReplacements.filter(candidate => {
      if (candidate.currentTail === exception.tailNumber) return false;

      const assignment = assignedReplacements.get(candidate.id);
      if (!assignment) return true;
      return assignment.alertResourceId === exception.resourceId;
    });
  }

  if (!isOpen) return null;

  const openExceptions = exceptions.filter(e => {
    const status = resolutionStatus.get(e.resourceId);
    return status !== 'ASSIGNED' && status !== 'NO_FIX_EXPLICIT';
  });

  const noShowCount = openExceptions.filter(e => e.type === 'no-show').length;
  const leaveUpdateCount = openExceptions.filter(e => e.type === 'leave-update').length;

  const filteredRecommendations = selectedTailFilter
    ? exceptions.filter(e => e.tailNumber === selectedTailFilter)
    : exceptions;

  const openCounts = contingencyCounts.map(count => {
    const tailExceptions = openExceptions.filter(e => e.tailNumber === count.tailNumber);
    const noShow = tailExceptions.filter(e => e.type === 'no-show').length;
    const leaveUpdate = tailExceptions.filter(e => e.type === 'leave-update').length;
    return {
      tailNumber: count.tailNumber,
      noShowCount: noShow,
      leaveUpdateCount: leaveUpdate,
    };
  }).filter(c => c.noShowCount > 0 || c.leaveUpdateCount > 0);

  const allResolved = openExceptions.length === 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden border-2 border-gray-800 flex flex-col">
        <div className="bg-orange-500 text-white p-4 flex items-center justify-between border-b-2 border-gray-800">
          <div className="flex items-center gap-3">
            <AlertTriangle size={28} />
            <h2 className="text-xl font-bold">Exceptions & Recommendations</h2>
            <span className="text-xs bg-orange-600 px-2 py-1 rounded">UI SIMULATION MODE</span>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-orange-600 rounded p-1 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 bg-gray-50 border-b border-gray-300">
          <p className="text-gray-700 mb-4 font-medium">
            Fix Apr 30 issues before locking May 1 plan. Review alert details and take action below.
          </p>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded border border-gray-300 shadow-sm">
              <span className="font-semibold">Open No-show:</span>
              <span className="text-xl font-bold text-red-600">{noShowCount}</span>
            </div>
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded border border-gray-300 shadow-sm">
              <span className="font-semibold">Open Leaves:</span>
              <span className="text-xl font-bold text-orange-600">{leaveUpdateCount}</span>
            </div>
          </div>

          {assignmentError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded text-red-700 text-sm font-medium">
              {assignmentError}
            </div>
          )}
        </div>

        <div className="border-b border-gray-300">
          <div className="flex">
            <button
              onClick={() => {
                setActiveTab('summary');
                setSelectedTailFilter(null);
              }}
              className={`flex-1 px-6 py-3 font-semibold transition-colors ${
                activeTab === 'summary'
                  ? 'bg-white text-gray-900 border-b-2 border-blue-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => setActiveTab('recommendations')}
              className={`flex-1 px-6 py-3 font-semibold transition-colors ${
                activeTab === 'recommendations'
                  ? 'bg-white text-gray-900 border-b-2 border-blue-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Recommendations
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {activeTab === 'summary' && (
            <div>
              {allResolved ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircle size={48} className="mx-auto mb-3 text-green-500" />
                  <p className="text-lg font-medium">All exceptions handled!</p>
                  <p className="text-sm">No active exceptions found for Apr 30</p>
                </div>
              ) : (
                <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-100">
                      <tr className="border-b-2 border-gray-300">
                        <th className="border-r border-gray-300 px-4 py-3 text-left font-bold">Tail Number</th>
                        <th className="border-r border-gray-300 px-4 py-3 text-center font-bold">No-show Count</th>
                        <th className="px-4 py-3 text-center font-bold">Leaves Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openCounts.map((count, idx) => (
                        <tr
                          key={count.tailNumber}
                          onClick={() => handleTailClick(count.tailNumber)}
                          className={`border-b border-gray-200 cursor-pointer hover:bg-blue-50 transition-colors ${
                            idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                          }`}
                        >
                          <td className="border-r border-gray-300 px-4 py-3 font-semibold text-blue-600 hover:underline">
                            {count.tailNumber}
                          </td>
                          <td className="border-r border-gray-300 px-4 py-3 text-center">
                            <span className={`inline-block px-3 py-1 rounded font-bold ${
                              count.noShowCount > 0 ? 'bg-red-100 text-red-700' : 'text-gray-400'
                            }`}>
                              {count.noShowCount}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-3 py-1 rounded font-bold ${
                              count.leaveUpdateCount > 0 ? 'bg-orange-100 text-orange-700' : 'text-gray-400'
                            }`}>
                              {count.leaveUpdateCount}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div>
              {selectedTailFilter && (
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-sm text-gray-600">Filtered by tail:</span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 font-semibold rounded text-sm">
                    {selectedTailFilter}
                  </span>
                  <button
                    onClick={() => setSelectedTailFilter(null)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Clear filter
                  </button>
                </div>
              )}

              {filteredRecommendations.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircle size={48} className="mx-auto mb-3 text-green-500" />
                  <p className="text-lg font-medium">No exceptions found!</p>
                  <p className="text-sm">No active exceptions for this filter</p>
                </div>
              ) : (
                <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr className="border-b-2 border-gray-300">
                          <th className="border-r border-gray-300 px-4 py-3 text-left font-bold min-w-[200px]">Employee Details</th>
                          <th className="border-r border-gray-300 px-4 py-3 text-left font-bold">Tail Assigned</th>
                          <th className="border-r border-gray-300 px-4 py-3 text-left font-bold">Flight/Context</th>
                          <th className="border-r border-gray-300 px-4 py-3 text-left font-bold min-w-[350px]">Recommended Replacements</th>
                          <th className="px-4 py-3 text-center font-bold min-w-[220px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecommendations.map((exception, idx) => {
                          const availableOptions = getAvailableReplacements(exception);
                          const hasOptions = availableOptions.length > 0;
                          const currentSelection = selectedReplacements[exception.resourceId];
                          const status = resolutionStatus.get(exception.resourceId);
                          const isAssigned = status === 'ASSIGNED';
                          const assignedReplacement = currentSelection ? assignedReplacements.get(currentSelection) : null;

                          return (
                            <tr
                              key={exception.resourceId}
                              className={`border-b border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                            >
                              <td className="border-r border-gray-300 px-4 py-3">
                                <div>
                                  <p className="font-semibold text-gray-900">{exception.resourceName}</p>
                                  <p className="text-xs text-gray-600">ID: {exception.resourceId}</p>
                                  <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
                                    exception.type === 'no-show'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-orange-100 text-orange-700'
                                  }`}>
                                    {exception.type === 'no-show' ? 'No-show' : 'Leave'}
                                  </span>
                                </div>
                              </td>
                              <td className="border-r border-gray-300 px-4 py-3 font-semibold">
                                {exception.tailNumber}
                              </td>
                              <td className="border-r border-gray-300 px-4 py-3 text-sm text-gray-700">
                                {exception.impact}
                              </td>
                              <td className="border-r border-gray-300 px-4 py-3">
                                {isAssigned && assignedReplacement ? (
                                  <div className="space-y-1">
                                    <p className="text-sm font-medium text-gray-900">
                                      {(() => {
                                        const replacement = exception.potentialReplacements?.find(r => r.id === currentSelection);
                                        if (replacement) {
                                          const enrichedData = generateEnrichedData(replacement.id);
                                          return formatEnrichedLabel(replacement, enrichedData);
                                        }
                                        return `${assignedReplacement.employeeName} (${currentSelection})`;
                                      })()}
                                    </p>
                                    {assignedReplacement.supportNormalized && (
                                      <p className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded">
                                        Note: Support updated to AV for this assignment.
                                      </p>
                                    )}
                                    <p className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded inline-block">
                                      ✓ Assigned
                                    </p>
                                  </div>
                                ) : hasOptions ? (
                                  <select
                                    value={currentSelection || ''}
                                    onChange={(e) => {
                                      setSelectedReplacements(prev => ({
                                        ...prev,
                                        [exception.resourceId]: e.target.value,
                                      }));
                                      setAssignmentError(null);
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">Select replacement...</option>
                                    {availableOptions.map(replacement => {
                                      const enrichedData = generateEnrichedData(replacement.id);
                                      return (
                                        <option key={replacement.id} value={replacement.id}>
                                          {formatEnrichedLabel(replacement, enrichedData)}
                                        </option>
                                      );
                                    })}
                                  </select>
                                ) : (
                                  <select
                                    disabled
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-gray-100 text-gray-500 cursor-not-allowed"
                                  >
                                    <option>No replacement available</option>
                                  </select>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2 justify-center">
                                  <button
                                    onClick={() => handleNoFix(exception)}
                                    disabled={isAssigned || status === 'NO_FIX_EXPLICIT'}
                                    className={`px-3 py-1.5 font-semibold rounded transition-colors text-xs flex items-center gap-1 ${
                                      isAssigned || status === 'NO_FIX_EXPLICIT'
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                                  >
                                    <XCircle size={14} />
                                    No-Fix
                                  </button>
                                  <button
                                    onClick={() => handleAssignAndNotify(exception)}
                                    disabled={!currentSelection || isAssigned}
                                    className={`px-3 py-1.5 font-semibold rounded transition-colors text-xs flex items-center gap-1 ${
                                      !currentSelection || isAssigned
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : 'bg-blue-600 text-white hover:bg-blue-700'
                                    }`}
                                  >
                                    <CheckCircle size={14} />
                                    Assign & Notify
                                  </button>
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
          )}
        </div>

        <div className="border-t-2 border-gray-800 p-4 bg-gray-50 flex justify-between items-center">
          <div className="text-xs text-gray-600">
            <p className="font-medium">Note: All actions are simulated in UI only. No database changes are made.</p>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-800 text-white font-semibold rounded hover:bg-gray-900 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
