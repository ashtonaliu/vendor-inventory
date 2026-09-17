"use client";

import { useState, useTransition } from "react";
import { updateLotCertAction } from "@/app/quick/actions";

export function CertEditor({ lotId, certNumber }: { lotId: number; certNumber: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(certNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {certNumber ? `Cert ${certNumber}` : "Add cert number"}
      </button>
    );
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateLotCertAction({ lotId, certNumber: value });
      if (!result.ok) return setError(result.error);
      setValue(result.certNumber ?? "");
      setError(null);
      setEditing(false);
    });
  }

  return (
    <form onSubmit={save} className="space-y-1">
      <div className="flex gap-1">
        <input
          aria-label="Cert number"
          autoFocus
          autoComplete="off"
          placeholder="Cert number"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-8 rounded-md bg-zinc-900 px-2 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "…" : "Save"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </form>
  );
}
