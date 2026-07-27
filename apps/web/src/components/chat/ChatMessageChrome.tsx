import { useUser } from "@clerk/react";
import { type ProviderDriverKind } from "@t3tools/contracts";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { BotIcon } from "lucide-react";
import { type ReactNode } from "react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatShortTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export type TimelineAssistantAuthor = {
  /** Message author label — the model name, not the harness. */
  displayName: string;
  /** Harness/provider label used for icon initials when no driver glyph exists. */
  harnessDisplayName: string;
  driver: ProviderDriverKind;
  accentColor?: string;
};

function InitialsAvatar({ label, className }: { label: string; className?: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground",
        className,
      )}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function ClerkChatUserAvatar() {
  const { user } = useUser();
  const imageUrl = user?.imageUrl;
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="size-10 shrink-0 rounded-full object-cover outline outline-1 outline-black/10 dark:outline-white/10"
      />
    );
  }
  const label =
    user?.fullName?.trim() ||
    user?.firstName?.trim() ||
    user?.username?.trim() ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "You";
  return <InitialsAvatar label={label} />;
}

function ClerkChatUserDisplayName() {
  const { user } = useUser();
  return (
    user?.fullName?.trim() ||
    user?.firstName?.trim() ||
    user?.username?.trim() ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "You"
  );
}

export function ChatUserAvatar() {
  if (!hasCloudPublicConfig()) {
    return <InitialsAvatar label="You" />;
  }
  return <ClerkChatUserAvatar />;
}

export function ChatUserDisplayName() {
  if (!hasCloudPublicConfig()) {
    return "You";
  }
  return <ClerkChatUserDisplayName />;
}

export function AssistantAvatar({ author }: { author: TimelineAssistantAuthor | null }) {
  if (!author) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <BotIcon className="size-5 text-muted-foreground" aria-hidden />
      </span>
    );
  }

  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"
      style={author.accentColor ? { backgroundColor: `${author.accentColor}33` } : undefined}
    >
      <ProviderInstanceIcon
        driverKind={author.driver}
        displayName={author.harnessDisplayName}
        accentColor={author.accentColor}
        className="size-5"
        iconClassName="size-5"
      />
    </span>
  );
}

export function DiscordMessageLayout({
  avatar,
  name,
  timestamp,
  timestampFormat,
  children,
  actions,
  className,
}: {
  avatar: ReactNode;
  name: ReactNode;
  timestamp: string;
  timestampFormat: TimestampFormat;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("group/message flex gap-3", className)} data-chat-message-layout="discord">
      <div className="mt-0.5 shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground" data-chat-message-author="">
            {name}
          </span>
          <span className="inline-flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <time
                    className="text-xs text-muted-foreground tabular-nums"
                    dateTime={timestamp}
                  />
                }
              >
                {formatShortTimestamp(timestamp, timestampFormat)}
              </TooltipTrigger>
              <TooltipPopup>{formatChatTimestampTooltip(timestamp, timestampFormat)}</TooltipPopup>
            </Tooltip>
            {actions ? (
              <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100">
                {actions}
              </span>
            ) : null}
          </span>
        </div>
        <div className="mt-1.5 min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function DiscordMessageContinuationLayout({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("group/message flex gap-3", className)}
      data-chat-message-layout="discord-continuation"
    >
      <div className="size-10 shrink-0" aria-hidden />
      <div className="relative min-w-0 flex-1">
        {actions ? (
          <div className="absolute end-0 top-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100">
            {actions}
          </div>
        ) : null}
        <div className="min-w-0 pt-2">{children}</div>
      </div>
    </div>
  );
}
