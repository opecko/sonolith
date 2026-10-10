import { ChevronLeft } from "lucide-react";
import { useNav } from "../stores/nav";
import SearchBox from "./SearchBox";
import Avatar from "./Avatar";
import { UpdateChip } from "./UpdateDialog";

export default function TopBar() {
  const canBack = useNav((s) => s.history.length > 0);
  const back = useNav((s) => s.back);
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--c-outline)] bg-[var(--c-bg)] px-6">
      <button className="icon-btn h-10 w-10" onClick={back} disabled={!canBack} aria-label="Back">
        <ChevronLeft size={24} />
      </button>
      <SearchBox />
      <div className="ml-auto flex items-center gap-3">
        <UpdateChip />
        <Avatar />
      </div>
    </header>
  );
}
