const { google } = require('googleapis');

(async () => {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Users!A1:Z1',
    });

    console.log('OK. Header row:', res.data.values?.[0] || '(empty)');
  } catch (e) {
    console.error('Sheets test failed:', e?.response?.data || e);
  }
})();