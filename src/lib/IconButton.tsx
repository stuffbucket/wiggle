import type { ReactNode } from "react";

/// A ghost icon button: no fill at rest (so it never reads like the attachment
/// chip), faded→ink on hover, always carrying an aria-label + tooltip.
export function IconButton({
  label,
  onClick,
  children,
  title,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
