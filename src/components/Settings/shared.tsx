import { Switch } from "../ui/switch";

export const sectionHeadingClass =
  "text-xs font-medium text-muted-foreground uppercase tracking-[0.5px] mb-2.5";

export const inputClass =
  "px-2.5 py-1.5 text-[13px] bg-transparent border border-border rounded-md text-foreground outline-none transition-[color,box-shadow] focus:ring-2 focus:ring-ring/50 focus:border-ring";

// ── Toggle Row ──
// Shared toggle switch component used across settings tabs.

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-foreground">{label}</span>
        {description && (
          <span className="text-[11px] text-muted-foreground mt-0.5">
            {description}
          </span>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </label>
  );
}
