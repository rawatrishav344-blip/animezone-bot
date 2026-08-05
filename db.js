const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data.json");
const BACKUP_PATH = path.join(__dirname, "data.backup.json");

function backup() {
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
  }
}
function read() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (fs.existsSync(BACKUP_PATH)) {
      console.log("Restoring database from backup...");
      fs.copyFileSync(BACKUP_PATH, DB_PATH);
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      return JSON.parse(raw);
    }
    throw err;
  }
}

function write(data) {
  backup();
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Database write failed:", err);
    throw err;
  }
}

function update(mutateFn) {
  const data = read();
  const result = mutateFn(data);
  write(data);
  return result;
}

module.exports = { read, write, update, backup };
