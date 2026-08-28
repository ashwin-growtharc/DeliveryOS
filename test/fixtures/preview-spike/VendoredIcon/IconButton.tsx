import { Search } from 'lucide-react';

export interface IconButtonProps {
  label: string;
}

export function IconButton({ label }: IconButtonProps) {
  return (
    <button data-testid="icon-button">
      <Search data-testid="search-icon" />
      {label}
    </button>
  );
}
