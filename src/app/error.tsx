"use client";

import { Notice } from "@/components/notice";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <Notice title="Något gick fel">
      <button type="button" onClick={() => retry()} className="font-medium text-accent">
        Försök igen
      </button>
    </Notice>
  );
}
