import { z } from 'zod';

export interface FormattedProps {
  value: string;
}

const schema = z.string();

export function Formatted({ value }: FormattedProps) {
  return <span>{schema.parse(value)}</span>;
}
