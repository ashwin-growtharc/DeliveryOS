export interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({ children, variant = 'primary', disabled = false }: ButtonProps) {
  const background = variant === 'primary' ? '#1E3C53' : 'transparent';
  const color = variant === 'primary' ? '#FFFCF2' : '#1E3C53';
  const border = variant === 'primary' ? 'none' : '1px solid #1E3C53';

  return (
    <button
      disabled={disabled}
      style={{
        background: disabled ? '#C9BFAF' : background,
        color: disabled ? '#6b7280' : color,
        border,
        borderRadius: '6px',
        padding: '10px 20px',
        fontSize: '14px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'transform .1s ease',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {children}
    </button>
  );
}
