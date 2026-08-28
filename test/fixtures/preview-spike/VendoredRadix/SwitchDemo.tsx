import * as Switch from '@radix-ui/react-switch';

export interface SwitchDemoProps {
  label: string;
}

export function SwitchDemo({ label }: SwitchDemoProps) {
  return (
    <label data-testid="switch-label">
      <Switch.Root defaultChecked data-testid="switch-root">
        <Switch.Thumb data-testid="switch-thumb" />
      </Switch.Root>
      {label}
    </label>
  );
}
