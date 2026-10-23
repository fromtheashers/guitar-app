/**
 * Shares a page of the app through the phone's share sheet (WhatsApp, Messages…),
 * or copies its link where there isn't one. Browser only.
 */
export async function shareLink(title: string, path: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = new URL(path, window.location.origin).toString();
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
