import { Requirement } from '../lib/supabase';

interface RequirementListProps {
  requirements: Requirement[];
}

export function RequirementList({ requirements }: RequirementListProps) {
  return (
    <div className="bg-white border-2 border-gray-800 rounded">
      <div className="bg-white border-b-2 border-gray-800 p-3">
        <h2 className="text-lg font-bold text-center">Today's Staffing Requirements</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-800">
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">Tail Number Reference</th>
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">Aircraft Details</th>
              <th className="border-r border-gray-800 px-3 py-2 text-center font-bold">Number of Licensed Engineers Required</th>
              <th className="border-r border-gray-800 px-3 py-2 text-center font-bold">Support Staff Required</th>
              <th className="px-3 py-2 text-left font-bold">Notes from Lead Engineer</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((req) => {
              const isDelayed = req.status === 'delayed';
              const rowClass = isDelayed
                ? 'border-b border-gray-300 bg-orange-100 hover:bg-orange-200'
                : 'border-b border-gray-300 hover:bg-gray-50';

              return (
                <tr key={req.id} className={rowClass}>
                  <td className="border-r border-gray-300 px-3 py-2 font-medium">{req.tail_number}</td>
                  <td className="border-r border-gray-300 px-3 py-2">{req.tail_details}</td>
                  <td className="border-r border-gray-300 px-3 py-2 text-center">{req.lic_engineers}</td>
                  <td className="border-r border-gray-300 px-3 py-2 text-center">{req.support}</td>
                  <td className="px-3 py-2">{req.notes || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
