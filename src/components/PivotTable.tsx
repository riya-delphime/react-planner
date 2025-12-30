import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface TailAssignment {
  tailNumber: string;
  cc: number;
  engr: number;
  tech: number;
}

interface PivotTableProps {
  refreshTrigger?: number;
}

export function PivotTable({ refreshTrigger }: PivotTableProps) {
  const [assignedCapacity, setAssignedCapacity] = useState<TailAssignment[]>([]);
  const [availableTotals, setAvailableTotals] = useState({ cc: 0, engr: 0, tech: 0 });
  const [may1Assignments, setMay1Assignments] = useState<TailAssignment[]>([]);

  useEffect(() => {
    loadPivotData();
  }, [refreshTrigger]);

  async function loadPivotData() {
    const may1Date = '2025-05-01';

    const { data: may1Requirements } = await supabase
      .from('requirements')
      .select('*')
      .eq('date', may1Date)
      .order('tail_number');

    const { data: may1AssignmentsData } = await supabase
      .from('assignments')
      .select('resource_id, requirement_id')
      .eq('date', may1Date);

    const { data: allResources } = await supabase
      .from('resources')
      .select('*');

    if (!allResources || !may1Requirements) return;

    // Process May 1st assignments (Red area - Assigned Capacity)
    const assignmentsByTail: Record<string, { cc: number; engr: number; tech: number }> = {};
    const avAssignmentsByTail: Record<string, { cc: number; engr: number; tech: number }> = {};

    // Initialize all May 1st tail numbers with zero counts
    may1Requirements.forEach(req => {
      assignmentsByTail[req.tail_number] = { cc: 0, engr: 0, tech: 0 };
      avAssignmentsByTail[req.tail_number] = { cc: 0, engr: 0, tech: 0 };
    });

    // Count all assignments and separate AV assignments
    if (may1AssignmentsData) {
      may1AssignmentsData.forEach(assignment => {
        const resource = allResources.find(r => r.id === assignment.resource_id);
        const requirement = may1Requirements?.find(r => r.id === assignment.requirement_id);

        if (resource && requirement) {
          const tail = requirement.tail_number;
          if (assignmentsByTail[tail]) {
            // Count in Assigned Capacity (all assignments)
            if (resource.title === 'CC') assignmentsByTail[tail].cc++;
            else if (resource.title === 'ENGR') assignmentsByTail[tail].engr++;
            else if (resource.title === 'TECH') assignmentsByTail[tail].tech++;

            // Count in Available Support (only AV assignments)
            if (resource.support === 'AV') {
              if (resource.title === 'CC') avAssignmentsByTail[tail].cc++;
              else if (resource.title === 'ENGR') avAssignmentsByTail[tail].engr++;
              else if (resource.title === 'TECH') avAssignmentsByTail[tail].tech++;
            }
          }
        }
      });
    }

    const pivotData: TailAssignment[] = Object.keys(assignmentsByTail)
      .sort()
      .map(tail => ({
        tailNumber: tail,
        cc: assignmentsByTail[tail].cc,
        engr: assignmentsByTail[tail].engr,
        tech: assignmentsByTail[tail].tech,
      }));

    setAssignedCapacity(pivotData);

    // Set the AV assignments for the Available Support per-tail breakdown
    const avData: TailAssignment[] = Object.keys(avAssignmentsByTail)
      .sort()
      .map(tail => ({
        tailNumber: tail,
        cc: avAssignmentsByTail[tail].cc,
        engr: avAssignmentsByTail[tail].engr,
        tech: avAssignmentsByTail[tail].tech,
      }));

    setMay1Assignments(avData);

    // Calculate total available support (where support='AV' and not on leave and not assigned on May 1)
    const may1AssignedResourceIds = new Set(may1AssignmentsData?.map(a => a.resource_id) || []);

    const availableResources = allResources.filter(r => {
      const hasLeave = r.leave_data?.['2025-05-01'] === 'AL' || r.leave_data?.['2025-05-01'] === 'SL';
      const isAssigned = may1AssignedResourceIds.has(r.id);
      return r.support === 'AV' && !hasLeave && !isAssigned;
    });

    const totals = {
      cc: availableResources.filter(r => r.title === 'CC').length,
      engr: availableResources.filter(r => r.title === 'ENGR').length,
      tech: availableResources.filter(r => r.title === 'TECH').length,
    };

    setAvailableTotals(totals);
  }

  const maxRows = Math.max(assignedCapacity.length, may1Assignments.length);

  return (
    <div className="bg-white border-2 border-gray-800 rounded">
      <div className="bg-white border-b-2 border-gray-800 p-3">
        <h2 className="text-lg font-bold text-center">Assignment Overview - 01-05-2025</h2>
      </div>

      <div className="overflow-x-auto p-4">
        <table className="w-full border-collapse border-2 border-gray-800">
          <thead>
            <tr>
              <th rowSpan={3} className="border-r-2 border-gray-800 px-3 py-3 text-left font-bold bg-white"></th>
              <th colSpan={3} className="border-r-2 border-gray-800 border-b border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">
                Assigned Capacity
              </th>
              <th colSpan={3} className="border-b border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">
                Available Support
              </th>
            </tr>
            <tr>
              <th className="border-r border-gray-800 border-b-2 border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">CC</th>
              <th className="border-r border-gray-800 border-b-2 border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">ENGR</th>
              <th className="border-r-2 border-gray-800 border-b-2 border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">TECH</th>
              <th className="border-r border-gray-800 border-b-2 border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">CC</th>
              <th className="border-r border-gray-800 border-b-2 border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">ENGR</th>
              <th className="border-b-2 border-gray-800 px-3 py-2 text-center font-bold text-base bg-white">TECH</th>
            </tr>
            <tr className="border-b-2 border-gray-800">
              <th className="border-r border-gray-800 px-3 py-2 text-center bg-white"></th>
              <th className="border-r border-gray-800 px-3 py-2 text-center bg-white"></th>
              <th className="border-r-2 border-gray-800 px-3 py-2 text-center bg-white"></th>
              <th className="border-r border-gray-800 px-3 py-2 text-center font-bold text-lg bg-white">{availableTotals.cc}</th>
              <th className="border-r border-gray-800 px-3 py-2 text-center font-bold text-lg bg-white">{availableTotals.engr}</th>
              <th className="px-3 py-2 text-center font-bold text-lg bg-white">{availableTotals.tech}</th>
            </tr>
          </thead>
          <tbody>
            {assignedCapacity.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-500 border-t-2 border-gray-800">
                  No assignments found
                </td>
              </tr>
            ) : (
              assignedCapacity.map((tail, idx) => {
                const avTail = may1Assignments.find(av => av.tailNumber === tail.tailNumber);
                return (
                  <tr key={idx} className="border-b border-gray-800">
                    <td className="border-r-2 border-gray-800 px-3 py-3 font-bold text-base bg-white">
                      {tail.tailNumber}
                    </td>
                    <td className="border-r border-gray-800 px-3 py-3 text-center bg-red-100 text-base">
                      {tail.cc || ''}
                    </td>
                    <td className="border-r border-gray-800 px-3 py-3 text-center bg-red-100 text-base">
                      {tail.engr || ''}
                    </td>
                    <td className="border-r-2 border-gray-800 px-3 py-3 text-center bg-red-100 text-base">
                      {tail.tech || ''}
                    </td>
                    <td className="border-r border-gray-800 px-3 py-3 text-center bg-yellow-100 text-base">
                      {avTail?.cc || ''}
                    </td>
                    <td className="border-r border-gray-800 px-3 py-3 text-center bg-yellow-100 text-base">
                      {avTail?.engr || ''}
                    </td>
                    <td className="px-3 py-3 text-center bg-yellow-100 text-base">
                      {avTail?.tech || ''}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
