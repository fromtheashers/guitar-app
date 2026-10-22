import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 560, paddingTop: "8vh" }}>
      <h1>We couldn&apos;t find that</h1>
      <p className="muted">The song or setlist may have been deleted, or the link was copied incompletely.</p>
      <p>
        <Link href="/" className="btn">
          Back to songs
        </Link>
      </p>
    </div>
  );
}
