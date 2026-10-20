"use client";

import * as React from "react";
import { parseBR, parseInt2, num } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BufferedNumberInputProps {
  value: number;
  onChange: (n: number) => void;
  decimal?: boolean; // true = aceita vírgula decimal; false (padrão) = inteiro
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

// Input numérico que mantém o texto digitado em um buffer local, evitando que o
// valor seja reformatado a cada tecla (o que impedia digitar a vírgula decimal).
export function BufferedNumberInput({
  value, onChange, decimal = true, placeholder, className, readOnly, disabled,
}: BufferedNumberInputProps) {
  const display = React.useCallback(
    (n: number) => (n ? (decimal ? num(n) : String(n)) : ""),
    [decimal],
  );
  const [text, setText] = React.useState(() => display(value));
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setText(display(value));
  }, [value, display]);

  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(display(value)); }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(decimal ? parseBR(raw) : parseInt2(raw));
      }}
      className={cn(
        "h-9 rounded-md bg-input px-2 text-sm mono border border-border",
        disabled ? "opacity-50 cursor-not-allowed" : "",
        readOnly ? "opacity-90 cursor-not-allowed" : "",
        className,
      )}
    />
  );
}
