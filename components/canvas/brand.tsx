import { Aperture } from "lucide-react";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Aperture size={compact ? 15 : 20} />
      </span>
      {!compact && <span>AI Canvas</span>}
    </span>
  );
}
