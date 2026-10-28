const fetchedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23'
});

export function formatFetchedAt(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return `${fetchedAtFormatter.format(time)}（北京时间）`;
}
