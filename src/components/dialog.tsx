"use client";

import { useId } from "react";

/** A modal that closes on a tap outside it. Open it with `dialogRef.current?.showModal()`. */
export function Dialog({
  dialogRef,
  title,
  text,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  title: string;
  text?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl bg-background text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 id={titleId} className="font-semibold">
            {title}
          </h3>
          {text && <p className="text-sm text-muted">{text}</p>}
        </div>
        {children}
      </div>
    </dialog>
  );
}
