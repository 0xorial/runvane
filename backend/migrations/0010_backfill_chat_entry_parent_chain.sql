UPDATE chat_entries AS e
SET parent_id = (
  SELECT p.id
  FROM chat_entries p
  WHERE p.conversation_id = e.conversation_id
    AND p.conversation_index < e.conversation_index
  ORDER BY p.conversation_index DESC
  LIMIT 1
)
WHERE e.parent_id IS NULL;

UPDATE conversations
SET active_leaf_entry_id = (
  SELECT e.id
  FROM chat_entries e
  WHERE e.conversation_id = conversations.id
  ORDER BY e.conversation_index DESC
  LIMIT 1
)
WHERE active_leaf_entry_id IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM chat_entries e
     WHERE e.conversation_id = conversations.id
       AND e.id = conversations.active_leaf_entry_id
   );
