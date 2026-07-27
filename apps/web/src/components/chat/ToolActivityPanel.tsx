import { EyeIcon, GlobeIcon, Link2Icon, SquarePenIcon, TerminalIcon } from "lucide-react";
import { memo, type ReactNode } from "react";

import { workEntryIndicatesToolFailure, type WorkLogEntry } from "../../session-logic";
import { cn } from "~/lib/utils";
import {
  formatToolActivitySummary,
  formatWorkLogEntryHeading,
  resolveToolActivityEntryIcon,
  resolveToolActivitySummaryIcon,
  type ToolActivityLineIcon,
} from "./MessagesTimeline.logic";

/** Matches chat layout v2 message body line box. */
export const CHAT_LAYOUT_V2_TEXT_LINE_CLASS = "text-sm leading-[1.375]";

/** Grey secondary activity line — same height as a message text line. */
export const CHAT_LAYOUT_V2_ACTIVITY_LINE_CLASS = cn(
  CHAT_LAYOUT_V2_TEXT_LINE_CLASS,
  "relative m-0 block w-fit max-w-full min-h-0 border-0 bg-transparent p-0 text-muted-foreground/60",
);

/** Expand affordance — visible on hover/focus only; absolutely placed so line height stays exact. */
export const CHAT_LAYOUT_V2_ACTIVITY_EXPAND_ICON_CLASS =
  "size-3.5 shrink-0 opacity-0 transition-opacity group-hover/activity:opacity-60 group-focus-visible/activity:opacity-100";

function ToolActivityLineIcon({
  name,
  className,
}: {
  name: ToolActivityLineIcon;
  className?: string;
}) {
  const iconClass = cn("size-3.5 shrink-0 opacity-70", className);
  switch (name) {
    case "edit":
      return <SquarePenIcon className={iconClass} aria-hidden />;
    case "terminal":
      return <TerminalIcon className={iconClass} aria-hidden />;
    case "globe":
      return <GlobeIcon className={iconClass} aria-hidden />;
    case "eye":
      return <EyeIcon className={iconClass} aria-hidden />;
    case "link":
    default:
      return <Link2Icon className={iconClass} aria-hidden />;
  }
}

export const ToolActivityLine = memo(function ToolActivityLine({
  icon,
  children,
  trailing,
  failed = false,
  className,
  as = "div",
  ...props
}: {
  icon?: ToolActivityLineIcon;
  children: ReactNode;
  trailing?: ReactNode;
  failed?: boolean;
  className?: string;
  as?: "div" | "button";
} & React.ComponentPropsWithoutRef<"button">) {
  const content = (
    <>
      {icon ? (
        <ToolActivityLineIcon
          name={icon}
          {...(failed ? { className: "text-destructive opacity-90" } : {})}
        />
      ) : null}
      <span className={cn("block min-w-0 truncate", failed ? "text-destructive" : null)}>
        {children}
      </span>
      {trailing ? (
        <span className="absolute end-0 top-0 flex h-[1.375em] items-center">{trailing}</span>
      ) : null}
    </>
  );

  if (as === "button") {
    return (
      <button
        type="button"
        className={cn(
          CHAT_LAYOUT_V2_ACTIVITY_LINE_CLASS,
          "group/activity cursor-pointer text-left transition-colors hover:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          icon ? "flex items-center gap-1.5" : null,
          className,
        )}
        data-tool-activity-line="true"
        {...props}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        CHAT_LAYOUT_V2_ACTIVITY_LINE_CLASS,
        trailing ? "group/activity" : null,
        icon ? "flex items-center gap-1.5" : null,
        "select-none",
        className,
      )}
      data-tool-activity-line="true"
    >
      {content}
    </div>
  );
});

export const ToolActivityEntryLine = memo(function ToolActivityEntryLine({
  entry,
  text,
  trailingMutedLabel = null,
  trailing = null,
  failed,
  leadingIcon = false,
  as = "div",
  className,
  children,
  ...props
}: {
  entry: WorkLogEntry;
  text?: string;
  trailingMutedLabel?: string | null;
  trailing?: ReactNode;
  failed?: boolean;
  leadingIcon?: boolean;
  as?: "div" | "button";
  children?: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"button">, "children">) {
  const isFailed = failed ?? workEntryIndicatesToolFailure(entry);
  const heading = text ?? formatWorkLogEntryHeading(entry);
  const icon = leadingIcon ? resolveToolActivityEntryIcon(entry) : undefined;

  return (
    <ToolActivityLine
      as={as}
      icon={icon}
      failed={isFailed}
      {...(className !== undefined ? { className } : {})}
      trailing={
        trailing ??
        (trailingMutedLabel ? (
          <span className="shrink-0 text-muted-foreground/55">{trailingMutedLabel}</span>
        ) : null)
      }
      {...props}
    >
      {children ?? heading}
    </ToolActivityLine>
  );
});

export const ToolActivitySummaryLine = memo(function ToolActivitySummaryLine({
  entries,
  fallbackLabel,
  trailing = null,
  leadingIcon = false,
  as = "div",
  className,
  ...props
}: {
  entries: ReadonlyArray<WorkLogEntry>;
  fallbackLabel?: string;
  trailing?: ReactNode;
  leadingIcon?: boolean;
  as?: "div" | "button";
} & Omit<React.ComponentPropsWithoutRef<"button">, "children">) {
  const summary = entries.length > 0 ? formatToolActivitySummary(entries) : (fallbackLabel ?? "");
  const icon =
    leadingIcon && entries.length > 0 ? resolveToolActivitySummaryIcon(entries) : undefined;

  if (!summary) {
    return null;
  }

  return (
    <ToolActivityLine
      as={as}
      icon={icon}
      {...(className !== undefined ? { className } : {})}
      trailing={trailing}
      {...props}
    >
      {summary}
    </ToolActivityLine>
  );
});

/** @deprecated Use flat activity lines; kept for non-v2 fallbacks during migration. */
export const CHAT_LAYOUT_V2_ACTIVITY_PILL_CLASS = CHAT_LAYOUT_V2_ACTIVITY_LINE_CLASS;

/** @deprecated Use ToolActivityEntryLine */
export const ToolActivityEntryPill = ToolActivityEntryLine;

export const ToolActivityDrawer = memo(function ToolActivityDrawer({
  entries,
  className,
}: {
  entries: ReadonlyArray<WorkLogEntry>;
  className?: string;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("flex w-full max-w-[min(100%,36rem)] flex-col items-start gap-1", className)}
      data-tool-activity-drawer="true"
    >
      {entries.map((entry) => (
        <ToolActivityEntryLine key={entry.id} entry={entry} />
      ))}
    </div>
  );
});
