import { BotIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import {
  CHAT_LAYOUT_V2_CONTENT_INSET,
  CHAT_MESSAGE_ASSISTANT_AVATAR_FILL_CLASS,
  type TimelineAssistantAuthor,
} from "./ChatMessageChrome";
import { formatWorkLogEntryHeading, type LiveTurnToolActivity } from "./MessagesTimeline.logic";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ToolActivityDrawer } from "./ToolActivityPanel";
import { formatWorkingTimerNow } from "./workingTimer";

function LiveWorkingTimer({ createdAt }: { createdAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatWorkingTimerNow(createdAt);

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatWorkingTimerNow(createdAt);
      }
    };
    updateText();
    const id = setInterval(updateText, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  return (
    <span ref={textRef} className="tabular-nums">
      {initialText}
    </span>
  );
}

function WorkingStatusAvatar({ author }: { author: TimelineAssistantAuthor | null }) {
  const surfaceClass =
    "box-border flex size-5 shrink-0 items-center justify-center rounded-full border border-border/80 bg-accent dark:border-white/15 dark:bg-muted/90";

  if (!author) {
    return (
      <span className={cn(surfaceClass, CHAT_MESSAGE_ASSISTANT_AVATAR_FILL_CLASS)}>
        <BotIcon className="size-3 text-muted-foreground" aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={cn(surfaceClass, CHAT_MESSAGE_ASSISTANT_AVATAR_FILL_CLASS)}
      style={author.accentColor ? { backgroundColor: `${author.accentColor}40` } : undefined}
      aria-hidden
    >
      <ProviderInstanceIcon
        driverKind={author.driver}
        displayName={author.harnessDisplayName}
        accentColor={author.accentColor}
        className="size-3"
        iconClassName="size-3"
      />
    </span>
  );
}

export function ComposerWorkingStatus({
  modelLabel,
  author,
  startedAt,
  className,
  liveToolActivity = null,
  activityDrawerEnabled = false,
}: {
  modelLabel: string;
  author: TimelineAssistantAuthor | null;
  startedAt: string | null;
  className?: string;
  liveToolActivity?: LiveTurnToolActivity | null;
  activityDrawerEnabled?: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const latestToolLabel = liveToolActivity
    ? formatWorkLogEntryHeading(liveToolActivity.latestEntry)
    : null;
  const canOpenDrawer = activityDrawerEnabled && (liveToolActivity?.entries.length ?? 0) > 0;

  const statusText = startedAt ? (
    <>
      <span className="font-medium text-muted-foreground">{modelLabel}</span>
      {latestToolLabel ? (
        <>
          {" · "}
          <span className="font-medium text-foreground/80">{latestToolLabel}</span>
        </>
      ) : null}
      {" · working for "}
      <LiveWorkingTimer createdAt={startedAt} />
      {liveToolActivity && liveToolActivity.totalCount > 1 ? (
        <span className="text-muted-foreground/65">
          {" · "}
          {liveToolActivity.totalCount} tools
        </span>
      ) : null}
    </>
  ) : (
    <>
      <span className="font-medium text-muted-foreground">{modelLabel}</span>
      {latestToolLabel ? (
        <>
          {" · "}
          <span className="font-medium text-foreground/80">{latestToolLabel}</span>
        </>
      ) : null}
      {" is working…"}
    </>
  );

  return (
    <div
      className={cn("flex min-h-5 flex-col", CHAT_LAYOUT_V2_CONTENT_INSET, className)}
      data-composer-working-status="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <WorkingStatusAvatar author={author} />
        {canOpenDrawer ? (
          <button
            type="button"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
            className="min-w-0 flex-1 truncate rounded-md text-left text-[12px] leading-5 text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            {statusText}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-muted-foreground/80">
            {statusText}
          </span>
        )}
      </div>
      {drawerOpen && liveToolActivity ? (
        <ToolActivityDrawer entries={liveToolActivity.entries} className="mt-2" />
      ) : null}
    </div>
  );
}
