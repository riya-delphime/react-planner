import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Resource } from '../lib/supabase';
import { ResourceDetail } from './ResourceDetail';

interface ResourceSearchProps {
  resources: Resource[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ResourceSearch({ resources, searchQuery, onSearchChange }: ResourceSearchProps) {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);

  const filteredResources = resources.filter(resource => {
    const query = searchQuery.toLowerCase();
    return (
      resource.name.toLowerCase().includes(query) ||
      resource.team.toLowerCase().includes(query) ||
      resource.core.toLowerCase().includes(query) ||
      resource.support.toLowerCase().includes(query) ||
      resource.title.toLowerCase().includes(query) ||
      resource.licenses.toLowerCase().includes(query)
    );
  });

  return (
    <div className="bg-white border-2 border-gray-800 rounded">
      <div className="bg-white border-b-2 border-gray-800 p-3">
        <h2 className="text-lg font-bold text-center mb-3">Requirement Search</h2>

        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Lead engineers in avionics with 10+ years of experience working on Airbus RR engine"
              className="w-full px-4 py-2 pr-10 border-2 border-gray-300 rounded focus:outline-none focus:border-blue-500"
            />
            <Search className="absolute right-3 top-2.5 text-gray-400" size={20} />
          </div>
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="px-4 py-2 bg-gray-600 text-white font-semibold rounded hover:bg-gray-700 transition-colors flex items-center gap-2"
              title="Clear search"
            >
              <X size={18} />
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-gray-100">
            <tr className="border-b-2 border-gray-800">
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">#</th>
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">Name</th>
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">Team</th>
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">Core</th>
              <th className="border-r border-gray-800 px-3 py-2 text-left font-bold">Support</th>
              <th className="px-3 py-2 text-left font-bold">TITLE</th>
            </tr>
          </thead>
          <tbody>
            {filteredResources.map((resource) => (
              <tr
                key={resource.id}
                onClick={() => setSelectedResource(resource)}
                className={`border-b border-gray-300 cursor-pointer hover:bg-blue-50 ${
                  resource.title === 'ENGR' ? 'bg-yellow-100' :
                  resource.title === 'TECH' ? 'bg-blue-100' : 'bg-white'
                }`}
              >
                <td className="border-r border-gray-300 px-3 py-2 font-medium">{resource.id}</td>
                <td className="border-r border-gray-300 px-3 py-2">{resource.name}</td>
                <td className="border-r border-gray-300 px-3 py-2">{resource.team}</td>
                <td className="border-r border-gray-300 px-3 py-2">{resource.core}</td>
                <td className="border-r border-gray-300 px-3 py-2">{resource.support}</td>
                <td className="px-3 py-2 font-medium">{resource.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedResource && (
        <ResourceDetail
          resource={selectedResource}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </div>
  );
}
