import { openDatabase } from "../infra/db/client.js";
import { logger } from "../infra/logger.js";
import { runMigrations } from "../infra/db/migrate.js";

const db = openDatabase(process.env.BACKEND2_DB_PATH);
runMigrations(db);
logger.info("[backend] migrations applied");
db.close();
