import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";

/**
 * Deliberately plain building blocks for the Automations Area. PLO-417 ships
 * a functional read-and-operate surface with existing T3 primitives only; a
 * designed UI is a separate owner-in-the-loop ticket.
 */

export function SectionTitle(props: { readonly children: string }) {
  return <Text className="mt-4 font-t3-bold text-foreground">{props.children}</Text>;
}

export function FieldRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row justify-between gap-3 py-1">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="flex-1 text-right text-sm text-foreground" selectable>
        {props.value}
      </Text>
    </View>
  );
}

export function CodeBlock(props: { readonly text: string }) {
  return (
    <View className="rounded-2xl border border-border bg-card p-3">
      <Text className="font-mono text-xs leading-normal text-foreground" selectable>
        {props.text}
      </Text>
    </View>
  );
}

export function PlainButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className={`items-center rounded-full px-5 py-3 active:opacity-70 ${
        props.destructive ? "bg-rose-600" : "bg-primary"
      } ${props.disabled ? "opacity-40" : ""}`}
    >
      <Text
        className={`text-sm font-t3-bold ${props.destructive ? "text-white" : "text-primary-foreground"}`}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function ListRow(props: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="rounded-2xl border border-border bg-card px-4 py-3 active:opacity-70"
    >
      <Text className="font-t3-bold text-foreground">{props.title}</Text>
      {props.lines.map((line, index) => (
        <Text key={index} className="mt-0.5 text-sm text-foreground-muted">
          {line}
        </Text>
      ))}
    </Pressable>
  );
}
