// sheets.js — minimal Sheets integration (safe no-ops if env missing)

const { google } = require("googleapis");

const {
  SHEET_ID,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  SHEETS_SYNC_ON_START,
} = process.env;

// If any missing, export safe no-ops
if (!SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  module.exports = {
    syncUsers: async () => {},
    logTx: async () => {},
    onUserChange: async () => {},
  };
  return;
}

// Some hosts store the key with literal \n characters
const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: privateKey,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function ensureHeader(range, headerRow) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [headerRow] },
  });
}

async function syncUsers(usersObj) {
  // Write all users to Users!A:K
  const rows = [["ID","Name","Country","Age","Birth","Income","Rank","Balance","Status","Kind","Faction"]];
  for (const id of Object.keys(usersObj || {})) {
    const u = usersObj[id];
    rows.push([
      id,
      u.name ?? "",
      u.country ?? "",
      u.age ?? "",
      u.birth ?? "",
      u.income ?? "",
      u.rank ?? "",
      u.balance ?? "",
      u.status ?? "",
      u.kind ?? "",
      u.faction ?? "",
    ]);
  }
  await ensureHeader("Users!A1:K1", rows[0]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: "Users!A2:K" });
  if (rows.length > 1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Users!A2",
      valueInputOption: "RAW",
      requestBody: { values: rows.slice(1) },
    });
  }
}

async function logTx(entry) {
  // Append to Tx!A:E
  const header = ["Timestamp","Type","From","To","Amount","Fee"];
  await ensureHeader("Tx!A1:F1", header);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Tx!A:F",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        new Date().toISOString(),
        entry.type || "",
        entry.from || "",
        entry.to || "",
        entry.amount ?? "",
        entry.fee ?? "",
      ]],
    },
  });
}

async function onUserChange(user) {
  // Just re-sync whole users table for simplicity (small bots it’s fine)
  // You could optimize by upserting the row with ID==user.id if you like.
  return; // optional no-op; full sync happens on every save in index.js already
}

module.exports = { syncUsers, logTx, onUserChange };
