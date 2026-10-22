"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const LINKS = [
  { href: "/", label: "Songs", match: (p: string) => p === "/" || p.startsWith("/songs") },
  { href: "/setlists", label: "Setlists", match: (p: string) => p.startsWith("/setlists") },
  { href: "/edit", label: "Teacher", match: (p: string) => p.startsWith("/edit") },
];

function Links({ className, path }: { className?: string; path: string }) {
  return (
    <nav className={className} aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

function Current({ className }: { className?: string }) {
  return <Links className={className} path={usePathname()} />;
}

// The path is only known at request time, so the static shell shows the links unhighlighted.
export function NavLinks({ className }: { className?: string }) {
  return (
    <Suspense fallback={<Links className={className} path="" />}>
      <Current className={className} />
    </Suspense>
  );
}
