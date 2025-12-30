import { useState } from 'react';
import { Resource } from '../lib/supabase';

interface TailPlanningProps {
  resources: Resource[];
}

interface ProposedTeamMember {
  id: string;
  name: string;
  team: string;
  primarySkill: string;
  secondarySkill: string;
  role: string;
  plannedLeaves: number;
  potentialReplacement: string;
}

interface BaySlot {
  id: string;
  bay: string;
  startDate: string;
  endDate: string;
  status: 'on-track' | 'delayed' | 'free';
}

export function TailPlanning({ resources }: TailPlanningProps) {
  const [requirementText, setRequirementText] = useState('');
  const [aircraft, setAircraft] = useState('');
  const [maintenanceCheck, setMaintenanceCheck] = useState('');
  const [licenseRequirements, setLicenseRequirements] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);

  const handleRecommendTeam = () => {
    if (requirementText.trim() && aircraft && maintenanceCheck && licenseRequirements.length > 0) {
      setShowResults(true);
    }
  };

  const toggleLicense = (license: string) => {
    setLicenseRequirements(prev =>
      prev.includes(license)
        ? prev.filter(l => l !== license)
        : [...prev, license]
    );
  };

  const handleExport = () => {
    alert('Export functionality coming soon!');
  };

  const proposedTeam: ProposedTeamMember[] = [
    {
      id: 'AB12348',
      name: 'Carson Ryan',
      team: 'Team 4',
      primarySkill: 'AQB',
      secondarySkill: 'AQB',
      role: 'ENGR',
      plannedLeaves: 0,
      potentialReplacement: 'Ben Tarr'
    },
    {
      id: 'AB12352',
      name: 'Cam Dwight',
      team: 'Team 2',
      primarySkill: 'AV',
      secondarySkill: 'AL',
      role: 'ENGR',
      plannedLeaves: 2,
      potentialReplacement: 'Jay Plat'
    },
    {
      id: 'AB12355',
      name: 'Jimmy Wang',
      team: 'Team 5',
      primarySkill: 'AV',
      secondarySkill: 'AV',
      role: 'ENGR',
      plannedLeaves: 1,
      potentialReplacement: 'Steve Morin'
    },
    {
      id: 'AB12363',
      name: 'Brandon Cavill',
      team: 'Team 7',
      primarySkill: 'AV',
      secondarySkill: 'AV',
      role: 'ENGR',
      plannedLeaves: 3,
      potentialReplacement: 'Bill Wort'
    },
    {
      id: 'AB12364',
      name: 'Joe Henry',
      team: 'Team 7',
      primarySkill: 'AV',
      secondarySkill: 'AV',
      role: 'CC',
      plannedLeaves: 0,
      potentialReplacement: 'Rick Pete'
    },
    {
      id: 'AB12367',
      name: 'Benny Red',
      team: 'Team 5',
      primarySkill: 'AV',
      secondarySkill: 'AV',
      role: 'TECH',
      plannedLeaves: 0,
      potentialReplacement: 'Jose Pull'
    }
  ];

  const baySchedule: BaySlot[] = [
    { id: '1', bay: 'Bay 1', startDate: '13-2001', endDate: 'MH-018-F...', status: 'on-track' },
    { id: '2', bay: 'Bay 2', startDate: 'VT-0002', endDate: 'H...', status: 'delayed' },
    { id: '3', bay: 'Bay 3', startDate: 'J3-...', endDate: 'HF-1UU...', status: 'on-track' },
    { id: '4', bay: 'Bay 4', startDate: 'AA- ISK...', endDate: 'HF-1 LU...', status: 'on-track' },
    { id: '5', bay: 'Bay 5', startDate: 'L7-0000', endDate: '', status: 'on-track' }
  ];

  const licenses = ['FAA', 'UKCAA', 'GCCA', 'EASA', 'FTE'];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-800">Requirement Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Aircraft</label>
              <select
                value={aircraft}
                onChange={(e) => setAircraft(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 bg-white"
              >
                <option value="">Select Aircraft</option>
                <option value="A319">A319</option>
                <option value="B777">B777</option>
                <option value="A320">A320</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Maintenance Check</label>
              <select
                value={maintenanceCheck}
                onChange={(e) => setMaintenanceCheck(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 bg-white"
              >
                <option value="">Select Check</option>
                <option value="c6">C6</option>
                <option value="c12">C12</option>
                <option value="overhaul">Overhaul</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">License Requirements</label>
            <div className="border-2 border-gray-300 rounded-lg p-3 bg-white">
              <div className="flex flex-wrap gap-2">
                {licenses.map(license => (
                  <button
                    key={license}
                    onClick={() => toggleLicense(license)}
                    className={`px-4 py-2 rounded-md font-medium transition-colors ${
                      licenseRequirements.includes(license)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {license}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Additional Details</label>
            <textarea
              value={requirementText}
              onChange={(e) => setRequirementText(e.target.value)}
              placeholder="Provide estimated hours, tooling requirements and planned start & end dates....."
              className="w-full h-[200px] p-4 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 placeholder:text-gray-400 placeholder:italic resize-none"
            />
          </div>

          <button
            onClick={handleRecommendTeam}
            disabled={!requirementText.trim() || !aircraft || !maintenanceCheck || licenseRequirements.length === 0}
            className="w-full py-3 bg-gray-500 text-white font-bold text-lg rounded-lg hover:bg-gray-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Recommend Team
          </button>
        </div>

        <div className="space-y-4">
          {showResults && (
            <>
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-gray-800">Bay Occupancy</h2>

                <div className="border-2 border-gray-800 rounded-lg p-4 bg-white">
                  <div className="space-y-3 mb-4">
                    {['Bay 1', 'Bay 2', 'Bay 3', 'Bay 4', 'Bay 5'].map((bay, bayIndex) => (
                      <div key={bay} className="flex items-center gap-3">
                        <div className="w-16 text-lg font-bold text-gray-800">{bay}</div>
                        <div className="flex-1 flex gap-2 h-10">
                          {baySchedule.filter(slot => slot.bay === bay).map((slot) => (
                            <div
                              key={slot.id}
                              className={`flex-1 flex items-center justify-center text-xs font-semibold text-white px-2 rounded-md ${
                                slot.status === 'on-track' ? 'bg-green-500' :
                                slot.status === 'delayed' ? 'bg-orange-500' :
                                'bg-gray-300'
                              }`}
                            >
                              {slot.startDate}
                            </div>
                          ))}
                          {baySchedule.filter(slot => slot.bay === bay)[0]?.endDate && (
                            <div
                              className={`flex-1 flex items-center justify-center text-xs font-semibold text-white px-2 rounded-md ${
                                baySchedule.filter(slot => slot.bay === bay)[0].status === 'on-track' ? 'bg-green-500' :
                                baySchedule.filter(slot => slot.bay === bay)[0].status === 'delayed' ? 'bg-orange-500' :
                                'bg-gray-300'
                              }`}
                            >
                              {baySchedule.filter(slot => slot.bay === bay)[0].endDate}
                            </div>
                          )}
                          {bayIndex === 1 && (
                            <div className="flex-1 bg-gray-200 border-3 border-gray-800 rounded-md flex flex-col items-center justify-center text-xs font-semibold text-gray-800 px-2">
                              <div>Allocated</div>
                              <div>Bay Slot</div>
                            </div>
                          )}
                          {bayIndex === 4 && (
                            <div className="flex-1 bg-gray-200 border-3 border-gray-800 rounded-md flex flex-col items-center justify-center text-xs font-semibold text-gray-800 px-2">
                              <div>Potential Bay</div>
                              <div>Slot</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center pl-20">
                    <div className="flex-1 flex justify-between px-2">
                      <span className="text-sm text-gray-600">30 Jan 2025</span>
                      <span className="text-sm text-gray-600">01 Feb 2025</span>
                      <span className="text-sm text-gray-600">05 Feb 2025</span>
                      <span className="text-sm text-gray-600">01 Feb 2025</span>
                      <span className="text-sm text-gray-600">01 Jun 2025</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t-2 border-gray-200 flex items-center justify-center gap-8">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-green-500 rounded"></div>
                      <span className="text-gray-800 font-medium text-base">On Track</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-orange-500 rounded"></div>
                      <span className="text-gray-800 font-medium text-base">Delayed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-6 bg-gray-200 border-3 border-gray-800 rounded flex items-center justify-center">
                        <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                      </div>
                      <span className="text-gray-800 font-medium text-base">Allocated Bay Slot</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-6 bg-gray-200 border-3 border-gray-800 rounded"></div>
                      <span className="text-gray-800 font-medium text-base">Potential Bay Slot</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border-2 border-gray-300 rounded-lg p-4 space-y-2">
                  <p className="text-base text-gray-800 leading-relaxed">
                    <span className="font-semibold text-red-600">Current assigned bay slot Bay 2 (Feasibility~20%)</span>
                  </p>
                  <p className="text-base text-gray-800 leading-relaxed">
                    <span className="font-semibold text-green-600">Recommended Bay 5 (Feasibility~80%)</span>
                  </p>
                </div>
              </div>

              <h2 className="text-2xl font-bold text-gray-800 pt-4">Proposed Team</h2>
            </>
          )}

          {!showResults ? (
            <div className="border-2 border-gray-300 rounded-lg p-12 bg-gray-50 flex items-center justify-center min-h-[600px]">
              <p className="text-gray-400 text-center text-lg italic leading-relaxed max-w-md">
                In this section, best team configuration considering availability & certification requirements will be provided.
              </p>
            </div>
          ) : (
            <div className="border-2 border-gray-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-800">
                      <th className="px-3 py-3 text-left font-bold border-r border-gray-300">Employee ID</th>
                      <th className="px-3 py-3 text-left font-bold border-r border-gray-300">Employee</th>
                      <th className="px-3 py-3 text-left font-bold border-r border-gray-300">Team</th>
                      <th className="px-3 py-3 text-left font-bold border-r border-gray-300">Primary Skill</th>
                      <th className="px-3 py-3 text-left font-bold border-r border-gray-300">Secondary Skill</th>
                      <th className="px-3 py-3 text-left font-bold border-r border-gray-300">Role</th>
                      <th className="px-3 py-3 text-left font-bold bg-blue-600 text-white border-r border-gray-300">Planned leaves</th>
                      <th className="px-3 py-3 text-left font-bold bg-blue-400 text-white">Potential Replacement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposedTeam.map((member, index) => (
                      <tr key={member.id} className={`border-b border-gray-300 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="px-3 py-3 border-r border-gray-300 font-medium">{member.id}</td>
                        <td className="px-3 py-3 border-r border-gray-300">{member.name}</td>
                        <td className="px-3 py-3 border-r border-gray-300">{member.team}</td>
                        <td className="px-3 py-3 border-r border-gray-300 text-center">{member.primarySkill}</td>
                        <td className="px-3 py-3 border-r border-gray-300 text-center">{member.secondarySkill}</td>
                        <td className="px-3 py-3 border-r border-gray-300 text-center">{member.role}</td>
                        <td className="px-3 py-3 border-r border-gray-300 text-center bg-blue-50">{member.plannedLeaves}</td>
                        <td className="px-3 py-3 bg-gray-100">{member.potentialReplacement}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {showResults && (
            <button
              onClick={handleExport}
              className="w-full py-3 bg-blue-600 text-white font-bold text-lg rounded-lg hover:bg-blue-700 transition-colors"
            >
              Export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
