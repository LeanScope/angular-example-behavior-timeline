/** `m:ss` below an hour, `h:mm:ss` above: the timeline's axis and the preview's clock. */
export function clockLabel(totalSeconds: number): string {
  // Before the start: no label (the axis has a little air left of 0:00).
  if (totalSeconds < -0.5) return '';
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
