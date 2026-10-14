import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted " +
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, "h-10", className)} {...props} />
));
Input.displayName = "Input";
