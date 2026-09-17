"use client";

import { useState, useTransition } from "react";
import { CHANNEL_LABELS, CHANNELS, parseDollarsToCents, type Channel } from "@/lib/domain";
import type { EventOption } from "@/lib/queries";
import { createEventAction } from "./actions";

export type Where = { eventId: number | null; channel: Channel };

const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function WherePicker({
  events,
  value,
  today,
  onChange,
  onEventCreated,
}: {
  events: EventOption[];
  value: Where;
  today: string;
  onChange: (where: Where) => void;
  onEventCreated: (event: EventOption) => void;
}) {
  const [adding, setAdding] = useState(false);
  const selectValue = value.eventId != null ? `event:${value.eventId}` : `channel:${value.channel}`;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label htmlFor="where" className="sr-only">
          Where
        </label>
        <select
          id="where"
          value={selectValue}
          onChange={(e) => {
            const [kind, raw] = e.target.value.split(":");
            onChange(kind === "event" ? { eventId: Number(raw), channel: "show" } : { eventId: null, channel: raw as Channel });
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {events.length > 0 && (
            <optgroup label="Card shows">
              {events.map((event) => (
                <option key={event.id} value={`event:${event.id}`}>
                  {event.name} · {dateLabel.format(new Date(`${event.startsOn}T12:00:00`))}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Not at a show">
            {CHANNELS.filter((c) => c !== "show").map((channel) => (
              <option key={channel} value={`channel:${channel}`}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="h-10 shrink-0 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {adding ? "Cancel" : "Add show"}
        </button>
      </div>

      {adding && (
        <NewShowForm
          today={today}
          onCreated={(event) => {
            onEventCreated(event);
            onChange({ eventId: event.id, channel: "show" });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function NewShowForm({ today, onCreated }: { today: string; onCreated: (event: EventOption) => void }) {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [fee, setFee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const tableFeeCents = fee.trim() === "" ? 0 : parseDollarsToCents(fee);
    if (!name.trim()) return setError("Enter the show's name.");
    if (tableFeeCents == null) return setError("Enter the table fee as a dollar amount.");

    startTransition(async () => {
      const result = await createEventAction({ name, startsOn, tableFeeCents });
      if (result.ok) onCreated(result.event);
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <input
        aria-label="Show name"
        placeholder="San Jose Card Show"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <div className="flex gap-2">
        <input
          aria-label="Show date"
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <input
          aria-label="Table fee"
          inputMode="decimal"
          placeholder="Table fee $"
          value={fee}
          onChange={(e) => {
            setFee(e.target.value);
            setError(null);
          }}
          className="h-10 w-28 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-10 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save show"}
      </button>
    </form>
  );
}
