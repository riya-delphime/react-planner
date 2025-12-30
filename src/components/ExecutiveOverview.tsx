import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Users, Calendar, Clock, AlertTriangle, ChevronDown } from 'lucide-react';
import {
  getAllKpiData,
  getAvailableDimensions,
  getMonthlyKpiWithBreakdown,
  getTrainingsExpiringInWeeks,
  groupTrainingsByName,
  type PlanningKpi,
  type MonthlyKpiData,
  type TrainingExpiryGroup,
} from '../lib/kpiData';

// Color palette for dimension breakdown bars
const DIMENSION_COLORS = [
  { bg: 'bg-blue-500', gradient: 'from-blue-500 to-blue-600' },
  { bg: 'bg-emerald-500', gradient: 'from-emerald-500 to-emerald-600' },
  { bg: 'bg-amber-500', gradient: 'from-amber-500 to-amber-600' },
  { bg: 'bg-slate-400', gradient: 'from-slate-400 to-slate-500' }, // Others
];

// KPI type mapping - must match exact values from planning_kpi_cube.kpi column
const KPI_TYPES = {
  AIRCRAFT_COMPLETED: 'Aircraft Completed Per Month',
  AVG_RESOURCES: 'Avg Resources Per Aircraft Per Month',
  LEAVE_DAYS: 'Leave Days Per Month',
  TOTAL_HOURS: 'Total Hours Clocked Per Month',
} as const;

export function ExecutiveOverview() {
  // State for KPI data
  const [kpiData, setKpiData] = useState<PlanningKpi[]>([]);
  const [availableDimensions, setAvailableDimensions] = useState<string[]>(['All']);
  const [selectedDimension, setSelectedDimension] = useState<string>('All');
  const [isLoadingKpi, setIsLoadingKpi] = useState(true);

  // State for training data
  const [trainingGroups, setTrainingGroups] = useState<TrainingExpiryGroup[]>([]);
  const [selectedWeeks, setSelectedWeeks] = useState<number>(4);
  const [isLoadingTraining, setIsLoadingTraining] = useState(true);

  // Fetch KPI data on mount
  useEffect(() => {
    async function fetchKpiData() {
      setIsLoadingKpi(true);
      try {
        const [data, dimensions] = await Promise.all([
          getAllKpiData(),
          getAvailableDimensions(),
        ]);
        setKpiData(data);
        setAvailableDimensions(dimensions);
      } catch (error) {
        console.error('Failed to fetch KPI data:', error);
      } finally {
        setIsLoadingKpi(false);
      }
    }
    fetchKpiData();
  }, []);

  // Fetch training data when weeks selection changes
  useEffect(() => {
    async function fetchTrainingData() {
      setIsLoadingTraining(true);
      try {
        const trainings = await getTrainingsExpiringInWeeks(selectedWeeks);
        const grouped = groupTrainingsByName(trainings);
        setTrainingGroups(grouped);
      } catch (error) {
        console.error('Failed to fetch training data:', error);
        setTrainingGroups([]);
      } finally {
        setIsLoadingTraining(false);
      }
    }
    fetchTrainingData();
  }, [selectedWeeks]);

  // Process KPI data for each chart
  const aircraftData = useMemo(() =>
    getMonthlyKpiWithBreakdown(kpiData, KPI_TYPES.AIRCRAFT_COMPLETED, selectedDimension),
    [kpiData, selectedDimension]
  );

  const resourcesData = useMemo(() =>
    getMonthlyKpiWithBreakdown(kpiData, KPI_TYPES.AVG_RESOURCES, selectedDimension),
    [kpiData, selectedDimension]
  );

  const leavesData = useMemo(() =>
    getMonthlyKpiWithBreakdown(kpiData, KPI_TYPES.LEAVE_DAYS, selectedDimension),
    [kpiData, selectedDimension]
  );

  const hoursData = useMemo(() =>
    getMonthlyKpiWithBreakdown(kpiData, KPI_TYPES.TOTAL_HOURS, selectedDimension),
    [kpiData, selectedDimension]
  );

  // Calculate totals for KPI cards
  const totals = useMemo(() => {
    const avgResourcesSum = resourcesData.reduce((sum, d) => sum + d.total, 0);
    const avgResourcesCount = resourcesData.filter(d => d.total > 0).length;

    return {
      aircraft: aircraftData.reduce((sum, d) => sum + d.total, 0),
      avgResources: avgResourcesCount > 0
        ? (avgResourcesSum / avgResourcesCount).toFixed(1)
        : '0',
      leaves: leavesData.reduce((sum, d) => sum + d.total, 0),
      hours: hoursData.reduce((sum, d) => sum + d.total, 0),
    };
  }, [aircraftData, resourcesData, leavesData, hoursData]);

  // Calculate max values for bar scaling
  const maxValues = useMemo(() => ({
    aircraft: Math.max(...aircraftData.map(d => d.total), 1),
    resources: Math.max(...resourcesData.map(d => d.total), 1),
    leaves: Math.max(...leavesData.map(d => d.total), 1),
    hours: Math.max(...hoursData.map(d => d.total), 1),
  }), [aircraftData, resourcesData, leavesData, hoursData]);

  // Format year-month for display (2022-02 -> Feb 2022)
  const formatYearMonth = (ym: string) => {
    const [year, month] = ym.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  };

  // Render a horizontal bar with optional dimension breakdown
  const renderBar = (
    data: MonthlyKpiData,
    maxValue: number,
    colorGradient: string,
    hoverBg: string,
    textColor: string,
    unit: string
  ) => {
    const hasBreakdown = data.breakdown.length > 0;
    const totalWidth = (data.total / maxValue) * 100;

    return (
      <div className={`${hoverBg} p-2 rounded-xl transition-colors`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm text-slate-700">{formatYearMonth(data.yearMonth)}</span>
          <span className={`font-bold ${textColor} text-lg`}>
            {data.total.toLocaleString()} {unit}
          </span>
        </div>
        <div className="relative h-8 bg-slate-100 rounded-xl overflow-hidden shadow-inner">
          {hasBreakdown ? (
            // Stacked bar with dimension breakdown
            <div className="absolute inset-y-0 left-0 flex h-full" style={{ width: `${totalWidth}%` }}>
              {data.breakdown.map((segment, idx) => {
                const segmentWidth = data.total > 0 ? (segment.value / data.total) * 100 : 0;
                const colorClass = DIMENSION_COLORS[Math.min(idx, DIMENSION_COLORS.length - 1)].bg;
                return (
                  <div
                    key={segment.dimValue}
                    className={`${colorClass} h-full transition-all duration-500 first:rounded-l-xl last:rounded-r-xl relative group cursor-pointer hover:opacity-80`}
                    style={{ width: `${segmentWidth}%` }}
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 shadow-lg pointer-events-none">
                      <div className="font-semibold">{segment.dimValue}</div>
                      <div>{segment.value.toLocaleString()} {unit}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Simple bar without breakdown
            <div
              className={`absolute inset-y-0 left-0 bg-gradient-to-r ${colorGradient} transition-all duration-500 rounded-xl`}
              style={{ width: `${totalWidth}%` }}
            />
          )}
        </div>
        {/* Legend for breakdown */}
        {hasBreakdown && (
          <div className="flex flex-wrap gap-3 mt-2">
            {data.breakdown.map((segment, idx) => {
              const colorClass = DIMENSION_COLORS[Math.min(idx, DIMENSION_COLORS.length - 1)].bg;
              return (
                <div key={segment.dimValue} className="flex items-center gap-1.5 text-xs">
                  <div className={`w-2.5 h-2.5 ${colorClass} rounded`} />
                  <span className="text-slate-600 font-medium">{segment.dimValue}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Dimension Filter */}
      <div className="glass-effect rounded-2xl p-6 shadow-soft-lg border border-white/20">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Executive Overview Dashboard
          </h2>
          <div className="flex items-center gap-3">
            <label className="font-semibold text-sm text-slate-600">Break down by:</label>
            <div className="relative">
              <select
                value={selectedDimension}
                onChange={(e) => setSelectedDimension(e.target.value)}
                className="appearance-none px-4 py-2 pr-10 border-2 border-slate-200 rounded-xl font-semibold text-slate-700 bg-white hover:border-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all cursor-pointer"
              >
                {availableDimensions.map(dim => (
                  <option key={dim} value={dim}>
                    {dim === 'All' ? 'No Breakdown' : dim}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl p-6 shadow-soft-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-6 h-6 text-white/90" />
              <div className="text-sm font-semibold text-white/90 uppercase tracking-wide">Total Aircraft</div>
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              {isLoadingKpi ? '...' : totals.aircraft}
            </div>
            <div className="text-xs text-white/70 font-medium">Last 6 months</div>
          </div>

          <div className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl p-6 shadow-soft-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-6 h-6 text-white/90" />
              <div className="text-sm font-semibold text-white/90 uppercase tracking-wide">Avg Resources</div>
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              {isLoadingKpi ? '...' : totals.avgResources}
            </div>
            <div className="text-xs text-white/70 font-medium">Per aircraft/month</div>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-6 shadow-soft-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-6 h-6 text-white/90" />
              <div className="text-sm font-semibold text-white/90 uppercase tracking-wide">Total Leaves</div>
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              {isLoadingKpi ? '...' : totals.leaves}
            </div>
            <div className="text-xs text-white/70 font-medium">Last 6 months</div>
          </div>

          <div className="bg-gradient-to-br from-violet-500 to-purple-500 rounded-2xl p-6 shadow-soft-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-6 h-6 text-white/90" />
              <div className="text-sm font-semibold text-white/90 uppercase tracking-wide">Total Hours</div>
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              {isLoadingKpi ? '...' : totals.hours.toLocaleString()}
            </div>
            <div className="text-xs text-white/70 font-medium">Last 6 months</div>
          </div>
        </div>
      </div>

      {/* KPI Charts - Row 1 */}
      <div className="grid grid-cols-2 gap-6">
        {/* Aircraft Completed Chart */}
        <div className="glass-effect rounded-2xl shadow-soft-lg border border-white/20 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white p-4 font-bold text-lg">
            Aircraft Completed Per Month
            {selectedDimension !== 'All' && (
              <span className="text-sm font-normal ml-2 opacity-80">by {selectedDimension}</span>
            )}
          </div>
          <div className="p-6">
            {isLoadingKpi ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              </div>
            ) : aircraftData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-slate-500">
                No data available
              </div>
            ) : (
              <div className="space-y-4">
                {aircraftData.map((data, idx) => (
                  <div key={idx}>
                    {renderBar(data, maxValues.aircraft, 'from-blue-500 to-cyan-500', 'hover:bg-blue-50/50', 'text-blue-600', 'Aircraft')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Avg Resources Chart */}
        <div className="glass-effect rounded-2xl shadow-soft-lg border border-white/20 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-4 font-bold text-lg">
            Avg Resources Per Aircraft Per Month
            {selectedDimension !== 'All' && (
              <span className="text-sm font-normal ml-2 opacity-80">by {selectedDimension}</span>
            )}
          </div>
          <div className="p-6">
            {isLoadingKpi ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
              </div>
            ) : resourcesData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-slate-500">
                No data available
              </div>
            ) : (
              <div className="space-y-4">
                {resourcesData.map((data, idx) => (
                  <div key={idx}>
                    {renderBar(data, maxValues.resources, 'from-emerald-500 to-teal-500', 'hover:bg-emerald-50/50', 'text-emerald-600', 'Resources')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Charts - Row 2 */}
      <div className="grid grid-cols-2 gap-6">
        {/* Leave Days Chart */}
        <div className="glass-effect rounded-2xl shadow-soft-lg border border-white/20 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-600 to-orange-600 text-white p-4 font-bold text-lg">
            Leave Days Per Month
            {selectedDimension !== 'All' && (
              <span className="text-sm font-normal ml-2 opacity-80">by {selectedDimension}</span>
            )}
          </div>
          <div className="p-6">
            {isLoadingKpi ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
              </div>
            ) : leavesData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-slate-500">
                No data available
              </div>
            ) : (
              <div className="space-y-4">
                {leavesData.map((data, idx) => (
                  <div key={idx}>
                    {renderBar(data, maxValues.leaves, 'from-amber-500 to-orange-500', 'hover:bg-orange-50/50', 'text-orange-600', 'Days')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Total Hours Chart */}
        <div className="glass-effect rounded-2xl shadow-soft-lg border border-white/20 overflow-hidden">
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 text-white p-4 font-bold text-lg">
            Total Hours Clocked Per Month
            {selectedDimension !== 'All' && (
              <span className="text-sm font-normal ml-2 opacity-80">by {selectedDimension}</span>
            )}
          </div>
          <div className="p-6">
            {isLoadingKpi ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
              </div>
            ) : hoursData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-slate-500">
                No data available
              </div>
            ) : (
              <div className="space-y-4">
                {hoursData.map((data, idx) => (
                  <div key={idx}>
                    {renderBar(data, maxValues.hours, 'from-violet-500 to-purple-500', 'hover:bg-purple-50/50', 'text-purple-600', 'Hours')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Training Renewals Section */}
      <div className="glass-effect rounded-2xl shadow-soft-lg border border-white/20 overflow-hidden">
        <div className="bg-gradient-to-r from-rose-600 to-red-600 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-7 h-7" />
            <span className="font-bold text-lg">Training Renewals Due</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-white/90">Time Window:</label>
            <div className="relative">
              <select
                value={selectedWeeks}
                onChange={(e) => setSelectedWeeks(Number(e.target.value))}
                className="appearance-none px-4 py-2 pr-10 border-2 border-white/30 rounded-xl font-semibold text-rose-900 bg-white hover:border-white/50 focus:border-white focus:ring-2 focus:ring-white/30 transition-all cursor-pointer"
              >
                <option value={2}>Next 2 Weeks</option>
                <option value={4}>Next 4 Weeks</option>
                <option value={6}>Next 6 Weeks</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400 pointer-events-none" />
            </div>
          </div>
        </div>
        <div className="p-6">
          {isLoadingTraining ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
            </div>
          ) : trainingGroups.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500">
              No training renewals due in the next {selectedWeeks} weeks
            </div>
          ) : (
            <div className="space-y-4">
              {trainingGroups.map((group, idx) => (
                <div
                  key={idx}
                  className="border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-red-50 rounded-2xl p-5 hover:border-rose-400 hover:shadow-lg transition-all duration-300"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="font-bold text-lg text-rose-900">{group.trainingName}</div>
                      <div className="text-sm text-rose-700 mt-1 font-medium">
                        <span className="font-semibold">{group.count} employees</span> require renewal
                      </div>
                    </div>
                    <div className="px-5 py-2 bg-gradient-to-br from-rose-600 to-red-600 text-white rounded-full font-bold text-lg shadow-lg">
                      {group.count}
                    </div>
                  </div>
                  <div className="border-t-2 border-rose-200 pt-3 mt-3">
                    <div className="text-xs font-semibold text-rose-800 mb-2 uppercase tracking-wide">
                      Affected Employees:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.employees.slice(0, 6).map((emp, empIdx) => (
                        <span
                          key={empIdx}
                          className="px-3 py-1.5 bg-white border-2 border-rose-300 rounded-lg text-xs font-semibold text-rose-900 hover:bg-rose-50 transition-colors"
                          title={emp.id}
                        >
                          {emp.name}
                        </span>
                      ))}
                      {group.employees.length > 6 && (
                        <span className="px-3 py-1.5 bg-rose-200 border-2 border-rose-400 rounded-lg text-xs font-bold text-rose-900">
                          +{group.employees.length - 6} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Filter Indicator */}
      {selectedDimension !== 'All' && (
        <div className="glass-effect border-2 border-blue-300 rounded-2xl p-5 shadow-soft">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="font-semibold text-blue-900">
              Charts broken down by {selectedDimension} - Showing Top 3 + Others
            </span>
          </div>
        </div>
      )}
    </div>
  );
}