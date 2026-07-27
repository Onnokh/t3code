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

const CHAT_MESSAGE_AVATAR_CLASS = "size-9 shrink-0 rounded-full";

/** Visible avatar plate — border stays inside size-* so timeline overflow does not clip it. */
const CHAT_MESSAGE_AVATAR_SURFACE_CLASS =
  "box-border border border-border/80 bg-accent dark:border-white/15 dark:bg-muted/90";

const CHAT_MESSAGE_USER_AVATAR_FILL_CLASS =
  "bg-foreground/[0.09] text-foreground/90 dark:bg-foreground/[0.14] dark:text-foreground";

export const CHAT_MESSAGE_ASSISTANT_AVATAR_FILL_CLASS =
  "bg-muted/95 text-foreground dark:bg-muted/80";

/** Avatar (2.25rem) + gap-3 (0.75rem) — aligns activity rows with message body text. */
export const CHAT_LAYOUT_V2_CONTENT_INSET = "ps-12";

/** Temporary — set true to color layout layers for rhythm debugging. */
export const CHAT_LAYOUT_V2_RHYTHM_DEBUG = false;

function chatMessageAvatarClassName(...extra: Array<string | undefined>) {
  return cn(CHAT_MESSAGE_AVATAR_CLASS, CHAT_MESSAGE_AVATAR_SURFACE_CLASS, ...extra);
}

function InitialsAvatar({ label, className }: { label: string; className?: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "flex items-center justify-center text-sm font-semibold",
        chatMessageAvatarClassName(CHAT_MESSAGE_USER_AVATAR_FILL_CLASS, className),
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
      <span className={chatMessageAvatarClassName("overflow-hidden p-0")}>
        <img src={imageUrl} alt="" className="size-full object-cover" />
      </span>
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
      <span
        className={chatMessageAvatarClassName(
          CHAT_MESSAGE_ASSISTANT_AVATAR_FILL_CLASS,
          "flex items-center justify-center",
        )}
      >
        <BotIcon className="size-4 text-muted-foreground" aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={chatMessageAvatarClassName(
        CHAT_MESSAGE_ASSISTANT_AVATAR_FILL_CLASS,
        "flex items-center justify-center",
      )}
      style={author.accentColor ? { backgroundColor: `${author.accentColor}40` } : undefined}
    >
      <ProviderInstanceIcon
        driverKind={author.driver}
        displayName={author.harnessDisplayName}
        accentColor={author.accentColor}
        className="size-4"
        iconClassName="size-4"
      />
    </span>
  );
}

function ChatMessageBodySlot({ children }: { children: ReactNode }) {
  return (
    <div className="chat-message-body min-w-0" data-chat-message-body="">
      {children}
    </div>
  );
}

function ChatMessageHeaderTimestamp({
  timestamp,
  timestampFormat,
  actions,
}: {
  timestamp: string;
  timestampFormat: TimestampFormat;
  actions?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <time
              className="text-sm leading-none text-muted-foreground tabular-nums"
              dateTime={timestamp}
            />
          }
        >
          {formatShortTimestamp(timestamp, timestampFormat)}
        </TooltipTrigger>
        <TooltipPopup>{formatChatTimestampTooltip(timestamp, timestampFormat)}</TooltipPopup>
      </Tooltip>
      <span
        className={cn(
          "inline-flex h-3.5 items-center gap-0.5",
          actions
            ? "opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100"
            : null,
        )}
        data-chat-message-actions=""
      >
        {actions}
      </span>
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
    <div
      className={cn("group/message flex items-start gap-3", className)}
      data-chat-message-layout="discord"
      {...(CHAT_LAYOUT_V2_RHYTHM_DEBUG ? { "data-chat-rhythm-debug": "" } : {})}
    >
      <div className="shrink-0 overflow-visible" data-chat-message-avatar="">
        {avatar}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1" data-chat-message-content-column="">
        <div
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0 leading-none"
          data-chat-message-header=""
        >
          <span
            className="text-sm font-bold leading-none text-foreground"
            data-chat-message-author=""
          >
            {name}
          </span>
          <ChatMessageHeaderTimestamp
            timestamp={timestamp}
            timestampFormat={timestampFormat}
            actions={actions}
          />
        </div>
        <ChatMessageBodySlot>{children}</ChatMessageBodySlot>
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
      className={cn("group/message flex items-start gap-3", className)}
      data-chat-message-layout="discord-continuation"
      {...(CHAT_LAYOUT_V2_RHYTHM_DEBUG ? { "data-chat-rhythm-debug": "" } : {})}
    >
      <div
        className={cn(CHAT_MESSAGE_AVATAR_CLASS, "shrink-0")}
        aria-hidden
        data-chat-message-avatar=""
      />
      <div
        className="relative flex min-w-0 flex-1 flex-col gap-0.5"
        data-chat-message-content-column=""
      >
        {actions ? (
          <div
            className="absolute end-0 top-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100"
            data-chat-message-actions=""
          >
            {actions}
          </div>
        ) : null}
        <ChatMessageBodySlot>{children}</ChatMessageBodySlot>
      </div>
    </div>
  );
}
