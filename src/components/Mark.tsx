/** The app mark: a lancet window split into four panes, one per jewel hue. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5C7.5 3.4 5 7 5 11v11.5h14V11c0-4-2.5-7.6-7-9.5Z" fill="#121212" />
      <path d="M11.2 3.3C8.3 5 6.6 7.7 6.6 11v1.4h4.6Z" fill="var(--cobalt)" />
      <path d="M12.8 3.3c2.9 1.7 4.6 4.4 4.6 7.7v1.4h-4.6Z" fill="var(--ruby)" />
      <path d="M6.6 13.9h4.6v7.1H6.6Z" fill="var(--amber)" />
      <path d="M12.8 13.9h4.6v7.1h-4.6Z" fill="var(--green)" />
    </svg>
  );
}
