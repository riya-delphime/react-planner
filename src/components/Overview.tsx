import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface OverviewProps {
  requirements: any[];
  resources: any[];
}

interface BayJob {
  tailNumber: string;
  bay: number;
  startDate: Date;
  endDate: Date;
  status: 'completed' | 'delayed';
  aircraftType: string;
}

interface Assignment {
  id: string;
  requirement_id: string;
  resource_id: string;
  date: string;
  role_type: string;
}

export function Overview({ requirements, resources }: OverviewProps) {
  const minDate = new Date('2025-01-01');
  const maxDate = new Date('2025-04-30');
  const [startDate, setStartDate] = useState(new Date('2025-01-01'));
  const [endDate, setEndDate] = useState(new Date('2025-04-30'));
  const [utilizationView, setUtilizationView] = useState<'team' | 'skill' | 'role'>('team');
  const [allRequirements, setAllRequirements] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [hoveredJob, setHoveredJob] = useState<BayJob | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    fetchAllData();
  }, []);

  async function fetchAllData() {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const [reqRes, assignRes] = await Promise.all([
      supabase.from('requirements').select('*').gte('date', startDateStr).lte('date', endDateStr),
      supabase.from('assignments').select('*').gte('date', startDateStr).lte('date', endDateStr),
    ]);

    if (reqRes.data) setAllRequirements(reqRes.data);
    if (assignRes.data) setAssignments(assignRes.data);
  }

  useEffect(() => {
    fetchAllData();
  }, [startDate, endDate]);

  const getUtilizationData = () => {
    if (!resources || resources.length === 0) return [];

    if (utilizationView === 'team') {
      const teams = new Map<string, number>();
      resources.forEach(r => {
        const team = r.team || 'Unknown';
        teams.set(team, (teams.get(team) || 0) + 1);
      });
      return Array.from(teams.entries()).map(([label, count]) => ({
        label,
        value: Math.round((count / resources.length) * 100)
      }));
    } else if (utilizationView === 'skill') {
      const skills = new Map<string, number>();
      resources.forEach(r => {
        const skill = r.core || 'Unknown';
        skills.set(skill, (skills.get(skill) || 0) + 1);
      });
      return Array.from(skills.entries()).map(([label, count]) => ({
        label,
        value: Math.round((count / resources.length) * 100)
      }));
    } else {
      const roles = new Map<string, number>();
      resources.forEach(r => {
        const role = r.title || 'Unknown';
        roles.set(role, (roles.get(role) || 0) + 1);
      });
      return Array.from(roles.entries()).map(([label, count]) => ({
        label,
        value: Math.round((count / resources.length) * 100)
      }));
    }
  };

  const bayOccupancyData: BayJob[] = useMemo(() => {
    const bayJobs: BayJob[] = [];
    const tailNumberToBay = new Map<string, number>();
    let currentBay = 1;

    allRequirements.forEach(req => {
      const reqDate = new Date(req.date);
      if (!tailNumberToBay.has(req.tail_number)) {
        tailNumberToBay.set(req.tail_number, currentBay);
        currentBay = currentBay === 5 ? 1 : currentBay + 1;
      }

      const bay = tailNumberToBay.get(req.tail_number)!;
      const existingJob = bayJobs.find(j => j.tailNumber === req.tail_number && j.bay === bay);

      if (!existingJob) {
        bayJobs.push({
          tailNumber: req.tail_number,
          bay,
          startDate: reqDate,
          endDate: reqDate,
          status: req.status === 'delay_expected' ? 'delayed' : 'completed',
          aircraftType: req.tail_details || 'Unknown'
        });
      } else {
        if (reqDate < existingJob.startDate) existingJob.startDate = reqDate;
        if (reqDate > existingJob.endDate) existingJob.endDate = reqDate;
      }
    });

    return bayJobs;
  }, [allRequirements]);

  const getWeekdaysInRange = () => {
    const days: Date[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  const weekdays = getWeekdaysInRange();

  const assignmentsByResourceAndDate = useMemo(() => {
    const map = new Map<string, Map<string, string>>();

    resources.forEach(resource => {
      map.set(resource.id, new Map());
    });

    assignments.forEach(assignment => {
      if (!map.has(assignment.resource_id)) {
        map.set(assignment.resource_id, new Map());
      }

      const req = allRequirements.find(r => r.id === assignment.requirement_id);
      if (req) {
        map.get(assignment.resource_id)!.set(assignment.date, req.tail_number);
      }
    });

    return map;
  }, [assignments, allRequirements, resources]);

  const bayUtilization = useMemo(() => {
    if (bayOccupancyData.length === 0 || weekdays.length === 0) return 0;

    let totalBayDays = 0;
    let occupiedBayDays = 0;

    const numBays = 5;
    totalBayDays = numBays * weekdays.length;

    bayOccupancyData.forEach(job => {
      const current = new Date(Math.max(job.startDate.getTime(), startDate.getTime()));
      const end = new Date(Math.min(job.endDate.getTime(), endDate.getTime()));

      while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          occupiedBayDays++;
        }
        current.setDate(current.getDate() + 1);
      }
    });

    return Math.round((occupiedBayDays / totalBayDays) * 100);
  }, [bayOccupancyData, weekdays, startDate, endDate]);

  const resourceUtilization = useMemo(() => {
    if (resources.length === 0 || weekdays.length === 0) return 0;

    let totalResourceDays = 0;
    let assignedResourceDays = 0;

    resources.forEach(resource => {
      const resourceAssignments = assignmentsByResourceAndDate.get(resource.id);

      weekdays.forEach(day => {
        const dateKey = day.toISOString().split('T')[0];
        totalResourceDays++;

        const leaveType = resource.leave_data && resource.leave_data[dateKey];
        if (leaveType && leaveType !== 'NO-SHOW') {
          assignedResourceDays++;
        } else if (resourceAssignments && resourceAssignments.has(dateKey)) {
          assignedResourceDays++;
        }
      });
    });

    return Math.round((assignedResourceDays / totalResourceDays) * 100);
  }, [resources, assignmentsByResourceAndDate, weekdays]);

  const getTailNumberColor = (tailNumber: string, status?: string) => {
    if (status === 'delayed' || status === 'delay_expected') {
      return '#f97316';
    }
    return '#22c55e';
  };

  const getAssignmentForCell = (resourceId: string, date: Date) => {
    const dateKey = date.toISOString().split('T')[0];

    const resource = resources.find(r => r.id === resourceId);
    if (resource?.leave_data && resource.leave_data[dateKey]) {
      return resource.leave_data[dateKey];
    }

    const resourceAssignments = assignmentsByResourceAndDate.get(resourceId);
    if (resourceAssignments && resourceAssignments.has(dateKey)) {
      return resourceAssignments.get(dateKey) || '';
    }

    return '';
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const calculateBayPosition = (jobStart: Date, jobEnd: Date) => {
    const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

    const effectiveStart = jobStart < startDate ? startDate : jobStart;
    const effectiveEnd = jobEnd > endDate ? endDate : jobEnd;

    const startOffset = (effectiveStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const duration = (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24) + 1;

    const left = (startOffset / totalDays) * 100;
    const width = (duration / totalDays) * 100;

    return { left: `${left}%`, width: `${width}%` };
  };

  const generateTimelineLabels = () => {
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const labels: string[] = [];

    if (totalDays <= 14) {
      for (let i = 0; i <= totalDays; i += 2) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        labels.push(date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
      }
    } else if (totalDays <= 60) {
      for (let i = 0; i <= totalDays; i += 7) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        labels.push(date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
      }
    } else {
      let current = new Date(startDate);
      current.setDate(1);

      while (current <= endDate) {
        labels.push(current.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
        current.setMonth(current.getMonth() + 1);
      }
    }

    return labels;
  };

  const timelineLabels = generateTimelineLabels();

  const utilizationData = getUtilizationData();
  const maxUtilization = utilizationData.length > 0 ? Math.max(...utilizationData.map(d => d.value)) : 100;

  return (
    <div className="space-y-6">
      <div className="bg-white border-2 border-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg p-4 shadow-lg min-w-[200px]">
              <div className="text-sm font-medium opacity-90">Bay Utilization</div>
              <div className="text-3xl font-bold mt-1">{bayUtilization}%</div>
            </div>
            <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-lg p-4 shadow-lg min-w-[200px]">
              <div className="text-sm font-medium opacity-90">Resource Utilization</div>
              <div className="text-3xl font-bold mt-1">{resourceUtilization}%</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-700">Date Range:</label>
            <input
              type="date"
              value={startDate.toISOString().split('T')[0]}
              onChange={(e) => setStartDate(new Date(e.target.value))}
              min={minDate.toISOString().split('T')[0]}
              max={endDate.toISOString().split('T')[0]}
              className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            />
            <span className="text-gray-500 font-semibold">to</span>
            <input
              type="date"
              value={endDate.toISOString().split('T')[0]}
              onChange={(e) => setEndDate(new Date(e.target.value))}
              min={startDate.toISOString().split('T')[0]}
              max={maxDate.toISOString().split('T')[0]}
              className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border-2 border-gray-800 rounded-lg p-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">Employee Utilization</h3>
              <select
                value={utilizationView}
                onChange={(e) => setUtilizationView(e.target.value as 'team' | 'skill' | 'role')}
                className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="team">By Team</option>
                <option value="skill">By Skill</option>
                <option value="role">By Role</option>
              </select>
            </div>
            <div className="space-y-3">
              {utilizationData.map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-20 text-sm font-medium text-gray-700">{item.label}</div>
                  <div className="flex-1 bg-gray-200 rounded-full h-8 relative overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full flex items-center justify-end pr-2 transition-all duration-300"
                      style={{ width: `${(item.value / maxUtilization) * 100}%` }}
                    >
                      <span className="text-white text-xs font-bold">{item.value}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Bay Occupancy</h3>
            <div className="relative">
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((bay) => (
                  <div key={bay} className="flex items-center gap-3">
                    <div className="w-16 text-sm font-medium text-gray-700">Bay {bay}</div>
                    <div className="flex-1 bg-white rounded h-12 relative border-2 border-gray-300">
                      {bayOccupancyData
                        .filter(job => job.bay === bay)
                        .map((job, idx) => {
                          const position = calculateBayPosition(job.startDate, job.endDate);
                          const bgColor = getTailNumberColor(job.tailNumber, job.status);
                          return (
                            <div
                              key={idx}
                              className="absolute top-0 h-full flex items-center justify-center text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
                              style={{ ...position, backgroundColor: bgColor }}
                              onMouseEnter={(e) => {
                                setHoveredJob(job);
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 10 });
                              }}
                              onMouseLeave={() => setHoveredJob(null)}
                            >
                              <span className="truncate px-1">{job.tailNumber}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 px-16 text-xs text-gray-600">
                {timelineLabels.map((label, idx) => (
                  <div key={idx} className="text-center" style={{ width: `${100 / (timelineLabels.length - 1)}%` }}>
                    {label}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-6 mt-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded"></div>
                  <span>On Track</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-orange-500 rounded"></div>
                  <span>Delayed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-white border-2 border-gray-300 rounded"></div>
                  <span>Free</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-2 border-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">
          Assignment Table - {formatDate(startDate)} to {formatDate(endDate)}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-800">
                <th className="px-3 py-2 text-left font-bold border-r border-gray-300 sticky left-0 bg-gray-100 z-10">Employee ID</th>
                <th className="px-3 py-2 text-left font-bold border-r border-gray-300 sticky left-[100px] bg-gray-100 z-10 min-w-[140px]">Employee</th>
                <th className="px-3 py-2 text-left font-bold border-r border-gray-300 sticky left-[240px] bg-gray-100 z-10">Team</th>
                <th className="px-3 py-2 text-left font-bold border-r border-gray-300 sticky left-[320px] bg-gray-100 z-10">Core</th>
                <th className="px-3 py-2 text-left font-bold border-r border-gray-300 sticky left-[380px] bg-gray-100 z-10">Title</th>
                <th className="px-3 py-2 text-center font-bold border-r border-gray-300 sticky left-[450px] bg-gray-100 z-10">AL</th>
                <th className="px-3 py-2 text-center font-bold border-r-2 border-gray-800 sticky left-[490px] bg-gray-100 z-10">SL</th>
                {weekdays.map((day, idx) => (
                  <th key={idx} className="px-2 py-2 text-center font-bold border-r border-gray-300 min-w-[90px]">
                    <div>{day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                    <div className="text-[10px] font-normal text-gray-600">
                      {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((employee) => (
                <tr key={employee.id} className="border-b border-gray-300 hover:bg-gray-50">
                  <td className="px-3 py-2 border-r border-gray-300 font-medium sticky left-0 bg-white z-10">{employee.id}</td>
                  <td className="px-3 py-2 border-r border-gray-300 sticky left-[100px] bg-white z-10">{employee.name}</td>
                  <td className="px-3 py-2 border-r border-gray-300 sticky left-[240px] bg-white z-10">{employee.team}</td>
                  <td className="px-3 py-2 border-r border-gray-300 sticky left-[320px] bg-white z-10">{employee.core}</td>
                  <td className="px-3 py-2 border-r border-gray-300 sticky left-[380px] bg-white z-10">{employee.title}</td>
                  <td className="px-3 py-2 border-r border-gray-300 text-center sticky left-[450px] bg-white z-10">
                    {weekdays.filter(day => getAssignmentForCell(employee.id, day) === 'AL').length}
                  </td>
                  <td className="px-3 py-2 border-r-2 border-gray-800 text-center sticky left-[490px] bg-white z-10">
                    {weekdays.filter(day => getAssignmentForCell(employee.id, day) === 'SL').length}
                  </td>
                  {weekdays.map((day, dayIdx) => {
                    const assignment = getAssignmentForCell(employee.id, day);
                    const isLeave = assignment === 'AL' || assignment === 'SL';
                    const requirement = allRequirements.find(r => r.tail_number === assignment && r.date === day.toISOString().split('T')[0]);
                    const bgColor = isLeave ? '' : getTailNumberColor(assignment, requirement?.status);

                    return (
                      <td key={dayIdx} className="px-2 py-2 text-center border-r border-gray-300">
                        {assignment && (
                          <div
                            className={`text-xs px-1 py-0.5 rounded font-medium ${
                              assignment === 'AL'
                                ? 'bg-green-300 text-gray-800'
                                : assignment === 'SL'
                                ? 'bg-yellow-200 text-gray-800'
                                : 'text-white'
                            }`}
                            style={!isLeave ? { backgroundColor: bgColor } : undefined}
                          >
                            {assignment}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {hoveredJob && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-2xl border-2 border-gray-700 min-w-[250px]">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between border-b border-gray-700 pb-2">
                <span className="font-bold text-base">{hoveredJob.tailNumber}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  hoveredJob.status === 'delayed' ? 'bg-orange-500' : 'bg-green-500'
                }`}>
                  {hoveredJob.status === 'delayed' ? 'Delayed' : 'On Track'}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Aircraft Type:</span>
                <span className="ml-2 font-medium">{hoveredJob.aircraftType}</span>
              </div>
              <div>
                <span className="text-gray-400">Start Date:</span>
                <span className="ml-2 font-medium">{formatDate(hoveredJob.startDate)}</span>
              </div>
              <div>
                <span className="text-gray-400">End Date:</span>
                <span className="ml-2 font-medium">{formatDate(hoveredJob.endDate)}</span>
              </div>
            </div>
            <div
              className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderTop: '8px solid #374151',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
