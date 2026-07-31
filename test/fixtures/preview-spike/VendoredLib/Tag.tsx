import clsx from 'clsx';

export interface TagProps {
  label: string;
  active?: boolean;
}

export function Tag({ label, active = false }: TagProps) {
  return (
    <span data-testid="tag" className={clsx('tag', active && 'tag--active')}>
      {label}
    </span>
  );
}
