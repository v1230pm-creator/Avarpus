import { Search } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

/**
 * Visual check for the Avarpus loading animation: full-screen state, header
 * action slot and the in-search-field slot, on the app's dark surface.
 */
export default function AvarpusLoadingPreview() {
  return (
    <div className="min-h-screen bg-[#0B1220] p-6 font-sans text-white">
      <div className="mx-auto flex max-w-[420px] flex-col gap-6">
        {/* Header with a busy action slot, as in the reference screenshot */}
        <div className="flex items-center justify-between">
          <span className="text-2xl font-semibold">Avarpus</span>
          <span className="flex size-9 items-center justify-center rounded-full bg-white/5">
            <Spinner size={18} className="text-[#2F86FF]" />
          </span>
        </div>

        {/* Search field with the inline slot next to the magnifier */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-white/40" />
          <span className="absolute left-8 top-2.5 flex size-4 items-center justify-center">
            <Spinner size={14} className="text-[#2F86FF]" label={null} />
          </span>
          <input
            readOnly
            value="samsung a12"
            className="h-9 w-full rounded-md border border-white/10 bg-white/5 pl-14 pr-3 text-sm text-white outline-none"
          />
        </div>

        {/* Full-screen state */}
        <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-white/10">
          <Spinner size={44} className="text-[#2F86FF]" />
          <p className="text-sm text-white/60">Loading conversations…</p>
        </div>

        {/* Size ramp, dark and light */}
        <div className="flex items-center gap-6 rounded-xl border border-white/10 p-5">
          <Spinner size={14} className="text-[#2F86FF]" />
          <Spinner size={20} className="text-[#2F86FF]" />
          <Spinner size={32} className="text-[#2F86FF]" />
          <Spinner size={44} className="text-[#2F86FF]" />
        </div>
        <div className="flex items-center gap-6 rounded-xl bg-white p-5">
          <Spinner size={14} className="text-[#0F62FE]" />
          <Spinner size={20} className="text-[#0F62FE]" />
          <Spinner size={32} className="text-[#0F62FE]" />
          <Spinner size={44} className="text-[#0F62FE]" />
        </div>
      </div>
    </div>
  );
}
