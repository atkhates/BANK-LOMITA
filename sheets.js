// sheets.js — optional Google Sheets sync
const { google } = require("googleapis");
const fs = require("fs");

const SHEETS_ID = process.env.SHEETS_ID;
const EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
let KEY = process.env.GOOGLE_PRIVATE_KEY || "";
if (KEY.startsWith('"') && KEY.endsWith('"')) KEY = KEY.slice(1, -1);
KEY = KEY.replace(/\\n/g, "\n");

function enabled() {
  return SHEETS_ID && EMAIL && KEY;
}

function auth() {
  return new google.auth.JWT({
    email: EMAIL,
    key: KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

async function ensureHeaders(sheets, range, headers) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEETS_ID, range });
  if (!res.data.values || !res.data.values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEETS_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [headers] }
    });
  }
}

module.exports = {
  // Write all users to “Users!A:K”
  async syncUsers(usersObj) {
    if (!enabled()) return;
    const jwt = auth();
    const sheets = google.sheets({ version: "v4", auth: jwt });

    const headers = [
      "UserID","Name","Country","Age","Birth","Income","Rank","Balance",
      "Status","Kind","Faction"
    ];
    await ensureHeaders(sheets, "Users!A1:K1", headers);

    const rows = Object.entries(usersObj).map(([id, u]) => ([
      id, u.name || "", u.country || "", u.age ?? "", u.birth || "",
      u.income ?? 0, u.rank || "", u.balance ?? 0, u.status || "",
      u.kind || "", u.faction || ""
    ]));

    await sheets.spreadsheets.values.clear({ spreadsheetId: SHEETS_ID, range: "Users!A2:K" });
    if (rows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEETS_ID,
        range: "Users!A2",
        valueInputOption: "RAW",
        requestBody: { values: rows }
      });
    }
  },

  // Append one transaction to “Tx!A:D”
  async logTx(row) {
    if (!enabled()) return;
    const jwt = auth();
    const sheets = google.sheets({ version: "v4", auth: jwt });

    const headers = ["Time","Type","Actor","Details"];
    await ensureHeaders(sheets, "Tx!A1:D1", headers);

    const when = new Date().toISOString();
    const pretty = JSON.stringify(row);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEETS_ID,
      range: "Tx!A2",
      valueInputOption: "RAW",
      requestBody: { values: [[when, row.type || "", row.actor || "", pretty]] }
    });
  }
};
