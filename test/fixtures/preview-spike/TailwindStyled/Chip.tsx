export interface ChipProps {
  label: string;
}

export function Chip({ label }: ChipProps) {
  return (
    <span data-testid="chip" className="rounded-full bg-indigo-600 px-3 py-1 text-white">
      {label}
    </span>
  );
}
