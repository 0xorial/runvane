# ChatPage.tsx — file length

- **Issue**: 384 lines, over the 350-line cap (pre-existing).
- **Why it matters**: this is the central page component; growth makes
  it harder to find any one concern.
- **Status**: attachment chip + mode picker extracted into
  `components/chat/AttachmentChips.tsx` (done).
- **Remaining suggested split**:
  - Extract `sendMessageToConversation` + `defaultAttachmentMode` into
    `components/chat/sendMessage.ts`.
  - Optionally extract the composer JSX (huge `MessageComposer` props
    block) into a `<ChatComposer />` wrapper.
