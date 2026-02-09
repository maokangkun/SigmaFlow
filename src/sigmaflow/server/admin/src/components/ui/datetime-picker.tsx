import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date & time',
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    value
  );
  const [hours, setHours] = React.useState(
    value ? value.getHours().toString().padStart(2, '0') : '00'
  );
  const [minutes, setMinutes] = React.useState(
    value ? value.getMinutes().toString().padStart(2, '0') : '00'
  );
  const [seconds, setSeconds] = React.useState(
    value ? value.getSeconds().toString().padStart(2, '0') : '00'
  );

  React.useEffect(() => {
    if (value) {
      setSelectedDate(value);
      setHours(value.getHours().toString().padStart(2, '0'));
      setMinutes(value.getMinutes().toString().padStart(2, '0'));
      setSeconds(value.getSeconds().toString().padStart(2, '0'));
    }
  }, [value]);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const newDate = new Date(date);
      newDate.setHours(parseInt(hours) || 0);
      newDate.setMinutes(parseInt(minutes) || 0);
      newDate.setSeconds(parseInt(seconds) || 0);
      setSelectedDate(newDate);
      onChange?.(newDate);
    }
  };

  const handleTimeChange = (
    type: 'hours' | 'minutes' | 'seconds',
    value: string
  ) => {
    const numValue = parseInt(value) || 0;
    let finalValue = value;

    if (type === 'hours') {
      if (numValue > 23) finalValue = '23';
      setHours(finalValue.padStart(2, '0'));
    } else if (type === 'minutes' || type === 'seconds') {
      if (numValue > 59) finalValue = '59';
      if (type === 'minutes') setMinutes(finalValue.padStart(2, '0'));
      else setSeconds(finalValue.padStart(2, '0'));
    }

    if (selectedDate) {
      const newDate = new Date(selectedDate);
      if (type === 'hours') newDate.setHours(parseInt(finalValue) || 0);
      if (type === 'minutes') newDate.setMinutes(parseInt(finalValue) || 0);
      if (type === 'seconds') newDate.setSeconds(parseInt(finalValue) || 0);
      setSelectedDate(newDate);
      onChange?.(newDate);
    }
  };

  const formatDateTime = (date: Date | undefined) => {
    if (!date) return placeholder;
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'justify-between font-normal h-9 rounded-full',
            !selectedDate && 'text-muted-foreground',
            className
          )}
        >
          {formatDateTime(selectedDate)}
          <CalendarIcon className="w-4 h-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3 space-y-3">
          <Calendar
            navLayout="around"
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            captionLayout="dropdown"
            fromYear={2020}
            toYear={2030}
            initialFocus
          />
          <div className="border-t pt-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">
                  Hours
                </label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={hours}
                  onChange={(e) => handleTimeChange('hours', e.target.value)}
                  className="h-8 text-center"
                />
              </div>
              <div className="text-2xl text-muted-foreground mt-5">:</div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">
                  Minutes
                </label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={minutes}
                  onChange={(e) => handleTimeChange('minutes', e.target.value)}
                  className="h-8 text-center"
                />
              </div>
              <div className="text-2xl text-muted-foreground mt-5">:</div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">
                  Seconds
                </label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={seconds}
                  onChange={(e) => handleTimeChange('seconds', e.target.value)}
                  className="h-8 text-center"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedDate(undefined);
                onChange?.(undefined);
                setOpen(false);
              }}
              className="flex-1"
            >
              Clear
            </Button>
            <Button size="sm" onClick={() => setOpen(false)} className="flex-1">
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
