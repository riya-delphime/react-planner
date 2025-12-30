import { useState } from 'react';

interface BaySlot {
  id: string;
  bay: string;
  startDate: string;
  endDate: string;
  status: 'on-track' | 'delayed' | 'free';
}

export function BayAllocation() {
  const [aircraft, setAircraft] = useState('');
  const [maintenanceCheck, setMaintenanceCheck] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [showResults, setShowResults] = useState(false);

  const handleRecommendBay = () => {
    if (aircraft && maintenanceCheck && startDate && endDate) {
      setShowResults(true);
    }
  };

  const baySchedule: BaySlot[] = [
    { id: '1', bay: 'Bay 1', startDate: '13-2001', endDate: 'MH-018-F...', status: 'on-track' },
    { id: '2', bay: 'Bay 2', startDate: 'VT-0002', endDate: 'H...', status: 'delayed' },
    { id: '3', bay: 'Bay 3', startDate: 'J3-...', endDate: 'HF-1UU...', status: 'on-track' },
    { id: '4', bay: 'Bay 4', startDate: 'A...', endDate: '', status: 'on-track' },
    { id: '5', bay: 'Bay 5', startDate: 'L7-0000', endDate: '', status: 'on-track' }
  ];

  return (
    <div className="grid grid-cols-2 gap-8">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-800">Bay Requirement Details</h2>

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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Date Range:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full p-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">&nbsp;</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 p-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 bg-white"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Additional Details</label>
          <textarea
            value={additionalDetails}
            onChange={(e) => setAdditionalDetails(e.target.value)}
            placeholder="Provide estimated hours, tooling requirements and planned start & end dates....."
            className="w-full h-[280px] p-4 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 placeholder:text-gray-400 placeholder:italic resize-none"
          />
        </div>

        <button
          onClick={handleRecommendBay}
          disabled={!aircraft || !maintenanceCheck || !startDate || !endDate}
          className="w-full py-3 bg-gray-500 text-white font-bold text-lg rounded-lg hover:bg-gray-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Recommend Bay
        </button>
      </div>

      <div className="space-y-4">
        {!showResults ? (
          <div className="border-2 border-gray-300 rounded-lg p-12 bg-gray-50 flex items-center justify-center min-h-[600px]">
            <p className="text-gray-400 text-center text-lg italic leading-relaxed max-w-md">
              In this section best possible bays will be shown for the request based on availability, progress, tooling & other requirements
            </p>
          </div>
        ) : (
          <div className="border-2 border-gray-800 rounded-lg p-6 bg-white">
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
                        <div>Potential Bay</div>
                        <div>Slot</div>
                      </div>
                    )}
                    {bayIndex === 3 && (
                      <div className="flex-1 bg-gray-200 border-3 border-gray-800 rounded-md flex flex-col items-center justify-center text-xs font-semibold text-gray-800 px-2">
                        <div>Potential Bay</div>
                        <div>Slot</div>
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

            <div className="flex items-center pl-20 mb-6">
              <div className="flex-1 flex justify-between px-2">
                <span className="text-sm text-gray-600">30 Jan 2025</span>
                <span className="text-sm text-gray-600">01 Feb 2025</span>
                <span className="text-sm text-gray-600">05 Feb 2025</span>
                <span className="text-sm text-gray-600">01 Feb 2025</span>
                <span className="text-sm text-gray-600">01 Jun 2025</span>
              </div>
            </div>

            <div className="pt-4 border-t-2 border-gray-200 flex items-center justify-center gap-8">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-500 rounded"></div>
                <span className="text-gray-800 font-medium text-base">On Track</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-orange-500 rounded"></div>
                <span className="text-gray-800 font-medium text-base">Delayed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-6 bg-gray-200 border-3 border-gray-800 rounded"></div>
                <span className="text-gray-800 font-medium text-base">Potential Bay Slot</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
