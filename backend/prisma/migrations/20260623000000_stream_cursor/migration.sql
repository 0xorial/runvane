-- Global monotonic stream cursor (single row, id=0). Bumped in the same
-- transaction as each chat_entries mutation; its value is the event seq and the
-- snapshot watermark. Recovery is re-snapshot, so it need not survive restart
-- durably — living in the DB just makes the watermark consistent with entries.
CREATE TABLE "stream_cursor" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "stream_cursor" ("id", "value") VALUES (0, 0);
