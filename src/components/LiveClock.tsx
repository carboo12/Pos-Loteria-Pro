import React, { useState, useEffect } from "react";

const formatTo12HourTime = (dateInput: Date | string | number, includeSeconds: boolean = true): string => {
  let date: Date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else if (typeof dateInput === "number") {
    date = new Date(dateInput);
  } else {
    date = new Date(dateInput);
  }
  if (isNaN(date.getTime())) return "--:--:--";
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = hours < 10 ? "0" + hours : hours;
  const strMinutes = minutes < 10 ? "0" + minutes : minutes;
  const strSeconds = seconds < 10 ? "0" + seconds : seconds;
  return includeSeconds
    ? `${strHours}:${strMinutes}:${strSeconds} ${ampm}`
    : `${strHours}:${strMinutes} ${ampm}`;
};

interface LiveClockProps {
  className?: string;
  prefix?: string;
  includeSeconds?: boolean;
}

export const LiveClock: React.FC<LiveClockProps> = React.memo(({
  className = "bg-blue-950 px-2 py-0.5 rounded text-white animate-pulse",
  prefix = "Reloj: ",
  includeSeconds = true
}) => {
  const [timeText, setTimeText] = useState(() => formatTo12HourTime(new Date(), includeSeconds));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeText(formatTo12HourTime(new Date(), includeSeconds));
    }, 1000);
    return () => clearInterval(timer);
  }, [includeSeconds]);

  return (
    <span className={className}>
      {prefix}{timeText}
    </span>
  );
});

export default LiveClock;
