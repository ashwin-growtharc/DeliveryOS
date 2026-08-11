export interface CardProps {
  label: string;
}

export function Card({ label }: CardProps) {
  return (
    <div data-testid="card" className="bg-white text-gray-800 dark:bg-black dark:text-gray-200">
      {label}
    </div>
  );
}
