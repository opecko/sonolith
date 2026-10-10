import { Bell, Check } from "lucide-react";
import { useState } from "react";
import { getChannel, setSubscribed } from "../api/ytm";
import { Shelves } from "../components/Shelves";
import { ErrorBox, Loading } from "../components/Status";
import Thumb from "../components/Thumb";
import { useAsync } from "../hooks/useData";
import { useToast } from "../stores/toast";

/** User channel page (podcast creators, profiles): avatar, title, subscribe, then its shelves. */
export default function ChannelView({ id }: { id: string }) {
  const { data: c, error, reload } = useAsync(`channel:${id}`, () => getChannel(id));
  const [sub, setSub] = useState<boolean | null>(null);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!c) return <Loading />;
  const subscribed = sub ?? c.subscribed;
  const toggle = () => {
    setSub(!subscribed);
    setSubscribed(c.id, !subscribed).catch((e) => {
      setSub(subscribed);
      useToast.getState().show(`Could not update subscription: ${e instanceof Error ? e.message : e}`);
    });
  };
  return (
    <>
      <header className="mb-12 mt-8 flex items-center gap-8">
        <Thumb src={c.avatar} round className="h-36 w-36 shrink-0" />
        <h1 className="min-w-0 flex-1 text-4xl font-bold tracking-tight">{c.title}</h1>
        <button onClick={toggle} aria-pressed={subscribed}
          className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium ${subscribed ? "border border-[var(--c-outline)] hover:bg-[var(--c-hover)]" : "bg-button text-on-button hover:bg-button/90"}`}>
          {subscribed ? <Check size={16} aria-hidden /> : <Bell size={16} aria-hidden />}
          {subscribed ? "Subscribed" : "Subscribe"} {c.subscribers && <span className={subscribed ? "text-[var(--c-text-muted)]" : "text-on-button/60"}>{c.subscribers}</span>}
        </button>
      </header>
      <Shelves shelves={c.shelves} />
    </>
  );
}
