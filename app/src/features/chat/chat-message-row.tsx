import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { useAppStateSelector } from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

import { Message } from "./chat-content";
import { createChatMessageRowSelector } from "./chat-transcript-index";

export type ChatMessageRowCallbacks = Readonly<{
  onDisclosureInteractionChange: (active: boolean) => void;
  onOpenDiff: (proposalId: string) => void;
  onOpenFullContent: (messageId: string) => void;
  onOpenGeneratedMedia: (messageId: string, attachmentId: string) => void;
  onReport: (messageId: string) => void;
}>;

export const ChatMessageRow = memo(function ChatMessageRow({
  callbacks,
  conversationId,
  first,
  messageId,
}: {
  callbacks: ChatMessageRowCallbacks;
  conversationId: string;
  first: boolean;
  messageId: string;
}) {
  const palette = useAppPalette();
  const selector = useMemo(
    () => createChatMessageRowSelector(conversationId, messageId),
    [conversationId, messageId],
  );
  const { message, proposal } = useAppStateSelector(selector);
  if (!message) return null;

  return (
    <View style={first ? undefined : styles.gap}>
      <Message
        message={message}
        onDisclosureInteractionChange={callbacks.onDisclosureInteractionChange}
        onOpenDiff={callbacks.onOpenDiff}
        onOpenFullContent={callbacks.onOpenFullContent}
        onOpenGeneratedMedia={callbacks.onOpenGeneratedMedia}
        onReport={callbacks.onReport}
        palette={palette}
        proposal={proposal}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  gap: { marginTop: spacing.md },
});
