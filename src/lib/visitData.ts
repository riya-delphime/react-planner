import { supabase } from './supabase';

export interface DayWiseRequirement {
  date: string;
  CC?: number;
  ENGR?: number;
  TECH?: number;
}

export interface BayDayWise {
  date: string;
  bay_id: string;
}

export interface VisitPlanningRecord {
  visit_id: string;
  po_confirmed: boolean;
  po_number: string;
  tail_num: string;
  customer: string;
  check_type: string;
  status: string;
  notes: string;
  aircraft: string;
  engine: string;
  lic_req: string;
  license_authorities: string[];
  tooling_constraints: string;
  induction_date: string;
  ets_date: string;
  min_engineers: number;
  min_technicians: number;
  daywise_resc: DayWiseRequirement[];
  bay_alloc: string;
  bay_daywise: BayDayWise[];
  date_created?: string;
  record_timestamp?: string;
  source?: 'historical' | 'new';
}

// Lookup data interfaces
export interface LookupItem {
  id: number;
  name: string;
}

export interface TailNumberLookup {
  id: number;
  tail_num: string;
}

// Fetch all visits from combined view (historical + new)
export async function getAllVisits(): Promise<VisitPlanningRecord[]> {
  const { data, error } = await supabase
    .from('visit_planning_combined')
    .select('*')
    .order('induction_date', { ascending: true });

  if (error) {
    console.error('Error fetching visits:', error);
    throw error;
  }

  return data || [];
}

export async function getVisitById(visitId: string): Promise<VisitPlanningRecord | null> {
  const { data, error } = await supabase
    .from('visit_planning_combined')
    .select('*')
    .eq('visit_id', visitId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching visit:', error);
    throw error;
  }

  return data;
}

// Create new visit - writes to visit_details table
export async function createVisit(visit: Omit<VisitPlanningRecord, 'date_created' | 'record_timestamp' | 'source'>): Promise<VisitPlanningRecord> {
  // Map frontend field names to database column names
  const dbRecord = {
    visit_number: parseInt(visit.visit_id) || null,
    tail_num: visit.tail_num,
    start_date: visit.induction_date,
    end_date: visit.ets_date,
    aircraft_clean: visit.aircraft,
    engine_clean: visit.engine,
    lic: visit.lic_req,
    airline: visit.customer,
    bay: visit.bay_alloc,
    min_engineers: visit.min_engineers,
    min_technicians: visit.min_technicians,
    po_confirmed: visit.po_confirmed,
    po_number: visit.po_number,
    customer: visit.customer,
    check_type: visit.check_type,
    status: visit.status,
    notes: visit.notes,
    license_authorities: visit.license_authorities,
    tooling_constraints: visit.tooling_constraints,
    daywise_resc: visit.daywise_resc,
    bay_alloc: visit.bay_alloc,
    bay_daywise: visit.bay_daywise
  };

  const { data, error } = await supabase
    .from('visit_details')
    .insert([dbRecord])
    .select()
    .single();

  if (error) {
    console.error('Error creating visit:', error);
    throw error;
  }

  return data;
}

// Update visit - inserts a new record with updated values (append-only pattern)
export async function updateVisit(visitId: string, updates: Partial<VisitPlanningRecord>): Promise<VisitPlanningRecord> {
  // Map frontend field names to database column names
  const dbRecord = {
    visit_number: parseInt(visitId) || null,
    tail_num: updates.tail_num,
    start_date: updates.induction_date,
    end_date: updates.ets_date,
    aircraft_clean: updates.aircraft,
    engine_clean: updates.engine,
    lic: updates.lic_req,
    airline: updates.customer,
    bay: updates.bay_alloc,
    min_engineers: updates.min_engineers,
    min_technicians: updates.min_technicians,
    po_confirmed: updates.po_confirmed,
    po_number: updates.po_number,
    customer: updates.customer,
    check_type: updates.check_type,
    status: updates.status,
    notes: updates.notes,
    license_authorities: updates.license_authorities,
    tooling_constraints: updates.tooling_constraints,
    daywise_resc: updates.daywise_resc,
    bay_alloc: updates.bay_alloc,
    bay_daywise: updates.bay_daywise
  };

  // Insert a new record with the updates (append-only pattern)
  const { data, error } = await supabase
    .from('visit_details')
    .insert([dbRecord])
    .select()
    .single();

  if (error) {
    console.error('Error updating visit:', error);
    throw error;
  }

  return data;
}

// Delete visit - deletes all records for the visit_number from visit_details
export async function deleteVisit(visitId: string): Promise<void> {
  const { error } = await supabase
    .from('visit_details')
    .delete()
    .eq('visit_number', parseInt(visitId));

  if (error) {
    console.error('Error deleting visit:', error);
    throw error;
  }
}

// Get next visit ID using database function (returns numeric visit_number)
export async function getNextVisitId(): Promise<string> {
  const { data, error } = await supabase
    .rpc('get_next_visit_id');

  if (error) {
    console.error('Error fetching next visit ID:', error);
    // Fallback: calculate from combined view
    const { data: visits } = await supabase
      .from('visit_planning_combined')
      .select('visit_id');

    if (!visits || visits.length === 0) return '978345'; // Start after existing visits

    // Find max numeric visit_id
    const maxId = visits.reduce((max, v) => {
      const num = parseInt(v.visit_id, 10);
      return !isNaN(num) && num > max ? num : max;
    }, 0);

    return (maxId + 1).toString();
  }

  return data || '978345';
}

// Lookup functions for dropdowns
export async function getCustomers(): Promise<string[]> {
  const { data, error } = await supabase
    .from('lookup_customers')
    .select('name')
    .order('name');

  if (error) {
    console.error('Error fetching customers:', error);
    return [];
  }

  return data?.map(item => item.name) || [];
}

export async function getAircraftTypes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('lookup_aircraft')
    .select('name')
    .order('name');

  if (error) {
    console.error('Error fetching aircraft types:', error);
    return [];
  }

  return data?.map(item => item.name) || [];
}

export async function getEngineTypes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('lookup_engines')
    .select('name')
    .order('name');

  if (error) {
    console.error('Error fetching engine types:', error);
    return [];
  }

  return data?.map(item => item.name) || [];
}

export async function getLicenses(): Promise<string[]> {
  const { data, error } = await supabase
    .from('lookup_licenses')
    .select('name')
    .order('name');

  if (error) {
    console.error('Error fetching licenses:', error);
    return [];
  }

  return data?.map(item => item.name) || [];
}

export async function getTailNumbers(): Promise<string[]> {
  const { data, error } = await supabase
    .from('lookup_tail_numbers')
    .select('tail_num')
    .order('tail_num');

  if (error) {
    console.error('Error fetching tail numbers:', error);
    return [];
  }

  return data?.map(item => item.tail_num) || [];
}

export async function getBays(): Promise<string[]> {
  const { data, error } = await supabase
    .from('lookup_bays')
    .select('name')
    .order('name');

  if (error) {
    console.error('Error fetching bays:', error);
    return [];
  }

  return data?.map(item => item.name) || [];
}

// Check if a visit is editable (only new visits can be edited)
export function isVisitEditable(visit: VisitPlanningRecord): boolean {
  return visit.source === 'new';
}
