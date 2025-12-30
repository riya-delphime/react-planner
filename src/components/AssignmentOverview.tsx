import { useState, useEffect } from 'react';
import { supabase, Requirement } from '../lib/supabase';
import { ChevronDown } from 'lucide-react';

interface AssignmentOverviewProps {
  onFilterByTailNumber?: (tailNumber: string | null) => void;
  onAutoAssignComplete?: () => void;
  onDateChange?: (date: string) => void;
  onMay1InputsChange?: (inputs: Record<string, { CC: number; ENGR: number; TECH: number }>) => void;
}

interface TailCapacity {
  tailNumber: string;
  assignedCC: number;
  assignedENGR: number;
  assignedTECH: number;
  availableCC: number;
  availableENGR: number;
  availableTECH: number;
}

export function AssignmentOverview({ onFilterByTailNumber, onAutoAssignComplete, onDateChange, onMay1InputsChange }: AssignmentOverviewProps) {
  const [selectedDate, setSelectedDate] = useState('2025-04-30');
  const [capacities, setCapacities] = useState<TailCapacity[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [hasApr30Exceptions, setHasApr30Exceptions] = useState(false);
  const [unassignedAV, setUnassignedAV] = useState({ CC: 0, ENGR: 0, TECH: 0 });
  const [totalAvailableAV, setTotalAvailableAV] = useState({ CC: 0, ENGR: 0, TECH: 0 });
  const [may1Inputs, setMay1Inputs] = useState<Record<string, { CC: number; ENGR: number; TECH: number }>>({});

  const dates = [
    { value: '2022-04-23', label: '23-04-2022', isPast: true },
    { value: '2022-04-24', label: '24-04-2022', isPast: true },
    { value: '2022-04-25', label: '25-04-2022', isPast: true },
    { value: '2022-04-26', label: '26-04-2022', isPast: true },
    { value: '2022-04-27', label: '27-04-2022', isPast: true },
    { value: '2022-04-30', label: '30-04-2022', isPast: true },
    { value: '2022-05-01', label: '01-05-2022', isPast: false },
  ];

  const currentDate = dates.find(d => d.value === selectedDate);
  const isPastDate = currentDate?.isPast || false;

  useEffect(() => {
    loadCapacities();
    checkApr30Exceptions();
    onDateChange?.(selectedDate);
  }, [selectedDate]);

  async function checkApr30Exceptions() {
    const { data: resources } = await supabase.from('resources').select('*');
    if (!resources) return;

    let exceptionsCount = 0;
    const checkDate = '2025-04-30';

    resources.forEach(resource => {
      const loginTime = generateLoginTime(resource.id);
      const hasLoginTime = loginTime && loginTime !== '';
      const leaveType = resource.leave_data?.[checkDate];

      if (!hasLoginTime && leaveType !== 'AL' && leaveType !== 'SL') {
        exceptionsCount++;
      } else if (leaveType === 'SL') {
        exceptionsCount++;
      }
    });

    setHasApr30Exceptions(exceptionsCount > 0);
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

  async function loadCapacities() {
    const { data: reqs } = await supabase
      .from('requirements')
      .select('*')
      .eq('date', selectedDate);

    if (!reqs) return;

    setRequirements(reqs);

    const dateForAssignments = selectedDate === '2025-05-01' ? '2025-04-30' : selectedDate;

    const { data: assignments } = await supabase
      .from('assignments')
      .select('resource_id, requirement_id, resources!inner(id, title, core, support, leave_data)')
      .eq('date', dateForAssignments);

    const capacityMap = new Map<string, TailCapacity>();

    if (selectedDate === '2025-05-01') {
      const { data: apr30Reqs } = await supabase
        .from('requirements')
        .select('*')
        .eq('date', '2025-04-30');

      reqs.forEach(req => {
        const apr30Req = apr30Reqs?.find(r => r.tail_number === req.tail_number);

        if (!apr30Req) {
          capacityMap.set(req.tail_number, {
            tailNumber: req.tail_number,
            assignedCC: 0,
            assignedENGR: 0,
            assignedTECH: 0,
            availableCC: 0,
            availableENGR: 0,
            availableTECH: 0,
          });
          return;
        }

        const reqAssignments = assignments?.filter(a => a.requirement_id === apr30Req.id) || [];

        const assignedCC = reqAssignments.filter((a: any) =>
          a.resources.title === 'CC' && a.resources.core === a.resources.support
        ).length;

        const assignedENGR = reqAssignments.filter((a: any) =>
          a.resources.title === 'ENGR' && a.resources.core === a.resources.support
        ).length;

        const assignedTECH = reqAssignments.filter((a: any) =>
          a.resources.title === 'TECH' && a.resources.core === a.resources.support
        ).length;

        const availableCC = reqAssignments.filter((a: any) =>
          a.resources.title === 'CC' && a.resources.support === 'AV'
        ).length;

        const availableENGR = reqAssignments.filter((a: any) =>
          a.resources.title === 'ENGR' && a.resources.support === 'AV'
        ).length;

        const availableTECH = reqAssignments.filter((a: any) =>
          a.resources.title === 'TECH' && a.resources.support === 'AV'
        ).length;

        capacityMap.set(req.tail_number, {
          tailNumber: req.tail_number,
          assignedCC,
          assignedENGR,
          assignedTECH,
          availableCC,
          availableENGR,
          availableTECH,
        });
      });
    } else {
      reqs.forEach(req => {
        const reqAssignments = assignments?.filter(a => a.requirement_id === req.id) || [];

        const assignedCC = reqAssignments.filter((a: any) =>
          a.resources.title === 'CC' && a.resources.core === a.resources.support
        ).length;

        const assignedENGR = reqAssignments.filter((a: any) =>
          a.resources.title === 'ENGR' && a.resources.core === a.resources.support
        ).length;

        const assignedTECH = reqAssignments.filter((a: any) =>
          a.resources.title === 'TECH' && a.resources.core === a.resources.support
        ).length;

        const availableCC = reqAssignments.filter((a: any) =>
          a.resources.title === 'CC' && a.resources.support === 'AV'
        ).length;

        const availableENGR = reqAssignments.filter((a: any) =>
          a.resources.title === 'ENGR' && a.resources.support === 'AV'
        ).length;

        const availableTECH = reqAssignments.filter((a: any) =>
          a.resources.title === 'TECH' && a.resources.support === 'AV'
        ).length;

        capacityMap.set(req.tail_number, {
          tailNumber: req.tail_number,
          assignedCC,
          assignedENGR,
          assignedTECH,
          availableCC,
          availableENGR,
          availableTECH,
        });
      });
    }

    setCapacities(Array.from(capacityMap.values()));

    const { data: allResources } = await supabase
      .from('resources')
      .select('id, title, support, leave_data');

    if (allResources) {
      const checkDate = selectedDate === '2025-05-01' ? '2025-04-30' : selectedDate;
      const avResources = allResources.filter((r: any) => {
        if (r.support !== 'AV') return false;
        const leaveType = r.leave_data?.[checkDate];
        return !leaveType || (leaveType !== 'AL' && leaveType !== 'SL');
      });

      if (selectedDate === '2025-05-01') {
        const baselineCC = avResources.filter((r: any) => r.title === 'CC').length;
        const baselineENGR = avResources.filter((r: any) => r.title === 'ENGR').length;
        const baselineTECH = avResources.filter((r: any) => r.title === 'TECH').length;

        setTotalAvailableAV({ CC: baselineCC, ENGR: baselineENGR, TECH: baselineTECH });

        const initialInputs: Record<string, { CC: number; ENGR: number; TECH: number }> = {};
        const capacityArray = Array.from(capacityMap.values());

        capacityArray.forEach(cap => {
          initialInputs[cap.tailNumber] = {
            CC: 0,
            ENGR: 0,
            TECH: 0
          };
        });

        setMay1Inputs(initialInputs);

        setUnassignedAV({
          CC: baselineCC,
          ENGR: baselineENGR,
          TECH: baselineTECH
        });
      } else {
        const assignedResourceIds = new Set(assignments?.map(a => a.resource_id) || []);

        const unassignedCC = avResources.filter((r: any) => r.title === 'CC' && !assignedResourceIds.has(r.id)).length;
        const unassignedENGR = avResources.filter((r: any) => r.title === 'ENGR' && !assignedResourceIds.has(r.id)).length;
        const unassignedTECH = avResources.filter((r: any) => r.title === 'TECH' && !assignedResourceIds.has(r.id)).length;

        setTotalAvailableAV({ CC: unassignedCC, ENGR: unassignedENGR, TECH: unassignedTECH });
        setUnassignedAV({ CC: unassignedCC, ENGR: unassignedENGR, TECH: unassignedTECH });
        setMay1Inputs({});
      }
    }
  }

  async function handleAutoAssign() {
    setIsAutoAssigning(true);

    try {
      const { data: resources } = await supabase
        .from('resources')
        .select('*');

      if (!resources) return;

      const { data: existingAssignments } = await supabase
        .from('assignments')
        .select('resource_id')
        .eq('date', selectedDate);

      const assignedResourceIds = new Set(existingAssignments?.map(a => a.resource_id) || []);
      const newAssignments = [];

      if (selectedDate === '2025-05-01') {
        const { data: previousDayAssignments } = await supabase
          .from('assignments')
          .select('resource_id, requirement_id, resources!inner(support, title), requirements!inner(tail_number)')
          .eq('date', '2025-04-30');

        const nonAVResources = resources.filter(r => {
          if (r.support === 'AV') return false;
          const leaveType = r.leave_data?.['2025-05-01'];
          if (leaveType === 'AL' || leaveType === 'SL') return false;
          return true;
        });

        for (const resource of nonAVResources) {
          if (assignedResourceIds.has(resource.id)) continue;

          const prevAssignment = previousDayAssignments?.find((a: any) => a.resource_id === resource.id);
          if (prevAssignment) {
            const tailNumber = (prevAssignment as any).requirements.tail_number;
            const may1Requirement = requirements.find(r => r.tail_number === tailNumber);

            if (may1Requirement) {
              assignedResourceIds.add(resource.id);
              newAssignments.push({
                requirement_id: may1Requirement.id,
                resource_id: resource.id,
                date: selectedDate,
                role_type: resource.core ? 'core' : 'support',
              });
            }
          }
        }

        for (const resource of nonAVResources) {
          if (assignedResourceIds.has(resource.id)) continue;

          const requirementForCore = requirements.find(r => {
            const tailCode = r.tail_number.split('-').pop();
            return tailCode === resource.core;
          });

          if (requirementForCore) {
            assignedResourceIds.add(resource.id);
            newAssignments.push({
              requirement_id: requirementForCore.id,
              resource_id: resource.id,
              date: selectedDate,
              role_type: resource.core ? 'core' : 'support',
            });
          }
        }

        for (const resource of nonAVResources) {
          if (assignedResourceIds.has(resource.id)) continue;

          const requirementForSupport = requirements.find(r => {
            const tailCode = r.tail_number.split('-').pop();
            return tailCode === resource.support;
          });

          if (requirementForSupport) {
            assignedResourceIds.add(resource.id);
            newAssignments.push({
              requirement_id: requirementForSupport.id,
              resource_id: resource.id,
              date: selectedDate,
              role_type: 'support',
            });
          }
        }

        for (const resource of nonAVResources) {
          if (assignedResourceIds.has(resource.id)) continue;

          if (requirements.length > 0) {
            const anyRequirement = requirements[0];
            assignedResourceIds.add(resource.id);
            newAssignments.push({
              requirement_id: anyRequirement.id,
              resource_id: resource.id,
              date: selectedDate,
              role_type: 'support',
            });
          }
        }

        const avResources = resources.filter(r => r.support === 'AV');

        for (const capacity of capacities) {
          const requirement = requirements.find(r => r.tail_number === capacity.tailNumber);
          if (!requirement) continue;

          for (let i = 0; i < capacity.availableCC; i++) {
            const availableCC = avResources.find(r => r.title === 'CC' && !assignedResourceIds.has(r.id));
            if (availableCC) {
              assignedResourceIds.add(availableCC.id);
              newAssignments.push({
                requirement_id: requirement.id,
                resource_id: availableCC.id,
                date: selectedDate,
                role_type: 'support',
              });
            }
          }

          for (let i = 0; i < capacity.availableENGR; i++) {
            const availableEngr = avResources.find(r => r.title === 'ENGR' && !assignedResourceIds.has(r.id));
            if (availableEngr) {
              assignedResourceIds.add(availableEngr.id);
              newAssignments.push({
                requirement_id: requirement.id,
                resource_id: availableEngr.id,
                date: selectedDate,
                role_type: 'support',
              });
            }
          }

          for (let i = 0; i < capacity.availableTECH; i++) {
            const availableTech = avResources.find(r => r.title === 'TECH' && !assignedResourceIds.has(r.id));
            if (availableTech) {
              assignedResourceIds.add(availableTech.id);
              newAssignments.push({
                requirement_id: requirement.id,
                resource_id: availableTech.id,
                date: selectedDate,
                role_type: 'support',
              });
            }
          }
        }
      } else {
        const avResources = resources.filter(r => r.support === 'AV' && (r.title === 'ENGR' || r.title === 'TECH'));

        for (const capacity of capacities) {
          const requirement = requirements.find(r => r.tail_number === capacity.tailNumber);
          if (!requirement) continue;

          for (let i = 0; i < capacity.availableENGR; i++) {
            const availableEngr = avResources.find(r => r.title === 'ENGR' && !assignedResourceIds.has(r.id));
            if (availableEngr) {
              assignedResourceIds.add(availableEngr.id);
              newAssignments.push({
                requirement_id: requirement.id,
                resource_id: availableEngr.id,
                date: selectedDate,
                role_type: 'support',
              });
            }
          }

          for (let i = 0; i < capacity.availableTECH; i++) {
            const availableTech = avResources.find(r => r.title === 'TECH' && !assignedResourceIds.has(r.id));
            if (availableTech) {
              assignedResourceIds.add(availableTech.id);
              newAssignments.push({
                requirement_id: requirement.id,
                resource_id: availableTech.id,
                date: selectedDate,
                role_type: 'support',
              });
            }
          }
        }
      }

      if (newAssignments.length > 0) {
        await supabase.from('assignments').insert(newAssignments);
        await loadCapacities();
      }

      onAutoAssignComplete?.();
    } finally {
      setIsAutoAssigning(false);
    }
  }

  function handleTailClick(tailNumber: string) {
    onFilterByTailNumber?.(tailNumber);
  }

  function handleCapacityChange(tailNumber: string, field: keyof TailCapacity, value: number) {
    if (isPastDate) return;

    if (selectedDate === '2025-05-01') {
      const roleField = field.replace('available', '') as 'CC' | 'ENGR' | 'TECH';
      const oldValue = may1Inputs[tailNumber]?.[roleField] || 0;
      const newValue = Math.max(0, Math.floor(value));

      const totalAllocated = Object.values(may1Inputs).reduce((sum, input) => sum + input[roleField], 0);
      const otherAllocations = totalAllocated - oldValue;
      const remaining = totalAvailableAV[roleField] - otherAllocations;

      if (newValue > remaining) {
        return;
      }

      const currentTailInputs = may1Inputs[tailNumber] || { CC: 0, ENGR: 0, TECH: 0 };
      setMay1Inputs(prev => ({
        ...prev,
        [tailNumber]: {
          ...currentTailInputs,
          [roleField]: newValue
        }
      }));

      const newTotalAllocated = otherAllocations + newValue;
      setUnassignedAV(prev => ({
        ...prev,
        [roleField]: Math.max(0, totalAvailableAV[roleField] - newTotalAllocated)
      }));
    }

    setCapacities(prev =>
      prev.map(cap =>
        cap.tailNumber === tailNumber
          ? { ...cap, [field]: value }
          : cap
      )
    );
  }

  return (
    <div className="bg-white border-2 border-gray-800 rounded">
      <div className="bg-gray-100 border-b-2 border-gray-800 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Assignment Overview</h2>
          <div className="relative">
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-4 py-2 border-2 border-gray-300 rounded font-medium cursor-pointer pr-8 appearance-none"
            >
              {dates.map(date => (
                <option key={date.value} value={date.value}>
                  {date.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-600" size={20} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-100">
            <tr className="border-b-2 border-gray-800">
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold" rowSpan={2}>Tail Num</th>
              <th className="border-r border-gray-800 px-3 py-2 text-center font-bold" colSpan={3}>
                Assigned Capacity
              </th>
              <th className="px-3 py-2 text-center font-bold bg-green-100" colSpan={3}>
                Available Support
              </th>
            </tr>
            <tr className="border-b-2 border-gray-800">
              <th className="border-r border-gray-800 px-2 py-2 text-center font-bold">CC</th>
              <th className="border-r border-gray-800 px-2 py-2 text-center font-bold">ENGR</th>
              <th className="border-r border-gray-800 px-2 py-2 text-center font-bold">TECH</th>
              <th className="border-r border-gray-800 px-2 py-2 text-center font-bold bg-green-50">CC</th>
              <th className="border-r border-gray-800 px-2 py-2 text-center font-bold bg-green-50">ENGR</th>
              <th className="px-2 py-2 text-center font-bold bg-green-50">TECH</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-gray-800 bg-white">
              <td className="border-r border-gray-300 px-3 py-3 font-bold text-base"></td>
              <td className="border-r border-gray-300 px-2 py-3 text-center bg-pink-50"></td>
              <td className="border-r border-gray-300 px-2 py-3 text-center bg-pink-50"></td>
              <td className="border-r border-gray-300 px-2 py-3 text-center bg-pink-50"></td>
              <td className="border-r border-gray-300 px-2 py-3 text-center bg-green-50 font-bold text-2xl">
                {unassignedAV.CC}
              </td>
              <td className="border-r border-gray-300 px-2 py-3 text-center bg-green-50 font-bold text-2xl">
                {unassignedAV.ENGR}
              </td>
              <td className="px-2 py-3 text-center bg-green-50 font-bold text-2xl">
                {unassignedAV.TECH}
              </td>
            </tr>
            {capacities.map((capacity, idx) => (
              <tr
                key={capacity.tailNumber}
                className={`border-b border-gray-300 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
              >
                <td className="border-r border-gray-300 px-3 py-2 font-bold">
                  <button
                    onClick={() => handleTailClick(capacity.tailNumber)}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {capacity.tailNumber}
                  </button>
                </td>
                <td className="border-r border-gray-300 px-2 py-2 text-center bg-pink-50">
                  {capacity.assignedCC}
                </td>
                <td className="border-r border-gray-300 px-2 py-2 text-center bg-pink-50">
                  {capacity.assignedENGR}
                </td>
                <td className="border-r border-gray-300 px-2 py-2 text-center bg-pink-50">
                  {capacity.assignedTECH}
                </td>
                <td className="border-r border-gray-300 px-2 py-2 text-center bg-green-50">
                  <input
                    type="number"
                    min="0"
                    value={capacity.availableCC}
                    onChange={(e) => handleCapacityChange(capacity.tailNumber, 'availableCC', parseInt(e.target.value) || 0)}
                    disabled={isPastDate}
                    className={`w-full text-center border rounded px-1 py-0.5 ${
                      isPastDate ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                    }`}
                  />
                </td>
                <td className="border-r border-gray-300 px-2 py-2 text-center bg-green-50">
                  <input
                    type="number"
                    min="0"
                    value={capacity.availableENGR}
                    onChange={(e) => handleCapacityChange(capacity.tailNumber, 'availableENGR', parseInt(e.target.value) || 0)}
                    disabled={isPastDate}
                    className={`w-full text-center border rounded px-1 py-0.5 ${
                      isPastDate ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                    }`}
                  />
                </td>
                <td className="px-2 py-2 text-center bg-green-50">
                  <input
                    type="number"
                    min="0"
                    value={capacity.availableTECH}
                    onChange={(e) => handleCapacityChange(capacity.tailNumber, 'availableTECH', parseInt(e.target.value) || 0)}
                    disabled={isPastDate}
                    className={`w-full text-center border rounded px-1 py-0.5 ${
                      isPastDate ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                    }`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isPastDate && (
        <div className="p-4 border-t-2 border-gray-800">
          <button
            onClick={() => {
              if (selectedDate === '2025-05-01') {
                onMay1InputsChange?.(may1Inputs);
                alert('May 1 inputs saved successfully!');
              } else {
                handleAutoAssign();
              }
            }}
            disabled={isAutoAssigning}
            className="w-full py-3 bg-gray-700 text-white font-semibold rounded hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isAutoAssigning ? 'Assigning...' : selectedDate === '2025-05-01' ? 'Save inputs for May 1' : 'Auto Assign Available Support'}
          </button>
        </div>
      )}
    </div>
  );
}
