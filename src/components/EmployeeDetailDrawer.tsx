/**
 * Employee Detail Drawer Component
 *
 * Displays comprehensive employee information in a slide-out drawer.
 * - For Engineers & CC: Full data from emp_360 view
 * - For Technicians: Simplified view (most aircraft worked, most engine worked, current core/support)
 *
 * Features:
 * - Smart license popout (collapsed by default, expandable)
 * - Executive look and feel matching the Work Planning tab design
 * - Responsive drawer animation
 */

import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Award, Calendar, Briefcase, User, Clock, GraduationCap, Plane, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { WorkforceGridRow } from '../lib/workforcePlanningData';

// Employee 360 data structure (for Engineers & CC)
interface Employee360Data {
  emp_id: string;
  emp_name: string;
  title: string;
  profit_center: string;
  team: string;
  date_of_joining: string;
  years_of_experience: number;
  most_worked_aircraft: string;
  licenses: string[];
  license_count: number;
  al_leave_balance: number;
  sl_leave_balance: number;
  total_leave_balance: number;
  upcoming_leaves_4w_count: number;
  upcoming_trainings_4w: string[];
  upcoming_trainings_4w_count: number;
  planned_core: string;
  planned_support: string;
}

// Technician data structure (from emp_cc_tech_work_summary_vw)
interface TechnicianData {
  emp_id: string;
  emp_name: string;
  title: string;
  most_aircraft_worked: string;
  most_engine_worked: string;
  current_core: string;
  current_support: string;
}

// Basic employee info for use when full WorkforceGridRow is not available
export interface BasicEmployeeInfo {
  empId: string;
  name: string;
  role: string;  // 'Engineer', 'CC', 'Technician', etc.
  team: string;
  plannedCore?: string;  // Optional: current core assignment for the selected date
  plannedSupport?: string;  // Optional: current support assignment for the selected date
}

interface EmployeeDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  employee: WorkforceGridRow | BasicEmployeeInfo | null;
  selectedDate: string;
}

export function EmployeeDetailDrawer({ isOpen, onClose, employee, selectedDate }: EmployeeDetailDrawerProps) {
  const [emp360Data, setEmp360Data] = useState<Employee360Data | null>(null);
  const [techData, setTechData] = useState<TechnicianData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLicenseExpanded, setIsLicenseExpanded] = useState(false);

  // Fetch employee data when drawer opens or employee changes
  useEffect(() => {
    if (isOpen && employee) {
      fetchEmployeeData(employee);
    }
  }, [isOpen, employee]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setEmp360Data(null);
      setTechData(null);
      setError(null);
      setIsLicenseExpanded(false);
    }
  }, [isOpen]);

  // Type guard to check if employee is a full WorkforceGridRow
  const isWorkforceGridRow = (emp: WorkforceGridRow | BasicEmployeeInfo): emp is WorkforceGridRow => {
    return 'dateDetails' in emp && emp.dateDetails instanceof Map;
  };

  async function fetchEmployeeData(emp: WorkforceGridRow | BasicEmployeeInfo) {
    setIsLoading(true);
    setError(null);

    // Get current assignments from grid data (if available) or from BasicEmployeeInfo
    let currentCore = 'N/A';
    let currentSupport = 'N/A';

    if (isWorkforceGridRow(emp)) {
      currentCore = emp.dateDetails.get(selectedDate)?.plannedCore || 'N/A';
      currentSupport = emp.dateDetails.get(selectedDate)?.plannedSupport || 'N/A';
    } else {
      // BasicEmployeeInfo - use the passed values if available
      currentCore = emp.plannedCore || 'N/A';
      currentSupport = emp.plannedSupport || 'N/A';
    }

    // Helper to create fallback data from employee info
    const createFallbackEmp360 = (): Employee360Data => ({
      emp_id: emp.empId,
      emp_name: emp.name,
      title: emp.role.toUpperCase(),
      profit_center: '',
      team: emp.team,
      date_of_joining: '',
      years_of_experience: 0,
      most_worked_aircraft: 'N/A',
      licenses: [],
      license_count: 0,
      al_leave_balance: 0,
      sl_leave_balance: 0,
      total_leave_balance: 0,
      upcoming_leaves_4w_count: 0,
      upcoming_trainings_4w: [],
      upcoming_trainings_4w_count: 0,
      planned_core: currentCore,
      planned_support: currentSupport,
    });

    const createFallbackTech = (): TechnicianData => ({
      emp_id: emp.empId,
      emp_name: emp.name,
      title: 'TECH',
      most_aircraft_worked: 'N/A',
      most_engine_worked: 'N/A',
      current_core: currentCore,
      current_support: currentSupport,
    });

    try {
      const role = emp.role.toLowerCase();

      if (role === 'tech' || role === 'technician') {
        // Fetch technician data from emp_cc_tech_work_summary_vw
        // The view uses 'id' column for employee ID
        try {
          const { data, error: fetchError } = await supabase
            .from('emp_cc_tech_work_summary_vw')
            .select('*')
            .eq('id', emp.empId)
            .eq('title', 'TECH')
            .maybeSingle();

          console.log('Technician query result for', emp.empId, ':', data, 'error:', fetchError);

          if (fetchError) {
            console.error('Error fetching technician data:', fetchError);
            setTechData(createFallbackTech());
          } else if (data) {
            // Map view columns to our interface
            // View columns: id, name, mobile, team, title, max_worked_airline, max_worked_aircraft, max_worked_engine
            setTechData({
              emp_id: data.id || emp.empId,
              emp_name: data.name || emp.name,
              title: data.title || 'TECH',
              most_aircraft_worked: data.max_worked_aircraft || 'N/A',
              most_engine_worked: data.max_worked_engine || 'N/A',
              current_core: currentCore,
              current_support: currentSupport,
            });
          } else {
            setTechData(createFallbackTech());
          }
        } catch {
          console.error('Failed to fetch technician data, using fallback');
          setTechData(createFallbackTech());
        }
      } else {
        // Fetch engineer/CC data from emp_360
        // The view uses 'emp_id' column for employee ID (not 'id')
        try {
          const { data, error: fetchError } = await supabase
            .from('emp_360')
            .select('*')
            .eq('emp_id', emp.empId)
            .maybeSingle();

          console.log('emp_360 query result for', emp.empId, ':', data, 'error:', fetchError);

          if (fetchError) {
            console.error('Error fetching emp_360 data:', fetchError);
            // Try alternate view before falling back
            await tryAlternateView(emp, currentCore, currentSupport, createFallbackEmp360);
          } else if (data) {
            // Map emp_360 column names to our interface
            // View columns: emp_id, emp_name, title, profit_center, date_of_joining, team, years_of_exp, most_worked_aircraft, licenses
            setEmp360Data({
              emp_id: data.emp_id || emp.empId,
              emp_name: data.emp_name || emp.name,
              title: data.title || emp.role.toUpperCase(),
              profit_center: data.profit_center || '',
              team: data.team || emp.team,
              date_of_joining: data.date_of_joining || '',
              years_of_experience: data.years_of_exp || data.years_of_experience || 0,
              most_worked_aircraft: data.most_worked_aircraft || 'N/A',
              licenses: data.licenses || [],
              license_count: Array.isArray(data.licenses) ? data.licenses.length : (data.license_count || 0),
              al_leave_balance: data.al_leave_balance || 0,
              sl_leave_balance: data.sl_leave_balance || 0,
              total_leave_balance: data.total_leave_balance || (data.al_leave_balance || 0) + (data.sl_leave_balance || 0),
              upcoming_leaves_4w_count: data.upcoming_leaves_4w_count || 0,
              upcoming_trainings_4w: data.upcoming_trainings_4w || [],
              upcoming_trainings_4w_count: data.upcoming_trainings_4w_count || 0,
              planned_core: data.planned_core || currentCore,
              planned_support: data.planned_support || currentSupport,
            });
          } else {
            // No data found in emp_360, try alternate view
            await tryAlternateView(emp, currentCore, currentSupport, createFallbackEmp360);
          }
        } catch {
          console.error('Failed to fetch emp_360 data, using fallback');
          setEmp360Data(createFallbackEmp360());
        }
      }
    } catch (err) {
      console.error('Error fetching employee data:', err);
      // Always provide fallback data instead of showing error
      const role = emp.role.toLowerCase();
      if (role === 'tech' || role === 'technician') {
        setTechData(createFallbackTech());
      } else {
        setEmp360Data(createFallbackEmp360());
      }
    } finally {
      setIsLoading(false);
    }
  }

  // Helper to try emp_cc_tech_work_summary_vw as alternate data source for CC/Engineers
  async function tryAlternateView(
    emp: WorkforceGridRow | BasicEmployeeInfo,
    currentCore: string,
    currentSupport: string,
    createFallback: () => Employee360Data
  ) {
    try {
      // emp_cc_tech_work_summary_vw columns: id, name, mobile, team, title, max_worked_airline, max_worked_aircraft, max_worked_engine
      const { data: ccData, error: ccError } = await supabase
        .from('emp_cc_tech_work_summary_vw')
        .select('*')
        .eq('id', emp.empId)
        .maybeSingle();

      console.log('Alternate view query result for', emp.empId, ':', ccData, 'error:', ccError);

      if (ccError || !ccData) {
        setEmp360Data(createFallback());
      } else {
        // Map CC/Tech view columns to emp360 format
        setEmp360Data({
          emp_id: ccData.id || emp.empId,
          emp_name: ccData.name || emp.name,
          title: ccData.title || emp.role.toUpperCase(),
          profit_center: '',
          team: ccData.team || emp.team,
          date_of_joining: '',
          years_of_experience: 0,
          most_worked_aircraft: ccData.max_worked_aircraft || 'N/A',
          licenses: [],
          license_count: 0,
          al_leave_balance: 0,
          sl_leave_balance: 0,
          total_leave_balance: 0,
          upcoming_leaves_4w_count: 0,
          upcoming_trainings_4w: [],
          upcoming_trainings_4w_count: 0,
          planned_core: currentCore,
          planned_support: currentSupport,
        });
      }
    } catch {
      setEmp360Data(createFallback());
    }
  }

  // Format date for display
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Calculate years since joining
  const calculateTenure = (dateOfJoining: string): string => {
    if (!dateOfJoining) return 'N/A';
    const joinDate = new Date(dateOfJoining);
    const now = new Date();
    const years = Math.floor((now.getTime() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return `${years} year${years !== 1 ? 's' : ''}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Panel - Centered with responsive width */}
      <div
        className={`relative w-full sm:w-[450px] md:w-[500px] lg:w-[550px] xl:w-[600px] max-h-[90vh] bg-white shadow-2xl overflow-hidden flex flex-col rounded-xl transform transition-all duration-300 ease-out ${
          isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-slate-700 to-slate-800 text-white px-6 py-5 border-b-4 border-slate-900 rounded-t-xl">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                <User className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {employee?.name || 'Employee Details'}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-slate-300 text-sm">{employee?.empId}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    employee?.role === 'Engineer' ? 'bg-purple-500 text-white' :
                    employee?.role === 'CC' ? 'bg-blue-500 text-white' :
                    'bg-cyan-500 text-white'
                  }`}>
                    {employee?.role}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-700"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-700 font-medium">{error}</p>
            </div>
          ) : techData ? (
            // Technician View - Simplified
            <>
              {/* Current Assignments Card */}
              <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-slate-600" />
                  <span className="font-bold text-slate-700">Current Assignments</span>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Current Core</div>
                      <div className="text-lg font-bold text-slate-800">
                        {techData.current_core || 'N/A'}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Current Support</div>
                      <div className="text-lg font-bold text-slate-800">
                        {techData.current_support || 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Work Experience Card */}
              <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-slate-600" />
                  <span className="font-bold text-slate-700">Work Experience</span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Plane className="w-5 h-5 text-blue-600" />
                      </div>
                      <span className="text-slate-600 font-medium">Most Worked Aircraft</span>
                    </div>
                    <span className="text-lg font-bold text-slate-800 bg-blue-50 px-3 py-1 rounded-lg">
                      {techData.most_aircraft_worked || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <Wrench className="w-5 h-5 text-green-600" />
                      </div>
                      <span className="text-slate-600 font-medium">Most Worked Engine</span>
                    </div>
                    <span className="text-lg font-bold text-slate-800 bg-green-50 px-3 py-1 rounded-lg">
                      {techData.most_engine_worked || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : emp360Data ? (
            // Engineer/CC View - Full Details
            <>
              {/* Quick Stats Card */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border-2 border-slate-200 rounded-xl p-4 text-center shadow-sm">
                  <div className="text-2xl font-bold text-purple-600">{emp360Data.years_of_experience || 0}</div>
                  <div className="text-xs font-medium text-slate-500 uppercase mt-1">Years Exp</div>
                </div>
                <div className="bg-white border-2 border-slate-200 rounded-xl p-4 text-center shadow-sm">
                  <div className="text-2xl font-bold text-blue-600">{emp360Data.license_count || 0}</div>
                  <div className="text-xs font-medium text-slate-500 uppercase mt-1">Licenses</div>
                </div>
                <div className="bg-white border-2 border-slate-200 rounded-xl p-4 text-center shadow-sm">
                  <div className="text-2xl font-bold text-green-600">{emp360Data.total_leave_balance || 0}</div>
                  <div className="text-xs font-medium text-slate-500 uppercase mt-1">Leave Bal</div>
                </div>
              </div>

              {/* Current Assignments Card */}
              <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-slate-600" />
                  <span className="font-bold text-slate-700">Current Assignments</span>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Planned Core</div>
                      <div className="text-lg font-bold text-slate-800">
                        {emp360Data.planned_core || (employee && 'dateDetails' in employee ? employee.dateDetails.get(selectedDate)?.plannedCore : null) || 'N/A'}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Planned Support</div>
                      <div className="text-lg font-bold text-slate-800">
                        {emp360Data.planned_support || (employee && 'dateDetails' in employee ? employee.dateDetails.get(selectedDate)?.plannedSupport : null) || 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* License Information Card - Collapsible */}
              {emp360Data.licenses && emp360Data.licenses.length > 0 && (
                <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => setIsLicenseExpanded(!isLicenseExpanded)}
                    className="w-full bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center justify-between hover:from-slate-200 hover:to-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Award className="w-5 h-5 text-slate-600" />
                      <span className="font-bold text-slate-700">License Information</span>
                      <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                        {emp360Data.licenses.length}
                      </span>
                    </div>
                    {isLicenseExpanded ? (
                      <ChevronUp className="w-5 h-5 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-500" />
                    )}
                  </button>
                  {isLicenseExpanded && (
                    <div className="p-5">
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {emp360Data.licenses.map((license, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200"
                          >
                            <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                            <span className="text-sm text-slate-700 font-medium">{license}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!isLicenseExpanded && emp360Data.licenses.length > 0 && (
                    <div className="px-5 py-3 text-sm text-slate-500">
                      <span className="font-medium">{emp360Data.licenses[0]}</span>
                      {emp360Data.licenses.length > 1 && (
                        <span className="text-slate-400"> +{emp360Data.licenses.length - 1} more</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Experience & Skills Card */}
              <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-slate-600" />
                  <span className="font-bold text-slate-700">Experience & Skills</span>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-600">Years of Experience</span>
                    <span className="font-bold text-slate-800">{emp360Data.years_of_experience || 0} years</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-600">Most Worked Aircraft</span>
                    <span className="font-bold text-slate-800 bg-blue-50 px-2 py-1 rounded">
                      {emp360Data.most_worked_aircraft || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-600">Team</span>
                    <span className="font-bold text-slate-800">{emp360Data.team || employee?.team || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">Profit Center</span>
                    <span className="font-bold text-slate-800">{emp360Data.profit_center || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Leave & Availability Card */}
              <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-slate-600" />
                  <span className="font-bold text-slate-700">Leave & Availability</span>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Annual Leave</div>
                      <div className="text-2xl font-bold text-green-700">{emp360Data.al_leave_balance || 0}</div>
                      <div className="text-xs text-green-600">days available</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">Sick Leave</div>
                      <div className="text-2xl font-bold text-blue-700">{emp360Data.sl_leave_balance || 0}</div>
                      <div className="text-xs text-blue-600">days available</div>
                    </div>
                  </div>
                  {emp360Data.upcoming_leaves_4w_count > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-amber-600" />
                      <span className="text-sm text-amber-700 font-medium">
                        {emp360Data.upcoming_leaves_4w_count} day(s) planned in next 4 weeks
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Trainings Card */}
              {emp360Data.upcoming_trainings_4w && emp360Data.upcoming_trainings_4w.length > 0 && (
                <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-slate-600" />
                    <span className="font-bold text-slate-700">Upcoming Trainings (4 Weeks)</span>
                    <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">
                      {emp360Data.upcoming_trainings_4w.length}
                    </span>
                  </div>
                  <div className="p-5">
                    <div className="space-y-2">
                      {emp360Data.upcoming_trainings_4w.map((training, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 px-4 py-3 bg-purple-50 rounded-lg border border-purple-200"
                        >
                          <div className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0"></div>
                          <span className="text-sm text-purple-800 font-medium">{training}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Employee Info Card */}
              {(emp360Data.date_of_joining || emp360Data.profit_center) && (
                <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b-2 border-slate-200 flex items-center gap-2">
                    <User className="w-5 h-5 text-slate-600" />
                    <span className="font-bold text-slate-700">Employee Information</span>
                  </div>
                  <div className="p-5 space-y-3">
                    {emp360Data.date_of_joining && (
                      <>
                        <div className="flex items-center justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">Date of Joining</span>
                          <span className="font-bold text-slate-800">{formatDate(emp360Data.date_of_joining)}</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-slate-600">Tenure</span>
                          <span className="font-bold text-slate-800">{calculateTenure(emp360Data.date_of_joining)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500">
              No employee data available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t-2 border-slate-200 bg-white px-6 py-4">
          <button
            onClick={onClose}
            className="w-full px-6 py-3 bg-gradient-to-r from-slate-700 to-slate-800 text-white font-semibold rounded-xl hover:from-slate-800 hover:to-slate-900 transition-all shadow-lg hover:shadow-xl active:scale-[0.98]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmployeeDetailDrawer;