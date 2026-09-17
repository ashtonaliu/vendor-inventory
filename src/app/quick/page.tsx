import type { Metadata } from "next";
import { getConditionMultipliers, getRecentEvents } from "@/lib/queries";
import { QuickTrade } from "./quick-trade";

export const metadata: Metadata = { title: "Buy / Sell" };
export const dynamic = "force-dynamic";

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function QuickTradePage() {
  const [events, multipliers] = await Promise.all([getRecentEvents(), getConditionMultipliers()]);
  const today = localDateString();
  const showToday = events.find((e) => e.startsOn === today);

  return (
    <QuickTrade
      initialEvents={events}
      defaultWhere={showToday ? { eventId: showToday.id, channel: "show" } : { eventId: null, channel: "local" }}
      today={today}
      multipliers={multipliers}
    />
  );
}
