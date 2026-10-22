/** Jewel hue per kind of section, so students can tell where they are at a glance. */
export type Hue = "cobalt" | "ruby" | "green" | "amber" | "plain";

export function sectionHue(kind: string): Hue {
  if (kind.startsWith("chorus")) return "ruby";
  if (kind.startsWith("verse")) return "cobalt";
  if (kind.startsWith("bridge")) return "green";
  if (kind.startsWith("pre")) return "amber";
  return "plain";
}
