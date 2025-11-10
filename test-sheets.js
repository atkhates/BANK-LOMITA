const { google } = require('googleapis');

(async () => {
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    await auth.authorize();
    console.log('✅ Authentication successful!');
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.SHEET_ID;

    // Get spreadsheet info
    const info = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    console.log('✅ Spreadsheet:', info.data.properties.title);
    console.log('✅ Available sheets:', info.data.sheets.map(s => s.properties.title).join(', '));
    
    // Try to get Users sheet (will fail if it doesn't exist yet)
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Users!A1:Z1',
      });
      console.log('✅ Users sheet header:', res.data.values?.[0] || '(empty)');
    } catch (e) {
      console.log('ℹ️ Users sheet not created yet (will be created automatically when bot syncs data)');
    }
    
  } catch (e) {
    console.error('❌ Sheets test failed:', e.message);
    if (e?.response?.data) {
      console.error('Details:', e.response.data);
    }
  }
})();