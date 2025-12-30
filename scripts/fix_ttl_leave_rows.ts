import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const envPath = join(process.cwd(), '.env');
const envContent = readFileSync(envPath, 'utf-8');
const envVars: Record<string, string> = {};

envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    envVars[match[1].trim()] = match[2].trim();
  }
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseAnonKey = envVars.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables in .env file');
  console.error('Expected: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function fixTTLLeaveRows() {
  console.log('Starting TTL data quality fix for Apr 30 leave rows...');
  console.log('Note: This script operates on simulated TTL data (generateLoginTime), not actual DB columns');
  console.log('The actual database does not store TTL login data - it is generated on the fly in the UI');
  console.log('\nSearching for resources with leave status on Apr 30...');

  const { data: resources, error: resourcesError } = await supabase
    .from('resources')
    .select('id, name, leave_data');

  if (resourcesError) {
    console.error('Error fetching resources:', resourcesError);
    process.exit(1);
  }

  let apr30LeaveCount = 0;
  const apr30LeaveResources: any[] = [];

  resources?.forEach((resource: any) => {
    const leaveData = resource.leave_data || {};
    const apr30Status = leaveData['2025-04-30'];
    if (apr30Status === 'SL' || apr30Status === 'AL') {
      apr30LeaveCount++;
      apr30LeaveResources.push({
        id: resource.id,
        name: resource.name,
        status: apr30Status
      });
    }
  });

  console.log(`\nFound ${apr30LeaveCount} resources with SL/AL status on Apr 30:`);
  apr30LeaveResources.forEach((res, index) => {
    console.log(`  ${index + 1}. ${res.name} (${res.id}): ${res.status}`);
  });

  console.log('\n✅ Data quality check complete');
  console.log('Note: TTL login is generated dynamically in the UI and automatically');
  console.log('      blanked for SL/AL rows during rendering. No database updates needed.');
}

fixTTLLeaveRows().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
