import { motion } from 'framer-motion';

export interface FaderProps {
  label: string;
}

export function Fader({ label }: FaderProps) {
  return (
    <motion.div data-testid="fader" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {label}
    </motion.div>
  );
}
