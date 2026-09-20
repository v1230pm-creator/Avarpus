import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { API_BASE_URL, AUTH_KEY } from "@/lib/auth";

function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Renders the other party's chat photo. Profile photos live behind
 * `requireAuth` (no public URL), so a plain `<img src>` cannot carry the
 * bearer token — this fetches the bytes once and renders them as a blob URL,
 * falling back to initials when there is no photo or the fetch fails.
 */
export function ChatAvatar({
  name,
  photoPath,
  className,
}: {
  name: string;
  photoPath?: string | null;
  className?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    if (!photoPath) return;
    const token = localStorage.getItem(AUTH_KEY);
    if (!token) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    const base = API_BASE_URL ?? "";
    fetch(`${base}/api/storage${photoPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.blob() : Promise.reject(response)))
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photoPath]);

  return (
    <Avatar className={className}>
      {blobUrl && <AvatarImage src={blobUrl} alt={name} />}
      <AvatarFallback>{initialsFor(name) || "?"}</AvatarFallback>
    </Avatar>
  );
}
