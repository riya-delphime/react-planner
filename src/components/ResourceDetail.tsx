import { Resource } from '../lib/supabase';
import { X } from 'lucide-react';

interface ResourceDetailProps {
  resource: Resource;
  onClose: () => void;
}

export function ResourceDetail({ resource, onClose }: ResourceDetailProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-700 text-white rounded-lg p-6 w-80 relative shadow-xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-300 hover:text-white"
        >
          <X size={20} />
        </button>

        <h3 className="text-xl font-bold mb-4">{resource.name}</h3>

        <div className="space-y-2 text-sm">
          <div>
            <span className="text-gray-300">DOB:</span> {resource.dob}
          </div>
          <div>
            <span className="text-gray-300">Dept:</span> {resource.department}
          </div>
          <div>
            <span className="text-gray-300">Role:</span> {resource.title}
          </div>
          <div>
            <span className="text-gray-300">Lics:</span> {resource.licenses}
          </div>
        </div>
      </div>
    </div>
  );
}
