import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AlertCircle, ChevronUp, ChevronDown, Download, Upload, Search, X, Edit2, Copy, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import CreatableSelect from './CreatableSelect';
import {
  createVisit,
  updateVisit,
  deleteVisit,
  getNextVisitId,
  getCustomers,
  getAircraftTypes,
  getEngineTypes,
  getLicenses,
  getTailNumbers,
  getBays,
  type DayWiseRequirement,
  type BayDayWise
} from '../lib/visitData';

export interface Visit {
  id: string;
  poConfirmed: boolean;
  poNumber: string;
  tailNumber: string;
  customer: string;
  checkType: string;
  customerNotes: string;
  aircraftType: string;
  engineType: string;
  licenseRequirements: string[];
  toolingConstraints: string;
  inductionDate: string;
  etsDate: string;
  minEngineers: number;
  minTechnicians: number;
  dayWiseRequirements: {
    [date: string]: {
      CC: number;
      ENGR: number;
      TECH: number;
    };
  };
  bayAlloc: string;
  bayDaywise: BayDayWise[];
  status: 'Upcoming' | 'Ongoing' | 'Completed';
  source?: 'historical' | 'new';
}

interface VisitDetailsProps {
  visits: Visit[];
  visitCounter: number;
  onAddVisit: (visit: Visit) => void;
  onUpdateVisit: (visitId: string, updatedVisit: Visit) => void;
  onDeleteVisit: (visitId: string) => void;
  onIncrementCounter: () => void;
  onRefresh?: () => void;
}

const TODAY = '2022-04-30'; // App's current date

export default function VisitDetails({ 
  visits, 
  visitCounter, 
  onAddVisit, 
  onUpdateVisit,
  onDeleteVisit,
  onIncrementCounter 
}: VisitDetailsProps) {
  // File input refs for Excel upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bayFileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [poConfirmed, setPoConfirmed] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [tailNumber, setTailNumber] = useState('');
  const [customer, setCustomer] = useState('');
  const [checkType, setCheckType] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [aircraftType, setAircraftType] = useState('');
  const [engineType, setEngineType] = useState('');
  const [licenseRequirements, setLicenseRequirements] = useState<string[]>([]);
  const [toolingConstraints, setToolingConstraints] = useState('');
  const [inductionDate, setInductionDate] = useState('');
  const [etsDate, setEtsDate] = useState('');
  const [minEngineers, setMinEngineers] = useState(0);
  const [minTechnicians, setMinTechnicians] = useState(0);
  const [dayWiseRequirements, setDayWiseRequirements] = useState<Visit['dayWiseRequirements']>({});
  const [bayAlloc, setBayAlloc] = useState('');
  const [bayDaywise, setBayDaywise] = useState<{[date: string]: string}>({});
  const [isSaving, setIsSaving] = useState(false);

  // Table search state - single search bar
  const [searchQuery, setSearchQuery] = useState('');
  
  // Table sorting state
  const [tableSortColumn, setTableSortColumn] = useState<string>('inductionDate');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state for saved visits table
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Dropdown options from backend
  const [tailNumbers, setTailNumbers] = useState<string[]>([]);
  const [customers, setCustomers] = useState<string[]>([]);
  const [aircraftTypes, setAircraftTypes] = useState<string[]>([]);
  const [engineTypes, setEngineTypes] = useState<string[]>([]);
  const [licenseOptions, setLicenseOptions] = useState<string[]>([]);
  const [bayOptions, setBayOptions] = useState<string[]>([]);
  const [isLoadingLookups, setIsLoadingLookups] = useState(true);

  // Static check types (not in backend yet)
  const checkTypes = ['A-Check', 'C-Check', 'Periodic Check', 'HSC Check', '12 Year Check', '7 Days Check'];

  // Edit drawer state
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Visit | null>(null);

  // Load dropdown options from backend
  useEffect(() => {
    async function loadLookups() {
      setIsLoadingLookups(true);
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
        setCustomers(customersData);
        setAircraftTypes(aircraftTypesData);
        setEngineTypes(engineTypesData);
        setLicenseOptions(licensesData);
        setBayOptions(baysData);
      } catch (error) {
        console.error('Error loading lookup data:', error);
      } finally {
        setIsLoadingLookups(false);
      }
    }

    loadLookups();
  }, []);

  const visitId = `VIS-${visitCounter.toString().padStart(5, '0')}`;

  // Calculate date range
  const dateRange = useMemo(() => {
    if (!inductionDate || !etsDate) return [];
    const start = new Date(inductionDate);
    const end = new Date(etsDate);
    const dates: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }, [inductionDate, etsDate]);

  // Initialize day-wise requirements and bay allocations when dates change
  React.useEffect(() => {
    if (dateRange.length > 0) {
      const newReqs: Visit['dayWiseRequirements'] = {};
      const newBays: {[date: string]: string} = {};
      dateRange.forEach(date => {
        if (!dayWiseRequirements[date]) {
          newReqs[date] = { CC: 0, ENGR: 0, TECH: 0 };
        } else {
          newReqs[date] = dayWiseRequirements[date];
        }
        if (bayDaywise[date]) {
          newBays[date] = bayDaywise[date];
        } else {
          newBays[date] = '';
        }
      });
      setDayWiseRequirements(newReqs);
      setBayDaywise(newBays);
    }
  }, [dateRange]);

  // Calculate suggested min team size
  const suggestedMinSize = useMemo(() => {
    if (Object.keys(dayWiseRequirements).length === 0) return 0;
    let max = 0;
    Object.values(dayWiseRequirements).forEach(day => {
      const total = day.CC + day.ENGR + day.TECH;
      if (total > max) max = total;
    });
    return max;
  }, [dayWiseRequirements]);

  // Check if date is locked (induction has passed)
  const isDateLocked = (date: string) => {
    if (!inductionDate) return false;
    return date <= TODAY && date >= inductionDate;
  };

  const isAfterInduction = inductionDate && TODAY >= inductionDate;

  // Filter and sort visits based on search query
  const filteredAndSortedVisits = useMemo(() => {
    let filtered = visits.filter(visit => {
      if (!searchQuery) return true;
      
      const searchLower = searchQuery.toLowerCase();
      return (
        visit.id.toLowerCase().includes(searchLower) ||
        visit.tailNumber.toLowerCase().includes(searchLower) ||
        visit.poNumber.toLowerCase().includes(searchLower) ||
        visit.customer.toLowerCase().includes(searchLower) ||
        visit.status.toLowerCase().includes(searchLower) ||
        visit.checkType.toLowerCase().includes(searchLower) ||
        visit.aircraftType.toLowerCase().includes(searchLower) ||
        visit.engineType.toLowerCase().includes(searchLower) ||
        visit.inductionDate.includes(searchLower) ||
        visit.etsDate.includes(searchLower)
      );
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
  }, [visits, searchQuery, tableSortColumn, tableSortDirection]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Calculate pagination for saved visits
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

  // Handle column sort click
  const handleTableSort = (column: string) => {
    if (tableSortColumn === column) {
      setTableSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setTableSortColumn(column);
      setTableSortDirection('asc');
    }
  };

  const handleDayWiseChange = (date: string, role: 'CC' | 'ENGR' | 'TECH', value: string) => {
    const numValue = Math.max(0, parseInt(value) || 0);
    setDayWiseRequirements(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [role]: numValue,
      },
    }));
  };

  const handlePaste = (e: React.ClipboardEvent, startRole: 'CC' | 'ENGR' | 'TECH', startDateIndex: number) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text');
    const rows = pasteData.split('\n').map(row => row.split('\t'));

    const roles: ('CC' | 'ENGR' | 'TECH')[] = ['CC', 'ENGR', 'TECH'];
    const startRoleIndex = roles.indexOf(startRole);

    const newReqs = { ...dayWiseRequirements };

    rows.forEach((row, rowIndex) => {
      const currentRoleIndex = startRoleIndex + rowIndex;
      if (currentRoleIndex >= roles.length) return;
      const currentRole = roles[currentRoleIndex];

      row.forEach((cell, colIndex) => {
        const currentDateIndex = startDateIndex + colIndex;
        if (currentDateIndex >= dateRange.length) return;
        const currentDate = dateRange[currentDateIndex];

        if (isDateLocked(currentDate)) return;

        const value = parseInt(cell.trim()) || 0;
        if (!newReqs[currentDate]) {
          newReqs[currentDate] = { CC: 0, ENGR: 0, TECH: 0 };
        }
        newReqs[currentDate][currentRole] = Math.max(0, value);
      });
    });

    setDayWiseRequirements(newReqs);
  };

  const handleLicenseToggle = (license: string) => {
    setLicenseRequirements(prev =>
      prev.includes(license)
        ? prev.filter(l => l !== license)
        : [...prev, license]
    );
  };

  const calculateStatus = (induction: string, ets: string): Visit['status'] => {
    if (TODAY < induction) return 'Upcoming';
    if (TODAY >= induction && TODAY <= ets) return 'Ongoing';
    return 'Completed';
  };

  const handleSave = async () => {
    if (isSaving) return;

    // Validation
    if (poConfirmed && !poNumber) {
      alert('PO Number is required when PO is confirmed');
      return;
    }
    if (!tailNumber || !customer || !checkType || !aircraftType || !engineType || !inductionDate || !etsDate) {
      alert('Please fill in all required fields');
      return;
    }
    if (etsDate < inductionDate) {
      alert('ETS Date must be greater than or equal to Induction Date');
      return;
    }

    setIsSaving(true);

    try {
      const nextVisitId = await getNextVisitId();

      const daywiseRescArray: DayWiseRequirement[] = Object.entries(dayWiseRequirements).map(([date, reqs]) => ({
        date,
        CC: reqs.CC,
        ENGR: reqs.ENGR,
        TECH: reqs.TECH
      }));

      // Fill in date gaps for bay allocations
      const specifiedBays = Object.entries(bayDaywise)
        .filter(([_, bay]) => bay)
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB));

      const filledBayDaywise: {[date: string]: string} = {};

      if (specifiedBays.length > 0) {
        dateRange.forEach(date => {
          let applicableBay = '';
          for (let i = 0; i < specifiedBays.length; i++) {
            const [bayDate, bayId] = specifiedBays[i];
            if (bayDate <= date) {
              applicableBay = bayId;
            } else {
              break;
            }
          }
          if (applicableBay) {
            filledBayDaywise[date] = applicableBay;
          }
        });
      }

      const bayDaywiseArray: BayDayWise[] = Object.entries(filledBayDaywise)
        .map(([date, bay_id]) => ({
          date,
          bay_id
        }));

      const visitRecord = {
        visit_id: nextVisitId,
        po_confirmed: poConfirmed,
        po_number: poNumber,
        tailnum: tailNumber,
        customer,
        check_type: checkType,
        status: calculateStatus(inductionDate, etsDate),
        notes: customerNotes,
        aircraft: aircraftType,
        engine: engineType,
        lic_req: licenseRequirements.join(', '),
        license_authorities: licenseRequirements,
        tooling_constraints: toolingConstraints,
        induction_date: inductionDate,
        ets_date: etsDate,
        min_engineers: minEngineers,
        min_technicians: minTechnicians,
        daywise_resc: daywiseRescArray,
        bay_alloc: bayAlloc,
        bay_daywise: bayDaywiseArray
      };

      await createVisit(visitRecord);

      const newVisit: Visit = {
        id: nextVisitId,
        poConfirmed,
        poNumber,
        tailNumber,
        customer,
        checkType,
        customerNotes,
        aircraftType,
        engineType,
        licenseRequirements,
        toolingConstraints,
        inductionDate,
        etsDate,
        minEngineers,
        minTechnicians,
        dayWiseRequirements,
        bayAlloc,
        bayDaywise: bayDaywiseArray,
        status: calculateStatus(inductionDate, etsDate),
      };

      onAddVisit(newVisit);
      onIncrementCounter();
      handleReset();
      alert('Visit saved successfully!');
    } catch (error) {
      console.error('Error saving visit:', error);
      alert('Error saving visit. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPoConfirmed(false);
    setPoNumber('');
    setTailNumber('');
    setCustomer('');
    setCheckType('');
    setCustomerNotes('');
    setAircraftType('');
    setEngineType('');
    setLicenseRequirements([]);
    setToolingConstraints('');
    setInductionDate('');
    setEtsDate('');
    setMinEngineers(0);
    setMinTechnicians(0);
    setDayWiseRequirements({});
    setBayAlloc('');
    setBayDaywise({});
  };

  // Download Excel template for day-wise requirements
  const handleDownloadTemplate = () => {
    if (dateRange.length === 0) {
      alert('Please set Induction and ETS dates first to generate the template.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Resource Requirements
    const resourceHeader = ['Role', ...dateRange.map(date =>
      new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    )];
    const resourceData = [
      resourceHeader,
      ['CC', ...dateRange.map(() => 0)],
      ['ENGR', ...dateRange.map(() => 0)],
      ['TECH', ...dateRange.map(() => Math.floor(Math.random() * 11) + 10)],
    ];
    const wsResource = XLSX.utils.aoa_to_sheet(resourceData);
    XLSX.utils.book_append_sheet(wb, wsResource, 'Resource Requirements');

    // Sheet 2: Bay Allocation
    const bayHeader = ['Date', 'Bay ID'];
    const bayData = [
      bayHeader,
      ...dateRange.map(date => [
        new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ''
      ])
    ];
    const wsBay = XLSX.utils.aoa_to_sheet(bayData);
    XLSX.utils.book_append_sheet(wb, wsBay, 'Bay Allocation');

    XLSX.writeFile(wb, `visit_requirements_template_${inductionDate}_to_${etsDate}.xlsx`);
  };

  // Handle Excel file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (dateRange.length === 0) {
      alert('Please set Induction and ETS dates first before uploading.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        // Parse Resource Requirements sheet
        const resourceSheet = workbook.Sheets['Resource Requirements'];
        if (resourceSheet) {
          const resourceData = XLSX.utils.sheet_to_json<string[]>(resourceSheet, { header: 1 });

          if (resourceData.length >= 4) {
            const ccRow = resourceData[1] as (string | number)[];
            const engrRow = resourceData[2] as (string | number)[];
            const techRow = resourceData[3] as (string | number)[];

            const newReqs: Visit['dayWiseRequirements'] = {};

            dateRange.forEach((date, index) => {
              const colIndex = index + 1;
              newReqs[date] = {
                CC: parseInt(String(ccRow[colIndex])) || 0,
                ENGR: parseInt(String(engrRow[colIndex])) || 0,
                TECH: parseInt(String(techRow[colIndex])) || 0,
              };
            });

            setDayWiseRequirements(newReqs);
          }
        }

        // Parse Bay Allocation sheet
        const baySheet = workbook.Sheets['Bay Allocation'];
        if (baySheet) {
          const bayData = XLSX.utils.sheet_to_json<string[]>(baySheet, { header: 1 });

          if (bayData.length > 1) {
            const newBays: {[date: string]: string} = {};

            bayData.slice(1).forEach((row, index) => {
              if (index < dateRange.length && row[1]) {
                newBays[dateRange[index]] = String(row[1]);
              }
            });

            setBayDaywise(prev => ({ ...prev, ...newBays }));
          }
        }

        alert('Template uploaded successfully!');
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        alert('Error parsing Excel file. Please make sure it matches the template format.');
      }
    };

    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // Download Excel template for bay allocation only
  const handleDownloadBayTemplate = () => {
    if (dateRange.length === 0) {
      alert('Please set Induction and ETS dates first to generate the template.');
      return;
    }

    const wb = XLSX.utils.book_new();

    const bayHeader = ['Date', 'Bay ID'];
    const bayData = [
      bayHeader,
      ...dateRange.map(date => [
        new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        bayDaywise[date] || ''
      ])
    ];
    const wsBay = XLSX.utils.aoa_to_sheet(bayData);
    XLSX.utils.book_append_sheet(wb, wsBay, 'Bay Allocation');

    XLSX.writeFile(wb, `bay_allocation_template_${inductionDate}_to_${etsDate}.xlsx`);
  };

  // Handle Excel file upload for bay allocation only
  const handleBayFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (dateRange.length === 0) {
      alert('Please set Induction and ETS dates first before uploading.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        const baySheet = workbook.Sheets['Bay Allocation'];
        if (baySheet) {
          const bayData = XLSX.utils.sheet_to_json<string[]>(baySheet, { header: 1 });

          if (bayData.length > 1) {
            const newBays: {[date: string]: string} = {};

            bayData.slice(1).forEach((row, index) => {
              if (index < dateRange.length && row[1]) {
                newBays[dateRange[index]] = String(row[1]);
              }
            });

            setBayDaywise(prev => ({ ...prev, ...newBays }));
          }
        }

        alert('Bay allocation uploaded successfully!');
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        alert('Error parsing Excel file. Please make sure it matches the template format.');
      }
    };

    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // Edit drawer functions
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

  // Copy visit - ONLY copy aircraft-related details (tail_num, customer, aircraft_model, engine, lic_type)
  // NOT dates, resource requirements, or bay allocation (due to unique constraint on tail_num + start_date + end_date)
  const handleCopyVisit = (visit: Visit) => {
    // Only copy aircraft-related fields
    setTailNumber(visit.tailNumber);
    setCustomer(visit.customer);
    setAircraftType(visit.aircraftType);
    setEngineType(visit.engineType);
    setLicenseRequirements([...visit.licenseRequirements]);
    
    // Clear all other fields - user must set new dates and resource requirements
    setPoConfirmed(false);
    setPoNumber('');
    setCheckType('');
    setCustomerNotes('');
    setToolingConstraints('');
    setInductionDate('');
    setEtsDate('');
    setMinEngineers(0);
    setMinTechnicians(0);
    setDayWiseRequirements({});
    setBayAlloc('');
    setBayDaywise({});
    
    // Scroll to top to show the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    alert('Aircraft details copied to form. Please set the induction date, ETS date, and resource requirements for the new visit.');
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

  const isEditDateLocked = (date: string, inductionDate: string) => {
    if (!inductionDate) return false;
    return date <= TODAY && date >= inductionDate;
  };

  const handleEditLicenseToggle = (license: string) => {
    if (!editData) return;
    const newLicenses = editData.licenseRequirements.includes(license)
      ? editData.licenseRequirements.filter(l => l !== license)
      : [...editData.licenseRequirements, license];
    setEditData({ ...editData, licenseRequirements: newLicenses });
  };

  const handleEditDayWiseChange = (date: string, role: 'CC' | 'ENGR' | 'TECH', value: string) => {
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
  const editDateRange = useMemo(() => {
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
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="bg-white border-2 border-gray-800 rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900">Visit Details</h1>
          <p className="text-gray-600 mt-1">Record new visits and manage existing visit records</p>
        </div>

        {/* Visit Header Card */}
        <div className="bg-white border-2 border-gray-800 rounded-lg">
          <div className="bg-blue-500 text-white px-6 py-3 font-semibold">
            New Visit - Header
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* PO Confirmed */}
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={poConfirmed}
                  onChange={(e) => setPoConfirmed(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="font-medium text-gray-700">PO Confirmed</span>
              </label>
              {poConfirmed && (
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="PO Number *"
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>

            {/* Visit ID */}
            <div className="space-y-2">
              <label className="block font-medium text-gray-700">Visit ID</label>
              <input
                type="text"
                value={visitId}
                disabled
                className="w-full px-3 py-2 border-2 border-gray-300 rounded bg-gray-100 text-gray-600"
              />
            </div>

            {/* Tail Number */}
            <div className="space-y-2">
              <label className="block font-medium text-gray-700">Tail Number *</label>
              <CreatableSelect
                value={tailNumber}
                onChange={setTailNumber}
                options={tailNumbers}
                placeholder="Select or type tail number..."
                className="bg-white border-2 border-gray-300"
              />
            </div>

            {/* Customer */}
            <div className="space-y-2">
              <label className="block font-medium text-gray-700">Customer *</label>
              <CreatableSelect
                value={customer}
                onChange={setCustomer}
                options={customers}
                placeholder="Select or type customer..."
                className="bg-white border-2 border-gray-300"
              />
            </div>

            {/* Check Type */}
            <div className="space-y-2">
              <label className="block font-medium text-gray-700">Check Type *</label>
              <CreatableSelect
                value={checkType}
                onChange={setCheckType}
                options={checkTypes}
                placeholder="Select or type check type..."
                className="bg-white border-2 border-gray-300"
              />
            </div>

            {/* Customer Notes */}
            <div className="space-y-2 lg:col-span-3">
              <label className="block font-medium text-gray-700">Additional Customer Notes</label>
              <textarea
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                rows={3}
                placeholder="Enter any special requirements or notes..."
                className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Technical Requirements Card */}
        <div className="bg-white border-2 border-gray-800 rounded-lg">
          <div className="bg-blue-500 text-white px-6 py-3 font-semibold">
            Technical Requirements
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Aircraft Type */}
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">Aircraft Type *</label>
                <CreatableSelect
                  value={aircraftType}
                  onChange={setAircraftType}
                  options={aircraftTypes}
                  placeholder="Select or type aircraft type..."
                  className="bg-white border-2 border-gray-300"
                />
              </div>

              {/* Engine Type */}
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">Engine Type *</label>
                <CreatableSelect
                  value={engineType}
                  onChange={setEngineType}
                  options={engineTypes}
                  placeholder="Select or type engine type..."
                  className="bg-white border-2 border-gray-300"
                />
              </div>

              {/* Tooling/Constraints */}
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">Tooling/Constraints</label>
                <input
                  type="text"
                  value={toolingConstraints}
                  onChange={(e) => setToolingConstraints(e.target.value)}
                  placeholder="Special tooling requirements..."
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* License Requirements (Multi-select) */}
            <div className="space-y-2">
              <label className="block font-medium text-gray-700">License Requirements</label>
              <div className="flex flex-wrap gap-2">
                {licenseOptions.map(license => (
                  <button
                    key={license}
                    onClick={() => handleLicenseToggle(license)}
                    className={`px-4 py-2 rounded-full border-2 font-medium transition-colors ${
                      licenseRequirements.includes(license)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {license}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Schedule Card */}
        <div className="bg-white border-2 border-gray-800 rounded-lg">
          <div className="bg-blue-500 text-white px-6 py-3 font-semibold">
            Schedule
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Input Induction Date */}
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">Input Induction Date *</label>
                <input
                  type="date"
                  value={inductionDate}
                  onChange={(e) => setInductionDate(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* ETS Date */}
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">ETS Date *</label>
                <input
                  type="date"
                  value={etsDate}
                  onChange={(e) => setEtsDate(e.target.value)}
                  min={inductionDate}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
                {etsDate && inductionDate && etsDate < inductionDate && (
                  <p className="text-red-600 text-sm flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    ETS must be greater than or equal to Induction Date
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Planning Rule Banner */}
        {isAfterInduction && (
          <div className="bg-amber-50 border-2 border-amber-500 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">Planning Rule Active</p>
                <p className="text-amber-800 text-sm mt-1">
                  After Input Induction Date, Daily Planning cannot be modified for this visit.
                  Past and current dates are locked.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Team Sizing + Day-wise Requirements Card */}
        <div className="bg-white border-2 border-gray-800 rounded-lg">
          <div className="bg-blue-500 text-white px-6 py-3 font-semibold">
            Team Sizing & Day-wise Requirements
          </div>
          <div className="p-6 space-y-6">
            {/* Min Team Size - Two Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">Min Engineers Required</label>
                <input
                  type="number"
                  min="1"
                  value={minEngineers}
                  onChange={(e) => setMinEngineers(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full md:w-48 px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block font-medium text-gray-700">Min Technicians Required</label>
                <input
                  type="number"
                  min="0"
                  value={minTechnicians}
                  onChange={(e) => setMinTechnicians(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full md:w-48 px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-gray-600">
                Total Min Team Size: <span className="font-semibold">{minEngineers + minTechnicians}</span> (indicative and may change later based on planning updates)
              </p>
              {suggestedMinSize > 0 && (
                <p className="text-sm font-medium text-blue-600">
                  Suggested Min Size (from day-wise breakdown): {suggestedMinSize}
                </p>
              )}
            </div>

            {/* Day-wise Requirements Table */}
            {dateRange.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block font-medium text-gray-700">
                    Day-wise Requirements Breakdown <span className="text-gray-500 font-normal">(cannot be modified post-induction date)</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadTemplate}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download Template
                    </button>
                    <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Upload Excel
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
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
                          {dateRange.map((date, dateIndex) => {
                            const locked = isDateLocked(date);
                            return (
                              <td key={date} className="border-2 border-gray-800 px-2 py-2">
                                <input
                                  type="number"
                                  min="0"
                                  value={dayWiseRequirements[date]?.[role] || 0}
                                  onChange={(e) => handleDayWiseChange(date, role, e.target.value)}
                                  onPaste={(e) => handlePaste(e, role, dateIndex)}
                                  disabled={locked}
                                  className={`w-full px-2 py-1 text-center border-2 rounded focus:outline-none ${
                                    locked
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
                          const total = (dayWiseRequirements[date]?.CC || 0) +
                                       (dayWiseRequirements[date]?.ENGR || 0) +
                                       (dayWiseRequirements[date]?.TECH || 0);
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

            {dateRange.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>Select Induction and ETS dates to configure day-wise requirements</p>
              </div>
            )}
          </div>
        </div>

        {/* Bay Allocation Card */}
        <div className="bg-white border-2 border-gray-800 rounded-lg">
          <div className="bg-blue-500 text-white px-6 py-3 font-semibold">
            Bay Allocation
          </div>
          <div className="p-6 space-y-6">
            {/* Allocated Bay */}
            <div className="space-y-2">
              <label className="block font-medium text-gray-700">Allocated Bay</label>
              <select
                value={bayAlloc}
                onChange={(e) => setBayAlloc(e.target.value)}
                className="w-full md:w-64 px-3 py-2 border-2 border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select a bay...</option>
                {bayOptions.map(bay => (
                  <option key={bay} value={bay}>{bay}</option>
                ))}
              </select>
              <p className="text-sm text-gray-600">
                Specify the primary bay allocated for this visit.
              </p>
            </div>

            {/* Day-wise Bay Allocation */}
            {dateRange.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block font-medium text-gray-700">
                    Day-wise Bay Allocation <span className="text-gray-500 font-normal">(optional - specify bay per day if different)</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadBayTemplate}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download Template
                    </button>
                    <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Upload Excel
                      <input
                        ref={bayFileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleBayFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
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
                        const locked = isDateLocked(date);
                        return (
                          <tr key={date} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="border-2 border-gray-800 px-3 py-2 font-medium">
                              {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                            <td className="border-2 border-gray-800 px-3 py-2">
                              <select
                                value={bayDaywise[date] || ''}
                                onChange={(e) => setBayDaywise(prev => ({...prev, [date]: e.target.value}))}
                                disabled={locked}
                                className={`w-full px-3 py-1 border-2 rounded focus:outline-none ${
                                  locked
                                    ? 'bg-gray-200 border-gray-300 cursor-not-allowed text-gray-500'
                                    : 'border-gray-300 focus:border-blue-500'
                                }`}
                              >
                                <option value="">Select bay...</option>
                                {bayOptions.map(bay => (
                                  <option key={bay} value={bay}>{bay}</option>
                                ))}
                              </select>
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

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <button
            onClick={handleReset}
            disabled={isSaving}
            className="px-6 py-2 border-2 border-gray-800 rounded-lg font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-blue-600 text-white border-2 border-gray-800 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Visit'}
          </button>
        </div>

        {/* Saved Visits Table */}
        <div className="bg-white border-2 border-gray-800 rounded-lg">
          <div className="bg-blue-500 text-white px-6 py-3 font-semibold flex items-center justify-between">
            <span>Saved Visits ({filteredAndSortedVisits.length})</span>
          </div>
          
          {/* Single Search Bar */}
          <div className="p-4 border-b-2 border-gray-300">
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search all fields (Visit ID, Tail, Customer, Status, Check Type, Aircraft, Engine, Dates...)"
                className="w-full pl-10 pr-10 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-blue-500 text-white">
                  {[
                    { key: 'id', label: 'Visit ID', align: 'left' },
                    { key: 'tailNumber', label: 'Tail', align: 'left' },
                    { key: 'customer', label: 'Customer', align: 'left' },
                    { key: 'checkType', label: 'Check Type', align: 'left' },
                    { key: 'inductionDate', label: 'Induction', align: 'left' },
                    { key: 'etsDate', label: 'ETS', align: 'left' },
                    { key: 'minEngineers', label: 'Min Engr', align: 'center' },
                    { key: 'minTechnicians', label: 'Min Tech', align: 'center' },
                    { key: 'status', label: 'Status', align: 'center' },
                  ].map(col => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 font-semibold cursor-pointer hover:bg-blue-600 transition-colors select-none border-2 border-gray-800 ${col.align === 'center' ? 'text-center' : 'text-left'}`}
                      onClick={() => handleTableSort(col.key)}
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
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500 border-2 border-gray-800">
                      {searchQuery ? 'No visits found matching your search.' : 'No visits saved yet.'}
                    </td>
                  </tr>
                ) : (
                  paginatedVisits.map((visit, idx) => (
                    <tr 
                      key={visit.id} 
                      className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 cursor-pointer`}
                      onClick={() => handleViewEdit(visit)}
                    >
                      <td className="px-4 py-3 font-medium border-2 border-gray-800">{visit.id}</td>
                      <td className="px-4 py-3 border-2 border-gray-800">{visit.tailNumber}</td>
                      <td className="px-4 py-3 border-2 border-gray-800">{visit.customer}</td>
                      <td className="px-4 py-3 border-2 border-gray-800">{visit.checkType}</td>
                      <td className="px-4 py-3 border-2 border-gray-800">
                        {new Date(visit.inductionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 border-2 border-gray-800">
                        {new Date(visit.etsDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-center border-2 border-gray-800">{visit.minEngineers}</td>
                      <td className="px-4 py-3 text-center border-2 border-gray-800">{visit.minTechnicians}</td>
                      <td className="px-4 py-3 text-center border-2 border-gray-800">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                          visit.status === 'Upcoming' ? 'bg-blue-100 text-blue-800' :
                          visit.status === 'Ongoing' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {visit.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-2 border-gray-800" onClick={(e) => e.stopPropagation()}>
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
                            onClick={() => handleCopyVisit(visit)}
                            className="p-2 hover:bg-green-100 rounded transition-colors"
                            title="Copy Aircraft Details"
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

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-4 border-t-2 border-gray-300">
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

              {/* Results Count */}
              <div className="text-sm text-gray-600 text-center mt-2">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredAndSortedVisits.length)} of {filteredAndSortedVisits.length} visits
                {filteredAndSortedVisits.length !== visits.length && ` (filtered from ${visits.length} total)`}
              </div>
            </div>
          )}
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
                          onClick={() => editMode && handleEditLicenseToggle(license)}
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
                  {editDateRange.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Day-wise Requirements Breakdown <span className="text-gray-500 font-normal">(cannot be modified post-induction date)</span>
                      </label>
                      <div className="overflow-x-auto">
                        <table className="w-full border-2 border-gray-800">
                          <thead>
                            <tr className="bg-blue-500 text-white">
                              <th className="border-2 border-gray-800 px-3 py-2 text-left font-semibold">Role</th>
                              {editDateRange.map(date => (
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
                                {editDateRange.map(date => {
                                  const locked = isEditDateLocked(date, editData.inductionDate);
                                  return (
                                    <td key={date} className="border-2 border-gray-800 px-2 py-2">
                                      <input
                                        type="number"
                                        min="0"
                                        value={editData.dayWiseRequirements[date]?.[role] || 0}
                                        onChange={(e) => handleEditDayWiseChange(date, role, e.target.value)}
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
                              {editDateRange.map(date => {
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
                  {editDateRange.length > 0 && (
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
                            {editDateRange.map((date, index) => {
                              const locked = isEditDateLocked(date, editData.inductionDate);
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

