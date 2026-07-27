import { BotIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { type TimelineAssistantAuthor } from "./ChatMessageChrome";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
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
  if (!author) {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
        <BotIcon className="size-3 text-muted-foreground" aria-hidden />
      </span>
    );
  }

  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
      style={author.accentColor ? { backgroundColor: `${author.accentColor}33` } : undefined}
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
}: {
  modelLabel: string;
  author: TimelineAssistantAuthor | null;
  startedAt: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Indent to the message content column (avatar 2.5rem + gap-3), then
        // start the small profile there — text follows the circle.
        "flex min-h-5 items-center gap-2 ps-[3.25rem]",
        className,
      )}
      data-composer-working-status="true"
      aria-live="polite"
    >
      <WorkingStatusAvatar author={author} />
      <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-muted-foreground/80">
        {startedAt ? (
          <>
            <span className="font-medium text-muted-foreground">{modelLabel}</span>
            {" is working for "}
            <LiveWorkingTimer createdAt={startedAt} />
          </>
        ) : (
          <>
            <span className="font-medium text-muted-foreground">{modelLabel}</span>
            {" is working…"}
          </>
        )}
      </span>
    </div>
  );
}
