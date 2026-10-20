"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isoToDate, dateToISO } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DatePickerBRProps {
  value: string; // data em formato ISO (yyyy-mm-dd)
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
}

// Campo de data no formato brasileiro (dd/mm/aaaa) com calendário visual
export function DatePickerBR({ value, onChange, className, placeholder = "dd/mm/aaaa" }: DatePickerBRProps) {
  const [open, setOpen] = React.useState(false);
  const selected = isoToDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md bg-input px-3 text-sm mono text-left",
            className,
          )}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? format(selected, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
          </span>
          <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            if (d) {
              onChange(dateToISO(d));
              setOpen(false);
            }
          }}
          locale={ptBR}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
