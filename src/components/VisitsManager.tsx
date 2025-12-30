import { useState, useMemo, useEffect } from 'react';
import { Search, X, Edit2, Copy, Trash2, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { Visit } from './VisitIntake';
import CreatableSelect from './CreatableSelect';
import {
  updateVisit,
  deleteVisit,
  createVisit,
  getNextVisitId,
  getCustomers,
  getAircraftTypes,
  getEngineTypes,
  getLicenses,
  getTailNumbers,
  getBays,
  type BayDayWise
} from '../lib/visitData';

interface VisitsManagerProps {
  visits: Visit[];
  onUpdateVisit: (visitId: string, updatedVisit: Visit) => void;
  onDeleteVisit: (visitId: string) => void;
  onDuplicateVisit: (visit: Visit) => void;
  onRefresh?: () => void;
}

const TODAY = '2022-04-30';

export default function VisitsManager({ visits, onUpdateVisit, onDeleteVisit, onDuplicateVisit }: VisitsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [customerFilter, setCustomerFilter] = useState<string>('All');
  const [checkTypeFilter, setCheckTypeFilter] = useState<string>('All');
  const [inductionDateFrom, setInductionDateFrom] = useState('');
  const [inductionDateTo, setInductionDateTo] = useState('');
  const [sortBy, setSortBy] = useState<string>('induction-desc');
  const [tableSortColumn, setTableSortColumn] = useState<string>('inductionDate');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Edit form state
  const [editData, setEditData] = useState<Visit | null>(null);

  // Dropdown options from backend
  const [tailNumbers, setTailNumbers] = useState<string[]>([]);
  const [customers, setCustomersOptions] = useState<string[]>([]);
  const [aircraftTypes, setAircraftTypes] = useState<string[]>([]);
  const [engineTypes, setEngineTypes] = useState<string[]>([]);
  const [licenseOptions, setLicenseOptions] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_bayOptions, setBayOptions] = useState<string[]>([]);

  // Static check types
  const checkTypes = ['A-Check', 'C-Check', 'Periodic Check', 'HSC Check', '12 Year Check', '7 Days Check'];

  // Load dropdown options from backend
  useEffect(() => {
    async function loadLookups() {
      try {
        const [
          tailNumbersData,
          customersData,
          aircraftTypesData,
          engineTypesData,
          licensesData,
          baysData
        ] = await Promise.all([
          getTailNumbers(),
          getCustomers(),
          getAircraftTypes(),
          getEngineTypes(),
          getLicenses(),
          getBays()
        ]);

        setTailNumbers(tailNumbersData);
        setCustomersOptions(customersData);
        setAircraftTypes(aircraftTypesData);
        setEngineTypes(engineTypesData);
        setLicenseOptions(licensesData);
        setBayOptions(baysData);
      } catch (error) {
        console.error('Error loading lookup data:', error);
      }
    }

    loadLookups();
  }, []);

  // Get unique values for filters
  const uniqueCustomers = useMemo(() => Array.from(new Set(visits.map(v => v.customer))), [visits]);
  const uniqueCheckTypes = useMemo(() => Array.from(new Set(visits.map(v => v.checkType))), [visits]);

  // Handle column sort
  const handleColumnSort = (column: string) => {
    if (tableSortColumn === column) {
      setTableSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setTableSortColumn(column);
      setTableSortDirection('asc');
    }
  };

  // Filter and sort visits
  const filteredAndSortedVisits = useMemo(() => {
    let filtered = visits.filter(visit => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery ||
        visit.id.toLowerCase().includes(searchLower) ||
        visit.tailNumber.toLowerCase().includes(searchLower) ||
        visit.poNumber.toLowerCase().includes(searchLower) ||
        visit.customer.toLowerCase().includes(searchLower) ||
        visit.status.toLowerCase().includes(searchLower) ||
        visit.checkType.toLowerCase().includes(searchLower);

      // Status filter
      const matchesStatus = statusFilter === 'All' || visit.status === statusFilter;

      // Customer filter
      const matchesCustomer = customerFilter === 'All' || visit.customer === customerFilter;

      // Check type filter
      const matchesCheckType = checkTypeFilter === 'All' || visit.checkType === checkTypeFilter;

      // Date range filter
      const matchesDateFrom = !inductionDateFrom || visit.inductionDate >= inductionDateFrom;
      const matchesDateTo = !inductionDateTo || visit.inductionDate <= inductionDateTo;

      return matchesSearch && matchesStatus && matchesCustomer && matchesCheckType && matchesDateFrom && matchesDateTo;
    });

    // Sort using table column sort
    filtered.sort((a, b) => {
      const aVal = a[tableSortColumn as keyof Visit];
      const bVal = b[tableSortColumn as keyof Visit];

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      }

      return tableSortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [visits, searchQuery, statusFilter, customerFilter, checkTypeFilter, inductionDateFrom, inductionDateTo, tableSortColumn, tableSortDirection]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, customerFilter, checkTypeFilter, inductionDateFrom, inductionDateTo]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredAndSortedVisits.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedVisits = filteredAndSortedVisits.slice(startIndex, endIndex);

  // Generate page numbers for display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  const handleViewEdit = (visit: Visit) => {
    setSelectedVisit(visit);
    setEditData({ ...visit });
    setEditMode(false);
    setIsDrawerOpen(true);
  };

  const handleStartEdit = () => {
    setEditMode(true);
  };

  const handleCancelEdit = () => {
    if (selectedVisit) {
      setEditData({ ...selectedVisit });
    }
    setEditMode(false);
  };

  const handleSaveEdit = async () => {
    if (!editData) return;

    try {
      const daywiseRescArray = Object.entries(editData.dayWiseRequirements).map(([date, reqs]) => ({
        date,
        CC: reqs.CC,
        ENGR: reqs.ENGR,
        TECH: reqs.TECH
      }));

      const bayDaywiseArray: BayDayWise[] = Array.isArray(editData.bayDaywise)
        ? editData.bayDaywise.filter(b => b && b.bay_id).map(b => ({ date: b.date, bay_id: b.bay_id }))
        : [];

      const updates = {
        po_confirmed: editData.poConfirmed,
        po_number: editData.poNumber,
        tailnum: editData.tailNumber,
        customer: editData.customer,
        check_type: editData.checkType,
        notes: editData.customerNotes,
        aircraft: editData.aircraftType,
        engine: editData.engineType,
        lic_req: editData.licenseRequirements.join(', '),
        license_authorities: editData.licenseRequirements,
        tooling_constraints: editData.toolingConstraints,
        induction_date: editData.inductionDate,
        ets_date: editData.etsDate,
        min_engineers: editData.minEngineers,
        min_technicians: editData.minTechnicians,
        daywise_resc: daywiseRescArray,
        bay_alloc: editData.bayAlloc || '',
        bay_daywise: bayDaywiseArray
      };

      await updateVisit(editData.id, updates);

      onUpdateVisit(editData.id, editData);
      setSelectedVisit(editData);
      setEditMode(false);
      alert('Visit updated successfully!');
    } catch (error) {
      console.error('Error updating visit:', error);
      alert('Error updating visit. Please try again.');
    }
  };

  const handleDelete = async (visitId: string) => {
    if (confirm('Are you sure you want to delete this visit?')) {
      try {
        await deleteVisit(visitId);
        onDeleteVisit(visitId);
        if (selectedVisit?.id === visitId) {
          setIsDrawerOpen(false);
          setSelectedVisit(null);
        }
        alert('Visit deleted successfully!');
      } catch (error) {
        console.error('Error deleting visit:', error);
        alert('Error deleting visit. Please try again.');
      }
    }
  };

  const handleDuplicate = async (visit: Visit) => {
    try {
      const nextVisitId = await getNextVisitId();

      const daywiseRescArray = Object.entries(visit.dayWiseRequirements).map(([date, reqs]) => ({
        date,
        CC: reqs.CC,
        ENGR: reqs.ENGR,
        TECH: reqs.TECH
      }));

      const bayDaywiseArray: BayDayWise[] = (visit.bayDaywise || []).map(item => ({
        date: item.date,
        bay_id: item.bay_id
      }));

      const newVisitRecord = {
        visit_id: nextVisitId,
        po_confirmed: visit.poConfirmed,
        po_number: visit.poNumber,
        tailnum: visit.tailNumber,
        customer: visit.customer,
        check_type: visit.checkType,
        status: 'Upcoming',
        notes: visit.customerNotes,
        aircraft: visit.aircraftType,
        engine: visit.engineType,
        lic_req: visit.licenseRequirements.join(', '),
        license_authorities: visit.licenseRequirements,
        tooling_constraints: visit.toolingConstraints,
        induction_date: visit.inductionDate,
        ets_date: visit.etsDate,
        min_engineers: visit.minEngineers,
        min_technicians: visit.minTechnicians,
        daywise_resc: daywiseRescArray,
        bay_alloc: visit.bayAlloc || '',
        bay_daywise: bayDaywiseArray
      };

      await createVisit(newVisitRecord);
      onDuplicateVisit(visit);
      alert('Visit duplicated successfully!');
    } catch (error) {
      console.error('Error duplicating visit:', error);
      alert('Error duplicating visit. Please try again.');
    }
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedVisit(null);
    setEditData(null);
    setEditMode(false);
  };

  // Check if induction has started
  const isInductionStarted = (inductionDate: string) => {
    return TODAY >= inductionDate;
  };

  const isDateLocked = (date: string, inductionDate: string) => {
    if (!inductionDate) return false;
    return date <= TODAY && date >= inductionDate;
  };

  const handleLicenseToggle = (license: string) => {
    if (!editData) return;
    const newLicenses = editData.licenseRequirements.includes(license)
      ? editData.licenseRequirements.filter(l => l !== license)
      : [...editData.licenseRequirements, license];
    setEditData({ ...editData, licenseRequirements: newLicenses });
  };

  const handleDayWiseChange = (date: string, role: 'CC' | 'ENGR' | 'TECH', value: string) => {
    if (!editData) return;
    const numValue = Math.max(0, parseInt(value) || 0);
    setEditData({
      ...editData,
      dayWiseRequirements: {
        ...editData.dayWiseRequirements,
        [date]: {
          ...editData.dayWiseRequirements[date],
          [role]: numValue,
        },
      },
    });
  };

  // Calculate date range for editing
  const dateRange = useMemo(() => {
    if (!editData) return [];
    const start = new Date(editData.inductionDate);
    const end = new Date(editData.etsDate);
    const dates: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }, [editData?.inductionDate, editData?.etsDate]);

  return (
    <div className="h-full overflow-y-auto p-6 bg-gray-50">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* Page Header */}
        <div className="bg-white border-2 border-gray-800 rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900">Visits Manager</h1>
          <p className="text-gray-600 mt-1">View, search, and manage existing visits</p>
        </div>

        {/* Filters and Search */}
        <div className="bg-white border-2 border-gray-800 rounded-lg p-6">
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Tail, Visit ID, PO #, Customer, Status, or Check Type..."
                className="w-full pl-10 pr-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Filters Row 1 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                >
                  <option value="All">All Status</option>
                  <option value="Upcoming">Upcoming</option>
                  <option value="Ongoing">Ongoing</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                >
                  <option value="All">All Customers</option>
                  {uniqueCustomers.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check Type</label>
                <select
                  value={checkTypeFilter}
                  onChange={(e) => setCheckTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                >
                  <option value="All">All Check Types</option>
                  {uniqueCheckTypes.map(ct => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                >
                  <option value="induction-asc">Induction Date (Earliest)</option>
                  <option value="induction-desc">Induction Date (Latest)</option>
                  <option value="ets-asc">ETS Date (Earliest)</option>
                  <option value="ets-desc">ETS Date (Latest)</option>
                  <option value="tail-asc">Tail Number (A-Z)</option>
                  <option value="tail-desc">Tail Number (Z-A)</option>
                </select>
              </div>
            </div>

            {/* Filters Row 2 - Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Induction Date From</label>
                <input
                  type="date"
                  value={inductionDateFrom}
                  onChange={(e) => setInductionDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Induction Date To</label>
                <input
                  type="date"
                  value={inductionDateTo}
                  onChange={(e) => setInductionDateTo(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Visits Table */}
        <div className="bg-white border-2 border-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                {/* Sortable Headers Row */}
                <tr className="bg-blue-500 text-white">
                  {[
                    { key: 'id', label: 'Visit ID', align: 'left' },
                    { key: 'tailNumber', label: 'Tail', align: 'left' },
                    { key: 'customer', label: 'Customer', align: 'left' },
                    { key: 'checkType', label: 'Check Type', align: 'left' },
                    { key: 'inductionDate', label: 'Induction Date', align: 'left' },
                    { key: 'etsDate', label: 'ETS', align: 'left' },
                    { key: 'minEngineers', label: 'Min Engr', align: 'center' },
                    { key: 'minTechnicians', label: 'Min Tech', align: 'center' },
                    { key: 'status', label: 'Status', align: 'center' },
                  ].map(col => (
                    <th
                      key={col.key}
                      className={`border-2 border-gray-800 px-4 py-3 font-semibold cursor-pointer hover:bg-blue-600 transition-colors select-none ${col.align === 'center' ? 'text-center' : 'text-left'}`}
                      onClick={() => handleColumnSort(col.key)}
                    >
                      <div className={`flex items-center gap-1 ${col.align === 'center' ? 'justify-center' : ''}`}>
                        {col.label}
                        <span className="flex flex-col">
                          <ChevronUp className={`w-3 h-3 -mb-1 ${tableSortColumn === col.key && tableSortDirection === 'asc' ? 'text-white' : 'text-blue-300'}`} />
                          <ChevronDown className={`w-3 h-3 ${tableSortColumn === col.key && tableSortDirection === 'desc' ? 'text-white' : 'text-blue-300'}`} />
                        </span>
                      </div>
                    </th>
                  ))}
                  <th className="border-2 border-gray-800 px-4 py-3 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVisits.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="border-2 border-gray-800 px-4 py-8 text-center text-gray-500">
                      No visits found. Create visits in the Visit Intake & Requirements page.
                    </td>
                  </tr>
                ) : (
                  paginatedVisits.map((visit) => (
                    <tr
                      key={visit.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleViewEdit(visit)}
                    >
                      <td className="border-2 border-gray-800 px-4 py-3 font-medium">{visit.id}</td>
                      <td className="border-2 border-gray-800 px-4 py-3 font-medium">{visit.tailNumber}</td>
                      <td className="border-2 border-gray-800 px-4 py-3">{visit.customer}</td>
                      <td className="border-2 border-gray-800 px-4 py-3">{visit.checkType}</td>
                      <td className="border-2 border-gray-800 px-4 py-3">
                        {new Date(visit.inductionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="border-2 border-gray-800 px-4 py-3">
                        {new Date(visit.etsDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="border-2 border-gray-800 px-4 py-3 text-center">{visit.minEngineers}</td>
                      <td className="border-2 border-gray-800 px-4 py-3 text-center">{visit.minTechnicians}</td>
                      <td className="border-2 border-gray-800 px-4 py-3 text-center">
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                          visit.status === 'Upcoming' ? 'bg-blue-100 text-blue-800' :
                          visit.status === 'Ongoing' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {visit.status}
                        </span>
                      </td>
                      <td className="border-2 border-gray-800 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          {visit.status !== 'Completed' && (
                            <button
                              onClick={() => handleViewEdit(visit)}
                              className="p-2 hover:bg-blue-100 rounded transition-colors"
                              title="View / Edit"
                            >
                              <Edit2 className="w-4 h-4 text-blue-600" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDuplicate(visit)}
                            className="p-2 hover:bg-green-100 rounded transition-colors"
                            title="Duplicate"
                          >
                            <Copy className="w-4 h-4 text-green-600" />
                          </button>
                          {visit.status === 'Upcoming' && (
                            <button
                              onClick={() => handleDelete(visit.id)}
                              className="p-2 hover:bg-red-100 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 border-2 border-gray-300 rounded font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            <div className="flex items-center gap-1">
              {getPageNumbers().map((page, index) => (
                typeof page === 'number' ? (
                  <button
                    key={index}
                    onClick={() => setCurrentPage(page)}
                    className={`w-10 h-10 rounded font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-blue-600 text-white border-2 border-blue-600'
                        : 'border-2 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {page}
                  </button>
                ) : (
                  <span key={index} className="px-2 text-gray-500">...</span>
                )
              ))}
            </div>

            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 border-2 border-gray-300 rounded font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}

        {/* Results Count */}
        <div className="text-sm text-gray-600 text-center">
          Showing {startIndex + 1}-{Math.min(endIndex, filteredAndSortedVisits.length)} of {filteredAndSortedVisits.length} visits
          {filteredAndSortedVisits.length !== visits.length && ` (filtered from ${visits.length} total)`}
        </div>
      </div>

      {/* Detail Drawer */}
      {isDrawerOpen && editData && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={handleCloseDrawer}
          />

          {/* Drawer */}
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-4xl bg-white shadow-xl overflow-y-auto">
            {/* Drawer Header */}
            <div className="sticky top-0 z-10 bg-blue-600 text-white px-6 py-4 flex items-center justify-between border-b-4 border-gray-800">
              <div>
                <h2 className="text-2xl font-bold">{editMode ? 'Edit Visit' : 'Visit Details'}</h2>
                <p className="text-blue-100 text-sm mt-1">{editData.id}</p>
              </div>
              <div className="flex items-center gap-2">
                {!editMode && editData.status !== 'Completed' && (
                  <button
                    onClick={handleStartEdit}
                    className="px-4 py-2 bg-white text-blue-600 font-semibold rounded hover:bg-blue-50 transition-colors flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                )}
                <button
                  onClick={handleCloseDrawer}
                  className="p-2 hover:bg-blue-700 rounded transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Guardrail Warning */}
            {editMode && isInductionStarted(editData.inductionDate) && (
              <div className="bg-yellow-50 border-2 border-yellow-400 p-4 m-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-yellow-900">Visit Induction Has Started</p>
                    <p className="text-sm text-yellow-800 mt-1">
                      After Input Induction Date, Daily Planning cannot be modified for this visit.
                      Dates on or before today ({TODAY}) are locked.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Drawer Content */}
            <div className="p-6 space-y-6">
              {/* Header Card */}
              <div className="bg-white border-2 border-gray-800 rounded-lg">
                <div className="bg-gray-100 px-4 py-3 font-semibold border-b-2 border-gray-800">
                  Visit Header
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tail Number</label>
                      {editMode ? (
                        <CreatableSelect
                          value={editData.tailNumber}
                          onChange={(value) => setEditData({ ...editData, tailNumber: value })}
                          options={tailNumbers}
                          placeholder="Select or type tail number..."
                          className="bg-white border-2 border-gray-300"
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border-2 border-gray-300 rounded bg-gray-100">
                          {editData.tailNumber}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                      {editMode ? (
                        <CreatableSelect
                          value={editData.customer}
                          onChange={(value) => setEditData({ ...editData, customer: value })}
                          options={customers}
                          placeholder="Select or type customer..."
                          className="bg-white border-2 border-gray-300"
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border-2 border-gray-300 rounded bg-gray-100">
                          {editData.customer}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Check Type</label>
                      {editMode ? (
                        <CreatableSelect
                          value={editData.checkType}
                          onChange={(value) => setEditData({ ...editData, checkType: value })}
                          options={checkTypes}
                          placeholder="Select or type check type..."
                          className="bg-white border-2 border-gray-300"
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border-2 border-gray-300 rounded bg-gray-100">
                          {editData.checkType}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <div className="px-3 py-2 bg-gray-100 rounded border-2 border-gray-300 font-medium">
                        {editData.status}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer Notes</label>
                    <textarea
                      value={editData.customerNotes}
                      onChange={(e) => setEditData({ ...editData, customerNotes: e.target.value })}
                      disabled={!editMode}
                      rows={3}
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                    />
                  </div>
                </div>
              </div>

              {/* Technical Requirements Card */}
              <div className="bg-white border-2 border-gray-800 rounded-lg">
                <div className="bg-gray-100 px-4 py-3 font-semibold border-b-2 border-gray-800">
                  Technical Requirements
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Aircraft Type</label>
                      {editMode ? (
                        <CreatableSelect
                          value={editData.aircraftType}
                          onChange={(value) => setEditData({ ...editData, aircraftType: value })}
                          options={aircraftTypes}
                          placeholder="Select or type aircraft type..."
                          className="bg-white border-2 border-gray-300"
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border-2 border-gray-300 rounded bg-gray-100">
                          {editData.aircraftType}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Engine Type</label>
                      {editMode ? (
                        <CreatableSelect
                          value={editData.engineType}
                          onChange={(value) => setEditData({ ...editData, engineType: value })}
                          options={engineTypes}
                          placeholder="Select or type engine type..."
                          className="bg-white border-2 border-gray-300"
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border-2 border-gray-300 rounded bg-gray-100">
                          {editData.engineType}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">License Requirements</label>
                    <div className="flex flex-wrap gap-2">
                      {licenseOptions.map(license => (
                        <button
                          key={license}
                          onClick={() => editMode && handleLicenseToggle(license)}
                          disabled={!editMode}
                          className={`px-4 py-2 rounded-full border-2 font-medium transition-colors ${
                            editData.licenseRequirements.includes(license)
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                          } ${!editMode ? 'cursor-default opacity-75' : ''}`}
                        >
                          {license}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tooling/Constraints</label>
                    <input
                      type="text"
                      value={editData.toolingConstraints}
                      onChange={(e) => setEditData({ ...editData, toolingConstraints: e.target.value })}
                      disabled={!editMode}
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                    />
                  </div>
                </div>
              </div>

              {/* Schedule & Team Sizing Card */}
              <div className="bg-white border-2 border-gray-800 rounded-lg">
                <div className="bg-gray-100 px-4 py-3 font-semibold border-b-2 border-gray-800">
                  Schedule & Team Sizing
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Induction Date</label>
                      <input
                        type="date"
                        value={editData.inductionDate}
                        onChange={(e) => setEditData({ ...editData, inductionDate: e.target.value })}
                        disabled={!editMode || isInductionStarted(editData.inductionDate)}
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">ETS Date</label>
                      <input
                        type="date"
                        value={editData.etsDate}
                        onChange={(e) => setEditData({ ...editData, etsDate: e.target.value })}
                        disabled={!editMode}
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Min Engineers Required</label>
                      <input
                        type="number"
                        min="1"
                        value={editData.minEngineers}
                        onChange={(e) => setEditData({ ...editData, minEngineers: Math.max(1, parseInt(e.target.value) || 1) })}
                        disabled={!editMode}
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Min Technicians Required</label>
                      <input
                        type="number"
                        min="0"
                        value={editData.minTechnicians}
                        onChange={(e) => setEditData({ ...editData, minTechnicians: Math.max(0, parseInt(e.target.value) || 0) })}
                        disabled={!editMode}
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                      />
                    </div>
                  </div>

                  {/* Day-wise Requirements */}
                  {dateRange.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Day-wise Requirements Breakdown <span className="text-gray-500 font-normal">(cannot be modified post-induction date)</span>
                      </label>
                      <div className="overflow-x-auto">
                        <table className="w-full border-2 border-gray-800">
                          <thead>
                            <tr className="bg-blue-500 text-white">
                              <th className="border-2 border-gray-800 px-3 py-2 text-left font-semibold">Role</th>
                              {dateRange.map(date => (
                                <th key={date} className="border-2 border-gray-800 px-3 py-2 text-center font-semibold min-w-[100px]">
                                  {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(['CC', 'ENGR', 'TECH'] as const).map(role => (
                              <tr key={role} className="hover:bg-gray-50">
                                <td className="border-2 border-gray-800 px-3 py-2 font-medium bg-gray-50">
                                  {role}
                                </td>
                                {dateRange.map(date => {
                                  const locked = isDateLocked(date, editData.inductionDate);
                                  return (
                                    <td key={date} className="border-2 border-gray-800 px-2 py-2">
                                      <input
                                        type="number"
                                        min="0"
                                        value={editData.dayWiseRequirements[date]?.[role] || 0}
                                        onChange={(e) => handleDayWiseChange(date, role, e.target.value)}
                                        disabled={!editMode || locked}
                                        className={`w-full px-2 py-1 text-center border-2 rounded focus:outline-none ${
                                          !editMode || locked
                                            ? 'bg-gray-200 border-gray-300 cursor-not-allowed text-gray-500'
                                            : 'border-gray-300 focus:border-blue-500'
                                        }`}
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                            {/* Total Row */}
                            <tr className="bg-gray-100 font-semibold">
                              <td className="border-2 border-gray-800 px-3 py-2">Total</td>
                              {dateRange.map(date => {
                                const total = (editData.dayWiseRequirements[date]?.CC || 0) +
                                             (editData.dayWiseRequirements[date]?.ENGR || 0) +
                                             (editData.dayWiseRequirements[date]?.TECH || 0);
                                return (
                                  <td key={date} className="border-2 border-gray-800 px-3 py-2 text-center">
                                    {total}
                                  </td>
                                );
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Bay Allocation Card */}
              <div className="bg-white border-2 border-gray-800 rounded-lg">
                <div className="bg-gray-100 px-4 py-3 font-semibold border-b-2 border-gray-800">
                  Bay Allocation
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Allocated Bay</label>
                    <input
                      type="text"
                      value={editData.bayAlloc || ''}
                      onChange={(e) => setEditData({ ...editData, bayAlloc: e.target.value })}
                      disabled={!editMode}
                      placeholder="Enter bay identifier (e.g., H1, H2)..."
                      className="w-full md:w-64 px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                    />
                  </div>

                  {/* Day-wise Bay Allocation */}
                  {dateRange.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Day-wise Bay Allocation <span className="text-gray-500 font-normal">(optional)</span>
                      </label>
                      <div className="overflow-x-auto">
                        <table className="w-full border-2 border-gray-800">
                          <thead>
                            <tr className="bg-blue-500 text-white">
                              <th className="border-2 border-gray-800 px-3 py-2 text-left font-semibold">Date</th>
                              <th className="border-2 border-gray-800 px-3 py-2 text-left font-semibold">Bay ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dateRange.map((date, index) => {
                              const locked = isDateLocked(date, editData.inductionDate);
                              const bayValue = Array.isArray(editData.bayDaywise)
                                ? editData.bayDaywise.find(b => b.date === date)?.bay_id || ''
                                : (editData.bayDaywise && typeof editData.bayDaywise === 'object' && date in editData.bayDaywise)
                                  ? (editData.bayDaywise as any)[date]
                                  : '';
                              return (
                                <tr key={date} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="border-2 border-gray-800 px-3 py-2 font-medium">
                                    {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </td>
                                  <td className="border-2 border-gray-800 px-3 py-2">
                                    <input
                                      type="text"
                                      value={bayValue}
                                      onChange={(e) => {
                                        const currentBayDaywise: BayDayWise[] = Array.isArray(editData.bayDaywise) ? editData.bayDaywise : [];
                                        const newBayDaywise: BayDayWise[] = [
                                          ...currentBayDaywise.filter(b => b.date !== date),
                                          { date, bay_id: e.target.value }
                                        ];
                                        setEditData({ ...editData, bayDaywise: newBayDaywise });
                                      }}
                                      disabled={!editMode || locked}
                                      placeholder="Bay ID..."
                                      className={`w-full px-3 py-1 border-2 rounded focus:outline-none ${
                                        !editMode || locked
                                          ? 'bg-gray-200 border-gray-300 cursor-not-allowed text-gray-500'
                                          : 'border-gray-300 focus:border-blue-500'
                                      }`}
                                    />
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
              </div>

              {/* Action Buttons */}
              {editMode && (
                <div className="flex justify-end gap-3 pt-4 border-t-2 border-gray-800">
                  <button
                    onClick={handleCancelEdit}
                    className="px-6 py-2 border-2 border-gray-800 font-semibold rounded hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-6 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
